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
     4) 版本一致性        VERSION / CHANGELOG / 代码注释三处版本号不得漂移
     5) 文档一致性        模块索引行号（↔ 实际 banner）· 禁手写耗时 · 归档状态（v2.0.5 新增）
     6) 代码卫生 · 加强   ESLint（AST/控制流规则；**可选**：装了才跑，没装标 ⊘ 跳过）
     7) 类型检查 · 加强   tsc（checkJs：模块接口与数据模型的类型错误；**可选**：同上）
     8) DOM 引用完整性    $("x") 不得悬空
     9) 浏览器冒烟        真实 DOM/CSS/Service Worker（**环境可选**：没装浏览器标 ⊘，见下）
    10) 自动化测试        FULL_SCAN=1 全量组合扫描
    11) 死循环看门狗      每用例独立子进程 + 超时强杀
    12) 行覆盖率          V8 内置采集，总阈值 97% / 分区 90%

   ★ 两种"跳过"必须分清（v2.0.6，审计 P1-10）：
     · 第 6、7 项是**可选加强项**——缺的是开发依赖（npm ci 能装上），所以 --strict-env 下报错，
       逼 CI 装上而不是假装查过；
     · 第 9 项是**环境可选**——缺的是环境能力（本机得有 Chrome/Edge）。构建镜像里必然没有，
       把它算失败会无谓地堵住部署，所以 --strict-env 也不升级。它靠退出码 3 表达"本机缺能力"。
     两者在汇总里都显示 ⊘，但"为什么没跑"分开写清——这正是本文件区分 ⊘/✓ 的初衷。

   第 5 项（文档一致性，v2.0.5）是这一轮审计的产物：闸门把**代码**盘得很干净，却没有任何
   检查器会核对注释与文档里的数字——模块索引 16 条行号全错、自验耗时被"修"过又歪、
   README 声称已归档的文档正文里没有归档横幅，三件都是这么漏掉的。它不做别的，
   只把"抄进文档的数值"这一类漂移变成机器可判。

   第 6、7 项是**可选加强项**：它们依赖 node_modules（npm install 才有），而产物始终零依赖、
   Cloudflare 的发布链路不保证跑过 install。所以缺依赖时它们主动 exit 0 并打印"跳过"，
   绝不因为"没装开发依赖"把上线堵死。规则集与 check-lint.js 刻意不重叠，详见 eslint.config.js
   与 tools/tsconfig.typecheck.json。

   **可选步骤的"跳过"必须显示为 ⊘ 而不是 ✓**（v1.10.0 修）：本文件只认退出码，而可选步骤
   按设计就是 exit 0，于是"没装依赖所以没查"和"查了且通过"在汇总里长得一模一样——
   那是个假绿：汇总写着"全部通过"，实际跑过的项比看上去少。现在由本文件自己检查依赖是否
   （step.optional 指向的路径），缺了就直接标 ⊘ 并计入"未执行"数，不调用那个步骤。
   这样"到底查了几项"是**能一眼看出来**的，不用去猜。

   用法：
     node tools/check-all.js               # 全套（耗时随机器与 Node 版本而变，看末尾汇总）
     node tools/check-all.js --quick       # 跳过 T21 的 243 组全量扫描（改代码时用）
     node tools/check-all.js --strict-env  # CI 用：可选加强项缺依赖时报错（不允许静默跳过）
   退出码 0 = 全部通过，1 = 有失败项。
   ★ 刻意不在这里写实测秒数（v2.0.5，审计 P0-5）：这类数字在 D1/D9 里已经被"修"过一次又歪了，
     tools/check-docs.js 现在会拦下重新写回它的手——耗时由本文件在末尾自己打印。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const QUICK = process.argv.includes("--quick");
/* CI 里最容易出的事：忘记 npm ci，于是 ESLint / tsc 两步永远是 ⊘——汇总虽写着"实跑 8/10"，
   但没人会去核对那个分母。--strict-env 把"可选跳过"变成"报错"，逼 CI 要么装上依赖、要么改口径。 */
const STRICT_ENV = process.argv.includes("--strict-env");

/* 语法校验没有独立脚本（就一行），内联在这里，与新检出的仓库保持一致 */
const SYNTAX = "const fs=require('fs');const m=fs.readFileSync('index.html','utf8')"
  + ".match(/<script>([\\s\\S]*?)<\\/script>/);if(!m)throw new Error('未找到 <script>');"
  + "new Function(m[1]);console.log('inline script 编译通过')";

const STEPS = [
  { name: "语法校验", cmd: process.execPath, args: ["-e", SYNTAX] },
  { name: "架构约束 · 模块不得反向引用", cmd: process.execPath, args: ["tools/check-module-order.js"] },
  { name: "代码卫生 · 零依赖 lint", cmd: process.execPath, args: ["tools/check-lint.js"] },
  { name: "版本一致性", cmd: process.execPath, args: ["tools/check-version.js"] },
  /* v2.0.5（审计 P0-6）：文档一致性紧跟在版本一致性之后——两者同属"元信息不得漂移"，
     且都极便宜（纯读文件比对，毫秒级），按本文件"先便宜后昂贵"的排序原则一起前置 */
  { name: "文档一致性", cmd: process.execPath, args: ["tools/check-docs.js"] },
  /* optional = 该步骤所需的依赖相对路径；不存在就标 ⊘ 跳过（不调用），不让它伪装成 ✓ */
  { name: "代码卫生 · ESLint（加强）", cmd: process.execPath, args: ["tools/check-eslint.js"],
    optional: "node_modules/eslint" },
  { name: "类型检查 · tsc（加强）", cmd: process.execPath, args: ["tools/check-tsc.js"],
    optional: "node_modules/typescript" },
  { name: "DOM 引用完整性", cmd: process.execPath, args: ["tools/check-dom-ids.js"] },
  /* 环境可选步骤（v2.0.6，审计 P1-10）：真实浏览器冒烟。它需要的不是"开发依赖"而是
     **环境能力**（本机得装 Chrome/Edge）——Cloudflare 的构建镜像里必然没有，所以
     --strict-env 也不该把它升级成错误，否则每次部署都会被无谓地堵住。
     约定：退出码 3 = 本机缺这项能力 → 按 ⊘ 记账（既不算通过也不算失败，结论见汇总）。 */
  { name: "浏览器冒烟 · 真实 DOM", cmd: process.execPath, args: ["tools/smoke.js"],
    skipCode: 3, skipNote: "本机没有 Chrome / Edge" },
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
  /* 可选步骤：依赖不在就直接标 ⊘，**不调用**。理由见文件头——让"没查"与"查了通过"长得不一样，
     否则汇总里的 ✓ 会撒谎（假装查过）。 */
  if (step.optional && !fs.existsSync(path.join(ROOT, step.optional))){
    console.log("\n▸ " + step.name);
    if (STRICT_ENV){
      console.log("  ✗ --strict-env：缺少 " + step.optional + "，可选加强项不允许跳过（请先 `npm ci`）。");
      results.push({ name: step.name, ok: false, skipped: false, ms: 0, status: 2 });
      break;
    }
    console.log("  ⊘ 跳过（未安装 " + path.basename(step.optional) + "）——这是可选加强项，不是失败项");
    results.push({ name: step.name, ok: true, skipped: true, ms: 0, status: 0 });
    continue;
  }
  process.stdout.write("\n▸ " + step.name + "\n");
  const started = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: Object.assign({}, process.env, step.env || {}),
  });
  const ms = Date.now() - started;
  /* 环境可选步骤的专用退出码：代表"本机缺这项环境能力"，按 ⊘ 记账而不是失败。
     与上面 optional 的差别：optional 缺的是**开发依赖**（能 npm ci 装上，所以 --strict-env
     会报错逼你装）；这里缺的是**环境能力**（浏览器没法"装进产物"），--strict-env 也不升级为失败 */
  const envSkipped = step.skipCode !== undefined && r.status === step.skipCode;
  if (envSkipped) console.log("  ⊘ 跳过（" + (step.skipNote || "本机缺该项环境能力") + "）");
  const okStep = r.status === 0;
  results.push({ name: step.name, ok: okStep, skipped: envSkipped, env: envSkipped, ms, status: r.status });
  if (!okStep && !envSkipped){
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
  const mark = r.skipped ? "⊘" : (r.ok ? "✓" : "✗");
  const time = r.skipped ? (r.env ? "环境缺失，未执行" : "未安装依赖，未执行") : (r.ms / 1000).toFixed(2) + "s";
  console.log("  " + mark + " " + r.name.padEnd(28) + time);
});
const skippedOpt = results.filter(r => r.skipped && !r.env).length;
if (skippedOpt) console.log("  · " + skippedOpt + " 项可选加强项未执行（装了 node_modules 才会跑）");
const skippedEnv = results.filter(r => r.env).length;
if (skippedEnv) console.log("  · " + skippedEnv + " 项环境能力缺失未执行（本机没有可用浏览器，不影响产物）");
const skipped = STEPS.length - results.length;
if (skipped > 0) console.log("  · 跳过 " + skipped + " 项（前面有失败项）");
console.log("  " + "─".repeat(52));
/* 失败计数必须排除"环境缺失"那类 ⊘：它的 ok 是 false（没跑到 0），但它不是失败 */
const failed = results.filter(r => !r.ok && !r.env).length;
const ran = results.filter(r => !r.skipped).length;
console.log("  " + (failed ? failed + " 项失败" : "全部通过")
  + " · 实跑 " + ran + "/" + STEPS.length + " 项 · 用时 " + elapsed + "s");
process.exit(failed ? 1 : 0);
