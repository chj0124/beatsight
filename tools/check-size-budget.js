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
   上调到 1308KB，留约 2KB 余量拦回归；非无脑抬常数——体积增量经 git diff 确认为功能本体。 */
const BUDGET_BYTES = 1308 * 1024;

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
