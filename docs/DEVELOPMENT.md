# BeatSight 开发交接文档

> 写给下次继续开发的人（或 AI）。读完这份文档即可无缝接手，不需要重新推断项目性质。

## 1. 项目性质与硬约束

- **单文件应用**：所有代码在 `index.html`（HTML+CSS+JS 一体），禁止引入构建工具、框架、外部 CDN
- **零依赖、离线优先**：必须能双击 file:// 直接运行（PWA 化是 M3，不能破坏单文件性质——manifest/sw 用 Blob 内联注册）
- **移动优先**：布局以 390px 宽度为基准，桌面端 `max-width:1440px` 居中
- **界面语言**：中文
- **音色约束**：正拍 1046.5Hz / 重拍 1568Hz(triangle) / 细分 784Hz，短促包络（4ms 起音，90ms 衰减）——代码中集中在 `CONFIG` 常量区，勿散落硬编码

## 2. 文件结构

```
beatsight/
├── index.html            # 全部代码（样式 <style> + 逻辑 <script>）
├── README.md             # 项目门面
├── CHANGELOG.md          # 版本记录
├── tests/
│   ├── run.js            # 持久化自动化测试（node tests/run.js，零依赖）
│   └── README.md         # 测试原理与补断言规则
└── docs/
    ├── prd.html          # 原始产品需求文档 v1.0
    └── DEVELOPMENT.md    # 本文档
```

## 3. 核心架构

### 3.0 模块地图（v0.6.0 起）

`<script>` 为 8 个 IIFE 逻辑模块，按依赖方向排序，**禁止反向引用**：

```
Store（持久化/状态创建/迁移/导入导出）→ Modal（应用内弹窗）→ Viz（时值可视化）
→ Audio（Web Audio 前瞻调度）→ Trainer（变速训练器）→ Controls（播放控制/BPM/拍号/音量/静音拍）
→ Presets（预设库/回退提示/播放中切换挂起）→ Editor（自定义编辑器）→ init（装配）
```

- 模块间只通过暴露接口通信（`Trainer.updateProg()`、`Presets.consumePending()`、`Viz.resetForStop()` 等），禁止直读内部变量
- 跨模块共享的可变状态（S、customs、`ctx`/`loopStart`/`nextNoteTime`/`schedBar`/`schedStep`/`rafId`）集中在「共享状态」区声明；S 的创建/迁移/落盘归 Store
- `window.__beat` 暴露全部模块接口，是 tests/run.js 的断言入口，也是控制台调试入口
- 完整的函数归属清单见 index.html 顶部注释；下列 3.1–3.5 的机制描述不变，只是函数现在有模块归属

### 3.1 数据模型（v0.7.0 起 tick 制）

```js
// 时值单位为 tick：TPB=48 ticks/拍（48=2⁴×3，整除 2/3/4/6/8/12/16/24，
// 覆盖到三十二分三连音）。四分=48t、八分=24t、八三连=16t、十六分=12t、十六三连=8t、三十二分=6t
pattern = { name, desc, meter, accents, bars: [[{t, rest}...], ×4] }
// meter = 每小节拍数（2/3/4/5/6/7）；内置预设 4 小节相同（rep4），自定义可逐小节不同
// accents = 重拍落点（拍序号，支持跨拍如 1.5），省略默认 [0]；重拍音在 accents 落点触发
// rest: true = 休止符（占时不发声，虚线框渲染）
// 小节校验：barSum === meter × 48，整数严格相等——没有浮点容差
```

- 内置预设在 `BUILTINS`（12 个）；用户预设在 `customs[]`，存 localStorage key `beatsight.m2`（`v:3`）
- **v0.7.0 迁移**：加载时 `v!==3` → 整包备份 `beatsight.m2.bak`，customs 的浮点 `d ×48 → t`
- **Swing 是演奏参数不是时值**：`S.swing ∈ {50,67,75}` 存 S 不入 pattern；只偏移拍内后半八分的发声时刻（(swing-50)/50×24t），时间轴与块宽均不动；6/8 不套用
- **奇数拍重拍分组**：`ACC_GROUPS = {5:[[0,2],[0,3]], 7:[[0,3,5],[0,2,4]]}`；`S.accentGrp[sig]` 记录选择，作用于 basicPattern 与新建自定义；内置/已存预设自带 accents 不受影响
- **播放中发声读 `Presets.activePattern()` 快照**（v0.7.0）：S.sel/S.sig 切换即变，直读 curPattern() 会在小节中途换节奏型导致 schedStep 越界（v0.4.0 起潜伏 bug）；快照仅在小节边界 applyPatternChange 时更新
- **变速训练器配置 `S.trainer = {on, start, target, step, everyN}`**：与 mute/bpm/swing 一并持久化在 beatsight.m2；会话状态 `trStepIdx`/`trBarCnt` 不持久化，`start()` 时重置
- **自定义预设以 `id` 引用**：`S.sel = {type:"builtin", idx}` 或 `{type:"custom", id}`
- 当前选择与拍号不匹配时 `curPattern()` 回退为 `basicPattern(sig)`，同时 `updateFallbackNote()` 显示琥珀色提示条（含一键切回）
- **改数据结构时必须同步**：`buildViz`（渲染）、`scheduler`（发声）、`paintFrame`（动画）、编辑器 `draft`
- **用户可控字符串（预设名等）一律 textContent 赋值，禁止 innerHTML 拼接**

### 3.2 音频引擎（Web Audio 前瞻调度）

```
setInterval(CONFIG.schedInterval=25ms) → scheduler()：把未来 CONFIG.schedWindow=150ms 内的音符注册到 audio clock
loopStart = ctx.currentTime（循环起点的音频时钟时间）
位置换算：pos(拍) = (ctx.currentTime - loopStart) / (60/bpm)
```

- **播放中变速不中断**：`setBpm` 重映射 `loopStart = now - posBeats × 新spb`
- **播放中切换节奏型不跳针（v0.4.0 起）**：`refreshAfterPatternChange()` 在播放中只挂起（`pendingPattern`），由 `scheduler()` 在小节边界调用 `applyPatternChange()` 并重映射 loopStart；拍号变化则等到循环起点
- **静音拍**：`S.mute && schedBar === 3` 时跳过发声（视觉照常）
- **变速训练（v0.5.0）**：小节边界调 `trainerOnBarBoundary()`——每练满 `everyN` 小节经 `setBpm(v,false)` 升一级（时钟重映射不打断播放），到目标并练满一级自动 `stop()` 并提示；返回 true 时 scheduler 立即退出本次调度。爬坡会覆盖播放中的手动调速（下一级边界生效）
- 空小节（编辑器草稿）安全跳过
- 拍号/音量的 UI 入口统一走 `setSig()` / `setBpm()`，不要新写并行的 pill 高亮逻辑

### 3.3 渲染循环（rAF，每帧）

`paintFrame()` 每帧只做两件便宜事：播放头 left% + 当前音符 fill 宽度%。
小节/音符切换时才做全量重绘（class 切换 + fill 0/100% + 组标签高亮）。

### 3.4 时值可视化三层结构（z-index）

```
.cell（音符块，基座 14% 白）
  ├── .fill (z0)  填充：played=白 100%、active=白填充+绿描边光晕（≥0.5 拍的宽格做进度填充；<0.5 拍的窄格轮到即整块白，过程填充在窄格上只是竖条噪声）、rest=灰/浅白
  ├── .subs (z1)  十六分刻度线：n = d×4 格，满格高、只画内部十六分分界线（末格不画——格边缘即边界，右缘多画会垂出多余竖线），跑完一格闪烁（白底/暗底统一闪绿光）
  └── span  (z2)  时值名称标签（d≥0.5 才有独立标签）
```

- 闪烁判定：`t16 = floor(bib/0.25)`，变化时闪「刚走完的格」（同小节 t16-1，跨小节闪上行最后一格）
- 闪烁配色：绿块上白边白光、白/暗块上绿边绿光（WAAPI 动态取色，260ms）
- **短音符合并标注（v0.4.0 起）**：连续 ≥2 个 d<0.5 非休止音符共享组标签「十六 ×n」（`.cell-label.group`，存于 `glEls`），随播放高亮，过窄自动隐藏

### 3.5 编辑器

全屏 overlay（`#editor`，role="dialog"）。草稿 `draft` 深拷贝当前节奏型；`edSel` 选中的音符块、`editBar` 目标小节（标签显示「· 编辑中」）。
校验：`barSum(bar) === draft.meter`（1e-9 容差），任一小节不完整 → 保存按钮禁用 + 该行标红。
**撤销栈（v0.4.0 起）**：任何草稿变更前先 `pushUndo()` 快照（JSON 序列化 bars，上限 50）；Ctrl+Z / 撤销按钮回退。危险操作（复制到全部/清空/未保存返回）需 confirm。
试听：`S.preview=true` 后复用主引擎，`curPattern()` 返回 draft；试听前记录 `prevSigBeforeAudition`，停止/保存时还原主界面拍号。

## 4. 设计规范（视觉 tokens）

| 用途 | 值 |
|---|---|
| 底色 / 卡片 / 控件 | `#121212` / `#181818` / `#1F1F1F` |
| 功能绿（播放、当前、激活） | `#1ED760`（绿底上文字用 `#0A0A0A`） |
| 错误红 | `#F3727F` |
| 提示琥珀（非错误提示条，v0.4.0 新增） | `#E3B341` |
| 文字三级 | `#FFFFFF` / `#B3B3B3` / `#8C8C8C`（v0.4.0 由 #737373 提亮） |
| 线框 | `#2A2A2A` / `#4D4D4D` / 休止虚线 `#5A5A5A` |
| 圆角 | 卡片 12px、块 8px、小格 4px、按钮 9999px（全胶囊） |
| 强调规则 | 绿只做功能强调；绿底上的最高强调用近白 |

设计稿（可继续改）：`https://ardot.tencent.com/file/721823967024298`

## 5. 自验流程（改完代码必须做）

```bash
# 0) 自动化测试（v0.6.0 起，最快反馈，先跑这个）
node tests/run.js    # 56 断言全 PASS 才继续

# 1) JS 语法校验（提取内联脚本）
python -c "import re,io;html=io.open('index.html',encoding='utf-8').read();io.open('_check.js','w',encoding='utf-8').write(re.search(r'<script>(.*?)</script>',html,re.S).group(1))"
node --check _check.js && rm _check.js

# 2) Chrome 无头渲染截图（路径按本机实际调整）
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu \
  --user-data-dir="$TEMP/chp-随机名" --window-size=1440,1100 --virtual-time-budget=4000 \
  --screenshot="%TEMP%\check.png" "file:///绝对路径/index.html"

# 3) 控制台报错检查：加 --enable-logging=stderr --v=0，grep CONSOLE 应为空
```

**坑（都踩过）**：
- macOS 无头 Chrome 在 WorkBuddy 沙箱 shell 内报 `sandbox initialization failed`：加 `--no-sandbox`；`--virtual-time-budget` / `--timeout` 组合可能挂起不退出——后台跑 + 到时 pkill 兜底（v0.6.0 踩）
- `--user-data-dir` 每次必须换新目录，否则静默失败无截图
- headless=new 有 ~500px 最小窗口宽度：`--window-size=390` 实际 innerWidth=500，截图按 390 裁会"假性溢出"。诊断响应式先 dump-dom 验证真实 innerWidth，或用 `--force-device-scale-factor=2` + 双倍窗口尺寸折算
- 含持续 rAF/AudioContext 的页面用 `--virtual-time-budget` 截不到播放态，用 `--timeout=9000`（也只能抓加载态）
- 播放/发声验证必须真人点击（浏览器音频手势策略）
- 想截图特定预设/编辑器：临时复制一份文件，改 `sel` 默认值或末尾追加 `openEditor()`，截完删除临时文件

## 6. 路线图（2026-09-07 重排）

已完成：~~M1 节拍内核~~ / ~~M2 预设+编辑器~~ / ~~M3-2 变速训练器~~ / ~~v0.6 模块化+导入导出+持久化测试~~ / ~~v0.7 tick 制+三连音/Swing/奇数拍~~

按优先级排队：

1. **v0.8 练习闭环第一刀**：停止时自动记录有效播放（≥30 秒）到 `beatsight.log`；统计 overlay（顶栏 chip 入口）：本周时长/连续天数/速度纪录/累计场次四卡 + 近 7 天条图（div 实现，不引图表库）
2. **v0.9 音色扩展**：纯 Web Audio 合成三音色（电子 Click 现状 / 木鱼=带通噪声 30ms 包络 / 鼓组=扫频底鼓+带通军鼓+高通踩镲），噪声 buffer 程序生成，不引采样文件；`S.timbre` 持久化
3. **PWA 离线（原 M3-1）**：内联 manifest（Blob URL）+ Service Worker；iOS 需 apple-touch-icon（可用 SVG data URI）
4. **后台持续发声（原 M3-3）**：优先 `navigator.wakeLock.request("screen")`；iOS Safari 不支持 WakeLock 时用静音循环 audio 元素保活；均需设置页开关
5. **v1.0 训练计划**：「上次训练一键继续」起步，7 天爬升计划的形态视 v0.8 统计数据使用情况再定

## 7. 用户协作偏好

- 无技术背景：解释技术问题用生活化比方，不堆术语
- 在意 token 成本：改动合并成一条明确需求；声称完成前必须自验（语法 + 真实浏览器截图）
- 决策记录写进 CHANGELOG.md，关键状态写进本文档
