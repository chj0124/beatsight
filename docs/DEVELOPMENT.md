# BeatSight 开发交接文档

> 写给下次继续开发的人（或 AI）。读完这份文档即可无缝接手，不需要重新推断项目性质。

## 1. 项目性质与硬约束

- **单文件应用**：所有代码在 `index.html`（HTML+CSS+JS 一体），禁止引入构建工具、框架、外部 CDN
- **零依赖、离线优先**：必须能双击 file:// 直接运行（PWA 化是 M3，不能破坏单文件性质——manifest/sw 用 Blob 内联注册）
- **移动优先**：布局以 390px 宽度为基准，桌面端 `max-width:1440px` 居中
- **界面语言**：中文
- **音色约束**（v0.8.0 起三音色）：click = 正拍 1046.5Hz / 重拍 1568Hz(triangle) / 细分 784Hz，短促包络（4ms 起音，90ms 衰减）；wood = 带通噪声（重拍 2000 / 正拍 1500 / 细分 1100Hz，Q=8，30ms）；drum = 底鼓扫频 150→50 / 军鼓带通 1800 / 踩镲高通 8000（音量 ×0.7）。全部集中在 `CONFIG` / `CONFIG.timbres` 常量区，勿散落硬编码；噪声一律程序生成 buffer，**禁止引入采样文件**

## 2. 文件结构

```
beatsight/
├── index.html            # 全部代码（样式 <style> + 逻辑 <script>）
├── README.md             # 项目门面
├── CHANGELOG.md          # 版本记录
├── LICENSE               # MIT
├── tests/
│   ├── run.js            # 主测试套件（node tests/run.js，零依赖）
│   ├── hang-guard.js     # 死循环看门狗：每用例独立子进程 + 超时强杀
│   ├── hang-case.js      # 看门狗的单用例探针（被 hang-guard 调起）
│   ├── screenshot.sh     # macOS 无头截图自验
│   └── README.md         # 测试原理与补断言规则
├── tools/                # 零依赖检查器（CI 与本地自验都跑，见 §5）
│   ├── check-module-order.js   # 架构约束：模块不得反向引用（R1/R2/R3）
│   ├── check-lint.js           # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars
│   ├── check-dom-ids.js        # DOM 引用完整性：$("x") 不得悬空
│   ├── check-coverage.js       # 行覆盖率（V8 内置采集，双阈值）
│   └── scan-util.js            # 上面几个共用的扫描工具（剥注释 / 括号配对）
└── docs/
    ├── prd.html          # 原始产品需求文档 v1.0
    └── DEVELOPMENT.md    # 本文档
```

`.github/workflows/` 有两个工作流：`test.yml`（语法 + 三项检查 + 全量测试 + 死循环看门狗 + 失败产物）与 `pages.yml`（在线版部署）。

## 3. 核心架构

### 3.0 模块地图（v0.6.0 起；v1.0.0 依赖方向净化）

`<script>` 顺序：**数据 → Store → 共享状态 → Modal → Viz → Audio → Trainer → Controls → Presets → Editor → init**

```
Store（持久化/状态创建/迁移/导入导出）
共享状态（S/customs 别名、draft、appliedPat、activePattern、curPattern、UI 同步助手、音频时钟变量）
→ Modal（应用内弹窗）→ Viz（时值可视化）→ Audio（Web Audio 前瞻调度）
→ Trainer（变速训练器）→ Controls（播放控制/BPM/拍号/Swing/音色/预备拍/静音拍）
→ Presets（预设库/回退提示/播放中切换挂起）→ Editor（自定义编辑器）→ init（装配）
```

- **任何模块不得反向引用后方模块**；运行期热路径（paintFrame/scheduler 每帧/每 25ms 读）只读共享状态区与前方模块——v1.0.0 把 activePattern/draft 从 Presets/Editor 上移至此区，消除了 Viz→Presets、共享→Editor 两处反向依赖
- **v1.3.0：这条规则从"注释里的口号"变成了可执行检查**（`tools/check-module-order.js`），并精确化为三条：
  - **R1 零例外**：IIFE 顶层执行期不得引用后方模块（真会产生 TDZ 的场景）
  - **R2 零例外**：**每帧渲染热路径**（paintFrame / paintFrameBody / paintBall）体内不得出现「后方模块名 + .」
  - **R3 白名单**：运行时回调可以调用后方模块，但必须在检查器的 WHITELIST 逐条登记并写明理由；条目失效（代码里不再出现）也会报错，防止白名单腐烂成"什么都放行"
  - 注：审计报告原文把 scheduler 也划进 R2，但同时又称 `Audio→Trainer` 属于"合法的运行时调用"（而它就在 scheduler 体内），自相矛盾。这里按实际语义修正——scheduler 是 25ms 周期回调，跨模块调用只发生在小节边界（约每 1–2 秒一次），归入 R3
- **跨模块装配用"钩子"而非直接调用**：`Store.setPersistFailHandler(fn)`、`onFrameError`。模块只暴露回调，由 init 段注入——避免小状态（Store）与渲染热路径（Viz）为了报告错误而反向引用后方模块

- `window.__beat` 暴露全部模块接口，是 tests/run.js 的断言入口，也是控制台调试入口
- 下列 3.1–3.5 的机制描述不变，只是函数有模块归属

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
- **paintFrame 只认 `vizSig`**（v0.9.0）：buildViz 时锁定的渲染拍号。播放中切拍号的挂起窗口内 S.sig 已变、画面未变，paintFrame 若用 S.sig 会让播放头按新拍号提前回卷（v0.9.0 修复的可视化脱轨 bug）
- **预备拍（v0.9.0）**：`S.countIn = {on, beats(1–8)}` 持久化；会话游标 ciStart/ciBeats/ciNext/ciLeft 在共享状态区，start() 时 loopStart 顺延 N 拍，scheduler 在 loopStart 之前独立调度计数音（不走 swing/静音拍），paintFrame 在此期间只显示「预备拍 · n / N」+ 跑道脉冲
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
- **播放中切换节奏型**（v1.1.1 改）：先试 `Audio.resyncToNow(newPat)` **就地接续**——**不动时间轴**，只用「已真实经过的 tick 数」在新节奏型的循环网格里重求 `(小节, 小节内 tick)`，取新节奏型中第一个「起始 tick ≥ 该位置」的音符接续。成功即点下生效，不再等小节边界；仅当新节奏型在本小节已无起点可接时返回 false，回退到旧的挂起路径（`pendingPattern` → `scheduler()` 小节边界消费并重映射 `loopStart`）
  - 关键不变量：`nextNoteTime == 本小节 tick 0 时刻 + 该小节累计 tick`。靠它能反推已走 tick，也让本函数对「同节奏型」幂等（`cum(schedStep)` 恒等于已走 tick）→ 重复点同一个节奏型相位零跳动
  - 接续点取「第一个 ≥ 当前位置的起点」，故 `nextNoteTime` **只向前**，绝不会把音符排到过去
  - 拍号变化时 `loopStart` 同样不动，位置按新拍号重新解释：小节线会挪（播放头一次像素位移，不可避免），但音频连续、不重现已走部分
  - 改这里的相位换算务必跑 T21 全组合扫描（9×9 节奏型对切 × 3 相位），单点用例覆盖不到稀疏↔密集、奇数拍↔4/4、小节末这些边界
- **停止时落定挂起**：`Controls.stop()` 调 `Presets.flushPending()`。档位高亮在点击时就切了，若挂起的切换不被消费，就会出现「档位已换、标题与网格还是旧的」半切换残留
- **静音拍**：`S.mute && schedBar === 3` 时跳过发声（视觉照常）
- **变速训练（v0.5.0）**：小节边界调 `trainerOnBarBoundary()`——每练满 `everyN` 小节经 `setBpm(v,false)` 升一级（时钟重映射不打断播放），到目标并练满一级自动 `stop()` 并提示；返回 true 时 scheduler 立即退出本次调度。爬坡会覆盖播放中的手动调速（下一级边界生效）
- 空小节（编辑器草稿）安全跳过。**跳过时空小节也强制正向推进 `nextNoteTime += pat.meter * spb()`**（`adv > 0 && isFinite(adv)` 兜底 0.5s），并有一层 `MAX_SCHED_STEPS = 512` 硬上限——脏拍号（`-3` / `0` / `"abc"`）曾让这个分支永不推进 → 主线程死循环（v1.2.4 修）
- **持久值收口（v1.2.4）**：`Store` 加载路径与编辑器共用**同一份**校验（`VALID_T` / `VALID_METER` 已上移到 `S` 创建之前，`validatePreset()` 复用）。`bpm`/`vol`/`accentVol`/`sig` 一律经 `numOr`/`clamp01`/白名单取值；`customs` 逐项校验，**淘汰项不静默丢弃**而是写入 `beatsight.quarantine` + `console.warn`，用户可人工找回。trainer / accents 用**显式白名单抽取**，不用 `Object.assign` 整包（消除对「`Object.assign` 只拷自有属性」的侥幸依赖）
- **发声末级钳制**：`playClick` 送出增益前过 `Math.min(1, Math.max(0, …))`。对合法输入是**无操作**（合法上界本就是 1），只在持久值被改坏时兜住 `vol:1e6 → +120 dBFS` 这类削波爆音
- 拍号/音量的 UI 入口统一走 `setSig()` / `setBpm()`，不要新写并行的 pill 高亮逻辑
- **弹跳球 onset 表（v1.2）**：排程每个非休止音符时（含静音小节）顺手 `onsetBuf.push({t, bar, cumT})`，时刻含 `swingShift()` 偏移；每轮调度末尾 `onsetNext = predictNext(pat)` 预测游标处下一发声点（与排程同源，值严格相等）；修剪保留最近 1s 已落地端点。Swing 偏移公式共享为 `swingShift()`——改 Swing 只改这一处，否则球与声音会分叉
- **前瞻窗口按可见性自适应（v1.3.0，审计 P1-3）**：`schedWindow()` = 前台 150ms（`CONFIG.schedWindow`）/ 后台 1.2s（`CONFIG.schedWindowBg`）
  - 为什么：调度时钟跑在主线程 `setInterval(25ms)` 上，而浏览器对**后台标签页**的定时器节流下限是 **1000ms**（Chrome 隐藏 5 分钟后还有 intensive throttling，约 1 次/分钟）。固定 150ms 窗口在后台等于「每次唤醒排 150ms 的音，然后静音 850ms」→ 后台播放必然断续。这也是路线图 M8「后台持续发声」一直落不了地的技术阻塞点
  - 后台窗口取 1.2s：大于节流下限，留 20% 余量
  - **行为变化（必须知道）**：后台下已排入的音符**无法撤销**，所以「点下即生效」在后台最多延迟一个窗口（1.2s）；回前台后立即恢复 150ms，无额外延迟
  - 回前台（`visibilitychange`）会**立即补排一次**，不等下一个 25ms 周期。顺序上「先补排、再收窄窗口」——此刻 `document.hidden` 已为 false，故本次补排用前台窗口
  - **调度饥饿兜底**：若游标落后实时时钟超过一个窗口（后台被长时间节流），**以当前时刻重新锚定**整条时间轴（`nextNoteTime = now + 0.05`，`loopStart` 同步、`schedBar/schedStep` 归零、onset 表清空），而不是把过去几十秒的音符一次性排到"现在"（那听感是一坨同时爆响；`MAX_SCHED_STEPS` 只拦得住死循环，拦不住这个）。用「重新锚定」而不是「按整循环前移」：前移粒度至少一小节（慢速 7/4 可达 16s、一循环 56s），很容易落到窗口之外反而多出一整格静音；而此时相位早已无意义

### 3.3 渲染循环（rAF，每帧）

`paintFrame()` 每帧只做便宜事：播放头 left% + 当前音符 fill 宽度% + 弹跳球 transform。
小节/音符切换时才做全量重绘（class 切换 + fill 0/100% + 组标签高亮）。

**外壳 / 主体两层（v1.2.4，改渲染层必须先读）**：

```
paintFrame()        ← 外壳：① if (!S.playing) return ② try{ paintFrameBody() }catch{ 停播 + 弹窗 + console.error } ③ 续 rAF
  └── paintFrameBody()  ← 主体：只画，**绝不调用 requestAnimationFrame**
```

- **续期只在 `paintFrame()` 一处**。这是硬约束：主体任何一条 `return` 分支都不再需要自己续期，所以「任何异常路径都不会丢掉下一帧」这个性质是**一眼可验证**的。v1.2.3 主体内部有 3 处各自 `requestAnimationFrame(...) + return`，中途抛异常 → 循环永久死亡 → 症状是**画面冻结、声音照响、控制台安静**
- 外壳的恢复动作各自包 `try`：万一异常源头就在这些 DOM 写入里（例如状态栏元素本身出问题），不能让它把「告诉用户」这一步也一起带走
- 主体守卫（脏值一律跳过本帧，等 `buildViz` / `setBpm` 修正回来再画）：`barTicks` / `posT` 非有限 → return；本行未渲染出格子 → return；**空小节 → return**（与 `scheduler` 同名守卫对齐）
- 全量重绘前 `activePattern()` **只取一次快照**（原先每格调一次，自定义预设下等于每次重绘 64 次线性查找）

**性能两条硬约束（v1.3.0，审计 P1-4，改渲染层必须遵守）**：

1. **帧内零 `offset*` 读取**。几何一律读缓存 `rowGeo`（`geoOf(i)`），只在两处采集：`buildViz()` 末尾、`resize` 时（`S.playing` 时只重采缓存、不重建 DOM）。为什么：原实现每帧先写 7 处 style（播放头 left / 尾迹 left+width …），紧接着 `paintBall` 里去读 `row.offsetLeft/offsetWidth` —— 浏览器被迫在帧中途做一次**同步重排**（layout thrashing，rAF 里最典型的性能反模式），中低端机上直接掉帧
2. **增量重绘**：换音符时只改变化的那几格（旧 active → played、新 active → active、`.next` 搬家，约 6 次 className 写入），只有**换小节**才全量重扫。原实现每次换音符都双层循环重写 4 小节全部格子（Funk 十六分 = 128 次写入/换音符，240BPM 下约 2000 次/秒）
   - 全量与增量**共用 `setCell()` / `setGroup()`**，所以「增量结果 == 全量结果」是结构性保证而非巧合
   - 触发全量的条件（写在一起便于审查）：首帧 / 换小节 / `active` 前进超过 1 格（掉帧或节流跨格）/ `active` 回退 / 格子数变化
   - `resetTracking()` 会清 `lastPainted`——网格可能整片重建（拍号、格子数都会变），此时增量的前提已不成立
   - 回归：`tests/run.js` T27 逐帧交叉检查渲染结果是否仍满足全量重绘的那套不变量（active 唯一、current 行对齐、前后格状态、next 唯一且为 active 后继、fill 宽度）


**弹跳球（v1.2）**：`paintBall(now, bar, tib)` 每帧驱动。端点 = `onsetBuf`（已排程，Audio 写 Viz 读）+ `onsetNext`（Audio 预测的下一发声点——**视觉要看得远一跳，不能依赖调度器 150ms 前瞻窗口**，否则慢速下落地僵住）。落点时刻 = 真实发声时刻（含 Swing、静音小节照跳、休止跳过）。运动：y = H·4p(1−p)，H = clamp(120·T², 10, 48) 且顶点不出容器空域；触地 70ms 挤压回弹 + 空中拉伸 + 落地预压 + 地面投影；不做滚动旋转（接缝回卷伪影）。**跨小节 = 接力制（v1.2.3）**：每小节一颗球自始至终跳完本行，终端弧终点 = 本行右缘（时刻 = 小节边界，与下一行首拍发声同时），期间待命球（半透明）停在新行首 onset 处、边界无缝交接；小节前导休止时球停在首 onset 待命。onsetBuf 修剪保留最近 1s 且 ≥8 条（30BPM 的 7/4 小节 16s，上一颗本行 onset 可能很远）。开关 `S.bounce`（默认开）只控显隐。

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

### 3.6 持久化：冷热分离（v1.3.0，审计 P1-5）

| key | 内容 | 写入时机 |
|---|---|---|
| `beatsight.state` | bpm/vol/accentVol/mute/sig/sel/swing/accentGrp/timbre/countIn/trainer/bounce/migHint（**< 1 KB**） | 每次交互，**250ms 尾部防抖**；`flush()` 立即写 |
| `beatsight.customs` | `{v:1, customs}` 预设库 | 只在预设增删改时，**立即写**（不防抖——丢掉一个手写节奏型代价太大） |
| `beatsight.m2` | **旧键，只读的迁移来源** | 仅首次升级时读取；拆分成功且写后校验通过后**删除**（v1.3.1），备份存 `beatsight.m2.bak` |
| `beatsight.quarantine` | 未通过结构校验的预设（人工找回用） | 加载时发现淘汰项才写 |

- 为什么要拆：原实现把预设库塞进同一个 key，而 `persist()` 挂在几乎每个交互上。实测 10/100/500 个预设 = 14 KB / 143 KB / **715 KB**，每次点击都要全量 `JSON.stringify` + 同步写盘 → 5–20ms 主线程阻塞，**正好会触发音频掉音**（与 P1-3 同源）
- **防抖窗口内不能丢**：`visibilitychange`（转为隐藏）与 `pagehide` 都会 `flush()`
- **写失败必须可见**：`catch(e){}` 静默降级改为经 `setPersistFailHandler` 上报 → 顶栏状态点变红 + chip 文案改「保存失败」+ 一次性弹窗。原先用户攒了几十个预设却存不进去时**毫无察觉**
- 读取优先级：新键存在即以其为准，否则回落旧键——所以老用户与既有测试的种子数据都能跑
- **旧键清理（v1.3.1）**：拆分成功后删除 `beatsight.m2`（否则老用户永远留着一个最大可达 715 KB 的废弃键）。删前两道保证，缺一不删：① **写后校验**（写完读回来确认能解析出预期结构）；② **必有备份**（确保 `.bak` 存在，已存在则不覆盖——保留最早那份最原始的数据）。触发条件只认 `!hotIn`（真正的老版本升级）；"热键在、冷键缺"的半迁移状态**不动旧键**，避免把用户已删掉的预设从陈旧数据里复活

### 3.7 无障碍（v1.3.0，审计 P2-11）

- **分级播报**：`#statusText` 每换一个十六分音就更新，**绝不能挂 `aria-live`**（读屏会刷屏）。另设 `#srAnnounce`（`.sr-only` + `role="status"` + `aria-live="polite"`），只在「开始 / 停止 / 训练完成」这类状态迁移时由 `announce()` 写入
- **开关三件套收口**：`setToggle(id, on)` 一次写全 `className` + `aria-checked`。原先 4 个开关各写一遍 className，加无障碍语义后必然漂移
- **三选一 pill**：`setPressed(selector, pred)` 让 `.active` 与 `aria-pressed` 同源更新
- **动效降级**：`prefers-reduced-motion` 下 CSS 关掉装饰性动画（`.dot.live` / `.cell.next` / `.trail-glow`），JS 侧 `REDUCE_MOTION` 把弹跳球的挤压/拉伸置为无形变。**只降形变、保留位置**——球在哪儿、何时落地是核心功能提示，不能去掉
- **焦点陷阱**：弹窗/编辑器打开时给 `.main` / `.topbar` 置 `inert`，关闭时还原焦点。用 `Modal.refreshInert()` **重算**而不是置位/复位——编辑器里再弹确认框时，弹窗关闭不能把仍开着的编辑器对应的 inert 一起摘掉

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
node tests/run.js    # 全 PASS 才继续；CI（.github/workflows/test.yml）在每次 push 自动跑同一套
                     # v1.2.4 起渲染层已进覆盖（T23 系列用 driveFrames 同时推进音频时钟与 rAF 帧），
                     # 改 paintFrame / 加守卫后**必须**有对应断言，否则下一个人会把它改回来
FULL_SCAN=1 node tests/run.js   # 跑 T21 的 243 组全组合扫描（默认只跑抽样 16 组，CI 里跑全量）
node tests/hang-guard.js   # 死循环看门狗（v1.2.4 起）：每用例独立子进程 + 超时强杀
                     # 单进程的 run.js 一旦被死循环卡住会挂满 CI 的 6 小时超时，而不是干脆失败
                     # 反向验证：BEATSIGHT_HTML=<旧版 index.html> node tests/hang-guard.js 3000

# 1) JS 语法校验（提取内联脚本，编译不执行）
node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);new Function(m[1])"

# 1.5) 四项零依赖检查（v1.3 起，CI 里也跑）
node tools/check-module-order.js   # 架构约束：模块不得反向引用（R1/R2 零例外，R3 白名单登记）
node tools/check-lint.js           # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars
node tools/check-dom-ids.js        # DOM 引用完整性：$("x") 不得悬空
node tools/check-coverage.js       # 行覆盖率（v1.3.1）：V8 内置采集，总阈值 97% / 分区 90%
                                   # 加 --full 跑全量扫描；改完核心逻辑务必看一眼分区表

# 2)+3) 无头 Chrome 截图 + 控制台报错检查（macOS 一条命令，v1.0.0 起固化）
tests/screenshot.sh              # 桌面 1440×1150
tests/screenshot.sh 800 1800     # 窄屏
```

**必须在真实浏览器里人工做一次的事（无法自动化，别跳过）**：

- **后台 30 秒不断音**（v1.3 自适应窗口的验收，审计 P1-3）：真实浏览器打开页面 → 开始播放 → 切到别的标签页 30 秒 → 切回来听/录音核对没有空隙。
  **为什么自动化不了**：`setInterval` 的后台节流是**浏览器层面的行为**，无头环境里页面始终被视为可见、不会真的节流；用脚本改写 `document.hidden` 只能验证我们的窗口切换逻辑（那部分已由 T26 覆盖），验证不了"浏览器真的按 1s 节流时还够不够"。用假时钟也造不出这个条件。
- **后台切回后「点下即生效」的延迟**：后台期间切节奏型，最多延迟一个窗口（1.2s）才生效——这是设计取舍，确认可接受即可。

**写完检查器/断言后要反向验证**（v1.3 起的硬规矩）：把修复临时"退回"，确认目标断言**真的会失败**。没做过反向验证的测试等于没有测试——尤其对"窗口自适应""增量重绘""零布局读取"这类**没有肉眼可辨症状**的性能承诺。

**坑（都踩过）**：
- macOS 无头 Chrome 在 WorkBuddy 沙箱 shell 内报 `sandbox initialization failed`：加 `--no-sandbox`；`--virtual-time-budget` / `--timeout` 组合可能挂起不退出——后台跑 + 到时 pkill 兜底（v0.6.0 踩）
- `--user-data-dir` 每次必须换新目录，否则静默失败无截图
- headless=new 有 ~500px 最小窗口宽度：`--window-size=390` 实际 innerWidth=500，截图按 390 裁会"假性溢出"。诊断响应式先 dump-dom 验证真实 innerWidth，或用 `--force-device-scale-factor=2` + 双倍窗口尺寸折算
- 含持续 rAF/AudioContext 的页面用 `--virtual-time-budget` 截不到播放态，用 `--timeout=9000`（也只能抓加载态）
- 播放/发声验证必须真人点击（浏览器音频手势策略）
- 想截图特定预设/编辑器：临时复制一份文件，改 `sel` 默认值或末尾追加 `openEditor()`，截完删除临时文件
- **量布局不要靠眼睛**：在 `</body>` 前插一段**同步**探针（不要套 `load`/`setTimeout`，`--dump-dom` 在 load 后立刻吐出，异步探针赶不上），把 `getBoundingClientRect()` 结果塞进一个 `div` 再用正则抠出来。`--dump-dom` 输出的是被探测页面自身的 DOM，所以字符串只出现在注入的 `div` 里，不会撞上源码注释里的同名字面量（v1.0.1 踩过正则误匹配源码）
- **`<datalist>` 给 range 做刻度在 Chrome 里不渲染**：实测不加 `appearance:none` 也一样，属浏览器未实现（非样式冲突）。要刻度只能自己画绝对定位层（v1.1 踩）

## 6. 路线图（2026-09-07 重排）

已完成：~~M1 节拍内核~~ / ~~M2 预设+编辑器~~ / ~~M3-2 变速训练器~~ / ~~v0.6 模块化+导入导出+持久化测试~~ / ~~v0.7 tick 制+三连音/Swing/奇数拍~~ / ~~v0.8 三套程序合成音色~~ / ~~v0.9 预备拍+可视化脱轨修复~~ / ~~v0.9.1 防御性补丁~~ / ~~v1.0 依赖方向净化+Editor 测试+CI~~ / ~~v1.0.1 重拍增强量倒挂+音量行错位~~ / ~~v1.1 BPM 常用速度档（60/72/84/96/120）+ ±5 粗调 + 滑杆手绘刻度~~ / ~~v1.1.1 播放中切节奏型点下即生效（相位就地接续）+ 停止落定挂起~~ / ~~v1.2 弹跳球预判式可视化（onset 表 + 预测终点 + 真实球体物理）~~ / ~~v1.2.4 持久值健壮性收口（加载路径校验复用 + 渲染帧外壳/主体分离 + 调度器防死循环 + 音量末级钳制 + 渲染层进测试覆盖 + 死循环看门狗）~~ / ~~v1.3 审计第二/三梯队（持久化冷热分离 + 后台调度自适应 + 渲染几何缓存与增量重绘 + CI 三项检查 + 无障碍分级 + PWA 元信息与 Pages + 音频生命周期补全 + 跨 origin 提示）~~ / ~~v1.3.1 遗留收口（V8 内置覆盖率采集并接入 CI + 弹跳球物理逐帧数值断言 + 交互接线层补测 + 旧键清理）~~

按优先级排队：

1. **v1.4 练习闭环第一刀**（原 v1.1，因 v1.1 让位给 BPM 速度档而后移）：停止时自动记录有效播放（≥30 秒）到 `beatsight.log`；统计 overlay（顶栏 chip 入口）：本周时长/连续天数/速度纪录/累计场次四卡 + 近 7 天条图（div 实现，不引图表库）
2. **PWA 离线**：内联 manifest（Blob URL）+ Service Worker（元信息与 `theme-color` / `icon` / Pages 部署已在 v1.3 就位）
3. **后台持续发声收尾**：自适应窗口（v1.3）已打通调度侧阻塞点；剩余是 iOS 保活——优先 `navigator.wakeLock.request("screen")`，不支持时用静音循环 audio 元素，均需设置页开关
4. **训练计划**：「上次训练一键继续」起步，7 天爬升计划的形态视统计数据使用情况再定

### 已埋的技术债 / 后续要盯
- 快捷档值 `CONFIG.speedPresets` 目前只服务 BPM；若日后音量、拍号也要常用值，考虑抽成通用 preset row 组件，别复制三份
- 滑杆刻度是手绘层，`--thumb-r` 必须与实际 `::-webkit-slider-thumb` 尺寸同步；再改圆钮大小记得同改 `.slider-wrap` 的内缩变量
- **静态检查仍是自写的窄规则集**：架构约束 / 四项 lint / DOM 引用 / 覆盖率都已就位，但覆盖面小于 ESLint 生态（无 `no-undef`、无类型检查）。要更全套就加 `package.json` + ESLint devDependency——只进 CI、不进产物（"零依赖"约束针对的是 `file://` 直开的运行时产物，不是开发工具）
- **后台持续发声仍需真人验收**（见 §5）：自适应窗口只能用假时钟断言，浏览器层面的定时器节流无法在无头环境复现
- 覆盖率唯一未覆盖的 3 行是 `scheduler` 的 `MAX_SCHED_STEPS` 硬上限分支（实测 99.8%）——单轮调度要处理超过 512 个音符才会触发，属**刻意保留的防御性代码**，不为了数字去造人工状态点亮它
- `Viz.paintBall` 的 `H = min(clamp(k·T²,10,48), yBase+6)` 里那道"顶点不出容器空域"的钳制，只在**第一行且弧很长**时才会真正生效；T30 覆盖了公式本身，但没单独构造触顶场景。改动行高/内边距时要留意

### 已明确不处理（不再跟进）
- **Firefox 圆钮样式**（2026-09-11 决定忽略）：本项目只写了 `::-webkit-slider-thumb`，没有 `::-moz-range-thumb`，理论上 FF 下圆钮可能与刻度略错位。本机无 Firefox、未实测，用户已决定不处理 → **不再列为待办，也不要主动盘它**（不必提、不必测、不必补）。仅当日后真有人在 Firefox 下反馈刻度错位时，再回来补这两条伪元素规则

## 7. 用户协作偏好

- 无技术背景：解释技术问题用生活化比方，不堆术语
- 在意 token 成本：改动合并成一条明确需求；声称完成前必须自验（语法 + 真实浏览器截图）
- 决策记录写进 CHANGELOG.md，关键状态写进本文档
