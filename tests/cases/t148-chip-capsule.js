/* BeatSight 自动化测试 · 编排歌词字块「胶囊槽位」化（v2.82.0）
   T148 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html .arg-lyric-chip / mkLyricChip 注释同源）：

     · 参考样式（用户供图，像素取证）：字块 = 落在时值槽里的**胶囊**——四周比格子内缩
       ~2px（相邻字块间 ~4px 视觉缝，缝里露出下层时值轮廓的边线）、圆角 ~6px、
       长时值字 = 跨格连体一颗、空槽 = 轮廓描边（v2.80.0 已有，不动）。
     · ★ 硬约束：**外几何零改动**——left/width 仍是 tick 百分比（拖拽换算 perTick 契约
       v2.35.0 起不动），视觉内缩全靠 `border:2px solid transparent` +
       `background-clip:padding-box`（border-box 内裁切，总宽不变）。
     · 状态环（sel/cur/dragging/blocked/focus-visible）从外阴影改 **inset**——
       外环画在透明边区上，与绿块之间隔一条缝，视觉上"环掉了"。
     · `.sm` = 窄格降级：dur ≤ T16（十六分）内缩降为 1px，不然格子里放不下字
       （沿用 mkLyricChip 的窄块判定点，零新状态）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const lyOf = els => els["argSections"].children[0].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const laneOf = els => lyOf(els).children.find(c => /(^| )arg-lyric-lane( |$)/.test(c.className));
const rowOf = (lane, i) => lane.children.filter(c => /(^| )arg-lyric-row( |$)/.test(c.className))[i];
const barrowOf = row => row.children.find(c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
const chipsOf = barrow => barrow.children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className));

/* 夹具：一小节里五颗时长 12/48/24/12/96（十六分 / 四分 / 八分 / 十六分 / 二分；
   全在 VALID_T 白名单内），五个字贴在各自的起点、dur = 到下一字（「按节奏对齐」产物的典型形状） */
function setup(){
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "混拍", meter: 4, bars: [[{ t: 12 }, { t: 48 }, { t: 24 }, { t: 12 }, { t: 96 }]] },
  ] })).ok, "混拍素材导入成功");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "胶囊", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.upsertLyric(arr.id, arr.sections[0].uid,
    [{ t: 0, dur: 12, ch: "一" }, { t: 12, dur: 48, ch: "二" }, { t: 60, dur: 24, ch: "三" },
     { t: 84, dur: 12, ch: "四" }, { t: 96, dur: 96, ch: "五" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  lyOf(els).children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className)).fire("click");
  return { beat, els };
}

/* ============ 场景 T148a：胶囊化（源码级） ============ */
section("T148a 胶囊化 · 内缩边 / 圆角 / box-sizing / 状态环改 inset（源码级）");
{
  ok(/\.arg-lyric-chip\{[^}]*border:2px solid transparent/.test(html),
     "★ chip 有 2px 透明内缩边（视觉缝的来源）");
  ok(/\.arg-lyric-chip\{[^}]*background-clip:padding-box/.test(html),
     "★ background-clip:padding-box（绿块裁进 padding-box——外几何 left/width 不动的根本）");
  ok(/\.arg-lyric-chip\{[^}]*box-sizing:border-box/.test(html),
     "★ box-sizing:border-box（没有它 border 会把总宽撑大 4px，破坏宽度∝时值）");
  ok(/\.arg-lyric-chip\{[^}]*border-radius:6px/.test(html), "圆角 4→6px（胶囊语汇）");
  ok(/\.arg-lyric-chip\.sm\{border-width:1px\}/.test(html), "★ 窄格降级规则存在（.sm → 1px）");
  for (const cls of ["sel", "cur", "dragging", "blocked"]){
    ok(new RegExp("\\.arg-lyric-chip\\." + cls + "\\{[^}]*box-shadow:inset 0 0 0 2px").test(html),
       "★ ." + cls + " 的环是 inset（外环会悬在 2px 透明缝上）");
  }
  ok(/\.arg-lyric-chip:focus-visible\{[^}]*box-shadow:inset 0 0 0 2px/.test(html),
     "★ :focus-visible 同步 inset（键盘选中态）");
}

/* ============ 场景 T148b：几何零改动 + 窄格降级（桩级） ============ */
section("T148b 几何零改动 · left/width 仍是 tick 百分比 / sm 只给窄格");
{
  const { beat, els } = setup();
  const chips = chipsOf(barrowOf(rowOf(laneOf(els), 0)));
  eq(chips.length, 5, "前提：5 个字块上轨");
  eq(chips.map(c => c.style.left).join(","), "0%,6.25%,31.25%,43.75%,50%",
     "★ left = tick 百分比逐位不变（0/12/60/84/96 ÷ 192）——胶囊化不碰外几何");
  eq(chips.map(c => c.style.width).join(","), "6.25%,25%,12.5%,6.25%,50%",
     "★ width = 时值占比逐位不变（12/48/24/12/96 ÷ 192）——拖拽换算契约不动");
  eq(chips.map(c => /(^| )sm( |$)/.test(c.className)).join(","), "true,false,false,true,false",
     "★ sm 只给 dur≤T16（十六分）的块（1/4 号），其余内缩 2px");
  beat.Arrange.close();
}
