#!/usr/bin/env node
/* 反向变异验证（v3.53.2 · 弹法选项归位 + 空扫语义收口 + 编辑器作用域）。用法：node tools/reverse-verify-v3532.js

   八个变异各自退掉一处，对应用例的具名断言必须变红：
     M1 琶音档 airRow 回显；M2 点琶音不删 air；M3 restRow 四档恒显；
     M4 从休止进扫弦不默认实扫；M5 restRow 撤节拍档守卫；
     M6 airRow 不再联动 rest；M7 加载/导入撤掉 air=true ⇒ rest=true；
     M8 同档扫弦误清空扫 rest。
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。
   （JS 版先例 v3421/v3450；Windows 沙箱无 Python 运行时，沿用 JS 惯例。） */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
const TMP = path.join(os.tmpdir(), "mut-v3532.html");

const MUTANTS = [
  ["M1 显隐矩阵 arp 档 airRow 回显（琶音也可空划）", s => s.replace(
    'airRow: dirUsable && tech === "strum",',
    'airRow: dirUsable && (tech === "strum" || tech === "arp"),'),
   ["琶音档：方向/手部/逐弦收", "弦区显示"]],

  ["M2 点琶音落库不删 air（落库表与行为背离）", s => s.replace(
    's.dir = "A"; delete s.str; delete s.air;',
    's.dir = "A"; delete s.str;'),
   ["点「琶音」", "air 删", "无空扫概念"]],

  ["M3 restRow 改成四档恒显（休止入口漏回扫弦/琶音/分解）", s => s.replace(
    'restRow: dirUsable && tech === "beat",',
    'restRow: dirUsable,'),
   ["发声/休止收", "必须发声"]],

  ["M4 从休止切扫弦不默认实扫（rest/air 不重置）", s => s.replace(
    's.rest = false; s.air = false;',
    '// 变异：从休止进扫弦仍保持静默'),
   ["休止节拍 →「扫弦」", "默认实扫"]],

  ["M5 restRow 处理器撤掉节拍档守卫（隐藏行可写休止）", s => s.replace(
    'if (!s || stepTechOf(s) !== "beat") return;',
    'if (!s) return;'),
   ["合成事件", "二道防线"]],

  ["M6 airRow 只写 air、不联动 rest（空扫错误发声）", s => s.replace(
    's.air = wantAir;\n    s.rest = wantAir;',
    's.air = wantAir;'),
   ["点「空扫」", "rest=true + air=true"]],

  ["M7 加载/导入撤掉 air=true ⇒ rest=true（旧错误组合复活）", s => s.replace(
    'if (air === true) rest = true;',
    '// 变异：air=true 允许 rest=false'),
   ["强制归一 rest=true"]],

  ["M8 同档扫弦误清 rest（已有空扫被改成实扫）", s => s.replace(
    'if (from === want && (want === "beat" || want === "strum" || !s.rest)) return;',
    'if (from === want && (want === "beat" || !s.rest)) return;').replace(
    'if (from !== "strum"){',
    'if (true){'),
   ["已是空扫再点「扫弦」", "不被误改为实扫"]],
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
