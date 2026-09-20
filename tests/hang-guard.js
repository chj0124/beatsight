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

const CASES = [
  ["sig_abc",            "脏拍号 abc"],
  ["sig_neg",            "脏拍号 -3（v1.2.3 实测主线程死循环）"],
  ["sig_big",            "脏拍号 99"],
  ["sig_zero",           "脏拍号 0"],
  ["sig_null",           "脏拍号 null"],
  ["sig_bool",           "脏拍号 true"],
  ["customs_empty_bar",  "空小节自定义预设"],
  ["vol_big",            "音量 1e6（v1.2.3 实测 +120 dBFS）"],
  ["vol_3",              "音量 3"],
  ["vol_neg",            "音量 -5"],
  ["vol_str",            "音量 \"x\""],
  ["strum_vol_dirty",    "脏扫弦音量（v2.5.0：第二个进热路径的声部音量，带弦区谱驱动）"],
  ["pat_bars_max",       "型长上限 64 小节（v2.5.1：长型必须「能跑」，不只是「能存」）"],
  ["bpm_dirty",          "脏 BPM"],
  ["hunger_skip",        "后台节流 10 分钟后回前台（追赶逻辑写成逐拍会死循环）"],
  ["editor_clear_bar",   "试听中清空小节（真实用户路径）"],
  ["normal_path",        "正常路径（守卫不得误伤）"],
  ["dirty_misc",         "脏重拍分组 / trainer 原型污染"],
];

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
