/* ================================================================================
   BeatSight 自动化测试 · 装配入口
   运行：node tests/run.js
   ---------------------------------------------------------------------------
   本文件只负责「按序装配 + 汇总退出」：
     · 环境与桩：tests/lib/harness.js（vm 沙箱、DOM/音频 stub、drive/driveFrames、断言工具）
     · 用例：tests/cases/*.js，每个文件一个场景组，靠 require 顺序决定执行顺序
   环境变量 BEATSIGHT_HTML 可指向别的构建（用于历史版本对照）。
   ================================================================================ */
"use strict";
const h = require("./lib/harness");

/* 场景组装配顺序 = 执行顺序。新增文件请追加到末尾，保持既有用例的报错定位稳定。 */
const CASE_FILES = [
  "./cases/t01-store-and-presets",
  "./cases/t08-beat-model",
  "./cases/t13-timbre-and-controllers",
  "./cases/t20-pattern-switching",
  "./cases/t23-dirty-value-robustness",
  "./cases/t24-audit-hardening",
  "./cases/t30-wiring-and-lifetime",
  "./cases/t37-stats-and-training",
  "./cases/t47-stroke-direction",
  "./cases/t48-practice-limit",
];
for (const f of CASE_FILES) require(f);

const { pass, fail, failNames } = h.stats();
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
