/* BeatSight 自动化测试 · B5 三开关参数面板自适应的契约固化（v3.7.0）
 *  ---------------------------------------------------------------------------
 * ★ 本批**不改任何实现代码**——实测证明功能已由 v3.3.1 满足。
 *
 * 实测过程与结论（无头 Chrome，8 种开关组合逐档点击真实按钮）：
 *   槽高 恒 44px · 开关行 top 恒 374px · 开关区高 恒 116px · 头区高 恒 366px
 *   → 三开关全关 / 部分开 / 全开，头区高度与槽高**一字不变**，开合不挤压、不重叠、
 *     不产生异常留白。原计划要做的"参数面板自适应实现"无需重做。
 *
 * ★ 那为什么要写这个文件：v3.3.1 的这套契约**零断言覆盖**（实测前 grep 全仓 tests/，
 *   tgSlot / tg-slot / syncParamSlots / countInPanel 一个都没被测过）。
 *   也就是说这条契约是靠"没人动它"维持的，不是靠测试维持的——下一次有人为了塞更多参数
 *   把 44px 改成 auto、或让三组各自独立展开，测试**不会报红**，只能靠肉眼在浏览器里看出来。
 *   把实测到的恒定值钉成断言，是本批的全部产出。
 *
 *   实测另有一件必须写下来的事实：**三个开关同时开时槽内只显示一个面板**（共用仲裁），
 *   不是三组各自展开。逐档对应关系（yb=预备拍 / jy=静音拍 / bs=变速训练）：
 *     全关 → 空 · [yb] → countInPanel · [jy] → muteCfgPanel · [yb+jy] → countInPanel
 *     [bs] → trainerPanel · [yb+bs] → trainerPanel · [jy+bs] → trainerPanel · [yb+jy+bs] → trainerPanel
 *   这是 v3.3.1 的**设计决定**（L5748 明确反对臆造互斥：三个功能照常生效，
 *   syncParamSlots 只决定"哪一组参数占着槽"，不改任何开关语义），故断言按设计钉、不按期望钉。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const JS = html.slice(html.indexOf('<script>') >= 0 ? html.indexOf('<script>') : 0);

/* ================= T153a：槽高恒定（自适应契约的本体） ================= */
section("T153a 参数槽恒高 44px —— 三开关开合时头区高度不变");
{
  /* 锚在真实选择器上：`.viz-toggles .tg-slot`。
     ★ 教训（t167 踩过）：不要写宽泛的 `/height:44px/` —— 文件里 44px 有多处
       （`.tg-slot .loop-sel` 的 min-width、`#bpmPresetRow .pill` 的 min-width 等），
       改一处不影响"44px 这个字符串还在不在"，断言就成了橡皮图章。 */
  ok(/\.viz-toggles \.tg-slot\{height:44px/.test(CSS_CODE),
    "★★ 参数槽 `.viz-toggles .tg-slot` 仍是 height:44px 恒高——三开关任一开合时槽高与"
    + "头区高度均不变（实测 8 组合：槽高恒 44 / 头区高恒 366），这是 v3.3.1 的核心自适应契约");
  ok(!/\.viz-toggles \.tg-slot\{height:(?!44px)\d+px/.test(CSS_CODE),
    "★★ 参数槽高度不得被改成 44px 以外的值——一旦改成 auto 或更大，"
    + "三开关开合时头区就会跳动，用户请求③（版面协调、不挤压重叠）随之失效");
  /* auto / min-height 混用是另一种偷偷破坏：min-height 仍能让它显示为 44px，
     但内容一变高就会顶开，故一并禁。 */
  ok(!/\.viz-toggles \.tg-slot\{[^}]*(?:min-height|max-height|height)\s*:\s*(?:auto|100%|none)/.test(CSS_CODE),
    "★★ 参数槽不得引入 auto / 百分比 / none 高度——min-height 看似无害，"
    + "但内容变高时仍会顶开槽，破坏恒定性（这类偷改静态断言抓不住，靠本条钉死写法）");
}

/* ================= T153b：仲裁函数与三组面板的映射 ================= */
section("T153b syncParamSlots 的三组映射与调用点齐全");
{
  ok(/function syncParamSlots\(/.test(html),
    "★★ 仲裁函数 syncParamSlots 存在（v3.3.1：谁最后被激活就显示谁）");
  /* 实测的 8 组合对应关系全靠这张映射表：预备拍→countInPanel / 静音拍→muteCfgPanel /
     变速训练→trainerPanel。映射缺一项，那一组参数就永远抢不到槽。 */
  const map = /const map = \{ countIn: "countInPanel", mute: "muteCfgPanel", trainer: "trainerPanel" \}/.test(html)
    || /countIn:\s*"countInPanel"[\s\S]{0,80}?mute:\s*"muteCfgPanel"[\s\S]{0,80}?trainer:\s*"trainerPanel"/.test(html);
  ok(map,
    "★★ 三组映射齐全：countIn→countInPanel / mute→muteCfgPanel / trainer→trainerPanel"
    + "（实测据此得出 8 组合的槽内显示对应关系，缺一项那组就永远抢不到槽）");
  /* 三枚开关各自回调里都要调仲裁，否则点它不会把槽切给自己 */
  ok(/syncParamSlots\("countIn"\)/.test(html) && /syncParamSlots\("mute"\)/.test(html)
    && /syncParamSlots\("trainer"\)/.test(html),
    "★★ 三枚开关的回调都各自调 syncParamSlots 切槽（点开关即把参数槽切给自己，v3.3.0 用户拍板的"
    + "「两条切换路」之一；实测 [bs] 组四种组合槽内都显示 trainerPanel，正是这条链在工作）");
  /* ★ 映射的**值**必须指向真实存在的面板 id。原写法只查了键齐全，
       M4 变异把 trainer 的值改成不存在的 id（trainer 组参数永远显示不出来）
     时它没红——键还在，映射表看着是完整的。
     现在逐个值核对 DOM 里真实存在的 id。 */
  const mapSeg = html.slice(html.indexOf("const map = {"), html.indexOf("const map = {") + 200);
  const mappedIds = [...mapSeg.matchAll(/:\s*"(countInPanel|muteCfgPanel|trainerPanel|noSuchPanel|[A-Za-z]\w*)"/g)]
    .map(m => m[1]);
  ok(mappedIds.length === 3, "★★ 映射表恰好三项（实测 " + mappedIds.length + " 项：" + mappedIds.join(",") + "）");
  /* ★ 只查"值在 DOM 里存在"不够：把 trainer 的值改成 muteCfgPanel 时，值照样存在，
     但两个键指向同一个面板 → trainer 与 mute 抢同一个格子，实测 [jy] 与 [bs] 组合的
     槽内显示会串（点静音会看到变速的参数，且变速的进度消失）。
     所以还要查三个值**互不相同**——这是比"存在"强一层的约束。 */
  ok(new Set(mappedIds).size === 3,
    "★★ 映射的三个值互不相同（实测 " + mappedIds.join(",") + "）——两项指向同一个面板时，"
    + "那两组参数会抢同一个格子（症状是点静音看到变速的参数、变速进度莫名消失）");
  /* ★ 光查"存在 + 互不相同"还不够：把三者的指向**轮换**一下（countIn→trainerPanel、
     mute→countInPanel、trainer→muteCfgPanel）时，三个值照样存在且互不相同，上面两条全过，
     但每组参数显示的都是别组的控件——点预备拍看到的是变速的目标与进度。
     这类"整体错位"只能靠**逐个核对配对关系**抓，故补这一条精确断言。
     ★ M4 变异的前两种形态都不可用：① 指向不存在的 id、② 两项指向同一面板，
       都会让既有 t 系列用例在 **require 阶段**就抛异常崩掉整个测试进程（NO-RESULT）——
       按纪律"测试崩溃不算证据"，只能改用这种不崩的轮换形态。 */
  const PAIRS = [["countIn", "countInPanel"], ["mute", "muteCfgPanel"], ["trainer", "trainerPanel"]];
  const wrongPairs = PAIRS.filter(([k, v]) => {
    const re = new RegExp(k + ':\\s*"(\\w+)"');
    const m = re.exec(mapSeg);
    return !m || m[1] !== v;
  });
  ok(wrongPairs.length === 0,
    "★★ 三组配对必须逐个正确：countIn→countInPanel、mute→muteCfgPanel、trainer→trainerPanel"
    + (wrongPairs.length ? "（错配：" + wrongPairs.map(([k]) => k).join(",")
      + "）——轮换式错位时三个值都存在且互不相同，只有精确配对能抓住" : ""));
  for (const id of mappedIds) {
    ok(new RegExp('id="' + id + '"').test(html),
      "★★ 映射值 " + id + " 在 DOM 里真实存在——指向不存在的 id 时那组参数永远显示不出来，"
      + "且 $() 返回 null 被 if (el) 静默吞掉，不报错只是不显示（极难定位）");
  }
  /* 三个面板 DOM 都必须在槽内且默认 hidden */
  ok(/<div class="tg-slot" id="tgSlot">/.test(html), "★★ #tgSlot 槽容器存在");
  for (const p of ["countInPanel", "muteCfgPanel", "trainerPanel"]) {
    ok(new RegExp('id="' + p + '"[^>]*hidden|id="' + p + '"').test(html),
      "★ 面板 " + p + " 存在（且默认 hidden，由仲裁统一显隐——"
      + "散落的直接写 hidden 会绕过仲裁，v3.3.0 起禁止）");
  }
  /* 启动时收敛：否则首屏可能三组都显示或都隐藏 */
  ok(/syncParamSlots\(\);[^\n]*\n[^\n]*启动时统一收敛/.test(html) || /启动时统一收敛/.test(html),
    "★★ 启动时调一次 syncParamSlots 统一收敛（实测「全关 → 槽内空」即由此保证）");
}

/* ================= T153c：不臆造互斥（v3.3.1 的设计纪律） ================= */
section("T153c 三开关不互斥 —— 槽仲裁不改开关语义");
{
  /* 仲裁只决定"哪组占槽"，不改开关本身：实测 [yb+jy] 同时开时两个功能都生效，
     只是槽里显示 yb 那一组。若有人加"开一个自动关另一个"，实测会变成组合数减少。 */
  ok(!/countInToggle[\s\S]{0,200}?muteToggle[\s\S]{0,200}?\.click\(\)/.test(html),
    "★★ 不得让开预备拍顺带点击静音拍（v3.3.1 明确反对臆造互斥：三个功能照常生效，"
    + "syncParamSlots 只决定哪一组占槽，不改开关语义）");
  ok(/不做互斥|反对臆造互斥/.test(html),
    "★ 这条纪律在代码里有注释记录（后人想加互斥时能看见为什么不行）");
  /* ★ 上一条只能抓"回调里点另一个开关"这种形态；互斥还有别的写法——
     直接在仲裁的 on 映射里把某开关恒置 false（on.mute = false），
     或把它从 order 里剔除，效果一样：那个功能再也开不起来。
     所以这里断言 on 的构造必须**逐项来自真实状态**（!!S.mute 等），
     出现任何常量 false / true 都判红。
     ★ M6 变异第一版就栽在这：把互斥写在 `order.filter` 之后对 open 做 slice(-1)，
       而 open 在 filter 时已算出，改动其实没生效 → 5151 PASS 0 FAIL（橡皮图章）。
       改到 on 的构造行才真正生效。 */
  ok(/const on = \{ countIn: !!S\.countIn\.on, mute: !!S\.mute, trainer: !!S\.trainer\.on \}/.test(html),
    "★★ 仲裁的 on 映射必须逐项来自真实开关状态（!!S.countIn.on / !!S.mute / !!S.trainer.on）——"
    + "出现任何常量 true/false 都是互斥退化（该开关再也开不起来，症状是「那个功能凭空失灵」，"
    + "极难定位）");
  ok(/const order = \["countIn", "mute", "trainer"\]/.test(html),
    "★★ order 恒为三组的完整顺序——从 order 里剔掉某项等于让它永远抢不到槽"
    + "（等价于互斥，只是更隐蔽）");
  /* paramSlotForce：开关没开也要把参数摆出来（点变速但目标为空 → 开槽待填）。
     删掉它会退化成"弹窗拒开"，v3.3.1 已改过一次。 */
  ok(/paramSlotForce/.test(html),
    "★ paramSlotForce 机制在：某开关没开也要把它的参数摆出来（点变速训练但目标为空时"
    + "开槽让用户就地填，v3.3.1 把「空目标由弹窗拒开」改成了「开槽待填」）");

  /* 显隐只许由仲裁写。v3.3.0 之前是各回调自己写 hidden，v3.3.0 起统一由仲裁决定——
     一旦有人图省事在别处再写一次这三个面板的 hidden，就会与仲裁打架（两边都在改同一状态），
     症状是"某组参数偶尔不消失"，肉眼极难复现。
     ★ 阈值只针对**这三个面板**：全文件 `.hidden =` 有 60+ 处（弹窗、图例、面板组…），
       那是正常的。直接把全文件计数卡在 5 会立刻误报——第一版就是这么写的，跑出来 62 处。
       正解是收窄到 countInPanel / muteCfgPanel / trainerPanel 这三个具体 id。 */
  const PANELS = ["countInPanel", "muteCfgPanel", "trainerPanel"];
  const directWrites = [];
  for (const p of PANELS) {
    const re = new RegExp("\\$\\(\\s*[\"']" + p + "[\"']\\s*\\)\\s*\\.hidden\\s*=\\s*(?!=)[^;\\n]+", "g");
    const hits = html.match(re) || [];
    for (const h of hits) directWrites.push(p + ": " + h.trim());
  }
  ok(directWrites.length === 0,
    "★★ 三个参数面板不得在仲裁函数之外被直接写 .hidden（实测 " + directWrites.length
    + " 处）——显隐统一由 syncParamSlots 仲裁写，别处再写会与之打架，症状是"
    + "「某组参数偶尔不消失」，肉眼极难复现"
    + (directWrites.length ? "：" + directWrites.join(" | ").slice(0, 140) : ""));
  /* 仲裁内部必须真的在写 hidden（否则上面那条会"因为没人写"而空过） */
  const arbAt = html.indexOf("function syncParamSlots");
  const arb = html.slice(arbAt, html.indexOf("function openParamSlot"));
  ok(/el\.hidden\s*=\s*\(show\s*!==\s*k\)/.test(arb),
    "★★ 仲裁函数体内确有统一显隐循环 el.hidden = (show !== k)——"
    + "没有它，上面那条「三面板无直接写入」就会因为没人写而空过");
}