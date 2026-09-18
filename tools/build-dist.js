/* 构建产物装配 · 跨平台（v2.0.6，审计 P1-8，零依赖）
   ---------------------------------------------------------------------------
   背景：`wrangler.jsonc` 的 build.command 原本是一串 shell——
     `node tools/check-all.js --strict-env && rm -rf dist && mkdir -p dist && cp index.html … dist/`
   而 `rm -rf` / `mkdir -p` / `cp` **在 Windows 的 cmd 下不存在**，于是"本地 `wrangler deploy`
   能完整复现线上构建"这句承诺在本机（Windows）根本不成立——这正是审计 P1-8 点出的落差。
   现在把装配那半段收进这个脚本（`fs.rmSync` / `fs.mkdirSync` / `fs.copyFileSync` 全平台可用），
   命令里只留 `node tools/check-all.js --strict-env && node tools/build-dist.js`。

   顺带做两件 CI 该做的事（不做的话"构建成功"可能只是产出了一个空目录）：
     · 缺文件即失败（逐个断言存在且非空）；
     · 打印每个产物的字节数——体积突变是"误提交了别的东西"最直观的信号。

   上站产物 = 5 个**拷贝**条目（4 个对外资源 + `_headers`，由 Workers 解析成响应头，
   本身不作为静态资源对外提供）+ 4 个**生成**条目（PNG 图标回退，由 tools/gen-icons.js
   现场生成——二进制不入库，任何"只能推文本"的发布路径都带不动 PNG，生成器才是真相源）。
   拷贝清单是"零依赖、单文件、file:// 可直开"三条硬约束的具体形态，改它等于改产品形态，
   所以写死在数组里而不是扫描目录（扫描会把 README 之类也带上站）。

   用法：node tools/build-dist.js        # 产出 dist/（先被 check-all 拦过的代码才配进这里）
   退出码 0 = 装配完成，1 = 缺文件/读不到。 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const FILES = ["index.html", "sw.js", "manifest.webmanifest", "icon.svg", "_headers"];
const GENERATED = ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"];

console.log("══════════════════════════════════════════════════════════");
console.log("  构建产物装配 → dist/");
console.log("══════════════════════════════════════════════════════════");

/* 先清空：`force` 让"目录不存在"不报错，`recursive` 处理残留的旧子目录。
   为什么不留旧文件：dist 是"本次构建的完整快照"，混入上一轮的残留会让
   「线上到底是哪一版」重新变得不可知——那正是本项目一直在消灭的东西 */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const problems = [];
let total = 0;
for (const name of FILES){
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)){
    problems.push("缺少源文件 " + name);
    continue;
  }
  const bytes = fs.statSync(src).size;
  if (bytes === 0){
    problems.push("源文件是空的：" + name);
    continue;
  }
  fs.copyFileSync(src, path.join(DIST, name));
  total += bytes;
  console.log("  ✓ " + name.padEnd(22) + (bytes / 1024).toFixed(1).padStart(8) + " KB");
}

if (problems.length){
  console.log("──────────────────────────────────────────────────────────");
  problems.forEach(p => console.log("  ✗ " + p));
  process.exit(1);
}

/* PNG 图标回退：构建期由 gen-icons.js 现场生成（二进制不入库，理由见该文件头）。
   生成后直接落 dist/，并逐个断言非空——生成器坏了不该产出"看起来成功"的空壳 */
console.log("  · 生成 PNG 图标（tools/gen-icons.js → dist/）");
execFileSync(process.execPath, [path.join(__dirname, "gen-icons.js"), DIST], { stdio: "inherit" });
for (const name of GENERATED){
  const p = path.join(DIST, name);
  if (!fs.existsSync(p) || fs.statSync(p).size === 0){
    console.log("  ✗ 生成的图标缺失或为空：" + name);
    process.exit(1);
  }
  total += fs.statSync(p).size;
}

/* 产物戳记（v2.4.4，堵「线上构建跑没跑自验不可知」的缺口）：
   能走到这里的代码必然先过了 check-all（build.command 的 && 短路），把这件事**写进产物本身**：
   给 dist/index.html 注入 <meta name="beatsight-build" content="v版本|构建时间|源文件sha1">。
   index.html 启动时自检（见「产物戳记自检」段）——线上读不到戳记 = 那次部署绕过了自验链。
   注意只改 **dist 里的副本**：仓库根的 index.html 同时是 file:// 直开的开发版，不该带戳记。 */
{
  const htmlPath = path.join(DIST, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const vm = html.match(/const VERSION = "([^"]+)"/);
  if (!vm){ console.log("  ✗ 读不到 dist/index.html 的 VERSION——戳记无法生成"); process.exit(1); }
  const sha1 = crypto.createHash("sha1").update(html, "utf8").digest("hex").slice(0, 12);
  const stamp = `<meta name="beatsight-build" content="v${vm[1]}|${new Date().toISOString()}|${sha1}">`;
  if (!html.includes("</head>")){ console.log("  ✗ dist/index.html 没有 </head>——戳记无处注入"); process.exit(1); }
  fs.writeFileSync(htmlPath, html.replace("</head>", "  " + stamp + "\n</head>"), "utf8");
  console.log("  ✓ 产物戳记 " + stamp);
}

console.log("──────────────────────────────────────────────────────────");
console.log("  " + (FILES.length + GENERATED.length) + " 个条目就位（" + FILES.length + " 拷贝 + " + GENERATED.length + " 生成）· 合计 " + (total / 1024).toFixed(1) + " KB → " + path.relative(ROOT, DIST));
console.log("  · index.html 是唯一入口（file:// 直开与在线版同一份），其余只服务 PWA 离线");
process.exit(0);
