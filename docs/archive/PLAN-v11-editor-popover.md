# 编辑器音符级悬浮窗 + 小屏入口收敛 + 品牌合规修复 · 实施方案

> **状态：方案待执行（历史快照 · 方案）** —— 撰写于 v3.49.2（2026-10-13），**未落地**；
> 落地后在本行补记交付版本号与 CHANGELOG 指针（本目录唯一允许的回写）。
> 正文行号为撰写时快照，**不再维护**，动手前以 `Grep` 重查为准；
> 拍板记录以外的细节若与代码冲突，以代码为准。

## 0. 拍板记录（定稿，不再开放讨论）

| 项 | 定稿 |
|---|---|
| 悬浮窗范围 | **音符级四组**（扫弦标注 / 弦区 / 发声 / 逐弦）收进悬浮窗；「按序铺弦号 → 铺到当前小节」是**小节级**操作，留在页面上 |
| 铺弦号输入框 | 去 `flex:1` 改定宽 ≈320px；占位精简为「按序铺弦号：5:3 3 2 3 1 3 2 3」，「作用于当前小节」以独立常显 hint 承载（报错槽 `#strFillHint` 职责不变） |
| 未选中态 | 四组**完全隐藏**（不保留引导行）；四条「先在上方选中一个音符」提示语删除（id 是否保留以 Grep 引用为准） |
| 窄屏形态 | 本期不做底部弹层等特殊形态——锚定 + 视口夹取已天然安全；后续实报再议 |
| 编辑焦点用色 | **统一蓝**：`cur-sec`（现状即蓝）、`arg-mini.cur` 绿→蓝、edbar「编辑中」绿→蓝、编排歌词 chip 的蓝色键盘焦点保留；登记口径「发声=绿 · 编辑焦点=蓝」 |
| 小屏断点 | **复用复合查询** `(max-width:640px), (orientation: portrait), (max-height: 700px)`（与控制芯收窄同串）；只拦**入口**，不驱逐已进入者；副作用（宽而矮的桌面窗口也算小屏）与控制芯现状一致，照单全收 |
| 帮助提示 | 加：「编排曲式 / 新建节奏型仅桌面宽屏可见」；快捷键表补「小屏下 E 键无效」 |
| 品牌合规修复 | 2026-10-13 合规检查（对 docs/archive 两份品牌快照逐项比对）产出 P2×3 + P3×5，**全部执行**（批次 A1–A8） |
| 版本号 | 本批**一个版本号**（未发布连续工作只占一号，AGENTS §2 用户口径）；推送前 `git fetch` 看清 origin/main 再定，倾向 v3.50.0（含行为变更） |

## 1. 需求与事实基线

三股需求合流：

1. **品牌合规检查**（v3.49.2 会话，只读）：以 `docs/archive/beatsight-vi-manual.html` 与 `beatsight-brand-board.html`（均 v3.43.0 落地快照）逐项比对 v3.49.2 现状。可机验硬数字全部命中；失分点集中在编排/编辑两页的悬停/焦点次要状态，其中两项实锤（见 A1/A2）。
2. **用户截图反馈**（节奏型编辑页）：「铺到当前小节」旁输入框过宽（`flex:1` 吃满整行）；扫弦标注/弦区/逐弦/发声四组常驻占版面，改点音符块弹出悬浮窗。
3. **小屏收敛**（用户拍板）：编排与节奏型编辑是桌面密度的创作功能，小屏（过窄/竖屏/矮窗）直接隐藏两个入口；手机主场景是「练」，编排/节奏型**数据**照常加载与播放，藏的只是编辑入口。

事实基线（取证方式均为命令输出）：

- `const VERSION = "3.49.2"`（index.html）
- `node tools/check-all.js --quick`：**全部通过 · 实跑 18/21 项**（⊘×2 缺 node_modules、⊘×1 冒烟环境缺失、⚠×1 观察期警告不判红）
- 入口清单（Grep 全仓）：`#argOpen`（编排曲式）/ `#editBtn`（新建节奏型）两枚按钮 + 快捷键 **E**（Controls keydown → `openArrange()`，唯一调用点）；编排页内「✎ 以此型为底稿进编辑器」属页内链，不在拦截范围

## 2. 改动总览

| 批次 | 内容 | 触点 | 性质 |
|---|---|---|---|
| A | 品牌合规修复 8 项 | index.html 编排/编辑 CSS 区段 | 缺陷修复 + 样式微调 |
| B1 | 铺弦号输入框定宽 | index.html `.ed-strfill` 区段 | 用户需求 |
| B2 | 音符级选项悬浮窗 | index.html Editor 模块（标记 + CSS + JS） | 行为变更 |
| C | 测试 + 反向验证 + DOM 预算复跑 | tests/ + tools/reverse-verify-v3500.py | 质量闸门 |
| D | 小屏入口收敛 + 帮助提示 | index.html（CSS 复合查询 + E 键守卫 + 帮助两处） | 行为变更 |

全部代码改动集中在 `index.html` 单文件（仓库零运行时依赖纪律不变），加 tests/ 增补与本方案文档。

## 3. 批次 A · 品牌合规修复（8 项）

| # | 位置（快照） | 根因 | 修法 | 验收断言 |
|---|---|---|---|---|
| A1 | `.arg-pill-play:hover`（≈L2440） | 引用**全仓未定义**的 `var(--accent)`（只有日间档的 `--accent-hi`），color/border-color 两档主题下**静默失效**，悬停只剩 10% 白底（日间档白底上不可见） | 整条 hover 重写：`color:var(--green); border-color:var(--green); background:rgba(var(--green-rgb),.12)`（▶ 试听=进行中，绿语义吻合；日间随 `--green-rgb` 自动取蓝） | A6 落地后由 var() 扫描断言钉住；再由 t245 前置断言 hover 规则含 `var(--green)` |
| A2 | `.arg-item-del:hover`（≈L2459） | 写死深色档警示红 `#f3727f`，绕开 `var(--red)`——日间档 `--red:#DC2626` 时不跟随，#F3727F 在 #F2F4F8 底上对比 ≈2.2:1 不达 AA | `color:#f3727f` → `color:var(--red)` | var() 扫描不覆盖 hex 写死，由 t245 断言该规则文本含 `var(--red)` 且不含 `#f3727f` |
| A3 | `.arg-sec>.arg-sec-label`（≈L2391，标签内容由 JS 生成「段 N」） | 静态序号标签用品牌绿描边+绿字——与「绿只留给进行中/发声」（展板 Don't 第 1 条）直接冲突，同屏多段同时亮多个绿点 | 描边 `--green`→`var(--border)`、字色→`var(--t3)` | t245/t106 断言该规则不含 `var(--green)` |
| A4 | `.arg-item-del` 20×20（≈L2458）、`.arg-pill-edit`/`.arg-pill-play`（≈L2437-2439） | `span[role=button]` 热区低于 WCAG 2.5.8 AA 的 24px | arg-item-del 20→24px；pill-edit/pill-play 以 padding 撑热区 ≥24px（视觉字形不变） | t245 断言三者的生效 min 尺寸 ≥24（样式文本级 + 真机人眼） |
| A5 | `.arg-reps`/`.arg-chd-cell`/`.arg-pill-tag`/`.arg-pill-edit`/`.arg-pill-play`（≈L2418/L2421/L2436-2439） | 圆角 4px 不在展板阶梯 3/6/8/12 上 | 归并到 **3px**（时值格族） | var() 扫描不覆盖，t245 断言五条规则无 `border-radius:4px` |
| A6 | `.edcell.sel`（≈L2258）、obs 覆盖档（≈L3118）、`.arg-pill-edit:hover`（≈L2438） | 硬编码品牌色 rgba（30,215,96 / 37,99,235），违背「同源 token，改一处跟多处」 | `:root` 新增 `--green-rgb:30,215,96;`，日间档 override `--green-rgb:37,99,235;`（=#2563EB），三处改 `rgba(var(--green-rgb),x)`——obs 覆盖档随之自动正确 | **新增「未定义 CSS 变量引用」扫描断言**（并入 t131-css-orphan-cleanup）：正文样式内所有 `var(--x)` 必须有 `--x:` 定义，防 A1 类静默失效复发 |
| A7 | `.arg-mini.cur`（≈L2429）、`.edbar-label.editing .n` + `.s::after`（≈L2247-2248） | 「编辑焦点」三处三色（cur-sec 蓝 / arg-mini.cur 绿 / 编辑中绿），语义口径漂移 | 两处绿→`var(--blue)`；`cur-sec`（≈L2390）与歌词 chip 蓝焦点（≈L2728）不动。登记：**发声=绿 · 编辑焦点=蓝**（蓝与空扫虚线共用色相，属既有色板的语义复用，记入 CHANGELOG 取舍） | t245 断言两条规则含 `var(--blue)` 不含 `var(--green)`；日间 `--blue:#1D4ED8` 已定义（深色 `#4FA3E3` 深底对比足够） |
| A8 | `.editor-inner` max-width:1080px（≈L2207） | 与展板「内容最大行宽 850px」不一致，但 archive 文档不可回改 | 代码注释登记豁免：850px 口径属主界面内容带（`.viz-head-grid` 的 `--max-w`），编辑器是全屏工作面，1080px 为有意豁免 | 注释存在性并入 t245 前置断言（文本级） |

## 4. 批次 B · 编辑器改造

### B1 · 铺弦号输入框定宽（≈L3960-3964）

- `.ed-strfill` 内 `#strFillIn` 的 inline `style="width:auto;flex:1;min-width:200px"` 移除，改 CSS：`.ed-strfill .name-input{width:var(--ed-fill-w,320px);max-width:100%}`，`--ed-fill-w` 就近挂 `.ed-strfill` 作用域并注释援引展板 Do「新增尺寸先进 CSS 变量」。
- `placeholder` 改「按序铺弦号：5:3 3 2 3 1 3 2 3」；`aria-label` 保留完整语义（「作用于当前小节」不丢）。
- 新增独立静态 hint span 常显「作用于当前小节」；`#strFillHint`（role=status）**专用于报错**——两者不互斥、报错不复位问题不存在。
- 移动端 640 档 `flex-wrap` 已有，窄屏自然换行，不另做档。

### B2 · 音符级选项悬浮窗

**DOM**（标记区，≈L3927-3975）：

- 新增容器 `<div class="ed-pop" id="edPop" hidden>`，内含关闭钮 `.ed-pop-x`（≥24px 热区）与锚点箭头 `.ed-pop-arr`。
- `#dirRow` / `#zoneRow` / `#restRow` / `#strRow` **四组连 id 整体搬入**——`check-dom-ids` 只认标记里写死的 id，`$()` 接线与 harness 静态桩（tests/lib/harness.js 按 id 复刻，与父容器无关）均不受父级变化影响。
- 标记里的 `disabled` 初值与既有启用逻辑**原样保留**：弹出时机=已选中，逻辑天然自洽。
- 删除四条「先在上方选中一个音符」提示语；`dirHint`/`zoneHint`/`restHint`/`strHint` 四个 id 是否保留以 Grep 引用为准（无 JS 引用即删，`check-dom-ids` 随之通过）。

**CSS**：

- `.ed-pop{position:absolute;z-index:5;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.5);width:min(340px,calc(100% - 16px));padding:12px}`——局部 z 即可，不与全局 Modal 冲突（editor 本身是 z-index:100 的 fixed 层）。
- 出现/收起动画 `opacity + translateY(6px)` 120ms，包 `@media (prefers-reduced-motion: no-preference)`。
- `hidden` 属性初始（与 harness `HTML_ATTRS` 「标记 hidden 初始即隐藏」语义一致）。

**JS**（Editor 模块内，无跨模块回调 → R1–R4 不涉及）：

- 选中赋值处（edSel 落点）→ `openPop(cell)`：移除 hidden、`aria-expanded` 同步到块、内容 meta 更新（音符序号 · 时值名 · 拍数）。
- **定位算法**：left = 块中心 − 弹层半宽，夹取 `[8, editorWidth − popW − 8]`；箭头随块中心对位并二次夹取；纵向默认弹在跑道**下方**，若下方空间 < 弹层高 + 16 则翻到上方、箭头换边（视口夹取，窄屏天然安全）。
- **交互闭环**：点其他块 → 跟随重锚定；**再点当前块 → toggle 收起**；关闭路径共五条——✕、ESC（Editor 既有 keydown 域）、点编辑器空白（非块非弹层）、edSel 被清（撤销 / 清空小节 / 切小节 / 选中丢失）、编辑器 close()。ESC 后焦点回选中块（弹层 `role="dialog"` + `aria-label="音符属性"`）。
- `ensureStrPanel()` 惰性构建挂在**首次 openPop**（口径不变：24 节点不进首屏静态 DOM）。
- DOM 预算：+wrapper +close +arr ≈ **+3 节点**，复跑 smoke 的 domNodes ≤1300 确认。

## 5. 批次 C · 测试与反向验证

**新增用例**（下一个可用编号 t245-，命名沿用现风格）：

- `tests/cases/t245-editor-popover.js`：
  1. 初始态四组行不可见（`#edPop` hidden）且标记中仍带四个 id；
  2. 点块 → 弹层显示、块带选中环、meta 正确、四组 pill 可交互（dirRow 三档 aria-pressed 通路不变）；
  3. 点另一块 → 跟随（left/箭头变化、meta 更新）；再点当前块 → 收起；
  4. ✕ / 空白点击 / edSel 清空（撤销路径）→ 收起；
  5. 铺弦号行不受影响：输入框定宽样式存在、placeholder 新文案、报错仍走 `#strFillHint`；
  6. A1–A8 的样式文本级断言（§3 表内逐条）。
- `tests/cases/t246-compact-entry.js`：
  1. 复合查询规则存在且查询串与控制芯那条**逐字符一致**（CSS 文本级，t101 对 `@media` 断言的先例）；
  2. 规则覆盖 `#argOpen,#editBtn{display:none}`；
  3. E 键守卫：matchMedia 存在时小屏命中不调 openArrange（matchMedia 桩），不存在时按桌面放行（沙箱降级路径）；
  4. 帮助页两处提示文案存在。
- `tools/check-docs.js`/t131 侧：未定义 var() 扫描并入 t131（见 A6）。

**既有用例回归**（结构预期零迁移，全量跑确认）：t47（dirRow 三档与禁用逻辑）、t114（restRow toggle + 空扫通路）、t240c（strRow 子结构手工构建）、t242（编辑器模板）、t71/t106（编辑器/段卡片）。`tests/README.md` 的 harness 桩契约说明补一句「四组行住进 #edPop，桩按 id 不变」。

**反向验证**：`tools/reverse-verify-v3500.py`，三个变异点各须出现**具名 ✗**（崩溃不算证据）：

1. 还原 A1（`var(--green)` 改回 `var(--accent)`）→ t131 未定义变量断言红；
2. 还原 A2（改回 `#f3727f`）→ t245 的 A2 断言红；
3. 注掉 openPop 调用 → t245 用例 2 具名 ✗。

登记进 `python3 tools/reverse-verify.py --list`。变异只改 /tmp 副本，锚点失配大声失败。

**收尾**：`node tools/gen-index.js --write`（index.html 增删行后必跑）→ `node tools/check-all.js` **全量** → `git status --porcelain` 干净（add 清单：index.html / tests/cases/t245 / t246 / tests/README.md / tools/reverse-verify-v3500.py / tools/reverse-verify.py 登记 / 本文档 / docs/README.md）。

## 6. 批次 D · 小屏入口收敛

- **CSS**：新增 `@media (max-width:640px), (orientation: portrait), (max-height: 700px){ #argOpen,#editBtn{display:none} }`，查询串与控制芯收窄那条（≈L326）**逐字符一致**并注释互引；左栏顶部同排的 #earBtn/#loopPanel/#presetCount 排布留人眼复核。
- **JS**：E 键守卫（≈L14984，`openArrange` 的唯一调用点）——`matchMedia` 同串判断，命中小屏则 return；matchMedia 不存在（测试沙箱）按存在性判断降级为桌面放行（L9190 先例口径）。守在调用点，`openArrange()` 函数本身不动。快捷键说明（帮助「键盘快捷键」节，≈L4525）补注「小屏下 E 键无效」。
- **帮助**：「先分清两个编辑入口」节（≈L4234）加一句 help-tip：两入口仅桌面宽屏可见，小屏仍可播放/练习全部内容。
- **边界**：断点只拦入口，已打开的编排/编辑器不强制关闭（保护进行中的编辑）；下次进入才受限。

## 7. 版本与交付

- 版本号：推送/发布前 `git fetch` 后定（多机并发纪律，AGENTS §5.1）；本批倾向 **v3.50.0**。`check-version.js` 三处一致性与 `package-lock` 同步照常。
- CHANGELOG 一条条目（同日同功能面合并口径），分节写：品牌合规修复（含 var(--accent) 静默失效实锤与修复）/ 编辑器悬浮窗（根因：四组常驻占版面 → 修法 → 取舍：小节级行留页面、toggle 收起）/ 小屏入口收敛（取舍：不驱逐已进入者、宽矮窗口算小屏）。
- 提交纪律：commit message 根因→修法→取舍→自验数字；**默认不 push**，`pre-push` 钩子会强制 `npm run publish:check`。
- 流程顺序：`node tools/write-lock.js --acquire "plan-v11"` → 批次 A → B1 → B2 → D → C → gen-index → check-all 全量 → 报告，等待本人决定提交。

## 8. 人眼验收清单（冒烟测不出，交本人）

1. 悬浮窗弹出手感、遮挡范围、贴边翻转（含最左/最右块）；
2. 再点当前块收起、点空白关闭的直觉性；
3. 铺弦号定宽后的行排布（含 640 档换行）；
4. 圆角 4→3 观感、「段 N」中性色观感、编辑焦点蓝的辨识度；
5. 小屏（≤640 / 竖屏 / 拉矮窗口）入口隐藏 + E 键无效 + 左栏同排排布；
6. 涉及逐弦面板的首开惰性构建在弹层内的展开效果。

## 9. 风险与回滚

- 改动集中单文件 + tests + 文档，回滚 = revert 单提交。
- 最大风险：编辑器 DOM 搬移碰坏 harness 静态桩与既有用例——t47/t114/t240c 回归兜底，桩按 id 建与父容器无关（已核对 harness.js ≈L149-165）。
- 次风险：DOM 预算贴线（smoke domNodes ≤1300）——本批 +3 节点，复跑确认；超线则把 `.ed-pop-arr` 改 CSS 伪元素（-1 节点）。
- 文档纪律：本方案入 docs/archive 并登记 `docs/README.md` 快照表；落地后仅回写状态横幅，其余内容不改。
