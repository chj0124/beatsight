/* 单用例探针（供 hang-guard.js 以子进程方式调用）：node tests/hang-case.js <caseId>
   ---------------------------------------------------------------------------
   为什么单独成文件：本项目有一类缺陷是「主线程死循环」（v1.2.3 的 sig:-3 会让
   scheduler 的空小节分支永不推进）。这类缺陷**同进程内无法打断**——单线程被占死时
   setTimeout 看门狗根本轮不到执行，所以只能在**另一个进程里跑 + 超时强杀**，
   「被强杀」本身就是判定依据。

   用例覆盖的都是「JSON 合法但值非法」的持久数据，以及一条纯正常操作就能触发的路径
   （试听中清空小节）。判定口径与 tests/run.js 的 T23 系列一致，但这里额外带超时保护。
   ---------------------------------------------------------------------------
   输出格式：每行 `PASS|名称|详情` 或 `FAIL|名称|详情`，供调用方解析。 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const CASE = process.argv[2];
/* 默认测仓库里的 index.html；BEATSIGHT_HTML 可指向别的构建，
   便于拿历史版本验证「看门狗真的抓得住死循环」（见 tests/README.md）。 */
const HTML = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "index.html");
const SRC = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---------------- DOM / 音频 stub（与 run.js 同口径的最小复刻） ---------------- */
function makeEl(id){
  const el = {
    _id:id,_h:{},children:[],
    style:new Proxy({},{get:(t,k)=>(k in t?t[k]:""),set:(t,k,v)=>{t[k]=v;return true;}}),
    classList:{_s:new Set(),add(...c){c.forEach(x=>this._s.add(x));},remove(...c){c.forEach(x=>this._s.delete(x));},
      toggle(c,f){(f===undefined?!this._s.has(c):!!f)?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}},
    dataset:{},textContent:"",value:"",className:"",innerHTML:"",title:"",hidden:false,disabled:false,
    offsetWidth:0,offsetHeight:0,offsetLeft:0,offsetTop:0,scrollWidth:0,
    addEventListener(t,f){(this._h[t]=this._h[t]||[]).push(f);},removeEventListener(){},
    appendChild(c){this.children.push(c);return c;},setAttribute(k,v){this[k]=v;},
    getAttribute(k){return this[k]===undefined?null:this[k];},
    remove(){},blur(){},focus(){},animate(){},closest(){return makeEl("p");},
    fire(t,ev){(this._h[t]||[]).forEach(f=>f(Object.assign({currentTarget:el,target:el,
      preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}},ev)));},
  };
  return el;
}
let RAMPS = [];
class FP{constructor(v){this.value=v;}setValueAtTime(){}linearRampToValueAtTime(){}
  exponentialRampToValueAtTime(v){RAMPS.push(v);}}
class FN{constructor(c,k){this.frequency=new FP(0);this.gain=new FP(1);this.Q=new FP(0);this.type="";this._ctx=c;this._kind=k;this._dest=null;}
  connect(d){if(d&&d._kind)this._dest=d;}start(t){this._ctx.hits.push({t,kind:this._kind});}stop(){}}
class FAC{constructor(){this.currentTime=0;this.state="running";this.destination={};this.hits=[];this.sampleRate=48000;FAC.last=this;}
  createGain(){return new FN(this,"gain");}createOscillator(){return new FN(this,"osc");}createBiquadFilter(){return new FN(this,"filter");}
  createBuffer(c,l){return{getChannelData:()=>new Float32Array(l)};}createBufferSource(){return new FN(this,"noise");}resume(){}}

function loadApp(seed){
  const store = new Map(Object.entries(seed || {}));
  const els = {}, iv = new Map(); let seq = 1;
  const sb = {
    console:{ log(){}, warn(){}, error(){} },
    localStorage:{getItem:k=>(store.has(k)?store.get(k):null),setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    document:{getElementById:id=>{if(!els[id])Object.assign(els[id]=makeEl(id),id==="bpmSlider"?{min:"30",max:"240",value:"96"}:{});return els[id];},
      createElement:t=>Object.assign(makeEl("dyn"),{tagName:String(t||"").toUpperCase()}),
      querySelectorAll:()=>[],addEventListener(){},body:makeEl("body"),activeElement:{tagName:"DIV"}},
    AudioContext:FAC, setInterval:(f,m)=>{const i=seq++;iv.set(i,f);return i;}, clearInterval:i=>iv.delete(i),
    setTimeout:()=>0, clearTimeout(){}, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
    performance:{now:()=>Date.now()}, URL:{createObjectURL:()=>"blob:",revokeObjectURL(){}}, Blob, FileReader:function(){},
  };
  sb.window = sb; sb.window.addEventListener = () => {};
  vm.createContext(sb);
  new vm.Script(SRC, { filename:"inline.js" }).runInContext(sb);
  return { beat: sb.window.__beat, els, store };
}

/* 逐帧驱动：音频时钟与渲染帧同时推进（贴近真实），首个小异常即记录并继续 */
function driveFrames(ac, beat, seconds){
  const dt = 0.02, n = Math.ceil(seconds / dt);
  let firstErr = null;
  for (let i = 0; i < n; i++){
    ac.currentTime += dt;
    try { beat.Audio.scheduler(); } catch(e){ if(!firstErr) firstErr = "scheduler: " + e.message; }
    try { beat.Viz.paintFrame(); } catch(e){ if(!firstErr) firstErr = "paintFrame: " + e.message; }
    if (!beat.Store.S.playing) break;
  }
  return firstErr;
}
function out(ok, name, detail){ console.log((ok ? "PASS" : "FAIL") + "|" + name + "|" + (detail || "")); }

const seed = o => ({ "beatsight.m2": JSON.stringify(o) });
const SIGS = { sig_abc:"abc", sig_neg:-3, sig_big:99, sig_zero:0, sig_null:null, sig_bool:true };
const VOLS = { vol_big:1e6, vol_3:3, vol_neg:-5, vol_str:"x" };

if (CASE in SIGS){
  const v = SIGS[CASE];
  const { beat } = loadApp(seed({ sig: v }));
  const sig = beat.Store.S.sig;
  beat.Controls.start();
  const err = driveFrames(FAC.last, beat, 0.4);
  out([2,3,4,5,6,7].includes(sig), "脏拍号 " + CASE + " 被钳制到合法拍号", "S.sig=" + JSON.stringify(sig));
  out(!err, "脏拍号 " + CASE + " 渲染帧不抛异常", err || "OK");
  out(beat.Store.S.playing === true, "脏拍号 " + CASE + " 播放未中断", "playing=" + beat.Store.S.playing);

} else if (CASE === "customs_empty_bar"){
  const bad = { id:"z", name:"坏预设-空小节", meter:4, bars:[[],[],[],[]] };
  const { beat, store } = loadApp(seed({ v:3, customs:[bad], sel:{type:"custom",id:"z"} }));
  beat.Controls.start();
  const err = driveFrames(FAC.last, beat, 2);
  out(beat.Store.customs.length === 0, "空小节预设被结构校验淘汰", "customs=" + beat.Store.customs.length);
  out(!err, "空小节预设不崩渲染帧", err || "OK");
  out(store.has("beatsight.m2.quarantine"), "淘汰项已隔离备份（可人工找回）",
      store.has("beatsight.m2.quarantine") ? "beatsight.m2.quarantine" : "无备份");

} else if (CASE in VOLS){
  const v = VOLS[CASE];
  RAMPS = [];
  const { beat } = loadApp(seed({ v:3, vol:v, accentVol:1, bpm:120 }));
  const vol = beat.Store.S.vol;
  beat.Controls.start();
  const ac = FAC.last;
  for (let i = 0; i < 60; i++){ ac.currentTime += 0.02; beat.Audio.scheduler(); }
  const valid = RAMPS.filter(x => x > 0.0002);
  const max = valid.length ? Math.max(...valid) : 0;
  out(vol >= 0 && vol <= 1, "音量 " + CASE + " 钳制到 [0,1]", "S.vol=" + vol);
  out(max <= 1.0000001, "音量 " + CASE + " 增益不超 0 dBFS",
      "峰值 " + (max ? max.toFixed(3) + " (" + (20*Math.log10(max)).toFixed(1) + " dBFS)" : "静音兜底"));

} else if (CASE === "bpm_dirty"){
  const { beat } = loadApp(seed({ bpm:"abc" }));
  beat.Controls.start();
  const ac = FAC.last;
  const err = driveFrames(ac, beat, 1.5);
  out(!err, "脏 BPM 不崩", err || "OK");
  out(ac.hits.length > 0, "脏 BPM 仍能发声", "S.bpm=" + beat.Store.S.bpm + " / 发声 " + ac.hits.length + " 次");

} else if (CASE === "editor_clear_bar"){
  /* 真实用户路径：试听中「清空当前小节」→ 草稿出现空小节 → 渲染帧必然经过它 */
  const { beat, els } = loadApp();
  beat.Editor.open();
  els["auditionBtn"].fire("click");
  const ac = FAC.last;
  driveFrames(ac, beat, 0.3);
  els["clearBarBtn"].fire("click");
  els["modalOk"].fire("click");
  const n = beat.Editor.draft().bars[0].length;
  const err = driveFrames(ac, beat, 6);
  out(n === 0, "草稿第 1 小节已被清空", "剩余音符 " + n);
  out(!err, "试听中清空小节（真实用户路径）不崩", err || "OK");

} else if (CASE === "normal_path"){
  const { beat, els } = loadApp();
  beat.Controls.start();
  const ac = FAC.last;
  const err = driveFrames(ac, beat, 3);
  const status = els["statusText"].textContent;
  out(!err, "正常路径渲染帧无异常", err || "OK");
  out(/^(播放中 · 第 [1-4] 小节 · \d|静音拍)/.test(status), "正常路径状态栏照常推进", status);
  out(ac.hits.length > 0, "正常路径持续发声", ac.hits.length + " 次");
  out(beat.Store.S.playing === true, "正常路径仍在播放", "");

} else if (CASE === "dirty_misc"){
  const { beat } = loadApp(seed({ v:3, sig:5, accentGrp:{ "5":99, "7":"x" },
    trainer: JSON.parse('{"__proto__":{"everyN":1,"start":30}}') }));
  out(JSON.stringify(beat.curPattern().accents) === JSON.stringify([0,2]),
      "脏重拍分组被丢弃、回退默认 2+3", "accents=" + JSON.stringify(beat.curPattern().accents));
  out(beat.Store.S.trainer.everyN === 4 && beat.Store.S.trainer.start === 70,
      "trainer 原型污染未生效",
      "everyN=" + beat.Store.S.trainer.everyN + " / start=" + beat.Store.S.trainer.start);

} else {
  console.error("未知用例 " + CASE); process.exit(2);
}
