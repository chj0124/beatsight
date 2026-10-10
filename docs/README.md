# docs/ 目录索引

> 活文档与历史快照的分界线：**查现状看活文档，查"当时为什么"看快照**。
> 快照里的行号 / 数字 / 排期一律不作实时依据（修复状态以 `CHANGELOG.md` 为准）。

本索引把仓库里所有文档按「是否随代码更新」分成两类，接手者先读活文档即可无缝开工，
需要回溯某次决策的来龙去脉再翻对应的快照。**所有快照物理集中在 [`archive/`](archive/)**——
docs/ 第一层只剩活文档，根目录只放对外门面与规约，一眼可辨「哪份算数」。

## 活文档（随代码更新）

| 文件 | 位置 | 内容 |
|---|---|---|
| [README.md](../README.md) | 仓库根 | 项目定位、功能现状、发布与自验入口（对外第一入口） |
| [AGENTS.md](../AGENTS.md) | 仓库根 | 开发协作约定：改动纪律、任务分流、禁区（面向 AI 编码助手） |
| [CHANGELOG.md](../CHANGELOG.md) | 仓库根 | 当前大版本线（v3.x）逐版本变更记录（根因/修法/取舍/自验） |
| [DEVELOPMENT.md](DEVELOPMENT.md) | docs/ | **架构、数据模型、自验方法**——开发交接文档，按需查节 |

## 历史快照（已归档，仅作当时记录）

以下文档全部位于 [`archive/`](archive/)，带「历史快照 · 已归档 / 已落地」横幅，
由 `tools/check-docs.js` 第 3、4 项把守其横幅存在性。
行号、覆盖率、耗时、排期均为撰写当日的快照，不作实时依据。

| 文件 | 内容 | 状态 |
|---|---|---|
| [AUDIT-2026-09-21.md](archive/AUDIT-2026-09-21.md) | 全库审计报告（基线 v2.8.9） | 历史快照 · 已归档（P0–P3 已逐条闭环） |
| [spec.md](archive/spec.md) | 全维度代码审计与迭代规划（大文件） | 历史快照 · 已归档 |
| [tasks.md](archive/tasks.md) | 审计落地任务清单 | 历史快照 · 已归档 |
| [checklist.md](archive/checklist.md) | 审计评审检查清单 | 历史快照 · 已归档 |
| [PLAN-v1.5.md](archive/PLAN-v1.5.md) | v1.5 练习闭环方案 | 已归档（P0–P3 全部落地） |
| [PLAN-v1.9.md](archive/PLAN-v1.9.md) | v1.9 扫弦方向 / 听辨训练 / 类型检查闸门方案 | 已归档（条目全部落地） |
| [PLAN-v2-arrangement.md](archive/PLAN-v2-arrangement.md) | 曲式编排探针（18 条假设盘点） | 已归档 · 历史记录 |
| [PLAN-v2-impl.md](archive/PLAN-v2-impl.md) | 曲式编排（v2.0.0）落地施工记录 | 已落地 |
| [PLAN-v3-arrange-redesign.md](archive/PLAN-v3-arrange-redesign.md) | 编排重设计（v3 线）方案 | 已落地 · 已归档（全部交付，转历史记录） |
| [PLAN-v4-arrange-ui-rework.md](archive/PLAN-v4-arrange-ui-rework.md) | 编排 UI 重做（v4 线）方案 | 已落地 · 全部闭环 |
| [PLAN-v5-lyric-align-rework.md](archive/PLAN-v5-lyric-align-rework.md) | 歌词对齐交互重设计 + 字块拖拽改进（函数级实施清单） | 已落地 · 四期完成，仅剩真机 390px 冒烟 + V9 截图复核（验收项） |
| [PLAN-v6-pat-viz.md](archive/PLAN-v6-pat-viz.md) | 歌词区节奏型可视化（甲+乙）实施方案 | 已落地（v2.80.0 交付） |
| [PLAN-v6-ux-and-viz-rework.md](archive/PLAN-v6-ux-and-viz-rework.md) | 顶栏/设置收口 · 可视化标注 · 静音拍参数化 · 段标注（2026-09-28 方案，2026-10-08 自 `trae/agent-CI9dZv` 分支取回归档） | 历史快照 · 已落地（v2.69.0–v2.74.0 分批交付） |
| [PLAN-v7-lyric-inline.md](archive/PLAN-v7-lyric-inline.md) | 歌词显示位置重设计（显示歌词开关 + 自动/伴随节奏/底部三态；伴随节奏走覆盖层+逐行 translateY，文字格内居左，退役旧浮动跟随条） | 已落地（v2.86.0 交付） |
| [PLAN-v8-melody-subdiv.md](archive/PLAN-v8-melody-subdiv.md) | 旋律谱细分级编辑（16/32 分音符）：网格 T32 + 文本 `_`/`__` 时值后缀 + 简谱正字法（八度点）显示 + 音符块交互 | 已落地（v3.38.0 交付，两批全部完成） |
| [PLAN-v9-control-core.md](archive/PLAN-v9-control-core.md) | 控制区重构 · 居中控制芯（开关胶囊化 + 参数浮层 + 滑杆 340 + 桌面/移动同构）实施方案 | 已落地（v3.40.0 交付，四批一次完成） |
| [CHANGELOG-v0.md](archive/CHANGELOG-v0.md) / [CHANGELOG-v1.md](archive/CHANGELOG-v1.md) | 旧大版本变更记录分卷 | 已归档（现行记录见根目录 CHANGELOG.md） |
| [prd.html](archive/prd.html) | 早期产品需求稿 | 历史草稿 · 已归档 |
| [beatsight-brand-board.html](archive/beatsight-brand-board.html) | 视觉系统提案展板：设计 token / 字体 / 组件 / 图标规范整理（源自 index.html 真实值） | 历史快照 · 已落地（v3.43.0 入库时逐项核对一致） |
| [beatsight-vi-manual.html](archive/beatsight-vi-manual.html) | 品牌 VI 手册：标志制图 / 字标 / 标准色 / 辅助纹样 / 应用物料（2026-10 定稿） | 历史快照 · 已落地（v3.43.0 换标按此落地） |

> 约定：新增一份文档时，**先想清楚它是活文档还是快照**——活文档进上面那张表、快照进下面那张表
> 并带上对应状态横幅，别让「哪份算数」再次变成要靠猜的事（这正是本索引要消除的盲区）。
> 快照一律落盘到 `archive/`，本层只放活文档（`tools/check-docs.js` 第 10 项白名单把守，落错位置直接红）。
