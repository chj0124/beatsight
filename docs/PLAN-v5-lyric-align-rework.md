# 歌词对齐交互重设计 + 字块拖拽改进 · 函数级实施清单（PLAN-v5 草案）

> 基线：`chj0124/beatsight`（HEAD = 远端 main `6678ec6`，v2.48.0 已发版），`index.html` 13,480 行。
> **状态：四期全部落地（2026-09-28）。**期 1 = v2.49.0（撤销/重做 + 阈值分流）· 期 2 = v2.50.0（getDropTarget + ghost + 打轴上下文）· 期 3 = v2.51.0（试听 + 游标 + 松手即时音）· 期 4 = v2.52.0（批量平移 + 显性换位 + 流水线重排）。与原清单的差异：松手即时音直接挂 AudioEngine 导出（不经 let on... 注入槽）；「时值±1格」常驻渲染（非选中窄块才出现）；组头用 flex-basis:100% 小标不包容器。
> 本文合并《歌词对齐-交互重设计方案.md》（R1–R5）与《歌词字块拖拽-交互改进方案.md》（D1–D6）为一份可执行清单。
> 体例沿用 PLAN-v4：拍板结论 → 范围总览 → 逐期「函数级改动清单 → 测试计划 → 反向验证变异清单」→ 不做的事 → 风险。
> **行号按 v2.48.0 工作区实测，动工前 `grep -n` 复核一次（仓库惯例）。用户确认后挪入 `docs/PLAN-v5-lyric-align-rework.md` 再动工。**
> ★ 前置硬条件：**v2.48.0 在制工作（打轴/磁吸/重命名）先落地发版**，本计划与其同区域（`bindDrag`/`onDragMove`/`mkLyricRow`/tap 系），双线开工必撞车。

---

## 0. 拍板决策点（待确认）

| # | 决策点 | 建议结论 | 代价/说明 |
|---|---|---|---|
| V1 | 撤销栈生命周期 | **会话内内存栈**（模块级 Map，关浮层/切段不清、刷新页面清空），不落盘 | 与 Editor `undoStack` 同纪律；刷新后不可撤销（可接受） |
| V2 | 键盘微调与撤销粒度 | **每击键 = 一步**（不做时间窗合并） | 连按 10 次方向键要撤 10 次；合并留观察项 |
| V3 | 打轴与撤销 | **整段打轴 = 一步**（startTap 压一次快照） | 逐字压栈会把 50 步额度打空 |
| V4 | 「按节奏对齐」确认弹窗 | 期 1–3 保留；**期 4（R5）随流水线重排降级**为 announce「已对齐 N 字，可撤销」 | t115 用例届时迁移 |
| V5 | 点选字块的渲染口径 | 选中态是**模块态**（`selChip`），`mkLyricChip` 渲染时按 (arr,sec,k) 回挂 `.sel`——批量按钮提交触发重渲染后选中不丢 | 撤销导致字数变少时 k 越界 → 清空选中 |
| V6 | 试听本段 | **单段循环 + 原速 + 不动 `S.trainer`**；浮层保持打开；与打轴互斥 | 与「循环本行（爬坡）」并存，两个入口语义分开 |
| V7 | 拖拽落点 FLIP 动画 | **期 2 不做**（全量重渲染打断 transition）；ghost 预览已消解跳变感知 | 若期 2 后仍嫌生硬再补 FLIP |
| V8 | 打轴「从第 k 字」的播放起点 | v1 仍从段首播（段一般 2–4 小节，等待可接受）；按字 seek 留观察项 | 省一套 arrangeSel 细粒度定位 |
| V9 | grip 热区外扩 | chip `overflow:hidden` → `visible`，裁剪改由 `.arg-lyric-char` 承担，grip `::after` 才能向右外扩 | 改一处既有样式的裁剪职责，需全截图复核 |

## 1. 范围总览

```
期 1（v2.49.0）安全网与手感地基：R1 撤销/重做 + D2 阈值分流 + D4 滚动分工 + D6 捕获/行高
期 2（v2.50.0）落点可见与打轴增强：D1 getDropTarget+ghost + D3 上浮/气泡 + R4 打轴上下文/从第 k 字
期 3（v2.51.0）验证闭环：R3 原速试听 + 播放游标 + 当前字高亮 + 松手即时音
期 4（v2.52.0）批量与流水线：R2 批量平移 + D5 grip 热区/窄块降级/显性换位 + R5 流水线重排
```

**四期共同红线**：
- `Store.upsertLyric` / `normLyricLine` 归一化、`secOnsetTicks` 锚点口径、歌词 uid 绑定、`arrangeSel` 语义——一行不改；新逻辑全部内聚 `Arrange`。
- 原生控件优先；新控件全 `<button>`/toggle-pill；用户可控字符串只走 `textContent`；运行时节点全部建在歌词展开区（折叠态不渲染），静态标记仅 tapBar +1 节点（期 2）。
- 落点计算**单一事实源** `getDropTarget()`：预览、提交、显性换位按钮三处共用。
- DOM 预算 1300（审计基线 1289）：四期静态净增 ≤ +2；每期发版前 `smoke.js` 复核。

---

## 2. 期 1 · 安全网与手感地基（v2.49.0）

### 2.1 R1 歌词撤销/重做

**A. 模块状态（`Arrange` 顶部，L10456 附近）**

```js
/* 歌词撤销/重做（V1）：键 = arrangeId|secUid；会话内存栈，不落盘。
   打轴是事务：startTap 压一次快照（V3），tapNow 的逐敲落库不压栈。 */
const lyricHist = new Map();          // key → { undo: string[], redo: string[] }
const HIST_MAX = 50;                  // Editor undoStack 同口径（L10008）
let lastLyricKey = null;              // { arrId, secUid }：Ctrl+Z 的路由目标（末次触碰段）
let selChip = null;                   // { arrId, secUid, k }：选中字块（V5，期 4 批量用，期 1 先立态）
```

**B. 新增函数**

| 函数 | 签名 | 职责 |
|---|---|---|
| `histKey` | `(arrId, secUid) → string` | `arrId + "|" + secUid` |
| `histGet` | `(arrId, secUid) → {undo,redo}` | get-or-create |
| `lyricCommit` | `(arrId, secUid, chars, opts?) → void` | **唯一写入口**：① 读 `Store.findLyric` 现值快照 `snap`；② `snap === JSON.stringify(chars)` → 早退（no-op 不压栈，Editor"同档重按不推栈"同源纪律）；③ `undo.push(snap)`、超 50 shift、`redo.length = 0`；④ `chars.length ? Store.upsertLyric(...) : Store.deleteLyric(...)`（清除与删除走同一门）；⑤ 写 `lastLyricKey` |
| `applyLyricSnap` | `(arrId, secUid, snap) → void` | 解析快照：空数组 → `deleteLyric`，否则 `upsertLyric`；随后 `arrangeRender()` |
| `lyricUndo` / `lyricRedo` | `(arrId, secUid) → boolean` | 弹栈前先把**当前态**压入对侧栈（redo/undo），再 `applyLyricSnap`；空栈返回 false（按钮置灰判据） |
| `lyricHistPush` | `(arrId, secUid) → void` | 只压 undo 不清场（打轴事务入口专用：startTap 调一次，tapNow 不经过 lyricCommit） |

**C. 六个写路径改道**（逐一替换，签名不变）

| 位置 | 现状 | 改为 |
|---|---|---|
| `distribute`（L10734 / L10739） | `Store.deleteLyric` / `Store.upsertLyric` | `lyricCommit(a.id, secUid, chars)`（空数组 = 删除分支） |
| `onDragEnd`（L10620） | `Store.upsertLyric` | `lyricCommit(...)`；no-op 早退（L10619）保留在 lyricCommit 内层双保险 |
| `moveChipKey`（L10822） | `Store.upsertLyric` | `lyricCommit(...)`（V2：每击键一步） |
| `alignLyricToRhythm`（L10799） | `Store.upsertLyric` | `lyricCommit(...)` |
| 清除钮 handler（L11054） | `Store.deleteLyric` | `lyricCommit(a.id, uid, [])` |
| `tapNow`（L10947） | `Store.upsertLyric` | **不改道**；改在 `startTap`（L10900 处）调一次 `lyricHistPush`（V3 事务） |

**D. UI 与键盘**

- `mkLyricRow` 展开区（L11021 注释处之后）加 ↩ / ↪ 两颗 `arg-mini`：`disabled` 由 `histGet` 栈长决定；点击 = `lyricUndo/lyricRedo` + `arrangeRender`。
- 键盘层（L12217 `registerKeyLayer`）：`isOpen()` 分支内、`onInput` 排除后——`Ctrl/⌘+Z` → `lyricUndo(lastLyricKey…)`；`Ctrl/⌘+Shift+Z` 或 `Ctrl+Y` → `lyricRedo`。`lastLyricKey` 为空则忽略。
- `arrangeRender` 收尾：若 `selChip` 所指段字数 < k+1 → `selChip = null`（V5 的越界清理）。

### 2.2 D2 拖拽阈值分流

**`bindDrag` 重写（L10625–10670）为两段式**：

| 阶段 | 行为 |
|---|---|
| pointerdown | 只记 `pend = { ev, lctx, k, mode, x0, y0, pointerId }`，挂到模块级 `pendDrag`；**不调 preventDefault、不加 dragging 类、不建 drag** |
| `onDragMove` 开头 | `pendDrag` 存在且位移 ≥（touch ? 8 : 5）px → 转正：执行原 pointerdown 里的全部初始化（L10634–10668 原样搬入 `activateDrag(pend)`），加 dragging 类、`setPointerCapture`（D6）、此后 `preventDefault` |
| pointerup / cancel | `pendDrag` 存在且未转正 = **点按**：`selChip = {arr, sec, k}` + `chip.focus()` + 视觉选中（见下）+ 清空 pendDrag；已转正则走原 `onDragEnd` |

**点按的视觉选中**：不进 `arrangeRender`（避免整树重建），就地摘旧 `.sel` 加新 `.sel`；`mkLyricChip` 渲染时按 `selChip` 回挂（V5）。

**CSS**：新增 `.arg-lyric-chip.sel{ box-shadow:0 0 0 2px var(--blue) }`（与 focus-visible 蓝描边同色系）。

### 2.3 D4 滚动分工 + D6 捕获/行高（纯小改）

| 位置 | 改动 |
|---|---|
| `.arg-lyric-chip`（L929） | `touch-action:none` → **`pan-y`**（竖滚归还浏览器；横拖在 D2 转正后 preventDefault 接管） |
| `activateDrag` 内 | `if (chip.setPointerCapture) try{ chip.setPointerCapture(pend.pointerId) }catch(_){}`（桩无此 API，防御包裹；window 监听兜底保留） |
| 窄屏媒体查询（L800 附近） | `@media (max-width:640px){ .arg-lyric-barrow{ height:36px } }`（现 24px，L928） |

### 2.4 测试计划

**新增 `t118-lyric-undo.js`**：
1. 粘贴 → undo → 段回到无词态（`findLyric` 为 null）；redo → 词回来
2. 拖动提交 → undo 复原；no-op（原地松手）不压栈
3. 键盘 ←×3 → 三次 undo 逐步回退（V2 粒度断言）
4. 打轴：startTap 后 tapNow×5 → **一次** undo 回到打轴前（V3 事务断言）
5. 清除 → undo 恢复整行
6. 栈超 50 步头部被裁
7. ↩/↪ 按钮 disabled 随栈长切换；新提交清空 redo

**新增 `t119-drag-threshold.js`**：
1. down+up（无 move）→ `selChip` 生效、Store 零变化、无 dragging 类
2. down+move(3px)+up → 零变化（未过阈）
3. down+move(10px)+up → 正常拖拽提交（与旧用例同断言）
4. CSS 文本断言：`.arg-lyric-chip` 含 `touch-action:pan-y`（t101 同口径）

**迁移**：既有拖拽用例（t60/t115 系及 v2.48 新增的 t116/t117）若直接 fire pointerdown+up 模拟拖动的，补 move 事件。

### 2.5 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| `lyricCommit` 删掉压栈步骤 | t118 #1「undo 后回到无词态」 |
| `lyricCommit` 删掉 `redo.length = 0` | t118 #7「新提交清空 redo」 |
| 打轴改回逐敲压栈 | t118 #4「一次 undo 回打轴前」 |
| 阈值改回 0（pointerdown 即建 drag） | t119 #1「点按零变化」 |
| `touch-action` 改回 `none` | t119 #4 CSS 断言 |

---

## 3. 期 2 · 落点可见与打轴增强（v2.50.0）

### 3.1 D1 `getDropTarget` 单事实源 + ghost

**新增纯函数**（从 `onDragEnd` L10585–10616 提取，逻辑逐位不变）：

```js
/** 落点唯一事实源：拖动预览（ghost）、松手提交、显性换位按钮（期 4）三处共用。
    @param {any} d drag 对象 @returns {{t:number, dur:number, swap:-1|0|1, magnet:number}} */
function getDropTarget(d){ /* 邻界钳制 → 换位判定（overR/overL）→ 磁吸 → 格吸附，原样搬移 */ }
```

**`onDragMove`（L10505）增 ghost 维护**：`activateDrag` 时与 guide 同建 `drag.ghost`（`div.arg-lyric-ghost`，aria-hidden）；每次 move 调 `getDropTarget(drag)` 把 ghost 摆到预测落点的行与 left/width（分行换算复用 L10565–10569 同一组公式）；`swap !== 0` 时给邻字加 `.swap-hint` 脉冲类（显性换位预览的预览）。`onDragEnd`：摘 ghost、调 `getDropTarget` 拿终值提交（原计算体删除）。

**CSS 新增**：
```css
.arg-lyric-ghost{position:absolute;top:2px;bottom:2px;border:1px dashed var(--green);background:rgba(30,215,96,.18);border-radius:4px;pointer-events:none}
.arg-lyric-chip.swap-hint{animation:argSwapPulse .5s ease infinite alternate}  /* 关键帧走变量，双主题成立 */
```

### 3.2 D3 上浮 + 读数气泡

- `.arg-lyric-chip.dragging` 加 `transform:translateY(-22px) scale(1.06)`（视觉位移，tick 换算只认 pointer 坐标，**零换算改动**）。
- `activateDrag` 同建 `drag.bubble`（`div.arg-lyric-bubble`，aria-hidden，挂同行，`top:-34px`）；`onDragMove` 更新文本：`第 ⌊t/barTicks⌋+1 小节 · 第 ⌊t%barTicks/TPB⌋+1 拍（相对原位 ±N 格）`；`onDragEnd` 摘除。
- CSS：`.arg-lyric-bubble{position:absolute;z-index:5;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;font-family:var(--mono);pointer-events:none;white-space:nowrap}`。

### 3.3 R4 打轴增强

| 位置 | 改动 |
|---|---|
| tapBar 静态标记（L1278–1280） | 加 `<span id="tapCtx" class="tapbar-ctx"></span>`（静态 +1，预算内） |
| `updateTapBar`（L10970） | 增上下文渲染：`tapCtx.textContent = chars[k-2..k+2]`，当前字包 `【】`（纯文本，不建子节点） |
| `startTap`（L10896） | 增可选参 `k0`（缺省 0）：`tap = { …, k: k0, … }` |
| `mkLyricRow` 打轴钮（L11086） | 若 `selChip` 属本段：文案改 `从第 k 字开打`、`startTap(a, sec, line, selChip.k)`（V8：仍从段首播） |

### 3.4 测试计划

**新增 `t120-ghost-droptarget.js`**：
1. `getDropTarget` 四分支单测：格吸附 / 磁吸命中 / 邻界钳住 / 换位（overR ≥ 半程）——函数导出（return 列表加它，`secOnsetTicks` 先例）
2. 拖拽中 ghost 节点存在且 `style.left` = 最终提交 t 的换算值（**预览-提交一致性断言**）
3. 松手后 ghost/bubble 均摘除（含 pointercancel 路径）
4. bubble 文本格式断言
**新增 `t121-tap-context.js`**：startTap(k0=5) 后 `tap.k===5`、前 5 字原样保留；tapCtx 含当前字；打完整段一次 undo 复原（与 t118 #4 联动）。

### 3.5 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| `onDragEnd` 不调 `getDropTarget`、内联一份旧计算（两份真相） | t120 #2 一致性断言 |
| ghost 在 onDragEnd 忘摘 | t120 #3 |
| startTap 忽略 k0 恒从 0 | t121 首条 |

---

## 4. 期 3 · 验证闭环（v2.51.0）

### 4.1 R3 原速就地试听

**新增函数**：

| 函数 | 职责 |
|---|---|
| `previewSection(a, secIdx)` | `S.arrangeSel = { id, from: 段首, to: 段尾, loop:true, byLyric:false }`；`setMode("playMode","arrange","歌词试听")`；**不动 `S.trainer`**（V6）；`Controls.stop(); Controls.start()`；**不关浮层**；记 `preview = { arrId, secUid }`；试听钮切 ■ 态 |
| `previewStop()` | `Controls.stop()`；`preview = null`；钮态还原。`close()` / `startTap` / `open()` 入口各加一句调用（互斥纪律） |
| `sectionPosTicks(arrId, secUid)` | 从 `tapPosTicks`（L10879）提取的段内位置原语（去掉 `tap` 依赖，改参量化）；`tapPosTicks` 改为委托调用——**打轴与游标同一位置源** |
| `syncPreviewCursor()` | `preview` 非空时：`pos = sectionPosTicks(...)` → 移动游标 `div.arg-lyric-cursor`（目标段 lane 内，`left = pos%barTicks/barTicks*100%`、跨行跳行）+ 当前字加 `.cur`（判据 `t ∈ [c.t, c.t+dur)`，主视图 L6717 同构）；由 rAF 驱动（`if (window.requestAnimationFrame)` 防御，桩环境测试直接调函数） |

**「从选中字起播」**：`selChip` 属本段时试听钮旁加一颗 `▶ 从选中字`：`arrangeSel.from = 段首 + ⌊t/barTicks⌋`（粗到小节，V8 同口径）。

**松手即时音**：`lyricCommit` 尾部（拖动/键盘/批量来源，非打轴/粘贴）调 `cueAt(charT)`——经 **AudioEngine 注入槽**暴露的 `lyricCueNow()`（复用 `lyricCueHit` L7470 的发声体，包一层"取当前音频时刻 + 发声"；装配区接线登记，`check-wiring` 槽位 +1）。

### 4.2 测试计划

**新增 `t122-preview.js`**：
1. 试听装配断言：`arrangeSel` 单段循环 + `byLyric:false` + **`S.trainer.on` 不被改动**（本期的核心回归）
2. 试听中点开始打轴 → 试听先停（互斥）；反之亦然
3. `syncPreviewCursor`：给定 onset 端点与音频时钟（桩注入），游标 left 与 `.cur` 字下标正确
4. 关浮层 → 试听停、游标摘
5. `sectionPosTicks` 与 `tapPosTicks` 同源断言（同输入同输出）

### 4.3 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| `previewSection` 顺手开了 trainer（复制 loopLyricSection 的旧习） | t122 #1 |
| 游标位置另写一套插值（不经 `sectionPosTicks`） | t122 #5 |
| 互斥漏一边（试听中打轴双开） | t122 #2 |

---

## 5. 期 4 · 批量与流水线（v2.52.0）

### 5.1 R2 批量平移

**新增纯函数**：
```js
/** 整体平移：fromK 起（含）所有字 t += delta；整组钳制（首字不早于 0、末字 t+dur 不越段长），
    钳后 delta = 0 → 返回 null（调用方 announce「到头了」）。@returns {any[]|null} */
function shiftLyricChars(chars, fromK, delta, span){ /* 纯函数，可单测 */ }
```

**工具行**（`mkLyricRow` 展开区，字块轨上方）：`◀1拍 ◀半拍 ◀1格 | 1格▶ 半拍▶ 1拍▶` 六颗 arg-mini（Δ = ∓TPB / ∓LYRIC_BASE / ∓LYRIC_GRID）+ 范围二选一 toggle-pill：`全部字` / `从选中字`（后者无 `selChip` 时 disabled）。每次点击 = `shiftLyricChars` → `lyricCommit`（**一次批量 = 一步撤销**）→ `arrangeRender`（`selChip` 按 V5 存留）。

### 5.2 D5 grip 热区 / 窄块降级 / 显性换位

| 项 | 改动 |
|---|---|
| grip 热区 | `.arg-lyric-chip{overflow:visible}`、裁剪移给 `.arg-lyric-char{overflow:hidden;max-width:100%}`（V9）；`.arg-lyric-grip::after{content:"";position:absolute;top:0;bottom:0;right:-10px;width:20px}` |
| 窄块降级 | `mkLyricChip`：`c.dur < 30`（2.5 格）→ 不渲染 grip；选中窄块时工具行出现 `时值−1格 / +1格` 两颗（走 `lyricCommit`，dur 钳制同 L10614 口径） |
| 显性换位 | 工具行 `⇄ 与后字换位`：`selChip` 有后继时可用；内部调 `getDropTarget` 同款交换助手 `swapChars(chars, k)`（期 2 提取时一并导出）；**与拖拽换位殊途同归同一函数** |

### 5.3 R5 流水线重排 + 对齐弹窗降级

- `mkLyricRow` 展开区子节点按 ① 贴词（粘贴框+清除）→ ② 粗对齐（按节奏对齐 + 跟播打轴）→ ③ 精修（工具行 + ↩↪）→ 字块轨 → 试听行（▶ 试听本段 / 从选中字 / 变速练唱）重排，组间加 `stats-head` 小标（①②③）。
- 「循环本行」改名 **「变速练唱（爬坡）」**（语义如实）；「按节奏对齐」确认弹窗降级为 announce「已对齐 N 字，可 Ctrl+Z 撤销」（V4）。
- 摘要行文案：`歌词 ✓ N 字 · 贴词/对齐/打轴/微调 ▸`。
- help 页词条（L1948 附近）与 README 同步。

### 5.4 测试计划

**新增 `t123-batch-shift.js`**：全部字 +1 格 / 从选中字起平移（前面字不动）/ 首字钳 0 / 末字段尾钳 / 钳后为 0 返回 null 不落库 / 一次批量一步 undo / `⇄` 按钮与拖拽换位同结果。
**迁移**：t115（对齐确认弹窗 → announce 的断言改写）、t60/t108（展开区子节点顺序按新流水线改定位，本次迁完换 aria 定位）。

### 5.5 反向验证变异清单

| 变异 | 必须红的断言 |
|---|---|
| `shiftLyricChars` 首字越界不钳 | t123 钳制断言 |
| 批量平移拆成逐字多次 commit | 「一次批量 = 一步撤销」断言 |
| `⇄` 按钮内联一份交换逻辑（不经 `swapChars`） | 同结果断言 + 代码审查点 |

---

## 6. 不做的事（本期明确排除）

dur 批量缩放 · 自由框选多字 · 拖拽 FLIP 归位动画（V7，观察项）· 打轴按字 seek（V8，观察项）· 键盘撤销时间窗合并（V2，观察项）· 真实音频强制对齐 / 波形 / 外部拖拽库 · 数据模型与调度层任何改动。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| v2.48.0 未提交改动与本计划同区域 | **前置硬条件**：先发版再动工（文首已标） |
| 期 1 阈值引入后既有拖拽用例批量变红 | 统一补 move 事件，一次迁移（t119 先行立住新口径） |
| 撤销后焦点丢失（arrangeRender 重建） | 期 1 接受；期 4 视反馈做焦点归还（记 `selChip` 回挂已有先例） |
| rAF 在桩环境不存在 | `syncPreviewCursor` 可独立调用，驱动层 `if (window.requestAnimationFrame)` 防御 |
| DOM 预算 | 静态净增 ≤ +2（tapCtx + 可能的试听行容器）；游标/ghost/气泡全是拖动/试听期临时节点，建-摘同 guide 模式 |
| 四期连发、版本纪律 | 每期独立：`gen-index --write` → 版本五处同步 → `check-all --strict-env` → 反向验证 → 冒烟人眼复核（真机拖一遍 390px） |
