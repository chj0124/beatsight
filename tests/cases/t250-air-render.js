/* BeatSight 自动化测试 · 无方向空扫（air）渲染与分类（v3.52.0）
   T250 系列。
   ---------------------------------------------------------------------------
   契约：新增可选字段 air:true（仅在 rest===true 时有意义），空扫判据统一为 rest && (dir || air)。
     · 三处渲染点（主视图 / 编辑器 / 编排页 mini）同口径：有方向 → 带箭头空扫（.strumv.ghost + dn/up）；
       无方向 → **无头蓝虚线杆**（.strumv.ghost.air，不带 dn/up/arp 类 ⇒ 三角天然不可见）；
     · 弦区沿用 prevZone（air 是 rest，天然不更新 prevZone，与带箭头空扫逐位一致）；
     · 编辑器 aria 报「空扫」（dir 或 air 任一）；
     · stepHasStrumLike 纳入 air ⇒ 纯 air 型归「扫弦」类（hasStrum=true）；
     · 老数据 rest+dir 仍是**带箭头** ghost（零迁移回归）；
     · 磁吸落点集（secOnsetTicks includeGhost）含 air 格。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

function vizRows(els){ return els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className)); }
function strumLayerOf(els, b){
  const rows = vizRows(els);
  return rows[b] ? rows[b].children.find(ch => /(^| )strums( |$)/.test(ch.className)) || null : null;
}
function strumOf(els, b, i){
  const l = strumLayerOf(els, b);
  return l ? (l.children.find(c => c.dataset && c.dataset.i === String(i)) || null) : null;
}
/* class → { ghost, air, dn, up, arp, zone } 的解析器（测试里一律经它取值） */
function glyph(els, b, i){
  const sm = strumOf(els, b, i);
  if (!sm) return null;
  const cl = " " + sm.className + " ";
  return {
    ghost: / ghost /.test(cl),
    air: / air /.test(cl),
    dn: / dn /.test(cl),
    up: / up /.test(cl),
    arp: / arp /.test(cl),
    zone: / kF /.test(cl) ? "full" : (/ kB /.test(cl) ? "bass" : (/ kT /.test(cl) ? "treble" : "?")),
  };
}
function selectPreset(beat, els, bars){
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "air素材", meter: 4, bars }] })).ok, "素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
}
const edCellsOf = (els, b) => els["editorBars"].children[b].children[1].children;

/* ================= 场景 T250a：主视图渲染无头蓝虚线杆 ================= */
section("T250a 主视图 · 无方向空扫 = .strumv.ghost.air（无 dn/up/arp）");
{
  const { beat, els } = loadApp();
  selectPreset(beat, els, [[{ t:48, rest:true, air:true }, { t:48 }, { t:48 }, { t:48 }]]);
  beat.Viz.buildViz();
  const g = glyph(els, 0, 0);
  ok(!!g, "无方向空扫格渲染出 .strumv 记号（hasStr 生效）");
  eq(g && g.ghost, true, "带 .ghost（蓝虚线杆身）");
  eq(g && g.air, true, "★ 带 .air 类（无方向空扫锚点）");
  eq(g && g.dn, false, "★ 不带 .dn（无方向 ⇒ 无箭头三角）");
  eq(g && g.up, false, "★ 不带 .up");
  eq(g && g.arp, false, "★ 不带 .arp");
  eq(g && g.zone, "full", "无前一记实扫 → 弦区落默认全扫");
  const layer = strumLayerOf(els, 0);
  eq(layer ? layer.children.length : -1, 1, "空扫格只有一支记号（不是并列两支）");
  eq(strumOf(els, 0, 1), null, "无记谱的纯发声音符不生成记号");
}

/* ================= 场景 T250b：弦区沿用前一记实扫（prevZone） ================= */
section("T250b 主视图 · 空扫（air）弦区沿用前一记实扫的 zone");
{
  const { beat, els } = loadApp();
  /* 第 1 格实扫低弦区（zone 0）→ prevZone=0；第 2 格无方向空扫应沿用 kB */
  selectPreset(beat, els, [[{ t:48, dir:"U", zone:0 }, { t:48, rest:true, air:true }, { t:48 }, { t:48 }]]);
  beat.Viz.buildViz();
  eq((glyph(els, 0, 0) || {}).zone, "bass", "第 1 格实扫低弦区");
  const g = glyph(els, 0, 1);
  eq(g && g.zone, "bass", "★ 无方向空扫沿用前一记实扫的弦区（kB）");
  eq(g && g.ghost && g.air, true, "且仍是 ghost.air（无头杆）");
}

/* ================= 场景 T250c：编辑器渲染 + aria 报「空扫」 ================= */
section("T250c 编辑器 · 无方向空扫渲染 + aria-label 报「空扫」");
{
  const { beat, els } = loadApp();
  selectPreset(beat, els, [[{ t:48, rest:true, air:true }, { t:48, rest:true, dir:"D" }, { t:48 }, { t:48 }]]);
  beat.Editor.open();
  const c0 = edCellsOf(els, 0)[0];
  const sv = c0.children.filter(x => /(^| )strumv( |$)/.test(x.className));
  eq(sv.length, 1, "编辑器第 1 格渲染一支 .strumv");
  ok(/(^| )ghost( |$)/.test((sv[0] || {}).className) && /(^| )air( |$)/.test((sv[0] || {}).className),
     "★ 编辑器内联 .strumv.ghost.air（无头蓝虚线杆）");
  ok(!/(^| )(dn|up|arp)( |$)/.test((sv[0] || {}).className), "★ 不带方向类");
  ok(/空扫/.test(c0.getAttribute("aria-label")), "★ aria-label 报「空扫」（air 亦计入 dirName）");
  const c1 = edCellsOf(els, 0)[1];
  ok(/空扫/.test(c1.getAttribute("aria-label")), "带方向空扫（rest+dir）同样报「空扫」");
}

/* ================= 场景 T250d：分类 —— 纯 air 型归「扫弦」 ================= */
section("T250d 分类 · stepHasStrumLike 纳入 air ⇒ 纯 air 型 hasStrum=true");
{
  const { beat } = loadApp();
  eq(beat.stepHasStrumLike({ t:48, rest:true, air:true }), true, "★ 纯 air 格判为带扫弦记谱");
  eq(beat.stepHasStrumLike({ t:48, rest:true }), false, "纯休止格仍不算（air 缺省）");
  eq(beat.hasStrum({ bars: [[{ t:48, rest:true, air:true }, { t:48 }]] }), true,
     "★ 纯 air 型（全部格只挂 air）→ hasStrum=true（归类到「扫弦」）");
  eq(beat.hasStrum({ bars: [[{ t:48, rest:true }, { t:48 }]] }), false,
     "对照：纯休止型（无 air）仍归「节拍」");
}

/* ================= 场景 T250e：老数据零迁移（rest+dir 仍带箭头） ================= */
section("T250e 主视图 · 老数据 rest+dir 仍是带箭头 ghost（零迁移回归）");
{
  const { beat, els } = loadApp();
  selectPreset(beat, els, [[{ t:48, rest:true, dir:"D" }, { t:48 }, { t:48 }, { t:48 }]]);
  beat.Viz.buildViz();
  const g = glyph(els, 0, 0);
  ok(!!g, "老数据 rest+dir 渲染出记号");
  eq(g && g.ghost, true, "带 .ghost（空扫虚线）");
  eq(g && g.dn, true, "★ 仍带方向类 .dn（有方向 ⇒ 带箭头，与 air 无头杆互斥）");
  eq(g && g.air, false, "★ 不带 .air 类（老数据零迁移，形状逐位不变）");
}

/* ================= 场景 T250f：磁吸落点集含 air 格 ================= */
section("T250f secOnsetTicks · includeGhost 下无方向空扫（air）计入磁吸落点");
{
  const { beat } = loadApp();
  /* 16 个十六分：下标 1/5/9/13 是「休止 + air」= 无方向空扫，其余发声 */
  const bar = [];
  for (let i = 0; i < 16; i++) bar.push(i % 4 === 1 ? { t: 12, rest:true, air:true } : { t: 12, dir:"D" });
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "air夹具", meter: 4, bars: [bar] }] })), "素材型导入");
  const id = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "air曲式", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id }, repeats: 1 }] },
  ] }), "曲式落库");
  const sec = beat.Store.arranges[beat.Store.arranges.length - 1].sections[0];
  const auto = beat.Arrange.secOnsetTicks(sec);
  eq(auto.join(","), "0,24,36,48,72,84,96,120,132,144,168,180",
     "不传参（自动对齐口径）**排除**无方向空扫");
  const manual = beat.Arrange.secOnsetTicks(sec, true);
  eq(manual.join(","), Array.from({ length: 16 }, (_, i) => i * 12).join(","),
     "★ 传 true（手动拖动磁吸集）**含** air 空扫 ⇒ 16 格全在");
}
