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
const TOGGLES_AT = html.indexOf('<div class="viz-toggles">');
const TOGGLES = html.slice(TOGGLES_AT, html.indexOf("<!-- v3.0.0：预设库从 360px"));
const PLAYBAR = html.slice(html.indexOf('<div class="play-bar" id="playBar"'),
                           html.indexOf("<!-- ================= 自定义节奏型编辑器"));

section("T173a 底栏右区两行化（结构红线 + 解耦落点）");
{
  ok(/<div class="pb-progress" id="pbProgress"[^>]*><\/div>\s*<div class="pb-sub">/.test(PLAYBAR),
    "★★ 行 1 = #pbProgress 独占、行 2 = .pb-sub（两行 DOM 的源码序）");
  ok(PLAYBAR.indexOf('id="pbProgress"') < PLAYBAR.indexOf('<div class="pb-sub">')
     && /<div class="pb-sub">[\s\S]*?id="statusDot"/.test(PLAYBAR)
     && !/id="countInToggle"/.test(PLAYBAR),
    "★★ v3.15.0：.pb-sub（行 2）只剩状态灯（预备拍搬回卡片开关行、拍数输入走悬浮槽）；"
    + "整体仍在进度条之下");
  /* 结构红线（t170 立）：#pbProgress 挂载前会被 buildDemoSongRow 清空——
     状态灯不得是它的子节点。两行化后隔了一层 .pb-sub，仍是兄弟。 */
  const pbOpen = PLAYBAR.indexOf('id="pbProgress"');
  const pbClose = PLAYBAR.indexOf("</div>", pbOpen);
  ok(PLAYBAR.indexOf('id="statusDot"') > pbClose + 6,
    "★★★ 状态灯仍不是 #pbProgress 的子节点（buildDemoSongRow 清空容器时不得连坐销毁）");
  ok(/\.pb-right\{justify-self:end;display:flex;flex-direction:column;/.test(CSS_CODE),
    "★★ .pb-right 纵排两行（行 1 宽度只随容器——解耦的结构前提）");
  ok(/\.pb-sub\{display:flex;justify-content:flex-end;/.test(CSS_CODE),
    "★★ v3.15.0：.pb-sub 右对齐单状态（预备拍已离开底栏——可变宽度源只剩状态文案）");
}

section("T173b 控制区限宽 1000（丁）+ 参数槽通栏悬浮（桌面档）");
{
  ok(/max-width:1000px/.test(CSS_CODE),
    "★ 控制区限宽 1000 居中（丁方案的限宽口径保留）");
  ok(/@media \(min-width:900px\)\{[\s\S]*?\.viz-head-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(CSS_CODE),
    "★★ v3.19.0：三列均分取代两列（音量 | BPM | 开关列，用户需求同排均分宽度）");
  /* ★ v3.22.0：音量组固定间距顶对齐（零变形机制源码钉）——行高随开关列生长时滑杆
     纹丝不动；回退 space-between/evenly 会重新引入内容重分布（变异 M18 实证）。 */
  ok(/\.viz-head-grid \.card-head-left \.group\{flex:1;justify-content:flex-start;gap:29px\}/.test(CSS_CODE),
    "★★ v3.22.0：音量组 = 顶对齐固定间距 29px（零变形机制；基态列高 ≈ BPM 列）");
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
  ok(els["muteCfgPanel"].hidden === false && els["trainerPanel"].hidden === false,
    "★★ 两面板**同开并排**（通栏悬浮的落位前提——旧逐列模型下两者分属两列）");
  els["trainerToggle"].fire("click");
  els["muteToggle"].fire("click");
  eq(els["muteCfgPanel"].hidden, true, "★ 全关 → 静音面板隐藏（复原无残留）");
  eq(els["trainerPanel"].hidden, true, "★ 全关 → 变速面板隐藏");
  void beat;
}

section("T173d 拍数输入常显（v3.22.0：显隐翻转退役，值同步保留）");
{
  const { beat, els, html } = loadApp({
    "beatsight.state": JSON.stringify({ countIn: { on: false, beats: 2 } }),
  }, { seedDemo: false });
  ok(!/countInBeatsWrap"\)\.hidden/.test(html),
    "★★ v3.22.0：处理器不再翻转拍数输入显隐（常显契约，用户需求）");
  els["countInToggle"].fire("click");
  eq(beat.Store.S.countIn.on, true, "★ 打开预备拍 → 状态开（拍数输入本来就显示着）");
  els["countInToggle"].fire("click");
  eq(beat.Store.S.countIn.on, false, "★ 关闭预备拍 → 状态关（拍数输入仍显示上次值）");
}