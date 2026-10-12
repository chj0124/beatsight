/* BeatSight 自动化测试 · 逐弦拨弦（str）可视化层
   T240b 系列（v3.47.0）。
   ---------------------------------------------------------------------------
   契约：
     · pickGlyph：实心点 = 拨这根弦（cy = (s−1)×8.6，与 .tab 六线落点逐位一致）、
       点右文本串 = 品数/技巧（`3` / `3P` / `P`）；viewBox 26×44 = 主视图行高 1:1；
     · 三处渲染点同构（主视图 buildRowCells / 编辑器 editorRender / 编排页 mkPatBar）：
       宿主 .strumv.pick、同一份 SVG 子结构；str 优先于 dir（同格不画箭头）；
     · 染态：hit 变绿（.strumv.pick.hit）/ 空拨 ghost 空心虚线 / 窄格两级降级
       （先藏文本 notxt，再藏整体 STRUM_MIN_W）；
     · ★ 纯 str 型（无 dir/zone）：六线 .tab 层与 .strums 层照建（hasStrumLike 扩展的钉子）；
     · 帧内纪律：setCell 对 pick 宿主只切 .hit（与箭头同路径，PROBE 零新增布局读取面）。 */
"use strict";
const { loadApp, ok, eq, section, driveFrames, FakeAudioContext, html } = require("../lib/harness");

const load = (seed, opts) => loadApp(seed, opts);
const BARS = () => [0,1,2,3].map(() => [
  { t: 48, str: [{ s: 5, f: 3 }] },                                    // 单弦带品 → 「3」
  { t: 48, str: [{ s: 2, f: 0, tech: "P" }] },                         // 带品带技巧 → 「0P」
  { t: 48, rest: true, str: [{ s: 4 }] },                              // 空拨 → ghost 空心
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
const textsOf = svg => svg.children.filter(c => c.tagName === "TEXT");
const importAndSelect = beat => {
  beat.Store.importPresets(JSON.stringify({ presets: [PRESET()] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
};

/* ================= 场景 T240b-1：主视图结构（纯 str 型的层与记号） ================= */
section("T240b-1 逐弦 · 纯 str 型建层 / 宿主与 SVG 子结构 / 文本串格式");
{
  const { beat, els } = load();
  importAndSelect(beat);
  /* ★ hasStrumLike 扩展的钉子：纯 str 型六线层与箭头层照建 */
  ok(!!tabOf(els, 0), "★ 纯 str 型（无 dir/zone）→ 六线 .tab 层照建");
  ok(!!layerOf(els, 0), "★ 纯 str 型 → .strums 层照建");
  /* 四格逐位检查 */
  for (let i = 0; i < 4; i++){
    const host = pickOf(els, 0, i);
    ok(!!host, `第 ${i + 1} 格有逐弦点宿主（data-i 定位）`);
    if (!host) continue;
    ok(/(^| )strumv pick( |$)/.test(host.className), `第 ${i + 1} 格宿主类 .strumv.pick`);
    const svg = svgOf(host);
    ok(!!svg, `第 ${i + 1} 格宿主内是 SVG`);
    if (!svg) continue;
    eq(svg.viewBox, "0 0 26 44", `第 ${i + 1} 格 SVG viewBox 26×44（行高 1:1）`);
    eq(svg.preserveAspectRatio, "none", `第 ${i + 1} 格 pAR=none（跨行高铺满的既有取舍）`);
  }
  /* 单弦带品：cy 对弦线、文本串 = 品数 */
  const svg0 = svgOf(pickOf(els, 0, 0));
  const c0 = circlesOf(svg0)[0];
  eq(circlesOf(svg0).length, 1, "单弦格 1 颗点");
  eq(c0.cx, "5", "点 cx=5");
  eq(c0.cy, "34.4", "★ ⑤弦点 cy=4×8.6=34.4（与 .tab 第五线落点逐位一致）");
  eq(c0.r, "3.4", "点 r=3.4（点径 6.8 ≤ 弦距 8.6）");
  eq(c0.fill, "currentColor", "点色走 currentColor（CSS 管色、SVG 只管形）");
  const t0 = textsOf(svg0)[0];
  ok(!!t0 && t0.textContent === "3", "带品格文本串 = 「3」（六线谱百年记法）");
  eq(t0.x, "10.5", "文本在点右侧 x=10.5");
  /* 带品带技巧：0P */
  const t1 = textsOf(svgOf(pickOf(els, 0, 1)))[0];
  eq(t1.textContent, "0P", "★ 品+技巧合并为一个文本串「0P」（不另开点上方位置）");
  eq(circlesOf(svgOf(pickOf(els, 0, 1)))[0].cy, "8.6", "②弦点 cy=8.6");
  /* 空拨：ghost 宿主、无文本 */
  const host2 = pickOf(els, 0, 2);
  ok(/ ghost/.test(" " + host2.className), "rest+str 空拨 → .ghost 宿主");
  eq(textsOf(svgOf(host2)).length, 0, "空拨无品无技 → 无文本串");
  /* 多弦加花：3 点 3 串，各自 cy */
  const svg3 = svgOf(pickOf(els, 0, 3));
  eq(circlesOf(svg3).length, 3, "★ 一格多弦 = 同一 x 纵列多点");
  eq(JSON.stringify(circlesOf(svg3).map(c => c.cy)), JSON.stringify(["0", "8.6", "34.4"]),
     "①②⑤ 的 cy 各对弦线（升序）");
  eq(JSON.stringify(textsOf(svg3).map(t => t.textContent)), JSON.stringify(["0", "2", "3"]),
     "各点各自标品数");
  /* 水平定位：与箭头同公式（格中心） */
  eq(pickOf(els, 0, 0).style.left, "12.5%", "第 1 格 left = 格中心 12.5%（与箭头同公式）");
  eq(pickOf(els, 0, 1).style.left, "37.5%", "第 2 格 left = 37.5%");
  /* 帧内纪律的静态面：setCell 对 strumEls 的 .hit 切换路径覆盖 pick 宿主（CSS 染色规则在位） */
  ok(html.includes(".strumv.pick.hit{color:var(--green)"), "CSS：pick 命中染绿规则在位");
  ok(html.includes(".strumv.pick.ghost circle{fill:none;stroke:currentColor;stroke-dasharray:2 2}"),
     "CSS：空拨空心虚线规则在位");
  ok(html.includes(".strumv.pick.hit.ghost{color:var(--blue);filter:none}"),
     "CSS：空拨不被 .hit 染实心（同 .strumv.hit.ghost 语义）");
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
  eq(circlesOf(svg0).length, 1, "编辑器 SVG 与主视图同构（1 颗点）");
  eq(circlesOf(svg0)[0].cy, "34.4", "编辑器 cy 同一映射");
  eq(textsOf(svg0).length, 1, "编辑器文本串同构");
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
  eq(svgOf(host).children.filter(c => c.tagName === "CIRCLE").length, 1, "是 pick 而不是箭头");
}

/* ================= 场景 T240b-4：编排页 mkPatBar 同构 ================= */
section("T240b-4 逐弦 · 编排页块头行同构");
{
  const { beat } = load();
  const el = beat.Arrange.mkPatBar({ name: "x", meter: 4, bars: BARS() }, true);
  eq(el.className, "arg-pat-bar", "编排页块头容器类");
  const picks = el.children.filter(c => /(^| )strumv pick( |$)/.test(c.className));
  eq(picks.length, 4, "四格四宿主（与主视图同构）");
  const svg0 = picks[0].children.find(c => c.tagName === "SVG");
  eq(circlesOf(svg0).length, 1, "SVG 子结构与主视图逐位一致");
  eq(circlesOf(svg0)[0].cy, "34.4", "cy 映射同一份");
  eq(textsOf(svg0)[0].textContent, "3", "文本串同一份");
  eq(picks[0].style.left, "12.5%", "水平定位同一公式（pct(startT + t/2)）");
  ok(/ ghost/.test(" " + picks[2].className), "空拨 ghost 同口径");
  /* hasStr=false（非扫弦谱）不画 */
  const el2 = beat.Arrange.mkPatBar({ name: "x", meter: 4, bars: BARS() }, false);
  eq(el2.children.filter(c => /(^| )strumv( |$)/.test(c.className)).length, 0,
     "无记谱谱（hasStr=false）不画逐弦点");
}

/* ================= 场景 T240b-5：窄格两级降级 ================= */
section("T240b-5 逐弦 · 窄格先藏文本后藏点");
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
     "★ 6.25px 格 → svg notxt（第一级：藏品数/技巧字母，只留点）");
  eq(narrow.style.display, "none",
     "★ 6.25px 格 → 整体 display:none（第二级，走既有 STRUM_MIN_W 门）");
  eq(svgOf(ctrl).classList.contains("notxt"), false, "25px 对照格不降级");
  eq(ctrl.style.display, "", "25px 对照格整体可见");
}
