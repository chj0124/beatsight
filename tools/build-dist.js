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

   上站产物**只有 5 个条目**：4 个对外资源 + `_headers`（由 Workers 解析成响应头，
   本身不作为静态资源对外提供）。这个清单是"零依赖、单文件、file:// 可直开"三条硬约束的
   具体形态，改它等于改产品形态，所以写死在数组里而不是扫描目录（扫描会把 README 之类也带上站）。

   用法：node tools/build-dist.js        # 产出 dist/（先被 check-all 拦过的代码才配进这里）
   退出码 0 = 装配完成，1 = 缺文件/读不到。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const FILES = ["index.html", "sw.js", "manifest.webmanifest", "icon.svg", "_headers"];

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
console.log("──────────────────────────────────────────────────────────");
console.log("  5 个条目就位 · 合计 " + (total / 1024).toFixed(1) + " KB → " + path.relative(ROOT, DIST));
console.log("  · index.html 是唯一入口（file:// 直开与在线版同一份），其余 3 个只服务 PWA 离线");
process.exit(0);
