#!/usr/bin/env node
/* 反向验证：空扫分片、模态期间 hover 抽屉与 select 箭头契约必须命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const TMP = path.join(os.tmpdir(), "mut-air-slice-select-drawer.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 分片再次丢失 air", s => once(s,
    "        if (s.air !== undefined) copy.air = s.air;            // 空扫同口径：漏了它，K≥2 下有方向退成实扫、无方向整支消失\n", "", "M1"),
    "tests/cases/t250-air-render.js", "分片后有方向空扫保留 ghost"],
  ["M2 模态弹窗打开时 hover 抽屉仍自动收起", s => once(s,
    "hoverTimer = setTimeout(() => { hoverTimer = null; if (Modal.isOpen()) return; setPresetDrawer(false); }, 400);",
    "hoverTimer = setTimeout(() => { hoverTimer = null; setPresetDrawer(false); }, 400);", "M2"),
    "tests/cases/t174-four-features.js", "模态弹窗打开期间，400ms 到期也不收起 hover 抽屉"],
  ["M3 select 恢复浏览器默认箭头", s => once(s,
    ".loop-sel{-webkit-appearance:none;appearance:none;", ".loop-sel{", "M3"),
    "tests/cases/t278-native-select-style.js", "原生默认箭头退役"],
  ["M4 分组弹窗重新允许 Chrome 自动完成", s => once(s,
    ' id="modalInput" hidden aria-labelledby="modalMsg" autocomplete="off"',
    ' id="modalInput" hidden aria-labelledby="modalMsg"', "M4"),
    "tests/cases/t278-native-select-style.js", "modalInput 显式 autocomplete=off"],
  ["M5 线性箭头错改回 24px", s => once(s,
    "background-size:14px 14px", "background-size:24px 24px", "M5"),
    "tests/cases/t278-native-select-style.js", "箭头恢复 14×14px"],
  ["M6 目标 BPM 输入框退回 46px", s => once(s,
    ".tg-flyout #trTarget{width:64px;min-width:64px;max-width:100%}",
    ".tg-flyout #trTarget{width:46px;min-width:46px;max-width:100%}", "M6"),
    "tests/cases/t278-native-select-style.js", "目标 BPM 输入框放宽到 64px"],
  ["M7 每级输入框退回 46px", s => once(s,
    ".tg-flyout #trEvery{width:64px;min-width:64px;max-width:100%}",
    ".tg-flyout #trEvery{width:46px;min-width:46px;max-width:100%}", "M7"),
    "tests/cases/t278-native-select-style.js", "每级输入框同步放宽"],
];
let hits = 0, misses = 0;
for (const [name, mutate, file, key] of MUTANTS){
  let mut;
  try { mut = mutate(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")); }
  catch (e){ console.log("!! " + e.message); misses++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter(line => line.trim().startsWith("✗"));
  const matched = failed.filter(line => line.includes(key));
  console.log("=".repeat(72) + "\n变异：" + name);
  if (matched.length){
    for (const line of matched) console.log("  " + line.trim());
    console.log("  ✓ 具名断言变红：" + matched.length + " 条"); hits++;
  } else {
    console.log("  ⚠ 未命中目标断言" + (r.status !== 0 ? "（测试崩溃，不算证据）" : ""));
    for (const line of failed.slice(0, 6)) console.log("  " + line.trim());
    misses++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72) + "\n命中 " + hits + " / 未命中 " + misses);
process.exit(misses ? 1 : 0);
