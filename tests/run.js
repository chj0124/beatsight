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
  "./cases/t61-lyric-loop",            // v2.2.0：F2 按歌词行选段循环（落点 / 爬坡粒度 / 跨小节延音完整）
  "./cases/t62-strum-track",           // v2.2.0：扫弦轨升级（zone 三态音色 / 空扫静默 / 录入 UI）
  "./cases/t63-demo-song",             // v2.3.0：示例曲《在他乡》载入（谱面映射 / 幂等 / 播放冒烟）
  "./cases/t64-track-split",           // v2.4.0：双入口拆分（轨状态 / 过滤 / 回退 / 门控 / 零迁移）
  "./cases/t65-practice-loop",         // v2.4.3：练习循环（区间归一 / 下拉 / 调度回绕 / 起始游标 / 曲式收起）
  "./cases/t66-mode-contract",         // v2.4.4：模式字段契约（setMode 值域 / 幂等 / 迁移轨迹 / 无互斥）
  "./cases/t67-service-worker",        // v2.4.4：sw.js 缓存策略（预缓存 / 清旧 / network-first / SWR / 不接管三类）
  "./cases/t68-whole-song-and-voices", // v2.5.0：整首连播入口 + 扫弦/节拍双声部（每拍出声 / 独立音量 / 脏值）
  "./cases/t69-pattern-length",        // v2.5.1：型的小节数自由化（校验域 / 网格行数 / 回绕 / 段长 / 循环下拉）
  "./cases/t70-arrange-window",        // v2.5.2：网格 = 歌曲小节上的滚动窗口（跨段取行 / 状态栏口径 / 回落）
  "./cases/t71-editor-bars",           // v2.6.1：编辑器增删小节（复制当前小节 / 下限 1 / 上限 64 / 撤销回退）
  "./cases/t72-loop-rewind-ball",       // v2.6.2：练习循环的渲染层回卷（球不倒退 / 待命球指向区间起点 / .next 同口径）
  "./cases/t73-arrange-mode-exit",      // v2.6.3：曲式模式的主界面收口（退出后跳段行不残留 / 播放中切轨不分裂）
  "./cases/t74-demo-version-migration", // v2.6.4：切轨假选中去除 + 示例曲版本迁移（120 小节混杂态收敛 / 删除不复活）
  "./cases/t75-page-flip-preview",      // v2.7.0：跳段基准分语境 + 翻页档预告行（替换 / 徽标 / 已弹豁免 / 待命球落点 / 边界）
  "./cases/t76-voices-and-lyric-audible", // v2.7.1：双声部打通（dir-only/鼓组）+ 歌词轨与计数器可听域对齐
  "./cases/t77-jump-loop-release",      // v2.7.3：跳段的「范围循环」解除开关（同源字段 / 单段放行到曲末）
  "./cases/t78-bar-chord-names",    // v2.7.4：小节上方的和弦名（段名解析 / 逐行渲染 / 预告行 / 无和弦段 / 预设模式）
  "./cases/t79-viz-rows",           // v2.8.0：同屏行数档位（扫弦窗口与歌词轨共用 / 脏值白名单 / 预设模式不受影响）
  "./cases/t80-countin-arrange-no-reenter", // v2.8.2：整首连播 + 预备拍不再重入门控（小球跳过首小节末拍）
];
for (const f of CASE_FILES) require(f);

const { pass, fail, failNames } = h.stats();
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
