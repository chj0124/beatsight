#!/usr/bin/env node
/* 反向变异验证 · 帧路径布局读取纪律（三视角体检 2026-10-15 · C2）。用法：node tools/reverse-verify-t260-frame-geometry.js

   三个变异各往 paintFrame / paintFrameBody / paintBall 的函数体里**注回一次布局读取**，
   t260 的具名断言必须变红（否则这道纪律就没被真正守住）。

   三条铁律：
     · 变异只改临时副本（/tmp/mut-t260-*.html），绝不落回仓库；
     · 必须出现**具名** ✗（用例崩溃不算证据）；
     · 锚点失配要大声失败（源文本变了 → 打印「变异未生效」并计入未命中）。

   ★ 与 v3532 等脚本的两点差异（刻意的）：
     ① 只跑**单个用例文件**（tests/cases/t260-*.js）而不是整套 tests/run.js——
        t260 是纯源码扫描（不 loadApp），单跑是毫秒级；整套跑一遍 40s 对这条断言毫无增量。
     ② 变异形态用 `if (false) void <布局读取>;`：静态扫描看得见、运行期永不执行——
        以此证明**是 t260 的静态断言**在守，而不是被 T27 的运行期探针顺手挡下。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
const TMP = path.join(os.tmpdir(), "mut-t260-frame-geometry.html");
const CASE = path.join("tests", "cases", "t260-frame-geometry-discipline.js");

const MUTANTS = [
  ["M1 paintFrame 体内注回布局读取（document.body.offsetWidth）",
   s => s.replace("function paintFrame(){",
     "function paintFrame(){ if (false) void document.body.offsetWidth;"),
   ["paintFrame 体内零布局读取"]],

  ["M2 paintFrameBody 体内注回布局读取（document.body.clientWidth）",
   s => s.replace("function paintFrameBody(){",
     "function paintFrameBody(){ if (false) void document.body.clientWidth;"),
   ["paintFrameBody 体内零布局读取"]],

  ["M3 paintBall 体内注回布局读取（ballEl.getBoundingClientRect）",
   s => s.replace("function paintBall(now, bar, tib, a){",
     "function paintBall(now, bar, tib, a){ if (false) void ballEl.getBoundingClientRect;"),
   ["paintBall 体内零布局读取"]],
];

let hitN = 0, missN = 0;
for (const [name, fn, keys] of MUTANTS) {
  const mut = fn(orig);
  if (mut === orig) {
    console.log("!! 变异未生效（锚点失配）：" + name);
    missN++;
    continue;
  }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, [CASE], {
    cwd: ROOT, env: Object.assign({}, process.env, { BEATSIGHT_HTML: TMP }),
    encoding: "utf-8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map(l => l.trim())
    .filter(l => l.startsWith("✗")).map(l => l.slice(1).trim());
  console.log("=".repeat(72));
  console.log("变异：" + name);
  const hit = failed.filter(f => keys.some(k => f.includes(k)));
  if (hit.length) {
    console.log("  ✓ 具名断言变红：" + hit.length + " 条");
    for (const f of hit.slice(0, 3)) console.log("   ✗ " + f.slice(0, 110));
    hitN++;
  } else {
    console.log("  ⚠ 无具名断言变红");
    for (const f of failed.slice(0, 5)) console.log("     (实际红的是) ✗ " + f.slice(0, 110));
    missN++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72));
console.log("命中 " + hitN + " / " + MUTANTS.length + "（未命中 " + missN + "）");
process.exit(missN ? 1 : 0);
