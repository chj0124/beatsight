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
  "./cases/t49-ear-training",
  "./cases/t50-practice-coverage",
  "./cases/t51-arrangement-model",
  "./cases/t52-arrangement-cursor",
  "./cases/t53-arrangement-playback",
  "./cases/t54-arrangement-ui",
  "./cases/t55-help",
  "./cases/t56-diagnostics",
  "./cases/t57-overlay-listeners",
  "./cases/t58-p0-audit",              // v2.0.5：审计 P0 批次（抛错读盘 / 脏值域 / 级数 / 无障碍）
  "./cases/t59-p1-audit",              // v2.0.6：审计 P1 批次（句柄重入 / ctx 重建 / 数据边界 / 重锚计数）
  "./cases/t60-lyric-align",           // v2.1.0：F1 歌词对齐轨（数据层 / 段内解析 / 渲染 / 锚点音 / 编辑轨）
];
for (const f of CASE_FILES) require(f);

const { pass, fail, failNames } = h.stats();
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
