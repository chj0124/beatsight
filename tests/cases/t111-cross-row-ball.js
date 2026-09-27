/* BeatSight 自动化测试 · 跨行大抛物线——终端弧落点改为下一颗发声的真实位置（v2.42.9）
   T111 系列。
   ---------------------------------------------------------------------------
   来源（用户真机报障，2026-09-27，曲式整首《在他乡》移动端）：第一小节的两行之间，
   主球在第一行播到行尾时，待命球**直接出现在第二行内部**（首个发声点的位置上原地
   小跳、行边界时刻就提前落地），而不是从第二行开头起跑抛物线。
   根因：旧待命球是一根独立小抛物线，相位挂在主球终端弧上、行边界时刻（p=1）落地——
   与主球飞行脱节。用户拍板的正确模型：**一根完整抛物线跨行拆两半**——
   前半段留在本行（主球到行右缘时仍在空中），后半段按行平移给下一行的待命球，
   发声时刻触地转正。
   驱动口径：BPM 240 ⇒ 48 tick = 0.25s、一小节 1s；0.005s 细步长（同 T72/T100）。
   谱面：2 小节型 + 2 行档（P === W，窗口零重建）——
     bar0 = 四分 ×4（发声 tick 0/48/96/144）；bar1 = 休止×2 + 四分×2（发声 96/144）：
     第 0 行最后一颗发声（144）到第 1 行第一颗发声（96）之间隔着一根完整的
     行边界（192）——正是《在他乡》第 1 小节「第 6 格起跳、第 10 格落地」的同构场景。
   ★ 端点选取一律按 {bar, cumT} 字段（onsetBuf 有「保留最近 1s」修剪，且首音在
     loopStart 前的锚点顺延里——下标选取会被修剪错位，T111 第一版踩过）。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const rowEls = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className));
const rowsPill = (els, n) => els["vizRowsRow"].children.find(c => c.dataset.rows === String(n));
const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

/* 导入测试谱面并选中：bars = [bar0, bar1]（meter 4） */
function withPattern(beat, bar0, bar1, name){
  beat.Store.importPresets(JSON.stringify({
    presets: [{ name, meter: 4, bars: [bar0, bar1] }],
  }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();     // 停机态：applyPatternChange → buildViz
}
const Q = { t: 48 };                            // 四分音符
const QR = { t: 48, rest: true };               // 四分休止

/* 细步长驱动（同 T100 口径）：逐帧采样主球 / 待命球姿态；
   端点表全程累积（union）——onsetBuf 会修剪，事后读不到早期端点 */
function drive(beat, ac, seconds){
  const samples = [], onsets = new Map();
  for (let i = 0; i < Math.round(seconds / 0.005); i++){
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.t.toFixed(4), { t: e.t, bar: e.bar, cumT: e.cumT }));
    const iv = beat.Viz.internals();
    const b = nums(iv.ballEl.style.transform), w = nums(iv.waitEl.style.transform);
    samples.push({
      now: ac.currentTime,
      ballOn: iv.ballEl.style.display !== "none",
      bx: b[0], by: b[1],
      waitOn: iv.waitEl.style.display !== "none",
      wx: w[0], wy: w[1], wsx: w[2],
    });
  }
  return { samples, onsets: [...onsets.values()].sort((a, b) => a.t - b.t) };
}
const pick = (arr, lo, hi) => arr.filter(s => s.now > lo && s.now <= hi);

section("T111a 跨行大抛物线 · 行尾连续空格 ⇒ 主球离场仍在空中、待命球从下一行左缘接住、发声时刻在行内落点触地");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, [Q, Q, Q, Q], [QR, QR, Q, Q], "跨行缺口型");
  rowsPill(els, 2).fire("click");
  eq(rowEls(els).length, 2, "前提：2 行档渲染 2 行（P === W = 2，窗口零重建）");
  beat.Controls.setBpm(240);                    // 48 tick = 0.25s，一小节 1s
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 2.3);
  beat.Controls.stop();
  const iv = beat.Viz.internals();
  const g0 = iv.rowGeo[0], g1 = iv.rowGeo[1];
  /* 端点按 {bar, cumT} 选取：L0 = 第 0 行最后一颗（bar0 cumT 144）；F1 = 第 1 行第一颗（bar1 cumT 96） */
  const L0 = onsets.find(e => e.bar === 0 && e.cumT === 144);
  const F1 = onsets.find(e => e.bar === 1 && e.cumT === 96);
  ok(!!L0 && !!F1, "前置：采到 L0（bar0@144）与 F1（bar1@96）两个关键端点");
  const boundary = L0.t + 0.25;                 // 行边界 = L0 + 行内剩余 48 tick（每 tick 0.25/48s）
  const Ay0 = g0.top - 20, Ay1 = g1.top - 20;   // 球的基线 = 行顶 − 20（posOf 口径）
  const H = Math.min(48, Ay0 + 6);              // 大抛物线跳高（T=0.75s ⇒ 120T²=67.5 → 钳到 48）
  const landX = g1.left + (96 / 192) * g1.width - 8;   // 落点 = 第 1 行行内 tick 96（50% 处）
  ok(Math.abs(boundary - (F1.t - 0.5)) < 0.02,
     "前置：行缺口 = 三个四分（边界 " + boundary.toFixed(3) + " = F1 " + F1.t.toFixed(3) + " − 0.5s）");

  /* ① 越界前：主球沿大抛物线前半段飞向行右缘，行边界前一刻仍在空中（旧实现此刻已落地） */
  const preB = pick(samples, L0.t + 0.20, boundary - 0.004).filter(s => s.ballOn);
  ok(preB.length > 3, `前置：越界前采到 ${preB.length} 帧主球`);
  const lastPre = preB[preB.length - 1];
  ok(lastPre.by < Ay0 - H * 0.7,
     "★★ 越界前主球仍在空中（y=" + lastPre.by.toFixed(0) + " 远高于基线 " + Ay0.toFixed(0) +
     "）——旧实现终端弧在行右缘落地（y≈基线），此处必红");
  /* ② 越界后：主球让位隐藏，待命球从下一行左缘、以主球离场高度接住（同一条抛物线同相位） */
  const postB = pick(samples, boundary + 0.002, boundary + 0.05);
  ok(postB.length > 3, `前置：越界后采到 ${postB.length} 帧`);
  ok(postB.every(s => !s.ballOn), "★★ 越界后主球隐藏（本行坐标系画不下已出右缘的球）");
  const wEntry = postB.find(s => s.waitOn);
  ok(!!wEntry, "★★ 越界后待命球立即在场（从第二行开头接住，不再凭空出现在行内部）");
  const exitH = H * 4 * (1 / 3) * (2 / 3);      // 主球在行边界的离场高度（pB = 48/144 = 1/3）
  ok(Math.abs((Ay1 - wEntry.wy) - exitH) <= H * 0.25,
     "★★ 接住高度 = 主球离场高度（同一条抛物线同相位）：离基线 " + (Ay1 - wEntry.wy).toFixed(0) +
     " ≈ 离场高度 " + exitH.toFixed(0) + "——旧实现此刻待命球已提前落地（贴基线），必红");
  ok(wEntry.wx < g1.left + 40 && wEntry.wx > g1.left - 20,
     "★★ 接住位置在下一行左缘（wx=" + wEntry.wx.toFixed(0) + "，行左缘 " + g1.left.toFixed(0) +
     "）——旧实现凭空出现在行内落点（≈" + landX.toFixed(0) + "），必红");
  /* ③ 触地前：待命球沿下降段落到行内 50% 处的发声点，发声时刻贴地 */
  const preLand = pick(samples, F1.t - 0.02, F1.t - 0.001).filter(s => s.waitOn);
  ok(preLand.length > 2, `前置：触地前采到 ${preLand.length} 帧待命球`);
  const wl = preLand[preLand.length - 1];
  ok(Math.abs(wl.wy - Ay1) <= 8, "★★ 发声时刻待命球贴地（wy=" + wl.wy.toFixed(1) + " ≈ 基线 " +
     Ay1.toFixed(1) + "）——落地时机 = 发声时刻，旧实现提前半个缺口在行边界就落地，必红");
  ok(Math.abs(wl.wx - landX) <= 10,
     "★★ 落点 = 下一颗发声的真实位置（wx=" + wl.wx.toFixed(0) + " ≈ " + landX.toFixed(0) + "）");
  ok(landX - (g1.left - 8) > g1.width * 0.3, "★ 落点确在行内（bug 签名位置：第二行内部）");
  /* ④ 落地转正：主球在发声点上归队（挤压回弹） */
  const postLand = pick(samples, F1.t + 0.01, F1.t + 0.05).filter(s => s.ballOn);
  ok(postLand.length > 2, `前置：落地后采到 ${postLand.length} 帧主球`);
  const bl = postLand[0];
  ok(Math.abs(bl.bx - landX) <= 12 && Math.abs(bl.by - Ay1) <= 12,
     "★★ 落地转正：主球在发声点归队（bx=" + bl.bx.toFixed(0) + "/by=" + bl.by.toFixed(0) +
     " ≈ " + landX.toFixed(0) + "/" + Ay1.toFixed(0) + "）");
}

section("T111b 正常接力对照 · 下一颗发声恰在行边界 ⇒ 既有「起跑预备」逐位保留，主球在行右缘正常落地");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, [Q, Q, Q, Q], [Q, Q, Q, Q], "正常接力型");
  rowsPill(els, 2).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 2.3);
  beat.Controls.stop();
  const iv = beat.Viz.internals();
  const g0 = iv.rowGeo[0], g1 = iv.rowGeo[1];
  /* 第 1 行（bar1，全四分）的终端弧：L1 = bar1@144，下一颗 = 回绕的 bar0@0，恰在行边界 */
  const L1 = onsets.find(e => e.bar === 1 && e.cumT === 144);
  const F0w = onsets.find(e => e.bar === 0 && e.cumT === 0 && e.t > L1.t);
  ok(!!L1 && !!F0w, "前置：采到 L1（bar1@144）与回绕端点 F0w（bar0@0）");
  const boundary = L1.t + 0.25;
  ok(Math.abs(F0w.t - boundary) < 0.02, "前置：回绕首音恰在行边界（正常接力前提）");
  /* 越界前：主球照旧完整落地在行右缘（大抛物线时长 == 旧终端弧时长，逐位退化），待命球起跑预备在场 */
  const preB = pick(samples, L1.t + 0.1, boundary - 0.006);
  ok(preB.length > 5, `前置：对照场景采到 ${preB.length} 帧`);
  ok(preB.filter(s => s.ballOn).length > 5 && preB.filter(s => s.waitOn).length > 5,
     "★ 正常接力：终端弧期间主球与待命球同时在场（v1.8.0 起跑预备逐位保留）");
  const lastPre = preB[preB.length - 1];
  ok(Math.abs(lastPre.by - (g1.top - 20)) <= 10,
     "★★ 主球在行右缘正常落地（by=" + lastPre.by.toFixed(0) + " ≈ 基线 " + (g1.top - 20).toFixed(0) +
     "）——若跨行数学误伤正常接力，此处必红");
  /* 越界后：主球立即在下一行行首归队（正常接力没有隐藏窗口） */
  const postB = pick(samples, boundary + 0.01, boundary + 0.05).filter(s => s.ballOn);
  ok(postB.length > 2, `前置：接力后采到 ${postB.length} 帧主球`);
  ok(Math.abs(postB[0].bx - (g0.left - 8)) <= 12,
     "★★ 接力后主球在下一行行首归队（bx=" + postB[0].bx.toFixed(0) + " ≈ " + (g0.left - 8).toFixed(0) + "）");
}

section("T111c REDUCE_MOTION 降级 · 去动作留位置：待命球贴在落点、主球越界后仍隐藏");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }), { reduceMotion: true });
  withPattern(beat, [Q, Q, Q, Q], [QR, QR, Q, Q], "跨行缺口型");
  rowsPill(els, 2).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 1.7);
  beat.Controls.stop();
  const iv = beat.Viz.internals();
  const g1 = iv.rowGeo[1];
  const L0 = onsets.find(e => e.bar === 0 && e.cumT === 144);
  const F1 = onsets.find(e => e.bar === 1 && e.cumT === 96);
  ok(!!L0 && !!F1, "前置：采到 L0 与 F1");
  const boundary = L0.t + 0.25;
  const landX = g1.left + (96 / 192) * g1.width - 8;
  const gap = pick(samples, boundary + 0.01, F1.t - 0.01);
  ok(gap.length > 10, `前置：缺口窗口采到 ${gap.length} 帧`);
  ok(gap.every(s => !s.ballOn), "★ REDUCE_MOTION 下主球越界后同样隐藏（位置已出本行坐标系）");
  const w = gap.filter(s => s.waitOn);
  ok(w.length > 10, `★ 降级不改可观测性：待命球整段在场（${w.length} 帧）`);
  ok(w.every(s => Math.abs(s.wy - (g1.top - 20)) <= 8 && Math.abs(s.wx - landX) <= 10),
     "★★ REDUCE_MOTION：待命球贴在落点（去动作留位置，v1.3.0 P2-11 纪律）");
  ok(w.every(s => Math.abs((s.wsx || 1) - 1) < 0.02), "★ 形变置为无形变（scale=1）");
}
