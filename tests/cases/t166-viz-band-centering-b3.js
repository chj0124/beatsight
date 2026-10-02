/* BeatSight 自动化测试 · B3 可视化带垂直居中真正生效 + 左缘绿条改行首短标（v3.5.0）
   ---------------------------------------------------------------------------
   ★★★ 本批的起因是**实测推翻了原计划的前提**，故断言以实测值为准，不以计划值为准。

   原计划（B3 方案文档）打算做三件事，实测后逐一核对：
     ① 行高公式 `clamp(40, 行宽÷每行拍数÷2.8, 120)` —— **不成立**。
        无头 Chrome 实测（1440×900，逐档点真实按钮）：四档行高**恒为 86px**、格高**恒为
        44px**、格宽恒 87px（1280 视口下 77px，只随视口宽变、不随行数变）。
        `.bar-row{height:86px}` 是硬编码固定值，压根没有"按可用高度分配行高"这条路径。
        用户当初报的"1 行时格子被纵向拉长"在**真实应用**里不存在（87×44 ≈ 1.98:1）。
        → 强行套公式等于凭空改一个没问题的东西，故不做。
     ② "上下余量均分" —— **测错了，不是真问题**。
        第一版探针把「band.top − main.top = 446px」当成上方留白，实际那是**控制卡自身高度**
        （.main 的唯一子块 <col> 共 817px = 控制卡 422 + 可视化带 395）；下方 120px 则是
        `--bar-h 96 + 24` 对 fixed 底库的**有意让位**。两侧都不是浪费空间。
     ③ 垂直居中 —— **真问题，且 v3.3.1 就想修但从未生效**。
        `.viz-band{margin-block:auto}` 在 grid 里要靠"行内剩余高度"才能分配，而
        `.main{align-items:start}` 让子项按内容收缩、.main 自身也只包内容 →
        没有剩余高度可分，auto 边距**恒解析为 0**。实测 margin-block = 0px / 0px。
        这正是 v3.3.1 注释里写的「同屏行数 = 1 时页面太空旷」的病根，躺了三个版本没修。

   契约（改动前先钉死，改码后必须全绿）：
     ① .main 拿到一屏高的 min-height 下限（vh 后紧跟 dvh 兜底），让 auto 边距有空间可分；
     ② 下限必须扣掉 --bar-h 与 24px——否则内容会被 fixed 底栏压住（尾行遮挡）；
     ③ 不得改 .main 的 align-items：stretch 会波及卡内对齐契约（t90 有断言）；
     ④ 左缘绿条由通高（inset 3px 0 0）改行首短标（inset 3px 24px 0），底纹 .12 不变；
        ★ v3.8.0 订正：④ 的实现是几何 bug——inset 3px 24px 0 0 渲染为 L 形通宽带而非短标
        （断言只比 CSS 字符串所致）；v3.8.0 改单层渐变背景实现真短标、底纹随用户裁决回 .07，
        T151c 已同步改写；
     ⑤ 行高/格高**一个字都不许动**（本批最大的风险是把 86px 改坏，故钉死为反向不变量）。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

/* ================= T151a：.main 拿到一屏高度下限（居中得以生效的前提） ================= */
section("T151a .main 有 min-height 一屏下限，auto 边距才可能分配");
{
  /* ★ 取**全部** .main 规则的并集，不要只取第一条：min-height 写在独立的一条
     （首条 .main 是 v2.11.1 的 grid 基座，不含它）。取首条的写法会静默判红。 */
  const mainRules = (CSS.match(/^\.main\{[^}]*\}/gm) || []).join("\n");
  const b = /\.main\{min-height:([^};]+)/.exec(CSS);
  ok(!!b, "★★ .main 有 min-height 声明（v3.3.1 的 margin-block:auto 此前恒为 0px）");
  ok(/min-height/.test(mainRules),
    "★★ min-height 落在 .main 自身规则上（独立一条也可，但必须作用于 .main）");
  /* 下限必须扣掉底栏与让位，否则末行被 fixed 底栏压住。
     ★ 用**精确整串**比对，不用捕获组：这条 .main 规则里挤了两条 min-height，
       正则的 [^)] 与 [^}] 都会在同一行的第二个 } 处截断（两种都试过、都静默判红）。
       契约本身就值得精确到字符——"扣了 bar-h 与 24px"不该有第二种写法。 */
  ok(/min-height:calc\(100dvh - var\(--bar-h\) - 24px\)/.test(CSS),
    "★★ 下限精确为 100dvh − var(--bar-h) − 24px：底栏 fixed 不扣高会盖住末行下缘，"
    + "24px 与 .main 自身 padding 同值（别让内容贴住视口下缘）");
  ok(/min-height:calc\(100vh - var\(--bar-h\) - 24px\)/.test(CSS),
    "★ 100vh 那条同值口径也在（不支持 dvh 的旧浏览器据此兜底）");
  /* vh 在前、dvh 在后：同优先级下后者覆盖前者，是刻意的渐进增强顺序 */
  const order = CSS.indexOf("min-height:calc(100vh") < CSS.indexOf("min-height:calc(100dvh");
  ok(order,
    "★ 100vh 声明在 100dvh 之前（同优先级下后者生效 = 渐进增强，"
    + "不支持 dvh 的旧浏览器落到 vh 而不是失去高度下限）");
}

/* ================= T151b：不得动 align-items（波及面守卫） ================= */
section("T151b .main 保持 align-items:start，不靠 stretch 改居中");
{
  const mainRules = (CSS.match(/^\.main\{[^}]*\}/gm) || []).join("\n");
  ok(/align-items:start/.test(mainRules),
    "★★ align-items 仍是 start——改 stretch 会把 .card 等块拉高，"
    + "卡内对齐（音量组沉底，t90 有断言）随之改变，属波及面大得多的改法");
}

/* ================= T151c：行首短标（v3.8.0 改写：修 B3 几何 bug） ================= */
section("T151c .bar-row.current 为真·24px 行首短标（渐变实现），底纹回 .07");
{
  const rule = (html.match(/^\.bar-row\.current\{[^}]*\}/m) || [""])[0];
  ok(!!rule, "★ 规则在位");
  ok(/linear-gradient\(var\(--green\),var\(--green\)\) left top\/3px 24px no-repeat/.test(rule),
    "★★ 短标 = 单层渐变 3px×24px 贴左上不重复——B3 原意图的真正落地");
  ok(!/box-shadow/.test(rule),
    "★★ 无 box-shadow：inset 阴影画的是盒差集，3px 24px 偏移实为 L 形（左缘通高条 ∪ 顶部"
    + "通宽带）——这正是用户实拍里那条压暗读谱区的大绿带的来源（B3 几何 bug，v3.8.0 修）");
  ok(/rgba\(30,215,96,\.07\)/.test(rule),
    "★ 底纹 .07（v3.8.0 用户裁决退回 v3.3.1 强度：.12 亮带牺牲未弹格读谱对比度，不值）");
  ok(/border-radius:8px/.test(rule), "★ 圆角保留（短标贴左缘，背景随圆角自然收角）");
}

/* ================= T151d：反向不变量——行高与格高一个字都不许动 ================= */
section("T151d 行高 86px / 格高 44px 保持固定（本次最大的回归风险）");
{
  ok(/^\.bar-row\{position:relative;height:86px/m.test(CSS),
    "★★ .bar-row 仍是 height:86px 固定值——B3 最大的风险就是手滑把它改成自适应，"
    + "实测四档行高恒 86px，说明固定值本来就是对的");
  ok(/\.cell\{position:absolute;top:0;height:44px/.test(CSS),
    "★★ .cell 仍是 height:44px（格高 44 与弦距 --gt:8.6px 六线几何是一套，改了线就出格）");
  ok(/--gt:8\.6px/.test(CSS),
    "★ 弦距 --gt 仍按 44px 格高派生（(44−1)/5），未与格高脱钩");
}

/* ================= T151e：固定行高下"格子被拉长"确实不存在 ================= */
section("T151e 格子宽高比与行数无关（为「不改行高」这一决策留证据）");
{
  /* 这条断言钉的是**决策依据**而非渲染结果：实测四档格宽高比恒 ≈1.98:1（1440 视口），
     说明用户报的"1 行被纵向拉长"来自别处（或来自早期版本），不是当前行高策略的锅。
     匹配不用 ^ 锚：样式表里部分规则并非顶格书写，顶格锚会静默判红（教训已记）。 */
  ok(/\.bar-row\{[^}]*height:86px/.test(CSS) && /\.cell\{[^}]*height:44px/.test(CSS),
    "★ 现状即证据：行高 86 / 格高 44 与行数无关，四档实测比值恒定 → 无纵向拉长问题");
}
