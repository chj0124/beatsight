#!/usr/bin/env node
/* 反向变异验证（矢量 Chevron 尖端定位 / 伪元素隔离）。只改临时副本，必须出现具名 ✗。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-chevron-vector.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次，必须恰好 1 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 上扫尖端向下错 4px", s => once(s,
    ".strumv.dn::after{top:calc(var(--y1) - 5px)}",
    ".strumv.dn::after{top:calc(var(--y1) + 4px)}", "M1"),
   ["dn（下扫 6→1）用路径尖端"]],
  ["M2 下扫尖端向上错 6px", s => once(s,
    ".strumv.up::after{top:calc(var(--y2) - 11px)",
    ".strumv.up::after{top:calc(var(--y2) - 5px)", "M2"),
   ["up（上扫 1→6）用路径尖端"]],
  ["M3 无方向空扫与逐弦拨弦恢复折线头", s => once(s,
    ".strumv.air::after,.strumv.pick::after{content:none}",
    ".strumv.air::after,.strumv.pick::after{content:\"\"}", "M3"),
   ["无方向空扫的 ::after 显式关闭", "逐弦拨弦的 ::after 显式关闭"]],
];
let hitN = 0, missN = 0;
for (const [name, fn, keys] of MUTANTS){
  let mut;
  try { mut = fn(orig); } catch (e){ console.log("!! " + e.message); missN++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/run.js"], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP },
    encoding: "utf8", timeout: 1800000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map(l => l.trim()).filter(l => l.startsWith("✗")).map(l => l.slice(1).trim());
  const m = out.match(/(\d+) PASS \/ (\d+) FAIL/);
  console.log("=".repeat(72) + "\n变异：" + name);
  const hit = failed.filter(f => keys.some(k => f.includes(k)));
  if (hit.length){
    console.log("  " + (m ? m[0] : "(未取到汇总)"));
    for (const f of hit.slice(0, 5)) console.log("   ✗ " + f.slice(0, 110));
    console.log("  ✓ 具名断言变红：" + hit.length + " 条"); hitN++;
  } else {
    console.log("  ⚠ 无具名断言变红（" + (m ? m[0] : "崩溃") + "）");
    for (const f of failed.slice(0, 5)) console.log("     (实际红的是) ✗ " + f.slice(0, 110));
    missN++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72) + "\n命中 " + hitN + " / 未命中 " + missN);
process.exit(missN ? 1 : 0);
