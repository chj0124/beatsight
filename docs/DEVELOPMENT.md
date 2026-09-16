# BeatSight 开发交接文档

> 写给下次继续开发的人（或 AI）。读完这份文档即可无缝接手，不需要重新推断项目性质。

## 1. 项目性质与硬约束

- **单文件应用**：应用代码全在 `index.html`（HTML+CSS+JS 一体），禁止引入构建工具、框架、外部 CDN
- **零依赖、离线优先**：必须能双击 file:// 直接运行。v1.4 PWA 化的落地方式：新增 `manifest.webmanifest`/`sw.js`/`icon.svg` 三个**独立文件**，注册逻辑在 index.html 里按协议收口（仅 http(s) 生效，file:// 整段跳过）——**SW 不能用 Blob 内联注册**（浏览器禁止），这是单文件原则唯一的一次妥协，且不影响单文件直开
- **移动优先**：布局以 390px 宽度为基准，桌面端 `max-width:1440px` 居中
- **界面语言**：中文
- **音色约束**（v0.8.0 起三音色）：click = 正拍 1046.5Hz / 重拍 1568Hz(triangle) / 细分 784Hz，短促包络（4ms 起音，90ms 衰减）；wood = 带通噪声（重拍 2000 / 正拍 1500 / 细分 1100Hz，Q=8，30ms）；drum = 底鼓扫频 150→50 / 军鼓带通 1800 / 踩镲高通 8000（音量 ×0.7）。全部集中在 `CONFIG` / `CONFIG.timbres` 常量区，勿散落硬编码；噪声一律程序生成 buffer，**禁止引入采样文件**

## 2. 文件结构

```
beatsight/
├── index.html            # 全部应用代码（样式 <style> + 逻辑 <script>）
├── manifest.webmanifest  # PWA manifest（v1.4；仅在线版被引用，file:// 下不加载）
├── sw.js                 # Service Worker（v1.4；同上。导航 network-first、静态 cache-first）
├── icon.svg              # PWA 图标（同源相对路径，manifest 内引用）
├── README.md             # 项目门面
├── CHANGELOG.md          # 版本记录
├── LICENSE               # MIT
├── package.json          # 开发期自验工具链（唯一 devDependency：eslint；只跑本地，不进产物）
├── eslint.config.js      # ESLint flat config（本地自验专用，规则集与取舍写在文件头）
├── wrangler.jsonc        # Cloudflare Workers 静态资源目录声明（唯一入库的 Cloudflare 配置；构建/部署命令仍在 Dashboard）
├── tests/
│   ├── run.js            # 主测试套件（node tests/run.js，零依赖）
│   ├── hang-guard.js     # 死循环看门狗：每用例独立子进程 + 超时强杀
│   ├── hang-case.js      # 看门狗的单用例探针（被 hang-guard 调起）
│   ├── screenshot.sh     # macOS 无头截图自验
│   └── README.md         # 测试原理与补断言规则
├── tools/                # 零依赖检查器（见 §5：node tools/check-all.js 一条命令跑全套）
│   ├── check-all.js            # 本地完整自验入口（取代原来的 GitHub Actions CI）
│   ├── check-module-order.js   # 架构约束：模块不得反向引用（R1/R2/R3）
│   ├── check-lint.js           # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef
│   ├── check-eslint.js         # 代码卫生 · 加强（**可选**）：ESLint 包装（抽脚本 + 行号回映射；缺依赖自动跳过）
│   ├── check-tsc.js            # 类型检查 · 加强（**可选**）：tsc 包装（同上；见 §5 与 tools/tsconfig.typecheck.json）
│   ├── tsconfig.typecheck.json # 类型闸门的规则集与取舍说明（为什么 checkJs 开着、严格开关关着）
│   ├── check-dom-ids.js        # DOM 引用完整性：$("x") 不得悬空
│   ├── check-coverage.js       # 行覆盖率（V8 内置采集，双阈值）
│   └── scan-util.js            # 上面几个共用的扫描工具（剥注释 / 括号配对 / 字符串掩码 / 声明表）
└── docs/
    ├── prd.html          # 原始产品需求文档 v1.0（已归档：现行功能以 CHANGELOG 为准）
    ├── DEVELOPMENT.md    # 本文档
    ├── PLAN-v1.5.md      # 历史方案存档（v1.4.1→v1.6 的 P0–P3 已全部落地）
    └── PLAN-v1.9.md      # 现行方案：v1.8.2→v1.10（工程债 / 扫弦方向 / 练习量 / 听辨训练 / 曲式编排评估）
```

**发布渠道（两条，各司其职）**：

- **① Cloudflare，自动**：仓库接 Git，推 `main` 即自动构建部署 → https://beatsight.chenhuajian1995.workers.dev/ 。构建命令里串了 `node tools/check-all.js` 全量检查，**不通过就不部署**，所以这条路上线上始终是最新代码
- **② WorkBuddy，手动**：https://beatsight-48543.app.workbuddy.host/ （v2.0.1 起；旧链接 beatsight-34873 已随换绑废弃，停在 v1.6.0 不再更新）。**只在你用 WorkBuddy 打开项目并发布时才更新**——所以它滞后是常态、不是故障，随手一比"WorkBuddy 上还是旧版"不说明任何问题，判断"线上是不是最新"请以 Cloudflare 为准
  - ★ **发布的是一整份目录，所以要单独建一份干净副本再发**：`beatsight-publish/`（只有 `index.html` / `manifest.webmanifest` / `sw.js` / `icon.svg` 四个文件，约 300 KB）。
    不要直接发 `beatsight/`——那里有 44 MB 的 `node_modules`，以及 `tests/` `tools/` `docs/` `package.json` `wrangler.jsonc`，
    发上去就都变成公开可访问的了。**每次重新发布前要先重新 copy 覆盖**，否则会发到旧版本
  - ★ **应用归属是按"工作区（会话）"判定的，不是按目录**：每个 WorkBuddy 工作区根目录有一个
    `.<appId>.genie` 标记文件，记录它发布到哪个应用。**指定别的 appId、或从别的工作区的目录发布，
    都会被路由回当前工作区自己那个应用**——所以一个应用只能在"当初创建它的那个工作区"里更新。
    旧应用更新不了就换绑新链接（34873 → 48543 就是这么发生的）

项目**不用 GitHub Actions**（`.github/workflows/` 早期有过、后全部移除），机器检查改由 `node tools/check-all.js` 在本地一键跑完（见 §5）。Cloudflare 侧只留一份最小配置 `wrangler.jsonc`：Workers 的静态资源（Static Assets）**必须**由 Wrangler 配置文件声明资源目录（`assets.directory = ./dist`），否则构建里的部署命令无法定位要发布的文件、当场失败——**构建命令 / 部署命令 / 根目录仍全部在 Dashboard 里配**，仓库里没有 `_headers` / `_redirects` / `functions/`，也没有 Worker 脚本（纯静态托管，Worker 不参与请求）。

## 3. 核心架构

### 3.0 模块地图（v0.6.0 起；v1.0.0 依赖方向净化；v1.4 扩到 10 模块；v1.10 起 11 模块；v2.0 起 12 模块；v2.0.1 起 13 模块）

`<script>` 顺序：**数据 → Store → 共享状态 → Modal → Viz → Audio → Trainer → Controls → Presets → Editor → Stats → Ear → KeepAlive → init**

```
Store（持久化/状态创建/迁移/导入导出/练习记录）
共享状态（S/customs 别名、draft、appliedPat、activePattern、sessStartT、UI 同步助手、音频时钟变量）
→ Modal（应用内弹窗）→ Viz（时值可视化）→ Audio（Web Audio 前瞻调度）
→ Trainer（变速训练器 + 上次训练接续）→ Controls（播放控制/BPM/拍号/Swing/音色/预备拍/静音拍/练习入账）
→ Presets（预设库/回退提示/播放中切换挂起）→ Editor（自定义编辑器）
→ Stats（练习统计汇总 + overlay）→ Ear（听辨训练：出题/判分/战绩，v1.10.0）→ Arrange（曲式编排 UI，v2.0.0）→ Help（使用方法页，v2.0.1）
→ KeepAlive（后台保活：wakeLock + 静音音频兜底）→ init（装配）
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
- **扫弦方向 `dir`（v1.9.0，可选字段）**：步对象上可挂 `dir: "D"|"U"`（下扫/上扫），省略即不标注。
  **它是纯记谱层字段——`scheduler` 一行都不读**（与 Swing「演奏参数不入时值」同类先例），
  所以老数据零迁移、老 JSON 导入后就是"无箭头"。内置民谣扫弦带 `DDUUDU`，与其名称逐字对应。
  `rep4` / 编辑器 `{...s}` / 撤销栈 `JSON.stringify` / 导出全部自动带上，无需为它加代码；
  渲染见 §3.4，编辑器入口见 §3.5
  - **校验口径的分界线**（改动前务必先读这条）：`dir` 脏值**静默降级为"不标注"**，
    不让整条预设失败；休止符上的 `dir` 一并抹掉（休止不承载扫弦动作）。
    这与 v1.2.4「淘汰项不静默丢弃」**不冲突**，因为那条针对的是会让节奏型**不可用**的
    结构性损坏（时值非法、小节不完整）；箭头丢了节奏型依然完整可弹，为它弹窗报错反而更糟
- **改数据结构时必须同步**：`buildViz`（渲染）、`scheduler`（发声）、`paintFrame`（动画）、编辑器 `draft`、`validatePreset`（加载/导入校验）
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
- **练习量（v1.9.0）**：两句就说完——**入口在 `scheduler()` 最前面**，`if (onLimitPulse && onLimitPulse()) return;`
  每个 25ms 周期问一次「该不该停」；**计数在 `schedBar` 前进的两处**（正常小节边界 + 空小节跳过分支）
  各 `limitBars++`，保持「计数 = 小节边界数」这条不变式
  - 为什么判定放最前面而不是小节边界：`min` 模式按音频时钟差算，若按小节边界判，
    30BPM 的 7/4（一小节 16 秒）会晚停十几秒；放这里则与 BPM/拍号完全无关
  - `bars` 模式天然按小节对齐（`limitBars` 只在小节边界增长），不需要额外对齐逻辑
  - **到点处置归注入的钩子**（`onLimitPulse`，装配层赋 `Controls.onLimitPulse`）：
    Audio 声明在 Controls 之前，直接调 `Controls.stop()` 是反向引用（§3.0 的钩子纪律）。
    与 `onFrameError` / `Store.setPersistFailHandler` 同一套模式
  - **预备拍不吃额度**：`limitT0` 在预备拍数完那一刻才取（`Controls.start` 里先置 null）。
    注意它主要是为**进度显示**服务的——去掉它，min 模式的停止时刻其实不变
    （`start()` 算 `loopStart` 时已把 N 拍顺延进去，值等价），但进度区会在预备拍期间就显示
    「已练 0:00 / 5:00」。**别当成冗余代码删掉**（反向验证已确认这条）
  - **已知行为（与既有训练器同源）**：`bars` 模式的墙钟停止时刻会早于小节边界最多约 0.85s
    （前瞻窗口 150ms + 一个音符时长）。小节计数在**排程**时累加，而 `stop()` 只停时钟与画面、
    **不取消已排入音频时钟的振荡器**——所以那 N 小节的音一个不少地响完。
    判据始终是「发声个数 = N × 每小节音数」，不是墙钟
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


**弹跳球（v1.2）**：`paintBall(now, bar, tib)` 每帧驱动。端点 = `onsetBuf`（已排程，Audio 写 Viz 读）+ `onsetNext`（Audio 预测的下一发声点——**视觉要看得远一跳，不能依赖调度器 150ms 前瞻窗口**，否则慢速下落地僵住）。落点时刻 = 真实发声时刻（含 Swing、静音小节照跳、休止跳过）。运动：y = H·4p(1−p)，H = clamp(120·T², 10, 48) 且顶点不出容器空域；触地 70ms 挤压回弹 + 空中拉伸 + 落地预压 + 地面投影；不做滚动旋转（接缝回卷伪影）。**跨小节 = 接力制（v1.2.3）**：每小节一颗球自始至终跳完本行，终端弧终点 = 本行右缘（时刻 = 小节边界，与下一行首拍发声同时），期间待命球（半透明）停在新行首 onset 处、边界无缝交接；小节前导休止时球停在首 onset 待命。onsetBuf 修剪保留最近 1s 且 ≥8 条（30BPM 的 7/4 小节 16s，上一颗本行 onset 可能很远）。开关 `S.bounce`（默认开）只控显隐。**待命球起跑预备（v1.8.0，v1.8.1 修正为含水平分量）**：终端弧期间（末 onset → 小节边界），待命球把主球的终端弧**整条抛物线**平行复制到下一行——从新行首 onset 左侧起跳，同相位 p、同高 H、同形变（复用主球本帧 sx/sy），边界同时触地；水平跨距 = 终端弧跨距、封顶行宽 20%。只动待命球位移/形变，交接时刻（= b2.t）分毫不动；REDUCE_MOTION 下保持贴地停泊位不跳。回归：tests T41（逐帧贴合复制抛物线 3px 容差 / 水平单调 / 过界交接位置不变）。

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
- **扫弦方向徽标（v1.9.0）**：`.cell-strum` 挂在**格子内部**（`strumEls` 与 `labelEls` 同构，无徽标处存 null），
  显示 ↓ / ↑。三个必须知道的设计点：
  1. **不跟随主题色**：绿/蓝在 `.cell.played` 的纯白填充上对比不足，改用「深底 + 亮描边 + 近白字形」，
     两个主题通吃——不必往观测台覆盖块再加一份
  2. **画在格内而不是时值标签行**：标签只给 t≥24 发声，画在标签行会丢掉切分位上那颗下扫
     （民谣扫弦第 5 颗，12t），而它恰恰是最需要提示的一颗。T47 有一句专门钉这条
  3. **窄格整体隐藏**，不做部分裁切：`fitCellAnnotations()` 里用常量阈值 `STRUM_MIN_W=20`
     比较 `offsetWidth`（徽标是定宽元素，拿 `scrollWidth` 比没有意义）
- **`fitCellLabels` 已改名 `fitCellAnnotations`（v1.9.0）**：一处函数同时管时值标签、组标签、
  扫弦徽标三者的宽窄自适应。**调用点与帧内纪律一律不变**——仍只在 `buildViz` 末尾与 resize 后调用，
  `paintFrame` 里一次 `offset*` 都不读（v1.3.0 P1-4 的性能承诺靠这一点成立，往帧内加读取会立刻破功）

### 3.5 编辑器

全屏 overlay（`#editor`，role="dialog"）。草稿 `draft` 深拷贝当前节奏型；`edSel` 选中的音符块、`editBar` 目标小节（标签显示「· 编辑中」）。
校验：`barSum(bar) === draft.meter`（1e-9 容差），任一小节不完整 → 保存按钮禁用 + 该行标红。
**撤销栈（v0.4.0 起）**：任何草稿变更前先 `pushUndo()` 快照（JSON 序列化 bars，上限 50）；Ctrl+Z / 撤销按钮回退。危险操作（复制到全部/清空/未保存返回）需 confirm。
试听：`S.preview=true` 后复用主引擎，`curPattern()` 返回 draft；试听前记录 `prevSigBeforeAudition`，停止/保存时还原主界面拍号。
**扫弦方向三档（v1.9.0）**：`#dirRow` 的「↓ 下扫 / ↑ 上扫 / 不标注」作用于 `edSel` 选中的音符。
可用性、高亮、`aria-pressed` 与选中状态**同源更新**（三件事全部收在 `render()` 里）——
分散写必然漂移，这是 v1.3.0 开关三件套的教训。未选中、或选中的是休止符时三档禁用并给出原因
（禁用而不是弹窗报错，避免误点即打扰）；点击处理器同样再拦一次，两道防线。
重复点当前档位不产生变更、不污染撤销栈（T47c 有一句专门钉这条）。

### 3.6 持久化：冷热分离（v1.3.0，审计 P1-5）

| key | 内容 | 写入时机 |
|---|---|---|
| `beatsight.state` | bpm/vol/accentVol/mute/sig/sel/swing/accentGrp/timbre/countIn/trainer/bounce/keepAwake/migHint/plan/**limit**（**< 1 KB**，实测 328 字节） | 每次交互，**250ms 尾部防抖**；`flush()` 立即写 |
| `beatsight.customs` | `{v:1, customs}` 预设库 | 只在预设增删改时，**立即写**（不防抖——丢掉一个手写节奏型代价太大） |
| `beatsight.m2` | **旧键，只读的迁移来源** | 仅首次升级时读取；拆分成功且写后校验通过后**删除**（v1.3.1），备份存 `beatsight.m2.bak` |
| `beatsight.quarantine` | 未通过结构校验的预设（人工找回用） | 加载时发现淘汰项才写 |
| `beatsight.log` | `{v:1, sessions:[{t, sec, bpm, name}]}` 练习记录（v1.4） | 停止一次 ≥30s 的有效练习时**立即写**（冷键语义，不进防抖）；环形截断最近 400 场 |
| `beatsight.ear` | `{v:1, total, right, best}` 听辨训练战绩（v1.10.0） | 答完一题**立即写**（冷键同语义）；`right` 用 `min(total,…)` 夹住，防脏数据算出 >100% 正确率。v1.11.0 起同时显示在统计面板（**只是读，不新增键**） |
| `beatsight.arranges` | `{v:1, arranges:[{id, name, sections:[{name, blocks:[{ref, repeats}]}]}]}` 曲式库（v2.0.0） | 增删改曲式时**立即写**（冷键语义，丢不起）。**只做结构校验**（段/块/遍数/上限/总小节数）；引用存在性与拍号一致性由共享状态区的 `arrangeProblems()` 判（要 `resolveRef`，而它在 Store 之后——这条边界别混，见 §3.9 的口径讨论） |
| `beatsight.theme` | `"classic"` / `"obs"` 主题偏好（v1.7.0） | 点顶栏「主题」切换时立即写；**独立键**，不进上面的冷热拆分，写失败静默降级 |

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

### 3.8 听辨训练（v1.10.0）

模块 `Ear`（排在 `Stats` 之后、`KeepAlive` 之前）。玩法：取一个易混组 → 自动播 2 小节 →
从 3 张**只给记谱不给名字**的候选里选 → 即时反馈 + 战绩。

- **候选不给名字**是刻意的，别"顺手加上"：「附点布鲁斯」这个名字直接把答案写在脸上，
  给了名字就变成「读名字猜」，练不到耳朵。作答后才揭示
- **出题质量在数据表里，不在代码里**：随机抽内置预设会出送分题与无解题，所以手写 `EAR_GROUPS`
  易混组（同组候选听觉上真的容易混）。组表完整性由 T49 断言——表写错是开发期错误，
  要在测试里立刻炸，而不是让用户遇到一道没有正确答案的题
- **候选顺序打乱、答案位置随机**：否则用户会学出「总选 A」的歪策略（T49b 用 300 次随机断言分布）
- **复用主引擎的试听通道**：`previewRef` 泛化（见 §3.1 的 `curPattern`），
  编辑器指向草稿、听辨指向本题答案。**绝不另起一套调度**——双时钟、双热键、双缓存三份麻烦
- **自动停靠「会话播放额度」**：共享状态 `playQuota` + `onQuotaDone`，与练习量共用同一个
  `onLimitPulse` 钩子（见 §3.2）。**额度分支优先于练习量**——试听不是练习，那段声音不该
  消耗用户的练习量额度、也不该弹「已练满 N 小节」。T49g 把练习量设成「1 小节就停」来钉这条
- **「正在播放」从状态推导**（`S.playing || playQuota > 0`），不设独立标志位：
  标志位一旦有一条停播路径没走到，按钮就永远卡在「播放中…」且禁用
- **作答即停播**，并顺手作废额度（否则下一题会带着旧额度「放一半就停」）
- 战绩存冷键 `beatsight.ear`；`right` 用 `min(total, …)` 夹住，防脏数据算出 >100% 正确率
- 接入既有那套 overlay 纪律：`Modal.refreshInert()` 纳入 `earOverlay`；键盘处理器加 `Ear` 分支
  （overlay 打开时空格不误触播放、Escape 关闭）——`Controls → Ear` 已在 R3 白名单登记，理由同 `Controls → Stats`

### 3.9 练习统计的两个口径（v1.11.0）

统计面板的汇总都走 `Stats.summarize(list, now, rangeDays, available)`（纯函数，`now` 与
`available` 都可注入——测试用固定时钟断言窗口边界）。**六个数各有口径，其中两组刻意不同**：

| 字段 | 口径 | 为什么 |
|---|---|---|
| `weekSec` | 本周（周一 00:00 起） | 「这周练了多久」 |
| `streak` | 连续自然日（今天没练从昨天往回数，不归零） | 别因为"今天还没练"就把连击清零 |
| `maxBpm` | **全时段**最高 | 「我最高打到过多少」必须跨期看 |
| `byPattern` | **全时段**各节奏型最高，取前 3 | 同上 |
| `practice` | **本期窗口内**每节奏型：场次/时长/本期 BPM 区间/最后练习于/最近 ≤5 场趋势 | 「这周练了哪些、有没有在推进」只在窗口内成立 |
| `untouched` | 可用清单（内置 + 自定义）− 本期练过的，并标 `ever` | 「哪块一次没碰」；`ever` 区分「本期没碰」与「从没练过」 |

**别把这两组"统一"掉**——混掉的后果很隐蔽：切到"近 7 天"却把三个月前的纪录算进"本期练过"，
用户会以为自己在练，实际那一项这周一次没碰。T50 专门盯着窗口两端点
（"恰在窗口起点 00:00"与"差一分钟"）。

另外三处容易写错的地方：

- **窗口起点取 `days[0]` 那天的零点**，不是 `days[0].t`（那是"同样钟点"，会漏掉/多算窗口第一天前半段）。
  日柱按日期分桶，两者必须用同一个零点才自洽
- **趋势取最近 5 场**（`slice(-5)`）而不是最早 5 场：写 `slice(0,5)` 画出来是"很久以前那几天"，
  与"我现在什么状态"正好相反。日志是追加写的，所以天然按时间升序
- **「最后练习于」按自然日差**，不用毫秒差除以 86400000：后者跨天会算错
  （昨晚 23:59 → 今晨 00:29 该是"昨天"，毫秒差给出"今天"）。要测这条必须在**确定性时钟**下测，
  否则白天跑测试永远发现不了（`Stats.agoText` 因此导出给测试用）

**日志按 name 聚合，因此自定义预设改名后会表现为"新节奏型"**（旧名字留在历史里、
新名字算"从没练过"）。这是 name-keyed 日志的固有性质，不值得为它加 id 迁移——
预设名是用户可见的展示名，改名的语义本来就是"换了个名字"。

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

### 4.1 观测台主题（v1.7.0 新增，第二主题）

顶栏「主题」切换；偏好存**独立键** `beatsight.theme`（见 §3.6）。实现纪律：经典主题样式
一行不改，观测台全部差异收在 `body[data-theme="obs"]` 作用域覆盖块（`<style>` 末尾，块头
有简短设计规范注释）；分区编号角标 `.sec-tag` 等新增 DOM 在经典主题下 `display:none`。
JS 侧只有 WAAPI 闪烁取色按主题查 `FLASH_THEME` 常量表（读 body 属性，热路径不碰
getComputedStyle）。

| 用途 | 值 |
|---|---|
| 底色 / 面板 / 控件 | `#0A0C12` / `#11141C` / `#171B27` |
| 主强调（当前播放、主按钮、关键数据） | 电光蓝 `#3B82F6`（高光 `#60A5FA`） |
| 进行 / 成功点缀（训练中、校验通过、今日柱） | 青绿 `#2DD4A8` |
| 描边 | 1px 半透明白：面板 rgba(255,255,255,.07)、控件 .16 |
| 文字三级 | `#E8ECF5` / `#97A1B5` / `#5F6B7E` |
| 圆角 | 卡片 8px、控件/音符块 6px |
| 排版 | 分区标题 = 大号编号（01–06）+ 小号大写英文 + 中文标题；数字一律等宽 + tabular-nums |

## 5. 自验流程（改完代码必须做）

```bash
# 0) 一条命令跑完全部检查（v1.3.2 起；这就是取代 CI 的入口）
node tools/check-all.js          # 顺序：语法 → 架构约束 → 零依赖 lint → ESLint(可选) → 类型检查(可选)
                                 #       → DOM 引用 → 全量测试 → 看门狗 → 覆盖率（共 9 步）
                                 # 约 6 秒；先便宜后贵，前面失败就停（后面的检查建立在前面是对的之上）
node tools/check-all.js --quick  # 跳过 T21 的 243 组全量扫描，改代码时用（约 2 秒）

# 需要单独跑某一项时（排查用）
node tests/run.js                # 主套件：抽样的 T21（16 组）
FULL_SCAN=1 node tests/run.js    # 全量 T21（243 组）
node tests/hang-guard.js         # 死循环看门狗：每用例独立子进程 + 8s 超时强杀
                                 # 反向验证：BEATSIGHT_HTML=<旧版 index.html> node tests/hang-guard.js 3000
node tools/check-module-order.js # 架构约束：R1/R2 零例外，R3 白名单登记
node tools/check-lint.js         # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef
                                 # 反向验证：node tools/check-lint.js <注入拼错变量的 index.html> 应报错退出 1
node tools/check-eslint.js       # 代码卫生 · 加强（可选）：ESLint 10 的 AST/控制流规则，补零依赖 lint 的盲区
                                 # 装了 node_modules 才跑，缺依赖自动跳过并 exit 0（绝不堵部署）
                                 # 它负责抽内联脚本并把 ESLint 行号映射回 index.html；规则集见 eslint.config.js
                                 # 反向验证：注入 if (x = y) 应报 no-cond-assign 且行号正确（check-lint 看不见这条）
node tools/check-tsc.js          # 类型检查 · 加强（可选）：tsc 的 checkJs，把关**模块接口与数据模型**
                                 # 与 ESLint 同一套降级口径（装了才跑、缺依赖标 ⊘ 跳过）
                                 # 配置与"为什么不开 noImplicitAny"见 tools/tsconfig.typecheck.json
                                 # 反向验证：注入 S.limit.noSuchField / S.trainr.on / S.sig="four"
                                 #   应分别报 TS2339 / TS2551(Did you mean 'trainer'?) / TS2322，行号准确
node tools/check-dom-ids.js      # DOM 引用完整性：$("x") 不得悬空
node tools/check-coverage.js     # 行覆盖率：V8 内置采集，总阈值 97% / 分区 90%

# 2)+3) 无头 Chrome 截图 + 控制台报错检查（macOS 一条命令，v1.0.0 起固化）
tests/screenshot.sh              # 桌面 1440×1150
tests/screenshot.sh 800 1800     # 窄屏
```

**可选闸门的"跳过"必须是 ⊘、不能是 ✓**（v1.9.1 修的一个假绿）：`check-all.js` 只认退出码，
而这两步按设计就是缺依赖时 `exit 0`——于是"没装依赖所以没查"与"查了且通过"在汇总里长得一模一样。
现在 `STEPS` 里给可选步骤声明 `optional: "<依赖路径>"`，`check-all.js` 自己检查依赖、
缺了就直接标 ⊘ 且**不调用**；汇总多打印一行「实跑 N/M 项」。
**别把它改回只看退出码**——那等于让汇总里的 ✓ 撒谎，而它能撒谎的话，其余 ✓ 就都不值得信了。

**类型闸门管什么、不管什么**（别期待它管 DOM）：它把关的是**模块接口与数据模型**——
`Store.zzzNoSuchMethod()` 这类接口拼错、`S.limit.noSuchField` / `S.trainr.on` 这类字段拼错、
类型不符的赋值，实测都能拦住（含 "Did you mean" 提示）。它**不管** DOM 元素类型：
`$` 故意标成返回 `any`（30+ 种元素类型逐一标注的维护成本远高于收益，而"id 是否存在"
已由 `check-dom-ids.js` 保证）；事件里读写当前元素统一走 `evEl(ev)` / `evTarget(ev)`
两个有文档的助手，`querySelectorAll` 的结果过 `asEl(el)`。这三个助手就是这套取舍的全部落点。

**为什么不用 GitHub Actions**：改由本地 `tools/check-all.js` 一条命令跑完，少一套要维护的流水线配置，检查内容一条不少。而它在两条发布渠道上的强制力不同：**Cloudflare 的构建命令里串了全量检查**（不通过即不部署），等于在部署路径上装了硬闸门；**WorkBuddy 那条纯手动，没人拦你**。所以"改完先跑它再看效果"依然是习惯要求——只是漏跑时 Cloudflare 会替你拦住，WorkBuddy 不会。

**发版规则（v1.6.4 起）：每次发版都 bump `index.html` 的 `const VERSION`**，功能版与工程版一视同仁（改这一行即可，`<title>` / 品牌区 / chip 三处显示由它派生）。此前 v1.6.1~v1.6.4 连发四版都没动它，线上徽章长期停在 `v1.6.0`——代码明明都上了线，看号的人却只能得出"部署没生效"的结论。版本号是用户唯一能看到的"这批代码是哪一版"的凭据，工程版跳过 bump 等于让这个凭据说谎。

**必须在真实浏览器里人工做一次的事（无法自动化，别跳过）**：

- ~~**后台 30 秒不断音**（v1.3 自适应窗口的验收，审计 P1-3）~~ **已验收（2026-09-15，桌面 Chrome，用户确认无断音）**。该验收项至此关闭；仅当未来改动 scheduler 的窗口/锚定逻辑时才需要重做。
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

已完成：~~M1 节拍内核~~ / ~~M2 预设+编辑器~~ / ~~M3-2 变速训练器~~ / ~~v0.6 模块化+导入导出+持久化测试~~ / ~~v0.7 tick 制+三连音/Swing/奇数拍~~ / ~~v0.8 三套程序合成音色~~ / ~~v0.9 预备拍+可视化脱轨修复~~ / ~~v0.9.1 防御性补丁~~ / ~~v1.0 依赖方向净化+Editor 测试+CI~~ / ~~v1.0.1 重拍增强量倒挂+音量行错位~~ / ~~v1.1 BPM 常用速度档（60/72/84/96/120）+ ±5 粗调 + 滑杆手绘刻度~~ / ~~v1.1.1 播放中切节奏型点下即生效（相位就地接续）+ 停止落定挂起~~ / ~~v1.2 弹跳球预判式可视化（onset 表 + 预测终点 + 真实球体物理）~~ / ~~v1.2.4 持久值健壮性收口（加载路径校验复用 + 渲染帧外壳/主体分离 + 调度器防死循环 + 音量末级钳制 + 渲染层进测试覆盖 + 死循环看门狗）~~ / ~~v1.3 审计第二/三梯队（持久化冷热分离 + 后台调度自适应 + 渲染几何缓存与增量重绘 + 静态检查三项 + 无障碍分级 + PWA 元信息 + 音频生命周期补全 + 跨 origin 提示）~~ / ~~v1.3.1 遗留收口（V8 内置覆盖率 + 弹跳球物理逐帧数值断言 + 交互接线层补测 + 旧键清理）~~ / ~~v1.3.2 发布渠道收口（移除 GitHub Actions，改由 WorkBuddy 发布 + tools/check-all.js 一键自验）~~ / ~~v1.4 练习闭环（练习记录+统计 overlay）+ PWA 离线 + 后台保活开关 + 上次训练一键继续~~

按优先级排队（详版方案见 [PLAN-v1.5.md](PLAN-v1.5.md)）：

1. ~~v1.4.1 修 bug：木鱼/鼓组响度不足~~ **已完成（2026-09-15）**：滤波噪声路径补 makeup gain（木鱼 ×14 / 军鼓 ×5 / 踩镲 ×2.5，上限=makeup 本身），wood decay 30→60ms，T44 覆盖；**真人试听校准待定**（推算值，尤其手机小喇叭对 1500–2000Hz 的表现）
2. ~~后台持续发声真人验收~~ **已验收（2026-09-15，桌面 Chrome 切后台 30 秒无断音）**；**iOS 已明确不作为目标平台**（用户无 iOS 设备、以后也不考虑——静音 WAV 兜底代码保留，它对无 wakeLock 的桌面/Android 浏览器同样有效，但 iOS 专属的兼容性话术与验收项不再跟进）
3. ~~7 天爬升训练计划~~ **已完成（v1.5.0）**；~~统计增强~~ **已完成（v1.6.0：导出 / 30 天视图 / 各节奏型纪录）**
4. ~~**M8 已全部关闭**。下一步候选（暂无排期）：统计数据攒两三周后再看是否需要趋势/目标类功能；旧链接 beatsight-68235 下线（需在「设置—数据管理—应用」里手动操作）~~ **已接手（v1.8.2 → v1.9.0）**：
   - ~~v1.8.2 仓库卫生收口 + 文档对齐~~ **已完成**：删 `.trae-html-share-packages/`（224 KB 入库 zip 垃圾）、
     `.gitignore` 补规则、README 功能表补齐 v1.6.4–v1.8、装 pre-commit 钩子（`core.hooksPath` 是本机配置，**clone 后各自跑一次**）
   - ~~v1.9.0 扫弦方向标注 ↑↓ + 练习量控制~~ **已完成**：见 CHANGELOG v1.9.0
   - ~~v1.10.0 听辨训练（节奏默写）~~ **已完成**：新模块 `Ear` + 手写易混组 + 会话播放额度自动停 +
     冷键 `beatsight.ear`；前置的 `previewRef` 泛化作为纯重构单独提交。见 §3.8 与 CHANGELOG v1.10.0
   - ~~可选类型检查闸门~~ **已完成（v1.9.1）**：见 §2 仓库树与 §5 自验清单
   - **方案与施工记录**：[PLAN-v1.9.md](PLAN-v1.9.md)（含落地过程与方案的偏差、反向验证清单）
   - **更远（P3，设计探针已完成）**：曲式编排（多段落串联）。会动音频核心的"严格 4 小节循环"模型
     （`schedBar` 0..3 + 单锚点 `loopStart`），牵连 T12/T15/T20/T21 一大批相位不变量的前提，**不与小改动混批**。
     **探针已出：[PLAN-v2-arrangement.md](PLAN-v2-arrangement.md)** —— 盘出 17 条循环假设、
     三个改动档位（①播放层面串联 ②段落自适应行数 ③完整编辑器）与各自代价、7 个待拍板决策点。
     建议先做档位①（不动时间轴不变量）。**动工前需先就决策点给出选择。**

### 已埋的技术债 / 后续要盯
- ~~快捷档值 `CONFIG.speedPresets` 目前只服务 BPM；若日后音量、拍号也要常用值，考虑抽成通用 preset row 组件，别复制三份~~ **已完成（v1.6.4）**：共享区（`setPressed` 旁）抽出 `buildPillRow(host, items, opt)`，BPM 快捷档与奇数拍重拍分组两处改为复用；`CONFIG.speedPresets` 仍是唯一数据源，日后音量/拍号要常用档位直接复用组件，不必再复制
- 滑杆刻度是手绘层，`--thumb-r` 必须与实际 `::-webkit-slider-thumb` 尺寸同步；再改圆钮大小记得同改 `.slider-wrap` 的内缩变量
- ~~静态检查仍是自写的窄规则集~~ **已补（v1.6.5）**：原话是"架构约束 / 五项 lint / DOM 引用 / 覆盖率都已就位，但覆盖面小于 ESLint 生态（无类型检查）。要更全套就加 `package.json` + ESLint devDependency——只用于本地自验，不进产物"。现已落地：加 `package.json` + `package-lock.json`（唯一 devDependency `eslint`）+ `eslint.config.js`（flat config）+ `tools/check-eslint.js`（抽内联脚本、把 ESLint 行号回映射到 `index.html`），作为 `tools/check-all.js` 的第 4 步（现共 8 步）。**它仍是可选加强项**：缺 `node_modules` 时自动跳过并 `exit 0`，绝不会因为"没装开发依赖"堵住 Cloudflare 部署；"零依赖"约束针对的始终是 `file://` 直开的运行时产物（上站仍只有 4 个文件）。规则集与 `check-lint.js` 刻意不重叠，取舍理由见 `eslint.config.js` 文件头。~~**仍未做类型检查**（无 TS/JSDoc 类型校验）~~ **已补（v1.9.1）**：`tools/check-tsc.js` + `tools/tsconfig.typecheck.json` + `typescript` devDependency，按同一套"可选加强项、缺依赖标 ⊘ 跳过"模式接入（第 5 步，现共 9 步）。落地时实测抓到 6 类真问题（46 处 EventTarget 取值、22 处 `$` 元素类型、`textContent` 被赋数字、`onLimitPulse` 名字遮蔽等，全部已修），并给最中心的 `S` 补了显式类型标注——那是闸门真正长牙的地方。**仍未做的是严格模式**：`noImplicitAny` 打开会立刻得到 **759 条**报错（"隐式 any"占 55%），修它等于给全文件补 JSDoc/类型，是一次独立的重构。开启路径：先给模块导出的接口与数据模型逐个补标注，每补完一块就把对应开关打开一点，别一次性开
- **检查只在 Cloudflare 那条路上是强制的，别处全靠自觉**：Cloudflare 构建时必定跑一次全量检查，失败即不部署（想上线上不去）；但**提交时**和 **WorkBuddy 手动发布时**没有任何机制强制跑 `tools/check-all.js`。别拿"Cloudflare 会拦"当借口跳过本地那一遍——它只拦得住上 Cloudflare 这一条路
- **后台持续发声仍需真人验收**（见 §5）：自适应窗口只能用假时钟断言，浏览器层面的定时器节流无法在无头环境复现
- 覆盖率唯一未覆盖的 3 行是 `scheduler` 的 `MAX_SCHED_STEPS` 硬上限分支（实测 99.8%）——单轮调度要处理超过 512 个音符才会触发，属**刻意保留的防御性代码**，不为了数字去造人工状态点亮它
- `Viz.paintBall` 的 `H = min(clamp(k·T²,10,48), yBase+6)` 里那道"顶点不出容器空域"的钳制，只在**第一行且弧很长**时才会真正生效（默认 96 BPM 下未钳制跳高 46.9px 仅比上界 44px 高 2.9px，余量很薄）。**已补专门场景**：T30 ⑧ 把 BPM 降到 60 构造长弧（未钳制 48px 明显高于上界 44px），断言实测跳高等于上界而非未钳制值——删掉钳制即变红（反向验证已跑）。改动行高/内边距时要留意上界 `yBase+6` 会随行位置漂移

### 已明确不处理（不再跟进）
- **Firefox 圆钮样式**（2026-09-11 决定忽略）：本项目只写了 `::-webkit-slider-thumb`，没有 `::-moz-range-thumb`，理论上 FF 下圆钮可能与刻度略错位。本机无 Firefox、未实测，用户已决定不处理 → **不再列为待办，也不要主动盘它**（不必提、不必测、不必补）。仅当日后真有人在 Firefox 下反馈刻度错位时，再回来补这两条伪元素规则
- **iOS 兼容性**（2026-09-15 决定忽略）：用户无 iOS 设备、以后也不考虑 → iOS 专属的验收项（锁屏保活、Safari interrupted 状态实测）不再跟进。代码里已有的兜底（静音 WAV、ctx 状态监听）保留不动——它们对无 wakeLock 的桌面/Android 浏览器同样有效

## 7. 用户协作偏好

- 无技术背景：解释技术问题用生活化比方，不堆术语
- 在意 token 成本：改动合并成一条明确需求；声称完成前必须自验（语法 + 真实浏览器截图）
- 决策记录写进 CHANGELOG.md，关键状态写进本文档
