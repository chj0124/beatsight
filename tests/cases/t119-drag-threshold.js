/* BeatSight 自动化测试 · 拖拽阈值分流（v2.49.0 D2/D4）
   T119 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · 两段式：pointerdown 只记 pend（不建 drag / 不加 dragging 类 / 不 preventDefault）；
       onDragMove 位移过阈（触屏 8px / 鼠标 5px）才转正；未转正的 up = 点按
       （selChip 生效 + .sel 视觉 + Store 零变化）；pointercancel 未转正 = 丢弃。
     · D4：.arg-lyric-chip 的 touch-action none→pan-y（竖滚归还浏览器）。
     · CSS 文本断言（t101 同口径）：桩不解析样式表，静态规则只能走源码 includes。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => r.children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className))));

function setup(){
  const { beat, els, fireWin } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材S", meter: 4, bars: [[{ t:48, dir:"D" }, { t:24, dir:"U" }, { t:24, dir:"D" }, { t:48, dir:"U" }, { t:48 }]] },
  ] })).ok, "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Store.upsertLyric(arr.id, arr.sections[0].uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }, { t: 150, dur: 24, ch: "觉" }]);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  return { beat, els, fireWin, id: arr.id, uid: arr.sections[0].uid };
}
const PER_TICK = 600 / 192;
const px = ticks => ticks * PER_TICK;
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};

/* ================= 场景 T119a：点按（down+up 无 move）= 选中，不是拖拽 ================= */
section("T119a 点按选中 · selChip 生效 / Store 零变化 / 无 dragging 类");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  const before = JSON.stringify(chars(beat, id, uid));

  chips[0].fire("pointerdown", { clientX: 100 });
  eq(/(^| )dragging( |$)/.test(chips[0].className), false, "pointerdown 不再加 dragging 类（D2）");
  fireWin("pointerup", {});
  eq(/(^| )sel( |$)/.test(chips[0].className), true, "★ 点按后 .sel 选中态生效");
  eq(JSON.stringify(chars(beat, id, uid)), before, "★ Store 零变化（点按 ≠ 拖拽提交）");

  /* 点第二颗：旧 .sel 就地摘除（不进 arrangeRender） */
  const chips2 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));
  chips2[1].fire("pointerdown", { clientX: 200 });
  fireWin("pointerup", {});
  const chips3 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));   // 无重渲染，引用应同前
  eq(/(^| )sel( |$)/.test(chips3[0].className), false, "旧选中就地摘除");
  eq(/(^| )sel( |$)/.test(chips3[1].className), true, "新选中挂上");
  beat.Arrange.close();
}

/* ================= 场景 T119b：阈值 —— 未过阈的 move 不转正 ================= */
section("T119b 阈值 · 3px 未转正（零变化）/ pointercancel 未转正丢弃");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  const before = JSON.stringify(chars(beat, id, uid));

  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 103 });               // 3px < 5px（鼠标档）
  fireWin("pointerup", {});
  eq(JSON.stringify(chars(beat, id, uid)), before, "★ 未过阈：Store 零变化");
  eq(/(^| )dragging( |$)/.test(chips[0].className), false, "未转正：无 dragging 类");

  /* pointercancel 未转正 = 丢弃（不选中、不提交）。用**未选中**的字块验证：
     前面点按选中的是 chips[0]，cancel 不应让另一颗凭空获得选中 */
  const chips2 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));
  chips2[1].fire("pointerdown", { clientX: 100 });
  fireWin("pointercancel", {});
  eq(/(^| )sel( |$)/.test(chips2[1].className), false, "★ cancel 丢弃：不选中");
  eq(/(^| )sel( |$)/.test(chips2[0].className), true, "此前点按的选中不受影响");
  eq(JSON.stringify(chars(beat, id, uid)), before, "cancel 路径 Store 零变化");
  beat.Arrange.close();
}

/* ================= 场景 T119c：过阈转正 = 正常拖拽提交（与 t117a 同断言口径） ================= */
section("T119c 过阈转正 · 10px 转正 → 磁吸提交（与既有拖拽用例同断言）");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + px(41) });      // tc=41 → 磁吸 48（半拍 24 内最近锚点）
  eq(/(^| )dragging( |$)/.test(chips[0].className), true, "过阈即转正：dragging 类挂上");
  eq(chips[0].style.left, "25%", "拖动中 chip 已被磁到锚点 48（48/192 = 25%）");
  fireWin("pointerup", {});
  eq(chars(beat, id, uid)[0].t, 48, "★ 松手提交 t=48（格吸附会给 36，磁吸覆盖盲格）");
  beat.Arrange.close();
}

/* ================= 场景 T119d：触屏档阈值 8px ================= */
section("T119d 触屏档 · pointerType=touch 过 8px 才转正");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  const before = JSON.stringify(chars(beat, id, uid));
  chips[0].fire("pointerdown", { clientX: 100, pointerType: "touch" });
  fireWin("pointermove", { clientX: 106, pointerType: "touch" });   // 6px：鼠标档会转正，触屏档不
  fireWin("pointerup", { pointerType: "touch" });
  eq(JSON.stringify(chars(beat, id, uid)), before, "★ 触屏 6px 未过 8px 阈：零变化");
  beat.Arrange.close();
}

/* ================= 场景 T119e：CSS 文本断言（t101 同口径） ================= */
section("T119e CSS 契约 · touch-action:pan-y / .sel 选中态 / 窄屏行高 36px");
{
  ok(html.indexOf(".arg-lyric-chip{") >= 0 &&
     /\.arg-lyric-chip\{[^}]*touch-action:pan-y/.test(html),
     "★ .arg-lyric-chip 含 touch-action:pan-y（D4：竖滚归还浏览器）");
  ok(!/\.arg-lyric-chip\{[^}]*touch-action:none/.test(html),
     "旧值 touch-action:none 已从 chip 规则移除");
  ok(html.indexOf(".arg-lyric-chip.sel{box-shadow:0 0 0 2px var(--blue)}") >= 0,
     "★ .sel 点按选中态规则存在（与 focus-visible 同色系）");
  ok(/@media \(max-width: 640px\)\{[\s\S]*?\.arg-lyric-barrow\{height:36px\}/.test(html),
     "★ 窄屏（≤640px）字块行高 36px（D4 触屏可达性）");
}
