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
└── docs/
    ├── prd.html          # 原始产品需求文档 v1.0
    └── DEVELOPMENT.md    # 本文档
```

## 3. 核心架构

### 3.1 数据模型

```js
// 节奏型：4 小节 × 音符数组，d 单位是"拍"（十六分=0.25）
pattern = { name, desc, meter, bars: [[{d, rest}...], ×4] }
// meter = 每小节拍数（2/3/4/6）；内置预设 4 小节相同（rep4），自定义可逐小节不同
// rest: true = 休止符（占时不发声，虚线框渲染）
```

- 内置预设在 `BUILTINS`（8 个）；用户预设在 `customs[]`，存 localStorage key `beatsight.m2`
- **自定义预设以 `id` 引用（v0.4.0 起）**：`S.sel = {type:"builtin", idx}` 或 `{type:"custom", id}`；旧数据的 idx 选择在加载时自动迁移为 id。新增/删除预设时不要再用数组下标引用
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
- `--user-data-dir` 每次必须换新目录，否则静默失败无截图
- 含持续 rAF/AudioContext 的页面用 `--virtual-time-budget` 截不到播放态，用 `--timeout=9000`（也只能抓加载态）
- 播放/发声验证必须真人点击（浏览器音频手势策略）
- 想截图特定预设/编辑器：临时复制一份文件，改 `sel` 默认值或末尾追加 `openEditor()`，截完删除临时文件

## 6. M3 任务拆解（下一个里程碑）

1. **PWA 离线**：内联 manifest（Blob URL）+ Service Worker（`index.html` 单资源缓存即可）；iOS 需 apple-touch-icon（可用 SVG data URI）
2. **变速训练器**：参数 `{startBpm, targetBpm, step, everyNBars}`；在 `scheduler()` 的小节边界计数，到达即调 `setBpm`（内部静音切换，不打断播放）；进度显示「当前 85 BPM · 第 6/13 步」；完成自动停止 + 提示。**UI 落位到主界面「训练模式」区（v0.4.0 已立好分区）**
3. **后台持续发声**：优先 `navigator.wakeLock.request("screen")`；iOS Safari 不支持 WakeLock 时用静音循环 audio 元素保活；均需设置页开关

## 7. 用户协作偏好

- 无技术背景：解释技术问题用生活化比方，不堆术语
- 在意 token 成本：改动合并成一条明确需求；声称完成前必须自验（语法 + 真实浏览器截图）
- 决策记录写进 CHANGELOG.md，关键状态写进本文档
