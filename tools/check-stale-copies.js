/* 过期副本检测（v3.33.14，审计 §2.3 · 零依赖）
   ---------------------------------------------------------------------------
   要解决的问题（本仓真实发生过，而且就在这次审计的第一分钟）：
     工作区里躺着一份 `beatsight/` 副本，停在 **v3.0.1**，而远端 main 已经是 **v3.33.13**
     ——落后 30+ 个版本。AGENTS.md §5 把它写成了一句纪律（"取证前先核对远端 HEAD，
     别拿过期副本当现状"），但**没有任何机器在盯**：AI / 人一旦 `cd` 进那份副本，
     读到的全是过期代码，据此得出的结论与改动全部打在错的地方。

   本工具把这条纪律变成可执行的：扫描仓库内外的同名副本，读它们的 `const VERSION`，
   与本仓当前 VERSION 比对，不一致即报 ⚠（含路径 + 版本 + 落后多少个版本条目）。

   ★ 口径（刻意保守，避免假红）：
     · 只认**带 BeatSight 版本串**的 index.html（正则 `const VERSION = "x.y.z"`），
       别的 index.html 一律不管——扫全盘比名字会把任何网页都算进来；
     · **永远 exit 0**：过期副本可能是有意为之（对照旧版本、做历史复现），
       本工具只负责"让你看见"，不替你判断该不该删；
     · 扫不到（权限 / 路径不存在）也 exit 0，只打印"跳过"——**工具故障与"没有"要分得清**，
       但这条是便利项，不该因为没有工作区就堵住部署。

   用法：node tools/check-stale-copies.js [--json]
   退出码 0 = 完成（可能含 ⚠）；4 = 本仓 index.html 读不到（真·工具故障，不猜）。
   ============================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".workbuddy", "Library", "Downloads"]);
const MAX_DEPTH = 4;                 // 够覆盖"工作区/日期戳目录/仓库"这种常见三层
const VERSION_RE = /const\s+VERSION\s*=\s*"(\d+\.\d+\.\d+)"/;

function verOf(file){
  try{
    const m = VERSION_RE.exec(fs.readFileSync(file, "utf8"));
    return m ? m[1] : null;
  }catch(e){ return null; }
}

/* 限定深度的目录遍历。跳过清单里的目录；读不到就静默跳过（权限 / 挂载点）。 */
function walk(dir, depth, out){
  let entries;
  try{ entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch(e){ return; }
  for (const en of entries){
    if (SKIP_DIRS.has(en.name)) continue;
    if (en.name.startsWith(".") && en.name !== ".github") continue;
    const p = path.join(dir, en.name);
    if (en.isDirectory()){
      if (depth < MAX_DEPTH) walk(p, depth + 1, out);
      continue;
    }
    if (en.name === "index.html") out.push(p);
  }
}

const srcVer = verOf(path.join(ROOT, "index.html"));
if (!srcVer){
  console.error("✗ 读不到本仓 index.html 的 VERSION —— 拒绝带着空基线继续扫描（宁可报错，不猜）");
  process.exit(4);
}

/* 扫描范围：① 仓库自身（防有人把副本塞进子目录）；② 工作区（仓库的**上两级**，
   覆盖 `/…/WorkBuddy/2026-09-26-05-18-10/` 这种"日期戳工作区里躺着多份"的形态）。 */
const roots = [ROOT];
let up = ROOT;
for (let i = 0; i < 2; i++){
  up = path.dirname(up);
  if (up && up !== path.dirname(up)) roots.push(up);
}

const found = [];
const seen = new Set();
for (const r of roots){
  const files = [];
  walk(r, 0, files);
  for (const f of files){
    const real = path.resolve(f);
    if (seen.has(real)) continue;
    seen.add(real);
    if (real === path.resolve(path.join(ROOT, "index.html"))) continue;   // 本仓自己不算副本
    const v = verOf(real);
    if (!v) continue;                        // 不是 BeatSight 的 index.html
    found.push({ file: f, version: v });
  }
}

const stale = found.filter(f => f.version !== srcVer);

console.log("══════════════════════════════════════════════");
console.log("  过期副本检测（本机其它位置的 BeatSight 副本）");
console.log("══════════════════════════════════════════════");
console.log("  · 本仓 index.html：v" + srcVer + " · 扫描到 " + found.length + " 份同名副本");

if (!stale.length){
  console.log("  ✓ 未发现版本不一致的副本（取证可以用当前这份）");
  process.exit(0);
}

stale.forEach(f => {
  const rel = path.relative(process.cwd(), path.resolve(f.file)) || f.file;
  const cmp = (a, b) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++){ if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1; }
    return 0;
  };
  const dirWord = cmp(f.version, srcVer) < 0 ? "**落后**" : "**领先**";
  console.log("  ⚠ 发现" + dirWord + "的副本：v" + f.version + "（本仓 v" + srcVer + "）");
  console.log("      " + rel);
});
console.log("  ⇒ 取证 / 改动前请先核对远端 HEAD（gh api repos/<o>/<r>/commits）；"
  + "过期副本读到的是旧代码，据此得出的结论全部不成立。");
console.log("  ⇒ 若这份副本是有意保留的（历史对照等），可以忽略本条——本工具只提示、不判红。");
process.exit(0);
