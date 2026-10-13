/* BeatSight 自动化测试 · 逐弦拨弦（str）可视化层
   T240b 系列（v3.47.0 立；v3.48.0 几何重排后改写）。
   ---------------------------------------------------------------------------
   契约（v3.48.0 口径）：
     · pickGlyph：**点恒在**（.pick-dot r 2.6 = "拨这根弦"的底层标记，任何降级兜底）；
       品数/技巧 = **描边数字**叠在点的位置上（g.pick-lab > text.pick-txt，11px 粗体 +
       var(--bg) 描边 paint-order:stroke 掏空身后弦线，无底衬——用户拍板去胶囊；
       数字盖住点，有品不见点）。cy(s) = (s−1)×11 与 has-pick 档六线（--gt 11px）逐位一致；
       viewBox 26×56 = has-pick 档格子带 1:1；svg 高度钉 var(--pick-h)（不 100%——
       .strums 宿主是整行高，100% 会纵向拉成近两倍，v3.47.0/1「圆点太大」的根因）；
     · has-pick 覆盖档（v3.48.0）：当前型含 str ⇒ #viz.has-pick（格子带 44→56、
       行高 86→98 等整组几何同块覆盖）；不含 ⇒ 44px 基础档不动（用户拍板：
       没有分解记谱不必调整跑道）。类由 syncTabLayer 在采几何**之前**挂（改行高 ⇒
       必须先于 cacheGeo）；
     · 三处渲染点同构（主视图 buildRowCells / 编辑器 editorRender / 编排页 mkPatBar）：
       宿主 .strumv.pick、同一份 SVG 子结构；str 优先于 dir（同格不画箭头）；
       编排页恒 notxt（总览只留点）；编辑器格 overflow:hidden ⇒ svg 上下内缩 6px
       （.edcell .strumv.pick svg{top:6px;height:calc(100% - 12px)}，①⑥ 弦胶囊不被格缘切）；
     · 染态：hit 变绿（.strumv.pick.hit）/ 空拨 ghost 空心虚线 / 窄格两级降级
       （先藏胶囊组 notxt——类挂在 **svg** 上，选择器是 svg.notxt——再藏整体 STRUM_MIN_W）；
     · ★ 纯 str 型（无 dir/zone）：六线 .tab 层与 .strums 层照建（hasStrumLike 扩展的钉子）；
     · 帧内纪律：setCell 对 pick 宿主只切 .hit（与箭头同路径，PROBE 零新增布局读取面）。 */
"use strict";
const { loadApp, ok, eq, section, driveFrames, FakeAudioContext, html } = require("../lib/harness");

const load = (seed, opts) => loadApp(seed, opts);
const BARS = () => [0,1,2,3].map(() => [
  { t: 48, str: [{ s: 5, f: 3 }] },                                    // 单弦带品 → 胶囊「3」
  { t: 48, str: [{ s: 2, f: 0, tech: "P" }] },                         // 带品带技巧 → 胶囊「0P」
  { t: 48, rest: true, str: [{ s: 4 }] },                              // 空拨 → ghost 空心点
  { t: 48, str: [{ s: 5, f: 3 }, { s: 2, f: 2 }, { s: 1, f: 0 }] },    // 多弦加花（⑤3+②2+①0）
]);
const PRESET = () => ({ name: "分解", meter: 4, bars: BARS() });

/* 定位工具（与 t62 同一套手法） */
const rowsOf = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const layerOf = (els, b) => {
  const row = rowsOf(els)[b];
  return row ? (row.children.find(c => /(^| )strums( |$)/.test(c.className)) || null) : null;
};
const tabOf = (els, b) => {
  const row = rowsOf(els)[b];
  return row ? (row.children.find(c => /(^| )tab( |$)/.test(c.className)) || null) : null;
};
const pickOf = (els, b, i) => {
  const l = layerOf(els, b);
  return l ? (l.children.find(c => c.dataset && c.dataset.i === String(i)) || null) : null;
};
const svgOf = host => host ? (host.children.find(c => c.tagName === "SVG") || null) : null;
const edCellsOf = (els, b) => els["editorBars"].children[b].children[1].children;
const circlesOf = svg => svg.children.filter(c => c.tagName === "CIRCLE");
/* v3.48.0：文本串收进 g.pick-lab 组（rect 底衬 + text），不再是 svg 的直接子节点 ⇒ 递归收集 */
const textsOf = svg => {
  const out = [];
  (function walk(n){ n.children.forEach(c => { if (c.tagName === "TEXT") out.push(c); walk(c); }); })(svg);
  return out;
};
const labsOf = svg => svg.children.filter(c => c.getAttribute && c.getAttribute("class") === "pick-lab");
const importAndSelect = beat => {
  beat.Store.importPresets(JSON.stringify({ presets: [PRESET()] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
};

/* ================= 场景 T240b-1：主视图结构（纯 str 型的层与记号） ================= */
section("T240b-1 逐弦 · 纯 str 型建层 / has-pick 升档 / 宿主与 SVG 子结构 / 描边数字");
{
  const { beat, els } = load();
  importAndSelect(beat);
  /* ★ hasStrumLike 扩展的钉子：纯 str 型六线层与箭头层照建 */
  ok(!!tabOf(els, 0), "★ 纯 str 型（无 dir/zone）→ 六线 .tab 层照建");
  ok(!!layerOf(els, 0), "★ 纯 str 型 → .strums 层照建");
  /* ★ has-pick 升档（v3.48.0）：含 str ⇒ 格子带 56px 档 */
  eq(els["viz"].classList.contains("has-pick"), true,
     "★ 含 str 的型 → #viz.has-pick（格子带升 56px，品数胶囊要 11px 弦距）");
  /* 四格逐位检查 */
  for (let i = 0; i < 4; i++){
    const host = pickOf(els, 0, i);
    ok(!!host, `第 ${i + 1} 格有逐弦点宿主（data-i 定位）`);
    if (!host) continue;
    ok(/(^| )strumv pick( |$)/.test(host.className), `第 ${i + 1} 格宿主类 .strumv.pick`);
    const svg = svgOf(host);
    ok(!!svg, `第 ${i + 1} 格宿主内是 SVG`);
    if (!svg) continue;
    eq(svg.viewBox, "0 0 26 56", `第 ${i + 1} 格 SVG viewBox 26×56（has-pick 档格子带 1:1）`);
    eq(svg.preserveAspectRatio, "none", `第 ${i + 1} 格 pAR=none（跨行高等比铺的既有取舍）`);
  }
  /* 单弦带品：点在 DOM（haslab 类，数字在时 CSS 藏）+ 描边数字叠在点的位置上 */
  const svg0 = svgOf(pickOf(els, 0, 0));
  const d0 = circlesOf(svg0)[0];
  eq(circlesOf(svg0).length, 1,
     "★ 带品格也有 1 颗点（拨弦底层标记，窄屏/窄格藏数字时兜底——三轮「整格全空」的反向钉子）");
  eq(d0.getAttribute("class"), "pick-dot haslab",
     "★ 带品的点带 haslab 类（数字在时 CSS 藏点——数字两侧不露圆点边，五轮用户实拍）");
  eq(d0.cy, "44", "⑤弦点 cy=4×11=44");
  const lab0 = labsOf(svg0)[0];
  ok(!!lab0, "带品格有 .pick-lab 数字组");
  eq(lab0.children.length, 1, "数字组里只有文本（无底衬矩形）");
  eq(svg0.children.filter(c => c.tagName === "RECT").length, 0, "★ 无 rect——胶囊底衬已去（用户拍板）");
  const t0 = textsOf(svg0)[0];
  ok(!!t0 && t0.textContent === "3", "带品格文本串 = 「3」（六线谱百年记法）");
  eq(t0.getAttribute("class"), "pick-txt", "文本带 .pick-txt 类");
  eq(t0.getAttribute("x"), "13", "文本在纵列中线 x=13（叠在点的位置上）");
  eq(t0.getAttribute("text-anchor"), "middle", "文本水平居中");
  eq(t0.getAttribute("font-size"), "11", "品数 11px 粗体");
  eq(t0.getAttribute("y"), "44", "⑤弦 cy=4×11=44（与 .tab 第五线落点逐位一致）");
  /* 带品带技巧：0P */
  const t1 = textsOf(svgOf(pickOf(els, 0, 1)))[0];
  eq(t1.textContent, "0P", "★ 品+技巧合并为一个文本串「0P」（不另开点上方位置）");
  ok(html.includes(".strumv.pick .pick-txt{fill:currentColor;font-weight:700;paint-order:stroke;stroke:var(--bg);stroke-width:2.2px;stroke-linejoin:round}"),
     "★ CSS：品数 = 粗体 + var(--bg) 描边（paint-order:stroke 掏空身后弦线，无底衬也不融背景）");
  eq(t1.getAttribute("y"), "11", "②弦 cy=11");
  /* 空拨（无品无技）：ghost 宿主、只留一颗点 */
  const host2 = pickOf(els, 0, 2);
  ok(/ ghost/.test(" " + host2.className), "rest+str 空拨 → .ghost 宿主");
  eq(labsOf(svgOf(host2)).length, 0, "空拨无品无技 → 无数字组");
  const cd = circlesOf(svgOf(host2));
  eq(cd.length, 1, "空拨仍留点（手到无声也要看见手）");
  eq(cd[0].getAttribute("class"), "pick-dot", "点带 .pick-dot 类（色由 CSS 管）");
  eq(cd[0].cx, "13", "点 cx=13（纵列中线）");
  eq(cd[0].cy, "33", "④弦点 cy=3×11=33");
  eq(cd[0].r, "2.6", "点 r=2.6（点径 5.2 < 弦距 11）");
  eq(cd[0].getAttribute("fill"), null, "点不带 fill 属性（色全归 CSS currentColor 链）");
  /* 多弦加花：3 点 + 3 数字，各自 cy（点恒在兜底） */
  const svg3 = svgOf(pickOf(els, 0, 3));
  eq(circlesOf(svg3).length, 3, "★ 一格多弦 = 纵列多点（带品也有点，兜底）");
  eq(labsOf(svg3).length, 3, "一格多弦 = 纵列多数字");
  eq(JSON.stringify(textsOf(svg3).map(t => t.getAttribute("y"))), JSON.stringify(["0", "11", "44"]),
     "①②⑤ 的 cy 各对弦线（升序）");
  eq(JSON.stringify(textsOf(svg3).map(t => t.textContent)), JSON.stringify(["0", "2", "3"]),
     "各胶囊各自标品数");
  /* 水平定位：与箭头同公式（格中心） */
  eq(pickOf(els, 0, 0).style.left, "12.5%", "第 1 格 left = 格中心 12.5%（与箭头同公式）");
  eq(pickOf(els, 0, 1).style.left, "37.5%", "第 2 格 left = 37.5%");
  /* 帧内纪律的静态面 + 本版几何纪律的 CSS 钉子 */
  ok(html.includes(".strumv.pick.hit{color:var(--green)"), "CSS：pick 命中染绿规则在位");
  ok(html.includes(".strumv.pick.ghost .pick-dot{fill:none;stroke:currentColor;stroke-dasharray:2 2}"),
     "CSS：空拨空心虚线点规则在位");
  ok(html.includes(".strumv.pick.hit.ghost{color:var(--blue);filter:none}"),
     "CSS：空拨不被 .hit 染实心（同 .strumv.hit.ghost 语义）");
  ok(html.includes("height:var(--pick-h)") && html.includes("width:calc(26px * var(--pick-sy, 1))"),
     "★ CSS：svg 高钉 --pick_h（格子带，不再 100% 整行——v3.47.0/1「圆点太大」根因）、"
     + "宽随 --pick-sy 等比缩（点恒圆——五轮「圆点并不圆」用户实拍）");
  ok(html.includes(".strumv.pick .pick-dot.haslab{display:none}")
     && html.includes(".strumv.pick svg.notxt .pick-dot.haslab{display:block}"),
     "★ CSS：haslab 点——数字在时藏点、窄格 notxt 藏品时点回来兜底");
  ok(/@media \(max-width:960px\)\{[\s\S]*?\.strumv\.pick \.pick-dot\.haslab\{display:block\}/.test(html),
     "★ CSS：窄屏档藏品后点回来兜底（@media ≤960 内的 haslab 放行规则）");
  ok(!html.includes(".strumv.pick .pick-txt{fill:var(--bg)"), "★ CSS：胶囊时代的反色字规则已退役（描边数字走 currentColor 染态链）");
  ok(html.includes(".strumv.pick svg.notxt .pick-lab"),
     "★ CSS：notxt 选择器写成 svg.notxt（类挂在 svg 上；v3.47.0 写成宿主类实际空转）");
  ok(html.includes(".edcell .strumv.pick svg{top:6px;height:calc(100% - 12px)}"),
     "★ CSS：编辑器记号上下内缩 6px（.edcell overflow:hidden，①⑥ 弦胶囊不被格缘切）");
  ok(html.includes("#viz.has-pick{--cell-h:56px;--pick-h:56px;--pick-sy:1;--gt:11px"),
     "★ CSS：has-pick 覆盖档整组几何同块覆盖（56/11，含 --pick-sy 等比系数）");
}

/* ================= 场景 T240b-1b：无 str 的型 ⇒ 不升档（44px 基础档不动） ================= */
section("T240b-1b 逐弦 · 无分解记谱的型不升档（has-pick 不挂）");
{
  /* 判据探针（型级，与数据区 hasStrum / patHasPick 同口径的测试侧复刻） */
  const hasStrumPat = p => p.bars.some(bar => bar.some(s => s.dir !== undefined || s.zone !== undefined || (s.str && s.str.length)));
  const hasPickPat = p => p.bars.some(bar => bar.some(s => s.str && s.str.length));
  const { beat, els } = load();
  /* 纯节拍型（四分基础）：不升档 */
  beat.Store.S.sel = { type: "builtin", idx: 0 };
  beat.Presets.refreshAfterPatternChange();
  eq(hasStrumPat(beat.activePattern()), false, "前提：内置[0] 是纯节拍型（无任何扫弦类记谱）");
  eq(els["viz"].classList.contains("has-pick"), false,
     "★ 纯节拍型 → 无 has-pick（跑道保持 44px 基础档——没有分解记谱不必调整，用户拍板）");
  /* 扫弦型（dir/zone、无 str）：同样不升档（箭头在 44px 档本来就好好的） */
  const bi = beat.BUILTINS.findIndex(p => hasStrumPat(p) && !hasPickPat(p));
  ok(bi >= 0, "前提：内置里存在扫弦（无 str）型");
  beat.Store.S.sel = { type: "builtin", idx: bi };
  beat.Presets.refreshAfterPatternChange();
  eq(els["viz"].classList.contains("has-pick"), false,
     "★ 扫弦型（dir/zone、无 str）→ 不升档（升档只为品数胶囊服务）");
}

/* ================= 场景 T240b-2：hit 染态（播放中 setCell 切 .hit） ================= */
section("T240b-2 逐弦 · 播放中 pick 宿主继承 .hit 切换");
{
  const { beat, els } = load();
  importAndSelect(beat);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 0.4);          // 96BPM：0.4s 内第 1 格处于 active
  /* ★ 先断言再停机：stop → resetForStop 会摘 .hit，停机后查恒为空 */
  const hits = layerOf(els, 0).children.filter(c => /(^| )hit( |$)/.test(c.className)
    && /(^| )pick( |$)/.test(c.className));
  ok(hits.length >= 1, "★ 播放帧内 pick 宿主被 setCell 切上 .hit（与箭头同路径）");
  eq(hits.length ? hits[0].dataset.i : null, "0", "命中的是第 1 格的宿主");
  beat.Controls.stop();
}

/* ================= 场景 T240b-3：编辑器渲染点同构 + aria ================= */
section("T240b-3 逐弦 · 编辑器同构 / str 优先于 dir / aria-label");
{
  const { beat, els } = load();
  importAndSelect(beat);
  beat.Editor.open();
  const cell0 = edCellsOf(els, 0)[0];
  const pv0 = cell0.children.find(c => /(^| )strumv pick( |$)/.test(c.className));
  ok(!!pv0, "编辑器格内挂 .strumv.pick");
  const svg0 = pv0.children.find(c => c.tagName === "SVG");
  eq(circlesOf(svg0).length, 1, "编辑器 SVG 与主视图同构（带品 ⇒ 点兜底 + 数字）");
  eq(labsOf(svg0).length, 1, "编辑器底衬胶囊同构");
  eq(textsOf(svg0).length, 1, "编辑器文本串同构");
  eq(textsOf(svg0)[0].getAttribute("y"), "44", "编辑器 cy 同一映射");
  /* aria-label：⑤弦3品 */
  ok(String(cell0["aria-label"]).includes("逐弦 ⑤弦3品"), "aria-label 拼「逐弦 ⑤弦3品」");
  /* 品+技巧：「②弦0品勾弦」 */
  ok(String(edCellsOf(els, 0)[1]["aria-label"]).includes("②弦0品勾弦"),
     "aria-label 拼「②弦0品勾弦」（品+技巧全量入名）");
  /* 多弦格：+ 串接 */
  ok(String(edCellsOf(els, 0)[3]["aria-label"]).includes("+"), "多弦格 aria 用 + 串接");
  /* str 优先于 dir：str 格不画方向箭头 */
  const cell2 = edCellsOf(els, 0)[2];
  ok(/ ghost/.test(" " + cell2.children.find(c => /(^| )strumv( |$)/.test(c.className)).className),
     "空拨格 = ghost pick");
  beat.Editor.tryClose();
  /* dir+str 同格：pick 优先、无箭头（给格补 dir 后重开编辑器） */
  const p = beat.Store.customs[beat.Store.customs.length - 1];
  p.bars[0][0].dir = "D";                       // 直接改库内型（测试构造）
  beat.Presets.refreshAfterPatternChange();
  const host = pickOf(els, 0, 0);
  ok(!!host && / pick/.test(" " + host.className), "dir+str 同格 → 主视图仍画 pick（str 优先）");
  eq(svgOf(host).children.filter(c => c.tagName === "CIRCLE").length, 1, "是 pick（点+数字）而不是箭头");
}

/* ================= 场景 T240b-4：编排页 mkPatBar 同构 + 恒 notxt ================= */
section("T240b-4 逐弦 · 编排页块头行同构（恒 notxt 只留点）");
{
  const { beat } = load();
  const el = beat.Arrange.mkPatBar({ name: "x", meter: 4, bars: BARS() }, true);
  eq(el.className, "arg-pat-bar", "编排页块头容器类");
  const picks = el.children.filter(c => /(^| )strumv pick( |$)/.test(c.className));
  eq(picks.length, 4, "四格四宿主（与主视图同构）");
  ok(picks.every(c => /(^| )notxt( |$)/.test(c.className)),
     "★ 编排页恒 notxt（30/36px 总览行放不下底衬胶囊，只留点）");
  const svg0 = picks[0].children.find(c => c.tagName === "SVG");
  eq(circlesOf(svg0).length, 1, "SVG 子结构与主视图逐位一致（点兜底）");
  eq(labsOf(svg0).length, 1, "数字在 DOM（CSS 藏，与 notxt 降级同口径）");
  eq(textsOf(svg0)[0].textContent, "3", "文本串同一份");
  eq(picks[0].style.left, "12.5%", "水平定位同一公式（pct(startT + t/2)）");
  ok(/ ghost/.test(" " + picks[2].className), "空拨 ghost 同口径");
  /* hasStr=false（非扫弦谱）不画 */
  const el2 = beat.Arrange.mkPatBar({ name: "x", meter: 4, bars: BARS() }, false);
  eq(el2.children.filter(c => /(^| )strumv( |$)/.test(c.className)).length, 0,
     "无记谱谱（hasStr=false）不画逐弦点");
}

/* ================= 场景 T240b-5：窄格两级降级 ================= */
section("T240b-5 逐弦 · 窄格先藏胶囊后藏点");
{
  /* 分页主视图有窄屏自适应切片（chooseRowBeats 保证最短格 ≥ SLICE_MIN_CELL=24px），
     两级阈值在那里是防御纵深；真正会把格子压到阈值以下的是 **scroll 模式**
     （一行恒 = 整小节、不切片，见 buildViz 的 v3.0.0 注释）：rowW 200 时 6t 格 = 6.25px。
     同型的 24t 格 = 25px（≥ 两阈值 → 不降级，作对照）。 */
  const { beat, els } = load({}, { rowW: 200, viewportW: 1280 });
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "窄格", meter: 4,
    bars: [0,1,2,3].map(() => [
      { t: 6, str: [{ s: 5, f: 3, tech: "P" }] },   // 6.25px：两级全触发
      { t: 12 },
      { t: 24, str: [{ s: 3 }] },                    // 25px：对照（不降级）
      { t: 48 },
      { t: 96 },
      { t: 6 },
    ]) }] }));
  beat.Store.S.scrollMode = true;                    // 连续滚动：一行 = 整小节（切片不参与）
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  const narrow = pickOf(els, 0, 0), ctrl = pickOf(els, 0, 2);
  ok(!!narrow && !!ctrl, "scroll 模式下两个逐弦点都在");
  eq(svgOf(narrow).classList.contains("notxt"), true,
     "★ 6.25px 格 → svg notxt（第一级：藏品数/技巧胶囊，只留点）");
  eq(narrow.style.display, "none",
     "★ 6.25px 格 → 整体 display:none（第二级，走既有 STRUM_MIN_W 门）");
  eq(svgOf(ctrl).classList.contains("notxt"), false, "25px 对照格不降级");
  eq(ctrl.style.display, "", "25px 对照格整体可见");
}
