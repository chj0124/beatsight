#!/usr/bin/env node
/* 反向变异验证（T262 · 设计一致性与可达性收口）。用法：node tools/reverse-verify-t262-design.js

   五个变异各自退掉一处，对应用例的具名断言必须变红：
     M1 日间 --danger-fg 退回 #DC2626；M2 .name-input 恢复 outline:none；
     M3 曲式选中态恢复硬编码经典绿；M4 窄屏标注退回 8/9px；M5 设置页 h2 摘掉 hidden。
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
const TMP = path.join(os.tmpdir(), "mut-t262-design.html");

const MUTANTS = [
  ["M1 日间警示前景退回 #DC2626", s => s.replace(
    "--danger-fg:#B91C1C;",
    "--danger-fg:#DC2626;"),
   ["日间主题 --danger-fg = #B91C1C", "均 ≥4.5:1"]],

  ["M2 文本输入恢复 outline:none", s => s.replace(
    ".name-input{background:var(--card2);border:1px solid var(--line);border-radius:8px;color:var(--t1);font-size:13px;padding:10px 14px;width:280px;font-family:inherit}",
    ".name-input{background:var(--card2);border:1px solid var(--line);border-radius:8px;color:var(--t1);font-size:13px;padding:10px 14px;width:280px;font-family:inherit;outline:none}"),
   ["文本输入 .name-input 不再 outline:none"]],

  ["M3 曲式选中态恢复硬编码经典绿", s => s.replace(
    ".arg-item.sel{background:rgba(var(--green-rgb),.13);color:var(--green);font-weight:500}",
    ".arg-item.sel{background:rgba(30,215,96,.13);color:var(--green);font-weight:500}"),
   ["不再有 rgba(30,215,96", "arg-item.sel"]],

  ["M4 窄屏标注退回 8/9px", s => s.replace(
    ".ruler-lab{top:52px;font-size:10px}\n  .cell-label{top:38px;font-size:10px}",
    ".ruler-lab{top:52px;font-size:9px}\n  .cell-label{top:38px;font-size:8px}"),
   ["窄屏档 .cell-label/.ruler-lab 下限 = 10px", "窄屏时值标注 8px → 10px"]],

  ["M5 设置页标题恢复可见重复", s => s.replace(
    '<h2 class="card-title" hidden>画面</h2>',
    '<h2 class="card-title">画面</h2>'),
   ["页头进 h2 且视觉隐藏"]],
];

let hitN = 0, missN = 0;
for (const [name, fn, keys] of MUTANTS) {
  const mut = fn(orig);
  if (mut === orig) {
    console.log("!! 变异未生效（锚点失配）：" + name);
    missN++;
    continue;
  }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/run.js"], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP },
    encoding: "utf-8", timeout: 1800000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map(l => l.trim()).filter(l => l.startsWith("✗")).map(l => l.slice(1).trim());
  const m = out.match(/(\d+) PASS \/ (\d+) FAIL/);
  console.log("=".repeat(72));
  console.log("变异：" + name);
  const hit = failed.filter(f => keys.some(k => f.includes(k)));
  if (hit.length) {
    console.log("  " + (m ? m[0] : "(未取到汇总)"));
    for (const f of hit.slice(0, 5)) console.log("   ✗ " + f.slice(0, 110));
    console.log("  ✓ 具名断言变红：" + hit.length + " 条");
    hitN++;
  } else {
    console.log("  ⚠ 无具名断言变红（" + (m ? m[0] : "崩溃") + "）");
    for (const f of failed.slice(0, 5)) console.log("     (实际红的是) ✗ " + f.slice(0, 110));
    missN++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72));
console.log("命中 " + hitN + " / 未命中 " + missN);
process.exit(missN ? 1 : 0);
