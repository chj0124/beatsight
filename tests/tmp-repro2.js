"use strict";
const { loadApp, FakeAudioContext } = require("./lib/harness");

function run(label, opts){
  const { beat, els } = loadApp(opts.seed, opts.appOpts || {});
  if (opts.setup) opts.setup(beat);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: true };
  if (opts.bpm) beat.Controls.setBpm(opts.bpm);
  if (opts.countIn) beat.Store.S.countIn = { on: true, beats: opts.countIn };
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;

  const rows = () => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  const cells = () => rows()[0].children.filter(c => /(^| )cell( |$)/.test(c.className));
  const firstCell = cells()[0];
  let rebuilds = 0, prevFirst = firstCell;
  let seen = new Array(16).fill(false);
  let actives = [];
  const endT = ac.currentTime + (opts.seconds || 1.4);
  let guard = 0;
  while (ac.currentTime < endT && guard++ < 5000){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (cells()[0] !== prevFirst){ rebuilds++; prevFirst = cells()[0]; }
    const cs = cells();
    for (let i = 0; i < cs.length; i++){
      if (/active/.test(cs[i].className)){ seen[i] = true; actives.push(i); }
    }
  }
  console.log(`[${label}] bpm=${beat.Store.S.bpm} rebuilds=${rebuilds} seenRows=${rows().length}`);
  console.log(`    active idx ever seen: ${seen.map((v,i)=>v?i:null).filter(v=>v!==null).join(",")}`);
  console.log(`    14=${seen[14]} 15=${seen[15]}  rows=${rows().map(r=>r.children.filter(c=>/(^| )cell( |$)/.test(c.className)).length).join("|")}`);
  beat.Controls.stop();
}

run("240bpm seedDemo:false", { seed: undefined, appOpts: { seedDemo: false }, bpm: 240 });
run("default bpm seedDemo:false", { seed: undefined, appOpts: { seedDemo: false } });
run("default bpm default seed", { seed: undefined });
run("default bpm countIn4", { seed: undefined, countIn: 4 });
