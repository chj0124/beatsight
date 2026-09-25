/* BeatSight 自动化测试 · v2.7.1 双声部打通 + 歌词/计数器可听域对齐
   T76 系列。
   ---------------------------------------------------------------------------
   两条用户实拍各对应一半：

   ① 「带扫弦记谱的谱上把『节拍』拉到 0 就全静默、『扫弦』滑条怎么调都不影响声音」
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
/* 无扫弦记谱的基底选择（idx 1 四分基础）——场景里再 import 自己的谱。
   v2.9.0：轨模型已删，起跑型与"在哪条轨"无关，双声部判据只看**谱的内容** */
const loadStrum = extra => loadApp(seedState(Object.assign(
  { sel: { type: "builtin", idx: 1 } }, extra || {})));
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
  /* 默认开局就是用户实拍的那条路径：默认型 = 民谣扫弦（dir-only）+ 电子音色 */
  const { beat } = loadApp();
  eq(beat.Store.S.sel.type, "builtin", "前提：默认选中的是内置型");
  eq(beat.curPattern().name, "民谣扫弦 · 下-下上-上下上",
    "前提：默认型 = 民谣扫弦（dir-only，与实拍同谱；v2.9.0 起不再有「扫弦轨」这回事）");
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
  /* 鼓组 + 带 zone 的扫弦谱：扫弦格按层级选鼓件（不叠弦区频段），音量走 strumVol。
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
     游标已进段 B，但**可听**位置还在段 A 末尾——这正是用户截图 2 捕获的那一瞬间。
     v2.7.2 分行后这条不变量落在行级：可听位置没越过边界，「当前行」不许先跳到下一行 */
  const { beat, els } = loadStrum();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一板", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t76", name: "两段歌", sections: [
    { name: "A段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "B段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] });
  /* v2.26.0：段 uid 由 normArrange 补发（动态），按位置现取 */
  const u76 = i => beat.Store.findArrange("t76").sections[i].uid;
  beat.Store.upsertLyric("t76", u76(0), [{ t: 0, dur: 24, ch: "一" }]);
  beat.Store.upsertLyric("t76", u76(1), [{ t: 0, dur: 24, ch: "二" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t76", from: 0, to: 1, loop: false };
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 窗口 4 行 = 歌曲小节 [0,1,0,1]（曲尾绕回开头，与网格同口径）→ 平铺字块恒为「一二一二」，
     段边界上**结构不重建**，变的只是「当前行」与字态 */
  const chipTexts = () => beat.Viz.internals().lyricChipEls.map(c => c.children[1].textContent).join("");
  const rows = () => beat.Viz.internals().lyricRows;
  const chipOf = (r, i) => rows()[r].chipEls[i];

  /* 驱动到 currentTime ≈ 0.9：调度游标已越过段边界（排到了 1.2s 之后），
     可听位置还在段 A（最后一颗音 0.83s 已落地、段 B 首音 1.08s 未落地） */
  driveFrames(ac, beat, 0.9);
  ok(beat.clock().nextNoteTime > 1.08, "前提：调度游标已越过段边界（scheduling domain 已进段 B）");
  ok(ac.currentTime < 1.08, "前提：可听时钟仍在段 A 内（段 B 首音未发声）");
  ok(rows() && rows().length === 4, "歌词轨按小节分行（4 行）");
  if (rows() && rows().length === 4){
    eq(chipTexts(), "一二一二", "分行结构跨段边界不重建（窗口不变，内容就不变）");
    ok(rows()[0].el.classList.contains("cur") && !rows()[1].el.classList.contains("cur"),
       "★ 当前行仍是第 1 行（段 A）——调度越界不许先跳（v2.7.1 前整轨已切到段 B）");
    ok(/played/.test(chipOf(0, 0).className), "段 A 的字时值已走完 = played");
    ok(chipOf(1, 0).className === "lyric-chip", "★ 段 B 的字仍是未唱态（不提前点亮）");
  }
  /* v2.10.14：原这里的两条 argNowMeta「第 1/2 段 / 第 2/2 段」计数器断言随说明文字删除退役——
     可听域跟随的覆盖仍由下面的歌词 cur 行切换（跟声音走、不跟调度走）承担 */

  /* 可听位置越过边界后，两处在同一帧里跟过去（1.12s：段 B 第 1 小节早期） */
  driveFrames(ac, beat, 0.22);
  if (rows() && rows().length === 4){
    ok(rows()[1].el.classList.contains("cur") && !rows()[0].el.classList.contains("cur"),
       "★ 可听越界后当前行移到第 2 行（跟着声音走，不是跟着调度走）");
    ok(/(^| )on/.test(chipOf(1, 0).className), "段 B 的字进入 on（正在唱）");
  }
  beat.Controls.stop();
}

/* ================= 场景 T76d：停机预览不乘可听域（旧行为逐位保留） ================= */
section("T76d 可听域对齐 · 停机预览锚到定位段所在窗口（回退路径不破）");
{
  /* 两段各 2 小节：A=春风 / B=秋月。停机 + 定位到段 B（v2.10.7 小节口径：
     段 B = 歌曲小节 2..3，from=2 → 起点 = 第 3 小节）
     → 窗口锚到第 3 小节所在的页（第 1 页 = 小节 1-4）→ 四行依次 春/风/秋/月 */
  const { beat } = loadStrum();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一板", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t76d", name: "两段歌", sections: [
    { name: "A段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 2 }] },
    { name: "B段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 2 }] },
  ] });
  /* v2.26.0：段 uid 由 normArrange 补发（动态），按位置现取 */
  const u76d = i => beat.Store.findArrange("t76d").sections[i].uid;
  beat.Store.upsertLyric("t76d", u76d(0), [{ t: 0, dur: 24, ch: "春" }, { t: 192, dur: 24, ch: "风" }]);
  beat.Store.upsertLyric("t76d", u76d(1), [{ t: 0, dur: 24, ch: "秋" }, { t: 192, dur: 24, ch: "月" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t76d", from: 2, to: 3, loop: true };
  beat.Viz.buildLyricLane();
  const rows = beat.Viz.internals().lyricRows;
  eq(beat.Viz.internals().lyricChipEls.map(c => c.children[1].textContent).join(""), "春风秋月",
     "★ 停机预览：四行 = 定位段所在窗口的四个小节（与网格停机锚定同一口径）");
  ok(rows && rows.every(r => r.head.style.display === "none" && !r.el.classList.contains("cur")),
     "停机预览：走带线全收、无当前行");
}

/* ================= 场景 T76e：分行后的播放态字级着色与走带线 ================= */
section("T76e 分行歌词 · 播放中：前行已唱 / 当前行正在唱 / 走带线只在当前行");
{
  /* 一段 4 小节（不绕回，第 3、4 小节无字）：「一」在第 1 小节拍 1、「二」在第 2 小节拍 1
     （时值各 1 拍 = 48t）。240BPM → 1 小节 1s；驱动到 1.3s = 第 2 小节后 0.22s ≈ 小节内 42t */
  const { beat } = loadStrum();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一板", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t76e", name: "一段四节", sections: [
    { name: "唯一段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 4 }] },
  ] });
  /* v2.26.0：段 uid 由 normArrange 补发（动态），按位置现取 */
  const u76e = i => beat.Store.findArrange("t76e").sections[i].uid;
  beat.Store.upsertLyric("t76e", u76e(0), [{ t: 0, dur: 48, ch: "一" }, { t: 192, dur: 48, ch: "二" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t76e", from: 0, to: 3, loop: false };
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1.3);
  const rows = beat.Viz.internals().lyricRows;
  ok(rows && rows.length === 4, "分行结构在（4 行）");
  if (rows && rows.length === 4){
    eq(rows[0].chipEls.length, 1, "第 1 行 = 第 1 小节的「一」");
    eq(rows[1].chipEls.length, 1, "第 2 行 = 第 2 小节的「二」");
    eq(rows[2].chipEls.length + rows[3].chipEls.length, 0, "第 3、4 小节无字 → 空行");
    ok(/played/.test(rows[0].chipEls[0].className), "★ 前一行（已播小节）的字 = played");
    eq(rows[0].fillEls[0].style.transform, "scaleX(1)", "前行填充定格 1");
    ok(/(^| )on/.test(rows[1].chipEls[0].className), "★ 当前行（正播小节）的字 = on");
    const m = /scaleX\(([\d.]+)\)/.exec(rows[1].fillEls[0].style.transform);
    ok(m && Math.abs(parseFloat(m[1]) - 0.88) < 0.06, "正在唱的字按小节内进度填充（≈0.88，实际 " + (m && m[1]) + "）");
    ok(!rows[0].el.classList.contains("cur") && rows[1].el.classList.contains("cur"),
       "当前行标记在第 2 行");
    eq(rows[0].head.style.display, "none", "前行走带线收起");
    eq(rows[1].head.style.display, "", "★ 走带线只在当前行出现");
    const hx = /translateX\(([\d.]+)px\)/.exec(rows[1].head.style.transform);
    ok(hx && Math.abs(parseFloat(hx[1]) - 132) < 4, "走带线 = 小节内进度 × 轨宽（≈132px，实际 " + (hx && hx[1]) + "）");
  }
  beat.Controls.stop();
  /* 停播复位：走带线全收、字态清空、当前行标记摘掉 */
  ok(rows && rows.every(r => r.head.style.display === "none" && !r.el.classList.contains("cur")),
     "★ 停播后走带线全收、无当前行（resetForStop 口径）");
}
