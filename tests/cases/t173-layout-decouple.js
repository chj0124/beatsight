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
     && /<div class="pb-sub">[\s\S]*?id="countInToggle"[\s\S]*?id="statusDot"/.test(PLAYBAR),
    "★★ .pb-sub（行 2）= 预备拍组（左）+ 状态灯（右），且整体在进度条之下");
  /* 结构红线（t170 立）：#pbProgress 挂载前会被 buildDemoSongRow 清空——
     状态灯不得是它的子节点。两行化后隔了一层 .pb-sub，仍是兄弟。 */
  const pbOpen = PLAYBAR.indexOf('id="pbProgress"');
  const pbClose = PLAYBAR.indexOf("</div>", pbOpen);
  ok(PLAYBAR.indexOf('id="statusDot"') > pbClose + 6,
    "★★★ 状态灯仍不是 #pbProgress 的子节点（buildDemoSongRow 清空容器时不得连坐销毁）");
  ok(/\.pb-right\{justify-self:end;display:flex;flex-direction:column;/.test(CSS_CODE),
    "★★ .pb-right 纵排两行（行 1 宽度只随容器——解耦的结构前提）");
  ok(/\.pb-sub\{display:flex;justify-content:space-between;/.test(CSS_CODE),
    "★★ .pb-sub 两端对齐（两个可变宽度源只挤压行 2 中缝）");
}

section("T173b 控制区限宽 1000（丁）+ 参数槽通栏悬浮（桌面档）");
{
  ok(/max-width:1000px/.test(CSS_CODE)
     && /grid-template-columns:minmax\(280px,1fr\) minmax\(min-content,1fr\)/.test(CSS_CODE),
    "★★ 控制区限宽 1000 居中 + 两列 1fr（丁方案；旧三轨 max-content 口径退役）");
  ok(/\.viz-head-grid \.card-head-left\{width:100%\}/.test(CSS_CODE),
    "★★ 音量列在桌面档吃满 1fr 轨道（v2.10.18 的 min(312px,100%) 钉宽退役）");
  /* 悬浮槽三件套：absolute（脱离布局流 → 零横移/零高度变化）、锚在开关行下方、
     常驻预留 56px（最满面板实测 43px + 30% 余量）。行首锚定——被注释的残行不算。 */
  ok(/\n  \.viz-toggles \.tg-slot\{position:absolute;top:calc\(100% \+ 8px\);/.test(html),
    "★★ 悬浮槽 absolute + 锚开关行底（top:calc(100%+8px)）——开合零横移的结构前提");
  ok(/\.viz-head-grid \.viz-toggles \.tg-body\{display:block;position:relative;padding:16px 0 56px\}/.test(CSS_CODE),
    "★★ 常驻预留 56px（76px 是 v3.3.1 三列折行时代数值；面板自然高实测 24/40/43；"
    + "v3.13.1 顶部 +16px = 开关行下移，四态仍一字不变）");
  ok(/\.viz-toggles \.tg-slot \.tr-panel\{width:max-content;flex:none;flex-wrap:nowrap\}/.test(CSS_CODE),
    "★★ 面板锁自然宽单行（Chrome 对折行弹性容器的固有宽度算错：380→543.9 并折成两行"
    + "61px 超预留——实测抓到的第二个根因）");
  ok(TOGGLES.indexOf('id="tgSwitchRow"') < TOGGLES.indexOf('id="tgSlot"')
     && !/<\/div>\s*<!--[\s\S]*?-->?\s*<div class="tg-slot"/.test(TOGGLES.slice(0, TOGGLES.indexOf('id="tgSlot"'))),
    "★★ #tgSlot 在 #tgSwitchRow 行内（悬浮锚点 = 开关行盒底；窄屏档 display:contents 照常溶解）");
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

section("T173d 底栏预备拍显隐（两行化后接线一行未动的行为验证）");
{
  const { els } = loadApp({
    "beatsight.state": JSON.stringify({ countIn: { on: false, beats: 2 } }),
  }, { seedDemo: false });
  eq(els["countInBeatsWrap"].hidden, true, "前提：预备拍关 → 拍数输入隐藏（标记级 hidden）");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, false, "★ 打开预备拍 → 拍数输入出现（显形只影响行 2）");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, true, "★ 关闭预备拍 → 拍数输入隐藏");
}