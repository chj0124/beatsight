# 听辨作答后重听 Implementation Plan

> 历史快照 · 已归档。行号与自验数字不作实时依据；修复状态以 `CHANGELOG.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户答对或答错后重复重听当前题，同时保留明确的下一题入口。

**Architecture:** 复用 `play()` 重播当前 `question`，原按钮在作答后改为“重听本题”；新增独立下一题按钮调用 `next()`。不增加存储或新状态。

**Tech Stack:** 原生 HTML/JavaScript、仓库测试桩、Node.js 反向验证、CDP 浏览器冒烟。

**Spec:** `docs/archive/2026-11-10-ear-replay-after-answer-design.md`

## Global Constraints

- 不改 CSS、候选结构、现有边距间距或判分数据。
- 重听不换题、不重新计分、不修改连对，播放两遍后可再次重听。
- 下一题才调用 `next()`；播放期间按钮禁用。
- 不提交、不推送；版本在 fetch 后确定。

## Review Focus

- 答对与答错后重听：当前题和战绩不变，见 Task 1 Step 1。
- 重复重听：每次都使用同一题且仍跳过预备拍，见 Task 1 Step 1。
- 下一题：只有独立按钮换题，见 Task 1 Step 1。
- 播放中与播放后：按钮禁用与恢复正确，见 Task 1 Step 1。
- 布局：现有浏览器间距断言不回归，见 Task 1 Step 5。

---

### Task 1: 作答后重听与独立下一题

**Files:**
- Modify: `index.html`（听辨按钮行、earRender、按钮监听）
- Test: `tests/cases/t49-ear-training.js`
- Create: `tools/reverse-verify-ear-replay-after-answer.js`
- Modify: `README.md`、`CHANGELOG.md`、`package.json`、`package-lock.json`

**Interfaces:**
- Consumes: 当前 `question`、`play()`、`next()`、earRender。
- Produces: `#earNextBtn`，仅在已作答时可见并调用 `next()`。

- [ ] **Step 1: 写失败测试**

新增 T49k：答对与答错后原按钮均为“重听本题”，独立下一题可见；重听签名与战绩不变，可重复重听；只有下一题换题。

- [ ] **Step 2: 验证旧实现具名失败**

Run: `node tests/cases/t49-ear-training.js`
Expected: 缺少独立下一题或原按钮直接换题导致具名失败。

- [ ] **Step 3: 实现按钮与分支**

新增 `#earNextBtn`；earRender 同步文本、hidden 和 disabled；原按钮作答后调用 `play()`，下一题按钮调用 `next()`。

- [ ] **Step 4: 定向与反向验证**

Run: `node tests/cases/t49-ear-training.js && node tools/reverse-verify-ear-replay-after-answer.js`
Expected: 定向全绿；缺少下一题按钮或重听错误调用 next 时具名变红，2/2 命中。

- [ ] **Step 5: 版本与全量验收**

同步文档、下一补丁版、CHANGELOG 与模块索引，重建 dist，运行 `node tools/check-all.js`。Expected: 24/24 全绿，间距无回归，不提交、不推送。
