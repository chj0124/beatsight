# AGENTS.md — BeatSight 开发协作约定

> 本文件面向 AI 编码助手（Kimi Code / Copilot / 其他 agent）。在动手改代码之前，先读完本文件；与本文冲突时以本文为准，本文未覆盖的以 `spec.md` / `docs/DEVELOPMENT.md` 为准。

## 0. 一句话项目画像

BeatSight 是吉他练习用的时值可视化节拍器：**单文件、零运行时依赖、双击即用的网页应用**（`index.html` ~626 KB 内聚全部逻辑，14 个 IIFE 模块：Store → Modal → Viz → AudioEngine → Trainer → Controls → Tracks → Presets → Editor → Stats → Ear → Arrange → Help → KeepAlive，权威清单见 `tools/check-module-order.js` 的 `EXPECTED_ORDER`）。红线只有一条——**运行时零依赖**：`index.html` 必须能 `file://` 直开，任何引入外部运行时依赖的改动都不可接受（devDependencies 里的 eslint / typescript / wrangler 只服务自验与部署，不进产物）。

## 1. 动手前必读（按顺序）

1. `README.md` —— 功能现状、发布渠道、快速自验入口
2. `docs/DEVELOPMENT.md` —— 架构、数据模型、自验方法（交接文档，102 KB，按需查节）
3. `CHANGELOG.md` 最近 3–5 条 —— 当前演进方向与最近修过什么
4. `tasks.md` —— 历史审计清单（已完成项标 `[x]`；注意其头部声明：行号/耗时是历史快照，不作实时依据）
5. `spec.md` —— 全维度审计与迭代规划（大文件，按需查节）

**不要凭训练记忆描述项目状态**；版本号、测试数、覆盖率一律以 `node tools/check-all.js` 的实际输出为准。

## 2. 改动纪律（硬性）

- **任何代码改动后**：`node tools/check-all.js` 必须全绿（`--quick` 可用于迭代中，提交前必须全量）。跑不动的步骤按仓库惯例标「工具故障 ⚠」并说明原因，**绝不报假绿**。
- **动了 `index.html` 的模块结构**（新增/移动模块、新增跨模块回调）：`tools/check-module-order.js` 的 R1–R4 必须全绿；新回调须在 WHITELIST 登记原因，扇出超限须显式抬高 `MAX_FANOUT` 并写明理由。
- **功能变更必须带测试**：`tests/` 增补用例（沿用现有命名风格，如 `t80-countin-arrange-no-reenter`）；缺陷修复类须做**反向验证**——回退修复后目标断言应变红。行覆盖率分节不低于 90%、总体不低于 97%。
- **发版必 bump 版本号，工程版也不例外**：`index.html` 的 `const VERSION` 是唯一真相源，`package.json` / `package-lock.json`（`npm install --package-lock-only` 同步）/ `CHANGELOG.md` 首条 `## vX.Y.Z` 由 `check-version.js` 强制一致。
- **能现算的数字不写进文档**：耗时、测试数、覆盖率等以命令输出为准，不要手抄进 README / docs（`check-docs.js` 会强制）。

## 3. 提交与推送

- **默认不 push、不建分支、不开 PR**（仓库既定工作流是直提 `main` 由本人执行）；改动留在本地，向本人报告后由其决定提交时机。
- 如被要求代为提交：commit message 按仓库风格写——根因 → 修法 → 取舍（含实测代价）→ 自验数字（PASS/FAIL 数、覆盖率、冒烟断言数），中文，结构化长文。
- 仓库已接 GitHub Actions（`npm run ci`）：推 `main` 即触发 Cloudflare 自动构建部署，**任何 push 都有线上后果**，须再次确认。

## 3.5 禁区与敏感区

- `_headers`：结构受 `tools/check-headers.js` 钉死（`/*` 恰好一行、6 头齐全），改动它必须同步理解 CSP 对保活音频的影响。
- `tools/check-module-order.js` / `check-wiring.js` 等闸门本身的判定逻辑：改动属于架构级决策，先出方案再动手。
- 视觉/手感类改动：冒烟脚本看不出「好不好用」，须提醒本人人眼验收（涉及后台播放的改动还需真人实机验收）。
- 发布渠道配置（Cloudflare Dashboard 那行 `npm run ci`、WorkBuddy）在仓库外，agent 不可见也不应假设可改。

## 4. 任务分流

接到需求先归类，再按对应模式执行：

| 模式 | 动作 | 产出 |
|---|---|---|
| **诊断/审计** | 只读分析，不改代码 | 分级报告：P0 真实缺陷（静默失效/数据丢失/安全）→ P1 架构 → P2 性能 → P3 工程化；每条给文件+行号+根因+最小修复方案；不确定标「需实测」 |
| **缺陷修复** | 改代码 + 新增测试 + 反向验证 | check-all 全绿 + commit message 草稿 |
| **新功能** | 先对照 `spec.md`/`tasks.md` 查重与冲突，再给实现方案 | 同上，且涉及模块结构调整时先列 R1–R4 影响面 |
| **规划/路线图** | 只读，不改代码 | 按「用户可感知价值 / 实现成本 / 依赖关系」排序 + 每项验收标准 |

## 5. 工作区约定

- Node ≥ 22；核心闸门零安装可跑，ESLint / tsc / 浏览器冒烟为可选加强项（未装依赖标 ⊘ 是正常状态，不是失败）。
- 本机沙箱的已知限制：管道式子进程可能 EBUSY（tsc / 覆盖率跑不起来），走「工具故障」路径并按仓库惯例手工补跑说明。
