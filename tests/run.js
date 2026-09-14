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
/* index.html 里靠 attribute 承载初值的元素：stub 不解析 HTML，需在此复刻，否则读到 undefined。
   bpmSlider 的 min/max 是滑杆刻度的取值域（v1.1 起刻度位置由它换算），缺了就全变 NaN%。 */
const HTML_ATTRS = { bpmSlider: { min: "30", max: "240", value: "96" } };
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
    setAttribute(k, v){ this[k] = v; },          // v1.1：aria-label 等属性设置
    getAttribute(k){ return this[k] === undefined ? null : this[k]; },
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
  exponentialRampToValueAtTime(v){ this._rampTo = v; this._peak = Math.max(this._peak || 0, v); }   // _rampTo=v0.8.0 扫频目标；_peak=v1.0.1 包络峰值（末次归零 ramp 会覆盖 _rampTo）
}
class FakeNode {
  constructor(ctx, kind){ this.frequency = new FakeParam(0); this.gain = new FakeParam(1); this.Q = new FakeParam(0); this.type = ""; this._ctx = ctx; this._kind = kind; this._dest = null; }
  connect(d){ if (d && d._kind) this._dest = d; }
  start(t){
    if (this._kind === "osc") this._ctx.hits.push({ t, kind: "osc", freq: this.frequency.value, type: this.type, sweepTo: this.frequency._rampTo,
      gain: this._dest && this._dest.gain ? this._dest.gain._peak : undefined });   // v1.0.1：记录包络峰值（层级增益断言用）
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

/* 以指定 localStorage 预置数据加载应用，返回 {beat, els, sandbox, storage}
   opts.throwOnWrite：模拟隐私模式/配额超限——setItem 一律抛错（v0.9.1 T16） */
function loadApp(seed, opts){
  const store = new Map(Object.entries(seed || {}));
  const throwOnWrite = !!(opts && opts.throwOnWrite);
  const els = {};
  const intervals = new Map();
  let timerSeq = 1;

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { if (throwOnWrite) throw new DOMException("quota", "QuotaExceededError"); store.set(k, String(v)); },
      removeItem: k => store.delete(k),
    },
    document: {
      getElementById: id => {
        if (!els[id]) Object.assign(els[id] = makeEl(id), HTML_ATTRS[id] || {});
        return els[id];
      },
      createElement: tag => Object.assign(makeEl("dyn"), { tagName: String(tag || "").toUpperCase() }),   // v1.1：记录标签名，可断言生成的元素类型（如刻度必须是 <i> 而非 <option>）
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

/* ================= 场景 T15：播放中切拍号立即生效 + 渲染不脱轨（v1.1.1 改契约） ================= */
section("T15 播放中切拍号 · 立即生效，且 viz 按新拍号渲染不脱轨");
{
  /* 历史契约（v0.9.0）：「挂起窗口内 viz 按旧拍号渲染」——那是当时「等循环起点」设计的产物。
     v1.1.1 改为「点下即生效」后，常规路径已无挂起窗口（仅极罕见的小节末无音符起点才挂起），
     故本场景改为守住真正的不变量：切拍后立即按新拍号发声与渲染，且状态栏读数始终落在
     新拍号的合法小节/拍位内（不提前回卷、不越界、不脱轨）。 */
  const { beat, els, sandbox } = loadApp();
  const statusEl = sandbox.document.getElementById("statusText");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1);
  beat.Store.S.sel = { type: "builtin", idx: 6 };   // 华尔兹 3/4
  beat.Controls.setSig(3);
  beat.Presets.refreshAfterPatternChange();
  eq(beat.activePattern().meter, 3, "切拍后立即发声的就是 3/4（不再等循环起点）");
  eq(beat.Presets.consumePending(1).applied, false, "立即生效路径不留挂起（consumePending 无事可做）");
  drive(ac, beat, 6.6);                              // 越过原来 4/4 循环的边界
  beat.Viz.paintFrame();
  const txt = statusEl.textContent;
  const m = txt.match(/第 (\d+) 小节 · (\d)/);
  ok(!!m, "状态栏可解析出小节/拍位：" + txt);
  if (m){
    const barNo = +m[1], beatNo = +m[2];
    ok(barNo >= 1 && barNo <= 4, "小节号落在 4 小节循环内（实测 " + barNo + "）");
    ok(beatNo >= 1 && beatNo <= 3, "拍位按 3/4 渲染（实测第 " + beatNo + " 拍，≤3 才说明没用旧 4/4）");
  }
  ok(beat.Store.S.playing, "全程播放未中断");
  drive(ac, beat, 4);                                // 再越过若干新循环边界
  beat.Viz.paintFrame();
  ok(beat.Store.S.playing, "越过新循环起点后仍正常播放");
  ok(/第 [1-4] 小节/.test(statusEl.textContent), "读数持续合法：" + statusEl.textContent);
}

/* ================= 场景 T16：v0.9.1 防御性补丁 ================= */
section("T16 防御 · persist 写失败不炸 + accents 归一");
{
  /* H1：localStorage 写路径抛错（隐私模式/配额超限）时交互链不能断。
     注意：setSig 必须与 refreshAfterPatternChange 成对调用（真实 UI 的绑定路径如此），
     单独调 setSig 会让 viz 与 curPattern 脱节——那是测试误用，不是 app bug */
  const { beat } = loadApp({}, { throwOnWrite: true });
  let threw = false;
  try {
    beat.Controls.setBpm(120);
    beat.Controls.setSig(3);
    beat.Presets.refreshAfterPatternChange();
    beat.Controls.start();
    drive(FakeAudioContext.last, beat, 1);
    beat.Controls.stop();
  } catch(e){ threw = true; }
  ok(!threw, "persist 写失败时 播放/调速/切拍号 全程不抛异常");
  eq(beat.Store.S.bpm, 120, "写失败时状态仍在内存生效");

  /* M6：导入的 accents 去重 + 升序归一 */
  const { beat: b2 } = loadApp();
  const r = b2.Store.importPresets(JSON.stringify({ presets: [{ name: "乱序重拍", meter: 4, accents: [3, 0, 3, 1],
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }]}));
  ok(r.ok, "乱序/重复 accents 的预设可导入");
  eq(JSON.stringify(b2.Store.customs[0].accents), JSON.stringify([0, 1, 3]), "accents 归一为 [0,1,3]");
}

/* ================= 场景 T17：Editor 全流程（v1.0.0，M1 补覆盖） ================= */
section("T17 Editor · 打开-编辑-校验-撤销-保存全流程");
{
  const { beat, els, storage } = loadApp();
  beat.Editor.open();
  const d = beat.Editor.draft();
  ok(d && d.name.endsWith("-副本"), "打开编辑器：基于当前节奏型生成副本草稿");
  ok(els["editor"].classList.contains("open"), "编辑器 overlay 打开");

  const palette = els["palette"].children;
  eq(palette.length, 11, "音符块库 11 项（含两个三连音组块）");
  palette[10].fire("click");                       // 追加休止符（48t）→ 小节 1 超限
  eq(els["savePresetBtn"].disabled, true, "小节时值超限 → 保存禁用");
  ok(els["editorStatus"].textContent.includes("不完整"), "校验状态提示时值不完整");
  beat.Editor.undo();
  eq(els["savePresetBtn"].disabled, false, "撤销后校验恢复通过");

  els["presetNameInput"].value = "测试预设T17";
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, 1, "保存后 customs +1");
  eq(beat.Store.customs[0].name, "测试预设T17", "预设名正确");
  eq(beat.Store.S.sel.id, beat.Store.customs[0].id, "S.sel 指向新预设 id");
  ok(!els["editor"].classList.contains("open"), "保存后编辑器关闭");
  eq(JSON.parse(storage.get("beatsight.m2")).customs.length, 1, "新预设已持久化");
  eq(beat.curPattern().name, "测试预设T17", "保存后当前节奏型即新预设");
}

/* ================= 场景 T18：层级增益不变量（v1.0.1） ================= */
/* v1.0.0 缺陷：重拍直接以 S.accentVol 作倍率，而正拍固定 ×0.8，
   于是「重拍增强量」低于 80% 时重拍反而轻于正拍，听觉强调层级倒挂。 */
section("T18 音量 · 重拍恒 ≥ 正拍（修复增强量倒挂）");
{
  const { beat: probe } = loadApp();
  const C = probe.CONFIG;

  /* click 音色三档频率互异，按频率区分层级，返回各层级的包络峰值 */
  const levels = (accentVol) => {
    const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, vol: 0.8, accentVol, bpm: 120 }) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    const pick = f => { const h = ac.hits.find(x => x.kind === "osc" && x.freq === f); return h ? h.gain : undefined; };
    return { accent: pick(C.freqAccent), beat: pick(C.freqBeat), sub: pick(C.freqSub) };
  };

  const L = levels(0.56);
  near(L.accent, 0.8 * (C.accentMin + (C.accentMax - C.accentMin) * 0.56), 1e-6, "重拍增益 = 总音量 ×（accentMin + 增量 × 增强量）");
  near(L.beat, 0.8 * C.levelBeat, 1e-6, "正拍增益 = 总音量 × levelBeat");
  ok(L.accent > L.beat, "增强量 56% 时重拍高于正拍（v1.0.0 此处倒挂）");
  ok(L.beat > L.sub, "正拍高于细分");

  /* 全量程：任何增强量都必须保持 重拍 ≥ 正拍 > 细分 */
  const broken = [0, 0.1, 0.25, 0.5, 0.56, 0.79, 0.8, 0.99, 1]
    .filter(v => { const l = levels(v); return !(l.accent >= l.beat && l.beat > l.sub); });
  eq(broken.length, 0, "增强量 0–100% 全程维持 重拍 ≥ 正拍 > 细分");

  /* 边界语义 + 向后兼容：默认 100% 的听感必须与 v1.0.0 完全一致 */
  near(levels(0).accent, 0.8 * C.levelBeat, 1e-6, "增强量 0% → 重拍与正拍齐平");
  near(levels(1).accent, 0.8 * 1, 1e-6, "增强量 100% → 重拍 1.0，与 v1.0.0 默认听感一致");
}

/* ================= 场景 T19：常用速度快捷档 + ±5 步进（v1.1） ================= */
section("T19 速度 · 常用速度快捷档 / ±5 步进 / 训练模式置灰");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  eq(JSON.stringify(beat.CONFIG.speedPresets), JSON.stringify([60, 72, 84, 96, 120]), "快捷档值 = 60/72/84/96/120");

  /* 快捷档与滑杆刻度同源生成（单一数据源 CONFIG.speedPresets） */
  const pills = els["bpmPresetRow"].children;
  eq(pills.length, 5, "生成 5 个快捷档按钮");
  eq(pills.map(b => +b.dataset.bpm).join(","), "60,72,84,96,120", "dataset.bpm 与常量一致");
  eq(pills.map(b => +b.textContent).join(","), "60,72,84,96,120", "按钮文案与常量一致");
  /* 滑杆刻度：与档位同源，且必须是手绘 <i> —— 回归守卫。
     Chrome 不渲染 range 的 datalist 刻度（已实测），若有人改回 <option>，tagName 断言会立刻红。 */
  const ticks = els["bpmTicks"].children;
  eq(ticks.length, 5, "滑杆刻度同源生成 5 项");
  ok(ticks.every(t => t.tagName === "I"), "刻度是 <i> 元素而非 <option>（Chrome 不渲染 datalist 刻度）");
  const lefts = ticks.map(t => parseFloat(t.style.left));
  ok(Math.abs(lefts[1] - 20) < 1e-9, "72 BPM 刻度落在 20%（(72−30)/(240−30)）");
  ok(lefts.every((p, i) => i === 0 || p > lefts[i - 1]), "刻度从左到右严格递增");
  ok(lefts.every(p => p > 0 && p < 100), "刻度均落在滑杆行程内部");
  eq(pills[0].getAttribute("aria-label"), "跳到 60 BPM", "快捷档带无障碍标签");

  /* 点击档位 → 直达该 BPM，并同步数字 / 滑杆 / 高亮 */
  pills[4].fire("click");
  eq(S.bpm, 120, "点击 120 档 → S.bpm = 120");
  eq(+els["bpmNum"].textContent, 120, "大数字同步");
  eq(+els["bpmSlider"].value, 120, "滑杆位置同步");
  ok(pills[4].classList.contains("active"), "命中档位高亮");
  ok(!pills[0].classList.contains("active"), "未命中档位不高亮");

  /* 非档位值（滑杆 / ±1 调出来的）→ 全部不高亮 */
  beat.Controls.setBpm(97);
  ok(pills.every(b => !b.classList.contains("active")), "BPM 不等于任何档位时全部不高亮");

  /* ±5 粗调：单击一步（长按连发依赖 setTimeout，测试环境不真跑） */
  beat.Controls.setBpm(100);
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 105, "+5 → 105");
  els["bpmMinus5"].fire("pointerdown");
  eq(S.bpm, 100, "−5 → 100");
  for (let i = 0; i < 4; i++) els["bpmMinus5"].fire("pointerdown");
  eq(S.bpm, 80, "连续 −5 累计正确（100 → 80）");

  /* 越界钳制沿用 setBpm 的 30–240 */
  beat.Controls.setBpm(238);
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 240, "+5 触顶钳制到 240");
  beat.Controls.setBpm(32);
  els["bpmMinus5"].fire("pointerdown");
  eq(S.bpm, 30, "−5 触底钳制到 30");

  /* 播放中点击档位：不打断播放（setBpm 内部做 loopStart 重映射） */
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 1);
  ok(S.playing, "已进入播放态");
  pills[0].fire("click");
  eq(S.bpm, 60, "播放中点 60 档生效");
  ok(S.playing, "播放未被打断");

  /* 训练模式：BPM 归训练器阶梯管，快捷档与 ±5 置灰；关闭后恢复 */
  els["trainerToggle"].fire("click");
  ok(S.trainer.on, "训练已开启");
  ok(pills.every(b => b.disabled), "训练开启 → 快捷档全部置灰");
  ok(els["bpmPlus5"].disabled && els["bpmMinus5"].disabled, "训练开启 → ±5 置灰");
  els["trainerToggle"].fire("click");
  ok(!S.trainer.on, "训练已关闭");
  ok(pills.every(b => !b.disabled) && !els["bpmPlus5"].disabled, "训练关闭 → 快捷档与 ±5 恢复可用");
}

/* ================= 场景 T20：播放中切换节奏型 · 点下即生效（v1.1.1） ================= */
section("T20 播放中切节奏型 · 点下即生效（不再等小节边界）+ 不跳针 + 停止无残留");
{
  /* 用户实拍 bug：播放三连音基础时点「四分基础」，第 1 小节仍走三连音，要等小节边界才换。
     根因：refreshAfterPatternChange 在播放中一律挂起到小节边界。
     v1.1.1 改为 Audio.resyncToNow() 就地接续：不动时间轴，只把「已走过的 tick」在新节奏型里
     重新定位到第一个可接的音符起点。 */
  const { beat, els, sandbox } = loadApp();
  const S = beat.Store.S;
  const statusEl = sandbox.document.getElementById("statusText");
  S.sel = { type: "builtin", idx: 8 };              // 三连音基础：12 × 16t = 一小节
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1.2);                             // 96BPM 4/4 → 一小节 2.5s，此刻仍在第 1 小节内
  const tClick = ac.currentTime;
  const nBefore = ac.hits.length;
  eq(els["patternName"].textContent, "三连音基础", "开播时标题为三连音基础");

  S.sel = { type: "builtin", idx: 1 };              // 四分基础（同为 4/4）
  beat.Presets.refreshAfterPatternChange();

  /* 核心断言：不等小节边界，点完标题就换 */
  eq(els["patternName"].textContent, "四分基础", "点下立刻换型（标题即变，不再等小节边界）");
  eq(beat.activePattern().meter, 4, "发声快照同步切到新节奏型");
  eq(beat.Presets.consumePending(1).applied, false, "立即生效路径不留挂起");

  drive(ac, beat, 3.2);
  const hits = ac.hits.slice(nBefore);
  ok(hits.length >= 4, "切换后持续发声（实测 " + hits.length + " 颗）");
  ok(hits.every(h => h.t >= tClick), "新音符不排在过去（无时间倒流、不重现已走过的部分）");
  const gaps = hits.slice(1).map((h, i) => +(h.t - hits[i].t).toFixed(4));
  ok(gaps.length > 0 && gaps.every(g => g === 0.625), "切换后全是四分密度（0.625s/颗，实际 " + gaps.slice(0, 4).join(",") + "）");
  ok(S.playing, "播放未中断");

  /* 不跳针（幂等）：中途重复点同一个节奏型，跨点击的整段音轨间隔必须恒为规整四分。
     这比「数条数」硬——窗口相位不同条数本来就会差 1，但只要有漏音、重音或相位跳动，
     间隔里必然出现 1.25s（漏一颗）或 0（重一颗） */
  const nAll = ac.hits.length;
  drive(ac, beat, 1.2);
  const preClick = ac.hits.slice(nAll).map(h => h.t);
  beat.Presets.refreshAfterPatternChange();         // 重复点当前节奏型：应完全无副作用
  drive(ac, beat, 1.2);
  const all = ac.hits.slice(nAll).map(h => h.t);
  const allGaps = all.slice(1).map((t, i) => +(t - all[i]).toFixed(4));
  ok(preClick.length >= 1, "点击前已有音符可对照（实测 " + preClick.length + " 颗）");
  ok(allGaps.length > 0 && allGaps.every(g => g === 0.625),
     "跨重复点击整段间隔恒为四分（无跳针/漏音/重音，实际 " + allGaps.slice(0, 5).join(",") + "）");
  ok(!statusEl.textContent.includes("第 5 小节"), "读数未脱轨");

  /* 停止兜底：切换后立刻停止，标题必须与选中节奏型一致（半切换残留回归） */
  S.sel = { type: "builtin", idx: 2 };              // 八分摇滚
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.stop();
  eq(els["patternName"].textContent, beat.curPattern().name, "停止后标题与选中节奏型一致（无半切换残留）");
  eq(beat.activePattern().name, beat.curPattern().name, "停止后发声快照与选中节奏型一致");
}

/* ================= 场景 T21：全组合切换不变量扫描（v1.1.1） ================= */
section("T21 播放中切节奏型 · 全组合不变量扫描（9×9 组合 × 3 个点击相位）");
{
  /* 「就地接续」是相位换算逻辑，最容易在边界（稀疏↔密集、奇数拍↔4/4、小节末）出破例，
     单点用例覆盖不到。这里把 9 个代表性节奏型两两对切 × 3 个点击相位全跑一遍，
     只守四条硬不变量：立即切换 / 不排到过去 / 时刻严格递增 / 播放不中断。 */
  const idxs = [0, 1, 2, 5, 6, 8, 9, 10, 11];
  const waits = [0.35, 1.7, 3.1];
  const problems = [];
  let cases = 0;
  for (const from of idxs) for (const to of idxs) for (const wait of waits){
    const { beat, els } = loadApp();
    const S = beat.Store.S;
    S.sel = { type: "builtin", idx: from };
    beat.Presets.refreshAfterPatternChange();
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, wait);
    const tClick = ac.currentTime, n0 = ac.hits.length;
    const fromName = els["patternName"].textContent;
    S.sel = { type: "builtin", idx: to };
    const mt = beat.BUILTINS[to].meter;
    if (mt !== S.sig) beat.Controls.setSig(mt);
    beat.Presets.refreshAfterPatternChange();
    const toName = beat.curPattern().name;
    drive(ac, beat, 12);
    const seg = ac.hits.slice(n0).map(h => h.t);
    cases++;
    const tag = fromName + " → " + toName + " @" + wait + "s";
    if (els["patternName"].textContent !== toName) problems.push(tag + "：标题未立即切换");
    if (seg.some(t => t < tClick - 1e-9)) problems.push(tag + "：音符排到过去");
    for (let i = 1; i < seg.length; i++) if (!(seg[i] > seg[i - 1])) problems.push(tag + "：时刻非严格递增");
    if (!S.playing) problems.push(tag + "：播放被中断");
    if (seg.length < 4) problems.push(tag + "：切换后发声过少（" + seg.length + "）");
  }
  eq(cases, idxs.length * idxs.length * waits.length, "扫描组合数");
  ok(problems.length === 0, "全部组合满足不变量（" + cases + " 组，破例 " + problems.length + "）");
  problems.slice(0, 8).forEach(p => console.log("      · " + p));
}

/* ================= 场景 T22：弹跳球 onset 表（v1.2） ================= */
section("T22 弹跳球 onset 表：端点=真实发声时刻 / 静音照记 / 休止跳过 / 预测永远有下一跳");
{
  /* 弹跳球的每个落点都来自 onsetBuf/onsetNext（Audio 写、Viz 只读）。这里守数据层的硬不变量；
     渲染层（paintBall 的抛物线/挤压拉伸）是纯函数映射，由人工截图验收。 */
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.sel = { type: "builtin", idx: 1 };            // 四分基础
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);                              // 96BPM：四分 0.625s/颗

  const buf = beat.onsetBuf();
  ok(buf.length >= 2, "onset 缓冲覆盖当前跳跃区间（实测 " + buf.length + " 条，窗口=最近 1s + 前瞻 150ms）");
  ok(buf.every((e, i) => i === 0 || e.t > buf[i - 1].t), "端点时刻严格递增");
  const recentHits = ac.hits.filter(h => h.t > ac.currentTime - 1);   // 缓冲只留最近 1s，对照同窗口
  ok(recentHits.length > 0 && recentHits.every(h => buf.some(e => Math.abs(e.t - h.t) < 1e-9)),
     "最近 1s 内每个发声时刻都能在 onset 表找到（落点=真实发声时刻）");
  const nx = beat.onsetNext();
  ok(!!nx, "预测落点存在（球永远有目的地）");
  ok(nx && nx.t > buf[buf.length - 1].t, "预测落点总在最后一个已排程端点之后");
  ok(nx && nx.t > ac.currentTime, "预测落点在未来（不受 150ms 前瞻窗口限制）");
  eq(nx && +(nx.t - buf[buf.length - 1].t).toFixed(4), 0.625, "四分基础：预测与缓冲的间距即四分密度");

  /* Swing：后半八分落点后移 (67-50)/50×24t = 8.16t ≈ 0.10625s → 相邻间距一长一短交替 */
  const w = loadApp();
  const S2 = w.beat.Store.S;
  S2.sel = { type: "builtin", idx: 2 };           // 八分摇滚
  w.beat.Presets.refreshAfterPatternChange();
  S2.swing = 67;
  w.beat.Controls.start();
  const ac2 = FakeAudioContext.last;
  drive(ac2, w.beat, 2);
  const gaps = w.beat.onsetBuf().map((e, i, a) => i ? +(e.t - a[i - 1].t).toFixed(4) : null).slice(1);
  const LONG = 0.4188, SHORT = 0.2063;            // 0.3125 ± 0.10625
  ok(gaps.length >= 2 && gaps.every(g => Math.abs(g - LONG) < 2e-3 || Math.abs(g - SHORT) < 2e-3),
     "Swing 67%：落点间距一长一短（实测 " + gaps.slice(0, 4).join(",") + "）");
  ok(gaps.every((g, i) => i === 0 || Math.abs(g - gaps[i - 1]) > 0.1), "Swing 落点严格长短交替（球的运动跟随律动）");

  /* 静音拍：第 4 小节不发声但端点照记（视觉照常——静音小节里球是唯一节拍来源） */
  const m3 = loadApp();
  const S3 = m3.beat.Store.S;
  S3.sel = { type: "builtin", idx: 1 };
  m3.beat.Presets.refreshAfterPatternChange();
  S3.mute = true;
  m3.beat.Controls.start();
  const ac3 = FakeAudioContext.last;
  drive(ac3, m3.beat, 9);                          // 第 4 小节窗口 7.5–10s，修剪保留最近 1s
  const buf3 = m3.beat.onsetBuf();
  ok(buf3.some(e => e.bar === 3), "静音小节的端点照常记入（球照跳）");
  ok(!ac3.hits.some(h => h.t >= 8 && h.t < 10), "静音小节无声（对照：声音确实没了，只剩球）");

  /* 休止符：占时不发声也不产生落点——球做长跳跨过 */
  const restPat = { id: "r1", name: "含休止", meter: 4,
    bars: [0, 1, 2, 3].map(() => [{ t: 48, rest: false }, { t: 24, rest: true }, { t: 24, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }]) };
  const r = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, customs: [restPat], sel: { type: "custom", id: "r1" } }) });
  r.beat.Controls.start();
  const ac4 = FakeAudioContext.last;
  drive(ac4, r.beat, 3);
  ok(r.beat.onsetBuf().every(e => e.cumT !== 48), "休止符位置（cumT=48）不产生落点");

  /* resync 点下即生效：切换后预测立刻跟随新节奏型（不等小节边界、不留旧型残影） */
  const q = loadApp();
  const S5 = q.beat.Store.S;
  S5.sel = { type: "builtin", idx: 8 };           // 三连音基础
  q.beat.Presets.refreshAfterPatternChange();
  q.beat.Controls.start();
  const ac5 = FakeAudioContext.last;
  drive(ac5, q.beat, 1.2);
  S5.sel = { type: "builtin", idx: 1 };           // 点下切四分基础
  q.beat.Presets.refreshAfterPatternChange();
  drive(ac5, q.beat, 0.2);                         // 一个调度周期内预测必已换新
  const nx5 = q.beat.onsetNext();
  ok(nx5 && nx5.cumT % 48 === 0, "切换后预测落点立即按新节奏型（四分网格）");
  ok(q.beat.onsetBuf().every((e, i, a) => i === 0 || e.t > a[i - 1].t), "切换后 onset 表仍严格递增（不排到过去）");
}

/* ---------------- 汇总 ---------------- */
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
