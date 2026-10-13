/* BeatSight 自动化测试 · 记号起点锚定（本版）
   T243 系列。
   ---------------------------------------------------------------------------
   契约（PLAN-v11 onset-anchor §2）：
     · 起点锚定的唯一公式 = 时值块左缘 + clamp(4px, 25%×块宽, 28px)；
     · 与 .lyric-char 的 left:clamp(4px,25%,28px) **逐字同源**——任一处单方面改常数即红
       （t243④的「口径同源守卫」）；
     · 三处渲染点同式（主视图 buildRowCells / 编排页 mkPatBar / 编辑器 .edcell .strumv）；
     · 形心落锚点（宿主 translateX(-50%) 沿用）⇒ 记号与同 tick 的歌词字共享一条竖线
       （t243②的跨轨对齐守卫，跨的是「扫弦记号轨」与「歌词轨」两条不同宽的轨）。
   旧口径（本版要改掉的）：记号钉在**格中心** —— `((startT/barTicks) + w/2) * 100 + "%"`。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* 4/4、TPB=48 ⇒ 一小节 192t；四颗音带 dir / str（既有箭头又有逐弦点，两种宿主都覆盖） */
const BARS = () => [[
  { t: 48, dir: "D", zone: 1 },        // 起点 0   · 宽 25%
  { t: 48, str: [{ s: 5, f: 3 }] },    // 起点 48  · 宽 25%
  { t: 24, dir: "U" },                 // 起点 96  · 宽 12.5%
  { t: 72, dir: "D", zone: 2 },        // 起点 120 · 宽 37.5%
]];
const PRESET = () => ({ name: "锚定", meter: 4, bars: BARS() });
const BARTICKS = 4 * 48;               // meter 4 × TPB 48

const rowsOf = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const layerOf = (els, b) => {
  const row = rowsOf(els)[b];
  return row ? (row.children.find(c => /(^| )strums( |$)/.test(c.className)) || null) : null;
};
const markersOf = (els, b) => {
  const l = layerOf(els, b);
  return l ? l.children.filter(c => /(^| )strumv( |$)/.test(c.className)) : [];
};
/* 从 `calc(X% + clamp(4px,Y%,28px))` 里取出 onset 的 X% 项（跨轨对齐就用这一项比） */
const onsetOf = left => {
  const m = /^calc\((.+?) \+ clamp\(/.exec(String(left));
  return m ? m[1] : null;
};
const formulaOf = (startT, t) =>
  `calc(${startT / BARTICKS * 100}% + clamp(4px,${t / BARTICKS * 25}%,28px))`;

const importAndSelect = beat => {
  beat.Store.importPresets(JSON.stringify({ presets: [PRESET()] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
};

/* ================= 场景 T243①：主视图逐记号 left === 按同一数据现算的公式串 ================= */
section("T243① 主视图 · 逐记号 left = 起点 + clamp 内缩（旧「格中心」会红）");
{
  const { beat, els } = loadApp();
  importAndSelect(beat);
  const markers = markersOf(els, 0);
  eq(markers.length, 4, "★ 四格四记号（箭头 + 逐弦点混合）");
  const notes = BARS()[0];
  let acc = 0;
  notes.forEach((s, i) => {
    const exp = formulaOf(acc, s.t);
    eq(markers[i].style.left, exp, `第 ${i + 1} 格 left = 起点 ${acc / BARTICKS * 100}% + 内缩`);
    acc += s.t;
  });
  /* 显式反例：旧「格中心」口径（首格 = 12.5%）不得再出现 */
  ok(markers[0].style.left !== "12.5%", "★ 首格不再是格中心 12.5%（起点锚定）");
}

/* ================= 场景 T243②：跨轨对齐（同 tick 的 strumv onset% === 歌词字 left%） ================= */
section("T243② 跨轨对齐 · 曲式带词模式下同 tick 的记号 onset% = 歌词字左缘%");
{
  const app = loadApp();
  const { beat, els } = app;
  beat.Store.importPresets(JSON.stringify({ presets: [PRESET()] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "对齐曲", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] }] }),
    "一条引用型曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  const sec = arr.sections[0];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: arr.id, from: 0, to: 0, loop: false };
  /* 字落在段内 tick 48 = 小节内 48 ⇒ 行内左缘 25%（与第 2 格的换弦记号同 tick） */
  beat.Store.upsertLyric(arr.id, sec.uid, [{ t: 48, dur: 48, ch: "好" }]);
  beat.Viz.buildViz();
  beat.Viz.buildLyricLane();

  const markers = markersOf(els, 0);
  const m25 = markers.find(k => onsetOf(k.style.left) === "25%");
  ok(!!m25, "第 2 格（tick 48）的记号 left onset 项 = 25%");

  const lane = els["lyricLane"];
  const rows = lane.children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
  ok(rows.length >= 1, "歌词轨按小节分行（≥1 行）");
  const chips = rows[0].children.filter(c => /(^| )lyric-chip( |$)/.test(c.className));
  eq(chips.length, 1, "第 1 行 1 个字块");
  eq(chips[0].style.left, "25%", "★ 歌词字左缘 = 小节内 48/192 = 25%");
  ok(!!m25 && onsetOf(m25.style.left) === chips[0].style.left,
    "★★ 跨轨对齐：扫弦记号 onset 项 === 歌词字左缘（同一 tick 同一条竖线，「与歌词对齐」的机器化守卫）");
}

/* ================= 场景 T243③：编排页缩略带 mkPatBar 公式形 ================= */
section("T243③ 编排页 · mkPatBar 记号 left 同为起点锚定公式形");
{
  const { beat } = loadApp();
  const el = beat.Arrange.mkPatBar(PRESET(), true);
  const picks = el.children.filter(c => /(^| )strumv( |$)/.test(c.className));
  eq(picks.length, 4, "四格四记号（与主视图同构）");
  picks.forEach((p, i) => {
    ok(/^calc\(.+% \+ clamp\(4px,.+%,28px\)\)$/.test(String(p.style.left)),
      `第 ${i + 1} 格 left 是起点锚定公式形（calc(X% + clamp(4px,Y%,28px))）`);
  });
  ok(String(picks[1].style.left).indexOf("25%") === 0 || onsetOf(picks[1].style.left) === "25%",
    "第 2 格 onset 项 = 25%（tick 48）");
}

/* ================= 场景 T243④：口径同源守卫（三处常数必须同源） ================= */
section("T243④ 口径同源守卫 · .lyric-char 与 .edcell .strumv 同用 clamp(4px,25%,28px)");
{
  const pick = (name, re) => ok(re.test(html), name);
  pick("★ .lyric-char 落 left:clamp(4px,25%,28px)（逐字同源基准）",
    /\.lyric-char\{[^}]*left:clamp\(4px,25%,28px\)/);
  pick("★ .edcell .strumv 同式 left:clamp(4px,25%,28px)（编辑器渲染点）",
    /\.edcell \.strumv\{left:clamp\(4px,25%,28px\)\}/);
  ok((html.match(/clamp\(4px,25%,28px\)/g) || []).length >= 2,
    "★ 两处规则都含同一串 clamp(4px,25%,28px)（任一处单方面改常数即红）");
}
