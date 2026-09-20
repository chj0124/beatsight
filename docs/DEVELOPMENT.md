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
├── sw.js                 # Service Worker（v1.4；同上。导航 network-first、静态资源 stale-while-revalidate）
├── icon.svg              # PWA 图标（同源相对路径，manifest 内引用）
├── icon-*.png            # PWA 图标 PNG 回退（192/512 含 maskable；v2.4.4）——**构建期由 tools/gen-icons.js 生成、不入库**（二进制走不动纯文本发布路径；生成器与 icon.svg 同坐标）
├── README.md             # 项目门面
├── CHANGELOG.md          # 版本记录
├── LICENSE               # MIT
├── package.json          # 开发期自验工具链（devDependencies：eslint + typescript，均为**可选**加强项；只跑本地，不进产物）
├── eslint.config.js      # ESLint flat config（本地自验专用，规则集与取舍写在文件头）
├── _headers              # 静态资源响应头（v2.0.3 审计 C3；构建时拷进 dist/，自身不对外提供）
├── wrangler.jsonc        # Cloudflare Workers 静态资源配置（资源目录 + 构建命令；唯一入库的 Cloudflare 配置）
├── tests/
│   ├── run.js            # 主测试套件（node tests/run.js，零依赖）
│   ├── hang-guard.js     # 死循环看门狗：每用例独立子进程 + 超时强杀
│   ├── hang-case.js      # 看门狗的单用例探针（被 hang-guard 调起）
│   ├── screenshot.sh     # 无头截图自验（**已过时**：仅 macOS 可用、且只截图不断言）
│   │                     #   → 已由 tools/smoke.js 取代（跨平台 + 会断言真实 DOM/CSS/帧率/SW）
│   └── README.md         # 测试原理与补断言规则
├── tools/                # 零依赖检查器（见 §5：node tools/check-all.js 一条命令跑全套）
│   ├── check-all.js            # 本地完整自验入口（取代原来的 GitHub Actions CI）
│   ├── check-module-order.js   # 架构约束：模块不得反向引用（R1/R2/R3/R4）
│   ├── check-lint.js           # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef
│   ├── check-version.js        # 版本一致性：VERSION / CHANGELOG / 代码注释三处不得漂移（唯一真相源）
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
    ├── PLAN-v1.9.md      # 历史方案存档（v1.8.2→v1.10：工程债 / 扫弦方向 / 练习量 / 听辨训练，条目已全部落地）
    ├── PLAN-v2-arrangement.md  # 曲式编排设计探针（立项评估，已归档 · 历史记录：18 条循环假设 / 档位对比 / D1–D8 决策点均已闭环）
    └── PLAN-v2-impl.md   # 曲式编排阶段二实施方案（v2.0.0，已落地：数据模型 / 核心机制 / 测试计划 / 反向验证变异清单）
```

**发布渠道（两条，各司其职）**：

- **① Cloudflare，自动**：仓库接 Git，推 `main` 即自动构建部署 → https://beatsight.chenhuajian1995.workers.dev/ 。构建命令里串了 `node tools/check-all.js` 全量检查，**不通过就不部署**，所以这条路上线上始终是最新代码
- **② WorkBuddy，手动**：https://beatsight-48543.app.workbuddy.host/ （v2.0.1 起；旧链接 beatsight-34873 已随换绑废弃，停在 v1.6.0 不再更新）。**只在你用 WorkBuddy 打开项目并发布时才更新**——所以它滞后是常态、不是故障，随手一比"WorkBuddy 上还是旧版"不说明任何问题，判断"线上是不是最新"请以 Cloudflare 为准
  - ★ **发布的是一整份目录，所以要单独建一份干净副本再发**：`beatsight-publish/`（只有 `index.html` / `manifest.webmanifest` / `sw.js` / `icon.svg` / 4 个 `icon-*.png`，共 8 个文件）。
    **PNG 不入库**（v2.4.4 起由 `tools/gen-icons.js` 生成）——发布前先在仓库根跑一次
    `node tools/gen-icons.js`（默认输出到仓库根）再 copy；漏了也不致命
    （sw.js 把 PNG 列为可选资源，404 不拖垮 install，只是老设备没有位图图标）。
    不要直接发 `beatsight/`——那里有 44 MB 的 `node_modules`，以及 `tests/` `tools/` `docs/` `package.json` `wrangler.jsonc`，
    发上去就都变成公开可访问的了。**每次重新发布前要先重新 copy 覆盖**，否则会发到旧版本
  - ★ **应用归属是按"工作区（会话）"判定的，不是按目录**：每个 WorkBuddy 工作区根目录有一个
    `.<appId>.genie` 标记文件，记录它发布到哪个应用。**指定别的 appId、或从别的工作区的目录发布，
    都会被路由回当前工作区自己那个应用**——所以一个应用只能在"当初创建它的那个工作区"里更新。
    旧应用更新不了就换绑新链接（34873 → 48543 就是这么发生的）

项目**不用 GitHub Actions**（`.github/workflows/` 早期有过、后全部移除），机器检查改由 `node tools/check-all.js` 在本地一键跑完（见 §5）。Cloudflare 侧只留一份最小配置 `wrangler.jsonc`：Workers 的静态资源（Static Assets）**必须**由 Wrangler 配置文件声明资源目录（`assets.directory = ./dist`），否则构建里的部署命令无法定位要发布的文件、当场失败。仓库里另有 `_headers`（纯文本响应头规则，构建时拷进 `dist/`，由 Workers 解析后作用于静态资源响应，自身不对外提供）；**没有** `_redirects` / `functions/`，也没有 Worker 脚本（纯静态托管，Worker 不参与请求）。v2.0.4（审计 B4）起，构建步骤也进了 `wrangler.jsonc`：`build.command` = 全量自验 + 装配 `dist/`，使本地 `npx wrangler deploy` 可完整复现线上构建；但 **Cloudflare 的 Git 集成构建（Workers Builds）不读** wrangler 配置里的 Custom Builds（官方既有行为），线上那次构建仍以 Dashboard 里配的构建/部署命令为准——详见 `wrangler.jsonc` 头部注释。

## 3. 核心架构

### 3.0 模块地图（v0.6.0 起；v1.0.0 依赖方向净化；v1.4 扩到 10 模块；v1.10 起 11 模块；v2.0 起 12 模块；v2.0.1 起 13 模块；v2.4.0 起 14 模块）

`<script>` 顺序：**数据 → Store → 共享状态 → Modal → Viz → AudioEngine → Trainer → Controls → Tracks → Presets → Editor → Stats → Ear → KeepAlive → init**

```
Store（持久化/状态创建/迁移/导入导出/练习记录）
共享状态（S/customs 别名、draft、appliedPat、activePattern、sessStartT、UI 同步助手、音频时钟变量）
→ Modal（应用内弹窗）→ Viz（时值可视化）→ AudioEngine（Web Audio 前瞻调度）
→ Trainer（变速训练器 + 上次训练接续）→ Controls（播放控制/BPM/拍号/Swing/音色/预备拍/静音拍/练习入账）
→ Tracks（节拍轨切换：普通节拍 / 带扫弦的节拍 双入口，v2.4.0）
→ Presets（预设库/回退提示/轨内回退检查/播放中切换挂起/整首连播与段序条，v2.5.0）→ Editor（自定义编辑器）
→ Stats（练习统计汇总 + overlay）→ Ear（听辨训练：出题/判分/战绩，v1.10.0）→ Arrange（曲式编排 UI，v2.0.0）→ Help（使用方法页，v2.0.1）
→ KeepAlive（后台保活：wakeLock + 静音音频兜底）→ init（装配）
```

- **v2.4.0 的双入口拆分不改核心**：`Tracks` 是**入口维度**的模块，只决定三件事——预设库列哪些型（`hasStrum` 过滤）、记谱层画不画扫弦标注、zone 音色走不走。`bpm/sig/vol/swing/timbre` 仍是同一个 `S` 单例（用户拍板"全部共享，仅入口区分"），`spb()` 与 `scheduler` 一行未改。`Tracks → Presets` 是 R3 白名单条目（`set()` 切轨后调 `refreshAfterPatternChange()`，用户点击时执行）。
- **v2.5.0 的两条声部（改发声前必读）**：扫弦轨上节拍器与扫弦是**两条独立声部**，不是一条。
  - `schedOneStep` 里：先按原有逻辑发"这一步自己的声"（带 `zone` → 弦区扫弦声，否则 → 节拍音），
    再跑一遍**节拍器网格**（半开区间 `[cumT, cumT+step.t)` 扫拍点，逐拍补一声 click）。
  - 网格的生效条件是 `S.track === "strum" && hasStrum(pat)` 两个都成立：**不带扫弦记谱的谱本身就是节拍器**，
    给它补网格会把长音中间多敲出几下（行为变化，非修复）。`hasStrum` 每轮调度只算一次（在 `schedulerBody`），
    不进每步热路径。
  - 音量：节拍声部走 `S.vol`、扫弦声部走 `S.strumVol`，**并列不串联**（`strumVol` 不乘在 `vol` 上）。
    层级（重拍/正拍/细分）与重拍增强对两条声部共用。
  - "自身那一声是否顶掉了同拍的节拍音"的判据必须与 `playClick` 里那条 `zone` 分支**逐字一致**
    （drum 音色下 zone 不生效、仍走节拍音）。写错的表现很隐蔽：某一拍整拍没声音。
  - **节拍点不入 `onsetBuf`**：弹跳球跟的是"你要弹的那条声部"（扫弦声部）的落点，节拍层是参照网格。
  - 回归：`tests/cases/t68-whole-song-and-voices.js`（T68a–T68e）。
- **v2.5.0 的整首连播**：`Presets` 里新增「整首连播」按钮与段序条（挂在示例曲分组），
  机制**复用既有门面**（scheduler / `arrNextBar` / `arrangeStart` 一行未改）。
  三条路径构成"两个对等入口"的契约：点「整首连播」= 曲式模式 + 范围整首 + 开循环 + 起播；
  点段序条第 N 段 = `jumpTo(N)`（`range=[N,N]` + loop）；**点任一节奏型 = `exitArrangeForPreset()`
  退回预设模式**——最后这条是本次真正的流程修复：在此之前曲式模式**没有主界面出口**
  （全文件只有"曲式校验失败"与"删除曲式"会退回预设），用户点了节奏型再按播放，播的仍是节目单。
  呈现收口在 `Presets.syncDemoSecRow()` 一处，由 `Arrange.refreshBar/refreshNow` 与 `Controls.stop` 调用
  （`Arrange → Presets` 是向前引用，合法；反向的跳段经新钩子 `onDemoJump` 注入装配层）。
- **轨判定的"两处实现、一个语义"**：`Store` 的迁移期用局部 `strumOf`（因为共享区 `hasStrum` 声明在 Store 之后，顶层读它是 R1 反向引用），运行期一律走共享区 `hasStrum`（Presets/AudioEngine/Viz 三处）。两者判据都写成"`dir` 或 `zone` 任一 `!== undefined`"，由 `tests/cases/t64-track-split.js` 的 T64b/T64e 同时钉住——判据要改时两条一起红。

- **任何模块不得反向引用后方模块**；运行期热路径（paintFrame/scheduler 每帧/每 25ms 读）只读共享状态区与前方模块——v1.0.0 把 activePattern/draft 从 Presets/Editor 上移至此区，消除了 Viz→Presets、共享→Editor 两处反向依赖
- **v1.3.0：这条规则从"注释里的口号"变成了可执行检查**（`tools/check-module-order.js`），并精确化为三条：
  - **R1 零例外**：IIFE 顶层执行期不得引用后方模块（真会产生 TDZ 的场景）
  - **R2 零例外**：**每帧渲染热路径**（paintFrame / paintFrameBody / paintBall）体内不得出现「后方模块名 + .」
  - **R3 白名单**：运行时回调可以调用后方模块，但必须在检查器的 WHITELIST 逐条登记并写明理由；条目失效（代码里不再出现）也会报错，防止白名单腐烂成"什么都放行"
  - **R4 扇出上限（告警，v2.0.4 新增）**：一个模块**直接引用的下游模块个数**（扇出）不得超过 `MAX_FANOUT`（=7）。扇出是"某模块会不会膨胀成上帝对象"的最直接指标；`Controls` 当前已顶到上限（指向它全部的 7 个下游），再想加一条就必须显式抬高常量——让"中枢又胖一圈"成为一次看得见、需要理由的改动，而不是悄悄发生
  - 注：审计报告原文把 scheduler 也划进 R2，但同时又称 `AudioEngine→Trainer` 属于"合法的运行时调用"（而它就在 scheduler 体内），自相矛盾。这里按实际语义修正——scheduler 是 25ms 周期回调，跨模块调用只发生在小节边界（约每 1–2 秒一次），归入 R3
- **跨模块装配用"钩子"而非直接调用**：`Store.setPersistFailHandler(fn)`、`onFrameError`。模块只暴露回调，由 init 段注入——避免小状态（Store）与渲染热路径（Viz）为了报告错误而反向引用后方模块
- **新功能的 UI 装配内聚在各自模块内部（v2.0.4 约定）**：`Controls` 只做事件转发与共享状态读写，不再为某个新功能去挂一个新的下游模块；新 overlay/面板一律以自身模块为界，开合与监听器复用 `Modal` 的开合/登记原语（§3.10）。这条约定由 R4 的扇出上限机器守住（见 §3.11）

- `window.__beat` 暴露全部模块接口，是 tests/run.js 的断言入口，也是控制台调试入口
- 下列 3.1–3.5 的机制描述不变，只是函数有模块归属

### 3.1 数据模型（v0.7.0 起 tick 制）

```js
// 时值单位为 tick：TPB=48 ticks/拍（48=2⁴×3，整除 2/3/4/6/8/12/16/24，
// 覆盖到三十二分三连音）。四分=48t、八分=24t、八三连=16t、十六分=12t、十六三连=8t、三十二分=6t
pattern = { name, desc, meter, accents, bars: [[{t, rest}...], ×N] }
// meter = 每小节拍数（2/3/4/5/6/7）；bars 的**长度就是型的小节数**（v2.5.1 起域为 1–64，
//   原为恒 4），可逐小节不同。DEF_BARS(=4) 只是**新建型时的默认值**，
//   问"这个型有几小节"一律用 patBars(pat)，不要用那个常量（见 §3.14）
// 内置预设多为 4 小节相同（rep4）；《在他乡》的节奏型 1~5 各是 **1 小节**
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
setInterval(CONFIG.schedInterval=25ms) → scheduler()：把未来 CONFIG.schedWindow=300ms 内的音符注册到 audio clock
loopStart = ctx.currentTime（循环起点的音频时钟时间）
位置换算：pos(拍) = (ctx.currentTime - loopStart) / (60/bpm)
```

- **播放中变速不中断**：`setBpm` 重映射 `loopStart = now - posBeats × 新spb`
- **播放中切换节奏型**（v1.1.1 改）：先试 `AudioEngine.resyncToNow(newPat)` **就地接续**——**不动时间轴**，只用「已真实经过的 tick 数」在新节奏型的循环网格里重求 `(小节, 小节内 tick)`，取新节奏型中第一个「起始 tick ≥ 该位置」的音符接续。成功即点下生效，不再等小节边界；仅当新节奏型在本小节已无起点可接时返回 false，回退到旧的挂起路径（`pendingPattern` → `scheduler()` 小节边界消费并重映射 `loopStart`）
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
    AudioEngine 声明在 Controls 之前，直接调 `Controls.stop()` 是反向引用（§3.0 的钩子纪律）。
    与 `onFrameError` / `Store.setPersistFailHandler` 同一套模式
  - **预备拍不吃额度**：`limitT0` 在预备拍数完那一刻才取（`Controls.start` 里先置 null）。
    注意它主要是为**进度显示**服务的——去掉它，min 模式的停止时刻其实不变
    （`start()` 算 `loopStart` 时已把 N 拍顺延进去，值等价），但进度区会在预备拍期间就显示
    「已练 0:00 / 5:00」。**别当成冗余代码删掉**（反向验证已确认这条）
  - **已知行为（与既有训练器同源）**：`bars` 模式的墙钟停止时刻会早于小节边界最多约 0.85s
    （前瞻窗口 + 一个音符时长）。小节计数在**排程**时累加，而 `stop()` 只停时钟与画面、
    **不取消已排入音频时钟的振荡器**——所以那 N 小节的音一个不少地响完。
    判据始终是「发声个数 = N × 每小节音数」，不是墙钟
- 空小节（编辑器草稿）安全跳过。**跳过时空小节也强制正向推进 `nextNoteTime += pat.meter * spb()`**（`adv > 0 && isFinite(adv)` 兜底 0.5s），并有一层 `MAX_SCHED_STEPS = 512` 硬上限——脏拍号（`-3` / `0` / `"abc"`）曾让这个分支永不推进 → 主线程死循环（v1.2.4 修）
- **持久值收口（v1.2.4）**：`Store` 加载路径与编辑器共用**同一份**校验（`VALID_T` / `VALID_METER` 已上移到 `S` 创建之前，`validatePreset()` 复用）。`bpm`/`vol`/`accentVol`/`sig` 一律经 `numOr`/`clamp01`/白名单取值；`customs` 逐项校验，**淘汰项不静默丢弃**而是写入 `beatsight.quarantine` + `console.warn`，用户可人工找回。trainer / accents 用**显式白名单抽取**，不用 `Object.assign` 整包（消除对「`Object.assign` 只拷自有属性」的侥幸依赖）
- **发声末级钳制**：`playClick` 送出增益前过 `Math.min(1, Math.max(0, …))`。对合法输入是**无操作**（合法上界本就是 1），只在持久值被改坏时兜住 `vol:1e6 → +120 dBFS` 这类削波爆音
- 拍号/音量的 UI 入口统一走 `setSig()` / `setBpm()`，不要新写并行的 pill 高亮逻辑
- **弹跳球 onset 表（v1.2）**：排程每个非休止音符时（含静音小节）顺手 `onsetBuf.push({t, bar, cumT})`，时刻含 `swingShift()` 偏移；每轮调度末尾 `onsetNext = predictNext(pat)` 预测游标处下一发声点（与排程同源，值严格相等）；修剪保留最近 1s 已落地端点。Swing 偏移公式共享为 `swingShift()`——改 Swing 只改这一处，否则球与声音会分叉
  - **v2.5.0 边界**：节拍器网格补出的拍点**不写 onsetBuf**。球跟的是"你要弹的那条声部"
    （扫弦声部）的落点，节拍层是参照网格——两套语义混进同一张表会让球的落点序列
    既不是"音符起点"也不是"拍点"，并会牵动 T22/T30/T53 那批逐帧数值断言
- **前瞻窗口按可见性自适应（v1.3.0，审计 P1-3）**：`schedWindow()` = 前台 300ms（`CONFIG.schedWindow`）/ 后台 1.2s（`CONFIG.schedWindowBg`）
  - 为什么：调度时钟跑在主线程 `setInterval(25ms)` 上，而浏览器对**后台标签页**的定时器节流下限是 **1000ms**（Chrome 隐藏 5 分钟后还有 intensive throttling，约 1 次/分钟）。哪怕是几百毫秒的前台窗口，在后台也等于「每次唤醒只排那一小段的音，其余时间静音」→ 后台播放必然断续。这也是路线图 M8「后台持续发声」一直落不了地的技术阻塞点
  - 后台窗口取 1.2s：大于节流下限，留 20% 余量
  - **前台窗口 150ms → 300ms（v2.0.6，审计 P1-1）**：单轮余量 = 窗口 − 轮询间隔，150ms 时只有 125ms，而小节边界那一轮还要顺手做变速爬级、到点停播、换型重建网格——任何一次阻塞超过余量，时间轴就会被重锚定并**静默丢掉**那段时间的音符。翻倍后容错翻倍，代价是"变更生效"最多多等 150ms。取舍与"为什么不改成投微任务"的理由写在 `CONFIG.schedWindow` 上方
  - **行为变化（必须知道）**：后台下已排入的音符**无法撤销**，所以「点下即生效」在后台最多延迟一个窗口（1.2s）；回前台后立即恢复前台窗口，无额外延迟
  - 回前台（`visibilitychange`）会**立即补排一次**，不等下一个 25ms 周期。顺序上「先补排、再收窄窗口」——此刻 `document.hidden` 已为 false，故本次补排用前台窗口
  - **调度饥饿兜底**：若游标落后实时时钟超过一个窗口（后台被长时间节流），**以当前时刻重新锚定**整条时间轴（`nextNoteTime = now + 0.05`，`loopStart` 同步、`schedBar/schedStep` 归零、onset 表清空），而不是把过去几十秒的音符一次性排到"现在"（那听感是一坨同时爆响；`MAX_SCHED_STEPS` 只拦得住死循环，拦不住这个）。用「重新锚定」而不是「按整循环前移」：前移粒度至少一小节（慢速 7/4 可达 16s、一循环 56s），很容易落到窗口之外反而多出一格静音；而此时相位早已无意义
  - **重锚必须可见（v2.0.6，审计 P1-1）**：两条防线（饥饿兜底、单轮迭代超限）共用 `reanchor(why)`，每次上报计数到诊断面板（`重锚 N(饿X/超Y)`）。重锚会**静默吞掉**那段时间的音符，此前毫无痕迹——**0 = 从未漏拍，>0 即有据可查**。`饿`（被节流，属环境）与`超`（单轮触顶，属数据可疑）分开计数，因为处置完全不同

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


**弹跳球（v1.2）**：`paintBall(now, bar, tib)` 每帧驱动。端点 = `onsetBuf`（已排程，AudioEngine 写 Viz 读）+ `onsetNext`（AudioEngine 预测的下一发声点——**视觉要看得远一跳，不能依赖调度器 150ms 前瞻窗口**，否则慢速下落地僵住）。落点时刻 = 真实发声时刻（含 Swing、静音小节照跳、休止跳过）。运动：y = H·4p(1−p)，H = clamp(120·T², 10, 48) 且顶点不出容器空域；触地 70ms 挤压回弹 + 空中拉伸 + 落地预压 + 地面投影；不做滚动旋转（接缝回卷伪影）。**跨小节 = 接力制（v1.2.3）**：每小节一颗球自始至终跳完本行，终端弧终点 = 本行右缘（时刻 = 小节边界，与下一行首拍发声同时），期间待命球（半透明）停在新行首 onset 处、边界无缝交接；小节前导休止时球停在首 onset 待命。onsetBuf 修剪保留最近 1s 且 ≥8 条（30BPM 的 7/4 小节 16s，上一颗本行 onset 可能很远）。开关 `S.bounce`（默认开）只控显隐。**待命球起跑预备（v1.8.0，v1.8.1 修正为含水平分量）**：终端弧期间（末 onset → 小节边界），待命球把主球的终端弧**整条抛物线**平行复制到下一行——从新行首 onset 左侧起跳，同相位 p、同高 H、同形变（复用主球本帧 sx/sy），边界同时触地；水平跨距 = 终端弧跨距、封顶行宽 20%。只动待命球位移/形变，交接时刻（= b2.t）分毫不动；REDUCE_MOTION 下保持贴地停泊位不跳。回归：tests T41（逐帧贴合复制抛物线 3px 容差 / 水平单调 / 过界交接位置不变）。

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
- **扫弦竖箭头 + 六线底纹（v2.4.2，取代 v1.9.0 的方形徽标）**：`.strumv` 挂在**格子内部**
  （`strumEls` 与 `labelEls` 同构，无箭头处存 null）。照搬参考页的迷你六线谱读法：
  **箭头跨哪几条弦 = 弦区**。语义全部编码在类名上（DOM 里没有文字，箭头是纯 CSS 画的）：
  - 方向 `.dn` / `.up`（下扫箭头在顶端 / 上扫在底端）；空扫 `.ghost` = 蓝色虚线
  - 弦区 `.kF`（zone 1 或缺省）/ `.kB`（zone 0）/ `.kT`（zone 2）——
    **v2.2.0 的 `.cell-zone` 色带随之删除**：弦区已内化为箭头跨距，不必再单画一条带子
  - **空扫的弦区跟随前一记实扫**（`prevZone`，小节内自上而下携带），跨小节不延续——
    新小节从「全部弦」重起。小节是扫弦谱的语义单位，跨小节沿用会让新小节首格凭空落进低音区
  - 几何常量在 `:root`（`--gt` 弦间距 / `--gtop` 顶端留白 / `--yT1..--yB2` 四条端点），
    **底纹六条线与箭头跨距共用同一组变量**——分头写死就会让「箭头端点压在弦线上」一改即错位
  三个必须知道的设计点：
  1. **画在格内而不是时值标签行**：标签只给 t≥24 发声，画在标签行会丢掉切分位上那颗下扫
     （民谣扫弦第 5 颗，12t），而它恰恰是最需要提示的一颗。T47 有一句专门钉这条
  2. **窄格整体隐藏**，不做部分裁切：`fitCellAnnotations()` 里用常量阈值 `STRUM_MIN_W=14`
     比较 `offsetWidth`（箭头是定宽元素，拿 `scrollWidth` 比没有意义）。
     v2.4.2 由 20 降到 14——旧阈值是按 14px 方形徽标的宽度定的，新形态只有 2px 宽，
     判据从"够不够放下一个方块"变成"与邻格至少隔开 10px"
  3. **播放高亮 `.strumv.hit` 写在 `setCell()` 里，不写在帧内**：增量重绘只重画 3 格、
     旧 `active` 那格也在其中，离场时自动摘掉高亮，不需要第二条复位路径；
     `resetForStop()` 只补一朵停机兜底（此时 `setCell` 不会再被调用）
- **六线底纹 `.tab`**：每行铺 6 条 `<i>`（y 由变量推出 → 8/17/26/35/44/53）。
  **只挂扫弦轨**——普通轨没有箭头，留一层无解释的横线纯属噪音（同 v2.4.0 轨门控口径）。
  由「六线 · 扫弦谱底纹」开关（`S.showTab`，默认开）控制，走 `.viz.no-tab` 整层移除
  （不是 `opacity:0`——省掉每帧一条合成层）。**该开关只管底纹，不影响箭头**：
  箭头是内容，底纹是参照物
- **`fitCellLabels` 已改名 `fitCellAnnotations`（v1.9.0）**：一处函数同时管时值标签、组标签、
  扫弦箭头三者的宽窄自适应。**调用点与帧内纪律一律不变**——仍只在 `buildViz` 末尾与 resize 后调用，
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
- **焦点陷阱**：弹窗/编辑器打开时给 `.main` / `.topbar` 置 `inert`，关闭时还原焦点。用 `Modal.refreshInert()` **重算**而不是置位/复位——编辑器里再弹确认框时，弹窗关闭不能把仍开着的编辑器对应的 inert 一起摘掉。开合的挂/摘 `.open`、重算 inert、焦点进出由 `Modal.openOverlay()/closeOverlay()` 统一负责（见 §3.10）

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

### 3.10 overlay 开合与监听器协议（v2.0.4，审计 B2）

5 个 overlay（编辑 `#editor` / 统计 `#statsOverlay` / 听辨 `#earOverlay` / 曲式 `#arrangeOverlay` /
说明 `#helpOverlay`）的开合，此前各写一遍同样三件事——挂/摘 `.open`、`refreshInert()`、焦点进出——
并各持一份 `untrap` 局部变量；打开期间**按内容动态建出的节点**所绑的监听器没有统一登记出口，
「关闭时忘了解绑」只能靠人眼 review（spec.md 内存泄漏段的"需持续关注"）。

统一为 `Modal` 上的一对开合原语 + 一对监听器登记原语：

| 原语 | 职责 |
|---|---|
| `openOverlay(id)` | 挂 `.open`；`refreshInert()`；首次开时 `trapFocus(el)` 并把归还闭包记进该 id 的账本。**幂等**——已开再开直接返回（否则重复 open 会把前一个 `untrap` 覆盖后永久丢失） |
| `closeOverlay(id)` | 摘 `.open`；先 `unbindOverlay(id)` 清监听器、再执行 `untrap` 归还焦点、最后 `refreshInert()`（顺序与原先逐条写死时一致） |
| `bindOverlay(id, target, type, fn, opts)` | 向该 id 账本记一条 `{target,type,fn,opts}` 并 `addEventListener`；原样返回 `fn`。动态节点一律用它 |
| `unbindOverlay(id)` | 遍历账本 `removeEventListener` 后清空，返回解绑条数。**每次 `render()` 重建内容前先调一次**（否则记录随重建次数无界增长） |

- **为什么"登记与解绑共用同一份记录"**：漏解绑的根因是"绑的时候没记、解的时候想不起来解什么"。
  把登记与解绑绑成同一份账本后，解绑不需要调用方复述绑了哪些——结构上就不可能漏。
- **不要在模块里直接 `removeEventListener`**：`index.html` 现在 0 处直接调用（只在 `unbindOverlay` 内）。
  新增 overlay 一律走这对原语；`Modal.overlayListenerCount(id)` 是给测试与排查用的只读视图。
- **回归用例 `tests/cases/t57-overlay-listeners.js`（T57–T57e）**：反复开合 N 次断言计数不累积、
  同一次打开内多次 `render()` 计数不增长、`open` 幂等不翻倍、无动态监听器的统计/说明恒为 0。
  **注意测法**：harness 的 `removeEventListener` 是空操作（真实浏览器才摘监听器），
  所以断言的是应用级账本 `overlayListenerCount`，而不是元素桩上的 `_h` 数组长度。

### 3.11 新功能 UI 归属与扇出护栏（v2.0.4，审计 B3）

`Controls` 是 UI 层中枢，当前**直接引用 7 个下游模块**（Presets / Editor / Stats / Ear / Arrange /
Help / KeepAlive），是整张依赖图里最大的扇出点。这既是中枢的合理形态，也是**未来扩展的主要风险面**：
每加一个新 overlay 就顺手在 `Controls` 的 keydown 里再补一段，`Controls` 会慢慢长成"什么都管"的
上帝对象，到那时谁想拆都拆不动。

因此约定 —— **新功能的 UI 内聚在各自模块内部，`Controls` 只做事件转发**：

- 新 overlay / 面板默认落在**它自己的模块**里（`open` / `close` / `render` 都在模块内部），不要塞进 `Controls`
- `Controls` 只保留两件事：**事件转发**（把键盘/点击派发给当前打开的那个 overlay）与**共享状态读写**
- 键盘归属沿用既有模式（`Stats` / `Ear` / `Arrange` / `Help` 的 `isOpen()` / `close()`）：overlay 打开时键盘归它管。
  这一类是 `Controls` 既有的下游引用，属于**转发**，不算新装配
- overlay 的开合与监听器一律复用 `Modal` 的开合/登记原语（§3.10），不要各自再写一遍

护栏 —— `check-module-order.js` 的 **R4**：统计每个模块**直接引用的下游模块个数**，超过 `MAX_FANOUT`（=7）即告警。
`Controls` 现在就顶在上限上，于是"再给控件中枢加一条下游引用"会**当场失败**，必须显式抬高常量并写明理由——
把一次悄悄发生的架构漂移，变成一次看得见、需要辩护的改动。

### 3.12 练习循环：一个区间 = 一个开关（v2.4.3）

把播放限制在当前型的第 `[from, to]` 小节之间无限回绕，专治"某一两小节老是弹不顺"。

**语义前提（先说清，否则容易把功能做错）**：选中一个节奏型本来就会无限循环，所以"循环某个节奏型"
**本来就成立**——真正缺的是**更小的粒度**。参考页的 per-row「循环本段」在这里没有直接对应物
（它的"段落"是变长的）。

**两个入口操作同一份数据**（`S.loopRange = {on, from, to}`）：

| 入口 | 行为 |
|---|---|
| 「循环本段」按钮 | 一键把区间置为 `[0, n-1]`（n = 当前型的小节数）；已是整段时再点即关 |
| 两个下拉「第 X 到第 Y 小节」 | 精确指定；改完**顺手开启**（用户意图已明确,不再要求多点一步） |

**互斥是设计而不是巧合**：两者共用 `S.loopRange.on` **一个**开关。若各存一份，就会出现
"开关亮着但循环的是别的区间"这种无法解释的状态——共用后物理上不可能分裂。

**调度侧的两个出口必须共用同一个"下一小节去哪"**：小节边界有两个出口（空小节跳过 + 常规走完），
v1.9.0 的注释把「唯一出口」写在常规出口上、靠人工保持一致。循环若只改一处，**空小节就会漏出区间**。
故抽成模块级 `loopNextBar(b, n)`；起始小节由 `loopStartBar(n)` 单独回答（少了它，循环区间第一遍
会从 0 开始 → 用户选了第 3-4 小节却先白弹两小节：功能看着生效、起点是错的）。
`n` = `patBars(activePattern())`（v2.5.1 起型不再恒为 4 小节）。

**区间钳制分两层**（v2.5.1，改这里前必读）：
1. `Store.clampLoop()`（**加载期**）：只做形状 + **绝对域** `[0, MAX_PAT_BARS-1]` + 交换保证 `from <= to`。
   它**不可能**知道型有几小节——那时 `S` 还没建好。
2. `loopRangeFor(n)`（**使用期**）：按当前型的小节数二次收窄。
   为什么必须有第二层：`S.loopRange` 是**持久化的练习偏好**，与"当前型"是两份独立状态——
   换型 / 切轨 / 曲式推进 / 导入一份更短的型，都会让存下来的 `to` 指到不存在的小节上。
   **使用点三个**：`loopNextBar`、`loopStartBar`、`resyncToNow`（外加 UI 的 `syncLoopUI`）。
两次独立钳制做不到这件事——`from=3 / to=1` 各自都合法，合起来是空区间，调度器会算出
"永远到不了 `to`"从而卡死。读取一律经它（localStorage 当不可信输入）。

`AudioEngine.rescheduleLoop()` 让改完立刻可听：scheduler 是**前瞻式**的（已有一批音符排进了音频时钟），
规则改了不会自己回头。它与 `resyncToNow` 的分工：那个是"换了节奏型要在新型里找回相位"（**保**相位），
这个是"循环规则变了、相位本来就该重置"（**弃**相位）。**固有差异（不是遗漏）**：参考页能清 `sched`
队列，BeatSight 的音符已交给 Web Audio 排程，已发出的 ≤1.2s 前瞻窗**无法撤回**——听感上最多是
"点下去后还有半拍旧位置的声音"。

持久化跟**热键**走（`hotPayload`）：这是练习偏好而非会话状态，理由同 `S.showTab`。
**只作用于预设模式**——曲式模式的小节推进由节目单（`arrNextBar`）唯一决定，区间循环套上去会把
节目单卡死；此时整个面板**收起**。

**★ 测试观测量必须能区分所有待区分的真相**（本版踩过）：T65d/T65e 第一版用"首音当 `t0`、
再 `floor((t-t0)/barSec)`"反推小节号，而默认型**各小节音符数完全相同** → "没回绕"与
"回绕了但被平移"给出**字节相同**的读数，据此误判成功能没生效。改用**指纹型**（第 i 小节排 i+1 颗音）
后，小节身份由音数直接读出：ON `[1,2]` → `[2,3,2,3,2]`；OFF 对照 → `[1,2,3,4,1]`。

### 3.13 模式字段契约与产物戳记（v2.4.4，外部审计收口）

- **`Audio` 模块已改名 `AudioEngine`**（原名遮蔽全局 `window.Audio` 构造器）。改名波及面：
  check-module-order 的 EXPECTED_ORDER / WHITELIST、全部测试用例、本文档——
  这类改名以后照此办理：先改代码，再 `grep -rn "\b旧名\b"（避开 Web Audio / AudioContext）` 收尾
- **模式字段一律经 `setMode(field, value, why)`**（共享状态区）：`playing` / `preview` /
  `playMode` 三个全局面貌字段的写入点曾散落 9 处裸赋值。setMode 做三件事——值域白名单
  （非法值拒写 + warn）、同值幂等（不算迁移）、迁移轨迹（最近 20 次，`modeTrailView()` 只读）。
  ★ **不做互斥规则**：试听流程就是 preview=true 在先、playing=true 在后，两态合法共存
  （T66c 钉这条，防有人补臆想的互斥）
- **产物戳记自检**：`build-dist.js` 装配时给 dist/index.html 注入
  `<meta name="beatsight-build" content="v版本|时间|sha1">`；在线版启动时 `stampCheck()`
  核对——缺失记 `diag.noStamp`（WorkBuddy 手动链是目录拷贝、天然无戳记，缺席只计数不告警）、
  版本不符才 `diag.stampMismatch` + console.warn。file:// 与 localhost 不查。
  这条把「线上那次构建跑没跑自验」从**不可知**变成**诊断面板的一个读数**
- **R2 热路径名单扩至 5 个**：`paintFrame / paintFrameBody / paintBall / paintBeatFlash /
  repaintCells`（v2.4.4 拆出后两个）。**往帧路径上抽 helper 时，名字必须登记进
  check-module-order.js 的 HOT**——否则拆分会静默缩小 R2 覆盖面
- **测试桩新增两个语义**：DocumentFragment（append 片段 = 子节点摊平搬家，harness 与
  hang-case **两份桩**都要改）；sw.js 的同步 Promise 桩 + put 写回队列（见 tests/README.md）

### 3.14 型的小节数自由化（v2.5.1，改型相关代码前必读）

**一句话**：一个节奏型的小节数 = 它自己的 `bars.length`（域 `[1, MAX_PAT_BARS]`，`MAX_PAT_BARS = 64`）。
`DEF_BARS`(=4) 退化为"新建型的默认值"，**不再是"型恒为 4 小节"**。

**为什么改**：《在他乡》的扫弦是**逐小节指名**的（节奏型 1~5 各是 1 小节的型，
段长 1/3/4/2/4/2/4/2/6/2，全曲 30 小节）。而 `secBars = Σrepeats × 4` 把段长锁死成 4 的倍数
→ 30 小节被垫成 44 小节、每段里同一个小节被盖 4 遍。
（v2.6.0 起示例曲的数据已换成逐小节谱，这段描述的就是它，不再是"待办"。）

**唯一真相源**：`patBars(pat)`。凡是"这个型有几小节"一律走它——校验 / 循环游标 / 网格行数 /
段长 / 练习循环下拉 / **编辑器行数与增删**。直接写 `4` 或 `DEF_BARS` 都是错的（除非真的是"默认值"语义）。

**能力放开 ≠ 能用（v2.6.1 的教训）**：小节数在 v2.5.1 就放开了，但界面上直到 v2.6.1 才有改它的入口
（编辑器「＋ 加一小节 / − 删当前小节」）。**放开一个约束时，要同时检查"用户有没有办法用到它"**——
否则契约只落在数据层，用户侧看不到任何变化（示例曲的 1 小节型在编辑器里就卡了一整期）。
配套的一条硬性守卫：**只要小节数会变，`editBar` 这类"当前小节"游标就必须在 `render()` 开头收进范围**
（音符块库的 `d.bars[editBar].push(...)` 会越界抛错）。

**曲式段长怎么拿到型长**：`secBars(sec)` / `blockAt(sec, bar)` 是**纯函数**（T52 直测，不搭沙箱），
不能直接引用 `resolveRef`。做法是装配层注入 `setPatLenOf(ref => patBars(resolveRef(ref)))`，
默认值恒为 `DEF_BARS`（老数据与测试里的假 ref 行为不变）。**忘了注入不会崩，但段长会退回 4 的倍数**
——由 `t69` 的"3 小节 × 1 遍 = 3"钉住。

**渲染层要与拍号同时锁定型长**：`vizBars`（连同 `vizSig`）。行数、静音拍标识、播放头折行、
弹跳球行界必须用**同一个**模数，否则换型瞬间会"网格已按新型重建、播放头还按旧模数折行"。

**已知边界**：静音拍在 v2.5.1 时还是"型内最后一小节"（对 4 小节的型 = 一直以来的
"每 4 小节静音第 4 小节"，但对 1 小节的型会退化成"把自己整个静掉"）。
**v2.5.2 已改成按乐句位置线性计数**（见 §3.15）。

### 3.15 网格 = 歌曲小节上的翻页窗口（v2.5.2 第 Ⅱ 期立骨，v2.7.0 翻页档 + 预告行，改渲染层前必读）

**一句话**：曲式模式下网格的 4 行 = **这首歌的第 winStart…winStart+3 小节**；
v2.7.0 起窗口**按 4 小节整页翻**（`winAnchor(k)=floor(k/4)*4`，不再逐小节跟着滚），
页内第 4 小节期间第 1 行原地换成「下一小节」预告行（见下）。行可以来自不同的段、
不同的型。预设模式下仍是"画当前这个型的全部小节"（原行为）。

**v2.7.0 预告行（页内第 4 小节 → 第 1 行换成下一小节内容，用户拍板的方案）**：
扫弦练习到页末需要提前看到下一小节的型（翻页后就位太晚）。做法：`previewBarFor(k)`
只在 `k = 页内最后一行` 时解析**节目单**的下一小节（走 `arrNextBar`，与发声同源——
范围末尾不循环则没有预告、范围循环则预告 = 范围起点，绝不按歌曲 k+1 瞎猜）；
`buildViz` 时把 `winPat.bars[0]` 换成预告内容、第 1 行挂 `.preview-row`（降透明）
+ `.preview-badge` 徽标「下一小节 · 型名」。三条铁律：
① 预告行是**未来**——`setCell` 对它豁免"已弹"态（格子恒 upcoming）；
② `paintFrameBody` 重建条件除盯 `winAnchor(k)` 外再盯 `previewBarFor(k).bar`
   （进页末预告生效 / 翻页预告随窗口换，两处各重建一次）；
③ 待命球跨页接力：`paintBall` 里 `rowNext` 在"页末 + 有预告"时取 **0**（预告行）
   而不是 `bar+1` 钳制——待命球落预告行首音上，翻页瞬间内容原地转正、主球同点接管。
状态三件套 `winPrevBar/winPrevSteps/winPrevName` 同生同灭（窗口同步一处写入、
`resetWindow` 一处清）。回归：t70（翻页口径）/ t75（预告行五场景）/ t53k（页末待命球）。

**做法（决定了为什么下游几乎不用改）**：把窗口里的 4 个小节**合成为一个临时型**
（`arrWindowPat`），于是每一行仍然是"某个型的第 bar 小节"，格子/填充/闪烁/弹跳球
全都照旧工作。成本压在窗口合成这一个纯函数里，而不是让渲染层到处支持"混合型"。

| 关键件 | 职责 |
|---|---|
| `songBars / songBarBefore / songBarAt`（共享区） | 把 (段, 段内小节) 摊平成**歌曲线性小节号**；与 `secBars/blockAt` 同族、同样只通过注入的 `patLenOf` 问型长 |
| `winStart` / `winPat` | 窗口起点与合成型（buildViz 时算好缓存，热路径 O(1)） |
| `winAnchor(k)` | **手感档位就这一行**：v2.7.0 起 = `floor(k/4)*4`（每 4 小节翻页，默认）；`k` = 跟播放头滚动（v2.5.2 旧档，已下线） |
| `previewBarFor(k)` / `winPrevBar/Steps/Name` | 页末预告行：只在页内最后一行解析节目单的下一小节（走 `arrNextBar`）；三件套同生同灭 |
| `vizPattern()` | 渲染层该画哪个型：曲式模式 = 窗口合成型，预设模式 = 当前型 |
| `audibleSongBar(now)` | 现在**听到**的是歌曲第几小节。按 onset 表里已落地的端点算，绝不按调度游标 |
| `rowOfOnset(e)` | 端点 → **窗口行**（见下） |
| `mutedRow(b)` | 只用于**视觉标识**"这一行会不会被静**"（发声门控在 scheduler） |

**★ 两个"小节号"必须分清（本期最容易错的地方）**：
`e.bar` 是**型内**小节号（调度器与端点表的口径），窗口行 = 歌曲小节号 − `winStart`。
所以端点在画之前一律走 `rowOfOnset()` 换算（`audioPosAt` / `paintBall` / 待命球三处）。
待命球那块还多一层：**"内容取自型的第几小节"与"画在第几行"在曲式模式下不再相等**
（前者要解析下一小节的型，后者为当前行 + 1——v2.7.0 页末有预告时例外：取 0 = 预告行），
代码里拆成 `cand` / `rowNext` 两个名字。

**★ 重建由渲染侧驱动**：调度器提前一个前瞻窗口（默认 300ms）推进 `arrSec/arrBar`，
按它重建会"画面先跳、声音后到"（v2.0.2 踩过的同类错位）。所以 `paintFrameBody` 开头
先同步窗口，**且必须在取 `playheadEl/trailGlowEl` 别名之前**——重建会换掉这两个元素，
别名取早了就会整帧拿着一对已丢弃的节点写样式（画面完全不动，最难查的一类）。
每小节一次，不是每帧；与 T27「帧内零布局读取」的承诺不冲突（量测只在结构变化时发生）。

**端点为换算补齐的字段**：`aSec/aBar`（节目单位置，v2.0.2 已有）+ `pb`（发声时的**乐句相位**）。
`predictNextArrange` 的两个返回也补了 `aSec/aBar`——否则预测端点会被画到错误的行上。

**静音拍改成按乐句位置**（`schedPlayBar % MUTE_PERIOD === 3`）：旧判据 `schedBar === 型长-1`
对 1 小节的型会把每个小节都判成最后一小节 → 一开静音拍整段静音。4 小节的型下两者逐位等价。
`MUTE_PERIOD` 与 `schedPlayBar` 在共享区（调度器与渲染层共用同一份语义）。

**刻意不做的（写清以免误当 bug）**：
- **歌词轨仍是"当前段"**：它按段内 tick 定位、按 `arrSec` 重建，不跟着窗口跨段。
- **预设模式下型长 ≠ 4 时不静态标"哪一行会被静音"**（相位随循环次数轮转，标不出来），
  到点那一刻由状态栏说明。

### 3.16 示例曲《在他乡》的数据形状（v2.6.0，改示例曲数据前必读）

```
DEMO_STRUMS  = { P1..P5 }          // 5 个**单小节**的 16 格扫弦谱（逐格来自用户给的参考页 var BARS）
DEMO_PRESETS = [{ name, strum }]   // 5 个型，每个 1 小节 → 节奏型1~5
DEMO_SONG    = [{ name, strums: [...], words: [...] }]
                                   // strums 是**逐小节**的型 id 序列，长度 = 该段小节数
                                   // words 是**逐小节**的词行，与小节一一对应（不再"补齐"）
demoBuildSpec()                    // 纯函数：谱面 → { presets, arrange, lyrics }
                                   // 段内相邻同型**合并成一块**（块 = 型 × N 遍）
```

- 全曲 **30 小节**，段长 `1/3/4/2/4/2/4/2/6/2`；`songBars(arrange) === 30`（T63e 钉着）。
- **段长 = 词行数**（逐小节对齐）。改数据时若两者不一致，末行的字会越界被剔除（静默丢字）——
  判据见 T63e 的"没有字越界"。
- **`ensureDemo()` 必须逐块映射**：段 4（收束）与段 10（收尾）各有 **2 块**，
  只映射 `blocks[0]` 会把第二块整块丢掉（段长变短、末句无声）。
- **胶囊条 `applyDemoSeg()` 只换第 1 块的型**、其余块原样保留：它的语义是"这一段用哪个型"，
  不是"把这一段重编"。
- **不要重新引入 4 小节的"组合型"**（旧版的「收束/收尾」就是这么来的）：
  一个段里放两块就表达了"相邻小节各用不同的型"，这才是该用模型的地方。

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
node tools/check-all.js          # 顺序：语法 → 架构约束 → 零依赖 lint → 版本一致性 → 文档一致性
                                 #       → ESLint(可选) → 类型检查(可选) → DOM 引用 → 浏览器冒烟(环境可选)
                                 #       → 全量测试 → 看门狗 → 覆盖率（共 12 步）
                                 # 先便宜后贵，前面失败就停（后面的检查建立在前面是对的之上）
                                 # 耗时看末尾汇总——不在文档里抄数字，tools/check-docs.js 会拦
node tools/check-all.js --quick  # 跳过 T21 的 243 组全量扫描，改代码时用

# 需要单独跑某一项时（排查用）
node tests/run.js                # 主套件：抽样的 T21（16 组）
FULL_SCAN=1 node tests/run.js    # 全量 T21（243 组）
node tools/smoke.js              # 真实浏览器冒烟（CDP）：file:// 与 http://127.0.0.1 双通道
                                 # 断言真实 DOM/CSS/帧率/Service Worker/控制台零报错；本机没浏览器则退出码 3（跳过）
                                 # 跨平台，取代了 tests/screenshot.sh（那个只在 macOS 上能用，且只截图不断言）
node tests/hang-guard.js         # 死循环看门狗：每用例独立子进程 + 8s 超时强杀
                                 # 反向验证：BEATSIGHT_HTML=<旧版 index.html> node tests/hang-guard.js 3000
node tools/check-module-order.js # 架构约束：R1/R2 零例外，R3 白名单登记
node tools/check-lint.js         # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef
                                 # 反向验证：node tools/check-lint.js <注入拼错变量的 index.html> 应报错退出 1
node tools/check-version.js      # 版本一致性：VERSION / CHANGELOG 首条 / 代码里的版本字面量三者互相对齐
                                 # 拦「注释写着 v2.0.2、VERSION 还停在 2.0.1」这类发版漂移
                                 # 反向验证：把 VERSION 改小一格应报"代码引用了更高版本"并退出 1
node tools/check-eslint.js       # 代码卫生 · 加强（可选）：ESLint 10 的 AST/控制流规则，补零依赖 lint 的盲区
                                 # 装了 node_modules 才跑，缺依赖自动跳过并 exit 0（绝不堵部署）
                                 # 它负责抽内联脚本并把 ESLint 行号映射回 index.html；规则集见 eslint.config.js
                                 # 反向验证：注入 if (x = y) 应报 no-cond-assign 且行号正确（check-lint 看不见这条）
node tools/check-tsc.js          # 类型检查 · 加强（可选）：tsc 的 checkJs，把关**模块接口与数据模型**
                                 # 与 ESLint 同一套降级口径（装了才跑、缺依赖标 ⊘ 跳过）
                                 # 严格开关：strict 家族 9 项 + noImplicitReturns / noFallthroughCasesInSwitch 全部已开且全绿
                                 #   （开启路径与两轮攻坚的债务数字）见 tools/tsconfig.typecheck.json
                                 # 反向验证：注入 S.limit.noSuchField / S.trainr.on / S.sig="four"
                                 #   应分别报 TS2339 / TS2551(Did you mean 'trainer'?) / TS2322，行号准确
node tools/check-dom-ids.js      # DOM 引用完整性：$("x") 不得悬空
node tools/check-coverage.js     # 行覆盖率：V8 内置采集，总阈值 97% / 分区 90%

# 2)+3) 真实浏览器冒烟 + 控制台报错检查（v2.0.6 起跨平台，取代 macOS 专用的 tests/screenshot.sh）
node tools/smoke.js              # file:// 与 http://127.0.0.1 双通道；CDP 取页面内实测值
node tools/smoke.js --file-only  # 只跑 file://（无本地服务时用）
BEATSIGHT_CHROME=<路径> node tools/smoke.js   # 浏览器不在默认位置时指定
```

**可选闸门的"跳过"必须是 ⊘、不能是 ✓**（v1.9.1 修的一个假绿）：`check-all.js` 只认退出码，
而这两步按设计就是缺依赖时 `exit 0`——于是"没装依赖所以没查"与"查了且通过"在汇总里长得一模一样。
现在 `STEPS` 里给可选步骤声明 `optional: "<依赖路径>"`，`check-all.js` 自己检查依赖、
缺了就直接标 ⊘ 且**不调用**；汇总多打印一行「实跑 N/M 项」。
**别把它改回只看退出码**——那等于让汇总里的 ✓ 撒谎，而它能撒谎的话，其余 ✓ 就都不值得信了。

**两类"跳过"必须分清（v2.0.6，审计 P1-10）**——多了一种可选步骤之后，这条更重要：
- `optional`（第 6/7 步 ESLint、tsc）：缺的是**开发依赖**。`npm ci` 能装上，所以 `--strict-env`
  下要报错，逼 CI 装上而不是假装查过。
- `skipCode`（第 9 步浏览器冒烟）：缺的是**环境能力**（本机得有 Chrome/Edge）。构建镜像里
  必然没有，把它算失败会无谓地堵住部署——所以 `--strict-env` 也**不**升级为错误。
  它由被调脚本用**退出码 3** 表达"本机缺这项能力"。
两者在汇总里都显示 ⊘，但"为什么没跑"分开写清——这正是本文件区分 ⊘/✓ 的初衷。
另外：失败计数 `failed` 必须排除环境缺失那类（它的 `ok` 是 false），否则 ⊘ 会被算成失败。

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

**index.html 禁止过格式化器**（v2.4.4 审计补记）：`tools/check-module-order.js` 的 R1 用「恰好 2 空格缩进 = IIFE 顶层语句」做判定，prettier 一次全文件重排就会让这条架构闸门**静默失效**。同理 `check-lint.js` 依赖逐行括号配平。要引入格式化工具，先把这两个检查器改成括号深度/AST 判定。

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

## 6. 路线图（2026-09-07 重排 · 截至 v2.0.2 队列已清空）

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
   - ~~v1.11.0 练习闭环收口~~ **已完成**：本期练过 / 没碰的节奏型 + 速度趋势 + 听辨战绩并入统计。见 CHANGELOG v1.11.0
   - ~~**更远（P3）曲式编排**（多段落串联）~~ **已完成（v2.0.0，2026-09-16）**：最终走的就是探针里
     "不动时间轴不变量"那条路——**档位①′（播放层面串联）+ 块结构**，落地细节见 [PLAN-v2-impl.md](PLAN-v2-impl.md)。
     当初的顾虑（会动音频核心的"严格 4 小节循环"模型 `schedBar` 0..3 + 单锚点 `loopStart`，牵连
     T12/T15/T20/T21 一批相位不变量的前提）已用"串段而不改时间轴"化解，故如当初所判——**不与小改动混批、单独成版**。
     探针 [PLAN-v2-arrangement.md](PLAN-v2-arrangement.md) 盘出的 **18 条**"严格 4 小节循环"假设、
     三个改动档位（①播放层面串联 ②段落自适应行数 ③完整编辑器）与其中的决策点（D1–D8）**已随发布全部闭环**——
     该文自此转为**历史记录**，不再有待拍板项。
   - ~~v2.0.1 使用方法页 + 顶栏常驻入口~~ **已完成**：见 CHANGELOG v2.0.1
   - ~~v2.0.2 审计驱动的健壮性加固（曲式播放前复检 / 调度与渲染错误可见化 / 持久化恢复路径 / 版本号单一来源 + 闸门 / 下载去重）+ 修曲式播放实时进度~~ **已完成**：见 CHANGELOG v2.0.2

**本排队表已清空（截至 v2.0.2）：当前无排期中的事项。** 新需求先按上面的优先级原则排队再进来；落一项就把该项划掉，不要让已完成项留在"待办"里假装还在排期。

### 已埋的技术债 / 后续要盯
- ~~快捷档值 `CONFIG.speedPresets` 目前只服务 BPM；若日后音量、拍号也要常用值，考虑抽成通用 preset row 组件，别复制三份~~ **已完成（v1.6.4）**：共享区（`setPressed` 旁）抽出 `buildPillRow(host, items, opt)`，BPM 快捷档与奇数拍重拍分组两处改为复用；`CONFIG.speedPresets` 仍是唯一数据源，日后音量/拍号要常用档位直接复用组件，不必再复制
- 滑杆刻度是手绘层，`--thumb-r` 必须与实际 `::-webkit-slider-thumb` 尺寸同步；再改圆钮大小记得同改 `.slider-wrap` 的内缩变量
- ~~静态检查仍是自写的窄规则集~~ **已补（v1.6.5）**：原话是"架构约束 / 五项 lint / DOM 引用 / 覆盖率都已就位，但覆盖面小于 ESLint 生态（无类型检查）。要更全套就加 `package.json` + ESLint devDependency——只用于本地自验，不进产物"。现已落地：加 `package.json` + `package-lock.json`（唯一 devDependency `eslint`）+ `eslint.config.js`（flat config）+ `tools/check-eslint.js`（抽内联脚本、把 ESLint 行号回映射到 `index.html`），作为 `tools/check-all.js` 的第 4 步（现共 8 步）。**它仍是可选加强项**：缺 `node_modules` 时自动跳过并 `exit 0`，绝不会因为"没装开发依赖"堵住 Cloudflare 部署；"零依赖"约束针对的始终是 `file://` 直开的运行时产物（上站仍只有 4 个文件）。规则集与 `check-lint.js` 刻意不重叠，取舍理由见 `eslint.config.js` 文件头。~~**仍未做类型检查**（无 TS/JSDoc 类型校验）~~ **已补（v1.9.1）**：`tools/check-tsc.js` + `tools/tsconfig.typecheck.json` + `typescript` devDependency，按同一套"可选加强项、缺依赖标 ⊘ 跳过"模式接入（第 5 步，现共 9 步）。落地时实测抓到 6 类真问题（46 处 EventTarget 取值、22 处 `$` 元素类型、`textContent` 被赋数字、`onLimitPulse` 名字遮蔽等，全部已修），并给最中心的 `S` 补了显式类型标注——那是闸门真正长牙的地方。**严格模式已扩面（2026-09-16）**：TS 7.0.2 下实测，**8 项严格检查打开后 0 报错**，故已直接开（strict 家族 6 项：`strictFunctionTypes` / `strictBindCallApply` / `noImplicitThis` / `alwaysStrict` / `useUnknownInCatchVariables` / `strictBuiltinIteratorReturn`；另加非 strict 家族、但同样只抓真错的 2 项：`noImplicitReturns` / `noFallthroughCasesInSwitch`；均写在 tools/tsconfig.typecheck.json 的 `compilerOptions` 里）。**只剩两笔已量化的债**：~~`noImplicitAny` 打开会得到 **727 条**（TS7005 337 / TS7006 291 / TS7034 74 / TS7053 24 / TS18047 1）~~ **`noImplicitAny` 已清零并打开（2026-09-17）**——按"逐块补标注、逐块开开关"的路径分两批（727 → 282 → 0）补完全量前置 `@param` / `@returns` 与内联 `@type`，全文件 0 报错后把开关由 `false` 改为 `true`（改的是 `tools/tsconfig.typecheck.json` 的 `compilerOptions`，不动 `index.html`、不动产物）。**只剩一笔债**：~~`strictNullChecks` 打开会得到 **96 条**（TS18047 74 / TS2345 10 / TS2322 4 / TS18048 4 / TS2769 3 / TS2531 1）~~ **`strictNullChecks` 已清零并打开（2026-09-17）收官**——那 96 条（比原记的 **251** 降下来，因为大量隐式 any 消失后，原先被 any 传染出来的空值报错一并消失）按模块分七块逐块消化：Trainer 6（`S.plan`）→ 小尾 9（Arrange 4 + Ear 3 + Store 1 + Modal 1）→ Controls 11 → AudioEngine 20（`ctx`）→ Viz 25（缓存 DOM 引用）→ Editor 25（`draft`），统一用「取本地别名 + 判空守卫」补上（模块级可空 `let` 在函数顶部取别名并早返回，定时器句柄先判 `!== null` 再 `clearTimeout`，`.closest()` 补 `!!` 守卫），全文件 0 报错后把开关由 `false` 改为 `true`。**至此 strict 家族 8 项与两项额外严格检查全部打开且全绿，类型闸门扩面收官**。改动仍只在 `tools/tsconfig.typecheck.json` 的 `compilerOptions`，不动 `index.html`、不动产物。
- **检查没有"必经之路"，全靠钩子 / 自觉**（v2.0.5 修正，原写的是"Cloudflare 构建时必定跑一次全量检查，失败即不部署"）：Cloudflare 的**线上**构建跑什么，取决于 Dashboard 里那串构建命令——**Workers Builds（Git 集成构建）不读仓库里 `wrangler.jsonc` 的 `build.command`**（Cloudflare 官方既有行为），所以仓库里那份配置只约束本地与命令行的 `wrangler deploy`。换句话说，**没有任何一道闸门是"推上去就一定过不去"的**；**提交时**这一环已由仓库自带的 `hooks/pre-commit` + `tools/install-hooks.sh` 补上——`core.hooksPath` 是本机配置、不随仓库走，故**每个 clone 各自跑一次** `sh tools/install-hooks.sh`，此后每次 `git commit` 自动跑 `node tools/check-all.js --quick`（跳过 T21 全组合扫描；想绕过是不该常态的 `--no-verify`）；**WorkBuddy 手动发布时**仍没有任何机制拦你，发布前务必手动跑一次全量 `node tools/check-all.js`。别拿"Cloudflare 会拦"当借口跳过本地那一遍——它只拦得住上 Cloudflare 这一条路
- **后台持续发声仍需真人验收**（见 §5）：自适应窗口只能用假时钟断言，浏览器层面的定时器节流无法在无头环境复现
- 覆盖率未覆盖的共 **11 行**（实测 99.7%），分三组、性质不同：**AudioEngine 8 行** —— `arrNextBar` 的 onset 扫描兜底、单轮调度 `MAX_SCHED_STEPS` 硬上限触发后的**重锚分支**、以及 `ctx` 被系统关闭后重建 / `resumeCtx()` 的异常分支（v2.0.6 新增的代码里，只有"出事才走"的那几条没被点亮）；**Ear 3 行** —— `durName` 里 192/144/96 与 6 这几档时值。前 8 行属**刻意保留的防御性代码**（要造出超 512 音符的单轮调度、或让上下文被系统关闭才会触发）；后 3 行属**不可达分支**（内置库与听辨出题组都不用这几档时值，`durName` 也不对外导出）。两类都不为了数字去造人工状态点亮它。**具体行号一律不抄进文档**（v2.0.5）：本行原先写的 5 个行号（L2964 / L3034–L3036 / L4478 / L4479 / L4481）在 v2.0.4 全维度审计中实测**全部失效**——它们随代码行移动而漂移，抄一次就等着烂；现在以 `node tools/check-coverage.js` 的输出为准，它自己会打印未覆盖行所在的行号
- `Viz.paintBall` 的 `H = min(clamp(k·T²,10,48), yBase+6)` 里那道"顶点不出容器空域"的钳制，只在**第一行且弧很长**时才会真正生效（默认 96 BPM 下未钳制跳高 46.9px 仅比上界 44px 高 2.9px，余量很薄）。**已补专门场景**：T30 ⑧ 把 BPM 降到 60 构造长弧（未钳制 48px 明显高于上界 44px），断言实测跳高等于上界而非未钳制值——删掉钳制即变红（反向验证已跑）。改动行高/内边距时要留意上界 `yBase+6` 会随行位置漂移

### 已明确不处理（不再跟进）
- **Firefox 圆钮样式**（2026-09-11 决定忽略）：本项目只写了 `::-webkit-slider-thumb`，没有 `::-moz-range-thumb`，理论上 FF 下圆钮可能与刻度略错位。本机无 Firefox、未实测，用户已决定不处理 → **不再列为待办，也不要主动盘它**（不必提、不必测、不必补）。仅当日后真有人在 Firefox 下反馈刻度错位时，再回来补这两条伪元素规则
- **iOS 兼容性**（2026-09-15 决定忽略）：用户无 iOS 设备、以后也不考虑 → iOS 专属的验收项（锁屏保活、Safari interrupted 状态实测）不再跟进。代码里已有的兜底（静音 WAV、ctx 状态监听）保留不动——它们对无 wakeLock 的桌面/Android 浏览器同样有效

## 7. 用户协作偏好

- 无技术背景：解释技术问题用生活化比方，不堆术语
- 在意 token 成本：改动合并成一条明确需求；声称完成前必须自验（语法 + 真实浏览器截图）
- 决策记录写进 CHANGELOG.md，关键状态写进本文档
