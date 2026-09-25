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
/* ★ match(...)[1] 必须先判空：文件不存在 / 不是 BeatSight 产物 / 被裁剪掉 <script> 时，
   match 返回 null，`null[1]` 会抛 "Cannot read properties of null"——一个完全指错方向的崩溃
   （看起来像探针代码有 bug，实际是**输入文件不对**）。这里显式报"输入/工具故障"并以退出码 4
   交给 hang-guard（它会按工具故障记账，不再伪装成死循环或用例失败）。 */
const html = fs.readFileSync(HTML, "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch){
  console.error("✗ 在 " + HTML + " 里找不到 <script>…</script> 块——不是 BeatSight 产物或已被裁剪。");
  console.error("  BEATSIGHT_HTML 是否指错了文件？（这是输入/工具故障，不是用例失败）");
  process.exit(4);
}
const SRC = scriptMatch[1];

/* ---------------- DOM / 音频 stub（与 run.js 同口径的最小复刻） ---------------- */
function makeEl(id){
  const el = {
    _id:id,_h:{},children:[],
    /* v2.26.1：与 tests/lib/harness.js 同口径补 setProperty —— 格子填充层改成 .cell::before
       之后推进量走 CSS 变量 --f，而自定义属性只能 setProperty 写。本文件自带一份极简 DOM 桩
       （不复用 harness），所以这里也要补，否则"播放未中断"整组会静默变红。 */
    style:new Proxy({},{get:(t,k)=>{
      if(k==="setProperty")return (n,v)=>{t[n]=String(v);};
      if(k==="getPropertyValue")return n=>(n in t?t[n]:"");
      if(k==="removeProperty")return n=>{const v=t[n];delete t[n];return v||"";};
      return (k in t?t[k]:"");
    },set:(t,k,v)=>{t[k]=v;return true;}}),
    classList:{_s:new Set(),add(...c){c.forEach(x=>this._s.add(x));},remove(...c){c.forEach(x=>this._s.delete(x));},
      toggle(c,f){(f===undefined?!this._s.has(c):!!f)?this._s.add(c):this._s.delete(c);},contains(c){return this._s.has(c);}},
    dataset:{},textContent:"",value:"",className:"",innerHTML:"",title:"",hidden:false,disabled:false,
    /* v2.4.3：真实 <select> 的 `.options` **就是**它的 option 子元素集合（同一份数据两个视图）。
       本桩此前没有这个 getter，而 syncLoopUI 会读 `sel.options.length` 做"选项已建好就不再重建"
       的幂等判据 → 桩里读到 undefined、`.length` 抛 TypeError，**每个用例一开播就崩**，
       表现是"无输出（进程异常退出）"（看门狗因此全红：16/16）。
       ★ 教训：桩与真实 DOM 的**接口面**必须对齐，只补需要的字段会持续漏。
         这里照 tests/lib/harness.js 的同一口径从 children 派生，不另存一份 */
    get options(){ return this.children.filter(c=>c.tagName==="OPTION"); },
    offsetWidth:0,offsetHeight:0,offsetLeft:0,offsetTop:0,scrollWidth:0,
    addEventListener(t,f){(this._h[t]=this._h[t]||[]).push(f);},removeEventListener(){},
    appendChild(c){
      /* v2.4.4：DocumentFragment 语义同 harness——append 片段 = 子节点摊平搬家 */
      if(c&&c._isFragment){const kids=c.children.slice();c.children.length=0;kids.forEach(k=>this.appendChild(k));return c;}
      this.children.push(c);return c;
    },setAttribute(k,v){this[k]=v;},
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
  /* v2.4.1：这些用例判的是「脏数据会不会把主线程卡死」，不是「首次打开带不带出示例曲」。
     沙箱 localStorage 初始为空 → 会走 index.html 的**首次打开**分支，静默带出 7 个
     《在他乡》示例节奏型，从而污染期望值（customs_empty_bar 就要求被淘汰后
     `customs.length === 0`，带出后变成 7 → 假失败）。
     所以这里显式落「示例曲已带出」的闩，把沙箱摆成**老设备**的样子——与
     tests/lib/harness.js 的 seedDemo 默认值同一口径（见 tests/README.md）。 */
  store.set("beatsight.demoSeeded", "1");
  const els = {}, iv = new Map(); let seq = 1;
  const sb = {
    console:{ log(){}, warn(){}, error(){} },
    localStorage:{getItem:k=>(store.has(k)?store.get(k):null),setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    document:{getElementById:id=>{if(!els[id])Object.assign(els[id]=makeEl(id),id==="bpmSlider"?{min:"30",max:"240",value:"96"}:{});return els[id];},
      createElement:t=>Object.assign(makeEl("dyn"),{tagName:String(t||"").toUpperCase()}),
      /* v2.4.4：DocumentFragment 桩（与 harness.js 同口径；Editor/Arrange 批量插入用） */
      createDocumentFragment:()=>Object.assign(makeEl("frag"),{_isFragment:true,tagName:"#fragment"}),
      querySelectorAll:()=>[],addEventListener(){},body:makeEl("body"),activeElement:{tagName:"DIV"}},
    AudioContext:FAC, setInterval:(f,m)=>{const i=seq++;iv.set(i,f);return i;}, clearInterval:i=>iv.delete(i),
    setTimeout:()=>0, clearTimeout(){}, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
    performance:{now:()=>Date.now()}, URL:{createObjectURL:()=>"blob:",revokeObjectURL(){}}, Blob, FileReader:function(){},
  };
  sb.window = sb; sb.window.addEventListener = () => {};
  /* v2.8.8：`window.__beat`（完整内部句柄）已改为**条件挂载**（只认 ?debug=1 或宿主预置的
     BEATSIGHT_TEST）。本文件**自带一份私有沙箱**、不走 tests/lib/harness.js——所以
     harness 里加的那个标记**覆盖不到这里**：漏了它，下面 `sb.window.__beat` 就是 undefined，
     看门狗每个用例都会以 "Cannot read properties of undefined" 崩掉。
     ★ 这是本仓库的一个已知陷阱：**同一个仓库里存在多份 DOM/存储 stub 时，任何"改默认行为"
       的改动都要把所有 stub 都过一遍**（判断依据是"谁构造了沙箱"，不是"谁在用沙箱"）。
       所以这一行不能删，也不能改成"从 harness 导入一个常量"——私有沙箱必须自己声明。 */
  sb.BEATSIGHT_TEST = true;
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
    try { beat.AudioEngine.scheduler(); } catch(e){ if(!firstErr) firstErr = "scheduler: " + e.message; }
    try { beat.Viz.paintFrame(); } catch(e){ if(!firstErr) firstErr = "paintFrame: " + e.message; }
    if (!beat.Store.S.playing) break;
  }
  return firstErr;
}
function out(ok, name, detail){ console.log((ok ? "PASS" : "FAIL") + "|" + name + "|" + (detail || "")); }

const seed = o => ({ "beatsight.m2": JSON.stringify(o) });
const SIGS = { sig_abc:"abc", sig_neg:-3, sig_big:99, sig_zero:0, sig_null:null, sig_bool:true };
const VOLS = { vol_big:1e6, vol_3:3, vol_neg:-5, vol_str:"x" };

/* v2.8.16（审计 P2-2）：本文件是这些探针的**实现真相源**，故用例清单也从这里出——
   hang-guard 不再自带一份 id/标签，改为 `--list` 向本文件索要，消除「两处清单各改一处」的漂移。
   格式：每行 `id|中文说明`，供调用方解析显示。顺序即 hang-guard 的执行顺序（保持历史输出稳定）。
   ★ 新增探针必须**同时**登记到 CASE_LIST（否则 hang-guard 看不到它）并补上对应分支
     （否则运行到它时会落进末尾的「未知用例」而失败）——两侧互为闸门。 */
const SIG_LABELS = {
  sig_abc:"脏拍号 abc", sig_neg:"脏拍号 -3（v1.2.3 实测主线程死循环）", sig_big:"脏拍号 99",
  sig_zero:"脏拍号 0", sig_null:"脏拍号 null", sig_bool:"脏拍号 true",
};
const VOL_LABELS = {
  vol_big:"音量 1e6（v1.2.3 实测 +120 dBFS）", vol_3:"音量 3", vol_neg:"音量 -5", vol_str:"音量 \"x\"",
};
const SPECIAL_LABELS = {
  customs_empty_bar:"空小节自定义预设",
  strum_vol_dirty:"脏扫弦音量（v2.5.0：第二个进热路径的声部音量，带弦区谱驱动）",
  pat_bars_max:"型长上限 64 小节（v2.5.1：长型必须「能跑」，不只是「能存」）",
  bpm_dirty:"脏 BPM",
  hunger_skip:"后台节流 10 分钟后回前台（追赶逻辑写成逐拍会死循环）",
  editor_clear_bar:"试听中清空小节（真实用户路径）",
  normal_path:"正常路径（守卫不得误伤）",
  dirty_misc:"脏重拍分组 / trainer 原型污染",
  arrange_range_dirty:"反向播放范围 from > to（v2.10.4：滑块让这对字段变成连续可写）",
  narrow_range_short_song:"范围短于窗口 + 全曲短于窗口（v2.10.8：新增「小节号↔行号」映射）",
};
const CASE_LIST = [
  ...Object.keys(SIGS).map(id => [id, SIG_LABELS[id]]),
  ["customs_empty_bar", SPECIAL_LABELS.customs_empty_bar],
  ...Object.keys(VOLS).map(id => [id, VOL_LABELS[id]]),
  ...["strum_vol_dirty", "pat_bars_max", "bpm_dirty", "hunger_skip",
      "editor_clear_bar", "normal_path", "dirty_misc", "arrange_range_dirty",
      "narrow_range_short_song"].map(id => [id, SPECIAL_LABELS[id]]),
];

/* `--list`：把清单吐给调用方（hang-guard），本模式不加载 index.html、不执行任何探针 */
if (CASE === "--list"){
  CASE_LIST.forEach(([id, label]) => console.log(id + "|" + label));
  process.exit(0);
}

if (CASE in SIGS){
  const v = SIGS[CASE];
  const { beat } = loadApp(seed({ sig: v }));
  const sig = beat.Store.S.sig;
  beat.Controls.start();
  const err = driveFrames(FAC.last, beat, 0.4);
  out([2,3,4,5,6,7].includes(sig), "脏拍号 " + CASE + " 被钳制到合法拍号", "S.sig=" + JSON.stringify(sig));
  out(!err, "脏拍号 " + CASE + " 渲染帧不抛异常", err || "OK");
  out(beat.Store.S.playing === true, "脏拍号 " + CASE + " 播放未中断", "playing=" + beat.Store.S.playing);

} else if (CASE === "hunger_skip"){
  /* v1.3.0（审计 P1-3）：后台被长时间节流后回前台，游标已落后几十秒。
     这条路径最容易写成死循环：如果"追赶"逻辑用 while 逐拍补排，而不是直接重新锚定，
     就会把过去几十秒的音符一个个排出来（甚至排不完）。用超时守它。 */
  const { beat } = loadApp(seed({ v: 3, bpm: 120, sig: 4 }));
  beat.Controls.start();
  const ac = FAC.last;
  driveFrames(ac, beat, 0.5);
  const before = ac.hits.length;
  ac.currentTime += 600;                     // 模拟被节流 10 分钟
  beat.AudioEngine.scheduler();                    // 若这里逐拍追赶 → 超时被强杀
  const n = ac.hits.length - before;
  out(n < 200, "饥饿兜底：单次调度排程量有界", "新增 " + n + " 条（不是逐拍追赶几百条）");
  const c = beat.clock();
  out(c.nextNoteTime >= ac.currentTime && c.loopStart >= ac.currentTime,
      "饥饿兜底：时间轴重新锚定到当前时刻",
      "游标-现在=" + (c.nextNoteTime - ac.currentTime).toFixed(3) + "s");

} else if (CASE === "customs_empty_bar"){
  const bad = { id:"z", name:"坏预设-空小节", meter:4, bars:[[],[],[],[]] };
  const { beat, store } = loadApp(seed({ v:3, customs:[bad], sel:{type:"custom",id:"z"} }));
  beat.Controls.start();
  const err = driveFrames(FAC.last, beat, 2);
  out(beat.Store.customs.length === 0, "空小节预设被结构校验淘汰", "customs=" + beat.Store.customs.length);
  out(!err, "空小节预设不崩渲染帧", err || "OK");
  out(store.has("beatsight.quarantine"), "淘汰项已隔离备份（可人工找回）",
      store.has("beatsight.quarantine") ? "beatsight.quarantine" : "无备份");

} else if (CASE in VOLS){
  const v = VOLS[CASE];
  RAMPS = [];
  /* sel idx 1（四分基础，无扫弦记谱）：本探针守的是**节拍声部**的 0 dBFS 上限。
     v2.7.1 起带扫弦记谱的谱（如民谣扫弦）归扫弦声部——那条路径的峰值上限是 makeup（=8），
     安全性论证见 CONFIG.timbres 注释（削波看信号幅度，不看增益值），混进来会误报 */
  const { beat } = loadApp(seed({ v:3, vol:v, accentVol:1, bpm:120, sel:{ type:"builtin", idx:1 } }));
  const vol = beat.Store.S.vol;
  beat.Controls.start();
  const ac = FAC.last;
  for (let i = 0; i < 60; i++){ ac.currentTime += 0.02; beat.AudioEngine.scheduler(); }
  const valid = RAMPS.filter(x => x > 0.0002);
  const max = valid.length ? Math.max(...valid) : 0;
  out(vol >= 0 && vol <= 1, "音量 " + CASE + " 钳制到 [0,1]", "S.vol=" + vol);
  out(max <= 1.0000001, "音量 " + CASE + " 增益不超 0 dBFS",
      "峰值 " + (max ? max.toFixed(3) + " (" + (20*Math.log10(max)).toFixed(1) + " dBFS)" : "静音兜底"));

} else if (CASE === "strum_vol_dirty"){
  /* v2.5.0：扫弦声部音量（S.strumVol）是**第二个**进入 scheduler 热路径的声部数值，
     与 vol 同一类风险：脏值不得把增益送出天文数字，也不得让主线程卡住。
     ★ 必须同时带上"带弦区记谱的谱"——那条路径才会真的走到 strumZoneHit；
       不带弦区的谱走的是节拍声部，测不到 strumVol 那条分支（会变成假绿）。
     谱：16 格十六分，只第 1 格带 zone（小节和 = 16×12 = 192 才过结构校验） */
  const bars = [0,1,2,3].map(() => Array.from({ length: 16 }, (_, i) =>
    i === 0 ? { t: 12, dir: "D", zone: 0 } : { t: 12, rest: true }));
  RAMPS = [];
  const { beat } = loadApp(seed({ v:3, strumVol:1e6, vol:0.8, accentVol:1, bpm:120,
    customs:[{ id:"sv", name:"带弦区谱", meter:4, bars }], sel:{ type:"custom", id:"sv" } }));
  const sv = beat.Store.S.strumVol;
  beat.Controls.start();
  const ac = FAC.last;
  const err = driveFrames(ac, beat, 1.5);
  const valid = RAMPS.filter(x => x > 0.0002);
  const max = valid.length ? Math.max(...valid) : 0;
  out(sv >= 0 && sv <= 1, "脏扫弦音量钳制到 [0,1]", "S.strumVol=" + JSON.stringify(sv));
  out(!err, "脏扫弦音量不崩渲染帧", err || "OK");
  /* 扫弦声部带 makeup 增益（strumZones.makeup = 8），所以上界是 makeup 而不是 1：
     该路径的合法天花板 = 满音量 × makeup。断言写 makeup 本身，不写死 8 的"大概值"以外的数——
     削波看信号幅度不看增益值，这条补的是"不能因为脏值再放大一轮" */
  out(max <= 8.0000001, "脏扫弦音量下增益不越过该路径的合法天花板",
      "峰值 " + (max ? max.toFixed(3) : "静音兜底"));
  out(ac.hits.length > 0, "脏扫弦音量下仍能发声", "发声 " + ac.hits.length + " 次");

} else if (CASE === "pat_bars_max"){
  /* v2.5.1：型的小节数放开到 MAX_PAT_BARS(=64) 之后，长型必须是"**能跑**"而不只是"能存"。
     这条路径最可能出的问题不是崩而是慢：调度器每轮要沿型内小节环绕（predictNext 从 4 次
     变 64 次）、重绘要面向 64 行；脏数据与长型叠加能把主线程拖死。
     谱：64 小节 × 每小节 4 个四分（和 = 192 = 4×TPB，过结构校验）。 */
  const bars = [];
  for (let i = 0; i < 64; i++) bars.push([{t:48},{t:48},{t:48},{t:48}]);
  const { beat } = loadApp(seed({ v:3, bpm:120,
    customs:[{ id:"long", name:"六十四小节", meter:4, bars }], sel:{ type:"custom", id:"long" } }));
  out(beat.patBars(beat.curPattern()) === 64, "64 小节的型通过校验并生效",
      "bars.length=" + beat.curPattern().bars.length);
  beat.Controls.start();
  const ac = FAC.last;
  const err = driveFrames(ac, beat, 1.5);
  out(!err, "长型不崩渲染帧", err || "OK");
  out(ac.hits.length > 0, "长型仍在发声", "发声 " + ac.hits.length + " 次");
  out(beat.Store.S.playing === true, "长型播放未中断", "");

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
    /* v2.11.2：起始 BPM 参数已删，探针同步改为「everyN 仍是默认 4 且 start 字段根本不存在」
       ——原型污染想塞进来的 start 连字段都不该有（白名单抽取，不进 S.trainer）。 */
    trainer: JSON.parse('{"__proto__":{"everyN":1,"start":30}}') }));
  out(JSON.stringify(beat.curPattern().accents) === JSON.stringify([0,2]),
      "脏重拍分组被丢弃、回退默认 2+3", "accents=" + JSON.stringify(beat.curPattern().accents));
  out(beat.Store.S.trainer.everyN === 4 && !("start" in beat.Store.S.trainer),
      "trainer 原型污染未生效",
      "everyN=" + beat.Store.S.trainer.everyN + " / start=" + beat.Store.S.trainer.start);

} else if (CASE === "arrange_range_dirty"){
  /* v2.10.4：侧栏「播放范围」双滑块把 S.arrangeSel.from/to 变成了**连续可写**的一对字段
     ——这是它相较原来 10 颗段号胶囊（只能 from === to）新增的风险面。
     `from > to` 是本项目明写过的死循环形态（见 Store.clampLoop 的注释：两个独立钳制
     各自都合法，合起来却是空区间，调度器会算出"永远到不了 to"从而卡住主线程）。
     本探针在**加载之后**直接把反向区间写进 S（模拟滑块钳制失效 / 将来某个新入口漏钳），
     再驱动播放：若调度器靠逐小节追赶来兜，这里会被超时强杀。
     ★ 刻意不 seed 已经反向的持久数据：Store 加载期本就有双向归一
       （arrTo 取 Math.max(arrFrom, …)），过一遍加载就被修好了，测不到运行期这条。
     ★ 也刻意**不依赖示例曲**：本文件的 loadApp 落了「示例已带出」的闩（见其注释），
       所以这里自带一条三段曲式，用 builtin 引用（不需要额外 seed customs）。 */
  const sec = nm => ({ name: nm, blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1 }] });
  const { beat } = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "a1", name: "三段测试曲式", sections: [sec("一"), sec("二"), sec("三")] }] }),
    "beatsight.state": JSON.stringify({ v: 3, playMode: "arrange",
      arrangeSel: { id: "a1", from: 0, to: 2, loop: true, byLyric: false } }),
  });
  const a = beat.Store.findArrange("a1");
  out(!!a, "前提：三段曲式已在库里", a ? a.sections.length + " 段" : "缺失");
  if (a){
    beat.Controls.stop();                                  // 幂等：确保停止态再写脏值
    beat.Store.S.arrangeSel.from = 2;                      // 第 3 小节（v2.10.7 小节口径）
    beat.Store.S.arrangeSel.to = 0;                        // 第 1 小节 —— 反向
    beat.Controls.start();
    const err = driveFrames(FAC.last, beat, 1.5);          // 区间不归一 → 这里挂住被强杀
    out(!err, "反向区间不崩渲染帧", err || "OK");
    out(beat.Store.S.playing === true, "反向区间播放未中断", "playing=" + beat.Store.S.playing);
    out(FAC.last.hits.length > 0, "反向区间仍在发声（不是静默空转）", FAC.last.hits.length + " 次");
  }

} else if (CASE === "narrow_range_short_song"){
  /* v2.10.8：渲染层新增了一层「歌曲小节号 → 窗口行号」映射（Viz.rowOfSongBar /
     arrNextRowOf），它有两处必须配对成立的易错点：
       ① 行号 = 小节号 − 窗口起点，而 arrWindowPat 在**全曲短于窗口 / 走到曲尾**时会
          绕回重复铺行（`songBarAt(a, (winStart + i) % total)`）→ 必须按 songBars 取模；
       ② 结果行号必须落在 [0, 窗口长度)。
     本探针把这两个前提同时构造到极端：**全曲只有 1 小节**（窗口 4 行全是同一小节，
     `% total` 的模数退化成 1）+ **播放范围也正好是那 1 小节**（循环回卷 → "下一小节"
     就是当前小节自己）。预期不挂；若取模/钳制被写成会自增或回卷不收敛的形态，
     这里会被超时强杀（这类缺陷同进程内打断不了，只能靠子进程 + 超时）。 */
  const ONE = { id: "one", name: "一小节", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] };
  const { beat } = loadApp({
    "beatsight.customs": JSON.stringify({ v: 1, customs: [ONE] }),
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "a1", name: "一小节曲式", sections: [{ name: "唯一", blocks: [
        { ref: { type: "custom", id: "one" }, repeats: 1 }] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "a1", from: 0, to: 0, loop: true, byLyric: false } }),
  });
  const a = beat.Store.findArrange("a1");
  out(!!a, "前提：一小节曲式已在库里", a ? a.sections.length + " 段" : "缺失");
  if (a){
    out(beat.Viz.arrWinBars() === 4, "前提：窗口 4 行 > 全曲 1 小节（窗口会绕回重复铺行）",
        "arrWinBars=" + beat.Viz.arrWinBars());
    beat.Controls.start();
    const err = driveFrames(FAC.last, beat, 1.2);
    out(!err, "范围短于窗口 + 全曲短于窗口：渲染帧不抛", err || "OK");
    out(beat.Store.S.playing === true, "播放未中断", "playing=" + beat.Store.S.playing);
    out(FAC.last.hits.length > 0, "仍在发声（不是静默空转）", FAC.last.hits.length + " 次");
  }

} else {
  console.error("未知用例 " + CASE); process.exit(2);
}
