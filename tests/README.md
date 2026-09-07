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
| T5 | 预设导入导出：非法 JSON / 非法时值 / 小节不完整 / 未开放拍号拒绝，合法导入 id 重生成，导出→导入往返 |
| T6 | 节奏型选择失效（custom id 不存在 / builtin idx 越界）→ 回退基础节奏 |
| T7 | 模块装配完整性：`__beat` 八个模块与关键接口存在 |

## 何时补断言

- 修 bug 时：先加一条能复现该 bug 的断言，再修（v0.6.0 的 trainer null 脏值修复即此流程）
- 新功能动到 Store / Trainer / scheduler 时必须有对应断言
- v0.7 tick 制迁移前：先补「旧浮点数据 → tick 迁移」断言再动手
