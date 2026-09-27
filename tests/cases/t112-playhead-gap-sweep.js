/* BeatSight 自动化测试 · 跨行缺口期间播放杆扫入（v2.43.0，Q1 A 方案）
   T112 系列。
   ---------------------------------------------------------------------------
   来源（v2.42.9 交付后用户追问）：待命球转正那一刻，播放杆才从上一行行尾瞬移到
   下一行的发声点——缺口期间杆不动。根因：播放杆与球同源（onset 端点表），行归属
   只在端点落地时翻转。修法（A 方案）：audioPosAt 在跨行缺口期间额外给出「下一行
   扫入」依据——时间轴越过行边界后，杆从下一行左缘按 onset 时间插值扫到下一颗
   发声的位置；行边界时刻与发声时刻都来自端点表，仍纯端点驱动（无 v1.3.4 时钟分叉），
   与待命球的水平推进同一时间基（同为线性插值），视觉同步进场。
   ★ 杆是通高竖线（只写 translateX），扫入行的 x 即在下一行可见；尾迹 top/height
     跟随 headBar 一次性更新。格子填充 / 歌词 / 球的行归属维持旧口径（球走自己的
     终端弧分支，v2.42.9 机制不受影响）。
   驱动口径：BPM 240 ⇒ 48 tick = 0.25s、一小节 1s；0.005s 细步长（同 T72/T100/T111）。
   端点选取按 {bar, cumT} 字段 + drive 期间累积 union（onsetBuf 有修剪，同 T111 教训）。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const rowEls = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className));
const rowsPill = (els, n) => els["vizRowsRow"].children.find(c => c.dataset.rows === String(n));
const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const Q = { t: 48 }, QR = { t: 48, rest: true };

function withPattern(beat, bars, name){
  beat.Store.importPresets(JSON.stringify({ presets: [{ name, meter: 4, bars }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
}
/* 驱动 + 逐帧采样播放杆 x 与待命球姿态；端点全程累积（union） */
function drive(beat, ac, seconds){
  const samples = [], onsets = new Map();
  for (let i = 0; i < Math.round(seconds / 0.005); i++){
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.t.toFixed(4), { t: e.t, bar: e.bar, cumT: e.cumT }));
    const iv = beat.Viz.internals();
    const p = nums(iv.ph.style.transform), w = nums(iv.waitEl.style.transform);
    samples.push({ now: ac.currentTime, px: p[0], waitOn: iv.waitEl.style.display !== "none", wx: w[0],
      tgTop: nums(iv.tg.style.top)[0] });
  }
  return { samples, onsets: [...onsets.values()].sort((a, b) => a.t - b.t) };
}
const pick = (arr, lo, hi) => arr.filter(s => s.now > lo && s.now <= hi);
const findOn = (onsets, bar, cumT, after) =>
  onsets.find(e => e.bar === bar && e.cumT === cumT && (after === undefined || e.t > after));

section("T112a 缺口扫入 · 单行缺口 ⇒ 播放杆从下一行左缘线性扫到发声点，与待命球同步进场");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, [[Q, Q, Q, Q], [QR, QR, Q, Q]], "跨行缺口型");
  rowsPill(els, 2).fire("click");
  eq(rowEls(els).length, 2, "前提：2 行档渲染 2 行");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 2.3);
  beat.Controls.stop();
  const g0 = beat.Viz.internals().rowGeo[0], g1 = beat.Viz.internals().rowGeo[1];
  const L0 = findOn(onsets, 0, 144), F1 = findOn(onsets, 1, 96);
  ok(!!L0 && !!F1, "前置：采到 L0（bar0@144）与 F1（bar1@96）");
  const boundary = L0.t + 0.25;
  ok(Math.abs(F1.t - boundary - 0.5) < 0.02, "前置：缺口 = 0.5s（两个四分休止）");
  /* ① 越界前：杆钉在上一行行尾区间（行尾最后一段），不提前进场 */
  const preB = pick(samples, boundary - 0.03, boundary - 0.002);
  ok(preB.length > 3, `前置：越界前采到 ${preB.length} 帧`);
  ok(preB.every(s => s.px >= g0.left + 0.9 * g0.width && s.px <= g0.left + g0.width + 2),
     "★ 越界前播放杆钉在上一行行尾区间（不提前进场；此时仍随终端弧前进，30ms 内≈行宽 3%）");
  /* ② 缺口期间：杆在下一行内按 onset 时间线性扫入（斜率 = 行宽/缺口时长） */
  const gap = pick(samples, boundary + 0.02, F1.t - 0.02);
  ok(gap.length > 20, `前置：缺口期间采到 ${gap.length} 帧`);
  const bad = gap.filter(s => Math.abs(s.px - (g1.left + (s.now - boundary) * g1.width)) > 8);
  ok(bad.length === 0,
     "★★ 播放杆在下一行内线性扫入（行首左缘 → 发声点，onset 时间插值）："
     + "违例 " + bad.length + " 帧——旧实现钉在上一行行尾不动，此处必红");
  ok(gap.every((s, i) => i === 0 || s.px >= gap[i - 1].px - 0.5), "★ 扫入单调前进（不回跳）");
  /* ②b 尾迹竖直位置跟随扫入行（headBar 行归属——通高杆的 x 看不出行号，尾迹 top 才看得出） */
  ok(gap.every(s => Math.abs(s.tgTop - g1.top) <= 2),
     "★★ 尾迹随播放杆移到扫入行（tg.top=" + g1.top + "）——行归属错位（少 +1）时尾迹会留在上一行，必红");
  /* ③ 与待命球同步：同一时间基、同一线性插值，仅差 posOf 的 8px 球心偏移 */
  const both = gap.filter(s => s.waitOn);
  ok(both.length > 20, `前置：杆与待命球同帧在场 ${both.length} 帧`);
  const desync = both.filter(s => Math.abs(s.px - (s.wx + 8)) > 8);
  ok(desync.length === 0,
     "★★ 播放杆与待命球水平推进逐帧同步（差 = 球心偏移 8px）：失同步 " + desync.length + " 帧");
  /* ④ 转正后：杆从发声点位置继续随音乐前进（扫入终点 = 端点表行归属翻转点） */
  const postLand = pick(samples, F1.t + 0.005, F1.t + 0.02);
  ok(postLand.length > 2 && Math.abs(postLand[0].px - (g1.left + 0.5 * g1.width)) <= 12,
     "★★ 转正时刻杆恰在发声点位置（px=" + (postLand[0] ? postLand[0].px.toFixed(0) : "?") +
     " ≈ " + (g1.left + 0.5 * g1.width).toFixed(0) + "），此后随音乐继续前进");
}

section("T112b 正常接力对照 · 下一颗发声恰在行边界 ⇒ 无扫入窗口，杆行为逐位不变");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, [[Q, Q, Q, Q], [Q, Q, Q, Q]], "正常接力型");
  rowsPill(els, 2).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 2.3);
  beat.Controls.stop();
  const g0 = beat.Viz.internals().rowGeo[0], g1 = beat.Viz.internals().rowGeo[1];
  const L0 = findOn(onsets, 0, 144), F1 = findOn(onsets, 1, 0);
  ok(!!L0 && !!F1, "前置：采到 L0 与 F1（bar1 首音 tick 0 = 行边界）");
  const boundary = L0.t + 0.25;
  ok(Math.abs(F1.t - boundary) < 0.02, "前置：下一颗发声恰在行边界");
  /* 越界前：杆在本行行尾区间内扫（0.75W → W），绝不提前落到下一行左缘附近 */
  const preB = pick(samples, L0.t + 0.1, boundary - 0.002);
  ok(preB.length > 20, `前置：对照窗口采到 ${preB.length} 帧`);
  ok(preB.every(s => s.px >= g0.left + 0.7 * g0.width && s.px <= g0.left + g0.width + 2),
     "★★ 越界前杆始终在本行尾部区间（不出现扫入下一行的伪影）");
  const lastPre = preB[preB.length - 1];
  ok(Math.abs(lastPre.px - (g0.left + g0.width)) <= 8, "★ 越界前最后一帧杆在行右缘");
  /* 越界后：杆从下一行首音位置（tick 0 = 行左缘）随音乐继续，无中间态 */
  const postB = pick(samples, boundary + 0.005, boundary + 0.02);
  ok(postB.length > 2 && postB.every(s => s.px >= g1.left - 2 && s.px <= g1.left + 0.12 * g1.width),
     "★★ 接力后杆从下一行首音位置随音乐继续（若误触发扫入公式，会先算出非零偏移，必红）");
}

section("T112c 多行缺口 · 整行休止 ⇒ 播放杆逐行推进（每行 0 → 行尾），缺口跨几行扫几行");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, [[Q, Q, Q, Q], [QR, QR, QR, QR], [QR, QR, Q, Q]], "多行缺口型");
  rowsPill(els, 3).fire("click");
  eq(rowEls(els).length, 3, "前提：3 行档渲染 3 行");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 3.8);
  beat.Controls.stop();
  const g = beat.Viz.internals().rowGeo;
  const L0 = findOn(onsets, 0, 144), F2 = findOn(onsets, 2, 96);
  ok(!!L0 && !!F2, "前置：采到 L0（bar0@144）与 F2（bar2@96）");
  const boundary = L0.t + 0.25;                 // 第 0 行行尾
  ok(Math.abs(F2.t - boundary - 1.5) < 0.02, "前置：缺口跨 1.5 行（整行休止 + 半行休止）");
  /* 第 1 行（整行休止）：杆全程扫过 */
  const mid1 = pick(samples, boundary + 0.4, boundary + 0.6);
  ok(mid1.length > 10 && mid1.every(s => Math.abs(s.px - (g[1].left + (s.now - boundary) * g[1].width)) <= 10),
     "★★ 缺口第 1 行：杆线性扫过整行（旧实现钉在第 0 行行尾，必红）");
  /* 第 2 行（半行休止）：杆继续从行首扫向发声点 */
  const mid2 = pick(samples, boundary + 1.2, boundary + 1.4);
  ok(mid2.length > 10 && mid2.every(s => Math.abs(s.px - (g[2].left + (s.now - boundary - 1) * g[2].width)) <= 10),
     "★★ 缺口第 2 行：杆从行首继续扫向发声点（rowsIn ≥ 1 的多行推进公式）");
  /* 触地前：杆恰在发声点位置（bar2 首音 tick 96 = 50%）——窗口收紧到末 12ms（扫速 600px/s） */
  const preLand = pick(samples, F2.t - 0.012, F2.t - 0.002);
  ok(preLand.length > 1 && preLand.every(s => Math.abs(s.px - (g[2].left + 0.5 * g[2].width)) <= 12),
     "★★ 扫入终止于发声点位置（转正时刻）");
}
