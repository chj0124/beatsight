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
const fs = require("fs");
const path = require("path");
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
  "./cases/t37-training-and-keepalive",
  "./cases/t47-stroke-direction",
  "./cases/t49-ear-training",
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
  "./cases/t62-strum-zone",            // v2.2.0：扫弦弦区（zone 三态音色 / 空扫静默 / 录入 UI）
  "./cases/t63-demo-song",             // v2.3.0：示例曲《在他乡》载入（谱面映射 / 幂等 / 播放冒烟）
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
  "./cases/t81-wiring-slots",       // v2.8.6：注入槽装配（钩子被接上 / patLenOf 未注入必须抛错，审计 A1）
  "./cases/t82-keepalive-fallback",     // v2.8.8：后台保活兜底失败可见化（成功恒 0 / 被拒与无能力均留痕 / 面板只在非 0 时占位）
  "./cases/t83-full-data-pack",         // v2.8.8：全量数据包导出导入（四类冷数据 / 合并语义 / 三种校验口径 / 体量护栏）
  "./cases/t84-sidebar-zones",          // v2.9.0：侧栏三区分类（hasStrum 判据 / 按内容分区 / 分区下按对象删除）
  "./cases/t85-sidebar-fold",           // v2.10.0：侧栏分区折叠（默认全收起 / 记忆选择 / 只隐藏不删节点 / 重建重新套用）
  "./cases/t86-tab-toggle-boot-sync",   // v2.10.1：六线底纹开关的启动收敛（默认/重载两条路径下 pill 恒等于 S.showTab；同族 keepAwake）
  "./cases/t87-preset-row-window",      // v2.10.2：预设模式的 N 行窗口（型短于 N 重复铺满 / 型长于 N 翻页 / .arg-now[hidden] 补丁）
  "./cases/t88-demo-range-slider",      // v2.10.4：侧栏「播放范围」双滑块（取代段号胶囊 / 1-based 域 / 双向钳制 / input·change 两级）
  "./cases/t89-narrow-range-next-row",  // v2.10.8：范围小节数 < 同屏行数时，待命球与 .next 预告格的落点（循环回卷 → 行号不再等于 +1）
  "./cases/t90-control-layout",         // v2.10.11：控件搬家
  "./cases/t91-migration-matrix",       // v2.11.x：老数据搬家回归矩阵（旧热键 / 老数据包 / 段→小节 / 脏值 / 往返）
  "./cases/t92-wallpaper",              // v2.12.0：背景壁纸（格式魔数 / CSS 注入面 / 体积上限 / 遮罩两级）（拍号→同屏行数右侧；音色/音量→编辑节奏型左侧）+ 左边缘对齐的两条 CSS 契约
  "./cases/t93-first-open-defaults",    // v2.13.0：首次打开的默认状态（选中示例曲但**不自动播放** / 分区展开态 / 行数拍号 / 出厂默认壁纸）
];
/* v2.8.16（审计 P2-2）：CASE_FILES 是手工维护的执行顺序清单，而 tests/cases/ 目录才是真相源。
   新增一个用例文件却忘了登记进 CASE_FILES，它会**静默地不被执行**——PASS 数照旧好看却少了整组
   断言，是比失败更危险的假绿（历史上有过"文件在、没被 require"的先例）。
   故启动时把目录内容与清单**双向对账**，任一方向漂移即报错退出（退出码 1 = 真失败，非工具故障）。 */
{
  const listed = new Set(CASE_FILES.map(f => path.basename(f) + ".js"));
  const onDisk = new Set(fs.readdirSync(path.join(__dirname, "cases")).filter(f => f.endsWith(".js")));
  const unlisted = [...onDisk].filter(f => !listed.has(f));   // 目录有、清单没有 → 静默漏测
  const missing  = [...listed].filter(f => !onDisk.has(f));   // 清单有、目录没有 → require 必失败
  if (unlisted.length || missing.length){
    console.error("✗ 用例清单与 tests/cases/ 不一致（闸门 P2-2）：");
    if (unlisted.length) console.error("  未登记进 CASE_FILES（不会被执行）：" + unlisted.join("、"));
    if (missing.length)  console.error("  CASE_FILES 中存在但目录缺失：" + missing.join("、"));
    console.error("  请使两者一致后重跑（新增用例请追加到 CASE_FILES 末尾）。");
    process.exit(1);
  }
}
for (const f of CASE_FILES) require(f);

const { pass, fail, failNames } = h.stats();
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
