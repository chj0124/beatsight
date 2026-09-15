/* 一条命令跑完全部检查：node tools/check-all.js
   ---------------------------------------------------------------------------
   项目不再依赖 GitHub Actions（发布走双渠道：Cloudflare 自动 + WorkBuddy 手动），所以原先由 CI 承担的
   「每次改动都跑一遍机器检查」这件事，必须有一个本地入口来兜底——否则那些检查
   只会在有人记得的时候才跑，等于没写。

   顺序是刻意排的：**先便宜后昂贵**。语法错误会让后面所有检查都白跑，
   所以放第一位；覆盖率最贵（要跑一遍完整套件），放最后。

     1) 语法校验          提取内联脚本编译（不执行）
     2) 架构约束          模块不得反向引用（R1/R2 零例外，R3 白名单）
     3) 代码卫生          零依赖 lint（no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef）
     4) 代码卫生 · 加强   ESLint（AST/控制流规则；装了才跑，没装自动跳过，不影响产物）
     5) DOM 引用完整性    $("x") 不得悬空
     6) 自动化测试        FULL_SCAN=1 全量组合扫描
     7) 死循环看门狗      每用例独立子进程 + 超时强杀
     8) 行覆盖率          V8 内置采集，总阈值 97% / 分区 90%

   第 4 项是**可选加强项**：它依赖 node_modules（npm install 才有），而产物始终零依赖、
   Cloudflare 的发布链路不保证跑过 install。所以缺 eslint 时它主动 exit 0 并打印"跳过"，
   绝不因为"没装开发依赖"把上线堵死。规则集与 check-lint.js 刻意不重叠，详见 eslint.config.js。

   用法：
     node tools/check-all.js          # 全套（约 2–3 秒）
     node tools/check-all.js --quick  # 跳过 T21 的 243 组全量扫描（改代码时的快速反馈）
   退出码 0 = 全部通过，1 = 有失败项。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const QUICK = process.argv.includes("--quick");

/* 语法校验没有独立脚本（就一行），内联在这里，与新检出的仓库保持一致 */
const SYNTAX = "const fs=require('fs');const m=fs.readFileSync('index.html','utf8')"
  + ".match(/<script>([\\s\\S]*?)<\\/script>/);if(!m)throw new Error('未找到 <script>');"
  + "new Function(m[1]);console.log('inline script 编译通过')";

const STEPS = [
  { name: "语法校验", cmd: process.execPath, args: ["-e", SYNTAX] },
  { name: "架构约束 · 模块不得反向引用", cmd: process.execPath, args: ["tools/check-module-order.js"] },
  { name: "代码卫生 · 零依赖 lint", cmd: process.execPath, args: ["tools/check-lint.js"] },
  { name: "代码卫生 · ESLint（加强）", cmd: process.execPath, args: ["tools/check-eslint.js"] },
  { name: "DOM 引用完整性", cmd: process.execPath, args: ["tools/check-dom-ids.js"] },
  { name: "自动化测试" + (QUICK ? "（抽样）" : "（FULL_SCAN 全量）"), cmd: process.execPath, args: ["tests/run.js"], env: { FULL_SCAN: QUICK ? "" : "1" } },
  { name: "死循环看门狗", cmd: process.execPath, args: ["tests/hang-guard.js", "8000"] },
  { name: "行覆盖率", cmd: process.execPath, args: ["tools/check-coverage.js"].concat(QUICK ? [] : ["--full"]) },
];

console.log("══════════════════════════════════════════════════════════");
console.log("  BeatSight 完整自验" + (QUICK ? "（快速模式：跳过 T21 全量组合扫描）" : ""));
console.log("══════════════════════════════════════════════════════════");

const results = [];
const t0 = Date.now();

for (const step of STEPS){
  process.stdout.write("\n▸ " + step.name + "\n");
  const started = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: Object.assign({}, process.env, step.env || {}),
  });
  const ms = Date.now() - started;
  const okStep = r.status === 0;
  results.push({ name: step.name, ok: okStep, ms, status: r.status });
  if (!okStep){
    /* 失败就停：后面的检查建立在"前面是对的"之上，继续跑只会刷屏 */
    console.log("\n  ✗ 「" + step.name + "」未通过（退出码 " + r.status + "），后续检查已跳过。");
    break;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("\n══════════════════════════════════════════════════════════");
console.log("  结果汇总");
console.log("══════════════════════════════════════════════════════════");
results.forEach(r => {
  console.log("  " + (r.ok ? "✓" : "✗") + " " + r.name.padEnd(28) + (r.ms / 1000).toFixed(2) + "s");
});
const skipped = STEPS.length - results.length;
if (skipped > 0) console.log("  · 跳过 " + skipped + " 项（前面有失败项）");
console.log("  " + "─".repeat(52));
const failed = results.filter(r => !r.ok).length;
console.log("  " + (failed ? failed + " 项失败" : "全部通过") + " · 用时 " + elapsed + "s");
process.exit(failed ? 1 : 0);
