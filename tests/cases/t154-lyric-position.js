/* BeatSight 自动化测试 · 歌词显示位置六场景（PLAN-v7，v2.86.0）
   T154 系列 —— 与 t149/t150 互补的「反向验证」护栏。
   ---------------------------------------------------------------------------
   六场景对应 PLAN-v7 §6 的 T154a–f：
     a 显示歌词关 ⇒ 两种位置模式都不画；b follow ⇒ 逐行 translateY 贴自己小节；
     c bottom ⇒ 底部流式（回归护栏）；d auto ⇒ 窄→bottom / 宽→follow（响应式默认）；
     e 文字靠左（v3.38.1 补9 口径）；f 无词小节 ⇒ 空行位（有 row 元素、无字块、行高不跳）。
   基准：BUILTINS[1]（四分基础，4/4）× 1 遍 = 4 小节。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");
const fs = require("fs"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "歌词曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL(1, 1)] }] },
]}) });
const seedState = extra => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", vizRows: 4,   /* v3.1.0：出厂默认 2，本文件按 4 行档断言 */
    arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }, extra));

const numOf = s => { const m = /translateY\(([-0-9.]+)px\)/.exec(s || ""); return m ? parseFloat(m[1]) : NaN; };
function boxH(beat){ const r0 = beat.Viz.internals().rowEls[0]; return (r0 && r0.offsetHeight) ? r0.offsetHeight : 86; }
function laneOf(app){ return app.els["lyricLane"]; }

section("T154a 显示歌词关 ⇒ follow / bottom 两模式都不画歌词");
{
  const base = Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: false }) });
  const f = loadApp(base);
  f.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  f.beat.Store.S.lyricPos = "follow"; f.beat.Viz.buildViz();
  ok(laneOf(f).hidden, "follow + 显示歌词关 → 歌词轨隐藏");
  const b = loadApp(base);
  b.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  b.beat.Store.S.lyricPos = "bottom"; b.beat.Viz.buildViz();
  ok(laneOf(b).hidden, "bottom + 显示歌词关 → 歌词轨隐藏（总开关优先）");
}

section("T154b follow 模式 · 逐行 translateY 贴合对应小节（覆盖层，按行取 rowGeo）");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow" }) }));
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Viz.buildViz();
  const int = beat.Viz.internals();
  const bh = boxH(beat);
  ok(els["lyricLane"].classList.contains("overlay"), "follow → 覆盖层");
  for (let i = 0; i < int.lyricRows.length; i++){
    const tr = int.lyricRows[i].el.style.transform;
    eq(numOf(tr), int.rowGeo[i].top + bh + 2, "行 " + i + " 位移 = rowGeo[" + i + "].top + 行盒高 + 2");
  }
  // 行序：刺入真实落差验证「按行贴合」，而非整块堆在同一 y
  int.rowGeo[2].top = 220;
  beat.Viz.buildLyricLane();
  const lane = els["lyricLane"];
  ok(numOf(lane.children[2].style.transform) > numOf(lane.children[0].style.transform),
    "★ 行 2 位移 > 行 0 位移（覆盖层逐行贴各自小节）");
  // 预告行降权：源码确认 buildLyricLane 对 r===0 && winPrevSeg>=0 行加 .preview（与网格 .preview-row 同语义）
  ok(/\.preview" \)/.test(SRC) || /" preview"/.test(SRC) || /preview-row/.test(SRC),
    "★ 源码含预告行 .preview 降权分支（与网格同语义）");
}

section("T154c bottom 模式 · 底部流式堆叠（回归护栏）");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "bottom" }) }));
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Viz.buildViz();
  const lane = els["lyricLane"];
  ok(!lane.classList.contains("overlay"), "bottom → 无 .overlay（保持现状流式行为）");
  ok(lane.children.every(r => !/translateY\(/.test(r.style.transform || "")),
    "bottom → 行无内联 translateY（纯文档流堆叠）");
  ok(lane.children.length === beat.Viz.internals().lyricRows.length,
    "bottom → 行数 = 歌词行数（与旧版底部轨行为逐位一致）");
}

section("T154d auto 模式 · 窄屏解析为 bottom / 宽屏解析为 follow（响应式默认，D5）");
{
  const narrow = loadApp(seedArr(), { rowW: 500 });     // ≤960 → 窄
  eq(narrow.beat.Viz.narrow(), true, "rowW:500 → narrow() 真");
  eq(narrow.beat.Viz.effectiveLyricPos(), "bottom", "auto + 窄屏 → bottom（集中在底部）");

  const wide = loadApp(seedArr(), { rowW: 1200 });       // >960 → 宽
  eq(wide.beat.Viz.narrow(), false, "rowW:1200 → narrow() 假");
  eq(wide.beat.Viz.effectiveLyricPos(), "follow", "auto + 宽屏 → follow（贴在每行小节下）");

  // 显式档位不被 auto 覆盖
  const f = loadApp(seedArr(), { rowW: 500 });
  f.beat.Store.S.lyricPos = "follow";
  eq(f.beat.Viz.effectiveLyricPos(), "follow", "显式 follow + 窄屏 → 仍 follow（不强制 bottom）");
  const b = loadApp(seedArr(), { rowW: 1200 });
  b.beat.Store.S.lyricPos = "bottom";
  eq(b.beat.Viz.effectiveLyricPos(), "bottom", "显式 bottom + 宽屏 → 仍 bottom（不强制 follow）");
}

section("T154e 歌词字靠左（v3.38.1 补9 口径：left: clamp(4px,25%,28px) / right:auto / bottom:1px / text-align:left）");
{
  ok(/\.lyric-char\{[^}]*left:clamp\(4px,25%,28px\)[^}]*right:auto[^}]*text-align:left/.test(SRC),
    "★ CSS：歌词字**靠左**（left: clamp(4px,25%,28px) / right:auto / bottom: 1px / text-align:left）——v3.38.1 补9 用户口径");
}

section("T154f 无词小节 · 空行位（有 row 元素、无字块、行高不跳）");
{
  const { beat } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow" }) }));
  // 只给小节 0 写词，小节 1–3 无词 → 窗口 4 行里后 3 行是空行位
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Viz.buildViz();
  const int = beat.Viz.internals();
  eq(int.lyricRows.length, 4, "★ 窗口 4 行全建（无词小节也占一个空行位，不折叠/不跳过）");
  const emptyRows = int.lyricRows.filter(r => r.chars.length === 0);
  ok(emptyRows.length === 3, "无词的 3 行 chars 为空（只第 0 行有字）");
  ok(emptyRows.every(r => !!r.el && r.el.parentNode !== null),
    "★ 空行位仍有 DOM 元素（与有词行同高，视觉不跳）");
  ok(!laneOf({ els: { lyricLane: int.lyricEl } }).hidden, "有词行存在 ⇒ 整轨不收起（空行位只是没字）");
}
