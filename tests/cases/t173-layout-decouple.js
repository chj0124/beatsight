/* T173 v3.13.0 布局解耦批（底栏两行化 + 控制区限宽 + 参数槽通栏悬浮）
   ---------------------------------------------------------------------------
   背景（用户两项反馈，真机实测 1440）：
   ① 底栏右区旧单行 flex 里进度条 flex:1 吃剩余空间——预备拍开合（拍数输入显形 −64px）
     与每十六分更新的状态文案（长文案 −134px）都拽着进度条横跳。修法：右区两行化——
     行 1 进度条独占（宽度只随容器），行 2 .pb-sub = 预备拍（左）+ 状态灯（右）。
   ② 控制卡片：旧同轴网格列宽 = max(开关, 面板)（auto 轨），面板显形撑大所在列
     （静音 222 / 变速 380 vs 开关 99/112），叠加 fit-content + 居中 → 开任一开关另一枚
     横移（+114 / −148px）。修法：桌面档参数槽改 absolute 通栏悬浮（脱离布局流 →
     零横移、零高度变化）+ 常驻预留 76 → 56px（面板自然高实测 24/40/43）。
     侧空白（行 1 内容 624px 居中出 336/368px）→ 丁方案：限宽 1000 居中 + 两列 1fr。
   本文件钉**结构契约与行为契约**（桩可验）；真几何（逐像素零横移/等宽/对称）归 smoke
   的 layoutProbe（桩无布局引擎）。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");   // 剥块注释（防注释里的字面量骗过断言）
/* 控制芯重排（PLAN-v9 批 2）：.viz-toggles 开关列退役——切片改取芯顶胶囊行起的芯段 */
const TOGGLES_AT = html.indexOf('<div class="core-pills">');
const TOGGLES = html.slice(TOGGLES_AT, html.indexOf("<!-- v3.0.0：预设库从 360px"));
const PLAYBAR = html.slice(html.indexOf('<div class="play-bar" id="playBar"'),
                           html.indexOf("<!-- ================= 自定义节奏型编辑器"));

section("T173a 底栏右区两行化（结构红线 + 解耦落点）");
{
  /* ★ v3.30.0：.pb-sub 补 id（读数行的挂点——桩按 id 懒创建、无 querySelector），
     故源码钉按带 id 的写法匹配；两者之间允许夹注释（本轮在此补了 id 的说明注释）。 */
  ok(/<div class="pb-progress" id="pbProgress"[^>]*><\/div>(\s*<!--[\s\S]*?-->)*\s*<div class="pb-sub" id="pbSub">/.test(PLAYBAR),
    "★★ 行 1 = #pbProgress 独占、行 2 = .pb-sub#pbSub（两行 DOM 的源码序；v3.30.0 补 id）");
  ok(PLAYBAR.indexOf('id="pbProgress"') < PLAYBAR.indexOf('id="pbSub"')
     && /<div class="pb-sub" id="pbSub">[\s\S]*?id="statusDot"/.test(PLAYBAR)
     && !/id="countInToggle"/.test(PLAYBAR),
    "★★ v3.30.0：.pb-sub（行 2）= [读数行（运行时挂入） …… 状态灯]；"
    + "整体仍在进度条之下（预备拍仍住卡片开关行、拍数输入已无悬浮槽）");
  /* 结构红线（t170 立）：#pbProgress 挂载前会被 buildDemoSongRow 清空——
     状态灯不得是它的子节点。两行化后隔了一层 .pb-sub，仍是兄弟。 */
  const pbOpen = PLAYBAR.indexOf('id="pbProgress"');
  const pbClose = PLAYBAR.indexOf("</div>", pbOpen);
  ok(PLAYBAR.indexOf('id="statusDot"') > pbClose + 6,
    "★★★ 状态灯仍不是 #pbProgress 的子节点（buildDemoSongRow 清空容器时不得连坐销毁）");
  ok(/\.pb-right\{justify-self:end;display:flex;flex-direction:column;/.test(CSS_CODE),
    "★★ .pb-right 纵排两行（行 1 宽度只随容器——解耦的结构前提）");
  /* ★ v3.30.0（用户拍板 D 案）：.pb-sub 由「右对齐单状态」改「两端对齐」——
     左端接范围读数、右端仍是状态灯；读数长短不再推挤进度条（读数已移出行 1）。 */
  ok(/\.pb-sub\{display:flex;justify-content:space-between;/.test(CSS_CODE),
    "★★ v3.30.0：.pb-sub = space-between（读数左 / 状态灯右，两端钉死不互推）");
}

section("T173b 控制区限宽 1000（丁）+ 参数槽通栏悬浮（桌面档）");
{
  ok(/max-width:1000px/.test(CSS_CODE),
    "★ 控制区限宽 1000 居中（丁方案的限宽口径保留）");
  /* ★ 控制芯重排（PLAN-v9 批 2）：两块并排的 flex 装箱退役 → ≥1280 单列居中芯。
     同排契约的源码钉换成：芯容器 402 居中 + 560–1279.9 堆叠档 flex 装箱（仅合并组一块）。 */
  ok(CSS_CODE.indexOf("html body .card .viz-head-grid{display:block;max-width:none;margin:0 auto}") >= 0
     && CSS_CODE.indexOf(".viz-head-grid .card-head-left .group{max-width:402px;margin:0 auto}") >= 0
     && CSS_CODE.indexOf("flex:1 1 var(--min-w-vol);min-width:var(--min-w-vol);max-width:var(--max-w)") >= 0
     && !CSS_CODE.includes("var(--min-w-sw)") && !CSS_CODE.includes("var(--min-w-bpm)"),
    "★★ 控制芯（PLAN-v9 批 2）：≥1280 单列、芯 402 居中；堆叠档 flex 装箱只剩合并组"
    + "（开关列的 --min-w-sw 下限随列退役）");
  /* ★ v3.22.0：音量组固定间距顶对齐（零变形机制源码钉）——行高随开关列生长时滑杆
     纹丝不动；回退 space-between/evenly 会重新引入内容重分布（变异 M18 实证）。 */
  /* ★ v3.30.0：音量列的零变形承重墙从 `.group` 的 space-between 换成**其内 tg-body
     的顶锚定距**（flex-start + gap:10）——开关列抬高后关闭态即贴近 BPM 列高，开面板会
     顶破行高、若仍用 space-between/evenly 就会重分布（v3.22/3.23 的「单开零变形」契约
     靠顶锚保住）。.group 的 space-between 对单一弹性子项是空操作（保留但不再是机制）。 */
  ok(/\.viz-head-grid \.card-head-left \.group \.tg-body\{flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:10px\}/.test(CSS_CODE),
    "★★ v3.30.0：音量列 tg-body = 顶锚定距（flex-start + gap:10px）——行心对齐 L1/L2/L3，"
    + "且开关列开合时音量行纹丝不动（单开零变形的承重墙）");
  /* 悬浮槽三件套：absolute（脱离布局流 → 零横移/零高度变化）、锚在开关行下方、
     常驻预留 56px（最满面板实测 43px + 30% 余量）。行首锚定——被注释的残行不算。 */
  /* ★ v3.19.0：悬浮槽（absolute 锚定 + 50px 预留 + max-content 锁宽）整体退役——
     用户拍板"面板打开允许列内下移"，改三列均分 + 开关列流内（钉在 t168/t163）。 */
  ok(!/tg-slot\{position:absolute/.test(CSS_CODE) && !/padding:16px 0 50px/.test(CSS_CODE)
     && !/\.tg-slot \.tr-panel\{width:max-content/.test(CSS_CODE) && !/id="tgSlot"/.test(html),
    "★★ v3.19.0：悬浮槽时代三件套（absolute 锚定 / 50px 预留 / max-content 锁宽）"
    + "与 #tgSlot 壳全部退役");
}

section("T173c 参数面板显隐行为（搬块不换 id：syncParamSlots 收口不因搬块受影响）");
{
  const { beat, els } = loadApp({
    "beatsight.state": JSON.stringify({ countIn: { on: false, beats: 2 } }),
  }, { seedDemo: false });
  eq(els["muteCfgPanel"].hidden, true, "前提：静音拍关 → 面板隐藏");
  els["muteToggle"].fire("click");
  eq(els["muteCfgPanel"].hidden, false, "★ 开静音拍 → 面板显形（id 与接线一行未动）");
  els["trTarget"].value = "240";
  els["trTarget"].fire("change");
  els["trainerToggle"].fire("click");
  eq(els["trainerPanel"].hidden, false, "★ 开变速训练（目标已填）→ 面板显形");
  /* ★★★ v3.42.0 第七轮（用户拍板）：**窄档只允许开一块**——桩的视口宽默认 600（<1280）⇒ 后开的变速会把
     静音那块收掉；宽档"并排"改由冒烟的真实几何复核（1440 实测两块 [541..791]/[801..1051]，相隔 10px、零重叠）。 */
  ok(els["trainerPanel"].hidden === false && els["muteCfgPanel"].hidden === true,
    "★★ v3.42.0 窄档口径：窄档只留**最后打开**的那块参数面板（静音被变速收掉）；宽档并排由冒烟几何钉着");
  els["trainerToggle"].fire("click");
  els["muteToggle"].fire("click");
  eq(els["muteCfgPanel"].hidden, true, "★ 全关 → 静音面板隐藏（复原无残留）");
  eq(els["trainerPanel"].hidden, true, "★ 全关 → 变速面板隐藏");
  void beat;
}

section("T173d 拍数输入**就地长出**（v3.41.0 用户拍板：关闭时只显示「预备」，打开才长出 [4 拍]）");
{
  const { beat, els, html } = loadApp({
    "beatsight.state": JSON.stringify({ countIn: { on: false, beats: 2 } }),
  }, { seedDemo: false });
  /* ★★★ v3.41.0：**行为面**断言——就地长出 = 关着不显示、打开才出现（源码头在 t175b 钉） */
  eq(els["countInBeatsWrap"].hidden, true, "★★ 预备关着 → 拍数输入 hidden（只显示「预备」两个字）");
  els["countInToggle"].fire("click");
  eq(beat.Store.S.countIn.on, true, "★ 打开预备拍 → 状态开");
  eq(els["countInBeatsWrap"].hidden, false, "★★ 打开 → 拍数在同一个胶囊壳里**就地长出**");
  els["countInToggle"].fire("click");
  eq(beat.Store.S.countIn.on, false, "★ 关闭预备拍 → 状态关");
  eq(els["countInBeatsWrap"].hidden, true, "★★ 再关 → 拍数收回（值仍留着，下次打开即见）");
  void html;
}