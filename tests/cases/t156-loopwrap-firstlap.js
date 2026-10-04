/* BeatSight 自动化测试 · 连续滚动「第一圈语义」（v3.0.1，用户拍板「未回卷前留空」）
   T156 系列。
   ---------------------------------------------------------------------------
   用户实拍 bug：连续滚动 + 循环开着时，《在他乡》刚一打开（还没播、更没循环过），
   曲首之上就挂着曲尾第 30 小节的歌词「（哭）出声响我多想」——看起来像刚播过这句。
   批 7 只处理了「无循环 ⇒ 留空」，而「循环开着 ⇒ 上方 = 上一圈末尾」被有意保留；
   但**第一圈还没走完**时，那份"上一圈"内容根本还没发生过。

   修复口径（本文件锁定的行为契约）：
     · 新增会话级回卷标记 loopWrapped：调度侧真的从范围末回卷到起点才置位；
       开播 / 停止 / 重锚 / 上下文重建清零。
     · scroll 下槽内容的判据：
         - 无 wrap（循环关）        → 曲首之上 / 曲尾之下留空（批 7 原口径，不变）；
         - 有 wrap 且 !loopWrapped → 范围起点**之前**（上一圈末尾）同样留空；
         - 有 wrap 且  loopWrapped → 照常折回（上一圈真的播过了）；
         - 范围末**之后**（下一圈开头）→ 任何时刻照常折回（那是即将发生的未来）。
     · 网格（arrWindowPat / presetWindowPat）、歌词行（buildLyricLane）、
       和弦胶囊（chordAtRow）共用 scrollWrapRange() 单一判据来源。

   载体：2 小节曲式（范围 [0,1]、循环开），两小节内容刻意不同：
     bar0 = 0 个休止 + 字「甲」；bar1 = 2 个休止 + 字「乙」。
   240BPM / 4-4 ⇒ 一小节 = 1s：t≈1.08 进 bar1，t≈2.08 回卷回 bar0。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

/* bar0：四拍全实（0 休止）；bar1：前 two 拍休止（2 休止）——同一型内两小节可区分 */
const PAT = { id: "p2", name: "两小节型", meter: 4, bars: [
  [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
  [{ t: 48, rest: true }, { t: 48, rest: true }, { t: 48 }, { t: 48 }],
] };
const seed = loop => ({
  "beatsight.customs": JSON.stringify({ v: 1, customs: [PAT] }),
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t1", name: "两小节曲", sections: [{ uid: "s1", name: "A",
      blocks: [{ ref: { type: "custom", id: "p2" }, repeats: 1 }] }] },
  ] }),
  "beatsight.lyrics": JSON.stringify({ v: 2, lines: [
    { arrangeId: "t1", secUid: "s1", chars: [
      { t: 0, dur: 24, ch: "甲" }, { t: 192, dur: 24, ch: "乙" }] },
  ] }),
  "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
    arrangeSel: { id: "t1", from: 0, to: 1, loop: loop },
    scrollMode: true, scrollRows: 3, showLyric: true }),
});

/* 装载 + 把范围钉成 [0,1] 循环（绕开存档迁移路径，与 t155f 同一手法） */
function boot(loop){
  const { beat, els } = loadApp(seed(loop));
  beat.Store.S.arrangeSel = { id: "t1", from: 0, to: 1, loop: loop, byLyric: false };
  beat.Viz.resetWindow();
  beat.Viz.buildViz();
  return { beat, els };
}
/* 逐帧驱动（0.04s/帧）：scheduler + 渲染帧同推 */
function seek(beat, ac, seconds){
  const n = Math.round(seconds / 0.04);
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.04;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (!beat.Store.S.playing) break;
  }
}
const int = beat => beat.Viz.internals();
const restCount = beat => int(beat).cellEls.map(cs => cs.filter(c => /(^| )rest( |$)/.test(c.className)).length);
const lyricText = beat => int(beat).lyricRows.map(r => r.chars.map(c => c.ch).join(""));

/* ================= T156a 第一圈（未回卷）：范围起点之前留空 ================= */
section("T156a 循环开着但还没回卷过：曲首之上留空（网格 + 歌词同行判据）");
{
  const { beat } = boot(true);
  eq(int(beat).scroll.winStart, -1, "前置：winStart = cur(0) − center(1) = −1（上槽 = 范围起点之前）");
  eq(restCount(beat).join(","), "0,0,2,0",
    "★ 四槽休止数 = [空, bar0=0, bar1=2, 折回bar0=0]：上槽留空而不是折回 bar1（缺陷版此处是 2）");
  eq(int(beat).cellEls[0].length, 0, "★ 上槽无格子（跑道仍在、格子无——与批 7 的 bars.push([]) 同款）");
  /* ★★ v3.33.2 口径变更（**这不是回归**）：末槽由「不存在」变成「与网格同槽」。
     修复前歌词只建 3 行（槽位数判据两份、歌词那份漏了多行档的 +1），而网格建 4 行——
     本文件下一行早就断言了 `cellEls[3].length > 0`（第 4 槽照常折回 bar0），
     歌词却没有第 4 槽可比：**同一屏里两轨槽数不同**本身就是那条用户报障的形状
     （进场行滑进来时没有词）。现两轨同源（slotRowCount），末槽 = 折回 bar0 的「甲」。 */
  eq(lyricText(beat).join("|"), "|甲|乙|甲",
    "★ 歌词行 = [空, 甲, 乙, 甲]：上方不挂「乙」（用户实拍：循环开着时开头是曲尾那句词）；末槽与网格同槽 = 折回 bar0");
  /* 对照面：范围末**之后**（下一圈开头）第一圈也照常折回——预告的是几秒后就要发生的未来 */
  ok(int(beat).cellEls[3].length > 0, "★ 第 4 槽（pos=2 = 范围末之后）照常折回 bar0（预告不空白）");
  beat.Controls.stop();
}

/* ================= T156b 真回卷过一次之后：折回内容照常出现 ================= */
section("T156b 回卷后：曲首之上 = 真的播过的上一圈末尾（bar1 + 乙）");
{
  const { beat } = boot(true);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* ★ bar1 刻意以两拍休止开头 ⇒ 它的首个**落地端点**在 1.08+0.5=1.58 才出现，
     可听小节号（audibleSongBar 按落地端点）t≈1.6 才翻到 1——探针实测，别按时钟拍脑袋。 */
  seek(beat, ac, 1.9);                                  // t≈1.9：第一圈 bar1 中（尚未回卷）
  eq(int(beat).scroll.cur, 1, "前置：第一圈正在播 bar1");
  /* 第一圈播 bar1 时，winStart=0：四槽 pos = 0..3，无「起点之前」的槽——折回只发生在末尾之后 */
  eq(restCount(beat).join(","), "0,2,0,2", "第一圈 bar1：槽 = [bar0, bar1, 折回bar0, 折回bar1]");
  seek(beat, ac, 0.8);                                  // t≈2.7：已回卷（t≈2.08），第二圈 bar0
  eq(int(beat).scroll.cur, 0, "前置：已回卷，第二圈回到 bar0");
  eq(restCount(beat).join(","), "2,0,2,0",
    "★ 回卷后四槽 = [折回bar1=2, bar0=0, bar1=2, 折回bar0=0]：上槽放出折回内容（loopWrapped 生效）");
  eq(lyricText(beat).join("|"), "乙|甲|乙|甲",
    "★ 回卷后歌词行 = [乙, 甲, 乙, 甲]：上方这回是真的刚唱过的那句；末槽折回 bar0（与网格 cellEls[3] 同槽）");
  beat.Controls.stop();
}

/* ================= T156c 停止 → 再开播：回到第一圈留空 ================= */
section("T156c 停止清零回卷标记：再开播首帧即收敛回「第一圈留空」");
{
  const { beat } = boot(true);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  seek(beat, ac, 2.7);                                  // 回卷过一次（loopWrapped=true）
  eq(restCount(beat)[0], 2, "前置：回卷后上槽是折回的 bar1");
  beat.Controls.stop();                                 // 标记清零（停止 = 回到"第一圈还没开始"）
  beat.Controls.start();
  seek(beat, ac, 0.2);                                  // 再开播的第一小节内
  eq(int(beat).scroll.cur, 0, "前置：新一轮从 bar0 起播");
  eq(int(beat).cellEls[0].length, 0,
    "★ 再开播后上槽重新留空——stop 清标记 + 首帧影子判据（loopWrapped≠已重建值）补重建");
  eq(lyricText(beat)[0], "", "★ 歌词行 0 同步留空");
  beat.Controls.stop();
}

/* ================= T156e 预设模式同判据：范围循环的第一圈语义 ================= */
section("T156e 预设 + 播放范围循环：第一圈留空 / 回卷后放出（presetWindowPat 同判据）");
{
  const res = [
    [0, 1, 2, 3].map(() => ({ t: 48 })),                                    // bar0：0 休止
    [{ t: 48, rest: true }, { t: 48, rest: true }, { t: 48 }, { t: 48 }],   // bar1：2 休止（开头休止 ⇒ 可听翻小节延后，同 T156b 注释）
  ];
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 240,
    scrollMode: true, scrollRows: 3, loopRange: { on: true, from: 0, to: 1 } }) });
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "两小节", meter: 4, bars: res }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  eq(beat.Store.S.loopRange.on, true, "前置：指定小节循环开着");
  beat.Viz.resetWindow();
  beat.Viz.buildViz();
  eq(restCount(beat).join(","), "0,0,2,0",
    "★ 预设+范围循环第一圈：四槽 = [空, bar0=0, bar1=2, 折回bar0=0]——上槽留空（缺陷版首槽是 2）");
  eq(int(beat).cellEls[0].length, 0, "★ 上槽无格子（presetWindowPat 的 bars.push([])）");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  seek(beat, ac, 2.7);                                  // t≈2.7：已回卷（t≈2.08，范围 [0,1]）
  eq(int(beat).scroll.cur, 0, "前置：回卷后回到 bar0");
  eq(restCount(beat).join(","), "2,0,2,0",
    "★ 回卷后四槽 = [折回bar1=2, bar0=0, bar1=2, 折回bar0=0]（loopNextBar 回跳置位 loopWrapped）");
  beat.Controls.stop();
}

/* ================= T156d 对照：循环关（批 7 原口径）一字未变 ================= */
section("T156d 对照：loop=false 时批 7 口径不变（曲首之上/曲尾之下都留空）");
{
  const { beat } = boot(false);
  eq(restCount(beat).join(","), "0,0,2,0",
    "★ loop 关：四槽 = [空, bar0, bar1, **空**]——曲尾之下同样留空（与循环开的折回预告相反）");
  eq(int(beat).cellEls[3].length, 0, "★ loop 关时第 4 槽（pos=2 ≥ 全曲片段数）无格子");
  eq(lyricText(beat).join("|"), "|甲|乙|",
    "loop 关：歌词行 [空, 甲, 乙, 空]——首尾都留空（与上面 cellEls[3].length === 0 同判据；v3.33.2 起两轨同槽数）");
  beat.Controls.stop();
}
