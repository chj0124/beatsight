/* BeatSight 自动化测试 · v2.7.1 双声部打通 + 歌词/计数器可听域对齐
   T76 系列。
   ---------------------------------------------------------------------------
   两条用户实拍各对应一半：

   ① 「扫弦轨上把『节拍』拉到 0 就全静默、『扫弦』滑条怎么调都不影响声音」
     → 根因：双声部此前有两个未声明的前提——音色不是鼓组（playClick 的 zone 分支对
       drum 整体除外）、谱面带 zone 字段（内置「民谣扫弦」只有 dir 没有 zone）。
     → 契约：凡带扫弦记谱（dir 或 zone）的发声音符都归扫弦声部（S.strumVol）——
       dir-only 的格按中弦区发声；鼓组下扫弦格仍选鼓件、但音量走 strumVol。
       三种音色下「节拍拉 0 扫弦照响、扫弦拉 0 节拍照响」都成立。

   ② 「歌词都在『再回到她的』前后，小球位置却相差很多」
     → 根因：paintLyric 的段/小节号读调度游标（arrSec/arrBar，比发声早一个前瞻
       窗口），小节内 tick 读可听位置（audioPosAt）——两个时间域拼在一起，每逢
       小节/段边界前那一小段，歌词提前跳到下一小节/段。「第 N 段 · 第 M 小节」
       计数器与段序条高亮同属此类。
     → 契约：这三处的段/小节号一律取可听域（Viz.audibleArrangePos，与播放头/
       弹跳球/网格窗口同源）；调度游标越界、可听位置未越界时，呈现不许先跳。

   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, drive, driveFrames, ok, eq, near, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 扫弦轨 + 无扫弦记谱的基底选择（idx 1 四分基础）——场景里再 import 自己的谱 */
const loadStrum = extra => loadApp(seedState(Object.assign(
  { track: "strum", sel: { type: "builtin", idx: 1 } }, extra || {})));
const clicksOf = ac => ac.hits.filter(h => h.kind === "osc");
const strumsOf = ac => ac.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass"
  && [700, 1400, 2800].includes(h.filterFreq));
/* 与 t68 同一形状的对照谱：带 dir 不带 zone（= 内置「民谣扫弦」的形状），每拍一记实扫 */
const mkDirNoZone = () => [0,1,2,3].map(() => [
  { t: 48, dir: "D" }, { t: 48, dir: "D" }, { t: 48, dir: "U" }, { t: 48, dir: "U" },
]);
function startWith(beat, name, bars, opts){
  const o = opts || {};
  beat.Store.importPresets(JSON.stringify({ presets: [{ name, meter: 4, bars }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  if (typeof o.bpm === "number") beat.Controls.setBpm(o.bpm);
  if (typeof o.vol === "number") beat.Store.S.vol = o.vol;
  if (typeof o.strumVol === "number") beat.Store.S.strumVol = o.strumVol;
  beat.Controls.start();
  return FakeAudioContext.last;
}

/* ================= 场景 T76a：dir-only 谱的「扫弦」滑条真的管用 ================= */
section("T76a 双声部打通 · 纯方向谱（民谣扫弦形状）归扫弦声部");
{
  /* 默认开局就是用户实拍的那条路径：扫弦轨 + 民谣扫弦（dir-only）+ 电子音色 */
  const { beat } = loadApp();
  eq(beat.Store.S.track, "strum", "前提：默认轨 = 扫弦轨（民谣扫弦反推）");
  beat.Store.S.vol = 0;                               // 「节拍」拉到 0
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1.2);
  beat.Controls.stop();
  const strums = strumsOf(ac);
  ok(strums.length > 0, "★ 节拍=0 时扫弦照响（v2.7.1 前：纯方向谱全走节拍声部，这里一声不出）");
  ok(strums.every(h => h.filterFreq === 1400), "dir-only 的格按中弦区发声（1400Hz，与「省略 zone = 中弦区」同契）");
  ok(strums.every(h => h.gain > 1), "扫弦声部增益满格（strumVol=1 × tier × makeup 8）");
  ok(clicksOf(ac).every(h => h.gain < 0.001), "节拍=0 → 网格拍点静音（包络兜底 0.0001）");

  /* 反向：「扫弦」拉到 0，节拍器照响 */
  const { beat: b2 } = loadApp();
  b2.Store.S.strumVol = 0;
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  drive(ac2, b2, 1.2);
  b2.Controls.stop();
  ok(clicksOf(ac2).length > 0 && clicksOf(ac2).every(h => h.gain > 0.1),
     "★ 扫弦=0 时节拍声部照响（网格拍点增益 = vol × tier）");
  ok(strumsOf(ac2).every(h => h.gain < 0.01), "扫弦=0 → 扫弦声部静音");
}

/* ================= 场景 T76b：鼓组音色下扫弦格走 strumVol ================= */
section("T76b 双声部打通 · 鼓组音色不再绕过扫弦声部");
{
  /* 鼓组 + 扫弦轨 + 带 zone 的谱：扫弦格按层级选鼓件（不叠弦区频段），音量走 strumVol。
     稀疏扫弦谱：拍 0 实扫（低弦区）+ 拍 1 空扫 + 拍 2 实扫（高弦区），其余纯休止 */
  const sparse = [0,1,2,3].map(() => Array.from({ length: 16 }, (_, i) =>
    i === 0 ? { t: 12, dir: "D", zone: 0 }
    : i === 4 ? { t: 12, rest: true, dir: "D" }
    : i === 8 ? { t: 12, dir: "U", zone: 2 }
    : { t: 12, rest: true }));
  const run = (vol, strumVol) => {
    const { beat } = loadStrum({ timbre: "drum" });
    const ac = startWith(beat, "鼓组稀疏扫弦", sparse, { vol, strumVol });
    drive(ac, beat, 2.2);
    beat.Controls.stop();
    return ac;
  };
  /* 拍 0 上叠着两声底鼓：扫弦格（strumVol × accentGain）与网格拍点（vol × accentGain） */
  const A = run(0.8, 1);
  const kicks0 = A.hits.filter(h => h.kind === "osc" && h.sweepTo === 50 && Math.abs(h.t - 0.08) < 1e-6);
  eq(kicks0.length, 2, "鼓组下拍 0 = 扫弦底鼓 + 网格底鼓同刻叠加（双声部并列）");
  const gains = kicks0.map(h => h.gain).sort((a, b) => a - b);
  near(gains[0], 0.8, 1e-6, "网格拍点底鼓 = vol(0.8) × accentGain(1)");
  near(gains[1], 1, 1e-6, "★ 扫弦底鼓 = strumVol(1) × accentGain(1)——鼓组下扫弦格走 strumVol");

  /* 用户的实拍场景：鼓组下把「节拍」拉 0 */
  const Z = run(0, 1);
  const zk0 = Z.hits.filter(h => h.kind === "osc" && h.sweepTo === 50 && Math.abs(h.t - 0.08) < 1e-6);
  eq(zk0.length, 2, "节拍=0：拍 0 仍有两声底鼓（声部结构不变）");
  ok(zk0.some(h => h.gain > 0.9), "★ 节拍=0 时鼓组下的扫弦照响（v2.7.1 前：全静默）");
  ok(Z.hits.filter(h => Math.abs(h.t - 0.705) < 1e-6).every(h => h.gain < 0.01),
     "节拍=0 → 网格拍点（拍 2 军鼓）静音");

  /* 鼓组下扫弦格不叠弦区频段（鼓件自带频段分工，设计不变） */
  ok(strumsOf(A).length === 0, "鼓组下不出现弦区带通噪声（zone 只选声部音量）");
}

/* ================= 场景 T76c：歌词轨与计数器不抢先于声音跳段 ================= */
section("T76c 可听域对齐 · 调度越界 ≠ 可听越界，歌词/计数器不许先跳");
{
  /* 两段各 1 小节的曲式（240BPM → 1 小节 1s）：段 A 歌词「一」、段 B 歌词「二」。
     调度游标比发声早一个前瞻窗口（0.3s）：currentTime ≈ 0.9 时调度器已排完段 A、
     游标已进段 B，但**可听**位置还在段 A 末尾——这正是用户截图 2 捕获的那一瞬间 */
  const { beat, els } = loadStrum();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一板", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t76", name: "两段歌", sections: [
    { name: "A段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "B段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] });
  beat.Store.upsertLyric("t76", 0, [{ t: 0, dur: 24, ch: "一" }]);
  beat.Store.upsertLyric("t76", 1, [{ t: 0, dur: 24, ch: "二" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t76", from: 0, to: 1, loop: false };
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const chipTexts = () => beat.Viz.internals().lyricChipEls.map(c => c.children[1].textContent).join("");

  /* 驱动到 currentTime ≈ 0.9：调度游标已越过段边界（排到了 1.2s 之后），
     可听位置还在段 A（最后一颗音 0.83s 已落地、段 B 首音 1.08s 未落地） */
  driveFrames(ac, beat, 0.9);
  ok(beat.clock().nextNoteTime > 1.08, "前提：调度游标已越过段边界（scheduling domain 已进段 B）");
  ok(ac.currentTime < 1.08, "前提：可听时钟仍在段 A 内（段 B 首音未发声）");
  eq(chipTexts(), "一", "★ 歌词轨仍显示段 A——调度越界不许先跳（v2.7.1 前这里已是「二」）");
  ok(els["argNowMeta"].textContent.includes("第 1/2 段"),
     "★ 计数器仍在第 1 段（实际「" + els["argNowMeta"].textContent + "」）");

  /* 可听位置越过边界后，两处在同一帧里跟过去 */
  driveFrames(ac, beat, 0.4);                          // currentTime ≈ 1.3 > 1.08
  eq(chipTexts(), "二", "★ 可听越界后歌词轨切到段 B（跟着声音走，不是跟着调度走）");
  ok(els["argNowMeta"].textContent.includes("第 2/2 段"),
     "★ 计数器同步到第 2 段（实际「" + els["argNowMeta"].textContent + "」）");
  beat.Controls.stop();
}

/* ================= 场景 T76d：停机预览不乘可听域（旧行为逐位保留） ================= */
section("T76d 可听域对齐 · 停机预览仍显示当前定位段（回退路径不破）");
{
  const { beat } = loadStrum();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一板", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t76d", name: "两段歌", sections: [
    { name: "A段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "B段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] });
  beat.Store.upsertLyric("t76d", 0, [{ t: 0, dur: 24, ch: "春" }]);
  beat.Store.upsertLyric("t76d", 1, [{ t: 0, dur: 24, ch: "秋" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t76d", from: 1, to: 1, loop: true };
  beat.Viz.buildLyricLane();
  eq(beat.Viz.internals().lyricChipEls.map(c => c.children[1].textContent).join(""), "春",
     "★ 停机未起步（arrBar=-1）：歌词轨预览第 0 段，与 v2.7.1 前一致");
}
