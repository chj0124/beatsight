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
        ★ v3.31.4 再订正（最终态）：**渐变背景图同样给不出直条**——它按本行 border-radius:8px
        裁切，3px 宽的短标被斜切顶部 ≈8px（用户实拍那片「上尖下钝的叶片」）。修成真直条后用户看
        播放态实拍决定**整条取消**，只留底纹并提到 .10。T151c 重写为「短标不得复活 + 底纹 .10」；
        原 T151c-2（.bar-row 全族不得裁剪子盒）随短标一起退役——它守的那个前提已不存在；
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

/* ==== T151c：当前行只留底纹（v3.31.4 用户裁决：行首短标整条取消，底纹 .07 → .10） ==== */
section("T151c .bar-row.current 只留底纹 .10（v3.33.8：挂在 ::before 的 44px 格子带上），行首绿条不得复活");
{
  const base = (html.match(/^\.bar-row\.current\{[^}]*\}/m) || [""])[0];
  const pseudo = (html.match(/^\.bar-row\.current::before\{[^}]*\}/m) || [""])[0];
  const band = base + pseudo;
  ok(!!base && !!pseudo, "★ .bar-row.current（含 ::before 格子带）规则在位");
  ok(/rgba\(30,215,96,\.10\)/.test(pseudo),
    "★★ 底纹提到 .10（v3.31.4 用户裁决）：短标那条 5.67:1 的线索取消后，.07 实测对非当前行只有"
    + " 1.14:1——不补粗一档，整行级的线索就等于没有");
  ok(!/rgba\(30,215,96,\.07\)/.test(band), "★ 旧值 .07 已退役（真回退，不是被覆盖）");
  ok(!/rgba\(30,215,96,\.12\)/.test(band),
    "★★ 不得直接取 .12——v3.8.0 已明确否决过（压住未弹格子的扫弦箭头与六线底纹，读谱优先）");
  /* 反向不变量：行首短标不得复活。三条通道（伪元素 / 背景图 / inset 阴影）在 v3.33.8 **精确化**：
     伪元素不再一律禁止，而是必须是**整条格子带**（left/right:0 + height:44px）。 */
  /* ★★★ v3.38.1 补10：高度从写死 44px 改成**与格子带共用一个来源**（--cell-h）。
     写死 44px 正是"窄屏格子 34px、底纹仍 44px"那条漏网 bug 的成因（用户实拍：绿色遮罩
     多出 10px 落进歌词带）。意图不变：仍必须是**整条格子带**、不得声明窄宽。 */
  ok(/left:0;right:0/.test(pseudo) && /height:var\(--cell-h\)/.test(pseudo) && !/(?:^|[;{])\s*(?:width|max-width|min-width):/.test(pseudo),
    "★★ 行首绿条不得复活：伪元素只能是**整条格子带**（left:0;right:0 + height:var(--cell-h)，不得声明窄宽）"
    + "播放中真正的锚是 .cell.active 的绿描边；历史那条 5.67:1 的行首短标仍被本条拦下");
  ok(!/linear-gradient|background-image/.test(band),
    "★★ 不得扛背景图：本行 radius(8px) 大于任何贴边小段的宽度，背景图必被圆角"
    + "裁切——v3.8.0~v3.31.3 那条「叶片」就是这么来的");
  ok(!/box-shadow/.test(base),
    "★★ 不得在**行盒**上用 inset box-shadow：它画的是盒差集，inset 3px 24px 0 0 实为 L 形通宽带"
    + "（B3 几何 bug，v3.8.0 修）。凡「贴边的一小段」都别走上面这两条路");
  ok(/border-radius:8px/.test(pseudo), "★ 行圆角 8px 保留（底纹与 obs 描边款都要它）");
  /* obs 主题：它的位置对比由 1px inset 环承担，故底纹不跟着提到 .10；v3.33.8 起该环挂在 ::before 上 */
  const obs = (html.match(/body\[data-theme="obs"\] \.bar-row\.current::before\{[^}]*\}/) || [""])[0];
  ok(/inset 0 0 0 1px/.test(obs),
    "★ obs 的「位置对比」仍是那条 1px inset 环（挂在 ::before 的格子带上，经典主题不跟着提底纹）");
}

/* ================= T151d：反向不变量——行高与格高一个字都不许动 ================= */
section("T151d 行高 86px / 格高 44px 保持固定（本次最大的回归风险）");
{
  ok(/^\.bar-row\{position:relative;height:86px/m.test(CSS),
    "★★ .bar-row 仍是 height:86px 固定值——B3 最大的风险就是手滑把它改成自适应，"
    + "实测四档行高恒 86px，说明固定值本来就是对的");
  ok(/\.cell\{position:absolute;top:0;height:var\(--cell-h\)/.test(CSS),
    "★★ .cell 的高度来自 --cell-h（格高与弦距 --gt 是同一档几何：桌面 44/8.6、窄屏 34/6.6）");
  ok(/--gt:8\.6px/.test(CSS),
    "★ 弦距 --gt 仍按 44px 格高派生（(44−1)/5），未与格高脱钩");
  /* ★★★ v3.38.1 补10：**"贴格子带的四层"必须共用一个来源**。
     这一族已漏过三次（v2.79.0 的 .seams/.beat-zone、v3.33.8 新增的 ::before 又写死一遍）——
     所以这条不是「钉某个值」，而是钉「四个选择器都引用 --cell-h」：新加第五层时若再写死，
     这里当场变红。真机侧另由冒烟的 bandProbe 钉"底纹高 == 格子高、且不越出格子下缘"。 */
  ok(/--cell-h:44px/.test(CSS), "★★★ 格子带高 --cell-h 定义在基础档（44px）");
  ok(/@media \(max-width:960px\)\{[\s\S]*?--cell-h:34px/.test(CSS),
    "★★★ 窄屏档只改 --cell-h:34px 一处（不再逐条补，杜绝「加了新层就漏」）");
  const layers = [
    [/\.cell\{[^}]*height:var\(--cell-h\)/, ".cell"],
    [/\.beat-zone\{[^}]*height:var\(--cell-h\)/, ".beat-zone"],
    [/\.seams\{[^}]*height:var\(--cell-h\)/, ".seams"],
    [/\.bar-row\.current::before\{[^}]*height:var\(--cell-h\)/, ".bar-row.current::before"],
  ];
  const missing = layers.filter(x => !x[0].test(CSS)).map(x => x[1]);
  ok(missing.length === 0,
    "★★★ 「贴格子带的四层」全部引用 --cell-h（缺：" + (missing.join(" / ") || "无") + "）——"
    + "这一族漏过三次，本条是防「第五层再写死」的那道闸");
}

/* ================= T151e：固定行高下"格子被拉长"确实不存在 ================= */
section("T151e 格子宽高比与行数无关（为「不改行高」这一决策留证据）");
{
  /* 这条断言钉的是**决策依据**而非渲染结果：实测四档格宽高比恒 ≈1.98:1（1440 视口），
     说明用户报的"1 行被纵向拉长"来自别处（或来自早期版本），不是当前行高策略的锅。
     匹配不用 ^ 锚：样式表里部分规则并非顶格书写，顶格锚会静默判红（教训已记）。 */
  ok(/\.bar-row\{[^}]*height:86px/.test(CSS) && /\.cell\{[^}]*height:var\(--cell-h\)/.test(CSS),
    "★ 现状即证据：行高 86 / 格高 44 与行数无关，四档实测比值恒定 → 无纵向拉长问题");
}
