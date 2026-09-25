# 编排曲式 UI 重设计 · 函数级实施计划（PLAN-v4 草案）

> 基线：`chj0124/beatsight` @ v2.29.0（`9e51a9c`，`index.html` 12,219 行）。
> 本文体例沿用 `docs/PLAN-v3-arrange-redesign.md`：拍板结论 → 范围总览 → 逐阶段
> 「函数级改动清单 → 测试计划 → 反向验证变异清单」→ 不做的事 → 风险 → 分步提交。
> **用户确认后挪入 `docs/PLAN-v4-arrange-ui-rework.md`，README 文档表加一行，再动工。**
> 行号全部按 v2.29.0 实测标注，动工前用 `grep -n` 复核一次（仓库惯例）。

---

## 0. 拍板结论（待确认决策点）

| # | 决策点 | 建议结论 | 代价/说明 |
|---|---|---|---|
| D1 | 段行「起/终」两钮去留 | **退役**。范围入口收敛为两处：开练面板歌曲地图双滑块（精确到小节）+ 段卡片 ⋯ 菜单「练这段」（一键设该段范围） | 习惯老入口的用户需适应；help/README 词条同步改写 |
| D2 | 歌词区默认态 | **折叠为摘要行**（「歌词 ✓ 21 字 ▸ 展开」），展开后才是粘贴框/字块轨；展开态按曲式+段 uid 记本机 | 贴词多一步点击；段高从 ~130px 降到 ~64px |
| D3 | 段操作 8 钮 | 收成 **▶（试听）常显 + ⋯ 菜单**（上移/下移/移到最前/移到最后/删除，全文字标签） | 排序操作从 1 键变 2 键；移动端不再折行 |
| D4 | 曲式库形态 | 竖列表改 **横排 chips**；顶栏「复制」删除（与新建菜单「复制当前曲式」语义合并）；曲式 ⋯ 管复制/删除/重命名 | 「复制」入口从一键变两步 |
| D5 | 移动端开练区 | **底部固定开练条**（范围读数 + 循环 + ▶ 播放），`safe-area` 适配；顺手修 `.editor-topbar` 窄屏断字 | 无 |
| D6 | 数据模型 / 调度 | **一行不碰**。`arrangeSel` 三件套语义与持久化格式、歌词 uid 绑定、`arrNextBar`/scheduler 全部不动 | 本计划纯呈现层 + 编辑层 |

---

## 1. 范围总览

```
阶段一  S1 骨架重排（v2.30.0）：段卡片化 · 块胶囊横排 · 段操作 ▶/⋯ 分组 · 曲式库 chips 化 · 顶栏窄屏修复
阶段二  S2 开练面板（v2.31.0）：右栏 sticky「开练」面板 · 歌曲地图条 + 双滑块 · 「练这段」· 起/终退役 · 移动底条
阶段三  S3 歌词折叠（v2.32.0）：歌词摘要行 + 展开态 · 锚点提示音全局化（每段只渲染一份 → 面板唯一一份）
```

**三阶段共同红线**：

- `arrNextBar` 节目单步进、scheduler、时间轴不变量、`S.arrangeSel` 语义与持久化 v2、`normArrange`/`normLyricLine`（歌词按段 uid）——一行不改。
- 原生控件优先（测试桩无 `getBoundingClientRect`、不支持 `<select>`、驱动不了自绘拖拽）；用户可控字符串只走 `textContent`；`Modal.bindOverlay` 登记纪律（重建前先 `unbindOverlay`）。
- R4 扇出 ≤12；模块单向引用；UI 内聚 `Arrange` 模块，`Controls` 只做事件转发。
- **DOM 预算 1300（当前 1212）**：本计划静态标记净减（删 `argCopy` −1、删每段重复的 `cue` 开关 −1/段、段行起/终 −2/段），余量扩大，不动预算线。
- 视觉体系走 CSS 变量，双主题（经典/观测台）同时成立；`sec-tag` 角标沿用。

---

## 2. 阶段一 · 骨架重排（v2.30.0）

### 2.1 函数级改动清单

**A. 静态标记（`#arrangeOverlay`，L1486–1523）**

| 位置 | 改动 |
|---|---|
| L1498 `argCopy` 按钮 | **删除**（D4：复制并入新建菜单「复制当前曲式」与曲式 ⋯） |
| L1496–1500 `#argActions` | 保留 `argNew`（L1497）；新增曲式级 `⋯` 按钮 1 颗（`id="argLibMore"`，静态 +1，与删 `argCopy` 对冲） |

**B. CSS（L599–609 编辑器、L725–779 编排专属、L799–810 窄屏）**

| 位置 | 改动 |
|---|---|
| `.arg-sec`（L731–732） | 单行 flex 改**纵向卡片**：`flex-direction:column; align-items:stretch; gap:10px; background:var(--card2); border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:10px`，删除行底线 |
| `.arg-blocks`（L735） | `flex-wrap:nowrap; overflow-x:auto`（块胶囊**横排**，窄屏可横滑）；`flex:1→flex:none` |
| `.arg-block`（L736） | 圆角 6px 改 **999px 胶囊**，`padding:7px 12px`，内部 gap 8px |
| `.arg-ops`（L747） | 改段卡片头行右端容器：`flex:none` 保持，只放 ▶ 与 ⋯ 两颗 |
| 新增 `.arg-sec-menu` | ⋯ 展开的菜单行样式（运行时 DOM，纯 CSS 类） |
| `@media (max-width:640px)`（L799 起） | `.editor-topbar` 窄屏规则：`gap:8px`、`ed-title` 字号 14px、`.pill{padding:7px 12px;font-size:12px}`、`.back-btn` 隐藏文字只留箭头（或 `white-space:nowrap`）；**修 P0-3 断字** |
| `.arg-list`（L725–730） | 竖列改横排 chips：`flex-direction:row; flex-wrap:wrap`，`.arg-item` 圆角 999px、padding 收窄，`.sel` 绿框不变 |

**C. JS（`Arrange` 模块，L9849 起）**

| 函数 | 改动 |
|---|---|
| `buildSecRow`（L10082） | ① 结构调序：段号标签改**绿边圆徽章**样式（CSS 类，节点不增）；② **删除** `mkRange`（起/终，L10143–10164）——S2 才删，S1 暂保留，仅挪进 ⋯？★ 拍板：S1 不动起/终，S2 一并删（阶段间单一职责）；③ `mkMove`（L10168）/`rm`（L10180）/`mkEnd`（L10198）四组按钮**不再直接 append**，改收进 ⋯ 菜单：`mkSecMenu(i)` 新助手（按钮 + hidden 菜单行，菜单项全文字标签带 aria-label，桩可驱动）；④ `tryBtn`（L10217）保留常显 |
| `arrangeRender`（L10242） | 曲式库列表渲染（L10251–10261）：`arg-item` 结构不变，类名加 `arg-chip`（纯 CSS 变 chips）；`argNew` 的 `aria-expanded` 判据（L10268）宿主仍是 `#argActions`，不动 |
| 新增 `mkLibMore()` | 曲式级 ⋯ 菜单：复制 / 删除 / 重命名（运行时 DOM；逻辑搬自 L10809 `argCopy`、L10813 `argDel` 的装配监听，`argCopy`/`argDel` 两监听随静态按钮一并删除） |
| 装配区 L10809/L10813 | `argCopy`/`argDel` 两个 addEventListener 删除；新增 `argLibMore` 监听（复用同一 `Modal` 纪律） |

**D. 不动的**：`picking` 候选区（L10290–10357，三区+置顶）、`toggleNewMenu`（L~10660）、`applyTemplate`/`buildTemplateArrange`（L10611）、`open`/`close`（L10701/10711）、`setRange`（L10504）、歌词轨全部。

### 2.2 测试计划

**新增 `t106-sec-card.js`**：

1. 段卡片结构：块列 `flex-wrap:nowrap`（CSS 文本级断言，同 t101 口径）、块胶囊顺序 = `sections[].blocks` 顺序
2. ⋯ 菜单：点击展开 5 项（上移/下移/移到最前/移到最后/删除）→ 点「删除」走 `uiConfirm` 确认流；单段曲式「删除」disabled/置灰口径与现 rm 一致
3. ▶ 试听按钮 aria-label 含「试听第 N 段」
4. 曲式库 chips：`arg-item` 数量 = `Store.arranges.length`，选中态 `.sel` 唯一
5. 段号徽章首段/末段：↑/移到最前 的 disabled 口径与现 mkMove/mkEnd 一致

**必须全量重跑**：t54（段行结构——children 裸下标定位**逐条改 aria 定位**，本次迁完）、t104/t105（候选区与模板，触点结构变了）、t57（编辑器入口）、t45 系 DOM 预算 + **smoke.js**（静态节点 −1+1 净零，预算不动）。

### 2.3 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| ⋯ 菜单删「移到最前」（mkEnd 少一项） | t106 #2 菜单项数 = 5 |
| 块横排改回竖排（CSS flex-wrap 删 nowrap） | t106 #1 CSS 文本断言 |
| 段徽章样式改回纯文本标签（类名删） | t106 #5 徽章类存在性 |
| `argCopy` 删除时把「复制当前曲式」模板项也删了 | t105 #2 副本独立性（模板四选项仍齐） |

---

## 3. 阶段二 · 开练面板（v2.31.0）

### 3.1 函数级改动清单

**A. 静态标记（L1502–1521 重排）**

| 位置 | 改动 |
|---|---|
| L1502–1521 卡片 | 内部改双栏容器 `#argWork`：`grid-template-columns:minmax(0,1fr) 340px; gap:24px`；左栏 = 现有曲式库 + 段落结构；**右栏新增 `#argPanel`（sticky top:20px）**：`#argMap`（空容器，运行时填）、`#argRangeTrack`（双滑块：2 个 `input[type=range]` + 轨道 + fill，静态 4 节点，**复用侧栏 L8369–8490 那套原生叠层结构**）、`#argRangeRead`、`argLoopBtn`（L1516 原样挪入）、`argPlay`/`argPlayRange`（L1517–1518 挪入）、`#argPanelProbs` |
| L1513–1520 原「播放范围」区 | 整体删除（职责并入 `#argPanel`）；`argProblems` 移入面板（或保留原位同时镜像——**不镜像**，单点） |
| 窄屏（≤640px） | `#argPanel` 变**底部固定开练条**：`position:fixed; left/right:0; bottom:0; z-index:5`，横排 = 范围读数 + 循环 + ▶ 主钮；「播选中范围」「全部」「锚点提示音」收进面板内 ⋯；`padding-bottom` 加 `env(safe-area-inset-bottom)` |

**B. CSS**

| 位置 | 改动 |
|---|---|
| 新增 `.arg-work` / `.arg-panel` / `.arg-map*` / `.arg-dock` | 面板卡片化（--card2 底、12px 圆角）；地图条分段高 34px、范围高亮 `--green` 内阴影（复用 mockup 视觉） |
| `@media (max-width:960px)`（L811） | 双栏退化单栏：`#argPanel` 移左栏**顶部**（640–960px）或变 fixed 底条（≤640px） |
| 双滑块 | 直接复用侧栏既有 `.demo-range-*` 样式族（L551 起），抽公共类或复制改前缀（二选一，动工时按行数取小） |

**C. JS**

| 函数 | 改动 |
|---|---|
| `buildSecRow` | **删除** `mkRange`（起/终，L10143–10164）——D1 落地；⋯ 菜单**新增「练这段」项**（置顶第一位）：`setRange(songBarBefore(a,i), songBarBefore(a,i)+secBars(a.sections[i])-1)`，循环语义 = setRange 默认 loop:true（只练这段循环，与 v2.10.7 旧「点段=只循环这段」等价） |
| `setRange`（L10504） | 增第三参 `/** @type {{loop?:boolean}} */ opts = {}`，`S.arrangeSel.loop = opts.loop !== false ? true : opts.loop`——**既有调用方（侧栏滑块）零改动**；含那段「静默早退」注释的取曲式顺序逻辑不动 |
| `arrangeRender`（L10242） | 新增 `renderPanel(a)` 子工序：① `#argMap` 按 `a.sections` 比例生成分段（每段一 div，宽 = `secBars/TB%`，运行时 DOM，textContent 段号）；② 双滑块 min/max/初始值同步 `songBars(a)`，oninput 走既有侧栏同款归一逻辑（`clampLoop` 口径，setRange 里已有）→ 调 `setRange(f,t)`；③ 范围读数文案搬自 L10369–10371；④ `argProblems` 渲染搬自 L10378–10382；⑤ 地图高亮 = `arrangeSel` 区间覆盖的段（`songBarAt` 反解，L4142） |
| 新增 `onMapSegClick(i)` | 点地图某段 = 「练这段」同一路径（复用，不写第二份范围逻辑） |
| `refreshBar`（L10386） | 不动；面板读数由 `onArrangeBar` 家族既有钩子刷新（L3947–3964 注入模式，面板不另开刷新通道） |

**D. 不动的**：侧栏双滑块与 `demoSongNote` 读数（t68 钉住）、`loopLyricSection`、`argPlay`/`argPlayRange`/`argLoopBtn` 的监听与语义、调度。

### 3.2 测试计划

**新增 `t107-practice-panel.js`**：

1. 面板存在性：打开浮层即右栏（或窄屏底条）含地图/滑块/读数/两播放钮/循环钮
2. 地图分段数 = `sections.length`，各段宽度比例 = `secBars/TB`（±1px 容差由桩口径定，桩无 `getBoundingClientRect` → 断言**内联 style 百分比字符串**）
3. 拖/改 from 滑块 → `arrangeSel.from` 更新且 `from<=to` 恒成立（倒置归一断言，含 `byLyric:false`）
4. 「练这段」（⋯ 菜单与地图点击两条路）→ 范围=该段起止小节 + `loop:true` + 模式切 arrange
5. 段行上**无**起/终按钮（D1 退役断言）；`argProblems` 只在面板渲染一份
6. 窄屏（≤640px CSS 文本级断言）：`#argPanel` fixed 底条规则存在

**必须全量重跑**：t68 全家（侧栏读数零扰动证明）、t88（侧栏滑块）、t55（help「起/终」词条改写）、t63/t73/t75、t93、t45 系 + **smoke.js**（面板 +5 静态节点，预算仍 <1300）、t107 自身 + t106 回归。

### 3.3 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| 地图分段按段数均分（不按小节比例） | t107 #2 百分比断言 |
| 「练这段」调 setRange 时不传 loop → 落到 opts 默认外 | t107 #4 loop 断言 |
| 双滑块删双向归一（各自独立钳制） | t107 #3 倒置归一（from=3/to=1 组合断言） |
| 删段行起/终时把「全部」钮也删了 | t107 #1 面板控件齐套 |
| 面板读数另开 setInterval 刷新（绕过 onArrangeBar） | t107 #1 结构断言 + 代码评审项 |

---

## 4. 阶段三 · 歌词折叠（v2.32.0）

### 4.1 函数级改动清单

**A. 静态标记**：`#argPanel` 内新增 `#argLyricCue`（锚点提示音 toggle，静态 +1，**全书唯一一份**）。

**B. JS**

| 函数 | 改动 |
|---|---|
| `mkLyricRow`（L9996） | 重构：默认渲染**摘要行**（歌词✓N 字 / 未贴歌词 + ▸ 展开）；点展开才渲染完整控件（粘贴框/清除/lane/循环本行）；**删除 cue toggle 段**（L10003–10019）；「循环本行」（L10023–10034）挪进展开区 |
| `arrangeRender` | 面板 `renderPanel` 里同步 `#argLyricCue` 状态（`applyToggle`，S.lyricCue 语义不动）；展开态记 `S.arrLyricOpen`（`{[arrangeId]: {[secUid]: true}}`，**persist**——D2 记本机） |
| `Store` 加载段 | `S.arrLyricOpen` 是 UI 态不是数据，**不进冷键**（sessionStorage 级都不需要——直接 persist 在 S 的既有 save 通道？★ 拍板：放 `S` 但不持久化，关浮层即重置。理由：折叠是纯浏览态，用户上次展开≠这次想展开；持久化反而违背"默认折叠降噪"的初衷。D2 从"记本机"改为"不持久化"，待确认） |

**C. CSS**：新增 `.arg-lyric-sum`（摘要行）与展开容器样式；`.arg-lyric`（L752）改为展开容器专用。

### 4.2 测试计划

**新增 `t108-lyric-collapse.js`**：

1. 有词段默认渲染摘要（含字数），不渲染粘贴框/lane；无词段渲染「未贴歌词 + ▸ 展开」
2. 点展开 → 完整控件出现（粘贴框 aria-label「第 N 段歌词…」），再点收起
3. 全书 `cue` toggle 仅 1 份且在面板（DOM 计数断言）
4. 「循环本行」只在展开后且该段有词时可点
5. 展开/收起不触发歌词数据写（`Store.findLyric` 前后一致）

**必须全量重跑**：**t103 全量**（歌词 uid 契约）、t61（歌词循环）、t63、t68 系、t45 系 + **smoke.js**（歌词折叠后运行时 DOM 大减）。

### 4.3 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| 摘要字数统计错（`line.chars.length` 改读 blocks） | t108 #1 字数断言 |
| 展开时直接重建数据（distribute 重跑） | t108 #5 数据未动 |
| cue 在面板与段内各渲染一份 | t108 #3 计数 = 1 |
| 折叠态把「循环本行」留在外层 | t108 #4 可点性断言 |

---

## 5. 不做的事（在 PLAN-v3 §5 基础上追加）

| 排除项 | 理由 |
|---|---|
| 地图条 scrub / 播放头拖拽 | 练习页已有跳段与双滑块；编排页再加是第二权威源 |
| 段多选 / 批量操作 | 无真实场景；块结构已覆盖 |
| 歌词折叠态持久化 | §4.1 D2 修正：纯浏览态，默认折叠才是目的 |
| 编排页主题/壁纸差异 | 浮层始终盖在练习页上，跟主题走即可 |
| 任何数据模型/调度改动 | D6 红线 |

---

## 6. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 老用户找不到「起/终」 | help 词条首句「点段卡片 ⋯ → 练这段 = 只循环这一段」；README「核心交互细节」同步；「全部」钮仍在面板 |
| R2 | ⋯/折叠菜单驱动不了 | 全部是 button + hidden 展开，桩可点击；菜单项 aria-label 定位（新），逐步淘汰 t54 裸下标 |
| R3 | 三阶段动同一段代码互相污染 | 阶段间单一职责：S1 不动范围区与歌词，S2 不动曲式库与歌词，S3 不动结构；每阶段独立发版可回退 |
| R4 | 面板刷新通道多套并存 | 只走 `onArrangeBar` 既有注入；代码评审设专项 |
| R5 | DOM 预算误判 | 每阶段跑 t45 系 + smoke；静态净减有数可查 |
| R6 | 移动端底条挡内容 | 段列表容器 `padding-bottom` 让位 + safe-area；smoke 窄屏截图人眼过 |

---

## 7. 分步提交计划

| 提交 | 内容 | 版本 | 发布前清单 |
|---|---|---|---|
| S1 | 阶段一 + t106 + t54 迁移 + 全量回归 | **v2.30.0** | `node tools/check-all.js` 全量（含 t45+smoke）→ `const VERSION`（L1892）bump → CHANGELOG → 桌面/390px 截图人眼 → README 不改（无用户可见语义变化） |
| S2 | 阶段二 + t107 + help/README 词条 + 全量回归 | **v2.31.0** | 同上 + t55 内容契约同步 + help「播放范围」词条改写 |
| S3 | 阶段三 + t108 + 全量回归 | **v2.32.0** | 同上；help 歌词一节补「默认折叠」一句 |

每步发布前清单照旧：`check-all.js` 全量 → VERSION bump → `smoke.js` 人眼过一遍 → 真机验收改动面；`git push` 走既定纪律（直连先试 3 次，不通再走 API）。

---

## 8. 下一步

1. 确认 D1–D6 拍板表（尤其 D1 起/终退役、D2 折叠不持久化两处修正）；
2. 确认后本文挪入 `docs/PLAN-v4-arrange-ui-rework.md`，README 文档表加一行；
3. 按 S1 动工。
