/* 真实浏览器冒烟（v2.0.6，审计 P1-10 / C，零依赖）
   ---------------------------------------------------------------------------
   为什么需要它：`tests/` 那套跑在 vm 沙箱 + 自写 DOM 桩上，桩的行为**已知与浏览器有偏差**——
     · requestAnimationFrame 是空函数（帧循环必须手动驱动）
     · AudioContext.currentTime 是手推数字
     · offsetWidth/offsetLeft 按 style 百分比反解成 600px 行宽（几何是伪造的）
     · removeEventListener 是空操作、setTimeout 只记录不执行、querySelectorAll 只认两种选择器
   于是有一整类问题**在桩里永远测不出来**：真实布局、真实样式（改标签名后的视觉回归）、
   真实音频时钟、真实事件冒泡与焦点、以及 Service Worker 的离线行为。
   `tests/screenshot.sh` 本意是补这块，但它硬编码了 macOS 的 Chrome 路径、只抓一张加载态截图、
   也不做任何断言——在 Windows 上根本跑不了。本脚本用 CDP 把它重做成**跨平台且会断言**的冒烟。

   做法（零依赖关键点）：Node 22 自带 fetch 与 WebSocket，所以可以直接连 CDP——
     1) 找到浏览器（BEATSIGHT_CHROME 环境变量优先，其次是各平台常见路径）
     2) 用 --remote-debugging-port 起一个独立 profile 的无头实例
     3) 连上页面 target 的 WebSocket，用 Runtime.evaluate 取**页面内的实测值**
        （计算样式、元素结构、性能计时、Service Worker 注册状态）
     4) 逐项断言，并把控制台报错 / 未捕获异常也作为失败项
   两条通道都验：`file://` 直开（双击即用的那条路）与 `http://127.0.0.1`（PWA/离线那条路）。

   退出码：0 = 全部通过；1 = 有断言失败；3 = **本机没有可用浏览器**（跳过，不算失败）。
   为什么"没有浏览器"要有一个专用退出码：浏览器是**环境能力**，不是开发依赖。
   CI/构建镜像里本来就没有它，把它算成失败会无谓地堵住部署（与 ESLint/tsc 那种"可选加强项"
   同理但更强——那两个至少还能 npm ci）；check-all 收到 3 就标 ⊘，且 --strict-env 也不升级为错误。

   性能预算（v2.8.7，审计 §F11）：它不只判断"能跑"，还判断"跑得好"——首屏 / 帧率 /
   整树重建 / 单帧耗时四项各有定量阈值（见下方 PERF_BUDGET），任何"改一处就拖慢渲染"的
   隐性退化会在此当场变红，而不是等用户察觉。阈值刻意留了 10–100 倍余量，
   理由见 PERF_BUDGET 上方那段关于"假红"的说明。

   用法：node tools/smoke.js             # 两条通道都跑
         node tools/smoke.js --file-only # 只跑 file://（无本地服务时用） */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FILE_ONLY = process.argv.includes("--file-only");
const PORT_BASE = 8791;                       // CDP 端口；HTTP 服务端口取 PORT_BASE+1
const HTTP_PORT = PORT_BASE + 1;

/* ---------- 1) 找浏览器 ---------- */
const CANDIDATES = [
  process.env.BEATSIGHT_CHROME || "",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];
const browser = CANDIDATES.find(p => p && fs.existsSync(p));

console.log("══════════════════════════════════════════════════════════");
console.log("  真实浏览器冒烟（CDP）");
console.log("══════════════════════════════════════════════════════════");

if (!browser){
  console.log("  ⊘ 未找到 Chrome / Edge —— 跳过（浏览器是环境能力，不是失败项）");
  console.log("    想跑的话：设置 BEATSIGHT_CHROME=<浏览器可执行文件路径>");
  process.exit(3);
}
console.log("  · 浏览器 " + browser);

/* 取自 index.html 的 VERSION，用来断言"页面里显示的版本号与代码一致"（真实 DOM 里的读法，
   比在桩里断言 textContent 更接近用户看到的东西） */
const VERSION = (/const\s+VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")) || [])[1] || "";

/* ---------------------------------------------------------------------------
   性能预算（v2.8.7，审计 §F11）：把"能跑"升级为"跑得好"。
   为什么需要它：本脚本此前只做**定性**判断（帧率够不够、整树重建快不快），
   而 `paintFrameMs` 连判断都没有——它只被测出来打印，从不参与断言。于是
   "改一处就拖慢渲染"这类**隐性退化**在整条自验链里没有任何一处会变红，
   正好违反本项目对隐性退化的一贯态度（`check-coverage` 的 97%/90% 双阈值同理）。

   ★ 阈值怎么定的（每个数字都必须写清依据，否则下一个人只会把红改成绿）：
     取「实测值 × 安全倍数」，不是"取个整好看的数"。倍数刻意给大，是为了不出现**假红**——
     `eslint.config.js` 里那句"一个常年飘红的检查很快就会被所有人无视或直接关掉"
     对性能断言同样成立：宁可放过 3 倍退化，也不要让它随机飘红。
       · bootMs       首屏（导航开始 → DOMContentLoaded 结束，浏览器自己记的时间，
                      与探针何时连上 CDP 无关）——实测 247–257ms，预算 5000（约 20 倍余量）
       · fps          播放态真实 rAF 帧率；headless 下稳定 60–61，预算沿用 50（不为几帧冒险）
       · buildVizMs   整树重建，实测 3.4–5.5ms（只在换型/换主题发生，不逐帧），预算 50
       · paintFrameMs 同步循环下界，实测 0.007–0.01 ms/帧。注意它是**下界**：循环期间
                      音频时钟几乎不动，增量重绘会走"状态没变"的短路分支（该探针第一版
                      就因此量出 0.001ms 的假象，见 probe 内注释）。所以 1ms 这个预算
                      相当于 100 倍余量，它只拦"每帧都在重建整棵树"那个量级的退化——
                      而那正是它该拦的、也是唯一值得拦的。
   ★ 刻意**不**把这些实测数字抄进任何文档（v2.8.7）：它们由本脚本每次现场打印，
     抄进 docs/ 就变成又一个"抄一遍就等着烂"的数值，与 check-docs.js 的立身之道冲突。 */
const PERF_BUDGET = {
  bootMs: 5000,
  fps: 50,
  buildVizMs: 50,
  paintFrameMs: 1,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 2) 一个极小的静态服务（只为验证在线通道：SW 需要安全上下文，127.0.0.1 恰好是） ---------- */
function startServer(){
  const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".json":"application/json",
    ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml", ".md":"text/plain; charset=utf-8" };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(HTTP_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ---------- 3) CDP 客户端（Runtime.evaluate 取页面内实测值） ---------- */
function connectCdp(wsUrl){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener("open", () => resolve({
      send(method, params){
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        return new Promise((res, rej) => pending.set(mid, { res, rej }));
      },
      events,
      close(){ try{ ws.close(); }catch(e){} },
    }));
    ws.addEventListener("message", ev => {
      let msg;
      try{ msg = JSON.parse(ev.data); }catch(e){ return; }
      if (msg.id && pending.has(msg.id)){
        const h = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) h.rej(new Error(msg.error.message || "CDP error"));
        else h.res(msg.result);
      } else if (msg.method){ events.push(msg); }
    });
    ws.addEventListener("error", e => reject(new Error("WebSocket 连接失败：" + (e && e.message ? e.message : "?"))));
  });
}

/** 在页面里求值并取回 JSON 结果（awaitPromise 支持返回 Promise 的表达式） */
async function evaluate(cdp, expression){
  const r = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (r.exceptionDetails){
    const d = r.exceptionDetails;
    throw new Error("页面求值抛错：" + (d.exception && d.exception.description ? d.exception.description : d.text));
  }
  return r.result ? r.result.value : undefined;
}

/** 页面内探针（字符串，注入到页面执行）。刻意不用模板字符串里的反引号，避免转义地狱 */
function probe(){
  return `(async () => {
  /* v2.8.8：等的是 window.__beatBoot（**无条件**挂载的启动探针），不再等 window.__beat。
     __beat 是完整内部句柄，v2.8.8 起只在 ?debug=1 或 BEATSIGHT_TEST 下挂载——
     生产页面上它**不存在**。若继续拿它当"启动成功"的判据，就会把"句柄已收起"
     误判成"应用白屏"：等满 4 秒、然后报一个完全指错了方向的失败。
     用途拆开之后，这条断言问的就只是"页面 boot 起来了没有"。
     （本函数的返回值是模板字符串，注释里刻意不写反引号——原注释已警告过。） */
  const t0 = performance.now();
  while (!window.__beatBoot && performance.now() - t0 < 4000) await new Promise(r => setTimeout(r, 50));
  const boot = window.__beatBoot;
  const out = { booted: !!boot, version: null, bpmNum: null, viz: null, storage: null, perf: null, sw: null };
  if (!boot) return JSON.stringify(out);
  out.version = { chip: document.getElementById("brandChip").textContent,
                  title: document.title, const: boot.version };
  const el = document.getElementById("bpmNum");
  if (el){
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.bpmNum = { tag: el.tagName, bg: cs.backgroundColor, outline: cs.outlineStyle,
      font: cs.fontSize, w: Math.round(r.width), h: Math.round(r.height),
      text: el.textContent, focusable: el.tabIndex >= 0 };
  }
  const viz = document.getElementById("viz");
  if (viz) out.viz = { ariaHidden: viz.getAttribute("aria-hidden"), children: viz.children.length };
  try{
    const k = "beatsight.state";
    localStorage.setItem(k, localStorage.getItem(k));
    out.storage = { available: true, keys: localStorage.length };
  }catch(e){ out.storage = { available: false, err: String(e && e.name || e) }; }
  try{
    if (navigator.serviceWorker){
      /* ★ register() 只是**发起**注册作业，不是同步完成。探针一等到 window.__beat 就查
         getRegistrations()——而 __beat 的赋值点离 register() 只有几十行，作业常常还没落地，
         于是读到 0，这条断言就变成随机红（实测同一份代码连跑两次：一次 0、一次 1）。
         给一个有上界（4s）的轮询等待：**等的是"异步动作完成"，不是"把失败等成成功"**——
         真没注册的话，4 秒后照样读到 0、照样判失败。
         file:// 通道整段跳过注册（见 index.html 里 PWA 那段），所以那里不等待，免得白等 4 秒。 */
      const swStart = performance.now();
      const deadline = swStart + 4000;
      let regs = await navigator.serviceWorker.getRegistrations();
      while (regs.length === 0 && location.protocol !== "file:" && performance.now() < deadline){
        await new Promise(r => setTimeout(r, 100));
        regs = await navigator.serviceWorker.getRegistrations();
      }
      out.sw = { supported: true, registrations: regs.length, waitedMs: Math.round(performance.now() - swStart) };
    } else out.sw = { supported: false };
  }catch(e){ out.sw = { supported: false, err: String(e && e.name || e) }; }
  try{
    const t1 = performance.now();
    window.__beat.Viz.buildViz();
    const buildMs = performance.now() - t1;
    /* 渲染成本必须**在播放态下**测：paintFrame 首句是 if (!S.playing) return，
       停机时逐帧循环量到的是 0（第一版探针就踩了这个坑——量出来 0.001ms，
       看着像"渲染免费"，其实什么都没跑）。所以先真的开播，确认 playing 为真，再量。 */
    window.__beat.Controls.start();
    await new Promise(r => setTimeout(r, 400));
    const playing = !!window.__beat.Store.S.playing;
    const t2 = performance.now();
    const N = 200;
    for (let i = 0; i < N; i++) window.__beat.Viz.paintFrame();
    const frameMs = (performance.now() - t2) / N;
    /* ★ 上面那个同步循环量到的是**下界**：循环期间音频时钟几乎不动，增量重绘会走
       "状态没变"的短路分支。真正对用户有意义的读数是**播放态下的实际帧率**——
       让它自己跑 1 秒 rAF，数多少帧（60fps 设备的理想值是 60）。
       这条同时覆盖了一件桩永远测不到的事：真实 rAF 的调度与真实样式计算。 */
    let frames = 0;
    const fps = await new Promise(res => {
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
        else res(Math.round(frames * 1000 / (performance.now() - t0)));
      };
      requestAnimationFrame(tick);
    });
    window.__beat.Controls.stop();
    /* 首屏耗时取自 **Navigation Timing**，不是探针自己的 performance.now()：
       探针要等 CDP 连上才注入，那时页面早启动完了，用探针的时间戳量出来的是
       "CDP 握手耗时"而非首屏。Navigation Timing 由浏览器从**导航开始**记账，
       何时去问都一样，因而可复现。loadMs 只打印不断言（loadEventEnd 在极少数
       时序下可能仍是 0，拿它做闸门会变成假红）。 */
    const nav = (performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null) || {};
    out.perf = { buildVizMs: +buildMs.toFixed(2), paintFrameMs: +frameMs.toFixed(3),
      measuredWhilePlaying: playing, syncFrames: N, fps: fps,
      bootMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0) };
  }catch(e){ out.perf = { err: String(e && e.message || e) }; }
  return JSON.stringify(out);
})()`;
}

/** 在浏览器里跑一轮：打开 url → 等页面 → 取探针结果 + 控制台错误 */
async function runPass(label, url, userDataDir){
  const cdpPort = PORT_BASE;
  const args = [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1440,1000",
    "--remote-debugging-port=" + cdpPort,
    "--user-data-dir=" + userDataDir,
    url,
  ];
  const child = spawn(browser, args, { stdio: "ignore" });
  const result = { label, url, errors: [], warnings: [], probe: null };
  let cdp = null;
  try{
    let targets = null;
    for (let i = 0; i < 60; i++){
      await sleep(250);
      try{
        const res = await fetch("http://127.0.0.1:" + cdpPort + "/json/list");
        const list = await res.json();
        const page = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
        if (page){ targets = page; break; }
      }catch(e){ /* 还没起来 */ }
    }
    if (!targets) throw new Error("等不到调试目标（浏览器是否启动失败？）");
    cdp = await connectCdp(targets.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable").catch(() => {});
    const raw = await evaluate(cdp, probe());
    result.probe = JSON.parse(raw);
    cdp.events.forEach(ev => {
      if (ev.method === "Runtime.exceptionThrown"){
        const d = ev.params.exceptionDetails || {};
        result.errors.push("未捕获异常：" + (d.exception && d.exception.description ? d.exception.description : d.text));
      }
      if (ev.method === "Runtime.consoleAPICalled"){
        const text = (ev.params.args || []).map(a => (a.value !== undefined ? String(a.value) : a.description)).join(" ");
        if (ev.params.type === "error") result.errors.push("console.error：" + text);
        if (ev.params.type === "warning") result.warnings.push("console.warn：" + text);
      }
    });
  }catch(e){
    result.errors.push(String(e && e.message ? e.message : e));
  }finally{
    if (cdp) cdp.close();
    try{ child.kill(); }catch(e){}
  }
  return result;
}

/* ---------- 4) 断言与汇总 ---------- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail){
  if (cond){ pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ " + name + (detail ? "（" + detail + "）" : "")); }
}

async function main(){
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beatsight-smoke-"));
  let server = null;
  /* v2.8.8：两条通道都带 `?debug=1`。
     为什么必须带：`window.__beat`（完整内部句柄）已从"无条件挂载"改为**仅调试/测试态**挂载，
     而本脚本的性能读数（buildViz 耗时 / 播放态帧率 / 整树重建）必须经它驱动
     `Viz.buildViz()` 与 `Controls.start()`——没有它就量不到任何东西。
     ★ 代价要写清楚：带 ?debug=1 会挂出右下角诊断面板（多一个 body 子节点）。
       本脚本的断言全部按 id 取元素，不受它影响；"控制台零报错"同样不受影响。
       于是"这一趟跑的是调试态页面"是**已知且可接受**的取舍——它是开发者工具，不是用户路径。
     ★ 启动探针用的是 window.__beatBoot（无条件挂载），所以"有没有白屏"这条
       仍然是在**与生产完全一致**的条件下验的，没被 debug 开关污染。 */
  const DEBUG_Q = "?debug=1";
  const passes = [{ label: "file://", url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/") + DEBUG_Q }];
  if (!FILE_ONLY){
    try{
      server = await startServer();
      passes.push({ label: "http://127.0.0.1", url: "http://127.0.0.1:" + HTTP_PORT + "/index.html" + DEBUG_Q });
    }catch(e){ console.log("  · 本地服务起不来（" + e.message + "），只跑 file://"); }
  }

  for (const p of passes){
    console.log("\n▸ 通道 " + p.label);
    const r = await runPass(p.label, p.url, path.join(tmp, "profile-" + p.label.replace(/[^a-z]/gi, "")));
    const d = r.probe;
    ok(!!d && d.booted, p.label + "：应用启动成功（window.__beatBoot 就位、没有白屏）",
      d ? "" : r.errors.join(" / "));
    if (d && d.booted){
      ok(d.version.chip === "v" + VERSION + " · 稳定版", p.label + "：顶栏版本 chip = v" + VERSION,
        "实际 " + (d.version && d.version.chip));
      ok(d.version.const === VERSION, p.label + "：页面内 VERSION 与源码一致");
      ok(!!d.viz && d.viz.children > 0, p.label + "：可视化网格已渲染（" + (d.viz ? d.viz.children : 0) + " 个顶层节点）");
      ok(!!d.viz && d.viz.ariaHidden === "true", p.label + "：#viz 对读屏隐藏");
      if (d.bpmNum){
        ok(d.bpmNum.tag === "BUTTON", p.label + "：#bpmNum 是 <button>（键盘可达）", "实际 " + d.bpmNum.tag);
        ok(/rgba\(0, 0, 0, 0\)|transparent/.test(d.bpmNum.bg), p.label + "：#bpmNum 静止态无底色（外观未走样）",
          "实际 background=" + d.bpmNum.bg);
        ok(d.bpmNum.outline === "none", p.label + "：#bpmNum 静止态无 outline（绿框只在聚焦时出现）",
          "实际 outline=" + d.bpmNum.outline);
        ok(d.bpmNum.font === "46px" && d.bpmNum.w === 92, p.label + "：#bpmNum 尺寸字号与设计一致（92×54 / 46px）",
          "实际 " + d.bpmNum.w + "×" + d.bpmNum.h + " / " + d.bpmNum.font);
      } else ok(false, p.label + "：#bpmNum 存在");
      if (p.label.startsWith("http")){
        ok(!!d.sw && d.sw.registrations > 0, p.label + "：Service Worker 已注册（离线能力的前提）",
          d.sw ? JSON.stringify(d.sw) : "");
      }
      if (d.perf && d.perf.buildVizMs !== undefined){
        /* 实测行同时打印**预算**，让"快到红线"在真的变红之前就看得见——只报实测值的话，
           从 5ms 退化到 45ms 是无声的，直到某天越过 50 才突然变红（那时已经很难定位）。 */
        console.log("  · 实测：首屏 " + d.perf.bootMs + " ms（预算 ≤ " + PERF_BUDGET.bootMs + "）· buildViz "
          + d.perf.buildVizMs + " ms/次（预算 < " + PERF_BUDGET.buildVizMs + "）· 播放态帧率 " + d.perf.fps
          + " fps（预算 ≥ " + PERF_BUDGET.fps + "，rAF 自跑 1 秒）· 同步循环下界 " + d.perf.paintFrameMs
          + " ms/帧（预算 < " + PERF_BUDGET.paintFrameMs + "）· load 结束 " + d.perf.loadMs + " ms"
          + "（" + (d.perf.measuredWhilePlaying ? "播放态" : "⚠ 非播放态，读数无效") + "）");
        ok(d.perf.measuredWhilePlaying === true, p.label + "：播放态已建立（性能读数的前提）");
        ok(d.perf.bootMs > 0 && d.perf.bootMs <= PERF_BUDGET.bootMs,
          p.label + "：首屏 ≤ " + PERF_BUDGET.bootMs + "ms（导航→DOMContentLoaded，Navigation Timing 实测）",
          "实际 " + d.perf.bootMs + " ms");
        ok(d.perf.fps >= PERF_BUDGET.fps,
          p.label + "：播放态帧率 ≥ " + PERF_BUDGET.fps + "fps（真实 rAF，非桩）", "实际 " + d.perf.fps + " fps");
        ok(d.perf.buildVizMs < PERF_BUDGET.buildVizMs,
          p.label + "：整树重建 < " + PERF_BUDGET.buildVizMs + "ms（它只发生在换型/换主题，不逐帧）",
          "实际 " + d.perf.buildVizMs + " ms");
        /* v2.8.7（§F11）：这一条以前**只打印不断言**——它正是"隐性退化不会被拦下"的缺口本身 */
        ok(d.perf.paintFrameMs < PERF_BUDGET.paintFrameMs,
          p.label + "：同步循环单帧 < " + PERF_BUDGET.paintFrameMs + "ms（下界读数，只拦整树重建级退化）",
          "实际 " + d.perf.paintFrameMs + " ms/帧");
      }
    }
    ok(r.errors.length === 0, p.label + "：控制台零报错", r.errors.slice(0, 3).join(" / "));
    if (r.warnings.length) console.log("  · 控制台警告 " + r.warnings.length + " 条：" + r.warnings.slice(0, 3).join(" / "));
  }

  if (server) server.close();
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}

  console.log("──────────────────────────────────────────────────────────");
  if (fail){
    console.log("  ✗ 冒烟未通过：" + fail + " 项失败");
    failures.forEach(f => console.log("      · " + f));
    process.exit(1);
  }
  console.log("  ✓ 冒烟通过（" + pass + " 项断言）");
  process.exit(0);
}

main().catch(e => {
  console.log("  ✗ 冒烟脚本自身异常：" + (e && e.stack ? e.stack : e));
  process.exit(1);
});
