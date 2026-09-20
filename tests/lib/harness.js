/* 测试共享环境（零依赖）：vm 沙箱 + DOM/音频桩 + 断言工具
   ---------------------------------------------------------------------------
   从 tests/run.js 抽出的「地基」部分，由 tests/run.js 与 tests/cases/*.js 共用。
   Node 的模块缓存保证这里只初始化一次——各用例文件 require 到的是**同一个**计数器
   与同一份桩实现，装配方式与原单文件版完全一致。

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

const html = fs.readFileSync(process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html"), "utf8");
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
/* 行宽（v2.4.2）：原先是写死的 600。STRUM_MIN_W 由 20 降到 14 之后，"窄格隐藏"这条分支
   在 600px 行宽下再也走不到——**合法时值的最小档是 6t**（VALID_T 的末位），
   600px 上等于 18.75px ≥ 14，于是 6t 格反而变可见了。想继续测那条规则只有两条路：
   改小阈值（假的，改了就不是在测产品）或改小行宽（真的，行宽本来就是外部条件）。
   故开成可覆盖量，默认仍是 600，只有需要压缩几何的用例才传 opts.rowW。 */
let ROW_W = 600;
const rowW = () => ROW_W;

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
  trResumeBtn: { hidden: true },       // v1.4：无训练历史时「继续上次」不露面
  planRow: { hidden: true },           // v1.5：无计划时「今日卡」不露面
  /* v2.0.5（审计 P0-8）：标记里承载语义、但桩不会从 HTML 读到的两处——
     #bpmNum 由 <div> 改成了真 <button>（键盘可达），#viz 加了 aria-hidden（整块对读屏隐藏）。
     不在此复刻的话，"改回 div"这类退化不会被任何断言拦下。 */
  bpmNum: { tagName: "BUTTON" },
  viz: { "aria-hidden": "true" },
  /* v2.1.0（F1 歌词对齐轨）：#lyricLane 在标记里就是 `hidden` + 对读屏隐藏的卫星轨，
     初始必须是收起态——否则「预设模式/无歌词行时整轨收起」这条不变量在桩里恒真，测不到。 */
  lyricLane: { hidden: true, "aria-hidden": "true" },
  /* v2.4.3（练习循环）：两个 <select>。它们不是 <div>——`sel.options` 与 `sel.disabled`
     都是 select 特有的接口，"位置稳定地灰掉而不是藏起来"这条 UI 决策要靠 disabled 断言。
     loopToggle 是 <button role=switch>，与 tabToggle 同类。 */
  loopFrom: { tagName: "SELECT" },
  loopTo: { tagName: "SELECT" },
  loopToggle: { tagName: "BUTTON" },
  /* v2.5.0：「扫弦」音量条在标记里就是 `hidden`（默认轨可能是普通轨，不该先闪一下），
     由 Tracks.syncTrackUI 按当前轨收放。不复刻初始态的话，"普通轨该收起"这条不变量
     在桩里恒真——而它正是这条 UI 决策的全部内容。 */
  volStrumRow: { hidden: true },
};
/* 静态标记里的「pill 组」：真实 HTML 里这些按钮是写死的，stub 不解析 HTML，
   所以在此复刻。不做的话 `document.querySelectorAll("#sigRow .pill")` 拿到空集合，
   `setPressed()` 变成空转 —— aria-pressed 这类无障碍断言根本跑不起来（v1.3.0 为 P2-11 而加）。 */
const HTML_CHILDREN = {
  sigRow:    [2, 3, 4, 5, 6, 7].map(n => ({ className: "pill" + (n === 4 ? " active" : ""), dataset: { sig: String(n) } })),
  swingRow:  [50, 67, 75].map((n, i) => ({ className: "pill" + (i === 0 ? " active" : ""), dataset: { swing: String(n) } })),
  timbreRow: ["click", "wood", "drum"].map((n, i) => ({ className: "pill" + (i === 0 ? " active" : ""), dataset: { timbre: n } })),
  /* v1.6：统计 overlay 的 7/30 天切换（静态标记里的 pill 组，同上要复刻） */
  statsRangeRow: [7, 30].map((n, i) => ({ className: "pill" + (i === 0 ? " active" : ""), dataset: { range: String(n) } })),
  /* v1.9.0：编辑器的扫弦方向三档。第三档 data-dir=""（不标注）——空串**不是** undefined，
     pill() 的 `dataset.dir !== undefined` 判据对它成立，故「清除方向」这条路测得到 */
  dirRow: [
    { className: "pill", dataset: { dir: "D" } },
    { className: "pill", dataset: { dir: "U" } },
    { className: "pill", dataset: { dir: "" } },
  ],
  /* v2.2.0 扫弦轨：弦区四档。第一档 data-zone=""（默认/中）——空串与 dirRow 的「不标注」
     同构：pill() 的 dataset.zone !== undefined 判据对它成立，「回默认」这条路测得到 */
  zoneRow: [
    { className: "pill", dataset: { zone: "" } },
    { className: "pill", dataset: { zone: "0" } },
    { className: "pill", dataset: { zone: "1" } },
    { className: "pill", dataset: { zone: "2" } },
  ],
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
    parentNode: null,                            // v2.4.1：insertAdjacentElement 要靠它找到兄弟位置
    textContent: "", value: "", title: "",
    hidden: false, disabled: false, inert: false,
    /* 布局属性做成**计数的 getter**：这里要断言的是"读了几次"，不是读到了多少；
       但值本身也要有代表性（见上方 ROW_TOP0 的说明），否则物理类的断言会算错 */
    get offsetWidth(){
      PROBE.layoutReads++;
      const m = /([\d.]+)%/.exec(el.style.width || "");
      return m ? ROW_W * (+m[1]) / 100 : ROW_W;
    },
    get offsetHeight(){ PROBE.layoutReads++; return 44; },
    get offsetLeft(){
      PROBE.layoutReads++;
      const m = /^(-?[\d.]+)%/.exec(el.style.left || "");
      return m ? Math.round(ROW_W * (+m[1]) / 100) : 0;
    },
    get offsetTop(){ PROBE.layoutReads++; return el._rowTop === undefined ? 0 : el._rowTop; },
    /* v2.4.3：<select> 的 options。真实 DOM 里 `sel.options` **就是**它的 option 子元素集合
       （同一份数据两个视图），这里照此从 children 派生——不另存一份。
       不做的话 syncLoopUI 读 `sel.options.length` 直接抛错，
       而那是"选项已建好就不再重建"的幂等判据，正是要断言的点。 */
    get options(){
      return el.children.filter(c => c.tagName === "OPTION");
    },
    scrollWidth: 0,
    addEventListener(t, f){ (this._h[t] = this._h[t] || []).push(f); },
    removeEventListener(){},
    appendChild(c){
      /* v2.4.4：DocumentFragment 语义——把片段 append 到父节点时，**子节点整体搬家**、
         片段自身清空（真实 DOM 如此）。不做这层摊平，children 里会混进片段壳，
         所有按 children[i] 定位的断言全部错位。 */
      if (c && c._isFragment){
        const kids = c.children.slice(); c.children.length = 0;
        kids.forEach(k => this.appendChild(k));
        return c;
      }
      this.children.push(c); if (c) c.parentNode = el; return c;
    },
    /* v2.4.1：兄弟插入。原先桩只有 appendChild，"把新节点插到某个既有节点旁边"
       这类需求在桩里根本表达不出来——于是 Arrange 的候选预设行只能 append 到末尾
       （真实浏览器里就是"点第 6 段的「换」，候选出现在第 10 段之后"，用户看不见）。
       补上这两个方法后，测试才能守住"候选行就在触点正下方"这条 UI 事实。 */
    insertBefore(c, ref){
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0){ this.children.push(c); return c; }
      this.children.splice(i, 0, c); return c;
    },
    insertAdjacentElement(pos, c){
      const p = this.parentNode;
      if (pos !== "afterend" || !p){ this.children.push(c); return null; }
      const i = p.children.indexOf(el);
      if (i < 0){ p.children.push(c); return null; }
      p.children.splice(i + 1, 0, c); return c;
    },
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
    if (this._kind === "noise") this._ctx.hits.push({ t, kind: "noise", filterType: this._dest && this._dest.type, filterFreq: this._dest && this._dest.frequency.value,
      /* v1.4.1：噪声链是 src → filter → gain，增益峰值在**第二级**——
         断言 makeup gain 补偿（T44）必须能看到它 */
      gain: this._dest && this._dest._dest && this._dest._dest.gain ? this._dest._dest.gain._peak : undefined,
      /* 记录噪声 buffer 的出生上下文：closed 重建后若复用旧 buffer 会被这条看见（T29c） */
      bufCtx: this.buffer ? this.buffer._ctx : null });
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
  createBuffer(ch, len, rate){ return { _ctx: this, getChannelData: () => new Float32Array(len) }; }
  createBufferSource(){ return new FakeNode(this, "noise"); }
  resume(){ this.resumeCount++; if (this.state === "suspended" || this.state === "interrupted") this.state = "running"; }
  /* v1.3.0（审计 P2-13）：模拟系统/其他 App 改变音频会话状态，并触发 onstatechange——
     iOS 的 "interrupted" 与 "closed" 是原实现完全没处理的两个分支 */
  setState(s){ this.state = s; if (typeof this.onstatechange === "function") this.onstatechange(); }
}

/* 以指定 localStorage 预置数据加载应用，返回 {beat, els, sandbox, storage, fireDoc, fireWin, docHidden}
   opts.throwOnWrite：模拟隐私模式/配额超限——setItem 一律抛错（v0.9.1 T16）
   opts.throwOnRead ：模拟沙盒 iframe / "站点数据被禁用"——getItem 一律抛 SecurityError（v2.0.5 T58）。
     与 throwOnWrite 同一类注入：这类**容器策略**在桩里本来无法复现，而它恰恰是"整页白屏"
     这类最严重症状的触发条件（Store 里任何一处漏了 try 都会被它照出来），必须可注入才能断言
   opts.seedDemo   ：v2.4.1。**默认 true —— 即"示例曲已带出过"**。
     为什么默认开：应用在首次打开（冷键 beatsight.demoSeeded 缺失）时会静默带出示例曲
     （7 个节奏型 + 1 首曲式 + 10 行歌词，见 index.html 装配层的 `if (!Store.demoSeeded())`）。
     这对真实用户是对的，但会让**所有**"预设库初始为空 / customs.length === N"的老用例
     全部偏 7（T01 的 2→9、T20 的 0→7…）。那些用例要验证的是它们各自的规则，
     不是"示例曲有没有自动进来"，所以默认把闩置上、让它们回到自己设计的起点。
     想测"首次打开会带出"的用例（T63a/c）传 `{ seedDemo: false }`。
     ★ 载体是**独立的冷键 beatsight.demoSeeded**，不是热键 beatsight.state：
       往热键里塞东西会让 `!hotIn` 为假，从而跳过 beatsight.m2 的冷热拆分迁移
       （t08 的迁移用例当场炸过）。这也正是生产代码把它独立成键的原因。
   opts.rowW      ：v2.4.2。桩模拟的行宽，默认 600px。只有需要"几何压缩"的用例才传
     （见 ROW_W 的注释：STRUM_MIN_W 降档后，6t 最小合法时值在 600px 上已不再触发隐藏）。
     注意它是**模块级**的，每次 loadApp 都会按本次 opts 重设——不会串到下一个用例。 */
function loadApp(seed, opts){
  const o = opts || {};
  const throwOnWrite = !!o.throwOnWrite;
  const throwOnRead = !!o.throwOnRead;
  /* v2.4.2：行宽可覆盖（默认 600）。见 ROW_W 的说明——窄格隐藏的临界点随
     STRUM_MIN_W 变化后，只有压缩行宽才能把那条分支重新走到 */
  ROW_W = typeof o.rowW === "number" && o.rowW > 0 ? o.rowW : 600;
  const seedObj = { ...(seed || {}) };
  /* 默认置闩（视为已带出）；seedDemo:false 时保持键缺失 → 应用走"首次带出"分支 */
  if (o.seedDemo !== false && seedObj["beatsight.demoSeeded"] === undefined){
    seedObj["beatsight.demoSeeded"] = "1";
  }
  const store = new Map(Object.entries(seedObj));
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
        c.textContent = spec.dataset.sig || spec.dataset.swing || spec.dataset.timbre || spec.dataset.range || "";
        els[id].children.push(c);
      });
    }
    return els[id];
  };

  const sandbox = {
    console,
    localStorage: {
      getItem: k => {
        if (throwOnRead) throw new DOMException("denied", "SecurityError");
        return store.has(k) ? store.get(k) : null;
      },
      setItem: (k, v) => { if (throwOnWrite) throw new DOMException("quota", "QuotaExceededError"); store.set(k, String(v)); },
      removeItem: k => store.delete(k),
      /* v2.0.6（审计 P1-9）：诊断面板要枚举"哪个键在膨胀"（配额是按 origin 总量算的），
         所以桩必须补上 length / key() —— 只实现 get/set/remove 的桩会让那条枚举路径
         永远走 catch 分支，测试便无法覆盖它（第一版就是这样，覆盖率闸门当场把它抓出来了） */
      get length(){ return store.size; },
      key: i => { const ks = [...store.keys()]; return i >= 0 && i < ks.length ? ks[i] : null; },
    },
    document: {
      getElementById: elFor,
      createElement: tag => {
        const el = Object.assign(makeEl("dyn"), { tagName: String(tag || "").toUpperCase() });   // v1.1：记录标签名，可断言生成的元素类型（如刻度必须是 <i> 而非 <option>）
        /* v1.4：KeepAlive 的 iOS 兜底是静音循环 audio 元素——桩给它最小可用的 play/pause，
           否则「无 wakeLock 时降级音频」这条路径根本跑不进 */
        if (String(tag).toLowerCase() === "audio"){
          el.play = () => { el._played = true; return { catch(){} }; };
          el.pause = () => { el._played = false; };
          el.loop = false; el.src = "";
        }
        return el;
      },
      /* v2.4.4：DocumentFragment 桩（Editor/Arrange 的批量插入用）。
         片段自身就是一个收集容器；append 到父节点时由 appendChild 里的 _isFragment
         分支把子节点摊平搬家（语义同真实 DOM）。 */
      createDocumentFragment(){
        return Object.assign(makeEl("frag"), { _isFragment: true, tagName: "#fragment" });
      },
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
      head: makeEl("head"),            // v1.4：PWA manifest <link> 的落点
      activeElement: { tagName: "DIV" },
      hidden: false,                 // v1.3.0：前台/后台切换（P1-3 自适应窗口断言用）
    },
    AudioContext: FakeAudioContext,
    /* v1.4：PWA / 保活需要可注入的 location 与 navigator。
       默认 undefined——typeof 守卫会把这两条路径判定为「非浏览器环境」而整体跳过，
       与老用例的行为一致（它们不该突然开始注册 SW） */
    location: opts && opts.location,
    navigator: opts && opts.navigator,
    /* v1.4：KeepAlive 的静音 WAV 是运行时 btoa 出来的——vm 沙箱默认没有 btoa，
       不补上的话 silentWav 永远走「typeof 守卫早退」分支，生成体进不了覆盖 */
    btoa: typeof btoa === "function" ? btoa : undefined,
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
    /* 活跃定时器计数（v2.0.6，审计 P1-3）：断言"起停重入不泄漏句柄"必须能看见它。
       桩此前只在内部维护这两个 Map，外部无从观察，于是"start() 被调两次会留下一个孤儿
       setInterval（音符排两遍、且再也清不掉）"这类缺陷在测试里完全没有抓手 */
    intervalCount: () => intervals.size,
    timeoutCount: () => timeouts.size,
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
    beat.AudioEngine.scheduler();
    if (onTick) onTick();
    if (!beat.Store.S.playing) return true;
  }
  return false;
}

/* 逐帧驱动：scheduler（每 25ms）与 paintFrame（每帧）双时钟同时跑，贴近真实浏览器 */
function driveFrames(ac, beat, seconds){
  const dt = 0.02, n = Math.ceil(seconds / dt);
  let firstErr = null;
  for (let i = 0; i < n; i++){
    ac.currentTime += dt;
    try { beat.AudioEngine.scheduler(); } catch(e){ if (!firstErr) firstErr = "scheduler: " + e.message; }
    try { beat.Viz.paintFrame(); } catch(e){ if (!firstErr) firstErr = "paintFrame: " + e.message; }
    if (!beat.Store.S.playing) break;
  }
  return firstErr;
}

/* 断言计数与失败名清单由本模块持有，run.js 用 stats() 取汇总 */
function stats(){ return { pass, fail, failNames }; }

module.exports = {
  loadApp, FakeAudioContext, pill, driveFrames,
  ok, eq, near, section, drive,
  PROBE, resetProbe, html, stats,
};
