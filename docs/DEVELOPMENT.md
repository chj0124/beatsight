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
├── package.json          # 开发期工具链（devDependencies：eslint / typescript 为**可选**加强项，wrangler 为部署工具且钉版本；只跑本地，不进产物）
├── eslint.config.js      # ESLint flat config（本地自验专用，规则集与取舍写在文件头）
├── _headers              # 静态资源响应头（v2.0.3 审计 C3；构建时拷进 dist/，自身不对外提供）
├── wrangler.jsonc        # Cloudflare Workers 静态资源配置（资源目录 + 构建命令；唯一入库的 Cloudflare 配置）
├── tests/
│   ├── run.js            # 主测试套件（node tests/run.js，零依赖）
│   ├── hang-guard.js     # 死循环看门狗：每用例独立子进程 + 超时强杀
│   ├── hang-case.js      # 看门狗的单用例探针（被 hang-guard 调起）
│   └── README.md         # 测试原理与补断言规则
├── tools/                # 零依赖检查器（见 §5：node tools/check-all.js 一条命令跑全套）
│   ├── check-all.js            # 本地完整自验入口（取代原来的 GitHub Actions CI）
│   ├── check-module-order.js   # 架构约束：模块不得反向引用（R1/R2/R3/R4）
│   ├── check-wiring.js         # 装配完整性：`let onXxx = null;` 约定的钩子与 patLenOf 注入点是否真被接上
│   ├── check-lint.js           # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef
│   ├── check-version.js        # 版本一致性：VERSION / CHANGELOG / package.json / package-lock.json / 代码注释不得漂移
│   ├── check-docs.js           # 文档一致性：模块索引行号 / 禁手写耗时 / 归档状态 / README 版本号与步数 / 禁手写覆盖率
│   ├── check-headers.js        # _headers 结构：全路径 glob 恰好一行 · 6 个安全头齐全且缩进 · 无 BOM / 无孤立收尾
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

- **① Cloudflare，自动**：仓库接 Git，推 `main` 即自动构建部署 → https://beatsight.chenhuajian1995.workers.dev/ 。**Dashboard 的 Build command 填的是 `npm run ci`**（v2.8.3 起；定义在 `package.json`，= `npm ci` + `node tools/check-all.js --strict-env` + `npm run build`），全量检查串在里面、**不通过就不部署**，所以这条路上线上始终是最新代码。注意那一行**只存在于 Dashboard**、仓库改不了它——仓库侧能做的是把它压到只剩这个稳定指针（理由与坑见 `wrangler.jsonc` 头部）
- **② WorkBuddy，手动**：https://beatsight.app.workbuddy.host/ （v2.8.30 起；旧链接 beatsight-48543 已随换绑废弃，不再更新）。**只在你用 WorkBuddy 打开项目并发布时才更新**——所以它滞后是常态、不是故障，随手一比"WorkBuddy 上还是旧版"不说明任何问题，判断"线上是不是最新"请以 Cloudflare 为准
  - ★ **发布的是一整份目录，所以要单独建一份干净副本再发**：`beatsight-publish/`。
    v2.8.30 起这份副本**直接取 `node tools/build-dist.js` 产出的 `dist/`**——它恰好就是上站清单
    （5 个拷贝条目 `index.html` / `sw.js` / `manifest.webmanifest` / `icon.svg` / `_headers`
    + 4 个构建期生成的 `icon-*.png`，共 9 个文件），拷一份到 `beatsight-publish/` 再发即可。
    **别直接发 `dist/`**：发布器可能把它当构建产物过滤掉，发上去是空站。
    **PNG 不入库**（v2.4.4 起由 `tools/gen-icons.js` 生成），由 `build-dist.js` 现场生成进 `dist/`，
    所以不必再手工跑 `gen-icons.js`（手工跑会输出到仓库根，反而多出一份无人清理的副本）。
    不要直接发 `beatsight/`——那里有 44 MB 的 `node_modules`，以及 `tests/` `tools/` `docs/` `package.json` `wrangler.jsonc`，
    发上去就都变成公开可访问的了。**每次重新发布前要先重新 copy 覆盖**，否则会发到旧版本
  - ★ **应用归属是按"工作区（会话）"判定的，不是按目录**：每个 WorkBuddy 工作区根目录有一个
    `.<appId>.genie` 标记文件，记录它发布到哪个应用。**指定别的 appId、或从别的工作区的目录发布，
    都会被路由回当前工作区自己那个应用**——所以一个应用只能在"当初创建它的那个工作区"里更新。
    旧应用更新不了就换绑新链接（34873 → 48543 → beatsight 就是这么发生的）

机器检查改由 `node tools/check-all.js` 在本地一键跑完（见 §5）。**v2.8.8 起仓库内另有一条可 review 的 CI**（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)）：推送与 PR 都跑 `npm run ci`，并另开一个 job 跑真实浏览器冒烟——**它是补位不是替代**：Cloudflare 那条路仍只拦"推到 main 触发的那次构建"，而仓库内的 CI 对所有分支与 PR 生效、可 diff。Cloudflare 侧只留一份最小配置 `wrangler.jsonc`：Workers 的静态资源（Static Assets）**必须**由 Wrangler 配置文件声明资源目录（`assets.directory = ./dist`），否则构建里的部署命令无法定位要发布的文件、当场失败。仓库里另有 `_headers`（纯文本响应头规则，构建时拷进 `dist/`，由 Workers 解析后作用于静态资源响应，自身不对外提供）；**没有** `_redirects` / `functions/`，也没有 Worker 脚本（纯静态托管，Worker 不参与请求）。

  - ★ **安全头的作用域 = 只有 Cloudflare 这一条渠道**（v2.8.7，审计 §S1 补记）：`_headers` 是 **Cloudflare Workers 静态资源**的格式，只有走 Workers 的那条路会解析它。渠道 ② 的发布集在上面写着——**8 个文件、不含 `_headers`**（`dist/` 共 9 个文件，扣掉 Cloudflare 专用的 `_headers` 即这 8 个），所以那 6 个头在 WorkBuddy 渠道**按构造就不生效**。WorkBuddy 的静态托管是否支持某种等价机制（或会不会读同名文件）**未实测**，本仓库也没有为它准备等价配置；因此"两渠道等价"这句从未成立，**别拿 Cloudflare 的响应头去推断 WorkBuddy 的行为**。要让两渠道真正等价，要么给 ② 找到并接上等价机制，要么在 ② 侧明确接受"无这些头"这一事实——**在补上之前，安全头相关的结论一律只对 Cloudflare 渠道负责**。
  - ★ **`/*` 是路径 glob，不是注释开头**（v2.8.7，审计 §S1）：`_headers` 只认 `#` 为注释，`/*` 的含义是"匹配所有路径"，目前 `_headers` 正是靠它让 6 条头作用于全站——**这层作用域是"声明"出来的巧合，改动前请先读文件里那段作用域说明**。结构性约束（glob 恰好一行、6 个头齐全且缩进、无 BOM、无孤立收尾标记）由 `tools/check-headers.js` 把守（自验链第 7 步）——因为这类改动**不会报错，只会静默失效**。v2.0.4（审计 B4）起，构建步骤也进了 `wrangler.jsonc`：`build.command` = 全量自验 + 装配 `dist/`，使本地 `npx wrangler deploy` 可完整复现线上构建；但 **Cloudflare 的 Git 集成构建（Workers Builds）不读** wrangler 配置里的 Custom Builds（官方既有行为），线上那次构建仍以 Dashboard 里配的构建/部署命令为准——详见 `wrangler.jsonc` 头部注释。

## 3. 核心架构

### 3.0 模块地图（v0.6.0 起；v1.0.0 依赖方向净化；v1.4 扩到 10 模块；v1.10 起 11 模块；v2.0 起 12 模块；v2.0.1 起 13 模块；v2.4.0 短暂 14 模块、v2.9.0 撤销回 13；**v2.19.0 起 14 模块——诊断代码从装配层抽成 `Diagnostics`**）

`<script>` 顺序：**数据 → Store → 共享状态 → Modal → Viz → AudioEngine → Trainer → Controls → Presets → Editor → Settings → Ear → Arrange → Help → KeepAlive → Diagnostics → init**

```
Store（持久化/状态创建/迁移/导入导出）
共享状态（S/customs 别名、draft、appliedPat、activePattern、UI 同步助手、音频时钟变量）
→ Modal（应用内弹窗）→ Viz（时值可视化）→ AudioEngine（Web Audio 前瞻调度）
→ Trainer（变速训练器；v2.11.2 起「上次训练接续 / 7 天计划」整块删除，只剩爬坡本身）→ Controls（播放控制/BPM/拍号/Swing/音色/预备拍/静音拍；★ v2.10.14 起**没有走带卡**——BPM 在时值卡头行、Swing 在同屏行数行、播放键在跳段行中间，上/下段键常显置灰）
→ Presets（预设库三区「节拍 / 扫弦 / 自定义」/回退提示/播放中切换挂起/整首连播与播放范围滑块，v2.5.0 起·滑块于 v2.10.4；三区常显于 v2.9.0）→ Editor（自定义编辑器）
→ Settings（设置弹窗：浮层小窗形态、点窗外即关，主题 / 弹跳球 / 六线底纹 / 音色 / 四个导入导出 / 使用方法入口，v2.10.12；形态改 Dialog 于 v2.10.13）→ Ear（听辨训练：出题/判分/战绩，v1.10.0）→ Arrange（曲式编排 UI，v2.0.0）→ Help（使用方法页，v2.0.1）
→ KeepAlive（后台保活：wakeLock + 静音音频兜底）→ Diagnostics（诊断与产物戳记：计数器 / 错误原文环形缓冲 / 产物戳记自检 / `?debug=1` 面板，**v2.19.0 由装配层抽出**）→ init（装配）
```

- **v2.9.0：两态「轨」模型取消，改为按**内容**分类的三区侧栏**：旧版在预设库顶部有一条「普通节拍 / 带扫弦」切换条（`Tracks` 模块 + `S.track`），它维护一个**运行期的"当前轨"状态**，再按该状态过滤预设、门控记谱与声部。v2.9.0 把这条切换条整条删掉，预设库改为「节拍 / 扫弦 / 自定义」三区**常显**堆叠——**分类判据是每个型自己的内容**（`hasStrum` = 带 `dir` 或 `zone` 记谱），"这个型归哪一区 / 画不画扫弦标注 / 走节拍声部还是扫弦声部"全部由型自身决定，**不再有任何隐藏的"当前轨"状态**。`bpm/sig/vol/swing/timbre` 依旧是同一个 `S` 单例（沿用"全部共享"的既有约定），`spb()` 与 `scheduler` 一行未改。
- **v2.5.0 的两条声部（改发声前必读）**：带扫弦记谱的谱上，节拍器与扫弦是**两条独立声部**，不是一条。
  - `schedOneStep` 里：先按原有逻辑发"这一步自己的声"（带扫弦记谱 → 扫弦声，否则 → 节拍音），
    再跑一遍**节拍器网格**（半开区间 `[cumT, cumT+step.t)` 扫拍点，逐拍补一声 click）。
  - 网格的生效条件只有一条 —— `hasStrum(pat)`（v2.9.0 去掉了旧的 `S.track === "strum"` 门控）：**不带扫弦记谱的谱本身就是节拍器**，
    给它补网格会把长音中间多敲出几下（行为变化，非修复）。`hasStrum` 每轮调度只算一次（在 `schedulerBody`），
    不进每步热路径。
  - 音量：节拍声部走 `S.vol`、扫弦声部走 `S.strumVol`，**并列不串联**（`strumVol` 不乘在 `vol` 上）。
    层级（重拍/正拍/细分）与重拍增强对两条声部共用。
  - **v2.7.1 打通（用户实拍驱动）**：扫弦声部的判据从「带 `zone`」放宽到「带扫弦记谱
    （`dir` 或 `zone`）」——纯方向谱（内置「民谣扫弦」只有 dir）此前整谱走节拍声部，
    「扫弦」滑条对它恒无效；dir-only 的格补成中弦区（与"省略 zone = 中弦区"同契）。
    **鼓组音色也不再除外**：扫弦格仍按层级选鼓件（底鼓/军鼓/踩镲自带频段分工，不叠弦区
    频段），但音量走 `S.strumVol`。三种音色下两条滑条都成立。
  - "自身那一声是否顶掉了同拍的节拍音"的判据必须与 `playClick` 的声部入口**逐字一致**
    （v2.7.1 起：透传后 `zone !== undefined` 即扫弦声部，drum 不除外；扫弦声**不顶掉**拍点，
    拍点叠在它上面——只有不带扫弦记谱的普通音符才顶掉自己那一拍）。
    写错的表现很隐蔽：某一拍整拍没声音。
  - **节拍点不入 `onsetBuf`**：弹跳球跟的是"你要弹的那条声部"（扫弦声部）的落点，节拍层是参照网格。
  - 回归：`tests/cases/t68-whole-song-and-voices.js`（T68a–T68e）+ `tests/cases/t76-voices-and-lyric-audible.js`（T76a/T76b）。
- **v2.5.0 的整首连播**：`Presets` 里新增「整首连播」按钮与段序条（挂在示例曲分组），
  机制**复用既有门面**（scheduler / `arrNextBar` / `arrangeStart` 一行未改）。
  三条路径构成"两个对等入口"的契约：点「整首连播」= 曲式模式 + 范围整首 + 开循环 + 起播；
  点段序条第 N 段 = `jumpTo(N)`（`range=[N,N]` + loop）；**点任一节奏型 = `exitArrangeForPreset()`
  退回预设模式**——最后这条是本次真正的流程修复：在此之前曲式模式**没有主界面出口**
  （全文件只有"曲式校验失败"与"删除曲式"会退回预设），用户点了节奏型再按播放，播的仍是节目单。
  呈现收口在 `Presets.syncDemoSecRow()` 一处，由 `Arrange.refreshBar/refreshNow` 与 `Controls.stop` 调用
  （`Arrange → Presets` 是向前引用，合法；反向的跳段经新钩子 `onDemoJump` 注入装配层）。
  ★ **v2.10.4 更新**：段序条已换成**播放范围双滑块**（`syncDemoRange`，钩子改为 `onDemoRange`
  → `Arrange.setRange`），"切换节奏型"胶囊条整条删除。详见 §3.17；`jumpTo` 保留但只服务跳段行。
- **分类判据 `hasStrum` 只有一处实现**：v2.8.8 起它从 `Store` 上移到**数据区**（`Store` 之前），只读 `pat.bars`、不查任何已落盘的型，因此 `Store` 的迁移期与运行期（`Presets` / `AudioEngine` / `Viz`）**共用同一份** `hasStrum`，不再有"两处实现"的分野。判据是「`dir` 或 `zone` 任一 `!== undefined`」，回归见 `tests/cases/t62-strum-zone.js` 与 `t84-sidebar-zones.js`。

- **任何模块不得反向引用后方模块**；运行期热路径（paintFrame/scheduler 每帧/每 25ms 读）只读共享状态区与前方模块——v1.0.0 把 activePattern/draft 从 Presets/Editor 上移至此区，消除了 Viz→Presets、共享→Editor 两处反向依赖
- **v1.3.0：这条规则从"注释里的口号"变成了可执行检查**（`tools/check-module-order.js`），并精确化为三条：
  - **R1 零例外**：IIFE 顶层执行期不得引用后方模块（真会产生 TDZ 的场景）
  - **R2 零例外**：**每帧渲染热路径**（paintFrame / paintFrameBody / paintBall）体内不得出现「后方模块名 + .」
  - **R3 白名单**：运行时回调可以调用后方模块，但必须在检查器的 WHITELIST 逐条登记并写明理由；条目失效（代码里不再出现）也会报错，防止白名单腐烂成"什么都放行"
  - **R4 扇出上限（告警，v2.0.4 新增）**：一个模块**直接引用的下游模块个数**（扇出）不得超过 `MAX_FANOUT`（=7）。扇出是"某模块会不会膨胀成上帝对象"的最直接指标。★ **v2.18.0 复核后已不是"顶格"**：`Controls` 从 7 降到 **2**（详见 §3.11），当前全场最高是 `AudioEngine×2` / `Controls×2`——但常量**刻意留在 7**，它是"中枢又胖一圈"的可见化闸门，不是"当前用量的记录"。再想加一条仍须显式抬高常量并写明理由，让"中枢又胖一圈"成为一次看得见、需要辩护的改动，而不是悄悄发生
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

- 内置预设在 `BUILTINS`（现共 17 个 = 12 条通用型 + 5 条《在他乡》示例型，v2.20.0 起示例型 push 进来；
  源数组字面量仍是 12 条，`DEMO_BUILTIN_BASE` 之后追加）；用户预设在 `customs[]`，存 localStorage key `beatsight.m2`（`v:3`）
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
- **★ 曲式的段带稳定身份 `uid`（v2.26.0，改段 / 改歌词寻址前必读）**：
  ```js
  section  = { uid: "s<ts>-<n>", name, blocks: [{ ref, repeats }] }
  lyricLine = { arrangeId, secUid, chars: [{ t, dur, ch }] }   // v2.26.0 前是 sec（段下标）
  ```
  - **为什么**：歌词此前按 `(曲式id, 段下标)` 寻址，而下标是**位置**不是**身份**——
    段上移/下移/删中间一段之后，挂在下标上的词会跟着位置落到**另一个段**上。
  - **发放与继承**：`normArrange` 三档判据 —— 自带有效且同曲式内未重复 → 用它；
    否则**按位置继承**库里同 id 旧版本的 uid（`upsertArrange` 传入）；都没有 → 补发。
    继承那条是为了示例曲重建（`ensureDemo` 的 spec 恒不带 uid）不让段身份变。
  - **冷键 `beatsight.lyrics` v:1 → v:2**：加载期与导入期都过 `lyricMigrate`
    （已有 secUid → 直接用 / `sec` 下标 → 该段 uid / 越界 → 按 `secName` 兜底 / 都失败 → 坏行计数）。
    迁移**幂等**（不写回、不重复迁移），但**只修复未来不再错位，不追溯修复历史上已错位的词**。
  - **`deleteArrange` 连带清歌词行**：曲式删掉再重建是全新的段、新 uid，旧行留着只占配额且永不可见。
  - 回归：`tests/cases/t103-lyric-sec-uid.js`（T103a–g）。

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
- **会话额度（原练习量，v2.10.12 删档位留内核）**：入口仍在 `scheduler()` 最前面，`if (onLimitPulse && onLimitPulse()) return;`
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
  **只挂在带扫弦记谱的谱上**——不带扫弦记谱的谱没有箭头，留一层无解释的横线纯属噪音（分类判据同 `hasStrum`，v2.9.0 去轨门控）。
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
可用性、高亮、`aria-pressed` 与选中状态**同源更新**（三件事全部收在 Editor 的 `editorRender()` 里）——
分散写必然漂移，这是 v1.3.0 开关三件套的教训。未选中、或选中的是休止符时三档禁用并给出原因
（禁用而不是弹窗报错，避免误点即打扰）；点击处理器同样再拦一次，两道防线。
重复点当前档位不产生变更、不污染撤销栈（T47c 有一句专门钉这条）。

### 3.6 持久化：冷热分离（v1.3.0，审计 P1-5）

| key | 内容 | 写入时机 |
|---|---|---|
| `beatsight.state` | bpm/vol/accentVol/mute/sig/sel/swing/accentGrp/timbre/countIn/trainer/bounce/keepAwake/migHint/**limit**（**< 1 KB**，实测 328 字节） | 每次交互，**250ms 尾部防抖**；`flush()` 立即写。★ v2.11.2：`trainer.plan`（7 天计划）随功能删除，老存档里的 `plan` 由白名单忽略（零迁移） |
| `beatsight.customs` | `{v:1, customs}` 预设库 | 只在预设增删改时，**立即写**（不防抖——丢掉一个手写节奏型代价太大） |
| `beatsight.m2` | **旧键，只读的迁移来源** | 仅首次升级时读取；拆分成功且写后校验通过后**删除**（v1.3.1），备份存 `beatsight.m2.bak` |
| `beatsight.quarantine` | 未通过结构校验的预设（人工找回用） | 加载时发现淘汰项才写 |
| `beatsight.ear` | `{v:1, total, right, best}` 听辨训练战绩（v1.10.0） | 答完一题**立即写**（冷键同语义）；`right` 用 `min(total,…)` 夹住，防脏数据算出 >100% 正确率。★ v2.10.12：统计面板连同「练习记录」冷键 `beatsight.log` 一起删除后，战绩**只在听辨训练自己的弹窗里看**（`#earAcc` / `#earTotal` / `#earBest`），本表不再有 `beatsight.log` 一行 |
| `beatsight.arranges` | `{v:1, arranges:[{id, name, sections:[{name, blocks:[{ref, repeats}]}]}]}` 曲式库（v2.0.0） | 增删改曲式时**立即写**（冷键语义，丢不起）。**只做结构校验**（段/块/遍数/上限/总小节数）；引用存在性与拍号一致性由共享状态区的 `arrangeProblems()` 判（要 `resolveRef`，而它在 Store 之后——这条边界别混，见 §3.9 的口径讨论） |
| `beatsight.theme` | `"classic"` / `"obs"` 主题偏好（v1.7.0） | 点顶栏「主题」切换时立即写；**独立键**，不进上面的冷热拆分，写失败静默降级 |
| `beatsight.wallpaper` | `{v:1, img, dim:0–80}` 背景壁纸（v2.12.0；**v2.13.0 起有三态**，见下） | 换图 / 拖完遮罩滑杆时立即写；**独立键**（与主题同判据：低频视觉偏好）。★ 刻意**不进热键**：它几百 KB，进了热键就等于每次交互都整份 stringify 它，正是本表冷热分离要防的事；也**不进「导出全部数据」**（它是这台机器的偏好，不是数据资产）。落盘上限 1200 KB（base64 字符数），写失败**必须提示**（与主题"静默降级"不同：这是用户刚做的动作） |
| `beatsight.latency` | `{v:1, profiles:[{id,name,ms}], currentId}` 音频延迟补偿（v2.14.0，见 §3.18） | 改补偿值 / 新建改名删除 / 切配置时**立即写**；**独立键**（低频设备配置，与主题 / 壁纸同判据）。刻意**不进热键**（热键是"每次交互都写"的载荷，而它低频）、**不进「导出全部数据」**（它是"这台机器的这副耳机"的校准结果——换设备本来就该重新校准，塞进数据包只会制造"导入了却对不上"的困惑）。键不存在 = 出厂「默认」（ms 0），**不落盘**；写失败**必须提示**（用户刚做的动作，同壁纸口径） |

**`beatsight.wallpaper` 的四个取值（v2.13.0 加入出厂默认图后，"没有壁纸"不再是唯一一种"空"）**：

| `img` | 含义 |
|---|---|
| 键**不存在** | **出厂默认图**（内联常量 `WALL_DEFAULT`，Pexels 可商用素材）。用户从没做过选择 → 也**不落盘**：不该让"什么都没做"变成一个几百 KB 的存档 |
| `"default"` | 默认图 + **用户自己调的遮罩**（落的是记号，不是那 186 KB 的副本） |
| `null` | 用户明确点过「移除」→ **默认图不复活**（同"示例曲删不掉的东西"口径：删过的默认不该自己回来） |
| `"data:image/…"` | 用户自己的图 |

- ★ **顺序敏感**：读档必须先认 `null`（那是**有效选择**），再认记号，最后才做格式校验。反过来先跑 `wallCheck`
  的话 `img:null` 会走进"格式不对"一路被当成脏值 → 默认图复活，用户的「移除」刷新后即失效。
- ★ **脏值回落"出厂默认图"**（v2.12.0 时回落"没有壁纸"）：读不懂的偏好应当落回**出厂状态**，
  而不是落回那个只有用户点过「移除」才该有的态。
- ★ **遮罩只认数值类型**且有限（`typeof o.dim === "number" && isFinite(o.dim)`），其余回默认。
  **别用 `isFinite(Number(x))` 一把收**：`Number(null) === 0`、`Number("") === 0`，
  一份脏存档会把壁纸读成"完全不压暗"（默认 55 变 0，画面突然刺眼）。写盘只写 Number，故收紧不误伤真实存档。
  （这条是 v2.13.0 的**新断言当场抓出的真 bug**。）

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

模块 `Ear`（排在 `Settings` 之后、`KeepAlive` 之前）。玩法：取一个易混组 → 自动播 2 小节 →
从 3 张**只给记谱不给名字**的候选里选 → 即时反馈 + 战绩。

- **候选不给名字**是刻意的，别"顺手加上"：「附点布鲁斯」这个名字直接把答案写在脸上，
  给了名字就变成「读名字猜」，练不到耳朵。作答后才揭示
- **出题质量在数据表里，不在代码里**：随机抽内置预设会出送分题与无解题，所以手写 `EAR_GROUPS`
  易混组（同组候选听觉上真的容易混）。组表完整性由 T49 断言——表写错是开发期错误，
  要在测试里立刻炸，而不是让用户遇到一道没有正确答案的题
- **候选顺序打乱、答案位置随机**：否则用户会学出「总选 A」的歪策略（T49b 用 300 次随机断言分布）
- **复用主引擎的试听通道**：`previewRef` 泛化（见 §3.1 的 `curPattern`），
  编辑器指向草稿、听辨指向本题答案。**绝不另起一套调度**——双时钟、双热键、双缓存三份麻烦
- **自动停靠「会话播放额度」**：共享状态 `playQuota` + `onQuotaDone`，v2.10.12 起走的就是
  `onLimitPulse` 钩子（见 §3.2）——练习量删除后它成了这套机制**唯一**的消费者。
  原先「额度分支优先于练习量」的口径（试听不是练习，不弹「已练满」）随之消失：
  T49g 现在钉的是「入口已迁顶栏 + `S.limit` 不留空壳」
- **「正在播放」从状态推导**（`S.playing || playQuota > 0`），不设独立标志位：
  标志位一旦有一条停播路径没走到，按钮就永远卡在「播放中…」且禁用
- **作答即停播**，并顺手作废额度（否则下一题会带着旧额度「放一半就停」）
- 战绩存冷键 `beatsight.ear`；`right` 用 `min(total, …)` 夹住，防脏数据算出 >100% 正确率
- 接入既有那套 overlay 纪律：`Modal.refreshInert()` 纳入 `earOverlay`；键盘处理器加 `Ear` 分支
  （overlay 打开时空格不误触播放、Escape 关闭）——`Controls → Ear` 已在 R3 白名单登记，理由同 `Controls → Settings`

### 3.9 练习统计（v1.11.0 → **v2.10.12 删除**）

> ★ 本节随「练习统计」功能一起删除（用户要求②）：顶栏按钮、`#statsOverlay`、`Stats` 模块
> （`summarize` / `agoText`）、以及它消费的练习记录 `beatsight.log`（用户选"甲"）。
> 保留下面的口径设计**只为存档**——将来若要重做统计，别把这段当现状实现。
>
> 删掉后的连带：`Store` 的 `logSessions / appendSession / clearLog / serializeLog` 四个出口、
> `CONFIG.logMinSec / logMax`、`Controls.stop` 里的自动入账、`sessStartT` 计时起点、
> 以及「导出全部数据」里的 `log` 段（旧数据包里的 `log` 字段现在被**静默忽略**）。
> 听辨战绩 `Store.earStats` **保留**（它有自己的消费者——听辨训练 overlay 里的正确率）。

（原口径：`weekSec` 本周、`streak` 连续自然日不归零、`maxBpm` 与 `byPattern` 全时段、
`practice` 本期窗口内、`untouched` 可用清单减本期练过并标 `ever`；**两组口径刻意不同**，
混掉的后果是切到"近 7 天"却把三个月前的纪录算进"本期练过"。窗口起点取首日那天的零点、
趋势取最近 5 场、"最后练习于"按自然日差而非毫秒差；日志按 name 聚合，预设改名会表现为"新节奏型"。）


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

`Controls` 是 UI 层中枢。**它曾经直接引用 7 个下游模块**（Presets / Editor / Settings / Ear / Arrange /
Help / KeepAlive），是整张依赖图里最大的扇出点。这既是中枢的合理形态，也是**未来扩展的主要风险面**：
每加一个新 overlay 就顺手在 `Controls` 的 keydown 里再补一段，`Controls` 会慢慢长成"什么都管"的
上帝对象，到那时谁想拆都拆不动。

> ★ **v2.18.0 后续（本节曾一度与代码不符，已修正）**：那 7 条里**有四条（Settings / Ear / Arrange / Help）
> 是同一套「某个叠加层开着就吞键、Escape 关掉它」的逐字重复**。它们已改由**共享状态区**的
> `KEY_LAYERS` 注册表承载 —— 各叠加层模块在**自己体内** `registerKeyLayer(overlayKeyLayer({ isOpen, close }))`
> 登记，`Controls` 只剩 `for (const layer of KEY_LAYERS){ if (layer.handles(e)) return; }` 一次
> （读共享状态，不再引用后方模块）。`Controls` 扇出因此 **7 → 2**（只剩 Presets + KeepAlive）。
> ★ 教训：**顶格时第一反应应当是"这几条引用是不是同一件事被抄了多遍"，而不是抬高常量。**
> 新增叠加层从此连 `Controls` 都不用碰——登记一行即可。

因此约定 —— **新功能的 UI 内聚在各自模块内部，`Controls` 只做事件转发**：

- 新 overlay / 面板默认落在**它自己的模块**里（`open` / `close` / 渲染函数都在模块内部），不要塞进 `Controls`
- `Controls` 只保留两件事：**事件转发**（把键盘/点击派发给当前打开的那个 overlay）与**共享状态读写**
- 键盘归属沿用既有模式（`Settings` / `Ear` / `Arrange` / `Help` 的 `isOpen()` / `close()`）：overlay 打开时键盘归它管。
  **v2.18.0 起由 `KEY_LAYERS` 注册表实现**（v2.18.0 前这一段是 `Controls` 对它们四个的直接引用，属**转发**而非新装配）
- ★ **v2.13.1：主界面空格 = 播放/暂停（全局规则）**。判据只看一件事——**是否正在输入文字**
  （文本类 input / textarea / contenteditable，`Controls` 里的 `isTextEntry` 反向白名单）。
  旧规则按焦点元素排除 INPUT / BUTTON / SELECT / TEXTAREA 与 role=button，挡不住
  **留焦点的控件**（滑杆、侧栏预设项——按钮们各自 `blur()` 自救，它们没有）→
  用户实报「点过其他功能后空格就哑了」。主界面各处 `itemKeys` 因此改为
  `{enterOnly:true}`：空格让位给播放、**Enter 仍激活本项**；按钮的原生空格激活也被
  `preventDefault` 让位。**面板内维持"空格不误触播放"**（各 overlay 的既有契约不变）。
  顺带收口 `e.repeat`（按住不连切）与修饰键（Ctrl/Cmd/Alt+Space 不抢）。回归：`t94`。
- overlay 的开合与监听器一律复用 `Modal` 的开合/登记原语（§3.10），不要各自再写一遍

护栏 —— `check-module-order.js` 的 **R4**：统计每个模块**直接引用的下游模块个数**，超过 `MAX_FANOUT`（=7）即告警。
常量**刻意留在 7** 不缩（v2.18.0 起 `Controls` 已降到 2，全场最高也只有 2）——它是"中枢又胖一圈"的可见化闸门，
不是"当前用量的记录"。于是"再给控件中枢加一条下游引用"若真顶到上限仍会**当场失败**，必须显式抬高常量并写明理由——
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

**v2.7.3：曲式范围循环（`S.arrangeSel.loop`）也补上"第二个入口 + 出口"**
（同 §3.12「一个区间 = 一个开关」的同一套做法）。jumpTo 把范围锁成单段并打开循环
（`from=to=k, loop=true`，即"反复磨这一段"）是默认，但此前**整条链路没有任何出口**：
`arrNextBar` 走到段尾遇 `loop` 为真就 `s = from` 回卷、永不返回 `null`，`onArrangeEnd`
于是永不触发，播放永远困在第 k 段（用户实拍）。修法是在跳段行补一个常驻
`.toggle-pill`「范围循环」，与编排面板的 `argLoopBtn` **共用 `S.arrangeSel.loop` 这一个字段**
（无第二份真相）——两处入口都过 `refreshBar`，`setToggle("argJumpLoopBtn", !!S.arrangeSel.loop)`
一处收口同源刷新。**关 = 解除锁定**：`loop` 置假；若范围已被跳段收成单段（`from===to`），
把 `to` 放开到曲末 → "从当前段一路播到曲末后自然停"（用户选定，而非原地再放一遍）。
范围本就是多段时只关循环、不动用户设的 `from/to`。回归：t77（T77a–e）。

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
配套的一条硬性守卫：**只要小节数会变，`editBar` 这类"当前小节"游标就必须在 `editorRender()` 开头收进范围**
（音符块库的 `d.bars[editBar].push(...)` 会越界抛错）。

**曲式段长怎么拿到型长**：`secBars(sec)` / `blockAt(sec, bar)` 是**纯函数**（T52 直测，不搭沙箱），
不能直接引用 `resolveRef`。做法是装配层注入 `setPatLenOf(ref => patBars(resolveRef(ref)))`。
**忘了注入现在会抛错，不再静默退回 4**（v2.8.6，审计 §A1 改的）：原先默认实现是 `() => DEF_BARS`，
那是个**恒 4 的静默谎言**——它与真实实现语义完全不同（真实实现按型实际小节数），忘了注入不会崩，
只会让段长悄悄退回「4 的倍数」。V8 覆盖率显示这条默认实现**从未被执行过**，即它在生产中恒被覆盖，
却没有任何检查器保证这一点。现在由两半合起来守：`tools/check-wiring.js` 静态管"装没装"，
默认实现本身管"没装就别想安静地拿到 4"。
★ 「老数据引用了不存在的型」**不是**默认值的职责（v2.6.1 之前的注释把两者混为一谈）：
那个场景永远走**注入的真实实现**——`resolveRef` 对不存在的 ref 返回 null，而 `patBars(null)` 返回 `DEF_BARS`。
——段长的正确性由 `t69` 的"3 小节 × 1 遍 = 3"钉住。

**渲染层要与拍号同时锁定型长**：`vizBars`（连同 `vizSig`）。行数、静音拍标识、播放头折行、
弹跳球行界必须用**同一个**模数，否则换型瞬间会"网格已按新型重建、播放头还按旧模数折行"。

**已知边界**：静音拍在 v2.5.1 时还是"型内最后一小节"（对 4 小节的型 = 一直以来的
"每 4 小节静音第 4 小节"，但对 1 小节的型会退化成"把自己整个静掉"）。
**v2.5.2 已改成按乐句位置线性计数**（见 §3.15）。

### 3.15 网格 = 「N 行窗口」（v2.5.2 第 Ⅱ 期立骨，v2.7.0 翻页档 + 预告行，v2.10.2 扩到预设模式，v2.10.3 预告行补 N ≥ 2 前提，改渲染层前必读）

**一句话**：网格的 N 行 = **正在弹的那 N 个连续小节位**，N = 同屏行数档位（`S.vizRows`，默认 4）。
曲式模式下窗口是**歌曲**的第 winStart…winStart+N-1 小节（行可来自不同的段、不同的型）；
预设模式下窗口是**当前型**的第 (winStart+i) % 型长 小节——**型短于 N 绕回重复铺满 N 行，
型长于 N 按 N 行翻页**（v2.10.2 用户拍板，见下）。
两种模式都**按 N 小节整页翻**（`winAnchor(k)=floor(k/N)*N`，不再逐小节跟着滚）。
预告行只有曲式模式有，**且要求 N ≥ 2**（见下）。

**v2.10.2：预设模式也窗口化（此前 2.8.0~2.10.1 只对曲式生效）**。改动前 `S.vizRows` 的
唯一消费点是 `arrWinBars()`、只被曲式窗口用；预设模式 `vizBars = patBars(activePattern())`
恒等于型长 → 档位按钮点下去画面零变化（用户实拍：「行数按钮在一些情形中无效」）。
两条语义：

| 关系 | 行为 | 例 |
|---|---|---|
| 型长 < N | 绕回重复铺满 N 行 | 1 小节的型 + 4 行档 → 同一小节铺 4 行 |
| 型长 = N | 恰好铺满一页（= 窗口化之前的样子，既有数据逐位不变） | 4 小节的型 + 4 行档 |
| 型长 > N | 按 N 行翻页，页锚随可听小节前进；走到曲尾绕回开头 | 4 小节的型 + 2 行档 → [1-2] / [3-4] 两页 |

★ **两模式共用同一份窗口状态**（`winStart` / `winPat`）——模式互斥，故不会打架；
所有曲式专属分支都带 `S.playMode === "arrange"` 守卫。
★ 预设模式的窗口起点是**型内小节号**，恒为 N 的整数倍；曲式的是**歌曲小节号**。

**★ `vizBars` 已拆成两个数（v2.10.2）**——它此前身兼二职（曲式下是窗口长度、预设下是型长），
窗口化后这两个数不再相等，必须分清：

| 变量 | 含义 | 来源 |
|---|---|---|
| `vizBars` | **显示行数** = 窗口长度 | `patBars(vizPattern())` = `arrWinBars()` |
| `vizPatLen` | **内容模数** = 型的小节数 | `patBars(activePattern())` |

读错的症状很隐蔽：拿行数当模数去算"型内第几小节"，1 小节的型 + 4 行档就会算出不存在的小节号。
**行号 ⇄ 型内小节号的对译助手**（都在 Viz 内部，热路径 O(1)）：
`patBarOfRow` / `rowOfPatBar`（端点 → 行，不在窗口返回 -1）/ `nextPatBarOf` / `nextRowOf`。
两处最容易踩的语义边界：
- `S.loopRange` 是**型内小节号**口径。`loopNextBar(b, n)` 的 `n` 必须是**型长**，
  调用前先把行号折成型内小节号；返回值还要再折回**翻页后**的行号（`cand % N`）。
  旧代码传 `vizBars` 之所以对，只是因为那时它与型长恰好相等。
- **时钟回落**（`audioPosAt` 返回 null 时）按 `vizPatLen` 折再换算成行；曲式那条仍按 `vizBars` 折。

**v2.7.0 预告行（页内第 4 小节 → 第 1 行换成下一小节内容，用户拍板的方案）**：
扫弦练习到页末需要提前看到下一小节的型（翻页后就位太晚）。做法：`previewBarFor(k)`
只在 `k = 页内最后一行` 时解析**节目单**的下一小节（走 `arrNextBar`，与发声同源——
范围末尾不循环则没有预告、范围循环则预告 = 范围起点，绝不按歌曲 k+1 瞎猜）；
`buildViz` 时把 `winPat.bars[0]` 换成预告内容、第 1 行挂 `.preview-row`（降透明）
+ `.preview-badge` 徽标「下一小节 · 型名」。四条铁律：
① **前提 N ≥ 2**（v2.10.3 补）——见下；
② 预告行是**未来**——`setCell` 对它豁免"已弹"态（格子恒 upcoming）；
③ `paintFrameBody` 重建条件除盯 `winAnchor(k)` 外再盯 `previewBarFor(k).bar`
   （进页末预告生效 / 翻页预告随窗口换，两处各重建一次）；
④ 待命球跨页接力：`paintBall` 里 `rowNext` 在"页末 + 有预告"时取 **0**（预告行）
   而不是 `bar+1` 钳制——待命球落预告行首音上，翻页瞬间内容原地转正、主球同点接管。
状态三件套 `winPrevBar/winPrevSteps/winPrevName` 同生同灭（窗口同步一处写入、
`resetWindow` 一处清）。回归：t70（翻页口径）/ t75（预告行五场景）/ t53k（页末待命球）。

**★ v2.10.3：预告行的前提是 N ≥ 2**（用户实拍「1 行档下曲式模式格子永不填白」）。
预告行的机制是"把**整屏最陈旧的第 1 行**让给屏外的下一小节"——它要求屏内还有别的行在
正常显示当前页。**N = 1 时这个前提不成立**：`winAnchor(k) = floor(k/1)*1 = k`，"每 N 小节
翻页"退化成"跟播放头滚动"，窗口恒等于当前小节，**下一小节本来就不在屏外**。而页末判据
`k === winAnchor(k) + N - 1` 在 N=1 时**恒成立**（`k === k + 1 - 1`），于是唯一那一行每帧
都被当成"未来"，三条后果连锁发生：
1. `winPat.bars[0] = winPrevSteps` → 行内容 = 下一小节（球走的却是当前小节）；
2. 整行挂 `.preview-row`（`opacity:.55`）；
3. 铁律 ② 的 `isPreview` 豁免让所有格子**恒为 `upcoming`**，永远拿不到 `.active` / `.played`
   —— 而白色填充的底色**只长在** `.cell.played .fill` / `.cell.active .fill` 上
   （`.cell .fill` 本身是 `background:transparent`），于是帧内每帧写入的 `scaleX(进度)`
   全部不可见。**典型症状 = 球正常滚动、格子不填白**（`paintBall` 走 `onsetBuf`/`onsetNext`
   自己的端点表，与"格子 class + CSS"这条链完全独立 → 只有半边坏）。
修法：`previewBarFor` 开头一行守卫 `if (arrWinBars() < 2) return { bar: -1 };`。
1 行档下预告**没有任何信息量**（"下一小节"就在下一小节），关掉即可；窗口照常按每小节
翻页、格子回到正常态。★ 只关 N=1，**N ≥ 2 逐位不变**。
回归：`t79` 场景 **T79h**（曲式 + 1 行档，12 条断言；含一个 N=2 的**对照组**，防止
守卫写宽成 `< 3` 把预告机制一起吃掉——T75 全程用默认 4 行档，拦不住这种过宽）。
**测试空白值得记一笔**：`t79` 此前只在**预设**模式测 1 行档（T79d），曲式侧只到 2 行档
（T79e/f），"1 行档 × 曲式"这条组合从来没人走过 —— 这就是本 bug 穿过 2506 条断言的通道。
**教训**：翻页/窗口类判据在 N=1 处几乎总会退化（`floor(k/1)*1 = k`），凡是靠"页内还有别的行"
成立的机制，都要显式钉住 N 的下界。

**做法（决定了为什么下游几乎不用改）**：把窗口里的 4 个小节**合成为一个临时型**
（`arrWindowPat`），于是每一行仍然是"某个型的第 bar 小节"，格子/填充/闪烁/弹跳球
全都照旧工作。成本压在窗口合成这一个纯函数里，而不是让渲染层到处支持"混合型"。

| 关键件 | 职责 |
|---|---|
| `songBars / songBarBefore / songBarAt`（共享区） | 把 (段, 段内小节) 摊平成**歌曲线性小节号**；与 `secBars/blockAt` 同族、同样只通过注入的 `patLenOf` 问型长 |
| `winStart` / `winPat` | 窗口起点与合成型（buildViz 时算好缓存，热路径 O(1)）；`resetWindow` 只丢曲式那个（见下） |
| `arrWindowPat` / `presetWindowPat` | 两种模式的合成型构造（曲式：每行取自不同的型；预设：每行取自同一型的不同小节） |
| `winAnchor(k)` | **手感档位就这一行**：= `floor(k/N)*N`（每 N 小节翻页，N = 档位，默认 4）；`k` = 跟播放头滚动（v2.5.2 旧档，已下线） |
| `audibleSongBar` / `audiblePatBar` | 两种模式各自的"现在**听到**的是第几小节"——都用 onset 表里已落地的那一条，绝不用早一个前瞻窗口的调度游标 |
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

**v2.7.1：歌词轨 / 跳段行计数器 / 播放位置读数也改走可听域**（`Viz.audibleArrangePos()` =
`audibleSongBar` + `songBarAt`）。此前 `paintLyric` 把调度游标 `arrSec/arrBar`（早一个前瞻
窗口）与可听域的小节内 tick 拼在一起——每逢小节/段边界前那一小段，段内位置被拼错将近
一小节，歌词与「第 N 段 · 第 M 小节」先跳、声音后到（用户实拍，与本节"重建由渲染侧驱动"
同一类问题的漏网处）。触发侧新增可听域钩子 `onAudibleBar`（`paintFrameBody` 每帧检测可听
小节变化才调，与调度域的 `onArrangeBar` 并存；`refreshNow` 双触发、内部只读可听域）。
停机预览（未起播显示第 0 段）行为不变。回归：t76c/t76d。

**静音拍改成按乐句位置**（`schedPlayBar % MUTE_PERIOD === 3`）：旧判据 `schedBar === 型长-1`
对 1 小节的型会把每个小节都判成最后一小节 → 一开静音拍整段静音。4 小节的型下两者逐位等价。
`MUTE_PERIOD` 与 `schedPlayBar` 在共享区（调度器与渲染层共用同一份语义）。

**刻意不做的（写清以免误当 bug）**：
- **歌词轨的内容域仍是"当前段"**：段号取可听域（v2.7.1 起；此前按 `arrSec`
  调度游标，边界前会提前整轨跳段），不跟着窗口跨段。但**布局**自 v2.7.2 起改为
  按小节分行——4 条 `.lyric-row` 与网格窗口 `W..W+4` 逐行对齐，字块按「小节内
  tick / 小节长」行内铺开，跨小节延音在边界截断、下一行续显；首行播放中显示
  `winPrevBar` 作半透明回看。行走带线只出现在可听域当前行（按行号 `kk - W`
  匹配，不用小节号——窗口环绕时同一小节号可出现两次）。
- **预设模式不做「页末预告行」**（v2.10.2 刻意不搬曲式那一套）：预设窗口的内容全部来自
  同一个型，`nextRowOf()` 算术即可得出"下一行是谁"；待命球的落点本来就取自
  `activePattern().bars[下一小节]`，位置在翻页前就是对的。搬过来只会把 `setCell` 的
  `isPreview`、`buildViz` 的第 1 行替换、`previewBarFor` 全部染上模式分支——收益不抵风险。
- **档位 ≠ 4（`MUTE_PERIOD`）时不静态标"哪一行会被静音"**（一页只覆盖乐句的一段，
  落点随翻页轮转），到点那一刻由状态栏说明。档位 = 4 时**能标且标得准**，与型长无关
  ——窗口锚恒为 N 的整数倍，故「行号 == 乐句相位」，且第 3 行的内容恰好就是会被静音的
  那一小节（v2.10.1 及以前拿 `vizBars` 当型长判据，1 小节的型标不出来）。

- **「下一行」的两种口径（v2.10.8，改渲染层前必读）**：`.next` 预告格与待命球共用 `nextRowOf`，
  而曲式模式下它**必须由节目单算**（`arrNextRowOf` → `arrangeNextRow().lin` → `rowOfSongBar`），
  **不能按"位置式 +1"**：播放范围可以短于窗口（滑块只选 1 小节，而屏内是 4 行档），此时范围末小节的
  "下一小节"是**范围起点**（`arrNextBar` 的循环回卷），它落在窗口的哪一行完全可能是当前行或更前面——
  按 `bar+1` 画会把球摆到**范围外那一行**上（用户实拍：球在当前小节快结束时提前在"下一小节的位置"
  显示预备动画，而那个小节这一轮永远不会播）。**只有 `W > L` 才暴露**（`W = S.vizRows`、
  `L = to − from + 1`）：`W ≤ L` 时范围末小节恰落在窗口末行，走"预告行让给第 1 行"那条既有分支，
  看着是对的——所以 L=4 永远出不了错（W 最大 4），用户也正是只报了 1/2/3。
  ★ `rowOfSongBar` **必须按 `songBars` 取模**：`arrWindowPat` 在曲尾 / 全曲短于窗口时会绕回重复铺行
  （`songBarAt(a, (winStart + i) % total)`），于是"行号 = 小节号 − 窗口起点"在那些页并不成立。
  写成 `lin % W`（第一版）在最后一页会错——实测「整首 + 4 行档」会被算成第 1 行而不是第 4 行。
  ★ 返回 −1 的两档（需向前翻页 / 需向后跨页）**一律回落** v2.7.0 那套位置式口径，故向前翻页仍落
  第 1 行、逐位不变；**向后跨页仍走位置式，是已知边界**（向后翻页没有预告行那套机制，
  硬落行反而会压在"当前页另一个小节"的内容上，比位置式更难看）——要动它先回答"向后翻页怎么呈现"。
  回归：`tests/cases/t89-narrow-range-next-row.js`（T89a–T89f）+ 看门狗 `narrow_range_short_song`。

★ **v2.15.0：这套「N 行窗口」的"行"不再恒等于整小节**——窄屏时按内容密度自适应拆成
「片段」（一行 = 一小节 ÷ 每小节片数；切点落整拍），本节所有机制（翻页 / 预告 / 映射 /
待命球 / 歌词轨）的单位随之细化为片段，**整小节档下逐位不变**。细节见 §3.19。

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
- **`applyDemoSeg()` 随「切换节奏型」胶囊条一起删除（v2.10.4）**：它只换第 1 块的型、其余块原样保留，
  语义是"这一段用哪个型"而不是"把这一段重编"——**这条语义约束本身仍然有效**：
  将来若在别处重开"换本段用哪个型"的入口，必须照此只动第 1 块。
  删除理由见 §3.17（候选与「扫弦」区重复 + 与新范围滑块语义相冲）。
- **不要重新引入 4 小节的"组合型"**（旧版的「收束/收尾」就是这么来的）：
  一个段里放两块就表达了"相邻小节各用不同的型"，这才是该用模型的地方。

### 3.17 侧栏「播放范围」双滑块（v2.10.4；**v2.10.7 起按小节调节**，改侧栏范围 UI 前必读）

**v2.10.7 变更**：滑块从「按段」改为「按小节」——取值域 `max` 由段数改为总小节数（`songBars`），
内部 `S.arrangeSel.from/to` 同步改为 0-based **线性小节号**（可落在段中间）；重合 = **单小节循环**；
旧持久化数据（无 `v` 标记的段下标口径）在加载期经 `migrateSecRangeToBars` 一次性换算并立即落盘
（`arrangeSel.v:2` 区分新旧口径），本节契约的小节说法均已更新。

**它取代了什么**：v2.5.0 的「段序条」（N 颗段号胶囊，`buildDemoSongRow` 里生成）与 v2.4.1 的
「切换节奏型」胶囊条（`buildDemoSegRow`，已删除）。

**为什么换（能力，不是样式）**：`Arrange.jumpTo` 把 `S.arrangeSel.from` 与 `.to` **写死成同一个值**，
所以 N 颗胶囊只能表达 **N 种状态**（"只循环某一段"）；而 `S.arrangeSel` 本就支持任意区间
（10 段 = **N(N+1)/2 = 55 种**）。滑块用 1 个控件解锁全部区间，**且不随段数增长**
（`CONFIG.arrMaxSections = 24` 时同样只占一行）。"只循环这一段"也没丢——用滑块框住该段的
起止小节即可；v2.10.4 时代的"拖到重合 = 单段"如今是"拖到重合 = 单小节循环"。

**契约（六条）**：

| # | 契约 | 说明 |
|---|---|---|
| 1 | 取值域 **1-based 小节号** | `min=1` / `max=总小节数`（`songBars(a)`）。内部 `from`/`to` 是 0-based **线性小节号**（v2.10.7，可落在段中间），换算只在 `onRangeInput` 与 `syncDemoRange` 两处。**别把 1-based 值直接写进 S** |
| 2 | 双向钳制 | 起点越过终点时把终点一起顶走，反之亦然 → 任何时刻 `from <= to`（空区间会让调度器永远到不了 `to`，见 `Store.clampLoop` 注释） |
| 3 | **`input` / `change` 两级** | `input`（拖动中，每秒几十次）只改 S + 视觉 + 走 250ms 热键防抖；`change`（松手/键盘提交）才调 `onDemoRange`。**合成一级 = 一次拖动跑几十轮 `applyPatternChange`**，会吃掉音频排程窗口（同 `CONFIG.schedWindow` 的教训） |
| 4 | 滑块 = **范围**，不是位置 | 播放期间两个 thumb 必须纹丝不动。"现在播到第几小节"由 `.demo-play-note` 承担（`demoCurBar()` → 可听位置，v2.10.7 起小节口径），**别把那行说明删掉** |
| 5 | 重合时的 z-index 翻转 | `from === to` 时上层 input 会挡住下层 thumb；重合在**最左**时让终点在上，其余让起点在上。不做这一步，重合态总有一侧拖不动（而它是最常用的一档） |
| 6 | 注入而非直调 | `Presets` 声明在 `Arrange` 之前 → 反向调用要登记 R3 白名单。故走共享区钩子 `onDemoRange` = `Arrange.setRange`，装配层接线（与 `onDemoBar` / `onArrangeBar` 同套） |

**实现取舍（为什么是两个原生 range 叠层，而不是自绘）**：
① 原生滑块自带键盘与读屏语义，自绘要手工补 `role=slider` + `aria-valuenow/valuetext` + 方向键，
   且**双 thumb 的读屏区分**最麻烦；② 直接复用既有 `input[type=range]` 样式（观测台主题、
   `focus-visible` 环、移动端 22px thumb 自动生效），与音量 / BPM 三条滑杆视觉同源；
③ 测试桩**没有 `getBoundingClientRect`**，自绘拖拽在桩里驱动不了，而原生滑块就是
   `.value` + `fire("input")`。★ 但选择器**必须**带 `.demo-range-input` 提高特异性——
   全局 `input[type=range]` 与 `body[data-theme="obs"] input[type=range]`（0,2,2）都会命中这两个
   input，少了这一级 `height` 会被压回 4px。

**踩过的坑（`setRange` 的静默早退）**：取曲式不能只用 `arrangeCur() || cur()` ——
`arrangeCur()` 在 `playMode !== "arrange"` 时恒为 `null`（而拖滑块最常在**还没进曲式模式**时发生），
`cur()` 又依赖编排 overlay 开过（它读编辑选中项 `curId`）。两个都为 `null` 时函数**静默早退**：
模式没切、`loop` 没开、主界面没反馈、网格没换型，而滑块看起来"能拖、值也变了"。
故补了两级兜底 `Store.findArrange(S.arrangeSel.id) || Store.arranges[0]`
（`onRangeInput` 已先把渲染中那条曲式的 id 写进 `S.arrangeSel.id`）。
回归：`tests/cases/t88-demo-range-slider.js`（11 场景 / 71 条断言）+ 看门狗 `arrange_range_dirty`。

**三处「播放范围」入口共用一份 `S.arrangeSel`**（改任何一处都要想清另两处）：

| 入口 | 位置 | 能力 |
|---|---|---|
| 主界面跳段行 `#argJump` | 时值可视化正下方 | 只能单段（`jumpTo`，含「范围循环」出口开关） |
| 编排 overlay 的段行「起 / 终」 | 弹层内 | 任意区间（`#argRangeRow` 只读显示 + 「全部」） |
| **侧栏范围滑块** | 预设库「自定义」区 | 任意区间（`setRange`） |

**★ 范围可以短于窗口（v2.10.8）**：滑块允许只选 1 小节，而同屏行数档位是 1–4 行 ——
于是 `L = to − from + 1 < W = S.vizRows` 是常态。这时"下一小节"是**范围起点**（循环回卷，
见 `arrNextBar`），待命球与 `.next` 预告格的落点**必须由节目单算**（`arrNextRowOf`），
不能按"位置式 +1"——那会把球摆到"范围外那一行"上（用户实拍）。判据与两处易错点见 §3.15 那条
bullet，回归见 `t89`。

**★ 窗口内容不收敛到范围（v2.10.8 的既定取舍）**：`L < W` 时窗口其余各行照旧显示**相邻的小节**
（那些小节这一轮永远不会播）——好处是保留"接下来回到哪 / 周围是什么"的上下文，代价是那几行
看着像会播、其实不会。**要不要让窗口内容也跟着范围走**（像预设模式"型短于 N 行就绕回重复铺满"
那样）是另一个待定的体验问题，本轮**刻意不动**（不与 bug 修复混批）；真要动，得连着改
`arrWindowPat` 与歌词轨 / 行首和弦名 / 预告行那一串（`T89f` 已把"跨页回卷仍走位置式"这条
已知边界钉住，动窗口时它会先变红）。

### 3.18 音频延迟补偿（v2.14.0，改发声时机前必读）

**一句话**：蓝牙耳机 / 无线音箱的输出链路有 100–300ms 延迟——声音比画面晚到。补偿把
**发声时刻统一提前** `latencyMs` 毫秒（0–500，设置里调），让耳机里听到的那一刻回到时间轴上。

**只动发声，不动时间轴**：
- 收口在 AudioEngine 的两个出口：`playClick`（节拍 / 扫弦 / 预备拍 / 试听）与
  `lyricCueHit`（歌词锚点音）。**新增任何发声路径都要走这两个口**，否则它不参与补偿。
- `onset` 表、`loopStart` / `nextNoteTime`、播放头与弹跳球一律不碰（T95b 有专门断言）。
- **排程前瞻量** = `schedWindow + 补偿`（`look`）：不加长的话，靠近窗口边缘的音会被排到
  "过去的时刻"而被 Web Audio 立即播放——offset 大于窗口时听感是"越补越晚"。
  重锚 / 饥饿判定仍按 `win` 口径，别混。
- **首声限制**：起播那一刻的第一颗音排不到"过去"，它仍会晚一点；第二声起完全生效——
  物理限制，不是遗漏（除非把起播整体延后 offset，代价更大，未采用）。
- **v2.42.1 起无自动校准**：跟拍校准向导整包退役（`calibPlay` / `calibRaw` / `latSuggest`
  随删，发声路径恒吃补偿）。手动校准 = 滑杆 + 文案里的参考起步值（真无线耳机约 200ms /
  蓝牙耳机·音箱约 150ms / 有线·外放 0），再 ±20ms 微调到声画重合。

**数据与 UI**：独立键 `beatsight.latency`（见 §3.6 表）；设置新分组实现在**装配层**的
"音频延迟补偿"一段（**不是新模块**——对照壁纸 / 诊断面板两条先例：只接线 + 读写自己的键 +
把生效值写进共享状态 `latencyMs`，不向外提供跨模块接口）。测试句柄见 `__beat` 的
`latRead / latWrite / latencyMs() / latState()`。

**回归**：`tests/cases/t95-latency-compensation.js`（4 场景；v2.42.1 起原 T95d/e/f 与
校准守卫四个场景随向导删除）；反向验证三轮定向变异
（抽掉补偿 4 红 / 退回前瞻量 1 红 / 放宽钳制 5 红）。★ **真机验收项**：手动校准的手感与
补偿后的视听觉对齐，冒烟脚本看不出来。

### 3.19 窄屏自适应分片（v2.15.0，改渲染层前必读）

**一句话**：行的粒度不再恒为「一小节」——按**行宽 × 内容密度**自适应拆成`每行几拍`
（`vizRowBeats`）：4/4 可 4/2/1 拍，切点只落整拍；一行 = 一小节的**一片**（segment）。

- **判据（`chooseRowBeats`）**：候选 = 拍数的**约数**（降序，保证"切点落整拍"）；
  取第一个使「最短格宽度 ≥ `SLICE_MIN_CELL`(24px)」的档；都不达标兜底 1 拍/行。
  宽度取 `#viz` 的 offsetWidth（量测只在 buildViz / relayout）；密度取**正在播放的型**的
  最短时值（`minStepOf`）。所以同样的屏宽，四分型不拆、十六分型才拆。
- **单位升级：小节 → 片段**（改这块最容易错的地方）：窗口锚点（`winAnchorSeg`）、
  端点 → 行（`onsetPos` 一次算出 `{seg, tick}`——`tick` 是**片内** tick，弹跳球 / 播放头 /
  闪烁全部用它）、`rowOfPatSeg / patSegOfRow / patBarOfRow`、`rowOfSongPos`、
  `nextPatSeg`（含"同小节下一片"的走法）、预告行（`previewSegFor` = 同小节下一片或
  节目单下一小节首片）、歌词轨（`lyricRows[i].barTicks` = 片跨度）、座次尺（只报本行覆盖的拍、
  标签折回小节全局）、状态栏（仍报"第几小节 · 第几拍"的小节口径）。
- **跨行长音 = 续接片段**：`sliceSteps` 把一小节的 steps 切出第 sub 片、**重基到片起点**；
  跨片的音符两侧各成一段并带 `_cutl/_cutr`（渲染成 `.cutl/.cutr`：虚线描边 + 圆角收平），
  截断片段**不打时值标签**（截断后的 t 不是真实时值）。★ 建树（buildRowCells）/ 逐帧重绘
  （setCell）/ 停机复位（resetForStop）**三处都要带上该标记**——漏一处，播放第一帧或停机后
  虚线边就没了（v2.15.0 实测踩过）。
- **★★ K=1 是安全边界**：每行 = 整小节时全链**逐位等于**分片之前——`sliceSteps` 原样返回
  原型数组（对象身份都保持）、片段号与行号/小节号逐位重合、所有映射退化回旧式。
  任何改动都必须守住它（t79 / t87 / t89 等既有契约原样全绿就是这条边界的证明）。
- **已知边界（刻意为之，不是遗漏）**：① 档位是派生值、不持久化——旋屏当帧不重建
  （resize 播放中"只重采几何"是既有承诺），最迟下次翻页 / 换型生效；② 分片档下不做静态
  "静音行"标识（一页只覆盖乐句一段），到点由状态栏说明；③ 奇数拍（5/4、7/4）没有"半小节"
  档（1/2 不落整拍），直接退到每行 1 拍；④ K>1 时**预设模式**也不静态标静音行
  （`vizBars === MUTE_PERIOD × 每小节片数` 恒不成立）。
- **回归**：`tests/cases/t96-adaptive-slice.js`（5 场景）+ `t47b` 按新行为重排
  （"窄行宽 ≠ 窄格子"——要造 <14px 的格子得用 96px 行宽）。反向验证三轮变异：
  永不切分 35 红 / 关标签压制 2 红 / 退回片内折算 1 红。

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

### 4.2 布局：左边缘只有一条（v2.10.11 立，改任何控件的横向位置前必读）

页面的横向对齐**只有一条线**：卡片内容边缘（桌面 `.card` padding 24px、≤960px 16px）。
`.col` 里的**裸块**（不是卡片的直接子元素）默认落在 `.main` 的 padding 上（桌面 24 / 窄屏 16），
比卡片内容**偏 24px / 16px**——v2.10.11 之前 `.pattern-head`、训练模式 `.group`、底部 `.hint`
三块都偏在那一侧。现在 `.pattern-head` 已补 `padding:0 24px`（窄屏 `0 16px`）与卡片对齐；
**另外两块仍然是偏的**（见 CHANGELOG v2.10.11 的「未做」，要补就一起补，否则页面还是两条线）。

- **判定不许靠眼睛，要量**：CDP 取 `getBoundingClientRect`——量**文字**必须用 `Range`
  取第一段文本节点的矩形（直接量元素盒子会把按钮自身的 padding 算进去，看不出"文案"从哪开始）。
  截图也能量：逐行带找「明显亮于卡片底色」的最左像素列（深色 pill 的底不会命中，正好只量到文字）。
- **按钮行的固有陷阱**：`.toggle-pill` / `.pill` 自带横向内边距，于是**文字**比**盒子**右移 16 / 14px。
  因为 `.toggle-pill` 的底色 `var(--card)` 与卡片底色**完全相同**（看不见"底"），那 16px 会被读成
  "缩进"——v2.10.11 的需求③ 就是这么来的。修法是给 `.viz-toggles` 内的开关 `padding-left:0`
  （**只在这一行**；动全局 `.toggle-pill` 是全站开关的观感变更）。pill 那排**不要动**：
  它的**盒子**本来就在内容边缘上，去贴文字会把盒子拉进卡片内边距（只剩 2px 余量），更难看。
- **不变量由 `tools/smoke.js` 的 `layoutProbe()` 在真浏览器里守着**（桌面 + 390px 各跑一遍）：
  开关文字 / 组标签 / pill 盒子 / 说明行 / 当前节奏型名称，五者必须与卡片标题文字**同一条左边缘**
  （容差 0.5px），外加"拍号在行数右侧""音色 → 音量 → 编辑节奏型"两条相对位置。
  ★ 桩测不到这一层（不解析 HTML、也没有真实布局）——往 `.col` 里加裸块、或给某行加内边距，
  只有冒烟会拦。

## 5. 自验流程（改完代码必须做）

```bash
# 0) 一条命令跑完全部检查（v1.3.2 起；本地自检的唯一入口，仓库内 CI 跑的也是同一条 `npm run ci`）
node tools/check-all.js          # 顺序：语法 → 架构约束 → 装配完整性 → 零依赖 lint → 版本一致性 → 文档一致性
                                 #       → _headers 结构 → DOM 节点账本 → 测试桩能力对账 → ESLint(可选) → 类型检查(可选) → DOM 引用
                                 #       → 浏览器冒烟(环境可选) → 全量测试 → 看门狗 → 覆盖率（共 16 步）
                                 # 先便宜后贵，前面失败就停（后面的检查建立在前面是对的之上）
                                 # 耗时看末尾汇总——不在文档里抄数字，tools/check-docs.js 会拦
node tools/check-all.js --quick  # 跳过 T21 全量组合扫描，改代码时用

# npm 别名（v2.8.3）：`npm run verify` = 上面那一行；`npm run verify:quick` = 带 --quick
#   `npm run ci` = `npm ci` + `node tools/check-all.js --strict-env` + `npm run build`（构建侧唯一入口）
#   ★ Cloudflare Dashboard 的 Build command 就填 `npm run ci`——命令内容留在仓库，Dashboard 只留一行指针

# 需要单独跑某一项时（排查用）
node tests/run.js                # 主套件：抽样 T21
FULL_SCAN=1 node tests/run.js    # 全量 T21
node tools/smoke.js              # 真实浏览器冒烟（CDP）：file:// 与 http://127.0.0.1 双通道
                                 # 断言真实 DOM/CSS/帧率/Service Worker/控制台零报错；本机没浏览器则退出码 3（跳过）
                                 # 跨平台，取代了已删除的 tests/screenshot.sh（那个只在 macOS 上能用，且只截图不断言）
node tests/hang-guard.js         # 死循环看门狗：每用例独立子进程 + 8s 超时强杀
                                 # 反向验证：BEATSIGHT_HTML=<旧版 index.html> node tests/hang-guard.js 3000
node tools/check-module-order.js # 架构约束：R1/R2 零例外，R3 白名单登记
node tools/check-wiring.js       # 装配完整性：钩子注入槽（`let onXxx = null;` 约定）与 patLenOf 是否被接上
                                 # 守住"漏赋值 = 功能静默失效"这类**逃过全部既有闸门**的故障
                                 # 名单自动收列（以 `on` + 大写字母开头即纳入），新增钩子无需改本工具
                                 # 反向验证：删掉装配段任一 `onXxx = …` 应报「从未被赋过非 null 值」并退出 1
node tools/check-headers.js      # _headers 结构：`/*` 全路径 glob 恰好一行 · 6 个安全头齐全且缩进
                                 # 为什么单独成闸：_headers 是本仓库唯一"写错了不报错、只会静默失效"的配置
                                 #   （Cloudflare 对畸形行不告警），所以"删掉 `/*` → 6 条头全失效"必须机器判
                                 # 与 _headers 里那段作用域声明配套——那边写清"为什么不能动"，这边守住"动没动坏"
                                 # 反向验证：删掉 `/*` 行 / 再插一行 `/*` / 删掉任一条头 / 把某条头改成顶格
                                 #   → 四种都会报出具体原因并退出 1（v2.8.7 全部实测过）
node tools/check-lint.js         # 代码卫生：no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef
                                 # 反向验证：node tools/check-lint.js <注入拼错变量的 index.html> 应报错退出 1
node tools/check-version.js      # 版本一致性：VERSION / CHANGELOG 首条 / 代码里的版本字面量 / package.json / package-lock.json
                                 #   五者互相对齐（第 5 份是 v2.8.3 补的——此前文件头声明查它、代码却没读，
                                 #   锁文件已悄悄漂了 3 个版本而闸门全绿；见 CHANGELOG v2.8.3）
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

# 2)+3) 真实浏览器冒烟 + 控制台报错检查（v2.0.6 起跨平台；原 macOS 专用的 tests/screenshot.sh 已删除）
node tools/smoke.js              # file:// 与 http://127.0.0.1 双通道；CDP 取页面内实测值
node tools/smoke.js --file-only  # 只跑 file://（无本地服务时用）
BEATSIGHT_CHROME=<路径> node tools/smoke.js   # 浏览器不在默认位置时指定
```

**可选闸门的"跳过"必须是 ⊘、不能是 ✓**（v1.9.1 修的一个假绿）：`check-all.js` 只认退出码，
而这两步按设计就是缺依赖时 `exit 0`——于是"没装依赖所以没查"与"查了且通过"在汇总里长得一模一样。
现在 `STEPS` 里给可选步骤声明 `optional: "<依赖路径>"`，`check-all.js` 自己检查依赖、
缺了就直接标 ⊘ 且**不调用**；汇总多打印一行「实跑 N/M 项」。
**别把它改回只看退出码**——那等于让汇总里的 ✓ 撒谎，而它能撒谎的话，其余 ✓ 就都不值得信了。

★★ **推 main 前必须把两条加强闸门"真跑"一遍（v2.15.1 的教训）**：本机若没装 `node_modules`，
ESLint / tsc 会被标 ⊘ **跳过**——而 ⊘ 是"没查"、不是"查了通过"；构建环境 `npm ci` 装齐依赖后
它们真跑，护栏就是在那儿红的：v2.15.0 推上去被 CI 抓到 `no-shadow`（局部 `schedBar` 遮蔽模块级
同名游标），而同一改动里还藏着一条 tsc 的 TS18047（`atCur` 可空收窄）——**因为 CI 在 ESLint
那一步就停了，tsc 这颗直到补装依赖后本地手工补跑才现形**。做法：
`npm install --ignore-scripts`（`--ignore-scripts` 绕过 wrangler 安装脚本在本机沙箱的
`spawnSync EBUSY`）→ `node tools/check-all.js`（ESLint 会真跑）→ tsc 若仍是 ⚠（沙箱把
"工具没起来"报成工具故障），用 shell 直拉 `tsc -p` 的手工通道补跑并如实标注。**别让 CI 当你的
第一道闸门**——它停在第一步时，后面的闸门不会替你跑。

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

**为什么以本地 check-all 为主、仓库内 CI 为补位**（v2.8.17 订正：旧标题「为什么不用 GitHub Actions」已过时）：机器检查的主入口是本地 `tools/check-all.js` 一条命令跑完，少一套要维护的流水线配置，检查内容一条不少；**v2.8.8 起仓库内另有 CI**（`.github/workflows/ci.yml`：推 main / PR 时跑 `npm run ci`，并另开一个 job 跑真实浏览器冒烟 `node tools/smoke.js`）——它覆盖所有分支与 PR，是本地这一遍的**补位**而非替代；v2.8.3 起把这串收成一个稳定指针 `npm run ci`（`package.json` 里 = `npm ci` + `node tools/check-all.js --strict-env` + `npm run build`）。而它在两条发布渠道上的强制力不同：**Cloudflare Dashboard 的 Build command 填 `npm run ci` 时**，部署路径上就有硬闸门（不通过即不部署）——注意这串命令只存在于 **Dashboard**，仓库改不了它，换 clone / 换账号都得各自填一次；**WorkBuddy 那条纯手动，没人拦你**。所以"改完先跑它再看效果"依然是习惯要求——只是漏跑时 Cloudflare 会替你拦住（前提是 Dashboard 那串确实填对了），WorkBuddy 不会。

**发版规则（v1.6.4 起）：每次发版都 bump `index.html` 的 `const VERSION`**，功能版与工程版一视同仁（改这一行即可，`<title>` 与品牌区徽章**两处**显示由它派生——v2.10.9 起 chip 只报保存状态、不再重复版本号，详见「数据」区 `VERSION` 的注释）。此前 v1.6.1~v1.6.4 连发四版都没动它，线上徽章长期停在 `v1.6.0`——代码明明都上了线，看号的人却只能得出"部署没生效"的结论。版本号是用户唯一能看到的"这批代码是哪一版"的凭据，工程版跳过 bump 等于让这个凭据说谎。

**必须在真实浏览器里人工做一次的事（无法自动化，别跳过）**：

- ~~**后台 30 秒不断音**（v1.3 自适应窗口的验收，审计 P1-3）~~ **已验收（2026-09-15，桌面 Chrome，用户确认无断音）**。该验收项至此关闭；仅当未来改动 scheduler 的窗口/锚定逻辑时才需要重做。
- **后台切回后「点下即生效」的延迟**：后台期间切节奏型，最多延迟一个窗口（1.2s）才生效——这是设计取舍，确认可接受即可。

**✅ index.html 可以用格式化器了**（v2.8.8 起解除禁令，原禁令见下）：`tools/check-module-order.js` 的 R1/R2 判定已由「缩进」改为「**括号深度**」——先 `blankNonCode()` 抹掉注释与字符串内容，再逐字符数 `{`/`}`，**与缩进、换行、是否格式化完全无关**（已用"全文件缩进翻倍"与"注入 6 空格缩进的顶层反向引用"两个方向验证：前者输出逐字不变，后者仍能正确判为 R1）。新增一条自检：整段脚本跑完深度必须回到 0，否则报错退出（宁可报错，不可带着错位的深度表给结论）。

> ~~**index.html 禁止过格式化器**（v2.4.4 审计补记，v2.8.8 解除）~~：原因曾是 R1 用「恰好 2 空格缩进 = IIFE 顶层语句」判定，prettier 一次全文件重排就会让这条架构闸门**静默失效**——把架构约束押在"永不格式化"这条约定上，是典型的形式依赖结构。
> ⚠ 仍有一条相关限制未解除：`tools/check-lint.js` 的作用域模型依赖**逐行**剥注释与花括号配平（它刻意不做 AST，为的是零依赖）。它不受缩进影响，但**跨行模板字符串**会破坏它的配平自检（自检会直接报错退出，不会静默放行）。

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

> ★ **本节的性质（v2.17.0 补记——别再让读者猜"这份表还算不算数"）**
>
> 上面这份排队表是**截至 v2.0.2 的静态记录**：此后每一次功能与修复都直接以 `CHANGELOG.md`
> 的一条版本条目落地，**没有回到这里续排**。所以三件事分开看：
>
> - **"后来又做了什么"** → 看 [`CHANGELOG.md`](../CHANGELOG.md)（按版本倒序，每条都写了根因与取舍）；
> - **"现在是什么状态"** → 看 `index.html` 的 `const VERSION`（唯一真相源）与本文档的
>   §3 架构章节（那几节是**随代码更新**的活文档，与本节不同）；
> - **"接下来该做什么"** → 从下面「已埋的技术债 / 后续要盯」接着排：用户报障与审计发现
>   先进那一栏，定了范围再动手（分流口径见 `AGENTS.md §4`）。
>
> 之所以要写这一段：本节原先**只有一副"已清空"的静态快照**，而版本号早已走出很远——
> 读者（尤其是接手的人）无从判断这表是现行排期还是历史遗留。这是 `check-docs.js` 管不到的一类
> 漂移（它管"手写数字"，管不了"**语义已经过期但看起来还在生效**"的章节），只能靠本节自己声明。

### 已埋的技术债 / 后续要盯
- ~~快捷档值 `CONFIG.speedPresets` 目前只服务 BPM；若日后音量、拍号也要常用值，考虑抽成通用 preset row 组件，别复制三份~~ **已完成（v1.6.4）**：共享区（`setPressed` 旁）抽出 `buildPillRow(host, items, opt)`，BPM 快捷档与奇数拍重拍分组两处改为复用；`CONFIG.speedPresets` 仍是唯一数据源，日后音量/拍号要常用档位直接复用组件，不必再复制
- 滑杆刻度是手绘层，`--thumb-r` 必须与实际 `::-webkit-slider-thumb` 尺寸同步；再改圆钮大小记得同改 `.slider-wrap` 的内缩变量
- ~~静态检查仍是自写的窄规则集~~ **已补（v1.6.5）**：原话是"架构约束 / 五项 lint / DOM 引用 / 覆盖率都已就位，但覆盖面小于 ESLint 生态（无类型检查）。要更全套就加 `package.json` + ESLint devDependency——只用于本地自验，不进产物"。现已落地：加 `package.json` + `package-lock.json`（唯一 devDependency `eslint`）+ `eslint.config.js`（flat config）+ `tools/check-eslint.js`（抽内联脚本、把 ESLint 行号回映射到 `index.html`），作为 `tools/check-all.js` 的一个可选加强项（该链现共 14 步；步数以 `node tools/check-all.js` 的输出为准，文件里不留会漂移的旧数字）。**它仍是可选加强项**：缺 `node_modules` 时自动跳过并 `exit 0`，绝不会因为"没装开发依赖"堵住 Cloudflare 部署；"零依赖"约束针对的始终是 `file://` 直开的运行时产物（上站仍只有 4 个文件）。规则集与 `check-lint.js` 刻意不重叠，取舍理由见 `eslint.config.js` 文件头。~~**仍未做类型检查**（无 TS/JSDoc 类型校验）~~ **已补（v1.9.1）**：`tools/check-tsc.js` + `tools/tsconfig.typecheck.json` + `typescript` devDependency，按同一套"可选加强项、缺依赖标 ⊘ 跳过"模式接入（同属该链的一个可选加强项）。落地时实测抓到 6 类真问题（46 处 EventTarget 取值、22 处 `$` 元素类型、`textContent` 被赋数字、`onLimitPulse` 名字遮蔽等，全部已修），并给最中心的 `S` 补了显式类型标注——那是闸门真正长牙的地方。**严格模式已扩面（2026-09-16）**：TS 7.0.2 下实测，**8 项严格检查打开后 0 报错**，故已直接开（strict 家族 6 项：`strictFunctionTypes` / `strictBindCallApply` / `noImplicitThis` / `alwaysStrict` / `useUnknownInCatchVariables` / `strictBuiltinIteratorReturn`；另加非 strict 家族、但同样只抓真错的 2 项：`noImplicitReturns` / `noFallthroughCasesInSwitch`；均写在 tools/tsconfig.typecheck.json 的 `compilerOptions` 里）。**只剩两笔已量化的债**：~~`noImplicitAny` 打开会得到 **727 条**（TS7005 337 / TS7006 291 / TS7034 74 / TS7053 24 / TS18047 1）~~ **`noImplicitAny` 已清零并打开（2026-09-17）**——按"逐块补标注、逐块开开关"的路径分两批（727 → 282 → 0）补完全量前置 `@param` / `@returns` 与内联 `@type`，全文件 0 报错后把开关由 `false` 改为 `true`（改的是 `tools/tsconfig.typecheck.json` 的 `compilerOptions`，不动 `index.html`、不动产物）。**只剩一笔债**：~~`strictNullChecks` 打开会得到 **96 条**（TS18047 74 / TS2345 10 / TS2322 4 / TS18048 4 / TS2769 3 / TS2531 1）~~ **`strictNullChecks` 已清零并打开（2026-09-17）收官**——那 96 条（比原记的 **251** 降下来，因为大量隐式 any 消失后，原先被 any 传染出来的空值报错一并消失）按模块分七块逐块消化：Trainer 6（`S.plan`）→ 小尾 9（Arrange 4 + Ear 3 + Store 1 + Modal 1）→ Controls 11 → AudioEngine 20（`ctx`）→ Viz 25（缓存 DOM 引用）→ Editor 25（`draft`），统一用「取本地别名 + 判空守卫」补上（模块级可空 `let` 在函数顶部取别名并早返回，定时器句柄先判 `!== null` 再 `clearTimeout`，`.closest()` 补 `!!` 守卫），全文件 0 报错后把开关由 `false` 改为 `true`。**至此 strict 家族 8 项与两项额外严格检查全部打开且全绿，类型闸门扩面收官**。改动仍只在 `tools/tsconfig.typecheck.json` 的 `compilerOptions`，不动 `index.html`、不动产物。
- **检查没有"必经之路"，全靠钩子 / 自觉**（v2.0.5 修正，原写的是"Cloudflare 构建时必定跑一次全量检查，失败即不部署"）：Cloudflare 的**线上**构建跑什么，取决于 Dashboard 里那串构建命令——**Workers Builds（Git 集成构建）不读仓库里 `wrangler.jsonc` 的 `build.command`**（Cloudflare 官方既有行为），所以仓库里那份配置只约束本地与命令行的 `wrangler deploy`。换句话说，**没有任何一道闸门是"推上去就一定过不去"的**；**提交时**这一环已由仓库自带的 `hooks/pre-commit` + `tools/install-hooks.sh` 补上——`core.hooksPath` 是本机配置、不随仓库走，故**每个 clone 各自跑一次** `sh tools/install-hooks.sh`，此后每次 `git commit` 自动跑 `node tools/check-all.js --quick`（跳过 T21 全组合扫描；想绕过是不该常态的 `--no-verify`）；**WorkBuddy 手动发布时**仍没有任何机制拦你，发布前务必手动跑一次全量 `node tools/check-all.js`。别拿"Cloudflare 会拦"当借口跳过本地那一遍——它只拦得住上 Cloudflare 这一条路。
  **v2.8.3 收口**：把要填进 Dashboard 的那串从"手抄四步"收敛为一行稳定指针 `npm run ci`——命令的**内容**留在仓库（`package.json` + `tools/`），**唯一的仓库外之物**只是"填哪一行"这件事本身。失效面（Dashboard 没填对）因此依然存在，但它从此是一行可核对的东西，而不是一段要跟着仓库演进同步更新的脚本文本。⚠ 该脚本里 `npm ci` 与 `--strict-env` **缺一不可**：前者保证装齐 devDependency（否则 ESLint / tsc 被标 ⊘ 跳过，你验的不是同一件事），后者把"缺依赖"由跳过升级为报错
- **后台持续发声仍需真人验收**（见 §5）：自适应窗口只能用假时钟断言，浏览器层面的定时器节流无法在无头环境复现
- 覆盖率未覆盖的行**分两类、性质不同**（**条数、百分比、行号一律不抄进文档**，v2.0.5 起一律以 `node tools/check-coverage.js` 的输出为准——它会打印总量、分区占比与未覆盖行的绝对行号）：
  **一类是刻意保留的防御性代码**——**AudioEngine** 里 `arrNextBar` 的 onset 扫描兜底、单轮调度 `MAX_SCHED_STEPS` 硬上限触发后的**重锚分支**、以及 `ctx` 被系统关闭后重建 / `resumeCtx()` 的异常分支（要造出超 512 音符的单轮调度、或让上下文被系统关闭才会走到）；v2.0.6 之后的新模块（Arrange / 初始化装配 / Presets 等）也各留了几条同类"出事才走"的路径。
  **另一类是不可达分支**——**Ear** 的 `durName` 里 192/96 与 6 这几档时值（内置库与听辨出题组都不用这几档时值，`durName` 也不对外导出）。原先还列了 144/18 两档，实为 `VALID_T` 之外的死分支（任何经校验的型都到不了），已于 P3 工程卫生清理中删除。
  两类都不为了数字去造人工状态点亮它。
  ★ **v2.18.0 复核（装配区那一档，别再重新发现一遍）**：装配区曾是唯一明显低于
     邻居的一条线（其余各分区都在 98–100% 上下，它在 96% 上下）。逐行核过一遍，那 38 行**全部**属于
     上面两类中的一个：产物戳记版本不符的告警、`unhandledrejection` 里再抛异常的兜底、
     遮罩落盘失败 / 延迟配置条数超上限的弹窗（都要造出"资源耗尽"的局才走得到）、
     以及壁纸**降采样**那 21 行（★ 这条是**环境限制**：测试桩拿不到 2d 上下文，
     代码里本就写着"没有 canvas 就直接用原图"那条分支）。
     其中**只有两处属"该测而没测"**——`#wallPickBtn` 的点击转发、以及"节拍音量为 0 时不许开校准"
     的守卫——**v2.18.0 已补断言**（T92m / T95g，并各自做过变异反向验证）。
     ⇒ 余下那些**不要**为了数字去点亮；也**不要**把"它比邻居低"当成缺陷 ——
       闸门口径是**分区 ≥ 90% / 总体 ≥ 97%**，它一直合规。**本行原先同时抄了条数与行号，两样都烂了**：条数原写"共 11 行 / 实测 99.7%"，在 v2.8.3 自验时实测已是 **36 行 / 99.4%**（多出来的部分正是 v2.0.6～v2.8 各版新增的防御性路径）；5 个行号（L2964 / L3034–L3036 / L4478 / L4479 / L4481）在 v2.0.4 全维度审计中实测**全部失效**。这正是 `tools/check-docs.js` 文件头写的那句——"手写数字注定要烂"
  ★ **v2.19.0 追加（口径变了，别再拿上一条的结论套）**：装配区里那块诊断代码已抽成独立模块
     `Diagnostics`，于是**它自己成了一条分区线**（实测 97.1%，高于分区阈值 90%）——
     此前它被平均在装配区里，掉下去只会让装配区的百分比微微下移，看不见。上一条"装配区是明显
     低于邻居的那条线"**依然成立**，但**别再把它读成"诊断那一块的问题"**：诊断现在有自己的线了，
     装配区剩下的那点是壁纸降采样（环境受限）与几处"资源耗尽"兜底。
- `Viz.paintBall` 的 `H = min(clamp(k·T²,10,48), yBase+6)` 里那道"顶点不出容器空域"的钳制，只在**第一行且弧很长**时才会真正生效（默认 96 BPM 下未钳制跳高 46.9px 仅比上界 44px 高 2.9px，余量很薄）。**已补专门场景**：T30 ⑧ 把 BPM 降到 60 构造长弧（未钳制 48px 明显高于上界 44px），断言实测跳高等于上界而非未钳制值——删掉钳制即变红（反向验证已跑）。改动行高/内边距时要留意上界 `yBase+6` 会随行位置漂移

### 已明确不处理（不再跟进）
- **Firefox 圆钮样式**（2026-09-11 决定忽略）：本项目只写了 `::-webkit-slider-thumb`，没有 `::-moz-range-thumb`，理论上 FF 下圆钮可能与刻度略错位。本机无 Firefox、未实测，用户已决定不处理 → **不再列为待办，也不要主动盘它**（不必提、不必测、不必补）。仅当日后真有人在 Firefox 下反馈刻度错位时，再回来补这两条伪元素规则
- **iOS 兼容性**（2026-09-15 决定忽略）：用户无 iOS 设备、以后也不考虑 → iOS 专属的验收项（锁屏保活、Safari interrupted 状态实测）不再跟进。代码里已有的兜底（静音 WAV、ctx 状态监听）保留不动——它们对无 wakeLock 的桌面/Android 浏览器同样有效

## 7. 用户协作偏好

- 无技术背景：解释技术问题用生活化比方，不堆术语
- 在意 token 成本：改动合并成一条明确需求；声称完成前必须自验（语法 + 真实浏览器截图）
- 决策记录写进 CHANGELOG.md，关键状态写进本文档
