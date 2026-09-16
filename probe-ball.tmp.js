"use strict";
/* 探头：逐帧核对主球/待命球的 y 属于哪一行。ROW_TOP0=58, ROW_H=86（harness），
   球的地线 y = rowTop - 20 → bar b 的 y ≈ 38 + b*86 */
const { loadApp, FakeAudioContext } = require("/workspace/tests/lib/harness");

const app = loadApp();
const { beat } = app;
beat.Controls.start();
const ac = FakeAudioContext.last;
const iv = beat.Viz.internals();

const rowOfY = y => Math.round((y - 38) / 86);   // 反解行号
const num = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/;

let lastReport = "";
const dt = 0.02;
for (let i = 0; i < Math.round(11 / dt); i++){      // 96BPM：一小节 2.5s，跑 4+ 小节
  ac.currentTime += dt;
  beat.Audio.scheduler();
  beat.Viz.paintFrame();
  const bar = (() => { const c = beat.clock(); return c.schedBar; })();
  const bm = num.exec(iv.ballEl.style.transform || "");
  const wm = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(iv.waitEl.style.transform || "");
  const wVisible = iv.waitEl.style.display !== "none";
  const bRow = bm ? rowOfY(+bm[2]) : null;
  const wRow = wm ? rowOfY(+wm[2]) : null;
  const report = `t=${ac.currentTime.toFixed(2)} bar=${bar} 主球行=${bRow} 待命球=${wVisible ? "行" + wRow : "隐"}`;
  if (report !== lastReport){
    console.log(report + ((bRow !== bar || (wVisible && wRow !== (bar + 1) % 4)) ? "   ★★★ 错行" : ""));
    lastReport = report;
  }
}
beat.Controls.stop();
