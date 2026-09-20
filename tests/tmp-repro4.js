"use strict";
const { loadApp, FakeAudioContext } = require("./lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

const { beat, els } = loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 0 } }), { seedDemo: false });
const boxOf = () => els["presetList"].children.find(x => /(^| )preset-demo-group( |$)/.test(x.className));
const playAllOf = () => boxOf().children.find(x => /(^| )demo-play-row( |$)/.test(x.className)).children[0];
playAllOf().fire("click");
const ac = FakeAudioContext.last;

const rowsOf = () => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const cls = el => el.className || "";
const activeIdx = r => r.children.findIndex(c => /(^| )active( |$)/.test(cls(c)));

const seen = new Set();
let lastKey = "";
console.log("bpm=", beat.Store.S.bpm, "playing=", beat.Store.S.playing, "mode=", beat.Store.S.playMode);
for (let i = 0; i < 200; i++){          // 4.0s
  ac.currentTime += 0.02;
  beat.AudioEngine.scheduler();
  beat.Viz.paintFrame();
  const rs = rowsOf();
  const cur = rs.findIndex(r => /(^| )current( |$)/.test(cls(r)));
  const a0 = activeIdx(rs[0] || { children: [] });
  if (cur === 0 && a0 >= 0) seen.add(a0);
  const key = `${cur}:${a0}:${rs.length}`;
  if (key !== lastKey){
    console.log(`t=${ac.currentTime.toFixed(2)} rows=${rs.length} cur=${cur} activeRow0=${a0}`);
    lastKey = key;
  }
}
console.log("row0 active indices ever seen:", [...seen].sort((a, b) => a - b).join(","));
beat.Controls.stop();
