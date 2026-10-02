/* T161 · 底部播放条（v3.3.0 第一批）
   ---------------------------------------------------------------------------
   场景组：把「跳段 + 播放 + 循环段」整组从 #vizBand 末尾搬进新增的 fixed 底栏 #playBar。

   为什么要有这组断言：
   1. 这是**搬块换定位**，红线是"id 与接线一行不动"——搬运过程中最容易发生的退化是
      顺手改了 id、漏搬某枚按钮、或把循环钮落在 vizBand 里（半搬状态肉眼难辨）；
   2. 底栏是 fixed，必须同时存在"内容区让位"（.main 的 padding-bottom）与
      "同层控件避让"（.diag 的 bottom），三者是同一组常数（88 / 76）——只改一处
      就会让最后一小节或诊断条被底栏压住，而这类问题在桩里测不出、只能靠文本级断言钉住；
   3. 断言全部是源码文本级（同 t90/t110 口径）：桩不解析 CSS 计算值，实测位置由
      tools/smoke.js 在真实浏览器里复核。

   ★ 本文件只测结构契约，不测观感；观感（间距、层级、手感）以真人验收为准。 */

const { section, ok, eq } = require("../lib/harness");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/** 取 [起标记, 止标记) 之间的片段；止标记不存在时**报错而不是静默到文件末尾** */
function slice(a, b, label) {
  const i = src.indexOf(a);
  const j = src.indexOf(b);
  ok(i >= 0, `起标记存在：${label}`);
  ok(j > i, `止标记在起标记之后：${label}`);
  return i >= 0 && j > i ? src.slice(i, j) : "";
}

section("T161a 底栏容器 · 位置与让位");

const bar = slice('<div class="play-bar" id="playBar"', "<!-- ================= 自定义节奏型编辑器", "底栏块");

ok(src.includes('<div class="play-bar" id="playBar" role="group" aria-label="播放控制">'),
  "★ #playBar 存在且带 role=group + aria-label（读屏能报出这是「播放控制」分组）");
ok(src.indexOf("</main>") < src.indexOf('<div class="play-bar" id="playBar"'),
  "★★ 底栏在主列（</main>）之后——fixed 元素不参与主列布局，放里面会污染栅格与 geoOf 基准");
ok(!src.slice(src.indexOf("<main"), src.indexOf("</main>")).includes('id="argJump"'),
  "★★ 跳段行已不在主列内（否则会出现「两份播放键」或半搬状态）");

ok(/\.play-bar\{position:fixed;[^}]*bottom:0;[^}]*z-index:40/.test(src),
  "★ 底栏 fixed 贴底、z-index 40（低于模态遮罩 200 与 TAP/诊断条 60，高于普通内容）");
/* ★ v3.3.1：高度改由 --bar-h 一处定义、三处消费（.main 让位 / .diag 避让 / .col 居中基准） ——
   "改一处不会再漏另外两处"正是本轮把它提成变量的原因。 */
ok(/\.play-bar\{[^}]*height:var\(--bar-h\)/.test(src) && /--bar-h:96px/.test(src),
  "★★ 底栏高度 = var(--bar-h) = 96px（**全档统一**：窄屏若压到 84，72px 的播放键正好铺满内容框、"
  + "距底只剩 12px，真机实测没过「不贴底」的门槛）");
ok(/\.play-bar\{[^}]*padding:0 [^;]*calc\(14px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(src),
  "★ 下内边距 14px：按钮居中的余量与它相加 = 距视口底 19px");
ok(/\.main\{[^}]*calc\(var\(--bar-h\) \+ 24px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(src),
  "★★ 主列补 padding-bottom（var(--bar-h) + 24）：fixed 底栏不占流，不补则最后一小节被压住");
ok(/@media \(max-width:640px\)\{[\s\S]{0,900}body \.main\{padding-bottom:calc\(var\(--bar-h\) \+ 24px/.test(src),
  "★ ≤640 的让位跟着同一个变量走（不会再出现「改了高度忘了让位」）");
/* ★★ 这条是实战换来的：窄屏档里另有一条 `.main{grid-template-columns:1fr;padding:16px}`（简写）
   排在本文之后，同特异性下会把 padding-bottom 重置回 16px——让位静默失效。
   第一版就是 `.main{padding-bottom:...}`，被**真机冒烟**抓到（桩里没有布局引擎，测不出）。
   故这里同时钉住：① 抬到 `body .main`；② 不得退回裸 `.main` 写法。 */
ok(/@media \(max-width:640px\)\{[\s\S]{0,900}(^|\n)  \.main\{padding-bottom:calc\(var\(--bar-h\)/.test(src) === false,
  "★★ 让位不得用裸 `.main`（窄屏后续的 `padding:16px` 简写会把它重置——真机冒烟抓到的实际缺陷）");
ok(/\.diag\{[^}]*bottom:calc\(var\(--bar-h\) \+ 12px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(src),
  "★★ 底部诊断条避让也走 var(--bar-h)（fixed 同层、不参与让位，必须显式上移）");

section("T161b 搬块红线 · id 与顺序一行不动");

["argJump", "argJumpPrev", "playBtn", "argJumpNext", "argJumpLoopBtn"].forEach(id => {
  eq((src.match(new RegExp('id="' + id + '"', "g")) || []).length, 1, `id="${id}" 全局恰好一处（搬块不换 id）`);
});
ok(bar.includes('id="argJumpPrev"') && bar.includes('id="playBtn"') && bar.includes('id="argJumpNext"'),
  "★ 三枚控制键都在底栏内（搬运完整性）");
ok(bar.indexOf('id="argJumpPrev"') < bar.indexOf('id="playBtn"') && bar.indexOf('id="playBtn"') < bar.indexOf('id="argJumpNext"'),
  "★★ 源码序仍是「上一段 → 播放 → 下一段」（播放键居中，v2.10.14 的既定次序）");
ok(bar.includes('id="argJumpLoopBtn"') && bar.includes("ico-off") && bar.includes("ico-on"),
  "★ 循环段钮的双态图标随搬（CSS 按 aria-checked 切显隐，规则未动）");
ok(bar.includes('id="playIcon"'), "★ 播放图标 #playIcon 随搬（togglePlayIcon 的写点不变）");

section("T161c 去组容器底 · 四块统一无底");

ok(!src.includes(".viz-head-grid .viz-rows-row{background:transparent}"),
  "★ v3.0.0 只给行数拍号行去底的补丁已删（四块统一后它成了死规则）");
ok(src.includes("background:transparent;border-radius:10px;padding:12px 16px}"),
  "★★ 四块的共用选择器仍在，背景改为 transparent（圆角/内边距口径不变 → 块内间距不受影响）");
ok(!src.includes("background:var(--card2);border-radius:10px;padding:12px 16px"),
  "★★ 组容器底（--card2）已从控制行彻底移除（防回潮）");
