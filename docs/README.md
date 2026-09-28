# docs/ 目录索引

> 活文档与历史快照的分界线：**查现状看活文档，查"当时为什么"看快照**。
> 快照里的行号 / 数字 / 排期一律不作实时依据（修复状态以 `CHANGELOG.md` 为准）。

本索引把仓库里所有文档按「是否随代码更新」分成两类，接手者先读活文档即可无缝开工，
需要回溯某次决策的来龙去脉再翻对应的快照。

## 活文档（随代码更新）

| 文件 | 位置 | 内容 |
|---|---|---|
| [README.md](../README.md) | 仓库根 | 项目定位、功能现状、发布与自验入口（对外第一入口） |
| [AGENTS.md](../AGENTS.md) | 仓库根 | 开发协作约定：改动纪律、任务分流、禁区（面向 AI 编码助手） |
| [CHANGELOG.md](../CHANGELOG.md) | 仓库根 | 当前大版本线（v2.x）逐版本变更记录（根因/修法/取舍/自验） |
| [DEVELOPMENT.md](DEVELOPMENT.md) | docs/ | **架构、数据模型、自验方法**——开发交接文档，按需查节 |

## 历史快照（已归档，仅作当时记录）

以下文档带「历史快照 · 已归档 / 已落地」横幅，由 `tools/check-docs.js` 第 4 项把守其横幅存在性。
行号、覆盖率、耗时、排期均为撰写当日的快照，不作实时依据。

| 文件 | 内容 | 状态 |
|---|---|---|
| [AUDIT-2026-09-21.md](AUDIT-2026-09-21.md) | 全库审计报告（基线 v2.8.9） | P0–P3 已逐条闭环 |
| [spec.md](../spec.md) | 全维度代码审计与迭代规划（大文件） | 历史快照 · 已归档 |
| [tasks.md](../tasks.md) | 审计落地任务清单 | 历史快照 · 已归档 |
| [checklist.md](../checklist.md) | 审计评审检查清单 | 历史快照 · 已归档 |
| [PLAN-v1.5.md](PLAN-v1.5.md) | v1.5 练习闭环方案 | 已归档（P0–P3 全部落地） |
| [PLAN-v1.9.md](PLAN-v1.9.md) | v1.9 扫弦方向 / 听辨训练 / 类型检查闸门方案 | 已归档（条目全部落地） |
| [PLAN-v2-arrangement.md](PLAN-v2-arrangement.md) | 曲式编排探针（18 条假设盘点） | 已归档 · 历史记录 |
| [PLAN-v2-impl.md](PLAN-v2-impl.md) | 曲式编排（v2.0.0）落地施工记录 | 已落地 |
| [PLAN-v3-arrange-redesign.md](PLAN-v3-arrange-redesign.md) | 编排重设计（v3 线）方案 | 已全部交付，转历史记录 |
| [PLAN-v4-arrange-ui-rework.md](PLAN-v4-arrange-ui-rework.md) | 编排 UI 重做（v4 线）方案 | 已全部闭环 |
| [PLAN-v5-lyric-align-rework.md](PLAN-v5-lyric-align-rework.md) | 歌词对齐交互重设计 + 字块拖拽改进（函数级实施清单） | 实施完成，仅剩真机 390px 冒烟 + V9 截图复核（验收项） |
| [CHANGELOG-v0.md](CHANGELOG-v0.md) / [CHANGELOG-v1.md](CHANGELOG-v1.md) | 旧大版本变更记录分卷 | 已归档（现行记录见根目录 CHANGELOG.md） |
| [prd.html](prd.html) | 早期产品需求稿 | 历史草稿 |

> 约定：新增一份文档时，**先想清楚它是活文档还是快照**——活文档进上面那张表、快照进下面那张表
> 并带上对应状态横幅，别让「哪份算数」再次变成要靠猜的事（这正是本索引要消除的盲区）。
