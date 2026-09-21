/* 一条命令跑完全部检查：node tools/check-all.js
   ---------------------------------------------------------------------------
   机器检查的**主入口**是本地 `tools/check-all.js`（发布走双渠道：Cloudflare 自动 + WorkBuddy 手动）：
   这些检查原先只会在有人记得的时候才跑、等于没写，所以必须有一个本地入口来兜底；
   v2.8.8 起仓库内另加了 `.github/workflows/ci.yml` 作**补位**（推 main / PR 时跑 `npm run ci` +
   真实浏览器冒烟），它覆盖分支与 PR，但不替代本地这一遍、也不替代 Cloudflare 那条配不到仓库里的构建闸门。

   顺序是刻意排的：**先便宜后昂贵**。语法错误会让后面所有检查都白跑，
   所以放第一位；覆盖率最贵（要跑一遍完整套件），放最后。

     1) 语法校验          提取内联脚本编译（不执行）
     2) 架构约束          模块不得反向引用（R1/R2 零例外，R3 白名单）
     3) 装配完整性        注入槽（`let onXxx = null;` 约定）与 patLenOf 是否真被接上（v2.8.6 新增）
     4) 代码卫生          零依赖 lint（no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef）
     5) 版本一致性        VERSION / CHANGELOG / package.json / package-lock.json / 代码注释不得漂移
     6) 文档一致性        模块索引行号（↔ 实际 banner）· 禁手写耗时 · 归档状态 · 审计快照横幅 ·
                          README 版本号与功能清单步数 · 禁手写覆盖率现状（后三条 v2.8.6 新增）
     7) _headers 结构      `/*` 全路径 glob 恰好一行 · 6 个安全头齐全且缩进 · 无 BOM / 无孤立收尾
                          （v2.8.7 新增；它是唯一"写错了不报错、只会静默失效"的配置文件）
     8) 代码卫生 · 加强   ESLint（AST/控制流规则；**可选**：装了才跑，没装标 ⊘ 跳过）
     9) 类型检查 · 加强   tsc（checkJs：模块接口与数据模型的类型错误；**可选**：同上）
    10) DOM 引用完整性    $("x") 不得悬空
    11) 浏览器冒烟        真实 DOM/CSS/Service Worker（**环境可选**：没装浏览器标 ⊘，见下）
    12) 自动化测试        FULL_SCAN=1 全量组合扫描
    13) 死循环看门狗      每用例独立子进程 + 超时强杀
    14) 行覆盖率          V8 内置采集，总阈值 97% / 分区 90%

   ★ 三种"没跑到"必须分清（v2.0.6 起为两类，v2.8.6 补第三类）：
     · 第 8、9 项是**可选加强项**——缺的是开发依赖（npm ci 能装上），所以 --strict-env 下报错，
       逼 CI 装上而不是假装查过；
     · 第 11 项是**环境可选**——缺的是环境能力（本机得有 Chrome/Edge）。构建镜像里必然没有，
       把它算失败会无谓地堵住部署，所以 --strict-env 也不升级。它靠退出码 3 表达"本机缺能力"。
     · **工具故障**（任意步骤）——子进程**压根没起来**（spawnSync 报错），
       或子步骤按约定以退出码 4 自报"我未能执行"。它与前两类的区别是：
       前两类是"按设计不跑"，这一类是"**想跑但没跑成 = 本次未被验证**"。
     前两类在汇总里都显示 ⊘，"为什么没跑"分开写清；第三类显示 ⚠ 并单独计数——
     这正是本文件区分 ⊘ / ✓ 的初衷，v2.8.6 只是把它补全到"故障"这一类（审计 §E2/§E5）。
     ⚠ 本地（非 --strict-env）工具故障**不**让退出码变 1：它的成因在环境（权限/沙箱/资源），
       不是被检代码；把它算失败等于"因为尺子坏了就宣布测量结果不合格"。但它会**响亮地**
       印在汇总里，且 --strict-env（CI）下按失败处理——CI 里工具起不来是真的问题。

   第 6 项（文档一致性，v2.0.5）是这一轮审计的产物：闸门把**代码**盘得很干净，却没有任何
   检查器会核对注释与文档里的数字——模块索引 16 条行号全错、自验耗时被"修"过又歪、
   README 声称已归档的文档正文里没有归档横幅、审计产物（spec.md / tasks.md / checklist.md）
   正文里没有快照横幅，四件都是这么漏掉的。它不做别的，只把"抄进文档的数值"这一类漂移
   变成机器可判。

   第 8、9 项是**可选加强项**：它们依赖 node_modules（npm install 才有），而产物始终零依赖、
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
     node tools/check-all.js --quick       # 跳过 T21 全量组合扫描（改代码时用）
     node tools/check-all.js --strict-env  # CI 用：可选加强项缺依赖时报错（不允许静默跳过）
   退出码 0 = 没有失败项（仍可能含 ⊘ 未执行；**本地**工具故障也不计失败），
          1 = 有失败项，或 --strict-env 下出现工具故障（CI 里工具起不来是真问题）。
   ★ 刻意不在这里写实测秒数（v2.0.5，审计 P0-5）：这类数字在 D1/D9 里已经被"修"过一次又歪了，
     tools/check-docs.js 现在会拦下重新写回它的手——耗时由本文件在末尾自己打印。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const QUICK = process.argv.includes("--quick");
/* CI 里最容易出的事：忘记 npm ci，于是 ESLint / tsc 两步永远是 ⊘——汇总虽写着"实跑 8/10"，
   但没人会去核对那个分母。--strict-env 把"可选跳过"变成"报错"，逼 CI 要么装上依赖、要么改口径。 */
const STRICT_ENV = process.argv.includes("--strict-env");

/* 工具故障的统一退出码（v2.8.6，审计 §E2/§E5）：子步骤"压根没起来"时用它**主动**表达
   "我未能执行"，与退出码 1（真的检查没过）区分开。形状与上面 skipCode:3 同一约定：
   都是"用一个专用退出码传递一件退出码本身说不清的事"（3 = 本机缺环境能力，4 = 本步骤未能执行）。
   为什么需要它：有些子步骤自己会 spawn 下游进程（check-coverage → 测试套件、check-tsc → tsc），
   那层 spawn 失败时它没法让**本文件**知道"这是工具故障而非检查失败"——只能靠一个约定的退出码。
   v2.8.14（审计 P1-6）：各检查器的"自身故障"路径此前分别用 2 或 1 自报，只有一个退出码的约定
   只落实了一半——那些子步骤的故障仍被本文件误记成「✗ 未通过」并**中止后续步骤**。现已把
   check-lint / check-tsc / check-coverage / check-eslint / check-dom-ids / check-module-order
   的全部自身故障路径统一到 4，故本行判断即可覆盖"故障"这一整类，不再有 2 逃逸。 */
const TOOL_FAIL_CODE = 4;

/* 语法校验没有独立脚本（就一行），内联在这里，与新检出的仓库保持一致 */
const SYNTAX = "const fs=require('fs');const m=fs.readFileSync('index.html','utf8')"
  + ".match(/<script>([\\s\\S]*?)<\\/script>/);if(!m)throw new Error('未找到 <script>');"
  + "new Function(m[1]);console.log('inline script 编译通过')";

/* v2.8.16（审计 P2-1）：全量模式下最贵的那一遍（FULL_SCAN=1 组合扫描）此前被**跑两次**——
   第 12 步自己跑一次，第 14 步 check-coverage.js --full 内部又 spawn 一次同一套件。
   现在第 12 步带着 NODE_V8_COVERAGE 跑（同一遍既出测试结论、又把 V8 区间落盘到本目录），
   第 14 步 check-coverage 用 `--reuse=<本目录>` 直接分析这份落盘、**跳过重跑**。
   目录在整套检查跑完后清理（见循环之后）。 */
const COV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "beatsight-allcov-"));

const STEPS = [
  { name: "语法校验", cmd: process.execPath, args: ["-e", SYNTAX] },
  { name: "架构约束 · 模块不得反向引用", cmd: process.execPath, args: ["tools/check-module-order.js"] },
  /* v2.8.6（审计 §A1）：装配完整性紧跟架构约束——两者同属"模块边界"这个话题
     （前者管依赖方向，这条管边界处的注入语义），且都极便宜（纯读源码正则，毫秒级） */
  { name: "装配完整性 · 注入槽", cmd: process.execPath, args: ["tools/check-wiring.js"] },
  { name: "代码卫生 · 零依赖 lint", cmd: process.execPath, args: ["tools/check-lint.js"] },
  { name: "版本一致性", cmd: process.execPath, args: ["tools/check-version.js"] },
  /* v2.0.5（审计 P0-6）：文档一致性紧跟在版本一致性之后——两者同属"元信息不得漂移"，
     且都极便宜（纯读文件比对，毫秒级），按本文件"先便宜后昂贵"的排序原则一起前置 */
  { name: "文档一致性", cmd: process.execPath, args: ["tools/check-docs.js"] },
  /* v2.8.7（审计 §S1）：_headers 是本仓库唯一"写错了不报错、只会静默失效"的配置文件
     （Cloudflare 对畸形行不告警，"删掉 `/*` → 6 条安全头全部失去作用域"是无声的）。
     与上面两条同属"元信息不得漂移"，也极便宜（读一个 34 行的文件），故一起前置。 */
  { name: "_headers 结构", cmd: process.execPath, args: ["tools/check-headers.js"] },
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
  /* v2.8.16（审计 P2-1）：本步同时承担覆盖率采集——FULL_SCAN 下覆盖率插桩的内存开销约 2GB，
     故带头抬高 old-space 上限（V8 按需增长，不预占；只影响这个带插桩的子进程）。
     第 14 步据此落盘分析，不再重跑套件。 */
  { name: "自动化测试" + (QUICK ? "（抽样）" : "（FULL_SCAN 全量）"), cmd: process.execPath,
    args: ["--max-old-space-size=4096", "tests/run.js"],
    env: { FULL_SCAN: QUICK ? "" : "1", NODE_V8_COVERAGE: COV_DIR } },
  { name: "死循环看门狗", cmd: process.execPath, args: ["tests/hang-guard.js", "8000"] },
  /* v2.8.16（审计 P2-1）：--reuse 复用第 12 步的落盘，跳过 check-coverage 内部的重跑（去重的另一半） */
  { name: "行覆盖率", cmd: process.execPath,
    args: ["tools/check-coverage.js", "--reuse=" + COV_DIR].concat(QUICK ? [] : ["--full"]) },
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
  /* ---- 工具故障 ≠ 检查失败（v2.8.6，审计 §E2/§E5）----
     spawnSync **失败**时 `r.status === null` 且 `r.error` 有值。此前这里只看 `r.status === 0`，
     于是"工具压根没起来"被打印成「✗ 「行覆盖率」未通过（退出码 null）」——把工具故障说成
     被检项失败，把人送去查一个不存在的错误。本机沙箱实测**完整误导过一轮**：当时仓库
     13 项全部健康（手工补跑得覆盖率 99.4%、测试 2412 PASS / tsc 退出 0），
     汇总却是"1 项失败 · 实跑 10/12"，而且失败原因是"类型检查未通过"。
     这是 §E2 同一哲学的延伸：过去是"不让 ⊘ 伪装成 ✓"，现在是"不让故障伪装成失败"。 */
  if (r.error || r.status === TOOL_FAIL_CODE){
    const why = r.error
      ? (r.error.code || r.error.errno || "?") + "：" + r.error.message
      : "子步骤自报未能执行（按约定退出码 " + TOOL_FAIL_CODE + "）";
    console.log("  ⚠ 工具故障——本步骤**未被验证**（" + why + "）");
    console.log("     注意：这不是「检查没通过」，是「检查压根没跑成」。"
      + "先查该步骤的环境（权限 / 沙箱 / 资源），别去查检查内容。");
    results.push({ name: step.name, ok: false, skipped: false, env: false, toolError: true, ms, status: r.status });
    /* 刻意**不**终止后续：真失败会级联（后面的检查建立在前面是对的之上），
       而工具故障通常是环境性的、只影响用同一机制的那几步——继续跑反而能一次看清全貌。
       本机沙箱就是这个形状：用 stdio:"inherit" 的步骤全部正常，只有管道式 spawn 的那两步故障。 */
    continue;
  }
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
/* v2.8.16（审计 P2-1）：第 12/14 步共享的覆盖率落盘目录，检查跑完后清理（无论成败） */
fs.rmSync(COV_DIR, { recursive: true, force: true });
console.log("\n══════════════════════════════════════════════════════════");
console.log("  结果汇总");
console.log("══════════════════════════════════════════════════════════");
/* v2.8.28（审计 P3）：汇总列按**显示宽度**对齐，不是字符数。
   步名里混着 CJK（全角字符在等宽终端占 2 列），`String.padEnd(28)` 只数 code unit，
   于是「自动化测试（FULL_SCAN 全量）」这类行被算短、右列时间戳整体右移，汇总表看着是歪的
   （纯外观，但这是每天都要扫一眼的表）。口径：宽/全角字符按 2 列，其余按 1 列。 */
function dispWidth(str){
  let w = 0;
  for (const ch of str){
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}
results.forEach(r => {
  const mark = r.toolError ? "⚠" : (r.skipped ? "⊘" : (r.ok ? "✓" : "✗"));
  const time = r.toolError ? "工具故障，未验证"
    : (r.skipped ? (r.env ? "环境缺失，未执行" : "未安装依赖，未执行") : (r.ms / 1000).toFixed(2) + "s");
  const nameCol = r.name + " ".repeat(Math.max(0, 28 - dispWidth(r.name)));
  console.log("  " + mark + " " + nameCol + time);
});

/* 分解式汇总（v2.8.6，审计 §E5）：原先只有一行「N 项失败 · 实跑 R/M 项」，而"没跑到"
   的三种成因（缺开发依赖 / 缺环境能力 / **工具故障**）在那一行里长得一模一样——
   单看它无法判断要不要处置。现在按类别分开写，并在需要时附**一行**处置建议。
   ★ 为什么不是"少跑了几项就一起报个数字"：这三类的处置动作完全不同——
     缺依赖 → npm ci；缺浏览器 → 换台机器或忽略；工具故障 → 查环境。混在一起写就等于没写。 */
const passed     = results.filter(r => r.ok).length;
const skippedOpt = results.filter(r => r.skipped && !r.env).length;
const skippedEnv = results.filter(r => r.env).length;
const toolErr    = results.filter(r => r.toolError).length;
const failed     = results.filter(r => !r.ok && !r.env && !r.toolError).length;
const ran        = results.filter(r => !r.skipped && !r.toolError).length;
const notRun     = STEPS.length - results.length;          // 前面有真失败 → 后面的根本没轮到
const parts = [];
/* 有工具故障时**不再说「全部通过」**：本次确实有 N 项没被验证，说"全部通过"就是在撒谎 */
parts.push(failed ? "✗ " + failed + " 项失败"
  : (toolErr || notRun ? "✓ " + passed + " 项通过（本次未全部验证）" : "全部通过"));
if (skippedOpt) parts.push("⊘ " + skippedOpt + " 项未执行（可选加强项，缺 node_modules）");
if (skippedEnv) parts.push("⊘ " + skippedEnv + " 项环境缺失未执行");
if (toolErr)    parts.push("⚠ " + toolErr + " 项工具故障（未被验证，不是被检项失败）");
if (notRun)     parts.push("— " + notRun + " 项因前面失败未执行");
parts.push("实跑 " + ran + "/" + STEPS.length + " 项");
parts.push("用时 " + elapsed + "s");
console.log("  " + "─".repeat(52));
console.log("  " + parts.join(" · "));
if (failed){
  console.log("  处置：从上面第一个 ✗ 开始修——它之后的所有结论都不成立。");
} else if (toolErr){
  console.log("  处置：⚠ 是**工具自身没起来**，不是代码问题——查那几步的环境（权限 / 沙箱 / 资源），"
    + "别去查检查内容。本次这几项**未被验证**"
    + (STRICT_ENV ? "；--strict-env 下按失败处理。" : "（本地不堵部署，CI 会堵）。"));
} else if (skippedOpt && STRICT_ENV){
  console.log("  处置：--strict-env 已把缺依赖的 ⊘ 升级为报错，见上文。");
}
process.exit(failed || (toolErr && STRICT_ENV) ? 1 : 0);
