#!/usr/bin/env node
/* 反向变异验证（T259c · 编辑页局部间距）。用法：node tools/reverse-verify-t259-editor-spacing.js
   M1 编辑标签列退回 78px；M2 分段说明退回无空白的「|」。
   变异只改临时副本，目标断言必须具名变红，锚点失配必须大声失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-t259-editor-spacing.html");
const replaceOnce = (s, from, to, name) => {
  if (s.split(from).length !== 2) throw new Error("锚点非唯一/缺失：" + name);
  return s.replace(from, to);
};
const MUTANTS = [
  ["M1 编辑标签列退回 78px", s => replaceOnce(s,
    ".edbar-label{width:88px;flex:none}", ".edbar-label{width:78px;flex:none}", "M1 标签列"),
   ["编辑标签列 = 88px"]],
  ["M2 分段说明退回无空白竖线", s => replaceOnce(s,
    "用「 | 」分段会按片段均分", "用「|」分段会按片段均分", "M2 分段说明"),
   ["分段竖线在引号内留空"]],
];

let hitN = 0, missN = 0, rotN = 0;
for (const [name, fn, keys] of MUTANTS) {
  let mut;
  try { mut = fn(orig); }
  catch (err) { console.log("!! 脚本自身腐烂：" + name + "：" + err.message); rotN++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/run.js"], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP },
    encoding: "utf8", timeout: 1800000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map(l => l.trim()).filter(l => l.startsWith("✗")).map(l => l.slice(1).trim());
  const summary = out.match(/(\d+) PASS \/ (\d+) FAIL/);
  const hit = failed.filter(f => keys.some(k => f.includes(k)));
  console.log("=".repeat(72) + "\n变异：" + name);
  if (hit.length) {
    console.log("  " + (summary ? summary[0] : "(未取到汇总)"));
    for (const f of hit) console.log("  ✗ " + f);
    console.log("  ✓ 具名断言变红：" + hit.length + " 条");
    hitN++;
  } else {
    console.log("  ⚠ 无具名断言变红（" + (summary ? summary[0] : "崩溃") + "）");
    for (const f of failed.slice(0, 5)) console.log("    实际红：✗ " + f);
    missN++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72));
console.log("命中 " + hitN + " / 未命中 " + missN + " / 自身腐烂 " + rotN);
process.exit(rotN ? 2 : (missN ? 1 : 0));
