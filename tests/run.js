/* ================================================================================
   BeatSight 持久化自动化测试（v0.6.0 起）
   运行：node tests/run.js
   原理：从 index.html 提取内联脚本，在 Node vm 沙箱中运行——
     · localStorage：Map 实现，可按场景预置数据（容错 / 迁移 / 脏项回退）
     · DOM：按 id 缓存的元素 stub，addEventListener 存 handler 供测试触发
     · AudioContext：伪造实现，currentTime 手动推进，逐 tick 驱动 scheduler()；
       osc.start(t) 记录 {t, freq, type} 供 swing/重拍断言
     · 渲染层：requestAnimationFrame 默认置空（引擎/状态层用例只断言数据）；
       T23 系列改用 driveFrames() 同时推进音频时钟与 rAF 帧，**真正执行 paintFrame**
       （v1.2.4 起渲染层进覆盖——此前这里全空，导致帧内异常 CI 拦不住）
   断言对象的获取：脚本末尾的 window.__beat 调试句柄暴露全部模块接口。
   ================================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error("index.html 中未找到 <script> 块"); process.exit(1); }
const SRC = m[1];
/* v1.3.0（审计 P2-17）：内联脚本只编译一次，之后每个用例复用同一个 vm.Script 跑进新上下文。
   原先每个 case 都 new vm.Script 重新编译 1900+ 行，是全套件最没意义的一笔开销 */
const COMPILED = new vm.Script(SRC, { filename: "index.inline.js" });

/* ---------------- DOM / 浏览器环境 stub ---------------- */
/* 探针计数器（v1.3.0，审计 P1-4）：用来断言「一帧内零布局读取」与「增量重绘真的减少了 DOM 写入」。
   这两条性能承诺如果只靠人眼 review，下一次改动就会悄悄破功。 */
const PROBE = { layoutReads: 0, classWrites: 0 };
const resetProbe = () => { PROBE.layoutReads = 0; PROBE.classWrites = 0; };

/* 行几何模型（v1.3.1）：stub 给不出真实布局，但至少要让数值**自洽且有代表性**。
   v1.3.0 之前所有 offset* 恒为 0，导致弹跳球的「顶点不出容器空域」钳制算出负跳高
   （H = min(H, yBase+6) = min(10, -14) = -14）——球会向下飞，任何抛物线断言都是假的。
   现在：行按创建序分层（与真实 .bar-row 的纵向堆叠一致），格子的 left/width 由
   style.left / style.width 的百分比反解（600px 视作行宽），这样
   `fitCellLabels` 的宽窄判断与弹跳球的落点也都有真实量级。 */
const ROW_TOP0 = 58, ROW_H = 86;
let rowSeq = 0;

/* index.html 里靠 attribute 承载初值的元素：stub 不解析 HTML，需在此复刻，否则读到 undefined。
   bpmSlider 的 min/max 是滑杆刻度的取值域（v1.1 起刻度位置由它换算），缺了就全变 NaN%。 */
const HTML_ATTRS = {
  bpmSlider: { min: "30", max: "240", value: "96" },
  /* 标记里声明了 `hidden` 的元素：真实 DOM 加载后它们就是隐藏的，stub 必须同样如此。
     不做的话「预设库为空才提示跨地址迁移」这类依赖初始隐藏状态的逻辑会被误判为通过/失败
     （v1.3.0 P2-14 踩到）。 */
  fallbackNote: { hidden: true }, accGroup: { hidden: true }, countInBeatsWrap: { hidden: true },
  trainerPanel: { hidden: true }, migHint: { hidden: true }, importFile: { hidden: true },
  modalMask: { hidden: true }, modalInput: { hidden: true },
};
/* 静态标记里的「pill 组」：真实 HTML 里这些按钮是写死的，stub 不解析 HTML，
   所以在此复刻。不做的话 `document.querySelectorAll("#sigRow .pill")` 拿到空集合，
   `setPressed()` 变成空转 —— aria-pressed 这类无障碍断言根本跑不起来（v1.3.0 为 P2-11 而加）。 */
const HTML_CHILDREN = {
  sigRow:    [2, 3, 4, 5, 6, 7].map(n => ({ className: "pill" + (n === 4 ? " active" : ""), dataset: { sig: String(n) } })),
  swingRow:  [50, 67, 75].map((n, i) => ({ className: "pill" + (i === 0 ? " active" : ""), dataset: { swing: String(n) } })),
  timbreRow: ["click", "wood", "drum"].map((n, i) => ({ className: "pill" + (i === 0 ? " active" : ""), dataset: { timbre: n } })),
};
function makeEl(id){
  /* classList 与 className 必须是同一份数据的两个视图（真实 DOM 就是如此）。
     原先它们是各自独立的存储：`classList.toggle("active")` 改了 Set，`className` 字符串纹丝不动，
     于是「视觉高亮与 aria-pressed 是否一致」这类跨视图断言根本无从写起（v1.3.0 P2-11 踩到）。 */
  const cls = new Set();
  const el = {
    _id: id, _h: {},
    children: [],
    style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : ""), set: (t, k, v) => { t[k] = v; return true; } }),
    classList: {
      add(...c){ c.forEach(x => cls.add(x)); },
      remove(...c){ c.forEach(x => cls.delete(x)); },
      toggle(c, f){ (f === undefined ? !cls.has(c) : !!f) ? cls.add(c) : cls.delete(c); },
      contains(c){ return cls.has(c); },
    },
    dataset: {},
    textContent: "", value: "", title: "",
    hidden: false, disabled: false, inert: false,
    /* 布局属性做成**计数的 getter**：这里要断言的是"读了几次"，不是读到了多少；
       但值本身也要有代表性（见上方 ROW_TOP0 的说明），否则物理类的断言会算错 */
    get offsetWidth(){
      PROBE.layoutReads++;
      const m = /([\d.]+)%/.exec(el.style.width || "");
      return m ? 600 * (+m[1]) / 100 : 600;
    },
    get offsetHeight(){ PROBE.layoutReads++; return 44; },
    get offsetLeft(){
      PROBE.layoutReads++;
      const m = /^(-?[\d.]+)%/.exec(el.style.left || "");
      return m ? Math.round(600 * (+m[1]) / 100) : 0;
    },
    get offsetTop(){ PROBE.layoutReads++; return el._rowTop === undefined ? 0 : el._rowTop; },
    scrollWidth: 0,
    addEventListener(t, f){ (this._h[t] = this._h[t] || []).push(f); },
    removeEventListener(){},
    appendChild(c){ this.children.push(c); return c; },
    setAttribute(k, v){ this[k] = v; },          // v1.1：aria-label 等属性设置
    getAttribute(k){ return this[k] === undefined ? null : this[k]; },
    remove(){}, blur(){}, focus(){}, animate(){},
    /* 真实 DOM 的 click() 会触发自身 click 处理器（导出预设里的 <a download> 就是靠它） */
    click(){ this.fire("click", {}); },
    closest(){ return makeEl("closest-proxy"); },   // 近似真实 DOM：返回带 classList 的祖先代理
    /* 测试辅助：触发已绑定的事件 */
    fire(t, ev){
      (this._h[t] || []).forEach(f => f(Object.assign({
        currentTarget: el, target: el,
        preventDefault(){}, stopPropagation(){}, stopImmediatePropagation(){},
      }, ev)));
    },
  };
  /* className 与 classList 共享同一份 Set；写入计数用于断言增量重绘的收益。
     顺带做一件事：给 .bar-row 分配纵向层位（真实 DOM 里它们自上而下依次堆叠） */
  Object.defineProperty(el, "className", {
    get(){ return [...cls].join(" "); },
    set(v){
      PROBE.classWrites++;
      cls.clear();
      const s = String(v);
      s.split(/\s+/).filter(Boolean).forEach(c => cls.add(c));
      if (/(^| )bar-row( |$)/.test(s) && el._rowTop === undefined) el._rowTop = ROW_TOP0 + (rowSeq++) * ROW_H;
    },
    enumerable: true, configurable: true,
  });
  /* innerHTML 忠实清空子节点（真实 DOM 语义）。原先它只是个普通字符串属性，
     `$("viz").innerHTML = ""` 并不会清掉 stub 累积的 children —— 渲染层按「行/格」检查 DOM
     时会读到上一次 buildViz 的残留。
     另外：buildViz 第一件事就是清空 viz，所以这里同时复位行层位计数（否则第二次 buildViz
     的行会接着上一轮编号，offsetTop 越堆越大）。 */
  Object.defineProperty(el, "innerHTML", {
    get(){ return el._html || ""; },
    set(v){
      el._html = v;
      el.children.length = 0;
      if (el._id === "viz") rowSeq = 0;
    },
    enumerable: true, configurable: true,
  });
  return el;
}

/* 模拟「点击某个带 data-* 的 pill 按钮」（v1.3.1）。
   真实浏览器里 `e.target.closest("[data-sig]")` 会返回被点的那个按钮，
   桩里需要一个 dataset 正确、且 closest() 能返回自身的元素，否则
   sigRow / swingRow / timbreRow 的接线路（handler 里读 btn.dataset）永远跑不到。 */
function pill(spec){
  const el = makeEl("pill-sim");
  Object.assign(el.dataset, spec);
  el.closest = sel => {
    const m = /\[data-(\w+)\]/.exec(sel);
    return (m && el.dataset[m[1]] !== undefined) ? el : null;
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
  constructor(){
    this.currentTime = 0; this.state = "running"; this.destination = {}; this.hits = [];
    this.sampleRate = 48000; this.resumeCount = 0; this.onstatechange = null;
    FakeAudioContext.last = this;
  }
  createOscillator(){ return new FakeNode(this, "osc"); }
  createGain(){ return new FakeNode(this, "gain"); }
  createBiquadFilter(){ return new FakeNode(this, "filter"); }
  createBuffer(ch, len, rate){ return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource(){ return new FakeNode(this, "noise"); }
  resume(){ this.resumeCount++; if (this.state === "suspended" || this.state === "interrupted") this.state = "running"; }
  /* v1.3.0（审计 P2-13）：模拟系统/其他 App 改变音频会话状态，并触发 onstatechange——
     iOS 的 "interrupted" 与 "closed" 是原实现完全没处理的两个分支 */
  setState(s){ this.state = s; if (typeof this.onstatechange === "function") this.onstatechange(); }
}

/* 以指定 localStorage 预置数据加载应用，返回 {beat, els, sandbox, storage, fireDoc, fireWin, docHidden}
   opts.throwOnWrite：模拟隐私模式/配额超限——setItem 一律抛错（v0.9.1 T16） */
function loadApp(seed, opts){
  const store = new Map(Object.entries(seed || {}));
  const throwOnWrite = !!(opts && opts.throwOnWrite);
  const els = {};
  const intervals = new Map();
  const timeouts = new Map();
  let timerSeq = 1;
  /* v1.3.0（审计 P1-3/P2-13）：document / window 级监听器要能被测试触发，
     否则「回前台补排」「pagehide 停播」这类生命周期行为完全无法断言（原先 addEventListener 是空函数） */
  const docH = {}, winH = {};
  const addTo = (bag, t, f) => { (bag[t] = bag[t] || []).push(f); };
  /* 事件载荷必须能传进去（v1.3.1 修）：原实现只接受事件名，键盘/文件等事件读不到 e.code /
     e.target.files，导致「空格键」「Esc」「导入文件」这些接线永远不匹配而静默通过 */
  const fireAll = bag => (t, ev) => (bag[t] || []).forEach(f => f(Object.assign(
    { preventDefault(){}, stopPropagation(){}, stopImmediatePropagation(){} }, ev)));
  let FILE_TEXT = "";             // 下一次 FileReader.readAsText 交回的内容（测导入接线用）

  const elFor = id => {
    if (!els[id]){
      Object.assign(els[id] = makeEl(id), HTML_ATTRS[id] || {});
      (HTML_CHILDREN[id] || []).forEach(spec => {
        const c = makeEl(id + "-pill");
        c.className = spec.className;
        Object.assign(c.dataset, spec.dataset);
        c.textContent = spec.dataset.sig || spec.dataset.swing || spec.dataset.timbre || "";
        els[id].children.push(c);
      });
    }
    return els[id];
  };

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { if (throwOnWrite) throw new DOMException("quota", "QuotaExceededError"); store.set(k, String(v)); },
      removeItem: k => store.delete(k),
    },
    document: {
      getElementById: elFor,
      createElement: tag => Object.assign(makeEl("dyn"), { tagName: String(tag || "").toUpperCase() }),   // v1.1：记录标签名，可断言生成的元素类型（如刻度必须是 <i> 而非 <option>）
      /* 只支持 `#id .pill` 这一种选择器——setPressed() 需要它返回 pill 组；
         其它选择器返回空数组（与原先行为一致） */
      querySelectorAll: sel => {
        const m2 = /^#([\w-]+)\s+\.pill$/.exec(sel);
        if (m2){
          const host = elFor(m2[1]);
          return host.children.filter(c => /(^| )pill( |$)/.test(c.className));
        }
        /* 焦点陷阱（P2-11）：Modal.refreshInert() 用 `.main, .topbar` 选背景并置 inert */
        if (sel === ".main, .topbar") return [elFor("mainBg"), elFor("topbarBg")];
        return [];
      },
      addEventListener: (t, f) => addTo(docH, t, f),
      body: makeEl("body"),
      activeElement: { tagName: "DIV" },
      hidden: false,                 // v1.3.0：前台/后台切换（P1-3 自适应窗口断言用）
    },
    AudioContext: FakeAudioContext,
    setInterval: (fn, ms) => { const id = timerSeq++; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
    /* 定时器：**记录但不自动执行**（与原行为一致——自动执行会让 tap 复位、长按连发等
       干扰其它用例）。测试需要时用 runTimers() 手动冲刷。
       加这层是因为好几个真实路径藏在 setTimeout 里：窗口 resize 的防抖重建、
       TAP 文案复位、导出后 revokeObjectURL…… 原先它们永远跑不到。 */
    setTimeout: fn => { const id = timerSeq++; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id),
    requestAnimationFrame: () => 0, // paintFrame 不运行：测试只断言引擎与状态层
    cancelAnimationFrame(){},
    performance: { now: () => Date.now() },
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL(){} },
    Blob,
    /* 动效降级（P2-11）：REDUCE_MOTION 在加载期求值，故必须能注入。
       默认 matches=false（同真实浏览器未声明偏好时） */
    matchMedia: q => ({ matches: !!(opts && opts.reduceMotion) && /reduce/.test(q), media: q, addEventListener(){}, addListener(){} }),
    /* FileReader：真实实现至少要能把内容交给 onload，否则「导入预设」的接线永远跑不到
       （原桩是空构造函数，r.readAsText 是 undefined → 一调就 TypeError） */
    FileReader: function(){
      const self = this;
      self.readAsText = () => { self.result = FILE_TEXT; if (self.onload) self.onload(); };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (t, f) => addTo(winH, t, f);
  vm.createContext(sandbox);
  COMPILED.runInContext(sandbox);
  const beat = sandbox.window.__beat;
  if (!beat) throw new Error("window.__beat 调试句柄未暴露——模块化装配失败");
  return {
    beat, els, sandbox, storage: store,
    fireDoc: fireAll(docH), fireWin: fireAll(winH),
    /* 切前台/后台：改 document.hidden 后触发 visibilitychange。
       注意**两个 bag 都要发**：真实浏览器里该事件在 document 上派发并冒泡到 window，
       所以 `document.addEventListener` 与 `window.addEventListener` 两种写法都会收到
       （本应用 Store 挂在 window 上、Audio 挂在 document 上，只发一个会漏） */
    setHidden: h => {
      sandbox.document.hidden = h;
      fireAll(docH)("visibilitychange");
      fireAll(winH)("visibilitychange");
    },
    firePageHide: () => { fireAll(winH)("pagehide"); fireAll(docH)("pagehide"); },
    setFileText: t => { FILE_TEXT = t; },
    /* 可控时钟：TAP 测速按 performance.now() 的间隔算 BPM，必须能精确摆布 */
    setNow: v => { sandbox.performance.now = () => v; },
    /* 手动冲刷已排期的 setTimeout 回调（防抖重建 / 文案复位这类路径） */
    runTimers: () => { const fns = [...timeouts.values()]; timeouts.clear(); fns.forEach(f => f()); },
  };
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
  /* v1.3.0 契约更新：写目标由单键 beatsight.m2 改为冷热分离的
     beatsight.state（热）/ beatsight.customs（冷）。旧键降级为只读的迁移来源。
     persist() 现在是 250ms 防抖，要断言落盘内容必须显式 flush()（页面隐藏/pagehide 也走它） */
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).v, 3, "flush 后热键写入 beatsight.state（v:3）");
  eq(JSON.parse(storage.get("beatsight.customs")).customs.length, 1, "迁移后的预设写入冷键 beatsight.customs");
  eq(JSON.parse(storage.get("beatsight.customs")).customs[0].bars[0][0].t, 48, "冷键里是迁移后的 tick（非原始浮点 d）");
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
  bWood.Store.flush();                 // v1.3.0：热键写入改为防抖，断言落盘内容前须 flush
  eq(JSON.parse(stWood.get("beatsight.state")).timbre, "wood", "flush 后热键写入 timbre 字段");

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
     单独调 setSig 会让 viz 与 curPattern 脱节——那是测试误用，不是 app bug。
     v1.3.0：persist() 改为防抖后，必须显式 flush() 才会真正触发那次抛异常的 setItem，
     否则这条用例会变成空跑（写没发生，自然不抛）——那是假绿 */
  const { beat } = loadApp({}, { throwOnWrite: true });
  let threw = false;
  try {
    beat.Controls.setBpm(120);
    beat.Controls.setSig(3);
    beat.Presets.refreshAfterPatternChange();
    beat.Controls.start();
    drive(FakeAudioContext.last, beat, 1);
    beat.Controls.stop();
    beat.Store.flush();              // 真正把写盘打出去（会抛 QuotaExceededError → 被内部兜住）
    beat.Store.persistCold();        // 冷键路径同样要兜住
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
  /* v1.3.0 契约更新：预设库落在冷键 beatsight.customs（立即写，不防抖）。
     热键 beatsight.state 里不再含 customs —— 这正是 P1-5 要的效果：
     500 个预设时冷键 715 KB，但它只在增删改预设时写；每次调速/开关只写 <1 KB 的热键 */
  eq(JSON.parse(storage.get("beatsight.customs")).customs.length, 1, "新预设已写入冷键 beatsight.customs");
  ok(!/customs/.test(JSON.stringify(JSON.parse(storage.get("beatsight.state") || "{}"))),
     "热键不再携带 preset 库（冷热分离生效）");
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
     只守四条硬不变量：立即切换 / 不排到过去 / 时刻严格递增 / 播放不中断。

     v1.3.0（审计 P2-17）加 FULL_SCAN 开关：243 组是本套件最耗时的一段（每格都要新建沙箱 +
     驱动十几秒音频）。默认跑抽样 9 组，FULL_SCAN=1 跑全量——CI 跑全量，本地改代码时跑抽样。
     抽样取自同一批代表值（稀疏 / 密集 / 奇数拍 / 三连音），守的是同一组不变量，只是覆盖面小。
     下面的组合数断言按实际跑的组数校验，所以「抽样模式被静默改成全量」或反过来都能被发现。 */
  const FULL = process.env.FULL_SCAN === "1";
  const IDXS_ALL = [0, 1, 2, 5, 6, 8, 9, 10, 11];
  const WAITS_ALL = [0.35, 1.7, 3.1];
  /* 抽样：4 个节奏型（扫弦/四分/切分/三连音）× 点击相位取「中段」——最易出破例的小节末相位留给全量 */
  const idxs = FULL ? IDXS_ALL : [0, 1, 5, 8];
  const waits = FULL ? WAITS_ALL : [1.7];
  console.log("      · 模式：" + (FULL ? "全量" : "抽样（FULL_SCAN=1 跑全量）")
    + " · " + idxs.length + "×" + idxs.length + "×" + waits.length + " = " + (idxs.length * idxs.length * waits.length) + " 组");
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
  ok(buf.length >= 2, "onset 缓冲覆盖当前跳跃区间（实测 " + buf.length + " 条，保留最近 1s 且至少 8 条 + 前瞻）");
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

/* ================= 场景 T23：持久值健壮性（v1.2.4） =================
   背景：v1.2.3 的 T1 只覆盖了「坏 JSON」，没覆盖「JSON 合法但值非法」这条更常见的损坏路径。
   实测后果按严重度递增：
     · {"sig":"abc"} / 空小节 customs → paintFrame 抛 TypeError。异常落在 rAF 回调内，
       下一帧的 requestAnimationFrame 从未注册 → 渲染循环永久死亡（画面冻结、声音照响、无报错）。
     · {"sig":-3} → scheduler 的「空小节」分支步长为负，nextNoteTime 只减不增，
       while 条件恒真 → **主线程死循环，标签页 100% CPU 卡死**。
     · {"vol":1e6} → 增益送到 +120 dBFS（削波爆音）。
   「试听中清空小节」这条**不需要任何损坏数据**即可触发第一条，属真实用户可达路径。
   本场景把上述复现用例全部固化为断言。 */

/* 逐帧驱动：scheduler（每 25ms）与 paintFrame（每帧）双时钟同时跑，贴近真实浏览器 */
function driveFrames(ac, beat, seconds){
  const dt = 0.02, n = Math.ceil(seconds / dt);
  let firstErr = null;
  for (let i = 0; i < n; i++){
    ac.currentTime += dt;
    try { beat.Audio.scheduler(); } catch(e){ if (!firstErr) firstErr = "scheduler: " + e.message; }
    try { beat.Viz.paintFrame(); } catch(e){ if (!firstErr) firstErr = "paintFrame: " + e.message; }
    if (!beat.Store.S.playing) break;
  }
  return firstErr;
}
const VALID_SIGS = [2, 3, 4, 5, 6, 7];

section("T23 脏拍号 · 必须钳制到合法拍号，且不得让渲染帧抛异常");
{
  /* 覆盖：字符串 / 负零 / 负数 / 越界 / null / 布尔 —— 全部是"JSON 合法、值非法" */
  const cases = [["abc", "字符串"], [-3, "负数（v1.2.3 会让调度器死循环）"], [99, "越界"],
                 [0, "零"], [null, "null"], [true, "布尔"]];
  cases.forEach(([v, desc]) => {
    const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sig: v }) });
    ok(VALID_SIGS.includes(beat.Store.S.sig), `sig=${JSON.stringify(v)}（${desc}）钳制到合法拍号（实际 ${JSON.stringify(beat.Store.S.sig)}）`);
    beat.Controls.start();
    ok(beat.Store.S.playing, `sig=${JSON.stringify(v)}：进入播放态`);
    const err = driveFrames(FakeAudioContext.last, beat, 0.4);
    ok(!err, `sig=${JSON.stringify(v)}：调度 + 渲染全程无异常（${err || "OK"}）`);
    ok(beat.Store.S.playing, `sig=${JSON.stringify(v)}：播放未被异常中断（死循环会在此处超时）`);
  });
}

section("T23b 空小节 customs · 结构校验淘汰 + 隔离备份 + 渲染不崩");
{
  const bad = { id: "z", name: "坏预设-空小节", meter: 4, bars: [[], [], [], []] };
  const { beat, storage } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, customs: [bad], sel: { type: "custom", id: "z" } }) });
  eq(beat.Store.customs.length, 0, "空小节预设被 load 路径的结构校验淘汰（原先原样信任）");
  ok(storage.has("beatsight.quarantine"), "淘汰项隔离到 beatsight.quarantine，可人工找回");
  eq(JSON.parse(storage.get("beatsight.quarantine")).length, 1, "隔离备份内容完整");
  beat.Controls.start();
  const err = driveFrames(FakeAudioContext.last, beat, 2);
  ok(!err, "空小节不再让渲染帧抛异常（v1.2.3 此处 TypeError）");

  /* 反向守卫：合法自定义预设不得被校验误杀 */
  const { beat: b2, storage: st2 } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3,
    sel: { type: "custom", id: "keep" },
    customs: [{ id: "keep", name: "合法预设", meter: 4, accents: [0, 2],
      bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 24 }, { t: 24 }, { t: 48 }, { t: 48 }]) }] }) });
  eq(b2.Store.customs.length, 1, "合法自定义预设不被校验误杀");
  eq(b2.Store.customs[0].id, "keep", "合法预设的 id 被保留");
  eq(JSON.stringify(b2.Store.customs[0].accents), JSON.stringify([0, 2]), "合法预设的 accents 被保留");
  eq(b2.curPattern().name, "合法预设", "合法预设仍被选为当前节奏型");
  ok(!st2.has("beatsight.quarantine"), "无淘汰项时不产生 quarantine 备份");
}

section("T23c 音量越界 · 必须钳制到 [0,1]，增益不得超 0 dBFS");
{
  const cases = [[1e6, "1e6（v1.2.3 实测 +120 dBFS）"], [3, "3"], [-5, "负数"], ["x", "字符串"]];
  cases.forEach(([v, desc]) => {
    const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, vol: v, accentVol: 1, bpm: 120 }) });
    const vol = beat.Store.S.vol;
    ok(vol >= 0 && vol <= 1, `vol=${JSON.stringify(v)}（${desc}）钳制到 [0,1]（实际 ${vol}）`);
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 1.2);
    const peaks = ac.hits.filter(h => h.gain !== undefined).map(h => h.gain);
    ok(peaks.length > 0, `vol=${JSON.stringify(v)}：有发声包络可测`);
    ok(peaks.every(p => p <= 1), `vol=${JSON.stringify(v)}：送达增益峰值 ≤ 1.0（实测 ${Math.max(...peaks).toFixed(3)}）`);
  });
  /* accentVol 同样越界 */
  const { beat: bAcc } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1e9 }) });
  ok(bAcc.Store.S.accentVol <= 1, `accentVol=1e9 钳制到 [0,1]（实际 ${bAcc.Store.S.accentVol}）`);
}

section("T23d 脏 BPM · 不得让位置换算变 NaN");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ bpm: "abc" }) });
  ok(isFinite(beat.Store.S.bpm), `脏 bpm 回退为有限值（实际 ${beat.Store.S.bpm}）`);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const err = driveFrames(ac, beat, 1.5);
  ok(!err, "脏 BPM 下调度 + 渲染无异常（v1.2.3 此处 paintFrame TypeError）");
  ok(ac.hits.length > 0, `脏 BPM 下仍能正常发声（实测 ${ac.hits.length} 次）`);
  /* setBpm 是 BPM 唯一入口，脏输入在此收口 */
  beat.Controls.setBpm(NaN);
  ok(isFinite(beat.Store.S.bpm), "setBpm(NaN) 回退当前值而非污染 S.bpm");
  beat.Controls.setBpm("abc");
  ok(isFinite(beat.Store.S.bpm), "setBpm('abc') 回退当前值");
}

section("T23e 编辑器试听中清空小节 · 真实用户路径（无需任何损坏数据）");
{
  /* v1.2.3 实测：试听中点「清空当前小节」→ 草稿出现空小节 → curPattern() 返回草稿 →
     下一帧 steps[active].t 抛 TypeError → 渲染循环死亡。这条路径完全由正常操作触发 */
  const { beat, els } = loadApp();
  beat.Editor.open();
  els["auditionBtn"].fire("click");                       // 开始试听 → S.preview=true + start()
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 0.3);
  els["clearBarBtn"].fire("click");                       // 清空当前小节（应用内确认框）
  els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 0, "草稿第 1 小节已被清空");
  const err = driveFrames(ac, beat, 6);                   // 跨过整个循环，确保播放头经过空小节
  ok(!err, "试听中清空小节：调度 + 渲染全程无异常（v1.2.3 此处 TypeError）");
  ok(beat.Store.S.playing, "试听仍在继续，未被异常打断");
}

section("T23f 渲染帧异常 · 必须被外壳兜住并给出可见提示（不得静默死亡）");
{
  const { beat, els, sandbox } = loadApp();
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 0.5);
  /* 静音 sandbox 控制台，既保持测试输出干净，又能反过来断言"异常确实被记录了" */
  let errLogged = 0;
  sandbox.console = { log(){}, warn(){}, error(){ errLogged++; } };
  /* 人为注入故障：把状态栏换成"写入即抛"的替身，模拟帧内任意一点出异常。
     注意 els 是惰性缓存——只有被 getElementById 取过的 id 才有实体，
     所以这里必须先经 getElementById 拿到（并登记）statusText 元素，再改它的属性。 */
  const statusEl = sandbox.document.getElementById("statusText");
  let hit = 0;
  Object.defineProperty(statusEl, "textContent", {
    set(){ hit++; throw new Error("注入的渲染故障"); },
    get(){ return ""; }, configurable: true,
  });
  let escaped = null;
  try { beat.Viz.paintFrame(); } catch(e){ escaped = e; }
  ok(!escaped, `帧内异常不再冒泡出 paintFrame（rAF 回调不会静默死掉）${escaped ? "：" + escaped.message : ""}`);
  ok(hit > 0, "故障确实被触发（证明本用例有效）");
  eq(errLogged, 1, "异常已写入控制台，便于事后定位");
  eq(els["modalMask"].hidden, false, "用户看到可见的错误提示，而不是一片安静");
  eq(beat.Store.S.playing, false, "异常后自动停播（不会画面冻结还在响）");
}

section("T23g 正常路径 · 新守卫不得误伤");
{
  const { beat, els, sandbox } = loadApp();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const err = driveFrames(ac, beat, 3);
  ok(!err, "正常节奏型：调度 + 渲染无异常");
  const status = sandbox.document.getElementById("statusText").textContent;
  ok(/^(播放中 · 第 [1-4] 小节 · \d|静音拍)/.test(status), "状态栏照常推进：" + status);
  ok(ac.hits.length > 0, `持续发声（实测 ${ac.hits.length} 次）`);
  ok(beat.Store.S.playing, "仍在播放");
  /* 6/8 与奇数拍同样要能跑通（这些走的是不同的刻度/分组分支） */
  [[6, "6/8"], [5, "5/4"], [7, "7/4"]].forEach(([sig, name]) => {
    const { beat: b } = loadApp({ "beatsight.m2": JSON.stringify({ sig }) });
    b.Controls.start();
    const e = driveFrames(FakeAudioContext.last, b, 3);
    ok(!e, `${name} 正常路径无异常（${e || "OK"}）`);
  });
}

/* ================================================================================
   场景 T24–T29：v1.3.0「第二 / 第三梯队」改造
   对应审计条目：P1-5 持久化冷热分离 · P2-9/P2-10 版本号与重复逻辑 · P1-3 后台调度
                 P1-4 渲染性能 · P2-11 无障碍 · P2-13/P2-14 音频生命周期与跨 origin 提示
   ================================================================================ */

section("T24 持久化 · 冷热分离 / 防抖 / 失败可见（审计 P1-5）");
{
  /* 载荷量级是 P1-5 的原始动因：原实现把预设库塞进同一个 key，而 persist() 挂在
     几乎每个交互上（调速、每个开关、TAP、拍号、音色、音量）。实测 500 预设 = 715 KB，
     每次点击都要全量 JSON.stringify + 同步写盘 → 5–20ms 主线程阻塞 → 音频掉音。 */
  const { beat, storage, setHidden } = loadApp();
  ok(!storage.has("beatsight.state") && !storage.has("beatsight.customs"), "全新用户：加载时不预写任何键");

  beat.Store.persist();
  ok(!storage.has("beatsight.state"), "persist() 是防抖的——调用后不立即落盘");
  beat.Store.flush();
  ok(storage.has("beatsight.state"), "flush() 立即落盘热键");
  const hot = JSON.parse(storage.get("beatsight.state"));
  eq(hot.v, 3, "热键带 schema 版本");
  ok(!("customs" in hot), "热键里不含 customs（冷热分离生效）");
  ok(!storage.has("beatsight.customs"), "纯热变更不写冷键——预设库没变就不该重写它");

  /* 冷数据：预设增删改必须立即写，不能防抖（丢掉一个手写节奏型代价太大） */
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "冷热测试", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }]}));
  ok(storage.has("beatsight.customs"), "导入预设 → 冷键立即落盘（不经防抖）");
  eq(JSON.parse(storage.get("beatsight.customs")).customs.length, 1, "冷键内容正确");

  /* 页面隐藏时强制落盘：防抖窗口内的改动不能在切走时丢 */
  const b2 = loadApp();
  b2.beat.Store.persist();
  ok(!b2.storage.has("beatsight.state"), "切换前：仍在防抖窗口内，尚未落盘");
  b2.setHidden(true);
  ok(b2.storage.has("beatsight.state"), "页面隐藏 → 强制 flush 落盘");

  /* 载荷量级对照 */
  const b3 = loadApp();
  const mk = i => ({ name: "P" + i, meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) });
  b3.beat.Store.importPresets(JSON.stringify({ presets: Array.from({ length: 100 }, (_, i) => mk(i)) }));
  b3.beat.Store.flush();
  const coldLen = b3.storage.get("beatsight.customs").length;
  const hotLen = b3.storage.get("beatsight.state").length;
  ok(coldLen > 20 * hotLen,
    `100 个预设时冷键 ${coldLen} B / 热键 ${hotLen} B（${Math.round(coldLen / hotLen)}×）——调速开关只动热键`);

  /* 失败可见：原先 catch(e){} 完全静默，用户"预设存不进去"毫无察觉 */
  const b4 = loadApp({}, { throwOnWrite: true });
  b4.beat.Controls.setBpm(150);
  b4.beat.Store.flush();
  eq(b4.els["brandChip"].textContent, "v" + b4.beat.VERSION + " · 保存失败", "写失败 → 顶栏 chip 明示");
  ok(b4.els["persistDot"].classList.contains("bad"), "写失败 → 状态点变红");
  eq(b4.els["modalMask"].hidden, false, "写失败 → 一次性弹窗告知（不再静默降级）");
}

section("T25 版本号单一真相源 + 重复逻辑抽取（审计 P2-9 / P2-10）");
{
  const { beat, els, sandbox } = loadApp();
  ok(/^\d+\.\d+\.\d+$/.test(beat.VERSION), `VERSION 形如 x.y.z（实际 ${beat.VERSION}）`);
  eq(sandbox.document.title, "BeatSight 时值节拍器 v" + beat.VERSION, "标题由 VERSION 派生");
  eq(els["brandVer"].textContent, "v" + beat.VERSION, "品牌区版本号由 VERSION 派生");
  eq(els["brandChip"].textContent, "v" + beat.VERSION + " · 稳定版", "顶栏 chip 由 VERSION 派生");
  /* 关键：标记段不得再出现**硬编码**版本号——那正是 P2-9 要根治的漂移源。
     要去掉注释再比（文件里到处是「v1.3.0：某某修复」这类历史注释，它们不是真相源） */
  const markup = html.slice(0, html.indexOf("<script>"))
    .replace(/<!--[\s\S]*?-->/g, "")      // HTML 注释
    .replace(/\/\*[\s\S]*?\*\//g, "");    // CSS 注释
  eq((markup.match(/v\d+\.\d+\.\d+/g) || []).length, 0, "标记段（去注释）零硬编码版本号");

  /* selectedPreset()：原先在 Presets 里写了两遍（updateFallbackNote 与 fallbackBtn） */
  const b = loadApp({ "beatsight.m2": JSON.stringify({ v: 3,
    customs: [{ id: "a", name: "自定义A", meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }],
    sel: { type: "custom", id: "a" } }) });
  eq(b.beat.selectedPreset().name, "自定义A", "selectedPreset：custom id 命中");
  b.beat.Store.S.sel = { type: "builtin", idx: 2 };
  eq(b.beat.selectedPreset().name, b.beat.BUILTINS[2].name, "selectedPreset：builtin idx 命中");
  b.beat.Store.S.sel = { type: "custom", id: "ghost" };
  eq(b.beat.selectedPreset(), undefined, "selectedPreset：不存在的 id → undefined（不抛）");

  /* defaultAccents()：原先在 basicPattern 与 Editor 各写一条阶梯 */
  eq(JSON.stringify(b.beat.defaultAccents(4)), "[0]", "4/4 默认重拍分组 [0]");
  eq(JSON.stringify(b.beat.defaultAccents(5)), "[0,2]", "5/4 默认档 2+3 → [0,2]");
  eq(JSON.stringify(b.beat.defaultAccents(7)), "[0,3,5]", "7/4 默认档 3+2+2 → [0,3,5]");

  const b2 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, sig: 5, accentGrp: { "5": 1 } }) });
  eq(JSON.stringify(b2.beat.defaultAccents(5)), "[0,3]", "5/4 切到 3+2 档 → [0,3]（accentGrp 被遵从）");
  b2.beat.Editor.open();
  eq(JSON.stringify(b2.beat.Editor.draft().accents), JSON.stringify(b2.beat.defaultAccents(5)),
    "编辑器草稿的默认重拍分组与 defaultAccents 同源（抽取前的重复点）");
}

section("T26 后台播放 · 自适应前瞻窗口 + 回前台补排 + 饥饿兜底（审计 P1-3）");
{
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;

  ac.currentTime += 0.02; beat.Audio.scheduler();
  /* 游标会**越过**窗口边界：while 的退出条件是「游标 ≥ now+窗口」，所以 nextNoteTime
     天然落在 [now+win, now+win+一个音符时长] 区间内。断言按这个口径写，否则会误报。 */
  const fg = beat.clock().nextNoteTime - ac.currentTime;
  ok(fg >= beat.CONFIG.schedWindow - 1e-6 && fg <= beat.CONFIG.schedWindow + 0.7,
    `前台窗口收在 ${beat.CONFIG.schedWindow}s 一档（实测游标超前 ${fg.toFixed(3)}s → 低延迟）`);

  /* 切后台：窗口必须拉到 > 1000ms（浏览器对后台标签页 setInterval 的节流下限），
     否则「每次唤醒只排 150ms 的音、然后静音 850ms」→ 必然断续 */
  app.setHidden(true);
  ac.currentTime += 0.02; beat.Audio.scheduler();
  const bg = beat.clock().nextNoteTime - ac.currentTime;
  ok(bg > 1.0, `后台窗口拉到 ${beat.CONFIG.schedWindowBg}s（实测游标超前 ${bg.toFixed(3)}s > 1s 节流下限）`);
  ok(bg - fg > 0.3, `可见性切换确实改变了窗口（前台游标超前 ${fg.toFixed(3)}s → 后台 ${bg.toFixed(3)}s）`);

  /* 模拟后台被严重节流（Chrome intensive throttling 可到 1 次/分钟唤醒）：30 秒没调度 */
  const hitsBefore = ac.hits.length;
  ac.currentTime += 30;

  /* 回前台（visibilitychange）→ 立即补排，不必等下一个 25ms 周期 */
  app.setHidden(false);
  const after = beat.clock();
  ok(ac.hits.length > hitsBefore, `回前台立即补排（新增 ${ac.hits.length - hitsBefore} 次排程）`);

  /* 饥饿兜底：绝不允许把过去 30 秒的音符一次性排到"现在"——那听感是一坨同时爆响。
     MAX_SCHED_STEPS 只拦得住死循环，拦不住这个。 */
  const past = ac.hits.slice(hitsBefore).filter(h => h.t < ac.currentTime - 1e-6);
  eq(past.length, 0, "没有任何音符被排到过去（否则 30 秒的音会瞬间叠响）");
  ok(after.nextNoteTime >= ac.currentTime, "游标已重新锚定，不落后于当前时钟");
  ok(after.nextNoteTime <= ac.currentTime + 1.2, "游标也没被推得过远（仍落在一个窗口内）");
  ok(after.loopStart >= ac.currentTime && after.loopStart <= ac.currentTime + 0.2,
    "时间轴原点已重新锚定到当前时刻附近（不再是几十秒前的旧时间轴 → 不会「有游标但窗口外」空档）");
  eq(after.schedBar, 0, "小节游标归零（相位重新起算）");
  const times = ac.hits.slice(hitsBefore).map(h => h.t);
  ok(times.every((t, i) => i === 0 || t > times[i - 1]), "补排后的时刻严格递增（无重复/无倒退）");
}

section("T27 渲染性能 · 帧内零布局读取 + 增量重绘等价（审计 P1-4）");
{
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1);                       // 进入稳定播放态

  /* 连跑约一个多小节（96BPM 4/4 四分基础一小节 2.5s），逐帧统计：
     布局读取 / className 写入。两者都是"性能承诺"，不数就断言不了。 */
  let frames = 0, reads = 0, idle = 0, incr = 0, full = 0, maxW = 0;
  for (let i = 0; i < 140; i++){
    ac.currentTime += 0.02;
    beat.Audio.scheduler();
    resetProbe();
    beat.Viz.paintFrame();
    frames++;
    reads += PROBE.layoutReads;
    if (PROBE.classWrites === 0){ idle++; continue; }
    maxW = Math.max(maxW, PROBE.classWrites);
    if (PROBE.classWrites <= 10) incr++; else full++;
  }
  eq(reads, 0, `连跑 ${frames} 帧、共 ${idle + incr + full} 次重绘，全程零 offset* 读取（不再帧中途强制重排）`);
  ok(idle > incr + full, `多数帧无事可做（${idle}/${frames} 帧零写入——"音符未变"提前返回生效）`);
  ok(incr >= 3, `增量重绘确实生效：${incr} 帧只改少数格子（≤10 次 className 写入，原实现每次换音符要 128 次）`);
  ok(full <= 2, `只有换小节那 ${full} 帧走全量重扫（增量未退化成"每帧全量"）`);
  ok(maxW <= 60, `单帧写入有上界（最大 ${maxW} 次）`);

  /* 增量重绘最危险的失效方式是"漏改某格"→ 画面与声音脱节。
     逐帧交叉检查渲染结果是否仍满足全量重绘会产出的那套不变量。 */
  const rows = () => app.els["viz"].children.filter(c => /(^| )bar-row( |$)/.test(c.className));
  const cellsOf = r => r.children.filter(c => /(^| )cell( |$)/.test(c.className));
  const checkGrid = () => {
    const rs = rows();
    if (rs.length !== 4) return `行数 ${rs.length} ≠ 4`;
    const cellRows = rs.map(cellsOf);
    const act = [], nxt = [];
    cellRows.forEach((cs, b) => cs.forEach((c, i) => {
      if (/(^| )active( |$)/.test(c.className)) act.push([b, i]);
      if (/(^| )next( |$)/.test(c.className)) nxt.push([b, i]);
    }));
    if (act.length !== 1) return `active 格数 ${act.length} ≠ 1`;
    if (nxt.length !== 1) return `next 格数 ${nxt.length} ≠ 1`;
    const curRow = rs.findIndex(r => r.classList.contains("current"));
    if (curRow !== act[0][0]) return `current 行 ${curRow} ≠ active 所在行 ${act[0][0]}`;
    const [ab, ai] = act[0];
    for (let b = 0; b < 4; b++) for (let i = 0; i < cellRows[b].length; i++){
      const cn = cellRows[b][i].className;
      const want = (b < ab) ? "played" : (b > ab) ? "upcoming" : (i < ai) ? "played" : (i === ai) ? "active" : "upcoming";
      if (!new RegExp("(^| )" + want + "( |$)").test(cn)) return `格[${b}][${i}] 应为 ${want}，实际「${cn}」`;
    }
    const [nb, ni] = nxt[0];
    const expB = ni === 0 ? (nb + 3) % 4 : nb;         // next 只能是 active 的下一格，或下一行第一格
    if (!(nb === ab && ni === ai + 1) && !(nb === (ab + 1) % 4 && ni === 0)) return `next 位置 [${nb}][${ni}] 不是 active 的后继`;
    if (nb !== expB && ni !== 0) return `next 行不合法`;
    return null;
  };
  let checked = 0; const problems = [];
  for (let k = 0; k < 300; k++){
    ac.currentTime += 0.02;
    beat.Audio.scheduler();
    beat.Viz.paintFrame();
    if (k % 6) continue;
    checked++;
    const p = checkGrid();
    if (p) problems.push(p);
  }
  ok(problems.length === 0, `增量重绘与全量重绘结果一致（抽查 ${checked} 帧，破例 ${problems.length} 例）`);
  problems.slice(0, 5).forEach(p => console.log("      · " + p));
}

section("T28 无障碍 · 开关语义 / 选中语义 / 分级播报 / 焦点陷阱（审计 P2-11）");
{
  const { beat, els, sandbox } = loadApp();

  /* 开关：role=switch + aria-checked，且与视觉同源（同一个助手写） */
  eq(els["muteToggle"].getAttribute("aria-checked"), "false", "静音拍开关初始 aria-checked=false");
  els["muteToggle"].fire("click");
  eq(els["muteToggle"].getAttribute("aria-checked"), "true", "点击后 aria-checked 跟随状态");
  ok(/(^| )on( |$)/.test(els["muteToggle"].className), "视觉（className=on）与语义（aria-checked=true）同步");
  els["bounceToggle"].fire("click");
  eq(els["bounceToggle"].getAttribute("aria-checked"), "false", "弹跳球开关关闭 → aria-checked=false");
  els["countInToggle"].fire("click");
  eq(els["countInToggle"].getAttribute("aria-checked"), "true", "预备拍开关 → aria-checked=true");

  /* 三选一 pill 组：aria-pressed 与 .active 同源 */
  const pills = sel => els[sel].children;
  eq(pills("sigRow")[2].getAttribute("aria-pressed"), "true", "4/4 初始 aria-pressed=true");
  beat.Controls.setSig(6);
  eq(pills("sigRow")[2].getAttribute("aria-pressed"), "false", "切到 6/8 后 4/4 的 aria-pressed 复位");
  eq(pills("sigRow")[4].getAttribute("aria-pressed"), "true", "6/8 的 aria-pressed 置位");
  ok(!/(^| )active( |$)/.test(pills("sigRow")[2].className) && /(^| )active( |$)/.test(pills("sigRow")[4].className),
    "视觉高亮与 aria-pressed 一致（原先只改 classList）");
  beat.Controls.setSwing(67);
  eq(pills("swingRow")[1].getAttribute("aria-pressed"), "true", "Swing 档位 aria-pressed 同步");
  beat.Controls.setTimbre("drum");
  eq(pills("timbreRow")[2].getAttribute("aria-pressed"), "true", "音色档位 aria-pressed 同步");

  /* 分级播报：粗粒度事件写 srAnnounce；高频读数 #statusText 绝不挂 aria-live。
     注意这两条要**查 index.html 原文**——它们是纯标记属性，用 stub 断言等于在断言 stub 自己 */
  ok(/id="srAnnounce"[^>]*aria-live="polite"/.test(html), "播报区在标记里挂了 aria-live=polite");
  ok(/id="srAnnounce"[^>]*role="status"/.test(html), "播报区在标记里声明 role=status");
  ok(!/id="statusText"[^>]*aria-live/.test(html), "高频状态栏没有 aria-live（否则读屏每换一个十六分音就刷屏）");
  eq((html.match(/role="switch"/g) || []).length, 4, "标记里 4 个 .toggle-pill 都声明了 role=switch");
  eq((html.match(/id="(mute|bounce|countIn|trainer)Toggle"[^>]*aria-checked=/g) || []).length, 4,
    "4 个开关在标记里都带初始 aria-checked");
  beat.Controls.start();
  ok(/开始播放/.test(els["srAnnounce"].textContent), `开始播放被播报：「${els["srAnnounce"].textContent}」`);
  beat.Controls.stop();
  eq(els["srAnnounce"].textContent, "已停止", "停止被播报");

  /* 播放键标签随状态变（原先静态写「播放/停止」） */
  eq(els["playBtn"].getAttribute("aria-label"), "播放", "停机时 aria-label=播放");
  beat.Controls.start();
  eq(els["playBtn"].getAttribute("aria-label"), "停止", "播放中 aria-label=停止");
  beat.Controls.stop();

  /* 焦点陷阱：弹窗/编辑器打开时背景 inert（用重算而非置位，嵌套弹窗不会提前摘掉） */
  const bg = () => sandbox.document.querySelectorAll(".main, .topbar");
  ok(!bg().some(e => e.inert), "常态：背景可交互");
  beat.Modal.uiAlert("测试");
  ok(bg().every(e => e.inert), "弹窗打开 → 背景 inert（Tab 不再跑到背后）");
  els["modalOk"].fire("click");
  ok(!bg().some(e => e.inert), "弹窗关闭 → inert 摘除");
  beat.Editor.open();
  ok(bg().every(e => e.inert), "编辑器打开 → 背景 inert");
  /* 嵌套：编辑器里再弹确认框，关掉弹窗后编辑器还开着 → 背景必须保持 inert（重算而非置位） */
  beat.Modal.uiAlert("嵌套");
  els["modalOk"].fire("click");
  ok(bg().every(e => e.inert), "嵌套弹窗关闭后仍保持 inert（编辑器还开着）");
  beat.Editor.tryClose();
  ok(!bg().some(e => e.inert), "编辑器关闭 → inert 摘除");
}

section("T29 音频生命周期 + 跨 origin 迁移提示（审计 P2-13 / P2-14）");
{
  /* iOS 的两个关键状态：interrupted（通话/闹钟抢占音频会话，Safari 私有状态）
     与 closed（上下文被彻底关闭）。原实现只认 suspended → 通话结束后可能永久无声。 */
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  ok(typeof ac.onstatechange === "function", "已安装 ctx.onstatechange（原先完全没监听）");

  const r0 = ac.resumeCount;
  ac.setState("interrupted");
  eq(ac.resumeCount, r0 + 1, "interrupted → 自动 resume（否则通话结束后永久无声）");

  /* closed → 重建上下文，否则旧时钟失效后表现为「在播放但一直不出声」 */
  ac.setState("closed");
  const ac2 = FakeAudioContext.last;
  ok(ac2 !== ac, "closed → 已重建 AudioContext");
  eq(ac2.state, "running", "新上下文为 running");
  ok(beat.Store.S.playing, "重建后仍在播放（不是被迫停机）");
  const c = beat.clock();
  ok(c.nextNoteTime >= ac2.currentTime - 0.2 && c.nextNoteTime <= ac2.currentTime + 1.0 + 0.2,
    "游标已按新时钟重新锚定（否则会领先新时钟几分钟 → 一直不出声）");
  const err = driveFrames(ac2, beat, 2);
  ok(!err, `重建后能继续正常排程与渲染（${err || "OK"}）`);

  /* pagehide：页面离开必须停播（移动端否则「切走了还在响」） */
  const app2 = loadApp();
  app2.beat.Controls.start();
  ok(app2.beat.Store.S.playing, "pagehide 前在播放");
  app2.firePageHide();
  ok(!app2.beat.Store.S.playing, "pagehide → 自动停播");

  /* 跨 origin 提示：README 同时推荐「双击 index.html」与在线版，但两者 origin 不同、
     localStorage 不共享，用户看不到任何提示。预设库为空时露一次。 */
  const fresh = loadApp();
  eq(fresh.els["migHint"].hidden, false, "预设库为空 → 提示跨地址不共享预设");
  fresh.els["migHintBtn"].fire("click");
  eq(fresh.els["migHint"].hidden, true, "确认后关闭");
  ok(fresh.beat.Store.S.migHint, "确认状态记入内存");
  fresh.beat.Store.flush();
  eq(JSON.parse(fresh.storage.get("beatsight.state")).migHint, true, "确认状态已持久化（不再重复打扰）");
  const withPresets = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, customs: [{ id: "x", name: "已有", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }) });
  eq(withPresets.els["migHint"].hidden, true, "已有预设的用户不显示该提示");
}

/* ================================================================================
   场景 T30–T32：v1.3.1「遗留问题」
   T30 弹跳球物理的逐帧数值断言（此前 399 行 Viz 里最容易悄悄改坏的一块完全无断言）
   T31 交互接线覆盖（事件处理器体——覆盖率工具显示这一层是大片空白）
   T32 旧键清理（冷热迁移完成后删除 beatsight.m2）
   ================================================================================ */

section("T30 弹跳球物理 · 逐帧数值断言（v1.3.1）");
{
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv = beat.Viz.internals();
  const CB = beat.CONFIG.bounce;
  ok(!!iv.ballEl && !!iv.shadowEl && !!iv.waitEl, "弹跳球三件套已渲染（球 / 影子 / 接力待命球）");

  const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const state = () => {
    const b = nums(iv.ballEl.style.transform);
    const sh = nums(iv.shadowEl.style.transform);
    return {
      x: b[0], y: b[1],
      sx: b.length > 2 ? b[2] : 1, sy: b.length > 2 ? b[3] : 1,
      shx: sh[0], shy: sh[1], shs: sh.length > 2 ? sh[2] : 1,
      op: iv.shadowEl.style.opacity === "" ? NaN : +iv.shadowEl.style.opacity,
      wait: iv.waitEl.style.display !== "none",
    };
  };

  /* 采样整条时间线（细步长 → 采样点距发声时刻 ≤ 1.25ms，落点对齐可严格断言） */
  const TPB = 48;                                    // 沙箱内的 PPQN，测试侧复刻一份
  const loopStart = beat.clock().loopStart;
  const barDur = beat.Store.S.sig * (60 / beat.Store.S.bpm);   // 一小节秒数 = 拍数 × 秒/拍
  const samples = [];
  const onsets = new Map();
  const DT = 0.0025;
  for (let i = 0; i < Math.round(barDur * 2 / DT); i++){          // 跑满两个小节
    ac.currentTime += DT;
    beat.Audio.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.bar + ":" + e.t.toFixed(4), e));
    samples.push(Object.assign({ now: ac.currentTime }, state()));
  }
  const os = [...onsets.values()].filter(e => e.bar === 0).sort((a, b) => a.t - b.t);
  ok(os.length >= 5, `采集到第 1 小节的 ${os.length} 个发声点`);

  /* 几何：落点 = 音符块左缘（原实现读 offset，v1.3 起读缓存，两者都必须等于这个式子） */
  const g = iv.rowGeo[0];
  const barTicks = beat.Store.S.sig * TPB;
  const expectX = cumT => g.left + (cumT / barTicks) * g.width - 8;

  /* ① 落点 = 真实发声时刻：每个发声点的最近采样应落在该音符块左缘 */
  let worstX = 0, worstAt = null;
  for (const e of os){
    let best = null;
    for (const s of samples) if (!best || Math.abs(s.now - e.t) < Math.abs(best.now - e.t)) best = s;
    if (!best) continue;
    const d = Math.abs(best.x - expectX(e.cumT));
    if (d > worstX){ worstX = d; worstAt = "cumT=" + e.cumT; }
  }
  ok(worstX < 2, `每个发声点的落点都贴着该音符块左缘（最大偏差 ${worstX.toFixed(2)}px @ ${worstAt}）`);

  /* ② 抛物线：取第一条完整弧（os[0] → os[1]）逐点验证 y = yBase − H·4p(1−p) */
  {
    const A = os[0], B = os[1], T = B.t - A.t;
    const yBase = g.top - 20;
    const H = Math.min(Math.max(CB.min, Math.min(CB.max, CB.k * T * T)), yBase + 6);
    const inArc = samples.filter(s => s.now > A.t + 0.05 && s.now < B.t - 0.05);   // 去掉两端挤压窗口
    let worstY = 0, peak = 0, peakAt = 0;
    for (const s of inArc){
      const p = (s.now - A.t) / T;
      const yExp = yBase - H * 4 * p * (1 - p);
      worstY = Math.max(worstY, Math.abs(s.y - yExp));
      const h = yBase - s.y;
      if (h > peak){ peak = h; peakAt = p; }
    }
    ok(worstY < 1.5, `弧内每帧 y 都符合重力抛物线 y=yBase−H·4p(1−p)（最大偏差 ${worstY.toFixed(2)}px，H=${H.toFixed(1)}）`);
    ok(Math.abs(peak - H) < 1 && Math.abs(peakAt - 0.5) < 0.12,
      `实测跳高 ${peak.toFixed(1)}px ≈ 公式值 ${H.toFixed(1)}px，且最高点在中点附近（p=${peakAt.toFixed(2)}）`);
    ok(H <= CB.max, `跳高不超过 CONFIG.bounce.max（${H.toFixed(1)} ≤ ${CB.max}）`);
  }

  /* ③ 触地挤压 → 空中拉伸（体积近似守恒） */
  {
    const A = os[0], T = os[1].t - A.t;
    /* 只取挤压窗口的前 50%：窗口末端 sy/sx 已回落到 1（回弹收尾），那是设计而非缺陷，
       卡在边界上断言只会得到浮点噪声（实测 f=0.68 时 sy 已回到 0.967） */
    const touch = samples.filter(s => s.now >= A.t && s.now < A.t + CB.squash * 0.5);
    const mid = samples.find(s => Math.abs((s.now - A.t) / T - 0.5) < 0.03) || samples[0];
    ok(touch.length > 0 && touch.every(s => s.sy < 0.95 && s.sx > 1.05),
      `触地挤压明显（${touch.length} 帧：sy<0.95 且 sx>1.05，首帧 sy=${touch[0].sy.toFixed(3)}/sx=${touch[0].sx.toFixed(3)}）`);
    ok(mid.sy > 1 && mid.sx < 1, `弧中点拉伸（sy=${mid.sy.toFixed(3)}>1、sx=${mid.sx.toFixed(3)}<1，体积近似守恒）`);
  }

  /* ④ 地面投影：球越高 → 影子越小越淡 */
  {
    const A = os[0], B = os[1];
    const inArc = samples.filter(s => s.now > A.t + CB.squash && s.now < B.t - CB.squash);
    const top = inArc.reduce((a, b) => (b.y < a.y ? b : a));
    /* 「落地采样」直接取全场最接近 B.t 的那一帧（inArc 排掉了两端，取不到真正的落地点） */
    const land = samples.reduce((a, b) => (Math.abs(b.now - B.t) < Math.abs(a.now - B.t) ? b : a));
    ok(top.op < land.op && top.shs < land.shs,
      `影子随高度变小变淡（最高处 opacity=${top.op.toFixed(3)}/scale=${top.shs.toFixed(3)}，落地 opacity=${land.op.toFixed(3)}/scale=${land.shs.toFixed(3)}）`);
    ok(land.shs > 0.9, `落地时影子几乎未被压缩（scale=${land.shs.toFixed(3)}）`);
    ok(Math.abs(top.shx - top.x) <= 1.5, `影子水平跟随球体（偏差 ${Math.abs(top.shx - top.x).toFixed(1)}px，即球-影固定偏移）`);
  }

  /* ⑤ 接力待命球：只在「终端弧」（本小节最后一颗 → 行右缘）飞行期间出现 */
  {
    const firstWindow = samples.filter(s => s.now > loopStart && s.now < loopStart + barDur * 0.25);
    const lastWindow = samples.filter(s => s.now > loopStart + barDur * 0.8 && s.now < loopStart + barDur);
    ok(firstWindow.length && firstWindow.every(s => !s.wait), "小节开头（非终端弧）不显示待命球");
    ok(lastWindow.some(s => s.wait), "小节末尾（终端弧）显示待命球——下一小节的第一颗已在待命");
  }

  /* ⑥ 关掉开关：球与影子一起隐藏，且不再写 transform */
  {
    beat.Store.S.bounce = false;
    ac.currentTime += DT;
    beat.Viz.paintFrame();
    eq(iv.ballEl.style.display, "none", "S.bounce=false → 球隐藏（只控显隐，onset 表照常维护）");
    eq(iv.shadowEl.style.display, "none", "影子同步隐藏");
    eq(iv.waitEl.style.display, "none", "待命球同步隐藏");
    beat.Store.S.bounce = true;
  }

  /* ⑦ prefers-reduced-motion：保位置、去形变（前庭敏感用户不该被挤压/拉伸打扰） */
  {
    const rm = loadApp({}, { reduceMotion: true });
    rm.beat.Controls.start();
    const rac = FakeAudioContext.last;
    const riv = rm.beat.Viz.internals();
    let deform = 0, moved = 0, prevX = null;
    for (let i = 0; i < 400; i++){
      rac.currentTime += DT;
      rm.beat.Audio.scheduler();
      rm.beat.Viz.paintFrame();
      const b = nums(riv.ballEl.style.transform);
      if (b.length > 2 && (Math.abs(b[2] - 1) > 1e-6 || Math.abs(b[3] - 1) > 1e-6)) deform++;
      if (prevX !== null && Math.abs(b[0] - prevX) > 1e-6) moved++;
      prevX = b[0];
    }
    eq(deform, 0, "reduced-motion：全程无形变（scale 恒为 1,1）");
    ok(moved > 50, `reduced-motion：位置照常推进 ${moved} 帧（球何时落拍是核心功能提示，不能去掉）`);
  }
}

section("T31 交互接线 · 事件处理器体（v1.3.1，覆盖率工具指出的空白层）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;

  /* 三组 pill 的真实点击路径（handler 里读 btn.dataset；桩里 pill() 提供 closest） */
  els["sigRow"].fire("click", { target: pill({ sig: "6" }) });
  eq(S.sig, 6, "点 6/8 → 拍号生效");
  eq(els["sigRow"].children[4].getAttribute("aria-pressed"), "true", "同一路径上 aria-pressed 也同步");
  els["sigRow"].fire("click", { target: pill({}) });
  eq(S.sig, 6, "点到行空白处（closest 返回 null）→ 提前返回，不改拍号");
  els["swingRow"].fire("click", { target: pill({ swing: "67" }) });
  eq(S.swing, 67, "点 Swing 档 → 生效");
  els["timbreRow"].fire("click", { target: pill({ timbre: "wood" }) });
  eq(S.timbre, "wood", "点音色档 → 生效");

  /* 奇数拍重拍分组行（按钮是动态生成的，直接触发它的 click） */
  beat.Controls.setSig(5);
  const accBtns = els["accRow"].children;
  eq(accBtns.length, 2, "5/4 → 生成 2 个重拍分组档");
  accBtns[1].fire("click");
  eq(S.accentGrp[5], 1, "点第二个分组档 → accentGrp 更新为 3+2");

  /* 音量滑杆：input 只改状态与文案（拖动过程不落盘），change 才落盘 */
  els["volMaster"].value = "45"; els["volMaster"].fire("input");
  eq(S.vol, 0.45, "总音量 input → 状态更新");
  eq(els["volMasterPct"].textContent, "45%", "百分比文案同步");
  els["volAccent"].value = "20"; els["volAccent"].fire("input");
  eq(S.accentVol, 0.2, "重拍增强量 input → 状态更新");

  /* 快捷速度档（按钮在 Controls 初始化时生成） */
  const presetBtn = els["bpmPresetRow"].children.find(b => b.textContent === "120");
  presetBtn.fire("click");
  eq(S.bpm, 120, "点快捷档 120 → BPM 生效");

  /* 播放键与空格键 */
  els["playBtn"].fire("click");
  ok(S.playing, "点播放键 → 开始播放");
  app.fireWin("keydown", { code: "Space" });
  ok(!S.playing, "空格键 → 停止（键盘与按钮同一入口）");
  app.fireWin("keydown", { code: "Space" });
  ok(S.playing, "再按空格 → 继续播放");
  els["playBtn"].fire("click");
  ok(!S.playing, "再点播放键 → 停止");

  /* ±1 / ±5 步进（pointerdown 走 bindStep；长按分支靠 setTimeout，桩里不真延迟） */
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 125, "点 +5 → 125");
  els["bpmMinus5"].fire("pointerdown");
  els["bpmMinus5"].fire("pointerup");
  eq(S.bpm, 120, "点 -5 再抬指 → 回到 120");

  /* BPM 数字 → 弹窗输入 */
  els["bpmNum"].fire("click");
  eq(els["modalMask"].hidden, false, "点 BPM 数字 → 弹出输入框");
  els["modalInput"].value = "88";
  els["modalOk"].fire("click");
  eq(S.bpm, 88, "确认后 BPM 应用");

  /* TAP 测速：两次点击间隔 600ms → 100 BPM */
  let clock = 1000; app.setNow(clock);
  els["tapBtn"].fire("click");
  eq(els["tapBtn"].textContent, "TAP · 再点一次", "第一次点击提示再点");
  clock += 600; app.setNow(clock);
  els["tapBtn"].fire("click");
  eq(S.bpm, 100, "两次点击间隔 600ms → 100 BPM");
  ok(/TAP · 100 BPM/.test(els["tapBtn"].textContent), "按钮回显测得的 BPM");

  /* 预备拍拍数输入：脏值回退原值，越界钳制 */
  els["countInBeats"].value = "99"; els["countInBeats"].fire("change");
  eq(S.countIn.beats, 8, "预备拍数超上限 → 钳到 8");
  els["countInBeats"].value = "abc"; els["countInBeats"].fire("change");
  eq(S.countIn.beats, 8, "预备拍数脏值 → 回退原值（不清零）");

  /* 拍数输入必须**紧跟**「预备拍」开关（v1.3.3 修的）：
     原先它排在 .config 行最末（弹跳球之后），打开预备拍时行尾凭空冒出一个孤零零的「4」，
     视觉上像是弹跳球的参数（用户实拍反馈）。用标记层 + 运行时两层断言锁住位置。 */
  const seg = html.slice(html.indexOf('id="countInToggle"'), html.indexOf('id="bounceToggle"'));
  ok(/id="countInBeatsWrap"/.test(seg),
    "拍数输入在标记里夹在「预备拍」与「弹跳球」之间（不再隔着弹跳球）");
  ok(/<span class="hint">拍<\/span>/.test(html), "拍数带可见单位「拍」（原先只有 aria-label，肉眼无从判断）");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, false, "打开预备拍 → 拍数输入出现");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, true, "关闭预备拍 → 拍数输入隐藏");

  /* 预设列表：点内置项 / 点自定义项的删除按钮 / 调色板的回退提示 */
  const listItems = () => els["presetList"].children.filter(c => c._h && c._h.click);
  ok(listItems().length >= beat.BUILTINS.length, `预设列表渲染出 ${listItems().length} 个可点项`);
  listItems()[3].fire("click");
  eq(S.sel.idx, 3, "点内置预设项 → 选中它");
  eq(els["patternName"].textContent, beat.BUILTINS[3].name, "标题同步为该预设名");

  /* 导入：走 FileReader 接线（桩的 FileReader 会把 FILE_TEXT 交给 onload） */
  app.setFileText(JSON.stringify({ presets: [{ name: "接线导入", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }));
  els["importFile"].fire("change", { target: { files: [{}], value: "" } });
  eq(beat.Store.customs.length, 1, "导入接线跑通 → 预设 +1");
  eq(beat.Store.customs[0].name, "接线导入", "导入内容正确");
  eq(els["modalMask"].hidden, false, "导入成功给出提示");

  /* 导出：Blob + <a download> 接线不应抛错 */
  ok(beat.Store.exportPresets(), "导出预设接线跑通（有预设时返回 true）");

  /* 自定义预设项的删除按钮（stopPropagation 后走 uiConfirm） */
  const customItem = listItems().find(c => c.children.some(x => /(^| )del( |$)/.test(x.className)));
  const delBtn = customItem.children.find(x => /(^| )del( |$)/.test(x.className));
  delBtn.fire("click");
  eq(els["modalMask"].hidden, false, "点删除 → 弹确认框");
  els["modalOk"].fire("click");
  eq(beat.Store.customs.length, 0, "确认后预设被删除");
  ok(app.storage.has("beatsight.customs"), "删除后冷键已落盘");

  /* 编辑器：动态调色板项、删除/复制/清空、撤销、返回 */
  beat.Editor.open();
  eq(els["editor"].classList.contains("open"), true, "点「编辑节奏型」→ 编辑器打开");
  const palette = els["palette"].children;
  ok(palette.length === 11, "音符块库 11 项");
  /* 用相对数而不是写死 4：草稿来自当前选中的预设，不同预设每小节音符数不同
     （写死期望值是典型的测试脆弱性来源） */
  const n0 = beat.Editor.draft().bars[0].length;
  ok(n0 > 0, `草稿第 1 小节有 ${n0} 个音符（来自当前预设）`);
  palette[6].fire("click");                              // 三连音组块（一次插入 3 枚）
  eq(beat.Editor.draft().bars[0].length, n0 + 3, "点三连音组块 → 一次追加 3 枚");
  els["undoBtn"].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0, "撤销 → 回到点击前的音符数");
  els["copyBarBtn"].fire("click"); els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[3].length, n0, "复制到全部 → 第 4 小节与第 1 小节一致");
  els["clearBarBtn"].fire("click"); els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 0, "清空当前小节 → 空小节");
  eq(els["savePresetBtn"].disabled, true, "空小节 → 保存禁用（真实点击路径下的校验）");
  els["undoBtn"].fire("click");
  eq(els["savePresetBtn"].disabled, false, "撤销后保存恢复可用");
  app.fireWin("keydown", { code: "Space" });             // 编辑器打开时空格不该触发播放
  ok(!S.playing, "编辑器打开时空格被键盘处理器吃掉（不误触播放）");
  /* Ctrl+Z 撤销（键盘路径，与撤销按钮同一入口）：先制造一次**明确改变音符数**的改动，
     否则可能撤到与当前等长的状态，断言看不出区别（第一版就踩了这个） */
  palette[6].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0 + 3, "再追加 3 枚（为 Ctrl+Z 准备可观察的变化）");
  app.fireWin("keydown", { key: "z", ctrlKey: true });
  eq(beat.Editor.draft().bars[0].length, n0, "Ctrl+Z → 撤回刚才的追加");
  /* 草稿有未保存改动 → Esc 先弹确认框，不静默丢弃用户改动 */
  app.fireWin("keydown", { key: "Escape" });
  eq(els["modalMask"].hidden, false, "Esc（有改动）→ 先弹确认框（不静默丢弃改动）");
  els["modalOk"].fire("click");
  eq(els["editor"].classList.contains("open"), false, "确认放弃后返回练习");
  /* 无改动时 Esc 直接返回，不打扰 */
  beat.Editor.open();
  app.fireWin("keydown", { key: "Escape" });
  eq(els["editor"].classList.contains("open"), false, "Esc（无改动）→ 直接返回");

  /* 试听开关：开 → 关（stopAudition 路径） */
  beat.Editor.open();
  els["auditionBtn"].fire("click");
  eq(S.preview, true, "点试听 → 进入试听态");
  els["auditionBtn"].fire("click");
  eq(S.preview, false, "再点 → 退出试听（stopAudition 恢复主界面拍号）");
  beat.Editor.tryClose();

  /* 弹窗的两种取消路径 */
  beat.Modal.uiConfirm("随便问问", () => { throw new Error("取消时不该执行 onOk"); });
  els["modalCancel"].fire("click");
  eq(els["modalMask"].hidden, true, "点取消 → 关闭");
  beat.Modal.uiConfirm("再问一次", () => { throw new Error("点遮罩不该执行 onOk"); });
  els["modalMask"].fire("click");
  eq(els["modalMask"].hidden, true, "点遮罩 → 也算取消");
}

section("T32 旧键清理 · 冷热拆分后删除 beatsight.m2（v1.3.1）");
{
  const mkPat = (id, name) => ({ id, name, meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) });
  const legacy = { v: 3, bpm: 111, sig: 5, customs: [mkPat("L1", "老预设")] };

  const app = loadApp({ "beatsight.m2": JSON.stringify(legacy) });
  ok(!app.storage.has("beatsight.m2"), "拆分迁移成功后删除旧键（否则老用户永远留着一个最大可达 715 KB 的废弃键）");
  ok(app.storage.has("beatsight.m2.bak"), "删除前已确保 .bak 备份存在");
  eq(JSON.parse(app.storage.get("beatsight.m2.bak")).bpm, 111, ".bak 是旧键原文（可人工回退）");
  eq(JSON.parse(app.storage.get("beatsight.state")).bpm, 111, "热键已接管 bpm");
  eq(JSON.parse(app.storage.get("beatsight.customs")).customs.length, 1, "冷键已接管预设");
  eq(JSON.parse(app.storage.get("beatsight.customs")).customs[0].name, "老预设", "冷键内容正确");
  eq(app.beat.Store.S.bpm, 111, "本次会话状态正常（迁移不影响读）");
  eq(app.beat.Store.customs.length, 1, "本次会话预设可用");

  /* .bak 已存在则不覆盖：保留最早那份最原始的数据（可能是 v1 浮点格式） */
  const app2 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, bpm: 222 }), "beatsight.m2.bak": "{\"orig\":1}" });
  eq(app2.storage.get("beatsight.m2.bak"), "{\"orig\":1}", ".bak 已存在则不覆盖");
  ok(!app2.storage.has("beatsight.m2"), "旧键仍被清理");

  /* 写后校验未过（写盘抛错）→ 必须保留旧键，不能把用户数据弄丢 */
  const app3 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, bpm: 190 }) }, { throwOnWrite: true });
  ok(app3.storage.has("beatsight.m2"), "写后校验未过 → 保留旧键以备下次启动重试");
  ok(!app3.storage.has("beatsight.state"), "此时新键确实没写成功（所以才不能删）");
  eq(app3.beat.Store.S.bpm, 190, "本会话仍从旧键正常读到状态");

  /* 半迁移状态（热键在、冷键缺）：不动旧键，避免把用户已删掉的预设从陈旧数据里复活 */
  const app4 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, bpm: 200 }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 210 }) });
  eq(app4.beat.Store.S.bpm, 210, "热键优先于旧键");
  ok(app4.storage.has("beatsight.m2"), "半迁移状态下不动旧键（不猜、不删）");

  /* 已迁移过的用户再次加载：旧键已不存在，冷热键照常工作 */
  const app5 = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 220 }),
    "beatsight.customs": JSON.stringify({ v: 1, customs: [mkPat("C1", "现有")] }) });
  eq(app5.beat.Store.S.bpm, 220, "老用户第二次启动：直接读热键");
  eq(app5.beat.Store.customs[0].name, "现有", "直接读冷键");
  ok(!app5.storage.has("beatsight.m2.bak"), "不需要迁移时不产生多余备份");
}


section("T33 Presets 接线补完 · 自定义项 / 一键切回 / 导入失败（v1.3.1）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  const items = () => els["presetList"].children.filter(c => c._h && c._h.click);
  const textOf = el => (el.textContent || "") + (el.children || []).map(textOf).join("|");
  const byName = nm => items().find(c => textOf(c).includes(nm));

  /* 导入一个 5/4 自定义预设：走**真实文件输入路径**（列表重建发生在该处理器里，
     直接调 Store.importPresets 不会刷新列表——这一点本身也值得记住） */
  app.setFileText(JSON.stringify({ presets: [
    { name: "五拍自定义", meter: 5, accents: [0, 3],
      bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }
  ]}));
  els["importFile"].fire("change", { target: { files: [{}], value: "" } });
  els["modalOk"].fire("click");
  eq(beat.Store.customs.length, 1, "5/4 自定义预设导入成功（小节和 = 5×48 = 240）");
  beat.Controls.setSig(4);                                   // 先切到 4/4，制造"预设拍号 ≠ 当前拍号"
  const customItem = byName("五拍自定义");
  ok(!!customItem, "自定义预设项已渲染（按名称定位）");
  customItem.fire("click");
  eq(S.sel.id, beat.Store.customs[0].id, "点自定义项 → 选中它");
  eq(S.sig, 5, "预设拍号与当前不符时自动切到 5/4");

  /* 一键切回（fallbackBtn）：拍号不匹配时把拍号切回去。
     注意：回退提示条只在 refreshAfterPatternChange 里刷新，而真实 UI 是 pill 点击处理器
     把 setSig 与 refreshAfterPatternChange 成对调用的——所以这里必须走真实点击，
     直接调 setSig(4) 不会让提示条出现（这也解释了为什么该处理器里必须成对写） */
  els["sigRow"].fire("click", { target: pill({ sig: "4" }) });   // 切回 4/4 → 选中项与拍号不匹配
  eq(S.sig, 4, "真实点击切到 4/4");
  eq(els["fallbackNote"].hidden, false, "拍号不匹配 → 显示回退提示条");
  ok(/五拍自定义/.test(els["fallbackText"].textContent), "提示文案点名被回退的预设");
  els["fallbackBtn"].fire("click");
  eq(S.sig, 5, "点「切回」→ 拍号切回预设自身的 5/4");
  eq(els["fallbackNote"].hidden, true, "切回后提示条收起");

  /* 导入失败要给出原因（不是静默失败） */
  app.setFileText('{"presets":[{"name":"坏预设","meter":4,"bars":[[{"t":48}]]}]}');
  els["importFile"].fire("change", { target: { files: [{}], value: "" } });
  eq(els["modalMask"].hidden, false, "导入失败 → 弹窗告知");
  ok(/导入失败/.test(els["modalMsg"].textContent), `失败原因可读：「${els["modalMsg"].textContent.slice(0, 40)}」`);
  els["modalOk"].fire("click");

  /* 导出 / 导入按钮自身的接线（真按钮 → <a download> / file input） */
  els["exportBtn"].fire("click");
  ok(beat.Store.customs.length > 0, "点导出按钮 → 走 exportPresets（不抛错）");
  els["importBtn"].fire("click");
  ok(true, "点导入按钮 → 走 importFile.click()（不抛错）");
}

section("T34 挂起兜底路径 · 就地接续失败时的降级（v1.3.1）");
{
  /* 「就地接续」失败才会落到挂起路径，而它只在**当前小节为空**时失败——
     正常自定义预设不可能有空小节（校验要求每小节恰好占满 meter×48），
     所以唯一入口是**试听中的草稿**。这条路径此前零覆盖。
     两个关键细节（第一版都写错了）：
       ① 不能先驱动帧：空小节会被调度器迅速跳过，游标离开空小节后接续就成功了；
       ② 判据不能用标题：预览态下 activePattern() 返回草稿，标题两侧都指向草稿名。
          改用可视化标题里的拍号——它只在 applyPatternChange → buildViz 时才更新。 */
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  beat.Editor.open();
  els["clearBarBtn"].fire("click"); els["modalOk"].fire("click");     // 清空第 1 小节（editBar 默认 0）
  eq(beat.Editor.draft().bars[0].length, 0, "草稿第 1 小节已清空");
  els["auditionBtn"].fire("click");                                   // 试听：开始播放但**不驱动**
  ok(S.playing && S.preview, "试听中（播放 + 预览态）");
  eq(beat.clock().schedBar, 0, "未驱动 → 调度游标仍停在第 1 小节（正是那个空小节）");
  const vizBefore = els["vizTitle"].textContent;
  eq(/4\/4/.test(vizBefore), true, `可视化当前按 4/4 渲染：「${vizBefore}」`);

  /* 播放中切到不同拍号的节奏型 → 接续失败 → 挂起 */
  const target = beat.BUILTINS.findIndex(p => p.meter === 3);
  els["presetList"].children.filter(c => c._h && c._h.click)[target].fire("click");
  eq(els["vizTitle"].textContent, vizBefore,
    "挂起生效：可视化**没有**立刻重建（「就地接续」路径会立刻 rebuildViz——这条区分两条路径）");
  eq(S.sig, 3, "新拍号已记录（等小节边界生效）");

  /* 驱动越过若干小节边界：挂起被消费，节奏型真正生效 */
  const err = driveFrames(FakeAudioContext.last, beat, 16);
  ok(!err, `挂起窗口内调度 + 渲染无异常（${err || "OK"}）`);
  ok(/3\/4/.test(els["vizTitle"].textContent),
    `越过循环起点后按新拍号重建可视化：「${els["vizTitle"].textContent}」`);
  ok(S.playing, "整个过程播放未中断（挂起不会打断播放）");
  beat.Controls.stop();
  beat.Editor.tryClose(); els["modalOk"].fire("click");
}

section("T35 剩余边角接线 · resize / 弹窗键盘 / 老数据引用迁移 / 编辑器选中与删除（v1.3.1）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;

  /* 窗口 resize：防抖 200ms 后重建（未播放）或只重采几何缓存（播放中，不打断动画） */
  const vizBefore = els["vizTitle"].textContent;
  const readsBefore = PROBE.layoutReads;
  app.fireWin("resize");
  app.runTimers();
  ok(PROBE.layoutReads > readsBefore, "resize（未播放）→ 重建可视化（读了一次布局）");
  eq(els["vizTitle"].textContent, vizBefore, "重建后标题不变（同一拍号）");

  beat.Controls.start();
  resetProbe();
  app.fireWin("resize");
  app.runTimers();
  ok(PROBE.layoutReads > 0, "resize（播放中）→ 只重采几何缓存");
  ok(S.playing, "播放中 resize 不打断播放（不重建 DOM）");
  const iv = beat.Viz.internals();
  ok(iv.rowGeo.length === 4 && iv.rowGeo.every(g => g.width > 0),
    `几何缓存已刷新（4 行，行宽 ${iv.rowGeo[0].width}）——否则球会按旧尺寸画到行外`);
  beat.Controls.stop();

  /* 弹窗键盘：Esc 取消；Enter 确认分两条路——无输入框时走 window，
     有输入框时由输入框自身的 keydown 处理（两处都得覆盖，否则用户会遇到"回车没反应"） */
  beat.Modal.uiConfirm("键盘测试", () => { throw new Error("Esc 取消不该触发 onOk"); });
  app.fireWin("keydown", { key: "Escape" });
  eq(els["modalMask"].hidden, true, "弹窗中按 Esc → 取消并关闭");
  let confirmOk = false;
  beat.Modal.uiConfirm("回车确认", () => { confirmOk = true; });
  app.fireWin("keydown", { key: "Enter" });
  ok(confirmOk, "无输入框的弹窗：window 上按 Enter → 确认");
  eq(els["modalMask"].hidden, true, "确认后关闭");
  let inputOk = false;
  beat.Modal.uiPrompt("输入点什么", "初值", v => { inputOk = v === "改过的值"; });
  eq(els["modalInput"].hidden, false, "uiPrompt 显示输入框");
  els["modalInput"].value = "改过的值";
  els["modalInput"].fire("keydown", { key: "Enter" });
  ok(inputOk, "有输入框的弹窗：在输入框里按 Enter → 确认并把输入值交给回调");
  eq(els["modalMask"].hidden, true, "确认后关闭");

  /* 编辑器：选中音符块 → 库标题变成「点击替换」→ 删除选中 */
  beat.Editor.open();
  const rowTrack = () => els["editorBars"].children[0].children[1];
  const cells = () => rowTrack().children;
  ok(cells().length > 0, `编辑区第 1 小节渲染出 ${cells().length} 个音符块`);
  const n0 = beat.Editor.draft().bars[0].length;
  cells()[0].fire("click");
  ok(/点击替换选中的/.test(els["paletteTitle"].textContent),
    `选中音符块后库标题改为替换语义：「${els["paletteTitle"].textContent.slice(0, 30)}」`);
  els["delStepBtn"].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0 - 1, "删除选中音符 → 草稿少一个");
  ok(els["undoBtn"].disabled === false, "删除后撤销可用");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0].length, n0, "撤销恢复");
  /* 点轨道空白处 = 取消选中，回到「追加」语义 */
  rowTrack().fire("click", { target: rowTrack() });
  ok(/点击追加到/.test(els["paletteTitle"].textContent), "取消选中后库标题回到追加语义");
  beat.Editor.tryClose(); els["modalOk"].fire("click");

  /* v0.4.0 老数据：sel 用数组下标引用自定义预设，加载时应升级为 id 引用 */
  const legacySel = { v: 3, sel: { type: "custom", idx: 0 },
    customs: [{ name: "下标引用", meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] };
  const old = loadApp({ "beatsight.m2": JSON.stringify(legacySel) });
  eq(old.beat.Store.S.sel.type, "custom", "老数据的 sel.type 保留");
  eq(old.beat.Store.S.sel.idx, undefined, "数值下标已移除（升级为 id 引用）");
  eq(old.beat.Store.S.sel.id, old.beat.Store.customs[0].id, "sel.id 指向第 0 个自定义预设");
  eq(old.beat.curPattern().name, "下标引用", "升级后仍命中原预设");

  /* 老数据里下标越界 → 回退内置第 0 个 */
  const bad = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, sel: { type: "custom", idx: 9 }, customs: [] }) });
  eq(bad.beat.Store.S.sel.type, "builtin", "下标越界 → 回退到内置预设");
  eq(bad.beat.Store.S.sel.idx, 0, "回退到第 0 个内置");

  /* 组标签（短音符合并标注）高亮：默认预设没有连续短音符，必须换成三连音才走得到。
     这条同时守 P1-4 的一个真实风险——增量重绘可能漏掉组标签这类"非格子"元素 */
  {
    const b2 = loadApp();
    b2.beat.Store.S.sel = { type: "builtin", idx: 8 };        // 三连音基础：12 个连续 16t 短音符 → 生成组标签
    b2.beat.Presets.refreshAfterPatternChange();
    b2.beat.Controls.start();
    const ac2 = FakeAudioContext.last;
    let groupCells = 0, litFrames = 0;
    for (let i = 0; i < 400; i++){
      ac2.currentTime += 0.02;
      b2.beat.Audio.scheduler();
      b2.beat.Viz.paintFrame();
      let anyLit = false, anyGroup = false;
      b2.els["viz"].children.forEach(r => r.children.forEach(c => {
        if (/(^| )cell-label( |$)/.test(c.className) && /(^| )group( |$)/.test(c.className)){
          anyGroup = true;
          if (/(^| )on( |$)/.test(c.className)) anyLit = true;
        }
      }));
      if (anyGroup) groupCells = Math.max(groupCells, 1);
      if (anyLit) litFrames++;
    }
    eq(groupCells, 1, "三连音基础渲染出组标签（短音符合并标注）");
    ok(litFrames > 0, `组标签随播放高亮（${litFrames} 帧亮起）——增量重绘没有漏掉它`);
    b2.beat.Controls.stop();
  }

  /* 时值非法（既无 t 也无 d）的预设必须被拒，且给出可读原因 */
  {
    const b3 = loadApp();
    const r = b3.beat.Store.importPresets(JSON.stringify({ presets: [
      { name: "缺时值", meter: 4, bars: [0,1,2,3].map(() => [{ rest: true }]) }
    ]}));
    ok(!r.ok, `既无 t 也无 d 的音符 → 导入被拒（${r.error || ""}）`);
    eq(b3.beat.Store.customs.length, 0, "被拒的预设不进入预设库");
  }

  /* predictNext 的"扫完全部小节都没有发声点"回退：
     试听中让第 1 小节只剩下休止符、后 3 小节全空。
     为什么不用"清空第 1 小节"：那样会先命中"当前小节为空"的早退分支，
     走不到末尾的 return null（两条回退路径要分别覆盖） */
  {
    const app2 = loadApp();
    const b4 = app2.beat;
    const trackOf = b => app2.els["editorBars"].children[b].children[1];
    b4.Editor.open();
    for (const b of [1, 2, 3]){
      trackOf(b).fire("click", { target: trackOf(b) });       // 把 editBar 切到第 b 小节
      app2.els["clearBarBtn"].fire("click"); app2.els["modalOk"].fire("click");
      eq(b4.Editor.draft().bars[b].length, 0, `清空第 ${b + 1} 小节`);
    }
    trackOf(0).fire("click", { target: trackOf(0) });
    app2.els["clearBarBtn"].fire("click"); app2.els["modalOk"].fire("click");
    for (let k = 0; k < 4; k++) app2.els["palette"].children[10].fire("click");   // 休止符（占时 48t）
    eq(b4.Editor.draft().bars[0].length, 4, "第 1 小节 = 4 个休止符（占满一小节但不发声）");

    app2.els["auditionBtn"].fire("click");
    const err = driveFrames(FakeAudioContext.last, b4, 4);
    ok(!err, `全休止 / 后续小节全空：调度 + 渲染无异常（${err || "OK"}）`);
    eq(b4.onsetNext(), null, "扫完所有小节都没有发声点 → 预测返回 null（球停住，不会飘向空行）");
    b4.Controls.stop();
    b4.Editor.tryClose(); app2.els["modalOk"].fire("click");
  }

  /* resyncToNow 的「本小节已无接续点 → 顺延到下一小节」分支。
     怎么才能构造出来：`nextNoteTime` 只会落在**音符起点**上，所以"站在最后一颗音符内部"
     这个说法本身不成立；真正触发 j<0 的是**两套起点集合错位**——
     旧节奏型的某个起点，晚于新节奏型在本小节的最后一颗起点。
     取旧 = 民谣扫弦（起点 …, 132, 144），新 = 两颗二分（起点 0, 96）：
     游标停在 132/144t 时去切，新节奏型本小节已无 ≥132t 的起点 → 顺延到下一小节。 */
  {
    const app3 = loadApp();
    const b5 = app3.beat;
    const spb = 60 / b5.Store.S.bpm, TPB = 48;
    b5.Store.importPresets(JSON.stringify({ presets: [{ name: "两颗二分", meter: 4,
      bars: [0,1,2,3].map(() => [{ t: 96 }, { t: 96 }]) }] }));
    eq(b5.Store.customs.length, 1, "新预设（每小节两颗二分，起点 0/96）导入成功");
    b5.Presets.buildPresetList();            // importPresets 不重建列表（真实路径由文件输入处理器负责）
    b5.Controls.start();                                     // 播放默认的民谣扫弦
    const ac3 = FakeAudioContext.last;
    const ls = b5.clock().loopStart;
    const cursorTick = () => (b5.clock().nextNoteTime - ls) / spb * TPB;
    let guard = 0;
    while (guard++ < 3000 && cursorTick() < 130){             // 推到超过新节奏型末颗起点 96t
      ac3.currentTime += 0.01;
      b5.Audio.scheduler();
      b5.Viz.paintFrame();
    }
    const t0 = cursorTick();
    ok(Math.abs(t0 - 132) < 0.5 || Math.abs(t0 - 144) < 0.5,
      `游标停在 ${t0.toFixed(0)}t（旧节奏型起点，且晚于新节奏型的末颗起点 96t）`);
    /* 切到新预设：本小节无接续点 → 顺延到下一小节 */
    const textOf = el => (el.textContent || "") + (el.children || []).map(textOf).join("|");
    const custom = app3.els["presetList"].children.filter(c => c._h && c._h.click)
      .find(c => textOf(c).includes("两颗二分"));
    ok(!!custom, "自定义预设项已在列表中");
    custom.fire("click");
    eq(b5.Store.S.sel.id, b5.Store.customs[0].id, "已切到新预设");
    const c = b5.clock();
    eq(c.schedBar, 1, "接续点顺延到下一小节（本小节已无音符起点可接）");
    eq(c.schedStep, 0, "从下一小节的第 0 颗记起");
    ok(Math.abs(c.nextNoteTime - (ls + b5.Store.S.sig * spb)) < 1e-9,
      "nextNoteTime = 下一小节起点（时间轴不动，只把位置顺延）");
    ok(b5.Store.S.playing, "顺延后仍在播放");
    b5.Controls.stop();
  }
}

/* ---------------- 汇总 ---------------- */
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
