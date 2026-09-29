/* BeatSight 自动化测试 · 批量平移 + 显性换位 + 窄块时值（v2.52.0 R2/D5）
   T123 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · shiftLyricChars（纯函数）：fromK 起（含）整组 t += delta；整组钳制（首字不早于
       0、末字 t+dur 不越段长）；钳后位移 0 → null（不落库、不动撤销栈）。
     · 一次批量 = 一步撤销（R2 核心：整组一次 lyricCommit，绝不逐字多次 commit）。
     · swapChars：k 与 k+1 交换时序——拖拽换位与「⇄ 与后字换位」按钮同一函数。
     · 范围二选一（全部字 / 从选中字）：会话内存态 shiftScope，跨渲染存活。
   桩口径：span = 192（一平方）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
/* v2.77.0：行容器包 [和弦格][字块行]——字块取行容器里的 barrow 孩子 */
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));
const miniByText = (ly, text) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.textContent === text);

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
  sumOf(lyOf(els, 0)).fire("click");
  return { beat, els, fireWin, arr, id: arr.id, uid: arr.sections[0].uid };
}
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};
const ts = cs => cs.map(c => c.t).join(",");

/* ================= 场景 T123a：shiftLyricChars 纯函数单测 ================= */
section("T123a 纯函数 · 整组平移 / 首字钳 0 / 末字段尾钳 / 钳后为 0 → null");
{
  const { beat } = setup();
  const sh = beat.Arrange.shiftLyricChars;
  ok(!!sh, "shiftLyricChars 已导出");
  const cs = [{ t: 24, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }];
  let out = sh(cs, 0, 12, 192);
  eq(ts(out), "36,108", "★ 整组 +1 格：两组字同时动");
  out = sh(cs, 0, -48, 192);                              // 首字 24 − 48 → 钳到 0（位移 −24）
  eq(ts(out), "0,72", "★ 首字钳 0：整组只移到头为止");
  out = sh(cs, 0, 200, 192);                              // 末字 96+24+200 越段长 → 钳到 +72
  eq(ts(out), "96,168", "★ 末字段尾钳：192 − (96+24) = +72");
  ok(sh([{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }], 0, -24, 192) === null,
     "★ 钳后位移 0 → null（首字已在 0，再左移到不了）");
  ok(sh([{ t: 180, dur: 12, ch: "尾" }], 0, 12, 192) === null,
     "★ 末字段尾钳满（180+12 = 192）→ null");
  /* 从选中字：fromK=1 → 首字不动 */
  out = sh([{ t: 24, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }], 1, 12, 192);
  eq(out[0].t, 24, "★ fromK 起（含）才动：前面字分毫不动");
  eq(out[1].t, 108, "后面的字动了");
  ok(sh([], 0, 12, 192) === null, "空字表 → null");
}

/* ================= 场景 T123b：按钮端到端 —— 全部字 / 从选中字 / 一步撤销 ================= */
section("T123b 批量按钮 · 一次点击 = 一步撤销 / 范围切换 / 到头不落库");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");  // 重渲染上轨
  const before = JSON.stringify(chars(beat, id, uid));

  /* 到头：全部字已在 0 起步，◀1拍 钳后位移 0 → null → 不落库、不产生撤销步 */
  miniByText(lyOf(els, 0), "◀1拍").fire("click");
  eq(JSON.stringify(chars(beat, id, uid)), before, "★ 到头：Store 分毫未动（null 不落库）");
  ok(beat.Arrange.lyricUndo(id, uid) === false, "★ 到头那次没有产生撤销步");

  miniByText(lyOf(els, 0), "1格▶").fire("click");         // 全部字 +1 格
  eq(ts(chars(beat, id, uid)), "12,60,108", "★ 全部字 +1 格：三组字同时动");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "undo 一步");
  eq(JSON.stringify(chars(beat, id, uid)), before, "★ 一次批量 = 一步撤销（整组一次提交）");
  beat.Arrange.lyricRedo(id, uid);

  /* 从选中字：点按选中第 2 字（k=1）→ 范围切「从选中字」→ +1 格只动后两字 */
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  chipsOf(lane)[1].fire("pointerdown", { clientX: 100 });
  fireWin("pointerup", {});
  miniByText(lyOf(els, 0), "从选中字").fire("click");     // 切范围（触发重渲染）
  miniByText(lyOf(els, 0), "1格▶").fire("click");
  eq(ts(chars(beat, id, uid)), "12,72,120", "★ 从选中字起平移：前面的字不动");
  ok(beat.Arrange.shiftScopeGet() === "sel", "范围态 = 从选中字");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "批量撤销仍是一步");
  eq(ts(chars(beat, id, uid)), "12,60,108", "回到平移前");
  beat.Arrange.close();
}

/* ================= 场景 T123c：⇄ 与后字换位 —— 与拖拽换位同结果 ================= */
section("T123c 显性换位 · ⇄ 按钮 = 拖拽换位同一函数 / 无选中指路 / 时值±1格钳制");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  const ly = lyOf(els, 0);

  /* 无选中：点击给指路、不动库 */
  miniByText(ly, "⇄ 与后字换位").fire("click");
  eq(ts(chars(beat, id, uid)), "0,96", "无选中：不动库");

  /* 点按选中第 1 字 → ⇄ → 春/眠 交换时序（与拖拽换位同一 swapChars） */
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  chipsOf(lane)[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointerup", {});
  miniByText(lyOf(els, 0), "⇄ 与后字换位").fire("click");
  const after = chars(beat, id, uid);
  eq(after[0].ch + "|" + after[0].t, "眠|0", "★ 换位：眠 接 春 的原位");
  eq(after[1].ch + "|" + after[1].t, "春|96", "★ 换位：春 落 眠 的原位（= 拖拽换位同结果）");

  /* 拖拽换位同路径回归（v2.50.0 已有，此处作为 swapChars 重构后的守卫）：
     拖「眠」向左推过「春」半程 → 换位 */
  const lane2 = byCls(lyOf(els, 0), "arg-lyric-lane");
  const cs2 = chipsOf(lane2);
  cs2[1].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 - 100 * (600 / 192) });
  fireWin("pointerup", {});
  const after2 = chars(beat, id, uid);
  eq(after2[0].ch + "|" + after2[1].ch, "春|眠", "★ 拖拽换位走同一 swapChars：换回来");

  /* 时值±1格：选中末字（眠@96，后无字 → lim = 192 段长）*/
  const lane3 = byCls(lyOf(els, 0), "arg-lyric-lane");
  chipsOf(lane3)[1].fire("pointerdown", { clientX: 100 });
  fireWin("pointerup", {});
  miniByText(lyOf(els, 0), "时值+1格").fire("click");
  eq(chars(beat, id, uid)[1].dur, 36, "★ 时值+1格：24 → 36");
  miniByText(lyOf(els, 0), "时值+1格").fire("click");
  eq(chars(beat, id, uid)[1].dur, 48, "再 +1 格：36 → 48");
  miniByText(lyOf(els, 0), "时值−1格").fire("click");
  miniByText(lyOf(els, 0), "时值−1格").fire("click");
  eq(chars(beat, id, uid)[1].dur, 24, "★ 时值−1格：48 → 36 → 24（连续两下）");
  beat.Arrange.close();
}
