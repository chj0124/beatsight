# 控制区重构 · 居中控制芯 · 实施方案

> **历史快照 · 已归档** ｜ 撰写基线：v3.39.2（HEAD 98f6b07 系）｜ 行号为撰写时快照，动手前以 `Grep` 重查为准
> 落地状态以 `CHANGELOG.md` 对应条目为准（版本号在 fetch 后定，预期 v3.40.0）。
> 配套视觉方案：`间距调整示意图.html`（间距修正）+ `整体布局方案示意图.html`（芯形态，桌面+移动）

## 0. 拍板记录（定稿参数，不再开放讨论）

| 项 | 定稿 |
|---|---|
| 桌面形态 | 单芯居中：`max-width:402px; margin:0 auto`，中轴 = 跑道中轴 |
| 滑杆长度 | 432 → **340**（三根等长；微调余地 280–380，实施后按观感可二次调） |
| 开关形态 | 三枚胶囊横排一行（预备·N拍 / 静音 / 变速），替换组标签行；参数点击胶囊弹浮层 |
| 变速读数 | **留芯底**（拒开原因的就地反馈通道，不迁胶囊） |
| 间距修正 | BPM 行盒 40px（移动 36px）、BPM 塔内 gap 6→13px（两端同批） |
| 移动端 | 参照同批：全宽芯（326 内容宽，滑杆 232 不变）；`.ctl-pills` 与新胶囊行统一；默认收起口径不变 |
| 退役口径 | 开关纵排三行、两列网格、组标签「音量 · 速度 BPM · 范围 30–240」、开关列容器 |
| 不动 | 跑道、顶栏、底栏、所有元素 id 与模块接线（搬块不换 id） |

## 1. 目标形态规格

### 1.1 桌面（≥1280）

```
            ┌──────── 402px 居中芯 ────────┐
[预备 ⬤ 4拍] [静音 ⬤] [变速 ⬤]          ← 胶囊行 ~36px
节拍 ▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 340      ← 行盒 40px
扫弦 ▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 340
BPM  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 340
     [-5][-1] 96 [+1][+5]           ← 步进群 47px（gap 13）
当前 96 BPM · 第 1/7 步             ← 读数行 18px
            └──────────────────────────┘
```
芯高 ~275px；芯左缘 x = 主列中轴 − 201。

### 1.2 移动 / 堆叠档（<1280）

同构全宽芯（内容宽 326，滑杆 232）；收起态 = 胶囊行常驻（含「BPM 96 ▾」折叠读数钮），展开 = 胶囊行 + 滑杆塔；开关组整块消失（控制区 ~470 → ~250px）。

### 1.3 间距基准（两端同律）

| 可见间距 | 桌面 | 移动 |
|---|---|---|
| 节拍↔扫弦（基准） | 44 | 36 |
| 扫弦↔BPM（= 基准） | 44（修 ①） | 36（修 ①） |
| BPM↔步进群 | 30（修 ②） | 28（修 ②） |

## 2. 现状代码地图（改动锚点）

### 2.1 HTML（index.html）

| 块 | 行号 | 动作 |
|---|---|---|
| `#ctlOpen` checkbox | 3083 | 保留（收起对象改语义：藏滑杆塔） |
| `.ctl-pills` 折叠胶囊（#volPillPctN/#bpmPillNumN） | 3089–3091 | 统一改造：折叠读数钮「BPM 96 ▾」 |
| `.card-head-left > .group > .group-label`（组标签） | 3107 | 退役，位置让给胶囊行 |
| `.tg-body`（音量/BPM 塔主体） | 3127–3177 | 保留全部 id；`.vol-row` ×2 + `.slider-row`（BPM 塔）+ `#trainerProg` |
| `.viz-toggles` 开关列 | 3200–3246 | **容器退役**；内部五块搬进浮层（见 3.2） |
| `#muteCfgPanel` / `#trainerPanel` 参数面板 | 3228 / 3240 | 搬块不换 id，进浮层壳 |

### 2.2 CSS

| 规则 | 行号 | 动作 |
|---|---|---|
| `.ctl-pills` 基础/窄屏/通栏 | 257 / 360 / 2933 | 统一为新胶囊行口径 |
| `#ctlOpen` 折叠联动 | 277–307 | 选择器目标改为滑杆塔 |
| `.bpm-slider-row` | 384 | **修 ①**：+`min-height:40px` |
| `.slider-row`（塔容器） | 1359 | **修 ②**：`gap:6px→13px` |
| `.viz-toggles` 系列 | 1477–1506 | 随容器退役（保留 `.toggle-pill` 基础规则） |
| `.tg-row/.tr-panel` 布局 | 1503–1571 | `.tr-panel` 进浮层后改定位 |
| 网格 `grid-template-columns` | 452–460 | 退役 → 单列居中（`display:block; max-width:402; margin:auto`） |
| `--tg-align-top` 补偿（44/117/2942） | 175/2704/2942 | 开关列消失 ⇒ 补偿体系整体退役 |
| `.preset-drawer`/`.pd-mask` | 566/574 | **参考模板**：浮层复用其 fixed/mask/hidden 模式 |
| 移动断点组（≤640/≤1439.9） | 319–400 等 | 逐条过：涉及开关列/双胶囊的规则退役或改写 |
| `.viz-head-grid` 容器查询/min-w 变量 | 175 | `--min-w-sw` 等随网格退役 |

### 2.3 JS（接线零改动为原则）

| 函数 | 行号 | 动作 |
|---|---|---|
| `bindToggle(id, flip, after)` | 14000 | **零改动**（胶囊就是 `button.toggle-pill`，id 不变） |
| `syncParamSlots()` | 7998–8014 | 显隐逻辑改挂浮层壳（`hidden` 语义不变）；`#trainerProg` 显隐改挂芯（不再跟随 trainerPanel） |
| `openParamSlot(name)` | 8016 | 语义保留 = 打开对应浮层（拒开路径的反馈通道） |
| `Trainer.updateProg()` | 13993 | **零改动**（#trainerProg 留芯底） |
| 变速拒开 `openSlotForTarget` | 13454–13458 | 调 `openParamSlot`，目标 DOM 变了但函数体不动 |
| 折叠胶囊读数（#volPillPctN 等） | sync 处 | BPM 读数保留进折叠钮；音量 % 读数随 .ctl-pills 改造取舍 |

### 2.4 测试影响面（19 文件 + smoke）

**smoke.js**：`volBpmDelta`/`volBpmLeftDelta`（L2273/2280，断言 3250–3257，互比口径**不改**，数值随 340 自动适配）｜「开关行右移」断言（L2144 注释处，**退役或改写**为胶囊行位置断言）｜390 窄屏探针（L2376+）与多视口循环（L2479：390–1440 十二档）逐条过｜`bpmNum` 尺寸断言（L4281，**不动**）。

**tests/cases**（grep `viz-toggles|tgSwitchRow|ctl-pills|ctlOpen|countInToggle|trainerToggle` 命中 19 文件，另加 grep 未命中但直接相关的 t230）：**t230（BPM 塔布局——批 1 间距修正与批 2 滑杆 340 直接受影响，重点更新）**、t90（vol-row 源码钉）、t229（控制合并）、t192（日间布局）、t177（headgrid 对齐）、t173（布局解耦）、t168/t163（param slot）、t167（触控目标）、t142/t137（trainer/loop 面板）、t13、t110、t24、t30、t37、t175、t180、t195、t215 —— 每文件先跑一遍分拣「断言退役 / 数值更新 / 不受影响」，再动手。

## 3. 分批实施清单

> 原则：每批收尾 `node tools/check-all.js --quick` 必绿、`git status` 干净、独立 commit；全量自验在最后一批后跑。

### 批 0 · 前置（半小时级）
1. `node tools/write-lock.js --acquire "控制芯重构"`
2. `git status --porcelain` 为空 + `gh api repos/chj0124/beatsight/commits/main --jq .sha` 对齐 HEAD
3. 基线：`node tools/check-all.js`（全量）记录绿项清单
4. 本方案登记：按 AGENTS §2「新增文档先判类」，本文件进 `docs/archive/`（带历史快照横幅）并登记快照表

### 批 1 · 间距修正（独立可交付，纯 CSS）
1. `.bpm-slider-row` 基础规则加 `min-height:40px`；≤640 档同步 `36px`（对齐 `.vol-row` 移动档口径，index.html L326 附近同批位）
2. `.slider-row` 的 `gap:6px → 13px`
3. 验收：临时测量脚本（复用本次会话的 CDP 探针法）量三档可见间距 = 44/44/30（移动 36/36/28）；smoke 全绿
4. 反向验证①：`/tmp` 副本去掉 min-height → 间距断言红；去掉 gap 13 → 红
5. commit：`fix: BPM 行盒与音量行同构 + 塔内间距 13px（间距两问题收口）`

### 批 2 · 芯结构重排（本方案主体，HTML+CSS 一次到位）
按顺序改，保持每步文件可解析：
1. **胶囊行**：`.group-label` 位置换为三枚 `button.toggle-pill`（`#countInToggle`/`#muteToggle`/`#trainerToggle`，DOM 搬块不换 id；预备胶囊内嵌 `#countInBeats` 同现状）
2. **浮层壳**：新增 `.tg-flyout`（fixed 定位、`.pd-mask` 同款遮罩可选配、点外关闭 + Esc + 开一关一）；`#muteCfgPanel`（含 `#muteEvery/#muteCount/#muteRandomToggle`）与 `#trainerPanel`（含 `#trTarget/#trStepInp/#trEvery`）整块搬入
3. **开关列退役**：`.viz-toggles` 容器与 `.tg-body` 壳删除，`#tgSwitchRow` 解散
4. **桌面芯**：`@media (min-width:1280px)` 内网格规则 → `.viz-head-grid{display:block}` + 芯容器 `max-width:402px;margin:0 auto`；`.viz-head{display:contents}` 退役
5. **滑杆 340**：`.viz-head-grid .card-head-left .group .tg-body{max-width:520px}`（L243）→ 芯口径 402（52+10+340）
6. **清理**：`--tg-align-top`/`--tg-align-shift` 体系、`.sw-line`/`.countin-line` 布局规则、`--min-w-sw`
7. `node tools/gen-index.js --write`（**必跑**，模块行号漂移）
8. 验收：check-all --quick 绿（受影响断言在本批内同步更新，见 §2.4 分拣结果）
9. commit：`refactor: 控制区重构为居中控制芯（开关胶囊化+参数浮层，桌面/移动同构）`

### 批 3 · 移动端参照与 .ctl-pills 统一
1. ≤1439.9 档：堆叠态改全宽芯（结构已同批 2，只清残余断点规则）
2. `.ctl-pills` 改造：折叠态 = 胶囊行 + 「BPM 96 ▾」读数钮（`#bpmPillNumN` 保留，音量 % 读数 `#volPillPctN` 退役或并入，二选一在批内定）；`#ctlOpen` 联动选择器改「藏滑杆塔」
3. 默认收起口径**不变**（行为变更不在本批）
4. 验收：390 探针绿；真机走查收起/展开
5. commit：`refactor: 移动端全宽芯 + 折叠胶囊统一（收起=胶囊行常驻）`

### 批 4 · 测试补全与反向验证
1. 新用例 `t231-control-core.js`（下一可用编号以 `Grep "t230-|t231-" tests/cases/` 现查为准）：
   - 芯宽度 402 / 居中（左右缘差 ≤2）
   - 胶囊行三枚 id 与 `role="switch"` 接线
   - 浮层开合（`openParamSlot` 路径 + 点外关闭）
   - 拒开原因仍落在 `#trainerProg`（t142 口径延伸）
   - 三滑杆等长（volBpm 互比口径的桩内版本）
2. 反向验证②（`/tmp` 副本变异，全走 `tools/reverse-verify.py` 登记）：
   - 删芯 `max-width:402` → 居中断言红
   - 删胶囊行 → 接线断言红
   - 浮层 `hidden` 逻辑反转 → 开合断言红
3. 覆盖率：分节 ≥90% / 总体 ≥97%（`check-all` 报数为准）
4. commit：`test: 控制芯用例 t231 + 反向验证两条`

### 批 5 · 收尾
1. `node tools/check-all.js`（**全量**）+ `npm run publish:check`（若走发布）
2. CHANGELOG：结构级条目，按「根因 → 修法 → 取舍 → 自验数字」写清 v3.19.0/v3.22.0/v3.39.0 拍板反转的演进理由
3. 版本号：**fetch 后定**（§5.1-3；建议 minor：v3.40.0）
4. 人眼验收清单（§3.5 纪律，冒烟测不出手感）：
   - [ ] 桌面 1280/1440/1920 三档：芯居中、滑杆观感、浮层开合
   - [ ] 真机移动端：收起/展开、浮层触控、练习网格首屏位置
   - [ ] 变速全流程：开 → 爬坡读数 → 拒开（清空目标再开）
   - [ ] 键盘：Tab 序（胶囊 → 滑杆 → 步进）、Esc 关浮层
5. `node tools/write-lock.js --release`

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| 单文件大重排，git 无法合并（§5.1-1） | 全程持锁；批 2 一次成型不拆小 commit 拖中间态 |
| 19 测试文件分拣量大 | 批 2 动手前先跑分拣清单（§2.4），退役断言在 commit message 里逐条列名 |
| 浮层是新交互面（点外关闭/Esc/焦点返回） | 复用 `.pd-mask` 成熟模式；键盘路径进 t231 |
| `--tg-align-top` 退役牵连日间主题（t192） | 批 2 内同步改写，不留半套补偿 |
| 观感类回归（滑杆 340 是否合意） | 参数已留 280–380 微调余地；人眼验收后再定，不追加批次 |
| 行号漂移 | 本文档所有行号动手前 `Grep` 重查；文档头部已声明 |

## 5. 明确不做（防 scope 蔓延）

- 桌面折叠能力（芯常驻，折叠是移动端口径）
- 默认收起的行为变更（维持现状）
- 跑道 / 顶栏 / 底栏任何改动
- 变速读数迁胶囊（已拍板留芯底）
- 开关以外的浮层化（音量/BPM 滑杆保持常驻）
