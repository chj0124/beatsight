#!/usr/bin/env node
/* 反向变异验证（T265 · 谱内连续滚动与实际生效态）。只改临时副本，必须出现具名 ✗。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-t265-lyric-tab-scroll-ui.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次，必须恰好 1 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 连续滚动重新强制 follow", s => once(s,
    'if (S.scrollMode) return S.lyricPos === "tab" ? "tab" : "follow";',
    'if (S.scrollMode) return "follow";', "M1"),
   ["连续滚动允许显式 tab", "连续滚动实际进入 tab"]],
  ["M2 设置高亮退回请求值而非实际值", s => once(s,
    'const shownPos = (S.lyricPos === "tab" || (S.scrollMode && S.lyricPos === "bottom")) ? view.actual : S.lyricPos;',
    'const shownPos = S.lyricPos;', "M2"),
   ["请求 tab 不再伪装成生效", "bottom 不再伪装成已生效"]],
  ["M3 音高开启时谱内按钮仍可点", s => once(s,
    "p.disabled = pitchBlocked || scrollBlocked;",
    "p.disabled = scrollBlocked;", "M3"),
   ["音高开启时谱内按钮禁用"]],
  ["M4 连续滚动重新禁用全部位置", s => once(s,
    "p.disabled = pitchBlocked || scrollBlocked;",
    "p.disabled = scrollOn;", "M4"),
   ["auto/follow/tab 在连续滚动中均可选", "auto/follow/tab 可选"]],
  ["M5 滚动谱内 y 退回行下位置", s => once(s,
    "y = g ? g.top + (tabH - 28) / 2 : (i * 32);",
    "y = g ? g.top + (((rowEls[i] && rowEls[i].offsetHeight) || vizRowBoxH) + 2) : (i * 32);", "M5"),
   ["槽居中于 44px 格子带"]],
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
