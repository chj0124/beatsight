/* BeatSight 自动化测试 · 预设库三级层次（区 / 分组 / 条目）（v3.33.17）
   T203 系列。
   ---------------------------------------------------------------------------
   用户实拍：「节奏型预设库中，分组的样式有问题，组标题竟然比组内各项内容的标题字体还小，
   而且排版也有问题。」

   两条独立缺陷：
     ① **层级倒挂**：`.preset-section`（区）与 `.preset-group`（分组）都是 11px，而它管着的
        `.preset-item .name`（条目名）是 **13px** —— 容器比内容还小。
     ② **缩进方向反了**：分组头带 `margin-left:10px` + `padding-left:8px` + `border-left:2px`
        = 比它管着的**条目多缩进 18px**，容器比内容还深，读起来像"标题属于更下一层"。

   本文件用**源码钉**（CSS 是纯声明，桩里没有布局，断言只能钉在声明上）。
   视觉最终效果按仓库纪律**需人眼验收**。 */
"use strict";
const { ok, eq, section, html } = require("../lib/harness");

const src = html;
/** 取某条 CSS 规则的规则体（第一个 `{` 到配对 `}`），找不到返回 "" */
function ruleBody(selector){
  const i = src.indexOf(selector + "{");
  if (i < 0) return "";
  const j = src.indexOf("}", i);
  return j < 0 ? "" : src.slice(i + selector.length + 1, j);
}
const px = (sel, prop) => {
  const m = new RegExp(prop + ":\\s*(-?[\\d.]+)px").exec(ruleBody(sel));
  return m ? Number(m[1]) : null;
};

section("T203a 三级层次单调 · 区 ≤ 分组 = 条目名（不再倒挂）");
{
  const secFs = px(".preset-section", "font-size");
  const grpFs = px(".preset-group", "font-size");
  const nameFs = px(".preset-item .name", "font-size");
  eq(secFs, 12, "区标题 12px（原 11px）");
  eq(grpFs, 13, "★ 分组标题 13px（原 11px）");
  eq(nameFs, 13, "前提：条目名仍是 13px");
  ok(grpFs >= nameFs,
     "★★ 分组标题字号 ≥ 它管着的条目名字号（" + grpFs + " ≥ " + nameFs + "）——这正是用户报的那条");
  ok(secFs <= grpFs,
     "★ 层次单调：区（" + secFs + "）≤ 分组（" + grpFs + "）——最外层不该是最小的一档");
}

section("T203b 分组标题的视觉权重 ≥ 条目名（字重 / 颜色）");
{
  const grp = ruleBody(".preset-group");
  ok(/font-weight:600/.test(grp), "★ 分组标题 font-weight:600（一眼是容器头）");
  ok(/color:var\(--t1\)/.test(grp), "★ 分组标题 color:--t1（亮于条目名所在层）");
  ok(!/color:var\(--t3\)/.test(grp), "且不再是 --t3 那种「最暗的辅助文字」档");
}

section("T203c 缩进方向 · 分组头不再比它的条目更深");
{
  const grp = ruleBody(".preset-group");
  ok(!/border-left/.test(grp),
     "★ 去掉 border-left 竖线（它把分组画成「又深一层」的括号）");
  ok(!/padding-left/.test(grp),
     "★ 去掉 padding-left:8px（18px 缩进的一半）");
  ok(!/margin:10px 0 6px 10px/.test(grp),
     "★ 去掉 margin-left:10px（另一半）——分组头现在与区头同左缘，层次靠字号/字重/颜色表达");
  ok(/margin:10px 0 6px;/.test(grp), "保留垂直间距（10/6），只收掉水平缩进");
}

section("T203d 源码钉 · 折叠箭头仍在（改样式不许碰行为契约）");
{
  ok(/\.preset-group::before\{content:"▾"/.test(src), "★ 折叠箭头 ::before 仍在（组头可折叠）");
  ok(/\.preset-group\[aria-expanded="false"\]::before\{transform:rotate\(-90deg\)\}/.test(src),
     "★ 折叠态仍由 aria-expanded 单一真相驱动（未引入第二份状态）");
}
