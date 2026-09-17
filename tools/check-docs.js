/* 文档一致性闸门（v2.0.5，审计 P0-6，零依赖）
   ---------------------------------------------------------------------------
   由来：v2.0.4 全维度代码审计的主要结论之一是——**闸门能把代码盘干净，但没有任何检查器
   会核对注释与文档里的数字**。实测三处系统性漂移（都不是笔误，是"没人核对"）：

     1) index.html 头部的模块索引 16 条行号**全部**偏移（最大 59 行）→ 转给 tools/gen-index.js
     2) 自验耗时的「约 N 秒」全是手写的，实测与真值差 20%～3 倍。这一处尤其说明问题：
        D1/D9 已经"修"过一次（把约 6 秒改成约 17 秒），这次实测是 20.8 秒——**又歪了**。
        手写数字注定要烂，因为耗时会随机器、Node 版本、跑不跑 FULL_SCAN 而变。
     3) README 文档表声明某份文档"已归档 / 已落地"，而文档正文里没有任何状态横幅
        （PLAN-v1.9 / PLAN-v2-arrangement / PLAN-v2-impl 三份都缺）——读者按表点进去，
        看到的是还在写"确认后开工"的方案，无从判断该不该信。

   三项都改成机器可判的规则，而不是再手写一遍数值：

     1) 模块索引行号 = index.html 实际 banner 行号（复用 gen-index.js 的解析，口径唯一）
     2) 不许手写耗时：这四个文件的正文里不得出现「约 N 秒」。
        为什么是"禁止"而不是"自动回写实测值"：自动回写要把耗时写进文档正文，于是每次跑自验
        都会改动文档（脏工作区 + diff 噪音 + 提交时才发现）；而耗时本来就不该是文档的职责
        ——命令自己会在末尾打印「全部通过 · 实跑 N/M 项 · 用时 Xs」。文档只描述"怎么用、为什么"。
     3) 归档状态一致：README 文档表里标了「已归档 / 已落地」的 Markdown 文档，
        正文开头必须有同一状态词（写清"已归档/已落地 + 以什么为准"）。

   刻意不做的事：不去校验 README 里"实跑 8/10 项"这类**步数**，也不去校验正文里引用的
   代码行号（如"未覆盖的 L2964"）——前者要工具改口径时同改多处文案，收益低；后者更适合
   由产出方（check-coverage）直接打印，让文档指过去而不是抄一遍。这类"抄一遍就等着烂"的
   数值，本轮只处理耗时这一处最典型、被审计点名过的。

   退出码 0 = 一致，1 = 有漂移。 */
"use strict";
const fs = require("fs");
const path = require("path");
const genIndex = require("./gen-index.js");

const ROOT = path.join(__dirname, "..");

/* 手写耗时的禁区（相对路径）。刻意排除：CHANGELOG（历史记录，改了反而失真）、
   docs/PLAN-*.md（归档方案，是当年的快照）、spec.md / checklist.md / tasks.md（审计产物） */
const TIMING_FILES = [
  "README.md",
  "docs/DEVELOPMENT.md",
  "tests/README.md",
  "tools/check-all.js",
];
const TIMING_RE = /约\s*\d+(?:\.\d+)?\s*秒/g;

const problems = [];
const report = [];

console.log("══════════════════════════════════════════════════════════");
console.log("  文档一致性（模块索引 · 手写耗时 · 归档状态）");
console.log("══════════════════════════════════════════════════════════");

/* ---- 1) 模块索引行号 ---- */
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const a = genIndex.analyze(html);
  const d = genIndex.diff(a);
  if (d.length){
    report.push(`✗ 模块索引：${d.length} 处与实际 banner 不符（index.html）`);
    d.forEach(x => problems.push("模块索引 —— " + x));
  } else {
    report.push(`✓ 模块索引：${a.banners.length} 个模块逐条对齐（index.html）`);
  }
}

/* ---- 2) 不许手写耗时 ---- */
{
  const hits = [];
  TIMING_FILES.forEach(rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    fs.readFileSync(full, "utf8").split("\n").forEach((ln, i) => {
      TIMING_RE.lastIndex = 0;
      const m = TIMING_RE.exec(ln);
      if (m) hits.push(`${rel}:${i + 1} 「${m[0]}」`);
    });
  });
  if (hits.length){
    report.push(`✗ 手写耗时：${hits.length} 处（耗时随机器/Node 版本/FULL_SCAN 而变，写死在文档里必烂）`);
    hits.forEach(h => problems.push("手写耗时 —— " + h));
  } else {
    report.push("✓ 手写耗时：4 个文件均无「约 N 秒」（耗时由 check-all 在末尾自己输出）");
  }
}

/* ---- 3) 归档状态一致 ---- */
{
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const tableRe = /\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|([^|]*)\|/g;
  const missing = [];
  let checked = 0;
  let m;
  while ((m = tableRe.exec(readme))){
    const label = m[1].trim();
    const desc = m[3];
    if (!/\.md$/.test(label)) continue;                 // 只看 Markdown（prd.html 这类不查，见文件头）
    const status = /已归档/.test(desc) ? "已归档" : (/已落地/.test(desc) ? "已落地" : null);
    if (!status) continue;
    checked++;
    const full = path.join(ROOT, label);
    if (!fs.existsSync(full)){
      missing.push(`${label} 在 README 里被标为「${status}」，但文件不存在`);
      continue;
    }
    const head = fs.readFileSync(full, "utf8").split("\n").slice(0, 20).join("\n");
    if (!head.includes(status)){
      missing.push(`${label}：README 标为「${status}」，但正文前 20 行没有「${status}」字样`
        + "——点进去的人无从判断这份文档还算不算数");
    }
  }
  if (missing.length){
    report.push(`✗ 归档状态：${missing.length} 处不一致（README 文档表 ↔ 文档正文）`);
    missing.forEach(x => problems.push("归档状态 —— " + x));
  } else {
    report.push(`✓ 归档状态：README 文档表中 ${checked} 份带状态的文档，正文均有同名横幅`);
  }
}

report.forEach(l => console.log("  · " + l));
console.log("──────────────────────────────────────────────────────────");
if (problems.length){
  console.log("  ✗ " + problems.length + " 处文档漂移：");
  problems.forEach(p => console.log("      · " + p));
  console.log("  修法：索引行号 → `node tools/gen-index.js --write`；"
    + "耗时 → 删掉数字交给命令输出；归档状态 → 给文档正文补一行状态横幅。");
  process.exit(1);
}
console.log("  ✓ 文档一致（索引行号 / 无手写耗时 / 归档状态）");
process.exit(0);
