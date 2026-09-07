/* ================================================================================
   BeatSight 持久化自动化测试（v0.6.0 起）
   运行：node tests/run.js
   原理：从 index.html 提取内联脚本，在 Node vm 沙箱中运行——
     · localStorage：Map 实现，可按场景预置数据（容错 / 迁移 / 脏项回退）
     · DOM：按 id 缓存的元素 stub，addEventListener 存 handler 供测试触发
     · AudioContext：伪造实现，currentTime 手动推进，逐 tick 驱动 scheduler()
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
    closest(){ return null; },
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
  setValueAtTime(){} exponentialRampToValueAtTime(){} linearRampToValueAtTime(){}
}
class FakeNode {
  constructor(){ this.frequency = new FakeParam(0); this.gain = new FakeParam(1); this.type = ""; }
  connect(){} start(){} stop(){}
}
class FakeAudioContext {
  constructor(){ this.currentTime = 0; this.state = "running"; this.destination = {}; FakeAudioContext.last = this; }
  createOscillator(){ return new FakeNode(); }
  createGain(){ return new FakeNode(); }
  resume(){}
}

/* 以指定 localStorage 预置数据加载应用，返回 {beat, els, ac, storage} */
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

/* ================= 场景 T5：预设导入导出 ================= */
section("T5 Store · 预设导入导出校验");
{
  const { beat } = loadApp();
  const Store = beat.Store;
  ok(Store.importPresets("not json").ok === false, "非 JSON 拒绝");
  ok(Store.importPresets('{"foo":1}').ok === false, "无 presets 字段拒绝");
  ok(Store.importPresets('{"presets":[]}').ok === false, "空数组拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars: [[{ d: 0.3 }], [], [], []] }] })).ok === false,
     "非法时值 d=0.3 拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars: [[{ d: 1 }, { d: 1 }, { d: 1 }], [], [], []] }] })).ok === false,
     "小节时值不足 4 拍拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 5, bars: [[{ d: 1 }], [], [], []] }] })).ok === false,
     "拍号 5（v0.7 才支持）拒绝");

  const good = { app: "beatsight", kind: "presets", v: 1, presets: [
    { name: "测试 · 摇滚", meter: 4, bars: [0,1,2,3].map(() => Array.from({ length: 8 }, () => ({ d: 0.5, rest: false }))) },
    { name: "测试 · 6/8", meter: 6, bars: [0,1,2,3].map(() => Array.from({ length: 4 }, () => ({ d: 1.5, rest: false }))) },
  ]};
  const r1 = Store.importPresets(JSON.stringify(good));
  ok(r1.ok && r1.count === 2, "合法文件导入 2 个预设");
  eq(Store.customs.length, 2, "customs 增至 2");
  ok(Store.customs.every(c => typeof c.id === "string" && c.id.startsWith("c")), "导入后 id 重新生成");
  ok(Store.customs[0].id !== Store.customs[1].id, "id 互不相同");

  const round = Store.importPresets(Store.serializePresets());
  ok(round.ok && round.count === 2, "导出→再导入 往返成功");
  eq(Store.customs.length, 4, "往返后 customs 增至 4");
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
  ok(typeof beat.Modal.uiAlert === "function", "Modal.uiAlert()（v0.6.0 新增）");
  ok(typeof beat.Presets.consumePending === "function", "Presets.consumePending()");
  ok(typeof beat.Editor.draft === "function", "Editor.draft() 访问器");
}

/* ---------------- 汇总 ---------------- */
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
