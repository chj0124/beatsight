/* BeatSight 自动化测试 · 控件布局搬家（v2.10.11）
   T90 系列。
   ---------------------------------------------------------------------------
   来源（用户三项需求，逐条确认后落地）：
     ① 「拍号」整块移到「同屏行数」右侧、两者紧邻 → 拍号从**走带卡**搬进**时值可视化卡**，
        与 `.viz-rows-panel` 同处新的 `.viz-rows-row`（窄屏放不下时自动折回上下两行）。
     ② 「音量」「音色」移到「编辑节奏型」按钮**左侧** → 两块从走带卡搬进**当前节奏型行**
        （`.pattern-head`，一个没有卡片外壳的裸行），排在 `#editBtn` 之前；
        两块 `.group-label` 按用户要求缩短成「音色」「音量」。
     ③ 可视化卡里几行文案左边缘不齐 → 根因是**按钮自身的内边距**：`.viz-toggles` 里的开关
        左内边距 16px，而它的底色与卡片同色（看不见"底"），于是被读成缩进。修法（用户选"丙"）：
        **只把这一行的开关左内边距去掉**，让文字落到卡片内容边缘；那排 pill 不动
        （它的**盒子**本来就在内容边缘上，只有文字被自身 padding 内缩，属正常）。
     另按用户要求 (ii)：`.pattern-head` 是裸行，补上与 `.card` 同值的左右内边距，
        否则它的内容比卡片内容偏 24px（窄屏 16px）——音色/音量搬进来后这偏差会当场变成
        "看得见的左边缘不齐"。

   ★ 本组用**标记字符串**断言，不走 DOM 父子：桩不解析 HTML，静态元素都是孤立桩
     （`parentNode` 恒 null），**走路树断言不出来**（与 T25 的版本号结构断言同一理由）。
   ★ 真几何（"文案左边缘是否真的落在同一条线上"）桩更测不了 —— 那一半在 `tools/smoke.js`
     里用真实浏览器 + `getBoundingClientRect` 断言。
   ★ 控件的 id 与文本契约全部保留（`#sigRow` / `#timbreRow` / `#volMaster` / `#vizRowsRow` …），
     所以 t24 / t30 / t50 / t79 / t87 的既有断言**一行都不用改**——这也是选"搬块不换 id"的理由。 */
"use strict";
const { loadApp, ok, eq, section, pill, html } = require("../lib/harness");

/* 三段切片的两端标记。★ 切片前必须确认**两端都在**：`indexOf` 给 -1 时会切出"到文件末尾"
   的超长片段，让那些"不该包含 X"的断言侥幸通过（比失败更危险）。 */
const M = {
  topbar: ['<header class="topbar">', '<!-- 分级播报', "顶栏（品牌 + 状态行 + 补偿 + 设置/主题）"],
  /* 控制芯重排（PLAN-v9 批 2）：头行止标记从「<!-- 视听辅助开关」（随开关列退役）改为
     「<!-- v3.0.0：预设库」——vizHead 切片现在含芯（胶囊行 + 滑杆塔 + 浮层壳）全部内容 */
  vizHead: ['<div class="card-head viz-head">', '<!-- v3.0.0：预设库', "时值卡头行（控制芯：胶囊行+滑杆塔+浮层）"],
  /* 控制芯重排（PLAN-v9 批 2）：`.viz-toggles` 开关列退役 → 芯顶胶囊行切片 */
  corePills: ['<div class="core-pills">', '<!-- v2.5.0：原来只有「总音量', "芯顶胶囊行（预备/静音/变速）"],
  /* v3.12.0：`rowsRow` 切片随原并排行整块退役删除——那一行不再存在，
     遗留切片标记会让 indexOf 恒 -1、切片静默变成"到文件末尾"（比失败更危险）。 */
  /* v3.3.0：跳段行整组搬进页面底部的固定播放条 #playBar（在 </main> 之后），
     止标记随之从 `</div><!-- /vizBand -->` 改成其后第一个区块注释（自定义节奏型编辑器）。
     起止标记都必须真实存在，否则 slice 会静默切出"到文件末尾"，让"不该包含 X"的断言
     侥幸通过（比失败更危险——v3.0.0 立此规矩时的同一口径）。 */
  jumpRow: ['<div class="arg-now arg-jump" id="argJump">', "<!-- ================= 自定义节奏型编辑器", "跳段 + 播放行（v3.3.0：已在 #playBar 内）"],
  /* v3.4.1：整条固定播放条（型名胶囊在左区）——P3 去重的断言要在这里做 */
  playBar: ['<div class="play-bar" id="playBar"', "<!-- ================= 自定义节奏型编辑器", "底部固定播放条（左区型名胶囊 + 跳段播放 + 右区进度）"],
  settingsOverlay: ['<div class="dialog" id="settingsOverlay"', "<!-- ================= 应用内弹窗", "设置浮层小窗"],
  css: ["<style>", "</style>", "样式表"],
};
/** @param {keyof M} which */
function slice(which){
  const [a0, b0, label] = M[which];
  const a = html.indexOf(a0), b = html.indexOf(b0);
  ok(a >= 0, `前提：起标记存在 —— ${label}「${a0}」`);
  ok(b > a, `前提：止标记在起标记之后 —— ${label}「${b0}」`);
  return html.slice(a, b);
}

/* ================= 场景 T90a（v3.12.0 重写）：原「行数 + 拍号」并排行整块退役 ================= */
section("T90a v3.12.0 · 原 .viz-rows-row 整块退役（同屏行数 → 设置弹窗 / 拍号 → 删除）");
{
  /* 用户拍板：① 同屏行数搬进设置弹窗「画面图层」组（判据同 Swing）；② 拍号整块删除。
     本组断言"两边都搬全了、原址清干净了"，防半搬（浮层/卡片两边都留一半）。 */
  ok(!/class="viz-rows-row"/.test(html), "★★ 原并排行容器 `.viz-rows-row` 已从标记里退役");
  ok(!/class="viz-rows-panel"/.test(html), "★ `.viz-rows-panel` 旧面板壳一并退役（设置里改由 .group 承担）");
  ok(!/id="sigRow"/.test(html), "★★ 拍号 `#sigRow` 已删除（手动拍号控件退役）");
  ok(!/id="accGroup"/.test(html) && !/id="accRow"/.test(html),
    "★★ `#accGroup` / `#accRow` 随拍号一并删除（重拍分组界面退役；数据层 ACC_GROUPS 仍在，回退节奏恒用第 0 组）");
  ok(!/id="fallbackNote"/.test(html) && !/id="fallbackBtn"/.test(html),
    "★★ 拍号回退提示条（#fallbackNote / #fallbackBtn）一并退役——它的触发条件已无从产生");
  ok(!/data-sig="/.test(html), "★ 标记里不再有拍号 pill（6 档全删）");
  {
    /* 取设置弹窗整段（用既有的切片标记；注意 helpOverlay 在文件中**早于** settingsOverlay，
       拿它当止标记会切出空串——那正是"断言静默恒假"的坑，故用 slice() 的成对标记） */
    const setOverlay = slice("settingsOverlay");
    ok(/id="vizRowsRow"/.test(setOverlay),
      "★★ 同屏行数档位 `#vizRowsRow` 搬进设置弹窗（id 不换）");
    ok(setOverlay.indexOf('id="scrollModeToggle"') < setOverlay.indexOf('id="vizRowsRow"'),
      "★ 排在「连续滚动」开关之后（两者共用同一档位语义，放一起最好懂）");
    ok(/class="viz-rows" id="vizRowsRow"/.test(setOverlay), "★ 档位行容器 `.viz-rows` 随块同搬（生成逻辑不动）");
    /* 设置里是 .group 形态（标签左、按钮右），不再是 .viz-rows-panel */
    const seg = setOverlay.slice(setOverlay.indexOf('id="vizRowsRow"') - 400, setOverlay.indexOf('id="vizRowsRow"'));
    ok(/class="group"/.test(seg) && /class="group-label"/.test(seg),
      "★ 设置里用 .group + .group-label 骨架（同 Swing 组的先例）");
  }
  /* 旧档位语义仍由 VIZ_ROW_COUNTS 运行期生成（不写死，单一数据源不破） */
  eq((html.match(/data-rows="/g) || []).length, 0,
    "同屏行数档位仍由 VIZ_ROW_COUNTS 运行期生成（标记里不写死，单一数据源不破）");
}

/* ================= 场景 T90b：当前节奏型行删除；名字进播放键行；标题/状态灯落位 ================= */
section("T90b v2.10.16 · .pattern-head 整块删除；#patternName 进跳段行；#vizTitle 删除；状态灯入左列");
{
  /* ① 「当前节奏型」裸行整块删除（名字搬进跳段行、meta 删除） */
  ok(!/class="pattern-head"/.test(html), "★ `.pattern-head` 裸行已整块删除（名字去跳段行、meta 删）");
  ok(!/id="patternMeta"/.test(html), "★ #patternMeta（4/4 拍 · N BPM）已删——拍号看 pill、速度看 BPM 大字");
  /* v3.10.0：状态灯搬进底栏右区后，#statusText（.pb-right 内）与 #patternName（胶囊内）
     都在 play-bar 里，文档序随各自落位——原「statusText 在 patternName 之前」的序断言退役。 */
  ok(!/id="patternName"/.test(slice("topbar")),
    "★ v3.4.1（P3 去重）：型名只在底栏胶囊里（#patternName 随元素搬进 #presetLibBtn），"
    + "顶栏零读数");
  /* ② 标题 #vizTitle 整块删除（含「· 4/4」——用户拍板连它一起删），JS 写入点不复存在 */
  ok(!/id="vizTitle"/.test(html), "★ #vizTitle 已整块删除（与状态灯重复；卡片以角标 01 Rhythm Map 为名）");
  /* ③ v2.76.3：状态灯行曾搬进顶栏；★ v3.10.0：整体搬去底栏右区 .pb-right（用户要求
     "与第 N–M 小节读数放一起"）——顶栏自此零读数，契约归 t170。 */
  const tb = slice("topbar");
  ok(!/class="status"/.test(tb) && !/id="statusDot"/.test(tb),
    "★★ v3.10.0：顶栏不再有状态灯行（已整体搬去底栏右区，契约归 t170）");
  ok(!/id="patternName"/.test(tb),
    "★★ v3.4.1（P3 去重）：顶栏**不再**有型名——原先与底栏胶囊同帧同值的重复面已消除");
  /* ★ v3.4.1：型名的唯一权威面 = 底栏胶囊（在 #presetLibBtn 内，fixed 常驻不随页面滚走） */
  const bar = slice("playBar");
  ok(/<button class="pb-ctx" id="presetLibBtn"/.test(bar)
     && /<b class="pat-now" id="patternName">/.test(bar),
    "★★ v3.4.1：#patternName 在底栏胶囊内（.pb-ctx > b.pat-now）——全页面唯一型名展示位");
  ok(!/id="plbCurName"/.test(html),
    "★★ v3.4.1：#plbCurName（v3.1.0 加的同源第二写点）已随去重一并删除");
  const h = slice("vizHead");
  ok(!/class="status"/.test(h) && !/id="statusDot"/.test(h),
    "★★ v2.76.3：时值卡左列不再有状态灯行（顶部 53px 对齐占位随之退役）");
  ok(h.indexOf("sec-tag") < h.indexOf('id="volMaster"'),
    "★ 左列顺序：角标 → 音量（状态灯已迁顶栏）");
  ok(h.indexOf('id="volMaster"') < h.indexOf('id="bpmNum"'), "左列（音量）在源码序上先于右列（BPM）");
  ok(/id="volStrumRow"/.test(h), "音量三条（含扫弦行 id）都在左列");
  /* ④ 设置弹窗结构（v2.85.0 起：四组——画面图层 / 环境 / 发声 / 数据与说明；
     原「外观与辅助」拆为「画面图层」(5) +「环境」(2 keepAwake/wide)） */
  const st = slice("settingsOverlay");
  for (const g of ["画面图层", "环境", "发声", "数据与说明"]){
    ok(st.includes(g), "★ 设置弹窗分四组之一：「" + g + "」");
  }
  /* v2.69.0（1.1）：themeToggle 上顶栏，从设置弹窗 id 清单移除；
     v2.70.0（1.4）：新增座次尺/时值标注两开关（9 → 11 项）；
     v2.86.0（PLAN-v7）：旧的「歌词跟随条」开关退役，改为「显示歌词」开关（同属画面图层组，role=switch 计数仍是 15）；
     v2.85.0（②）：「外观与辅助」拆为「画面图层」(5) +「环境」(2)，并新增 ③a 恢复示例曲 / ③b 危险区 */
  for (const id of ["bounceToggle", "tabToggle", "timbreRow", "swingRow",
                    "exportBtn", "importBtn", "exportAllBtn", "importAllBtn", "helpBtn",
                    "rulerLabToggle", "durLabelToggle", "showLyricToggle",
                    "keepAwakeToggle", "wideToggle"]){
    ok(new RegExp('id="' + id + '"').test(st), "★ 设置弹窗 14 项之一：#" + id + (id === "swingRow" ? "（v2.10.17 Swing 入发声组）" : (id === "showLyricToggle" ? "（v2.86.0 显示歌词·画面图层组，取代歌词跟随条）" : (id === "keepAwakeToggle" || id === "wideToggle" ? "（v2.85.0 环境组·从外观与辅助拆出）" : ""))));
  }
  /* v2.85.0（③a/③b）：数据与说明组新增「恢复示例曲」、危险区新增「恢复出厂设置」 */
  ok(/id="demoRebuildBtn"/.test(st), "★ v2.85.0（③a）：恢复示例曲按钮在数据组");
  ok(/id="factoryResetBtn"/.test(st), "★ v2.85.0（③b）：恢复出厂设置按钮在危险区");
  eq((st.match(/data-swing="/g) || []).length, 3, "★ Swing 3 档已进设置弹窗");
  ok(/class="dialog-panel"/.test(st) && /id="settingsClose"/.test(st), "浮层小窗面板与 ✕ 关闭钮在位");
}
/* ================= 场景 T90c：走带卡整卡删除，角标 01–08 连续 ================= */
section("T90c v2.10.14 · 走带卡整卡删除（播放键进跳段行），角标上移一位后连续无空号");
{
  ok(!/class="card transport"/.test(html),
    "★ `.card.transport` 整卡已删——BPM/Swing（v2.10.13）、音色/音量/拍号（v2.10.11）相继搬走后只剩播放键，播放键本轮也进了跳段行");
  ok(/id="playBtn"/.test(html) && !/class="card transport"/.test(html),
    "播放键还在（随跳段行），只是换了住处");
  /* 角标连续性：02 腾空后 03–09 全体上移一位 → 01–08 恰好各一次（v2.10.12 收拾 06 空号的同一口径）。
     ★ 按值排序后比对——设置 overlay 在标记里声明在最后，文档顺序 ≠ 编号顺序 */
  const tags = [...html.matchAll(/sec-tag"><b>(\d+)<\/b>/g)].map(m => m[1]).sort();
  eq(tags.join(","), "01,02,03,04,05,06,07",
    "★★ 角标 01–07 恰好各一次、无空号无重号（v2.10.16 训练模式标题行删除，02 再次腾空）");
  ok(/<b>02<\/b><i>Library<\/i>/.test(html), "预设库顶上 02（原 03）");
  ok(/<b>04<\/b><i>Settings<\/i>/.test(html), "设置是 04（原 05）");
}
/* ================= 场景 T90g：跳段行结构（播放键居中 + 双态循环钮） ================= */
section("T90g 跳段行 · 播放键居三键中间、圆形键常显置灰、无说明文字、双态循环钮");
{
  const s = slice("jumpRow");
  ok(/id="argJumpPrev"/.test(s) && /id="playBtn"/.test(s) && /id="argJumpNext"/.test(s),
    "播放键与上/下段键同处一行");
  ok(s.indexOf('id="argJumpPrev"') < s.indexOf('id="playBtn"')
     && s.indexOf('id="playBtn"') < s.indexOf('id="argJumpNext"'),
    "★★ 播放键在「上一段」与「下一段」**中间**");
  eq((s.match(/class="jump-btn loop-btn"/g) || []).length, 1,
    "循环段 = jump-btn 同款圆钮（v2.10.22 双态图标；v3.1.0 术语从「范围循环」改「循环段」）");
  ok(/aria-label="上一段"/.test(s) && /aria-label="下一段"/.test(s) && /aria-label="循环段"/.test(s),
    "图标化后 aria-label 是唯一名字，三枚都要保留（v3.1.0 术语分离：预设库侧叫「循环小节」）");
  ok(!/<div class="arg-now arg-jump" id="argJump" hidden/.test(s),
    "★ 行本身不再带 hidden（常显；置灰交给 .jump-btn:disabled）");
  ok(/id="argJumpPrev"[^>]*disabled/.test(s) && /id="argJumpNext"[^>]*disabled/.test(s),
    "初始标记置灰（默认预设模式无可跳目标；refreshBar 按实际状态改写）");
  ok(!/argNowMeta/.test(s), "★「第 N 段 · 第 M 小节」说明文字已删（v2.10.16 用户要求）");
  /* v2.10.22：两枚 SVG 并存（关=顺序循环 ico-off / 开=单曲循环+1 ico-on），aria-checked 驱动切换 */
  ok(/class="ico-off"/.test(s) && /class="ico-on"/.test(s),
    "★ 循环钮内两枚 SVG 并存（ico-off / ico-on），显隐由 CSS 按 aria-checked 切换");
  eq((s.match(/<svg/g) || []).length, 5,
    "跳段行共 5 枚 SVG（◀ ▶ 播放键 playIcon + 两枚循环态）");
}

/* ================= 场景 T90f：BPM 在卡片头；Swing 进同屏行数行 ================= */
section("T90f v3.39.0 · BPM 并入音量组（卡片头单列）；Swing 与同屏行数平齐（排拍号右侧）");
{
  const h = slice("vizHead");
  /* ★ v3.39.1（用户澄清）：BPM 行改上下两行塔式——上行 .bpm-slider-row 复刻音量行
     三段槽位（滑杆与音量条严格等长），下定居中步进群（居中轴参照滑杆）。
     v3.39.0 的「数值与增减钮紧跟滑杆同行」口径退役；TAP 与快捷档行退役不变。 */
  ok(/id="bpmNum"/.test(h) && /id="bpmSlider"/.test(h) && /id="bpmTicks"/.test(h),
    "★ BPM 三件（滑杆/数值步进/刻度层）都在卡片头行内");
  ok(!/id="tapBtn"/.test(h) && !/id="bpmPresetRow"/.test(h),
    "★★ TAP 测速与快捷档行已从标记除名（v3.39.0 删除项）");
  ok(h.indexOf('id="volMaster"') < h.indexOf('id="bpmSlider"'),
    "★ 源码序即读序：音量条在前、BPM 行在后（同一 .tg-body 内的纵排）");
  const row = h.slice(h.indexOf('id="bpmSlider"'), h.indexOf('id="trainerProg"'));
  ok(/id="bpmMinus5"/.test(row) && /id="bpmNum"/.test(row) && /id="bpmPlus5"/.test(row),
    "★★ 数值与 ± 增减钮与滑杆同住 .slider-row（v3.39.1 起为上下两行塔式，细钉见 T230）");
  ok(/class="card-head-left"/.test(h), "左块包 .card-head-left（v3.39.0 起头行只有这一个孩子）");
  ok(!/id="swingRow"/.test(h), "Swing 不在头行（已下移）");
  ok(!/<div class="viz-toggles">/.test(html) && !/id="tgSwitchRow"/.test(html),
    "★★ 控制芯重排（PLAN-v9 批 2）：开关列容器与 #tgSwitchRow 已整列退役");
  /* v3.12.0：原「行数 + 拍号」并排行整块退役——头行之外不再有那个容器 */
  ok(!/class="viz-rows-row"/.test(html) && !/id="sigRow"/.test(html),
    "★ 原「同屏行数 + 拍号」并排行已整块退役（行数去设置弹窗、拍号删除）");
  ok(!/id="bpmNum"/.test(html.slice(html.indexOf("viz-head-grid"), html.indexOf("viz-head-grid") + 60)),
    "★ BPM 组已上移卡片头（并排行里没有它）");
}

/* ================= 场景 T90h（PLAN-v9 批 2 重写）：开关 = 芯顶胶囊行三枚；参数进浮层 ================= */
section("T90h 控制芯 · 胶囊行三枚（预备/静音/变速）；拍数输入贴预备胶囊；参数面板进浮层壳");
{
  const s = slice("corePills");
  for (const id of ["muteToggle", "trainerToggle", "countInToggle"]){
    ok(new RegExp('id="' + id + '"').test(s), "★ 胶囊行的三件之一：#" + id);
  }
  ok(!/id="countInPanel"/.test(s), "★★ 空参数面板 #countInPanel 仍不存在（拍数输入走 #countInBeatsWrap，不再造面板壳）");
  ok(s.indexOf('id="countInToggle"') < s.indexOf('id="muteToggle"')
     && s.indexOf('id="muteToggle"') < s.indexOf('id="trainerToggle"'),
    "★ v3.22.0 列内顺序 → 胶囊行顺序：预备拍 → 静音拍 → 变速训练（历史列序在胶囊行上延续）");
  /* 预备拍已离开底栏（v3.15.0 搬回卡片） */
  {
    const pb = slice("playBar");
    ok(!/id="countInToggle"/.test(pb) && !/id="countInBeatsWrap"/.test(pb),
      "★★ 预备拍开关与拍数输入都已离开底栏（v3.15.0 搬回卡片开关行/悬浮槽）");
    ok(!/class="pb-countin"/.test(pb), "★ .pb-countin 承载层已退役（.pb-sub 只剩状态灯）");
  }
  /* 拍数输入在胶囊行内、位于预备拍开关之后（顺序「开关 → 拍数」不变） */
  ok(s.indexOf('id="countInToggle"') >= 0 && s.indexOf('id="countInBeatsWrap"') >= 0
     && s.indexOf('id="countInToggle"') < s.indexOf('id="countInBeatsWrap"'),
    "★ 拍数输入在胶囊行内、位于预备拍开关之后（顺序「开关 → 拍数」不变）");
  /* v2.11.2：训练模式区整块删除——面板搬进本行、接续按钮与 7 天计划下线 */
  ok(!/<i>Training<\/i>/.test(html), "★ 「02 Training 训练模式」标题行已删（v2.10.16）");
  ok(!/id="trResumeBtn"/.test(html) && !/id="trStart"/.test(html) && !/id="planGenBtn"/.test(html),
    "★ v2.11.2：继续上次按钮 / 起始输入框 / 7 天计划入口均已删除");
  /* ★ 参数面板进浮层壳（搬块不换 id）：面板仍在、且在自己的胶囊之后（同芯内源码序） */
  ok(/id="trainerPanel"/.test(html), "★ 变速训练面板仍在（id 未换）");
  {
    const h = slice("vizHead");
    ok(h.indexOf('id="trainerToggle"') >= 0 && h.indexOf('id="trainerPanel"') >= 0
       && h.indexOf('id="trainerToggle"') < h.indexOf('id="trainerPanel"'),
      "★ 参数面板在开关之后（同芯内源码序；壳 #trainerFlyout > .tr-panel#trainerPanel）");
    ok(/<div class="tg-flyout" id="muteFlyout" hidden>/.test(h)
       && /<div class="tg-flyout" id="trainerFlyout" hidden>/.test(h),
      "★ 两个浮层壳在位且默认 hidden（显隐由 syncParamSlots 镜像面板）");
    ok(!/class="countin-line"/.test(h) && !/class="sw-line"/.test(h),
      "★ 开关行容器 .countin-line / .sw-line 随开关列退役（预备拍数输入直接贴胶囊）");
  }
  eq((html.match(/id="muteToggle"/g) || []).length, 1,
    "静音拍开关全文件恰此一处（训练区已无副本）");
  ok(!/class="config"/.test(html), "★ `.config` 包裹层随开关搬家删除（本文件已无使用者）");
}

/* ================= 场景 T90d：两条 CSS 契约（③选丙 + (ii) 补齐） ================= */
section("T90d CSS 契约 · 开关行去左内边距（丙）；音量列宽；跳段键 52px；页底提示行；窄屏六线铺满");
{
  const css = slice("css");
  /* 控制芯重排（PLAN-v9 批 2）：`.viz-toggles .toggle-pill{padding-left:0}`（③选丙）随开关列退役；
     新胶囊行带自己的规格钉（36px 高 = 上下 8px 内边距），作用域同样收在芯内 */
  /* ★ v3.41.0（按《整体布局方案示意图》对账）：胶囊规格从「上下 8px 内边距」改为**显式 height:36px**
     + 方案的中性描边——同一件事（36px 胶囊）换写法，因为方案图的胶囊是「描边胶囊 + 16px 圆点」。 */
  ok(/\.core-pills \.toggle-pill\{height:36px;padding:0 14px;gap:7px;font-size:12\.5px;/.test(css),
    "★★ 控制芯：36px 胶囊改为显式 height（v3.41.0 描边胶囊 + 16px 圆点，按方案图）");
  /* ★ 作用域必须限定在 .viz-toggles 内：改成全局 .toggle-pill 会是全站开关的观感变更 */
  ok(!/^\.toggle-pill\{[^}]*padding-left:0/m.test(css),
    "★ 且没顺手把全局 `.toggle-pill` 也改掉（那是全站开关，不在本次范围）");
  ok(!/^\.pattern-head\{/m.test(css),
    "★ v2.10.16：`.pattern-head` 规则随裸行删除一并清理（v2.10.11 的 (ii) 内边距契约退役）");
  /* v3.12.0：旧并排行整块退役——`.viz-rows-row` 的 flex-wrap 兜底随之无对象；
     同屏行数住进设置弹窗后，折行由 `.viz-rows` 自己的 flex-wrap 承担（见 T90d）。 */
  ok(/\{display:flex;align-items:center;gap:8px;flex-wrap:wrap\}/.test(css),
    "★ `.viz-rows` 仍带 flex-wrap（档位多时折行，不被 overflow-x:hidden 裁掉）");
  /* v2.10.14：行数 pill 的缩小规则删除（与拍号统一大小）；Swing 进本行后同款 wrap 兜底不变。
     ★ v3.6.0（B4）订正：该决定的口径是「统一为默认 .pill 规格」，不是「钉死 36px」——
       默认规格本身可以被整体抬高（B4 就是给它加 min-height:40px）。故本断言仍成立。 */
  ok(!/^\.viz-rows \.pill\{/m.test(css),
    "★★ 用户要求④：`.viz-rows .pill{padding:7px 14px…}` 缩小规则仍不存在——同屏行数与拍号共用默认 .pill 规格（v3.6.0 起默认规格含 min-height:40px），两者仍无局部差异");
  ok(/\.viz-head\{[^}]*align-items:stretch[^}]*\}/.test(css),
    "★ v2.10.18：`.viz-head` 改 stretch（左列撑满头行高、音量组沉底）；顶对齐意图由左列自身"
    + "的 flex-start 起步保留——BPM 组标签与左列首行仍同一行起步");
  ok(/^\.jump-btn\{[^}]*border-radius:50%/m.test(css) && /^\.jump-btn\{[^}]*width:52px/m.test(css),
    "★ 用户要求③：`.jump-btn` 圆形 52px（v2.10.15 加大两号；播放键 72px 仍最大）");
  ok(/\.jump-btn:disabled\{[^}]*opacity/.test(css),
    "★ 用户要求⑤：置灰态用 opacity（常显 + 不可用变灰，不再隐藏）");
  ok(/\.card-head-left\{[^}]*flex-direction:column[^}]*\}/.test(css),
    "★ v2.10.15：`.card-head-left` 竖排（角标+标题在上行、音量三条在标题正下方）");
  ok(/\.card-head-left \.vol-row\{width:100%\}/.test(css),
    "★ 音量滑杆在列内占满宽度（列内没有横向约束可依，须显式给宽）");
  ok(/\.card-head-left \.vol-row input\[type=range\]\.vol\{flex:1;width:auto\}/.test(css),
    "★★ v2.34.0：左列音量滑杆吃满行内剩余宽度——% 列右缘贴列右缘，"
    + "与节奏型名（pat-now 行尾）恢复 v2.10.17 的「同一右缘对齐」契约"
    + "（120px 定宽时 % 右缘 278 vs 名字 368，差 90px 死空间；设置弹窗同款滑杆不受影响）");
  /* 注释里留作纪念的名字不算违规（仓内 `.page-foot` 同款口径）——断言前先剥块注释 */
  const cssNoCmt = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/\.viz-rows-panel/.test(cssNoCmt),
    "★★ v3.12.0：`.viz-rows-panel` 旧面板壳已随并排行整块退役（设置里用 .group 骨架）；"
    + "v2.38.0 那条「标签与按钮同行自适应」的 flex-wrap 口径由 .group 承担，本断言改为防回潮");
  ok(/\.viz-head-grid\.viz-head-grid\{display:block[^}]*\}|html body \.card \.viz-head-grid\{display:block/.test(css)
     && /\.viz-head-grid \.card-head-left \.group\{max-width:402px;margin:0 auto\}/.test(css),
    "★★ 控制芯（PLAN-v9 批 2）：两列网格退役 → 单列居中芯（402 = 标签 52 + 间距 10 + 滑杆 340，中轴=跑道中轴）");
  ok(/\.viz-head-grid \.card-head-left \.group\{position:relative\}/.test(css)
     && /\.tg-flyout\{position:absolute/.test(css)
     && /\.tg-flyout\[hidden\]\{display:none\}/.test(css),
    "★★ 控制芯：参数浮层壳 = 芯内绝对定位（.group 为包含块），[hidden] 显式收显（类选择器盖 UA 的坑）");
  /* ★ v3.41.0（乙案重设计）：面板改为挂在**自己那枚胶囊正下方**的下拉面板——包含块 = .core-pill-hold（≥1280）
     或芯（<1280），顶部带指向胶囊的小箭头；旧的「出芯两侧」口径退役。 */
  ok(/\.core-pill-hold\{position:relative;display:flex\}/.test(css)
     && /\.tg-flyout::before\{content:""/.test(css),
    "★ v3.41.0：参数面板 = 胶囊下方的下拉（holder 提供包含块 + 顶部指向箭头）");
  ok(/\.viz-head\{[^}]*justify-content:flex-start[^}]*column-gap:48px/.test(css),
    "★ v2.10.17：卡片头紧凑排列——BPM 组紧随音量列 48px（原 space-between 中间空 239px）");
  ok(/\.status\{display:inline-flex;align-items:center;gap:8px/.test(css)
     && !/\.status\{[^}]*width:100%\}/.test(css)
     && !/min-width:16em/.test(css),
    "★★ v2.76.3：状态行改顶栏原生——inline-flex、左列时代的 width:100% 与"
    + "#statusText 16em 定宽/margin-right:auto 退役（不再有「推到行尾对右缘」的场景）");
  ok(/\.pb-ctx \.pat-now\{[^}]*max-width:22em[^}]*white-space:nowrap/.test(css),
    "★★ 型名胶囊截断——max-width:22em + 单行省略（胶囊可用宽比顶栏充裕，故 18em→22em；"
    + "nowrap 必需：少了它省略号失效、长型名折两行撑破 fixed 底栏高度）");
  /* v2.76.3 决定的是「状态行要与补偿读数/设置/主题钮**同高**」这件事，
     36px 只是当时的取值。v3.6.0（B4）把它抬到 40px 与全站触控下限对齐——
     等高带仍在（四者同一条规则），故按最新决定改写断言值而非删除断言。 */
  /* ★ v3.10.0：状态行整体搬去底栏右区（.pb-right，用户要求"与第 N–M 小节读数放一起"）——
     顶栏等高带收缩为三项，高度契约 40px 不变；状态行的新契约归 t170。 */
  ok(/\.topbar \.pill, \.topbar \.icon-btn, \.topbar \.lat-btn\{height:40px/.test(css),
    "★★ 顶栏**等高带**仍在（补偿读数/设置/主题钮同高共一条规则；取值 40px 是 v3.6.0"
    + "与全站触控下限对齐）；v3.10.0 起带内不再有 .status（已搬去底栏右区）");
  ok(/\.loop-btn, \.loop-btn:hover, \.loop-btn\[aria-checked="true"\]\{background:transparent;border:none\}/.test(css),
    "★★ v2.11.0（v3.12.0 补 border:none）：循环钮零背景图层（含 hover 与开启态）——"
    + "图标直接浮在页面背景上；基座 .jump-btn 补 1px 描边后这里必须显式去掉，否则循环钮会长出圆框");
  ok(!/\.viz-head \.bpm-row\{justify-content:space-between\}/.test(css),
    "★★ v3.39.0：`.viz-head .bpm-row` 两端对齐规则随快捷档行退役删除（步进群按内容宽住滑杆右侧，无行宽可摊）");
  ok(/\.card-head-left\{[^}]*width:min\(312px,100%\)/.test(css),
    "★★ v2.10.18：左列固定宽——宽度原先由内容（含节奏型名）驱动，名字变短列变窄、BPM 组跟着左移"
    + "（v2.39.0：320→352；v2.75.1 音量条缩 40px 让给 BPM 卡，组容器底吃掉 32px 内边距后型名可读宽度分毫不变）");
  ok(/\.card-head-left \.group\{width:100%;flex:1;justify-content:space-evenly\}/.test(css),
    "★★ v2.10.20：音量组撑满列内剩余高度、滑杆行距均摊——死空间从「状态灯↔音量标签」"
    + "转移进组内行距（用户反馈该处仍太大，要求增大音量条间隙）");
  ok(!/\.tr-dock\{/m.test(css),
    "★ Q5（v2.62.0）：`.tr-dock` 死样式随训练组壳重构一并清理（本文件已无元素挂此类，规则无使用者）；"
    + "此前这条断言是「保护」死样式的，清理后改为反向断言防回潮");
  ok(/\.bpm-num\{font-size:40px[^}]*min-width:80px/.test(css) && /\.step-btn\{width:40px;height:40px/.test(css)
     && !/#bpmPresetRow \.pill\{padding/.test(css),
    "★★ v2.10.19：大数字 40px/80、步进键 40px 仍在；v3.39.0 快捷档 32px 收窄规则随该行退役删除");
  ok(/\.dialog\{[^}]*backdrop-filter:blur\(8px\)/.test(css),
    "★ v2.10.17：设置浮层 backdrop 加毛玻璃模糊（压暗 + 模糊）");
  ok(/\.arg-jump\{display:grid;grid-template-columns:1fr auto 1fr/.test(css)
     && /\.trio\{display:flex;gap:10px;grid-column:2/.test(css)
     && /\.arg-jump > \.loop-btn\{grid-column:3;justify-self:start\}/.test(css),
    "★★ v2.10.23：跳段行三列 Grid——三键组**精确居中**（中列 auto），循环钮贴着三键组排"
    + "（用户要求：居中不考虑循环钮；循环隐藏时右列空置、三键组仍居中）");
  ok(/\.loop-btn\[aria-checked="true"\] \.ico-on\{display:block\}/.test(css)
     && /\.loop-btn\[aria-checked="true"\]\{color:var\(--green\)/.test(css),
    "★★ v2.10.22：循环钮双态图案按 aria-checked 切换（关=顺序循环 / 开=单曲循环+1），开启态绿色点亮");
  ok(!/^\.transport\{/m.test(css) && !/data-theme="obs"\] \.transport\{/m.test(css),
    "★ 走带卡删除后 `.transport` 两条规则（含观测台覆盖）一并清理，不留死样式");
  ok(!/^\.config\{/m.test(css),
    "★ v2.10.15：`.config` 规则随训练开关搬家一并清理（本文件已无使用者）");
  ok(!/^\.card-head-left-top/m.test(css),
    "★ v2.10.16：`.card-head-left-top` 上行包裹随标题删除一并清理");
  ok(/^\.pb-ctx \.pat-now\{/m.test(css) && !/^\.status \.pat-now\{/m.test(css),
    "★ 型名样式在位且宿主已换——`.pb-ctx .pat-now`（底栏胶囊），`.status .pat-now` 旧规则不留死样式");
  ok(!/^\.page-foot/m.test(css) && !/^\.caption\{/m.test(css) && !/\.page-foot\{/m.test(css),
    "★ v2.11.1：`.page-foot` 与 `.caption` 的**规则**随文案区删除一并清理（内容移入使用方法；"
    + "清理注释里保留名字作纪念不算违规）");
  ok(/--gt:6\.6px;--gtop:0px;--yT1:0px;--yT2:13\.2px;--yB1:19\.8px;--yB2:33px/.test(css),
    "★★ v2.10.16 立口径、v2.79.1 修正：窄屏六线几何「铺满」——(34−1)/5=6.6px 弦距、"
    + "线落 0..33（第六弦 33~34 从内侧贴底边，线体不再悬出格外）"
    + "（修复 v2.8.0 只改桌面档、窄屏仍留 v2.4.3 上下留白导致的「底纹铺不满」）");
  ok(/\.viz-rows\{display:flex;align-items:center;gap:8px;flex-wrap:wrap\}/.test(css),
    "★ 档位行容器 `.viz-rows` 规则保留（住在设置弹窗里，布局口径未变）");
  ok(!/\.viz-rows-row/.test(cssNoCmt),
    "★★ 退役容器的 CSS 一并清干净（`.viz-rows-row` / `.viz-rows-panel` 不留死规则）");
}

/* ================= 场景 T90e：搬家不得改变控件自身的行为契约 ================= */
section("T90e 回归护栏 · 搬家只动位置，id / 初始态 / 接线契约一件不改");
{
  const { beat, els } = loadApp();
  /* 挂载点与 id 未变 —— 这是"既有断言一行不用改"的前提，也是本组要守的东西 */
  ok(!!els["timbreRow"] && !!els["volMaster"] && !!els["vizRowsRow"],
    "三个容器的 id 仍能取到（未被改名；#vizRowsRow 换了位置但 id 未换）");
  eq(String(els["volMaster"].value), "80", "节拍音量初始 80%（桩里初值是数字，故并成字符串比对）");
  ok(els["volMasterPct"] === undefined && els["volStrumPct"] === undefined,
    "★ v3.39.1：音量行 % 文案已退役（读数只在收起态胶囊 #volPillPctN 上）");
  eq(els["timbreRow"].children[0].getAttribute("aria-pressed"), "true", "音色初始仍是电子");
  /* 接线仍在（handler 绑在容器上，随容器一起走）——这是搬家最容易踩坏、又最难发现的一类 */
  els["timbreRow"].fire("click", { target: pill({ timbre: "drum" }) });
  eq(beat.Store.S.timbre, "drum", "★ 搬家后音色档位点击仍生效");
  eq(els["timbreRow"].children[2].getAttribute("aria-pressed"), "true", "且高亮同步到鼓组");
  /* v3.12.0：拍号控件删除后，「切拍号」的唯一途径是**程序性对齐**（选型/跳段/听辨）。
     本组改为验那条路径仍然接得上 + 新增的启动归一（alignSigToPattern）真的起作用。 */
  {
    const idx6 = beat.BUILTINS.findIndex(p => p.meter === 6);
    ok(idx6 >= 0, "前提：存在 6/8 的内置型");
    beat.Store.S.sel = { type: "builtin", idx: idx6 };
    beat.Presets.alignSigToPattern();
    eq(beat.Store.S.sig, 6, "★★ 选 6/8 型 → 拍号自动对齐（控件删除后这条路径是唯一入口）");
    const idx4 = beat.BUILTINS.findIndex(p => p.meter === 4);
    beat.Store.S.sel = { type: "builtin", idx: idx4 };
    beat.Presets.alignSigToPattern();
    eq(beat.Store.S.sig, 4, "★ 切回 4/4 型 → 拍号跟着回 4（不会卡在上一个）");
    /* 手动拍号控件没了 → 界面不再有任何入口能把 sig 改到与选中型不一致 */
    ok(!els["sigRow"], "★★ 桩里 `#sigRow` 已不存在（控件删除）");
  }
  /* v2.10.13：BPM 组进时值卡、v2.10.14 再进卡片头——接线（bindStep / 档位点击）必须跟着走。
     ★ bindStep 的 click 兜底只认 `e.detail === 0`（键盘/读屏激活；指针路径由 pointerdown
       步进、detail ≥ 1）——桩的 fire 不带 detail，必须显式传 0 模拟键盘激活。 */
  /* v2.10.13：BPM 组进时值卡、v2.10.14 再进卡片头——接线（bindStep / 档位点击）必须跟着走。
     ★ bindStep 的 click 兜底只认 `e.detail === 0`（键盘/读屏激活；指针路径由 pointerdown
       步进、detail ≥ 1）——桩的 fire 不带 detail，必须显式传 0 模拟键盘激活。 */
  const bpm0 = beat.Store.S.bpm;
  els["bpmMinus"].fire("click", { detail: 0 });
  eq(beat.Store.S.bpm, bpm0 - 1, "★ BPM「-1」按钮搬家后仍生效");
  els["bpmPlus"].fire("click", { detail: 0 });
  eq(beat.Store.S.bpm, bpm0, "★ BPM「+1」回到原值");
  eq(+els["bpmNum"].textContent, bpm0, "大数字同步（接线在，显示就跟手）");
  els["swingRow"].fire("click", { target: pill({ swing: "67" }) });
  eq(beat.Store.S.swing, 67, "★ Swing 档位点击仍生效");
}

/* ================= 场景 T90z：段名位 · v2.25.4 chip 化 → v3.36.18 搬进底栏胶囊 =================
   #argNowName 的四个状态写入点不变；变的是**它的形态与位置**：
     · v2.25.4 给它加了 chip 描边 + 「当前曲式 · 」前缀（纯 CSS ::before，写入点零改动）；
     · v3.36.18 它从抽屉**搬进底栏胶囊**（与型名并列）——外壳交还胶囊本体，前缀退役
       （胶囊只有 176px 给两个名字，每 px 都算数，语义改由胶囊 title 承担），
       空值收显从 :empty 改成 [hidden]（空壳在 flex 胶囊里会吃掉一个 gap），
       而 v2.35.0 的「单曲式隐藏」整条退役——职责已从"服务哪一条曲式"变成"我在第几段"。 */
section("T90z 段名位 · ★ 底栏胶囊内、CSS 出分隔符、[hidden] 收显（写入点仍零改动）");
{
  const css = slice("css");
  ok(css.includes(".pb-ctx .arg-now-name:not([hidden]):not(:empty)::after"),
     "★ 段名与型名之间的「 · 」由 CSS ::after 提供——四个 textContent 写入点一行不改");
  ok(css.includes(".pb-ctx .arg-now-name[hidden]{display:none}"),
     "★ 无段名时整枚位收起（[hidden]；不用 :empty——空壳会吃掉 flex gap）");
  ok(!css.includes('.arg-now-name::before{content:"当前曲式 · "'),
     "★★ v3.36.18：「当前曲式 · 」前缀退役（窄胶囊放不下，语义改由胶囊 title 承担）");
  ok(!css.includes(".arg-now.single .arg-now-name{display:none}"),
     "★★ v2.35.0 的「单曲式隐藏」退役——它现在的职责是「我在第几段」，单曲式同样有信息量");
  ok(/\.arg-now-name\{[^}]*text-overflow:ellipsis/.test(css),
     "★★ 截断仍在：窄胶囊里段名过长走省略号，不把型名挤出胶囊");
}

/* ================= 场景 T90aa：音量说明行的触屏可达（v3.36.10，批次② D3） =================
   审计 C-8：三条音量条的说明此前**只有** title（悬停）与 aria-label（读屏）——触屏明眼用户
   拿不到（没有悬停）。口径按本仓既有的 hover 分档：**默认（触屏）显出来**，桌面由同一块
   媒体查询收起（与 .preset-item 的图标同一条分档，故写进同一块而不是另起一块）。 */
section("T90aa 音量说明行 · ★★ 触屏常显、桌面随 hover 分档收起（审计 C-8）");
{
  const css = slice("css");
  ok(/\.vol-note\{[^}]*font-size:11px/.test(css), "★ .vol-note 有基础样式（触屏常显的那一半）");
  /* ★ 块提取口径与 t101 一致（行首 } 收尾）。两条断言必须落在**同一块**文本上——
     若有人把 .vol-note 挪进另一块媒体查询，t101 的 indexOf 会先命中别处，两条会一起红。 */
  const mi = html.indexOf("@media (hover: hover) and (pointer: fine)");
  const block = html.slice(mi, html.indexOf("\n}", mi) + 2);
  ok(block.includes(".vol-note{display:none}"),
     "★★ 桌面（可 hover）收起音量说明——与 .preset-item 图标同一条分档口径，写在同一块里");
  /* ★★ 文案链路的断言走**标记 + 源码**，不走 DOM 属性：桩是孤立静态桩（本文件头部第 18-19 行
     已写明"桩不解析 HTML，静态元素 parentNode 恒 null"），而 `HTML_ATTRS` 只登记了
     bpmSlider / wallDim / latMs 三个 id —— `#volMaster` 的 aria-label 在桩里读不到（恒 null）。
     真实 DOM 里这一链路由真机探针验（见本轮 CHANGELOG 的实测记录）。 */
  eq((html.match(/class="vol-note"/g) || []).length, 2,
    "★ 两条音量条各挂一枚 .vol-note（说明行的容器；v3.39.0 重拍增强条退役后 3→2）");
  eq((html.match(/class="vol-note" id="\w+Note" aria-hidden="true"/g) || []).length, 2,
    "★★ 说明行对读屏隐藏（aria-label 已表达同一件事，避免被读两遍）");
  ok(/note\.textContent = inp\.getAttribute\("aria-label"\)/.test(html),
    "★★ 文案从滑杆自己的 aria-label 抄——**单一来源**（不写第二份文案，改一处即两处同步）");
  ok(/const inp = \$\(pair\[0\]\), note = \$\(pair\[1\]\);/.test(html) && !/pair\[0\]\]\)\.parentNode/.test(html),
    "★ 接线**不用 closest()/parentNode**——桩的 closest 只返回空代理、parentNode 恒 null，"
    + "用它们这段会在桩里静默失效（本仓反复踩过的「桩比真机宽松」）");
}
