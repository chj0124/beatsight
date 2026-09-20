/* 临时复现脚本：整首连播示例曲 → 第一小节（行0，16 格）动画是否跳过最后两个十六分音符 */
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

function trace(label, schedMs, rafMs, stepMs, seconds){
  const { beat, ac } = enter();
  const cells = () => beat.Viz.internals().cellEls;
  const rowCls = b => (cells()[b] || []).map(c => c.className);
  const out = [];
  let tSched = 0, tRaf = 0;
  const N = Math.round(seconds / (stepMs / 1000));
  let lastKey = "";
  for (let i = 0; i < N; i++){
    const wall = i * stepMs;
    ac.currentTime = wall / 1000;
    if (wall - tSched >= schedMs - 1e-9){ tSched = wall; try { beat.AudioEngine.scheduler(); } catch (e) { out.push("SCHEDERR " + e.message); } }
    if (wall - tRaf >= rafMs - 1e-9){ tRaf = wall; try { beat.Viz.paintFrame(); } catch (e) { out.push("RAFERR " + e.message); } }
    if (!beat.Store.S.playing) { out.push(`stopped@${(wall/1000).toFixed(3)}`); break; }
    const r0 = rowCls(0);
    if (r0.length){
      const active = r0.findIndex(c => /(^| )active( |$)/.test(c));
      const played = r0.filter(c => /(^| )played( |$)/.test(c)).length;
      const key = active + "|" + played;
      if (key !== lastKey){
        out.push(`t=${(wall/1000).toFixed(3)} active=${active} played=${played}/${r0.length}`);
        lastKey = key;
      }
    }
  }
  const maxPlayed = Math.max(0, ...out.map(l => { const m = /played=(\d+)\//.exec(l); return m ? +m[1] : 0; }));
  console.log(`\n===== ${label} (sched=${schedMs} raf=${rafMs} step=${stepMs}) =====`);
  console.log(`bpm=${beat.Store.S.bpm} sig=${beat.Store.S.sig} maxPlayedOnRow0=${maxPlayed}`);
  console.log(out.slice(0, 80).join("\n"));
}

trace("lockstep-1ms", 25, 16.7, 1, 6);
trace("two-clock-1ms", 25, 16.7, 1, 6);
trace("two-clock-0.5ms", 25, 16.7, 0.5, 6);
trace("lockstep-20ms", 25, 16.7, 20, 6);
