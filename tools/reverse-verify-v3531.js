#!/usr/bin/env node
/* 反向变异验证（v3.53.1 批 6 · 琶音去空扫）——证明「琶音档移除空扫开关」的两处改动
   各自有具名断言守着。用法：node tools/reverse-verify-v3531.js

   两个变异各自退掉一处，对应用例的具名断言必须变红：
     M1 显隐矩阵 arp 档 airRow 回显（退回批 3 口径「琶音也可空划」）→ t256d「琶音档：方向/手部收」红
     M2 点琶音落库不删 air（字段落库表与行为背离）→ t256b「点「琶音」→ air 删」红
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。
   （JS 版先例 v3421/v3450；Windows 沙箱无 Python 运行时，沿用 JS 惯例。） */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
const TMP = path.join(os.tmpdir(), "mut-v3531.html");

const MUTANTS = [
  ["M1 显隐矩阵 arp 档 airRow 回显（退回批 3「琶音也可空划」口径）", s => s.replace(
    'airRow: dirUsable && tech === "strum",',
    'airRow: dirUsable && (tech === "strum" || tech === "arp"),'),
   ["琶音档：方向/手部收", "手部收", "显隐"]],

  ["M2 点琶音落库不删 air（落库表与行为背离）", s => s.replace(
    's.dir = "A"; delete s.str; delete s.air;',
    's.dir = "A"; delete s.str;'),
   ["点「琶音」", "air 删", "无空扫概念"]],
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
