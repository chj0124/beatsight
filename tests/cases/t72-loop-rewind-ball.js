/* BeatSight 自动化测试 · 练习循环的渲染层回卷（v2.6.2）
   T72 系列。
   ---------------------------------------------------------------------------
   起因（用户实拍）：打开「循环本段」并循环「第 1 到第 1 小节」时，小球跳到最后一个
   音符后会**倒着返回**行首——因为循环 [k,k] 的每一遍都落在**同一行**，渲染层按
   「同row的下一端点 = 本小节的后续音」插值，于是从行尾向行首画了一条反向弧
   （时间向前、位置回退）。播放头（audioPosAt）同源同病。
   修复口径（与不循环时的接力同一套逻辑）：
     · 同row但 cumT 不增的下一端点 = 循环下一遍的起点 → 按**终端弧**处理，
       球向前跳完本行全程（终点 = 行右缘），不倒退；
     · 终端弧期间**待命球**在循环起点（本例行首）起跑预备——同一份抛物线复制；
     · 待命球 / .next 预告格的"下一行"走 loopNextBar（区间起点），不再写死 (bar+1)%n。
   不变量：循环**关着**时 loopNextBar ≡ (bar+1)%vizBars——旧行为一字不差，
   由 T30/T41 的既有断言继续钉住，本组只管循环开着的场景。 */
"use strict";
const { loadApp, FakeAudioContext, ok, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const TPB = 48;

/* 默认型民谣扫弦：4/4、96BPM → 一小节 2.5s；行几何 = 桩的 600px 行宽 */
const BAR_SEC = 2.5;

/* 采样驱动：细步长推进音频时钟，scheduler + paintFrame 双时钟同跑（同 T30 口径）。
   返回 { samples, onsets }：samples 逐帧记录球 / 待命球姿态；onsets 收集全程经过的端点。
   probe：可选的逐帧探针——DOM 类名这类"活值"必须在**那一帧**记录，跑完再读
   只剩末帧状态（第一版就在这里误判：断言时读到的是驱动结束那一刻的类名） */
function run(beat, ac, iv, seconds, probe){
  const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const samples = [];
  const onsets = new Map();
  const DT = 0.005;
  for (let i = 0; i < Math.round(seconds / DT); i++){
    ac.currentTime += DT;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.bar + ":" + e.t.toFixed(4), e));
    const b = nums(iv.ballEl.style.transform);
    const w = nums(iv.waitEl.style.transform);
    samples.push(Object.assign({
      now: ac.currentTime,
      x: b[0], y: b[1],
      wait: iv.waitEl.style.display !== "none",
      wx: w[0], wy: w[1],
    }, probe ? probe() : {}));
  }
  return { samples, onsets: [...onsets.values()] };
}

/* ================= 场景 T72a：循环 [0,0] —— 球跳完全程不倒退 + 行首预备动画 ================= */
section("T72a 循环 [0,0] · ★ 球不倒着返回：终端弧跳完本行全程，待命球在本行开头预备");
{
  const app = loadApp(seedState({ loopRange: { on: true, from: 0, to: 0 } }));
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv = beat.Viz.internals();
  const loopStart = beat.clock().loopStart;
  const barTicks = beat.Store.S.sig * TPB;
  const g = iv.rowGeo[0];
  const expectX = cumT => g.left + (cumT / barTicks) * g.width - 8;

  const { samples, onsets } = run(beat, ac, iv, BAR_SEC * 1.4);
  const os = onsets.filter(e => e.bar === 0 && e.t >= loopStart && e.t < loopStart + BAR_SEC)
    .sort((a, b) => a.t - b.t);
  ok(os.length >= 2, `前置：采到第一遍的 ${os.length} 个端点（循环 [0,0] 全部落在第 0 行）`);
  ok(onsets.every(e => e.bar === 0), "前置：循环 [0,0] 下所有端点恒在第 0 行（每遍同一行）");

  const L = os[os.length - 1];                        // 本行最后一颗音（旧 bug 从它之后开始倒退）
  const barEnd = loopStart + BAR_SEC;
  const W = samples.filter(s => s.now > L.t && s.now < barEnd - 0.01);
  ok(W.length > 10, `前置：终端弧窗口采到 ${W.length} 帧`);

  /* ① 核心断言：终端弧期间 x 单调向前，任何一帧都不许退回最后一颗音的左侧
     （旧实现在这里从行尾向行首插值 —— 每帧都在往左走，这条立刻红） */
  ok(W.every(s => s.x >= expectX(L.cumT) - 1),
    `★ 最后一颗音之后球不回到其左侧（旧 bug：从 x=${expectX(L.cumT).toFixed(0)} 一路倒退回行首）`);
  let maxBack = 0;
  for (let i = 1; i < W.length; i++) maxBack = Math.max(maxBack, W[i - 1].x - W[i].x);
  ok(maxBack < 1, `★ 终端弧逐帧单调向前（最大倒退步 ${maxBack.toFixed(2)}px < 1px）`);

  /* ② 跳完全程：窗口末尾球已贴近行右缘（终点 = 行右缘，与不循环时一致） */
  const rightX = g.left + g.width - 10;
  ok(W[W.length - 1].x > rightX - 15,
    `★ 球跳到行右缘收束（末帧 x=${W[W.length - 1].x.toFixed(1)}，右缘 ${rightX.toFixed(1)}）`);

  /* ③ 行首预备动画：终端弧期间待命球出现（旧实现判成"行内还有音"，待命球全程不露面），
     且窗口末尾它落在**本行**第一颗音的位置（循环 [0,0] 的"下一行"就是本行自己） */
  const wVis = W.filter(s => s.wait);
  ok(wVis.length > 3, `★ 快跳完时待命球在本行开头出现（${wVis.length} 帧可见）`);
  const wl = wVis[wVis.length - 1] || null;
  ok(!!wl && Math.abs(wl.wy - (g.top - 20)) < 8,
    `★ 待命球落点在第 0 行行首（y=${wl ? wl.wy.toFixed(1) : "无"} ≈ ${(g.top - 20).toFixed(1)}，不串行）`);
  ok(!!wl && Math.abs(wl.wx - expectX(os[0].cumT)) < 8,
    `★ 待命球落点 x 对齐本行第一颗音（x=${wl ? wl.wx.toFixed(1) : "无"} ≈ ${expectX(os[0].cumT).toFixed(1)}）`);
  beat.Controls.stop();
}

/* ================= 场景 T72b：循环 [1,2] —— 待命球指向区间起点，不是顺序下一行 ================= */
section("T72b 循环 [1,2] · ★ 第 2 小节末尾待命球在第 1 行开头预备（区间起点），不是第 3 行");
{
  const app = loadApp(seedState({ loopRange: { on: true, from: 1, to: 2 } }));
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv = beat.Viz.internals();
  const loopStart = beat.clock().loopStart;
  const barTicks = beat.Store.S.sig * TPB;
  const g2 = iv.rowGeo[2];
  const expectX2 = cumT => g2.left + (cumT / barTicks) * g2.width - 8;

  const hasNext = c => /(^| )next( |$)/.test(c.className);
  const { samples, onsets } = run(beat, ac, iv, BAR_SEC * 2.4, () => ({
    n10: hasNext(iv.cellEls[1][0]), n30: hasNext(iv.cellEls[3][0]),
  }));
  const os2 = onsets.filter(e => e.bar === 2 && e.t >= loopStart + BAR_SEC && e.t < loopStart + BAR_SEC * 2)
    .sort((a, b) => a.t - b.t);
  ok(os2.length >= 2, `前置：采到第 2 小节第一遍的 ${os2.length} 个端点`);

  const L2 = os2[os2.length - 1];
  const bar2End = loopStart + BAR_SEC * 2;
  const W2 = samples.filter(s => s.now > L2.t && s.now < bar2End - 0.01);
  ok(W2.length > 10, `前置：第 2 小节终端弧窗口采到 ${W2.length} 帧`);

  /* ① 主球在第 2 行内跳完全程（不倒退） */
  ok(W2.every(s => s.x >= expectX2(L2.cumT) - 1), "★ 第 2 小节终端弧不回到最后一颗音左侧");

  /* ② 待命球落点的**行**：必须是 rowGeo[1]（区间起点第 1 行）。
     旧实现 cand=(2+1)%4=3 → 落在第 3 行（纵向差 2×86px，容差 8px 内必然分得清） */
  const wVis = W2.filter(s => s.wait);
  ok(wVis.length > 3, `★ 第 2 小节快跳完时待命球出现（${wVis.length} 帧可见）`);
  const wl = wVis[wVis.length - 1] || null;
  ok(!!wl && Math.abs(wl.wy - (iv.rowGeo[1].top - 20)) < 8,
    `★ 待命球在第 1 行开头预备（y=${wl ? wl.wy.toFixed(1) : "无"} ≈ ${(iv.rowGeo[1].top - 20).toFixed(1)}`
    + `，而非第 3 行的 ${(iv.rowGeo[3].top - 20).toFixed(1)}）`);

  /* ③ .next 预告格同口径：第 2 行最后一格亮起时，预告必须落在第 1 行第 0 格，
     不是顺序的第 3 行（与待命球同走 loopNextBar） */
  const n1 = W2.filter(s => s.n10).length;
  const n3 = W2.filter(s => s.n30).length;
  ok(n1 > 3, `★ .next 预告落在第 1 行第 0 格（${n1} 帧）`);
  ok(n3 === 0, `★ .next 预告**不**落在区间外的第 3 行（旧实现会）`);
  beat.Controls.stop();
}
