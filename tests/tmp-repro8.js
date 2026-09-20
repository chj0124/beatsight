"use strict";
const { loadApp, FakeAudioContext } = require("./lib/harness");

const seedState = () => ({ "beatsight.state": JSON.stringify({ track: "strum", sel: { type: "builtin", idx: 0 } }) });

function enter(){
  const { beat, els } = loadApp(seedState(), { seedDemo: false });
  const box = els["presetList"].children.find(x => /(^| )preset-demo-group( |$)/.test(x.className));
  const playAll = box.children.find(x => /(^| )demo-play-row( |$)/.test(x.className)).children[0];
  playAll.fire("click");
  return { beat, els, ac: FakeAudioContext.last };
}

function run(label, bpm, schedMs, rafMs, stepMs, seconds){
  const { beat, ac } = enter();
  beat.Controls.setBpm(bpm);
  const viz = () => beat.Viz.internals();
  const cellEls = () => viz().cellEls;
  const subMap = {};             // b -> { subEl -> idx }
  const flashes = [];            // { t, b, idx }
  const idxOf = new Map();       // subEl -> {b, idx}
  for (let b = 0; b < cellEls().length; b++){
    let n = 0;
    (cellEls()[b] || []).forEach(cell => {
      const subs = cell.children.find(ch => ch.className === "subs");
      if (subs) subs.children.forEach(sub => {
        const rec = { b, idx: n };
        idxOf.set(sub, rec);
        // eslint-disable-next-line no-param-reassign
        sub.animate = () => { flashes.push({ t: ac.currentTime, ...rec }); };
        n++;
      });
    });
    subMap[b] = n;
  }
  const rowCls = b => (cellEls()[b] || []).map(c => c.className);
  const activeIdx = b => rowCls(b).findIndex(c => /(^| )active( |$)/.test(c));
  const changes = [];
  let lastActive = -2;
  const N = Math.round(seconds / (stepMs / 1000));
  let tSched = 0, tRaf = 0;
  for (let i = 0; i < N; i++){
    const wall = i * stepMs;
    ac.currentTime = wall / 1000;
    if (wall - tSched >= schedMs - 1e-9){ tSched = wall; try { beat.AudioEngine.scheduler(); } catch (e) { changes.push("SCHEDERR " + e.message); } }
    if (wall - tRaf >= rafMs - 1e-9){ tRaf = wall; try { beat.Viz.paintFrame(); } catch (e) { changes.push("RAFERR " + e.message); } }
    if (!beat.Store.S.playing){ changes.push(`stopped@${(wall/1000).toFixed(3)}`); break; }
    const a = activeIdx(0);
    if (a !== lastActive){ changes.push(`t=${(wall/1000).toFixed(3)} row0 active=${a}`); lastActive = a; }
  }
  console.log(`\n===== ${label} bpm=${bpm} sched=${schedMs} raf=${rafMs} step=${stepMs} =====`);
  console.log("sub counts per row:", JSON.stringify(subMap));
  console.log("row0 active changes:");
  console.log(changes.join("\n"));
  const row0 = flashes.filter(f => f.b === 0).map(f => `${f.idx}@${f.t.toFixed(3)}`);
  console.log("row0 flash seq:", row0.join(" "));
  const seen = [...new Set(flashes.filter(f => f.b === 0).map(f => f.idx))].sort((x, y) => x - y);
  console.log("row0 flash indices seen:", seen.join(","));
}

run("demo-120-1ms", 120, 25, 16.7, 1, 2.3);
run("demo-96-1ms", 96, 25, 16.7, 1, 3.0);
