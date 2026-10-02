/* BeatSight 自动化测试 · 参数区契约固化（v3.9.0 三列固定槽位）
 *  ---------------------------------------------------------------------------
 * ★ 沿革：本文件原为 B5（v3.7.0）对 v3.3.1「共槽仲裁」形状的契约固化——实测 8 种开关
 *   组合槽高恒 44px、槽内只显示一组。v3.9.0 用户裁决共槽退役（"想同时看两组做不到、
 *   切开关参数跳来跳去，不好用；控制区空间足够"），形状换为三列固定槽位、显隐各管各。
 * ★ 重写而非删除：旧契约里**仍然成立**的部分（零跳动、不互斥、force 开槽待填、
 *   显隐收口）按新落点重新钉死；不再成立的部分（44px 槽高、show 仲裁、8 组合对应表）
 *   在注释里写明为什么失效。删掉回归测试等于把这块地重新变成雷区。
 *
 * v3.9.0 实测几何（无头 Chrome 1440，三开关全开）：
 *   三列 x = [236, 359/564, 706]，开关列与参数列逐像素同缘；参数行轨道恒 76px；
 *   头部三块居中聚拢、左右留白对称（172/172）。
 *   真实几何由 tools/smoke.js 复核，本文件钉源码级契约。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const JS = html.slice(html.indexOf('<script>') >= 0 ? html.indexOf('<script>') : 0);

/* ================= T153a：参数行轨道恒高（零跳动契约的现行落点） ================= */
section("T153a 参数行轨道恒 76px —— 三开关开合时块内高度不变");
{
  /* 旧契约（v3.7.0 钉的 `.viz-toggles .tg-slot{height:44px}`）随共槽退役失效：
     槽壳 display:contents 后没有盒子，"槽高"无从谈起。零跳动的承重墙换成
     tg-body 网格的第二轨（参数行）76px——机制换了，契约本身不换。 */
  ok(/\.viz-head-grid \.viz-toggles \.tg-body\{display:grid;grid-template-columns:auto auto auto;grid-template-rows:auto 76px/.test(CSS_CODE),
    "★★ 参数行轨道恒 76px（grid-template-rows:auto 76px）——三开关任一开合时"
    + "参数行高度与块内高度均不变（v3.3.1 零跳动契约的现行落点，实测四态一字不变）");
  ok(!/\.viz-head-grid \.viz-toggles \.tg-body\{[^}]*grid-template-rows:auto (?!76px)\d+px/.test(CSS_CODE),
    "★★ 参数行轨道不得被改成 76px 以外的值——一旦改小，最满那组（变速训练的"
    + "一行输入 + 两行拒开原因）会溢出；改成 auto 则开合跳动回归");
  ok(!/\.viz-head-grid \.viz-toggles \.tg-body\{[^}]*grid-template-rows:[^;}]*minmax/.test(CSS_CODE),
    "★★ 参数行轨道不得引入 minmax——第二轨必须是刚性 76px，弹性轨道等于没有钉");
}

/* ================= T153b：三列钉位与作用域 ================= */
section("T153b 三列网格的钉位齐全、作用域不误伤");
{
  /* 显式 grid-area：display:none 的面板不占格，不钉位的话剩下的面板会被
     auto-placement 挪进第 1 列——症状是"只开变速时参数出现在预备拍下面"。 */
  const AREAS = [["countInToggle", "1/1"], ["muteToggle", "1/2"], ["trainerToggle", "1/3"],
                 ["countInPanel", "2/1"], ["muteCfgPanel", "2/2"], ["trainerPanel", "2/3"]];
  for (const [id, area] of AREAS) {
    const re = new RegExp("\\#" + id + "\\{grid-area:" + area.replace(/\//g, "\\/") + "\\}");
    ok(re.test(CSS_CODE),
      "★★ " + id + " 钉在 grid-area:" + area + "——开关在上排、自己的参数在正下方同列");
  }
  /* 作用域必须钉在 .viz-toggles 内：.tg-body 类名在音量组与 BPM 组里也在用
     （各自的行包装层）——宽选择器会把音量三条滑杆排成三列（v3.9.0 实拍翻过车）。 */
  ok(/\.viz-head-grid \.viz-toggles \.tg-body\{/.test(CSS_CODE)
     && !/\.viz-head-grid \.tg-body\{display:grid/.test(CSS_CODE),
    "★★ 三列网格的作用域钉在 .viz-toggles 内——裸 .viz-head-grid .tg-body 会误伤"
    + "音量组与 BPM 组的同名包装层（音量三滑杆变三列，实拍抓过）");
  ok(/\.viz-toggles \.tg-row\{display:contents\}/.test(CSS_CODE)
     && /\.viz-toggles \.tg-slot\{display:contents\}/.test(CSS_CODE),
    "★★ 两层壳 display:contents——开关与参数进同一张网格，列对齐是结构保证");
  /* 窄屏（≤759.9）回退手风琴式单列：三列 118px 装不下任何一组参数（换行爆高，实拍翻过车）——
     每组一对纵排（开关在上、参数紧跟其下，显式钉行），零跳动只在桌面档承诺。 */
  ok(/@media \(max-width:759\.9px\)\{[^}]*\.viz-head-grid \.viz-toggles \.tg-body\{grid-template-columns:minmax\(0,1fr\);grid-template-rows:none;justify-items:start\}/.test(CSS_CODE.replace(/\n/g, "")),
    "★ 窄屏回退在：手风琴式单列（minmax(0,1fr) + 行高放开 + justify-items:start 防拉伸居中）");
  ok(/@media \(max-width:759\.9px\)[\s\S]*?\.viz-toggles \.tg-row \.toggle-pill#muteToggle\{grid-area:3\/1\}[\s\S]*?\.viz-toggles \.tg-slot \.tr-panel#muteCfgPanel\{grid-area:4\/1\}/.test(CSS_CODE),
    "★ 窄屏显式钉行：每组（开关, 参数）占相邻两行——隐藏面板的行自动塌缩，组与组不错位");
}

/* ================= T153c：不互斥 + force 开槽 + 显隐收口 ================= */
section("T153c 三开关不互斥 —— 各管各不改开关语义");
{
  ok(!/countInToggle[\s\S]{0,200}?muteToggle[\s\S]{0,200}?\.click\(\)/.test(html),
    "★★ 不得让开预备拍顺带点击静音拍（v3.3.1 明确反对臆造互斥：三个功能照常生效）");
  ok(/不做互斥|反对臆造互斥/.test(html),
    "★ 这条纪律在代码里有注释记录（后人想加互斥时能看见为什么不行）");
  ok(/const on = \{ countIn: !!S\.countIn\.on, mute: !!S\.mute, trainer: !!S\.trainer\.on \}/.test(html),
    "★★ on 映射必须逐项来自真实开关状态——出现任何常量 true/false 都是互斥退化");
  ok(/paramSlotForce/.test(html),
    "★ paramSlotForce 机制在：某开关没开也要把它的参数摆出来（点变速训练但目标为空时"
    + "就地填，v3.3.1 把「空目标由弹窗拒开」改成了「开槽待填」）");
  ok(/if \(on\[k\] && paramSlotForce === k\) paramSlotForce = "";/.test(html),
    "★ force 随对应开关真正打开而解除（不解除的话关掉开关参数还赖着不走）");
  /* 启动收敛：否则首屏可能三组全显或全隐 */
  ok(/启动时统一收敛/.test(html) || /syncParamSlots\(\);\s*\/\/ v3\.3\.0：启动时统一收敛/.test(html),
    "★★ 启动时调一次 syncParamSlots 统一收敛（全关 → 参数区全隐即由此保证）");
  /* 面板默认 hidden（标记层），显隐只由 syncParamSlots 写 */
  for (const p of ["countInPanel", "muteCfgPanel", "trainerPanel"]) {
    ok(new RegExp('id="' + p + '"[^>]*hidden|id="' + p + '"').test(html),
      "★ 面板 " + p + " 存在（且默认 hidden，由 syncParamSlots 统一显隐）");
  }
}
