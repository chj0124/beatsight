/* BeatSight 自动化测试 · 跨行缺口期歌词轨跟随歌曲时间推进
   T239 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍）：示例曲《在他乡》移动端，主歌二（P4×7）播放中——节奏型跑道的
   播放头已扫入后半片（动画过半），歌词跑道却整行滞留在前半片（"人静的"全亮、
   "雨夜"全灰），直到下一颗扫弦落地才跳行。桌面端正常。
   根因（类别错误）：paintLyric 的进度源复用了 audioPosAt 的 (bar, tib)——那是
   **扫弦 onset 落地**口径（onsetBuf 只装扫弦发声点，schedOneStep 仅在 !step.rest
   时入表），而节奏型跑道上根本没有「何时唱」的信息；歌词的时间权威是歌词数据
   自己的 {t, dur}。扫弦休止期 (bar, tib) 被钳在上一行行尾 ⇒ 歌词行归属滞留。
   窄屏 K=2 分片把 P4 后片行首 1.5 拍纯休止（格 8–13）变成跨行缺口才暴露；
   桌面 K=1 缺口在行内，bar/tib 的行内插值恰好等于真实时间位置，错误不显现。
   修法：paintLyric 改传 headBar/headTick（歌曲时间在（行, 行内 tick）上的连续
   位置——缺口期由 v2.43.0 的 sweep 给出，其余时刻与 bar/tib 恒等，scroll 模式
   下 headBar===bar 亦恒等）。格子填充 / 球维持 onset 口径不动（它们可视化的
   就是扫弦本身）。
   夹具：P4 状节奏型（发声格 0,3,4,5,6,14,15）× 2 小节，歌词复刻《在他乡》
   主歌二首小节（人@24 静@48 的@72 雨@96 夜@144）；BPM 240 ⇒ 48t = 0.25s、
   一片 96t = 0.5s。300px 行宽 ⇒ K=2（行 = 半小节）。
   反向验证锚点：paintLyric 调用点退回 (tib, …, bar) 后，T239b 必须具名变红。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const S16 = { t: 12 }, R16 = { t: 12, rest: true };
/* P4 状：发声格 0,3,4,5,6 / 14,15；格 8–13 = 后片行首 1.5 拍纯休止 */
const P4LIKE = [S16, R16, R16, S16, S16, S16, S16, R16,
                R16, R16, R16, R16, R16, R16, S16, S16];

function setupSong(beat){
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "行首休止型", meter: 4, bars: [P4LIKE] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t239", name: "缺口歌", sections: [
    { name: "A段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 2 }] },
  ] });
  const uid = beat.Store.findArrange("t239").sections[0].uid;
  beat.Store.upsertLyric("t239", uid, [
    { t: 24, dur: 24, ch: "人" }, { t: 48, dur: 24, ch: "静" }, { t: 72, dur: 24, ch: "的" },
    { t: 96, dur: 48, ch: "雨" }, { t: 144, dur: 48, ch: "夜" },
  ]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t239", from: 0, to: 1, loop: false };
  beat.Controls.setBpm(240);
}

/* 驱动 + 逐帧采样歌词轨状态；端点全程累积（union，同 T112 教训：onsetBuf 有修剪） */
function driveLyric(beat, ac, seconds){
  const samples = [], onsets = new Map();
  for (let i = 0; i < Math.round(seconds / 0.005); i++){
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.t.toFixed(4), { t: e.t, bar: e.bar, cumT: e.cumT }));
    const lr = beat.Viz.internals().lyricRows;
    const chip = (ri, ci) => (lr[ri] && lr[ri].chipEls[ci]) ? String(lr[ri].chipEls[ci].className) : "?";
    const fill = (ri, ci) => (lr[ri] && lr[ri].fillEls[ci]) ? String(lr[ri].fillEls[ci].style.transform) : "?";
    samples.push({
      now: ac.currentTime,
      cur: lr.findIndex(r => r.el.classList.contains("cur")),
      yu: chip(1, 0), ye: chip(1, 1), yuF: fill(1, 0),
      hd1: (lr[1] && lr[1].head) ? lr[1].head.style.display : "?",
      /* 宽屏对照用（K=1 时五个字全在第 0 行） */
      yu0: chip(0, 3), ye0: chip(0, 4), yuF0: fill(0, 3),
    });
    if (!beat.Store.S.playing) break;
  }
  return { samples, onsets: [...onsets.values()].sort((a, b) => a.t - b.t) };
}
const pick = (arr, lo, hi) => arr.filter(s => s.now > lo && s.now <= hi);
const findOn = (onsets, bar, cumT) => onsets.find(e => e.bar === bar && e.cumT === cumT);
const fillX = s => { const m = String(s).match(/scaleX\(([\d.]+)\)/); return m ? Number(m[1]) : -1; };

section("T239a 前提 · K=2 分片下歌词按片分行（雨/夜在后片行，行内偏移重基到片起点）");
{
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ vizRows: 4 }) }, { rowW: 300 });
  setupSong(beat);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveLyric(beat, ac, 0.3);
  beat.Controls.stop();
  const iv = beat.Viz.internals();
  eq(iv.vizRowBeats, 2, "300px + 十六分密度 ⇒ 每行 2 拍（K=2）");
  const lr = iv.lyricRows;
  eq(lr.length, 4, "歌词轨 4 行（2 小节 × 2 片，与网格同档）");
  ok(lr[0].chars.length === 3 && lr[0].chars[0].ch === "人", "前片行 = 人静的");
  ok(lr[1].chars.length === 2 && lr[1].chars[0].ch === "雨" && lr[1].chars[1].ch === "夜",
     "后片行 = 雨夜（与移动端截图的两行一致）");
  eq(lr[1].chars[0].lt, 0, "「雨」行内偏移 0（片起点 = 它的谱面起点 t=96）");
  eq(lr[1].chars[1].lt, 48, "「夜」行内偏移 48（t=144）");
}

section("T239b 核心 · 扫弦休止缺口期歌词按自己的时间轴推进（不滞留前片行）");
{
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ vizRows: 4 }) }, { rowW: 300 });
  setupSong(beat);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = driveLyric(beat, ac, 3.0);
  beat.Controls.stop();
  const L0 = findOn(onsets, 0, 72), F1 = findOn(onsets, 0, 168);
  ok(!!L0 && !!F1, "前置：采到 L0（前片末音 格6@72）与 F1（后片首音 格14@168）");
  const boundary = L0.t + 0.125;              // 片边界 = 96t = 0.5 拍后
  ok(Math.abs(F1.t - boundary - 0.375) < 0.02, "前置：缺口 = 1.5 拍（0.375s，格 8–13 纯休止）");
  /* ① 缺口前段（行内 tick ≈ 12–38）：当前行已是后片行，「雨」按谱面开唱并填充 */
  const gapA = pick(samples, boundary + 0.06, boundary + 0.20);
  ok(gapA.length > 10, `前置：缺口前段采到 ${gapA.length} 帧`);
  ok(gapA.every(s => s.cur === 1),
     "★★ 缺口期歌词当前行 = 后片行（旧口径钉在前片行，此处必红）");
  ok(gapA.every(s => /(^| )on( |$)/.test(s.yu)),
     "★★ 「雨」在缺口期按时开唱（on）——它的 t=96 正是片边界，不等扫弦落地");
  ok(gapA.every(s => { const x = fillX(s.yuF); return x > 0.05 && x < 0.95; }),
     "★ 「雨」的白色填充在缺口期渐进（scaleX 介于 0–1 之间）");
  ok(gapA.every((s, i) => i === 0 || fillX(s.yuF) >= fillX(gapA[i - 1].yuF) - 0.001),
     "★ 填充单调前进（不回跳）");
  ok(gapA.every(s => !/(^| )(on|played)( |$)/.test(s.ye)),
     "★ 「夜」还没到它的谱面时刻（t=144），保持未唱态");
  ok(gapA.every(s => s.hd1 !== "none"),
     "★ 歌词走带线落在后片行（不再绕回前片行行首——v3.34.4 的次生怪相随根因消失）");
  /* ② 缺口后段（行内 tick ≈ 52–69）：「雨」唱完转 played，「夜」接棒 on */
  const gapB = pick(samples, boundary + 0.27, boundary + 0.36);
  ok(gapB.length > 5, `前置：缺口后段采到 ${gapB.length} 帧`);
  ok(gapB.every(s => s.cur === 1 && /(^| )played( |$)/.test(s.yu)),
     "★★ 「雨」在自己的 dur（48t）唱完后转 played——全程与扫弦 onset 无关");
  ok(gapB.every(s => /(^| )on( |$)/.test(s.ye)),
     "★★ 「夜」在 t=144 按时开唱（此刻下一颗扫弦 格14@168 仍未发声）");
  /* ③ 转正后：扫弦落地，歌词态连续（无跳变回退） */
  const post = pick(samples, F1.t + 0.005, F1.t + 0.05);
  ok(post.length > 2 && post.every(s => s.cur === 1 && /(^| )on( |$)/.test(s.ye)),
     "★ 扫弦落地后歌词态连续（当前行不变、「夜」继续唱）");
}

section("T239c 对照 · 宽屏 K=1 行为逐位不变（桌面本无 bug，修复不许动它）");
{
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ vizRows: 4 }) }, { rowW: 600 });
  setupSong(beat);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = driveLyric(beat, ac, 3.0);
  beat.Controls.stop();
  const iv = beat.Viz.internals();
  eq(iv.vizRowBeats, 4, "600px ⇒ 整小节一行（K=1）");
  const lr = iv.lyricRows;
  ok(lr[0].chars.length === 5 && lr[0].chars[3].ch === "雨" && lr[0].chars[3].lt === 96,
     "前置：K=1 下五个字同在一行，「雨」行内偏移 96");
  const L0 = findOn(onsets, 0, 72);
  ok(!!L0, "前置：采到 L0（格6@72）");
  /* 缺口在**行内**：tick 96–168 间 bar/tib 本来就是时间的线性插值——
     这里断言的是「修复后桌面路径逐位不变」：雨在 t≈106–125 窗口内 on 且填充渐进 */
  const win = pick(samples, L0.t + 0.18, L0.t + 0.28);
  ok(win.length > 10, `前置：行内缺口窗口采到 ${win.length} 帧`);
  ok(win.every(s => s.cur === 0 && /(^| )on( |$)/.test(s.yu0)),
     "★ K=1：「雨」在行内缺口期照常 on（当前行不变）");
  ok(win.every(s => { const x = fillX(s.yuF0); return x > 0.05 && x < 0.95; })
     && win.every((s, i) => i === 0 || fillX(s.yuF0) >= fillX(win[i - 1].yuF0) - 0.001),
     "★ K=1：「雨」填充渐进且单调（与修复前逐位一致）");
}

section("T239d 源码级 · 进度源换绑的防复活钉子");
{
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "index.html"), "utf8");
  ok(src.includes("paintLyric(headTick, audK, arrCur, headBar)"),
     "★ paintLyric 的进度源 = headBar/headTick（歌曲时间），回退成 (tib, …, bar) 即复活 bug");
  ok(!src.includes("paintLyric(tib, audK, arrCur, bar)"),
     "★ 旧的 onset 落地口径调用已移除（防复活）");
}
