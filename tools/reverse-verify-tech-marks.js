#!/usr/bin/env node
/* 反向变异验证：六线谱技巧连接、哑音与 P.M. 五条关键契约。
   变异只写临时副本；每项必须出现对应的具名 ✗，锚点失配或进程崩溃均不算证据。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-tech-marks.html");
const MUTANTS = [
  ["M1 回退品数+技巧后缀", s => s.replace(
    'const label = e.dead ? "×" : (e.f !== undefined && e.f !== null ? String(e.f) : "");',
    'const label = (e.f !== undefined && e.f !== null ? String(e.f) : "") + (e.tech || "");'),
   ["不再拼接「0P」"]],
  ["M2 同弦前音解析失效", s => s.replace(
    "function techSourceFor(bar, to, s){",
    "function techSourceFor(bar, to, s){ return null;"),
   ["三条有效同弦连接", "目标音写入 S"]],
  ["M3 哑音不再显示 ×", s => s.replace(
    'const label = e.dead ? "×" : (e.f !== undefined && e.f !== null ? String(e.f) : "");',
    'const label = (e.f !== undefined && e.f !== null ? String(e.f) : "");'),
   ["哑音以 × 代替品数"]],
  ["M4 P.M. 区间合并失效", s => s.replace(
    "function pmRunsFor(bar){",
    "function pmRunsFor(bar){ return [];"),
   ["连续三个 pm 步合并为一个 P.M. 区间"]],
  ["M5 编辑缓存指纹漏 pm", s => s.replace(
    '+ (x.str ? JSON.stringify(x.str) : "") + "," + (x.air ? 1 : 0) + "," + (x.pm ? 1 : 0) + ";";',
    '+ (x.str ? JSON.stringify(x.str) : "") + "," + (x.air ? 1 : 0) + ";";'),
   ["barFinger 含 pm"]],
];
let hits = 0, misses = 0;
for (const [name, mutate, keys] of MUTANTS){
  const mut = mutate(orig);
  if (mut === orig){ console.log("!! 锚点失配：" + name); misses++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/run.js"], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP },
    encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map(x => x.trim()).filter(x => x.startsWith("✗"));
  const named = failed.filter(x => keys.some(k => x.includes(k)));
  console.log("=".repeat(60) + "\n" + name);
  if (named.length){
    named.slice(0, 4).forEach(x => console.log("  " + x));
    console.log("  ✓ 具名断言变红：" + named.length + " 条"); hits++;
  } else {
    console.log("  ⚠ 未命中预期断言；exit=" + r.status + "；实际失败：" + failed.slice(0, 3).join(" | ")); misses++;
  }
}
try { fs.rmSync(TMP, { force: true }); } catch (e) {}
console.log("=".repeat(60) + `\n命中 ${hits} / 失配 ${misses}`);
process.exit(misses ? 1 : 0);
