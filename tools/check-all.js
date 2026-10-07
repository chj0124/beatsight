/* 一条命令跑完全部检查：node tools/check-all.js
   ---------------------------------------------------------------------------
   机器检查的**主入口**是本地 `tools/check-all.js`（发布走双渠道：Cloudflare 自动 + WorkBuddy 手动）：
   这些检查原先只会在有人记得的时候才跑、等于没写，所以必须有一个本地入口来兜底；
   v2.8.8 起仓库内另加了 `.github/workflows/ci.yml` 作**补位**（推 main / PR 时跑 `npm run ci` +
   真实浏览器冒烟），它覆盖分支与 PR，但不替代本地这一遍、也不替代 Cloudflare 那条配不到仓库里的构建闸门。

   顺序是刻意排的：**先便宜后昂贵**。语法错误会让后面所有检查都白跑，
   所以放第一位；覆盖率最贵（要跑一遍完整套件），放最后。
    ★ 步骤清单与顺序的**唯一真相源是下方 STEPS 数组**；本注释的编号列表由
      tools/check-docs.js 第 6 项校验「数量必须与 STEPS 一致」（落地审计 E3）——
      改 STEPS 请同步改本列表，漏改会当场红。

      1) 语法校验          提取内联脚本编译（不执行）
      2) 架构约束          模块不得反向引用（R1/R2 零例外，R3 白名单）
      3) 装配完整性        注入槽（`let onXxx = null;` 约定）与 patLenOf 是否真被接上（v2.8.6 新增）
      4) 代码卫生          零依赖 lint（no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef /
                           no-eval / no-innerhtml / no-children-array-method）
      5) 版本一致性        VERSION / CHANGELOG / package.json / package-lock.json / 代码注释不得漂移
      6) 文档一致性        模块索引行号（↔ 实际 banner）· 禁手写耗时 · 归档状态 · 审计快照横幅 ·
                           README 版本号与功能清单步数 · 禁手写覆盖率现状（后三条 v2.8.6 新增）
      7) _headers 结构      `/*` 全路径 glob 恰好一行 · 6 个安全头齐全且缩进 · 无 BOM / 无孤立收尾
                           （v2.8.7 新增；它是唯一"写错了不报错、只会静默失效"的配置文件）
      8) 过期副本检测      本机其它位置的 BeatSight 副本版本比对（v3.33.14 新增；恒不判红，
                           只提示——副本可能是有意保留的历史对照）
     9) 远端漂移核对      本机 HEAD ↔ GitHub main（v3.36.5 新增；一致 ✓ / 不一致判红 /
                           无 gh = ⊘ 环境缺失 / 网络不可达 = ⚠ 未被验证。它守的是"别在旧基线上开工"）
     10) DOM 节点账本      body 内节点数与标记结构平衡（零判红权账本，观察预算趋势）
     11) 测试桩能力对账    harness ↔ hang-case 能力键集合 + 差异白名单（--strict 判红，v3.31.x 升级）
     12) 资源体积预算       index.html ≤ 预算字节数（硬线，越界即红）
     13) CSS 孤儿扫描      死 class 清单（**v3.33.14 起 --strict 判红**：修完口径后实测 0 孤儿，
                           观察期结束；此前 26 条全是动态拼接造成的假阳性）
     14) 代码卫生 · 加强   ESLint（AST/控制流规则；**可选**：装了才跑，没装标 ⊘ 跳过）
     15) 类型检查 · 加强   tsc（checkJs：模块接口与数据模型的类型错误；**可选**：同上）
     16) DOM 引用完整性    $("x") 不得悬空
     17) 无障碍 · 标记级   静态 a11y 高置信规则 A–E（v3.34.6 新增；正 tabindex / switch 缺
                           aria-checked / img 缺 alt / 可交互元素无可访问名 / aria-hidden 藏可聚焦项。
                           ★ 认「JS 运行期赋名」，免得误报 applyTheme 那类写法）
     18) 浏览器冒烟        真实 DOM/CSS/Service Worker（**环境可选**：没装浏览器标 ⊘，见下）
     19) 自动化测试        FULL_SCAN=1 全量组合扫描
     20) 死循环看门狗      每用例独立子进程 + 超时强杀
     21) 行覆盖率          V8 内置采集，总阈值 97% / 分区 90%

   ★ 三种"没跑到"必须分清（v2.0.6 起为两类，v2.8.6 补第三类）：
     · 第 13、14 项是**可选加强项**——缺的是开发依赖（npm ci 能装上），所以 --strict-env 下报错，
       逼 CI 装上而不是假装查过；
     · 第 16 项是**环境可选**——缺的是环境能力（本机得有 Chrome/Edge）。构建镜像里必然没有，
       把它算失败会无谓地堵住部署，所以 --strict-env 也不升级。它靠退出码 3 表达"本机缺能力"。
     · **工具故障**（任意步骤）——子进程**压根没起来**（spawnSync 报错），
       或子步骤按约定以退出码 4 自报"我未能执行"。它与前两类的区别是：
       前两类是"按设计不跑"，这一类是"**想跑但没跑成 = 本次未被验证**"。
     前两类在汇总里都显示 ⊘，"为什么没跑"分开写清；第三类显示 ⚠ 并单独计数——
     这正是本文件区分 ⊘ / ✓ 的初衷，v2.8.6 只是把它补全到"故障"这一类（审计 §E2/§E5）。
     ⚠ 本地（非 --strict-env）工具故障**不**让退出码变 1：它的成因在环境（权限/沙箱/资源），
       不是被检代码；把它算失败等于"因为尺子坏了就宣布测量结果不合格"。但它会**响亮地**
       印在汇总里，且 --strict-env（CI）下按失败处理——CI 里工具起不来是真的问题。
      ★ v3.33.14 更新：原「第 11 项 CSS 孤儿扫描的**观察期警告**」**已转正为判红**
      （修完"被用到"口径后实测 0 孤儿，观察期结束，详见该步骤处的注释）。
      现仍走"⚠ 单列进汇总"这条通道的观察项有三类：模块规模（≥3000 行）、
      装配区规模（顶层 function ≥34 / 行数 ≥2000）、以及**过期副本检测**
      （新第 8 项，恒 exit 0——副本可能是有意保留的历史对照，工具不替人判断该不该删）。

   第 6 项（文档一致性，v2.0.5）是这一轮审计的产物：闸门把**代码**盘得很干净，却没有任何
   检查器会核对注释与文档里的数字——模块索引 16 条行号全错、自验耗时被"修"过又歪、
   README 声称已归档的文档正文里没有归档横幅、审计产物（spec.md / tasks.md / checklist.md）
   正文里没有快照横幅，四件都是这么漏掉的。它不做别的，只把"抄进文档的数值"这一类漂移
   变成机器可判。

   第 13、14 项是**可选加强项**：它们依赖 node_modules（npm install 才有），而产物始终零依赖、
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
   第 16 步自己跑一次，第 18 步 check-coverage.js --full 内部又 spawn 一次同一套件。
   现在第 16 步带着 NODE_V8_COVERAGE 跑（同一遍既出测试结论、又把 V8 区间落盘到本目录），
   第 18 步 check-coverage 用 `--reuse=<本目录>` 直接分析这份落盘、**跳过重跑**。
   目录在整套检查跑完后清理（见循环之后）。 */
const COV_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "beatsight-allcov-"));

const STEPS = [
  { name: "语法校验", cmd: process.execPath, args: ["-e", SYNTAX] },
  { name: "架构约束 · 模块不得反向引用", cmd: process.execPath, args: ["tools/check-module-order.js"],
    warnScan: /^\s*⚠\s*模块规模/,
    /* ★ v3.36.12（审计 C-6）：观察期项必须**登记到期日**——否则"暂时只警告"会变成永久状态，
       而长期不判红的警告会被习惯性忽略（审计原话：「最终变成噪音」）。 */
    observe: { until: "2026-11-06", why: "装配区规模告警线（2000 行 / 34 个 function）尚未越线，先观察" } },
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
  /* v3.33.14（审计 §2.3）：过期副本检测。与上面三条同属"元信息不得漂移"，
     且便宜（只读各副本的第一处 VERSION 正则）。
     ★ 它守的是一条此前**只有文字纪律**的规则：AGENTS.md §5 写着"取证前先核对远端 HEAD，
       别拿过期副本当现状"，而本仓真实发生过——工作区里那份副本落后 30+ 个版本被当基线。
       放到这一步之后立刻执行，是为让"我读的是不是当前这份"在**开始跑昂贵检查之前**就有答案。
     ★ 恒 exit 0（只提示不判红）：过期副本可能是有意保留的历史对照，工具不替人判断该不该删；
       它只负责把"旁边还有一份 vX.Y.Z"这件事摆到眼前。 */
  { name: "过期副本检测", cmd: process.execPath, args: ["tools/check-stale-copies.js"],
    warnScan: /^\s*⚠\s*发现/ },
  /* v3.36.5（审计 第二部分①）：远端漂移核对。
     ★ 与上面这条（过期副本检测）是同一个问题的两端：那条管**本机别处**有没有更旧/更新的副本，
       这条管**远端**有没有前进。两者都在最便宜的阶段回答"我读的是不是当前这份"。
     ★ 放在这里而不是更后面：它是唯一会为"在旧基线上开工"这件事报警的一步，
       必须在任何昂贵检查之前给出答案——否则 20 步全绿的代价是 90 秒。
     ★ 退出码约定（详见工具文件头）：0 一致 / 1 不一致（判红）/ 3 本机没有 gh（⊘ 环境缺失）
       / 4 网络不可达等工具故障（⚠ 未被验证）。
       ★★ 3 与 4 都不判红是刻意的：CI 构建镜像里没有 gh 是常态，网络抖动也不是代码问题；
          把"查不了"算成失败，等于因为尺子不在手就宣布测量结果不合格。 */
  { name: "远端漂移核对", cmd: process.execPath, args: ["tools/check-remote-drift.js"],
    skipCode: 3, skipNote: "本机没有 gh（无法核对远端）",
    faultRetry: 1 },
  /* v2.42.2（审计第一批）：两个静态账本/对账步。与上面三步同属"极便宜纯读文件"家族——
     节点账本给「DOM 预算只剩多少、大头在哪」提供数据（v2.26.1"先瘦身不放宽"纪律的依据），
     并把守 body 标记结构平衡（落地当天就抓到一处游离 </template>）；
     桩对账盯两份 DOM 桩（harness ↔ hang-case）的能力集合同步，防"改一份漏一份"再造成整组假红。
     桩对账自 v3.31.x（落地审计 E2）起带 --strict 判红——它落地至今一直 0 违规，观察期结束；
     节点账本仍零判红权（预算趋势由人看）。详见各自文件头。 */
  { name: "DOM 节点账本", cmd: process.execPath, args: ["tools/check-node-budget.js"] },
  { name: "测试桩能力对账", cmd: process.execPath, args: ["tools/check-stub-parity.js", "--strict"] },
  /* v2.58.0（基建 T3）：两个"零依赖纯读文件"家族的新账本，与上面同属极便宜家族，故一并前置。
     资源体积预算守"单文件 PWA 不得膨胀越过预算"的硬上限（越界即红，逼着以后每次加功能都先瘦身）；
     CSS 孤儿扫描是观察期账本——只打印疑似孤儿 class、默认不判红（exit 0），确认删除前先核对动态拼法，
     避免误删运行期才拼出来的样式。它带 warnScan 标记：本编排器会捕获它打印的 ⚠ 条数并单列进汇总
     （v3.31.x，落地审计 E2）——不判红，但「有 N 个疑似孤儿」从此在总览里可见。 */
  { name: "资源体积预算", cmd: process.execPath, args: ["tools/check-size-budget.js"] },
  /* v3.33.14：观察期**结束**，改按 --strict 接入（差异按失败处理）。
     观察期结束的依据（有实测，不是"看着差不多"）：v3.33.14 修了"被用到"的抽取口径后
     （补上动态拼接的类名），实测孤儿数由 **26 → 0**，而这 26 条经逐个核实**全部是假阳性**。
     ⇒ 既已零噪音，就没有理由继续"只警告不阻断"——再拖下去死样式仍然没人把守。
     与 check-stub-parity.js v3.31.x 由观察期转 --strict 是同一条路径。 */
  { name: "CSS 孤儿扫描", cmd: process.execPath, args: ["tools/check-orphan-css.js", "--strict"],
    warnScan: /^\s*⚠\s*/ },
  /* optional = 该步骤所需的依赖相对路径；不存在就标 ⊘ 跳过（不调用），不让它伪装成 ✓ */
  { name: "代码卫生 · ESLint（加强）", cmd: process.execPath, args: ["tools/check-eslint.js"],
    optional: "node_modules/eslint" },
  { name: "类型检查 · tsc（加强）", cmd: process.execPath, args: ["tools/check-tsc.js"],
    optional: "node_modules/typescript" },
  { name: "DOM 引用完整性", cmd: process.execPath, args: ["tools/check-dom-ids.js"] },
  /* v3.34.6（审计 第二部分①）：无障碍静态闸门。放在 DOM 引用之后、冒烟之前——
     与它同类（都是只看标记/静态结构的零依赖检查），且先于需要浏览器的步骤，
     这样"标记层面的 a11y 违规"能在最便宜的阶段就被拦住。 */
  { name: "无障碍 · 标记级", cmd: process.execPath, args: ["tools/check-a11y.js"] },
  /* 环境可选步骤（v2.0.6，审计 P1-10）：真实浏览器冒烟。它需要的不是"开发依赖"而是
     **环境能力**（本机得装 Chrome/Edge）——Cloudflare 的构建镜像里必然没有，所以
     --strict-env 也不该把它升级成错误，否则每次部署都会被无谓地堵住。
     约定：退出码 3 = 本机缺这项能力 → 按 ⊘ 记账（既不算通过也不算失败，结论见汇总）。 */
  { name: "浏览器冒烟 · 真实 DOM", cmd: process.execPath, args: ["tools/smoke.js"],
    skipCode: 3, skipNote: "本机没有 Chrome / Edge",
    /* v2.42.3：工具故障（exit 4，传输层抖动）自动重跑一次——与 smoke 内部的重测
       组成双层自愈，见下面循环内的说明 */
    faultRetry: 1 },
  /* v2.8.16（审计 P2-1）：本步同时承担覆盖率采集——FULL_SCAN 下覆盖率插桩的内存开销约 2GB，
     故带头抬高 old-space 上限（V8 按需增长，不预占；只影响这个带插桩的子进程）。
     第 18 步据此落盘分析，不再重跑套件。
     ★ v3.33.0：上限 4096 → 6144，依据是**实测**而非估算——套件已长到 186 个用例文件，
       v3.31.8 基线在 4096 下峰值 RSS 已达 3.727GB（贴着上限跑完，无余量），
       v3.33.0（+12 次 loadApp）峰值 3.754GB 即 OOM（exit 134）。
       对照实验排除"泄漏"：单次 loadApp 的内存增量两侧几乎相同（2438KB → 2464KB，+1%），
       即这 27MB 差额正是新增用例的 12 次装载本身，不是新代码的泄漏。
       本机物理内存 16GB，6GB 上限安全（插桩进程峰值约 4GB）。
       为什么是抬上限而不是砍用例数：上限卡在两版都顶到的位置 ⇒ 这是**套件增长**问题，
       砍自己那 12 次装载只是把同一颗雷留给下一个功能分支。 */
  { name: "自动化测试" + (QUICK ? "（抽样）" : "（FULL_SCAN 全量）"), cmd: process.execPath,
    args: ["--max-old-space-size=6144", "tests/run.js"],
    env: { FULL_SCAN: QUICK ? "" : "1", NODE_V8_COVERAGE: COV_DIR } },
  { name: "死循环看门狗", cmd: process.execPath, args: ["tests/hang-guard.js", "8000"] },
  /* v2.8.16（审计 P2-1）：--reuse 复用第 16 步的落盘，跳过 check-coverage 内部的重跑（去重的另一半） */
  { name: "行覆盖率", cmd: process.execPath,
    args: ["tools/check-coverage.js", "--reuse=" + COV_DIR].concat(QUICK ? [] : ["--full"]),
    warnScan: /^\s*⚠\s*(从未执行的函数|增量覆盖率)/,
    observe: { until: "2026-11-06", why: "48 个未执行函数里绝大多数是桩不可达的防御分支；先观察是否稳定" } },
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
  /* warnScan（v3.31.x，落地审计 E2）：观察期步骤（如 CSS 孤儿扫描）exit 0 不判红，
     但其 stdout 里的 ⚠ 行被捕获：原文照常回显，条数记进 step 结果、单列进汇总——
     「打 ⚠ 不判红」不再等于「总览里看不见」。 */
  const stdio = step.warnScan ? ["inherit", "pipe", "inherit"] : "inherit";
  const spawnOnce = () => spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    stdio,
    env: Object.assign({}, process.env, step.env || {}),
  });
  let r = spawnOnce();
  if (step.warnScan && r.stdout){
    process.stdout.write(r.stdout);
    const warnCount = String(r.stdout).split("\n").filter(l => step.warnScan.test(l)).length;
    r = Object.assign({}, r, { warnCount });
  }
  const ms = Date.now() - started;
  /* ---- 工具故障 ≠ 检查失败（v2.8.6，审计 §E2/§E5）----
     spawnSync **失败**时 `r.status === null` 且 `r.error` 有值。此前这里只看 `r.status === 0`，
     于是"工具压根没起来"被打印成「✗ 「行覆盖率」未通过（退出码 null）」——把工具故障说成
     被检项失败，把人送去查一个不存在的错误。本机沙箱实测**完整误导过一轮**：当时仓库
     13 项全部健康（手工补跑得覆盖率 99.4%、测试 2412 PASS / tsc 退出 0），
     汇总却是"1 项失败 · 实跑 10/12"，而且失败原因是"类型检查未通过"。
     这是 §E2 同一哲学的延伸：过去是"不让 ⊘ 伪装成 ✓"，现在是"不让故障伪装成失败"。 */
  if (r.error || r.status === TOOL_FAIL_CODE){
    /* v2.42.3（审计第一批 · flake 自愈第二层）：带 faultRetry 的步骤在工具故障时
       自动重跑一次——传输层抖动是环境性的、与被检代码无关（smoke 内部已自带
       一次重测，这里是第二层）；重跑后成功/环境跳过就照常记账，**两次都**故障
       才记 ⚠（--strict-env 下仍按失败——CI 里连续四轮故障才会红，抖动事实上被吸收）。 */
    if (step.faultRetry){
      console.log("  · 工具故障，按 flake 自愈口径自动重跑一次…");
      r = spawnOnce();
      if (step.warnScan && r.stdout){
        process.stdout.write(r.stdout);
        const warnCount = String(r.stdout).split("\n").filter(l => step.warnScan.test(l)).length;
        r = Object.assign({}, r, { warnCount });
      }
      if (!(r.error || r.status === TOOL_FAIL_CODE)){
        const envSkipped2 = step.skipCode !== undefined && r.status === step.skipCode;
        if (envSkipped2) console.log("  ⊘ 跳过（" + (step.skipNote || "本机缺该项环境能力") + "）");
        results.push({ name: step.name, ok: r.status === 0, skipped: envSkipped2, env: envSkipped2,
          ms: Date.now() - started, status: r.status, warnCount: r.warnCount || 0 });
        /* v3.31.x（落地审计 E4）：重试后**真实断言失败**（exit 1）与正常路径同权——失败就停。
           此前这里无条件 continue，冒烟真实失败时最贵的三步仍会跑完、输出噪音大，
           与"失败就停"的语义不一致（正常路径 break，重试路径反而继续）。 */
        if (!envSkipped2 && r.status !== 0){
          console.log("\n  ✗ 「" + step.name + "」未通过（退出码 " + r.status + "），后续检查已跳过。");
          break;
        }
        continue;
      }
    }
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
  results.push({ name: step.name, ok: okStep, skipped: envSkipped, env: envSkipped, ms, status: r.status,
    warnCount: r.warnCount || 0 });
  if (!okStep && !envSkipped){
    /* 失败就停：后面的检查建立在"前面是对的"之上，继续跑只会刷屏 */
    console.log("\n  ✗ 「" + step.name + "」未通过（退出码 " + r.status + "），后续检查已跳过。");
    break;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
/* v3.31.6（审计①）：机器可读的自验报告（.gitignore 忽略）——「哪些步骤被验证 / 哪些 ⊘/⚠」
   从此可 diff：改完代码跑一遍，对比上一份就知道哪一步从 ✓ 变成 ⊘/⚠。 */
try{
  const ver = (/const\s+VERSION\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")) || [])[1] || "";
  fs.writeFileSync(path.join(ROOT, ".verify-report.json"), JSON.stringify({
    ts: new Date().toISOString(), version: ver, quick: !!QUICK, strictEnv: !!STRICT_ENV,
    elapsedS: +elapsed,
    steps: results.map(r => ({ name: r.name, ok: !!r.ok, skipped: !!r.skipped, env: !!r.env,
      toolError: !!r.toolError, warnCount: r.warnCount || 0, ms: r.ms })),
  }, null, 2));
}catch(e){}
/* v2.8.16（审计 P2-1）：第 16/18 步共享的覆盖率落盘目录，检查跑完后清理（无论成败） */
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
const warnCount  = results.reduce((s, r) => s + (r.warnCount || 0), 0);   // 观察期 ⚠（v3.31.x，审计 E2）
/* ★ v3.36.12（审计 C-6）：观察期项**到期**单列计数。
   为什么需要它：观察期本意是"先看一段时间再决定转正"，但"一段时间"没有机器盯着 ⇒
   警告会一直响，人会对它脱敏（审计原话：「长期不判红的警告会被习惯性忽略，最终变成噪音」）。
   现在每个观察期步骤必须登记 observe.until；到期后单列一行 ⏰，与"普通 ⚠"分开数——
   普通 ⚠ 是"还在观察中"，⏰ 是"该拍板了"。 */
const today = new Date().toISOString().slice(0, 10);
const observeSteps = STEPS.filter(s => s.observe);
const missingUntil = STEPS.filter(s => s.warnScan && !s.observe)
  .filter(s => !/过期副本检测|CSS 孤儿扫描/.test(s.name));   // 这两步的 warnScan 是"计数机制"不是"观察期"，见各自注释
const expiredObs = observeSteps.filter(s => s.observe.until && today > s.observe.until);
const parts = [];
/* 有工具故障时**不再说「全部通过」**：本次确实有 N 项没被验证，说"全部通过"就是在撒谎 */
parts.push(failed ? "✗ " + failed + " 项失败"
  : (toolErr || notRun ? "✓ " + passed + " 项通过（本次未全部验证）" : "全部通过"));
if (skippedOpt) parts.push("⊘ " + skippedOpt + " 项未执行（可选加强项，缺 node_modules）");
if (skippedEnv) parts.push("⊘ " + skippedEnv + " 项环境缺失未执行");
if (toolErr)    parts.push("⚠ " + toolErr + " 项工具故障（未被验证，不是被检项失败）");
if (warnCount)  parts.push("⚠ " + warnCount + " 条观察期警告（不判红，见对应步骤）");
if (expiredObs.length) parts.push("⏰ " + expiredObs.length + " 项观察期已到期（须转正或续期）");
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
/* v3.36.5（审计 第二部分①）：汇总补两条「开工前须知」——下一个可用用例编号、以及钩子状态。
   这两条都是多 Agent 共用工作区的**冲突高发点**（见工作区记忆「后动工一方必须现查的值」）：
   用例编号撞车会让两份克隆各写 t217、钩子没生效则 commit 不跑 check-all --quick。
   全部 try 包裹：本条纯信息，任何异常都不许拖垮上面已经跑完的自验结论。 */
try{
  const fsCases = fs.readdirSync(path.join(ROOT, "tests/cases"));
  const maxN = fsCases.reduce((m, f) => {
    const mm = /^t(\d+)-/.exec(f); return mm ? Math.max(m, +mm[1]) : m;
  }, 0);
  const hooksPath = (() => {
    const r = require("child_process").spawnSync("git", ["config", "core.hooksPath"], { cwd: ROOT, encoding: "utf8" });
    return r.status === 0 ? String(r.stdout || "").trim() : "";
  })();
  console.log("  " + "─".repeat(52));
  console.log("  下一个可用用例编号：t" + (maxN + 1) + "-（新增用例请勿撞号）");
  console.log("  钩子状态：core.hooksPath = " + (hooksPath || "（未设置 → 走默认 .git/hooks，本地提交不会自动跑闸门）"));
  /* v3.36.12（审计 C-11）：单文件写锁状态。它是"现在有没有人在写 index.html"的唯一可查出口——
     本仓最危险的失败（两个会话同时改、后写的静默覆盖）没有任何机器会拦，只能靠这一刻的可见性。 */
  try{
    const lockRaw = fs.readFileSync(path.join(ROOT, ".write-lock.json"), "utf8");
    const lock = JSON.parse(lockRaw);
    const h = (Date.now() - Date.parse(lock.at)) / 3600000;
    console.log("  写锁：" + (lock.by || "(未署名)") + " · " + h.toFixed(1) + " 小时前"
      + (h > 8 ? " ⇒ ⚠ 已过期未释放，确认对方收工后 --force 抢锁" : " ⇒ 另一个会话可能正在写 index.html"));
  }catch(e){ console.log("  写锁：未持有（可以开工；开工前请 node tools/write-lock.js --acquire \"会话名\"）"); }
  /* ★ v3.36.12（审计 C-6）：观察期到期 / 登记不完整的**明细**。两条都放在这里（而不是汇总行里），
     因为汇总行只报数，而"哪一项到期了、该找谁拍板"必须看得见。 */
  if (expiredObs.length){
    console.log("  " + "─".repeat(52));
    console.log("  ⏰ 观察期已到期（" + today + "）：");
    expiredObs.forEach(s => console.log("      · " + s.name + " —— 到期日 " + s.observe.until
      + "（" + s.observe.why + "）⇒ 转正（改 --strict / 去掉 warnScan）或**重新登记**一个新的到期日"));
  }
}catch(e){ /* 纯信息，忽略 */ }

/* ★ v3.36.12（审计 C-6）：观察期步骤**登记不完整**判红。
   为什么要判红而不是只警告：这是"机制本身漏了一行"，补一次就完事；放它过去，
   下一个新增观察期步骤照样不写到期日，C-6 就等于没装。 */
const badObserve = missingUntil.map(s => s.name + "（有 warnScan 但没登记 observe.until/why）")
  .concat(observeSteps.filter(s => !s.observe.until).map(s => s.name + "（observe 缺 until）"));
if (badObserve.length){
  console.log("  " + "─".repeat(52));
  console.log("  ✗ 观察期登记不完整：" + badObserve.length + " 项");
  badObserve.forEach(b => console.log("      · " + b));
  console.log("  修法：在 tools/check-all.js 的 STEPS 里给该步补 observe: { until: \"YYYY-MM-DD\", why: \"…\" }"
    + "——观察期必须有尽头，否则「暂时只警告」会永久化。");
}

process.exit(failed || (toolErr && STRICT_ENV) || badObserve.length ? 1 : 0);
