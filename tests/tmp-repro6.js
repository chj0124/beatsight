"use strict";
const { loadApp, FakeAudioContext } = require("./lib/harness");

function run(bpm, frames){
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: true };
  beat.Controls.setBpm(bpm);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const rowAt = i => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className))[i];
  const cellsAt = i => rowAt(i).children.filter(c => /(^| )cell( |$)/.test(c.className));
  const seen = new Set();
  const seq = [];
  for (let f = 0; f < frames; f++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const cs = cellsAt(0);
    let act = -1;
    cs.forEach((c, j) => { if (/(^| )active( |$)/.test(c.className)) act = j; });
    if (act >= 0) seen.add(act);
    seq.push(act);
  }
  beat.Controls.stop();
  console.log(`bpm=${bpm} frames=${frames}`);
  console.log("  row0 active seq:", seq.join(" "));
  console.log("  row0 seen active:", [...seen].sort((a, b) => a - b).join(","));
}

run(240, 60);
run(120, 60);
run(60, 60);
