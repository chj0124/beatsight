/* BeatSight 自动化测试 · B4 全站可点元素统一触控下限（v3.6.0）
   ---------------------------------------------------------------------------
   立项依据：可访问性维度的实测——38 个可点元素里 **25 个命中盒 <40px**
   （无头 Chrome，1440×900）。明细：pill 家族 19 个（主体 36px、tapBtn 38px、
   5 个 BPM 快捷档 31px、图例关闭钮 27px），另有 icon-btn 1 个 36px。

   口径选择（为什么是 40px 而不是 44px，也不是"逐个补"）：
     · WCAG 2.5.8 的 AA 门槛是 24×24——现状 36px **本就过 AA**，所以这不是合规缺陷，
       是移动端体验问题。练琴常在手机 PWA 上打开（这是本应用真实的主场景），
       拇指点击需要更大的命中盒，才值得动。
     · 取 40px 而非 AAA 级的 44px：实测主列 +25px vs +41px，且首屏更不容易被顶掉。
       44 留给以后真的按 AAA 验收时再上，届时会有明确的理由而不是现在这个。
     · **加在 .pill 默认规格而不是逐个补局部规则**：`.viz-rows .pill`（同屏行数）与拍号
       共用同一批元素，v2.10.14 已按用户要求④把两者的缩小差异删掉、"统一为默认规格"。
       那是**统一方向**，不是"钉死在 36px"。加局部规则会重新造出第三套规格。

   契约（改动前先钉死，改码后必须全绿）：
     ① .pill 默认规格含 min-height:40px —— 全站触控下限的唯一定义处；
     ② 不得出现把高度压回 40px 以下的局部覆盖（本批最可能的回归）；
     ③ 底栏 --bar-h 96px 与参数槽 #tgSlot 44px **不受影响**（这两处各另有契约）；
     ④ 注释须写明 40 的依据（否则后人会当成随手挑的 magic number）。
     ★ ③ 是本批最危险的连带面：参数槽恒高是 v3.3.1 三开关自适应的核心契约，
       它一旦被顶高，8 种开关组合的头区高度稳定性就破了（t166 与 t90 都有断言）。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

/* ★ 断言一律在**剥掉注释**的 CSS 上做。
   本批的注释里恰好写着 "min-height:40px"、"1440×900"、"5 个 31px" 这些串——
   直接拿原始 CSS 跑正则，会把注释文字当成规则命中：
   先踩到的是 `[^}]*` 跨注释后误判"有 <40px 的高度声明"，还把违规文本回显成
   一段中文注释，看起来像匹配错了对象。踩过两次，固化成这两行。 */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/* ================= T152a：.pill 默认规格含 min-height:40px ================= */
section("T152a .pill 默认规格含 min-height:40px（全站触控下限的唯一定义处）");
{
  ok(/\.pill\{[^}]*min-height:40px/.test(CSS),
    "★★ .pill 默认规格含 min-height:40px——38 个可点元素里 25 个曾 <40px，这是唯一定义处");
  /* min-height 是**下限**而非替代：padding 仍在，文字多的 pill（预设名等）仍可自然长高，
     不该被这个下限压成固定高度。 */
  ok(/\.pill\{[^}]*padding:9px 16px[^}]*\}/.test(CSS),
    "★ min-height 是**下限**而非替代：padding:9px 16px 仍在，文字多的 pill 仍可自然长高");
}

/* ================= T152b：不得有绕过下限的局部覆盖 ================= */
section("T152b 没有把高度压回 40px 以下的局部覆盖");
{
  /* ★ 本节的写法是被 M2 变异逼出来的：第一版用 `/\.pill\{[^;{}]*min-height:…px/`
     想在同一条规则里跨过分号去找 min-height，结果 `[^;{}]*` 不吃分号，
     跨不过 `border-radius:…;padding:…;` 那串前缀 → **这条断言从来没真正生效**（橡皮图章）。
     M2 把主规则的 40 改成 36 时它没红，只有 T152a 红——这才暴露出来。
     M3 能抓到纯属侥幸：`.viz-rows .pill{` 后面紧跟 min-height，中间没分号。

     正确做法：**先按规则边界切开，再逐条查声明**——不靠正则跨越分隔符。
     下面是本批唯一可靠的写法（也顺带解决了跨规则贪婪与注释误命中两个老问题）。 */
  const RULES = CSS_CODE.split("}");           // 每段 = 一条规则（含选择器 + 声明）
  const TOO_SMALL = /^(?:[1-3][0-9]|4[1-3])px$/; // 10–39 与 41–43；40 是合规值，不在内

  /* 所有选择器命中 .pill 的规则：主规则 .pill 与各私有规则 .x .pill 都在内 */
  const pillRules = RULES.filter(r => /\.pill(?=[{:,\s])/.test(r));
  const violations = pillRules.filter(r =>
    (r.match(/(?:min-)?height\s*:\s*([^;]+)/g) || [])
      .some(d => TOO_SMALL.test(d.replace(/^(?:min-)?height\s*:\s*/, "").trim())));

  ok(pillRules.length >= 2,
    "★ 至少查到了 .pill 主规则 + 一条私有规则（防正则写坏后静默零命中）：" + pillRules.length + " 条");
  ok(violations.length === 0,
    "★★ 任何 .pill 规则都不得含 <40px 的高度声明（局部下调是最可能的回归）"
    + (violations.length ? "（违规：" + violations.join(" | ").slice(0, 140) + "）" : ""));
  ok(!/^\.viz-rows \.pill\{/m.test(CSS),
    "★★ v2.10.14 用户要求④的缩小规则仍不存在——B4 走抬高默认规格，不走局部缩小差异");
}

/* ================= T152c：有高度契约的两处不被牵动 ================= */
section("T152c 底栏 --bar-h 与参数行 76px 不受本批影响");
{
  ok(/:root\{[^}]*--bar-h:\s*96px/.test(CSS) || /--bar-h:\s*96px/.test(CSS),
    "★★ 底栏 --bar-h 仍是 96px（实测加 min-height 后底栏高不变，此值不得被 pill 改动牵动）");
  /* v3.9.0 订正：参数槽 #tgSlot 已 display:contents（三列固定槽位改造，共槽退役），
     "恒定高度"的承重墙换成 tg-body 网格的**第二轨 76px**（参数行）——
     零跳动契约不变，只是落点从槽高换成轨道高。锚真实选择器（教训沿用旧注释）。 */
  ok(/\.viz-head-grid \.viz-toggles \.tg-body\{[^}]*grid-template-rows:auto 76px/.test(CSS_CODE),
    "★★ 参数行轨道仍是 grid-template-rows:auto 76px 恒高——三开关开合时参数行高度不变"
    + "是 v3.3.1 零跳动契约的现行落点，B4 若把它顶高，稳定性就破了");
  ok(!/\.viz-head-grid \.viz-toggles \.tg-body\{[^}]*grid-template-rows:auto (?!76px)\d+px/.test(CSS_CODE),
    "★★ 参数行轨道不得被改成 76px 以外的值（本批最危险的连带面，必须钉死）");

  /* 顶栏等高带：这条显式 height 会**盖住** .pill 的 min-height——不改它，顶栏的元素
     （补偿读数 / 设置钮 / 主题钮）就仍是 36px，B4 等于漏了顶栏。
     实测抬到 40 后：.topbar 容器高 64px 与 .main 起点都不变、零横向溢出，
     且四者 top 由 [14,12] 收敛为单值 [12]——等高带反而更齐，不是妥协。
     ★ v3.10.0：.status 移出等高带（状态灯已搬去底栏右区），带收缩为三项；高度契约不变。 */
  ok(/\.topbar \.pill, \.topbar \.icon-btn, \.topbar \.lat-btn\{height:40px/.test(CSS_CODE),
    "★★ 顶栏等高带也抬到 40px——这条显式 height 会盖住 .pill 的 min-height，"
    + "不改则顶栏元素仍是 36px（B4 漏掉顶栏）；v3.10.0 起带内不再有 .status");
  ok(!/\.topbar \.pill, \.topbar \.icon-btn, \.topbar \.lat-btn, \.topbar \.status\{height:/.test(CSS_CODE),
    "★ 等高带里不再有 .topbar .status（旧四项写法已随状态灯搬家退役）");
  ok(!/\.topbar \.pill, \.topbar \.icon-btn, \.topbar \.lat-btn\{height:(?:[1-3][0-9])px/.test(CSS_CODE),
    "★ 顶栏等高带不得被调回 30~39px（与全站触控下限同源，别只改 .pill 忘了这条显式 height）");
  ok(/:root\{[^}]*--bar-h:\s*96px|--bar-h:\s*96px/.test(CSS_CODE)
    && !/--bar-h:\s*(?:8[0-9]|9[0-5]|9[7-9]|1\d\d)px/.test(CSS_CODE),
    "★★ 底栏 --bar-h 恒 96px——顶栏抬到 40px 与它无关（两者分属不同容器，"
    + "实测底栏高 96 与主列起点均不变），此值不得被 B4 牵动");
}

/* ================= T152d：口径写进注释（防 magic number 回潮） ================= */
section("T152d 40px 的依据写进注释");
{
  const at = CSS.indexOf(".pill{border-radius");
  ok(at > 0, "★ .pill 主规则存在");
  const seg = CSS.slice(Math.max(0, at - 1600), at);
  ok(/40px/.test(seg),
    "★ .pill 的 min-height:40px 附近注释须写明 40 这个数（否则后人会以为随手挑的）");
  ok(/AA|2\.5\.8|WCAG/.test(seg),
    "★ 注释须写明依据（WCAG 2.5.8 的 AA 门槛 24px / 44 是 AAA），"
    + "否则后人会想当然地改成 44");
  ok(/44/.test(seg),
    "★ 注释须说明为何不是 44px（AAA 级、实测主列 +41px 而 40 只 +25px），"
    + "避免后人「够到标准」就改 44");
  /* ★ 这条第一版写成 /实测/，被 M5 变异（删掉「实测影响面」整段）放过——橡皮图章。
     原因：注释里"改前实测 38 个""实测主列只 +25px"也有"实测"二字，删一段照样命中。
     教训与上面同源：**断言要锚在"唯一措辞"上，不能锚在"这类措辞"上**。
     改为查该段独有的四档视口数字 + "影响面"标题词，两者缺一即判红。 */
  ok(/影响面/.test(seg) && /1440×900/.test(seg) && /390/.test(seg) && /360/.test(seg) && /640/.test(seg),
    "★ 注释须带**四档视口实测影响面**（1440×900 / 390 / 360 / 640，含「影响面」标题词）——"
    + "这是让后人敢把这个下限继续往上抬的依据；锚在具体数字上而非「实测」二字（后者太松）");
  ok(/166→174px/.test(seg),
    "★ 注释须写出窄屏的具体变化量（.viz-rows-row 166→174px），不只是「零横向溢出」这种结论");
}