# 全拍号随机听辨题 Implementation Plan

> 历史快照 · 已归档。行号与自验数字不作实时依据；修复状态以 `CHANGELOG.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用受约束的全拍号程序化生成替代固定听辨题库，同时保持现有布局与间距完全不变。

**Architecture:** 在 `Ear` 内增加随机节奏、候选变异、签名校验与近期去重，复用现有 `question`、播放和判分接口。旧手工组只作失败兜底；不新增模块、不改 CSS 和候选 DOM。

**Tech Stack:** 原生 HTML/JavaScript、仓库测试桩与 FakeAudioContext、Node.js 属性测试与反向验证、CDP 浏览器冒烟。

**Spec:** `docs/archive/2026-11-10-ear-procedural-questions-design.md`

## Global Constraints

- 禁止修改 `<style>`、候选 DOM 结构及现有边距间距。
- 覆盖 `VALID_METER` 2/3/4/5/6/7；作答前不得用文字泄露拍号。
- 每题正式答案仍重复两遍，候选三个且答案必在其中。
- 保持单文件、零运行时依赖、预备拍跳过和既有判分行为。
- 新行为先写失败测试并做具名反向验证；版本在 fetch 后确定；不提交、不推送。

## Review Focus

- 全部六种拍号：合法总时值、重音与发声数，见 Task 1 Step 1。
- 同拍号与跨拍号题：候选差异及答案位置，见 Task 1 Step 1。
- 最近 32 题：签名不重复且生成不死循环，见 Task 1 Step 1。
- 播报与答案揭示：播放前不泄露、作答后可读拍号，见 Task 1 Step 1。
- 布局与间距：不改 CSS/DOM，现有真实浏览器几何全部保持，见 Task 2 Step 2。

---

### Task 1: 受约束生成器与出题接入

**Files:**
- Modify: `index.html`（仅 `Ear`）
- Test: `tests/cases/t49-ear-training.js`

**Interfaces:**
- Consumes: `VALID_METER`、既有 `question` / `play()` / `answer()`。
- Produces: `makeGeneratedQuestion(rand, options = {})`，返回既有题目结构；`options.meter` 和 `options.kind` 供测试固定输入。

- [ ] **Step 1: 写失败测试**

新增 T49j：每个拍号与两类题目各批量生成，断言总时值、合法 tick、至少三个非休止发声点、重音规则、三个候选唯一且答案在内；跨拍号题至少两种拍号。验证最近 32 个答案不重复、`next()` 不再固定第 0 组、播报不含拍号文字。

- [ ] **Step 2: 验证旧实现具名失败**

Run: `node tests/cases/t49-ear-training.js`
Expected: `makeGeneratedQuestion` 缺失或旧 `next()` 固定第 0 组导致具名失败，既有测试不崩溃。

- [ ] **Step 3: 实现生成与接入**

实现合法节奏组成、拍号重音、受控变异、候选与签名校验、32 题去重及有界重试；`next()` 优先使用生成器，失败才随机旧手工组。播放播报移除拍数，答案名称保留拍号。

- [ ] **Step 4: 验证定向测试通过**

Run: `node tests/cases/t49-ear-training.js && node tests/cases/t13-timbre-and-controllers.js`
Expected: 全部 PASS，既有听辨与预备拍行为不回归。

### Task 2: 反向验证、文档与全量验收

**Files:**
- Create: `tools/reverse-verify-ear-procedural-questions.js`
- Modify: `docs/DEVELOPMENT.md`、`README.md`、`CHANGELOG.md`、`package.json`、`package-lock.json`

**Interfaces:**
- Consumes: Task 1 的生成器和 `next()`。
- Produces: 对第 0 组锁定、拍号泄露和非法节奏校验的具名反向验证。

- [ ] **Step 1: 添加反向验证**

分别验证：回退到固定第 0 组、播报重新泄露拍号、破坏总时值/候选校验时，T49j 目标断言具名变红；变异只写系统临时目录。

Run: `node tools/reverse-verify-ear-procedural-questions.js`
Expected: 3/3 命中，崩溃不计证据。

- [ ] **Step 2: 全量验证布局与行为**

Run: `node tools/smoke.js`
Expected: 双通道全部通过，既有间距、候选卡与版面断言无回归。

- [ ] **Step 3: 版本与最终自验**

更新开发文档、下一补丁版、CHANGELOG 与模块索引，重建 dist，运行 `node tools/check-all.js`。Expected: 24/24 全绿；复核 diff 不含 CSS 或候选结构改动，不提交、不推送。
