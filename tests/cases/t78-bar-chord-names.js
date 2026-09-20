/* BeatSight 自动化测试 · 小节上方的和弦名（v2.7.4）
   T78 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍 + 用户原话）：「这部分的文案离扫弦和歌词区域太远了，把和弦名也
   显示在对应的小节上方。」——原先把和弦只写进段名，只出现在远端侧栏的「曲名 · 段名」
   里，弹唱时眼睛得在侧栏与扫弦/歌词区之间来回跳。

   契约：本工具**无和弦轨**，和弦寄生于段名（见 DEMO_SONG 注释）——
   段名格式 = 「<结构名> · <歌词首句> <和弦1>[·<和弦2>…]」，**一小节一个和弦**，
   和弦数 == secBars(段)。secChords 纯函数取段名尾部那一段记号，渲染层逐行把它挂到
   对应小节行上方（一行 = 一小节，故一行一颗）。窗口口径与 arrWindowPat/buildLyricLane
   同源：预告行（第 1 行）取 winPrevBar，其余行取 winStart+b。

   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const mkBars = (n, per) => Array.from({ length: n }, () =>
  Array.from({ length: per }, (_, i) => ({ t: 192 / per })));
/* 网格行 / 行内胶囊：与 t24/t70/t75 同一套类名定位手法 */
const rowEls = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const chordTexts = beat => (beat.Viz.internals().barChordEls || []).map(c => c ? c.textContent : null);
const chordClass = els => rowEls(els).map(r => {
  const c = r.children.find(x => /(^| )bar-chord( |$)/.test(x.className));
  return c ? c.textContent : null;
});
/* 推 n 个 0.02s：时钟 + 调度 + **渲染**（窗口和弦在渲染侧逐行画） */
function step(beat, ac, n){
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
  }
}
/* 两段曲式：A 用「四音型」（4 格/小节）×4 小节，B 用「八音型」（8 格/小节）×4 小节。
   段名尾部各带一串和弦 → 8 小节：0-3 = A 的和弦，4-7 = B 的和弦。240BPM 下一小节 1s */
function startTwoStages(loop){
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(4, 4) },
    { name: "八音型", meter: 4, bars: mkBars(4, 8) },
  ] }));
  const [p4, p8] = beat.Store.customs.slice(-2);
  const v = beat.Store.upsertArrange({ name: "和弦预告测试", sections: [
    { name: "A · 甲 C·Am·Dm·G", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
    { name: "B · 乙 Em·F·G·Am", blocks: [{ ref: { type: "custom", id: p8.id }, repeats: 1 }] },
  ] });
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 1, loop: !!loop };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last, v };
}

/* ================= 场景 T78a：secChords 纯函数 ================= */
section("T78a 段名解析 · secChords 取段名尾部的和弦序列（一小节一颗）");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  eq(JSON.stringify(beat.secChords("副歌 · 上 C·Am·Dm")), JSON.stringify(["C", "Am", "Dm"]),
     "★ 尾部以「·」分隔的和弦串逐颗解析（示例曲第 2 段）");
  eq(JSON.stringify(beat.secChords("主歌二 · 人静的雨夜 Am·Em·F·C·Am·Em")),
     JSON.stringify(["Am", "Em", "F", "C", "Am", "Em"]), "六和弦行完整解析");
  eq(beat.secChords("开头 · 我多想 C").join(), "C", "单和弦段");
  eq(JSON.stringify(beat.secChords("段 · 词 C#m·Bbm·G7")),
     JSON.stringify(["C#m", "Bbm", "G7"]), "带 #/b 后缀与延伸记号的和弦不被误过滤");
  eq(JSON.stringify(beat.secChords("就一个段名")), "[]", "无空格 → 无和弦");
  eq(JSON.stringify(beat.secChords("段 · 只有歌词 没有和弦")), "[]",
     "★ 尾段不以 A–G 开头 → 空（歌词里带空格也不会被误读成和弦）");
  eq(JSON.stringify(beat.secChords("")), "[]", "空串不抛");
  eq(JSON.stringify(beat.secChords(null)), "[]", "null 不抛");
  eq(JSON.stringify(beat.secChords(undefined)), "[]", "undefined 不抛");
}

/* ================= 场景 T78b：示例曲自洽 + 逐行渲染 ================= */
section("T78b 示例曲 · 每段和弦数 == 段长（一小节一颗），渲染逐行取对和弦");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  const a = beat.Store.findArrange(beat.DEMO_ID);
  /* 契约的硬约束（段名里的和弦数必须与段的小节数吻合），任何一处错位都会在这里现形 */
  eq(JSON.stringify(a.sections.map(s => beat.secChords(s.name).length)),
     JSON.stringify(a.sections.map(s => beat.secBars(s))),
     "★ 每段「和弦数 == 小节数」（示例曲 1/3/4/2/4/2/4/2/6/2）");
  /* 曲式模式载入示例并起播：窗口起点 = 歌曲第 1 小节 */
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: true };
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  step(beat, ac, 2);
  eq(JSON.stringify(chordTexts(beat)), JSON.stringify(["C", "C", "Am", "Dm"]),
     "★ 四行 = 歌曲第 0-3 小节的和弦（开头 C / 副歌上 C·Am·Dm）");
  eq(beat.Viz.internals().barChordEls.length, rowEls(els).length,
     "★ 胶囊数组与网格行逐位同构（无和弦的行存 null 占位）");
  eq(JSON.stringify(chordClass(els)), JSON.stringify(["C", "C", "Am", "Dm"]),
     "★ 每颗胶囊都挂在**对应小节行**内（不是别处）");
  beat.Controls.stop();
}

/* ================= 场景 T78c：预告行取下一小节的和弦 ================= */
section("T78c 翻页窗口 · ★ 页内第 4 小节的第 1 行（预告行）换下一小节的和弦");
{
  const { beat, els, ac } = startTwoStages(true);
  step(beat, ac, 2);
  eq(JSON.stringify(chordTexts(beat)), JSON.stringify(["C", "Am", "Dm", "G"]),
     "起点四行 = 歌曲第 0-3 小节和弦");
  step(beat, ac, 158);                             // ≈3.2s → 页内第 4 小节（末行）→ 预告生效
  eq(JSON.stringify(chordTexts(beat)), JSON.stringify(["Em", "Am", "Dm", "G"]),
     "★ 第 1 行换成**下一小节**的和弦 Em（与徽标/格子同源：走 winPrevBar，不是 k+1 之外的错位）");
  step(beat, ac, 60);                              // ≈4.4s → 翻页，预告内容原地转正
  eq(JSON.stringify(chordTexts(beat)), JSON.stringify(["Em", "F", "G", "Am"]),
     "★ 翻页后四行 = 歌曲第 4-7 小节和弦（B 段 Em·F·G·Am）");
  beat.Controls.stop();
}

/* ================= 场景 T78d：无和弦段不挂胶囊 ================= */
section("T78d 无和弦段 · 该段各行不挂胶囊（null 占位），不影响有和弦的段");
{
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(4, 4) },
  ] }));
  const p4 = beat.Store.customs.slice(-1)[0];
  const v = beat.Store.upsertArrange({ name: "半和弦测试", sections: [
    { name: "A · 甲 C·Am·Dm·G", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
    { name: "B · 乙", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
  ] });
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 1, loop: false };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  step(beat, ac, 2);
  eq(JSON.stringify(chordTexts(beat)), JSON.stringify(["C", "Am", "Dm", "G"]), "第 1 页 = A 段和弦");
  step(beat, ac, 210);                             // ≈4.24s → 翻到 B 段（段名无和弦序列）
  eq(JSON.stringify(chordTexts(beat)), JSON.stringify([null, null, null, null]),
     "★ B 段段名无和弦序列 → 四行都不挂胶囊（null 占位，保持与行逐位同构）");
  ok(rowEls(els).every(r => !r.children.some(c => /(^| )bar-chord( |$)/.test(c.className))),
     "行内确实没有 .bar-chord 元素");
  beat.Controls.stop();
}

/* ================= 场景 T78e：预设模式不生效 ================= */
section("T78e 预设模式 · 不挂和弦（和弦只在曲式模式的小节上有意义）");
{
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  eq(beat.Store.S.playMode, "preset", "前提：预设模式（默认）");
  const cc = beat.Viz.internals().barChordEls;
  eq(cc.length, rowEls(els).length, "胶囊数组与网格行同构（既有 4 行就有 4 个 null）");
  ok(cc.every(x => x === null), "★ 预设模式全部为 null（不挂胶囊）");
  ok(rowEls(els).every(r => !r.children.some(c => /(^| )bar-chord( |$)/.test(c.className))),
     "行内没有 .bar-chord");
}
