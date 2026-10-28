#!/usr/bin/env node
/* 反向变异验证（分页档位 / 滚动单行专注视图 / 谱内避让坐标）。只改临时副本，必须出现具名 ✗。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-scroll-focus-lyrics.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次，必须恰好 1 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 分页 1 行档复活", s => once(s,
    "const VIZ_ROW_COUNTS = [2, 3, 4];", "const VIZ_ROW_COUNTS = [1, 2, 3, 4];", "M1"),
   ["三个分页档位按钮", "旧分页 1 行偏好"]],
  ["M2 单行大号类不再挂载", s => once(s,
    'viz.classList.toggle("scroll-belt", !!S.scrollMode && scrollRows() === 1);',
    'viz.classList.toggle("scroll-belt", false);', "M2"),
   ["滚动 1 行挂大号专注视图类"]],
  ["M3 普通单行谱面退回 44px", s => once(s,
    "#viz.scroll-belt{--cell-h:66px;", "#viz.scroll-belt{--cell-h:44px;", "M3"),
   ["桌面普通档：44→66"]],
  ["M4 大号逐弦歌词仍按 56px 居中", s => once(s,
    'const tabH = viz.classList.contains("scroll-belt")\n          ? ((cell && cell.offsetHeight) || (viz.classList.contains("has-pick") ? 84 : 66))\n          : (viz.classList.contains("has-pick") ? 56 : ((cell && cell.offsetHeight) || 44));',
    'const tabH = viz.classList.contains("has-pick") ? 56 : ((cell && cell.offsetHeight) || 44);', "M4"),
   ["大号单行的谱内歌词居中读实际格高"]],
  ["M5 避让退回混用屏幕坐标", s => once(s,
    "symbols.push({ left: mr.left - gr.left - pad, right: mr.right - gr.left + pad });",
    "symbols.push({ left: mr.left - rr.left - pad, right: mr.right - rr.left + pad });", "M5"),
   ["箭头减网格行 rect", "不得把未同步落位的箭头屏幕坐标"]],
];

let hitN = 0, missN = 0;
for (const [name, fn, keys] of MUTANTS){
  let mut;
  try { mut = fn(orig); } catch (e){
    console.log("!! " + e.message); missN++; continue;
  }
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
