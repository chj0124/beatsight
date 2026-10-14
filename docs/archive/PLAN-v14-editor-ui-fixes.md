# 节奏型编辑界面四项修正 · 执行方案（PLAN-v14）

> **状态：已落地（v3.53.3）· 历史快照**（2026-10-14 拍板，同日落地）——原为「历史快照 · 待实施」，施工完成后按 PLAN-v13 同款口径改为「已落地」。施工后记见文末 §11。
> 行号均为 v3.53.2 快照（HEAD `6a694aa`），动手前以 Grep 现查为准；实际落地版本号 v3.53.3（推送前 `fetch` 确认远端 `main` = `6a694aa` 后定，AGENTS.md §5.1-3）。

## 0. 拍板摘要

用户就三张实拍图报了 5 个问题，2026-10-14 逐项拍板：

| # | 问题（实拍图） | 拍板 |
|---|---|---|
| 1 | 图一：空态引导三行文案贴轨道上下边缘 | 压缩引导层自身排版（行高/字号），不动轨道高度 |
| 2 | 「撤销」按钮在页面顶部、离编辑区太远 | 移回网格下方 `.ed-actions` 行首位，形态改为**图标 +「撤销」** |
| 3 | 图二：「选模板」触发框比原生弹层宽；左侧「模板」标签多余 | **收窄触发框**（max-width + 省略号，不自绘下拉）；删除「模板」标签 |
| 4 | 图三：弹层「弦区」三档换行 | **只在 `#edPop` 作用域**收紧 pill 内边距/字号 |
| 5 | 型级「标注」与曲式编排页和弦名是否冲突 | 查证**不冲突**（两条数据通路隔离，见 §1），按拍板忽略、不改 |

## 1. 事实基线（取证 2026-10-14，v3.53.2）

- `const VERSION = "3.53.2"`（L5007）；`wc` 实测 index.html 25,132 行 / 2,135,219 B；`git status --porcelain` 干净。
- **问题 5 证据链**（结论：隔离，无冲突）：
  - 型级标注存 `customs[].label`（编辑器 `#patLabelInput`，L4101）；
  - `labelChipsAtRow`（L11280-11295）**首行** `if (S.playMode === "arrange") return [];`——型标注胶囊在曲式模式完全不渲染；
  - 曲式模式和弦来自**块级** `block.chords`（`chordAtRow` L11231-11268，v2.75/v2.77 设计「和弦跟块走不跟型走」），在段编辑视图逐小节和弦格编辑，存曲式数据、不存型上；
  - 渲染合流点二选一（L11703-11706：`labChips.length ? labChips : arrChips`），两条通路不会同屏；编排页换型候选列表只显示型名，不露标注。
  - 语义：同一条带标注的型，预设模式贴标注、曲式模式**隐形**（不是被覆盖，是设计如此）。若将来想「编排页也带出型标注」，那是新需求（需定义与块级和弦的优先级），不是本批缺陷。

## 2. 改动一（图一）：空态引导排版

**根因**：`.ed-guide`（L2346-2349）绝对定位 `inset:0` 铺在 `.edtrack`（恒高 64px，L2273）内。三行文案（标题 13px + 两行 12.5px，行高 1.8，gap 2px×2）合计 ≈72.4px > 64px，`justify-content:center` 使溢出上下均分——文字各溢出 ≈4px，视觉上贴死上下边缘。

**修法**（纯 CSS，压缩排版使三行 ≈59px ≤ 64px，上下各留 ≈2.6px 呼吸）：

```css
/* L2346-2349，改 font-size / line-height 两处；.ed-guide-t 字号 13→12.5 */
.ed-guide{position:absolute;inset:0;display:flex;flex-direction:column;gap:2px;
  align-items:center;justify-content:center;text-align:center;pointer-events:none;
  font-size:12px;line-height:1.5;color:var(--t3);padding:0 12px}
.ed-guide .ed-guide-t{font-size:12.5px;font-weight:600;color:var(--t2)}
```

**为什么不增高轨道**：`draftEmpty`（L17663-17665）=「全部小节都是空数组」，用户在首填前可以「＋加小节」造出**多个全空小节**，而引导层只挂首个空小节（L17951 `showGuide && b === 0`）——只给首行增高会出现 84/64 混排的行高跳变。排版压缩对任意行数都成立。

**兜底**（人眼验收仍觉贴边再上，不进首批）：`gap 2→0` + `line-height 1.5→1.45`（≈55px，上下各 ≈4.5px）。

**窄屏注意**：② 行 ≈23 字，390px 档轨道 ≈250px 内可能折行（现状 12.5px 同样折，属既有行为，非本批引入）；验收含 390px 人眼复核，若需另收窄屏字号，按 @media 单独一档再议。

## 3. 改动二：撤销钮归位 + 图标

**根因**：`#undoBtn` 在顶栏 `.editor-actions`（L3960，与「试听」同排），隔了卡片头与音符块库才到编辑区。它是 PLAN-v13「整稿级动作住顶栏」口径（注释 L3993、t258a 断言）的产物——本次用户实拍推翻该口径：**撤销是高频恢复动作，要跟网格走**。

**修法**：

1. 从 L3960 删除顶栏那颗；顶栏 `.editor-actions` 只剩「试听」。
2. 在 `.ed-actions`（L3992，网格下方「＋ 在其后加一小节 / − 删当前小节 / …」行）**首位**插入：

```html
<button class="pill outline" id="undoBtn" disabled aria-label="撤销上一步草稿修改（Ctrl+Z）"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14 4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>撤销</button>
```

3. CSS（放 `.ed-actions` 规则 L2287 附近；`#rhyPillRow .pill` 同款 inline-flex 先例）：`#undoBtn{display:inline-flex;align-items:center;gap:6px}`。
4. 注释同步：L3993「整稿级『撤销』移去顶栏」改写为本次口径（★ 用户实拍：撤销离编辑区太远 → 归位网格下方，图标 + 文字；顶栏只留过程动作「试听」）。

**不动的东西**：`id="undoBtn"` 不变（check-dom-ids / harness 桩 / 接线全按 id 走）；JS 接线零改动（禁用态同步 L18075、click→undo L18260 均按 id）；`Ctrl+Z` 键盘路径不变；`.editor-actions` 的 CSS（flex:none 不变量，t201f 钉着）不动。

**文档同步**：DEVELOPMENT.md L372-373「作用域分区」段改写（撤销：顶栏 → 网格下方），回归行补 t259。

**注意**：`.ed-actions` 在源码有**两处**（L3992 小节工具行 / L4081 弹层内删除钮行），断言与改动都以**首处**为锚（`html.indexOf('<div class="ed-actions">')` 命中 L3992）。

## 4. 改动三（图二）：模板下拉收窄 + 删「模板」标签

**根因**：`#editorTplSel` 是原生 `<select>`，触发框宽度由**最长选项**（「内置 · 十六分满扫（《在他乡》前奏）」等）撑出 ≈270px；展开后的原生弹层宽度走**浏览器自带测量**，与触发框不共用一条路径——用户实机上弹层比触发框窄。页面 CSS 管不到原生弹层，「严格同宽」只有自绘下拉一条路（已否决：可达性/DOM 预算/测试面代价大）。

**修法**（收窄触发框，使「触发框 ≤ 弹层」观感统一）：

1. CSS（放 `.ed-meter` 规则 L2238 附近）：

```css
/* 触发框收窄：最长选项撑宽的 ≈270px 收到 200px，溢出省略；原生弹层宽度由
   浏览器测量（≥触发框），两侧观感统一。只作用模板下拉，拍数下拉不动。 */
.ed-tpl .loop-sel{max-width:200px;text-overflow:ellipsis}
```

2. HTML（L3954-3957）：删除 `<span class="lab">模板</span>`——下拉自带「选模板…」占位与「内置 · 名」选项文案，自描述成立；aria-label（「模板：当前底稿…」）完整保留。`#edTplWrap` 外壳与 `.ed-tpl` class 不动（空态 .guide-ring 挂点，L18196-18203）。
3. 引导文案 ①（L17957）：`"① 顶栏「模板」下拉，一键载入整套节奏型"` → `"① 顶栏「选模板」下拉，一键载入整套节奏型"`——标签已删，指名改成用户实际看到的占位文案。

**边界**：原生弹层宽度随平台渲染器而变（Chrome/Firefox/Safari 各不同）；收窄后若用户实机仍见不一致，属平台原生行为，如实回报——彻底统一只有自绘下拉（本批不做）。

## 5. 改动四（图三）：弹层弦区三档单行

**根因**：`#edPop` 宽 `min(340px, 100%−16px)`、左右 padding 12 → 内容区 ≈314px。弦区行 = 「弦区」hint + 三颗 pill（`.pill` 全局：`padding:9px 16px;font-size:13px;min-height:40px`，L1653）+ 空 `#zoneHint` 仍占两侧 gap（`.ed-dir{gap:10px}`）——合计 ≈406px ≫ 314px，第三颗必然换行。弹法行四颗短 pill ≈297px 恰好放下，所以只有弦区行破。

**修法**（全部限定 `#edPop` 作用域，全局 `.pill` 与按钮文案一字不动——帮助页声明弦区释义与按钮文案逐字对应，L4576-4580）：

```css
/* 放 L2324（.ed-pop .ed-dir 规则）之后 */
#edPop .pill{padding:5px 8px;font-size:11.5px}   /* 弦区三档一行放下；min-height:40 触控下限不动（DEVELOPMENT.md「触控下限」不变量） */
#edPop .ed-dir{gap:8px}
#edPop .hint:empty{display:none}                 /* 空 hint 不占 gap（.loop-panel .hint:empty 同款先例 L2123） */
```

**宽度预算**（CJK 按等宽估，误差 ±5px，真机截图复核）：

| 项 | 宽 |
|---|---|
| 内容区（340 − 边框 2 − padding 24） | 314px |
| 全扫（默认） | 6 字 ×11.5 + 16 ≈ 85px |
| 低弦区 ④⑤⑥ / 高弦区 ①②③（各一） | ≈6.3 字 ×11.5 + 16 ≈ 89px |
| 「弦区」hint（12px ×2 字） | 24px |
| gap 8px ×3（空 hint 已 display:none） | 24px |
| **合计** | **≈311px ≤ 314px** |

余量仅 ≈3px，**兜底**：真机仍换行则字号 11.5→11（余量 ≈14px）。同弹层其他行（弹法四档 / 方向 / 手部 / 发声）在新尺寸下均 ≲210px，不受影响；`#delStepBtn` 同步收小，弹层内观感一致。

## 6. 测试与反向验证

**新增 `tests/cases/t259-editor-ui-fixes.js`**（沿用 t258 风格：源码结构钉 + 行为回归 + CSS 钉）：

- **T259a 结构钉**：`edActionsAt < undoAt < popAt`（撤销在首个 `.ed-actions` 内、`#edPop` 之前）；`html.indexOf('id="undoBtn"', editorActionsAt) < 0`（顶栏不再有）；undoBtn 切片含 `<svg` 且文字含「撤销」。
- **T259b 模板区**：`#edTplWrap` 切片无 `class="lab"`；引导层文案含「选模板」（① 措辞更新后的锚）。
- **T259c CSS 钉**（t201f「CSS 不变量」先例）：`.ed-tpl .loop-sel` 规则含 `text-overflow:ellipsis`；`#edPop .pill{` 规则存在；`.ed-guide` 规则块含 `line-height:1.5`。
- **T259d 行为回归**：openBlank → 摆一块 → `undoBtn.fire("click")` 撤销仍生效（换宿主接线不变）+ 禁用态随栈长同步。

**改写 `t258-editor-scope-layout.js`**：T258a 三条撤销相关断言反转（撤销在 `.ed-actions` 首位 / 顶栏无 / 不在弹层 `.ed-actions`），注释块「撤销 = 整稿级动作，住顶栏」改为「撤销 = 高频恢复动作，随网格走（2026-10-14 用户实拍推翻 v3.53.2 口径）」；T258b 行为断言保留、文案「顶栏撤销」改「网格下方撤销」；T258c 不动。

**登记**：tests/README.md 分组表（L229-230 附近）更新 t258 描述 + 增 t259 行。

**反向验证**（`tools/reverse-verify-vNNN.py`，NNN = 届时版本号三段去点；三条铁律：变异只改 /tmp 副本、必须出现具名 ✗、锚点失配大声失败）：

| 变异 | 目标断言变红 |
|---|---|
| M1 撤销钮挪回顶栏 | T259a |
| M2 恢复「模板」lab span | T259b |
| M3 删 `#edPop .pill` 规则 | T259c |
| M4 `.ed-guide` 行高回 1.8 | T259c |

CSS 类变异（M3/M4）走 t201f 同款「源码字符串替换 → CSS 钉断言红」路径；跑法 `python3 tools/reverse-verify.py --only=vNNN`。

## 7. 文档与闸门同步

| 项 | 动作 |
|---|---|
| DEVELOPMENT.md L372-373 | 「作用域分区」段：撤销位置口径改写，回归行补 t259 |
| tests/README.md | 分组表更新（§6） |
| docs/README.md | 本方案已登记快照表；落地后状态格翻「已落地」 |
| `node tools/gen-index.js --write` | index.html 增删行后必跑（模块索引行号，check-docs 第 1 项） |
| `tools/check-size-budget.js` | 净增估算 ≈ +0.8KB（SVG ≈0.35K + CSS ≈0.5K − lab ≈0.04K）；超限则按仓规显式抬高 `BUDGET_BYTES` 并在 CHANGELOG 写明理由 |
| smoke domNodes | 净 +2 节点（svg+2 path −1 span），预算 ≤1300 贴线，跑完看数 |
| smoke editorHeader 探针 | 顶栏 `.editor-actions` 只剩「试听」，判据 `btns.length >= 1`（v3.49.1 已放宽）仍绿，探针不动 |
| 帮助正文 | 已核对（L4463-4472 段）：无「撤销按钮位置」「模板标签」指路，零改动 |
| CHANGELOG | 推送前定版本号后写一条（同一功能面同日合并口径）：根因 → 修法 → 取舍 → 自验数字（轨道余量 / 弹层行宽 / 体积增量的实测值） |

## 8. 执行顺序

0. `node tools/write-lock.js --acquire "PLAN-v14"`；`git status --porcelain` 为空 + `gh api` 对齐远端 HEAD。
1. index.html 四项一次改完（§2-§5）→ `node tools/gen-index.js --write`。
2. t259 新增 / t258 改写 / DEVELOPMENT.md / tests/README.md 同步。
3. `node tools/check-all.js --quick` 迭代 → 全量（含 ⊘ 项如实记账）。
4. 反向验证脚本落盘 + 复跑四变异，各出具名 ✗。
5. 人眼验收（用户）：§9 清单 + 390px 窄屏复核。
6. `git fetch` → 定版本号 → CHANGELOG + `check-version` 对齐 → `git status` 复核 add 清单。
7. 报告并等本人拍板提交（默认不 push）。

## 9. 验收标准

| 项 | 判据 |
|---|---|
| 图一 | 引导三行均在 64px 轨道内，上下各 ≥2px 呼吸（截图实测像素） |
| 撤销 | 位于「＋ 在其后加一小节」左侧；图标 +「撤销」；点击与 Ctrl+Z 同效；未改动时禁用 |
| 图二 | 触发框 ≤200px，占位「选模板…」完整可见；**用户实机**确认触发框/弹层观感统一 |
| 图三 | 弦区三档单行（1080 桌面与 390px 两档截图实测） |
| 机器 | check-all 全绿；t259 全绿；反向验证 4 变异各出具名 ✗ |

## 10. 风险与边界

1. **原生 select 弹层宽度不可控**：收窄只保证「触发框 ≤ 弹层」的多数平台观感；用户实机若仍不一致，如实回报并说明这是原生行为（自绘下拉为唯一彻底解，已否决）。
2. **估宽误差**：§5 预算按 CJK 等宽近似（±5px），余量 3px 偏紧——已备 11px 降档；不做「预防性再收」，以真机截图为准。
3. **口径反转的传染面**：本次推翻 PLAN-v13「撤销住顶栏」——t258 教义、DEVELOPMENT.md、L3993 注释三处必须同一批改齐，漏一处则下轮 Agent 按旧文档改回（本仓已发生过两份规则打架的先例）。
4. **DOM/体积预算贴线**：净 +2 节点 / +0.8KB，两项都长期贴线——跑完 check-all 看实际数，超了按仓规显式抬门槛并留痕，不静默绕过。

## 11. 施工后记（2026-10-14 落地 v3.53.3）

- **落地内容**：§2–§5 四项一次改完，无偏离。撤销钮归位后形态为 SVG 图标 +「撤销」（`#undoBtn{display:inline-flex;align-items:center;gap:6px}`），`id` 与 JS 接线未动。
- **自验数字**（工具输出）：tests **8657 PASS / 0 FAIL**（新增 T259 共 18 条断言，改写 T258 口径反转）；反向验证 `reverse-verify-v3533.py` **4/4 命中**、0 未命中、0 自身腐烂；`check-all --quick` 全绿（18/21 实跑，⊘ ESLint / tsc / 浏览器冒烟按环境未执行）。体积 **2,138,541 B**（预算 2092KB = 2,142,208 B，余量 ≈3,667 B）；行覆盖率 **97.7%**（总阈值 97%）。
- **与方案的偏差**：无功能性偏差。一处实现细节——反向验证 M1（撤销挪回顶栏）最初以 `<div class="editor-actions">` 为锚，实测它在文件里出现**两次**（编辑器顶栏 + 听辨浮层），改为用唯一短语「撤销钮已归位到网格下方」定位插回点（触发「锚点非唯一」大声失败，符合铁律）。
- **反向验证脚本后缀说明**：`reverse-verify-v3533.py` 用 `.py`（统一入口 `tools/reverse-verify.py` 只枚举 `.py`，`.js` 版本不被 `--list` 清点）；近期 v3531 / v3532 用 `.js`（Windows 沙箱无 Python 运行时）——本轮沙箱有 python3，取「留在统一入口管辖内」优先，故用 `.py`。
- **待真人验收**：§9 四项人眼清单未执行（沙箱无浏览器）——图一像素呼吸、图二触发框/弹层观感统一、图三弦区单行，需真机截图确认；弹层弦区预算余量仅 ≈3px，真机若仍换行按 §5 兜底降字号到 11px。
