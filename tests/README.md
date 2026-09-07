# BeatSight 自动化测试

```bash
node tests/run.js
```

零依赖，任意 Node ≥ 18 可直接运行。退出码 0 = 全绿，1 = 有失败项。

## 原理

从 `index.html` 提取内联脚本，在 Node `vm` 沙箱中运行：

- **localStorage**：Map 实现，可按场景预置数据（容错 / 脏项回退 / 迁移）
- **DOM**：按 id 缓存的元素 stub；`addEventListener` 存 handler，测试用 `el.fire("change")` 触发
- **AudioContext**：伪造实现，`currentTime` 手动推进，逐 tick 驱动 `scheduler()`
- **rAF 置空**：`paintFrame` 不运行，测试只断言引擎与状态层（视觉验证仍走无头 Chrome 截图）

断言入口：脚本末尾的 `window.__beat` 调试句柄暴露全部模块接口
（Store / Modal / Viz / Audio / Trainer / Controls / Presets / Editor）。

## 覆盖场景

| 场景 | 内容 |
|---|---|
| T1 | localStorage 坏 JSON → 回退默认，不白屏 |
| T2 | trainer 配置缺项 / 脏项（含 null、布尔）→ 回退默认值 |
| T3 | 变速训练爬坡序列 70→80→90→95、到目标自动停止、完成文案（v0.5.0 核心回归） |
| T4 | 训练参数钳制：超上限、目标≤起始抬回、非数字回退原值、下限 |
| T5 | 预设导入导出：非法 JSON / 非法 tick / 小节不完整 / 未开放拍号拒绝；v1 旧格式（浮点 d）自动换算；5/7 拍接受；accents 保留；导出→导入往返 id 唯一 |
| T6 | 节奏型选择失效（custom id 不存在 / builtin idx 越界）→ 回退基础节奏 |
| T7 | 模块装配完整性：`__beat` 八个模块与关键接口存在 |
| T8 | v0.7 迁移：旧浮点 customs → tick，备份 beatsight.m2.bak，persist 写 v:3，id 引用仍命中 |
| T9 | 三连音：八分三连音 ×12 整数校验通过；残缺组（2/3）拒绝；小节和整数严格相等 |
| T10 | Swing：后半拍八分延后 (swing-50)/50×24t 精确到 1e-6 秒；下一颗按时进入；swing=50 均匀 |
| T11 | 奇数拍重拍分组：Take Five [0,3] 发音频率序列；5/4 默认 2+3、7/4 默认 3+2+2 |
| T12 | 播放中切拍号：小节边界无缝生效、播放不中断、schedStep 不越界（activePattern 快照回归） |

## 何时补断言

- 修 bug 时：先加一条能复现该 bug 的断言，再修（v0.6.0 的 trainer null 脏值、v0.7.0 的 activePattern 快照与导入 id 冲突均按此流程）
- 新功能动到 Store / Trainer / scheduler 时必须有对应断言
