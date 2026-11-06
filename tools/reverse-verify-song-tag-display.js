#!/usr/bin/env node
/* 反向验证：出处括号格式化与下节预告接线必须在临时副本上命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-song-tag-display.html");

function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
function failures(cases){
  const failed = [];
  for (const file of cases){
    const r = spawnSync(process.execPath, [file], {
      cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status !== 0) return { crashed: true, failed };
    for (const line of out.split("\n")) if (line.trim().startsWith("✗")) failed.push(line.trim());
  }
  return { crashed: false, failed };
}
const FORMAT_CASES = ["tests/cases/t221-bottom-bar-and-playing-dot.js", "tests/cases/t242-editor-template-select.js"];
const PREVIEW_CASES = ["tests/cases/t75-page-flip-preview.js"];
const FORMAT_KEYS = ["出处括号改空格", "预设库条目以空格分隔", "第二首示例曲按 1–5 排列"];
const MUTANTS = [
  ["M1 显示格式化退化为原样", s => once(s,
    'const displayPatternName = nm => String(nm || "").replace(SONG_TAG_RE, tag => " " + tag.slice(1, -1));',
    'const displayPatternName = nm => String(nm || "");', "M1"), FORMAT_CASES, FORMAT_KEYS],
  ["M2 下节预告绕过显示格式化", s => once(s,
    'const pvName = (b === 0 && winPrevSeg >= 0 && winPrevName) ? displayPatternName(winPrevName) : "";',
    'const pvName = (b === 0 && winPrevSeg >= 0 && winPrevName) ? winPrevName : "";', "M2"), PREVIEW_CASES, ["胶囊"]],
];
let hits = 0, misses = 0;
for (const [name, mutate, cases, keys] of MUTANTS){
  let mut;
  try { mut = mutate(orig); } catch (e){
    console.log("!! " + e.message); misses++; continue;
  }
  fs.writeFileSync(TMP, mut);
  const result = failures(cases);
  const matched = keys.filter(key => result.failed.some(line => line.includes(key)));
  console.log("=".repeat(72) + "\n变异：" + name);
  if (!result.crashed && matched.length === keys.length){
    for (const line of result.failed) console.log("  " + line.slice(0, 160));
    console.log("  ✓ 具名断言变红：" + result.failed.length + " 条"); hits++;
  } else {
    console.log("  ⚠ 未完整命中目标断言" + (result.crashed ? "（测试崩溃，不算证据）" : ""));
    for (const line of result.failed.slice(0, 8)) console.log("  " + line.slice(0, 160));
    misses++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72) + "\n命中 " + hits + " / 未命中 " + misses);
process.exit(misses ? 1 : 0);
