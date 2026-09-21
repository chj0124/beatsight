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

let pass = 0, fail = 0, hangs = 0;
const hangsList = [];

for (const [id, label] of CASES){
  let raw = "", timedOut = false;
  const t0 = Date.now();
  try {
    raw = execFileSync(process.execPath, [path.join(__dirname, "hang-case.js"), id],
      { encoding: "utf8", timeout: TIMEOUT, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e){
    if (e.killed || e.signal) timedOut = true;
    else raw = (e.stdout || "") + (e.stderr || "");
  }
  const ms = Date.now() - t0;

  if (timedOut){
    hangs++; hangsList.push(id);
    console.log("  ✗ " + id.padEnd(20) + " 超时强杀 " + (ms / 1000).toFixed(1) + "s"
      + "  ← 主线程死循环（用户侧表现：标签页卡死）");
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
console.log("  结果：" + pass + " PASS / " + fail + " FAIL / " + hangs + " 死循环超时");
if (hangsList.length) console.log("  死循环用例：" + hangsList.join(", "));
process.exit(fail || hangs ? 1 : 0);
