/* BeatSight 自动化测试 · 接力待命球最大提前量（2 拍）
   T241 系列（v3.48.0）。
   ---------------------------------------------------------------------------
   来源（用户实拍 v3.47.1）：「C琶音」式长空档段——整段只有第 1 拍发声——主球第 1 拍
   没跳完，下一小节的待命球就挂上等着（提前近一小节），读作长期占位干扰。
   修法：待命球最多提前 2 拍现身（paintBall 的 waitEl 块：b2.t − now > 2×spb() 不显示）；
   2 拍与预备拍「进入最后一拍起跳」同一数量级。
   谱面：bar0 = 四分 + 休止×3（只第 1 拍发声）；bar1 = 四分×4——正常接力（下一颗恰在行边界）。
   口径：BPM 240 ⇒ 1 拍 = 0.25s、一小节 1s、2 拍窗口 = 0.5s；0.005s 细步长（同 T111）。
   ★ 端点选取一律按 {bar, cumT} 字段（同 T111 的教训：下标选取会被修剪错位）。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const rowEls = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className));
const rowsPill = (els, n) => els["vizRowsRow"].children.find(c => c.dataset.rows === String(n));
const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

function withPattern(beat, bar0, bar1, name){
  beat.Store.importPresets(JSON.stringify({
    presets: [{ name, meter: 4, bars: [bar0, bar1] }],
  }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
}
const Q = { t: 48 };                            // 四分音符
const QR = { t: 48, rest: true };               // 四分休止

/* 细步长驱动（同 T111 口径） */
function drive(beat, ac, seconds){
  const samples = [], onsets = new Map();
  for (let i = 0; i < Math.round(seconds / 0.005); i++){
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.t.toFixed(4), { t: e.t, bar: e.bar, cumT: e.cumT }));
    const iv = beat.Viz.internals();
    samples.push({
      now: ac.currentTime,
      ballOn: iv.ballEl.style.display !== "none",
      waitOn: iv.waitEl.style.display !== "none",
    });
  }
  return { samples, onsets: [...onsets.values()].sort((a, b) => a.t - b.t) };
}
const pick = (arr, lo, hi) => arr.filter(s => s.now > lo && s.now <= hi);

section("T241a 待命球提前量上限 · 长空档段最多提前 2 拍现身，窗口内既有起跑预备保留");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, [Q, QR, QR, QR], [Q, Q, Q, Q], "长空档型");
  rowsPill(els, 2).fire("click");
  eq(rowEls(els).length, 2, "前提：2 行档渲染 2 行（P === W = 2，窗口零重建）");
  beat.Controls.setBpm(240);                    // 1 拍 = 0.25s，一小节 1s
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 2.3);
  beat.Controls.stop();
  const L0 = onsets.find(e => e.bar === 0 && e.cumT === 0);    // 第 0 行唯一发声（第 1 拍）
  const F1 = onsets.find(e => e.bar === 1 && e.cumT === 0);    // 第 1 行首颗（恰在行边界）
  ok(!!L0 && !!F1, "前置：采到 L0（bar0@0）与 F1（bar1@0）两个关键端点");
  ok(Math.abs(F1.t - L0.t - 1.0) < 0.02,
     "前置：L0 → F1 空档 = 一整小节 1s（4 拍）——v3.47.1 里待命球全程 ~0.75s 干等");
  /* ① 上限：空档前段（离落点 > 2 拍 = 0.5s）待命球不现身——旧实现终端弧一开始就在场，此处必红 */
  const early = pick(samples, L0.t + 0.1, F1.t - 0.51);
  ok(early.length > 50, `前置：空档前段采到 ${early.length} 帧`);
  ok(early.every(s => !s.waitOn),
     "★★ 离落点超过 2 拍时待命球不现身（最多提前 2 拍）——旧实现此刻早已挂上，必红");
  ok(early.every(s => s.ballOn), "★ 主球全程在场（正常接力主球不隐藏，上限只收待命球）");
  /* ② 窗口内：离落点 ≤ 2 拍后待命球按既有「起跑预备」现身（既有行为逐位保留） */
  const late = pick(samples, F1.t - 0.49, F1.t - 0.02);
  ok(late.length > 50, `前置：2 拍窗口内采到 ${late.length} 帧`);
  ok(late.every(s => s.waitOn),
     "★★ 2 拍窗口内待命球在场（起跑预备不受伤）——若上限误伤窗口内行为，此处必红");
}

section("T241b 短空档对照 · 空档 ≤ 2 拍时行为与旧版逐位一致（上限不触发）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  /* bar0 = 四分+休+四分+休：行内**最后**发声在 cumT 96（其后才是终端弧），
     下一行首颗恰在行边界（192）——空档 = 96 tick = 2 拍（0.5s），恰好压在上限上
     （b2.t − now 恒 ≤ 0.5s，严格大于才隐藏 ⇒ 全程不触发） */
  withPattern(beat, [Q, QR, Q, QR], [Q, Q, Q, Q], "临界空档型");
  rowsPill(els, 2).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { samples, onsets } = drive(beat, ac, 2.3);
  beat.Controls.stop();
  const L0 = onsets.find(e => e.bar === 0 && e.cumT === 96);   // 第 0 行最后发声
  const F1 = onsets.find(e => e.bar === 1 && e.cumT === 0);
  ok(!!L0 && !!F1, "前置：采到 L0（bar0@96）与 F1（bar1@0）");
  ok(Math.abs(F1.t - L0.t - 0.5) < 0.02, "前置：空档恰 = 2 拍（0.5s，压上限）");
  const arc = pick(samples, L0.t + 0.05, F1.t - 0.01);
  ok(arc.length > 50, `前置：终端弧采到 ${arc.length} 帧`);
  ok(arc.every(s => s.waitOn),
     "★ 空档恰 2 拍：终端弧全程待命球在场（b2.t − now 恒 ≤ 2 拍，上限不触发）");
}
