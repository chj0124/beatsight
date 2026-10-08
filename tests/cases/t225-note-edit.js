/* BeatSight 自动化测试 · 音符块交互（v3.38.0 批 2）
   T225 系列。
   ---------------------------------------------------------------------------
   编排页编辑轨的「独立音符块」从显示-only 升级为**可编辑**：点按选中（selNote，
   与 selChip 互斥）、拖拽移动（段界钳 + onset 磁吸 + 6t 吸附 + 邻音重叠预检）、
   键盘 ←/→ 移起点、Shift+←/→ 改时值、Del/Backspace 删除。全部走 lyricCommit 唯一写入口
   （行级快照 + no-op 不压栈 + redo 清空），每击键/每次拖动 = 一步 undo，cue 不响。
   ★ 两条硬不变量：notechip **不进 chipEls**（与字块下标严格对齐的那份，掺入即错位）；
     音符锚在格上、**不随字移动**——交互只改音符 t/dur（p 改走贴谱），挪字不动谱。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const hasCls = (el, cls) => new RegExp("(^| )" + cls + "( |$)").test(el.className || "");
const collect = (root, pred) => {
  const out = [];
  (function walk(n){ for (const c of (n.children || [])){ if (pred(c)) out.push(c); walk(c); } })(root);
  return out;
};
const collectNotes = root => collect(root, c => hasCls(c, "notechip"));
const collectChips = root => collect(root, c => hasCls(c, "arg-lyric-chip") && !hasCls(c, "notechip"));
const findCls = (root, cls) => collect(root, c => hasCls(c, cls))[0] || null;
const btnByText = (root, txt) => (root.children || []).find(c => c.textContent === txt);
const fireUndo = els => btnByText(lyOf(els, 0), "↩ 撤销").fire("click");
const laneOf = els => byCls(lyOf(els, 0), "arg-lyric-lane");
const px = n => n * (600 / 192);                            // 桩行宽 600 / 段长 192 = 每 tick px
const rerender = els => { sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click"); };

/* 夹具（t223 同款）：一个 4/4 段（span=192t）+ 打开编排页并展开歌词编辑区 */
function fixture(chars, notes){
  const app = loadApp();
  const { beat, els } = app;
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材T", meter: 4, bars: [[{ t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }]] },
  ] })).ok, "素材型导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式T", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                       // 展开歌词编辑区
  beat.Store.upsertLyric(arr.id, arr.sections[0].uid, chars || [], { notes: notes || [] });
  rerender(els);
  return Object.assign(app, { id: arr.id, uid: arr.sections[0].uid, arr: arr });
}

/* ============ T225a：选中（点按 / 重渲染存留 / 越界清空 / 与字块互斥） ============ */
section("T225a 选中音符 · 点按 → .sel / 重渲染存留 / notes 变短清空 / 与字块互斥");
{
  const app = fixture([], [{ t: 0, dur: 24, p: 60 }, { t: 48, dur: 24, p: 62 }]);
  const { els, id, uid, beat } = app;
  let chips = collectNotes(laneOf(els));
  eq(chips.length, 2, "前提：两颗独立音符块");
  chips[0].fire("pointerdown", { clientX: 100 });
  app.fireWin("pointerup", {});
  ok(hasCls(chips[0], "sel"), "★★ 点按（未过阈）= 选中，.sel 挂上");

  rerender(els);
  chips = collectNotes(laneOf(els));
  ok(hasCls(chips[0], "sel"), "★★ 重渲染后选中存留（元素换新，.sel 按 selNote 回挂）");

  chips[1].fire("pointerdown", { clientX: 100 });
  app.fireWin("pointerup", {});
  ok(hasCls(chips[1], "sel") && !hasCls(chips[0], "sel"), "★ 改选第二颗：旧选中摘除");

  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 0, dur: 24, p: 60 }] });   // notes 变短
  rerender(els);
  ok(!collectNotes(laneOf(els)).some(c => hasCls(c, "sel")), "★★ notes 变短（q 越界）→ 选中清空");
  beat.Arrange.close();

  /* 互斥：带字 + 独立音符的行 */
  const app2 = fixture([{ t: 0, dur: 48, ch: "啊" }], [{ t: 96, dur: 24, p: 62 }]);
  const e2 = app2.els;
  const nc = collectNotes(laneOf(e2)), cc = collectChips(laneOf(e2));
  eq(nc.length, 1, "前提：一颗独立音符");
  eq(cc.length, 1, "前提：一个字块");
  nc[0].fire("pointerdown", { clientX: 100 }); app2.fireWin("pointerup", {});
  ok(hasCls(nc[0], "sel"), "音符选中");
  cc[0].fire("pointerdown", { clientX: 100 }); app2.fireWin("pointerup", {});
  ok(hasCls(cc[0], "sel") && !hasCls(nc[0], "sel"), "★★ 点字块 → 音符选中让位（互斥）");
  app2.beat.Arrange.close();
}

/* ============ T225b：键盘（←/→ 改起点 / Shift 改时值 / Del 删除 + 逐步 undo） ============ */
section("T225b 键盘 · ←/→ 移起点 6t / Shift 改时值 / Del 删除 / 连击逐步 undo");
{
  const app = fixture([], [{ t: 48, dur: 24, p: 60 }]);
  const { beat, els, id, uid } = app;
  let chips = collectNotes(laneOf(els));
  chips[0].fire("pointerdown", { clientX: 100 }); app.fireWin("pointerup", {});
  eq(beat.Store.findLyric(id, uid).notes[0].t, 48, "前提：起点 48");

  chips[0].fire("keydown", { key: "ArrowLeft" });
  chips = collectNotes(laneOf(els));
  eq(beat.Store.findLyric(id, uid).notes[0].t, 42, "★ ← 一格 = 6t：48 → 42");
  chips[0].fire("keydown", { key: "ArrowLeft" });
  chips = collectNotes(laneOf(els));
  eq(beat.Store.findLyric(id, uid).notes[0].t, 36, "★ ←×2 = 48 − 12");
  ok(hasCls(chips[0], "sel"), "★ 键盘微调后仍选中（重渲染回挂）");

  chips[0].fire("keydown", { key: "ArrowRight", shiftKey: true });
  chips = collectNotes(laneOf(els));
  eq(beat.Store.findLyric(id, uid).notes[0].dur, 30, "★ Shift+→：dur 24 → 30");

  fireUndo(els);
  eq(beat.Store.findLyric(id, uid).notes[0].dur, 24, "★ undo 一步：dur 回到 24");
  fireUndo(els);
  eq(beat.Store.findLyric(id, uid).notes[0].t, 42, "★ 再 undo 一步：起点回到 42（逐步，不合并）");

  chips = collectNotes(laneOf(els));
  chips[0].fire("keydown", { key: "Delete" });
  eq(beat.Store.findLyric(id, uid), null, "★★ Del 删唯一音符：词谱双空 → 行删除（走同一道门）");
  fireUndo(els);
  eq(beat.Store.findLyric(id, uid).notes.length, 1, "★ undo 恢复被删音符");
  eq(beat.Store.findLyric(id, uid).notes[0].t, 42, "★ 恢复的是删除前那颗（42）");
  beat.Arrange.close();
}

/* ============ T225c：拖拽（6t 吸附纯函数 / 磁吸 / 气泡 / pointercancel 无残留） ============ */
section("T225c 音符拖拽 · noteDropTarget 段界钳+6t+磁吸+重叠 / 气泡 / cancel 摘净");
{
  const { beat } = loadApp();
  const J = x => JSON.stringify(x);
  eq(J(beat.noteDropTarget([{ t: 0, dur: 24, p: 60 }], 0, 192, 50, null)),
    J({ t: 48, blocked: false, blockerIdx: -1 }), "★★ 50 → 48（6t 格吸附）");
  eq(beat.noteDropTarget([{ t: 0, dur: 24, p: 60 }], 0, 192, -10, null).t, 0, "★ 段界左钳 → 0");
  eq(beat.noteDropTarget([{ t: 0, dur: 24, p: 60 }], 0, 192, 500, null).t, 168, "★ 段界右钳 → span−dur = 168");
  eq(beat.noteDropTarget([{ t: 0, dur: 24, p: 60 }], 0, 192, 50, [48]).t, 48, "★★ 半拍内 onset 磁吸优先于格吸附");
  const r = beat.noteDropTarget([{ t: 0, dur: 24, p: 60 }, { t: 48, dur: 24, p: 62 }], 0, 192, 48, null);
  ok(r.blocked && r.blockerIdx === 1, "★★ 落点与另一颗重叠 → blocked + 指名 blocker（编辑路径不靠 norm 吞）");

  const app = fixture([], [{ t: 0, dur: 24, p: 60 }]);
  const { els, id, uid, beat: b2 } = app;
  let chips = collectNotes(laneOf(els));
  chips[0].fire("pointerdown", { clientX: 100, clientY: 0, pointerId: 1 });
  app.fireWin("pointermove", { clientX: 100 + px(48), clientY: 0, pointerId: 1 });
  const bub = findCls(laneOf(els), "arg-lyric-bubble");
  ok(!!bub, "★★ 拖拽中建读数气泡");
  ok(/\d+ 小节 · 第 \d+ 拍 · 时值 \d+ 格/.test(bub.textContent),
    "★★ 气泡文本格式（小节/拍/时值格）：" + JSON.stringify(bub.textContent));
  app.fireWin("pointerup", {});
  eq(b2.Store.findLyric(id, uid).notes[0].t, 48, "★ 松手提交：落点 48（磁吸命中 onset）");

  chips = collectNotes(laneOf(els));
  chips[0].fire("pointerdown", { clientX: 100, clientY: 0, pointerId: 2 });
  app.fireWin("pointermove", { clientX: 100 + px(72), clientY: 0, pointerId: 2 });
  ok(!!findCls(laneOf(els), "arg-lyric-bubble"), "前提：cancel 前气泡在");
  app.fireWin("pointercancel", {});
  ok(!findCls(laneOf(els), "arg-lyric-bubble"), "★★ pointercancel 摘气泡无残留");
  eq(b2.Store.findLyric(id, uid).notes[0].t, 48, "★ cancel 不提交（Store 停在 48）");
  app.beat.Arrange.close();
}

/* ============ T225d：重叠守卫（拖进邻音 → 拒绝 / Store 零变化 / announce） ============ */
section("T225d 重叠守卫 · 拖进邻音 span → 拒绝、Store 逐位零变化、有 announce");
{
  const app = fixture([], [{ t: 0, dur: 24, p: 60 }, { t: 48, dur: 24, p: 62 }]);
  const { beat, els, id, uid } = app;
  const before = JSON.stringify(beat.Store.findLyric(id, uid).notes);
  const chips = collectNotes(laneOf(els));
  chips[0].fire("pointerdown", { clientX: 100, clientY: 0, pointerId: 1 });
  app.fireWin("pointermove", { clientX: 100 + px(48), clientY: 0, pointerId: 1 });
  ok(hasCls(chips[0], "blocked"), "★★ 落点重叠 → .blocked 可见反馈");
  app.fireWin("pointerup", {});
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), before,
    "★★ 拒绝后 Store 逐位零变化（拖动 ≠ 静默丢音）");
  ok((els["srAnnounce"].textContent || "").indexOf("重叠") >= 0, "★ announce 说明「互不重叠，先挪开它」");
  beat.Arrange.close();
}

/* ============ T225e：undo（拖 / 键盘 两来源各撤销一步，行级快照无半态） ============ */
section("T225e undo · 来源各撤销一步回原样；行级快照 = 字谱同回");
{
  const app = fixture([{ t: 0, dur: 48, ch: "啊" }], [{ t: 96, dur: 24, p: 62 }]);
  const { beat, els, id, uid } = app;
  const c0 = JSON.stringify(beat.Store.findLyric(id, uid).chars);
  const n0 = JSON.stringify(beat.Store.findLyric(id, uid).notes);
  let chips = collectNotes(laneOf(els));
  chips[0].fire("pointerdown", { clientX: 100, clientY: 0, pointerId: 1 });
  app.fireWin("pointermove", { clientX: 100 + px(24), clientY: 0, pointerId: 1 });
  app.fireWin("pointerup", {});
  ok(beat.Store.findLyric(id, uid).notes[0].t !== 96, "前提：音符被拖动");
  fireUndo(els);
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), n0, "★★ 拖拽撤销：音符回原位");
  eq(JSON.stringify(beat.Store.findLyric(id, uid).chars), c0, "★★ 且字形逐位不变（行级快照无半态）");

  chips = collectNotes(laneOf(els));
  chips[0].fire("keydown", { key: "ArrowLeft" });
  ok(beat.Store.findLyric(id, uid).notes[0].t === 90, "前提：键盘微调 96 → 90");
  fireUndo(els);
  eq(beat.Store.findLyric(id, uid).notes[0].t, 96, "★★ 键盘撤销回到 96");
  beat.Arrange.close();
}

/* ============ T225f：隔离护栏（notechip 计数 / 不掺 chipEls / 可键盘） ============ */
section("T225f 隔离 · notechip 独立成组、chipEls 恒等字数 / role=button + tabIndex");
{
  const app = fixture(
    [{ t: 0, dur: 24, ch: "一" }, { t: 24, dur: 24, ch: "二" }, { t: 48, dur: 24, ch: "三" }],
    [{ t: 96, dur: 24, p: 62 }, { t: 120, dur: 24, p: 64 }]);
  const { els, uid, beat } = app;
  const lane = laneOf(els);
  eq(collectChips(lane).length, 3, "★★ 字块数 = 字数（notechip 不掺入）");
  eq(collectNotes(lane).length, 2, "★ 独立音符块 2 颗");
  const lc = beat.Arrange.laneCounts(uid);
  ok(!!lc, "前提：本段轨道在读表里（laneCounts 可用）");
  eq(lc ? lc.chips : -1, 3, "★★ chipEls 长度 = 字数（notechip 不进 chipEls）");
  eq(lc ? lc.notes : -1, 2, "★★ noteEls 长度 = 独立音符数");
  const nc = collectNotes(lane);
  ok(nc[0] ? nc[0].tabIndex === 0 : false, "★ notechip 可聚焦（tabIndex = 0）");
  eq(nc[0] ? nc[0].getAttribute("role") : "(无)", "button", "★ role = button（从 img 升级，可键盘）");
  ok(nc[0] ? (nc[0].getAttribute("aria-label") || "").indexOf("方向键移动") >= 0 : false, "★ aria 补操作提示");
  app.beat.Arrange.close();
}

/* ============ T225g：词谱独立（挪音符不动字 / 挪字不动谱） ============ */
section("T225g 词谱独立 · 挪音符不动字 / 挪字不动谱（B 期语义锁定）");
{
  const app = fixture([{ t: 0, dur: 48, ch: "啊" }], [{ t: 96, dur: 24, p: 62 }]);
  const { beat, els, id, uid } = app;
  const chars0 = JSON.stringify(beat.Store.findLyric(id, uid).chars);
  let nc = collectNotes(laneOf(els));
  nc[0].fire("keydown", { key: "ArrowRight" });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).chars), chars0, "★★ 挪音符：字逐位不变");

  const notes0 = JSON.stringify(beat.Store.findLyric(id, uid).notes);
  const cc = collectChips(laneOf(els));
  cc[0].fire("keydown", { key: "ArrowRight" });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), notes0, "★★ 挪字：谱逐位不变");
  beat.Arrange.close();
}
