#!/usr/bin/env node
/* 反向变异验证（v3.56.4 · 390 档段名槽回吐）——证明「胶囊几何五枚回吐字面值」各有具名断言守着。
   用法：node tools/reverse-verify-v3564.js

   背景：v3.56.0 令牌收敛在键组（.trio/.arg-now gap 10→12）与胶囊（基座 gap 6→8、≤640 横向
   padding 10→12）上多收 14px，390 档段名槽跌穿 2em 进 nameless（macOS 实测 37.61→<24px；
   CI Linux 字体窄 ~0.8px 恰在阈上——真机侧的字体不敏感闸在 smoke 名字槽 sweep「胶囊盒宽≥130」，
   本脚本只覆盖单测侧）。五个变异各自把一枚字面值退回令牌形态，t221e 的具名断言必须变红：
     M1 .trio gap → var(--sp-3)        （t90 三列 Grid 钉 + t221e 键组三键）
     M2 .arg-now gap → var(--sp-3)     （t221e 键组内间距）
     M3 .pb-ctx 基座 gap → var(--sp-2) （t221e 胶囊基座）
     M4 ≤640 胶囊 padding → sp-1/sp-3  （t221e ≤640 横向 padding）
     M5 ≤640 状态灯 padding-left → sp-3（t221e 状态灯成对不变量）
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。
   （JS 版先例 v3421/v3450/v3531；Windows 沙箱无 Python 运行时，沿用 JS 惯例。） */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
const TMP = path.join(os.tmpdir(), "mut-v3564.html");

const MUTANTS = [
  ["M1 .trio gap 10→var(--sp-3)（键组三键被令牌化）", s => s.replace(
    '.trio{display:flex;gap:10px;grid-column:2;align-items:center}',
    '.trio{display:flex;gap:var(--sp-3);grid-column:2;align-items:center}'),
   ["跳段行三列 Grid", "键组三键 gap:10px"]],

  ["M2 .arg-now gap 10→var(--sp-3)（键组内间距被令牌化）", s => s.replace(
    '.arg-now{display:flex;align-items:center;gap:10px;margin-top:12px',
    '.arg-now{display:flex;align-items:center;gap:var(--sp-3);margin-top:12px'),
   ["键组内间距 gap:10px"]],

  ["M3 .pb-ctx 基座 gap 6→var(--sp-2)（胶囊内部间距被令牌化）", s => s.replace(
    '.pb-ctx{justify-self:start;display:flex;align-items:center;gap:6px',
    '.pb-ctx{justify-self:start;display:flex;align-items:center;gap:var(--sp-2)'),
   ["胶囊基座 gap:6px"]],

  ["M4 ≤640 胶囊横向 padding 10→var(--sp-3)（窄档胶囊被令牌化）", s => s.replace(
    'padding:4px 10px;font-size:11px}',
    'padding:var(--sp-1) var(--sp-3);font-size:11px}'),
   ["≤640 胶囊横向 padding:10px"]],

  ["M5 ≤640 状态灯 padding-left 10→var(--sp-3)（对齐不变量的另一半被令牌化）", s => s.replace(
    '.play-bar .status{padding-left:10px}',
    '.play-bar .status{padding-left:var(--sp-3)}'),
   ["状态灯 padding-left:10px"]],
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
