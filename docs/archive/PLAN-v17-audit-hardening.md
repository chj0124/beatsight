# 守约束审计整改 Implementation Plan

> **状态：历史快照 · 已落地**。最终落地状态与实测数字以 CHANGELOG 和命令输出为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变单文件、零运行时依赖、无构建和 `file://` 直开的前提下，修完本轮审计确认的缺陷与工程效率问题。

**Architecture:** 以现有 IIFE 模块体系为基础，新增受 R1–R4 管辖的 `CoreUI` 与 `LyricHistory`。先补会失败的测试，再做最小实现；存储模型先量化，不无依据重写。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Web Audio、Service Worker、Node.js 零依赖测试、Python 反向验证入口。

**Spec:** `docs/archive/PLAN-v17-audit-hardening-design.md`

## Global Constraints

- `index.html` 必须保持单文件、运行时零依赖、无应用构建链、`file://` 直开。
- 不新增产品功能，不改变节奏、音频、歌词、曲式和导入导出的既有语义。
- 所有缺陷修复增加测试；变异只改临时副本，必须出现具名失败。
- `index.html` 行号变化后运行 `node tools/gen-index.js --write`。
- 连续未发布工作只占一个版本号，推送前 fetch 后再定版本。

## Review Focus

- Service Worker 缓存写入 reject：响应仍可用，事件生命周期有明确结束，不产生未处理拒绝。
- 编辑器试听原地修改草稿：`hasStrum` 缓存不得返回旧结果。
- 歌词行不存在、字与谱同时为空：撤销/重做应保持删除与恢复语义。
- WorkBuddy 与 Cloudflare 部署时间不同步：默认只报告，`--require-online` 才将目标版本不一致判红。
- 缺 `gh`、浏览器或线上超时：本地开发检查与严格发布检查的结论必须可区分。

---

### Task 1: Service Worker 与 PWA 异常路径

**Files:** `sw.js`、`index.html`、`tests/cases/t67-service-worker.js`、`tests/cases/t274-async-lifecycle.js`、`tests/run.js`

**Interfaces:** 保持 `Help.refreshInstall()` 与 SW fetch 对外行为不变；T67 增加可延迟的 `cache.put` 与 `waitUntil` 记录。

- [ ] 在 T67/T274 写失败测试：导航与缓存命中静态资源均注册 `waitUntil`；写入未决时事件未结束，写入完成后才结束；拒绝不产生未处理拒绝。
- [ ] 运行定向测试，确认旧 SW 因 `waitUntilCalls=0` 出现具名失败。
- [ ] 实现写缓存 Promise 链接与 `waitUntil`，保持 network-first 和 SWR 响应顺序。
- [ ] 为 rejected `userChoice` 写按钮禁用断言，再统一 Help 安装收尾并刷新。
- [ ] 运行定向测试与 `node tools/check-all.js --quick`。

### Task 2: 反向验证入口与老化锚点

**Files:** `tools/reverse-verify.py`、`tools/reverse-verify-v3335.py`、`tools/reverse-verify-v3400.py`、`tools/reverse-verify-v3400b.py`、`tools/reverse-verify-v33315.py`、`tools/reverse-verify-entry.js`（若无现有入口测试则沿用 tools 命名）

**Interfaces:** `--only` 只接受完整脚本短名；汇总分为 clean/naked/rotten/error 四类，计数均非负。

- [ ] 写入口测试：`--only=v3400` 不匹配 v3400b；纯 rotten 不出现负数；锚点失配退出 1 也归为 rotten。
- [ ] 运行入口测试确认旧实现失败，再修匹配、分类和汇总。
- [ ] 逐个更新三个已确认老化脚本的当前锚点，保留仍有效变异；运行原脚本确认无锚点错误且有效变异仍具名变红。
- [ ] 运行 `python3 tools/reverse-verify.py --list` 与 `--prune-list` 复核。

### Task 3: CoreUI 架构收口

**Files:** `index.html`、`tools/check-module-order.js`、`tools/check-wiring.js`、`tests/cases/t275-core-ui-boundary.js`、`tests/run.js`、模块相关文档

**Interfaces:** 新增 `CoreUI`，位于 `Store` 后、`Modal` 前；对外保留现有控制芯函数与 `KEY_LAYERS` 调用语义；诊断导出通过装配钩子。

- [ ] 写边界测试：CoreUI 在权威顺序中；共享区不再直接引用 `Diagnostics`；控制芯同步、Esc、参数槽行为不变。
- [ ] 将控制芯/参数槽/键盘层代码移入 CoreUI IIFE，必要接口通过显式返回面暴露。
- [ ] 将诊断导出改由装配层注入，R3 仅保留确有运行时调用的白名单。
- [ ] 更新模块索引、EXPECTED_ORDER、测试与 DEVELOPMENT/AGENTS 模块清单。
- [ ] 运行架构、装配、定向与 quick 检查。

### Task 4: LyricHistory 职责拆分

**Files:** `index.html`、`tools/check-module-order.js`、`tests/cases/t276-lyric-history-boundary.js`、`tests/run.js`

**Interfaces:** 新增 `LyricHistory`，位于 `Ear` 后、`Arrange` 前；提供 `commit/undo/redo/snapshot`，渲染回调由 Arrange 注入。

- [ ] 用现有歌词撤销场景补边界断言：字与谱同事务、空行删除、50 步上限、redo 分叉清空。
- [ ] 抽取歌词历史状态与函数，保留 Store 写入和 AudioEngine 提示音的前向调用。
- [ ] Arrange 通过钩子刷新，不形成反向依赖；更新模块清单与文档。
- [ ] 运行歌词/编排定向测试和 quick 检查。

### Task 5: 性能证据与安全缓存

**Files:** `index.html`、`tests/cases/t277-performance-guards.js`、`tests/run.js`

**Interfaces:** `Diagnostics.coldWrite()` 返回最近、峰值与 p95；AudioEngine 对稳定快照缓存 `hasStrum`，`S.preview` 每轮重算。

- [ ] 写测试：连续冷键写入能统计峰值/p95，失败与判重跳过不污染样本。
- [ ] 写测试：同一 appliedPat 多轮调度只扫描一次，换型重算；试听原地修改时每轮重算。
- [ ] 实现最小统计与缓存，运行定向测试并记录是否仍需存储模型重构。
- [ ] 不引入 localStorage 分片或 IndexedDB，除非实测证明当前模型已超调度预算。

### Task 6: 发布、观察期、协作与文档

**Files:** `package.json`、`tools/check-all.js`、`tools/check-deploy-parity.js`、`AGENTS.md`、`README.md`、`docs/DEVELOPMENT.md`、`docs/README.md`、`tests/README.md`、相关 CI 注释与归档文档

**Interfaces:** `publish:check` 为全量严格本地发布检查；`check-deploy-parity.js --require-online` 要求两渠道与源码同版。

- [ ] 为双渠道成功、超时、版本不一致和 `--require-online` 写测试。
- [ ] 发布脚本改全量严格模式；去除长期信息读数的到期观察期配置，保留真正超期判红。
- [ ] 增加双渠道读取与显式严格线上验收，更新 pre-push/发布文档。
- [ ] 统一 AGENTS 本地工作与交接规则；归档 DEVELOPMENT 已完成路线和体积预算历史，保留当前契约并登记索引。
- [ ] 修正过期的 18 步注释、WorkBuddy 戳记描述和重复测试编号说明。

### Task 7: 版本、全量验证与推送

**Files:** `index.html`、`package.json`、`package-lock.json`、`CHANGELOG.md`、所有上述改动

- [ ] 运行 `node tools/gen-index.js --write`、相关反向验证和 `node tools/check-all.js`。
- [ ] 真实浏览器冒烟与 Git diff 审查；未实测的人眼/听感项在提交说明中如实列出。
- [ ] `git fetch origin main`，确认快进，定一个版本号并同步 VERSION/package/package-lock/CHANGELOG/README。
- [ ] 运行 `npm run publish:check`，确认 dist 同版、9 个产物、6 个安全头。
- [ ] `git status --porcelain` 复核，提交一个结构化中文 commit，直接 `git push origin main`。
- [ ] 推送后核对远端提交与线上部署读数；线上未完成的明确标注，释放写锁并确认工作区干净。
