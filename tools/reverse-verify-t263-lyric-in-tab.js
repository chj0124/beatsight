#!/usr/bin/env node
/* 反向变异验证（T263/T264 · 歌词嵌入六线谱）。用法：node tools/reverse-verify-t263-lyric-in-tab.js
   七个变异只改临时副本；必须出现具名 ✗，崩溃不算证据，锚点失配大声失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-t263-lyric-in-tab.html");
const MUTANTS = [
  ["M1 移动端直接透传 tab", s => s.replace(
    'return requested === "tab" && !canOfferLyricTab() ? "follow" : requested;',
    'return requested;'), ["移动端实际贴行"]],
  ["M2 中央定位误用整行盒高", s => s.replace(
    "y = g ? g.top + (tabH - 28) / 2 : (i * 32);",
    "y = g ? g.top + vizRowBoxH / 2 : (i * 32);"), ["（中央）", "不是整行"]],
  ["M3 tab 摘掉行高守恒补偿", s => s.replace(
    "setLyricInlineOn(overlay);",
    'setLyricInlineOn(visible && actual === "follow");'), ["谱内保留行距补偿"]],
  ["M4 横向右移上限 32→8", s => s.replace(
    "LYRIC_TAB_MAX_SHIFT = 32",
    "LYRIC_TAB_MAX_SHIFT = 8"), ["与记号相交"]],
  ["M5 音高开启仍强行谱内", s => s.replace(
    '      else if (S.pitchNotation !== "off"){ actual = "follow"; reason = "pitch"; }\n',
    ""), ["音高标注开启 → follow"]],
  ["M6 独立旋律仍强行谱内", s => s.replace(
    '      else if (lyricRows.some(row => row.noteN > 0)){ actual = "follow"; reason = "standalone"; }\n',
    ""), ["窗口含独立旋律音符 → follow"]],
  ["M7 排版测量挪进逐帧歌词路径", s => s.replace(
    "    if (!lane || lane.hidden) return;           // 预设模式 / 无歌词行：整帧零开销（T27 走的就是这条）",
    "    if (!lane || lane.hidden) return;           // 预设模式 / 无歌词行：整帧零开销（T27 走的就是这条）\n    fitLyricTabLayout(lane);"),
   ["谱内排版测量不得进入 paintLyric 逐帧路径"]],
  ["M8 谱内歌词恢复深色描边光晕", s => s.replace(
    "#lyricLane.in-tab .lyric-char{color:var(--t2)}",
    "#lyricLane.in-tab .lyric-char{color:var(--t2);-webkit-text-stroke:2px var(--bg);paint-order:stroke fill;text-shadow:0 0 2px var(--bg)}"),
   ["谱内歌词使用纯色，不带深色描边或光晕"]],
  ["M9 唱完保留特殊色并恢复下划线", s => s.replace(
    "#lyricLane.in-tab .lyric-chip .lfill{display:none}",
    "#lyricLane.in-tab .lyric-chip.played .lyric-char{color:var(--on-green)}\n#lyricLane.in-tab .lyric-chip .lfill{top:auto;bottom:0;height:2px;background:var(--t3);z-index:3}"),
   ["唱完恢复普通色，不保留 played 特殊色", "谱内不显示逐字下划线"]],
];

let hitN = 0, missN = 0;
const ONLY = process.env.MUT_ONLY || "";
for (const [name, fn, keys] of MUTANTS){
  if (ONLY && !name.startsWith(ONLY + " ")) continue;
  const mut = fn(orig);
  if (mut === orig){ console.log("!! 变异未生效（锚点失配）：" + name); missN++; continue; }
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
try{ fs.unlinkSync(TMP); }catch(_){}
console.log("=".repeat(72) + "\n命中 " + hitN + " / 未命中 " + missN);
process.exit(missN ? 1 : 0);
