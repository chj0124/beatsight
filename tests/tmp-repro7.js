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
  const rows = () => beat.els === undefined ? null : null;
  const viz = () => beat.Viz.internals();
  const rowEls = () => viz().rowEls;
  const cellEls = () => viz().cellEls;
  const rowCls = b => (cellEls()[b] || []).map(c => c.className);
  const activeIdx = b => rowCls(b).findIndex(c => /(^| )active( |$)/.test(c));
  const out = [];
  let tSched = 0, tRaf = 0;
  const N = Math.round(seconds / (stepMs / 1000));
  let lastKey = "";
  const dwell = {};
  for (let i = 0; i < N; i++){
    const wall = i * stepMs;
    ac.currentTime = wall / 1000;
    if (wall - tSched >= schedMs - 1e-9){ tSched = wall; try { beat.AudioEngine.scheduler(); } catch (e) { out.push("SCHEDERR " + e.message); } }
    if (wall - tRaf >= rafMs - 1e-9){ tRaf = wall; try { beat.Viz.paintFrame(); } catch (e) { out.push("RAFERR " + e.message); } }
    if (!beat.Store.S.playing) { out.push(`stopped@${(wall/1000).toFixed(3)}`); break; }
    const r0 = rowCls(0);
    if (r0.length){
      const a = activeIdx(0);
      const played = r0.filter(c => /(^| )played( |$)/.test(c)).length;
      const cur = rowEls()[0] && /(^| )current( |$)/.test(rowEls()[0].className) ? 1 : 0;
      const key = a + "|" + played + "|" + cur;
      if (key !== lastKey){
        out.push(`t=${(wall/1000).toFixed(3)} active=${a} played=${played}/${r0.length} cur=${cur}`);
        lastKey = key;
      }
      if (a >= 0 && cur) dwell[a] = (dwell[a] || 0) + 1;
    }
  }
  console.log(`\n===== ${label} bpm=${bpm} sched=${schedMs} raf=${rafMs} step=${stepMs} =====`);
  console.log("row0 active seq(changes):");
  console.log(out.slice(0, 90).join("\n"));
  const seen = Object.keys(dwell).map(Number).sort((a, b) => a - b);
  console.log("cells that were ACTIVE while row0 current:", seen.join(","));
  console.log("cell14 active frames =", dwell[14] || 0, ", cell15 active frames =", dwell[15] || 0);
}

run("two-clock-1ms-120bpm", 120, 25, 16.7, 1, 2.2);
