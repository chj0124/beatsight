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
/* ★★★ v3.38.1 补10：允许把**被测 HTML** 指到 /tmp 副本（BEATSIGHT_HTML）——
   反向验证的纪律是「变异只改 /tmp 副本、绝不动工作区文件」（AGENTS §2 +
   reverse-verify-tests-by-mutation skill）。tests/run.js 早就有这个注入口，冒烟以前没有，
   于是"证明某条真机闸会红"只能靠换工作区文件——那本身就是违规操作（本次修 bug 时踩过）。
   补上同一口子：file:// 通道直开该路径、http 通道把 /index.html 映射到它，其余静态文件仍走 ROOT。 */
const HTML_PATH = process.env.BEATSIGHT_HTML
  ? path.resolve(process.env.BEATSIGHT_HTML) : path.join(ROOT, "index.html");
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
const VERSION = (/const\s+VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(HTML_PATH, "utf8")) || [])[1] || "";

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
    /* BEATSIGHT_HTML 注入：/index.html 服务那份 /tmp 副本（其余文件照旧走 ROOT） */
    const injected = HTML_PATH !== path.join(ROOT, "index.html");
    const file = (injected && rel === "index.html") ? HTML_PATH : path.join(ROOT, rel);
    /* ★ 目录边界必须按「路径分隔符」判，不能裸 startsWith(ROOT)：
       裸判会把同前缀的**兄弟目录**放进来——ROOT=/a/beatsight 时，/a/beatsight2/x 也以
       "/a/beatsight" 开头，于是仓库外的文件被当仓库内文件服务出去（本地工具，风险低，
       但语义是错的）。补上分隔符即 `file === ROOT || file.startsWith(ROOT + sep)`。 */
    const inRoot = file === ROOT || file.startsWith(ROOT + path.sep) || file === HTML_PATH;
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
  /* ★ v3.35.3：歌曲行的点击语义改成了「展开/收起」，整首连播挪到行尾的 ▶ ——
     这里要的是"回到曲式模式"，所以点的入口随之换成那颗 ▶（点行只会展开，模式不变，
     后续滚动探针的歌词轨就整轨隐藏——这正是本次实测到的那 12 条红）。 */
  const demoItem = q("#presetList .preset-arrange-group .preset-item");
  const demoPlay = demoItem && demoItem.querySelector(".aud");
  if (demoPlay){
    demoPlay.click();
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
  /* ★★★ v3.36.7（本轮审计 C-2）：**窄屏格宽**。桩里 cellEls 没有布局宽度（几何是伪造的），
     所以「手机竖屏 + 十六分型时单格多少 px、点不点得中」只能在真浏览器量。
     ★ 必须切到**最挤的那一档**（十六分型）：默认型是八分，格子宽得多，量出来是空转的假绿
       （与宽屏铺满探针同一个坑）。本探针自己选型、量完**还原**，不留副作用。
     ★ 量的是 .cell（一个时值格）：应用是**拆行**而不是缩格子——所以格宽不随同屏行数下降。 */
  out.cell = (() => {
    const b = window.__beat;
    if (!b) return null;
    const S = b.Store.S;
    const savedSel = JSON.stringify(S.sel);
    const i16 = b.BUILTINS.findIndex(x => /十六分/.test(x.name));
    if (i16 >= 0) S.sel = { type: "builtin", idx: i16 };
    b.Viz.buildViz();
    const cells = [...document.querySelectorAll(".cell")];
    const ws = cells.map(c => c.getBoundingClientRect().width).filter(w => w > 0);
    const rows = [...document.querySelectorAll(".bar-row")];
    const res = {
      pattern: i16 >= 0 ? b.BUILTINS[i16].name : null,
      count: cells.length,
      minW: ws.length ? round(Math.min.apply(null, ws)) : null,
      perRow: rows.map(r => r.querySelectorAll(".cell").length),
    };
    try { S.sel = JSON.parse(savedSel); b.Viz.buildViz(); }catch(e){}
    return res;
  })();
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
    /* ★ 控制芯批 6（PLAN-v9）：开关列 .viz-toggles 退役——开关进芯顶胶囊行、参数面板进浮层；
       tg-body 现住合并组内（.card-head-left .group .tg-body）。锚点随之改指新芯。 */
    const body = q(".card-head-left .group .tg-body") || q(".card-head-left .tg-body");
    if (!body) return null;
    /* ★ v3.19.0 探针（三列均分 + 开关列流内）：开合只让**开关列**纵向生长——
       音量/BPM 两列 rect 逐像素不动；开关/面板 x 恒定（列内零横移）；
       预备拍行 = 开关 + 拍数输入同行右侧。
       ★ v3.39.0：BPM 组并入音量组 ⇒ 独立 BPM 列（.viz-head > .group）除名，
       colB/colBH 一族读数随对象消失退役；"音量列不动"的承诺改由合并组（.card-head-left）承担。 */
    const colL = q(".viz-head-grid .card-head-left");
    /* v3.21.0：不移动承诺 = left/top/width（音量列高度随行高铺开是用户需求，不入此列） */
    const colLR = () => (colL ? JSON.stringify([round(colL.getBoundingClientRect().left), round(colL.getBoundingClientRect().top), round(colL.getBoundingClientRect().width)]) : null);
    const colLH = () => (colL ? round(colL.getBoundingClientRect().height) : null);
    const wrapEl = q("#countInBeatsWrap"), ct = q("#countInToggle");
    /* ★ v3.22.0：内容级零变形读数——音量第一条滑杆行 / BPM 大数字，在开关列开合前后
       rect 逐像素不动（用户验收点"打开变速训练没必要变形"的正体；盒子高度随行变化
       不算变形——组盒透明无边框）。 */
    const volRows = document.querySelectorAll(".viz-head-grid .vol-row");
    const vol1 = volRows[1], bpmNum = q(".viz-head-grid .bpm-num");   /* 量中间行：space-between 重分布时中行位移最大（首行被顶对齐钉住） */
    const vol1R = () => (vol1 ? JSON.stringify([round(vol1.getBoundingClientRect().left), round(vol1.getBoundingClientRect().top)]) : null);
    const bpmR = () => (bpmNum ? JSON.stringify([round(bpmNum.getBoundingClientRect().left), round(bpmNum.getBoundingClientRect().top)]) : null);
    const wrapRow = () => { if (!wrapEl || !ct) return null;
      /* ★ v3.41.0：拍数输入改为**就地长出**（预备关着时 hidden、零尺寸 ⇒ 直接量会读到 0×0 的假错位）
         ⇒ 量之前先把它打开、量完还原（沿用本文件"造条件→量→还原"的既有纪律，同 volPillInk 一族）。 */
      const prep = q("#countInToggle"), wasHidden = !!wrapEl.hidden;
      if (prep && wasHidden) prep.click();
      const a = ct.getBoundingClientRect(), b = wrapEl.getBoundingClientRect();
      const cyOK = Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) <= 2;   /* 垂直中轴对齐（align-items:center） */
      const rightOK = round(b.left) > round(a.right - 4);
      if (prep && wasHidden) prep.click();
      return JSON.stringify([cyOK, rightOK]); };
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
    const rowEl = q(".core-pills");   /* 控制芯批 6：开关行 = 芯顶胶囊行（.viz-toggles .tg-row 随列退役） */
    const rowCx = () => { const r = rowEl && rowEl.getBoundingClientRect();
      return r ? round(r.left + r.width / 2) : null; };
    /* ★ v3.42.0：右侧参数槽的宽度——开关关着应为 0（不占位），打开应 > 0（长在胶囊壳里） */
    const slotW = () => { const s = q("#muteSlot"); return s ? round(s.getBoundingClientRect().width) : null; };
    const ctxEl = q(".pb-ctx");
    const ctxL = ctxEl ? round(ctxEl.getBoundingClientRect().left) : null;
    const closed = h(), mxC = mx(), txC = tx(), colLC = colLR(), rowWC = wrapRow(), slotWC = slotW();
    const vol1C = vol1R(), bpmC = bpmR();
    const volHC = colLH();
    const cardHC = (() => { const c = cardEl || (q(".viz-head-grid") && q(".viz-head-grid").closest(".card")); return c ? round(c.getBoundingClientRect().height) : null; })();
    if (mt) mt.click();
    const muteOnly = h(), mxM = mx(), txM = tx(), colLM = colLR(), rowWM = wrapRow(), slotWM = slotW();
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
    const both = h(), mxB = mx(), txB = tx(), colLB = colLR(), rowWB = wrapRow();
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
      volHC: volHC,
      vol1C: vol1C, vol1M: vol1M, vol1B: vol1B,
      bpmC: bpmC, bpmM: bpmM, bpmB: bpmB,
      rowWC: rowWC, rowWM: rowWM, rowWB: rowWB,
      slotWC: slotWC, slotWM: slotWM,
      prepWrapHidden: (function(){ var w=q("#countInBeatsWrap"); return w ? !!w.hidden : null; })(),
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
    if (st){ const bak = st.textContent; st.textContent = "静音 · 第 44 小节 · 心中默数";
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
    /* v3.33.12：窄屏改「归右」契约后，需要右缘而不是中心来判定 */
    const jumpRight = jr ? round(jr.right) : null;
    const contentRight = round(bar.getBoundingClientRect().left + bar.clientWidth - br);
    return { keyCenter: round(kr.left + kr.width / 2),
      vpCenter: round(document.documentElement.clientWidth / 2),
      jumpCenter: jumpCenter, contentCenter: contentCenter,
      jumpRight: jumpRight, contentRight: contentRight,
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
  /* ★ v3.38.1 补7：音量组**收起时整块 display:none**（不再占列）⇒ 原来只取 .card-head-left
     会读到 0 盒（left=0 + padding=16），基准失真、窄屏 390 当场判红（实测 16 vs 48）。
     改成"取第一个**可见**的控制列块"——三者 padding-left 同源（都是 12px 16px），
     谁是第一个可见的都能当基准。
     ★★★ 控制芯批 3（PLAN-v9）：窄屏默认收起 = **只藏滑杆塔**（.tg-body）——探针据此判收起态；
     量「标题/开关行左缘」前造条件：收起态下临时翻 #ctlOpen 展开量完即还原（探针不留状态）。 */
  const ctlExpand = (() => {
    const cb = document.getElementById("ctlOpen"), tw = q(".card-head-left .group .tg-body");
    if (cb && !cb.checked && tw && getComputedStyle(tw).display === "none"){
      cb.checked = true; void document.body.offsetWidth;
      return true;
    }
    return false;
  })();
  out.headContentLeft = (() => {
    const cands = [q(".card-head-left")];
    for (const el of cands){
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      const hr = el.getBoundingClientRect();
      if (hr.width <= 0) continue;
      return round(hr.left + parseFloat(cs.paddingLeft));
    }
    return null;
  })();
  /* v2.10.16：标题 #vizTitle 已删，左边缘基准改用左列「音量」组标签
     （角标在经典主题是 display:none，不能当基准；音量标签同在卡片内容边缘上） */
  /* ★ 补31 → 控制芯批 3：窄屏收起档的左缘基准取第一个**可见**的——
     「BPM 96 ▾」读数钮（.ctl-pills）或芯顶胶囊行（.core-pills），两者同在内容边缘上 */
  out.title = (() => {
    const cands = [q(".ctl-pills .ctl-hit"), q(".core-pills .toggle-pill")];
    for (const el of cands){ if (el && el.getBoundingClientRect().width > 0) return textLeft(el); }
    return textLeft(cands[1]);
  })();
  out.toggle = textLeft(q(".core-pills .toggle-pill"));   // 控制芯批 3：开关移入 .core-pills 胶囊行
  /* ★★★ 控制芯批 6：芯顶胶囊行与滑杆塔同左缘——**必须在展开态量**（窄屏默认收起时
     .tg-body display:none，getBoundingClientRect 归零，量出来是假错位）。 */
  out.corePillsL = boxLeft(q(".core-pills"));
  out.towerL = boxLeft(q(".card-head-left .group .tg-body"));
  /* ★★★ v3.41.0（按《整体布局方案示意图》对账）：胶囊行**单行 + 居中**与**芯底读数行常显**。
     为什么必须新量：原来的「同左缘」量的是 .core-pills **容器**左缘，而容器恒满芯宽 ⇒
     对"是否折成两行""胶囊是否居中"完全无感——v3.41.0 之前全档折成两行（行高 82）也照样绿。 */
  out.pillGeom = (() => {
    const core = q(".card-head-left .group"), row = q(".core-pills");
    /* ★ v3.42.0 补：展开态的折叠小箭头在**非折叠档**是 display:none（rect 全 0）——它现在是胶囊行的
       行内 flex 项，不滤掉会把"单行/居中"判红（实测 tops=[124,124,124,0]、ctrOff 被拉偏 294px）。 */
    const kids = Array.from(document.querySelectorAll(".core-pills > *"))
      .filter(el => el.getBoundingClientRect().width > 0);
    if (!core || !row || !kids.length) return null;
    const c = core.getBoundingClientRect(), r = row.getBoundingClientRect();
    const rects = kids.map(el => el.getBoundingClientRect());
    const tops = rects.map(x => Math.round(x.top * 10) / 10);
    const l = Math.min.apply(null, rects.map(x => x.left));
    const rr = Math.max.apply(null, rects.map(x => x.right));
    return { rowH: Math.round(r.height * 10) / 10, singleLine: new Set(tops).size === 1,
      tops: tops, count: kids.length,
      ctrOff: Math.round(((l + rr) / 2 - (c.left + c.right) / 2) * 10) / 10 };
  })();
  out.progGeom = (() => {
    const el = document.getElementById("trainerProg");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height * 10) / 10, text: (el.textContent || "").trim() };
  })();
  /* ★ v3.39.0：上面的临时展开到此还原（后续 blockRects / grpWidths 等量**默认收起态**，
     不受污染——两套口径各量各的，与 portraitFixProbe「量完还原」同一纪律）。 */
  if (ctlExpand){ const cb = document.getElementById("ctlOpen"); if (cb) cb.checked = false; void document.body.offsetWidth; }
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
     "不得再有第 4 块"能被断言正面表达。
     ★ v3.39.0：BPM 组并入音量组 → 剩两块；保留第 3 位为 null 以便
     "BPM 独立块与行数拍号行都不得复活"能被断言正面表达。 */
  out.blockRects = [q(".card-head-left")]
    .map(el => { const r = el && el.getBoundingClientRect(); return r ? { l: round(r.left), w: round(r.width) } : null; });
  /* ★ 控制芯批 6（PLAN-v9）：开关列/行数拍号行已退役——正面钉"确已不在" */
  out.retiredBlocksGone = !q(".viz-toggles") && !q(".viz-rows-row");
  /* ★★★ 控制芯批 6（PLAN-v9）：**芯居中**几何读数（取代 v2.38/v2.39 的"左贴/左缘对齐"口径）——
     芯盒（.group）横向中心相对控制栅格中心的偏移（0 = 居中）。 */
  out.coreCtr = (() => {
    const g = q(".viz-head-grid .card-head-left .group"), grid = q(".viz-head-grid");
    if (!g || !grid) return null;
    const a = g.getBoundingClientRect(), b = grid.getBoundingClientRect();
    return { off: round((a.left + a.width / 2) - (b.left + b.width / 2)), w: round(a.width) };
  })();
  /* v3.13.0（丁方案）：控制区**限宽 1000 居中**的几何读数——
     gridW ≤ 1000；网格盒在卡片内容区内水平居中（两侧空白对称）。
     空白 = (容器−1000)/2，随窗口变大是**设计内**行为（恒定的是"盒宽"与"对称性"）。
     ★ v3.30.0：卡片盒收窄到 1048（抱控制区）后，"容器"不再是跑道宽，而是卡片内容区
     （1048−48=1000）——两侧空白恒 0，blankL/blankR 随之失去区分度，但断言仍成立。
     ★ v3.39.0：v3.13 的"两列 1fr 等宽"口径随 BPM 组并入音量组退役（块数 3→2），
     leftW/bpmW 读数除名，只保留盒宽与对称性两个不变量。 */
  out.row1 = (() => {
    const g = q(".viz-head-grid"), card = q(".viz-head-grid") && q(".viz-head-grid").closest(".card");
    if (!g || !card) return null;
    const gr = g.getBoundingClientRect(), cr = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const innerL = round(cr.left + parseFloat(cs.paddingLeft));
    const innerR = round(cr.right - parseFloat(cs.paddingRight));
    return { w: round(gr.width),
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
     v3.3.0：**四块**——预设库块退役，「同屏行数与拍号」接替第 4 轨（不再是横跨整行的 r2）
     ★ v3.39.0：BPM 组并入音量组 → 两块（合并组 | 开关）；grpGaps（三卡等距）随块数 3→2
     失去"等距"判据退役，间距单一来源由 v2.42.7 的 row-gap:16 收口断言在别处把守。 */
  out.grpWidths = (() => {
    const els = [q(".card-head-left")];   /* 控制芯批 6（PLAN-v9）：开关列退役 ⇒ 只剩一张组容器卡 */
    return els.map(el => { const r = el && el.getBoundingClientRect(); return r ? round(r.width) : null; });
  })();
  return JSON.stringify(out);
})()`;
}

/** 在浏览器里跑一轮：打开 url → 等页面 → 取探针结果 + 控制台错误 */
/* ★★★ v3.33.15：编辑器头部布局哨兵（用户实拍「编辑节奏型头部被压扁」）。
   桩测不出布局，只有真机能量——而这条恰恰是纯布局缺陷：.editor-topbar 在 >640px 没有
   flex-wrap，容器又被 .editor-inner 的 max-width:1080 封顶在 1032px，而顶栏内容
   （返回练习 + 标题 + 拍数 + 长引用提示 + 两按钮）的 max-content ≈1540px
   ⇒ 三个子项一起被压缩：标题从词中间断行（「前」/「奏）」）、「返回练习」拆两行、
   按钮变竖排且最右那颗贴边被裁。
   触发条件是**引用提示非空**（正在编辑一个被曲式引用的型），而默认编辑一个没人引用的型时
   它是空串、头部分毫看不出问题——这正是它长期潜伏的原因。故本探针把触发条件直接造出来
   （写 textContent + 写标题，复刻用户截图那一态），再量真几何。
   ★ 复刻的是**输入状态**，被断言的是**布局结果**，不是"把答案写进去"。 */
function editorHeaderProbe(){
  return `(async function(){
    var q = function(s){ return document.querySelector(s); };
    var rd = function(n){ return Math.round(n); };
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var ed = q("#editor"), note = q("#editorRefNote"), top = q(".editor-topbar");
    if (!ed || !note || !top) return JSON.stringify({ err: "缺 #editor / #editorRefNote / .editor-topbar" });
    var wasOpen = ed.classList.contains("open");
    if (!wasOpen) ed.classList.add("open");
    var savedNote = note.textContent, ttl = q("#editorTitle"), savedTitle = ttl ? ttl.textContent : null;
    note.textContent = "「十六分满扫（《在他乡》前奏）」被 3 首曲式引用（《在他乡》（示例）、练习用（示例）、副歌慢练）——保存会生成新副本，现有曲式仍用原版；要替换请回编排页换型";
    if (ttl) ttl.textContent = "基于「十六分满扫（《在他乡》前奏）」创建 · 4/4 拍 · 1 小节";
    await frame();
    var lines = function(el){
      try{
        var rng = document.createRange(); rng.selectNodeContents(el);
        var rs = rng.getClientRects(), tops = {};
        for (var i=0;i<rs.length;i++){ if (rs[i].width<1||rs[i].height<1) continue; tops[Math.round(rs[i].top)]=1; }
        return Object.keys(tops).length;
      }catch(e){ return 0; }
    };
    var tr = top.getBoundingClientRect(), nr = note.getBoundingClientRect();
    var acts = q(".editor-actions");
    var bs = acts ? Array.prototype.slice.call(acts.querySelectorAll("button")) : [];
    var res = {
      vw: window.innerWidth,
      inTopbar: top.contains(note),
      topH: rd(tr.height), topBottom: rd(tr.bottom),
      noteTop: rd(nr.top), noteH: rd(nr.height),
      titleLines: ttl ? lines(ttl) : 0,
      titleW: ttl ? rd(ttl.getBoundingClientRect().width) : 0,
      btns: bs.map(function(b){
        return { t: b.textContent.trim(), w: rd(b.getBoundingClientRect().width),
                 h: rd(b.getBoundingClientRect().height), lines: lines(b) };
      })
    };
    note.textContent = savedNote;
    if (ttl && savedTitle !== null) ttl.textContent = savedTitle;
    if (!wasOpen) ed.classList.remove("open");
    return JSON.stringify(res);
  })()`;
}
/* ★★★ v3.33.21：③ 精修 分组**折叠的真机闸**（用户实报「无法折叠」）。
   为什么必须真机：桩环境没有 CSS，`m.hidden === true` 在桩里恒绿——而真机上
   `.arg-mini{display:inline-flex}` 会盖过 UA 给 [hidden] 的 display:none，
   于是 hidden 设了、按钮照旧显示。故这里**不读 hidden 属性，只量高度**：
   收起后该组按钮的 getBoundingClientRect().height 之和必须为 0。
   这条能同时罩住"折叠失效"与将来任何"显隐被样式盖过"的回归。 */
function refineGroupProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange) return JSON.stringify({ err: "无 __beat.Arrange" });
    var res = { vw: window.innerWidth };
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "Arrange.open 失败 " + e.message }); }
    await frame();
    var secs = document.getElementById("argSections");
    if (!secs || !secs.children.length) return JSON.stringify({ err: "无段" });
    var sum = secs.children[0].querySelector(".arg-lyric-sum");
    if (!sum) return JSON.stringify({ err: "无歌词摘要行" });
    sum.click();
    await frame();
    var heads = document.querySelectorAll(".arg-lyric-grp");
    res.heads = heads.length;
    if (heads.length < 3) return JSON.stringify({ err: "组头不足（" + heads.length + "）" });
    var head = heads[2];
    var ly = head.parentNode;
    var kids = Array.prototype.slice.call(ly.children);
    var start = kids.indexOf(head);
    var members = [];
    for (var i = start + 1; i < kids.length; i++){
      var el = kids[i];
      var cn = el.className || "";
      if (/arg-lyric-grp|arg-lyric-rowsep|arg-lyric-head|arg-lyric-lane/.test(cn)) break;
      if (/(^| )arg-mini( |$)/.test(cn)) members.push(el);
    }
    res.members = members.length;
    if (!members.length) return JSON.stringify({ err: "该组无成员" });
    var sumH = function(){ var t = 0; for (var k = 0; k < members.length; k++) t += members[k].getBoundingClientRect().height; return Math.round(t); };
    res.hBefore = sumH();
    head.click();
    await frame();
    res.expandedAfterCollapse = head.getAttribute("aria-expanded");
    res.allHidden = members.every(function(m){ return m.hidden === true; });
    res.hAfterCollapse = sumH();          // ★ 真机证据：必须是 0
    head.click();
    await frame();
    res.hAfterExpand = sumH();
    try{ B.Arrange.close(); }catch(e){ }
    return JSON.stringify(res);
  })()`;
}

/* ★★★ v3.36.19：段行「块」列表的横向滚动真机闸（用户实报「竖屏下新增块那一带比例不对」）。
   为什么必须真机：桩环境没有 CSS，flex:none / white-space / align-items 在桩里根本不存在——
   两个块被压扁、型名竖排、overflow-x:auto 永不触发，全是**只有浏览器能看见**的行为。
   为什么不能只靠"1440px 下量一量"：本冒烟跑在 1440×1000，主列 1004px，两个块放得下、症状不出现。
   故探针**主动把块行压窄到 280px** 造出"放不下"的条件，再量三件事：
     · 块宽是否**跟着缩**（有 flex:none 就不缩——这是「被压扁」的直接否定式）；
     · 容器是否转为**可横向滚动**（overflow-x:auto 真的接住了）；
     · 「+ 块」是否被 stretch 拉成整行高。
   三条合起来与视口宽度无关，1440px 下也测得出。 */
/* ★★★ v3.36.20：段卡片「放不下就横滑」的真机闸（用户拍板：精修按钮不换行 + 歌词区横滑）。
   为什么必须真机：overflow / min-width / 换行全是 CSS 行为，桩里根本不存在；而本冒烟跑在
   1440×1000（卡片 956px、装得下）——症状不出现。故探针**主动把卡片压窄到 360px**，
   造出"放不下"的条件，量三件事：
     · 精修控件的**视觉行数**是否与宽屏一致（不许多折行）——按"垂直中心"分组，
       同行按钮高度不同，按 top 分会误判成多行；
     · .arg-lyric 是否保住了最小宽度（窄屏改为横滑，而不是把格压小）；
     · 卡片是否真的成为横向滚动容器（内容收进卡片内，不再画到边框外）。
   与视口宽度无关，1440px 下也测得出。 */
/* ★★★ v3.36.20 补：卡片右缘**留白**的真机闸（用户实报「歌词行依然压在边缘上」）。
   为什么必须真机、且必须**量几何**：滚动容器的可视区就是 padding box ⇒ 内容会一直排到边框。
   所以"有没有留白"完全取决于**卡片可见边缘与 padding box 右缘之间的距离**，
   这是布局几何、桩里没有；而把它做成"内容有没有画进留白"得逐像素读屏，噪声大且易 flaky。
   留白 = cardRect.right − (cardRect.left + borderLeft + card.clientWidth)。
   补这条 CSS 之前：padding-right:14 + border-right:1 ⇒ 留白 **1px**（内容一直画到边框上）；
   补之后：那 14px 从内边距挪到透明右边框 ⇒ 留白 **15px**。故阈值取 ≥14，两端都量。 */
function cardGutterProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange) return JSON.stringify({ err: "无 __beat.Arrange" });
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "Arrange.open 失败 " + e.message }); }
    await frame();
    var pick = function(){
      var cs = [].slice.call(document.querySelectorAll(".arg-sec"));
      for (var i = 0; i < cs.length; i++){ if (cs[i].querySelectorAll(".arg-lyric-row").length >= 3) return cs[i]; }
      return null;
    };
    var card = pick();
    for (var k = 0; k < 8 && !card; k++){
      var sums = [].slice.call(document.querySelectorAll(".arg-lyric-sum"));
      if (k >= sums.length) break;
      sums[k].click();
      await frame(); await frame();
      card = pick();
    }
    if (!card) return JSON.stringify({ err: "点开后仍没有多行歌词网格" });
    /* ★ 必须把这张卡标成 **当前段**再量 —— 这正是本闸门第一版漏掉的状态：
       cur-sec 是单例（t146 钉着"同一时刻至多一段"），而"留白看不见"的 bug 只在这一段暴露
       （那条蓝内环是 .cur-sec 专有）。不标的话量的是"别人家的段"，永远绿。 */
    card.classList.add("cur-sec");
    await frame();
    var gutterOf = function(){
      var cr = card.getBoundingClientRect(), k = getComputedStyle(card);
      var bl = parseFloat(k.borderLeftWidth);
      var spRight = cr.left + bl + card.clientWidth;   /* 滚动可视区右缘 = 内容能画到的最远处 */
      return Math.round(cr.right - spRight);
    };
    var ck = getComputedStyle(card);
    var res = { wideGutter: gutterOf(), wideScrollable: card.scrollWidth > card.clientWidth,
                bgImage: (ck.backgroundImage || "none").slice(0, 60),
                insetShadow: (ck.boxShadow || "none").indexOf("inset") >= 0,
                outlineW: parseFloat(ck.outlineWidth) || 0,
                outlineOff: ck.outlineOffset,
                /* ★ v3.36.20 补4：块行必须与卡片**共用同一条横滑轴** */
                blocksOverflowX: (function(){ var b = card.querySelector(".arg-blocks"); return b ? getComputedStyle(b).overflowX : null; })(),
                blocksOwnScroller: (function(){ var b = card.querySelector(".arg-blocks"); return b ? (b.scrollWidth > b.clientWidth + 1) : null; })() };
    /* 卡片滚到最右时，**最后一颗块**必须能进到卡片可视区内（证明它跟着卡片滚、没被自己那层裁掉） */
    var blk = card.querySelector(".arg-blocks");
    var chips = blk ? [].slice.call(blk.children) : [];
    if (chips.length){
      var padBoxR = card.getBoundingClientRect().left + parseFloat(ck.borderLeftWidth) + card.clientWidth;
      card.scrollLeft = card.scrollWidth;
      res.lastChipReachable = chips[chips.length - 1].getBoundingClientRect().right <= padBoxR + 1;
      card.scrollLeft = 0;
    } else { res.lastChipReachable = null; }
    card.style.width = "360px";
    await frame();
    res.narrowGutter = gutterOf();
    res.narrowScrollable = card.scrollWidth > card.clientWidth;
    res.narrowCardW = Math.round(card.getBoundingClientRect().width);
    card.style.width = "";
    await frame();
    try{ B.Arrange.close(); }catch(e){ }
    return JSON.stringify(res);
  })()`;
}
function lyricScrollProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange) return JSON.stringify({ err: "无 __beat.Arrange" });
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "Arrange.open 失败 " + e.message }); }
    await frame();
    /* 冒烟默认状态下没有展开的歌词网格（编辑区是点摘要行才展开的）⇒ 探针自己点开一节。
       ★ 点摘要会**整树重建** #argSections ⇒ 每轮都必须**重新查询**，不能沿用旧引用
         （沿用旧引用会一直读到已脱离文档的旧节点——这正是本仓反复踩过的"桩比真机宽松"同类坑）。 */
    var pick = function(){
      var cs = [].slice.call(document.querySelectorAll(".arg-sec"));
      for (var i = 0; i < cs.length; i++){ if (cs[i].querySelectorAll(".arg-lyric-row").length >= 3) return cs[i]; }
      return null;
    };
    var card = pick();
    for (var k = 0; k < 8 && !card; k++){
      var sums = [].slice.call(document.querySelectorAll(".arg-lyric-sum"));
      if (k >= sums.length) break;
      sums[k].click();
      await frame(); await frame();
      card = pick();
    }
    if (!card) return JSON.stringify({ err: "点开后仍没有多行歌词网格" });
    var ly = card.querySelector(".arg-lyric");
    var lane = card.querySelector(".arg-lyric-lane");
    var barrow = lane.querySelector(".arg-lyric-barrow");
    var rowsOf = function(){
      var els = [].slice.call(ly.children).filter(function(c){
        if (c.hidden) return false;
        if (!/arg-mini|arg-lyric-grp/.test(c.className)) return false;
        return c.getBoundingClientRect().width > 0;
      });
      var seen = {};
      els.forEach(function(e){ var r = e.getBoundingClientRect(); seen[Math.round(r.top + r.height / 2)] = 1; });
      return Object.keys(seen).length;
    };
    var res = { wideRows: rowsOf(), wideLyW: Math.round(ly.getBoundingClientRect().width),
                wideBarrowW: Math.round(barrow.getBoundingClientRect().width) };
    card.style.width = "360px";
    /* ★★ 必须先**中和"摘要行文字碰巧够长"这个偶然因素**——这是本闸门第一版栽过的坑：
       1440px 下那段歌词预览文字自己就能把 .arg-lyric 的 min-content 顶到 ~488px，
       于是"行数不变""格没被压小"在**没写任何 min-width 的版本**上也是绿的（假绿）。
       加一条临时样式把摘要行的最小宽度按掉，量到的才是**真正由 .arg-lyric:has(...) 那条规则**
       决定的宽度。（变异 M2 = 删掉那条规则：此时下面 narrowLyW 会掉到卡片宽，
       与 strippedLyW 相等 ⇒ ruleEffective 变 false ⇒ 具名变红。） */
    /* ★ 中和的对象必须是**那两个 white-space:nowrap 的预览**，不是 .arg-lyric-sum 的 min-width:
       给摘要行设 min-width:0 只是允许它在 flex 算法里收缩，**并不改变它对 .arg-lyric 的
       min-content 贡献**（它的 min-content = 预览那串不断行文字 ≈ 488px）。
       实测过这条路：只设 .arg-lyric-sum{min-width:0} 时，撤掉规则的变异体仍量到 488px、
       闸门照样全绿。display:none 才是真正把这份贡献拿掉。 */
    var st = document.createElement("style");
    st.textContent = ".arg-lyric-preview{display:none}.arg-lyric-sum{min-width:0}";
    document.head.appendChild(st);
    await frame();
    res.narrowRows = rowsOf();
    res.narrowLyW = Math.round(ly.getBoundingClientRect().width);
    res.narrowBarrowW = Math.round(barrow.getBoundingClientRect().width);
    res.scrollable = card.scrollWidth > card.clientWidth;
    res.overflowX = getComputedStyle(card).overflowX;
    res.cardPaintedW = Math.round(card.getBoundingClientRect().width);
    /* 自证式反证：在这同一条件下再把 .arg-lyric 的最小宽度就地摘掉，量"规则缺席"的基线 */
    ly.style.minWidth = "0";
    await frame();
    res.strippedLyW = Math.round(ly.getBoundingClientRect().width);
    res.strippedRows = rowsOf();
    ly.style.minWidth = "";
    st.remove();
    card.style.width = "";
    await frame();
    res.ruleEffective = res.narrowLyW > res.strippedLyW + 20;
    res.keptRows = res.narrowRows === res.wideRows;
    /* 无量纲判据：压窄后歌词格**比卡片还宽**（⇒ 必须横滑），而不是被压到卡片宽。
       若哪天有人撤掉 min-width，这里会变成 narrowBarrowW < cardPaintedW 立刻红。 */
    res.keptScale = res.narrowBarrowW > res.cardPaintedW;
    try{ B.Arrange.close(); }catch(e){ }
    return JSON.stringify(res);
  })()`;
}
/* ★★★ v3.38.1：音高标注的真机几何闸——三档槽位（高贴顶 / 中居中 / 低贴底）、点挂数码**右侧**、
   以及窄格三级降级的真机形态（把歌词轨压到 200px 强制走窄格 ⇒ 点必须被隐藏）。
   为什么必须真机：槽位是 :has() + 绝对定位、点在右侧是 flex 行 + align-self、降级靠 CSS 显隐——
   桩里没有布局，这三条在桩里一条都测不到（t227 只能钉类名与源码）。
   探针自带还原：量完把原歌词行写回并重建，不给后续断言留副作用。 */
/* ★★★ v3.38.1 补6（用户拍板）：**顶部三块的 12 档真机闸**。
   判据（用户给的五条，逐条对应下面断言块里的一条）：
     ① 列数 = floor((可用宽 + 列距) / (min_w + 列距)) —— 列数由 min-content 与列距**算出来**，不硬编；
     ② 行内空白率 ≤ 15%（块撑不满那一行就等于白留一条）；
     ③ 相邻块间距 ≤ 24px（目标 12–16px）；
     ④ 无横向溢出（容器与文档都不许出现滚动）；
     ⑤ 展开任一参数槽后**列数不变**（音量 / 变速训练两处，展开即重排是最刺眼的抖动；
        ★ v3.39.0：BPM 组并入音量组后顶部只剩两块，BPM 槽随合并除名）。
   为什么先建闸再改代码：auto-fit 网格与 flex-wrap 直改两条老路都是"改完才发现既有几何冒烟红"，
   来回两轮。这次把判据先落成会红的闸。
   ★ 探针只量**一个视口**（驱动侧按 12 档循环改 deviceMetrics）——重排必须在真实视口变化之后发生。 */
function topBlocksProbe(){
  return `(function(){
    var g = document.querySelector(".viz-head-grid");
    if (!g) return JSON.stringify({ err: "无 .viz-head-grid" });
    var cs = getComputedStyle(g);
    var gr = g.getBoundingClientRect();
    var avail = Math.round((gr.width - (parseFloat(cs.paddingLeft) || 0)
      - (parseFloat(cs.paddingRight) || 0)) * 10) / 10;
    var collect = function(){
      var items = [];
      var push = function(el){
        var pos = getComputedStyle(el).position;
        if (pos === "absolute" || pos === "fixed") return;   /* 脱离文档流 ⇒ 不占轨道 */
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        var cls = String(el.className || el.id || "?").split(" ").filter(function(x){
          return x && x !== "card-head" && x !== "viz-head"; }).slice(0, 2).join(".");
        /* min-content：定 --min-w 的**唯一依据**（用户口径：先量三块再定数）。
           量法：临时 width:min-content + flex:none，读完立刻还原（不留副作用）。 */
        var ow = el.style.width, of = el.style.flex, omin = el.style.minWidth;
        el.style.width = "min-content"; el.style.flex = "none"; el.style.minWidth = "0";
        var minC = el.offsetWidth;
        el.style.width = ow; el.style.flex = of; el.style.minWidth = omin;
        items.push({ cls: cls, left: Math.round(r.left - gr.left), right: Math.round(r.right - gr.left),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          w: Math.round(r.width * 10) / 10, minC: minC });
      };
      [].slice.call(g.children).forEach(function(c){
        var d = getComputedStyle(c).display;
        if (d === "contents" || d === "none"){ if (d === "contents") [].slice.call(c.children).forEach(push); }
        else push(c);
      });
      items.sort(function(a, b){ return a.top - b.top || a.left - b.left; });
      /* 行 = **纵向有重叠**的一组，不是"top 相等"的一组：
         align-self:end / stretch 都会让同一行的块 top 不同（开关列贴底对齐时差几十像素），
         按 top 相等分行会把它算成"两个单块行"——列数直接判成 1、空白率 51%（本闸第一版就这么误报过）。
         行内空白率 = 1 − (块宽和 + 列距×(n−1)) / 可用宽。 */
      var rows = [];
      items.forEach(function(it){
        var row = rows[rows.length - 1];
        if (row && it.top < row.bottom - 1){
          row.items.push(it);
          if (it.bottom > row.bottom) row.bottom = it.bottom;
        } else rows.push({ top: it.top, bottom: it.bottom, items: [it] });
      });
      var gap = parseFloat(cs.columnGap);
      if (!(gap >= 0)) gap = parseFloat(cs.gap) || 0;
      var content = rows.filter(function(r){
        return !(r.items.length === 1 && /ctl-pills/.test(r.items[0].cls)); });
      content.forEach(function(r){
        var used = r.items.reduce(function(a, x){ return a + x.w; }, 0) + gap * (r.items.length - 1);
        r.n = r.items.length;
        r.blankPct = avail > 0 ? Math.round((1 - used / avail) * 1000) / 10 : null;
        r.gapPx = [];
        for (var i = 1; i < r.items.length; i++) r.gapPx.push(Math.round((r.items[i].left - r.items[i - 1].right) * 10) / 10);
      });
      return { items: items, rows: content, cols: content.length ? Math.max.apply(null, content.map(function(r){ return r.n; })) : 0 };
    };
    var base = collect();
    /* 溢出读数在**基准态**取（展开动作可能有残留面板，别拿它当"正常态无溢出"） */
    var ovf0 = { x: Math.round((g.scrollWidth - g.clientWidth) * 10) / 10,
      doc: document.documentElement.scrollWidth - innerWidth };
    /* ⑤ 展开任一参数槽后列数不变：把参数槽切到展开态量一次列数，最后还原。
       ★ trainerToggle 走的是 openParamSlot("trainer")（就地开参数槽，不弹窗），正是"展开参数槽"。
       ★ 样本选**静音参数槽**（#muteToggle → #muteCfgPanel）：它是真正的"面板展开"，
         而且能干净地开→关（开关再点一次即收回）。不能用 #ctlOpen —— 那是**收起开关**
         （v3.39.0 起两枚合一），音量 + BPM 整块会随它 display:none（补7），可见块数一变
         列数当然变，那是设计不是回归。volOpen/bpmOpen 是它的前身（v3.39.0 合并退役）。 */
    var flipped = {};
    var mt = document.getElementById("muteToggle");
    var mtWas = mt ? mt.getAttribute("aria-checked") === "true" : null;
    var setMute = function(want){
      var el = document.getElementById("muteToggle");
      if (!el || (el.getAttribute("aria-checked") === "true") === want) return collect().cols;
      try{ el.click(); }catch(e){ return -1; }
      void g.offsetWidth;
      return collect().cols;
    };
    flipped.mute = setMute(true);
    flipped.muteBack = setMute(mtWas === true);
    void g.offsetWidth;
    var cols2 = collect().cols;
    return JSON.stringify({
      vw: innerWidth, vh: innerHeight, display: cs.display, wrap: cs.flexWrap,
      gridW: Math.round(gr.width * 10) / 10, avail: avail,
      gap: (function(){ var v = parseFloat(cs.columnGap); return v >= 0 ? v : (parseFloat(cs.gap) || 0); })(),
      minW: (cs.getPropertyValue("--min-w") || "").trim(),
      maxW: (cs.getPropertyValue("--max-w") || "").trim(),
      colGapVar: (cs.getPropertyValue("--col-gap") || "").trim(),
      /* v3.38.1 补7：各块**各自**的下限（补6 是一个 --min-w=280 通吃，那会把三列门槛
         从 776 抬到 864 ⇒ 明明挤得下却换行）。判据要用它们做装箱模拟。
         ★ v3.39.0：BPM 组并入音量组 → 下限只剩两块（--min-w-bpm 随独立组除名）。 */
      /* ★ 控制芯批 6（PLAN-v9）：开关列退役 ⇒ 可见块只剩**一块**（合并组），
         下限变量只剩 --min-w-vol（--min-w-sw 随之除名）。 */
      bases: ["--min-w-vol"].map(function(k){
        return parseFloat(cs.getPropertyValue(k)); }),
      /* 两块**当前是否参与排布**：收起方案（≤640/竖屏/矮屏）里音量 + BPM 整块默认
         display:none（v3.39.0 合并后 .card-head-left 一枚开关管整块），
         离开可见性子集去做装箱模拟会得出"应该并排"的错误期望（真机 899 档实测过）。 */
      vis: (function(){
        var see = function(sel){ var e = g.querySelector(sel); if (!e) return false;
          if (getComputedStyle(e).display === "none") return false;
          var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return { vol: see(".card-head-left"), sw: false };   /* 控制芯批 6（PLAN-v9）：开关列退役 */
      })(),
      /* ★ v3.39.0：原 align 字段（"预备拍行心 = BPM 步进行行心"）随 BPM 组并入音量组退役——
         BPM 步进行住进合并组左列、不再与开关列同行，行心对齐失去前提；新口径
         "开关首行与合并组第 1 行（节拍行）同线"由 layoutAuditProbe 的 alignCheck 把守
         （top 口径、两主题各量一次）。 */
      cols: base.cols, rows: base.rows, items: base.items,
      colsAfter: cols2, colsExpanded: flipped,
      overflowX: ovf0.x,
      docOverflow: ovf0.doc
    });
  })()`;
}
/* ★★★ v3.38.1 补10：**格子带底板闸**——"贴格子带的层"必须与格子同高、且不越出格子下缘。
   为什么值得单独一条真机闸：这一族漏过三次（v2.79.0 的 .seams/.beat-zone、v3.33.8 新增的
   .bar-row.current::before 又写死 44px）——每次都是"窄屏格子 34px、某层仍 44px ⇒ 多 10px
   落进歌词/标注带"（用户实拍："绿色遮罩主要盖扫弦区，但有一部分进了歌词行"）。
   量法：给首行临时挂 .current（那条底纹只在当前行存在），读 ::before 的计算高度与 .cell 的
   盒高/下缘，再还原 class（不污染播放中的 .current）。
   ★ 两档必须都量：桌面 44px / 窄屏(≤960) 34px —— 只量一档测不出"层没跟着缩"。 */
function bandProbe(){
  return `(function(){
    var row = document.querySelector("#viz .bar-row");
    if (!row) return JSON.stringify({ err: "无 .bar-row" });
    var cell = row.querySelector(".cell");
    if (!cell) return JSON.stringify({ err: "无 .cell" });
    var had = row.classList.contains("current");
    row.classList.add("current");
    void row.offsetWidth;                         /* 强制重排后再读计算样式 */
    var cs = getComputedStyle(row, "::before");
    var beforeH = parseFloat(cs.height);
    var beforeTop = parseFloat(cs.top);
    var out = {
      vw: innerWidth,
      cellH: Math.round(cell.offsetHeight * 10) / 10,
      cellBottom: Math.round((cell.offsetTop + cell.offsetHeight) * 10) / 10,
      beforeH: beforeH,
      beforeTop: beforeTop,
      beforeBottom: Math.round((beforeTop + beforeH) * 10) / 10,
      cellHVar: getComputedStyle(document.documentElement).getPropertyValue("--cell-h").trim(),
      yB2: getComputedStyle(document.documentElement).getPropertyValue("--yB2").trim()
    };
    var lr = document.querySelector("#lyricLane .lyric-row");
    out.lyricTop = lr ? Math.round(lr.getBoundingClientRect().top - row.getBoundingClientRect().top) : null;
    if (!had) row.classList.remove("current");
    void row.offsetWidth;
    return JSON.stringify(out);
  })()`;
}
function pitchMarkProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Viz || !B.Store) return JSON.stringify({ err: "无 __beat.Viz/Store" });
    try{
      var arrs = B.Store.arranges;   /* Store.arranges 是**数组**（不是取值函数） */
      var a = arrs && arrs[0];
      if (!a || !a.sections || !a.sections.length) return JSON.stringify({ err: "无曲式（示例曲未带出）" });
      var sec = a.sections[0];
      var before = null;
      try{ before = B.Store.findLyric(a.id, sec.uid); }catch(e){ before = null; }
      /* 三颗三十二分音符：高八度 / 本位 / 低两个八度（2 颗点 = 最宽的标记） */
      B.Store.upsertLyric(a.id, sec.uid,
        [{ t: 0, dur: 24, ch: "高" }, { t: 24, dur: 24, ch: "中" }, { t: 48, dur: 24, ch: "低" }, { t: 72, dur: 24, ch: "记" }],
        { notes: [{ t: 0, dur: 24, p: 72 }, { t: 24, dur: 24, p: 60 }, { t: 48, dur: 24, p: 36 }, { t: 72, dur: 24, p: 66 }] });
      (function(){var g=document.getElementById("pitchNotationGroup");if(g)g.querySelectorAll(".pill")[1].click();})();
      B.Store.S.playMode = "arrange";
      B.Store.S.arrangeSel = { id: a.id, from: 0, to: 0, loop: true };
      var lane = document.getElementById("lyricLane");
      if (!lane) return JSON.stringify({ err: "无 #lyricLane" });
      var measure = function(){
        var out = [];
        var chips = [].slice.call(lane.querySelectorAll(".lyric-chip"));
        chips.forEach(function(ch){
          if (/notechip/.test(ch.className)) return;
          var g = ch.querySelector(".lyric-pit .jp-g");
          if (!g) return;
          var body = g.querySelector(".jp-body");
          var dots = g.querySelector(".jp-dots");
          var cr = ch.getBoundingClientRect();
          var br = body ? body.getBoundingClientRect() : g.getBoundingClientRect();
          var shown = dots ? (getComputedStyle(dots).display !== "none") : false;
          var gr = g.getBoundingClientRect();
          var ccEl = ch.querySelector(".lyric-char");
          var ccr = ccEl ? ccEl.getBoundingClientRect() : null;
          var dr = (dots && shown) ? dots.getBoundingClientRect() : null;
          var accEl = g.querySelector(".jp-acc");
          var ar = accEl ? accEl.getBoundingClientRect() : null;
          out.push({
            oct: /oct-hi/.test(g.className) ? "hi" : (/oct-lo/.test(g.className) ? "lo" : "mid"),
            txt: g.textContent,
            accTxt: accEl ? accEl.textContent : null,
            accX: ar ? Math.round((ar.left - cr.left) * 10) / 10 : null,
            w: Math.round(cr.width * 10) / 10,
            numTop: Math.round((br.top - cr.top) * 10) / 10,
            dotGap: dr ? Math.round((dr.left - br.right) * 10) / 10 : null,
            clipRight: dr ? Math.round((cr.right - dr.right) * 10) / 10 : null,
            hasDots: !!dots,
            dotsShown: shown,
            fit: /pitch-num-only/.test(g.className) ? "num" : (/pitch-col/.test(g.className) ? "col" : "row"),
            chipH: Math.round(cr.height * 10) / 10,
            dotTop: dr ? Math.round((dr.top - br.top) * 10) / 10 : null,
            dotTop2: dr ? Math.round((dr.top - br.bottom) * 10) / 10 : null,
            dotBottom: dr ? Math.round((dr.bottom - br.top) * 10) / 10 : null,
            dotTopC: dr ? Math.round((dr.top - cr.top) * 10) / 10 : null,
            dotBottomC: dr ? Math.round((dr.bottom - cr.top) * 10) / 10 : null,
            bodyTop: Math.round(br.top - cr.top) * 10 / 10,
            bodyBottom: Math.round(br.bottom - cr.top) * 10 / 10,
            dx: dr ? Math.round((dr.left + dr.width / 2 - (br.left + br.width / 2)) * 10) / 10 : null,
            centered: Math.round((br.top + br.height / 2 - (cr.top + cr.height / 2)) * 10) / 10,
            gTop: Math.round((gr.top - cr.top) * 10) / 10,
            gBot: Math.round((gr.bottom - cr.top) * 10) / 10,
            bodyL: Math.round((br.left - cr.left) * 10) / 10,
            bodyR: Math.round((br.right - cr.left) * 10) / 10,
            bodyB: Math.round((br.bottom - cr.top) * 10) / 10,
            dotL: dr ? Math.round((dr.left - cr.left) * 10) / 10 : null,
            dotR: dr ? Math.round((dr.right - cr.left) * 10) / 10 : null,
            dotB: dr ? Math.round((dr.bottom - cr.top) * 10) / 10 : null,
            charL: ccr ? Math.round((ccr.left - cr.left) * 10) / 10 : null,
            charR: ccr ? Math.round((ccr.right - cr.left) * 10) / 10 : null,
            /* ★ 补9：字形（Range）左右缘——元素盒横跨整格时恒等于左内缩，"靠左还是靠右"量不出来 */
            charGlyphL: (function(){ try{ if (!ccEl) return null; var rg = document.createRange();
              rg.selectNodeContents(ccEl); var gb = rg.getBoundingClientRect();
              return Math.round((gb.left - cr.left) * 10) / 10; }catch(e){ return null; } })(),
            charGlyphR: (function(){ try{ if (!ccEl) return null; var rg2 = document.createRange();
              rg2.selectNodeContents(ccEl); var gb2 = rg2.getBoundingClientRect();
              return Math.round((gb2.right - cr.left) * 10) / 10; }catch(e){ return null; } })(),
            charB: ccr ? Math.round((ccr.bottom - cr.top) * 10) / 10 : null
          });
        });
        return out;
      };
      /* ★ v3.38.1：**nm 档的宽格几何**——「音名 vs 歌词字」不相交判据在这里量。
         为什么单独量一遍：measure() 只认 .jp-g（简谱 glyph），nm 档里根本没有它；
         而 nm 档的「字」与「名」是**两条绝对定位**（一个靠左、一个靠右），是否相交
         只有真机 rect 说得清（桩里没有布局）。 */
      var measureNm = function(){
        var out = [];
        var chips = [].slice.call(lane.querySelectorAll(".lyric-chip"));
        chips.forEach(function(ch){
          var nmEl = ch.querySelector(".lyric-pit .pit-nm");
          if (!nmEl) return;
          var cr = ch.getBoundingClientRect();
          var cc = ch.querySelector(".lyric-char");
          var ccr = cc ? cc.getBoundingClientRect() : null;
          var nr = nmEl.getBoundingClientRect();
          out.push({
            txt: nmEl.textContent,
            chipW: Math.round(cr.width * 10) / 10,
            chipH: Math.round(cr.height * 10) / 10,
            nameL: Math.round((nr.left - cr.left) * 10) / 10,
            nameR: Math.round((nr.right - cr.left) * 10) / 10,
            charL: ccr ? Math.round((ccr.left - cr.left) * 10) / 10 : null,
            charR: ccr ? Math.round((ccr.right - cr.left) * 10) / 10 : null,
            /* ★ 补9：字形（Range）左右缘——元素盒横跨整格时恒等于左内缩，"靠左还是靠右"量不出来 */
            charGlyphL: (function(){ try{ if (!ccEl) return null; var rg = document.createRange();
              rg.selectNodeContents(ccEl); var gb = rg.getBoundingClientRect();
              return Math.round((gb.left - cr.left) * 10) / 10; }catch(e){ return null; } })(),
            charGlyphR: (function(){ try{ if (!ccEl) return null; var rg2 = document.createRange();
              rg2.selectNodeContents(ccEl); var gb2 = rg2.getBoundingClientRect();
              return Math.round((gb2.right - cr.left) * 10) / 10; }catch(e){ return null; } })(),
            charTxt: cc ? cc.textContent : null
          });
        });
        return out;
      };
      B.Viz.buildViz();
      await frame(); await frame();
      var res = { wide: measure(), wideLaneW: Math.round(lane.getBoundingClientRect().width) };
      /* ★ v3.38.1：切到 nm 档量一遍**宽格**几何，再切回简谱。
         为什么要单独这一趟：本探针的四颗种子是 24t（格约 172px），nm 档才有位置同时放下
         「字（靠左）+ 名（靠右）」；窄格里音名会被 nmMarkHidden 整枚隐掉 ⇒ 量不到不可相交这件事。 */
      (function(){var g=document.getElementById("pitchNotationGroup");if(g)g.querySelectorAll(".pill")[2].click();})();
      B.Viz.buildViz();
      await frame(); await frame();
      res.wideNm = measureNm();
      (function(){var g=document.getElementById("pitchNotationGroup");if(g)g.querySelectorAll(".pill")[1].click();})();
      B.Viz.buildViz();
      await frame(); await frame();
      /* 强制窄格：压到 200px 再重建——降级档在**构建时**算，故必须重建才生效 */
      /* ★ 压窄的必须是**主列**（#viz 与 lane 一起变窄）——v3.38.1 的实现按 #viz 宽判档，
         而 overlay 模式下 lane 自己的 width 是之后被 placeLaneOverlay 写上的：
         只改 lane.style.width 会被覆写回全宽（实测 1392px），那不构成"真窄格"。 */
      var col = document.querySelector(".col");
      var oldColW = col ? col.style.width : "";
      if (col) col.style.width = "260px";
      B.Viz.buildViz();
      await frame(); await frame();
      res.narrow = measure();
      res.narrowLaneW = Math.round(lane.getBoundingClientRect().width);
      /* ★ nm 档在同样窄的格里：**整枚不画**（v3.38.1 用户拍板）——有 chip、但无 .pit-nm 标记 */
      (function(){var g=document.getElementById("pitchNotationGroup");if(g)g.querySelectorAll(".pill")[2].click();})();
      /* ★ 注意：主列 260px 时实测最窄格是 16.3px（lane 有最小宽，不是线性的 260/32），
         刚好在 nm 两字符需求 15.8px **之上** ⇒ 必须再压一档才构成真窄格。 */
      if (col) col.style.width = "80px";
      B.Viz.buildViz();
      await frame(); await frame();
      /* ★ 只认**本探针自己种的那四颗**（按字认，不按宽度猜）：它们都是 6t 的格子，
         而曲式的拆行下限护的是"型内最短时值"，6t 只有它的一半 ⇒ 这几格才可能真窄。 */
      var nmChips = lane.querySelectorAll(".lyric-chip");
      var nmSeed = 0, nmSeedMarked = 0, nmSeedW = 999;
      for (var ci = 0; ci < nmChips.length; ci++){
        var chTxt = nmChips[ci].querySelector(".lyric-char");
        var t2 = chTxt ? (chTxt.textContent || "") : "";
        if (["高", "中", "低", "记"].indexOf(t2) < 0) continue;
        nmSeed++;
        nmSeedW = Math.min(nmSeedW, Math.round(nmChips[ci].getBoundingClientRect().width * 10) / 10);
        var pmk = nmChips[ci].querySelector(".lyric-pit .pit-nm");
        if (pmk && pmk.textContent) nmSeedMarked++;
      }
      res.nmNarrow = { chips: nmChips.length, narrowN: nmSeed, narrowMarked: nmSeedMarked, seedW: nmSeedW };
      B.Store.S.pitchNotation = "jp";
      if (col) col.style.width = oldColW;
      B.Viz.buildViz();
      await frame(); await frame();
      /* ★ 降号体系：同一个半音换写法（#4 → b5）；量完还原（不写 accSys ⇒ 回到按调名推导） */
      var saveA = { id: a.id, name: a.name, sections: a.sections };
      if (typeof a.key === "string") saveA.key = a.key;
      try{
        B.Store.upsertArrange(Object.assign({}, saveA, { accSys: "flat" }));
        B.Viz.buildViz();
        await frame(); await frame();
        res.flat = measure();
      }catch(e){ res.flatErr = String((e && e.message) || e); }
      try{ B.Store.upsertArrange(saveA); }catch(e){ }
      /* 还原原歌词行 + 重建：不留副作用 */
      try{
        if (before && before.chars && before.chars.length) B.Store.upsertLyric(a.id, sec.uid, before.chars, { notes: before.notes || [] });
        else B.Store.deleteLyric(a.id, sec.uid);
      }catch(e){ }
      B.Viz.buildViz();
      await frame();
      return JSON.stringify(res);
    }catch(e){ return JSON.stringify({ err: String((e && e.message) || e) }); }
  })()`;
}
function blockRowProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange) return JSON.stringify({ err: "无 __beat.Arrange" });
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "Arrange.open 失败 " + e.message }); }
    await frame();
    var secs = [].slice.call(document.querySelectorAll(".arg-sec"));
    var sec = null;
    for (var i = 0; i < secs.length; i++){ if (secs[i].querySelectorAll(".arg-block").length >= 2){ sec = secs[i]; break; } }
    if (!sec) return JSON.stringify({ err: "没有含 2 个及以上块的段" });
    var blocks = sec.querySelector(".arg-blocks");
    var blk = blocks.querySelector(".arg-block");
    var add = blocks.children[blocks.children.length - 1];
    var W = function(e){ return Math.round(e.getBoundingClientRect().width); };
    var H = function(e){ return Math.round(e.getBoundingClientRect().height); };
    var res = { blkW: W(blk), blockH: H(blk), nameW: W(blk.firstChild), nameH: H(blk.firstChild), addH: H(add) };
    /* ★ v3.36.20 补12：造「放不下」的条件改成**相对 chip 自身**（原写死 280px）。
       写死像素自带的坑：chip 自然宽是**字体相关**的（本机 macOS 353px、GitHub CI 的 Linux 字体 292px），
       若某天渲染到 <280px，这个"压窄"就变成空转——测不出任何东西却仍然绿。 */
    blocks.style.maxWidth = Math.max(140, Math.round(res.blkW * 0.8)) + "px";
    await frame();
    res.narrowBlkW = W(blk);
    res.narrowNameH = H(blk.firstChild);
    res.scrollable = blocks.scrollWidth > blocks.clientWidth;
    res.narrowAddH = H(add);
    blocks.style.maxWidth = "";             /* 还原（探针不留状态） */
    await frame();
    res.kept = res.narrowBlkW >= res.blkW - 2;
    try{ B.Arrange.close(); }catch(e){ }
    return JSON.stringify(res);
  })()`;
}

/* [diag3] 把「我」拖到**空扫格**上，量落点是否与节奏型格子对齐（只报告）。
   用户实报：松手后仍对不上，且**只在空扫格出现**。P1《十六分满扫》的空扫格 = 1/2/5/7/8/9/13。 */
function lyricGhostAlignProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange) return JSON.stringify({ err: "no __beat" });
    try{ B.Arrange.open(); }catch(e){}
    await frame();
    var sums = document.querySelectorAll(".arg-lyric-sum");
    if (!sums.length) return JSON.stringify({ err: "no sum" });
    sums[0].click();
    await frame();
    var barrow = document.querySelector(".arg-lyric-barrow");
    if (!barrow) return JSON.stringify({ err: "no barrow" });
    var W = barrow.getBoundingClientRect().width, base = barrow.getBoundingClientRect().left;
    var barTicks = 192;
    var out = { W: Math.round(W) };
    /* 节奏型每一格的左缘（px，相对 barrow）——即"正确的对齐标尺" */
    var patBar = document.querySelector(".arg-pat-row .arg-pat-bar");
    out.cellEdges = patBar ? Array.prototype.slice.call(patBar.querySelectorAll(".arg-pat-cell"))
      .map(function(c){ return Math.round(c.getBoundingClientRect().left - base); }) : null;
    /* 歌词轨自己画的时值轮廓（.arg-lyric-note）——它是"节奏型的块"在歌词轨的复刻 */
    out.notes = Array.prototype.slice.call(barrow.querySelectorAll(".arg-lyric-note"))
      .slice(0, 18).map(function(n){ return n.style.left + "/" + n.style.width + (/(^| )rest( |$)/.test(n.className) ? "(rest)" : ""); });
    var chip0 = barrow.querySelector(".arg-lyric-chip");
    var tickFromPx = function(px){ return Math.round(px / W * barTicks); };
    out.before = { px: Math.round(chip0.getBoundingClientRect().left - base), tick: tickFromPx(chip0.getBoundingClientRect().left - base) };
    var r = chip0.getBoundingClientRect();
    var cx = r.left + r.width * 0.3, cy = r.top + r.height / 2;
    var mk = function(t2, x){ return new PointerEvent(t2, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: cy, buttons: 1 }); };
    chip0.dispatchEvent(mk("pointerdown", cx));
    var dx = -170, steps = 17;              /* 120 -> ~83 tick：落在空扫格 7/8 一带 */
    for (var s3 = 1; s3 <= steps; s3++){ window.dispatchEvent(mk("pointermove", cx + dx * s3 / steps)); await frame(); }
    var r2 = chip0.getBoundingClientRect();
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: cx + dx, clientY: cy, buttons: 0 }));
    await frame(); await frame();
    var chipA = document.querySelector(".arg-lyric-chip");
    var px = Math.round(chipA.getBoundingClientRect().left - base);
    var tk = tickFromPx(px);
    out.after = { px: px, tick: tk, onCell: out.cellEdges ? out.cellEdges.indexOf(px) : null,
                  pxPerCell: Math.round(W / 16), pxModCell: px % Math.round(W / 16) };
    out.label = (chipA.getAttribute("aria-label") || "").slice(0, 30);
    try{ B.Arrange.close(); }catch(e){}
    return JSON.stringify(out);
  })()`;
}

/* ★★★ v3.33.22：歌词拖动**行归属**的真机闸（v3.33.18 的 rowOfY 修复，此前零自动化覆盖）。
   ★ 为什么必须**自造夹具**：`geo` 只在 lctx.rows > 1 时构建，而示例曲那些段在真机里
     都是**单行**（上一轮 dump 实测 barrows 恒 [1]）⇒ 那条路径从不执行、覆盖率闸一直把
     rowOfY 列在「从未执行的函数」。故这里用 __beat.Store 现造一个**3 小节**的段（3 行）。
   闸的形态：把**第 1 行**的字块向右拖过"邻字半程"——按既有语义这会触发**换位**。
     · 修好后：row === row0 ⇒ overR 生效 ⇒ 换位 ⇒ **两个字**的时序互换
     · 行号算偏：sameRowGesture 假 ⇒ overR 归零 ⇒ 只会发生**移动**（一个字变），绝不换位
   ⇒ 断言 = "恰好 2 个字的 aria-label 变了"（用 label 而非 Store，免取 arrId/secUid）。 */
function lyricDragGateProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange || !B.Store) return JSON.stringify({ err: "no __beat" });
    var bar = [], i2;
    for (i2 = 0; i2 < 8; i2++) bar.push({ t: 24, dir: i2 % 2 ? "U" : "D" });
    var name = "DRAGGATE";
    B.Store.importPresets(JSON.stringify({ presets: [{ name: name, meter: 4, bars: [bar, bar, bar] }] }));
    var customs = B.Store.customs || [];
    var id = customs.length ? customs[customs.length - 1].id : null;
    if (!id) return JSON.stringify({ err: "import failed" });
    B.Store.upsertArrange({ name: "GATE曲式", sections: [
      { name: "段", blocks: [{ ref: { type: "custom", id: id }, repeats: 1 }] },
    ] });
    var arrs = B.Store.arranges || [];
    var arr = arrs[arrs.length - 1];
    var uid = arr.sections[0].uid;
    B.Store.upsertLyric(arr.id, uid, [
      { t: 0, dur: 24, ch: "一" }, { t: 24, dur: 24, ch: "二" }, { t: 48, dur: 24, ch: "三" }]);
    var out = { vw: window.innerWidth };
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "open failed" }); }
    await frame();
    var cur = document.querySelector(".arg-lyric-sum");
    /* 找到我们那条段（它是最后一条）：全部收起后逐条点开太慢，直接点最后一条的摘要 */
    var sums = document.querySelectorAll(".arg-lyric-sum");
    var target = sums[sums.length - 1];
    if (!target) return JSON.stringify({ err: "no sum" });
    target.click();
    await frame();
    var lane = null, ls = document.querySelectorAll(".arg-lyric-lane");
    for (i2 = 0; i2 < ls.length; i2++){
      if (ls[i2].querySelectorAll(".arg-lyric-barrow").length >= 2){ lane = ls[i2]; break; }
    }
    if (!lane){ try{ B.Store.deleteArrange(arr.id); }catch(e){} return JSON.stringify({ err: "still no multi-row lane" }); }
    var barrows = lane.querySelectorAll(".arg-lyric-barrow");
    out.rows = barrows.length;
    var chip = barrows[0].querySelector(".arg-lyric-chip");
    if (!chip) { try{ B.Store.deleteArrange(arr.id); }catch(e){} return JSON.stringify({ err: "no chip in row0" }); }
    /* ★ 落库会触发 arrangeRender() **整树重建** ⇒ 拖前抓的 lane 会变成冻结值。
       必须每次现取（这个坑我在 t201e 里已经踩过一次）。 */
    var snap = function(){
      var ls2 = document.querySelectorAll(".arg-lyric-lane"), L = null;
      for (var q = 0; q < ls2.length; q++){
        if (ls2[q].querySelectorAll(".arg-lyric-barrow").length >= 2){ L = ls2[q]; break; }
      }
      if (!L) return "";
      return Array.prototype.slice.call(L.querySelectorAll(".arg-lyric-chip"))
        .map(function(c){ return c.getAttribute("aria-label") || ""; }).join("|");
    };
    var before = snap();
    var r = chip.getBoundingClientRect();
    var cx = r.left + r.width * 0.3, cy = r.top + r.height / 2;
    var mk = function(t3, x, btns){ return new PointerEvent(t3, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: cy, buttons: btns }); };
    chip.dispatchEvent(mk("pointerdown", cx, 1));
    var dx = 150, steps = 15;
    for (i2 = 1; i2 <= steps; i2++){ window.dispatchEvent(mk("pointermove", cx + dx * i2 / steps, 1)); await frame(); }
    window.dispatchEvent(mk("pointerup", cx + dx, 0));
    await frame(); await frame();
    var after = snap();
    var a0 = before.split("|"), a1 = after.split("|"), diff = 0;
    for (i2 = 0; i2 < Math.max(a0.length, a1.length); i2++){ if (a0[i2] !== a1[i2]) diff++; }
    out.diffCount = diff;
    out.swapped = diff >= 2;
    out.before = before;
    out.after = after;
    try{ B.Store.deleteArrange(arr.id); }catch(e){}
    try{ B.Arrange.close(); }catch(e){}
    return JSON.stringify(out);
  })()`;
}

/* ★★★ v3.33.28：歌词**跨行拖动**的真机闸（用户实报「同行后面还有块 ⇒ 前面的块拖不到别的行」）。
   ★ 为什么必须真机：跨行这条路要 drag.geo（由每行真实矩形构建），桩里没有布局 ⇒ 恒 null。
   夹具要点：**同一行里放两个字**（A@0、B@24）——这正是用户描述的条件；
   再把 A 往下拖一行，断言它**真的落到了下一行**（起点 ≥ 一行 tick 数）。 */
function lyricRowMoveGateProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange || !B.Store) return JSON.stringify({ err: "no __beat" });
    /* ★ 夹具写进**当前显示的那条曲式**（示例曲）的「段 2」——它有 3 小节 ⇒ 天然多行。
       为什么不新建曲式：视图显示的是 S.arrangeSel.id 那条，而 upsertArrange 不会切选择
       （第一次就是栽在这：探针抓到的是示例曲自己的歌词）。 */
    var arr = B.Store.findArrange(B.DEMO_ID);
    if (!arr) return JSON.stringify({ err: "no demo arrange" });
    var sec = arr.sections[1];
    if (!sec) return JSON.stringify({ err: "demo section 1 missing" });
    /* ★ 甲、乙 在**同一行**（行 0）——这正是用户描述的触发条件；丙 在第 2 行 */
    B.Store.upsertLyric(arr.id, sec.uid, [
      { t: 0, dur: 24, ch: "甲" }, { t: 24, dur: 24, ch: "乙" },
      { t: 192, dur: 24, ch: "丙" }]);
    var orig = B.Store.findLyric(arr.id, sec.uid);
    var origChars = orig && orig.chars ? JSON.parse(JSON.stringify(orig.chars)) : null;   /* ★ 结束前还原 */
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "open failed" }); }
    await frame();
    var sums = document.querySelectorAll(".arg-lyric-sum");
    /* ★ 先全部收起：前面的探针可能把别的段留在展开态 ⇒ 否则会抓到别人的轨道 */
    for (i2 = 0; i2 < sums.length; i2++){
      if (sums[i2].getAttribute("aria-expanded") === "true"){ sums[i2].click(); await frame(); }
    }
    if (sums.length < 2) return JSON.stringify({ err: "sums < 2" });
    sums[1].click();                                      /* 段 2（3 小节） */
    await frame();
    var lane = null, ls = document.querySelectorAll(".arg-lyric-lane");
    for (i2 = 0; i2 < ls.length; i2++){
      if (ls[i2].querySelectorAll(".arg-lyric-barrow").length >= 2){ lane = ls[i2]; break; }
    }
    if (!lane){  return JSON.stringify({ err: "no multi-row lane" }); }
    var barrows = lane.querySelectorAll(".arg-lyric-barrow");
    var out = { rows: barrows.length };
    var chip = null, chips = lane.querySelectorAll(".arg-lyric-chip");
    for (i2 = 0; i2 < chips.length; i2++){
      if (/起点 0 tick/.test(chips[i2].getAttribute("aria-label") || "")){ chip = chips[i2]; break; }
    }
    if (!chip){
      var dbg = [];
      for (i2 = 0; i2 < chips.length; i2++) dbg.push((chips[i2].getAttribute("aria-label") || "(无标签)").slice(0, 26));
      
      return JSON.stringify({ err: "no chip@0", rows: barrows.length, n: chips.length, labels: dbg.join(" | ") });
    }
    var r = chip.getBoundingClientRect();
    var tr = barrows[1].getBoundingClientRect();
    var cx = r.left + r.width * 0.3, cy0 = r.top + r.height / 2, cy1 = tr.top + tr.height / 2;
    out.cy0 = Math.round(cy0); out.cy1 = Math.round(cy1);
    var mk = function(t3, x, y, btns){ return new PointerEvent(t3, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: x, clientY: y, buttons: btns }); };
    chip.dispatchEvent(mk("pointerdown", cx, cy0, 1));
    for (i2 = 1; i2 <= 12; i2++){ window.dispatchEvent(mk("pointermove", cx, cy0 + (cy1 - cy0) * i2 / 12, 1)); await frame(); }
    window.dispatchEvent(mk("pointerup", cx, cy1, 0));
    await frame(); await frame();
    /* 提交会整树重建 ⇒ 重新取 lane 与字块 */
    var lane2 = null, ls2 = document.querySelectorAll(".arg-lyric-lane");
    for (i2 = 0; i2 < ls2.length; i2++){
      if (ls2[i2].querySelectorAll(".arg-lyric-barrow").length >= 2){ lane2 = ls2[i2]; break; }
    }
    var lab = [];
    if (lane2){
      var cs = lane2.querySelectorAll(".arg-lyric-chip");
      for (i2 = 0; i2 < cs.length; i2++) lab.push((cs[i2].getAttribute("aria-label") || "").slice(0, 40));
    }
    out.labels = lab.join(" | ");
    var m = /「甲」起点 (\\d+) tick/.exec(out.labels);   /* ★ 模板字符串里 \d 会被吞成 d ⇒ 必须写 \\d */      /* ★ 换行后下标会变（时间序前移），故只按字名匹配 */
    out.jiaTick = m ? Number(m[1]) : null;
    out.movedToRow1 = out.jiaTick !== null && out.jiaTick >= 192;
    
    /* ★ 这是示例曲：把我改过的歌词**还原**（否则后面的探针/断言读到脏数据） */
    if (origChars) { try{ B.Store.upsertLyric(arr.id, sec.uid, origChars); }catch(e){} }
    try{ B.Arrange.close(); }catch(e){}
    return JSON.stringify(out);
  })()`;
}

/* ★★★ v3.33.32：预设库「区 ⊃ 组」两级折叠的真机闸（用户实报：扫弦区收起后，区内分组行还在）。
   桩里做不了（要真实 children 结构与 hidden 生效），故走冒烟。 */
function presetFoldProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    var list = document.getElementById("presetList");
    if (!list) return JSON.stringify({ err: "no presetList" });
    var out = { checks: [] };
    /* ★★ v3.35.8：本探针量的是**几何与开合**，抽屉收起时所有 rect 都是 0 —— 那种"绿"是
       零矩形假绿（本仓老教训），上一版那条折叠断言在这里其实半空跑。故先确保抽屉是开的，
       并把"抽屉确实开着"回传给断言侧（不然断言自己也不知道自己在量空气）。 */
    var libBtn = document.getElementById("presetLibBtn"), drawer = document.getElementById("presetDrawer");
    if (drawer && drawer.hidden && libBtn){ libBtn.click(); await frame(); }
    out.drawerOpen = !!(drawer && !drawer.hidden);
    /* ★★★ v3.35.11（用户需求）：**真机**验"快速双击 = 播放/暂停"与"第 2 击不改开合"。
       这条**只能**在真机验：区分靠的是浏览器自己的 MouseEvent.detail 计数（第 2 击 = 2），
       桩里 fire("click") 不带 detail，验不出系统阈值那套语义。 */
    try{
      var rows0 = Array.prototype.slice.call(document.querySelectorAll(".preset-item.song"));
      if (rows0.length){
        var fire = function(el, type, d){ el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail: d })); };
        var fold0 = rows0[0].getAttribute("aria-expanded");
        /* ★★★ v3.35.12（用户反馈「双击时第 1 击会先折叠/展开，干扰」）：第 1 击**不得**改开合。
           真手势的折叠被排到 DBLCLICK_MS 之后，且 dblclick 会把它取消 ⇒ 这里先单独验第 1 击。 */
        fire(rows0[0], "click", 1);
        await frame();
        out.dblFirst = { foldAfterFirst: document.querySelectorAll(".preset-item.song")[0].getAttribute("aria-expanded") };
        fire(document.querySelectorAll(".preset-item.song")[0], "click", 2);
        fire(document.querySelectorAll(".preset-item.song")[0], "dblclick", 2);
        await frame();
        out.dbl = { playing: !!B.Store.S.playing, mode: B.Store.S.playMode,
          foldBefore: fold0,
          foldAfter: document.querySelectorAll(".preset-item.song")[0].getAttribute("aria-expanded") };
        fire(document.querySelectorAll(".preset-item.song")[0], "click", 1);
        fire(document.querySelectorAll(".preset-item.song")[0], "click", 2);
        fire(document.querySelectorAll(".preset-item.song")[0], "dblclick", 2);
        await frame();
        out.dbl.stopped = !B.Store.S.playing;
      }
    }catch(e){ out.dblErr = String(e && e.message); }
    /* ★★ 造夹具：给「节拍」区建一个**子分组**。默认库里各区的分组数都可能是 0 ⇒
       上一版探针查的是空集，于是一跑就绿——那种绿证明不了任何事。
       ★ v3.35.3：「扫弦」区退役（不再渲染），夹具改用节拍区——否则这个夹具落在
       一个没有落脚的区里，闸门又变成空跑。 */
    try{
      B.Store.groupMove({ type: "builtin", idx: 2 }, "beat", "闸测组");
      B.Presets.refreshAfterPatternChange();
    }catch(e){ out.fixtureErr = String(e); }
    await frame();
    var heads = Array.prototype.slice.call(list.children).filter(function(c){ return c.className === "preset-section"; });
    for (var i = 0; i < heads.length; i++){
      var h = heads[i];
      if (h.getAttribute("aria-expanded") === "true"){ h.click(); await frame(); }
      var kids = Array.prototype.slice.call(list.children);
      var from = kids.indexOf(h), to = kids.length;
      for (var j = from + 1; j < kids.length; j++){ if (kids[j].className === "preset-section"){ to = j; break; } }
      var leaked = [];
      for (var j = from + 1; j < to; j++){
        var k = kids[j];
        var isRow = (k.className === "preset-group") || (k.classList && k.classList.contains("preset-arrange-group"));
        /* ★★ 必须查**实际渲染**而不是 k.hidden：属性可能被作者样式的 display 压过
           （本仓已踩过多次，见样式表里那一族 [hidden]{display:none} 补丁）。
           只查属性会**假绿**——这正是本闸第一版漏掉用户这个 bug 的原因。 */
        if (isRow && getComputedStyle(k).display !== "none")
          leaked.push(k.className + "·" + (k.textContent || "").slice(0, 10));
      }
      out.checks.push({ sec: (h.dataset && h.dataset.sec) || "?", total: to - from - 1, leaked: leaked });
      h.click(); await frame();
    }
    /* ★ v3.35.6（用户实拍「点了也不会折叠」）：**基础节奏区**的开合自理（applyBasicFold），
       不进 applyFold 的区切段。判据必须看**实际渲染**—— #rhyBeatBox 自己写着 display:flex，
       会把 [hidden] 的 display:none 盖掉，只查 hidden 属性会假绿（那个 bug 正是这个形状）。 */
    var bh = document.getElementById("basicSecHead"), bb = document.getElementById("rhyBeatBox");
    if (bh && bb){
      var d0 = getComputedStyle(bb).display;
      var hBefore = Math.round(bb.getBoundingClientRect().height);
      bh.click(); await frame();
      var d1 = getComputedStyle(bb).display;
      out.basic = { before: d0, collapsed: d1, aria: bh.getAttribute("aria-expanded"),
        hBefore: hBefore, h: Math.round(bb.getBoundingClientRect().height) };
      bh.click(); await frame();
      out.basic.restored = getComputedStyle(bb).display;
      /* ★ v3.35.8（用户实拍两处）：① 基础节奏区与下面两栏的间距要**统一**——本区在 #presetList
         之外，靠父容器 flex gap 吃间距，容易与网格内两区差几像素；判据取"本区行 → 下区头"
         与"网格内两区头之间"这两个实测量，必须相等。② 拍数参数槽要在区头**右边同一行**、
         且不在区体里（嵌在 role=button 内就是嵌套交互控件）。 */
      var row = document.querySelector(".basic-head-row");
      var list = document.getElementById("presetList");
      var secs = Array.prototype.filter.call(list.children, function(c){ return c.className === "preset-section"; });
      if (row && secs.length >= 2){
        var slot = row.querySelector("#sigSel");
        /* ★★★ v3.35.10：本区的三个间距必须与**网格自己的两个基准**逐像素相同 ——
           它们分别是"区头→首条目"（12）与"末条目→下区头"（18）。先把网格的这两个基准量出来
           （需要节拍区是展开的，才有条目可量），再量本区对应的两个。
           为什么值得三条等式：本区在 #presetList 之外，父容器 flex gap(10) 与网格 row-gap(4)
           的 6px 差全落在这条边界上，历史上连着两版都在这里"补丁叠补丁"（用户实拍三次）。 */
        var needOpen = secs[0].getAttribute("aria-expanded") !== "true";
        if (needOpen){ secs[0].click(); await frame(); }
        var its = Array.prototype.filter.call(list.children, function(c){
          return /(^| )preset-item( |$)/.test(c.className); });
        /* ★ 本探针早些时候往**节拍区**塞了夹具分组（闸测组）⇒ 那里的"头→首条目"已被污染，
           改量**自定义区**同构的那一段（区头 → 紧随其后的块，同样是 8 + 4 = 12）。 */
        var kids0 = Array.prototype.slice.call(list.children);
        var after = function(el){ var i = kids0.indexOf(el); return (i >= 0 && i + 1 < kids0.length) ? kids0[i + 1] : null; };
        var czNext = after(secs[1]);
        var gridHeadToFirst = czNext ? Math.round(czNext.getBoundingClientRect().top - secs[1].getBoundingClientRect().bottom) : null;
        var gridLastToNext = its.length ? Math.round(secs[1].getBoundingClientRect().top - its[its.length - 1].getBoundingClientRect().bottom) : null;
        if (bh.getAttribute("aria-expanded") !== "true"){ bh.click(); await frame(); }
        var expandedRowToBox = bb.hidden ? null : Math.round(bb.getBoundingClientRect().top - row.getBoundingClientRect().bottom);
        var expandedBoxToSec = bb.hidden ? null : Math.round(secs[0].getBoundingClientRect().top - bb.getBoundingClientRect().bottom);
        out.basicGeom = {
          slotInRow: !!slot,
          slotInBox: !!(bb.querySelector && bb.querySelector("#sigSel")),
          slotToRowRight: slot ? Math.round(row.getBoundingClientRect().right - slot.getBoundingClientRect().right) : null,
          headText: bh.textContent,
          rowToBox: expandedRowToBox,
          boxToSec: expandedBoxToSec,
          gridHeadToFirst: gridHeadToFirst,
          gridLastToNext: gridLastToNext
        };
        /* ② 折叠本区后再量"本区 → 下区头"——这才是与"网格内两区之间"可比的量。
           ★ 从**容器**（#basicZone）底量，不从区头行底量：区头那 8px 下边距现在被容器吃住
             （flow-root），从行底量会把这 8px 算重（实测 34 而不是 26）。 */
        bh.click(); await frame();
        /* ★★★ v3.35.12：从**区头元素**量（与网格那边的参考点同类），不再从容器底量 ——
           容器底含了区头的 8px 下边距，量出来是 18，看着"相等"其实是我又犯了苹果比橘子的错
           （用户第二次追问「你确定间距改好了吗」正是这么暴露的）。 */
        out.basicGeom.gapHere = Math.round(secs[0].getBoundingClientRect().top - bh.getBoundingClientRect().bottom);
        /* ③ 参照：收起节拍区，量"节拍头 → 自定义头"（网格内两区的真实间距） */
        secs[0].click(); await frame();
        var secs2 = Array.prototype.filter.call(list.children, function(c){ return c.className === "preset-section"; });
        out.basicGeom.refGap = Math.round(secs2[1].getBoundingClientRect().top - secs2[0].getBoundingClientRect().bottom);
        secs[0].click(); await frame();
        bh.click(); await frame();   /* 还原本区为展开（探针不留状态） */
      }
    }
    return JSON.stringify(out);
  })()`;
}

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

/* ★★★ v3.36.21：**竖屏四修**的真机闸（用户竖屏实报四条）。
   为什么必须真机 + 必须在 390 那一遍量：四条全是 ≤640 的媒体查询，1440 下量不到；
   而"每段 2px""播放键离上缘 3px""滑条盒高 0 与下一行重叠 12px""状态灯差 11px"
   全是**布局几何**，桩里没有。探针自己开编排浮层（地图与滑条只在浮层里）。
   ★ 用"最窄那一段"而不是首段：地图每段宽度是 **JS 写的比例**
     （renderPanel 里 seg.style.flexGrow = 该段小节数），1 小节的段天然最窄——
     那正是修复前被压成 2px 的那一段；只看首段会随曲式数据变化而假绿/假红。 */
function portraitFixProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var B = window.__beat;
    if (!B || !B.Arrange) return JSON.stringify({ err: "无 __beat.Arrange" });
    try{ B.Arrange.open(); }catch(e){ return JSON.stringify({ err: "Arrange.open 失败 " + e.message }); }
    await frame(); await frame();
    var q = function(s){ return document.querySelector(s); };
    var W = function(e){ return e ? Math.round(e.getBoundingClientRect().width) : null; };
    var map = q("#argMap"), kids = map ? [].slice.call(map.children) : [];
    var bar = q("#playBar"), btn = q("#playBtn"), prog = q(".pb-progress");
    var dot = q("#statusDot"), dir = q(".pb-ctx .pb-ctx-dir");
    var st = q("#pbSub .status");
    var track = q(".arg-range-track"), acts = q(".arg-t-actions");
    var res = { vw: window.innerWidth, mapW: W(map), segN: kids.length,
      segMin: kids.length ? Math.min.apply(null, kids.map(W)) : null,
      trackH: track ? Math.round(track.getBoundingClientRect().height) : null,
      trackActionsGap: (track && acts) ? Math.round(acts.getBoundingClientRect().top - track.getBoundingClientRect().bottom) : null,
      btnTopGap: (bar && btn) ? Math.round(btn.getBoundingClientRect().top - bar.getBoundingClientRect().top) : null,
      statusDelta: (dot && dir) ? Math.round(dot.getBoundingClientRect().left - dir.getBoundingClientRect().left) : null,
      /* ★ v3.36.20 补5：窄屏底栏「状态区让位给进度条」——量状态盒宽、进度条宽，
         并把状态文案换成**最长那条**确认不被截断（用户诉求：上限之外的富余给进度条，
         但不能把 v3.33.12「状态行被切掉约 3 字」那个老毛病带回来）。 */
      /* ★ v3.36.20 补6：胶囊宽度 + 胶囊与传输键组的**重叠量**（>0 = 压在一起） */
      ctxW: q(".pb-ctx") ? Math.round(q(".pb-ctx").getBoundingClientRect().width) : null,
      /* ★ v3.36.20 补14：竖屏下「音量区右缘」应落在 BPM 滑杆右缘上（用户实报音量条占满全宽） */
      /* ★ v3.36.20 补15：窄屏控制卡**默认收起**的实证（卡片高 + 练习网格顶部） */
      ctlCardH: (function(){ var c=q(".card-head"); c = c && c.closest("section.card,div.card"); return c? Math.round(c.getBoundingClientRect().height):null; })(),
      vizTop: q("#viz") ? Math.round(q("#viz").getBoundingClientRect().top) : null,
      /* ★ 补15：窄屏**默认收起**音量组 ⇒ 这里临时展开再量（量的是"展开态"的右缘对齐），量完还原。
         与仓库既有探针「造出条件 → 量 → 还原（探针不留状态）」同一纪律。 */
      /* ★★★ v3.36.20 补26（用户要求"先做这一项"）：闸门改量**可见边缘**，不再量盒子边缘。
         前几轮我三次栽在"盒子间距绿、肉眼不齐"：盒子边缘是布局量，眼睛比较的是**可见内容**。
         · 音量侧：胶囊底 → 该行内容区第一个**可见**元素（标签文字）的 top；
         · BPM 侧：胶囊底 → 内容区第一个子元素（步进按钮，自身即可见）的 top。
         两者应相等（±3px）。 */
      /* ★ 量之前必须**临时展开整块**（窄屏默认收起 ⇒ 隐藏元素的 rect 是 0，量出来是假值 —— 我第一版就踩了：
         音量侧量到 −181px）。量完还原，与仓库探针"造条件→量→还原、不留状态"同一纪律。
         ★ v3.39.0：volOpen/bpmOpen 合并为 #ctlOpen 一枚 ⇒ 展开动作只翻这一个开关；
         pillGap/pillsSameRow（两枚胶囊同行/不重叠）随合一除名，pillsVisible 改量合并胶囊。 */
      volPillInk: (function(){ var cb=document.getElementById("ctlOpen");
        var k=cb?cb.checked:null;
        if(cb)cb.checked=true; void document.body.offsetWidth;
        var p=q(".core-pills"), r=q(".card-head-left .vol-row"), t=r? r.querySelector("span") : null;
        var d = (p&&t)? Math.round(t.getBoundingClientRect().top-p.getBoundingClientRect().bottom):null;
        if(cb&&k!==null)cb.checked=k; void document.body.offsetWidth;
        return d; })(),
      /* ★★★ v3.36.20 补33：本轮新增行为的真机闸 —— 胶囊可见 / 实时值跟随 / 无卡底。
         · pillsVisible：折叠读数钮在收起档可见（宽屏档 .ctl-pills 整行 display:none）；
         · pillLive：**真的派发事件**（点 BPM +1）后读胶囊文本，读完还原；
           控制芯批 3：音量 % 读数（#volPillPctN）退役 ⇒ pillLive 只量 BPM。 */
      pillsVisible: (function(){ var a=q(".ctl-pills .ctl-hit[for=ctlOpen]");
        return a ? a.getBoundingClientRect().height > 0 : null; })(),
      pillLive: (function(){
        var out={};
        var up=q("#bpmPlus"), dn=q("#bpmMinus");
        if (up && dn){ up.click(); out.bpm = (q("#bpmPillNumN")||{}).textContent || (q("#bpmPillNum")||{}).textContent || null; dn.click(); }
        return out; })(),
      ctlCardBg: (function(){ var c=q(".card-head.viz-head"); c = c? c.closest("section.card,div.card") : null;
        return c? getComputedStyle(c).backgroundColor : null; })(),
      /* ★ v3.39.0：窄屏默认收起 = 整块 display:none ⇒ 这两个 top 必须在**展开态**量
         （与 volPillInk 同款"造条件→量→还原"；旧默认 bpmOpen 展开、无需展开，新默认两块全收）。 */
      volBodyTop: (function(){ var cb=document.getElementById("ctlOpen"), k=cb?cb.checked:null;
        if(cb&&!cb.checked)cb.checked=true; void document.body.offsetWidth;
        var b=q(".card-head-left .group .tg-body")||q(".card-head-left .tg-body"); var t=b?Math.round(b.getBoundingClientRect().top):null;
        if(cb&&k===false)cb.checked=k; void document.body.offsetWidth; return t; })(),
      /* ★ v3.39.0：BPM 内容区随组合并住进左列 ⇒ bpmBodyTop 改量合并组里的 BPM 滑杆行
         （.slider-row）；"BPM 块在音量块下方"的 A1 排列判据不变。bpmPillInk（BPM 胶囊→
         BPM 内容区间距）随两枚胶囊合一除名——合并胶囊的落点间距由 volPillInk 一枚管。 */
      bpmBodyTop: (function(){ var cb=document.getElementById("ctlOpen"), k=cb?cb.checked:null;
        if(cb&&!cb.checked)cb.checked=true; void document.body.offsetWidth;
        var b=q(".card-head-left .slider-row"); var t=b?Math.round(b.getBoundingClientRect().top):null;
        if(cb&&k===false)cb.checked=k; void document.body.offsetWidth; return t; })(),
      /* ★ v3.39.1：BPM 塔式两行后的「等长 / 对齐 / 居中」三组读数（用户澄清的三点口径；
         同批追加：音量 % 文案与右侧定宽槽退役，三行统一两段式、右端同抵列右缘）：
         ① volBpmDelta 改为**两根滑杆互比右端**（原口径是音量行盒 vs BPM 输入——塔式后
            行盒右缘恒比滑杆宽出右侧空槽 48px，原口径会把对齐判成错位）；
         ② volBpmLeftDelta 左端互比——与 ① 同时为 0 ⇔ 等长且两端对齐；
         ③ bpmClusterAxis 步进群轴心 vs **BPM 行（芯）轴**——★ v3.41.0（方案对账 G9）按方案图
            改为参照芯轴；v3.39.1 的「参照滑杆轴」会让它偏右 31px（左槽 52px 把滑杆顶开）；
            bpmStackedDown 步进群在滑杆**下方**（塔式形状本体）。 */
      volBpmDelta: (function(){ var cb=document.getElementById("ctlOpen");
        var keep = cb? cb.checked : null;
        if (cb){ cb.checked = true; void document.body.offsetWidth; }
        var v=q(".card-head-left .vol-row input[type=range]"), b=q(".slider-row input[type=range]");
        var d = (v&&b)? Math.round(v.getBoundingClientRect().right-b.getBoundingClientRect().right):null;
        if (cb && keep !== null){ cb.checked = keep; void document.body.offsetWidth; }
        return d; })(),
      volBpmLeftDelta: (function(){ var cb=document.getElementById("ctlOpen");
        var keep = cb? cb.checked : null;
        if (cb){ cb.checked = true; void document.body.offsetWidth; }
        var v=q(".card-head-left .vol-row input[type=range]"), b=q(".slider-row input[type=range]");
        var d = (v&&b)? Math.round(v.getBoundingClientRect().left-b.getBoundingClientRect().left):null;
        if (cb && keep !== null){ cb.checked = keep; void document.body.offsetWidth; }
        return d; })(),
      bpmClusterAxis: (function(){ var cb=document.getElementById("ctlOpen");
        var keep = cb? cb.checked : null;
        if (cb){ cb.checked = true; void document.body.offsetWidth; }
        var s=q(".bpm-slider-row"), g=q(".slider-row .bpm-row");
        var d=null;
        if (s&&g){ var sr=s.getBoundingClientRect(), gr=g.getBoundingClientRect();
          d=Math.round((gr.left+gr.right)/2-(sr.left+sr.right)/2); }
        if (cb && keep !== null){ cb.checked = keep; void document.body.offsetWidth; }
        return d; })(),
      bpmStackedDown: (function(){ var cb=document.getElementById("ctlOpen");
        var keep = cb? cb.checked : null;
        if (cb){ cb.checked = true; void document.body.offsetWidth; }
        var s=q(".slider-row input[type=range]"), g=q(".slider-row .bpm-row");
        var d=null;
        if (s&&g) d=Math.round(g.getBoundingClientRect().top-s.getBoundingClientRect().bottom);
        if (cb && keep !== null){ cb.checked = keep; void document.body.offsetWidth; }
        return d; })(),
      /* ★ v3.36.20 补7：上排「胶囊↔键组」与下排「读数/状态↔进度条」两个间距（用户要求二者相等） */
      gapTop: (function(){ var c=q(".pb-ctx"), j=q("#argJump"); return (c&&j)? Math.round(j.getBoundingClientRect().left-c.getBoundingClientRect().right):null; })(),
      /* ★ v3.36.20 补8：键组**内部**间距（trio 右缘 → 循环键左缘）——用户要求组外间距必须大于它 */
      gapBtns: (function(){ var t=q("#argJump .trio"), l=q("#argJump > .loop-btn");
        return (t&&l)? Math.round(l.getBoundingClientRect().left-t.getBoundingClientRect().right):null; })(),
      gapBottom: (function(){ var n=q(".pb-sub .demo-range-note"), s=q("#pbSub .status"), p=q("#pbProgress"); if(!p) return null;
        var e=-1; [n,s].forEach(function(x){ if(!x) return; var r=x.getBoundingClientRect(); if(r.width>0 && r.right>e) e=r.right; });
        return e>=0? Math.round(p.getBoundingClientRect().left-e):null; })(),
      overlapCtxJump: (function(){
        var c = q(".pb-ctx"), j = q("#argJump");
        if (!c || !j) return null;
        return Math.round(c.getBoundingClientRect().right - j.getBoundingClientRect().left);
      })(),
      statusW: st ? Math.round(st.getBoundingClientRect().width) : null,
      progressW: prog ? Math.round(prog.getBoundingClientRect().width) : null,
      jumpW: q("#argJump") ? Math.round(q("#argJump").getBoundingClientRect().width) : null,
      longTextOverflow: (function(){
        var t = q("#statusText");
        if (!t) return null;
        var keep = t.textContent;
        t.textContent = "播放中 · 第 64 小节 · 8&";
        void t.offsetWidth;
        var bad = t.scrollWidth > t.clientWidth + 1;
        t.textContent = keep;
        return bad;
      })() };
    try{ B.Arrange.close(); }catch(e){ }
    return JSON.stringify(res);
  })()`;
}
  /* ★★★ v3.38.1：**每个探针都要报出自己的名字**。
     本轮踩过的坑（诊断实录）：pitchMarkProbe 的对象字面量少了一个逗号 ⇒ 注入页面的那段是
     SyntaxError ⇒ Runtime.evaluate 回 undefined ⇒ JSON.parse(undefined) 抛「"undefined" is not valid JSON」。
     而 catch 只把这句原样转达：12 条断言一起变红，看的人把它误判成「http 那一遍没跑起来」——
     实际两条通道逐条相同，根因就在本文件里。故：探针名 + 页面原话一并抛出，且 undefined 单独报。
     @param {string} name @param {string} expression @param {boolean} [awaitPromise] */
  const probeJson = async (name, expression, awaitPromise) => {
    const r = await cdp.send("Runtime.evaluate",
      { expression: expression, awaitPromise: !!awaitPromise, returnByValue: true });
    if (r.exceptionDetails){
      const d = r.exceptionDetails;
      throw new Error("探针 " + name + " 在页面里抛错：" + ((d.exception && d.exception.description) || d.text));
    }
    if (!r.result || r.result.value === undefined){
      throw new Error("探针 " + name + " 没有返回值（求值结果 undefined——先查该探针表达式有没有语法错）");
    }
    /* 探针约定：表达式**必须**是 JSON.stringify(...) 的字符串。返回到这里的是别的类型
       （对象 / 数字 / 布尔）时 JSON.parse 会先把它转成 "[object Object]" 再报一句看不懂的
       「"[object Object]" is not valid JSON」——所以这里把**探针名与真实类型**一并带上。 */
    try{
      return JSON.parse(r.result.value);
    }catch(e){
      throw new Error("探针 " + name + " 的返回值不是 JSON 字符串（实际是 " + (typeof r.result.value)
        + "：" + String(r.result.value).slice(0, 60) + "）");
    }
  };
    try{
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(400);                       // 等 resize 重排与网格 relayout 跑完
      const wide = await probeJson("layoutProbe", layoutProbe(), true);
      /* ★★★ v3.36.20 补4：**宽屏**下也要量一次歌曲地图的"每段最小宽度"——
         原来那条 min-width 只在 ≤640 生效，结果宽屏下短段一样很窄（1440 实测首段 13px）。 */
      result.mapWide = await probeJson("portraitFixProbe", portraitFixProbe(), true);
      /* v3.0.0：抽屉探针在桌面宽度（≥1280 栅格生效）跑一遍，量收起/展开两态的真几何 */
      const drawer = await probeJson("drawerProbe", drawerProbe(), true);
      /* v3.1.0：drawerProbe 末尾 location.reload()——等页面重新起完再跑滚动探针
         （playMode 已被本探针复原为曲式；重载顺带把"就地接续"的播放位置归零） */
      await sleep(1500);
      /* v3.0.0：连续滚动探针（同上，桌面宽度、真实 UI 路径、约 3.3s 采样） */
      const scroll = await probeJson("scrollProbe", scrollProbe(), true);
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(400);                       // 等 resize 重排与网格 relayout 跑完
      const narrow = await probeJson("layoutProbe", layoutProbe(), true);
      /* ★★★ v3.36.21：竖屏四修（地图/滑条/播放键间距/状态灯对齐）——就在这档 390 量 */
      result.portraitFix = await probeJson("portraitFixProbe", portraitFixProbe(), true);
      /* ★★★ v3.36.20 补5：**横屏**（640×360）单独量一次底栏 —— 那条改动只在
         `@media (max-width:640px) and (orientation:landscape)` 内，竖屏 390 量不到。 */
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 640, height: 360, deviceScaleFactor: 2, mobile: true });
      await sleep(400);
      result.playBarLandscape = await probeJson("portraitFixProbe", portraitFixProbe(), true);
      /* ★★★ v3.36.20 补6：**641–960 中间档**（大屏手机竖屏/手机横屏）——这一档此前没有任何断言，
         正是"胶囊压到键组上"能长期存在的原因。取用户实报的 740×1804。 */
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 740, height: 1804, deviceScaleFactor: 2, mobile: true });
      await sleep(400);
      result.barMid = await probeJson("portraitFixProbe", portraitFixProbe(), true);
      /* ★★★ v3.36.20 补6：**961–1000 桌面档**也要罩住——那一档左右各 1fr（970 时约 291px）
         装不下定宽 320px 的胶囊，重叠是被 `.pb-ctx{max-width:100%}` 单独特修掉的，
         而 1440/1920 两档量不出来（那里 1fr 足够宽）。取 970×600。 */
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 970, height: 600, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      result.barEdge = await probeJson("portraitFixProbe", portraitFixProbe(), true);
      /* ★★★ v3.36.20 补38：折叠方案的**新作用域**必须有自己的档位 ——
         此前 补35/36/37 三次改动都只有手工实测、没有闸门，用户实拍才发现漏（939 胶囊换行）。
         三档：1000×1400 竖屏（宽 > 640）/ 939×406 矮屏（横屏但矮）/ 1440×900 宽裕横屏（= 典型 PC，应不折叠）。 */
      for (const sc of [["barPortrait", 1000, 1400, 2, true], ["barShort", 939, 406, 2, true], ["barPC", 1440, 900, 1, false]]){
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width: sc[1], height: sc[2], deviceScaleFactor: sc[3], mobile: sc[4] });
        await sleep(400);
        const scRaw = await cdp.send("Runtime.evaluate",
          { expression: portraitFixProbe(), awaitPromise: true, returnByValue: true });
        result[sc[0]] = JSON.parse(scRaw.result.value);
      }
      /* ★★★ v3.36.20 补38b：**宽度扫描** —— 矮屏档（高 420）下从 660 到 1440 逐档量"胶囊行是否可见"。
         起因：M32 变异（去掉 .viz-head-grid{display:block}）在 939 单点**没被抓到**（那一档三列装得下），
         说明单点取样不够；扫描能把"某一段宽度下折叠方案失效（胶囊被塞进窄列/换行）"整段罩住。
         ★ v3.39.0：两枚胶囊合并为一枚 ⇒ row/gap 两读数除名，扫描只保留 vis 判据。 */
      result.pillSweep = [];
      for (const w of [660, 700, 760, 820, 880, 900, 939, 1000, 1100, 1280, 1440]){
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width: w, height: 420, deviceScaleFactor: 1, mobile: false });
        await sleep(320);
        const s = await probeJson("portraitFixProbe", portraitFixProbe(), true);
        result.pillSweep.push({ w: w, vis: s.pillsVisible });
      }
      /* ★★★ v3.31.0：宽屏铺满必须在 >1440 的视口量（1440 下主列封顶，开关不改变 #viz） */
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      /* 探针是 async（要等 ResizeObserver 写 --cs），故用 awaitPromise */
      const wideFull = await probeJson("wideFullProbe", wideFullProbe(), true);
      /* ★★★ v3.31.3：格子四档亮度分离度（与视口无关，在 1920 顺带量） */
      result.cellLevels = await probeJson("cellLevelsProbe", cellLevelsProbe(), false);
      /* v3.31.x（落地审计 P0-1）：children 形状哨兵——真机 children 是 HTMLCollection、
         没有数组方法，而测试桩把它实现成数组；产品代码一旦直接调 .find/.map 之类，
         桩里恒绿、真机必抛。这条把「桩与真机的分叉」钉成一条会红的断言。 */
      result.childrenShape = await probeJson("childrenShapeProbe", childrenShapeProbe(), false);
      /* ★★★ v3.31.1：连续滚动的静止态落位（与视口无关，在 1920 顺带量） */
      const scrollRest = await probeJson("scrollRestProbe", scrollRestProbe(), true);
      /* ★★★ v3.33.8：文字对比度审计（两主题各一遍）。放在最后——它会把所有 [hidden] 面板
         展开再收起，属于"改页面状态"的重探针，跑在布局/滚动/铺满等几何探针之后才不会互相污染。 */
      result.contrast = await probeJson("contrastProbe", contrastProbe(), true);
      /* ★★★ v3.33.8：版面审计（折行/挤压/两走道对齐）——同样放在最后（会开关浮层） */
      result.layoutAudit = await probeJson("layoutAuditProbe", layoutAuditProbe(), true);
      /* ★★★ v3.33.15：编辑器头部布局哨兵——同样放最后（它会把 #editor 浮层打开量几何） */
      result.editorHeader = await probeJson("editorHeaderProbe", editorHeaderProbe(), true);
      /* ★★★ v3.33.21：精修分组折叠的真机哨兵 */
      result.refineGroups = await probeJson("refineGroupProbe", refineGroupProbe(), true);
      /* ★★★ v3.33.32：预设库两级折叠（区收起 ⇒ 区内组头/组行也必须收） */
      result.presetFold = await probeJson("presetFoldProbe", presetFoldProbe(), true);
      /* ★★★ v3.36.19：段行块列表的横向滚动真机闸 */
      result.blockRow = await probeJson("blockRowProbe", blockRowProbe(), true);
      /* ★★★ v3.36.20：段卡片"放不下就横滑"的真机闸（精修按钮不换行 + 歌词区横滑） */
      result.lyricScroll = await probeJson("lyricScrollProbe", lyricScrollProbe(), true);
      /* ★★★ v3.36.20 补：卡片右缘留白 */
      result.cardGutter = await probeJson("cardGutterProbe", cardGutterProbe(), true);
      /* ★★★ v3.33.28：歌词跨行拖动（同行有后续块时也必须能换行） */
      result.lyricRowMove = await probeJson("lyricRowMoveGateProbe", lyricRowMoveGateProbe(), true);
      /* ★★★ v3.33.22：歌词拖动行归属的真机闸（自造 3 小节段 ⇒ 多行） */
      result.lyricDrag = await probeJson("lyricDragGateProbe", lyricDragGateProbe(), true);
      /* ★★★ v3.38.1：音高标注真机几何（三档槽位 / 点在数码右侧 / 窄格降级）——**排在最后**：
         它会改 S.pitchNotation / playMode 并临时改写一行歌词（量完已还原并重建），
         放在任何依赖曲式状态的探针之后最稳。 */
      result.pitchMark = await probeJson("pitchMarkProbe", pitchMarkProbe(), true);
      try{
        const gRaw = await cdp.send("Runtime.evaluate",
          { expression: lyricGhostAlignProbe(), awaitPromise: true, returnByValue: true });
        console.log("  [diag3] ghost=" + (gRaw.result && gRaw.result.value));
      }catch(e){ console.log("  [diag3] failed: " + e.message); }
      /* ★★★ v3.38.1 补6：顶部三块 12 档真机闸——逐档改视口、等重排、量一次。
         取 12 档的用意：既覆盖三块各自的「刚好放下 / 刚好放不下」临界，也覆盖既有的
         560–899 与 ≥900 两个老断点边界（列数必须在**任意**宽度上都等于那个 floor 公式）。 */
      /* ★ v3.38.1 补10：格子带底板——桌面档(44px) 与窄屏档(34px) 各量一次 */
      result.band = [];
      for (const bw of [1440, 900]){
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width: bw, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(360);
        result.band.push(await probeJson("bandProbe@" + bw, bandProbe(), false));
      }
      result.topBlocks = [];
      for (const w of [390, 480, 560, 640, 700, 760, 824, 846, 899, 960, 1024, 1440]){
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(340);
        result.topBlocks.push(await probeJson("topBlocksProbe@" + w, topBlocksProbe(), false));
      }
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
/* ★★★ v3.33.8：**文字对比度审计**（用户报障「日间模式下部分按钮的字体和背景色几乎融为一体」）。
   量法：日间/经典两主题各扫一遍——枚举所有**可见且自带文本**的元素，按 WCAG 相对亮度算
   「文字色 vs 有效背景色」（背景沿祖先链做 alpha 合成，不把 transparent 当底色），
   阈值取 AA：正文 4.5:1、大字号（≥24px 或 ≥18.66px 粗体）3:1。
   ★ 为什么必须真机：撞色来自 CSS 变量的级联（日间主题漏覆盖 --sel-bg ⇒ 选中胶囊是深底墨蓝字
     1.31:1；--amber 未覆盖 ⇒ 和弦胶囊白底 1.95:1；--t3 在浅色分层底上 3.87:1），
     测试桩没有样式引擎，量不出这一类。改前实测：日间 **44 处**不合格、经典 0 处。
   ★ 扫描范围：先把所有 [hidden] 展开（面板/抽屉/编辑器都算进去），再把弹窗**单独**量一遍——
     弹窗遮罩是 position:fixed 的整屏暗纱，混在一起会把页面其它元素的有效背景算暗、产出假失败。 */
function contrastProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    /* ★ 必须等**过渡动画**跑完再采样：.pill 有 transition:background .12s，切主题后只等两帧
       会量到深→浅的中间灰（实测 fg/bg 双灰 1.07:1 的假失败）；同理 --t3 的字色也在过渡。
       200ms 覆盖 .12s/.15s 两档过渡并留余量。 */
    var settle = function(){ return new Promise(function(r){ setTimeout(r, 220); }); };
    function lum(c){ var f=function(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); }
    function parse(c){ var m=/rgba?\\(([^)]+)\\)/.exec(c||""); if(!m) return null; var p=m[1].split(",").map(parseFloat); return [p[0],p[1],p[2],p.length>3?p[3]:1]; }
    function over(f,b){ var a=f[3]; return [f[0]*a+b[0]*(1-a), f[1]*a+b[1]*(1-a), f[2]*a+b[2]*(1-a), 1]; }
    function effBg(el){ var st=[],n=el; while(n&&n.nodeType===1){ var c=parse(getComputedStyle(n).backgroundColor); if(c&&c[3]>0.001) st.push(c); n=n.parentElement; } var base=[255,255,255,1]; for(var i=st.length-1;i>=0;i--) base=over(st[i],base); return base; }
    function ownText(el){ var s=""; for(var i=0;i<el.childNodes.length;i++){ var n=el.childNodes[i]; if(n.nodeType===3) s+=n.textContent; } return s.trim(); }
    function sweep(scope){
      var out=[], n=0, root = scope ? document.querySelector(scope) : document;
      if(!root) return { n:0, fails:out };
      var all = root.querySelectorAll("*");
      for(var i=0;i<all.length;i++){
        var el=all[i], cs=getComputedStyle(el);
        if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)<0.15) continue;
        var r=el.getBoundingClientRect(); if(r.width<6||r.height<6) continue;
        var tx=ownText(el); if(!tx) continue;
        n++;
        var bg=effBg(el), fgR=parse(cs.color); if(!fgR) continue;
        var fg=fgR[3]>=0.999?fgR:over(fgR,bg);
        var L1=lum(fg),L2=lum(bg), cr=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
        var px=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight,10)>=700;
        var need=(px>=24||(bold&&px>=18.66))?3:4.5;
        if(cr<need){
          var ch=[], m=el;
          while(m&&m.nodeType===1&&ch.length<4){ var mcs=getComputedStyle(m); ch.push(m.tagName.toLowerCase()+(m.id?"#"+m.id:"")+"("+mcs.backgroundColor+","+mcs.opacity+")"); m=m.parentElement; }
          out.push({ cls:(el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+"."+String(el.className||"").split(" ").slice(0,3).join(".")).slice(0,52), t:tx.slice(0,10), cr:Math.round(cr*100)/100, need:need, px:px, fg:cs.color, bg:"rgb("+bg.map(Math.round).join(",")+")", chain:ch.join(" < ") });
        }
      }
      return { n:n, fails:out.sort(function(a,b){return a.cr-b.cr;}) };
    }
    var tt=document.getElementById("themeToggle");
    if(!tt) return JSON.stringify({ err:"no themeToggle" });
    var before=document.body.dataset.theme||"classic";
    var hidden=[].slice.call(document.querySelectorAll("[hidden]"));
    var mask=document.getElementById("modalMask");
    var res={};
    for(var k=0;k<2;k++){
      var th = k===0 ? "classic" : "obs";
      if((document.body.dataset.theme||"classic")!==th){ tt.click(); await frame(); await settle(); }
      hidden.forEach(function(e){ e.hidden=false; });
      if(mask) mask.hidden=true;
      await frame(); await settle();
      var a=sweep(null);
      if(mask){ mask.hidden=false; await frame(); await settle(); }
      var b=sweep(".modal");
      if(mask) mask.hidden=true;
      res[th]={ n:a.n+b.n, fails:a.fails.concat(b.fails).sort(function(x,y){return x.cr-y.cr;}) };
    }
    hidden.forEach(function(e){ e.hidden=true; });
    if((document.body.dataset.theme||"classic")!==before){ tt.click(); await frame(); await settle(); }
    return JSON.stringify(res);
  })()`;
}

/* ★★★ v3.33.8：**版面审计**（用户实拍两例：① 日间下「预备拍」开关对齐到了 BPM 标题行而不是
   BPM 的 +5；② 设置弹窗标题「设置」被挤成一字宽、逐字竖排）。
   量法：① 折行——短文本（≤10 字、块级、非 inline）用 Range 的**行框数**判（按钮的 min-height/
   padding 不会被误判）；② 挤压——.sec-tag 在同 flex/grid 行里吃掉 ≥80% 宽、且同行兄弟被压到
   <40px；③ 对齐——「预备拍开关首行」与 BPM 的「+5」按钮 top 差（仅 ≥961 栅格才是左右两列）。
   覆盖三个界面（主界面 / 设置弹窗 / 预设侧栏）× 两主题；跑完把浮层关回去（不污染后续）。 */
function layoutAuditProbe(){
  return `(async function(){
    var frame = function(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); };
    var settle = function(){ return new Promise(function(r){ setTimeout(r, 220); }); };
    function ownText(el){ var s=""; for(var i=0;i<el.childNodes.length;i++){ var n=el.childNodes[i]; if(n.nodeType===3) s+=n.textContent; } return s.trim(); }
    function lines(el){ try{ var rng=document.createRange(); rng.selectNodeContents(el); var rs=rng.getClientRects(), tops={}; for(var i=0;i<rs.length;i++){ if(rs[i].width<1||rs[i].height<1) continue; tops[Math.round(rs[i].top)]=1; } return Object.keys(tops).length; }catch(e){ return 0; } }
    function sweep(){
      var wrapped=[], squeezed=[], n=0, all=document.querySelectorAll("*");
      for (var i=0;i<all.length;i++){
        var el=all[i], cs=getComputedStyle(el);
        if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)<0.15) continue;
        var b=el.getBoundingClientRect(); if(b.width<4||b.height<4) continue;
        n++;
        var tx=ownText(el);
        if (tx && tx.length<=10 && el.children.length===0 && cs.display!=="inline" && !cs.whiteSpace.startsWith("pre")){
          var ln=lines(el);
          if (ln>=2) wrapped.push({ cls:(el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+"."+String(el.className||"").split(" ").slice(0,2).join(".")).slice(0,40), t:tx.slice(0,10), w:Math.round(b.width), lines:ln });
        }
        if (el.classList && el.classList.contains("sec-tag") && el.parentElement){
          var ps=getComputedStyle(el.parentElement);
          if (ps.display==="flex"||ps.display==="grid"){
            var sibs=el.parentElement.children, bad=null, k;
            for (k=0;k<sibs.length;k++){ if (sibs[k]===el) continue; var stx=sibs[k].textContent.trim(); if(stx && sibs[k].getBoundingClientRect().width<40) bad=Math.round(sibs[k].getBoundingClientRect().width); }
            var pw=el.parentElement.getBoundingClientRect().width;
            if (bad!==null && pw>0 && b.width/pw>=0.8) squeezed.push({ parent:(el.parentElement.tagName.toLowerCase()+"."+String(el.parentElement.className||"").split(" ").slice(0,2).join(".")).slice(0,36), tagW:Math.round(b.width), parentW:Math.round(pw), sibW:bad, t:el.textContent.trim().slice(0,10) });
          }
        }
      }
      /* ★ v3.33.8：**参数行整行不换行**判据。用户实拍：参数框过宽把「小节」顶到下一行。
         此前只判"元素自身的行框数"抓不到（每个元素仍是 1 行，是**容器换行**把子项折下去）。
         精确口径：变速训练 / 静音配置面板里的「标签 + 参数框」必须同处一行——
         排除按设计独占整行的进度行（宽度 ≥ 容器 90% 的子项），只在 ≥961 栅格下判
         （窄屏这些行本来就允许换行）。 */
      if (innerWidth >= 961){
        var PANELS = ["trainerPanel", "muteCfgPanel"];
        for (var pi=0; pi<PANELS.length; pi++){
          var pan = document.getElementById(PANELS[pi]);
          if (!pan || pan.hidden || getComputedStyle(pan).display === "none") continue;
          var cw = pan.getBoundingClientRect().width;
          var kids = pan.children, ptops = {}, pn = 0;
          for (var ki=0; ki<kids.length; ki++){
            var kb = kids[ki].getBoundingClientRect();
            if (kb.width < 1 || kb.height < 1) continue;
            if (cw > 0 && kb.width / cw >= 0.9) continue;      // 进度行/整行元素按设计独占一行
            /* 按**垂直中心**归并（6px 桶）：.tr-panel 是 align-items:center，
               标签(17px) 与输入框(24px) 顶端天然差 4px、中心相同——按 top 判会假红。 */
            pn++; ptops[Math.round(((kb.top + kb.bottom) / 2) / 6) * 6] = 1;
          }
          if (pn >= 3 && Object.keys(ptops).length >= 2){
            wrapped.push({ cls: "参数行 " + PANELS[pi], t: PANELS[pi], w: Math.round(cw), lines: Object.keys(ptops).length });
          }
        }
      }
      return { n:n, wrapped:wrapped, squeezed:squeezed };
    }
    function alignCheck(){
      if (innerWidth < 961) return null;
      /* ★ v3.39.0：对齐参照从 BPM 的「+5」换成合并组第 1 行（节拍滑杆行）——
         BPM 步进行住进合并组左列后，--tg-align-top 的补偿口径改为
         "开关首行与节拍行同线"（CSS 侧注释同口径，量纲未变：旧 L1 位置）。 */
      var ci=document.getElementById("countInToggle"), vr=document.querySelector(".card-head-left .vol-row");
      if(!ci||!vr||ci.getBoundingClientRect().width<=0||vr.getBoundingClientRect().width<=0) return null;
      return { countInTop:Math.round(ci.getBoundingClientRect().top), volTop:Math.round(vr.getBoundingClientRect().top), delta:Math.round(ci.getBoundingClientRect().top-vr.getBoundingClientRect().top) };
    }
    function dialogTitleLines(){
      var t=document.querySelector("#settingsOverlay .dialog-title");
      if(!t) return null;
      var o=document.getElementById("settingsOverlay"); if(o) o.classList.add("open");
      var r=t.getBoundingClientRect();
      return { lines:lines(t), w:Math.round(r.width), h:Math.round(r.height), text:t.textContent.trim() };
    }
    var tt=document.getElementById("themeToggle");
    var before=document.body.dataset.theme||"classic";
    var res={};
    for (var k=0;k<2;k++){
      var th = k===0 ? "classic" : "obs";
      if((document.body.dataset.theme||"classic")!==th){ tt.click(); await frame(); await settle(); }
      /* ① 主界面 —— ★ v3.33.8：**先把参数面板显形**（变速训练 / 静音拍 / 随机 / 预备拍 开关打开、
          静音配置面板展开）。上一轮这条审计漏掉的就是这里：面板 hidden 时扫不到，
          "参数框过宽把小节标签顶到下一行"因此没被拦住。 */
      var toggleIds = ["trainerToggle","muteToggle","randomToggle","countInToggle"];
      var toggled = [];
      for (var ti=0; ti<toggleIds.length; ti++){
        var tg = document.getElementById(toggleIds[ti]);
        if (tg && tg.getAttribute("aria-checked") !== "true"){ tg.click(); toggled.push(toggleIds[ti]); }
      }
      var muteCfg = document.getElementById("muteCfgPanel");
      var muteWasHidden = muteCfg ? muteCfg.hidden : null;
      if (muteCfg) muteCfg.hidden = false;
      await settle();
      var main = sweep();
      /* 复原（不影响后续界面/主题轮次） */
      for (var ri=0; ri<toggled.length; ri++){ var tb = document.getElementById(toggled[ri]); if (tb) tb.click(); }
      if (muteCfg && muteWasHidden !== null) muteCfg.hidden = muteWasHidden;
      main.align = alignCheck();
      /* ② 设置弹窗（含标题行数） */
      var so = document.getElementById("settingsOverlay"); if(so) so.classList.add("open");
      await settle();
      var dlg = sweep();
      dlg.title = dialogTitleLines();
      if(so) so.classList.remove("open");
      /* ③ 预设侧栏 */
      var dr = document.getElementById("presetDrawer"); if(dr) dr.hidden=false;
      await settle();
      var drawer = sweep();
      if(dr) dr.hidden=true;
      /* ★★★ v3.35.2：**曲式编排左栏**（用户实拍：选中曲式的绿底缺一角、段树歌词被硬切没有省略号、
         侧栏还冒出一条横向滚动条；连段树的「缩小版节奏型」都整条不见了）。
         根因：容器 .arg-list 还是 v3.35.0 之前的横排 flex（改纵向行时漏改），横排下条目带
         min-width:auto 被内容撑到 294px / 段树 400px，双双超过侧栏列宽 273px，
         再被 .arg-outline 的 overflow:auto **静默裁掉**。判据三条：
         ① 侧栏自身不许横向溢出；② #argList 每个直接子项都不越过内容右边界（含选中行整块绿底）；
         ③ 歌词行的 scrollWidth > clientWidth —— 元素自己比文字窄，ellipsis 才会真的画出来
         （否则文字是被外层容器硬切的，用户看到的就是"没有省略号的一刀切"）。 */
      var ao = document.getElementById("arrangeOverlay");
      var arg = null;
      try{
        if (!ao || !/(^| )open( |$)/.test(ao.className)){
          var aoBtn = document.getElementById("argOpen");
          if (aoBtn){ aoBtn.click(); await settle(); }
        }
        var argList = document.getElementById("argList"), argSide = document.getElementById("argSide");
        if (argList && argSide){
          var argItems = [];
          for (var ai=0; ai<argList.children.length; ai++){
            if (/(^| )arg-item( |$)/.test(argList.children[ai].className)) argItems.push(argList.children[ai]);
          }
          /* 选第 2 首：名字最长、且选中态才带 ✕ —— 用户实拍被裁的就是这一行。
             ★ 先记下原选中项：本探针会改「当前在编哪首」，量完必须切回去，
               否则后面依赖视图的探针（歌词跨行拖动，它把夹具写进**示例曲**的段 2）
               会抓到另一首的轨道，报出与本题无关的假红。 */
          var selIdx = -1;
          for (var si=0; si<argItems.length; si++){ if (/(^| )sel( |$)/.test(argItems[si].className)) selIdx = si; }
          if (argItems.length > 1 && !/(^| )sel( |$)/.test(argItems[1].className)){ argItems[1].click(); await settle(); }
          var sr = argSide.getBoundingClientRect();
          var padR = parseFloat(getComputedStyle(argSide).paddingRight) || 0;
          var contentRight = sr.left + argSide.clientWidth - padR;
          var over = 0, worst = "";
          for (var ci=0; ci<argList.children.length; ci++){
            var cb = argList.children[ci].getBoundingClientRect();
            var dd = Math.round((cb.right - contentRight) * 10) / 10;
            if (dd > over){ over = dd; worst = String(argList.children[ci].className || "").slice(0, 24); }
          }
          var lys = argList.querySelectorAll(".arg-ol-lyr"), lyr = null;
          for (var li=0; li<lys.length; li++){ if (!lyr || lys[li].scrollWidth > lyr.scrollWidth) lyr = lys[li]; }
          arg = { listClientW: argList.clientWidth, listScrollW: argList.scrollWidth,
                  sideClientW: argSide.clientWidth, sideScrollW: argSide.scrollWidth,
                  over: over, worst: worst, selIdx: selIdx,
                  lyrText: lyr ? lyr.textContent.slice(0, 8) : "",
                  lyrClientW: lyr ? lyr.clientWidth : 0, lyrScrollW: lyr ? lyr.scrollWidth : 0,
                  lyrOverflow: lyr ? getComputedStyle(lyr).textOverflow : "" };
        }
      }catch(e){ arg = { err: String((e && e.message) || e) }; }
      /* ★ 还原「当前在编哪首」——见上面 selIdx 的说明（否则会污染后面的歌词拖动探针） */
      if (arg && !arg.err && arg.selIdx >= 0 && arg.selIdx !== 1){
        try{
          var argList2 = document.getElementById("argList"), items2 = [];
          if (argList2){ for (var ri2=0; ri2<argList2.children.length; ri2++){ if (/(^| )arg-item( |$)/.test(argList2.children[ri2].className)) items2.push(argList2.children[ri2]); } }
          if (items2[arg.selIdx] && !/(^| )sel( |$)/.test(items2[arg.selIdx].className)){ items2[arg.selIdx].click(); await settle(); }
        }catch(e2){ /* 还原失败不影响本次量到的几何 */ }
      }
      var aoClose = document.getElementById("argClose");
      if (aoClose && ao && /(^| )open( |$)/.test(ao.className)) aoClose.click();
      else if (ao) ao.classList.remove("open");
      res[th] = { main:main, dlg:dlg, drawer:drawer, arr:arg };
    }
    if((document.body.dataset.theme||"classic")!==before){ tt.click(); await frame(); await settle(); }
    return JSON.stringify(res);
  })()`;
}

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
  const passes = [{ label: "file://", url: "file:///" + HTML_PATH.replace(/\\/g, "/") + DEBUG_Q }];
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
      /* ★★★ v3.36.20 补13（修 CI 判红）：传输层自愈之后的那一轮**也要过预算检查**。
         原实现的预算是 `!transport && isBudgetFlake(r)` —— 首次是传输层故障时短路成 false，
         重测结果的预算**从未被检查**，直接进断言 ⇒ 慢 runner 上必然判红。
         CI 实测（f05d340..ee06b34）：smoke 作业先撞传输层故障 → 自愈重测通过，而那次重测恰逢
         一台很慢的机器（首屏 4866ms、播放态 30fps；同提交另一作业 464ms / 61fps）⇒ 30fps 未再自愈就判红。
         这里补一轮：自愈后若仍越预算，再自愈一次；连续三轮都越预算才真判红（不再是抖动）。 */
      if (!isTransport(r) && isBudgetFlake(r)){
        const p1 = (r.probe && r.probe.perf) || {};
        console.log('  · 自愈后仍越预算（首屏 ' + Math.round(p1.bootMs || 0) + 'ms / fps ' + (p1.fps || '?')
          + '）—— 再自愈一轮（补13）');
        const r3 = await runPass(p.label, p.url, profileOf('-retry2'));
        console.log(isBudgetFlake(r3) ? '  · 第二轮重测仍越预算 —— 连续三轮，判红'
          : '  · 第二轮重测落入预算，以它为准');
        r = r3;
      }
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
        /* ★★★ 控制芯批 6（PLAN-v9，居中补正）：控制芯改为**水平居中**——取代 v2.38/v2.39
           「桌面栅格居中 / 窄屏左贴」与「标题文字在控制列内容边缘」的旧口径。
           新契约：芯盒（.group）中心 ≈ 控制栅格中心（容差 2）；且芯顶胶囊行与滑杆塔同左缘。 */
        ok(m.coreCtr && typeof m.coreCtr.off === "number" && Math.abs(m.coreCtr.off) <= 2,
          p.label + "·" + label + "：★★★ 控制芯水平居中（芯中心 − 栅格中心 = "
          + (m.coreCtr && m.coreCtr.off) + "px，容差 2）",
          "coreCtr=" + JSON.stringify(m.coreCtr) + "（视口 " + m.w + "）");
        ok(sameLine(m.corePillsL, m.towerL),
          p.label + "·" + label + "：★★ 芯顶胶囊行与滑杆塔**同左缘**（同住居中芯，左缘差 ≤0.5）",
          "胶囊行 " + m.corePillsL + " vs 滑杆塔 " + m.towerL);
        /* ★★★ v3.41.0（方案对账）：胶囊行**单行**、**居中**，芯底读数行**常显**——方案的核心形态，
           此前无机器看守（折成两行 / 左贴 / 读数行隐身都能溜过去）。 */
        const pg = m.pillGeom;
        ok(!!pg && pg.singleLine === true && pg.rowH <= 40,
          p.label + "·" + label + "：★★★ 芯顶胶囊行**单行**（行高 " + (pg ? pg.rowH : "?")
          + " ≤ 40 = 一枚 36px 胶囊；方案：一行三枚）",
          "pillGeom=" + JSON.stringify(pg));
        ok(!!pg && Math.abs(pg.ctrOff) <= 2,
          p.label + "·" + label + "：★★ 胶囊行**居中**（胶囊束中心 − 芯中心 = " + (pg ? pg.ctrOff : "?")
          + "px，容差 2；v3.41.0 起按方案图的 justify-content:center）",
          "pillGeom=" + JSON.stringify(pg));
        const prg = m.progGeom;
        ok(!!prg && prg.h === 0 && prg.text === "",
          p.label + "·" + label + "：★★ 芯底读数行**随变速训练生死**（训练器未开 ⇒ 空文本零高度；实测高 "
          + (prg ? prg.h : "?") + "px、文本「" + (prg ? prg.text : "") + "」；v3.41.0 撤回 G4）",
          "progGeom=" + JSON.stringify(prg));
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
             开关列与音量/BPM 同排（同排/零横移由 layoutProbe 的 tgBody 段
             colLC 一族与 topBlocks 装箱闸钉死；v3.39.0 起 colBC 随 BPM 列合并除名）。 */
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
        ok(br.length === 1 && !!br[0] && lay.wide.retiredBlocksGone,
          p.label + "：★★ 控制行恰**1 块**（合并组）；开关列与行数拍号行确已退役（PLAN-v9 批 2）",
          "块矩形 " + JSON.stringify(br) + " · retiredGone=" + lay.wide.retiredBlocksGone);
        ok(lay.wide.rowsHome === "settings",
          p.label + "：★★ 同屏行数档位在设置弹窗内（且不在控制行），拍号控件已删除",
          "归属 " + lay.wide.rowsHome + " · sigGroup=" + lay.wide.sigGroup);
        ok(lay.wide.coreCtr && Math.abs(lay.wide.coreCtr.w - 402) <= 1,
          p.label + "：★★ 控制芯盒宽 = 402px（芯口径：52 标签槽 + 10 间距 + 340 滑杆）",
          "芯宽 " + (lay.wide.coreCtr && lay.wide.coreCtr.w));
        /* ★★ v3.13.0（丁方案）：控制区限宽 1000 居中 + 两列 1fr——
           盒宽 ≤1000、两块等宽、两侧空白对称（空白 =(容器−1000)/2，随窗口变大是设计内行为，
           钉的是"盒宽"与"对称性"两个不变量，不是具体像素）。 */
        if (lay.wide.row1){
          ok(lay.wide.row1.w <= 1001,
            p.label + "：★★ 控制区限宽 1000px（.viz-head-grid max-width，恒定紧凑不随窗口稀释）",
            "盒宽 " + lay.wide.row1.w);
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
        /* ★★★ v3.36.20 补4：右缘框线画在真边缘（不许再用背景画）+「块行与卡片共用一条横滑轴」+ 宽屏地图下限 */
      if (vp === "桌面"){
        const G4 = r.cardGutter;
        if (G4 && !G4.err){
          ok(G4.bgImage === "none" && G4.outlineW >= 1 && parseFloat(G4.outlineOff) < 0,
            p.label + "·" + vp + "：★★★ 卡片右缘的框线画在**真正的可见边缘**上（不再用 background 画："
            + "background-origin 默认是 padding-box，会把那条 1px 线画到离边缘 15px 处、在卡片内部留下一条"
            + "贯穿上下的灰竖线，所有内部横线都终结在它上面——用户实报「顶部和底部的边缘与内部线条接触」）",
            "bgImage=" + G4.bgImage + " / outline " + G4.outlineW + "px " + G4.outlineOff);
          ok(G4.blocksOverflowX === "visible" && G4.blocksOwnScroller === false,
            p.label + "·" + vp + "：★★★ 块行**不再有自己的滚动容器**（overflow-x=" + G4.blocksOverflowX
            + "、自身溢出=" + G4.blocksOwnScroller + "）——与卡片共用同一条横滑轴",
            "overflow-x=" + G4.blocksOverflowX + " / ownScroller=" + G4.blocksOwnScroller);
          ok(G4.lastChipReachable === true,
            p.label + "·" + vp + "：★★ 卡片滚到最右时**最后一颗块可达**（它跟着卡片滚，不被自己那层裁掉）",
            "lastChipReachable=" + G4.lastChipReachable);
        }
        const MW = r.mapWide;
        if (MW && !MW.err){
          ok(MW.segMin !== null && MW.segMin >= 28,
            p.label + "·" + vp + "：★★★ **宽屏**下歌曲地图每段也有下限（最窄 " + MW.segMin
            + "px / 整图 " + MW.mapW + "px）——修复前 1440 下首段只有 13px（64 小节摊在 723px 上，1 小节的段最窄）",
            "最窄段 " + MW.segMin + "px");
        } else {
          ok(false, p.label + "·" + vp + "：宽屏地图探针未取到（故障：" + ((MW && MW.err) || "缺失") + "）", "");
        }
        /* ★★★ v3.36.20 补6：641–960 中间档（用户实报机型 740×1804）——胶囊不许压到键组、进度条要吃到富余 */
        /* ★★★ v3.36.20 补38b：宽度扫描断言 —— 矮屏档下 660~1440 每一档都必须"胶囊行可见"
           （★ v3.39.0：两枚胶囊合一后，"同行/不重叠"两判据随对象消失除名） */
        {
          const sw = r.pillSweep || [];
          const bad = sw.filter(function(x){ return !(x.vis === true); });
          ok(sw.length >= 11 && bad.length === 0,
            p.label + "·宽度扫描：矮屏档下 660→1440 全部『合并胶囊行可见』（" + sw.length + " 档）",
            bad.length ? ("不可见的档：" + JSON.stringify(bad)) : ("各档 vis=" + sw.map(function(x){return x.vis;}).join(",")));
        }
        /* ★★★ v3.36.20 补38：折叠方案作用域的三档闸门（窄屏 ∪ 竖屏 ∪ 矮屏；宽裕横屏不得折叠） */
        for (const [nm, m, want, bg] of [["竖屏1000x1400", r.barPortrait, true, "rgba(0, 0, 0, 0)"],
                                          ["矮屏939x406", r.barShort, true, "rgba(0, 0, 0, 0)"],
                                          ["PC 1440x900", r.barPC, false, "rgba(0, 0, 0, 0)"]]){
          if (!m){ ok(false, p.label + "·" + nm + "：折叠作用域档位探针未取到", ""); continue; }
          ok(m.pillsVisible === want,
            p.label + "·" + nm + "：紧凑折叠方案" + (want ? "**应生效**（合并胶囊行可见）" : "**不应生效**（胶囊行隐藏）")
            + "（pillsVisible=" + m.pillsVisible + "）",
            JSON.stringify({ pillsVisible: m.pillsVisible }));
          ok(m.ctlCardBg === bg,
            p.label + "·" + nm + "：控制卡底色应为 " + bg + "（v3.41.0 起**全档无卡底**；实测 " + m.ctlCardBg + "）",
            "bg=" + m.ctlCardBg);
        }
        const M6 = r.barMid;
        if (M6 && !M6.err){
          ok(M6.overlapCtxJump !== null && M6.overlapCtxJump <= 0,
            p.label + "·740档：★★★ 胶囊**不再压到传输键组上**（胶囊右缘 − 键组左缘 = " + M6.overlapCtxJump
            + "px）——修复前实测 **+82px 重叠**（胶囊定宽 320 塞进 181px 的列里溢出去了）",
            "overlap=" + M6.overlapCtxJump);
          ok(M6.progressW !== null && M6.progressW >= 400,
            p.label + "·740档：★★★ 这一档的进度条也吃到了富余（" + M6.progressW
            + "px）——修复前被 1fr 列卡在 181px",
            "progressW=" + M6.progressW);
          ok(M6.gapTop !== null && M6.gapBtns !== null && M6.gapTop > M6.gapBtns,
            p.label + "·740档：★★★ 竖屏「胶囊↔键组」组外间距（" + M6.gapTop
            + "px）**大于**键组内部间距（" + M6.gapBtns + "px）",
            "gapTop=" + M6.gapTop + " gapBtns=" + M6.gapBtns);
          ok(M6.gapTop !== null && M6.gapTop >= 26 && M6.gapBottom !== null && M6.gapBottom <= 14,
            p.label + "·740档：★★★ 竖屏上 28 / 下 12（实测 " + M6.gapTop + " / " + M6.gapBottom + "）",
            "gapTop=" + M6.gapTop + " gapBottom=" + M6.gapBottom);
          /* ★★★ v3.36.20 补11：641–960 档状态灯与上方胶囊首元素的**对齐**。
             根因：读数（可见，占 120px）排在状态灯前面，把圆点推到 x=146 ⇒ 与 ‹(29) 差 117px。 */
          ok(M6.statusDelta !== null && Math.abs(M6.statusDelta) <= 3,
            p.label + "·740档：★★★ 状态灯与上方胶囊的 ‹ 对齐（差 " + M6.statusDelta
            + "px）——修复前读数排在状态灯前面、把圆点推后 117px",
            "statusDelta=" + M6.statusDelta);
          ok(M6.progressW !== null && M6.progressW >= 400,
            p.label + "·740档：★★★ 只动上排 ⇒ 进度条长度不受影响（" + M6.progressW + "px）",
            "progressW=" + M6.progressW);
          ok(M6.btnTopGap !== null && M6.btnTopGap >= 8,
            p.label + "·740档：★★★ 播放键**不贴上缘**（上缘 " + M6.btnTopGap
            + "px）——修复前这一档只有 **1px**（那条「居中 + 顶部内边距」的修复被圈在 ≤640 里没跟过来）",
            "btnTopGap=" + M6.btnTopGap);
        } else {
          ok(false, p.label + "：641–960 中间档探针未取到（故障：" + ((M6 && M6.err) || "缺失") + "）", "");
        }
        /* ★★★ v3.36.20 补6：961–1000 桌面档 —— 胶囊不许压到键组（靠 .pb-ctx{max-width:100%}） */
        const E6 = r.barEdge;
        if (E6 && !E6.err){
          ok(E6.overlapCtxJump !== null && E6.overlapCtxJump <= 0,
            p.label + "·970档：★★★ 胶囊**不压传输键组**（右缘 − 键组左缘 = " + E6.overlapCtxJump
            + "px）——这一档左右各 1fr（约 291px）装不下定宽 320 的胶囊，靠 .pb-ctx{max-width:100%} 收住",
            "overlap=" + E6.overlapCtxJump);
        } else {
          ok(false, p.label + "：970 档探针未取到（故障：" + ((E6 && E6.err) || "缺失") + "）", "");
        }
        /* ★★★ v3.36.20 补5：**横屏**底栏——状态区让位给进度条（只在 landscape 生效，
           故用 640×360 单独量的那一份数据；挂在这一档只是为了让整块只跑一次）。 */
        const P5 = r.playBarLandscape;
        if (P5 && !P5.err){
          /* ★ 下排左半（读数/状态）与进度条**不许重叠** —— 状态列一旦被写成定宽，
             390 竖屏下它会越过自己的列压到进度条上（实测右缘 172 > 进度条左缘 164，gapBottom = −8）。 */
          ok(P5.gapBottom !== null && P5.gapBottom >= 0,
            p.label + "·" + vp + "：★★★ 下排左半与进度条**不重叠**（间距 " + P5.gapBottom + "px）",
            "gapBottom=" + P5.gapBottom);
          ok(P5.statusW !== null && P5.statusW >= 100 && P5.statusW <= 170,
            p.label + "·横屏640：★★★ 状态区宽度**有上限**（" + P5.statusW + "px）——修复前它被网格列拉成 398px、"
            + "文案只占 33px、空出 365px",
            "statusW=" + P5.statusW);
          ok(P5.progressW !== null && P5.progressW >= 400,
            p.label + "·横屏640：★★★ 富余**让给了进度条**（" + P5.progressW + "px）——修复前只有 198px",
            "progressW=" + P5.progressW);
          ok(P5.longTextOverflow === false,
            p.label + "·横屏640：★★ 最长那条状态文案（「播放中 · 第 64 小节 · 8&」）在上限内**不被截断**"
            + "（防 v3.33.12「状态行被切掉约 3 字」那个老毛病回来）",
            "longTextOverflow=" + P5.longTextOverflow);
          /* ★ v3.36.20 补10（用户拍板 (甲)）：窄档**横屏**也吃 28 ⇒ 上 28 / 下 12，
             不再满足"上=下"（用户在弄清"窄档/宽档"与"朝向"是两个轴之后明确接受这个代价）。
             判据与竖屏两档统一：组外 > 组内 + 上 ≥26 + 下 ≤14。 */
          ok(P5.gapTop !== null && P5.gapBtns !== null && P5.gapTop > P5.gapBtns,
            p.label + "·横屏640：★★★ 「胶囊↔键组」组外间距（" + P5.gapTop
            + "px）**大于**键组内部间距（" + P5.gapBtns + "px）",
            "gapTop=" + P5.gapTop + " gapBtns=" + P5.gapBtns);
          ok(P5.gapTop !== null && P5.gapTop >= 26 && P5.gapBottom !== null && P5.gapBottom <= 14,
            p.label + "·横屏640：★★★ 横屏也上 28 / 下 12（实测 " + P5.gapTop + " / " + P5.gapBottom
            + "）——只动上排：进度条长度不受影响",
            "gapTop=" + P5.gapTop + " gapBottom=" + P5.gapBottom);
          ok(P5.btnTopGap !== null && P5.btnTopGap >= 8,
            p.label + "·横屏640：★★★ 播放键**不贴上缘**（上缘 " + P5.btnTopGap + "px）",
            "btnTopGap=" + P5.btnTopGap);
          ok(P5.jumpW !== null && Math.abs(P5.jumpW - 198) <= 6,
            p.label + "·横屏640：★★ 传输键组宽度**没动**（" + P5.jumpW
            + "px）——三列网格把键组挪到第 3 列，位置与宽度都不该受影响",
            "jumpW=" + P5.jumpW);
        } else {
          ok(false, p.label + "：横屏底栏探针未取到（故障：" + ((P5 && P5.err) || "缺失") + "）", "");
        }
      }
      /* ★★★ v3.36.21：竖屏四修（用户实报）——只在这一档量（范围条件） */
      if (vp === "窄屏390"){
        const PF = r.portraitFix;
        if (PF && !PF.err){
          /* ★★★ v3.36.20 补7：**390 竖屏**下排左半（状态）与进度条**不许重叠**。
             状态列一旦被写成定宽 156，它会越过自己的列压到进度条上（实测右缘 172 > 进度条左缘 164，
             gapBottom 12 → **−8**）。这条断言是首轮 M19 变异**没被抓住**之后按危害现补的。 */
          ok(PF.gapBottom !== null && PF.gapBottom >= 0,
            p.label + "·" + vp + "：★★★ 下排状态与进度条**不重叠**（间距 " + PF.gapBottom
            + "px）——状态列用 min(156px,30vw) 而不是定宽，靠的就是这条",
            "gapBottom=" + PF.gapBottom);
          /* ★ v3.36.20 补8（用户口径）：竖屏下「胶囊 ↔ 键组」这个**组外**间距必须**大于**键组内部的间距，
             否则两者读作同一级、胶囊像是贴着键组。竖屏定为 上 20 / 下 12（用户拍板）。 */
          ok(PF.gapTop !== null && PF.gapBtns !== null && PF.gapTop > PF.gapBtns,
            p.label + "·" + vp + "：★★★ 竖屏「胶囊↔键组」组外间距（" + PF.gapTop
            + "px）**大于**键组内部间距（" + PF.gapBtns + "px）",
            "gapTop=" + PF.gapTop + " gapBtns=" + PF.gapBtns);
          ok(PF.gapTop !== null && PF.gapTop >= 26 && PF.gapBottom !== null && PF.gapBottom <= 14,
            p.label + "·" + vp + "：★★★ 竖屏上 28 / 下 12（实测 " + PF.gapTop + " / " + PF.gapBottom
            + "）——只动上排：进度条长度不受影响",
            "gapTop=" + PF.gapTop + " gapBottom=" + PF.gapBottom);
          /* ★★★ v3.36.20 补15（用户拍板 ①）：窄屏**默认收起控制区** —— 练习网格必须回到首屏内。
             修复前实测：390×844 控制卡 624px = 首屏 74%、#viz 顶部 855px（首屏 844 之外）✗。 */
          ok(PF.ctlCardH !== null && PF.ctlCardH <= 520 && PF.vizTop !== null && PF.vizTop <= 760,
            p.label + "·" + vp + "：★★★ 窄屏控制卡**默认收起**、练习网格回到首屏内（卡片高 " + PF.ctlCardH
            + "px / #viz 顶 " + PF.vizTop + "px / 视口 844px）——修复前 624px / 855px（#viz 在首屏之外）",
            "cardH=" + PF.ctlCardH + " vizTop=" + PF.vizTop);
          /* ★ v3.36.20 补24：容差 4 → 14。**又是字体敏感阈值**（与 补12 同类错误）：
             本机 macOS 实测差 0px，而 GitHub CI 的 Linux 字体下是 −9px（读数/标签的文本宽度不同），
             于是"对齐"这条在 CI 上稳定判红。14px 足够容纳字体差，且仍拦得住真错位
             （修复前是 +104px、修好后本机 0px）。 */
          /* ★★★ v3.36.20 补26：**可见边缘**口径的断言 —— 两组"胶囊→首行可见内容"的间距必须相等。
             修复前实测：音量 19px（行盒 40、内容居中 ⇒ 可见内容离盒顶 11）vs BPM 8px ⇒ 差 11px，
             而**盒子**口径两边都是 8（这就是"看着绿、肉眼不齐"的根源）。 */
          /* ★ 补31（原口径）：胶囊行 → **首个内容块**的可见间距落在合理带内；② BPM 内容块在音量块**下方**。
             ★ v3.39.0：两枚胶囊合一 ⇒ "不重叠/同行"两判据随对象消失除名（合并胶囊只有一枚，
             自重叠在几何上不成立）。 */
          ok(PF.volPillInk !== null && PF.volPillInk >= 4 && PF.volPillInk <= 30,
            p.label + "·" + vp + "：★★★ 胶囊行 → 首个内容块的**可见**间距落在 4~30px（实测 " + PF.volPillInk
            + "px）——可见边缘口径",
            "volPillInk=" + PF.volPillInk);
          ok(PF.pillLive && PF.pillLive.bpm === "97",
            p.label + "·" + vp + "：★★★ 折叠读数钮实时值跟随（点 +1 应显示 97；"
            + "控制芯批 3 起音量 % 读数退役，只量 BPM）",
            JSON.stringify(PF.pillLive));
          ok(PF.ctlCardBg === "rgba(0, 0, 0, 0)" || PF.ctlCardBg === "transparent",
            p.label + "·" + vp + "：★★★ 控制卡**无底色**（实测 " + PF.ctlCardBg + "）——用户拍板「任何时候都没有卡底」",
            "bg=" + PF.ctlCardBg);
          ok(PF.volBodyTop !== null && PF.bpmBodyTop !== null && PF.bpmBodyTop > PF.volBodyTop + 20,
            p.label + "·" + vp + "：★★★ A1 排列：BPM 内容块在音量内容块**下方**（" + PF.volBodyTop
            + " → " + PF.bpmBodyTop + "）",
            "volBodyTop=" + PF.volBodyTop + " bpmBodyTop=" + PF.bpmBodyTop);
          ok(PF.volBpmDelta !== null && Math.abs(PF.volBpmDelta) <= 2,
            p.label + "·" + vp + "：★★★ v3.39.1 BPM 滑杆右端与音量滑杆右端对齐（差 " + PF.volBpmDelta
              + "px）——等长的右端判据；容差 2 容纳取整",
            "volBpmDelta=" + PF.volBpmDelta);
          ok(PF.volBpmLeftDelta !== null && Math.abs(PF.volBpmLeftDelta) <= 2,
            p.label + "·" + vp + "：★★★ v3.39.1 BPM 滑杆左端与音量滑杆左端对齐（差 " + PF.volBpmLeftDelta
              + "px）——与右端判据同时为 0 ⇔ 两杆等长且两端一一对齐",
            "volBpmLeftDelta=" + PF.volBpmLeftDelta);
          ok(PF.bpmClusterAxis !== null && Math.abs(PF.bpmClusterAxis) <= 2,
            p.label + "·" + vp + "：★★★ v3.41.0 步进群轴心落在**芯轴**（BPM 行轴）上（偏 " + PF.bpmClusterAxis
              + "px）——方案图口径；v3.39.1 的「参照滑杆」会偏右 31px",
            "bpmClusterAxis=" + PF.bpmClusterAxis);
          ok(PF.bpmStackedDown !== null && PF.bpmStackedDown >= 0,
            p.label + "·" + vp + "：★★★ v3.39.1 步进群在滑杆**下方**（间隙 " + PF.bpmStackedDown
              + "px）——塔式形状本体，回潮到同行会变负",
            "bpmStackedDown=" + PF.bpmStackedDown);
          ok(PF.btnTopGap !== null && PF.btnTopGap >= 8,
            p.label + "·" + vp + "：★★★ 播放键**不贴上缘**（上缘 " + PF.btnTopGap + "px）",
            "btnTopGap=" + PF.btnTopGap);
          ok(PF.segMin !== null && PF.segMin >= 28,
            p.label + "·" + vp + "：★★★ 歌曲地图**每段都 ≥28px 可点**（最窄 " + PF.segMin + "px / 共 "
            + PF.segN + " 段，整图 " + PF.mapW + "px）——修复前每段只有 2px、完全没法点（地图 flex:1+min-width:0 "
            + "一路被压到 0，而同行读数是 flex:none;white-space:nowrap 一格不让）",
            "最窄段 " + PF.segMin + "px / 整图 " + PF.mapW + "px");
          ok(PF.trackH >= 20 && PF.trackActionsGap >= 6,
            p.label + "·" + vp + "：★★★ 滑条与下一行不再重叠（滑条盒高 " + PF.trackH + "px、间距 "
            + PF.trackActionsGap + "px）——修复前滑条盒高 0（那条 flex:1 1 100% 是按横向写的，"
            + "在 column 容器里把高度压成 0）、与「循环段/全部/锚点提示音」那行重叠 12px",
            "滑条高 " + PF.trackH + " / 间距 " + PF.trackActionsGap);
          ok(PF.btnTopGap !== null && PF.btnTopGap >= 8,
            p.label + "·" + vp + "：★★ 播放键不再贴底栏上缘（离上缘 " + PF.btnTopGap
            + "px）——修复前实测只有 3px（内容在固定高度里不居中，上 3px 下 16px）",
            "上间距 " + PF.btnTopGap + "px");
          ok(PF.statusDelta !== null && Math.abs(PF.statusDelta) <= 3,
            p.label + "·" + vp + "：★★ 状态灯与上方胶囊的首元素对齐（差 " + PF.statusDelta
            + "px）——修复前差 11px（圆点贴容器左缘 x=16，上面胶囊的 ‹ 被 padding-left:10px 推到 x=27）",
            "差 " + PF.statusDelta + "px");
        } else {
          ok(false, p.label + "·" + vp + "：竖屏四修探针未取到（故障：" + ((PF && PF.err) || "缺失") + "）", "");
        }
      }
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
          ok(L.tgBody.colLC === L.tgBody.colLM && L.tgBody.colLM === L.tgBody.colLB,
            p.label + "·" + vp + "：★★★ 合并组（音量+BPM）列 left/top/width **逐像素不动**"
            + "（v3.21.0：高度随行高铺开是用户需求，横移/顶移仍为零；v3.39.0 起 BPM 列随合并除名）",
            "合并组 " + L.tgBody.colLC + " → " + L.tgBody.colLM + " → " + L.tgBody.colLB);
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
          /* ★★★ v3.33.8：文字对比度（两主题）。用户报障「日间模式下部分按钮的字体和背景色几乎
             融为一体，看不清」——根因是日间主题漏覆盖 --sel-bg/--sel-line（选中胶囊深底墨蓝字
             1.31:1），另有 --amber（和弦胶囊 1.95:1）与 --t3 在浅色分层底上 3.87:1。
             改前实测日间 44 处不合格；本条把「所有可见文字 ≥ AA」钉成闸门，防回潮。
             ★ 断言分两层：先钉"确实扫到了足够多的带字元素"（防探针自身失效时的假绿），再钉零不合格。 */
          if (vp === "桌面" && r.contrast && !r.contrast.err){
            const CT = r.contrast;
            [["classic", "经典"], ["obs", "日间"]].forEach(function(pair){
              const d = CT[pair[0]] || { n: 0, fails: [] };
              ok(d.n >= 120,
                p.label + "·" + vp + "：★ 前提：对比度审计扫到足量带字元素（" + pair[1] + " " + d.n + " 个）",
                "只有 " + d.n + " 个（探针失效？）");
              ok(d.fails.length === 0,
                p.label + "·" + vp + "：★★ " + pair[1] + "主题下所有可见文字对比度 ≥ AA（正文 4.5:1 / 大字号 3:1）",
                d.fails.slice(0, 4).map(function(x){
                  return x.cr + ":1 " + x.cls + " fg=" + x.fg + " bg=" + x.bg + " 「" + x.t + "」\n       链：" + x.chain;
                }).join(" ／ ") + (d.fails.length > 4 ? " …共 " + d.fails.length + " 处" : ""));
            });
          } else if (vp === "桌面"){
            ok(false, p.label + "·" + vp + "：对比度审计未取到（probe 缺失，属冒烟自身故障）", "");
          }
          /* ★★★ v3.33.8：版面审计（两主题 × 主界面/设置弹窗/预设侧栏）——见 layoutAuditProbe 的注释：
             ① 短块级文本不得逐字竖排；② .sec-tag 不得把同行兄弟挤到 <40px；③ 日间/经典都必须
             「预备拍开关首行 = BPM 的 +5」（用户实拍：日间对齐到了标题行）。 */
          if (vp === "桌面" && r.layoutAudit && !r.layoutAudit.err){
            const LA = r.layoutAudit;
            [["classic", "经典"], ["obs", "日间"]].forEach(function(pair){
              const D = LA[pair[0]] || { main: { n: 0, wrapped: [], squeezed: [] }, dlg: { n: 0, wrapped: [], squeezed: [], title: null }, drawer: { n: 0, wrapped: [], squeezed: [] } };
              const wraps = [].concat(D.main.wrapped, D.dlg.wrapped, D.drawer.wrapped);
              const sqz = [].concat(D.main.squeezed, D.dlg.squeezed, D.drawer.squeezed);
              ok(D.main.n >= 150,
                p.label + "·" + vp + "：★ 前提：版面审计扫到足量元素（" + pair[1] + " 主界面 " + D.main.n + " 个）", "");
              ok(wraps.length === 0,
                p.label + "·" + vp + "：★★ " + pair[1] + "主题下没有短文本被排成竖排/异常折行（v3.33.8 修「设置」逐字竖排）",
                wraps.slice(0, 3).map(function(x){ return "「" + x.t + "」 " + x.cls + " w=" + x.w + " 行数=" + x.lines; }).join(" ／ "));
              ok(sqz.length === 0,
                p.label + "·" + vp + "：★★ " + pair[1] + "主题下 .sec-tag 没有把同行兄弟挤到 <40px（设置弹窗头部那条）",
                sqz.slice(0, 3).map(function(x){ return x.parent + " 角标 " + x.tagW + "/" + x.parentW + " 兄弟仅 " + x.sibW + "px"; }).join(" ／ "));
              /* ★★★ v3.35.2：曲式编排左栏（用户实拍：选中曲式的绿底缺一角、段树歌词硬切无省略号、
                 缩略带整条不见、侧栏冒出横向滚动条）。见 layoutAuditProbe 里 ④ 的注释。 */
              if (D.arr && !D.arr.err){
                ok(D.arr.sideScrollW <= D.arr.sideClientW + 1,
                  p.label + "·" + vp + "：★★★ " + pair[1] + "主题下曲式编排左栏**没有横向溢出**"
                  + "（溢出会被 overflow:auto 静默裁掉：绿底缺角、段树缩略带整条不见）",
                  "侧栏 scrollWidth=" + D.arr.sideScrollW + " vs clientWidth=" + D.arr.sideClientW);
                ok(D.arr.over <= 1,
                  p.label + "·" + vp + "：★★★ " + pair[1] + "主题下 #argList 的子项都在侧栏内容宽内（选中曲式那整块绿底不被裁）",
                  "最宽越界 " + D.arr.over + "px（" + D.arr.worst + "）");
                ok(D.arr.lyrScrollW > D.arr.lyrClientW && /ellipsis/.test(D.arr.lyrOverflow),
                  p.label + "·" + vp + "：★★★ " + pair[1] + "主题下段树歌词在**自己的盒子**里溢出 ⇒ 省略号真的画出来"
                  + "（元素比文字宽时是外层容器硬切，用户看到的是一刀切、没有 …）",
                  "「" + D.arr.lyrText + "」 clientW=" + D.arr.lyrClientW + " scrollW=" + D.arr.lyrScrollW
                  + " text-overflow=" + D.arr.lyrOverflow);
              } else if (vp === "桌面"){
                ok(false, p.label + "·" + vp + "：曲式编排左栏版面未取到（探针故障）",
                  D.arr ? String(D.arr.err) : "layoutAudit.arr 缺失");
              }
              if (D.dlg.title){
                ok(D.dlg.title.lines === 1 && D.dlg.title.w >= 20,
                  p.label + "·" + vp + "：★★ 设置弹窗标题「" + D.dlg.title.text + "」单行且未被挤（实测宽 " + D.dlg.title.w + " / " + D.dlg.title.lines + " 行）", "");
              }
              if (D.main.align){
                /* ★★★ 控制芯批 6（PLAN-v9）：开关列退役为**芯顶胶囊行** ⇒ v3.30.0「开关首行
                   与节拍行同线」口径失效（开关不再与滑杆同行）。新契约 = 胶囊行在滑杆塔**上方**。 */
                ok(D.main.align.countInTop < D.main.align.volTop,
                  p.label + "·" + vp + "：★★★ " + pair[1] + "主题下芯顶胶囊行（预备）在滑杆塔第 1 行（节拍）**上方**"
                  + "（PLAN-v9 取代 v3.30.0「开关首行↔节拍行同线」——开关列退役为顶部胶囊行）",
                  "预备 top=" + D.main.align.countInTop + " vs 节拍行 top=" + D.main.align.volTop);
              } else {
                ok(false, p.label + "·" + vp + "：" + pair[1] + "主题下两走道对齐未取到（探针故障）", "");
              }
            });
          } else if (vp === "桌面"){
            ok(false, p.label + "·" + vp + "：版面审计未取到（probe 缺失，属冒烟自身故障）", "");
          }
          /* ★★★ v3.33.15：编辑器头部（用户实拍「编辑节奏型头部被压扁」）。
             触发条件 = 引用提示非空（正在编辑被曲式引用的型），探针已把它造出来。 */
          if (vp === "桌面"){
            const EH = r.editorHeader;
            if (EH && !EH.err){
              ok(EH.inTopbar === false,
                p.label + "·" + vp + "：★★★ 引用提示在 .editor-topbar **之外**"
                + "（它曾是第三个 flex 子项，把顶栏一起挤爆；v3.33.15 移到栏下）", "");
              ok(EH.noteTop >= EH.topBottom - 1,
                p.label + "·" + vp + "：★★ 长提示落在顶栏**下方**而非栏内",
                "提示 top=" + EH.noteTop + " vs 顶栏 bottom=" + EH.topBottom);
              ok(EH.topH <= 80,
                p.label + "·" + vp + "：★★★ 长提示在场时顶栏仍是**单行**（高度 " + EH.topH + "px）"
                + "——被挤爆时会折行/撑高", "");
              ok(EH.btns.length >= 2 && EH.btns.every(function(b){ return b.lines === 1 && b.w >= 30; }),
                p.label + "·" + vp + "：★★★ 顶栏按钮文字**单行**且未被压扁（不竖排、不被裁）",
                EH.btns.map(function(b){ return "「" + b.t + "」 w=" + b.w + " 行数=" + b.lines; }).join(" ／ "));
              ok(EH.titleLines <= 2,
                p.label + "·" + vp + "：★★ 长提示在场时标题不超过 2 行",
                "实测 " + EH.titleLines + " 行 / 宽 " + EH.titleW);
            } else {
              ok(false, p.label + "·" + vp + "：编辑器头部探针未取到（探针故障："
                + ((EH && EH.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.36.20 补：卡片右缘**留白**——压窄后内容必须被裁在离卡片可见边缘 ≥14px 处 */
          if (vp === "桌面"){
            const G = r.cardGutter;
            if (G && !G.err){
              ok(G.wideGutter >= 14,
                p.label + "·" + vp + "：★★ 宽屏下卡片右缘留白 ≥14px（实测 " + G.wideGutter + "px）", "");
              /* ★ v3.36.20 补4 改判据（不变量不变：当前段**真正的卡片边缘必须有边线**）：
                 补2/补3 用 background-image 渐变补那条线，但它会被 background-origin:padding-box 画到
                 离边缘 15px 处（反而在卡片内部留一条灰竖线）；补4 改用 outline（画在边框盒内侧）。
                 故这里从"背景里有渐变"改成"有 outline 且带负偏移"，并额外要求 background 里
                 **不许**再有那条渐变（它会画错位置）。 */
              ok(G.outlineW >= 1 && parseFloat(G.outlineOff) < 0 && G.bgImage === "none",
                p.label + "·" + vp + "：★★★ 当前段**真正的卡片边缘有边线**（outline " + G.outlineW + "px "
                + G.outlineOff + " · background-image = " + G.bgImage + "）——用 background 画会被 "
                + "background-origin:padding-box 画到离边缘 15px 处、在卡片内部留下贯穿上下的灰竖线",
                "outline " + G.outlineW + "px " + G.outlineOff + " / bgImage=" + G.bgImage);
              ok(G.insetShadow === false && G.outlineW > 0,
                p.label + "·" + vp + "：★★★ 当前段的内环画在**真正的可见边缘**上（outline " + G.outlineW
                + "px / inset 阴影 = " + G.insetShadow + "）——inset 阴影画在 padding box 上，"
                + "会被 15px 透明边框一起推进来 15px，蓝环就成了「假边框」（用户实报：效果跟切在边框一样）",
                "insetShadow=" + G.insetShadow + " / outlineWidth=" + G.outlineW);
              ok(G.narrowScrollable === true && G.narrowGutter >= 14,
                p.label + "·" + vp + "：★★★ 卡片压窄到 " + G.narrowCardW + "px 后**右侧留白仍在**（" + G.narrowGutter
                + "px）——内容被裁在离卡片可见边缘 15px 处，不再画到边框上（用户实报「歌词行依然压在边缘上」）",
                "留白 " + G.narrowGutter + "px / 可横滑 " + G.narrowScrollable);
            } else {
              ok(false, p.label + "·" + vp + "：卡片留白探针未取到（故障：" + ((G && G.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.36.20：段卡片「放不下就横滑」——把卡片压窄到 360px，精修行数不许变、格不许被压小 */
          if (vp === "桌面"){
            const LS = r.lyricScroll;
            if (LS && !LS.err){
              ok(LS.wideRows >= 4, p.label + "·" + vp + "：★ 前提：宽屏下精修控件有 " + LS.wideRows + " 个视觉行", "");
              ok(LS.keptRows === true,
                p.label + "·" + vp + "：★★★ 卡片压窄到 360px 后**精修控件的视觉行数不变**（" + LS.narrowRows
                + " 行，宽屏 " + LS.wideRows + " 行）——「按钮不换行」的真机闸；"
                + "撤掉 .arg-lyric 的最小宽度时这里会多折行",
                "窄屏 " + LS.narrowRows + " 行 / 宽屏 " + LS.wideRows + " 行");
              ok(LS.scrollable === true && LS.overflowX === "auto",
                p.label + "·" + vp + "：★★ 放不下时由**卡片自己横滑**接住（不再画到卡片边框外）",
                "overflow-x=" + LS.overflowX + " / scrollable=" + LS.scrollable);
              ok(LS.ruleEffective === true,
                p.label + "·" + vp + "：★★★ 最小宽度**确实在起作用**（摘掉后歌词区从 " + LS.narrowLyW
                + "px 掉到 " + LS.strippedLyW + "px、行数 " + LS.narrowRows + " → " + LS.strippedRows
                + "）——这条是防「假绿」的自证：1440px 下摘要文字碰巧也够长时，前两条会一起骗过",
                "带规则 " + LS.narrowLyW + "px / 摘掉 " + LS.strippedLyW + "px");
              ok(LS.keptScale === true,
                p.label + "·" + vp + "：★★★ 歌词格**保持原尺度**（压窄后 " + LS.narrowBarrowW
                + "px > 卡片 " + LS.cardPaintedW + "px ⇒ 横滑，而不是被压到卡片宽）",
                "窄屏格宽 " + LS.narrowBarrowW + " / 卡片 " + LS.cardPaintedW);
            } else {
              ok(false, p.label + "·" + vp + "：卡片横滑探针未取到（故障：" + ((LS && LS.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.38.1 补5：音高标注真机几何（**现行口径**）——
             ① 数码整枚垂直居中、② 高音点贴数码头部右侧 / 低音点贴数码脚部左侧且不越出数码高度带、
             ③ 歌词字在右下、④ nm 档音名与歌词字不相交、⑤ nm 窄格整枚不画。
             桩里一条都测不到（没有布局）。旧口径（三档槽位 / 点在数码右侧一律 / 窄格三级降级 /
             字心 clamp）已随实现退役，对应断言在本轮**删净**，不留 ok(true) 占位。 */
          if (vp === "桌面"){
            const PM = r.pitchMark;
            if (PM && !PM.err){
              const pick = o => (PM.wide || []).filter(x => x.oct === o)[0] || null;
              const hi = pick("hi"), mid = pick("mid"), lo = pick("lo");
              ok(!!hi && !!mid && !!lo, p.label + "·" + vp + "：★ 前提：高/中/低三颗谱字都量到", "");
              if (hi && mid && lo){
                /* ★★★ v3.38.1 补8（用户口径变更）：音符**左上锚定**——低音点改为挂在数码正下方，
                   整枚 glyph 向下生长（0.85f + 0.4f×点数），竖向居中会让 2 颗点顶破 26px 格底
                   （补3 的「数码居中」与这一条互斥，以用户最新口径为准）。
                   判据：三个音区的**数码顶都在格顶附近**（同一水平线），且都 ≤ 3px。 */
                /* 容差 1.5px：低音 2 颗点时整枚缩一档字号（补8 的格高约束），数码行盒随之小 1px
                   ——这是"缩一档"的固有副作用，不是槽位漂移。 */
                ok(hi.bodyTop <= 3 && mid.bodyTop <= 3 && lo.bodyTop <= 3
                  && Math.abs(hi.bodyTop - mid.bodyTop) <= 0.5 && Math.abs(hi.bodyTop - lo.bodyTop) <= 1.5,
                  p.label + "·" + vp + "：★★★ 三个音区的数码**同一水平线且贴格顶**（左上锚定；数码顶 "
                  + hi.bodyTop + " / " + mid.bodyTop + " / " + lo.bodyTop + " px ≤ 3）",
                  "hi=" + hi.bodyTop + " mid=" + mid.bodyTop + " lo=" + lo.bodyTop);
              }
              const withDots = (PM.wide || []).filter(x => x.dotGap !== null);
              if (withDots.length){
                const minClip = Math.min.apply(null, withDots.map(x => x.clipRight));
                const hiD = (PM.wide || []).filter(x => x.oct === "hi" && x.dotTop !== null)[0] || null;
                const loD = (PM.wide || []).filter(x => x.oct === "lo" && x.dotTop !== null)[0] || null;
                /* ★ 坐标系必须同框：dotTopC/dotBottom 与 bodyTop/bodyBottom 都是**相对 chip** 的。
                   此前这条拿 body 相对的 dotTop 去比 chip 相对的 bodyTop，两边原点不同 ⇒ 恒判红
                   （v3.38.1 补5 修：不是实现不对，是断言自己写错了框）。 */
                /* ★★★ v3.38.1 补8（用户口径）：高音点 = 数码头部的**右边**（不向顶部多要空间 ⇒ 竖向仍在
                   数码高度带内）；低音点 = 数码**正下方偏左**（从数码底往下长，且不越出格底）。 */
                const hiOk = !!hiD && hiD.dotTopC >= hiD.bodyTop - 0.5 && hiD.dotBottomC <= hiD.bodyBottom + 0.5;
                const loOk = !!loD && loD.dotTopC >= loD.bodyBottom - 0.5 && loD.dotBottomC <= loD.chipH + 0.5;
                ok(hiOk && loOk,
                  p.label + "·" + vp + "：★★★ 高音点在数码**头部右侧**（竖向不越出数码高度带）、"
                  + "低音点在数码**正下方**（从数码底向下长、不越出格底；"
                  + "高 " + (hiD ? hiD.dotTopC + "…" + hiD.dotBottomC + " ⊂ " + hiD.bodyTop + "…" + hiD.bodyBottom : "?")
                  + "，低 " + (loD ? loD.dotTopC + "…" + loD.dotBottomC + " ⊂ 数码底 " + loD.bodyBottom + " … 格底 " + loD.chipH : "?")
                  + "）",
                  (hiD && loD) ? ("高音点 " + hiD.dotTopC + "…" + hiD.dotBottomC + " vs 数码 " + hiD.bodyTop + "…" + hiD.bodyBottom
                    + "／低音点 " + loD.dotTopC + "…" + loD.dotBottomC + " vs 数码底 " + loD.bodyBottom + " / 格底 " + loD.chipH) : "");
                /* 低音点改为"数码正下方偏左"：横向**不离开数码的宽度**（left:0 ⇒ dotL≈bodyL、dotR ≤ bodyR），
                   纵向在数码底之下（由上面那条判）。原来那条 dotR ≤ bodyL（贴脚部左侧）随之退役。 */
                ok(hiD && loD && hiD.dotL >= hiD.bodyR - 1.5
                  && loD.dotL >= loD.bodyL - 0.5 && loD.dotR <= loD.bodyR + 0.5,
                  p.label + "·" + vp + "：★★★ 高音点贴数码**头部右侧**（" + (hiD ? hiD.dotL + " ≥ " + hiD.bodyR : "?")
                  + "）、低音点在数码**正下方且不离开数码宽度**（" + (loD ? loD.dotL + "…" + loD.dotR
                    + " ⊂ " + loD.bodyL + "…" + loD.bodyR : "?") + "）", "");
                const inChip = (PM.wide || []).filter(x => x.gTop !== null);
                ok(inChip.length > 0 && inChip.every(x => x.gTop >= -0.5 && x.gBot <= x.chipH + 0.5),
                  p.label + "·" + vp + "：★★★ 整枚（含 2 颗点）都在格内不顶边", "");
                ok(minClip >= 0, p.label + "·" + vp + "：★★★ 宽格下**不裁字**（chip 右缘 − 点右缘 最小 " + minClip + "px）", "");
              } else {
                ok(false, p.label + "·" + vp + "：★ 前提：至少一颗带点的谱字（否则上面两条是空判据）", "");
              }
              /* ★★★ v3.38.1 补9（用户口径变更）：**歌词字靠左** + 贴格底。
                 左缘落在那条左内缩上（≥24px = "音符区之后"，既不贴格左、也不被推到格右）；
                 底缘贴格底（bottom:1px）。横向对齐必须用**字形**的左右缘判：元素盒横跨整格，
                 它恒等于左内缩，"靠左还是靠右"量不出来 —— 旧判据名字叫「右下」却从没判过右缘，
                 所以补5 那次把字推到右端、它照样全绿（这就是判据名说谎的代价）。 */
              const charGeom = (PM.wide || []).filter(x => x.charL !== null && x.charB !== null);
              const charLMin = charGeom.length ? Math.min.apply(null, charGeom.map(x => x.charL)) : null;
              const charBGap = charGeom.length
                ? Math.max.apply(null, charGeom.map(x => Math.round(Math.abs(x.charB - x.chipH) * 10) / 10)) : null;
              const hug = charGeom.filter(x => x.charGlyphL !== null && Math.abs(x.charGlyphL - x.charL) <= 3);
              ok(charGeom.length > 0 && hug.length === charGeom.length
                 && charGeom.every(x => x.charL >= 24 && Math.abs(x.charB - x.chipH) <= 2),
                p.label + "·" + vp + "：★★★ 歌词字**靠左**（字形左缘贴住字盒左缘 ≤3px："
                + (charGeom.length ? charGeom.map(x => Math.round((x.charGlyphL - x.charL) * 10) / 10).join(" / ") : "?")
                + "）且贴格底（左内缩最小 " + charLMin + "px ≥ 24；底缘与格底差 " + charBGap + "px ≤ 2）",
                charGeom.length ? ("字形 " + charGeom.map(x => x.charGlyphL + "…" + x.charGlyphR).join(" / ")
                  + " vs 字盒左 " + charGeom.map(x => x.charL).join(" / ")) : "");
              /* ★ v3.38.1：带记号格**整枚左让一档**（真机 acc.x 应落在 ~3–6px；没让则 ~7–10px） */
              const accEnt = (PM.wide || []).filter(x => x.accTxt !== null)[0] || null;
              ok(!!accEnt, p.label + "·" + vp + "：★ 前提：量到一颗带记号的谱字（否则下一条是空判据）", "");
              if (accEnt){
                ok(accEnt.accX >= 0 && accEnt.accX <= 7,
                  p.label + "·" + vp + "：★★ 带记号格整枚左让一档（记号左缘 " + accEnt.accX + "px ≤ 7；不让时在 8.7px 以上）",
                  "accX=" + accEnt.accX);
              }
              /* ★ v3.38.1：记谱体系切换真机生效——同一个半音，升号制写 #、降号制写 b */
              const sharpEnt = (PM.wide || []).filter(x => x.accTxt === "#")[0] || null;
              const flatEnt = (PM.flat || []).filter(x => x.accTxt === "b")[0] || null;
              ok(!!sharpEnt && !!flatEnt,
                p.label + "·" + vp + "：★★★ 记谱体系切换生效（升号制 " + (sharpEnt ? sharpEnt.txt : "(无)")
                + " / 降号制 " + (flatEnt ? flatEnt.txt : "(无)") + "，同一个半音）",
                "flat 探针：" + ((PM.flatErr) || "ok"));
              /* ★★★ v3.42.0 第九轮（用户口径：**音名像简谱一样落在歌词块左上角**）：名在**左**、字在**右**，
                 判据改为「字左缘 ≥ 名右缘」（名占左侧那个 26px 音符槽，与简谱同一槽位）。
                 旧口径（名靠右、判「名左缘 ≥ 字右缘」）随实现退役——它是 v3.38.1 未缩字号时代的补丁。 */
              const WN = (PM.wideNm || []).filter(x => x.nameR !== null && x.charL !== null);
              ok(WN.length > 0,
                p.label + "·" + vp + "：★ 前提：nm 档宽格量到音名（" + WN.length + " 颗）", "");
              if (WN.length){
                const gaps = WN.map(x => Math.round((x.charL - x.nameR) * 10) / 10);
                const badW = WN.filter(x => !(x.charL >= x.nameR));
                ok(badW.length === 0,
                  p.label + "·" + vp + "：★★★ nm 档**音名在左、歌词字在右且不相交**（字左缘 − 名右缘 最小 "
                  + Math.min.apply(null, gaps) + "px；各颗 " + gaps.join(" / ") + "）",
                  badW.length ? ("越界：" + badW.map(x => x.charTxt + "/" + x.txt + " 字左 " + x.charL
                    + " < 名右 " + x.nameR).join("；")) : "");
              }
              /* ★ v3.38.1：nm 档窄格**整枚不画**（用户拍板）——有 chip、但一个标记都不画 */
              const NM = PM.nmNarrow || {};
              ok(NM.narrowN > 0 && NM.narrowMarked === 0,
                p.label + "·" + vp + "：★★★ nm 档窄格整枚不画（本探针种的 " + NM.narrowN + " 颗、格宽 "
                + NM.seedW + "px，其中画了音名的 " + NM.narrowMarked + " 颗）",
                "画了音名的 " + NM.narrowMarked + " 颗（期望 0）");
            } else {
              ok(false, p.label + "·" + vp + "：音高标注探针未取到（故障：" + ((PM && PM.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.38.1 补6（用户拍板）：顶部块 12 档真机闸——判据逐档检。
             ★ v3.39.0：BPM 组并入音量组 ⇒ 顶部三块变两块（合并组 | 开关列）。
             ★ 控制芯批 6（PLAN-v9）：开关列退役 ⇒ 顶部**只剩一块**（合并组）；
             --min-w-sw 除名，装箱模拟与"并排门槛"同步降到单块口径（后者失去对象退役）。
             为什么每档都检而不抽样：列数是个**关于宽度的阶跃函数**，抽样正好跳过临界点，
             就会放出一个"这段宽度下多出一列/少了一列"的回归（pillSweep 当初就是为此加的）。 */
          if (vp === "桌面"){
            const TB = r.topBlocks || [];
            if (TB.length && !TB.some(x => x && x.err)){
              /* v3.38.1 补7：前提改成"**各块各自**的下限都在"（补6 只有一个 --min-w 通吃）。 */
              const bases0 = TB[0].bases || [];
              const gapDef = parseFloat(TB[0].colGapVar);
              const basesOk = bases0.length === 1 && bases0.every(b => b > 0);
              ok(basesOk && gapDef > 0,
                p.label + "·" + vp + "：★ 前提：--min-w-vol 与 --col-gap 都已定义"
                + "（合并组 " + bases0[0] + "、--col-gap=" + TB[0].colGapVar
                + "）——闸没有可判的数就是空转（控制芯批 6：开关列退役 ⇒ 只剩一块）",
                "12 档实测：" + TB.map(x => x.vw + ":" + x.display + "/gap" + x.gap).join(" "));
              if (basesOk && gapDef > 0){
                ok(gapDef >= 12 && gapDef <= 24,
                  p.label + "·" + vp + "：★★ 列距落在 12–24px（用户口径 12–16px；24 是「相邻块间距」闸的上限）",
                  "实测 --col-gap=" + gapDef + "px");
                const flexBad = TB.filter(x => x.display === "flex"
                  && Math.abs(x.gap - gapDef) > 0.51);
                ok(flexBad.length === 0, p.label + "·" + vp + "：★★ flex 档的实测列距 = --col-gap",
                  flexBad.length ? flexBad.map(x => x.vw + "px：实测 " + x.gap + " ≠ " + gapDef).join("；") : "");
                /* ① **排法阶梯**（v3.38.1 补7 换掉了补6 的"单 min_w 除一除"）：
                     补6 那条判据是**自我实现**的——不管 min_w 取多大，只要 CSS 跟着它走就永远绿，
                     它量不出"这个 min_w 定得合不合理"（正是它绿灯、用户截图不合格的原因）。
                     现在的判据：按三块的**各自下限**做 flex 装箱模拟（flex 换行就是按 hypothetical
                     main size = flex-basis 断行），逐档比对"每行几块"，并把"三块并排门槛"单独钉出来。 */
                const packRows = function(bases, gap2, avail){
                  var rows = [], cur = 0, n = 0;
                  bases.forEach(function(b){
                    var need = n ? gap2 + b : b;
                    if (cur + need <= avail + 0.5){ cur += need; n++; }
                    else { rows.push(n); cur = b; n = 1; }
                  });
                  if (n) rows.push(n);
                  return rows;
                };
                /* 只拿**可见**的块做装箱（收起方案里合并组默认不可见） */
                const visBases = x => x.bases.filter((b, i) =>
                  [x.vis.vol, x.vis.sw][i]);
                const wantRows = x => packRows(visBases(x), x.gap, x.avail);
                /* 实测行里的块数也要对齐到"可见子集"：.card-head-left 隐藏时它不出现在 items 里 */
                const gotRows = x => (x.rows || []).map(r2 => r2.n);
                /* ★ display:block 档（<560，壳未溶解）实际是"壳 + 开关"两块竖排 ⇒ 模拟不适用，
                   改用"列数=1"判据（那种档位本来就该单列）。只在 flex 档做装箱比对。 */
                const rowBad = TB.filter(x => x.display === "flex"
                  && JSON.stringify(wantRows(x)) !== JSON.stringify(gotRows(x)));
                /* ★ v3.39.0：窄屏默认收起 = 整块 display:none ⇒ <560 档可能**一块都不可见**
                   （cols=0 是设计不是回归）——只对"有可见块"的档位要求单列。 */
                const blockBad = TB.filter(x => x.display !== "flex"
                  && (x.vis.vol || x.vis.sw) && x.cols !== 1);
                ok(blockBad.length === 0,
                  p.label + "·" + vp + "：★★ 未切 flex 且有可见块的档位（<560px 纵向堆叠）必须单列"
                  + "（收起态 0 块不算列数）",
                  blockBad.length ? blockBad.map(x => x.vw + "px：" + x.display + " / 实测 " + x.cols + " 列").join("；") : "");
                ok(rowBad.length === 0,
                  p.label + "·" + vp + "：★★★ 12 档「每行几块」都 = 按合并组下限装箱的结果"
                  + "（合并组 " + (TB[0].bases[0] || "?") + "，列距 " + gapDef + "）",
                  rowBad.length ? rowBad.map(x => x.vw + "px：实测 [" + gotRows(x) + "] / 应为 ["
                    + wantRows(x) + "]（可用 " + x.avail + "）").join("；") : "");
                /* ①b（退役 · 控制芯批 6 PLAN-v9）：原「两块并排门槛」判据随开关列退役失去对象——
                   顶部可见块只剩合并组一块，"能并排却换行"在单块下不成立。 */
                /* ② 行内空白率 ≤15%：块撑不满自己那一行 ⇒ 那条留白就是纯浪费 */
                const blankBad = TB.filter(x => (x.rows || []).some(rw => rw.blankPct !== null && rw.blankPct > 15));
                ok(blankBad.length === 0,
                  p.label + "·" + vp + "：★★★ 12 档行内空白率 ≤15%（块要撑满自己那一行）",
                  blankBad.length ? blankBad.map(x => x.vw + "px：" + x.rows.filter(rw => rw.blankPct > 15)
                    .map(rw => rw.n + "块空 " + rw.blankPct + "%").join(",")).join("；") : "");
                /* ③ 相邻块间距 ≤24px（列距那一档的实测复核：flex gap 之外还可能叠 margin） */
                const gapBad = TB.filter(x => (x.rows || []).some(rw => (rw.gapPx || []).some(g2 => g2 > 24)));
                ok(gapBad.length === 0,
                  p.label + "·" + vp + "：★★ 12 档相邻块间距 ≤24px",
                  gapBad.length ? gapBad.map(x => x.vw + "px：最大 " + Math.max.apply(null,
                    x.rows.filter(rw => rw.gapPx.some(g2 => g2 > 24)).map(rw => Math.max.apply(null, rw.gapPx)))
                    + "px").join("；") : "");
                /* ④ 无横向溢出（容器与文档两个口径都查——容器溢出会被裁、文档溢出会出现横向滚动条） */
                const ovfBad = TB.filter(x => x.overflowX > 1 || x.docOverflow > 1);
                ok(ovfBad.length === 0, p.label + "·" + vp + "：★★★ 12 档都无横向溢出（容器与文档）",
                  ovfBad.length ? ovfBad.map(x => x.vw + "px：容器 +" + x.overflowX
                    + " / 文档 +" + x.docOverflow).join("；") : "");
                /* ⑥（退役）原"预备拍行心 = BPM 步进行行心"判据随 v3.39.0 BPM 并入音量组退役：
                   BPM 步进行住进合并组左列、不再与开关列同行，行心对齐失去几何前提。
                   新口径"开关首行与合并组第 1 行（节拍行）同线"由 layoutAudit 的 alignCheck
                   两主题各量一次把守（top 口径），此处不再逐档重复。 */
                /* ⑤ 展开任一参数槽后列数不变（静音槽展开→强制重排→再收列数） */
                const expBad = TB.filter(x => x.colsAfter !== x.cols
                  || Object.keys(x.colsExpanded || {}).some(k => x.colsExpanded[k] !== x.cols));
                ok(expBad.length === 0,
                  p.label + "·" + vp + "：★★★ 12 档「展开任一参数槽后列数不变」（静音槽展开再量）",
                  expBad.length ? expBad.map(x => x.vw + "px：基准 " + x.cols + " → 展开后 "
                    + JSON.stringify(x.colsExpanded) + " / 复位 " + x.colsAfter).join("；") : "");
              }
            } else {
              ok(false, p.label + "·" + vp + "：顶部三块探针未取到（故障：" + ((TB[0] && TB[0].err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.38.1 补10（用户实拍）：**贴格子带的层必须与格子同高**——
             窄屏格子 34px、底纹仍 44px 的那条漏网 bug（多出的 10px 落进歌词带）。
             判据两条：① 底纹高 == 格子高；② 底纹下缘不越出格子带下缘。 */
          if (vp === "桌面"){
            const BD = r.band || [];
            if (BD.length >= 2 && !BD.some(x => x && x.err)){
              ok(BD[0].cellH !== BD[1].cellH,
                p.label + "·" + vp + "：★ 前提：两档量到**不同的**格子高（桌面 " + BD[0].cellH
                + "px / 窄屏 " + BD[1].cellH + "px）——两档同高就测不出「层没跟着缩」",
                "实测：" + BD.map(x => x.vw + "px→格 " + x.cellH + "/底纹 " + x.beforeH).join(" "));
              const hBad = BD.filter(x => Math.abs(x.beforeH - x.cellH) > 0.5);
              ok(hBad.length === 0,
                p.label + "·" + vp + "：★★★ 「当前小节底纹」的高度 == 格子带高（共用 --cell-h）",
                hBad.length ? hBad.map(x => x.vw + "px：底纹 " + x.beforeH + " ≠ 格子 " + x.cellH
                  + "（--cell-h=" + x.cellHVar + "）").join("；") : "");
              const bleed = BD.filter(x => x.beforeBottom > x.cellBottom + 0.5);
              ok(bleed.length === 0,
                p.label + "·" + vp + "：★★★ 底纹**不越出格子带下缘**（越出就是当年那 10px：落进歌词/标注带）",
                bleed.length ? bleed.map(x => x.vw + "px：底纹下缘 " + x.beforeBottom
                  + " > 格子下缘 " + x.cellBottom).join("；") : "");
            } else {
              ok(false, p.label + "·" + vp + "：格子带底板探针未取到（故障："
                + ((BD[0] && BD[0].err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.36.19：段行块列表——把块行压窄到 280px，块**不该跟着缩**
             （桩测不到：没有 CSS；1440px 下也测不到：主列够宽、症状不出现。故探针主动造窄条件） */
          if (vp === "桌面"){
            const BR = r.blockRow;
            if (BR && !BR.err){
              /* ★ v3.36.20 补12：**前提**只用"有没有拿到一段真实宽度"作判据（≥150px），
                 不再钉具体像素——原写死 ≥300 是 macOS 上量的（实测 353），GitHub CI 的 Linux 字体
                 下 chip 自然宽只有 292 ⇒ 在那边**稳定判红**（同一提交两条通道都红）。
                 前置条件的职责是"测量有意义"，不是"字体必须和开发机一样"。 */
              ok(BR.blkW >= 150, p.label + "·" + vp + "：★ 前提：块拿到自然宽度（实测 " + BR.blkW + "px）", "");
              ok(BR.kept === true,
                p.label + "·" + vp + "：★★★ 块行压窄到自身 80% 后块**不跟着缩**（" + BR.narrowBlkW
                + "px，原 " + BR.blkW + "px）——flex:none 在位的真机闸；缺它时块被压到 1–2 字宽、"
                + "型名竖排（用户实报的竖屏症状）",
                "压窄后 " + BR.narrowBlkW + "px（期望 ≥ " + BR.blkW + "）／型名高 " + BR.narrowNameH + "px");
              /* ★ v3.36.20 补4 起：块行**不再自己滚**（overflow-x:visible），改为与卡片同一条横滑轴
                 ——故这里钉的是"内容**溢出**容器本身"（溢出交由卡片统一接住），而不是"容器自己能滚"。 */
              ok(BR.scrollable === true,
                p.label + "·" + vp + "：★★ 放不下时内容**溢出**块行（块行自己不滚，溢出交卡片统一横滑——补4）", "");
              ok(BR.narrowAddH <= BR.blockH,
                p.label + "·" + vp + "：★ 「+ 块」不被 stretch 拉成整行高（align-items:center）",
                "加块钮高 " + BR.narrowAddH + "px / 块高 " + BR.blockH + "px");
            } else {
              ok(false, p.label + "·" + vp + "：段行块列表探针未取到（故障：" + ((BR && BR.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.33.21：精修分组折叠——**只量高度，不读 hidden 属性**（见 refineGroupProbe 注释） */
          if (vp === "桌面"){
            const RG = r.refineGroups;
            if (RG && !RG.err){
              ok(RG.heads >= 5,
                p.label + "·" + vp + "：★★ ③ 精修 的组头齐备（实测 " + RG.heads + " 个）", "");
              ok(RG.hBefore > 0, p.label + "·" + vp + "：★ 前提：该组按钮原本可见（高 " + RG.hBefore + "px）", "");
              ok(RG.allHidden === true,
                p.label + "·" + vp + "：★★ 点组头后成员确实 hidden", "");
              ok(RG.hAfterCollapse === 0,
                p.label + "·" + vp + "：★★★ 点组头后该组**高度真的变成 0**（用户实报「无法折叠」的真机闸；"
                + "display:inline-flex 盖过 [hidden] 时这里会是 " + RG.hBefore + "px）",
                "收起后高度 = " + RG.hAfterCollapse + "px（期望 0）");
              ok(RG.hAfterExpand > 0,
                p.label + "·" + vp + "：★★ 再点恢复可见（高 " + RG.hAfterExpand + "px）", "");
            } else {
              ok(false, p.label + "·" + vp + "：精修分组探针未取到（故障：" + ((RG && RG.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.33.22：拖动行归属——行内右拖过半程必须**换位**（v3.33.18，此前零覆盖） */
          if (vp === "桌面"){
            const LD = r.lyricDrag;
            if (LD && !LD.err){
              ok(LD.rows >= 2, p.label + "·" + vp + "：★ 前提：自造段落确实跨 " + LD.rows + " 行（geo 才会构建）", "");
              ok(LD.swapped === true,
                p.label + "·" + vp + "：★★★ 行内右拖过「邻字半程」发生**换位**（恰 2 个字换时序）——"
                + "行号算偏时 overR 归零，只会「移动」（1 个字变），绝不换位",
                "改动字数 = " + LD.diffCount + "（换位需 >= 2）");
            } else {
              ok(false, p.label + "·" + vp + "：歌词拖动探针未取到（故障：" + ((LD && LD.err) || "缺失") + "）", "");
            }
          }
          /* ★★★ v3.33.28：跨行拖动——同行后面还有字块时，前面的块也必须能拖到下一行 */
          if (vp === "桌面"){
            const RM = r.lyricRowMove;
            if (RM && !RM.err){
              ok(RM.rows >= 2, p.label + "·" + vp + "：★ 前提：夹具确实跨 " + RM.rows + " 行", "");
              ok(RM.jiaTick === 0 || RM.jiaTick >= 192,
                p.label + "·" + vp + "：★★★ 同行有后续字块时，前面的字块**仍能拖到别的行**"
                + "（改前被 [min,max] 钳回原行 ⇒ 恒 0 tick）",
                "落地起点 = " + RM.jiaTick + " tick（≥192 才算换到第 2 行）· rows=" + RM.rows
                + " · y0=" + RM.cy0 + "→y1=" + RM.cy1 + " · labels=" + String(RM.labels).slice(0, 90));
            } else {
              ok(false, p.label + "·" + vp + "：跨行拖动探针未取到", JSON.stringify(RM).slice(0, 260));
            }
          }
          /* ★★★ v3.33.32：区收起后，区内不能还留着组行（用户实报「扫弦收起后分组没收起」） */
          if (vp === "桌面"){
            const PF = r.presetFold;
            if (PF && !PF.err){
              const bad = (PF.checks || []).filter(c => (c.leaked || []).length);
              ok((PF.checks || []).length > 0, p.label + "·" + vp + "：★ 前提：预设库至少有一个区", "");
              ok(bad.length === 0,
                p.label + "·" + vp + "：★★★ 每个区收起后，区内**不得**残留可见的组行/组头",
                bad.length ? JSON.stringify(bad).slice(0, 240) : ("各区内行数(收起后残留=0) " + JSON.stringify(PF.checks).slice(0, 300)));
              /* ★★★ v3.35.6：基础节奏区点标题必须**真的折叠**（display 变 none、高度归零、aria 同步），
                 再点要能展开回来。桩测不到这条——CSS 只有真机解析。 */
              ok(PF.drawerOpen === true && PF.basic && PF.basic.collapsed === "none" && PF.basic.h === 0
                 && PF.basic.hBefore > 0 && PF.basic.aria === "false" && PF.basic.restored !== "none",
                p.label + "·" + vp + "：★★★ 基础节奏区点标题真的折叠/展开（v3.35.6 用户实拍：display:flex 盖掉了 [hidden]）",
                JSON.stringify(PF.basic));
              /* ★★★ v3.35.8（用户实拍）：本区与下面两栏的间距必须与"网格内两区之间"**实测相等**。
                 桩测不到这条（CSS 只有真机解析），且它是"差几像素"的视觉不统一——只能量。 */
              ok(PF.drawerOpen === true && PF.basicGeom && PF.basicGeom.gapHere > 0
                 && PF.basicGeom.refGap > 0 && PF.basicGeom.gapHere === PF.basicGeom.refGap,
                p.label + "·" + vp + "：★★★ 基础节奏区与下面两栏的间距**统一**（v3.35.8：本区行→下区头 == 网格内区间距）",
                JSON.stringify(PF.basicGeom));
              /* ★★★ v3.35.10：本区的两个"体-头间距"与网格基准逐像素相同（防"下次又漂"） */
              ok(PF.basicGeom && PF.basicGeom.rowToBox > 0 && PF.basicGeom.rowToBox === PF.basicGeom.gridHeadToFirst,
                p.label + "·" + vp + "：★★★ 本区「头 → 细分」= 网格「区头 → 首条目」（v3.35.10）",
                JSON.stringify(PF.basicGeom));
              ok(PF.basicGeom && PF.basicGeom.boxToSec > 0 && PF.basicGeom.boxToSec === PF.basicGeom.gridLastToNext,
                p.label + "·" + vp + "：★★★ 本区「细分 → 下区头」= 网格「末条目 → 下区头」（v3.35.10）",
                JSON.stringify(PF.basicGeom));
              ok(PF.basicGeom && PF.basicGeom.slotInRow && !PF.basicGeom.slotInBox
                 && Math.abs(PF.basicGeom.slotToRowRight) <= 2,
                p.label + "·" + vp + "：★★ 拍数参数槽在区头**右边同一行**、不在区体里（v3.35.8 用户需求）",
                JSON.stringify(PF.basicGeom));
              /* ★★★ v3.35.11：真机双击语义（detail 计数只有浏览器给得出） */
              ok(PF.dbl && PF.dbl.playing === true && PF.dbl.mode === "arrange",
                p.label + "·" + vp + "：★★★ 真机双击歌曲行 = 整首连播（v3.35.11 用户需求）",
                JSON.stringify(PF.dbl) + " " + String(PF.dblErr || ""));
              ok(PF.dblFirst && PF.dblFirst.foldAfterFirst === PF.dbl.foldBefore,
                p.label + "·" + vp + "：★★★ 真手势双击的**第 1 击不改开合**（v3.35.12 用户反馈：折叠延迟一个双击窗口）",
                JSON.stringify(PF.dblFirst) + JSON.stringify(PF.dbl));
              ok(PF.dbl && PF.dbl.foldAfter === PF.dbl.foldBefore,
                p.label + "·" + vp + "：★★★ 快速双击**不改开合态**（第 2 击 detail=2 跳过单击语义）",
                JSON.stringify(PF.dbl));
              ok(PF.dbl && PF.dbl.stopped === true,
                p.label + "·" + vp + "：★★ 再双击一次 = 停（播放/暂停两态）",
                JSON.stringify(PF.dbl));
              ok(PF.basicGeom && PF.basicGeom.headText === "基础节奏",
                p.label + "·" + vp + "：★★ 区头文案 =「基础节奏」（「· 拍数与细分」已去掉）",
                JSON.stringify(PF.basicGeom));
            } else {
              ok(false, p.label + "·" + vp + "：折叠探针未取到", JSON.stringify(PF).slice(0, 200));
            }
          }
          /* （退役）v3.21 的「音量列与 BPM 列等高」断言随 v3.39.0 BPM 并入音量组失去对象——
             两列变一列（合并组），等高承诺由"合并组内部 flex 布局"天然成立，不再需要跨列断言。 */
          /* ★★★ v3.42.0（口径变更 · 用户拍板）：参数槽"长在胶囊里"（同预备的拍数）⇒ 开关一开胶囊行变宽、
             居中的三枚胶囊**整体重新居中**（实测静音 x 689.5 → 651.8）——旧的「开关/面板 x 逐像素不动」
             前提随之作废（那是"开关列固定、参数进浮层"时代的契约，且与"胶囊行居中 + 槽内联"互斥）。
             新契约：① 参数槽随开关生死（关着宽 0、打开有宽）；② 胶囊行保持**居中**（下面的 pillGeom）。
             面板"锚在自己胶囊下方"由 t231a 源码钉 + 面板几何把守。 */
          if (L.tgBody.slotWC !== null && L.tgBody.slotWM !== null){
            ok(L.tgBody.slotWC === 0 && L.tgBody.slotWM > 0,
              p.label + "·" + vp + "：★★ v3.42.0 参数槽随开关生死（关 " + L.tgBody.slotWC
              + "px → 开 " + L.tgBody.slotWM + "px；长在胶囊壳里，同预备的拍数）",
              "slotW=" + L.tgBody.slotWC + "/" + L.tgBody.slotWM);
          }
          /* ★ v3.41.0：拍数**就地长出**——关着时零尺寸（下条），打开时仍在开关右侧同行（上条造条件量）。 */
          if (L.tgBody.prepWrapHidden !== null && L.tgBody.prepWrapHidden !== undefined){
            ok(L.tgBody.prepWrapHidden === true,
              p.label + "·" + vp + "：★★ 预备关着 ⇒ 拍数输入**不占位**（就地长出：关着只显示「预备」两个字）",
              "prepWrapHidden=" + L.tgBody.prepWrapHidden);
          }
          if (L.tgBody.rowWC !== null && L.tgBody.rowWC !== "hidden"){
            ok(L.tgBody.rowWC === "[true,true]" || L.tgBody.rowWM === "[true,true]" || L.tgBody.rowWB === "[true,true]",
              p.label + "·" + vp + "：★★ 打开预备后 = 开关 + 拍数输入**同行右侧**（y 同行、x 在开关右）",
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
            if (String(vp).indexOf("窄屏") >= 0){
              /* ★ v3.33.12（用户拍板「读法 2 + 归右」）：**窄屏不再要求居中**，改判"右对齐底栏内容列"。
                 动机（用户实拍）：居中在窄屏两侧白留对称空白，胶囊只剩 63px、状态只剩 112px 都被截断；
                 归右后宽度让给文字列，播放键也更贴近右手拇指。桌面档契约不变（仍居中，见 else 分支）。 */
              ok(L.center.jumpRight !== null && Math.abs(L.center.jumpRight - L.center.contentRight) <= 2,
                p.label + "·" + vp + "：★★★ 窄屏播放键组**右对齐底栏内容列**（v3.33.12 用户拍板「归右」）",
                "argJump 右缘 " + L.center.jumpRight + " vs 内容列右缘 " + L.center.contentRight);
            } else if (L.center.jumpCenter !== null && L.center.contentCenter !== null){
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
        /* ★★★ v3.36.7（本轮审计 C-2）：窄屏单格宽度 ≥ 44px（移动端触控目标的通用下界）。
           桩量不出这条（cellEls 无布局宽度），故它是**真浏览器专属**的几何契约。
           本机实测：390px + 十六分型，1–4 行档恒为 44.75px（应用靠拆行保格宽）。 */
        if (lay.narrow.cell && lay.narrow.cell.minW !== null){
          ok(lay.narrow.cell.minW >= 44,
            p.label + "：★★★ 窄屏390 十六分型单格 ≥ 44px（触控目标下界）——"
            + "应用靠**拆行**保格宽，不是缩格子，故 1–4 行档实测同一宽度",
            "型「" + lay.narrow.cell.pattern + "」最窄格 " + lay.narrow.cell.minW
            + "px · 每行格数 " + JSON.stringify(lay.narrow.cell.perRow));
        } else {
          ok(false, p.label + "：窄屏格宽未验证——探针没取到 __beat（?debug=1 掉了？）",
            "cell=" + JSON.stringify(lay.narrow.cell));
        }
      } else {
        ok(false, p.label + "：窄屏布局未取到（需求①的折行本项未验证）", "");
      }
      /* v2.42.7：窄屏组容器卡等宽（宽度策略分裂的回归闸门——音量卡 352 钉死 /
         BPM 内容宽 / 开关·行数撑满曾在窄屏并存，右缘参差）。
         ★ PLAN-v9 批 2（控制芯批 6 收口）：开关列退役 ⇒ 窄屏只剩**一张**组容器卡
         （合并组，width:100%）——"等宽分裂"判据失去对象，改钉"恰一张卡、存在、且开关列确已不在"。
         ★ 长度变了必须改门槛：旧写法 `length===2` 在新结构下会**静默跳过**（假绿）。 */
      if (lay.narrow && Array.isArray(lay.narrow.grpWidths)){
        ok(lay.narrow.grpWidths.length === 1 && lay.narrow.grpWidths[0] > 0 && lay.narrow.retiredBlocksGone,
          "窄屏：★ 恰**一张**组容器卡（合并组，width:100%）——开关列已退役（PLAN-v9 批 2）",
          "宽度 " + JSON.stringify(lay.narrow.grpWidths) + " · retiredGone=" + lay.narrow.retiredBlocksGone);
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
