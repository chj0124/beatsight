#!/usr/bin/env node
/* 反向变异验证（T204f · 编排情境化帮助）。用法：node tools/reverse-verify-t204-contextual-help.js
   M1 删换位说明；M2 删时值说明；M3 顶部恢复集中长说明。
   变异只改临时副本，目标断言必须具名变红，锚点失配必须大声失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-t204-contextual-help.html");
const replaceOnce = (s, from, to, name) => {
  if (s.split(from).length !== 2) throw new Error("锚点非唯一/缺失：" + name);
  return s.replace(from, to);
};
const MUTANTS = [
  ["M1 删除换位情境说明", s => replaceOnce(s,
    "    noteTo(gSwap, \"也可顶着邻字推过半程，松手换位。\");\n", "", "M1 换位说明"),
   ["精修内恰好两条情境说明", "换位说明沉在换位按钮之后", "换位说明随换位组一起折叠"]],
  ["M2 删除时值情境说明", s => replaceOnce(s,
    "    noteTo(gDur, `拖字块右缘也可改时值，松手吸附 ${LYRIC_GRID} tick；窄块建议用「时值±1格」。`);\n", "", "M2 时值说明"),
   ["精修内恰好两条情境说明", "时值说明沉在时值按钮之后", "时值说明随时值组一起折叠"]],
  ["M3 顶部恢复集中长说明", s => replaceOnce(s,
    "return head + ` · ${line.chars.length} 个字：拖字块改起点，跨行即换小节；选中后可在「精修」中调整时值或换位`;",
    "return head + ` · ${line.chars.length} 个字：拖字块改起点、拖右缘改时值；顶着邻字推过半程松手 = 与它换位`;", "M3 顶部说明"),
   ["顶部只保留状态、移动说明与精修入口", "顶部不再重复时值与换位长说明"]],
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
