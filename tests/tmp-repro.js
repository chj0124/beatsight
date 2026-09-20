"use strict";
const { loadApp, FakeAudioContext } = require("./lib/harness");

const { beat, els } = loadApp(undefined, { seedDemo: false });
beat.Store.S.playMode = "arrange";
beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: true };
beat.Controls.setBpm(240);
beat.Presets.refreshAfterPatternChange();
beat.Controls.start();
const ac = FakeAudioContext.last;

const rows = () => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const cls = (r, i) => rows()[r].children.filter(c => /(^| )cell( |$)/.test(c.className))[i].className;

let seen14 = false, seen15 = false;
let log = [];
for (let i = 0; i < 90; i++){
  ac.currentTime += 0.02;
  beat.AudioEngine.scheduler();
  beat.Viz.paintFrame();
  const c14 = cls(0, 14), c15 = cls(0, 15);
  if (/active|played/.test(c14)) seen14 = true;
  if (/active|played/.test(c15)) seen15 = true;
  log.push(`${i} t=${ac.currentTime.toFixed(3)} c14="${c14}" c15="${c15}"`);
}
console.log(log.slice(0, 60).join("\n"));
console.log("...");
console.log("seen14=", seen14, "seen15=", seen15);
console.log("onsets in buf (first bar area):");
// dump onsetBuffer via scheduler internal? not accessible; print hits
console.log("audio hits t<1.1:", ac.hits.filter(h => h.t < 1.1).map(h => h.t.toFixed(3)).join(","));
beat.Controls.stop();
