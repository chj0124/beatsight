/* BeatSight 自动化测试 · 歌词跟随条预备拍预览（v2.85.0，fix ①）
   T150 系列。
   ---------------------------------------------------------------------------
   契约（与 index.html paintFollow / paintFrameBody 注释同源）：
     · 原 bug：开播后预备拍动画期间（curIdx=-1），歌词跟随条不显示，
       要等正式开唱（curIdx 翻 0）才出现——与节奏条不同步。
     · v2.85.0（①）：paintFollow 在预备拍窗（ciBeats>0 && ctx.currentTime<ciEnd）内
       对 curIdx=-1 强制 previewing=true，借第 0 行字块渲染（全「-」未唱态），
       让跟随条与节奏条同时出现；同时在 paintFrameBody 的预备拍分支里**驱动 paintLyric**，
       否则该分支早退、paintFollow 永远到不了（这是上一轮实现漏掉的关键一环）。
   基准：自定义「歌词曲」（1 段 2 字），与 T149 同一套种子。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "歌词曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL(1, 1)] }] },
]}) });
const seedState = ci => JSON.stringify(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 0, loop: true },
    countIn: { on: ci, beats: 4 }, lyricFollow: true });

function app(countInOn){
  const a = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState(countInOn) }));
  const beat = a.beat;
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Store.S.lyricFollow = true;
  beat.Viz.buildViz();
  return a;
}

section("T150a 预备拍预览 · curIdx=-1 时跟随条显示第 0 行（fix ① 正向）");
{
  const { beat } = app(true);
  beat.Controls.start();                       // 开预备拍 → ciBeats=4, ciEnd=第一可听小节
  const follow = beat.Viz.internals().lyricFollowEl;
  beat.Viz.paintLyric(0, -1, undefined, -1);   // 复刻预备拍帧（可听位置 = -1）
  ok(!follow.hidden, "★ 预备拍中（curIdx=-1）→ 跟随条已显示（与节奏条同时出现）");
  eq(beat.Viz.internals().followRow, 0, "★ 预览锁定到当前行 0（借第 0 行字块）");
  const chips = follow.children.filter(c => /(^| )lyric-chip( |$)/.test(c.className));
  eq(chips.length, 1, "★ 预览渲染出第 0 行字块（你）");
  ok(chips.every(c => !/(^| )played( |$)/.test(c.className) && !/(^| )on( |$)/.test(c.className)),
    "★ 预览态字块全未唱（无 played/on，不抢跑）");
  beat.Controls.stop();
}

section("T150b 对照 · 无预备拍时 curIdx=-1 不预览（不抢跑，回归护栏）");
{
  const { beat } = app(false);
  beat.Store.S.countIn = { on: false, beats: 0 };   // 关预备拍 → ciBeats=0
  beat.Viz.buildViz();
  beat.Controls.start();
  const follow = beat.Viz.internals().lyricFollowEl;
  beat.Viz.paintLyric(0, -1, undefined, -1);
  ok(follow.hidden, "★ 无预备拍时 curIdx=-1 → 跟随条仍隐藏（不提前冒出）");
  beat.Controls.stop();
}

section("T150c 端到端 · 真实帧驱动下预备拍期间跟随条也出现（paintFrameBody 已驱动 paintLyric）");
{
  const { beat } = app(true);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const follow = beat.Viz.internals().lyricFollowEl;
  let seen = false;
  const dt = 0.02;
  for (let i = 0; i < 12; i++){           // ~0.24s，远在 4 拍预备拍（1s @240BPM）内
    ac.currentTime += dt;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (!follow.hidden) seen = true;
  }
  ok(seen, "★ 真实帧驱动下，预备拍期间跟随条由 paintFrame 渲染出来（fix ① 端到端）");
  beat.Controls.stop();
}
