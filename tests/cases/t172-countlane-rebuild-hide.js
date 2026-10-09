/* T172 预备拍会话期间的换型重建（v3.12.1）：row0 隐藏不变量钉在 buildViz 出生点。
   ---------------------------------------------------------------------------
   背景（用户实拍二连 + 逐帧探针，见 plan-v3121-countlane-ghost.md）：
   v3.12.0 把预备拍道收成「传送带第 −1 小节」后，首个可听小节内 row0 靠
   visibility:hidden 让道顶替显示——但 hidden 只有预备拍分支（paintFrameBody
   帧内）会写，预备拍一结束就没人维护这个不变量。逐小节谱在第 1、2 小节
   型不同时，调度器会在第 1 小节最后一拍**开始时**（比可听边界早一个前瞻窗）
   消耗换型：schedOneStep → consumePending → applyPatternChange → buildViz，
   整树重建，新生 row0 默认可见、无人再藏 → 用户实拍「预备拍道突然变 4 拍长、
   前后两半线条粗细深浅不同」（row0 留空空跑道 4 拍通宽 + 道 2 拍叠印），
   一闪而过（末拍 0.4~0.8s）。修法：buildViz 内 countLaneSession 仍开启时，
   新生 row0 立即重新 hidden（不变量在被打破的同一同步点重建）。
   驱动手法（与 t171 同款）：同时推时钟 + scheduler + paintFrame。
   BPM 240 → 1 小节 = 1s，预备拍 2 拍 = 0.5s，前瞻 ≈0.3s →
   换型重建应落在 ≈1.2s（bar0 末拍内），会话退场在 1.5s。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, html } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const mkBars = (n, per) => Array.from({ length: n }, () =>
  Array.from({ length: per }, (_, i) => ({ t: 192 / per })));

/* 推 seconds：时钟 + 调度 + 渲染三时钟同跑；onFrame 每帧回调（逐帧采样用） */
function drive3(beat, ac, seconds, onFrame){
  const n = Math.ceil(seconds / 0.02);
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (onFrame) onFrame();
    if (!beat.Store.S.playing) return;
  }
}

/* 曲式：A 段 = P1（1 小节四音型），B 段 = P2（1 小节两音型）——相邻小节型不同，
   换型重建必经 consumePending。BPM 240，scroll rows=3，预备拍 2 拍，范围 0..1 循环 */
function twoPatternSetup(){
  const { beat, els } = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 2 },
  }));
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(1, 4) },
    { name: "两音型", meter: 4, bars: mkBars(1, 2) },
  ] }));
  const customs = beat.Store.customs;
  const p1 = customs[customs.length - 2], p2 = customs[customs.length - 1];
  const v = beat.Store.upsertArrange({ name: "换型重建", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: p1.id }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: p2.id }, repeats: 1 }] },
  ] });
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 1, loop: true };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last };
}

section("T172a 会话期间跨换型重建：row0 恒 hidden · 道宽恒 2 拍 · 退场恢复");
{
  const { beat, els, ac } = twoPatternSetup();
  const perBeat = beat.Viz.internals().rowGeo[0].width / 4;

  /* 阶段 1：预备拍（0.5s）+ 首个可听小节前 0.4s —— 既有语义不回归 */
  let rebuilt = 0, lastRow0 = null;
  let row0BornVisible = 0, laneBad = 0, laneGone = 0, sessionFrames = 0;
  const sample = () => {
    const iv = beat.Viz.internals();
    if (iv.rowEls[0] !== lastRow0){ if (lastRow0) rebuilt++; lastRow0 = iv.rowEls[0]; }
    if (iv.countLane.session){
      sessionFrames++;
      if (iv.rowEls[0].style.visibility !== "hidden") row0BornVisible++;
      if (iv.countLaneEl.style.display !== "block") laneGone++;
      else {
        const w = parseFloat(iv.countLaneEl.style.width || "NaN");
        if (!(Math.abs(w - perBeat * 2) < 2)) laneBad++;
      }
    }
  };
  drive3(beat, ac, 0.9, sample);
  eq(els["statusText"].textContent.indexOf("预备 ·") >= 0, false, "前提：已越过预备");
  eq(beat.Viz.internals().countLane.session, true, "前提：会话开启");
  ok(sessionFrames > 10, "前提：逐帧采样已覆盖会话窗口", "sessionFrames=" + sessionFrames);
  eq(row0BornVisible, 0, "★★ 会话期间（预备拍结束→换型重建前）row0 恒 hidden");

  /* 阶段 2：跨过换型重建（≈1.2s）直至退场（1.5s）——本 bug 的发作窗口 */
  drive3(beat, ac, 0.8, sample);
  ok(rebuilt >= 1, "★★ 前提自证：会话期间确实发生过网格重建"
    + "（调度器前瞻消耗换型 → buildViz；无此前提断言即空转）", "rebuilt=" + rebuilt);
  eq(row0BornVisible, 0, "★★ 核心断言：会话期间跨换型重建，row0 每一帧都保持 hidden"
    + "（v3.12.0 在重建帧露出 4 拍通宽空跑道 = 用户实拍的「道变 4 拍长」残影）");
  eq(laneGone, 0, "★ 会话期间道持续显示（paintBall 守卫同帧复活，既有语义）");
  eq(laneBad, 0, "★★ 道宽恒 = 2×每拍像素（2 拍预备拍永不显示为 4 拍）");

  /* 退场：进入第二个可听小节 → 会话结束、道撤、row0 恢复（v3.12.0 语义不动） */
  const st = beat.Viz.internals();
  eq(st.countLane.session, false, "★★ 播到第二个可听小节 → 会话结束（既有语义）");
  eq(st.countLaneEl.style.display, "none", "★ 道撤除（随传送带滑出，v3.12.0 设计）");
  eq(st.rowEls[0].style.visibility, "", "★ row0 恢复显形（:9108 对称写点）");
}

section("T172b 源码钉：不变量修复在 buildViz 出生点（防回潮）");
{
  ok(/\n    if \(countLaneSession && rowEls\[0\]\) rowEls\[0\]\.style\.visibility = "hidden";/.test(html),
    "★★ buildViz 内：会话开启时新生 row0 立即重新 hidden"
    + "（不变量在被打破的同一同步点重建，不依赖重建触发源的假设；"
    + "锚定行首缩进——被注释掉的残行不算在位）");
  ok(!/countLaneSession && countLaneEl\)\{[\s\S]{0,400}row0BornVisible/.test(html),
    "★ 修复不在 paintBall 守卫（早退帧 :9205/:9210 先于守卫，守卫路径有盲区）");
}
