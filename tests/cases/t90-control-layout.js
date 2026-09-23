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
  rowsRow: ['<div class="viz-rows-row">', '<div class="viz" id="viz"', "同屏行数 + 拍号 的并排行"],
  patternHead: ['<div class="pattern-head">', "<!-- 拍号回退提示", "当前节奏型行"],
  transport: ['<section class="card transport">', "<!-- 训练模式", "走带卡"],
  settingsOverlay: ['<div class="editor" id="settingsOverlay"', "<!-- ================= 应用内弹窗", "设置弹窗"],
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

/* ================= 场景 T90b：音色进设置、编辑节奏型去侧栏、音量留在主行 ================= */
section("T90b v2.10.12 · 音色进设置弹窗、编辑节奏型去侧栏；当前节奏型行右侧只剩音量");
{
  const s = slice("patternHead");
  /* ① 音量留在主行（用户拍板 4）：它是练习中会实时调的高频控件 */
  ok(/id="volMaster"/.test(s) && /id="volStrum"/.test(s) && /id="volAccent"/.test(s),
    "★ 音量三条滑杆仍留在当前节奏型行（练习中会实时调）");
  /* ② 音色已搬进设置弹窗 */
  ok(!/id="timbreRow"/.test(s) && !/data-timbre=/.test(s), "★ 音色已不在当前节奏型行");
  /* ③ 编辑节奏型已搬去侧栏（跨列） */
  ok(!/id="editBtn"/.test(s), "★ 编辑节奏型已不在当前节奏型行");
  /* ④ v2.10.11 为窄屏整组折行加的 `.ph-controls` 包裹层撤掉（只剩一件，不必再包） */
  ok(!/class="ph-controls"/.test(s), "★ `.ph-controls` 包裹层已撤（只剩一件）");
  /* ⑤ 设置弹窗里的三组标题与 9 项齐全（用户要求① + 分组 + 追加的导入导出） */
  const st = slice("settingsOverlay");
  for (const g of ["外观与辅助", "发声", "数据与说明"]){
    ok(st.includes(g), "★ 设置弹窗分三组之一：「" + g + "」");
  }
  for (const id of ["themeToggle", "bounceToggle", "tabToggle", "timbreRow",
                    "exportBtn", "importBtn", "exportAllBtn", "importAllBtn", "helpBtn"]){
    ok(new RegExp('id="' + id + '"').test(st), "★ 设置弹窗 9 项之一：#" + id);
  }
  /* ⑥ 两个隐藏的 file input 也跟着搬（按钮点击后触发它们，留在原处就成了死链） */
  ok(/id="importFile"/.test(st) && /id="importAllFile"/.test(st), "★ 两个 file input 随按钮一起搬");
}
/* ================= 场景 T90c：走带卡只剩 BPM 与 Swing ================= */
section("T90c 走带卡收口 · 只剩 BPM 与 Swing，且多余的分隔线已删（不留双竖线）");
{
  const s = slice("transport");
  ok(/id="bpmNum"/.test(s) && /id="bpmSlider"/.test(s) && /id="tapBtn"/.test(s),
    "BPM 组仍在本卡（拍号搬走不该动它）");
  ok(/id="swingRow"/.test(s), "Swing 组仍在本卡");
  ok(!/id="sigRow"/.test(s) && !/id="accGroup"/.test(s), "★ 拍号已不在走带卡内");
  ok(!/id="timbreRow"/.test(s), "★ 音色已不在走带卡内");
  ok(!/id="volMaster"/.test(s) && !/id="volStrum"/.test(s) && !/id="volAccent"/.test(s),
    "★ 音量三条已不在走带卡内");
  /* 原来 5 个 group 之间有 4 条分隔线；搬走 3 个 group 后应只剩 1 条 */
  eq((s.match(/class="vdivider"/g) || []).length, 1,
    "★★ 只剩 1 条 `.vdivider`（BPM ‖ Swing）——多留一条就会连成双竖线");
  eq((s.match(/class="group"/g) || []).length, 2, "本卡恰好 2 个 group（BPM / Swing）");
}

/* ================= 场景 T90d：两条 CSS 契约（③选丙 + (ii) 补齐） ================= */
section("T90d CSS 契约 · 开关行去左内边距（丙）；当前节奏型行补上与 .card 同值的内边距（ii）");
{
  const css = slice("css");
  ok(/\.viz-toggles \.toggle-pill\{padding-left:0\}/.test(css),
    "★★ ③选丙：`.viz-toggles .toggle-pill` 左内边距归零（开关文字落到卡片内容边缘）");
  /* ★ 作用域必须限定在 .viz-toggles 内：改成全局 .toggle-pill 会是全站开关的观感变更 */
  ok(!/^\.toggle-pill\{[^}]*padding-left:0/m.test(css),
    "★ 且没顺手把全局 `.toggle-pill` 也改掉（那是全站开关，不在本次范围）");
  ok(/\.pattern-head\{[^}]*padding:0 24px[^}]*\}/.test(css),
    "★★ (ii)：`.pattern-head` 桌面补 `padding:0 24px`（与 `.card` 同值）");
  ok(/\.pattern-head\{[^}]*padding:0 16px[^}]*\}/.test(css),
    "★ 窄屏同步成 `padding:0 16px`（`.card` 在 ≤960px 也是 16px；漏改就会在窄屏重新错开 16px）");
  ok(/\.viz-rows-row\{[^}]*flex-wrap:wrap[^}]*\}/.test(css),
    "★ `.viz-rows-row` 必须 flex-wrap：否则窄屏下拍号不折行会溢出（被 body 的 overflow-x:hidden 裁掉）");
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
}
