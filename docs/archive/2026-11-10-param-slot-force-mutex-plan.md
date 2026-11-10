# 参数面板强制打开互斥 Implementation Plan

> 历史快照 · 已归档。行号与自验数字不作实时依据；修复状态以 `CHANGELOG.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复窄屏下普通参数面板与强制打开的变速面板同时可见并重叠的问题。

**Architecture:** 沿用 `CoreUI` 现有 `slotDismissed` / `paramSlotForce` 状态，在所有打开入口复用同一互斥仲裁。强制状态清理与重新同步分离，避免嵌套同步；CSS 与模块结构不变。

**Tech Stack:** 原生 HTML/CSS/JavaScript、仓库零依赖测试桩、Node.js 反向验证、CDP 真实浏览器冒烟。

**Spec:** `docs/archive/2026-11-10-param-slot-force-mutex-design.md`

## Global Constraints

- `index.html` 单文件内聚，运行时零依赖，必须支持 `file://` 直开。
- 窄屏只显示最后请求的一块面板；收起面板不得关闭对应功能。
- 宽屏双面板扇开行为不变；重复点击强制面板仍可收起。
- 缺陷修复必须新增具名断言并做反向验证，变异只写系统临时目录。
- `index.html` 行数变化后执行 `node tools/gen-index.js --write`。
- 版本在 fetch 后确定；不提交、不推送，收尾工作区只保留本次交付文件。

## Review Focus

- 静音普通面板已开、变速被强制打开：只显示变速，见 Task 1 Step 1。
- 变速强制面板已开、再从开关或参数槽打开静音：只显示静音且旧提示清理，见 Task 1 Step 1。
- 空目标与 BPM 不低于目标两种拒开原因：提示语义不丢，见 Task 1 Step 1。
- 重复点击与正常双开关路径：既有开合语义不回归，见 Task 1 Step 1。
- 390px 共锚点与 1440px 扇开几何：分别零重叠、保留双开，见 Task 2 Step 1。

---

### Task 1: 强制打开与反向切换的行为修复

**Files:**
- Modify: `index.html`（`clearSlotForce` / `openParamSlot` / `dismissOtherSlot`）
- Test: `tests/cases/t231-control-core.js`
- Create: `tools/reverse-verify-param-slot-force-mutex.js`

**Interfaces:**
- Consumes: 现有 `slotDismissed`、`paramSlotForce`、`syncParamSlots()`、`setTrainerNote()`。
- Produces: 保持 `clearSlotForce()` 对外调用语义；新增一个只清理强制状态与提示、不触发同步的内部 helper，供 `dismissOtherSlot(k)` 使用。

- [ ] **Step 1: 写失败测试**

在 T231 增加窄屏组合场景：静音→空目标强制变速、静音→BPM 阻断强制变速、强制变速→开关开静音、强制变速→参数槽开静音。断言另一块隐藏、功能开关不被误关、提示按路径保留或清理，并保留重复点击收起与正常双开关回归。

- [ ] **Step 2: 验证旧实现具名失败**

Run: `node tests/cases/t231-control-core.js`
Expected: 新增“强制打开互斥”与“反向切换清理”断言 FAIL，既有断言不崩溃。

- [ ] **Step 3: 实现最小修复**

拆分强制状态清理与同步；`openParamSlot(name)` 设置 force 前调用 `dismissOtherSlot(name)`；`dismissOtherSlot(k)` 同时处理另一块的普通与强制显示状态，宽屏仍直接返回。

- [ ] **Step 4: 验证定向测试通过**

Run: `node tests/cases/t231-control-core.js && node tests/cases/t173-layout-decouple.js`
Expected: 全部 PASS。

- [ ] **Step 5: 添加并运行反向验证**

脚本分别撤掉强制入口互斥、另一块 force 清理，调用 T231 并匹配新增具名失败；锚点必须唯一，崩溃不计命中。

Run: `node tools/reverse-verify-param-slot-force-mutex.js`
Expected: 2/2 命中具名断言。

### Task 2: 真实几何、版本与全量验收

**Files:**
- Modify: `tools/smoke.js`（`slotGeomProbe` 及断言）
- Modify: `index.html`、`README.md`、`CHANGELOG.md`、`package.json`、`package-lock.json`
- Modify: `tools/gen-index.js` 生成的索引数据

**Interfaces:**
- Consumes: Task 1 的开合行为。
- Produces: 窄屏强制/普通组合的几何回归断言与一个补丁版本的完整变更记录。

- [ ] **Step 1: 扩展真实浏览器探针**

在 390px 下复现静音→强制变速及反向切换，断言可见面板数为 1、矩形重叠面积为 0；在 1440px 下复核正常双面板仍扇开且零重叠。探针结束复原开关、目标、BPM 与面板状态。

- [ ] **Step 2: 跑真实浏览器冒烟**

Run: `node tools/smoke.js`
Expected: `file://` 与 HTTP 双通道全部通过，新增几何断言有实际读数。

- [ ] **Step 3: 对齐远端并更新版本与索引**

先 `git fetch origin main`；若远端前进则先整合。以当时最新补丁版的下一版更新 `VERSION`、README 与 package 清单，执行 `npm install --package-lock-only` 和 `node tools/gen-index.js --write`，CHANGELOG 记录根因、修法、取舍与实测结果。

- [ ] **Step 4: 全量自验与交付复核**

Run: `node tools/check-all.js`
Expected: 全绿；若工具故障，明确标注且不伪报通过。随后 `git status --porcelain` 只显示本次交付文件，不提交、不推送。
