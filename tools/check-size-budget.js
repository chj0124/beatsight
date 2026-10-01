/* 资源体积预算（v2.58.0，审计 T3 · 技术基建，零依赖）
   ---------------------------------------------------------------------------
   由来：审计 T3 指出主文件与历史样式可能「静默膨胀」——没有任何闸门盯着体积，一次
   无心的复制/粘贴就会把 index.html 推过临界点，而 1.2MB 的单文件 PWA 在慢网/低端机
   上首屏代价明显。本工具做**静态体积账单 + 硬预算**：

     · 主文件 index.html 字节数必须 ≤ BUDGET_BYTES，超了即失败（exit 1）——这是真预算，
       不是观察期。预算给的是「当前体积 + 约 5% 余量」，既能当下绿、又能拦住回归。
     · 顺带打印 sw.js / manifest.webmanifest（若存在）的体积做趋势参考（不判红）。

   口径：数的是**字节数**（fs.statSync().size），与 check-coverage / check-node-budget
   的「节点数 / 行数」互补——三者各看一个维度，都不互相校验。

   为什么不是「只警告」：项目对假红零容忍（见 check-node-budget.js 头注释）。体积是可
   精确计算的硬指标，没有「误报」空间，所以直接判红；预算阈值里的余量已经吸收了正常的
   小幅增长，真正触发失败的是「明显膨胀」。

   用法：node tools/check-size-budget.js [html路径]   （缺省 index.html）
   退出码 0 = 主文件在预算内；1 = 超预算（真缺陷）；4 = 工具故障（文件读不到）。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = process.argv[2] || path.join(ROOT, "index.html");

/* 预算：原 1300KB（v2.82.0 实测 ≈1.27MB）。v2.83.0 新增「歌词跟随条（方案乙）」——
   纯增量：CSS（.lyric-follow / .lyric-follow-on）+ 状态变量 + cacheGeo 采行盒高 +
   4 个支撑函数（ensureLyricFollow / hideFollow / showFollow / paintFollow）+ paintLyric
   尾部接线 + internals 暴露，净增 ~87 行 / ~4KB 必要功能代码（注释已计入，非冗余）。
   v2.84.0 加「设置开关 + 双关放大模式」：syncFollowChrome 函数 + paintFollow 双关分支 +
   S.lyricFollow 状态/typedef/载荷 + 设置 pill + 两处理器接线，净增 ~2KB 必要功能代码。
   v2.85.0 三处改动：① 设置弹窗六组重分组（画面图层/环境/发声/数据与说明/危险区/诊断与自验）
   + 分组示意 SVG 图 + figcaption；② ③a/③b 两按钮（恢复示例曲/恢复出厂设置）+ 接线 + 二次确认文案；
   ③ 预备拍歌词跟随条预览（paintFollow 预览判定 + paintFrameBody 驱动 paintLyric 调用 + 注释），
   净增 ~5.3KB 必要功能代码（标记重组 + 新控件 + 新分支，均为用户拍板的功能本体）。
   上调到 1320KB，留约 6.9KB 余量拦回归；非无脑抬常数——体积增量经 git diff 确认为功能本体。
   v3.0.0 批 0（PLAN-v9 布局重构）：单栏改造（.main 1fr、aside 整节点删除）+ 预设库块
   #presetLibBtn / 抽屉 #presetDrawer（原侧栏卡内容按 id 整组搬入）+ 可视化带 #vizBand
   （#viz/#lyricLane/#argJump 迁出卡片）+ 行带淡底色 + 栅格断点 1440→1280 与第 4 轨 168px
   + 抽屉开合接线（含「选中即收起」委托）。git diff 实测 196 增 / 99 删 —— 侧栏删除回收约
   4KB 后仍**净增 8.4KB**（注释已计入、非冗余：这批注释记的是「为什么这么摆」，删了下次
   还会踩同一个坑）。上调到 1332KB，留约 5.6KB 余量拦回归；批 1–3（连续滚动模式）各自
   按同一口径自带 git diff 证据再调，不预先透支。
   v3.0.0 批 1（连续滚动骨架）：数据层两字段（S.scrollMode / S.scrollRows + typedef + 热键
   载荷）、设置弹窗一枚开关 + 一行两档分段 + 同构接线、Viz 的 scrollRows/scrollCenter/
   slotShift/reloadScroll、buildViz 的 scroll 窗口分支、paintFrameBody 的 scroll 同步 +
   播放头钉中央 + 行槽横移、paintBall 的 slotShift 叠加与待命球门、isPreviewRow /
   effectiveLyricPos 两处守卫、t24 开关计数 15→16。git diff 实测 422 增 / 108 删（批 0+批 1
   合计），净增约 19KB —— 其中约六成是注释，但记的都是「为什么这么定」（槽相位为什么
   clamp、为什么一行恒等于整小节、为什么同屏行数在 scroll 下要置灰），删了下次还会踩。
   上调到 1348KB，留约 5KB 余量拦回归；批 2/3 按同一口径自带 git diff 证据再调。
   v3.0.0 批 2（强拍登场 + 歌词叠加）：两个窗口合成器加可选行数参（建 rows+1 行，末行是进场行）、
   cacheGeo 采集槽距 slotH（不写死 106）、#viz 与歌词覆盖层的同源高度裁剪、scrollBvis/smooth01、
   dy 同帧复位、REDUCE_MOTION 降级、歌词行 y 锚点复用与同组 (dx,dy) 叠加。批 0+1+2 累计
   git diff 497 增 / 116 删。   上调到 1356KB（把 1348 那次的余量一并重算），留约 7KB 拦回归。
   v3.0.0 批 4（用户实报五问）：窗口起点改为**可为负**（当前行恒居中，修「第一小节播完先上滚
   又弹回」）+ `anchored()` 接管"未锚"判据 + 静止态 `applyScrollRest`（修「打开后首屏还是旧样子」）
   + 两档行数控件合并成「同屏行数」（不再多一个"窗口行数"）+ 撤掉 `--band` 深色底 + 抽屉开合
   触发 relayout。净增约 2KB（有增有删：删掉 --band 两处定义与一个控件，新增 anchored/静态态/注释）。
   上调到 1364KB，留约 6KB 拦回归。
   v3.0.0 批 6：① 修「播放时歌词不跟行走」——歌词窗口起点抽 `lyricWinBase()` 单一来源
   （批 4 两处手写公式分叉 → 每帧整轨重建 → translateY 同帧覆盖横移）；② rows=1 改**传送带**
   （3 槽、相位去 clamp 首尾相接、三行 dy 叠置、歌词只跟当前槽）。净增约 1.5KB（多为注释）。
   上调到 1372KB，留约 6KB 拦回归。
   v3.0.1（滚动「第一圈语义」）：loopWrapped 会话标记（共享区声明 + 调度曲式/预设两条置位
   + 四处清零）+ scrollWrapRange() 判据收口（loopWrapActive 退役）+ 网格/歌词/和弦三处
   第一圈判据 + 歌词取字改 foldSeg + 重建影子 scrollWrappedSeen + T156 注释。git diff 实测
   161 增 / 52 删（含 CHANGELOG 56 行），index.html 净增约 6.7KB —— 增量大头是注释
   （为什么通用回跳判定只在预设模式置位、为什么末尾之后照折不空），删了下次还会踩。
   上调到 1380KB，留约 7.8KB 拦回归。 */
const BUDGET_BYTES = 1380 * 1024;

function sizeOf(rel){
  const p = path.join(ROOT, rel);
  try { return fs.statSync(p).size; } catch (e){ return -1; }
}
function kb(n){ return (n / 1024).toFixed(1) + " KB"; }

if (!fs.existsSync(HTML)){ console.error("未找到主文件：" + HTML); process.exit(4); }
const main = fs.statSync(HTML).size;

console.log("══════════════════════════════════════════════");
console.log("  资源体积预算（index.html 单文件 PWA）");
console.log("══════════════════════════════════════════════");
console.log("  · 主文件 " + path.basename(HTML) + "：" + kb(main) + " / 预算 " + kb(BUDGET_BYTES));
const sw = sizeOf("sw.js");
if (sw >= 0) console.log("  · sw.js：" + kb(sw) + "（参考，不判红）");
const mf = sizeOf("manifest.webmanifest");
if (mf >= 0) console.log("  · manifest.webmanifest：" + kb(mf) + "（参考，不判红）");

if (main > BUDGET_BYTES){
  console.log("  ✗ 主文件超预算 " + kb(main - BUDGET_BYTES) + "（" + main + " > " + BUDGET_BYTES + "）");
  console.log("  处置：先 git diff 看这多出来的体积从哪来；确认是必要的再上调 BUDGET_BYTES 并写明理由。");
  process.exit(1);
}
console.log("  ✓ 主文件在预算内（余量 " + kb(BUDGET_BYTES - main) + "）");
process.exit(0);
