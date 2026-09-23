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
  vizHead: ['<div class="card-head viz-head">', '<!-- 视听辅助开关', "时值卡头行（标题+音量+BPM+状态灯）"],
  togglesRow: ['<div class="viz-toggles">', '<!-- 同屏行数档位', "预备拍 + 训练开关行"],
  rowsRow: ['<div class="viz-rows-row">', '<div class="viz" id="viz"', "同屏行数 + 拍号 + Swing 的并排行"],
  jumpRow: ['<div class="arg-now arg-jump" id="argJump">', '<div class="caption">', "跳段 + 播放行"],
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

/* ================= 场景 T90a：拍号并入「同屏行数」右侧 ================= */
section("T90a 需求① · 拍号整块搬进时值可视化卡，与「同屏行数」同处 .viz-rows-row 且在其后");
{
  const s = slice("rowsRow");
  ok(/id="vizRowsRow"/.test(s), "同屏行数档位 `#vizRowsRow` 在新容器内");
  ok(/id="sigRow"/.test(s), "★ 拍号 `#sigRow` 也搬进来了");
  ok(s.indexOf('id="vizRowsRow"') < s.indexOf('id="sigRow"'),
    "★★ 拍号排在「同屏行数」**之后**（即其右侧，与「紧邻右侧」的要求一致）");
  /* 奇数拍才出现的「重拍分组」是拍号的语义附属物，必须跟着搬——留在走带卡里就没人能触发它 */
  ok(/id="accGroup"/.test(s) && /id="accRow"/.test(s),
    "★ `#accGroup` / `#accRow`（重拍分组）跟着拍号一起搬（它是拍号的语义附属物）");
  /* 搬块不换内容：6 档拍号都在；行数档位仍由值表在运行期生成 */
  eq((s.match(/data-sig="/g) || []).length, 6, "拍号 6 档无一丢失");
  ok(/data-sig="7"/.test(s), "最高档 7/4 在位");
  eq((s.match(/data-rows="/g) || []).length, 0,
    "同屏行数档位仍由 VIZ_ROW_COUNTS 运行期生成（标记里不写死，单一数据源不破）");
}

/* ================= 场景 T90b：当前节奏型行删除；名字进播放键行；标题/状态灯落位 ================= */
section("T90b v2.10.16 · .pattern-head 整块删除；#patternName 进跳段行；#vizTitle 删除；状态灯入左列");
{
  /* ① 「当前节奏型」裸行整块删除（名字搬进跳段行、meta 删除） */
  ok(!/class="pattern-head"/.test(html), "★ `.pattern-head` 裸行已整块删除（名字去跳段行、meta 删）");
  ok(!/id="patternMeta"/.test(html), "★ #patternMeta（4/4 拍 · N BPM）已删——拍号看 pill、速度看 BPM 大字");
  ok(html.indexOf('id="patternName"') > html.indexOf('id="statusText"'),
    "★ #patternName 在状态灯行内、状态文案之后（「● 已停止　十六分满扫」，用户要求④）");
  /* ② 标题 #vizTitle 整块删除（含「· 4/4」——用户拍板连它一起删），JS 写入点不复存在 */
  ok(!/id="vizTitle"/.test(html), "★ #vizTitle 已整块删除（与状态灯重复；卡片以角标 01 Rhythm Map 为名）");
  /* ③ 状态灯入左列：角标 → 状态灯 → 音量（与标题同列上下分布） */
  const h = slice("vizHead");
  ok(/class="sec-tag"/.test(h) && /class="status"/.test(h) && /id="statusDot"/.test(h) && /id="statusText"/.test(h),
    "★ 状态灯（#statusDot/#statusText）搬进卡片头左列");
  ok(h.indexOf("sec-tag") < h.indexOf('class="status"')
     && h.indexOf('class="status"') < h.indexOf('id="volMaster"'),
    "★★ 左列顺序：角标 → 状态灯 → 音量（状态灯在标题位、音量之上）");
  ok(h.indexOf('id="volMaster"') < h.indexOf('id="bpmNum"'), "左列（音量）在源码序上先于右列（BPM）");
  ok(/id="volStrumRow"/.test(h), "音量三条（含扫弦行 id）都在左列");
  /* ④ 设置弹窗结构与 v2.10.13 一致 */
  const st = slice("settingsOverlay");
  for (const g of ["外观与辅助", "发声", "数据与说明"]){
    ok(st.includes(g), "★ 设置弹窗分三组之一：「" + g + "」");
  }
  for (const id of ["themeToggle", "bounceToggle", "tabToggle", "timbreRow", "swingRow",
                    "exportBtn", "importBtn", "exportAllBtn", "importAllBtn", "helpBtn"]){
    ok(new RegExp('id="' + id + '"').test(st), "★ 设置弹窗 10 项之一：#" + id + (id === "swingRow" ? "（v2.10.17 Swing 入发声组）" : ""));
  }
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
    "范围循环 = jump-btn 同款圆钮（v2.10.22 双态图标）");
  ok(/aria-label="上一段"/.test(s) && /aria-label="下一段"/.test(s) && /aria-label="范围循环"/.test(s),
    "图标化后 aria-label 是唯一名字，三枚都要保留");
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
section("T90f v2.10.14/16 · BPM 组占卡片头右列；Swing 与同屏行数平齐（排拍号右侧）");
{
  const h = slice("vizHead");
  ok(/id="bpmNum"/.test(h) && /id="bpmSlider"/.test(h) && /id="tapBtn"/.test(h)
     && /id="bpmPresetRow"/.test(h) && /id="bpmTicks"/.test(h),
    "★ BPM 整组四层（步进行/滑杆/TAP/快捷档 + 刻度层）都在卡片头行内");
  ok(h.indexOf('id="volMaster"') < h.indexOf('id="bpmNum"'),
    "★ 头行两个孩子：左列（角标/状态灯/音量）在前、BPM 在后（源码序即左右序）");
  ok(/class="card-head-left"/.test(h), "左块包 .card-head-left（v2.10.16 起头行只有两个孩子）");
  ok(!/id="swingRow"/.test(h), "Swing 不在头行（已下移）");
  const r = slice("rowsRow");
  ok(/id="vizRowsRow"/.test(r) && /id="sigRow"/.test(r),
    "★ 同屏行数 + 拍号两块同处一行");
  ok(!/id="swingRow"/.test(r), "★ Swing 已不在本行（v2.10.17 进设置弹窗——折行问题随之消失）");
  ok(!/id="bpmNum"/.test(r), "BPM 组不在本行（已上移卡片头）");
}

/* ================= 场景 T90h：训练开关并入预备拍行 ================= */
section("T90h v2.10.15/16 · 静音拍 + 变速训练并入 .viz-toggles；训练区标题行删除、只剩按钮与面板");
{
  const s = slice("togglesRow");
  for (const id of ["countInToggle", "countInBeatsWrap", "muteToggle", "trainerToggle"]){
    ok(new RegExp('id="' + id + '"').test(s), "★ 预备拍行的四件之一：#" + id + "（训练两开关已并入）");
  }
  ok(s.indexOf('id="countInToggle"') < s.indexOf('id="muteToggle"')
     && s.indexOf('id="muteToggle"') < s.indexOf('id="trainerToggle"'),
    "行内顺序：预备拍 → 静音拍 → 变速训练");
  /* 训练区只剩「继续上次训练」按钮与面板——标题行（02 Training 训练模式）已整行删除 */
  ok(!/<i>Training<\/i>/.test(html), "★ 「02 Training 训练模式」标题行已删（v2.10.16）");
  ok(/id="trResumeBtn"/.test(html) && /id="trainerPanel"/.test(html) && /id="trStart"/.test(html)
     && /id="planGenBtn"/.test(html),
    "★ 训练区内容保留：继续上次训练按钮 + 变速训练面板（含 7 天计划）都在");
  eq((html.match(/id="muteToggle"/g) || []).length, 1,
    "静音拍开关全文件恰此一处（在预备拍行，训练区已无副本）");
  ok(!/class="config"/.test(html), "★ `.config` 包裹层随开关搬家删除（本文件已无使用者）");
}

/* ================= 场景 T90d：两条 CSS 契约（③选丙 + (ii) 补齐） ================= */
section("T90d CSS 契约 · 开关行去左内边距（丙）；音量列宽；跳段键 52px；页底提示行；窄屏六线铺满");
{
  const css = slice("css");
  ok(/\.viz-toggles \.toggle-pill\{padding-left:0\}/.test(css),
    "★★ ③选丙：`.viz-toggles .toggle-pill` 左内边距归零（开关文字落到卡片内容边缘）");
  /* ★ 作用域必须限定在 .viz-toggles 内：改成全局 .toggle-pill 会是全站开关的观感变更 */
  ok(!/^\.toggle-pill\{[^}]*padding-left:0/m.test(css),
    "★ 且没顺手把全局 `.toggle-pill` 也改掉（那是全站开关，不在本次范围）");
  ok(!/^\.pattern-head\{/m.test(css),
    "★ v2.10.16：`.pattern-head` 规则随裸行删除一并清理（v2.10.11 的 (ii) 内边距契约退役）");
  ok(/\.viz-rows-row\{[^}]*flex-wrap:wrap[^}]*\}/.test(css),
    "★ `.viz-rows-row` 必须 flex-wrap：否则窄屏下拍号不折行会溢出（被 body 的 overflow-x:hidden 裁掉）");
  /* v2.10.14：行数 pill 的缩小规则删除（与拍号统一大小）；Swing 进本行后同款 wrap 兜底不变 */
  ok(!/^\.viz-rows \.pill\{/m.test(css),
    "★★ 用户要求④：`.viz-rows .pill{padding:7px 14px…}` 缩小规则已删——同屏行数与拍号的按钮统一为默认 .pill 规格（实测 31px → 36px）");
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
  ok(/\.viz-rows-panel\{[^}]*gap:10px/.test(css),
    "★ v2.10.17：`.viz-rows-panel` 的 label→内容间距与 .group 同值（10px）——修「行数与拍号差 3px 没对齐」");
  ok(/\.viz-toggles\{[^}]*margin-bottom:16px/.test(css) && /\.viz-rows-row\{[^}]*gap:16px 28px/.test(css),
    "★★ v2.10.17：块间纵向间隔统一 16px（预备拍行下边距、行内折行行距；横向 28 保留）");
  ok(/\.viz-head\{[^}]*justify-content:flex-start[^}]*column-gap:48px/.test(css),
    "★ v2.10.17：卡片头紧凑排列——BPM 组紧随音量列 48px（原 space-between 中间空 239px）");
  ok(/\.status #statusText\{min-width:16em;margin-right:auto\}/.test(css),
    "★★ v2.10.17+11.0：状态文案固定最小宽度防抖 + margin-right:auto 把节奏型名推到行尾，"
    + "与音量行的百分号列同一右缘对齐");
  ok(/\.status\{[^}]*width:100%\}/.test(css),
    "★ v2.11.0：状态行撑满左列宽（列是 flex-start，子项不自动拉伸）");
  ok(/\.loop-btn, \.loop-btn:hover, \.loop-btn\[aria-checked="true"\]\{background:transparent\}/.test(css),
    "★★ v2.11.0：循环钮零背景图层（含 hover 与开启态）——图标直接浮在页面背景上");
  ok(/\.viz-head \.bpm-row\{justify-content:space-between\}/.test(css),
    "★★ v2.11.0：BPM 组两行按钮两端对齐（-5↔60 左缘、+5↔120 右缘）");
  ok(/\.card-head-left\{[^}]*width:min\(320px,100%\)/.test(css),
    "★★ v2.10.18：左列固定 320px——宽度原先由内容（含节奏型名）驱动，名字变短列变窄、BPM 组跟着左移");
  ok(/\.card-head-left \.group\{width:100%;flex:1;justify-content:space-evenly\}/.test(css),
    "★★ v2.10.20：音量组撑满列内剩余高度、滑杆行距均摊——死空间从「状态灯↔音量标签」"
    + "转移进组内行距（用户反馈该处仍太大，要求增大音量条间隙）");
  ok(/\.tr-dock\{display:contents\}/.test(css),
    "★★ v2.10.18：训练组壳子 display:contents——隐藏时不占 20px 间隔槽（预设库上方 44→24px）");
  ok(/\.bpm-num\{font-size:40px[^}]*min-width:80px/.test(css) && /\.step-btn\{width:40px;height:40px/.test(css)
     && /#bpmPresetRow \.pill\{padding:7px 14px;font-size:12px\}/.test(css),
    "★★ v2.10.19：BPM 组降一档（大数字 40px/80、步进键 40px、快捷档 32px）——"
    + "头行变矮，左列剩余空间（状态灯↔音量空隙）同步收紧");
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
  ok(/^\.status \.pat-now\{/m.test(css),
    "★ v2.10.17：`.status .pat-now`（状态灯行里的当前节奏型名）样式在位");
  ok(/^\.page-foot\{/m.test(css),
    "★ v2.10.16：`.page-foot`（页面底部提示行，与 .main 同源内边距）样式在位");
  ok(/--gt:6\.8px;--gtop:0px;--yT1:0px;--yT2:13\.6px;--yB1:20\.4px;--yB2:34px/.test(css),
    "★★ v2.10.16：窄屏六线几何改为「铺满」——34/5=6.8px 弦距、线落 0..34 上下零留白"
    + "（修复 v2.8.0 只改桌面档、窄屏仍留 v2.4.3 上下留白导致的「底纹铺不满」）");
  ok(/\.viz-rows-row > \.viz-rows-panel\{margin-bottom:0\}/.test(css),
    "★ 行内 `.viz-rows-panel` 的下边距归零（否则行距叠加成 24px）");
}

/* ================= 场景 T90e：搬家不得改变控件自身的行为契约 ================= */
section("T90e 回归护栏 · 搬家只动位置，id / 初始态 / 接线契约一件不改");
{
  const { beat, els } = loadApp();
  /* 挂载点与 id 未变 —— 这是"既有断言一行不用改"的前提，也是本组要守的东西 */
  ok(!!els["sigRow"] && !!els["timbreRow"] && !!els["volMaster"],
    "三个容器的 id 仍能取到（未被改名）");
  eq(els["sigRow"].children.length, 6, "拍号 6 颗 pill 仍挂在 #sigRow 上（按钮由 syncSigUI 生成，未散落）");
  eq(els["sigRow"].children[2].getAttribute("aria-pressed"), "true", "拍号初始仍是 4/4 选中");
  eq(els["accGroup"].hidden, true, "★ 重拍分组默认隐藏（跟随拍号搬走后 hidden 初值必须保留）");
  eq(String(els["volMaster"].value), "80", "节拍音量初始 80%（桩里初值是数字，故并成字符串比对）");
  eq(els["volMasterPct"].textContent, "80%", "百分比文案与滑杆一致");
  eq(els["timbreRow"].children[0].getAttribute("aria-pressed"), "true", "音色初始仍是电子");
  /* 接线仍在（handler 绑在容器上，随容器一起走）——这是搬家最容易踩坏、又最难发现的一类 */
  els["timbreRow"].fire("click", { target: pill({ timbre: "drum" }) });
  eq(beat.Store.S.timbre, "drum", "★ 搬家后音色档位点击仍生效");
  eq(els["timbreRow"].children[2].getAttribute("aria-pressed"), "true", "且高亮同步到鼓组");
  els["sigRow"].fire("click", { target: pill({ sig: "6" }) });
  eq(beat.Store.S.sig, 6, "★ 搬家后拍号切换仍生效");
  eq(els["sigRow"].children[4].getAttribute("aria-pressed"), "true", "6/8 高亮置位");
  /* 门控条件别写错：`ACC_GROUPS` **只有 5 与 7**（6/8 没有重拍分组）——
     所以 6/8 下必须仍然隐藏，拿 6/8 去验"现身"是假期望（本用例第一版就错在这里） */
  eq(els["accGroup"].hidden, true, "6/8 无重拍分组（ACC_GROUPS 只有 5/7）→ 仍隐藏");
  els["sigRow"].fire("click", { target: pill({ sig: "7" }) });
  eq(beat.Store.S.sig, 7, "切到 7/4");
  eq(els["sigRow"].children[5].getAttribute("aria-pressed"), "true", "7/4 高亮置位");
  eq(els["accGroup"].hidden, false, "★ 7/4 下重拍分组现身（搬走后门控仍接得上）");
  /* `#accRow` 由桩按需惰性创建（`refreshAccRow` 在 sig 非 5/7 时提前 return，不会碰到它），
     所以这一步同时验"按钮宿主没搬丢"——搬丢了这里会取不到或个数为 0 */
  ok(!!els["accRow"] && els["accRow"].children.length === 2,
    "且重拍分组 2 档已生成（`buildPillRow` 的宿主 `#accRow` 没搬丢）",
    "children=" + (els["accRow"] ? els["accRow"].children.length : "无此元素"));
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
