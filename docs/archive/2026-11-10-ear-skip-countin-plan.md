# 听辨训练跳过预备拍 Implementation Plan

> 历史快照 · 已归档。行号与自验数字不作实时依据；修复状态以 `CHANGELOG.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让听辨训练在保留用户预备拍设置的同时，始终直接播放两遍正式答案。

**Architecture:** 给 `Controls.start()` 增加单次可选参数，仅在预备拍初始化时生效。`Ear.play()` 显式跳过，其他调用点不传参数并保持原行为。

**Tech Stack:** 原生 HTML/JavaScript、仓库测试桩与 FakeAudioContext、Node.js 反向验证、CDP 浏览器冒烟。

**Spec:** `docs/archive/2026-11-10-ear-skip-countin-design.md`

## Global Constraints

- 单文件、零运行时依赖、支持 `file://` 直开。
- 不改写用户 `countIn` 设置，不改变其他播放场景。
- 正式题目仍播放两遍，播放额度、作答与停止行为不变。
- 新行为先写失败测试，缺陷修复必须有具名反向验证。
- `index.html` 行数变化后更新模块索引；版本在 fetch 后确定；不提交、不推送。

## Review Focus

- 预备拍开启时首次出题：第一声即正式答案，见 Task 1 Step 1。
- 重听与下一题：每次都不重新插入预备拍，见 Task 1 Step 1。
- 退出听辨后的普通播放：仍按设置插入预备拍，见 Task 1 Step 1。
- 开关和拍数：整个流程不改写，见 Task 1 Step 1。
- 两遍正式答案与自动停：节奏一致且额度仍为零，见 Task 1 Step 1。

---

### Task 1: 单次跳过预备拍

**Files:**
- Modify: `index.html`（`Controls.start` 与 `Ear.play`）
- Test: `tests/cases/t49-ear-training.js`
- Create: `tools/reverse-verify-ear-skip-countin.js`
- Modify: `README.md`、`CHANGELOG.md`、`package.json`、`package-lock.json`

**Interfaces:**
- Consumes: 现有 `Controls.start()`、`S.countIn`、`playQuota`。
- Produces: `Controls.start({ skipCountIn?: boolean })`；默认与旧调用等价。

- [ ] **Step 1: 写失败测试**

在 T49 新增场景：开启 4 拍预备后，听辨首次播放、重听和下一题均无预备拍，两遍正式答案一致；退出后普通播放仍有 4 拍预备，且开关与拍数不变。

- [ ] **Step 2: 验证旧实现具名失败**

Run: `node tests/cases/t49-ear-training.js`
Expected: 新增“听辨跳过预备拍”断言 FAIL，原因是实际先播放预备拍。

- [ ] **Step 3: 实现单次选项**

`Controls.start()` 接收可选对象并只在预备拍初始化处判断 `skipCountIn`；`Ear.play()` 传入 `true`，其他调用不改。

- [ ] **Step 4: 跑定向与反向验证**

Run: `node tests/cases/t49-ear-training.js && node tests/cases/t13-timbre-and-controllers.js && node tools/reverse-verify-ear-skip-countin.js`
Expected: 定向全绿；分别撤掉 Ear 传参和 start 条件时，新增断言具名变红，2/2 命中。

- [ ] **Step 5: 版本与全量验收**

fetch 后确定下一补丁版，同步版本文件、CHANGELOG 和模块索引，重建 dist，运行 `node tools/check-all.js`。Expected: 24/24 全绿；复核工作区只含本次与上一项已确认交付，不提交、不推送。
