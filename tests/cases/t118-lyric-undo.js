/* BeatSight 自动化测试 · 歌词撤销/重做（v2.49.0 R1）
   T118 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · 唯一写入口 lyricCommit：写库前快照现值压 undo 栈；no-op（现值与新值逐位相同）
       不压栈；任何新提交清空 redo。快照口径：无行 = "[]"（applyLyricSnap 对空数组
       走 deleteLyric，两态同归宿）。
     · V1 会话内存栈（不落盘）；V2 每击键 = 一步；V3 整段打轴 = 一步（startTap 压一次
       快照，tapNow 逐敲落库不压栈）；HIST_MAX = 50，超限裁头部。
     · ★ 任何提交/撤销都会 arrangeRender 重建元素——按钮与行引用**每次现取**，不缓存。
   桩口径：span = 192（一平方），perTick = 600/192 = 3.125。 */
"use strict";
const { loadApp, ok, eq, section, FakeAudioContext, drive } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
/* v2.77.0：行容器包 [和弦格][字块行]——字块取行容器里的 barrow 孩子 */
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));
const miniByAria = (ly, frag) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.getAttribute("aria-label") &&
  c.getAttribute("aria-label").indexOf(frag) >= 0);
const undoBtnOf = els => miniByAria(lyOf(els, 0), "撤销第 1 段");
const redoBtnOf = els => miniByAria(lyOf(els, 0), "重做第 1 段");

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
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                      // 展开歌词编辑区
  return { beat, els, fireWin, arr, id: arr.id, uid: arr.sections[0].uid };
}
/* 粘贴：每次现取粘贴框（提交触发 arrangeRender，旧引用失效） */
function paste(els, text){
  const box = byCls(lyOf(els, 0), "arg-lyric-paste");
  box.value = text;
  box.fire("change");
}
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};

/* ================= 场景 T118a：粘贴 → undo → 无词态 → redo → 词回来 ================= */
section("T118a 粘贴撤销 · undo 回到无词态 / redo 恢复 / 按钮置灰随栈长切换");
{
  const { beat, els, id, uid } = setup();
  paste(els, "春眠不觉");
  eq(undoBtnOf(els).disabled, false, "提交后撤销可用");
  eq(redoBtnOf(els).disabled, true, "提交后重做置灰（无 redo）");
  ok(!!chars(beat, id, uid) && chars(beat, id, uid).length === 4, "4 字落库");

  undoBtnOf(els).fire("click");
  eq(chars(beat, id, uid), null, "★ undo 后段回到无词态（findLyric 为 null）");
  eq(redoBtnOf(els).disabled, false, "undo 后重做可用");
  redoBtnOf(els).fire("click");
  ok(!!chars(beat, id, uid) && chars(beat, id, uid).length === 4, "★ redo 后词回来");
  eq(redoBtnOf(els).disabled, true, "redo 消费完置灰");
  beat.Arrange.close();
}

/* ================= 场景 T118b：no-op 不压栈；拖动提交 → undo 复原 / redo ================= */
section("T118b 拖动撤销 · 原地松手（吸附回原位）不入栈 / 拖后 undo 逐位复原");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");  // 收起再展开：按新词重渲染
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chip0 = chipsOf(lane)[0];
  const before = JSON.stringify(chars(beat, id, uid));

  /* no-op：拖 +5 tick（15.6px 过阈），吸附 round(5/12)=0 → 原位 → 不压栈。
     此时栈为空，undo 返回 false 即证明 no-op 没有入栈 */
  chip0.fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 5 * (600 / 192) });
  fireWin("pointerup", {});
  eq(chars(beat, id, uid)[0].t, 0, "no-op 拖动：t 不变");
  ok(beat.Arrange.lyricUndo(id, uid) === false, "★ no-op（原地松手）不压栈：undo 空栈返回 false");

  /* 真拖：+41 tick → 磁吸 48 → 提交 → undo 逐位复原 → redo 回提交态 */
  const chip0b = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[0];
  chip0b.fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 41 * (600 / 192) });
  fireWin("pointerup", {});
  eq(chars(beat, id, uid)[0].t, 48, "拖动提交 t=48");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "undo 成功");
  eq(JSON.stringify(chars(beat, id, uid)), before, "★ undo 后逐位复原");
  ok(beat.Arrange.lyricRedo(id, uid) === true, "redo 成功");
  eq(chars(beat, id, uid)[0].t, 48, "redo 回到提交态");
  beat.Arrange.close();
}

/* ================= 场景 T118c：键盘微调 V2 粒度 —— ←×3 = 三步撤销 ================= */
section("T118c 键盘粒度 · 每击键 = 一步（连按 3 次撤 3 次，逐步回退）");
{
  const { beat, els, id, uid } = setup();
  beat.Store.upsertLyric(id, uid, [{ t: 96, dur: 24, ch: "春" }, { t: 150, dur: 24, ch: "眠" }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");  // 重渲染上轨
  const chip0 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[0];
  chip0.fire("keydown", { key: "ArrowLeft" });
  chip0.fire("keydown", { key: "ArrowLeft" });
  chip0.fire("keydown", { key: "ArrowLeft" });
  eq(chars(beat, id, uid)[0].t, 60, "←×3：96 → 60（每击 -1 格，原位更新不重渲染）");

  ok(beat.Arrange.lyricUndo(id, uid) === true, "第 1 次 undo");
  eq(chars(beat, id, uid)[0].t, 72, "★ 逐步回退：60 → 72");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "第 2 次 undo");
  eq(chars(beat, id, uid)[0].t, 84, "★ 72 → 84");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "第 3 次 undo");
  eq(chars(beat, id, uid)[0].t, 96, "★ 84 → 96（回到起点）");
  ok(beat.Arrange.lyricUndo(id, uid) === false, "栈空返回 false");
  beat.Arrange.close();
}

/* ================= 场景 T118d：打轴事务 V3 —— 整段打轴 = 一次 undo ================= */
section("T118d 打轴事务 · startTap 压一次快照 / 逐敲不压栈 / 一次 undo 回打轴前");
{
  const { beat, els, arr, id, uid } = setup();
  const sec = arr.sections[0];
  const before = [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }];
  beat.Store.upsertLyric(id, uid, JSON.parse(JSON.stringify(before)));

  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  ok(beat.Arrange.tapState() !== null, "进入打轴态");
  drive(FakeAudioContext.last, beat, 0.6);                // onset 端点落地
  beat.Arrange.tapNow();
  beat.Arrange.tapNow();
  beat.Arrange.tapNow();
  ok(beat.Arrange.tapState() === null, "打完自动收");
  ok(JSON.stringify(chars(beat, id, uid)) !== JSON.stringify(before),
     "打轴改写了时刻（前提自检）");

  ok(beat.Arrange.lyricUndo(id, uid) === true, "undo 成功");
  eq(JSON.stringify(chars(beat, id, uid)), JSON.stringify(before),
     "★ 一次 undo 回到打轴前（V3：整段打轴 = 一步，逐敲不压栈）");
  beat.Arrange.close();
}

/* ================= 场景 T118e：清除 → undo 恢复整行 ================= */
section("T118e 清除撤销 · 清除 = 空数组提交 / undo 恢复全部字（含 t/dur）");
{
  const { beat, els, id, uid } = setup();
  const before = [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }];
  beat.Store.upsertLyric(id, uid, JSON.parse(JSON.stringify(before)));
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");  // 重渲染上轨
  const clr = miniByAria(lyOf(els, 0), "清除第 1 段");
  ok(!!clr && clr.disabled === false, "清除钮上轨且可用");
  clr.fire("click");
  eq(chars(beat, id, uid), null, "清除后无词");
  undoBtnOf(els).fire("click");
  eq(JSON.stringify(chars(beat, id, uid)), JSON.stringify(before), "★ undo 恢复整行（t/dur 逐位）");
  beat.Arrange.close();
}

/* ================= 场景 T118f：栈超 50 步头部被裁 ================= */
section("T118f 栈上限 · HIST_MAX=50 / 超限裁头部（最早一步不可达）");
{
  const { beat, els, id, uid } = setup();
  for (let i = 0; i < 60; i++) paste(els, "字" + i);      // 60 次提交（值各不同，全部入栈）
  let undos = 0;
  while (beat.Arrange.lyricUndo(id, uid) === true) undos++;
  eq(undos, 50, "★ 60 次提交只可撤 50 步（头部被裁）");
  /* 裁掉的是最早 10 步：50 步撤到底 = 回到第 10 次提交后的状态（「字9」），
     而不是无词态——无词态那一步已被裁出栈 */
  const rest = chars(beat, id, uid);
  ok(!!rest && rest.length === 2 && rest[0].ch === "字" && rest[1].ch === "9",
     "★ 栈底 = 第 10 次提交后的状态（无词快照已被裁掉）");
  beat.Arrange.close();
}

/* ================= 场景 T118g：新提交清空 redo（栈分叉即作废） ================= */
section("T118g redo 清场 · undo 后新提交 → redo 置灰");
{
  const { beat, els, id, uid } = setup();
  paste(els, "春眠");
  eq(redoBtnOf(els).disabled, true, "初始无 redo");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "undo 一步");
  eq(chars(beat, id, uid), null, "回到无词态");
  eq(redoBtnOf(els).disabled, false, "undo 后重做可用");
  paste(els, "不觉晓");                                   // 新提交（分叉）
  eq(chars(beat, id, uid).length, 3, "新词落库");
  eq(redoBtnOf(els).disabled, true, "★ 新提交清空 redo（按钮置灰）");
  ok(beat.Arrange.lyricRedo(id, uid) === false, "redo 空栈返回 false");
  beat.Arrange.close();
}
