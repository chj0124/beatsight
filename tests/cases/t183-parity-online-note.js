/* BeatSight 自动化测试 · v3.31.7 部署对账工具回归（CI 实崩：线上核对分支 ReferenceError）
   ---------------------------------------------------------------------------
   背景：tools/check-deploy-parity.js 的③「线上实际版本核对」分支（异步 IIFE）引用过
   未定义的 `VERSION`——本文件唯一的版本变量是 `srcVer`。本地自验多走无网络分支
   （⊘ 跳过），该行从未执行；CI 有网执行即 ReferenceError、退出非 0，`npm run ci`
   整体红（2026-10-04 Cloudflare 构建日志实拍）。
   本组**真实执行该分支**：起独立子进程 HTTP 服务当「线上页面」（经 BEATSIGHT_PARITY_URL
   注入钩子），子进程跑工具，断言 ℹ 行正确 + 走到汇总行（不崩）。
   断言口径说明：
     · 不断言退出码——本地 dist/（gitignored）陈旧时工具会因产物集漂移退出 1，
       退出码是环境事实而非本缺陷；「崩溃」的判据是**没走到汇总行**（对账通过/失败）。
     · 反向验证锚点：把 `om[1] === srcVer` 改回 `=== VERSION` → 子进程 ReferenceError
       → 汇总行消失 → T183a/b 按名变红。
   ================================================================================ */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { ok, eq, section } = require("../lib/harness");

const ROOT = path.join(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "check-deploy-parity.js");
const srcHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const VER = /const\s+VERSION\s*=\s*"([^"]+)"/.exec(srcHtml)[1];

/* 独立子进程 HTTP 服务：父进程随后会被 execFileSync 阻塞（事件循环冻结），
   服务必须住在别的进程里才有自己的事件循环可应答。
   端口经临时文件同步交回（父进程忙等，5s 上限）。 */
const startFakeOnline = (body) => {
  const portFile = path.join(os.tmpdir(), "beatsight-t183-port-" + process.pid + ".txt");
  try { fs.unlinkSync(portFile); } catch (e) { /* 首次运行没有旧文件属正常 */ }
  const child = spawn(process.execPath, ["-e",
    'const http=require("http"),fs=require("fs");' +
    'const srv=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});r.end(' +
    JSON.stringify(body) + ');});' +
    'srv.listen(0,"127.0.0.1",()=>{fs.writeFileSync(' + JSON.stringify(portFile) +
    ',String(srv.address().port));});' +
    'setTimeout(()=>process.exit(0),30000);' // 兜底自杀，防僵尸
  ], { stdio: "ignore" });
  const deadline = Date.now() + 5000;
  let port = "";
  while (Date.now() < deadline){
    try { port = fs.readFileSync(portFile, "utf8").trim(); if (port) break; } catch (e) { /* 还没写 */ }
  }
  if (!port){ try { child.kill(); } catch (e) {} throw new Error("fake online server 未就绪（端口文件超时）"); }
  return { url: "http://127.0.0.1:" + port + "/", child, portFile };
};
const stopFakeOnline = (h) => {
  try { h.child.kill(); } catch (e) { /* 已退出 */ }
  try { fs.unlinkSync(h.portFile); } catch (e) { /* 已清理 */ }
};

/* 跑工具子进程。不因非零退出丢 stdout：崩溃/失败都收集输出交给断言判。 */
const runTool = (url) => {
  try {
    return { out: execFileSync(process.execPath, [TOOL], {
      cwd: ROOT, env: Object.assign({}, process.env, { BEATSIGHT_PARITY_URL: url }),
      encoding: "utf8", timeout: 20000,
    }), code: 0 };
  } catch (e) {
    return { out: (e && e.stdout) ? String(e.stdout) : "", code: (e && e.status) ? e.status : -1 };
  }
};

/* ================= T183a：线上与本地同版 → ℹ 行报一致 + 走到汇总行 ================= */
section("T183a 部署对账 · 线上核对分支真实执行（同版）：ℹ 行报一致且不崩");
{
  const h = startFakeOnline('const VERSION = "' + VER + '";');
  let r;
  try { r = runTool(h.url); } finally { stopFakeOnline(h); }
  ok(r.out.includes("线上（Cloudflare）= v" + VER + "，与本地一致"),
     "★ ℹ 行报告同版一致（对比值来自 srcVer，不再是未定义变量）");
  ok(r.out.includes("对账通过") || r.out.includes("对账失败"),
     "★ 走到汇总行（修复前此分支 ReferenceError → 进程死在汇总前 → CI 红）");
  ok(!/ReferenceError/.test(r.out), "★ 输出无 ReferenceError");
}

/* ================= T183b：线上落后 → ℹ 行报不一致（信息性）仍走到汇总行 ================= */
section("T183b 部署对账 · 线上核对分支真实执行（异版）：信息性不判红、不崩");
{
  const h = startFakeOnline('const VERSION = "9.9.9";');
  let r;
  try { r = runTool(h.url); } finally { stopFakeOnline(h); }
  ok(r.out.includes("线上（Cloudflare）= v9.9.9，与本地 v" + VER + " 不一致——部署可能尚未完成（信息性，不判红）"),
     "★ ℹ 行报出本地版本与不一致原因");
  ok(r.out.includes("对账通过") || r.out.includes("对账失败"),
     "★ 异版同样走到汇总行（崩溃才是本缺陷，信息性不一致不是）");
  ok(!/ReferenceError/.test(r.out), "★ 输出无 ReferenceError");
}

/* ================= T183c：工具源码级防回潮（行为断言之外的第二道钉） =================
   srcVer 是模块作用域变量；async IIFE 里的核对行若再写裸 VERSION，就回到 CI 实崩形状。
   本组与 T183a/b 的行为级断言互为兜底。 */
section("T183c 部署对账 · 源码级：核对分支只认 srcVer，传输层协议随 URL");
{
  const src = fs.readFileSync(TOOL, "utf8");
  ok(src.includes("om[1] === srcVer"), "★ 分支比较锚在 srcVer（回退即回到 CI 实崩形状）");
  ok(!/om\[1\]\s*===\s*VERSION/.test(src), "★ 不再出现 om[1] === VERSION");
  ok(!/"与本地 v" \+ VERSION/.test(src), "★ 不一致文案不再拼接裸 VERSION");
  ok(src.includes("process.env.BEATSIGHT_PARITY_URL"), "★ 注入钩子在（本组测试的前提）");
  ok(src.includes('/^https:/i.test(ONLINE_URL) ? require("https") : require("http")'),
     "★ 传输层协议随 URL 走（http 注入不再 ERR_INVALID_PROTOCOL）");
}
