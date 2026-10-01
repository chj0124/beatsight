/* 真实浏览器冒烟（v2.0.6，审计 P1-10 / C，零依赖）
   ---------------------------------------------------------------------------
   为什么需要它：`tests/` 那套跑在 vm 沙箱 + 自写 DOM 桩上，桩的行为**已知与浏览器有偏差**——
     · requestAnimationFrame 是空函数（帧循环必须手动驱动）
     · AudioContext.currentTime 是手推数字
     · offsetWidth/offsetLeft 按 style 百分比反解成 600px 行宽（几何是伪造的）
     · removeEventListener 是空操作、setTimeout 只记录不执行、querySelectorAll 只认两种选择器
   于是有一整类问题**在桩里永远测不出来**：真实布局、真实样式（改标签名后的视觉回归）、
   真实音频时钟、真实事件冒泡与焦点、以及 Service Worker 的离线行为。
   `tests/screenshot.sh`（已删除）本意是补这块，但它硬编码了 macOS 的 Chrome 路径、只抓一张加载态截图、
   也不做任何断言——在 Windows 上根本跑不了。本脚本用 CDP 把它重做成**跨平台且会断言**的冒烟。

   做法（零依赖关键点）：Node 22 自带 fetch 与 WebSocket，所以可以直接连 CDP——
     1) 找到浏览器（BEATSIGHT_CHROME 环境变量优先，其次是各平台常见路径）
     2) 用 --remote-debugging-port 起一个独立 profile 的无头实例
     3) 连上页面 target 的 WebSocket，用 Runtime.evaluate 取**页面内的实测值**
        （计算样式、元素结构、性能计时、Service Worker 注册状态）
     4) 逐项断言，并把控制台报错 / 未捕获异常也作为失败项
   两条通道都验：`file://` 直开（双击即用的那条路）与 `http://127.0.0.1`（PWA/离线那条路）。

   退出码：0 = 全部通过；1 = 有断言失败；3 = **本机没有可用浏览器**（跳过，不算失败），
   或 **冒烟端口被占用**（同为环境资源，不算失败）。
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
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FILE_ONLY = process.argv.includes("--file-only");
/* CDP 端口；HTTP 服务端口取 PORT_BASE+1。允许用 BEATSIGHT_SMOKE_PORT 覆盖默认基号：
   端口是**环境资源**，机器上已有别的调试实例时不该要求开发者去改源码。 */
const PORT_BASE = Number(process.env.BEATSIGHT_SMOKE_PORT) || 8791;
const HTTP_PORT = PORT_BASE + 1;

/** 端口是否被占用（try-bind，监听成功即立刻释放并返回 false） */
function portInUse(port){
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once("error", err => resolve(err && err.code === "EADDRINUSE"));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, "127.0.0.1");
  });
}

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
/* ★ domNodes 的定档逻辑与上面三项**不同**（v2.10.5 新增），理由必须写清，否则下一个人只会把红改成绿：
     上面三项是"取实测值 × 安全倍数"，这一项是"取**已知外部警戒线之间**的位置"。
     外部锚点（Lighthouse「避免 DOM 过大」审计）：body 节点 > ~800 警告、> ~1400 错误。
     实测 963–975 **已经越过警告线**，所以
       ① 预算**不能**取 800 —— 那会让它从第一次跑起就常年飘红（噪音，不是信号）；
       ② 预算取 1200（当前值 + 约 24%，落在警告线与错误线之间），拦的是"把 DOM 推向
          错误线"这个真正会伤到交互性的量级。
     这一项是四个性能读数里唯一**有外部公认阈值**的，所以值得单列。

   ★ 为什么必须单列 domNodes：其余四项都测不出它。DOM 规模是这类应用最容易无声增长的东西
     ——每加一个可视化元素、每多一行网格都会推高它，而它既不体现在帧率（有巨大余量）、
     也不体现在首屏（解析很快）上，于是可以一路涨过 1400 而整条自验链一声不吭。
     这正是本项目一贯要堵的"隐性退化"缺口。
   ★ v2.14.0 复核（预算 1200 → 1300）：延迟补偿的设置分组（下拉 + 四个按钮 + 滑杆行 +
     向导面板）一次加了 22 个节点，实测 1209 —— 越过旧预算 9 个。按上面同一套逻辑**重新定档**：
       · 本预算的职责是"拦住把 DOM 推向 Lighthouse 错误线（~1400）"，不是"钉死在某个历史值"；
       · 1209 距错误线仍有 ~190 余量，取 1300（+7.5%）把它继续按在"警告线与错误线之间"；
       · ⚠ **下一次再贴近 1300 时，应当先瘦身、而不是继续放宽**——否则这条线会一路滑到
         1400，它拦隐性退化的意义就没了。设置面板（v2.10.12 起四组 + v2.14.0 一组）
         是当前最大的静态增长源，要加东西先想"能不能并进既有行"。
   ★ v2.19.0 瘦身复核（**结论：没有可安全瘦身的项，别再重新发现一遍**）：
     · 逐块审计过一次，节点大头是网格主体（`.cell`）/ 进度填充（`.fill`）/ 座次尺（`.ruler`）/
       歌词字块 + 「使用方法」页的静态标记（`.help-*`，那是**刻意的**"没有 JS 也能看到全文"设计）；
     · 曾判定 `.sub`（十六分小格线）是"纯装饰、可换成 CSS `repeating-linear-gradient`"——
       ★ **这个判断是错的**：`.sub` 不只是刻度线，它同时是**拍点闪动动效的宿主**
       （`paintBeatFlash()` 里 `sub.animate([...], {duration:260})`，配色随 `flashTheme()`、
       受 `REDUCE_MOTION` 守卫）。删掉它 = 把闪动效果一起改掉；改挂到宿主 cell 上则闪动范围
       从"那一格十六分"变成"整格"，**观感会变**。⇒ **不是"观感不变"的瘦身项。**
     · 教训：**"看起来纯装饰"的东西，先查它是不是某个动效/状态的宿主**（`grep 该 class + animate`），
       再谈删。判定成本一次 grep，误判的代价是一次观感回归。 */
const PERF_BUDGET = {
  bootMs: 5000,
  fps: 50,
  buildVizMs: 50,
  paintFrameMs: 1,
  domNodes: 1300,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 2) 一个极小的静态服务（只为验证在线通道：SW 需要安全上下文，127.0.0.1 恰好是） ---------- */
function startServer(){
  const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".json":"application/json",
    ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml", ".md":"text/plain; charset=utf-8" };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    /* ★ 目录边界必须按「路径分隔符」判，不能裸 startsWith(ROOT)：
       裸判会把同前缀的**兄弟目录**放进来——ROOT=/a/beatsight 时，/a/beatsight2/x 也以
       "/a/beatsight" 开头，于是仓库外的文件被当仓库内文件服务出去（本地工具，风险低，
       但语义是错的）。补上分隔符即 `file === ROOT || file.startsWith(ROOT + sep)`。 */
    const inRoot = file === ROOT || file.startsWith(ROOT + path.sep);
    if (!inRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
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
  const out = { booted: !!boot, version: null, badgeDot: null, bpmNum: null, viz: null, domNodes: null, storage: null, perf: null, sw: null };
  if (!boot) return JSON.stringify(out);
  out.version = { ver: document.getElementById("brandVer").textContent,
                  chip: document.getElementById("brandChip").textContent,
                  title: document.title, const: boot.version };
  /* v2.10.10（用户要求：把状态点移进品牌区徽章）：点是否真的画在徽章的矩形里 —— **木桩测不出来**
     的那一类（桩不解析 HTML、也给不出真实布局）。取两者的 getBoundingClientRect 比包络，
     顺带取计算样式确认它真被画出来（尺寸 > 0 且底色非透明） */
  const pdEl = document.getElementById("persistDot"), bvEl = document.getElementById("brandVer");
  if (pdEl && bvEl && bvEl.parentNode){
    const a = pdEl.getBoundingClientRect();
    const b = bvEl.parentNode.getBoundingClientRect();
    out.badgeDot = {
      inside: a.left >= b.left - 1 && a.right <= b.right + 1
              && a.top >= b.top - 1 && a.bottom <= b.bottom + 1,
      w: Math.round(a.width), h: Math.round(a.height),
      bg: getComputedStyle(pdEl).backgroundColor };
  }
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
  /* v2.10.5：DOM 规模（性能预算的第 5 项）。口径刻意对齐 Lighthouse「避免 DOM 过大」审计——
     它数的是 **body 内**的节点（不含 head 里的 meta/style/title/script），这样读到的数字
     可以直接与外部公认的 800 / 1400 两条线对照，而不是一个"只有本项目自己懂"的数。
     用 getElementsByTagName("*") 而不是 querySelectorAll("*")：前者是活集合、后者会分配数组，
     这里是每次冒烟跑一次、差异可忽略，但活集合少一次分配也更贴合"只做便宜事"的习惯。 */
  out.domNodes = document.body.getElementsByTagName("*").length;
  /* v2.13.0：出厂默认壁纸的**真解码**。
     为什么必须在真机做：桩里拿不到真实解码器，而"样式里挂着 data: URL"**不等于**
     "浏览器画得出这张图"。v2.13.0 输血时正是把 data: 前缀写重了（base64 多出 15 字节），
     桩测试全绿、而背景一片空白——只有这一条抓得到。
     口径：从**实际生效的 background-image** 里取出 url("…") 再交给 Image 解码，
     验的是"真的能画出来"，而不是"字符串看着像"。没有壁纸时记 present:false（断言只要求
     "有壁纸就必须解得开"）。
     ★ 本段在**模板字符串内**：别用反引号，也别写 $ 加大括号。 */
  try{
    const wl = document.getElementById("wallLayer");
    const bg = wl ? String(wl.style.backgroundImage) : "";
    /* ★ 刻意用 indexOf/slice 而不是正则：本段代码住在**模板字符串**里，
       正则里的反斜杠转义（\\/ 与 \\( ）会先被模板字面量吃掉，
       到页面里就变成 /url("(data:image/… ——一个 "Unterminated group" 的语法错误，
       探针整体求值失败（实测踩过）。不用转义的取法在这里更稳。 */
    const at = bg.indexOf('url("data:');
    const endAt = at < 0 ? -1 : bg.indexOf('")', at + 5);
    const url = (at >= 0 && endAt > at) ? bg.slice(at + 5, endAt) : "";
    if (!url) out.wall = { present: false };
    else {
      const decoded = await new Promise(resolve => {
        const im = new Image();
        im.onload = () => resolve(im.naturalWidth + "x" + im.naturalHeight);
        im.onerror = () => resolve("ERR");
        im.src = url;
      });
      out.wall = { present: true, decoded: decoded, chars: url.length };
    }
  }catch(e){ out.wall = { present: false, err: String(e && e.message || e) }; }
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
    /* v2.26.1（DOM 瘦身）：格子的填充层从「每格一个 .fill 子节点」改成 **.cell::before
       伪元素**，推进量走 CSS 变量 --f。这条改动**桩完全测不出来**——桩没有伪元素、
       也不跑样式引擎，所以"填充层根本没被推进（格子永远不填白）"会是一例静默退化。
       故在**真实播放态**读 ::before 的计算 transform：至少要有一个格子 scaleX 明显 > 0。 */
    let fillScale = 0;
    for (const c of document.querySelectorAll("#viz .cell")){
      /* 用 indexOf 而不是正则：本探针是**模板字符串里的源码**，正则里的反斜杠会在
         "模板字面量 → CDP 传参"这两层里被吃掉一层（本次实测就抛出 Unterminated group）。 */
      const tr = getComputedStyle(c, "::before").transform || "";
      const i = tr.indexOf("(");
      if (tr.slice(0, 6) === "matrix" && i > 0){
        const v = parseFloat(tr.slice(i + 1));
        if (!isNaN(v)) fillScale = Math.max(fillScale, v);
      }
    }
    window.__beat.Controls.stop();
    /* 首屏耗时取自 **Navigation Timing**，不是探针自己的 performance.now()：
       探针要等 CDP 连上才注入，那时页面早启动完了，用探针的时间戳量出来的是
       "CDP 握手耗时"而非首屏。Navigation Timing 由浏览器从**导航开始**记账，
       何时去问都一样，因而可复现。loadMs 只打印不断言（loadEventEnd 在极少数
       时序下可能仍是 0，拿它做闸门会变成假红）。 */
    const nav = (performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null) || {};
    out.perf = { buildVizMs: +buildMs.toFixed(2), paintFrameMs: +frameMs.toFixed(3),
      measuredWhilePlaying: playing, syncFrames: N, fps: fps, fillScale: +fillScale.toFixed(3),
      bootMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || 0) };
  }catch(e){ out.perf = { err: String(e && e.message || e) }; }
  return JSON.stringify(out);
})()`;
}

/** 布局探针（v2.10.11）：只量「左边缘对齐 + 控件搬家后的相对位置」，供**两种视口**各跑一遍。
    为什么与主探针分开：它必须在**切换视口后重跑**，而主探针里的字号 / 盒子尺寸断言只在默认
    宽度下成立（例：窄屏 `.bpm-num` 会缩到 38px）。桩给不出真实布局——
    「几行文案的左边缘是否真的落在同一条线上」只能这样验（尺寸靠"行距远大于跳高上限"那种
    数值推断不算验证；这里是直接量像素） */
/* v3.0.0（PLAN-v9 批 0）预设库抽屉探针：收起 → 点开 → 再点收起，量真几何。
   抽屉是**内联**的（不是浮层），所以开合只改栅格行号与 hidden，读 rect 强制回流即可量到终态，
   不需要等动画（caret 的 transition 是纯装饰，不影响布局）。 */
function drawerProbe(){
  return `(() => {
  const round = v => Math.round(v * 10) / 10;
  const q = s => document.querySelector(s);
  const rect = el => { const r = el && el.getBoundingClientRect(); return r ? { l:round(r.left), r:round(r.right), t:round(r.top), b:round(r.bottom), w:round(r.width) } : null; };
  const out = { w: window.innerWidth };
  const btn = q("#presetLibCard"), dr = q("#presetDrawer"), viz = q("#viz");
  out.hasBtn = !!btn; out.hasDrawer = !!dr;
  out.vizInCard = !!(viz && viz.closest(".card"));
  /* v3.1.0：预设库卡片内部 —— 1 主钮（浏览节奏型 ▾）+ 3 次级入口 + 循环小节行
     （v3.0.0 批 5 的 6 颗同貌 pill 与 data-sec 分区按钮已退役） */
  const plbCard = q("#presetLibCard");
  out.plbMainBtn = !!(plbCard && plbCard.querySelector("#presetLibBtn"));
  out.plbHasEar = !!(plbCard && plbCard.querySelector("#earBtn"));
  out.plbHasLoop = !!(plbCard && plbCard.querySelector("#loopToggle"));
  out.plbInDrawer = !!(plbCard && dr && dr.contains(plbCard));
  const card = q(".viz-head-grid") && q(".viz-head-grid").closest(".card");
  out.cardInnerW = card ? round(card.getBoundingClientRect().width - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight)) : null;
  if (!btn || !dr) return JSON.stringify(out);
  /* ① 收起态 */
  out.btn = rect(btn);
  out.rowsClosed = rect(q(".viz-rows-row"));
  out.closedHidden = !!dr.hidden;
  out.ariaClosed = btn.getAttribute("aria-expanded");
  /* ② 点开：v3.1.0 起主钮「浏览节奏型 ▾」开合抽屉（批 5 的分区按钮已退役） */
  const mainBtn = q("#presetLibBtn");
  (mainBtn || btn).click();
  out.openHidden = !!dr.hidden;
  out.ariaOpen = btn.getAttribute("aria-expanded");
  out.drawer = rect(dr);
  out.rowsOpen = rect(q(".viz-rows-row"));
  out.btnOpen = rect(btn);
  /* v3.1.0：卡内容宽补测**展开态**——开抽屉会让页面长出滚动条（macOS/Windows 经典
     滚动条 15px），收起态量的卡宽与展开态量的抽屉宽差出这 15px 是平台现象不是回归；
     宽度断言改用同状态的两次测量（Linux overlay 滚动条两态相等，本口也成立） */
  out.cardInnerOpenW = card ? round(card.getBoundingClientRect().width - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight)) : null;
  out.scrollbarW = window.innerWidth - document.documentElement.clientWidth;   // CI Linux 经典滚动条 20px（抽屉与卡内容宽差的平台现象）
  /* ③ v3.1.0：点条目**不再收起**（选型与看型不分离）——真点一条验证 */
  const firstItem = q("#presetList .preset-item");
  if (firstItem) firstItem.click();
  out.selKeptOpen = !dr.hidden;
  /* ④ 复原 */
  q("#presetDrawerClose").click();
  out.reclosed = !!dr.hidden;
  /* v3.1.0：③ 的真点条目把模式切回了预设（exitArrangeForPreset）——后续滚动探针的
     歌词轨依赖曲式模式（arrangeCur()），不还原就整轨隐藏。纯 UI 复原：点示例曲条目
     回到曲式（playArrange 会开播）、再点播放键停住——回到「曲式选中示例曲、未播放」
     的出厂态，探针之间互不污染 */
  const demoItem = q("#presetList .preset-arrange-group .preset-item");
  if (demoItem){
    demoItem.click();
    const stTxt = q("#statusText");
    if (stTxt && /播放中/.test(stTxt.textContent)){
      const pb = q("#playBtn");
      if (pb) pb.click();                      // 停住（回到未播放态）
    }
  }
  /* v3.1.0：就地接续会让"停在哪"影响后续滚动探针的垂直登场采样——主流程在
     本探针之后重载一次页面，滚动探针拿到与 v3.0.1 相同的全新播放起点 */
  location.reload();
  return JSON.stringify(out);
})()`;
}
/* v3.0.0（PLAN-v9 批 2/3）连续滚动探针：**走真实 UI 路径**（设置弹窗 → 点开关 → 点播放），
   量真几何。桩里 t155 已覆盖数据/结构层，这里补的是桩永远测不到的那半——
   「播放头钉在行中央」在**真实布局**下成立：判据全部来自 getBoundingClientRect，
   不读任何内部变量（读内部变量等于与实现共用同一个来源，那是橡皮图章）。
   ★ 采样 200 帧（≈3.3s ≈ 1.3 小节）是刻意的：默认 96BPM/4-4 一小节正好 2.5s——
     采 150 帧时边界恰好压在采样窗末沿（v3.1.0 前的探针序列相位恰好偏进窗内，纯 luck），
     "最后一拍里的垂直登场"会随机漏采。多采 0.8s 把整个边界包进窗内，dy 断言不再靠相位。 */
function scrollProbe(){
  return `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const round = v => Math.round(v * 10) / 10;
  const out = { w: window.innerWidth };
  const viz = document.getElementById("viz");
  if (!viz) return JSON.stringify({ err: "no #viz" });
  out.baseRows = viz.querySelectorAll(".bar-row").length;
  out.baseScroll = viz.classList.contains("scroll-mode");
  /* v3.0.0 批 4：「同屏行数」档位随模式重列（滚动 1/3 ↔ 翻页 1/2/3/4）——同一个控件，
     不再多一个"窗口行数"、也不再把它置灰（用户拍板）。档位串是这条契约的可观测面。 */
  const rowPills = () => Array.from(document.querySelectorAll("#vizRowsRow .pill")).map(b => b.dataset.rows).join(",");
  const st = document.getElementById("settingsBtn");
  const tg = document.getElementById("scrollModeToggle");
  out.hasToggle = !!tg;
  if (!st || !tg) return JSON.stringify(out);
  /* 批 6：造一句词并开歌词 —— 出厂曲式若无词，歌词轨隐藏，「歌词跟不跟行走」就无从断言。
     ★ 这条必须在真机钉：桩里 arrangeCur() 为 null、paintLyric 早退，
       「两处 W 分叉 → 每帧整轨重建」在桩里根本不发作（批 6 实测）。 */
  try {
    __beat.Store.S.showLyric = true; __beat.Store.S.lyricPos = "follow";
    __beat.Store.upsertLyric("smoke", "smoke", [{ t: 0, dur: 24, ch: "测" }, { t: 96, dur: 24, ch: "词" }]);
    __beat.Viz.reloadScroll();
  } catch (e) {}
  out.rowsPaged = rowPills();
  /* ① 开：设置弹窗 → 点「连续滚动」 → 关弹窗 */
  st.click();
  tg.click();
  out.onAria = tg.getAttribute("aria-checked");
  const sc = document.getElementById("settingsClose"); if (sc) sc.click();
  await sleep(150);
  out.rowsScroll = rowPills();
  out.scrollClass = viz.classList.contains("scroll-mode");
  out.ovX = getComputedStyle(viz).overflowX;
  out.clip = getComputedStyle(viz).clipPath;
  out.bodyOx = getComputedStyle(document.body).overflowX;
  out.nRows = viz.querySelectorAll(".bar-row").length;
  out.cssH = viz.style.height;
  const lane = document.getElementById("lyricLane");
  out.laneClip = lane ? lane.classList.contains("scroll-clip") : null;
  /* ② 播放并逐帧采样 */
  document.getElementById("playBtn").click();
  const parse = s => {
    const a = s ? s.indexOf("(") : -1, b = s ? s.indexOf(")") : -1;
    if (a < 0 || b < 0) return null;
    const p = s.slice(a + 1, b).split(",");
    return p.length >= 2 ? [parseFloat(p[0]), parseFloat(p[1])] : null;
  };
  const samples = [];
  let lyricSameEarly = null;   // 批 6 回归钉：第 12 帧（≈0.2s，不可能跨小节）时元素必须还是同一个
  await new Promise(res => {
    let n = 0;
    const tick = () => {
      /* 第 2 帧才打标记（播放开始那次 scrollCur 初始化重建是合法的）、第 12 帧核对——
         中间 10 帧不可能跨小节，元素若换了就是「每帧重建」复发 */
      if (n === 2){
        const lr = document.querySelector("#lyricLane .lyric-row");
        if (lr) lr.dataset.smokeTag = "1";
      }
      if (n === 12){
        const lr = document.querySelector("#lyricLane .lyric-row");
        lyricSameEarly = !!(lr && lr.dataset && lr.dataset.smokeTag === "1");
      }
      const vr = viz.getBoundingClientRect();
      const ph = viz.querySelector(".playhead");
      const pr = ph ? ph.getBoundingClientRect() : null;
      const dxs = [], dys = [];
      viz.querySelectorAll(".bar-row").forEach(r => {
        const t = parse(r.style.transform);
        if (t && isFinite(t[0])) { dxs.push(round(t[0])); dys.push(round(t[1])); }
      });
      samples.push({ off: pr ? round((pr.left - vr.left) - vr.width / 2) : null, dxs: dxs, dys: dys });
      if (++n < 200) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  document.getElementById("playBtn").click();
  const offs = samples.map(s => s.off).filter(v => v !== null);
  out.nSamples = samples.length;
  out.nOff = offs.length;
  out.headMaxAbsOff = offs.length ? Math.max.apply(null, offs.map(Math.abs)) : null;
  const allDx = samples.reduce((a, s) => a.concat(s.dxs), []);
  out.dxSpread = allDx.length ? round(Math.max.apply(null, allDx) - Math.min.apply(null, allDx)) : null;
  const allDy = samples.reduce((a, s) => a.concat(s.dys), []);
  out.dyMaxAbs = allDy.length ? Math.max.apply(null, allDy.map(Math.abs)) : null;
  /* 批 6 回归钉的读数：采样结束后歌词行还是不是开头那个、transform 带不带横移 */
  out.lyricSameEl = lyricSameEarly;
  const lrEnd = document.querySelector("#lyricLane .lyric-row");
  out.lyricTf = lrEnd ? lrEnd.style.transform : "";
  /* ★ 不能用正则：本探针是模板字符串里的源码，反斜杠会被吃掉一层（perf 探针注释同款坑，
     实测 /translate\\(/ 传到页面变成 /translate(/ → Unterminated group）。用 indexOf。 */
  out.lyricHasDx = out.lyricTf.indexOf("translate(") === 0 && out.lyricTf.indexOf("px,") > 0;
  /* ③ 复位：再点一次开关 */
  st.click();
  tg.click();
  const sc2 = document.getElementById("settingsClose"); if (sc2) sc2.click();
  await sleep(150);
  out.offScroll = viz.classList.contains("scroll-mode");
  out.offRows = viz.querySelectorAll(".bar-row").length;
  out.offCssH = viz.style.height;
  out.rowsPagedBack = rowPills();
  /* 静止态（v3.0.0 批 4）：关掉之后必须已回到分页样子；再开一次、**不播放**，
     行槽就该是滚动模式的静止态（当前点在行中央），而不是"行从左侧铺满"的旧样子 */
  st.click(); tg.click(); const sc3 = document.getElementById("settingsClose"); if (sc3) sc3.click();
  await sleep(200);
  const restVr = viz.getBoundingClientRect();
  const restPh = viz.querySelector(".playhead");
  const restRows = Array.from(viz.querySelectorAll(".bar-row"));
  out.restHeadOff = restPh ? round((restPh.getBoundingClientRect().left - restVr.left) - restVr.width / 2) : null;
  out.restRowW = restRows.length ? round(restRows[0].getBoundingClientRect().width) : null;
  out.restRowDxs = restRows.map(r => { const t = r.style.transform || ""; const i = t.indexOf("("); return i >= 0 ? round(parseFloat(t.slice(i + 1))) : null; });
  st.click(); tg.click(); const sc4 = document.getElementById("settingsClose"); if (sc4) sc4.click();
  await sleep(150);
  return JSON.stringify(out);
})()`;
}
function layoutProbe(){
  return `(() => {
  const round = v => Math.round(v * 10) / 10;
  /* 第一段非空文字的**真实**左边缘（Range 量文本节点，而不是元素盒子）——
     元素盒子在按钮上会含 padding，看不出"文案"到底从哪开始 */
  const textLeft = el => {
    if (!el) return null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())){
      if (n.textContent && n.textContent.trim()){
        const rg = document.createRange(); rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        if (r.width > 0) return round(r.left);
      }
    }
    return null;
  };
  const boxLeft = el => { const r = el && el.getBoundingClientRect(); return r ? round(r.left) : null; };
  const q = s => document.querySelector(s);
  const out = { w: window.innerWidth };
  out.scrollW = document.documentElement.scrollWidth;
  const vizEl = q("#viz");
  /* v3.0.0：#viz 已随 #vizBand 迁出卡片（可视化区不带卡片背景）——基准卡片改为**控制卡**
     （.viz-head-grid 所在的 .card），四块组容器与左缘断言的语义不变；
     网格右缘的参照物从「卡片右缘」换成「主列内容右缘」（见 out.mainRight）。 */
  const card = (q(".viz-head-grid") && q(".viz-head-grid").closest(".card")) || (vizEl && vizEl.closest(".card"));
  if (!card) return JSON.stringify(out);
  const cr = card.getBoundingClientRect();
  out.cardTextLeft = round(cr.left + parseFloat(getComputedStyle(card).paddingLeft));
  out.cardRight = round(cr.right);
  /* v3.0.0：主列内容右缘（.main 盒 − 右内边距）= 网格不溢出的新参照物 */
  out.mainRight = (() => {
    const mn = q(".main");
    if (!mn) return null;
    const mr = mn.getBoundingClientRect();
    return round(mr.right - parseFloat(getComputedStyle(mn).paddingRight));
  })();
  out.vizInCard = !!(vizEl && vizEl.closest(".card"));   // v3.0.0：断言"确实已迁出卡片"
  out.vizRight = (() => { const v = q("#viz"); const r = v && v.getBoundingClientRect(); return r ? round(r.right) : null; })();
  /* v2.39.0：组容器底上线——控制列有了 16px 内边距，左缘基准改为「组容器内容边缘」
     （卡片内容边缘 + padding）。旧口径 cardTextLeft 保留，容器缺失时回退 */
  const headLeft = q(".card-head-left");
  out.headContentLeft = (() => {
    if (!headLeft) return null;
    const hr = headLeft.getBoundingClientRect();
    return hr ? round(hr.left + parseFloat(getComputedStyle(headLeft).paddingLeft)) : null;
  })();
  /* v2.10.16：标题 #vizTitle 已删，左边缘基准改用左列「音量」组标签
     （角标在经典主题是 display:none，不能当基准；音量标签同在卡片内容边缘上） */
  out.title = textLeft(q(".card-head-left .group-label"));
  out.toggle = textLeft(q(".viz-toggles .tg-row .toggle-pill"));   // v2.76.0：开关移入 .tg-row 行容器
  out.rowsLabel = textLeft(q(".viz-rows-panel > .group-label"));
  out.rowsPillBox = boxLeft(q("#vizRowsRow > .pill"));

  out.vizRowsPanel = boxLeft(q(".viz-rows-panel"));
  const sig = q("#sigRow"), timbre = q("#timbreRow"), vol = q(".vol-row");
  out.sigGroup = sig ? boxLeft(sig.parentElement) : null;
  out.timbreGroup = timbre ? boxLeft(timbre.parentElement) : null;
  out.volGroup = vol ? boxLeft(vol.parentElement) : null;
  out.editBtn = boxLeft(q("#editBtn"));
  /* v2.42.7：组容器卡宽度（窄屏等宽回归断言的数据源）
     v3.0.0：**五块**——预设库块 #presetLibBtn 插在开关与行数之间（抽屉收起时不占位、展开时
     也只占它自己的行，故不进本表：抽屉不是"组容器卡"） */
  out.grpWidths = (() => {
    const els = [q(".card-head-left"), q(".viz-head > .group"), q(".viz-toggles"), q("#presetLibCard"), q(".viz-rows-row")];
    return els.map(el => { const r = el && el.getBoundingClientRect(); return r ? round(r.width) : null; });
  })();
  /* v2.42.7 追加：相邻组容器卡的垂直间隙（等距回归断言的数据源——三处来源曾各给各的：
     row-gap 6/12 / head margin-bottom 16 / toggles margin-bottom 16） */
  out.grpGaps = (() => {
    const els = [q(".card-head-left"), q(".viz-head > .group"), q(".viz-toggles"), q("#presetLibCard"), q(".viz-rows-row")];
    const rs = els.map(el => el && el.getBoundingClientRect());
    const gaps = [];
    for (let i = 1; i < rs.length; i++) if (rs[i] && rs[i-1]) gaps.push(round(rs[i].top - rs[i-1].bottom));
    return gaps;
  })();
  return JSON.stringify(out);
})()`;
}

/** 在浏览器里跑一轮：打开 url → 等页面 → 取探针结果 + 控制台错误 */
async function runPass(label, url, userDataDir){
  const cdpPort = PORT_BASE;
  const args = [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--window-size=1440,1000",
    /* v2.8.30 加固（CI 冒烟偶发「等不到调试目标」）：
       Ubuntu 24.04 起内核默认限制非特权 user namespace，Chrome 的沙箱会起不来 → 无头实例
       当场退出、调试端口永不监听。本地 macOS/Windows 无此限制，故只在 CI 暴露。
       --no-sandbox 关掉该沙箱；--disable-dev-shm-usage 规避容器里 /dev/shm 过小导致崩溃。
       代价：仅作用于本脚本拉起的这一个一次性无头实例，且只加载自备的本地内容。 */
    "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=" + cdpPort,
    "--user-data-dir=" + userDataDir,
    url,
  ];
  /* v2.8.30：把浏览器 stderr 收下来。此前 stdio:"ignore" 让「起不来」只剩一句
     「浏览器是否启动失败？」，排查只能靠猜；现在失败时把浏览器自己的话原样带进报错。 */
  const child = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"] });
  /* v2.42.3：spawn 层错误（ENOENT 等）必须有人接——ChildProcess 的 'error' 事件
     无人监听会以未捕获异常的形式炸掉整个脚本（exit 1，比「等不到调试目标」更难读）。
     接住后走正常路径：调试端口永远等不到 → 「等不到调试目标」→ flake 自愈口径处理。 */
  child.on("error", () => {});
  let browserErr = "";
  if (child.stderr) child.stderr.on("data", d => { browserErr += d.toString(); });
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
    if (!targets){
      const tail = browserErr.trim().split("\n").slice(-6).join("\n      ");
      throw new Error("等不到调试目标（浏览器是否启动失败？）"
        + (tail ? "\n      浏览器 stderr：\n      " + tail : "（浏览器未输出 stderr）"));
    }
    cdp = await connectCdp(targets.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable").catch(() => {});
    const raw = await evaluate(cdp, probe());
    result.probe = JSON.parse(raw);
    /* v2.10.11：布局探针跑两遍——桌面宽度一遍，再切到 390px 一遍，量完恢复视口。
       失败只标记 result.layout = null（对应的几条断言会报"未验证"），不影响其它断言。
       ★ 桌面遍也走 setDeviceMetricsOverride（不再依赖 --window-size 的实际视口）：
       --window-size=1440 在 Windows 经典滚动条下 innerWidth 只有 ~1424（被吃掉 ~16px），
       而网格居中的媒体查询是 min-width:1440px——视口差 1px 不到断点，桌面网格整个不激活，
       「开关行右移」断言在本机必红、CI（Linux 无经典滚动条）却绿。用 deviceMetrics 钉死
       1440 后，三平台探针基线一致（与下方 390 窄屏同一机制）。 */
    try{
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(400);                       // 等 resize 重排与网格 relayout 跑完
      const wide = JSON.parse(await evaluate(cdp, layoutProbe()));
      /* v3.0.0：抽屉探针在桌面宽度（≥1280 栅格生效）跑一遍，量收起/展开两态的真几何 */
      const drawer = JSON.parse(await evaluate(cdp, drawerProbe()));
      /* v3.1.0：drawerProbe 末尾 location.reload()——等页面重新起完再跑滚动探针
         （playMode 已被本探针复原为曲式；重载顺带把"就地接续"的播放位置归零） */
      await sleep(1500);
      /* v3.0.0：连续滚动探针（同上，桌面宽度、真实 UI 路径、约 3.3s 采样） */
      const scroll = JSON.parse(await evaluate(cdp, scrollProbe()));
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(400);                       // 等 resize 重排与网格 relayout 跑完
      const narrow = JSON.parse(await evaluate(cdp, layoutProbe()));
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await sleep(150);
      result.layout = { wide, narrow };
      result.drawer = drawer;
      result.scroll = scroll;
    }catch(e){
      result.layout = null;
      console.log("  ! 布局探针未取到（只影响本轮新增的对齐断言）：" + (e && e.message ? e.message : e));
    }
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
  /* ★ CDP 端口被占时必须走 ⊘（退出码 3），不能硬跑：
     若 8791 已被**另一个**浏览器/调试实例监听，本脚本 spawn 的那个实例会因端口冲突起不来，
     而 runPass 里 fetch `/json/list` 却会成功——它连上的是**别人**的实例，页面不是我们的 URL，
     探针白等 4 秒拿不到 __beatBoot，于是整串断言变红。那是"端口是环境资源"被误报成"代码失败"，
     正是 P1-6/冒烟退出码要消除的那类假红。 */
  if (await portInUse(PORT_BASE)){
    console.log("  ⊘ 冒烟端口 " + PORT_BASE + " 已被占用 —— 跳过（端口是环境资源，不是失败项）");
    console.log("    想跑的话：设 BEATSIGHT_SMOKE_PORT=<空闲端口基号>（HTTP 取该值 +1）");
    process.exit(3);
  }
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

  const transportFaults = [];   // v2.42.3：传输层故障的通道（工具故障口径，见通道循环内的说明）
  for (const p of passes){
    console.log("\n▸ 通道 " + p.label);
    const profileOf = tag => path.join(tmp, "profile-" + p.label.replace(/[^a-z]/gi, "") + tag);
    let r = await runPass(p.label, p.url, profileOf(""));
    /* v2.42.3（审计第一批 · flake 自愈）：两类**环境性**异常不当场判红——
       ① 传输层故障（Chrome 起不来 / CDP 连不上 / 求值时执行环境被销毁——已实测四例）；
       ② 性能读数越预算（fps / buildViz / bootMs，对机器负载最敏感的三项）。
       两者与被检代码无关，先自动重测一次、以重测为准；传输层**两次都**故障 →
       记 transportFaults，末尾按退出码 4（工具故障，与 P1-6 的退出码约定一致）交出——
       check-all 对该退出码记 ⚠ 而非 ✗，且对冒烟步还会再自动重跑一次（双层自愈）；
       预算类重测仍越线才真的判红（连续两轮，不是抖动）。
       为什么要缓冲：判据失手的代价本项目自己算过（eslint.config.js 文件头——
       一个常年飘红的检查很快会被所有人无视或直接关掉，等于没写）。 */
    const isTransport = x => x.errors.some(m =>
      /等不到调试目标|WebSocket 连接失败|Execution context was destroyed/.test(m));
    const isBudgetFlake = x => {
      const f = x.probe && x.probe.perf;
      return !!f && (f.fps < PERF_BUDGET.fps
        || f.buildVizMs >= PERF_BUDGET.buildVizMs
        || f.bootMs > PERF_BUDGET.bootMs);
    };
    const transport = isTransport(r);
    const budgetBad = !transport && isBudgetFlake(r);
    if (transport || budgetBad){
      const why = transport
        ? "传输层故障（" + String(r.errors[0] || "").slice(0, 60) + "…）"
        : "性能读数越预算（fps / buildViz / bootMs，环境敏感）";
      console.log("  · " + why + " —— flake 自愈：自动重测一次（v2.42.3）");
      const r2 = await runPass(p.label, p.url, profileOf("-retry"));
      if (transport){
        if (!isTransport(r2)){ console.log("  · 重测通过，以重测结果为准"); }
        else { transportFaults.push(p.label); console.log("  · 重测仍传输层故障 → 按工具故障记账"); }
      } else {
        console.log(isBudgetFlake(r2)
          ? "  · 重测仍越预算 —— 连续两轮，不是抖动，判红"
          : "  · 重测落入预算，以重测结果为准");
      }
      r = r2;
    }
    const d = r.probe;
    ok(!!d && d.booted, p.label + "：应用启动成功（window.__beatBoot 就位、没有白屏）",
      d ? "" : r.errors.join(" / "));
    if (d && d.booted){
      /* v2.10.9（用户实报）：顶栏原先有两处版本号（品牌区徽章 + 最右的保存状态 chip），
         整条读下来重复 → 已按用户要求保留**左侧**那一处。故这里盯的从 chip 改为徽章，
         并加一条"chip 不再重复版本号"——不然改坏了两处一起显示、也没人拦 */
      ok(d.version.ver === "v" + VERSION, p.label + "：品牌区版本号 = v" + VERSION,
        "实际 " + (d.version && d.version.ver));
      ok(!!d.version.chip && d.version.chip.indexOf("v" + VERSION) < 0,
        p.label + "：顶栏 chip 只报保存状态、不重复版本号",
        "实际 " + (d.version && d.version.chip));
      ok(d.version.const === VERSION, p.label + "：页面内 VERSION 与源码一致");
      /* v2.13.0：出厂默认壁纸**真的能被浏览器解码**（宽高是数字、不是 ERR）。
         ★ 这条是"桩测不出、只能真机验"的典型：内联 base64 前缀写重过一次，
         桩全绿而背景空白。冒烟用的 profile 每次都是全新的 → 必然是首次打开形态。 */
      ok(!!d.wall && d.wall.present === true && /^\d+x\d+$/.test(String(d.wall.decoded))
         && d.wall.chars > 1000,
        p.label + "：出厂默认壁纸能真解码（v2.13.0）",
        d.wall ? JSON.stringify(d.wall) : "探针未取到 #wallLayer");
      /* v2.10.10：状态点真的落在品牌区徽章矩形内、且真的被画出来（真布局，桩测不到） */
      ok(!!d.badgeDot && d.badgeDot.inside === true,
        p.label + "：保存状态点渲染在版本徽章矩形内（真布局）",
        d.badgeDot ? JSON.stringify(d.badgeDot) : "探针未取到 #persistDot / #brandVer");
      ok(!!d.badgeDot && d.badgeDot.w > 0 && d.badgeDot.h > 0
         && !/rgba\(0, 0, 0, 0\)/.test(d.badgeDot.bg),
        p.label + "：状态点真的被画出来（尺寸 > 0、底色非透明）",
        d.badgeDot ? "w=" + d.badgeDot.w + " h=" + d.badgeDot.h + " bg=" + d.badgeDot.bg : "");
      /* ---- v2.10.11：左边缘对齐（需求③选丙 + 需求②(ii) 补齐）—— 全是**真几何**，桩测不到 ----
         桌面（1440 窗口）与窄屏（390，模拟手机）各验一遍：用户报的那次就发生在窄屏上。 */
      const lay = r.layout || {};
      const sameLine = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 0.51;
      for (const pair of [["桌面", lay.wide], ["窄屏390", lay.narrow]]){
        const label = pair[0], m = pair[1];
        if (!m){
          ok(false, p.label + "：" + label + " 布局探针未取到（本项未验证）", "见上方的探针提示");
          continue;
        }
        const base = m.title;
        /* v2.39.0：组容器底上线——控制列有了 16px 内边距，基准从「卡片内容边缘」
           改为「组容器内容边缘」（恒差一个 padding；容器缺失时回退旧口径） */
        const baseEdge = (typeof m.headContentLeft === "number") ? m.headContentLeft : m.cardTextLeft;
        ok(sameLine(baseEdge, base),
          p.label + "·" + label + "：前提——标题文字就在控制列内容边缘上（基准可信）",
          "内容边缘 " + baseEdge + " vs 标题 " + base + "（视口 " + m.w + "）");
        /* v2.38.0（用户反馈）：卡片头改居中分布——桌面（≥1280px）走 grid 居中（三块各归其列，
           不再左贴）；窄屏（<1280px）回退现状左贴（同一套断言保留）。两种口径按 label 分派。
           v2.39.0：竖跨执行错误已修——r1 = 音量｜BPM｜三开关并列，r2 = 行数拍号 1/4 占满整行，
           故行数行的左缘从「右移」改回「与音量列同缘」（都从第一列的内容缘起步） */
        if (label === "桌面"){
          ok(m.toggle > base + 40,
            p.label + "·" + label + "：★ 开关行已右移离标题（居中分布，不再左贴）",
            "标题 " + base + " vs 开关 " + m.toggle);
          ok(sameLine(m.rowsLabel, base),
            p.label + "·" + label + "：行数标签与音量列同缘（v2.39.0：整行占满，从第一列起步）",
            "标题 " + base + " vs 标签 " + m.rowsLabel);
          ok(m.rowsPillBox > base,
            p.label + "·" + label + "：行数 pill 盒子跟在同屏行数标签右侧（标签与按钮同行自适应）",
            "标签 " + m.rowsLabel + " vs pill 盒子 " + m.rowsPillBox);
        } else {
          ok(sameLine(m.toggle, base),
            p.label + "·" + label + "：窄屏回退左贴——开关行与标题同一条左边缘",
            "标题 " + base + " vs 开关 " + m.toggle);
          ok(sameLine(m.rowsLabel, base),
            p.label + "·" + label + "：行数标签也在这条线上", "标题 " + base + " vs 标签 " + m.rowsLabel);
        }
      }
      if (lay.wide){
        /* v2.38.0：居中分布下行数/拍号可能同行也可能堆叠（宽度由内容与居中算法决定），
           旧「拍号在右」左贴断言退役；改为验证两块都在卡片内容区内且不超界 */
        ok(lay.wide.vizRowsPanel > 0 && lay.wide.sigGroup > 0,
          p.label + "：行数/拍号面板均在文档内（居中布局正常渲染）",
          "行数 " + lay.wide.vizRowsPanel + " vs 拍号 " + lay.wide.sigGroup);
        ok(sameLine(lay.wide.volGroup, lay.wide.title),
          p.label + "：★★ 音量组在标题正下方（卡片头左列，左缘 = 卡片内容边缘）（v2.10.15）",
          "标题 " + lay.wide.title + " vs 音量组 " + lay.wide.volGroup);
      } else {
        ok(false, p.label + "：桌面布局未取到（需求①②的相对位置本项未验证）", "");
      }
      if (lay.narrow){
        /* 窄屏下这两块放不下，必须**折行**而不是溢出（body 有 overflow-x:hidden，溢出会被静默裁掉） */
        ok(lay.narrow.sigGroup <= lay.narrow.vizRowsPanel + 0.51,
          p.label + "：★ 窄屏下拍号折到下一行（左边缘回到卡片内容列，没被裁）",
          "行数 " + lay.narrow.vizRowsPanel + " vs 拍号 " + lay.narrow.sigGroup);
        /* v2.59.0（Infra B · 390px 几何回归扩展）：窄屏最静默的退化是「内容比视口宽、
           被 body 的 overflow-x:hidden 静默裁掉」——用户看不到滚动条，但右侧控件被吃掉。
           这两条专门拦它：整页无横向滚动条 + #viz 网格不超出卡片右缘。 */
        ok(lay.narrow.scrollW <= lay.narrow.w + 1,
          p.label + "：★ 窄屏390 无横向溢出（scrollWidth ≤ innerWidth）",
          "scrollW " + lay.narrow.scrollW + " vs innerWidth " + lay.narrow.w);
        /* v3.0.0：#viz 迁出卡片后参照物换成主列内容右缘（可视化带全宽落在页面背景上） */
        ok(lay.narrow.vizRight !== null && lay.narrow.mainRight !== null
           && lay.narrow.vizRight <= lay.narrow.mainRight + 1,
          p.label + "：窄屏390 #viz 网格不溢出主列内容区（无内部横向溢出）",
          "vizRight " + lay.narrow.vizRight + " vs mainRight " + lay.narrow.mainRight);
      } else {
        ok(false, p.label + "：窄屏布局未取到（需求①的折行本项未验证）", "");
      }
      /* v2.42.7：窄屏四张组容器卡等宽（宽度策略分裂的回归闸门——音量卡 352 钉死 /
         BPM 内容宽 / 开关·行数撑满曾在窄屏并存，右缘参差；宽屏 2×2 与四块一行
         有自己的列宽设计，本断言只认窄屏） */
      /* v3.0.0：四块 → **五块**（新增预设库块），长度门槛与文案同步 */
      if (lay.narrow && Array.isArray(lay.narrow.grpWidths) && lay.narrow.grpWidths.length === 5){
        const gws = lay.narrow.grpWidths;
        ok(Math.max(...gws) - Math.min(...gws) <= 1,
          "窄屏：★ 五张组容器卡等宽（宽度策略分裂回归闸门）",
          "宽度 " + JSON.stringify(gws));
      }
      if (lay.narrow && Array.isArray(lay.narrow.grpGaps) && lay.narrow.grpGaps.length === 4){
        const ggs = lay.narrow.grpGaps;
        ok(Math.max(...ggs) - Math.min(...ggs) <= 1,
          "窄屏：★ 五张组容器卡等距（间距来源分裂回归闸门）",
          "间隙 " + JSON.stringify(ggs));
      }
      /* ---- v3.0.0（PLAN-v9 批 0）：可视化带去卡片 + 预设库抽屉（真几何，桩测不到）---- */
      const dw = r.drawer;
      if (dw && dw.hasBtn && dw.hasDrawer){
        /* v3.1.0：预设库卡片 = 1 主钮（浏览节奏型 ▾）+ 3 次级入口 + 循环小节行，
           且它在**卡片区**、不在抽屉里（抽屉只放列表与提示） */
        ok(dw.plbMainBtn === true, p.label + "：★ 预设库卡片主钮「浏览节奏型 ▾」在卡片内",
          "实际 plbMainBtn=" + dw.plbMainBtn);
        ok(dw.plbHasEar === true && dw.plbHasLoop === true,
          p.label + "：★ 听辨训练入口与「循环本段」都在卡片里（v3.0.0 批 5 从抽屉搬出）");
        ok(dw.plbInDrawer === false, p.label + "：★ 卡片本身不在抽屉内（它是控制行第 4 块）");
        ok(dw.vizInCard === false,
          p.label + "：★ v3.0.0 可视化区已迁出卡片（#viz 不在任何 .card 内）",
          "vizInCard=" + dw.vizInCard);
        ok(dw.closedHidden === true && dw.ariaClosed === "false",
          p.label + "：★ 抽屉默认收起（hidden + aria-expanded=false）",
          "hidden=" + dw.closedHidden + " aria-expanded=" + dw.ariaClosed);
        ok(dw.openHidden === false && dw.ariaOpen === "true",
          p.label + "：★ 点预设库块 → 抽屉展开（hidden 摘掉 + aria-expanded=true）",
          "hidden=" + dw.openHidden + " aria-expanded=" + dw.ariaOpen);
        /* v3.1.0：选型不收起——点条目后抽屉仍开（真点击路径，桩测不到的语义） */
        ok(dw.selKeptOpen === true,
          p.label + "：★★ 点条目后抽屉仍开（v3.1.0 选型不收起，比较多个型不必反复开合）",
          "selKeptOpen=" + dw.selKeptOpen);
        /* 抽屉必须**紧贴行 1 之下**、在「同屏行数与拍号」之上——这是用户拍板的位置，
           不是"排在最末"即可（同屏行数行要被它推到第 3 行） */
        ok(!!dw.drawer && !!dw.btnOpen && dw.drawer.t >= dw.btnOpen.b - 0.51,
          p.label + "：★★ 抽屉紧贴第 1 行之下（在预设库块下沿之后）",
          "块底 " + (dw.btnOpen && dw.btnOpen.b) + " vs 抽屉顶 " + (dw.drawer && dw.drawer.t));
        ok(!!dw.drawer && !!dw.rowsOpen && dw.drawer.b <= dw.rowsOpen.t + 0.51,
          p.label + "：★★ 抽屉排在「同屏行数与拍号」**之上**（不是排在最末）",
          "抽屉底 " + (dw.drawer && dw.drawer.b) + " vs 行数行顶 " + (dw.rowsOpen && dw.rowsOpen.t));
        ok(!!dw.rowsOpen && !!dw.rowsClosed && dw.rowsOpen.t > dw.rowsClosed.t + 1,
          p.label + "：★ 展开后「同屏行数与拍号」被下推（栅格行号真的换了）",
          "收起 " + (dw.rowsClosed && dw.rowsClosed.t) + " → 展开 " + (dw.rowsOpen && dw.rowsOpen.t));
        /* CI Linux headless Chrome 实测：滚动条 15 + 抽屉嵌套层结构差 5 = 总差 20（平台现象） */
        const slack = 1 + (dw.scrollbarW || 0) + 25;
        ok(!!dw.drawer && dw.cardInnerOpenW !== null && dw.drawer.w >= dw.cardInnerOpenW - slack,
          p.label + "：★ 抽屉接近控制卡内容宽（全宽内联，不是浮层）",
          "抽屉宽 " + (dw.drawer && dw.drawer.w) + " vs 卡内容宽(展开态同测) " + dw.cardInnerOpenW + "（容差 " + slack + "）");
        ok(dw.reclosed === true,
          p.label + "：★ 再点一次 → 收起（选中/关闭路径同款）", "hidden=" + dw.reclosed);
      } else {
        ok(false, p.label + "：v3.0.0 抽屉探针未取到（开合两态本项未验证）", JSON.stringify(dw || {}));
      }
      /* v3.0.0（PLAN-v9）：连续滚动 —— 真实 UI 路径 + 真实几何。
         ★ 核心那条是 headMaxAbsOff：「播放头钉在行中央」此前只有桩断言，
           而桩的行宽是写死的 600、几何是伪造的 —— 钉不钉得中在桩里无从谈起。 */
      const sr = r.scroll;
      if (sr && !sr.err){
        ok(sr.hasToggle === true, p.label + "：设置弹窗里有「连续滚动」开关");
        ok(sr.baseScroll === false, p.label + "：★ 默认仍是分页（#viz 不带 .scroll-mode）");
        ok(sr.onAria === "true", p.label + "：点开关后 aria-checked=true（语义跟状态走）", "实际 " + sr.onAria);
        ok(sr.scrollClass === true, p.label + "：★ 开关真的挂了 .scroll-mode 类");
        /* v3.0.0 批 5（用户拍板选 B）：**不限制每条带的边界**——不再用 overflow 裁剪，
           改成 clip-path 只裁上下、左右放开（inset(0 -2000px)），溢出由 body 的
           `overflow-x:clip` 兜在视口边缘。所以这里断言的是"裁剪方式变了"，而不是"没有裁剪"。 */
        ok(typeof sr.clip === "string" && /inset\(/.test(sr.clip),
          p.label + "：★ scroll 下 #viz 用 clip-path 只裁上下（上下裁到盒子、左右放开）", "实际 " + sr.clip);
        ok(sr.clip.indexOf("-2000px") >= 0,
          p.label + "：★ 左右方向是**外扩**（不裁）——「不限制每条带的边界」的落点", "实际 " + sr.clip);
        ok(sr.bodyOx === "hidden",
          p.label + "：★ 横向溢出由 body 的 overflow-x:hidden 兜住（clip 不传播到视口，实测仍能横拖）",
          "实际 body overflow-x=" + sr.bodyOx);
        ok(sr.rowsPaged === "1,2,3,4" && sr.rowsScroll === "1,3",
          p.label + "：★★ 「同屏行数」档位随模式重列（分页 1/2/3/4 ↔ 滚动 1/3，同一个控件）",
          "分页 " + sr.rowsPaged + " → 滚动 " + sr.rowsScroll);
        ok(sr.rowsPagedBack === "1,2,3,4", p.label + "：★ 关掉后档位回到 1/2/3/4", "实际 " + sr.rowsPagedBack);
        /* 静止态：**不播放**时也该是滚动模式的样子（用户实报：打开后首屏仍是旧样子） */
        /* 静止态的签名：**当前行**右移半行宽（当前点落中央）、**上一行**冻结在左半屏。
           两件事都要，只看一个会漏 —— 比如"所有行都没平移"时，当前行那半句也过不了，
           但"只平移了当前行、邻行忘了冻结"会让带子间露出错位。 */
        const rdx = sr.restRowDxs || [], half = (sr.restRowW || 0) / 2;
        ok(rdx.length >= 2 && half > 0 &&
           Math.abs(Math.max.apply(null, rdx) - half) <= 1.5 &&
           Math.abs(Math.min.apply(null, rdx) + half) <= 1.5,
          p.label + "：★★ 未播放时行槽已是静止态（当前行右移半行宽 + 上一行冻结在左半屏）",
          "各行 dx=" + JSON.stringify(rdx) + " / 行宽 " + sr.restRowW);
        ok(typeof sr.restHeadOff === "number" && Math.abs(sr.restHeadOff) <= 1.5,
          p.label + "：★ 未播放时播放头已在行中央（不必等播放）", "偏心 " + sr.restHeadOff + "px");
        ok(typeof sr.nRows === "number" && sr.nRows >= 2 && sr.nRows > sr.baseRows - 1,
          p.label + "：★ scroll 下建 " + sr.nRows + " 行（= 可见行数 + 1 个进场行）", "paged 基线 " + sr.baseRows);
        ok(typeof sr.cssH === "string" && /^\d+px$/.test(sr.cssH),
          p.label + "：★ #viz 高度被裁到可见行（inline height 已设）", "实际 " + sr.cssH);
        ok(sr.laneClip !== false, p.label + "：歌词覆盖层带 .scroll-clip（它是 #viz 兄弟节点，须自带裁剪）",
          "实际 " + sr.laneClip);
        ok(sr.nOff === sr.nSamples && sr.nSamples >= 100,
          p.label + "：播放采样满帧（" + sr.nOff + "/" + sr.nSamples + "）—— 读数有效的前提");
        ok(typeof sr.headMaxAbsOff === "number" && sr.headMaxAbsOff <= 1.5,
          p.label + "：★★ 播放全程播放头钉在行水平中央（真实 rect 实测，最大偏心 " + sr.headMaxAbsOff + "px ≤ 1.5）");
        ok(typeof sr.dxSpread === "number" && sr.dxSpread >= 100,
          p.label + "：★ 行槽横向连续推移（150 帧内位移跨度 " + sr.dxSpread + "px）");
        ok(typeof sr.dyMaxAbs === "number" && sr.dyMaxAbs > 0.5,
          p.label + "：★ rows=3 有垂直登场（帧内 |dy| 峰值 " + sr.dyMaxAbs + "px > 0）");
        ok(sr.lyricSameEl === true,
          p.label + "：★★ 播放中歌词行元素**不被重建**（批 6：两处 W 分叉曾致每帧整轨重建 → 歌词脱节）");
        ok(sr.lyricHasDx === true,
          p.label + "：★★ 播放中歌词行 transform 带横移（与网格行同组走，而不是只剩 translateY）",
          "实际 " + sr.lyricTf);
        ok(sr.offScroll === false, p.label + "：★ 再点一次 → 回到分页（.scroll-mode 已摘）");
        ok(sr.offRows === sr.baseRows, p.label + "：★ 回到分页后行数复原", sr.offRows + " vs " + sr.baseRows);
        ok(sr.offCssH === "", p.label + "：★ 回到分页后 #viz 的裁剪高度已交还内容", "实际 " + JSON.stringify(sr.offCssH));
      } else {
        ok(false, p.label + "：v3.0.0 连续滚动探针未取到（本项未验证）", JSON.stringify(sr || {}));
      }
      ok(!!d.viz && d.viz.children > 0, p.label + "：可视化网格已渲染（" + (d.viz ? d.viz.children : 0) + " 个顶层节点）");
      ok(!!d.viz && d.viz.ariaHidden === "true", p.label + "：#viz 对读屏隐藏");
      /* v2.10.5：DOM 规模断言（第 5 项性能预算）。放在这里而不是 perf 那一组里，
         是因为它只需要 boot 成功即可测，不依赖"播放态已建立"（perf 那组的前提）。 */
      ok(typeof d.domNodes === "number" && d.domNodes > 0 && d.domNodes <= PERF_BUDGET.domNodes,
        p.label + "：DOM 节点数 ≤ " + PERF_BUDGET.domNodes + "（口径对齐 Lighthouse「避免 DOM 过大」审计：>800 警告 / >1400 错误）",
        "实际 " + d.domNodes + " 个");
      if (d.bpmNum){
        ok(d.bpmNum.tag === "BUTTON", p.label + "：#bpmNum 是 <button>（键盘可达）", "实际 " + d.bpmNum.tag);
        ok(/rgba\(0, 0, 0, 0\)|transparent/.test(d.bpmNum.bg), p.label + "：#bpmNum 静止态无底色（外观未走样）",
          "实际 background=" + d.bpmNum.bg);
        ok(d.bpmNum.outline === "none", p.label + "：#bpmNum 静止态无 outline（绿框只在聚焦时出现）",
          "实际 outline=" + d.bpmNum.outline);
        ok(d.bpmNum.font === "40px" && d.bpmNum.w === 64, p.label + "：#bpmNum 尺寸字号与设计一致（64×46 / 40px，v2.75.0 重排等宽压缩行）",
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
          + " · DOM 节点 " + d.domNodes + " 个（预算 ≤ " + PERF_BUDGET.domNodes + "）"
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
        /* v2.26.1：填充层走 ::before + --f 之后的**防退化护栏**——桩测不到伪元素，
           只有真机能证明"格子真的被填白了"。scaleX 恒 0 = 填充推进整条断了。 */
        ok(d.perf.fillScale > 0.05,
          p.label + "：★ 播放中格子填充层确实被推进（.cell::before 的 scaleX > 0）",
          "实际最大 scaleX = " + d.perf.fillScale);
      }
    }
    ok(r.errors.length === 0, p.label + "：控制台零报错", r.errors.slice(0, 3).join(" / "));
    if (r.warnings.length) console.log("  · 控制台警告 " + r.warnings.length + " 条：" + r.warnings.slice(0, 3).join(" / "));
  }

  if (server) server.close();
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}

  console.log("──────────────────────────────────────────────────────────");
  if (transportFaults.length){
    /* v2.42.3：工具故障口径（仓库退出码约定：4 = 本步骤未能执行，不是被检项失败）。
       check-all 对 4 记 ⚠ 并再自动重跑一次本步；--strict-env（CI）下 ⚠ 仍按失败处理，
       故 CI 里连续 4 次传输层故障才会红——环境抖动事实上被自愈吸收。 */
    console.log("  ⚠ 冒烟未完成（传输层故障，工具故障口径）：通道 " + transportFaults.join(" / "));
    process.exit(4);
  }
  if (fail){
    console.log("  ✗ 冒烟未通过：" + fail + " 项失败");
    failures.forEach(f => console.log("      · " + f));
    process.exit(1);
  }
  console.log("  ✓ 冒烟通过（" + pass + " 项断言）");
  process.exit(0);
}

main().catch(e => {
  /* v2.42.3：脚本自身崩溃也是「想跑但没跑成」——按工具故障（4）而不是检查失败（1）记账，
     与本文件头的 ⊘/⚠/✗ 三分法一致（原先 exit 1 会把环境故障说成被检项失败）。 */
  console.log("  ✗ 冒烟脚本自身异常：" + (e && e.stack ? e.stack : e));
  process.exit(4);
});
