/* 死循环看门狗：node tests/hang-guard.js [超时毫秒，默认 8000]
   ---------------------------------------------------------------------------
   解决的问题：tests/run.js 是**单进程**跑的，如果某个用例把主线程卡进死循环
   （历史案例：持久值 sig:-3 让 scheduler 的空小节分支永不推进），
   整个测试进程会挂住——CI 上的表现是**跑满 6 小时超时**，而不是干脆失败。
   单进程内加 setTimeout 看门狗没有用：主线程被占死时定时器根本轮不到执行。

   所以这里换个思路：**每个用例起一个子进程**，父进程按超时强杀。
   「被强杀」本身就是判定依据——文件名里带 guard，指的就是这道超时保护。

   用例清单与判定口径见 tests/hang-case.js，与 run.js 的 T23 系列互补：
   run.js 管「值对不对」，本文件管「会不会把主线程卡死」。 */
"use strict";
const { execFileSync } = require("child_process");
const path = require("path");

const TIMEOUT = +(process.argv[2] || 8000);

/* v2.8.16（审计 P2-2）：清单不再在本文件手抄一份——向 hang-case.js 索要（`--list`）。
   此前两处各维护一份 id/标签，新增探针只改一处就会「本文件漏跑 / hang-case 走到未知用例」，
   且两个方向都不会被闸门发现。现在本文件只负责超时强杀，清单以实现文件为准。 */
let CASES;
try {
  CASES = execFileSync(process.execPath, [path.join(__dirname, "hang-case.js"), "--list"],
    { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(l => {
      const i = l.indexOf("|");
      return i < 0 ? [l, ""] : [l.slice(0, i), l.slice(i + 1)];
    });
} catch (e){
  console.error("✗ 无法从 hang-case.js 取得用例清单（--list）：" + e.message);
  console.error("  这是**工具故障，不是用例失败**——本步骤未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
}

console.log("══════════════════════════════════════════════════════════");
console.log("  死循环看门狗 · 每用例独立子进程，超时 " + TIMEOUT + "ms 强杀");
console.log("══════════════════════════════════════════════════════════");

let pass = 0, fail = 0, hangs = 0, toolFaults = 0;
const hangsList = [];
const toolFaultList = [];

for (const [id, label] of CASES){
  let raw = "", timedOut = false, killedSignal = null, toolFail = false;
  const t0 = Date.now();
  try {
    raw = execFileSync(process.execPath, [path.join(__dirname, "hang-case.js"), id],
      { encoding: "utf8", timeout: TIMEOUT, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e){
    /* ★ 判"是不是死循环"只能按**超时**，不能按"有没有信号"：
       execFileSync 超时会杀子进程（signal=SIGTERM），但 **OOM(SIGKILL) / 段错误(SIGSEGV) /
       abort(SIGABRT) 同样会让 e.signal 有值**。老写法 `if (e.killed || e.signal) timedOut = true`
       把后三种一并报成"主线程死循环"——把一个环境/崩溃问题指到一个不存在的地方去查。
       区分依据（与 check-all 的退出码约定对齐）：
         · 超时强杀：实际耗时已到 TIMEOUT（留 50ms 抖动余量）且被信号终止
         · 其它信号：被信号终止但没跑满超时 → 疑似 OOM / 进程崩溃，归**工具故障**（退出码 4），
                     不是死循环，也不该伪装成用例失败
         · 子进程自报未执行：退出码 4（hang-case 用它表达"输入/工具故障"）
         · 其余：普通非零退出，把 stdout/stderr 交给下面按输出判定 */
    const elapsed = Date.now() - t0;
    if (elapsed >= TIMEOUT - 50 && (e.killed || e.signal)) timedOut = true;
    else if (e.signal) killedSignal = e.signal;
    else if (e.status === 4) toolFail = true;
    else raw = (e.stdout || "") + (e.stderr || "");
  }
  const ms = Date.now() - t0;

  if (timedOut){
    hangs++; hangsList.push(id);
    console.log("  ✗ " + id.padEnd(20) + " 超时强杀 " + (ms / 1000).toFixed(1) + "s"
      + "  ← 主线程死循环（用户侧表现：标签页卡死）");
    continue;
  }

  if (killedSignal){
    toolFaults++; toolFaultList.push(id);
    console.log("  ⚠ " + id.padEnd(20) + " 被信号 " + killedSignal + " 终止 " + (ms / 1000).toFixed(1) + "s"
      + "  ← 疑似 OOM / 进程崩溃，**不是主线程死循环**；本用例未被验证");
    continue;
  }

  if (toolFail){
    toolFaults++; toolFaultList.push(id);
    console.log("  ⚠ " + id.padEnd(20) + " 子进程自报未能执行（退出码 4）——工具/输入故障，不是用例失败");
    continue;
  }

  const lines = raw.trim().split("\n").filter(l => l.includes("|"));
  if (!lines.length){
    fail++;
    console.log("  ✗ " + id.padEnd(20) + " 无输出（进程异常退出）");
    continue;
  }

  let bad = 0;
  const detail = [];
  for (const l of lines){
    const [st, name, d] = l.split("|");
    if (st === "PASS") pass++;
    else { fail++; bad++; }
    detail.push((st === "PASS" ? "      ✓ " : "      ✗ ") + name + (d ? "  [" + d + "]" : ""));
  }
  console.log("  " + (bad ? "✗" : "✓") + " " + id.padEnd(20) + (ms / 1000).toFixed(1) + "s  " + label);
  detail.forEach(d => console.log(d));
}

console.log();
console.log("  结果：" + pass + " PASS / " + fail + " FAIL / " + hangs + " 死循环超时"
  + (toolFaults ? " / " + toolFaults + " 工具故障未验证" : ""));
if (hangsList.length) console.log("  死循环用例：" + hangsList.join(", "));
if (toolFaultList.length) console.log("  未验证用例（工具故障，非死循环）：" + toolFaultList.join(", "));
/* 退出码约定与 check-all 一致：1 = 有用例失败/死循环；4 = **工具故障**（本步骤未被验证，
   check-all 会标 ⚠ 并继续）；0 = 通过。有真失败时以 1 优先（真失败才是要被处置的那个）。 */
process.exit(fail || hangs ? 1 : (toolFaults ? 4 : 0));
