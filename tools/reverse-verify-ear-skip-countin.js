#!/usr/bin/env node
/* 反向验证：听辨训练的单次预备拍跳过必须命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const TMP = path.join(os.tmpdir(), "mut-ear-skip-countin.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 听辨播放不再传跳过参数", s => once(s,
    "    Controls.start({ skipCountIn: true });", "    Controls.start();", "M1")],
  ["M2 start 忽略单次跳过参数", s => once(s,
    "if (!options.skipCountIn && S.countIn.on && S.countIn.beats > 0)",
    "if (S.countIn.on && S.countIn.beats > 0)", "M2")],
];
let hits = 0, misses = 0;
for (const [name, mutate] of MUTANTS){
  let mut;
  try { mut = mutate(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")); }
  catch (e){ console.log("!! " + e.message); misses++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/cases/t49-ear-training.js"], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter(line => line.trim().startsWith("✗"));
  const matched = failed.filter(line => line.includes("听辨跳过预备拍"));
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
