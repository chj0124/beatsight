/* BeatSight 自动化测试 · 原速就地试听 + 播放游标（v2.51.0 R3）
   T122 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · V6：试听 = 单段循环 + 原速 + **不动 S.trainer**（与「循环本行」的变速爬坡并存、
       语义分开）；浮层保持打开；arrangeSel = { loop:true, byLyric:false }。
     · 互斥：打轴 ↔ 试听（startTap 经 close → previewStop；tap 期 previewSection 拒绝）。
     · 位置原语单一事实源：试听游标与打轴落点共用 sectionPosTicks——游标另写一套
       插值就是两份真相（同源断言钉住）。
     · 游标 = 蓝竖线（段内小节行内 left 百分比、跨行跳行）+ 当前字 .cur
       （判据 t ∈ [c.t, c.t+dur)，与主视图播放头同构）。rAF 自续；桩直接调函数。
   桩口径：span = 192（一平方），barTicks = 192，secBars = 1。 */
"use strict";
const { loadApp, ok, eq, section, FakeAudioContext, drive } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => r.children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className))));
const inLane = (lane, cls) => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => (r.children || []).filter(c => new RegExp("(^| )" + cls + "( |$)").test(c.className))));
const miniByAria = (ly, frag) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.getAttribute("aria-label") &&
  c.getAttribute("aria-label").indexOf(frag) === 0);

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
    [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }]);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  return { beat, els, fireWin, arr, id: arr.id, uid: arr.sections[0].uid };
}
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};

/* ================= 场景 T122a：试听装配 —— arrangeSel / trainer 不动 / 钮态 ================= */
section("T122a 试听装配 · 单段循环 + byLyric:false + S.trainer.on 零改动 + ■ 钮态");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  const trainerOn0 = beat.Store.S.trainer.on;             // 前提：默认关（无论如何记初值）
  beat.Arrange.previewSection(arr, 0, sec, 0);
  const sel = beat.Store.S.arrangeSel;
  eq(sel.id, id, "arrangeSel 指向本曲式");
  eq(sel.from, 0, "from = 段首");
  eq(sel.to, 0, "to = 段尾（单小节段）");
  eq(sel.loop, true, "★ 单段循环");
  eq(sel.byLyric, false, "★ byLyric:false（与打轴的 byLyric:true 语义分开）");
  eq(beat.Store.S.trainer.on, trainerOn0, "★ S.trainer.on 不被改动（V6 核心回归）");
  eq(beat.Store.S.playing, true, "试听即起播");
  ok(beat.Arrange.previewState() !== null, "preview 态立起");
  eq(miniByAria(lyOf(els, 0), "停止试听第 1 段").textContent, "■ 停止试听", "钮切 ■ 态");
  beat.Arrange.close();
}

/* ================= 场景 T122b：互斥 —— 试听 ↔ 打轴 ================= */
section("T122b 互斥 · 试听中打轴先停试听 / 打轴期试听被拒");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  beat.Arrange.previewSection(arr, 0, sec, 0);
  ok(beat.Arrange.previewState() !== null, "试听中");
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  ok(beat.Arrange.tapState() !== null, "进入打轴");
  eq(beat.Arrange.previewState(), null, "★ 试听先停（经 close → previewStop）");
  beat.Arrange.tapEnd();

  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  beat.Arrange.previewSection(arr, 0, sec, 0);
  eq(beat.Arrange.previewState(), null, "★ 打轴期试听被拒（防御分支）");
  beat.Arrange.tapEnd();
  beat.Arrange.close();
}

/* ================= 场景 T122c：游标与当前字高亮（同源一致性） ================= */
section("T122c 游标 · 位置走 sectionPosTicks / left 与 .cur 同源 / 从选中字起播");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  beat.Arrange.previewSection(arr, 0, sec, 0);
  drive(FakeAudioContext.last, beat, 0.6);                // 推进：onset 端点落地 + 时钟前进
  beat.Arrange.syncPreviewCursor();                       // 桩无 rAF：直接调
  const pos = beat.Arrange.sectionPosTicks(id, uid, sec);
  ok(pos !== null && pos > 0, "段内位置可读（端点驱动）");
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const cursor = inLane(lane, "arg-lyric-cursor")[0];
  ok(!!cursor && cursor.hidden === false, "游标上轨且可见");
  const row = Math.min(0, Math.floor(pos / 192));
  const expLeft = (pos - row * 192) / 192 * 100 + "%";
  eq(cursor.style.left, expLeft, "★ 游标 left = sectionPosTicks 的换算值（同一位置源）");
  const cs = chars(beat, id, uid);
  let hitK = -1;
  for (let k = 0; k < cs.length; k++){
    if (pos >= cs[k].t && pos < cs[k].t + cs[k].dur){ hitK = k; break; }
  }
  const chips = chipsOf(lane);
  for (let k = 0; k < chips.length; k++){
    eq(/(^| )cur( |$)/.test(chips[k].className), k === hitK,
       "★ .cur 恰落在 t∈[c.t,c.t+dur) 的字上（k=" + k + "）");
  }

  /* 从选中字起播：点按选中第 2 字（t=48 → 段内 0 小节）→ 单小节段落点仍是段首 */
  chips[1].fire("pointerdown", { clientX: 100 });
  els["arrangeOverlay"].fire("pointerup", {});
  miniByAria(lyOf(els, 0), "从选中的字起播第 1 段").fire("click");
  eq(beat.Store.S.arrangeSel.from, 0, "从选中字起播 = 段首 + ⌊t/barTicks⌋（粗到小节）");
  beat.Arrange.close();
}

/* ================= 场景 T122d：关浮层 → 试听停、游标摘 ================= */
section("T122d 收尾 · close 停试听 / 游标 hidden");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  beat.Arrange.previewSection(arr, 0, sec, 0);
  drive(FakeAudioContext.last, beat, 0.4);
  beat.Arrange.syncPreviewCursor();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const cursor = inLane(lane, "arg-lyric-cursor")[0];
  ok(!!cursor, "游标在");
  beat.Arrange.close();
  eq(beat.Arrange.previewState(), null, "★ 关浮层 = 试听停");
  eq(cursor.hidden, true, "★ 游标摘除（hidden）");
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                      // 重开浮层折叠态重置：重新展开
  eq(miniByAria(lyOf(els, 0), "试听第 1 段").textContent, "▶ 试听本段", "重开浮层钮态还原");
  beat.Arrange.close();
}

/* ================= 场景 T122e：位置原语同源 —— tapPosTicks ≡ sectionPosTicks ================= */
section("T122e 同源断言 · 打轴与试听同一位置源");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  drive(FakeAudioContext.last, beat, 0.6);
  const p1 = beat.Arrange.tapPosTicks(sec);
  const p2 = beat.Arrange.sectionPosTicks(id, uid, sec);
  ok(p1 !== null, "打轴位置可读");
  eq(p1, p2, "★ 同输入同输出（tapPosTicks 委托 sectionPosTicks，无第二套插值）");
  beat.Arrange.tapEnd();
  beat.Arrange.close();
}
