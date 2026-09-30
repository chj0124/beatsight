/* BeatSight 自动化测试 · 预备拍期间歌词可见（PLAN-v7，v2.86.0）
   T150 系列 —— 取代旧「歌词跟随条预备拍预览」（v2.85.0 ①）。
   ---------------------------------------------------------------------------
   契约（与 index.html paintFrameBody 注释同源）：
     · 旧 bug（v2.85.0 修的）：开播预备拍期间跟随条不显。新模型下「开局猝不及防」由
       位置模式本身覆盖——follow 模式小节 1 歌词恒在小节 1 下（含预备拍），bottom 模式
       底部轨恒显；删掉旧的 paintFollow 预览特判后该需求不回退。
     · 此用例只验「预备拍期间歌词轨确实在、且第 1 行有内容」，不依赖任何跟随条特判。
   基准：自定义「歌词曲」（1 段 2 字），与 T149 同一套种子。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "歌词曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL(1, 1)] }] },
]}) });
const seedState = ci => JSON.stringify(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 0, loop: true },
    countIn: { on: ci, beats: 4 }, showLyric: true, lyricPos: "follow" });

function app(countInOn, pos){
  const a = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState(countInOn) }));
  const beat = a.beat;
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Store.S.lyricPos = pos;
  beat.Viz.buildViz();
  return a;
}

section("T150a 伴随模式 · 预备拍前（构建即显）小节 1 歌词就在小节 1 下");
{
  const { beat, els } = app(true, "follow");
  const lane = els["lyricLane"];
  ok(!lane.hidden, "★ follow 模式构建后歌词轨即显示（含预备拍窗口）");
  ok(lane.classList.contains("overlay"), "follow 模式 → 覆盖层");
  const row0 = lane.children[0];
  const chips0 = row0.children.filter(c => /(^| )lyric-chip( |$)/.test(c.className));
  eq(chips0.length, 1, "★ 行 0（小节 1）字块 = 1（你）——预备拍即见，不待正式开唱");
  ok(/translateY\(/.test(row0.style.transform), "行 0 已贴到小节 1 下缘（覆盖层定位生效）");
}

section("T150b 底部模式 · 预备拍前底部轨即显（现状回归护栏）");
{
  const { beat, els } = app(true, "bottom");
  const lane = els["lyricLane"];
  ok(!lane.hidden, "★ bottom 模式构建后底部轨即显示（含预备拍窗口）");
  ok(!lane.classList.contains("overlay"), "bottom 模式 → 仍底部流式");
  const row0 = lane.children[0];
  const chips0 = row0.children.filter(c => /(^| )lyric-chip( |$)/.test(c.className));
  eq(chips0.length, 1, "★ 底部轨行 0 字块 = 1（你）——底部轨预备拍恒显");
}

section("T150c 端到端 · 真实帧驱动下预备拍期间歌词轨保持可见（覆盖层不丢）");
{
  const { beat, els } = app(true, "follow");
  beat.Controls.start();                       // 开预备拍 → ciBeats=4
  const ac = FakeAudioContext.last;
  const lane = els["lyricLane"];
  let seen = false, row0HasChip = false;
  const dt = 0.02;
  for (let i = 0; i < 12; i++){           // ~0.24s，远在 4 拍预备拍（1s @240BPM）内
    ac.currentTime += dt;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (!lane.hidden) seen = true;
    if (lane.children[0] && lane.children[0].children.some(c => /(^| )lyric-chip( |$)/.test(c.className))) row0HasChip = true;
  }
  ok(seen, "★ 真实帧驱动下，预备拍期间歌词覆盖层由 paintFrame 维持可见");
  ok(row0HasChip, "★ 预备拍期间小节 1 字块始终在（与节奏条同时出现）");
  beat.Controls.stop();
}

section("T150d 对照 · 显示歌词关时预备拍也不画（总开关优先）");
{
  const { beat, els } = app(true, "follow");
  beat.Store.S.showLyric = false;
  beat.Viz.buildViz();
  ok(els["lyricLane"].hidden, "显示歌词关 + 预备拍 → 歌词轨仍隐藏（总开关优先级最高）");
}
