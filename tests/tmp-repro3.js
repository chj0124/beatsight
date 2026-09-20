"use strict";
const { loadApp, FakeAudioContext } = require("./lib/harness");

const { beat, els } = loadApp(undefined, { seedDemo: false });
console.log("demo in store:", !!beat.Store.findArrange(beat.DEMO_ID));
console.log("countIn:", JSON.stringify(beat.Store.S.countIn), "bpm:", beat.Store.S.bpm,
  "sig:", beat.Store.S.sig, "track:", beat.Store.S.track);

beat.Store.S.playMode = "arrange";
beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: true };
beat.Presets.refreshAfterPatternChange();
beat.Controls.start();
const ac = FakeAudioContext.last;

const rows = () => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const cellsOf = r => rows()[r].children.filter(c => /(^| )cell( |$)/.test(c.className));
const cls = (r, i) => { const cs = cellsOf(r); return cs[i] ? cs[i].className : "(none)"; };

let prevSig = "";
for (let i = 0; i < 260; i++){
  ac.currentTime += 0.02;
  beat.AudioEngine.scheduler();
  beat.Viz.paintFrame();
  const n = cellsOf(0).length;
  const sig = `n=${n} c12=${cls(0,12)} c13=${cls(0,13)} c14=${cls(0,14)} c15=${cls(0,15)}`;
  if (sig !== prevSig){
    console.log(`i=${i} t=${ac.currentTime.toFixed(2)} ${sig}  arr=${JSON.stringify(beat.arrangeState())}`);
    prevSig = sig;
  }
}
console.log("--- onsetBuf ---");
console.log(beat.onsetBuf().map(e => `t=${e.t.toFixed(3)} bar=${e.bar} cumT=${e.cumT} aSec=${e.aSec} aBar=${e.aBar} pb=${e.pb}`).join("\n"));
console.log("rows cell counts:", rows().map(r => cellsOf(rows().indexOf(r)).length).join("|"));
console.log("audio hits (t<3.2):", ac.hits.filter(h => h.t < 3.2).map(h => h.t.toFixed(3)).join(","));
beat.Controls.stop();
