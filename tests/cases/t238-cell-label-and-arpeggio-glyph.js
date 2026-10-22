/* BeatSight 自动化测试 · 本版两处主视图口径：时值标注瘦身 + 琶音记号（用户实报）
   ============================================================================
   ① 时值标注删「休止 」前缀 + 字号缩小（12→10px，窄屏 10→9px）——
      休止与否由格子形状表达（主视图虚线空框 / 编辑器 .rest 虚线边），
      标签只报时值本身；「休止 八分」读起来像另一种时值，是错的。
   ② 琶音记号（dir:"A"）——示例曲《我们能不能不分手》引子小节的实际弹法：
      顶层 arpGlyph/strumDirCls 共享件，主视图 / 编辑器 / 编排页三处渲染点画同一个记号。
   字面量/数据侧由 t209 钉住；本用例钉**渲染与文本**两层。
   ============================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const isBarRow = el => /(^| )bar-row( |$)/.test(el.className);
const ARP = 21;   // 琶音型（节奏型1（《我们能不能不分手）》）——★ 本版新位 21（P6 插位 16 ⇒ 《我们》基址 17..21，t209/t237 钉过）

section("T238a stepLabel · 删「休止 」前缀：休止格与发声格同报时值本体");
{
  const { beat } = loadApp();
  eq(beat.Viz.stepLabel({ t: 48, rest: true }), "四分", "★★★ 纯休止四分 = 「四分」（不再带「休止 」前缀）");
  eq(beat.Viz.stepLabel({ t: 48, rest: false }), "四分", "★ 发声四分同报「四分」——休止与否不进文字，由格子形状表达");
  eq(beat.Viz.stepLabel({ t: 24, rest: true }), "八分", "★★ 纯休止八分 = 「八分」（用户实报的「休止 八分」正是这格）");
  eq(beat.Viz.stepLabel({ t: 192, rest: true }), "全", "附：非四分档同口径（192 = 全）");
  ok(!/return \(s\.rest \? "休止 " : ""\)/.test(html), "★ 源码里已无前缀拼接（不是渲染层再剥一遍）");
}

section("T238b 琶音型实弹 · 每格标签都是「四分」，无一个带「休止」");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type: "builtin", idx: ARP };
  beat.Presets.applyPatternChange();
  const rows = els["viz"].children.filter(isBarRow);
  ok(rows.length > 0, "前提：琶音型建出了行");
  const labels = [];
  rows[0].children.forEach(el => { if (/(^| )cell-label( |$)/.test(el.className)) labels.push(el.textContent); });
  ok(labels.length >= 4, "前提：第 1 行 4 格都有时值标注（四分格宽，不会被窄格隐藏）");
  labels.slice(0, 4).forEach((t, i) => eq(t, "四分", "★ 第 " + (i + 1) + " 格标签 = 「四分」（琶音 1 拍 + 休止 3 拍，都是四分）"));
  ok(labels.every(t => t.indexOf("休止") < 0), "★★★ 整行标签无一含「休止」（后三拍纯休止格也只报「四分」）");
}

section("T238c 字号 · PLAN-v11 追补：桌面 9px 封顶 10px、窄屏下限 10px（CSS 源钉）");
{
  ok(/\.cell-label\{position:absolute;top:48px;font-size:min\(calc\(9px \* var\(--cs, 1\)\), 10px\)/.test(html),
     "★★★ 桌面档 .cell-label = min(9px×--cs, 10px)——基准缩到 9px 且 10px 封顶，宽屏放大后恒小于和弦名 12px（top 48 = 基础档格子带下 4px）");
  ok(/#viz\.has-pick \.cell-label\{top:60px\}/.test(html),
     "★ has-pick 档 .cell-label 随 56px 格子带移到 60px（v3.48.0 覆盖块）");
  ok(!/\.cell-label\{position:absolute;top:48px;font-size:calc\(10px/.test(html),
     "★ 旧 10px 无封顶版已退役");
  ok(/\.bar-chord\{[^}]*font-size:12px/.test(html),
     "★ 和弦名胶囊 11→12px（同批追补：行级锚点更醒目，与缩小的时值标注拉开层级）");
  ok(/\.cell-label\{top:38px;font-size:10px\}/.test(html)
     && /\.ruler-lab\{top:52px;font-size:10px\}/.test(html),
     "★★ 窄屏档 .cell-label/.ruler-lab 下限 = 10px（放不下的格由 fitCellAnnotations 隐藏，不再缩成 8/9px 装饰纹理）");
}

section("T238d 琶音记号 · .strumv.arp + 内挂 SVG（主视图渲染层）");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type: "builtin", idx: ARP };
  beat.Presets.applyPatternChange();
  const layer = els["viz"].children.filter(isBarRow)[0]
    .children.find(ch => /(^| )strums( |$)/.test(ch.className));
  ok(!!layer, "前提：第 1 行有 .strums 层");
  const sm = layer.children.find(c => c.dataset && c.dataset.i === "0");
  ok(!!sm, "前提：第 1 格有扫弦记号节点");
  ok(/(^| )arp( |$)/.test(" " + sm.className + " "), "★★★ dir:A ⇒ .strumv 带 arp 类（三分支 dn/up/arp 的第三支）");
  ok(!/(^| )(dn|up)( |$)/.test(" " + sm.className + " "), "★ 不带 dn/up（::after 那套直杆三角无 .dn/.up 着色，本来就不出墨）");
  /* ★★ 回归钉（本批实缺陷，用户实报"琶音画错了"）：.strumv::before 是**基础规则**，
     对所有 .strumv 生效（不带 .dn/.up 限定）——首版没关它，屏幕上是「2px 直杆 + 波浪线」
     两根线并排。桩不渲染伪元素，行为断言测不出，只能钉 CSS 源。 */
  ok(/\.strumv\.arp::before\{content:none\}/.test(html),
     "★★★ 直杆伪元素已对 .arp 显式关闭（content:none）——缺了它琶音格会多画一根直线");
  ok(!/(^| )ghost( |$)/.test(" " + sm.className + " "), "★ 琶音本身发声 ⇒ 无 ghost（空扫才蓝虚线）");
  eq(sm.children.length, 1, "记号节点内恰好挂 1 个 SVG 子节点");
  const svg = sm.children[0];
  eq(svg.tagName, "SVG", "★ 子节点是 createElementNS 建的 SVG（零拼串、不走 innerHTML）");
  eq(svg.children.length, 2, "SVG 内 2 条 path（波浪线 + 顶端箭头）");
  eq(svg.children[0].getAttribute("class"), "arp-wave", "★★★ path#1 = arp-wave（竖波浪线）");
  eq(svg.children[1].getAttribute("class"), "arp-head", "★ path#2 = arp-head（顶端箭头，与下扫同向）");
}

section("T238e 琶音记号 · 三处渲染点共用同一份标记（顶层共享件）+ 编辑器 aria");
{
  /* 源码钉：arpGlyph 恰好 3 个调用点（主视图 / 编辑器 / 编排页）——各写一遍必然漂移（v2.4.3 教训） */
  const calls = (html.match(/arpGlyph\(/g) || []).length;
  eq(calls, 4, "★★ arpGlyph 恰好 4 处（1 定义 + 3 渲染点：主视图/编辑器/编排页）");
  ok(/function strumDirCls\(dir\)/.test(html), "★ dir→类名的三分支映射是顶层共享件（strumDirCls）");
  ok(html.includes('dir === "A" ? " arp"'), "★ 映射里 A → arp 分支在位");
  /* ★★ 本版（用户实报）：编辑器补「琶音」造谱能力。★ 批 3 迁移：原 dirRow 第四档
     data-dir="A" 迁入弹法行「琶音」档（data-tech="arp"，落库仍写 dir="A"）——
     手动编辑面的一等公民地位不变，入口换到弹法行 */
  ok(/<button class="pill" data-tech="arp" aria-pressed="false" disabled>琶音<\/button>/.test(html),
     "★★★ techRow 有「琶音」档（data-tech=\"arp\"——落库写 dir=\"A\"，走弹法分派接线）");
  /* 编辑器：选中琶音型打开 → 第 1 格 aria 报「 · 琶音」，且不带 ↓↑ 直杆字形 */
  const app = loadApp();
  app.beat.Store.S.sel = { type: "builtin", idx: ARP };
  app.beat.Presets.applyPatternChange();
  app.beat.Editor.open();
  const track = app.els["editorBars"].children[0].children[1];
  const first = track.children[0];
  ok(String(first.getAttribute("aria-label") || "").includes(" · 琶音"),
     "★★ 编辑器第 1 格 aria 报「 · 琶音」（D=下扫 / U=上扫 / A=琶音 三分支）");
  ok(!Array.from(track.children).some(c => (c.textContent || "").includes("↓") || (c.textContent || "").includes("↑")),
     "★ 琶音格不写 ↓↑ 字形（波浪线本身就是记法，「↓」反而会说错手部动作）");
}
