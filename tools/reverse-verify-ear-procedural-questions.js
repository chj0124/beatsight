#!/usr/bin/env node
/* 反向验证：全拍号覆盖、拍号保密与生成时值合法性必须命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const TMP = path.join(os.tmpdir(), "mut-ear-procedural-questions.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 next 回退到固定第 0 组", s => once(s,
    "    let q = makeGeneratedQuestion(Math.random);",
    "    let q = makeQuestion(Math.random, 0);", "M1"), "next() 覆盖全部拍号"],
  ["M2 播放前重新泄露拍号", s => once(s,
    '    announce("播放题目，共 " + EAR_BARS + " 小节");',
    '    announce("播放题目，共 " + question.answer.meter + " 拍 × " + EAR_BARS + " 小节");', "M2"), "播放前播报不泄露拍号"],
  ["M3 生成时值超出小节", s => once(s,
    "      steps.push({ t, rest: false });",
    "      steps.push({ t: t + 1, rest: false });", "M3"), "全拍号随机生成："],
];
let hits = 0, misses = 0;
for (const [name, mutate, key] of MUTANTS){
  let mut;
  try { mut = mutate(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")); }
  catch (e){ console.log("!! " + e.message); misses++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/cases/t49-ear-training.js"], {
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
