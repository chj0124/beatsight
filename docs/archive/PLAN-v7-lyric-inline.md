# 歌词显示位置重设计 · 伴随节奏 / 底部 双模式（PLAN-v7）

> ✅ **状态：已落地 · 历史记录（2026-09-30）**。本文件是「歌词显示位置」重设计的已确认并已实施方案，
> 已于 **v2.86.0** 全部落地（三批一次性完成，改动留本地待确认提交）。实测数字以 `CHANGELOG.md` v2.86.0 条目为准，
> 反向验证结论见文末 §11。正文行号为基线 v2.85.0 实测锚点（当时口径），落地后以 §11 实测为准。
> 基线：`main @ e19962b` = v2.85.0（tests 4712 PASS / 0 FAIL）；落地后 tests **4730 PASS / 0 FAIL**、
> `node tools/check-all.js` 18 项全绿（含资源体积预算、文档一致性、行覆盖率）。
> 体例沿用 PLAN-v5/v6：拍板结论 → 需求与问题 → 现状实证锚点 → 核心设计 → 逐层改动清单 → 范围分析
> → 测试计划 → 反向验证变异清单 → 不做的事 → 风险 → 分批 → 落地实测。

---

## 0. 拍板结论（决策表，已全部确认）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 单行跟随条去留 | **浮动元素退役**，但其**逐字 karaoke 文字效果**（`.lyric-chip` 底块 + `.lfill` 扫进 + played/on 变色）完整保留并移植到歌词行 |
| D2 | 文字对齐 | **字在各自节奏 chip 内靠左**（`justify-content:center → flex-start`），字仍按节奏位置铺开——逐字对格、起唱点 = 格子左缘 |
| D3 | 总开关 | 新增「显示歌词」`S.showLyric`（默认开）；关 = 任何位置都不画歌词 |
| D4 | 显示位置 | 新增「显示位置」`S.lyricPos`，三态：**自动（默认）/ 贴在每行小节下 / 集中在底部一整块** |
| D5 | 窄屏默认 | 「自动」= 响应式：**≤960px → 底部，>960px → 贴在每行小节下**（复用现有 viz 紧凑断点，不新造） |
| D6 | 无词小节 | 不处理：伴随节奏模式下无词小节的歌词行留**空行位**（无字块、不折叠、行高不跳）；用户嫌空可自行关「显示歌词」 |
| D7 | 屏幕空间 | 不做自动紧凑；靠「显示位置」自选 + D5 响应式默认解决 |
| D8 | 文案 | 开关「显示歌词」；位置三态「自动（窄屏底部）/ 贴在每行小节下 / 集中在底部一整块」 |
| D9 | 分批 | 三批：批1 数据层+开关+底部模式（现状迁移）→ 批2 伴随节奏覆盖层+退役跟随条+删① → 批3 测试改造+自验 |

> 唯一曾有的歧义（文字居左 = 格内靠左 vs 整行顶格连排）已按 D2 拍板为**格内靠左**。

---

## 1. 需求来源与问题

**用户实测痛点链**：
1. v2.85.0 ① 解决了"刚打开/开播时预备拍期间跟随条不显"（猝不及防）。
2. 但用户进一步指出：**预备拍只给第 1 小节做了预备歌词行，第 2 小节起同样猝不及防，却没有预备歌词行**——问题没彻底解决。
3. 用户的解法（本方案来源）：**把底部的几行歌词分别移到对应的小节节奏型下面，预告行同样处理**——让每行歌词贴着自己的小节，天然均匀前瞻，眼睛不用在"当前行 ↔ 底部歌词"之间来回跳。

**问题本质**：跟随条管"当前行"、底部轨管"预览"，这套分工默认用户会偶尔低头看底部轨；但跟随条的卖点恰恰是"眼睛钉在网格上"。一旦只靠跟随条，行间零前瞻。且行间切换时用户正忙着收尾当前行（无静音窗口可借），前瞻需求比开局更强。

---

## 2. 现状实证锚点（基线 v2.85.0）

- **三条分离的显示**：`#viz` 网格 N 行 `.bar-row`（节奏格子）；`#viz` 内浮一条单行跟随条 `#lyricFollow`（贴当前行下缘，`paintFollow` L7547）；`#viz` 之外的兄弟节点 `#lyricLane` 是底部整块歌词轨（`buildLyricLane` L7592）。
- **网格不变量（关键约束）**：`index.html` L455 注释——歌词轨刻意做成 `#viz` 的**兄弟节点而非子节点**，因为网格测试锁死「`#viz` 内恰有窗口行数个 `.bar-row` / 恰 1 个 `.active`」，歌词块塞进 `#viz` 会破功。** ⇒ 伴随节奏模式不能靠往 `#viz` 里插子节点实现。**
- **几何自适应**：`cacheGeo`（L5816）只收 `rowEls`（仅 bar-row，L6632 push）的 `offsetTop/offsetLeft/offsetWidth`，`vizRowBoxH` = bar-row 自身高（86px，窄屏 66px）。⇒ 歌词行可用 `translateY(rowGeo[i].top + vizRowBoxH + 缝隙)` 叠到对应小节下，**不动网格结构**。
- **字块渲染**：`.lyric-chip`（L467）`position:absolute;left:X%;width:Y%`（按节奏百分比铺开），字在 chip 内 `justify-content:center`（居中）。⇒ "文字居左" = 改 `flex-start`。
- **跟随条技术**：`#lyricFollow`（L482）`position:absolute;translateY` 贴行，帧内零 layout。⇒ 伴随节奏覆盖层复用同一套 translateY 思路。
- **窄屏断点**：viz 紧凑在 `@media (max-width:960px)`（L1196，`.bar-row` 66px / 行距 10px）。⇒ 响应式默认复用此断点。
- **预备拍预览（v2.85.0 ①）**：`paintFollow` L7556 `previewing` 分支 + `paintFrameBody` 预备拍分支里插入的 `paintLyric(0,-1,…)`。⇒ 本方案落地后可删（见 §5 退役安全性）。

---

## 3. 核心设计

**一个总开关 + 三态位置**，两种非关状态共用同一套 `.lyric-chip` 文字渲染（跟随条效果 + 格内居左）：

| 显示歌词 | 显示位置 | 行为 |
|---|---|---|
| 关 | （任意） | 哪里都不画歌词 |
| 开 | 贴在每行小节下（follow） | 每行歌词**叠到对应小节行正下方**；预告行歌词同样叠到预告小节下 |
| 开 | 集中在底部一整块（bottom） | 底部轨现状行为 |
| 开 | 自动（auto，默认） | ≤960px → bottom；>960px → follow（响应式，随当前宽度解析） |

**实现路线（推荐"重定位覆盖层"，不"塞进网格"）**：
- 歌词行仍由 `buildLyricLane` 统一构建（一套字块数据、一套着色逻辑不变）。
- 底部模式：`#lyricLane` 保持现状（`position:relative`，在 `#viz` 下方流式堆叠）。
- 伴随节奏模式：`#lyricLane` 切为覆盖层（`position:absolute` 叠到 `#viz` 上，`pointer-events:none`，z-index 同跟随条档），每个 `.lyric-row` `translateY(rowGeo[i].top + vizRowBoxH + 缝隙)` 叠到自己小节行下。
- **为什么走这条**：`#viz` 的 DOM 结构零改动（不往里塞任何歌词节点），网格不变量与 `rowEls`/`rowGeo`/`cacheGeo` 采集原样不动——这是唯一不踩 L455 硬约束的做法。

**跟随条退役的边界**：浮动 `#lyricFollow` 元素、`paintFollow`、`syncFollowChrome`、`.lyric-follow*` CSS、`#viz.lyric-follow-on` 行距补偿、**v2.84.0 双关放大**（跟随条专属）、**v2.85.0 ① 预备拍预览特判**全部删除。

---

## 4. 逐层改动清单

### 4.1 数据层
- `S.showLyric`（默认 `saved.showLyric !== false`）；typedef、热键载荷登记。
- `S.lyricPos`（默认 `"auto"`；取值 `"auto"|"follow"|"bottom"`）；typedef、热键载荷登记。
- 旧字段 `S.lyricFollow`（v2.84.0 跟随条开关）→ 由 `S.showLyric` 取代；做一次性迁移（`saved.lyricFollow === false` ⇒ `showLyric = false`），随后 `lyricFollow` 退役。
- 响应式解析辅助：`effectiveLyricPos()` = `S.lyricPos === "auto" ? (narrow() ? "bottom" : "follow") : S.lyricPos`；`narrow()` 用与 L1196 同口径的宽度信号（见 §8 风险 R2 的可测性取舍）。

### 4.2 渲染层
- `buildLyricLane`：按 `effectiveLyricPos()` 决定 `#lyricLane` 定位模式（流式 / 覆盖层）与各 `.lyric-row` 的 `translateY`；无词小节放空行位；`S.showLyric === false` 时整轨收起。
- `paintLyric`：逐帧只更新 played/on/fill 与 `.cur` 高亮（两种位置模式同一套）；行位置在 build/翻页时定，**帧内零行级 transform 写入**。
- 覆盖层几何：行 `translateY` 在 `buildLyricLane`（结构层，可读 offset）写入，取自 `rowGeo`/`vizRowBoxH`；resize/翻页随 `buildViz` → `buildLyricLane` 重采。
- 跟随条删除（见 §3 边界）：`#lyricFollow` 元素、`paintFollow`、`syncFollowChrome`、`internals` 里的 `lyricFollowEl/followRow` 暴露、`.lyric-follow*` CSS、`#viz.lyric-follow-on`、双关放大规则、预备拍预览分支。

### 4.3 设置 UI（画面图层组）
- 把现有「歌词跟随条」开关替换为「显示歌词」开关（`role="switch"`）。
- 其下加「显示位置」三档 pill 组（`自动（窄屏底部）/ 贴在每行小节下 / 集中在底部一整块`），仅「显示歌词」开时可用。
- `role="switch"` 计数：删 1（旧 lyricFollowToggle）+ 加 1（showLyricToggle）= 仍 15，t24 不变；「显示位置」是 pill 组（非 switch），不计入。
- 接线：两个新控件处理器自管 `setToggle`/`setPressed` + `Store.persist` + 触发 `buildViz`（重排歌词轨）；从 `syncVizLabelToggles` 摘掉跟随条联动。

### 4.4 CSS
- 新增：`.lyric-chip{justify-content:flex-start}`（文字居左，D2）；`#lyricLane.overlay`（覆盖层定位）；覆盖模式下 `.lyric-row` 的 `translateY` 由 JS 写（不写死 CSS）。
- 删除：`.lyric-follow` / `.lyric-follow[hidden]` / `.lyric-follow .lyric-chip|.lyric-char` / `#viz.lyric-follow-on .bar-row` / `#viz.no-ruler.no-durlab .lyric-follow*`（双关放大）。

---

## 5. 范围分析（重构前必做）

- **动**：`buildLyricLane` / `paintLyric` / 设置组① UI / `S` 两个新字段 + 一个迁移 / 歌词相关 CSS / `effectiveLyricPos`/`narrow` 辅助。
- **删**：`#lyricFollow` 元素、`paintFollow`、`syncFollowChrome`、`.lyric-follow*` CSS、`#viz.lyric-follow-on` 行距补偿、双关放大规则、预备拍预览分支（`paintFollow` 的 `previewing` + `paintFrameBody` 的 `paintLyric(0,-1,…)`）、`S.lyricFollow`。
- **下游影响**：`buildViz`（调 `buildLyricLane` 处不变）；`cacheGeo`/`rowGeo`/`rowEls`（不变，仍只收 bar-row）；`syncVizLabelToggles`（摘跟随条联动）；`internals`（摘 lyricFollowEl/followRow）。
- **保留替代**：跟随条的**文字渲染语义**整套保留（移植到歌词行）；底部模式 = 现状行为完整保留。
- **① 预备拍预览删除安全性**：伴随节奏模式下小节 1 歌词恒在小节 1 下（含预备拍）；底部模式下底部轨恒显——"开局猝不及防"在两种位置模式下都仍被覆盖，删 ① **不回退需求**。
- **v2.84.0 双关放大删除**：它是跟随条专属（座次尺+时值标注双关时跟随条移入行内放大）。跟随条退役后此特性随之消失；`.chord-xl` 行首和弦放大（网格侧，v2.84.0 另一条）与跟随条无关，保留。

---

## 6. 测试计划

- **改**：
  - `t149-lyric-follow`（跟随条 → 改为伴随节奏/底部两模式断言：follow 模式每行歌词叠在对应小节下、bottom 模式 = 现状、`.cur` 高亮与逐字着色不变）。
  - `t150-follow-countin-preview`（预备拍预览 → 改为"伴随模式下小节 1 歌词预备拍即见 / 底部模式底部轨预备拍恒显"）。
  - `t90-control-layout`（设置项清单：歌词跟随条开关 → 显示歌词 + 显示位置三档）。
  - `t24-audit-hardening`（`role="switch"` 计数复核，理论仍 15）。
  - `t27` 所在网格不变量测试（跟随条退役但网格不变量不变，确认 `#viz` 内 `.bar-row` 计数不受影响）。
- **新**（暂命名 t154-lyric-position）：
  - T154a：显示歌词关 → 两种位置模式都不画歌词。
  - T154b：follow 模式 → 每行歌词 translateY 叠在对应小节下（`rowGeo[i].top + vizRowBoxH + 缝隙`），预告行同处理（`.preview` 降权）。
  - T154c：bottom 模式 → 底部轨流式堆叠（现状回归护栏）。
  - T154d：auto 模式 → 窄宽度解析为 bottom、宽宽度解析为 follow（响应式默认，D5）。
  - T154e：文字居左 → chip `justify-content:flex-start`。
  - T154f：无词小节 → 空行位（有 lyric-row 无字块，行高不跳）。
- **自验**：`node tests/run.js` 全绿 + `node tools/check-all.js` 全绿（模块顺序 R2、DOM 预算、体积预算复核——删除跟随条 + 新增覆盖层逻辑，净体积预计下降）。

---

## 7. 反向验证变异清单

| 变异 | 预期 |
|---|---|
| 拔 `buildLyricLane` 里的覆盖层 translateY 写入 | T154b 红（歌词行不贴小节） |
| 把"显示歌词关"改成仍画底部轨 | T154a 红 |
| 把 auto 的窄宽解析写反（窄→follow） | T154d 红 |
| chip 居左改回 center | T154e 红 |
| 删跟随条时漏删 `#viz.lyric-follow-on` 行距补偿 | 行距异常（t27 / 视觉复核红） |
| follow 模式下预告行不带 `.preview` 降权 | T154b 红 |

---

## 8. 风险

- **R1 网格不变量**：最大风险。缓解 = 走覆盖层路线（§3），`#viz` DOM 零改动；落地第一步先重读网格不变量测试确认它按 `.bar-row` class 计数（而非 `#viz.children`），若按 children 计数则需同步放行 `.lyric-row`。
- **R2 响应式默认的可测性**：`narrow()` 若用 `matchMedia("(max-width:960px)")`，harness 的 matchMedia 桩目前只认 reduce-motion（harness.js L479），窄宽分支测不到 ⇒ 要么给 harness 补宽度感知 matchMedia，要么 `narrow()` 改读 `#viz.offsetWidth < 阈值`（harness 用 ROW_W 控制，天然可测）。**倾向后者**（与 `chooseRowBeats` 同用 offsetWidth，口径一致且可测）。落地时定。
- **R3 覆盖层与网格元素叠放次序**：覆盖层 `pointer-events:none`，z-index 需压在弹跳球/播放头之下、格子之上（跟随条是 z-index 5，参照之）。拖拽微调在编辑视图承担，这层不收事件（沿用 `.lyric-lane` 纯视觉轨约定）。
- **R4 翻页重建**：窗口翻页时 `buildViz`→`buildLyricLane` 重建，覆盖层行位置随之重采；页内行位置静态，帧内零行级写入（比跟随条省）。
- **R5 退役回归**：跟随条/双关放大/预备拍预览三处近期功能被删，需靠 t149/t150 改写 + t27 网格不变量 + 真机视觉复核把守。

---

## 9. 不做的事

- 不做自动紧凑（屏幕空间靠位置自选 + 响应式默认，D7）。
- 不做无词小节的折叠/特殊 UI（D6，空行位即可）。
- 不做"整行顶格连排"的文字对齐（D2 已拍板格内靠左）。
- 不保留浮动跟随条元素（其文字效果已移植，元素冗余）。
- 不动 `.bar-row` 的高度/内部结构、不动 `rowEls`/`rowGeo`/`cacheGeo` 的采集口径。
- 不动网格的 `.chord-xl` 行首和弦放大（与跟随条无关，保留）。

---

## 10. 分批

- **批1（低风险迁移）**：数据层（`S.showLyric`/`S.lyricPos`/`lyricFollow` 迁移）+ 设置 UI（显示歌词开关 + 显示位置三档）+ 底部模式接通现状。此批跟随条仍在，行为与现状逐位一致。
- **批2（核心）**：伴随节奏覆盖层（`buildLyricLane` 覆盖定位 + translateY）+ 文字居左 + 退役跟随条/双关放大/预备拍预览 + auto 响应式默认。
- **批3（收尾）**：测试改造（t149/t150/t90/t24 + 新增 t154 六场景）+ 反向验证 + 全量自验 + CHANGELOG v2.86.0 条目 + 文档登记（本方案转「已落地」）。

---

## 11. 落地实测（2026-09-30）

- **三批一次性完成**（用户指令「开工，一次完成 3 批」）：批1 数据层+开关+底部模式接通；批2 伴随节奏覆盖层+文字居左+退役跟随条/双关放大/预备拍预览+auto 响应式默认；批3 测试改造+自验+文档。改动按约定留本地、待用户确认提交（未推）。
- **自验数字**：`node tests/run.js` → **4759 PASS / 0 FAIL**（较基线 v2.85.0 的 4712 净增 47 条断言：含视觉补丁 T149g 13 项 + T149h 双关位移 4 项 + 四次修订 T149i 窄屏口径 9 项）；`node tools/check-all.js` → **18 项全绿**（语法/架构约束/装配完整性/零依赖 lint/版本一致性/文档一致性/_headers/DOM 账本/测试桩能力对账/资源体积预算/CSS 孤儿扫描/ESLint/类型检查/DOM 引用/浏览器冒烟/全量测试/死循环看门狗/行覆盖率）。
- **净体积**：移除跟随条浮动元素 + `paintFollow`/`syncFollowChrome`/`ensureLyricFollow`/`hideFollow`/`showFollow` 整条 + 双关放大 CSS（`.lyric-follow*`、`#viz.lyric-follow-on`、`.lyric-chip`/`.lyric-char` 跟随条专用规则）+ 预备拍预览特判，**净减约 2.0KB**（资源体积预算充裕，未触及上限）。
- **逆向验证（与 §7 变异清单逐项对账，全绿）**：
  | 变异 | 预期 | 实测 |
  |---|---|---|
  | 拔 `S.showLyric` 总开关 → 任何位置仍画歌词 | T149c/T154a 红 | 关 ⇒ `lane.hidden=true`（follow/bottom 均收起）✓ |
  | 拔 `layoutLyricLane` 里的覆盖层 translateY 写入 | T149a/T154b 红 | 逐行 `translateY(rowGeo[i].top+行盒高+2)` 按行贴合 ✓ |
  | 把 auto 的窄宽解析写反（窄→follow） | T154d 红 | `narrow()` 读 `#viz.offsetWidth≤960`：500→bottom、1200→follow ✓ |
  | chip 居左改回 center | T149e/T154e 红 | CSS `.lyric-chip{justify-content:flex-start}` ✓ |
  | 删跟随条时漏删 `#viz.lyric-follow-on` 行距补偿 | 行距异常（视觉复核红） | 旧规则已删（`grep` 全仓零残留）；补偿以新类 `.lyric-inline-on`（52/48px + xl 联动）重建，T149g 锁定 ✓ |
  | follow 模式预告行不带 `.preview` 降权 | T154b 红 | `r===0 && winPrevSeg>=0` 行加 `.preview`（与网格同语义）✓ |
  | ⑦ 删 `setLyricInlineOn` 挂类逻辑 | T149g 红 | follow 时 `#viz` 不挂 `.lyric-inline-on` ⇒ 歌词压下一行回归；T149g 13 项全红 ✓ |
  | ⑧ 双关（两标注都关）位移退回锚行盒底+2 | T149h 红 | `.lyric-inline-on.chord-xl` 时 `placeLaneOverlay` 读 `#viz.chord-xl` 走 `行顶+50`/`+36` 分支，歌词进释放标注带；T149h 4 项全红 ✓ |
  | ⑨ `narrow()` 误读回 `offsetWidth`（视口口径同旧 bug 回归） | T149i 红 | 错位场景（viz600/视口1200）误用窄屏 +36 ⇒ T149i 8 位移断言 + 1 误判回归断言全红；`matchMedia` 视口口径优先后归位 ✓ |
  | ⑩ 落法B 字心撤销（改回 `justify-content:flex-start`+`padding-left`） | T149e/T154e 红 | `.lyric-char{left:clamp(10px,25%,32px)}` 断言缺失 ⇒ 两用例红 ✓ |
- **桩环境适配**：`placeLaneOverlay` 的逐行 translateY 先写（只依赖 `rowGeo`/`vizRowBoxH`，与 `getBoundingClientRect` 解耦），覆盖层自身的像素对齐定位在桩缺 `getBoundingClientRect` 时跳过、由 CSS 兜底——保证断言稳定性，真实浏览器仍走像素对齐路径。
- **R1 不变量已守住**：`#viz` 内仍恰 N 个 `.bar-row`、歌词行全在 `#viz` 兄弟 `#lyricLane`，t149a 明确断言无 `.lyric-row`/`.lyric-lane` 落入 `#viz`。
- **R3 缺口已补（视觉补丁 · 三次修订）**：R3 原只覆盖「叠放次序/z-index」，未预留「歌词行竖向空间」——原跟随条靠 `.lyric-follow-on{margin-bottom:48px}` 腾空间，该规则随跟随条退役被删，导致覆盖层 `translateY(本行顶+行盒高+2)` 把 28px 歌词行压进下一行（用户实拍重叠）。**首版补偿 44/34px 仍被用户实拍打回**：这条行间空带里还住着下一行的行首和弦胶囊（`.bar-chord` 挂本行顶上方，普通 top:-18px 高 13px / xl 放大 top:-36px 高 24px），xl 时胶囊整个压在歌词行上（Am 徽标与歌词同行）。**二次修订按「两个住户」重算（52/70px）后，用户又报「歌词上方空 44px」**——根因是 v2.84.0 双关时跟随条上移进释放出的行内标注带（`FOLLOW_INSET_Y`/双关放大 CSS），v2.86.0 退役跟随条时整批删掉、逐行歌词轨退回锚行盒底（+88），空带复用语丢失。终版把 v2.84.0 方案移植回逐行轨：**xl（两标注都关）时歌词行上移进标注带**（位移 `行顶+50` 桌面/`+36` 窄屏、行高 32/字块 30/字 17·800），**行距 xl 48px**（v2.84.0 守恒值，不再叠加 70 的过剩空带）；普通模式维持锚行盒底+2、行距 52px。`setLyricInlineOn` 在 follow 挂 / bottom·关摘，`cacheGeo()` 在翻转时重采；双关位移分支在 `placeLaneOverlay` 读 `#viz.chord-xl`；follow 期间切两标注（xl 开/关改行距+锚点 52/48 + 行顶+88↔+50）由点击路径按需 `Viz.relayout()` 重采——竖向空间（普通 & 双关）、z-index、空带复用三处关切齐备，T149g 13 项 + T149h 4 项锁定。

- **四次修订（2026-09-30 续 · 视觉验收补丁之二）**：① **落法B 字位**（用户拍板，替换 D2 +8px 内边距）：`.lyric-chip` 退回纯容器、`.lyric-char` 绝对定位 `clamp(10px,25%,32px)`（25% = 以 50% 为居中的「半格的一半」）；短音字心在格宽 1/4 处、长音封顶 32px 保住「起唱点=格子左缘」语义、极短格 `overflow:hidden` 不裁字。② **窄屏口径对齐 CSS 视口断点**（修 961–1392px 歌词带压格子底 7px 重叠）：旧 `narrow()` 读 `#viz.offsetWidth≤960`（网格宽），但 CSS `@media(max-width:960px)` 断视口宽；双栏布局下 viz 宽 ≈ min(视口,1440)−432，视口 961–1392px 时 CSS 走桌面几何但 `narrow()` 误判窄屏 → 双关位移误用 +36（标注带仅 32px）而非 +50 → 带压格底 7px。`narrow()` 改优先 `matchMedia("(max-width:960px)")`，桩 `matchMedia` 扩展应答 `max-width` 查询（harness `viewportW ?? ROW_W` 控制），新增 T149i 9 项断言锁定错位场景用 +50、且缺省口径仍 +36（存量行为不变）。两处改动均已由 `tests/run.js`（4759 PASS / 0 FAIL）覆盖。

> 本文件已落地，登记于 `docs/README.md` 快照表与根 `README.md` 文档表；实测数字与反向验证结论以 `CHANGELOG.md` v2.86.0 条目为准。
