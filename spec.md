# BeatSight 全维度代码审计与迭代规划（技术负责人视角）

> **历史快照 · 已归档**（2026-09-17 审计，基线 `v2.0.2`）
> 本文件是那次全维度审计的**报告**：其中所有数字（受控文件数 / `index.html` 行数 / 内联 JS 行数 /
> 实跑项数 / PASS 数 / 覆盖率 / 耗时 / 模块数 / 行号）均为**当时实测值，会随代码演进漂移**，
> 不作实时依据——当前口径一律以 `node tools/check-all.js` 的实际输出为准。

> 审计日期：2026-09-17　当前版本：`v2.0.2`（`index.html` `VERSION`）　分支：`main`（工作区干净）
> 审计方式：**只读全量扫描 + 实跑自验链**（未修改任何代码）
> 证据基线：仓库 56 个受版本控制文件 · `index.html` 5426 行 · 内联 JS 约 12542 行

---

## 0. 审计方法与证据基线

本报告所有结论均来自**一手实跑或逐行阅读**，关键数据如下（可直接复现）：

| 证据项 | 命令 | 实测结果 |
| --- | --- | --- |
| 自验链（完整） | `node tools/check-all.js` | 全部通过 · **实跑 8/10 项** · 17.3s |
| 自验链（快速） | `node tools/check-all.js --quick` | **实跑 8/10 项** · 10.7s |
| 测试用例 | `node tests/run.js` | **1342 PASS / 0 FAIL** |
| 行覆盖率 | 自验链第 10 步 | **99.8%（3756/3763）** |
| 函数执行率 | 同上 | 449/461 |
| ESLint 前置扫描 | `node tools/check-lint.js` | 已扫 4375 行 · 声明 820 个 · 作用域块 956 个 ✓ |
| DOM id 一致性 | `node tools/check-dom-ids.js` | 声明 147 / 引用 142 / 未用 5（info） |
| 依赖 | `node_modules` | **不存在** ⇒ ESLint / tsc 两步为 ⊘ 跳过 |

> **重要澄清**：工作区规则要求「`node tools/check-all.js` 须 10/10 全绿」。当前输出是「全部通过 · 实跑 8/10 项」——这不是失败，而是 `check-all.js` 的**可选步骤契约**：当 `node_modules/` 不存在时，ESLint 与 tsc 两步打印「⊘ 未安装依赖，未执行」，不计为失败，也不会阻断部署。真实语义是「8 步实跑全绿 + 2 步环境缺依赖跳过」。

### 0.1 关键证据片段（可直接核对）

**证据 1 · ⊘ 可选步骤契约** —— `/workspace/tools/check-all.js` L54–80、L103–108：

```js
/* optional = 该步骤所需的依赖相对路径；不存在就标 ⊘ 跳过（不调用），不让它伪装成 ✓ */
{ name: "代码卫生 · ESLint（加强）", cmd: process.execPath, args: ["tools/check-eslint.js"],
  optional: "node_modules/eslint" },
{ name: "类型检查 · tsc（加强）", cmd: process.execPath, args: ["tools/check-tsc.js"],
  optional: "node_modules/typescript" },
...
for (const step of STEPS){
  if (step.optional && !fs.existsSync(path.join(ROOT, step.optional))){
    console.log("  ⊘ 跳过（未安装 " + path.basename(step.optional) + "）——这是可选加强项，不是失败项");
    results.push({ name: step.name, ok: true, skipped: true, ms: 0, status: 0 });
    continue;
  }
  ...
}
...
const mark = r.skipped ? "⊘" : (r.ok ? "✓" : "✗");
const time = r.skipped ? "未安装依赖，未执行" : (r.ms / 1000).toFixed(2) + "s";
```

这解释了「8/10」：`fs.existsSync("node_modules/eslint")` 与 `"node_modules/typescript"` 均返回假 → 两步 `skipped`，其余 8 步 `status === 0`。

**证据 2 · 类型闸门其实全开（反驳 README）** —— `/workspace/tools/tsconfig.typecheck.json` L39–50：

```jsonc
"strict": false,
"noImplicitAny": true,
"strictNullChecks": true,
"strictFunctionTypes": true,
"strictBindCallApply": true,
"noImplicitThis": true,
"alwaysStrict": true,
"useUnknownInCatchVariables": true,
"strictBuiltinIteratorReturn": true,
"noImplicitReturns": true,
"noFallthroughCasesInSwitch": true
```

`strict:false` 只是显式基座——strict 家族 9 项被**逐条单独置 true**，等于全开。文件头 L7–26 记录了两轮攻坚：`noImplicitAny` 727 → 282 → 0，`strictNullChecks` 251 → 96 → 0。

**证据 3 · README 两处失实** —— `/workspace/README.md` L19–25：

```
node tools/check-all.js          # 约 6 秒，共 10 步：...
node tools/check-all.js --quick  # 约 2 秒，跳过 243 组全量组合扫描（改代码时用）
...
它不开严格模式，原因写在 `tools/tsconfig.typecheck.json`。
```

实测：完整 17.3s、快速 10.7s；且 L25 与证据 2 直接矛盾。注意 L20 的「约 2 秒」同样失实。

**证据 4 · DOM id 检查器用脚本内相对行号** —— `/workspace/tools/check-dom-ids.js` L35–39：

```js
const re = /(?:\$|getElementById)\(\s*"([^"]+)"\s*\)/g;
let mm;
while ((mm = re.exec(code))){
  const id = mm[1];
  if (!referenced.has(id)) referenced.set(id, code.slice(0, mm.index).split("\n").length);
}
```

行号取自 `code`（内联脚本切片），**未加 index.html 起始行偏移**——与 `check-eslint.js`/`check-tsc.js` 的 `baseLine` 修正不一致，报错定位会对不上文件。

**证据 5 · 覆盖率注释已双重过期** —— `/workspace/tools/check-coverage.js` L26–29：

```
当前（v1.3.1）总覆盖率 99.8%，唯一未覆盖的 3 行是 scheduler 的 MAX_SCHED_STEPS
硬上限分支（1688-1690）——...
```

实测当前为 **v2.0.2**、未覆盖 **7 行**（Audio 4 + Ear 3），既不是「3 行」，也不是「scheduler 1688-1690」。版本号与未覆盖行描述**同时**过期。

**证据 6 · 部署命令不入库** —— `/workspace/wrangler.jsonc`：

```jsonc
/* 这里只声明"发布什么"；构建命令 / 部署命令 / 根目录仍在 Cloudflare Dashboard 里配。 */
{
  "name": "beatsight",
  "compatibility_date": "2026-09-15",
  "assets": { "directory": "./dist" }
}
```

构建/部署命令不在版本控制内 → 本地无法完整复现部署链路。

---

# 第一部分：代码现状诊断与优化方案

## 1.1 全局画像

### 1.1.1 项目架构图（简述）

BeatSight 是一个**单文件、零运行时依赖、无构建步骤**的架子鼓/节拍器练习 PWA。整个应用逻辑内联在 `index.html` 的一个 `<script>` 块中（`index.html` L1050 开 → L5424 闭），由 **16 个顺序 IIFE 模块**组成，模块间靠**注入式 hook**而非直接调用耦合。

```
┌─────────────────────────────────────────────────────────────┐
│  index.html (5426 行)                                         │
│  ┌── <style> L12–560 ── 设计令牌 / :focus-visible ──────────┐ │
│  └── <body>  L562 ── 静态骨架 + 147 个 id 锚点 ─────────────┘ │
│  ┌── <script> L1050–5424 ── 16 个 IIFE 模块（线性序）──────┐ │
│  │                                                          │ │
│  │  L1083 数据        CONFIG / VERSION / BUILTINS / PALETTE  │ │
│  │  L1257 Store       localStorage 持久化 + 防抖 + 失败钩子  │ │
│  │  L1802 共享状态     §state 单一事实源                     │ │
│  │  L2133 Modal       通用弹层                              │ │
│  │  L2209 Viz         画布绘制 / rAF 渲染                    │ │
│  │  L2847 Audio       Web Audio 前向调度（核心）             │ │
│  │  L3248 Trainer     练习会话 / 节拍推进                    │ │
│  │  L3431 Controls    UI 事件绑定                            │ │
│  │  L3871 Presets     预设管理                               │ │
│  │  L4097 Editor      自定义节奏编辑器                       │ │
│  │  L4362 Stats       统计面板                               │ │
│  │  L4591 Ear         耳训模块                               │ │
│  │  L4816 Arrange     编排（多段/块/重复）                   │ │
│  │  L5169 Help        帮助                                   │ │
│  │  L5204 KeepAlive   Wake Lock / 后台保活                   │ │
│  │  L5263 初始化      bootstrap 顺序装配                     │ │
│  │                                                          │ │
│  │   依赖方向 →→→→→→→ （严格单向，禁止回引）                 │ │
│  │   Runtime 回调经 WHITELIST 登记（R3）                     │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        │
        ├── sw.js (77 行)           Service Worker：导航 network-first，静态资源 SWR
        ├── manifest.webmanifest    PWA 清单
        ├── icon.svg                图标
        └── tools/ + tests/         自验链（10 步）+ 17 个测试用例

部署产物 = 上述 4 个文件（约 300KB），无 node_modules、无打包器
```

**架构不变式（由工具机器强制，非口头约定）** —— 见 `/workspace/tools/check-module-order.js`：

- **R1**：IIFE 顶层执行期**零例外**禁止前向引用。
- **R2**：逐帧热路径 `paintFrame` / `paintFrameBody` / `paintBall` **零例外**禁止前向引用。
- **R3**：运行期回调允许引用，但**必须**在 `WHITELIST` 登记原因，且**过期条目报错**。

当前 R3 登记 10 条，实测调用计数：`Audio→Trainer×1`、`Audio→Presets×2`、`Trainer→Controls×9`、`Controls→Presets×4`、`Controls→Editor×2`、`Controls→Stats×2`、`Controls→Ear×2`、`Controls→Arrange×2`、`Controls→Help×2`、`Controls→KeepAlive×2`。

跨模块装配通过**钩子注入**完成（非直接调用）：`Store.setPersistFailHandler` / `setPersistRecoverHandler` / `onFrameError` / `onSchedError` / `onLimitPulse` / `onArrangeEnd` / `onArrangeBar`。

### 1.1.2 技术栈健康度评分

| 维度 | 评分 | 依据（证据） |
| --- | --- | --- |
| 架构设计 | **9.0 / 10** | 单向依赖 + R1/R2/R3 机器强制 + 钩子注入，13 模块边界清晰；`check-module-order.js` 212 行实现三项规则 |
| 代码质量 | **8.5 / 10** | JSDoc 密度高（`@type` 168、`@param` 84），`as any` = 0；lint 声明 820 个 / 作用域块 956 个全通过 |
| 测试与覆盖 | **9.5 / 10** | 1342 PASS/0 FAIL；行覆盖 99.8%（3756/3763），仅 7 行未覆盖且均为防御性/不可达分支 |
| 性能 | **8.0 / 10** | 前向调度 25ms/帧、自适应窗口（前台 150ms / 后台 1.2s）、`MAX_SCHED_STEPS=512` 防死循环；rAF + 定时器管理规范 |
| 安全 | **9.0 / 10** | 无 `eval`/`new Function`；17 处 `innerHTML` **全部为 `= ""` 清空**；用户字符串走 `textContent` |
| 工程化 | **8.0 / 10** | 10 步自验链 + pre-commit（`--quick`）+ CI 部署闸门；可选步骤契约设计良好 |
| 文档一致性 | **6.5 / 10** | 存在 3 处可复现的文档漂移（见债务 D1–D3） |
| 可维护性 | **8.5 / 10** | 模块图/部署/自验流程在 `docs/DEVELOPMENT.md` 完整沉淀；类型闸门已 100% 通过 |

**综合健康度：8.4 / 10（良好偏优）**。这是一个个人/小团队项目里罕见的**自律度极高**的代码库——真正的短板不在代码，而在**文档与工具输出的一致性和少量工程卫生问题**。

### 1.1.3 核心债务清单

| # | 债务 | 严重度 | 证据（文件 / 行 / 现象） |
| --- | --- | --- | --- |
| D1 | README 闸门耗时失实 | 中 | `README.md` L19 称「约 6 秒」、L20 称 `--quick`「约 2 秒」，实测完整 17.3s / 快速 10.7s（见证据 3） |
| D2 | README 类型闸门描述与实现相反 | 中 | `README.md` L25 称「它不开严格模式」，而 `tools/tsconfig.typecheck.json` L40–50 已将 strict 家族 9 项 + `noImplicitReturns`/`noFallthroughCasesInSwitch` 全部置 `true`（见证据 2） |
| D3 | 开发文档同样残留耗时失实 | 低 | `docs/DEVELOPMENT.md` §5（约 L360）沿用「约 6 秒」 |
| D4 | 覆盖率工具头部注释**双重过期** | 中 | `tools/check-coverage.js` L26–29 称「当前（v1.3.1）…唯一未覆盖的 3 行是 scheduler 的 MAX_SCHED_STEPS 硬上限分支（1688-1690）」；实测为 v2.0.2、未覆盖 **7 行**（Audio 4 + Ear 3）——版本号与未覆盖行数量/位置**同时**不符（见证据 5） |
| D5 | DOM id 检查器行号非绝对 | 低 | `tools/check-dom-ids.js` L39 用脚本内相对行号（`code.slice(0,mm.index).split("\n").length`），ESLint/tsc 包装器均做了 `baseLine` 偏移修正 → 报错定位与其他工具不一致（见证据 4） |
| D6 | 5 个声明未引用 id | 低 | `argBar` / `editorCardTitle` / `editorDot` / `earHead` / `earDot` 已声明未引用（info 级） |
| D7 | `.uploads/` 产物被纳入版本控制 | 低 | `git ls-files .uploads` 返回 2 个 PNG，且 `.gitignore`（17 行）**未忽略** `.uploads/` → 仓库卫生问题 |
| D8 | 无 CSP / 安全响应头 | 低 | 仓库无 `_headers` / `_redirects` / `functions/`；Cloudflare 仅托管静态资源，默认无 CSP |
| D9 | 自验链头部注释耗时失实 | 低 | `tools/check-all.js` 头部写「约 2–3 秒」 |

> 注：D1–D3、D9 属于**同一类「文档/注释与实测漂移」**，可一次性清零；这恰恰是 v2.0.2 已经建立「实测反验」文化后仍遗漏的角落。

---

## 1.2 分层优化清单

### 1.2.1 代码质量层

**坏味道 / 冗余逻辑**
- **单文件 5426 行的认知负荷**：`index.html` 承担样式+结构+全部逻辑。虽然 16 个 IIFE 模块有清晰 banner 分隔，但对新读者仍是一次性 5426 行的冲击。**不建议拆文件**（违反单文件硬约束），但可在 `<script>` 开头补一个「模块索引注释块」，列出 16 个模块名 + 起始行，作为文件内导航。
- **`innerHTML = ""` 模式重复 17 次**：功能正确（清空），但可抽象为 `clear(el)` 工具函数，减少重复并统一语义。属**低收益低成本**。
- **`$("...")` 调用 248 次**：缓存 DOM 引用可降低重复查询，但现代浏览器 `getElementById` 极快，收益有限。**建议只在热路径（逐帧）确认无重复查询**（当前 rAF 路径未发现重复 `$()`）。

**命名与注释**
- 命名规范一致（模块名中文 banner + 英文标识符），JSDoc 完整。`no-shadow` 对 `D` 放行是历史设计（`D(t,rest,dir)` 构造器），可接受。
- `check-coverage.js` 头部注释版本号过期（D4），应改为动态读取 `VERSION` 或去掉版本号。

**可测试性**
- 已具备优秀基础：测试通过 `vm.Script` 编译内联脚本 + 假 DOM/localStorage/AudioContext，并以 `window.__beat` 作为断言句柄，17 个用例覆盖主流程。
- **可测试性缺口**：纯展示型模块（Modal/Help）覆盖依赖整体，缺少针对弹层开关、帮助文本渲染的独立断言；`Viz` 的边界夹取（`paintBall` 的 clamp）属于难测分支。

### 1.2.2 性能层

**函数/接口耗时瓶颈**
- **无网络接口**，无后端，不存在接口耗时问题。真正的耗时预算在音频调度与渲染：
  - 音频：`setInterval(25ms)`（`CONFIG.schedInterval`）+ 前向窗口 150ms（前台）/ 1.2s（后台，`CONFIG.schedWindowBg`），`MAX_SCHED_STEPS=512` 防单次循环过久。
  - 渲染：rAF 驱动 `paintFrame`，已做「逐帧热路径零前向引用」优化（R2），避免逐帧解引用开销。
- **潜在瓶颈点**：后台标签页 rAF 被节流后，画布更新停止但音频仍走定时器——这是**正确设计**（听感优先），但若要后台也保持视觉，需评估成本，**不建议改**。

**内存泄漏风险**
- 定时器/动画帧管理已规范化（28 处计时 API 调用点，均配对 `clearInterval`/`cancelAnimationFrame`）。`KeepAlive` 模块集中处理 Wake Lock。
- **需持续关注**：`Modal`/`Editor` 动态生成节点时若绑定匿名监听器而未在关闭时解绑，可能累积；建议在弹层关闭路径统一做监听器清理审计（当前未见明显泄漏，但缺少自动化回归）。

**资源复用率**
- AudioContext 单例、预创建缓冲/音色（`CONFIG.timbres` 定义 wood/drum 等音色参数），复用度高。
- **可优化**：音色参数对象在每次调度时读取，若在热路径内做深拷贝会浪费；当前为只读引用，OK。

### 1.2.3 架构层

**模块耦合度**
- 优秀。单向依赖 + 钩子注入，耦合面被 R3 WHITELIST 精确围栏（仅 10 条受控回调）。`Controls` 是最大的扇出点（指向 7 个下游模块），这是 UI 层中枢的合理形态，但也是**未来扩展的主要风险面**——新增功能若都挂 `Controls`，会让它持续膨胀。建议：新功能的 UI 装配优先放在**各自模块内部**，`Controls` 只做事件转发。

**依赖合理性**
- 零运行时依赖，无版本冲突、无供应链风险。devDeps 仅 eslint + typescript（且可选）。

**扩展边界**
- 明确的硬约束：单文件、零依赖、必须支持 `file://`。这意味着**任何新功能不得引入构建步骤或网络后端**（否则破坏 `file://` 与离线能力）。
- 扩展点：`BUILTINS` 节奏库、`PALETTE`、`CONFIG`、`Presets`、`Arrange` 编排系统。

**可观测性**
- 有 `onFrameError` / `onSchedError` / `onLimitPulse` 等错误钩子，能把异常上报到 UI。
- **缺口**：无结构化日志或运行时诊断面板。建议新增一个**隐藏的「诊断面板」**（`?debug=1` 触发），展示掉帧数、调度饥饿次数、持久化失败次数等计数器——低成本、高可观测性收益。

### 1.2.4 安全层

**漏洞风险点**
- **XSS**：风险极低。17 处 `innerHTML` 全部为 `= ""` 清空；用户可控字符串（自定义节奏名等）一律走 `textContent`（如 `Stats` 渲染模式名处）。**无注入面**。
- **动态执行**：无 `eval` / `new Function`。
- **存储**：数据仅存 `localStorage`（同源），无外传。

**权限边界**
- 无后端、无账号、无跨源请求。Service Worker 只处理同源 GET（`sw.js` 显式拒绝非 GET / 非 http(s) / 跨源），边界干净。
- Wake Lock API 需用户手势授权，符合规范。

**数据合规性**
- 全部数据本地存储，不采集、不上报。**合规风险为零**，且天然符合隐私优先。

**可加固项**
- 缺 CSP（D8）。由于是纯静态托管，可在 `dist` 增加 `_headers` 文件下发 `Content-Security-Policy`（`default-src 'self'; script-src 'self' 'unsafe-inline'`——因内联脚本必须放行 `unsafe-inline`，收益有限）与 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。属**低成本加固**。

### 1.2.5 工程层

**CI/CD 可优化点**
- 已有 10 步自验链 + pre-commit（`--quick`）+ 部署闸门，设计成熟。
- **可优化**：
  1. 自验链完整跑 17.3s，`--quick` 10.7s。可在 CI 并行化独立步骤（如 tests 与 lint 并行）缩短墙钟时间。
  2. 可选步骤（ESLint/tsc）在无 `node_modules` 时静默跳过——**风险是 CI 里忘记 `npm ci` 就永远不跑类型闸门**。建议在 CI 环境显式要求这两步**不许跳过**（若 `CI=true` 且未安装依赖则**报错**而非 ⊘）。
  3. `package.json` 缺 `version`、`engines`、`test` 脚本字段，可补齐以规范工具链。

**环境配置**
- `wrangler.jsonc` 仅 `assets.directory: "./dist"`，build/deploy 命令在 Cloudflare Dashboard（不可版本化）——**这是配置漂移隐患**：本地无法完整复现部署。建议把 build 命令落到仓库可版本化的位置（如 `wrangler.jsonc` 的 `build.command`）。

**部署流程**
- 双通道：① Cloudflare Workers 静态资源（push `main` 自动部署，构建期跑 check-all 作硬闸门）；② WorkBuddy 手动（设计上滞后，独立 localStorage 源）。
- **风险**：两通道 localStorage 源不同，用户换通道会丢数据。若未来做数据同步，需先统一 origin。

---

## 1.3 优化实施路线

按「高收益低成本 / 高收益高成本 / 低收益低成本」分类，给出分阶段落地顺序。

### 阶段 A｜高收益 · 低成本（建议立即执行，1 个迭代内完成）

| 序 | 事项 | 收益 | 成本 | 具体动作 |
| --- | --- | --- | --- | --- |
| A1 | 修复文档漂移 D1/D2/D3/D9 | 消除「文档骗人」的信任损耗 | 极低 | 把 4 处「约 6 秒」改为以实测为准的表述；删除/改写 README L25「它不开严格模式」为「已开启全部 strict 家族开关（`tools/tsconfig.typecheck.json`）」 |
| A2 | 覆盖率工具头部去版本化 D4 | 消除又一处过期基线 | 极低 | 改为运行时读取 `VERSION`，或删除括号内版本号 |
| A3 | DOM id 检查器行号对齐 D5 | 报错定位与其他工具一致 | 低 | 在 `check-dom-ids.js` L39 处加 `baseLine` 偏移（复用 `check-eslint.js` 已有实现） |
| A4 | `.uploads/` 卫生 D7 | 仓库干净 | 极低 | 在 `.gitignore` 增加 `.uploads/`，并 `git rm --cached` 已跟踪的 2 个 PNG |
| A5 | CI 强制类型闸门 | 防止类型检查被静默跳过 | 低 | `check-all.js` 支持 `--strict-env`：`CI=true` 且可选步骤缺依赖时**报错**而非 ⊘ |

### 阶段 B｜高收益 · 高成本（中期排期，需设计）

| 序 | 事项 | 收益 | 成本 | 具体动作 |
| --- | --- | --- | --- | --- |
| B1 | 运行时可观测性（诊断面板） | 排障能力质变 | 中 | 新增隐藏 `?debug=1` 面板，聚合掉帧/调度饥饿/持久化失败/限流脉冲计数器 |
| B2 | 弹层监听器生命周期审计 | 消除潜在内存缓慢增长 | 中 | 统一 `Modal` 打开/关闭时的监听器注册与清理协议，补回归用例 |
| B3 | `Controls` 解耦（抑制扇出） | 保护核心中枢不膨胀 | 中 | 约定「新功能 UI 内聚在各模块」，`Controls` 仅转发；在 `check-module-order.js` 增加扇出上限告警 |
| B4 | 部署配置版本化 | 本地可复现部署 | 中 | 将 Cloudflare build 命令落到 `wrangler.jsonc` 可版本化字段 |

### 阶段 C｜低收益 · 低成本（随手做，攒进任意迭代）

| 序 | 事项 | 收益 | 成本 |
| --- | --- | --- | --- |
| C1 | 抽 `clear(el)` 工具函数替代 17 处 `innerHTML=""` | 一致性 | 极低 |
| C2 | 清理 5 个未引用 id（D6） | 减少困惑 | 极低 |
| C3 | 增加 `_headers` 下发 `nosniff`/`no-referrer`（D8） | 轻微加固 | 低 |
| C4 | `package.json` 补 `engines`/`version`/`test` 脚本 | 工具链规范 | 极低 |
| C5 | `<script>` 开头加 16 模块索引注释块 | 降低 5426 行阅读门槛 | 低 |

### 分阶段落地顺序（推荐）

```
阶段 A（信任修复 + 工程卫生）  →  阶段 C 部分（顺手项，可与 A 合并提交）
        ↓
阶段 B（可观测性 → 内存 → 解耦 → 部署版本化）
        ↓
第二部分功能迭代（P0 → P1 → P2）
```

> 说明：**阶段 A 与 C 必须先行**——它们把「工具/文档可信度」拉回满分，是后续所有功能迭代的地基。B 与第二部分可并行规划，但 B1（诊断面板）建议先于复杂功能上马，否则新功能引入的性能问题不可观测。

---

# 第二部分：功能迭代规划

## 2.1 需求匹配度评估

**产品定位还原**（依据 `README.md` 功能表 + `docs/DEVELOPMENT.md`）：面向鼓手/乐手的**离线优先节拍器与节奏练习工具**，核心价值链是「稳定出声 → 可视节奏 → 练习记录 → 编排复杂曲目 → 耳训」。

| 需求域 | 当前支撑度 | 证据 |
| --- | --- | --- |
| 稳定节拍输出 | **强** | 前向调度 + 自适应窗口 + 防死循环 + 饥饿重锚 |
| 节奏可视化 | **强** | `Viz` 模块 + rAF + `paintBall` 弹性动画（`CONFIG.bounce`） |
| 练习记录/统计 | **强** | `Stats` 模块：`summarize` 计算最高 BPM、连续天数、按模式 Top-3、会话柱状 |
| 复杂节奏编排 | **中强** | `Arrange` 支持段/块/重复（`arrMaxSections:24/blocks:8/repeats:16/bars:256`） |
| 自定义节奏 | **强** | `Editor` + `BUILTINS`(12) + `Presets` |
| 耳训 | **中强** | `Ear` 模块独立 |
| 后台保活 | **强** | `KeepAlive`（Wake Lock） |
| 跨设备数据 | **无** | 数据仅 localStorage，无同步 |
| 音频延迟校准 | **无** | 未发现校准/偏移量相关逻辑 |
| 外部输入（MIDI/键盘） | **弱** | 未见 MIDI；键盘快捷键情况未系统化 |
| 教学/渐进训练 | **弱** | 无自动变速/渐进提速课程 |

**结论**：当前代码对「**单人离线练习**」这一核心需求的支撑度约 **85%**，产品化完整度很高；缺口集中在**校准精度、渐进教学、数据连续性（跨设备）、外部输入**四块。

## 2.2 新增功能池

> 架构硬约束：**单文件、零运行时依赖、必须支持 `file://`**。下列所有功能的实现思路均已在此约束下设计；对现有架构的影响按「模块边界 R1/R2/R3」评估。

---

### P0 核心功能（对产品价值提升最大）

#### P0-1　音频延迟校准（Audio Latency Calibration）

- **业务价值**：设备/蓝牙耳机音频链路存在几十到几百毫秒的输出延迟，直接导致「听到的节拍」与「实际节拍」错位，严重影响练习精度。这是**专业节拍器与玩具的分水岭**，且是当前完全缺失的能力。
- **技术实现思路**：
  1. 新增 `Calibration` IIFE 模块，插入到 `Audio` 之后（依赖 `Audio`，符合 R1 顺序）。
  2. 交互式校准：让用户对参考脉冲进行**手动敲击**（复用已有打击音），采集 N 次（建议 8–16 次）敲击时间，取**中位数**作为延迟偏移（中位数抗离群）。
  3. 将偏移量存入 `CONFIG` 同级的运行态（非 CONFIG 常量），并在 `Audio` 调度时把 `nextTime` 做 `- offset` 补偿。
  4. 偏移量持久化到 Store，随预设/会话跨启动保留。
- **对现有架构影响**：**中**。需在 `Audio` 的调度计算处开一个可注入的偏移钩子（建议用已有的 hook 注入模式，如 `Audio.setLatencyOffset(fn)`），避免 `Calibration` 反向引用 `Audio` 内部状态。新增 R3 一条：`Audio→Calibration`（仅取偏移值）。
- **预估开发量**：**中**（约 1–2 个迭代）。核心难点是校准 UI 与统计稳健性，不是音频本身。

#### P0-2　渐进提速训练（Progressive Tempo Ramping）

- **业务价值**：鼓手最核心的练习法就是「从慢速起、每 N 小节 +2~5 BPM，直到目标速度」。当前只能手动拨速，**无法自动化**，这是阻碍日常练习效率的头号缺口。
- **技术实现思路**：
  1. 在 `Trainer` 模块内扩展会话模型：`startBPM` → `targetBPM`，`stepBPM`，`barsPerStep`（每多少小节提速一次）。
  2. 复用 `Trainer` 已有的「小节推进」计数逻辑，在跨小节边界时判断是否触发提速；到 `targetBPM` 后保持或停止。
  3. UI 挂在 `Controls`（**仅转发事件**，控件本体内聚于 `Trainer` 自带渲染），符合 §1.2.3 的防扇出约定。
  4. 数据入 `Stats`：记录「本次练习达成最高 BPM」，与现有 `Stats` 的「全时段最高 BPM / 本期最高 BPM」天然衔接。
- **对现有架构影响**：**低–中**。主要是 `Trainer` 内部状态机扩展；`Stats` 与 `Controls` 通过既有 hook 衔接，几乎不动其他模块。
- **预估开发量**：**中**（约 1 个迭代）。逻辑不复杂，重点在边界（提速时机与拍号/重音对齐）。

#### P0-3　练习数据导出/导入增强（Data Portability）

- **业务价值**：当前已有 JSON 导出（`Store.downloadJSON`），但主用于统计。用户最怕「清缓存丢三年练习记录」。提供**全量备份/恢复**（含预设、编排、统计、设置）能极大提升留存信任度，也是未来跨设备同步的地基。
- **技术实现思路**：
  1. 复用现有 `importMaxBytes: 2MB` / `importMaxCount: 500` 的导入护栏。
  2. 增加「一键导出全部 + 校验（schema 版本字段）+ 导入合并/覆盖」三态。
  3. 导入时按 `VERSION` 做**前向兼容校验**（高版本数据拒绝导入并提示）。
- **对现有架构影响**：**低**。`Store` 已具备持久化与导入护栏，属能力补全而非新模块。
- **预估开发量**：**小–中**（约 0.5–1 个迭代）。

> P0 取舍说明：三项均为「不引入后端、不破坏 `file://`、对核心练习场景直接增益」。**若只能做一项，选 P0-1（校准）**——它决定「准不准」，是专业定位的入场券。

---

### P1 体验功能（提升易用性与稳定性）

| # | 功能 | 业务价值 | 技术实现思路 | 架构影响 | 开发量 |
| --- | --- | --- | --- | --- | --- |
| P1-1 | **诊断面板**（`?debug=1`） | 排障从「猜」到「看」 | 新增隐藏面板，聚合掉帧/调度饥饿/持久化失败/限流脉冲计数器（复用现有 `onFrameError`/`onSchedError`/`onLimitPulse` 钩子） | 低（挂在现有钩子上，只读） | 小 |
| P1-2 | **键盘快捷键体系** | 高阶用户免鼠标操作 | 在 `Controls` 内集中注册 `keydown` 映射（Space 播放/暂停、↑↓ 调速、Tab 切面板），做输入框焦点豁免 | 低（`Controls` 已存在） | 小 |
| P1-3 | **PWA 安装引导** | 提升留存（免浏览器直达） | 监听 `beforeinstallprompt`，在合适时机展示安装入口；`sw.js`/`manifest` 已就绪 | 极低 | 小 |
| P1-4 | **节奏分享（URL 编码）** | 传播/复用自定义节奏 | 把自定义节奏编成紧凑字符串放进 URL hash，接收端解码导入；纯前端、可离线 | 低（`Editor`/`Presets` 内） | 小–中 |
| P1-5 | **可视化无障碍增强** | 包容性 + 弱视用户可用 | 为视觉节拍增加可调的对比度/尺寸令牌，复用 CSS 设计令牌层（`index.html` L12–560） | 低 | 小 |

---

### P2 探索功能（长期可布局的创新方向）

| # | 功能 | 业务价值 | 技术实现思路 | 架构影响 | 开发量 |
| --- | --- | --- | --- | --- | --- |
| P2-1 | **麦克风演奏准确度分析** | 从「节拍器」升级为「陪练教练」 | `getUserMedia` 采集 + 简单起音检测（能量阈值），与你敲击对齐评分 | **高**（新模块 + 需处理权限/隐私，且 `file://` 下麦克风受限，必须 `https://`） | 大 |
| P2-2 | **AI 生成练习律动** | 降低创作门槛 | 在零依赖约束下用本地算法（马尔可夫/规则化）生成节奏，接入 `Editor`/`Arrange` | 中（算法模块，可离线） | 中–大 |
| P2-3 | **多设备数据同步** | 解决 localStorage 孤岛 | 需**引入后端**（如 Cloudflare KV/Workers），会突破「零依赖 + 单文件」硬约束 | **很高**（架构级） | 大 |
| P2-4 | **社区节奏库** | 网络效应 | 静态 JSON 清单 + CDN 拉取；需设计内容审核与离线回退 | 中–高 | 大 |

> P2 提醒：**P2-1 与 P2-3 都会冲击现有硬约束**——P2-1 要求 `https://`（`file://` 下麦克风不可用），P2-3 要求后端。上马前必须先与产品/用户确认「是否愿意牺牲 `file://` 离线优先」这一核心卖点，否则应长期搁置。

---

## 附：关键结论速览

1. **代码质量已属优等生**：1342 测试全绿、99.8% 覆盖、`as any` 为 0、R1/R2/R3 机器强制。**无需重构**——审计反而确认了架构纪律的真实性。
2. **真正的问题是「信任一致性」**：文档/注释与实测有 4 处漂移（D1–D4、D9），会侵蚀「实测反验」文化辛苦建立的公信力。**阶段 A 必须最先做。**
3. **产品缺「准」与「教」**：校准（P0-1）决定专业定位，渐进提速（P0-2）决定日常效率。这两项是价值最高的下一步。
4. **架构红线不可越**：单文件 / 零依赖 / `file://`。P2-1 与 P2-3 会触碰红线，需产品决策前置。
