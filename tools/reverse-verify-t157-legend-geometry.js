#!/usr/bin/env node
/* 反向变异验证（T157f · 图例符号几何）。用法：node tools/reverse-verify-t157-legend-geometry.js
   M1 有头蓝箭头退回 16px；M2 无头杆删除独立居中规则。
   变异只改临时副本，目标断言必须具名变红，锚点失配必须大声失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-t157-legend-geometry.html");
const replaceOnce = (s, from, to, name) => {
  if (s.split(from).length !== 2) throw new Error("锚点非唯一/缺失：" + name);
  return s.replace(from, to);
};
const MUTANTS = [
  ["M1 有头蓝箭头退回 16px", s => {
    let out = replaceOnce(s,
      ".viz-legend .vl-swatch.vl-air::before{content:\"\";position:absolute;left:50%;top:9px;bottom:3px;",
      ".viz-legend .vl-swatch.vl-air::before{content:\"\";position:absolute;left:50%;top:7px;bottom:1px;", "M1 杆身");
    return replaceOnce(out,
      ".viz-legend .vl-swatch.vl-air::after{content:\"\";position:absolute;left:50%;top:3px;",
      ".viz-legend .vl-swatch.vl-air::after{content:\"\";position:absolute;left:50%;top:1px;", "M1 箭头");
  }, ["有头蓝箭头可见高度 = 12px"]],
  ["M2 无头杆删除独立居中规则", s => replaceOnce(s,
    ".viz-legend .vl-swatch.vl-air.vl-nh::before{top:3px;bottom:3px}\n", "", "M2 无头杆"),
   ["无头蓝虚线杆可见高度 = 12px", "无头蓝虚线杆与有头箭头共享可见区顶缘", "无头蓝虚线杆可见中心 = 容器中心"]],
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
