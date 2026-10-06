/* 双渠道部署对账（v2.68.0，审计「剩余基建·部署对账」收尾）
   ---------------------------------------------------------------------------
   背景：BeatSight 有两条**对外渠道**，但共用同一份源码真相：
     · file:// 直开渠道 —— 仓库根的 index.html（开发版，不带产物戳记）。
     · Cloudflare Workers 在线渠道 —— `node tools/build-dist.js` 装配出的 dist/，
       其中 dist/index.html 与根 index.html 是**同一份代码**（build-dist 只注入
       `<meta name="beatsight-build">` 戳记，不改版本语义）。
   两条渠道「到底是不是同一版」此前只能靠人记——这正是本项目一直在消灭的
   「线上到底是哪一版不可知」问题（见 build-dist.js 头注释与产物戳记段）。

   本工具做**只读对账**（不构建、不改任何文件），是 T1「先做成只读报告不设阈值、
   避免假红」同款纪律的具体落地；它**不进** check-all 的 18 步门禁（避免引入新的
   阻塞阈值），而是作为「build 之后」的独立校验——v3.31.x（落地审计 E1）起接入
   `npm run ci`（= npm ci → check-all --strict-env → build → 本工具）：
   CI 与本地全量流程在构建产物落地后**自动**跑它，无需记得手动；也可单独跑：
       node tools/check-deploy-parity.js
   退出码 0 = 一致（或 dist 未构建、仅做本地版本对账的说明性结论）；1 = 发现真实不一致。

   对账项：
     ① 本地版本对齐（file:// 渠道拿到的版本 == 将要部署的版本）：
        index.html VERSION == package.json == package-lock.json（含 packages[""]）
        == README 的「当前 vX.Y.Z」== CHANGELOG 首条 ## vX.Y.Z。
        （这一项与 check-version 同事实、不同 framing：这里强调「用户看到的版本
         就是仓库声明的版本」；check-version 守的是 VERSION 单一真相源不漂移。）
     ② 已构建产物一致性（仅当 dist/ 存在时才查——部署/CI 上下文）：
        · dist/index.html 的 VERSION == 根 index.html 的 VERSION
          （渠道一致性：线上服务的版本 == 源码声明的版本）。
        · dist/ 产物集 == 恰好 9 个条目（5 拷贝 + 4 生成，与 build-dist.js 的
          FILES/GENERATED 同款），无多余、无缺失——混入上一轮残留会让
          「线上到底是哪一版」重新变得不可知。
        · dist/_headers 在场且含 6 条安全响应头（X-Content-Type-Options /
          Referrer-Policy / Content-Security-Policy / X-Frame-Options /
          Permissions-Policy / Strict-Transport-Security）——安全头随部署一起上线，
          只作用于 Cloudflare 渠道（file:// 忽略 _headers，属既定取舍，见 _headers 文件头）。
     ③ 优雅降级：dist/ 不存在时跳过 ②，仅跑 ①，并打印明确提示
        「dist/ 未构建，仅做本地版本对账（file:// 渠道）」，退出 0（说明性结论）。

   用法：node tools/check-deploy-parity.js
   无参数（路径固定为仓库根 + dist/）。
   环境变量 BEATSIGHT_PARITY_URL 可覆盖③的线上核对地址（默认 Cloudflare Workers；
   测试用本地 HTTP 服务注入时用它，其余行为不变）。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
/* 与 build-dist.js 的 FILES / GENERATED 同源（改 build-dist 的清单要同步改这里，
   否则对账会误报「产物集漂移」）。顺序无关——对账只比「集合」是否相等 */
const EXPECT_DIST = [
  "index.html", "sw.js", "manifest.webmanifest", "icon.svg", "_headers",
  "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png",
];
const SEC_HEADERS = [
  "X-Content-Type-Options", "Referrer-Policy", "Content-Security-Policy",
  "X-Frame-Options", "Permissions-Policy", "Strict-Transport-Security",
];

const problems = [];
const notes = [];
const okLines = [];

/* ---- 读取辅助（任何读不到都记问题，不抛）---- */
const read = (p) => {
  try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; }
};
const verOf = (src) => {
  if (!src) return null;
  const m = /const\s+VERSION\s*=\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
};
const semverOk = (s) => /^(\d+)\.(\d+)\.(\d+)$/.test(s || "");

console.log("══════════════════════════════════════════════════════════");
console.log("  双渠道部署对账（file:// ↔ Cloudflare dist/）");
console.log("══════════════════════════════════════════════════════════");

/* ---- ① 本地版本对齐 ---- */
const html = read(path.join(ROOT, "index.html"));
const pkg = read(path.join(ROOT, "package.json"));
const lock = read(path.join(ROOT, "package-lock.json"));
const readme = read(path.join(ROOT, "README.md"));
const changelog = read(path.join(ROOT, "CHANGELOG.md"));

const srcVer = verOf(html);
if (!srcVer) problems.push("读不到 index.html 的 VERSION");
else if (!semverOk(srcVer)) problems.push("index.html 的 VERSION 不是合法 semver：" + srcVer);

let pkgVer = null, lockVer = null, lockPkgVer = null, readmeVer = null, clVer = null;
try { pkgVer = JSON.parse(pkg || "{}").version; } catch (e) { problems.push("package.json 解析失败"); }
try {
  const L = JSON.parse(lock || "{}");
  lockVer = L.version; lockPkgVer = L.packages && L.packages[""] ? L.packages[""].version : null;
} catch (e) { problems.push("package-lock.json 解析失败"); }

const rm = /当前\s+`v([^`]+)`/.exec(readme || "");
readmeVer = rm ? rm[1] : null;
const cl = /^##\s+v([\d.]+)/m.exec(changelog || "");
clVer = cl ? cl[1] : null;

const align = [
  ["index.html", srcVer],
  ["package.json", pkgVer],
  ["package-lock.json", lockVer],
  ["package-lock.json(packages[\"\"])", lockPkgVer],
  ["README.md（当前 vX.Y.Z）", readmeVer],
  ["CHANGELOG.md（首条）", clVer],
];
for (const [label, v] of align){
  if (v == null) { problems.push(label + "：读不到版本"); continue; }
  if (!srcVer){ continue; } // 上面已报 VERSION 缺失，这里不重复刷屏
  if (v !== srcVer) problems.push(label + " 版本 " + v + " ≠ index.html 的 " + srcVer);
  else okLines.push("  ✓ " + label + " = " + v);
}

/* ---- ② 已构建产物一致性（仅当 dist/ 存在）---- */
if (!fs.existsSync(DIST)){
  notes.push("dist/ 未构建，仅做本地版本对账（file:// 渠道）。CI 应在 `npm run build` 之后跑本工具以核对线上版本。");
} else {
  console.log("──────────────────────────────────────────────────────────");
  console.log("  dist/ 已构建 · 核对线上产物");
  const dHtml = read(path.join(DIST, "index.html"));
  const dVer = verOf(dHtml);
  if (dVer == null) problems.push("dist/index.html 读不到 VERSION（构建可能不完整）");
  else if (srcVer && dVer !== srcVer)
    problems.push("dist/index.html 版本 " + dVer + " ≠ 源码 index.html 的 " + srcVer + "（线上/源码版本不一致）");
  else okLines.push("  ✓ dist/index.html = " + dVer + "（与源码一致）");

  /* 产物集 == 恰好 EXPECT_DIST（集合相等：无多余、无缺失） */
  let entries = [];
  try { entries = fs.readdirSync(DIST); } catch (e) { problems.push("读不到 dist/ 目录"); }
  const extra = entries.filter(n => !EXPECT_DIST.includes(n));
  const missing = EXPECT_DIST.filter(n => !entries.includes(n));
  if (extra.length) problems.push("dist/ 有多余条目（上一轮残留？）：" + extra.join(", "));
  if (missing.length) problems.push("dist/ 缺失条目：" + missing.join(", "));
  if (!extra.length && !missing.length) okLines.push("  ✓ 产物集 = 恰好 " + EXPECT_DIST.length + " 个条目（无残留/无缺失）");

  /* _headers 在场且含 6 条安全头 */
  const dh = read(path.join(DIST, "_headers"));
  if (dh == null) problems.push("dist/_headers 缺失（安全响应头未随部署上线）");
  else {
    const absent = SEC_HEADERS.filter(h => !dh.includes(h + ":"));
    if (absent.length) problems.push("dist/_headers 缺少安全头：" + absent.join(", "));
    else okLines.push("  ✓ dist/_headers 含 6 条安全响应头（仅作用于 Cloudflare 渠道）");
  }
}

/* ---- ③ 线上实际版本（v3.31.6，审计⑤）：信息性核对，**不判红**——CI 里跑在本批 push 的
   部署完成之前，线上落后属预期（Cloudflare 自动构建要几十秒到几分钟）；它把「线上到底
   是哪一版」从人肉看徽章变成每次对账打印一行。无网络（本地离线）标 ⊘ 跳过。
   CJS 无顶层 await：核对与汇总整体收进 async IIFE。 */
(async () => {
  const ONLINE_URL = process.env.BEATSIGHT_PARITY_URL || "https://beatsight.chenhuajian1995.workers.dev/";
  const online = await new Promise(resolve => {
    /* 协议随 URL 走：线上默认 https；BEATSIGHT_PARITY_URL 注入本地 HTTP 服务时用 http。 */
    let req;
    try {
      const mod = /^https:/i.test(ONLINE_URL) ? require("https") : require("http");
      req = mod.get(ONLINE_URL, { timeout: 8000 }, res => {
        if (res.statusCode !== 200){ res.resume(); resolve({ err: "HTTP " + res.statusCode }); return; }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", c => { if (body.length < 3 * 1024 * 1024) body += c; });
        res.on("end", () => resolve({ body }));
      });
    req.on("timeout", () => { req.destroy(); resolve({ err: "timeout" }); });
    req.on("error", e => resolve({ err: e && e.code ? e.code : String(e) }));
    } catch (e) { resolve({ err: "REQ_ERR " + (e && e.code ? e.code : String(e)) }); }
  });
  if (online.err){
    notes.push("线上版本核对 ⊘ 跳过（无网络/超时：" + online.err + "）——本地对账结论不受影响");
  } else {
    const om = /const\s+VERSION\s*=\s*"([^"]+)"/.exec(online.body || "");
    if (!om){
      notes.push("线上页面读不到 VERSION（结构与预期不符，可能服务异常或页面改版）");
    } else {
      const same = srcVer != null && om[1] === srcVer;
      notes.push("线上（Cloudflare）= v" + om[1] + "，" + (same ? "与本地一致" :
        "与本地 v" + (srcVer || "?") + " 不一致——部署可能尚未完成（信息性，不判红）"));
    }
  }

  /* ---- ④ GitHub 远端漂移（v3.34.6，审计 ⑤）：本仓最后一块「没有机器盯」的盲区。
     由来：`check-stale-copies.js` 只扫本地副本、本工具 ①–③ 只看本地与线上部署，
     **没有任何一步会告诉你 origin/main 已经前进**——而另一台电脑也在推 main。
     与 ③ 同口径：**信息性、不判红**（本地落后于远端是正常协作状态，不是错误），
     只把「本地 HEAD 与 origin/main 是否同一提交」变成每次对账打印一行。
     实现走 `git ls-remote`：不需要 API token，也不引外部依赖；沙箱里 https 被拦时
     自动退化为 ⊘ 跳过（与本文件既有降级口径一致）。 */
  const drift = (() => {
    const cp = require("child_process");
    /* ★★ 必须带 timeout（本步初版漏了，被 t183 当场抓出）：`git ls-remote` 走网络，
       在没有网络或隧道被拦的环境里会**挂着不走**——它是同步调用，一挂就把整个工具卡在
       汇总行之前，表现为"对账没有任何输出"。实测在预提交钩子里触发了 t183a/b 的两条失败
       （"走到汇总行" 与 "ℹ 行报出本地版本"），而在另一次运行里网络恰好快速失败、又能通过
       ⇒ **典型的不确定挂起**，正是最该设上限的那种调用。
       超时按「连不上」处理（⊘ 跳过），与无网络同一条降级路径。 */
    const GIT_TIMEOUT_MS = 5000;
    const run = (args) => {
      try{
        return { out: String(cp.execFileSync("git", args,
          { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS }) || "").trim() };
      }
      catch(e){ return { err: true }; }
    };
    const local = run(["rev-parse", "HEAD"]);
    if (local.err || !local.out) return { skip: "读不到本地 HEAD（不是 git 仓库？）" };
    const remote = run(["ls-remote", "origin", "main"]);
    if (remote.err) return { skip: "连不上 origin（无网络/隧道拦截）" };
    const m = /^([0-9a-f]{40})\s/.exec(remote.out || "");
    if (!m) return { skip: "origin/main 未返回可解析的提交" };
    return { local: local.out, remote: m[1] };
  })();
  if (drift.skip){
    notes.push("GitHub 远端漂移核对 ⊘ 跳过（" + drift.skip + "）——本地对账结论不受影响");
  } else if (drift.local === drift.remote){
    okLines.push("  ✓ GitHub origin/main = 本地 HEAD（" + drift.local.slice(0, 7) + "）—— 无远端漂移");
  } else {
    notes.push("★ GitHub origin/main = " + drift.remote.slice(0, 7) + "，本地 HEAD = " + drift.local.slice(0, 7)
      + " —— **远端已前进**（另一台电脑推过？）。push 前必须先 `git fetch` + 整合，"
      + "且**版本号要在 fetch 之后再定**（见 AGENTS.md §5.1）。信息性，不判红");
  }

  /* ---- 汇总 ---- */
  console.log("──────────────────────────────────────────────────────────");
  for (const n of notes) console.log("  ℹ " + n);
  if (okLines.length) console.log(okLines.join("\n"));
  if (problems.length){
    console.log("  ✗ 发现 " + problems.length + " 处不一致：");
    problems.forEach(p => console.log("    - " + p));
    console.log("══════════════════════════════════════════════════════════");
    console.log("  对账失败 · 退出 1");
    process.exit(1);
  }
  console.log("  对账通过 · 双渠道版本一致" + (notes.length ? "（见上方 ℹ 说明）" : ""));
  console.log("══════════════════════════════════════════════════════════");
  process.exit(0);
})();
