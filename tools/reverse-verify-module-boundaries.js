#!/usr/bin/env node
/* 反向验证：CoreUI 面板收口与 LyricHistory 撤销必须命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const TMP = path.join(os.tmpdir(), "mut-module-boundaries.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 CoreUI 点空白/Esc 不再收面板", s => once(s,
    "function dismissSlots(){\n  for (const k of Object.keys(slotDismissed)) if (slotKeyOn(k)) slotDismissed[k] = true;",
    "function dismissSlots(){\n  return;", "M1"),
    "tests/cases/t275-core-ui-boundary.js", "Escape 收起静音面板"],
  ["M2 LyricHistory undo 不弹快照", s => once(s,
    "  function lyricUndo(arrId, secUid){\n    if (arrId === null || secUid === null) return false;\n    const h = histGet(arrId, secUid);\n    const snap = h.undo.pop();",
    "  function lyricUndo(arrId, secUid){\n    if (arrId === null || secUid === null) return false;\n    const h = histGet(arrId, secUid);\n    const snap = undefined;", "M2"),
    "tests/cases/t276-lyric-history-boundary.js", "撤销空行恢复成功"],
  ["M3 稳定快照每轮重扫 hasStrum", s => once(s,
    "    const strumGrid = strumGridFor(pat);", "    const strumGrid = hasStrum(pat);", "M3"),
    "tests/cases/t277-performance-guards.js", "同一 appliedPat 连续两轮调度只扫描一次"],
  ["M4 冷键写入不进入样本", s => once(s,
    "    coldWriteSamples.push(coldWriteMs);", "    /* 样本写入被删 */", "M4"),
    "tests/cases/t277-performance-guards.js", "两次真实写入进入样本"],
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
