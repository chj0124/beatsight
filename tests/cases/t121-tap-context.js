/* BeatSight 自动化测试 · 打轴上下文 + 从第 k 字开打（v2.50.0 R4）
   T121 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 落配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · startTap 增可选参 k0（缺省 0）：tap.k = k0，**k0 之前的字原样保留**（t 不动；
       dur 收口仍从 0 扫——那是「不重叠」归一化不变量，不是改位）。
     · tapCtx：悬浮条显示当前字 ±2 字，当前字包【】，纯 textContent。
     · 打轴钮文案：selChip 属本段 → 「从第 N 字开打」（渲染时派生；点按选中经
       syncTapBtn 就地跟上——不进 arrangeRender，焦点不丢）。V8：播放仍从段首起。
     · V3（v2.49.0）：从第 k 字打轴同样整段 = 一步撤销（startTap 压一次快照）。
   桩口径：span = 192（一平方）。 */
"use strict";
const { loadApp, ok, eq, section, FakeAudioContext, drive } = require("../lib/harness");

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
    [{ t: 0, dur: 24, ch: "春" }, { t: 24, dur: 24, ch: "眠" }, { t: 48, dur: 24, ch: "不" },
     { t: 72, dur: 24, ch: "觉" }, { t: 96, dur: 24, ch: "晓" }, { t: 120, dur: 24, ch: "处" }]);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  return { beat, els, fireWin, arr, id: arr.id, uid: arr.sections[0].uid };
}
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};
const tapBtnOf = ly => ly.children.find(c => c.classList && c.classList.contains("arg-mini") &&
  c.getAttribute("aria-label") && c.getAttribute("aria-label").indexOf("跟播打轴") === 0);

/* ================= 场景 T121a：startTap(k0) —— 游标与保留字 ================= */
section("T121a 从第 k 字打轴 · tap.k = k0 / 前 k 字 t 原样 / 打完一步撤销");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  const before = JSON.parse(JSON.stringify(chars(beat, id, uid)));
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid), 5);
  ok(beat.Arrange.tapState() !== null, "进入打轴态");
  eq(beat.Arrange.tapState().k, 5, "★ tap.k = 5（从第 6 字开打）");
  eq(beat.Arrange.tapState().n, 6, "总字数不变");
  const kept = chars(beat, id, uid);
  for (let j = 0; j < 5; j++) eq(kept[j].t, before[j].t, "前 5 字 t 原样（j=" + j + "）");

  drive(FakeAudioContext.last, beat, 0.6);
  beat.Arrange.tapNow();
  ok(beat.Arrange.tapState() === null, "打到最后一字自动收");
  ok(chars(beat, id, uid)[5].t !== before[5].t, "第 6 字被重打");
  for (let j = 0; j < 5; j++) eq(chars(beat, id, uid)[j].t, before[j].t, "打完后前 5 字 t 仍原样（j=" + j + "）");

  ok(beat.Arrange.lyricUndo(id, uid) === true, "undo 成功");
  eq(JSON.stringify(chars(beat, id, uid)), JSON.stringify(before),
     "★ 一次 undo 回到打轴前（V3 事务对 k0 起打同样成立）");
  beat.Arrange.close();
}

/* ================= 场景 T121b：tapCtx 上下文预览 ================= */
section("T121b 打轴上下文 · 当前字包【】，前后各 2 字，纯 textContent");
{
  const { beat, els, arr, id, uid } = setup();
  beat.Arrange.tapStart(arr, arr.sections[0], beat.Store.findLyric(id, uid), 2);
  eq(els["tapCtx"].textContent, "春眠【不】觉晓", "★ k=2：前 2 字 + 【当前字】 + 后 2 字");
  drive(FakeAudioContext.last, beat, 0.6);
  beat.Arrange.tapNow();                                  // 打第 3 字 → k=3
  eq(beat.Arrange.tapState() && beat.Arrange.tapState().k, 3, "敲击推进到第 4 字");
  eq(els["tapCtx"].textContent, "眠不【觉】晓处", "★ 推进后窗口随 k 滑动");
  beat.Arrange.tapEnd();
  eq(els["tapBar"].hidden, true, "打轴收起（tapCtx 随悬浮条隐藏）");
  beat.Arrange.close();
}

/* ================= 场景 T121c：打轴钮文案随 selChip 派生 ================= */
section("T121c 从第 k 字开打 · 点按选中 → 钮文案就地更新 / 渲染回挂");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  let btn = tapBtnOf(lyOf(els, 0));
  eq(btn.textContent, "跟播打轴", "无选中：默认文案");

  /* 点按第 3 字（k=2）→ syncTapBtn 就地更新（不重渲染） */
  chipsOf(lane)[2].fire("pointerdown", { clientX: 100 });
  fireWin("pointerup", {});
  btn = tapBtnOf(lyOf(els, 0));
  eq(btn.textContent, "从第 3 字开打", "★ 点按选中后文案就地更新（零重渲染）");

  /* 下一次渲染（重开浮层）按 selChip 回挂同样成立 */
  beat.Arrange.close();
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  btn = tapBtnOf(lyOf(els, 0));
  eq(btn.textContent, "从第 3 字开打", "重渲染按 selChip 回挂（V5）");

  /* 点击该钮 → 从 k=2 起打 */
  const arr = beat.Store.arranges.find((/** @type {any} */ a) => a.id === id);
  btn.fire("click");
  ok(beat.Arrange.tapState() !== null && beat.Arrange.tapState().k === 2, "★ 点击即从第 3 字起打");
  beat.Arrange.tapEnd();
  beat.Arrange.close();
  void uid;
}
