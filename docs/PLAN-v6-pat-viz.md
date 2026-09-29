# 编排歌词区 · 节奏型可视化（甲+乙）· 实施方案

> **状态：已实施（v2.80.0，2026-09-30）**。两批（乙 + 游标修复 / 甲）一次交付；§7 两个待确认项
> 当日清零（未贴词不插块头行、行高 30/36px）。实测数字与反向验证结论见 `CHANGELOG.md` v2.80.0 条目，
> 模块级知识沉淀在 `docs/DEVELOPMENT.md` §3.20。本文保留为设计依据与「不做的事」清单。

> 预定版本 **v2.80.0**。基线：`main @ 4933e8e` = v2.79.1（工作区 `beatsight/` 与远端逐字节一致，`git status` 干净，tests 4495 PASS / check-all 16/18）。
> 体例沿用 PLAN-v4/v5：拍板结论 → 范围总览 → 现状实证锚点 → 逐子项「函数级改动清单 → 测试计划 → 反向验证变异清单」→ 不做的事 → 风险 → 分批。
> **行号按 v2.79.1 实测，动工前 `grep -n` 复核一次（仓库惯例）。用户确认后挪入 `docs/PLAN-v6-pat-viz.md`，README 文档表加一行，再动工。**

---

## 0. 需求与拍板记录

**需求**：编排曲式的歌词对齐编辑区里看不到具体节奏型——`mkLyricRefs` 只画拍线 + onset 小圆点，字块该对哪颗音全凭感觉。要在歌词区显示节奏型，参考主界面可视化区。

**用户拍板（2026-09-30，AskUserQuestion 三项）**：

| # | 分歧点 | 拍板 |
|---|---|---|
| 1 | 显示位置 | **甲+乙都上**：每块插一行"块头节奏型行"（每块一次，A×3→B×2→A×1 = 三个块头行）；**且**每小节歌词行内画该小节的时值块轮廓，字块叠在轮廓上 |
| 2 | 粒度 | 时值块贴满 + 骑缝线 + 扫弦箭头 + 休止虚线 + 块内十六分刻度；**不画**座次尺（1 e & a）、**不画**时值标签（"十六×4"） |
| 3 | 多小节型 | 块头行**只画第 1 小节**，型名后注「· 共N小节」防误读 |

**硬约束（用户点名）**：不得影响歌词行左侧的小节序号（CSS counter `argbar`）与和弦名编辑格（`mkChordCell`）。

**默认取舍（方案陈述时用户未异议）**：块头行左列 = 真实型名 +「×N 遍」；乙的轮廓不画扫弦箭头（箭头只在块头行）；折叠态零变化；未贴词的段块头行照常显示。

---

## 1. 范围总览

| 子项 | 改动位置 | 性质 |
|---|---|---|
| 乙 · 行内时值轮廓 | `mkLyricRefs`（L12261）+ CSS | 改造既有函数 |
| 甲 · 块头节奏型行 | `mkLyricRow` 行循环（L12875）+ 新函数 `mkPatHeadRow` / `mkPatBar` + CSS | 新增 |
| 游标挂载点修复 | `syncPreviewCursor`（L12521）+ `lctx`/`laneBySec`（L12869/12898） | 甲的前置修复（★ 本方案最大坑，见 §4） |
| 测试 | 新用例 `tests/cases/t145-pat-viz.js`（登记进 `tests/run.js` CASE_FILES） | 新增 |
| 版本 | `VERSION` / `package.json` / `package-lock.json` / CHANGELOG 首条 | 发版纪律 |

不动：数据层（Store/数据区）、播放/调度（AudioEngine/共享状态）、拖拽、打轴、主界面歌词轨（Viz `buildLyricLane`）、折叠摘要行。

---

## 2. 现状实证锚点（动工前 `grep -n` 复核）

| 锚点 | 位置（v2.79.1） | 事实 |
|---|---|---|
| `mkLyricRefs` | L12261–12285 | 每小节行画：拍线 `.arg-lyric-beat`（每拍一条，首拍带 `.dn`）+ 扫弦型的 onset 点 `.arg-lyric-onset`（每非休止符起点）。已持有 `blk = blockAt(sec, r)`、`pat = resolveRef(blk.ref)`、`barTicks` |
| 歌词行循环 | L12875–12896 | `for r in [0, lctx.rows)`：`row(.arg-lyric-row)` = [`mkChordCell`][`barrow(.arg-lyric-barrow)`]；`mkLyricRefs(bar, sec, r, barTicks)`；`lctx.barrowEls` 收 barrow |
| 小节序号 | CSS L1020/1023–1024 | `counter-reset:argbar` 在 `.arg-lyric-lane`；`.arg-lyric-row::before{content:counter(argbar)}`——**块头行只要不用 `.arg-lyric-row` 类就不会吃序号** |
| 行高 | CSS L1027 / L1139 | `.arg-lyric-barrow` 高 24px；窄屏（≤960px 媒体查询）36px |
| ★ 试听游标 | L12521–12553 | `syncPreviewCursor` 用 **`reg.lane.children[row]`** 决定游标挂载行——v2.77.0 起 children 是行容器。lane 里插入块头行后 `children[row]` **错位**：游标会挂到块头行/错的小节行 |
| `blockAt` | L5235 | 返回 `{blockIdx, localBar, schedBar}`（消费点：`mkLyricRefs` 用 `blk.schedBar`、`mkChordCell` 用 `at.blockIdx/at.localBar`） |
| `seamGradient` | L6598，Viz 导出 L8014 | 骑缝线渐变生成器；Editor 复用先例 `Viz.seamGradient`（L10913）。Arrange 在 Viz 之后 = 向前引用，合法 |
| `.strumv` | CSS L395–421 | 贯穿式竖箭头：`--y1/--y2` 由 `.kF/.kT/.kB` 按弦区变量（`--yT1/--yT2/--yB1/--yB2`）取，`.dn/.up` 定箭头端；空扫 = `.ghost` 蓝虚线。弦区变量桌面值在 `:root` L60、窄屏 L1163；`.edcell` 的"行内等比重定义"先例 L441 |
| `resolveRef` / `hasStrum` | 数据区 L2645 / 装配区 | `mkLyricRefs` 现已在调用（函数声明 hoisting，运行期可达），无新依赖方向问题 |
| 轮廓配色 | CSS 根变量 L35–40 | `--veil` 是 RGB 三元组（v2.54.0 收口），`rgba(var(--veil),.18)` 两主题自动翻转——新轮廓/缝线一律走它，零 obs 特判 |

---

## 3. 子项乙：小节行内时值块轮廓

### 3.1 函数级改动清单

1. **CSS（`.arg-lyric-beat` 邻近，L1045 一带）新增**：
   - `.arg-lyric-note{position:absolute;top:0;bottom:0;border:1px solid rgba(var(--veil),.18);background:rgba(var(--veil),.05);border-radius:3px;pointer-events:none}` —— 贴满几何（`left = 起点占比`、`width = 时值占比`，与 v2.78.0 主界面同口径，间隙为零）。
   - `.arg-lyric-note.rest{border-style:dashed;background:transparent}` —— 休止虚线，与块头行/主界面同语汇。
   - `.arg-lyric-onset` 规则**整段删除**（退役）。
2. **`mkLyricRefs`（L12261）改造**：
   - 保留拍线循环（拍参照不丢）。
   - **删除** onset 点分支（`hasStrum(pat)` 那个 `for` 循环）——轮廓块的左缘就是 onset，双份信息是噪音。
   - 新增轮廓循环：遍历 `pat.bars[blk.schedBar]`，`acc` 累加，每颗音符（含休止）append 一个 `.arg-lyric-note`（`+ (s.rest ? " rest" : "")`）。**纯节拍型也画**——附点等非均分时值正是对齐参照。
   - DOM 顺序：轮廓 → 拍线（轮廓在底）；字块 chip 由 `mkLyricChip` 后 append，天然压顶，不动。
3. 拖拽换算、参考层与字块的百分比定位基准**全部不变**（perTick 走 barrow 宽度，与内部画了什么无关）。

### 3.2 测试计划（t145 乙组）

- 四分均分型：轮廓块 4 个，`left/width` = 0/25/50/75% + 各 25%（与 tick 占比逐值一致）。
- 含休止型：休止块带 `.rest`，数量 = 音符总数（含休止）。
- 纯节拍型（`hasStrum` = false）：同样画轮廓（防"只在扫弦型画"回退）。
- `.arg-lyric-onset` 在源码与 DOM 双端零残留（防复活）。
- 拍线数量不变（`pat.meter` 条）。
- 字块 chip 仍是 barrow 的**最后**子节点层（压顶顺序不被轮廓插队）。

### 3.3 反向验证变异清单（乙）

- perl 注释掉轮廓循环 → 「轮廓块数量/位置」断言**具名变红**（不炸 runner）。
- 轮廓改回旧 `hasStrum` 门槛 → 「纯节拍型也画」断言变红。
- 恢复后全绿。

---

## 4. 子项甲：块头节奏型行（含游标挂载点修复）

### 4.0 前置修复：游标改走显式行数组（★ 最大坑）

- `lctx`（L12869）增 `rowWrapEls`（行容器 `.arg-lyric-row` 数组，与 `barrowEls` 平行收集）。
- `laneBySec` 注册（L12898）带上 `rowWrapEls`。
- `syncPreviewCursor` L12537：`reg.lane.children[row]` → **`reg.rowWrapEls[row] || reg.lane`**。
- 理由：v2.77.0 把 `barrowEls` 从 children 解耦时漏了游标这一处（它要的是"行容器"不是 barrow，当时 children 恰好等于行容器数组）。块头行一插入这个巧合就破。修复本身独立成立（显式优于位置巧合），t122 同源断言区同步更新。

### 4.1 函数级改动清单

1. **CSS 新增（arg-lyric 区块）**：
   - `.arg-pat-row{display:flex;align-items:center;gap:4px;flex-basis:100%}` —— 与 `.arg-lyric-row` 同骨架，**但无 `counter-increment`**，序号不被吃。
   - `.arg-pat-name{flex:none;width:<和弦格同宽>;font:11px var(--mono);color:var(--t3);单行省略}` —— 左列与和弦格列等宽对齐（和弦格宽度动工时 `grep .arg-chd-cell` 取现值）；窄屏媒体查询同步。
   - `.arg-pat-bar{position:relative;flex:1;min-width:0;height:30px;background:var(--card2);border-radius:5px}`（窄屏 36px 跟随 barrow 档）；行内重定义弦区变量 `--yT1:0;--yT2:11px;--yB1:19px;--yB2:30px`（照 `.edcell` 等比先例；窄屏档另算）。
   - `.arg-pat-cell{position:absolute;top:3px;bottom:3px;background:rgba(var(--veil),.07);border:1px solid rgba(var(--veil),.22);border-radius:3px}` + `.rest` 虚线变体；块内十六分刻度用 1px 短线子节点（`t % T16 === 0` 才画，与主界面同规）。
   - 箭头直接复用 `.strumv` 类体系（`kF/kT/kB + dn/up + ghost`），靠 `.arg-pat-bar` 作用域变量定弦区——零新箭头 CSS。
2. **新函数 `mkPatBar(pat)`**（Arrange 内，`mkLyricRefs` 附近）：
   - 画 `pat.bars[0]`（拍板：只第 1 小节）：时值块贴满循环（同乙的 acc 口径）+ 休止 `.rest` + 十六分刻度；
   - 缝：`seamX` 收集（`startT>0 && !s.rest`，`strong = startT % TPB === 0`）→ 行尾挂一层 `.seams` 覆盖层，`background = Viz.seamGradient(seamX)`（拍内 1px 墨缝 / 拍界 2px 强缝，v2.79.0 语汇原样）；
   - 扫弦箭头：`hasStrum(pat)` 时逐非休止格按 `dir/zone` 建 `.strumv`（空扫 `ghost` 蓝虚线；`prevZone` 携带规则照主界面 buildRowCells L6630 注释口径：小节内跟随前一记实扫）。
3. **新函数 `mkPatHeadRow(a, sec, i, blk)`**：
   - 左列 `.arg-pat-name`：`pat.name + " ×" + blk.repeats + " 遍"`（`pat.bars.length > 1` 追加 `" · 共" + n + " 小节"`），`textContent` 赋值；`aria-hidden`（读屏走各行自己的 label，块头纯视觉）。
   - 右列 `.arg-pat-bar` = `mkPatBar(resolveRef(blk.ref))`。
4. **`mkLyricRow` 行循环（L12875）插入逻辑**：
   - 循环体开头：`const at = blockAt(sec, r); if (at && at.localBar === 0) lane.appendChild(mkPatHeadRow(...))`。
   - `mkChordCell` 内部已自建 `blockAt`（L12577），不重构它，各算各的（成本 O(1)）。
   - 无歌词（`span <= 0` 不建行）与折叠态：本就不建行，块头行自然不出现——**拍板默认"未贴词也显示"与此冲突，开工时与用户二次确认**（见 §7 待确认项）。

### 4.2 测试计划（t145 甲组）

- 构造段：块序 A×3 → B×2 → A×1 ⇒ lane 内 `.arg-pat-row` **恰 3 个**，且分别位于第 1/4/6 小节行**之前**。
- 同型两块（A 出现两次）⇒ 两个块头行（按块不按型去重）。
- 块头行 class 不含 `arg-lyric-row`（counter 安全）；其左列 textContent = 型名 + ×N 遍；多小节型带「· 共N小节」。
- `mkPatBar` 输出：时值块数量/位置与 `bars[0]` 一致；`.seams` 一层；拍界强缝存在；扫弦型箭头数 = 非休止格数（含 ghost）。
- 游标回归：`lane.children` 含块头行的状态下，`syncPreviewCursor` 后 `cursorEl.parentNode` 仍是**行容器**且为第 row 小节（断言挂对行）。
- 小节序号连续性（桩里断言 `.arg-lyric-row` 数量 = 小节数，间接钉住 counter 基数）。

### 4.3 反向验证变异清单（甲）

- 回退块头行插入 → 「恰 3 个块头行」红。
- 块头行改挂 `.arg-lyric-row` 类 → counter 安全断言红。
- 回退游标 `rowWrapEls` 修复（插着块头行跑）→ 游标挂载断言红。
- 恢复后全绿。

---

## 5. 不做的事

- 不动主界面播放态歌词轨（Viz `buildLyricLane`）、不动折叠摘要行。
- 块头行**不画**座次尺、时值标签（拍板），纯展示不可交互（无点击/无拖拽）。
- 乙的轮廓行**不画**扫弦箭头（密度）；onset 点退役（轮廓起点即 onset）。
- 不改拖拽 perTick、打轴、试听播放逻辑（除 §4.0 挂载点）。
- 不做"块头行点击跳换型"等附加交互（避免范围蔓延，需要另立项）。

---

## 6. 风险与核查点

| 风险 | 对策 |
|---|---|
| ★ 游标 `lane.children[row]` 错位 | §4.0 前置修复 + t145 游标回归断言 |
| DOM 预算：乙每小节 +音符数节点（全十六 4/4 = +16/行）、甲每块 +≤45；仅展开态发生，但多段可同时展开 | 动工后实跑 `tools/check-node-budget.js`；若编排浮层分区超预算，先回来报告再定（选项：轮廓改 CSS 渐变零节点方案） |
| 窄屏 390：左列型名挤压 | 窄屏媒体查询：型名单行省略；三档截图（1440/1024/390）人眼验收 |
| obs 日间主题对比度 | 全部走 `--veil` 三元组 + `--seam-strong`，零特判；obs 截图验收 |
| CSS counter 被块头行吃掉 | 块头行用独立类（无 `counter-increment`）+ t145 断言 |
| `resolveRef` 返回 null（脏数据段） | `mkPatHeadRow` 入口判空：无型则不插块头行（与 `mkLyricRefs` 同款早退） |

---

## 7. 待确认项（~~动工前清零~~ 2026-09-30 已定案）

1. **未贴词的段**：块头行**不显示**（用户定案）。理由：块头行是给「贴词对齐」当参照物的，
   没有词的段插它纯占位，且省掉为无词段单建行的改动。实现 = 插入条件带 `line`（贴了词），
   折叠态本就不建行 → 自然一致。
2. 块头行行高 **30px（桌面）/ 36px（窄屏）**（用户定案，与示意图一致）。

---

## 8. 分批与自验纪律

- **批 1（乙 + §4.0 游标修复）**：改码 → t145 乙组 + 游标断言 → 反向验证 → `node tests/run.js` → `node tools/check-all.js` → 三档截图 → 交用户人眼验收。
- **批 2（甲）**：mkPatBar/mkPatHeadRow + 插入逻辑 → t145 甲组 → 反向验证 → 全量自验 → 三档截图 → 用户验收。
- 两批合发 **v2.80.0**（CHANGELOG 一条，含根因/修法/取舍/自验四节；VERSION 与 package*.json 同步 bump）。
- 提交前按技能纪律：脏键核对（无新持久化字段，预计零新键）、`grep -n` 复核本文全部行号锚点。
