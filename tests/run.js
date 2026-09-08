/* ================================================================================
   BeatSight 持久化自动化测试（v0.6.0 起）
   运行：node tests/run.js
   原理：从 index.html 提取内联脚本，在 Node vm 沙箱中运行——
     · localStorage：Map 实现，可按场景预置数据（容错 / 迁移 / 脏项回退）
     · DOM：按 id 缓存的元素 stub，addEventListener 存 handler 供测试触发
     · AudioContext：伪造实现，currentTime 手动推进，逐 tick 驱动 scheduler()；
       osc.start(t) 记录 {t, freq, type} 供 swing/重拍断言
     · rAF 置空：paintFrame 不运行，测试只断言引擎与状态层
   断言对象的获取：脚本末尾的 window.__beat 调试句柄暴露全部模块接口。
   ================================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error("index.html 中未找到 <script> 块"); process.exit(1); }
const SRC = m[1];

/* ---------------- DOM / 浏览器环境 stub ---------------- */
function makeEl(id){
  const el = {
    _id: id, _h: {},
    children: [],
    style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : ""), set: (t, k, v) => { t[k] = v; return true; } }),
    classList: {
      _s: new Set(),
      add(...c){ c.forEach(x => this._s.add(x)); },
      remove(...c){ c.forEach(x => this._s.delete(x)); },
      toggle(c, f){ (f === undefined ? !this._s.has(c) : !!f) ? this._s.add(c) : this._s.delete(c); },
      contains(c){ return this._s.has(c); },
    },
    dataset: {},
    textContent: "", value: "", className: "", innerHTML: "", title: "",
    hidden: false, disabled: false,
    offsetWidth: 0, offsetHeight: 0, offsetLeft: 0, offsetTop: 0, scrollWidth: 0,
    addEventListener(t, f){ (this._h[t] = this._h[t] || []).push(f); },
    removeEventListener(){},
    appendChild(c){ this.children.push(c); return c; },
    remove(){}, blur(){}, focus(){}, animate(){},
    closest(){ return makeEl("closest-proxy"); },   // 近似真实 DOM：返回带 classList 的祖先代理
    /* 测试辅助：触发已绑定的事件 */
    fire(t, ev){
      (this._h[t] || []).forEach(f => f(Object.assign({
        currentTarget: el, target: el,
        preventDefault(){}, stopPropagation(){}, stopImmediatePropagation(){},
      }, ev)));
    },
  };
  return el;
}

class FakeParam {
  constructor(v){ this.value = v; }
  setValueAtTime(){} linearRampToValueAtTime(){}
  exponentialRampToValueAtTime(v){ this._rampTo = v; }   // v0.8.0：记录扫频目标（鼓组底鼓断言用）
}
class FakeNode {
  constructor(ctx, kind){ this.frequency = new FakeParam(0); this.gain = new FakeParam(1); this.Q = new FakeParam(0); this.type = ""; this._ctx = ctx; this._kind = kind; this._dest = null; }
  connect(d){ if (d && d._kind) this._dest = d; }
  start(t){
    if (this._kind === "osc") this._ctx.hits.push({ t, kind: "osc", freq: this.frequency.value, type: this.type, sweepTo: this.frequency._rampTo });
    if (this._kind === "noise") this._ctx.hits.push({ t, kind: "noise", filterType: this._dest && this._dest.type, filterFreq: this._dest && this._dest.frequency.value });
  }
  stop(){}
}
class FakeAudioContext {
  constructor(){ this.currentTime = 0; this.state = "running"; this.destination = {}; this.hits = []; this.sampleRate = 48000; FakeAudioContext.last = this; }
  createOscillator(){ return new FakeNode(this, "osc"); }
  createGain(){ return new FakeNode(this, "gain"); }
  createBiquadFilter(){ return new FakeNode(this, "filter"); }
  createBuffer(ch, len, rate){ return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource(){ return new FakeNode(this, "noise"); }
  resume(){}
}

/* 以指定 localStorage 预置数据加载应用，返回 {beat, els, sandbox, storage} */
function loadApp(seed){
  const store = new Map(Object.entries(seed || {}));
  const els = {};
  const intervals = new Map();
  let timerSeq = 1;

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      getElementById: id => (els[id] = els[id] || makeEl(id)),
      createElement: () => makeEl("dyn"),
      querySelectorAll: () => [],
      addEventListener(){},
      body: makeEl("body"),
      activeElement: { tagName: "DIV" },
    },
    AudioContext: FakeAudioContext,
    setInterval: (fn, ms) => { const id = timerSeq++; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: () => 0,            // 测试环境不真的延迟执行（tap 复位等无关紧要）
    clearTimeout(){},
    requestAnimationFrame: () => 0, // paintFrame 不运行：测试只断言引擎与状态层
    cancelAnimationFrame(){},
    performance: { now: () => Date.now() },
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL(){} },
    Blob,
    FileReader: function(){},
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  new vm.Script(SRC, { filename: "index.inline.js" }).runInContext(sandbox);
  const beat = sandbox.window.__beat;
  if (!beat) throw new Error("window.__beat 调试句柄未暴露——模块化装配失败");
  return { beat, els, sandbox, storage: store };
}

/* ---------------- 断言辅助 ---------------- */
let pass = 0, fail = 0;
const failNames = [];
function ok(cond, name){
  if (cond){ pass++; console.log("  ✓ " + name); }
  else { fail++; failNames.push(name); console.log("  ✗ " + name); }
}
function eq(actual, expect, name){ ok(actual === expect, `${name}（期望 ${JSON.stringify(expect)}，实际 ${JSON.stringify(actual)}）`); }
function near(actual, expect, eps, name){ ok(Math.abs(actual - expect) < eps, `${name}（期望 ≈${expect}，实际 ${actual}）`); }
function section(t){ console.log("\n■ " + t); }

/* 驱动播放：每次推进音频时钟 dt 秒并手动调度，直到停止或超步 */
function drive(ctx, beat, seconds, onTick){
  const dt = 0.02;
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++){
    ctx.currentTime += dt;
    beat.Audio.scheduler();
    if (onTick) onTick();
    if (!beat.Store.S.playing) return true;
  }
  return false;
}

/* ================= 场景 T1：localStorage 坏 JSON 容错 ================= */
section("T1 Store · 坏 JSON 回退默认，不白屏");
{
  const { beat } = loadApp({ "beatsight.m2": "{bad json,," });
  const S = beat.Store.S;
  eq(S.bpm, 96, "坏数据时 BPM 回退默认 96");
  eq(S.sig, 4, "坏数据时拍号回退 4");
  eq(S.trainer.start, 70, "坏数据时 trainer.start 默认 70");
  eq(S.trainer.everyN, 4, "坏数据时 trainer.everyN 默认 4");
}

/* ================= 场景 T2：trainer 脏项回退 ================= */
section("T2 Store · trainer 缺项/脏项回退默认值");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ trainer: { start: 80, step: "x", everyN: null } }) });
  const t = beat.Store.S.trainer;
  eq(t.start, 80, "合法 start 保留");
  eq(t.step, 4, "非数字 step 回退默认 4");
  eq(t.everyN, 4, "null everyN 回退默认 4");
  eq(t.target, 120, "缺失 target 回退默认 120");
  eq(t.on, false, "缺失 on 回退 false");
}

/* ================= 场景 T3：变速训练爬坡序列（v0.5.0 核心回归） ================= */
section("T3 Trainer · 爬坡序列 70→80→90→95 + 完成自动停止");
{
  const { beat, els } = loadApp({ "beatsight.m2": JSON.stringify({
    trainer: { on: true, start: 70, target: 95, step: 10, everyN: 2 },
  })});
  const S = beat.Store.S;
  beat.Controls.start();
  ok(S.playing, "训练开启时点播放：从起始速度起步");
  eq(S.bpm, 70, "起步 BPM = 起始 70");
  const ac = FakeAudioContext.last;   // start() 内 ensureCtx 创建的实例
  ok(!!ac, "AudioContext 已被创建");
  const seq = [S.bpm];
  const stopped = drive(ac, beat, 40, () => { if (S.bpm !== seq[seq.length - 1]) seq.push(S.bpm); });
  ok(stopped, "练到目标后自动停止");
  eq(JSON.stringify(seq), JSON.stringify([70, 80, 90, 95]), "爬坡序列 70→80→90→95");
  eq(els["statusText"].textContent, "训练完成 · 达到 95 BPM", "完成提示文案");
  eq(S.playing, false, "完成后 playing=false");
}

/* ================= 场景 T4：训练参数钳制 ================= */
section("T4 Trainer · 参数钳制与目标>起始约束");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  els["trStart"].value = "999";
  els["trStart"].fire("change");
  eq(S.trainer.start, 236, "起始超上限钳到 236");
  eq(S.trainer.target, 237, "目标被抬回 起始+1（237）");
  eq(els["trTarget"].value, 237, "目标输入框同步 237");
  els["trTarget"].value = "150";
  els["trTarget"].fire("change");
  eq(S.trainer.target, 237, "目标改到低于起始再次被抬回 237");
  els["trStart"].value = "abc";
  els["trStart"].fire("change");
  eq(S.trainer.start, 236, "非数字输入回退原值 236");
  els["trEvery"].value = "0";
  els["trEvery"].fire("change");
  eq(S.trainer.everyN, 1, "每级小节数下限钳到 1");
}

/* ================= 场景 T5：预设导入导出（v0.7.0：tick 制 + v1 旧格式兼容） ================= */
section("T5 Store · 预设导入导出校验（tick 制）");
{
  const { beat } = loadApp();
  const Store = beat.Store;
  ok(Store.importPresets("not json").ok === false, "非 JSON 拒绝");
  ok(Store.importPresets('{"foo":1}').ok === false, "无 presets 字段拒绝");
  ok(Store.importPresets('{"presets":[]}').ok === false, "空数组拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars: [[{ t: 14 }], [], [], []] }] })).ok === false,
     "非法时值 t=14（不在合法 tick 集合）拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }], [], [], []] }] })).ok === false,
     "小节时值不足 4 拍拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 8, bars: [[{ t: 48 }], [], [], []] }] })).ok === false,
     "拍号 8（未开放）拒绝");

  const good = { app: "beatsight", kind: "presets", v: 2, presets: [
    { name: "测试 · 摇滚", meter: 4, bars: [0,1,2,3].map(() => Array.from({ length: 8 }, () => ({ t: 24, rest: false }))) },
    { name: "测试 · 6/8", meter: 6, bars: [0,1,2,3].map(() => Array.from({ length: 4 }, () => ({ t: 72, rest: false }))) },
  ]};
  const r1 = Store.importPresets(JSON.stringify(good));
  ok(r1.ok && r1.count === 2, "合法 v2（tick）文件导入 2 个预设");
  eq(Store.customs.length, 2, "customs 增至 2");
  ok(Store.customs.every(c => typeof c.id === "string" && c.id.startsWith("c")), "导入后 id 重新生成");

  /* v0.7.0：拍号 5/7 开放 */
  const odd = { presets: [{ name: "测试 · 5/4", meter: 5, accents: [0, 2],
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }]};
  const r2 = Store.importPresets(JSON.stringify(odd));
  ok(r2.ok && r2.count === 1, "拍号 5（v0.7 开放）接受");
  eq(JSON.stringify(Store.customs[2].accents), JSON.stringify([0, 2]), "重拍分组随导入保留");

  /* v1 旧格式（浮点拍数 d）向后兼容：自动 ×48 转 tick */
  const legacy = { presets: [{ name: "旧格式 · 附点", meter: 4,
    bars: [0,1,2,3].map(() => [{ d: 0.75 }, { d: 0.25 }, { d: 1 }, { d: 1 }, { d: 1 }]) }]};
  const r3 = Store.importPresets(JSON.stringify(legacy));
  ok(r3.ok && r3.count === 1, "v1 旧格式（d 浮点）导入成功");
  eq(Store.customs[3].bars[0][0].t, 36, "d=0.75 → t=36");
  eq(Store.customs[3].bars[0][0].d, undefined, "旧字段 d 已清除");

  const ser = Store.serializePresets();
  ok(JSON.parse(ser).v === 2, "导出格式 v:2（tick 制）");
  const round = Store.importPresets(ser);
  ok(round.ok && round.count === 4, "导出→再导入 往返成功");
  const ids = Store.customs.map(c => c.id);
  ok(new Set(ids).size === ids.length, "往返后全部 id 仍唯一");
}

/* ================= 场景 T6：节奏型回退 ================= */
section("T6 curPattern · 选择失效时回退基础节奏");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "custom", id: "ghost" } }) });
  eq(beat.curPattern().name, "基础节奏 · 每拍一下", "custom id 不存在 → 回退基础节奏");
  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "builtin", idx: 99 } }) });
  eq(b2.curPattern().name, "基础节奏 · 每拍一下", "builtin idx 越界 → 回退基础节奏");
}

/* ================= 场景 T7：模块接口完整性 ================= */
section("T7 模块化 · 接口与装配完整性");
{
  const { beat } = loadApp();
  ["Store", "Modal", "Viz", "Audio", "Trainer", "Controls", "Presets", "Editor"].forEach(k =>
    ok(!!beat[k], `__beat.${k} 已暴露`));
  ["start", "stop", "setBpm", "setSig"].forEach(k => ok(typeof beat.Controls[k] === "function", `Controls.${k}()`));
  ["serializePresets", "exportPresets", "importPresets", "persist"].forEach(k => ok(typeof beat.Store[k] === "function", `Store.${k}()`));
  ok(typeof beat.Modal.uiAlert === "function", "Modal.uiAlert()");
  ok(typeof beat.Presets.consumePending === "function", "Presets.consumePending()");
  ok(typeof beat.Editor.draft === "function", "Editor.draft() 访问器");
  ok(typeof beat.Controls.setSwing === "function", "Controls.setSwing()（v0.7.0 新增）");
}

/* ================= 场景 T8：v0.7.0 localStorage 浮点 → tick 迁移 ================= */
section("T8 Store · 旧浮点数据迁移 tick + 备份");
{
  const oldData = { bpm: 100, sig: 4, sel: { type: "custom", id: "cold1" },
    customs: [{ id: "cold1", name: "旧预设", meter: 4,
      bars: [0,1,2,3].map(() => [{ d: 1 }, { d: 0.5 }, { d: 0.5 }, { d: 0.75 }, { d: 0.25 }, { d: 1 }]) }] };
  const { beat, storage } = loadApp({ "beatsight.m2": JSON.stringify(oldData) });
  const c = beat.Store.customs[0];
  eq(c.bars[0][0].t, 48, "迁移：d=1 → t=48");
  eq(c.bars[0][3].t, 36, "迁移：d=0.75 → t=36");
  ok(c.bars[0].every(s => s.d === undefined), "迁移后无残留 d 字段");
  ok(storage.has("beatsight.m2.bak"), "迁移前已备份 beatsight.m2.bak");
  eq(JSON.parse(storage.get("beatsight.m2.bak")).customs[0].bars[0][0].d, 1, "备份保留原始浮点数据");
  beat.Store.persist();
  eq(JSON.parse(storage.get("beatsight.m2")).v, 3, "persist 写入 v:3");
  eq(beat.curPattern().name, "旧预设", "迁移后 id 引用仍命中原预设");
}

/* ================= 场景 T9：三连音数据模型 ================= */
section("T9 节奏模型 · 三连音 tick 校验");
{
  const { beat } = loadApp();
  const Store = beat.Store;
  const triplet = { presets: [{ name: "三连音测试", meter: 4,
    bars: [0,1,2,3].map(() => Array.from({ length: 12 }, () => ({ t: 16 }))) }]};
  ok(Store.importPresets(JSON.stringify(triplet)).ok, "八分三连音 ×12 = 4 拍 整数校验通过");
  const badTriplet = { presets: [{ name: "残缺三连音", meter: 4,
    bars: [[{ t: 16 }, { t: 16 }, { t: 48 }, { t: 48 }, { t: 48 }], [], [], []] }]};
  ok(Store.importPresets(JSON.stringify(badTriplet)).ok === false, "残缺三连音组（2/3 组）时值不足拒绝");
  const c = Store.customs[0];
  eq(c.bars[0].reduce((a, s) => a + s.t, 0), 192, "三连音小节和 = 4×48 = 192t（整数严格相等，无浮点容差）");
}

/* ================= 场景 T10：Swing 发声时机偏移 ================= */
section("T10 Swing · 后半拍八分发声延后，时间轴不动");
{
  /* 八分摇滚（idx 2，24t×8），BPM 96 → spb=0.625s；swing 67 → 后半拍延后 (67-50)/50×24t=8.16t≈0.10625s */
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "builtin", idx: 2 }, swing: 67 }) });
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);
  const hits = ac.hits.slice(0, 4);
  eq(hits.length, 4, "一小节内 4 次发声已记录");
  const spb = 60 / 96;
  near(hits[1].t - hits[0].t, (24 + 8.16) / 48 * spb, 1e-6, "第 1→2 颗间隔 = 24t + 8.16t（swing 延后）");
  near(hits[2].t - hits[1].t, (24 - 8.16) / 48 * spb, 1e-6, "第 2→3 颗间隔 = 24t - 8.16t（下一颗按时进入）");
  near(hits[0].t, 0.08, 1e-6, "第 1 颗（正拍）不受 swing 影响");

  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "builtin", idx: 2 }, swing: 50 }) });
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  drive(ac2, b2, 1.5);
  const h2 = ac2.hits;
  near(h2[1].t - h2[0].t, 0.5 * spb, 1e-6, "swing=50（直）时八分间隔均匀");
}

/* ================= 场景 T11：奇数拍重拍分组 ================= */
section("T11 奇数拍 · 重拍分组发音");
{
  /* Take Five 律动（idx 9）：meter 5，accents [0,3]，[48,48,48,24,24] */
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sig: 5, sel: { type: "builtin", idx: 9 } }) });
  eq(beat.curPattern().name, "Take Five 律动 · 5/4", "5/4 下选中 Take Five 预设");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 4);
  const hits = ac.hits.slice(0, 5);
  eq(hits[0].freq, 1568, "第 1 拍重拍音（1568Hz）");
  eq(hits[1].freq, 1046.5, "第 2 拍普通正拍音");
  eq(hits[3].freq, 1568, "第 4 颗（第 4 拍 = 3+2 分组点）重拍音");
  eq(hits[4].freq, 784, "第 5 颗（后半拍八分 = 细分位）细分音 784Hz");

  /* 基本回退节奏 5/4 默认 2+3 分组（D4 决策） */
  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({ sig: 5 }) });
  eq(JSON.stringify(b2.curPattern().accents), JSON.stringify([0, 2]), "5/4 回退节奏默认重拍分组 2+3");
  const { beat: b3 } = loadApp({ "beatsight.m2": JSON.stringify({ sig: 7 }) });
  eq(JSON.stringify(b3.curPattern().accents), JSON.stringify([0, 3, 5]), "7/4 回退节奏默认重拍分组 3+2+2");
}

/* ================= 场景 T12：播放中切拍号无缝生效（v0.4.0 机制 tick 制回归） ================= */
section("T12 播放中切换 · 小节边界无缝应用（tick 制回归）");
{
  const { beat, els } = loadApp();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 播放 1 秒后切到 3/4（华尔兹 idx 6，meter 3）：挂起到循环起点 */
  drive(ac, beat, 1);
  beat.Store.S.sel = { type: "builtin", idx: 6 };
  beat.Controls.setSig(3);
  beat.Presets.refreshAfterPatternChange();
  eq(beat.Store.S.sig, 3, "拍号状态立即切换");
  drive(ac, beat, 8);
  eq(beat.Store.S.playing, true, "切换后播放未中断");
  ok(ac.hits.length > 8, "切换后持续发声");
}

/* ================= 场景 T13：音色扩展（v0.8.0） ================= */
section("T13 音色 · 三套合成音色与持久化");
{
  /* 默认与脏值 */
  const { beat } = loadApp();
  eq(beat.Store.S.timbre, "click", "默认音色 click（电子）");
  const { beat: bBad } = loadApp({ "beatsight.m2": JSON.stringify({ timbre: "dubstep" }) });
  eq(bBad.Store.S.timbre, "click", "非法音色值回退 click");
  const { beat: bWood, storage: stWood } = loadApp({ "beatsight.m2": JSON.stringify({ timbre: "wood" }) });
  eq(bWood.Store.S.timbre, "wood", "持久化音色 wood 正确恢复");
  bWood.Store.persist();
  eq(JSON.parse(stWood.get("beatsight.m2")).timbre, "wood", "persist 写入 timbre 字段");

  /* 木鱼：全部层级走带通滤波噪声 */
  bWood.Controls.start();
  drive(FakeAudioContext.last, bWood, 1.5);
  const hw = FakeAudioContext.last.hits;
  ok(hw.length > 0 && hw.every(h => h.kind === "noise" && h.filterType === "bandpass"), "wood：全部发声为带通噪声");
  eq(hw[0].filterFreq, 2000, "wood：小节首拍（重拍）中心 2000Hz");

  /* 鼓组：重拍=底鼓扫频 150→50；正拍=军鼓带通 1800；细分=踩镲高通 8000 */
  const { beat: bDrum } = loadApp({ "beatsight.m2": JSON.stringify({ timbre: "drum", sel: { type: "builtin", idx: 2 } }) });
  bDrum.Controls.start();
  drive(FakeAudioContext.last, bDrum, 2);
  const hd = FakeAudioContext.last.hits.slice(0, 4);   // 八分摇滚：重拍,细分,正拍,细分
  ok(hd[0].kind === "osc" && hd[0].sweepTo === 50, "drum：重拍=底鼓扫频终点 50Hz");
  ok(hd[1].kind === "noise" && hd[1].filterType === "highpass" && hd[1].filterFreq === 8000, "drum：细分=踩镲高通 8000Hz");
  ok(hd[2].kind === "noise" && hd[2].filterType === "bandpass" && hd[2].filterFreq === 1800, "drum：正拍=军鼓带通 1800Hz");

  /* 播放中切换音色即时生效（下一发音符即新音色） */
  bDrum.Controls.setTimbre("click");
  drive(FakeAudioContext.last, bDrum, 1);
  const lastHit = FakeAudioContext.last.hits[FakeAudioContext.last.hits.length - 1];
  ok(lastHit.kind === "osc" && lastHit.sweepTo === undefined, "播放中切 click：下一颗即振荡器发声，不打断播放");
  ok(bDrum.Store.S.playing, "切音色后播放未中断");
}

/* ================= 场景 T14：预备拍（v0.9.0） ================= */
section("T14 预备拍 · 计数发声 + 训练器不受污染");
{
  /* bpm 96 → spb 0.625s；countIn 3 拍：预备拍落在 0.08 / 0.705 / 1.33，1.955 起进正式第 1 小节 */
  const { beat, els } = loadApp({ "beatsight.m2": JSON.stringify({ countIn: { on: true, beats: 3 } }) });
  const S = beat.Store.S;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 0.5);
  beat.Viz.paintFrame();   // rAF 置空，手动补一帧
  eq(els["statusText"].textContent, "预备拍 · 1 / 3", "预备拍期间状态栏显示计数");
  drive(ac, beat, 3);
  const hits = ac.hits;
  near(hits[0].t, 0.08, 1e-6, "预备拍第 1 声 t=0.08");
  eq(hits[0].freq, 1568, "预备拍第 1 声为重拍音");
  near(hits[1].t, 0.08 + 0.625, 1e-6, "预备拍第 2 声间隔 1 拍");
  eq(hits[1].freq, 1046.5, "预备拍第 2 声为正拍音");
  eq(hits[2].freq, 1046.5, "预备拍第 3 声为正拍音");
  near(hits[3].t, 0.08 + 3 * 0.625, 1e-6, "预备拍结束后立即进正式第 1 小节");
  eq(hits[3].freq, 1568, "正式第 1 小节首音仍为重拍");
  beat.Controls.stop();
  const hitsBefore = ac.hits.length;
  beat.Controls.start();   // 每次播放重新数预备拍
  drive(ac, beat, 1);
  ok(ac.hits.length > hitsBefore && ac.hits[hitsBefore].freq === 1568, "重新播放再次触发预备拍（首声重拍）");

  /* 预备拍 + 变速训练：爬坡计数不含预备拍（everyN=1 时完成 2 级即停） */
  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({
    countIn: { on: true, beats: 2 },
    trainer: { on: true, start: 70, target: 80, step: 10, everyN: 1 },
  })});
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  const stopped = drive(ac2, b2, 30);
  ok(stopped, "预备拍+训练：练到目标自动停止");
  const S2 = b2.Store.S;
  eq(S2.bpm, 80, "训练完成停在 80 BPM");
  /* 关闭时零变化回归 */
  const { beat: b3 } = loadApp();
  b3.Controls.start();
  const ac3 = FakeAudioContext.last;
  drive(ac3, b3, 1);
  near(ac3.hits[0].t, 0.08, 1e-6, "预备拍关闭：第 1 声即正式节奏型");
}

/* ================= 场景 T15：拍号切换挂起窗口内可视化不脱轨（v0.9.0 修复） ================= */
section("T15 播放中切拍号 · 挂起窗口内 viz 按旧拍号渲染");
{
  /* 4/4 民谣扫弦播放中切 3/4：新拍号要等到循环起点（4 小节边界）才应用。
     bpm 96 → 一小节 2.5s、循环 10s。drive 到 ~7.6s（旧循环第 4 小节中段）时
     paintFrame 必须仍按 4/4 渲染：状态栏「第 4 小节」而非回卷「第 1 小节」 */
  const { beat, els } = loadApp();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1);
  beat.Store.S.sel = { type: "builtin", idx: 6 };   // 华尔兹 3/4
  beat.Controls.setSig(3);
  beat.Presets.refreshAfterPatternChange();
  drive(ac, beat, 6.6);                              // 累计 ~7.6s：旧循环第 4 小节
  beat.Viz.paintFrame();
  ok(els["statusText"].textContent.includes("第 4 小节"), "挂起窗口内状态栏仍按旧 4/4 渲染（第 4 小节，不回卷）");
  drive(ac, beat, 4);                                // 越过循环起点 → 新拍号生效
  beat.Viz.paintFrame();
  ok(els["statusText"].textContent.includes("播放中"), "循环起点后正常播放");
  ok(beat.Store.S.playing, "全程播放未中断");
}

/* ---------------- 汇总 ---------------- */
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
