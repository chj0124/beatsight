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

/* --print-browser（v3.31.x，落地审计 E20）：只探测并打印浏览器路径，不做冒烟。
   CI 的「准备浏览器」job 靠它拿到路径，探测清单（CANDIDATES）只在这里维护一份，
   不再与 .github/workflows/ci.yml 手抄第二份。找不到时打印空行并 exit 3（同冒烟口径）。 */
if (process.argv.includes("--print-browser")){
  console.log(browser || "");
  process.exit(browser ? 0 : 3);
}

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
  /* v3.31.6（审计 S-3）：歌词轨在场时的逐帧下界预算——paintLyric 每帧建 states 数组+签名串，
     长句时按字数放大；初值 2ms（实测校准后收紧/放宽）。 */
  lyricFrameMs: 2,
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
    /* ★ S-3（v3.31.6）：歌词轨在场时的逐帧成本——paintLyric 每帧建 states 数组 + 签名串，
       桩测不出（桩 rAF 空函数、无真实字块）。切到示例曲 + 显示歌词再量一遍，量完还原
       页面状态（后续探针依赖各自的初始态）。 */
    let lyricFrameMs = null;
    try{
      const St = window.__beat.Store.S;
      const prev = { mode: St.playMode, sel: St.arrangeSel, show: St.showLyric };
      St.playMode = "arrange";
      St.showLyric = true;
      St.arrangeSel = { id: window.__beat.DEMO_ID, from: 0, to: 99, loop: true, byLyric: false };
      window.__beat.Viz.buildViz();
      window.__beat.Controls.start();
      await new Promise(r => setTimeout(r, 400));
      const t3 = performance.now();
      const NL = 200;
      for (let i = 0; i < NL; i++) window.__beat.Viz.paintFrame();
      lyricFrameMs = (performance.now() - t3) / NL;
      window.__beat.Controls.stop();
      St.playMode = prev.mode; St.showLyric = prev.show; St.arrangeSel = prev.sel;
      window.__beat.Viz.buildViz();
    }catch(e){ lyricFrameMs = null; }
    window.__beat.Controls.stop();
    /* 首屏耗时取自 **Navigation Timing**，不是探针自己的 performance.now()：
       探针要等 CDP 连上才注入，那时页面早启动完了，用探针的时间戳量出来的是
       "CDP 握手耗时"而非首屏。Navigation Timing 由浏览器从**导航开始**记账，
       何时去问都一样，因而可复现。loadMs 只打印不断言（loadEventEnd 在极少数
       时序下可能仍是 0，拿它做闸门会变成假红）。 */
    const nav = (performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null) || {};
    out.perf = { buildVizMs: +buildMs.toFixed(2), paintFrameMs: +frameMs.toFixed(3),
      lyricFrameMs: lyricFrameMs === null ? null : +lyricFrameMs.toFixed(3),
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
  const btn = q("#presetLibBtn"), dr = q("#presetDrawer"), viz = q("#viz");
  out.hasBtn = !!btn; out.hasDrawer = !!dr;
  out.vizInCard = !!(viz && viz.closest(".card"));
  /* v3.3.0：入口与内容分家——入口 = 底栏左区上下文胶囊（#presetLibBtn），
     内容（动作区三行 + 循环小节 + 搜索 + 列表）全在左侧面板里。
     判据随之改成「入口在底栏内 / 内容在面板内」，位置再挪一次也不必重写。 */
  const cap = q("#presetLibBtn"), pb2 = q("#playBar");
  out.ctxInBar = !!(pb2 && cap && pb2.contains(cap));
  out.actionsInDrawer = !!(dr && dr.querySelector("#pdActions") && dr.querySelector("#earBtn"));
  out.loopInDrawer = !!(dr && dr.querySelector("#loopToggle"));
  const card = q(".viz-head-grid") && q(".viz-head-grid").closest(".card");
  out.cardInnerW = card ? round(card.getBoundingClientRect().width - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight)) : null;
  if (!btn || !dr) return JSON.stringify(out);
  /* ① 收起态 */
  out.btn = rect(btn);
  /* ★ v3.12.0：参照物从「同屏行数 + 拍号」并排行换成**可视化带**（#vizBand）——
     那一行已整块退役（行数进设置弹窗、拍号删除）。#vizBand 是"覆盖式不推挤"更直接的
     验收对象：面板压上来时网格与歌词带的绝对位置必须一动不动。 */
  out.rowsClosed = rect(q("#vizBand"));
  out.closedHidden = !!dr.hidden;
  out.ariaClosed = btn.getAttribute("aria-expanded");
  /* ② 点开：v3.3.0 起由**底栏左区胶囊**开合面板（主钮与卡片都已退役） */
  out.maskHiddenClosed = !!(q("#presetMask") && q("#presetMask").hidden);   // v3.3.0：收起态遮罩也须隐藏
  out.viewportH = window.innerHeight;
  out.clientW = document.documentElement.clientWidth;   // ★ fixed 元素按客户区算宽：滚动条会让它比 innerWidth 少 15px
  btn.click();
  out.openHidden = !!dr.hidden;
  out.ariaOpen = btn.getAttribute("aria-expanded");
  out.drawer = rect(dr);
  out.maskOpen = rect(q("#presetMask"));
  out.rowsOpen = rect(q("#vizBand"));   // v3.12.0：同 out.rowsClosed（参照物换成可视化带）
  out.btnOpen = rect(btn);
  out.focusAfterOpen = document.activeElement && document.activeElement.id;   // v3.3.0：焦点进了哪
  /* v3.1.0：卡内容宽补测**展开态**——开抽屉会让页面长出滚动条（macOS/Windows 经典
     滚动条 15px），收起态量的卡宽与展开态量的抽屉宽差出这 15px 是平台现象不是回归；
     宽度断言改用同状态的两次测量（Linux overlay 滚动条两态相等，本口也成立） */
  out.cardInnerOpenW = card ? round(card.getBoundingClientRect().width - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight)) : null;
  out.scrollbarW = window.innerWidth - document.documentElement.clientWidth;   // CI Linux 经典滚动条 20px（抽屉与卡内容宽差的平台现象）
  /* ③ v3.1.0：点条目**不再收起**（选型与看型不分离）——真点一条验证 */
  const firstItem = q("#presetList .preset-item");
  if (firstItem) firstItem.click();
  out.selKeptOpen = !dr.hidden;
  /* ④ v3.3.0：点遮罩关闭——覆盖式面板的必备路径（v3.0.0 判"内联"时省掉的那件成本） */
  const maskEl = q("#presetMask");
  if (maskEl) maskEl.click();
  out.maskClickClosed = !!dr.hidden;
  /* ⑤ 再开一次，用关闭钮收起并检查焦点归还（"从哪来回哪去"） */
  btn.click();
  out.reopened = !dr.hidden;
  q("#presetDrawerClose").click();
  out.reclosed = !!dr.hidden;
  out.focusAfterClose = document.activeElement && document.activeElement.id;
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
  const out = { w: window.innerWidth, h: window.innerHeight };   // v3.3.0：h 供固定底栏「贴底」断言用
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
  /* v3.3.0：底部播放条——fixed 元素的位置/让位在桩里完全测不出（桩无布局引擎），
     故由真实浏览器复核三件事：① 贴住视口底；② 高度符合断点（88 / 76）；
     ③ 不压住底部诊断条（.diag 与它同层且不参与让位，靠 bottom 上移避让）。 */
  out.playBar = (() => {
    const pb = q("#playBar");
    if (!pb) return null;
    const r = pb.getBoundingClientRect();
    const key = q("#playBtn");
    const kr = key && key.getBoundingClientRect();
    const aj = q("#argJump");
    return { top: round(r.top), bottom: round(r.bottom), h: round(r.height),
      inBar: !!(key && pb.contains(key)),
      playBtnTop: kr ? round(kr.top) : null,
      playBtnH: kr ? round(kr.height) : null,
      argJumpH: aj ? round(aj.getBoundingClientRect().height) : null,
      padBottom: round(parseFloat(getComputedStyle(pb).paddingBottom)),
      padTop: round(parseFloat(getComputedStyle(pb).paddingTop)),
      innerH: window.innerHeight };
  })();
  out.mainPadBottom = (() => {
    const mn = q(".main");
    return mn ? round(parseFloat(getComputedStyle(mn).paddingBottom)) : null;
  })();
  /* v3.3.0：底栏右区进度条——范围滑块从曲式区搬到这里（桩测不出落位，只能真机量） */
  /* v3.3.0：参数槽"恒定高度"的真实几何——桩里没有布局引擎，这条只能在真机量。
     量法：全关 → 点开两枚开关 → 全开，两次高度必须相等（这就是"卡片不变形"的定义）。
     ★ 量完立刻点回去复原（探针之间不污染）。 */
  out.tgBody = (() => {
    const body = q(".viz-toggles .tg-body");
    if (!body) return null;
    /* ★ v3.19.0 探针（三列均分 + 开关列流内）：开合只让**开关列**纵向生长——
       音量/BPM 两列 rect 逐像素不动；开关/面板 x 恒定（列内零横移）；
       预备拍行 = 开关 + 拍数输入同行右侧。 */
    const colL = q(".viz-head-grid .card-head-left");
    const colB = q(".viz-head-grid .viz-head > .group");
    /* v3.21.0：不移动承诺 = left/top/width（音量列高度随行高铺开是用户需求，不入此列） */
    const colLR = () => (colL ? JSON.stringify([round(colL.getBoundingClientRect().left), round(colL.getBoundingClientRect().top), round(colL.getBoundingClientRect().width)]) : null);
    const colBR = () => (colB ? JSON.stringify([round(colB.getBoundingClientRect().left), round(colB.getBoundingClientRect().top), round(colB.getBoundingClientRect().width)]) : null);
    const colLH = () => (colL ? round(colL.getBoundingClientRect().height) : null);
    const colBH = () => (colB ? round(colB.getBoundingClientRect().height) : null);
    const wrapEl = q("#countInBeatsWrap"), ct = q("#countInToggle");
    /* ★ v3.22.0：内容级零变形读数——音量第一条滑杆行 / BPM 大数字，在开关列开合前后
       rect 逐像素不动（用户验收点"打开变速训练没必要变形"的正体；盒子高度随行变化
       不算变形——组盒透明无边框）。 */
    const volRows = document.querySelectorAll(".viz-head-grid .vol-row");
    const vol1 = volRows[1], bpmNum = q(".viz-head-grid .bpm-num");   /* 量中间行：space-between 重分布时中行位移最大（首行被顶对齐钉住） */
    const vol1R = () => (vol1 ? JSON.stringify([round(vol1.getBoundingClientRect().left), round(vol1.getBoundingClientRect().top)]) : null);
    const bpmR = () => (bpmNum ? JSON.stringify([round(bpmNum.getBoundingClientRect().left), round(bpmNum.getBoundingClientRect().top)]) : null);
    const wrapRow = () => { if (!wrapEl || !ct) return null;
      const a = ct.getBoundingClientRect(), b = wrapEl.getBoundingClientRect();
      const cyOK = Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) <= 2;   /* 垂直中轴对齐（align-items:center） */
      return JSON.stringify([cyOK, round(b.left) > round(a.right - 4)]); };
    /* v3.16.0：面板收容口径放宽到**卡片底缘**——预留 50px 是记账线，真正的视觉边界
       是卡片底（预留 50 + 卡片内边距 24 = 行下 74px）；两行化后最满内容允许用内边距
       的空白（用户确认过：预留空间足够，不需要调高度）。 */
    const cardEl = q(".viz-head-grid") && q(".viz-head-grid").closest(".card");
    const cardBottom = () => (cardEl ? round(cardEl.getBoundingClientRect().bottom) : null);
    const h = () => round(body.getBoundingClientRect().height);
    const slotEl = q("#tgSlot");
    const mt = q("#muteToggle"), tt = q("#trainerToggle");
    /* v3.13.0：零横移的验收读数 = 两枚开关的盒左缘（x）在四种开合组合下逐像素相同——
       这才是"元素不挪窝"的本体（旧口径量 #countInToggle 的 top，而它 v3.12.0 已搬进
       底栏、与本块开合完全无关，四态恒等是橡皮图章）。 */
    const mx = () => (mt ? round(mt.getBoundingClientRect().left) : null);
    const tx = () => (tt ? round(tt.getBoundingClientRect().left) : null);
    /* v3.13.0：桌面档零跳动承重墙 = .tg-body 的 padding-bottom 56px（通栏悬浮槽的常驻
       预留，实测最满面板 43px + 30% 余量）；窄屏档仍是流内网格（第二轨 76px）。
       两种口径都读出，断言按档分派。 */
    const pad = () => round(parseFloat(getComputedStyle(body).paddingBottom));
    const row2 = () => { const t = getComputedStyle(body).gridTemplateRows.split(" ");
      return round(parseFloat(t[1]) || 0); };
    const rowEl = q(".viz-toggles .tg-row");
    const rowCx = () => { const r = rowEl && rowEl.getBoundingClientRect();
      return r ? round(r.left + r.width / 2) : null; };
    const ctxEl = q(".pb-ctx");
    const ctxL = ctxEl ? round(ctxEl.getBoundingClientRect().left) : null;
    const closed = h(), mxC = mx(), txC = tx(), colLC = colLR(), colBC = colBR(), rowWC = wrapRow();
    const vol1C = vol1R(), bpmC = bpmR();
    const volHC = colLH(), bpmHC = colBH();
    const cardHC = (() => { const c = cardEl || (q(".viz-head-grid") && q(".viz-head-grid").closest(".card")); return c ? round(c.getBoundingClientRect().height) : null; })();
    if (mt) mt.click();
    const muteOnly = h(), mxM = mx(), txM = tx(), colLM = colLR(), colBM = colBR(), rowWM = wrapRow();
    const vol1M = vol1R(), bpmM = bpmR();
    const cardHM = (() => { const c = cardEl || (q(".viz-head-grid") && q(".viz-head-grid").closest(".card")); return c ? round(c.getBoundingClientRect().height) : null; })();
    /* 悬浮面板收容：打开的面板底缘不得越过 .tg-body 底缘（56px 预留装得下最满面板） */
    const mp = q("#muteCfgPanel");
    const muteBottom = (mp && !mp.hidden) ? round(mp.getBoundingClientRect().bottom) : null;
    const bodyBottomM = round(body.getBoundingClientRect().bottom);
    const cardBottomM = cardBottom();
    const slotCxM = (() => { const r = slotEl && slotEl.getBoundingClientRect();
      return r ? round(r.left + r.width / 2) : null; })();
    /* ★ 点变速训练开关前必须**先填目标**：目标为空时应用按"空目标拒开"弹模态框，
       而模态会抢走焦点并留在页面上，把后续探针（抽屉焦点断言）一起带崩。
       这正是本轮实测踩到的：一条探针的副作用污染了下一条不相关的断言。 */
    const tgt = q("#trTarget");
    const tgtBak = tgt ? tgt.value : null;
    /* ★ 光改 value 不够：应用的"空目标拒开"读的是 **S.trainer.target**，
       而它由目标输入的 input/change 事件写入——必须走完两级事件，否则照样弹模态。 */
    if (tgt){
      tgt.value = "240";
      tgt.dispatchEvent(new Event("input", { bubbles: true }));
      tgt.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (tt) tt.click();
    const both = h(), mxB = mx(), txB = tx(), colLB = colLR(), colBB = colBR(), rowWB = wrapRow();
    const vol1B = vol1R(), bpmB = bpmR();
    const cardHB = (() => { const c = cardEl || (q(".viz-head-grid") && q(".viz-head-grid").closest(".card")); return c ? round(c.getBoundingClientRect().height) : null; })();
    const tp = q("#trainerPanel");
    const trainerBottom = (tp && !tp.hidden) ? round(tp.getBoundingClientRect().bottom) : null;
    const bodyBottomB = round(body.getBoundingClientRect().bottom);
    const cardBottomB = cardBottom();
    if (tt) tt.click();      // trainer 关
    if (tgt && tgtBak !== null) tgt.value = tgtBak;
    if (mt) mt.click();      // mute 关 → 复原
    const cardHR = (() => { const c = cardEl || (q(".viz-head-grid") && q(".viz-head-grid").closest(".card")); return c ? round(c.getBoundingClientRect().height) : null; })();
    return { closed: closed, muteOnly: muteOnly, both: both, restored: h(),
      cardHC: cardHC, cardHM: cardHM, cardHB: cardHB, cardHR: cardHR,
      ctxL: ctxL, colLC: colLC, colLM: colLM, colLB: colLB,
      colBC: colBC, colBM: colBM, colBB: colBB,
      volHC: volHC, bpmHC: bpmHC,
      vol1C: vol1C, vol1M: vol1M, vol1B: vol1B,
      bpmC: bpmC, bpmM: bpmM, bpmB: bpmB,
      rowWC: rowWC, rowWM: rowWM, rowWB: rowWB,
      mxC: mxC, mxM: mxM, mxB: mxB, mxR: mx(),
      txC: txC, txM: txM, txB: txB, txR: tx(),
      muteBottom: muteBottom, trainerBottom: trainerBottom };
  })();
  out.pbProgress = (() => {
    const host = q("#pbProgress"), bar = q("#playBar");
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const wrap = host.querySelector(".demo-range");
    const head = host.querySelector(".demo-range-head");
    const fromEl = host.querySelector(".demo-range-from");
    /* v3.13.0：进度条宽度**不敏感**扫描——预备拍开合（拍数输入显形，实测 −64px）与
       状态文案跳变（每十六分更新，长文案实测 −134px）都不得改变进度条宽度。
       两行化解耦（进度条独占行 1）的验收点；量完立刻复原，探针之间不污染。 */
    const w = () => round(host.getBoundingClientRect().width);
    const wBase = w();
    const cnt = q("#countInToggle"), st = q("#statusText");
    let wCnt = null, wLong = null;
    if (cnt){ cnt.click(); wCnt = w(); }
    if (st){ const bak = st.textContent; st.textContent = "静音拍 · 第 44 小节 · 心中默数";
      wLong = w(); st.textContent = bak; }
    if (cnt) cnt.click();      // 复原
    /* 行序：进度条（行 1）在 .pb-sub（行 2 = 预备拍+状态）之上 */
    const sub = q(".pb-sub");
    const statusBelow = sub ? round(sub.getBoundingClientRect().top) > round(r.top) : null;
    return { w: round(r.width), inBar: !!(bar && bar.contains(host)), hasRange: !!wrap,
      hasHead: !!head, hasFrom: !!fromEl,
      wBase: wBase, wCnt: wCnt, wLong: wLong, statusBelow: statusBelow };
  })();
  /* v3.3.1：播放键的**水平居中**与"离底距离"——两条都是用户直接看到的观感，只能在真机量。
     居中那条是本轮的实际故障：flex space-between 下左右两段宽差把中列挤偏。 */
  out.center = (() => {
    const key = q("#playBtn"), bar = q("#playBar");
    if (!key || !bar) return null;
    const kr = key.getBoundingClientRect();
    /* ★ 居中的参照必须是**客户区**（clientWidth）不是 innerWidth：底栏是 fixed，
       它的包含块就是客户区宽度；页面出现纵向滚动条时两者差 15px，用 innerWidth 判会误报偏心 7.5px。 */
    /* ★ v3.26.0：底栏内容列 = 卡片内容列（1000 居中列）——居中参照改量
       #argJump（开关+主参数行的中列容器）中心 vs **内容列中心**（barPadL 与
       barPadR 相等时 = 客户区中心；loop 按钮在 argJump 内右侧，量 argJump 整体）。 */
    const jr = q("#argJump") ? q("#argJump").getBoundingClientRect() : null;
    const bl = round(parseFloat(getComputedStyle(bar).paddingLeft));
    const br = round(parseFloat(getComputedStyle(bar).paddingRight));
    const contentCenter = round(bl + (bar.clientWidth - bl - br) / 2);
    const jumpCenter = jr ? round(jr.left + jr.width / 2) : null;
    return { keyCenter: round(kr.left + kr.width / 2),
      vpCenter: round(document.documentElement.clientWidth / 2),
      jumpCenter: jumpCenter, contentCenter: contentCenter,
      gapBottom: round(window.innerHeight - kr.bottom) };
  })();
  /* ★ v3.12.0：底栏右区（#pb-right）的实高 vs 底栏**内容区**实高——
     右列一旦比内容区高，网格行被撑大 → 中列的播放键随之被推低、贴到底栏下沿
     （v3.12.0 预备拍搬入后真机实测距底 9px）。这条把"右列不得顶穿"变成可断言的几何。 */
  out.barContentH = (() => {
    const bar = q("#playBar");
    if (!bar) return null;
    const cs = getComputedStyle(bar);
    return round(bar.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  })();
  out.pbRightH = (() => {
    const r = q(".pb-right");
    return r ? round(r.getBoundingClientRect().height) : null;
  })();
  /* ★★★ v3.31.0（用户报障）两组真机断言的数据源：
     ① 跑道特效——「已弹格填充」与「扫弦记号码色」必须**不同色**（同色即记号被抹平：
        经典主题白底白记号、观测台墨底墨记号，两个主题都中过招）。停机态没有 played 格子，
        故临时挂一个 .cell.played 探针读出 ::before 的解析值（走同一条级联），量完移除。
     ② 宽屏铺满——歌词轨的 inline 宽度由 JS 写死、不会随 #viz 自己更新，切换必须重排。
        真机点一次开关，量 #viz 与 #lyricLane 的宽度是否一致（并读歌词字号），量完切回。 */
  out.laneAndWide = (() => {
    const viz = q("#viz");
    if (!viz) return null;
    const res = {};
    const lumOf = (c) => { const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c || ""); return m ? Math.round(0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) : null; };
    /* ① 填充 vs 记号 */
    const probe = document.createElement("div");
    probe.className = "cell played";
    viz.appendChild(probe);
    res.cellFill = getComputedStyle(probe, "::before").backgroundColor;
    viz.removeChild(probe);
    const strum = q("#viz .strumv");
    res.strumInk = strum ? getComputedStyle(strum, "::before").backgroundColor : null;
    res.strumHeadInk = strum ? getComputedStyle(strum, "::after").borderBottomColor : null;
    res.fillL = lumOf(res.cellFill); res.inkL = lumOf(res.strumInk);
    /* ★ 宽屏铺满那半**不在这里量**：本探针的视口是 1440，而主列 max-width 本就 1440——
       铺满开关在该视口下不改变 #viz 宽，硬写就是空转的假绿。它由 wideFullProbe()
       在 1920 视口单独量（见 result.wideFull）。 */
    return res;
  })();
  /* ★★★ v3.30.0（用户拍板）：底栏内容缘 = **跑道/歌词行盒缘**（= .main 内容缘）。
     参照物由用户以截图红线亲手钉死（红线纵贯「音量条左边的卡片空白 → 跑道/歌词行 → 底栏」）——
     本轮把它变成可断言的几何：左块左缘 = #viz 左缘、右块右缘 = #viz 右缘、
     两块等宽（--pb-side-w）。旧口径（v3.28 "= 音量列左缘"）整体退役：那是**卡片控制
     网格缘**，与跑道缘在 1440 下相差 188.5px（212.5 vs 24）——正是用户反复说
     "没对齐"的根源。 */
  out.pbAlign = (() => {
    const viz = q("#viz"), ctx = q(".pb-ctx"), right = q(".pb-right"), lyric = q("#lyricLane");
    if (!viz || !ctx || !right) return null;
    const v = viz.getBoundingClientRect(), c = ctx.getBoundingClientRect(), r = right.getBoundingClientRect();
    /* 歌词行若在场，一并读它的缘（用户明确说"跟跑道和歌词行对齐"——两者同宽同起点，
       读它是为了在歌词行缺席时也能解释差异，不是另立一套基准） */
    const l = lyric ? lyric.getBoundingClientRect() : null;
    /* ★★★ v3.30.1（用户需求）：**进度条轨道的中线 = 胶囊中线 = 播放键中心**——
       三者同线这条只能在真机量（桩无布局引擎）。读的必须是**轨道**中心（.demo-range-track），
       不是右块中心：右块是两行纵排，整块居中时轨道天然高出 11.5px，那正是本轮的病灶。 */
    const track = q(".demo-range-track"), key = q("#playBtn"), bar = q("#playBar");
    const t = track ? track.getBoundingClientRect() : null;
    const k = key ? key.getBoundingClientRect() : null;
    /* 栏内容区底缘（栏底 − 下内边距）——用来确认右块下移后仍收在栏内 */
    const bc = bar ? (() => { const b = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
      return b.bottom - parseFloat(cs.paddingBottom); })() : null;
    return { vizL: round(v.left), vizR: round(v.right),
      lyricL: l ? round(l.left) : null, lyricR: l ? round(l.right) : null,
      ctxL: round(c.left), ctxW: round(c.width),
      rightR: round(r.right), rightW: round(r.width),
      ctxC: round(c.top + c.height / 2), trackC: t ? round(t.top + t.height / 2) : null,
      keyC: k ? round(k.top + k.height / 2) : null,
      rightBot: round(r.bottom), barInnerBot: bc === null ? null : round(bc) };
  })();
  /* ★ v3.17.0：底栏内部**零视口溢出**计数（390 窄屏右列曾被压到 6px、进度条
     min-width 96 溢出视口 66px 被裁——这条把"任何底栏子元素不得超出视口"钉死） */
  out.barOverflow = (() => {
    const bar = q("#playBar");
    if (!bar) return null;
    let n = 0;
    bar.querySelectorAll("*").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) n++;
    });
    return n;
  })();
  /* v3.3.1：同屏行数 = 1 时，可视化带是否在"控制卡之下、底栏之上"的剩余空间里**居中**
     （量上下两段留白，而不是量绝对位置——跟着内容高度变化的断言迟早会漂） */
  out.vizCenter = (() => {
    const rows = q("#vizRowsRow"), band = q("#vizBand"), bar = q("#playBar");
    const card = q(".viz-head-grid") && q(".viz-head-grid").closest(".card");
    if (!rows || !band || !card || !bar) return null;
    const pill = [...rows.children].find(b => (b.textContent || "").trim() === "1");
    if (!pill) return null;
    const wasActive = rows.querySelector(".pill.active");
    pill.click();
    const br = band.getBoundingClientRect();
    const topGap = round(br.top - card.getBoundingClientRect().bottom);
    const botGap = round(bar.getBoundingClientRect().top - br.bottom);
    if (wasActive) wasActive.click();          // 复原行数档位（探针之间不污染）
    return { topGap: topGap, botGap: botGap };
  })();
  out.diagBottom = (() => {
    const dg = q(".diag");
    return dg ? round(parseFloat(getComputedStyle(dg).bottom)) : null;
  })();
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
  /* ★ v3.12.0：「同屏行数 + 拍号」并排行整块退役——
     行数档位搬进**设置弹窗**（隐藏态，无几何可言）；拍号控件直接删除。
     故几何字段全部退役，改钉**结构事实**（槽位归属与存在性），防"搬一半"：
       · rowsHome  = 行数档位现在住在哪个容器（应为设置浮层）
       · sigExists = 拍号控件是否还在（应为 false）
       · countInInBar = 预备拍开关是否在底栏内（应为 true） */
  out.rowsHome = (() => {
    const r = q("#vizRowsRow");
    if (!r) return "missing";
    if (q("#settingsOverlay") && q("#settingsOverlay").contains(r)) return "settings";
    if (q(".viz-head-grid") && q(".viz-head-grid").contains(r)) return "head-grid";
    return "elsewhere";
  })();
  out.sigExists = !!q("#sigRow") || !!q("#accGroup") || !!q("#fallbackNote");
  /* ★ v3.15.0：预备拍搬回控制卡片开关行——判据改为"在 .viz-head-grid 内"（字段名
     countInInBar 保留以免牵动断言编号，语义 = 在卡片开关行；底栏路径同步查反）。 */
  out.countInInCard = (() => {
    const c = q("#countInToggle"), bar = q("#playBar"), grid = q(".viz-head-grid");
    return !!(c && grid && grid.contains(c) && !(bar && bar.contains(c)));
  })();
  out.countInWrapInCard = (() => {
    const c = q("#countInBeatsWrap"), bar = q("#playBar"), grid = q(".viz-head-grid");
    return !!(c && grid && grid.contains(c) && !(bar && bar.contains(c)));
  })();

  /* v3.3.0：四块的完整矩形（诊断 + 等宽等距断言的数据源）——
     第 4 轨换人后，"行数块在开关右侧"这类断言靠它才看得出真实落位。
     v3.12.0：第 4 块（行数拍号行）退役 → 剩三块；数组保留第 4 位为 null 以便
     "不得再有第 4 块"能被断言正面表达。 */
  out.blockRects = [q(".card-head-left"), q(".viz-head > .group"), q(".viz-toggles"), q(".viz-rows-row")]
    .map(el => { const r = el && el.getBoundingClientRect(); return r ? { l: round(r.left), w: round(r.width) } : null; });
  /* v3.13.0（丁方案）：控制区**限宽 1000 居中 + 两列 1fr** 的几何读数——
     gridW ≤ 1000；两块等宽（1fr）；网格盒在卡片内容区内水平居中（两侧空白对称）。
     空白 = (容器−1000)/2，随窗口变大是**设计内**行为（恒定的是"盒宽"与"对称性"）。
     ★ v3.30.0：卡片盒收窄到 1048（抱控制区）后，"容器"不再是跑道宽，而是卡片内容区
     （1048−48=1000）——两侧空白恒 0，blankL/blankR 随之失去区分度，但断言仍成立。 */
  out.row1 = (() => {
    const g = q(".viz-head-grid"), card = q(".viz-head-grid") && q(".viz-head-grid").closest(".card");
    const left = q(".card-head-left"), bpm = q(".viz-head > .group");
    if (!g || !card || !left || !bpm) return null;
    const gr = g.getBoundingClientRect(), cr = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const innerL = round(cr.left + parseFloat(cs.paddingLeft));
    const innerR = round(cr.right - parseFloat(cs.paddingRight));
    const lr = left.getBoundingClientRect(), br = bpm.getBoundingClientRect();
    return { w: round(gr.width), leftW: round(lr.width), bpmW: round(br.width),
      cardW: round(cr.width), cardL: round(cr.left), cardR: round(cr.right),
      blankL: round(gr.left - innerL), blankR: round(innerR - gr.right) };
  })();
  /* v3.9.0：行 2 同轴居中断言的数据源——开关参数块中心相对头部栅格中心的偏移（0 = 同轴） */
  out.togCenterOffset = (() => {
    const t = q(".viz-toggles"), g = q(".viz-head-grid");
    if (!t || !g) return null;
    const tr = t.getBoundingClientRect(), gr = g.getBoundingClientRect();
    return round((tr.left + tr.width / 2) - (gr.left + gr.width / 2));
  })();
  /* v3.12.0：#sigRow 已删除（手动拍号控件退役）→ sig 恒 null、sigGroup 恒 null；
     保留该字段以便"拍号控件不得复活"能被正面断言。timbreRow 仍在（音色未动）。
     ★ 本段住在**模板字符串**内：注释里不许出现反引号（会把模板串提前闭合）。 */
  const sig = q("#sigRow"), timbre = q("#timbreRow"), vol = q(".vol-row");
  out.sigGroup = sig ? boxLeft(sig.parentElement) : null;
  out.timbreGroup = timbre ? boxLeft(timbre.parentElement) : null;
  out.volGroup = vol ? boxLeft(vol.parentElement) : null;
  out.editBtn = boxLeft(q("#editBtn"));
  /* v2.42.7：组容器卡宽度（窄屏等宽回归断言的数据源）
     v3.3.0：**四块**——预设库块退役，「同屏行数与拍号」接替第 4 轨（不再是横跨整行的 r2） */
  out.grpWidths = (() => {
    const els = [q(".card-head-left"), q(".viz-head > .group"), q(".viz-toggles"), q(".viz-rows-row")];
    return els.map(el => { const r = el && el.getBoundingClientRect(); return r ? round(r.width) : null; });
  })();
  /* v2.42.7 追加：相邻组容器卡的垂直间隙（等距回归断言的数据源——三处来源曾各给各的：
     row-gap 6/12 / head margin-bottom 16 / toggles margin-bottom 16） */
  out.grpGaps = (() => {
    const els = [q(".card-head-left"), q(".viz-head > .group"), q(".viz-toggles"), q(".viz-rows-row")];
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
/* ★★★ v3.31.0：宽屏铺满专用探针——**必须 >1440 才有意义**。
   主列 `max-width:1440` 在 1440 视口下已把 #viz 钉在 1392，铺满开关不改变它的宽，
   在桌面趟里量等于空转的假绿（首版就这么写的，跑出来"前提：切换确实改变了 #viz 宽"直接红，
   反倒暴露了问题）。用户报障的场景正是宽屏，故单独切到 1920 量：切换前后 #viz 宽、
   歌词轨宽（JS 写的 inline 值）、歌词字号与字块高。 */
function wideFullProbe(){
  return `(async function(){
    var q = s => document.querySelector(s);
    var rd = n => Math.round(n);
    var viz = q("#viz"), lane = q("#lyricLane"), tog = q("#wideToggle");
    if (!viz || !lane || !tog) return JSON.stringify({ err: "缺元素" });
    var w = el => rd(el.getBoundingClientRect().width);
    /* ★ 必须等两帧：--cs（字号缩放因子）由 #viz 上的 **ResizeObserver 异步**写入，
       点完开关在同一 tick 读 getComputedStyle 拿到的是**旧字号**——
       首版就是这么写的，于是"字号 ≤ 字块高"这条空转变绿（M3 变异实证：撤销上限后它仍是绿的）。 */
    var frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    var res = { vw: window.innerWidth };
    var wasOn = document.body.classList.contains("wide-full");
    res.wasOn = wasOn;
    res.beforeViz = w(viz); res.beforeLane = w(lane);
    res.beforeFs = (() => { var c = lane.querySelector(".lyric-char"); return c ? Math.round(parseFloat(getComputedStyle(c).fontSize) * 10) / 10 : null; })();
    tog.click();
    await frame();
    res.on = document.body.classList.contains("wide-full");
    res.afterViz = w(viz); res.afterLane = w(lane);
    var ch = lane.querySelector(".lyric-char"), cp = lane.querySelector(".lyric-chip");
    res.charFs = ch ? Math.round(parseFloat(getComputedStyle(ch).fontSize) * 10) / 10 : null;
    res.chipH = cp ? rd(cp.getBoundingClientRect().height) : null;
    tog.click();
    await frame();
    res.restored = (document.body.classList.contains("wide-full") === wasOn);
    res.backViz = w(viz); res.backLane = w(lane);
    return JSON.stringify(res);
  })()`;
}
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
      /* ★★★ v3.31.0：宽屏铺满必须在 >1440 的视口量（1440 下主列封顶，开关不改变 #viz） */
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      /* 探针是 async（要等 ResizeObserver 写 --cs），故用 awaitPromise */
      const wfRaw = await cdp.send("Runtime.evaluate",
        { expression: wideFullProbe(), awaitPromise: true, returnByValue: true });
      const wideFull = JSON.parse(wfRaw.result.value);
      /* ★★★ v3.31.3：格子四档亮度分离度（与视口无关，在 1920 顺带量） */
      const lvRaw = await cdp.send("Runtime.evaluate",
        { expression: cellLevelsProbe(), returnByValue: true });
      result.cellLevels = JSON.parse(lvRaw.result.value);
      /* v3.31.x（落地审计 P0-1）：children 形状哨兵——真机 children 是 HTMLCollection、
         没有数组方法，而测试桩把它实现成数组；产品代码一旦直接调 .find/.map 之类，
         桩里恒绿、真机必抛。这条把「桩与真机的分叉」钉成一条会红的断言。 */
      const csRaw = await cdp.send("Runtime.evaluate",
        { expression: childrenShapeProbe(), returnByValue: true });
      result.childrenShape = JSON.parse(csRaw.result.value);
      /* ★★★ v3.31.1：连续滚动的静止态落位（与视口无关，在 1920 顺带量） */
      const srRaw = await cdp.send("Runtime.evaluate",
        { expression: scrollRestProbe(), awaitPromise: true, returnByValue: true });
      const scrollRest = JSON.parse(srRaw.result.value);
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await sleep(150);
      result.layout = { wide, narrow };
      result.wideFull = wideFull;
      result.scrollRest = scrollRest;
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

/* ★★★ v3.31.1：**连续滚动的静止态落位探针**（用户报障「切换连续滚动模式后歌词错位，按播放又恢复正常」）。
   量法：走真实 UI 路径切到滚动 → 等两帧（等重排与静止态落位跑完）→ 逐个比对
   「歌词行中心 x」与「同索引网格行中心 x」。停机态下两者必须一致
   （静止态 = 当前行右移半行宽、上一行冻结在左半屏）；播放中才由帧循环按 scrollDx 接管。
   修前实测：网格行在 24 / 1416，而歌词行停在视口正中 720（差 696px）。 */
function scrollRestProbe(){
  return `(async function(){
    var q = s => document.querySelector(s);
    var viz = q("#viz"), lane = q("#lyricLane"), tog = q("#scrollModeToggle");
    if (!viz || !lane || !tog) return JSON.stringify({ err: "缺元素" });
    var frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    var wasOn = viz.classList.contains("scroll-mode");
    if (!wasOn){ tog.click(); await frame(); await new Promise(r => setTimeout(r, 300)); }
    var g = Array.from(viz.querySelectorAll(".bar-row")).map(function(e){
      var b = e.getBoundingClientRect(); return Math.round(b.left + b.width / 2); });
    var l = Array.from(lane.querySelectorAll(".lyric-row")).map(function(e){
      var b = e.getBoundingClientRect(); return Math.round(b.left + b.width / 2); });
    var pairs = [];
    for (var i = 0; i < Math.min(g.length, l.length); i++){
      if (g[i] > 1 && l[i] > 1) pairs.push({ i: i, grid: g[i], lyric: l[i], dx: l[i] - g[i] });
    }
    if (!wasOn){ tog.click(); await frame(); }
    return JSON.stringify({ wasOn: wasOn, gridN: g.length, lyricN: l.length, pairs: pairs });
  })()`;
}
/* ★★★ v3.31.3：**格子四档亮度分离度探针**（用户报障「正在弹的实扫格背景变得和空扫格一样」）。
   做法：离屏合成五种格子状态（未弹/已弹/正在弹·实扫 + 空扫·未弹/正在弹），
   用 `getComputedStyle` 读「格底」与「填充层(::before)」两层颜色，再用**页内 canvas**
   把它们按序叠在主题底色 `var(--bg)` 上 —— 让**浏览器自己合成**，取最终 RGB 算亮度。
   ★ 为什么用 canvas 而不是截图采样：① smoke 端没有 PNG 解码器；
     ② 首版是把格子浮在页面上截图采样，而**透明格会透出背后的 app 内容**，
     把休止格读成了纯绿（假的）——canvas 合成从根上避开这类污染。
   判据：正在弹·实扫 与 空扫/休止 的亮度差必须够大（修前实测仅 −1.2＝无法区分）。 */
/* v3.31.x（落地审计 P0-1）：children 形状哨兵——真机 HTMLCollection 没有数组方法，
   测试桩是数组。探针在页内造一个真元素读它 children 的形状，断言放在桌面趟。 */
function childrenShapeProbe(){
  return `(function(){
    var el = document.createElement("div");
    el.appendChild(document.createElement("button"));
    var c = el.children;
    return JSON.stringify({
      isArray: Array.isArray(c),
      hasFind: typeof c.find === "function",
      hasItem: typeof c.item === "function",
      length: c.length
    });
  })()`;
}

function cellLevelsProbe(){
  return `(function(){
    function lum(r,g,b){ return 0.299*r + 0.587*g + 0.114*b; }
    function parse(c){
      var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([0-9.]+))?\\)/.exec(c || "");
      if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      m = /color\\(srgb ([0-9.]+) ([0-9.]+) ([0-9.]+)(?: \\/ ([0-9.]+))?\\)/.exec(c || "");
      if (m) return [Math.round(+m[1]*255), Math.round(+m[2]*255), Math.round(+m[3]*255), m[4] === undefined ? 1 : +m[4]];
      return null;
    }
    var host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(host);
    var cv = document.createElement("canvas"); cv.width = 1; cv.height = 1;
    var ctx = cv.getContext("2d");
    var bg = parse(getComputedStyle(document.body).backgroundColor) || [18,18,18,1];
    function measure(cls){
      var d = document.createElement("div");
      d.className = cls; d.style.width = "40px"; d.style.height = "20px";
      d.style.setProperty("--f", /upcoming/.test(cls) ? "0" : "1");
      host.appendChild(d);
      var cell = parse(getComputedStyle(d).backgroundColor);
      var fillRaw = getComputedStyle(d, "::before").backgroundColor;   // 必须在移除前读（移除后恒为空串）
      var fill = parse(fillRaw);
      ctx.clearRect(0,0,1,1);
      [bg, cell, fill].forEach(function(c){ if (c){ ctx.fillStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + ")"; ctx.fillRect(0,0,1,1); } });
      var px = ctx.getImageData(0,0,1,1).data;
      host.removeChild(d);
      return { rgb:[px[0],px[1],px[2]], lum: Math.round(lum(px[0],px[1],px[2]) * 10) / 10,
               cell: cell, fill: fill, fillRaw: fillRaw };
    }
    var out = {
      upSolid:      measure("cell upcoming"),
      playedSolid:  measure("cell played"),
      activeSolid:  measure("cell active"),
      restUp:       measure("cell rest upcoming"),
      restActive:   measure("cell rest active")
    };
    host.remove();
    out.fillRawOfActive = out.activeSolid.fillRaw;
    return JSON.stringify(out);
  })()`;
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
          /* ★ v3.3.1（用户澄清后的新形态）：控制行拆成两行 ——
               第一行 = 音量 ｜ BPM ｜（v3.12.0 前是「同屏行数与拍号」，现已退役）；
               第二行 = 开关 + 参数槽（跨满全宽）。
             ★ v3.12.0：原三条里与"行数拍号块"有关的两条（pill 盒子在标签右侧 /
               行数块在第一行右侧）随该块退役删除，替换为**槽位归属**断言：
               行数档位住在设置弹窗、拍号控件确认不存在。 */
          /* ★★ v3.19.0：三列均分后"开关块独占一行/同轴居中"两断言退役——
             开关列 = 第 3 列与音量/BPM 同排（同排/等宽/顶对齐由 layoutProbe 的
             三列断言钉死，见 tgBody 段 colLC/colBC 与 gridCols 检查）。 */
          ok(m.rowsHome === "settings",
            p.label + "·" + label + "：★★ 同屏行数档位住在**设置弹窗**（v3.12.0 搬移，且不在控制行里）",
            "归属 " + m.rowsHome);
          ok(m.sigExists === false,
            p.label + "·" + label + "：★★ 拍号控件确已删除（#sigRow / #accGroup / #fallbackNote 均不存在）",
            "sigExists=" + m.sigExists);
          ok(m.countInInCard === true && m.countInWrapInCard === true,
            p.label + "·" + label + "：★★ 预备拍开关与拍数输入都在**控制卡片开关行/悬浮槽**内（v3.15.0 搬回）",
            "toggle=" + m.countInInCard + " wrap=" + m.countInWrapInCard);
        } else {
          ok(sameLine(m.toggle, base),
            p.label + "·" + label + "：窄屏回退左贴——开关行与标题同一条左边缘",
            "标题 " + base + " vs 开关 " + m.toggle);
          ok(m.rowsHome === "settings",
            p.label + "·" + label + "：★ 窄屏下同屏行数同样只住设置弹窗（搬移与断点无关）",
            "归属 " + m.rowsHome);
        }
      }
      if (lay.wide){
        /* v2.38.0：居中分布下行数/拍号可能同行也可能堆叠（宽度由内容与居中算法决定），
           旧「拍号在右」左贴断言退役；改为验证两块都在卡片内容区内且不超界。
           ★ v3.12.0：两块均不在控制行了 → 改为"控制行恰三块、第 4 轨确已空出" +
           行数档位住在设置弹窗（防"搬了一半、旧槽位还留着"）。 */
        const br = lay.wide.blockRects || [];
        ok(!!br[0] && !!br[1] && !!br[2] && !br[3],
          p.label + "：★★ 控制行恰**三块**（音量｜BPM｜开关），第 4 块（行数拍号行）确已退役",
          "块矩形 " + JSON.stringify(br));
        ok(lay.wide.rowsHome === "settings",
          p.label + "：★★ 同屏行数档位在设置弹窗内（且不在控制行），拍号控件已删除",
          "归属 " + lay.wide.rowsHome + " · sigGroup=" + lay.wide.sigGroup);
        ok(sameLine(lay.wide.volGroup, lay.wide.title),
          p.label + "：★★ 音量组在标题正下方（卡片头左列，左缘 = 卡片内容边缘）（v2.10.15）",
          "标题 " + lay.wide.title + " vs 音量组 " + lay.wide.volGroup);
        /* ★★ v3.13.0（丁方案）：控制区限宽 1000 居中 + 两列 1fr——
           盒宽 ≤1000、两块等宽、两侧空白对称（空白 =(容器−1000)/2，随窗口变大是设计内行为，
           钉的是"盒宽"与"对称性"两个不变量，不是具体像素）。 */
        if (lay.wide.row1){
          ok(lay.wide.row1.w <= 1001,
            p.label + "：★★ 控制区限宽 1000px（.viz-head-grid max-width，恒定紧凑不随窗口稀释）",
            "盒宽 " + lay.wide.row1.w);
          ok(Math.abs(lay.wide.row1.leftW - lay.wide.row1.bpmW) <= 2,
            p.label + "：★★ 行 1 两列 1fr 等宽（音量 ≈ BPM，1fr 拉满吃掉固定内容宽差）",
            "音量 " + lay.wide.row1.leftW + " vs BPM " + lay.wide.row1.bpmW);
          if (lay.wide.row1.blankL !== null && lay.wide.row1.blankR !== null){
            ok(Math.abs(lay.wide.row1.blankL - lay.wide.row1.blankR) <= 2,
              p.label + "：★ 控制区两侧空白对称（限宽盒在卡片内居中）",
              "左 " + lay.wide.row1.blankL + " vs 右 " + lay.wide.row1.blankR);
          }
        } else {
          ok(false, p.label + "：行 1 几何未取到（丁方案断言未验证）", "");
        }
      } else {
        ok(false, p.label + "：桌面布局未取到（需求①②的相对位置本项未验证）", "");
      }
      /* v3.3.0：底部播放条（#playBar）——fixed 元素的位置与让位是**桩里完全测不出**的那部分
         （桩无布局引擎）。三条一起验：贴底、高度符合断点、主列已让位；诊断条存在时才验避让。 */
      /* v3.3.1：底栏抬高到 96（全档统一），内容随之上移，播放键不再贴底 */
      [[lay.wide, "桌面", 96], [lay.narrow, "窄屏390", 96]].forEach(function(pair){
        const L = pair[0], vp = pair[1], want = pair[2];
        if (!L) return;
        if (!L.playBar){
          ok(false, p.label + "·" + vp + "：底栏 #playBar 未取到（搬块未生效？）", "");
          return;
        }
        ok(Math.abs(L.playBar.h - want) <= 1,
          p.label + "·" + vp + "：★ 底栏高度 " + want + "px（var(--bar-h)，全档统一）",
          "实测 " + L.playBar.h);
        ok(Math.abs(L.playBar.bottom - L.h) <= 1,
          p.label + "·" + vp + "：★★ 底栏贴住视口底（fixed bottom:0，不随滚动跑）",
          "bottom " + L.playBar.bottom + " vs 视口高 " + L.h);
        ok(L.playBar.inBar === true,
          p.label + "·" + vp + "：★ 播放键在底栏内（搬块完整、无半搬状态）", "");
        ok(L.mainPadBottom !== null && L.mainPadBottom >= want,
          p.label + "·" + vp + "：★★ 主列已让位（padding-bottom ≥ 底栏高，否则最后一小节被压住）",
          "padding " + L.mainPadBottom + " vs " + want);
        if (L.diagBottom !== null){
          ok(L.diagBottom >= want,
            p.label + "·" + vp + "：★ 诊断条已避让（bottom ≥ 底栏高，二者同为 fixed 且互不让位）",
            "diag.bottom " + L.diagBottom + " vs " + want);
        }
        if (L.tgBody){
          /* ★★★ v3.19.0（用户拍板的新契约，取代 v3.13 的零位移/零高度）：开关列**流内**——
             面板打开 → 开关列纵向生长（卡片变高、下方内容顺移 = 用户接受的下移）；
             **音量/BPM 两列 rect 逐像素不动**（列内生长不外溢）；开关/面板 x 恒定（零横移）；
             预备拍行 = 开关 + 拍数输入同行右侧；复原无残留。
             （悬浮槽时代断言——四态等高 / 50px 预留 / 槽心对齐 / 卡底收容——整体退役。） */
          const xEq = a => (a[0] === a[1] && a[1] === a[2] && a[2] === a[3]);
          /* ★★★ v3.30.0（契约换轨，实测换来的界限）：**内容零变形 + 卡片向下生长**。
             v3.24「单开卡高恒定」随三列行心对齐退役——开关列关闭态被 44px 偏移抬到
             ~188px（正是"预备拍行心 = BPM 步进行"的代价），开面板必然纵向生长；
             实测四态：关 240.8 / 单开静音拍 290.8 / 全开 344 / 复原 240.8。
             用户真正在意的"打开开关内容乱窜"由**内容零变形**守住（下面的 vol1/bpm 断言：
             四条音量滑杆与 BPM 大数字逐像素不动，卡片只向下长、不重新分布内容）。
             界限取 110（实测 103.2 + 余量）：钉的是"不得出现量级失控的生长"，
             不是精确值——字体度量差会让它浮动几像素。 */
          if (vp === "桌面"){
            ok(L.tgBody.cardHR === L.tgBody.cardHC,
              p.label + "·" + vp + "：★★★ 开关全部复原后**卡片高度无残留**（四态回原点）",
              "关 " + L.tgBody.cardHC + " vs 复原 " + L.tgBody.cardHR);
            ok(L.tgBody.cardHB - L.tgBody.cardHC <= 110,
              p.label + "·" + vp + "：★★ 全开态卡片生长有界（≤110px：两组参数面板在列内的固有成本）"
              + "——v3.30.0 行心对齐与 v3.24 卡高恒定不可兼得，取舍 = 卡片向下长、内容不重分布",
              "关 " + L.tgBody.cardHC + " / 单开 " + L.tgBody.cardHM
              + " / 全开 " + L.tgBody.cardHB + " / 复原 " + L.tgBody.cardHR);
          }
          ok(L.tgBody.colLC === L.tgBody.colLM && L.tgBody.colLM === L.tgBody.colLB
             && L.tgBody.colBC === L.tgBody.colBM && L.tgBody.colBM === L.tgBody.colBB,
            p.label + "·" + vp + "：★★★ 音量/BPM 两列 left/top/width **逐像素不动**"
            + "（v3.21.0：高度随行高铺开是用户需求，横移/顶移仍为零）",
            "音量 " + L.tgBody.colLC + " → " + L.tgBody.colLM + " → " + L.tgBody.colLB);
          /* ★★★ v3.22.0：内容级**零变形**——开合开关列前后，音量滑杆行与 BPM 大数字
             的位置逐像素不动（用户验收点"打开变速训练没必要变形"的正体）。 */
          if (vp === "桌面"){
            /* 单开（闭/静音开）零变形；都开（两组参数同显）允许中行 ≤10px 重排
               （两组面板同显时 tg 列内容溢出预留区的固有重排，卡高仍恒定） */
            const near = (a, b) => Math.abs(a - b) <= 10;
            const p1 = JSON.parse(L.tgBody.vol1M), p2 = JSON.parse(L.tgBody.vol1B);
            const q1 = JSON.parse(L.tgBody.bpmM), q2 = JSON.parse(L.tgBody.bpmB);
            ok(L.tgBody.vol1C === L.tgBody.vol1M && L.tgBody.bpmC === L.tgBody.bpmM
               && near(p1[1], p2[1]) && near(q1[1], q2[1]),
              p.label + "·" + vp + "：★★★ 音量滑杆/BPM 数字**单开零变形**、都开重排 ≤10px"
              + "（v3.22.0 固定间距顶对齐的核心承诺）",
              "音量行 " + L.tgBody.vol1C + " → " + L.tgBody.vol1M + " → " + L.tgBody.vol1B
              + " BPM数字 " + L.tgBody.bpmC + " → " + L.tgBody.bpmM + " → " + L.tgBody.bpmB);
          }
          /* ★★★ v3.30.0（用户拍板）：底栏左块左缘 = **跑道左缘**、右块右缘 = 跑道右缘、
             两块等宽——对齐参照物 = 跑道/歌词行盒缘（= .main 内容缘），不是卡片控制网格缘
             （v3.28 口径，1440 下相差 188.5px）。这是本轮用户反复标注后钉死的正体。 */
          if (vp === "桌面" && L.pbAlign){
            const A = L.pbAlign;
            ok(Math.abs(A.ctxL - A.vizL) <= 2,
              p.label + "·" + vp + "：★★★ 底栏左块左缘 = 跑道左缘（贴跑道缘，v3.30.0）",
              "左块 " + A.ctxL + " vs 跑道 " + A.vizL);
            ok(Math.abs(A.rightR - A.vizR) <= 2,
              p.label + "·" + vp + "：★★★ 底栏右块右缘 = 跑道右缘（右侧对称）",
              "右块 " + A.rightR + " vs 跑道 " + A.vizR);
            ok(Math.abs(A.ctxW - A.rightW) <= 2,
              p.label + "·" + vp + "：★★ 底栏左右两块**等宽**（--pb-side-w 共享变量）",
              "左 " + A.ctxW + " vs 右 " + A.rightW);
            if (A.lyricL !== null){
              ok(Math.abs(A.lyricL - A.vizL) <= 2 && Math.abs(A.lyricR - A.vizR) <= 2,
                p.label + "·" + vp + "：★★ 跑道与歌词行同缘（用户口径「跟跑道和歌词行对齐」的两者一致）",
                "跑道 " + A.vizL + "/" + A.vizR + " vs 歌词行 " + A.lyricL + "/" + A.lyricR);
            }
            /* ★★★ v3.30.1（用户需求，截图圈出）：进度条轨道的中线 = 胶囊中线 = 播放键中心。
               量的必须是**轨道**（.demo-range-track）而非右块——右块两行纵排，整块居中时
               轨道天然高出 (45−22)/2 = 11.5px，正是本轮修的病灶。 */
            if (A.trackC !== null && A.keyC !== null){
              ok(Math.abs(A.trackC - A.ctxC) <= 2 && Math.abs(A.trackC - A.keyC) <= 2,
                p.label + "·" + vp + "：★★★ 进度条轨道中线 = 胶囊中线 = 播放键中心（三者同线，v3.30.1）"
                + "——右块下移 11.5px 使**轨道**（而非整块）成为居中基准",
                "轨道 " + A.trackC + " / 胶囊 " + A.ctxC + " / 播放键 " + A.keyC);
            }
            if (A.rightBot !== null && A.barInnerBot !== null){
              ok(A.rightBot <= A.barInnerBot + 1,
                p.label + "·" + vp + "：★★ 右块下移后仍收在栏内（块底 ≤ 栏内容区底，不溢出/不遮挡）",
                "块底 " + A.rightBot + " vs 栏内底 " + A.barInnerBot);
            }
          }
          /* ★★★ v3.31.0（用户报障）①：跑道特效——已弹格填充与扫弦记号码色**必须不同**。
             同色就是"记号被抹平"（经典＝白底白记号，观测台＝墨底墨记号，两主题都中过招）。
             停机态没有 played 格子，探针临时挂一个 .cell.played 读 ::before 的解析值。 */
          if (vp === "桌面" && L.laneAndWide && L.laneAndWide.fillL !== null && L.laneAndWide.inkL !== null){
            const W = L.laneAndWide;
            ok(Math.abs(W.fillL - W.inkL) >= 60,
              p.label + "·" + vp + "：★★★ 已弹格填充「" + W.cellFill + "」与记号码色「" + W.strumInk + "」"
              + "亮度差 ≥60 —— 同色即记号被抹平（v3.31.0 改为填充压暗 / 记号仍取 --peak）",
              "填充 L=" + W.fillL + " vs 记号 L=" + W.inkL + "（差 " + Math.abs(W.fillL - W.inkL) + "）");
            ok(W.strumHeadInk !== null && /^rgb/.test(W.strumHeadInk),
              p.label + "·" + vp + "：★ 箭头三角也取到实色（杆与头同源，不能只改一头）",
              "箭头 " + W.strumHeadInk);
          }
          /* ★★★ v3.31.0（用户报障）②：宽屏铺满切换后，歌词轨宽度必须跟随 #viz。
             歌词轨的 inline 宽度由 placeLaneOverlay 写死，不重排就停在旧值
             （实测 1920：切换后 #viz 1392→1857 而歌词轨仍是 1392 → 整体错位）。
             ★ 数据来自 **1920 专用探针**（r.wideFull）：在 1440 视口下主列本就封顶 1440，
             铺满开关不改变 #viz 宽——在那里量是空转的假绿。 */
          if (vp === "桌面" && r.wideFull && !r.wideFull.err){
            const W = r.wideFull;
            ok(W.afterViz !== W.beforeViz,
              p.label + "·" + vp + "：★ 前提：切换确实改变了 #viz 宽（否则本项无意义）",
              "切换前 " + W.beforeViz + " → 后 " + W.afterViz);
            ok(Math.abs(W.afterLane - W.afterViz) <= 2,
              p.label + "·" + vp + "：★★★ 铺满后歌词轨宽 = #viz 宽（v3.31.0：切换补 relayout）"
              + "——修前此处停在旧值（1440×900 实测差 465px）",
              "歌词轨 " + W.afterLane + " vs #viz " + W.afterViz);
            ok(W.restored === true,
              p.label + "·" + vp + "：★ 探针已复原（切回后 wide-full 类摘除，不污染后续）", "");
            if (W.charFs !== null && W.chipH !== null){
              ok(W.afterViz === W.afterLane,
                p.label + "·" + vp + "：★ 前提：歌词轨已跟上（否则下面量的是错位的字体环境）", "");
              ok(W.charFs <= W.chipH,
                p.label + "·" + vp + "：★★ 歌词字号 ≤ 字块高（v3.31.0 加上限 24px；"
                + "铺满档 --cs 无界增长会把字撑出固定行高，实测无上限时 31.2px in 26px 字块）",
                "字号 " + W.charFs + "px vs 字块高 " + W.chipH + "px"
                + "（非铺满 " + W.beforeFs + "px）");
              /* 钉**上限值本身**（24px）：铺满后字号必须收敛到上限，而不是随窗口无界增长。
                 ★ 别钉成"≤ 非铺满档"——上限 24 略高于非铺满上限 23.2，那正是"不改小已认可观感"
                 的必然结果（铺满后允许到 24，比非铺满大 0.8px）。首版就这么写错过，直接红。 */
              ok(W.charFs <= 24.05,
                p.label + "·" + vp + "：★★ 上限生效——铺满后字号收敛到 24px 上限"
                + "（无上限时 1920 下是 30.9px；非铺满档 23.2px 不受影响）",
                "非铺满 " + W.beforeFs + "px → 铺满 " + W.charFs + "px（上限 24）");
            }
          }
          /* ★★★ v3.31.1：切到连续滚动（未播放）后，歌词行必须落在**静止态**位置
             （与同索引网格行同中心）。修前歌词停在视口正中、差 696px，按播放才恢复。 */
          if (vp === "桌面" && r.scrollRest && !r.scrollRest.err){
            const S2 = r.scrollRest;
            ok(S2.pairs.length >= 2,
              p.label + "·" + vp + "：★ 前提：切滚动后有 ≥2 组可见的「网格行 ↔ 歌词行」可对比",
              "组数 " + S2.pairs.length + "（网格行 " + S2.gridN + " / 歌词行 " + S2.lyricN + "）");
            const bad = S2.pairs.filter(x => Math.abs(x.dx) > 2);
            ok(S2.pairs.length >= 2 && bad.length === 0,
              p.label + "·" + vp + "：★★★ 切滚动（未播放）后歌词行中心 = 同索引网格行中心"
              + "（静止态落位；v3.31.1 修掉「切完错位、按播放才恢复」）",
              "各对偏差 " + JSON.stringify(S2.pairs.map(x => x.dx))
              + "（修前实测 +696）");
          }
          /* ★★★ v3.31.3：格子四档亮度**必须互相可区分**（用户报障「正在弹的实扫格背景
             变得和空扫/休止格一样」）。修前实测：正在弹 15.0 vs 休止 16–24（分离 −1.2）。
             用页内 canvas 合成取真实像素亮度（透明格截图采样会透出背后内容，读数不可信）。 */
          if (vp === "桌面" && r.cellLevels){
            const C = r.cellLevels;
            const diff = (a, b) => Math.round((a.lum - b.lum) * 10) / 10;
            const chroma = p => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
            ok(diff(C.activeSolid, C.restActive) >= 25 && diff(C.activeSolid, C.restUp) >= 25,
              p.label + "·" + vp + "：★★★ 正在弹·实扫格 与 空扫/休止格 亮度分离 ≥25"
              + "（修前 −1.2＝无法区分，用户报障的正体）",
              "正在弹 " + C.activeSolid.lum + " vs 空扫·正在弹 " + C.restActive.lum
              + " / 空扫·未弹 " + C.restUp.lum + "（Δ " + diff(C.activeSolid, C.restActive) + "）");
            ok(diff(C.activeSolid, C.playedSolid) >= 15,
              p.label + "·" + vp + "：★★ 正在弹 与 已弹 也要能区分（不能两档同亮）",
              "正在弹 " + C.activeSolid.lum + " vs 已弹 " + C.playedSolid.lum);
            ok(diff(C.upSolid, C.playedSolid) >= 8,
              p.label + "·" + vp + "：★★ 未弹 与 已弹 可区分（已弹＝退到背景里）",
              "未弹 " + C.upSolid.lum + " vs 已弹 " + C.playedSolid.lum);
            ok(chroma(C.activeSolid.rgb) >= 20,
              p.label + "·" + vp + "：★★★ 正在弹格填充**有色**（随主题的绿/蓝调）——"
              + "这是它区别于「中性压暗」的休止格的关键线索",
              "正在弹 rgb " + JSON.stringify(C.activeSolid.rgb) + " 彩度 " + chroma(C.activeSolid.rgb));
            ok(chroma(C.restActive.rgb) <= 10 && chroma(C.restUp.rgb) <= 10,
              p.label + "·" + vp + "：★★★ 空扫/休止格保持**中性**（不得被染成主题色——"
              + "即「空扫不会被染成跟实扫一样」这条不回潮）",
              "空扫·正在弹 rgb " + JSON.stringify(C.restActive.rgb)
              + " 彩度 " + chroma(C.restActive.rgb));
          }
          if (vp === "桌面" && r.childrenShape){
            const CS = r.childrenShape;
            ok(!CS.isArray && !CS.hasFind && CS.hasItem === true && CS.length === 1,
              p.label + "·" + vp + "：真机 children 是 HTMLCollection（无数组方法）——"
              + "桩是数组，产品代码依赖数组方法会「桩绿真机红」（审计 P0-1 哨兵）",
              JSON.stringify(CS));
          } else if (vp === "桌面"){
            ok(false, p.label + "·" + vp + "：children 形状探针未取到（probe 缺失，属冒烟自身故障）", "");
          }
          if (vp === "桌面" && L.tgBody.volHC !== null && L.tgBody.bpmHC !== null){
            ok(Math.abs(L.tgBody.volHC - L.tgBody.bpmHC) <= 4,
              p.label + "·" + vp + "：★★ 音量列与 BPM 列**等高**（≥900 三列等高 + space-between 铺满，"
              + "用户需求；<900 纵向堆叠无此承诺）",
              "音量 " + L.tgBody.volHC + " vs BPM " + L.tgBody.bpmHC);
          }
          ok(xEq([L.tgBody.mxC, L.tgBody.mxM, L.tgBody.mxB, L.tgBody.mxR])
             && xEq([L.tgBody.txC, L.tgBody.txM, L.tgBody.txB, L.tgBody.txR]),
            p.label + "·" + vp + "：★★★ 开关/面板 x **逐像素不动**（列内零横移）",
            "静音拍 " + L.tgBody.mxC + "/" + L.tgBody.mxM + "/" + L.tgBody.mxB + "/" + L.tgBody.mxR
            + " 变速 " + L.tgBody.txC + "/" + L.tgBody.txM + "/" + L.tgBody.txB + "/" + L.tgBody.txR);
          if (L.tgBody.rowWC !== null && L.tgBody.rowWC !== "hidden"){
            ok(L.tgBody.rowWC === "[true,true]" || L.tgBody.rowWM === "[true,true]" || L.tgBody.rowWB === "[true,true]",
              p.label + "·" + vp + "：★★ 预备拍行 = 开关 + 拍数输入**同行右侧**（打开时 y 同行、x 在开关右）",
              "三态 " + L.tgBody.rowWC + "/" + L.tgBody.rowWM + "/" + L.tgBody.rowWB);
          }
        } else {
          ok(false, p.label + "·" + vp + "：参数槽容器未取到（本项未验证）", "");
        }
        if (L.pbProgress){
          ok(L.pbProgress.inBar === true,
            p.label + "·" + vp + "：★★ 进度条在底栏内（#pbProgress，v3.3.0 新增的右区）", "");
          /* 阈值按视口分档：桌面给得宽（>200），窄屏 390 三条东西挤一行，>60 即可用 */
          const minW = vp === "桌面" ? 200 : 60;
          ok(L.pbProgress.w > minW,
            p.label + "·" + vp + "：★ 进度条有实际宽度（不被胶囊/控制键挤成 0，阈值 " + minW + "）",
            "宽度 " + L.pbProgress.w);
          /* ★★ v3.13.0（桌面档）：进度条宽度**不敏感**——预备拍开合（拍数输入显形）与
             状态文案跳变都不得改变进度条宽度（真机实测旧单行布局下 −64px / −134px）。
             两行化解耦（进度条独占行 1）的验收点。
             ★ v3.17.0：断言收敛到**桌面档**——≤640 手机档行 2 内进度条与状态文案
             天然共享宽度（空间稀缺下的标准取舍），改由零溢出断言（barOverflow=0）
             + 进度条 ≥96 底线守门。 */
          if (vp === "桌面"){
            if (L.pbProgress.wCnt !== null){
              ok(Math.abs(L.pbProgress.wCnt - L.pbProgress.wBase) <= 1,
                p.label + "·" + vp + "：★★★ 预备拍开合**不改进度条宽度**（解耦验收点）",
                "关 " + L.pbProgress.wBase + " vs 开 " + L.pbProgress.wCnt);
            }
            if (L.pbProgress.wLong !== null){
              ok(Math.abs(L.pbProgress.wLong - L.pbProgress.wBase) <= 1,
                p.label + "·" + vp + "：★★★ 状态文案跳变**不改进度条宽度**（长文案 −134px 根因的解耦验收点）",
                "常规 " + L.pbProgress.wBase + " vs 长文案 " + L.pbProgress.wLong);
            }
          }
          if (L.pbProgress.statusBelow !== null){
            ok(L.pbProgress.statusBelow === true,
              p.label + "·" + vp + "：★ 状态灯行在进度条**下方**（.pb-sub 行 2，v3.13.0 两行化）", "");
          }
          /* 范围滑块是**曲式模式**下才挂进来的（预设模式没有"整首"可言）——
             没挂时不判假，只在挂了的时候验"整组都在、播放头也在" */
          /* ★ v3.3.1（用户反馈）：播放键必须**水平居中**且不贴底——两条都是真机才看得出的观感，
             也是本轮的实际故障（space-between 下中列被左右不等宽挤偏）。 */
          if (L.center){
            if (L.center.jumpCenter !== null && L.center.contentCenter !== null){
              ok(Math.abs(L.center.jumpCenter - L.center.contentCenter) <= 2,
                p.label + "·" + vp + "：★★★ 播放键组**居中于底栏内容列**（v3.26.0：内容列 = 卡片内容列）",
                "argJump 中心 " + L.center.jumpCenter + " vs 内容列中心 " + L.center.contentCenter);
            }
            ok(L.center.gapBottom >= 16,
              p.label + "·" + vp + "：★★ 播放键不贴底（底缘距视口底 ≥16px）",
              "距底 " + L.center.gapBottom);
          }
          /* ★ v3.3.1（用户反馈）：同屏行数 = 1 时整条可视化带在剩余空间里垂直居中 */
          if (L.vizCenter){
            ok(Math.abs(L.vizCenter.topGap - L.vizCenter.botGap) <= 2,
              p.label + "·" + vp + "：★★ 行数=1 时可视化带垂直居中（上下留白差 ≤2px）",
              "上留白 " + L.vizCenter.topGap + " vs 下留白 " + L.vizCenter.botGap);
          }
          if (L.pbProgress.hasRange){
            ok(L.pbProgress.hasFrom === true && L.pbProgress.hasHead === true,
              p.label + "·" + vp + "：★★ 范围滑块整组在底栏（双 range + 播放头），且未在曲式区留副本",
              "from=" + L.pbProgress.hasFrom + " head=" + L.pbProgress.hasHead);
          }
        } else {
          ok(false, p.label + "·" + vp + "：底栏右区容器 #pbProgress 未取到", "");
        }
      });

      if (lay.narrow){
        /* ★ v3.12.0：原「拍号折到下一行」断言随拍号控件删除退役，换成搬移后的归属断言 +
           底栏右区在窄屏下的高度不得顶穿底栏（那正是本轮真机抓到的 9px 贴底根因）。 */
        ok(lay.narrow.rowsHome === "settings" && lay.narrow.sigExists === false,
          p.label + "：★ 窄屏：行数档位只在设置弹窗、拍号控件已删（与桌面同口径）",
          "归属 " + lay.narrow.rowsHome + " · sigExists=" + lay.narrow.sigExists);
        if (lay.narrow.pbRightH !== null && lay.narrow.pbRightH !== undefined){
          ok(lay.narrow.pbRightH <= lay.narrow.barContentH + 1,
            p.label + "：★★★ 窄屏底栏右区不顶穿底栏（右列高 ≤ 底栏内容区高）——"
            + "超出会把中列一起撑高、播放键贴底（v3.12.0 真机实测距底 9px 的根因）",
            "右列 " + lay.narrow.pbRightH + " vs 内容区 " + lay.narrow.barContentH);
        }
        if (lay.narrow.barOverflow !== null && lay.narrow.barOverflow !== undefined){
          ok(lay.narrow.barOverflow === 0,
            p.label + "：★★★ 窄屏底栏**零视口溢出**（任何子元素不得超出视口——"
            + "v3.15.0 回归：三列网格把右列压到 6px、进度条溢出 66px 被裁）",
            "溢出元素 " + lay.narrow.barOverflow);
        }
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
      /* v2.42.7：窄屏组容器卡等宽（宽度策略分裂的回归闸门——音量卡 352 钉死 /
         BPM 内容宽 / 开关·行数撑满曾在窄屏并存，右缘参差；宽屏 2×2 或三块一行
         有自己的列宽设计，本断言只认窄屏）。
         ★ v3.12.0：块数 4 → **3**（「同屏行数与拍号」并排行退役）——门槛与文案同步，
         否则断言因长度不符被静默跳过（假绿）。 */
      if (lay.narrow && Array.isArray(lay.narrow.grpWidths) && lay.narrow.grpWidths.length === 3){
        const gws = lay.narrow.grpWidths;
        ok(Math.max(...gws) - Math.min(...gws) <= 1,
          "窄屏：★ 三张组容器卡等宽（宽度策略分裂回归闸门）",
          "宽度 " + JSON.stringify(gws));
      }
      if (lay.narrow && Array.isArray(lay.narrow.grpGaps) && lay.narrow.grpGaps.length === 3){
        const ggs = lay.narrow.grpGaps;
        ok(Math.max(...ggs) - Math.min(...ggs) <= 1,
          "窄屏：★ 四张组容器卡等距（间距来源分裂回归闸门）",
          "间隙 " + JSON.stringify(ggs));
      }
      /* ---- v3.0.0（PLAN-v9 批 0）：可视化带去卡片 + 预设库抽屉（真几何，桩测不到）---- */
      const dw = r.drawer;
      if (dw && dw.hasBtn && dw.hasDrawer){
        /* v3.3.0：入口与内容分家——入口 = 底栏左区胶囊；动作区三行 + 循环小节住面板内 */
        ok(dw.ctxInBar === true,
          p.label + "：★★ 入口胶囊在底栏内（#presetLibBtn 随左区搬到播放条）", "ctxInBar=" + dw.ctxInBar);
        ok(dw.actionsInDrawer === true && dw.loopInDrawer === true,
          p.label + "：★★ 动作区（编排/听辨/新建）与「循环小节」都在面板内",
          "actions=" + dw.actionsInDrawer + " loop=" + dw.loopInDrawer);
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
        /* ★★★ v3.3.0：预设库改「左侧覆盖面板」——旧的三条内联断言（紧贴行 1 之下 /
           排在行数行之上 / 行数行被下推）已随改造退役，换成本组"覆盖式"断言。
           其中"不推挤"那条是本轮的核心验收点（用户要求①：压在原页面上、不改动原页面）。 */
        const wantW = Math.min(392, Math.round(dw.w * 0.88));   // rect() 只回 l/r/t/b/w，高度用 b−t 算
        const dwH = dw.drawer ? Math.round(dw.drawer.b - dw.drawer.t) : null;
        ok(!!dw.drawer && dw.drawer.l <= 0.51 && dwH !== null && Math.abs(dwH - dw.viewportH) <= 1,
          p.label + "：★★ 面板贴左缘、满视口高（从左侧滑出的浮层）",
          "left " + (dw.drawer && dw.drawer.l) + " · 高 " + dwH + " vs 视口 " + dw.viewportH);
        ok(!!dw.drawer && Math.abs(dw.drawer.w - wantW) <= 1,
          p.label + "：★ 面板宽 min(392, 88vw)（窄屏自适应）",
          "实测 " + (dw.drawer && dw.drawer.w) + " vs 期望 " + wantW);
        ok(!!dw.maskOpen && dw.maskOpen.l <= 0.51 && dw.maskOpen.w >= (dw.clientW || dw.w) - 1,
          p.label + "：★ 遮罩满视口（盖住整页，含 fixed 播放底栏）",
          "遮罩宽 " + (dw.maskOpen && dw.maskOpen.w) + " vs 客户区 " + (dw.clientW || dw.w));
        ok(!!dw.rowsOpen && !!dw.rowsClosed && Math.abs(dw.rowsOpen.t - dw.rowsClosed.t) <= 0.51
           && Math.abs(dw.rowsOpen.l - dw.rowsClosed.l) <= 0.51,
          p.label + "：★★★ 展开面板**不推挤**页面——「同屏行数与拍号」位置一动不动（覆盖式的核心验收）",
          "收起 " + (dw.rowsClosed && (dw.rowsClosed.t + "/" + dw.rowsClosed.l))
          + " → 展开 " + (dw.rowsOpen && (dw.rowsOpen.t + "/" + dw.rowsOpen.l)));
        ok(!!dw.drawer && !!dw.rowsOpen && dw.drawer.b > dw.rowsOpen.t,
          p.label + "：★★ 面板**压在**原页面之上（与内容区重叠，而不是排在其上方）",
          "面板底 " + (dw.drawer && dw.drawer.b) + " vs 行数行顶 " + (dw.rowsOpen && dw.rowsOpen.t));
        ok(dw.maskHiddenClosed === true,
          p.label + "：★ 收起态遮罩一并隐藏（不留一层孤影吃掉点击）", "maskHidden=" + dw.maskHiddenClosed);
        ok(dw.maskClickClosed === true,
          p.label + "：★★ 点遮罩 → 关闭（覆盖式面板的必备退出路径）", "hidden=" + dw.maskClickClosed);
        ok(dw.focusAfterOpen === "presetSearch",
          p.label + "：★ 打开后焦点进搜索框（顺手就能过滤）", "focus=" + dw.focusAfterOpen);
        ok(dw.reclosed === true,
          p.label + "：★ 关闭钮 → 收起", "hidden=" + dw.reclosed);
        ok(dw.focusAfterClose === "presetLibBtn",
          p.label + "：★ 关闭后焦点归还主钮（从哪来回哪去）", "focus=" + dw.focusAfterClose);
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
        if (d.perf.lyricFrameMs !== null && d.perf.lyricFrameMs !== undefined){
          ok(d.perf.lyricFrameMs < PERF_BUDGET.lyricFrameMs,
            p.label + "：歌词轨在场单帧 < " + PERF_BUDGET.lyricFrameMs + "ms（paintLyric 逐帧分配的下界——S-3 实测收口）",
            "实际 " + d.perf.lyricFrameMs + " ms");
        } else {
          ok(false, p.label + "：歌词轨帧成本未取到（探针自身问题，需排查）", "");
        }
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
