/* BeatSight 自动化测试 · 日间主题版面：弹窗头部角标挤压 + 两走道对齐（v3.33.8 回归）
   T192
   ---------------------------------------------------------------------------
   【缺陷 1】设置弹窗头部是**一个 flex 行**（'04 Settings' 角标 + 中文标题「设置」），而日间主题把
     .sec-tag 从 display:none 变成 `display:flex;width:100%` ⇒ 角标独占整行、把标题挤成
     **一个字宽 → 逐字竖排**（用户实拍：设置两字上下叠着）。仓库里 .group-label / .pd-head 都
     加过同款例外，**弹窗头部漏了**。
   【缺陷 2】日间下 .sec-tag 可见后多占 44px 一行，左列内容整体下移；而右列（.viz-toggles）仍用
     经典那档 padding-top:44px ⇒ 「预备拍」开关对齐到了**左列标题行**而不是控制行（BPM 的 +5）。
     实测 1440：经典 +5 154 / 开关 156（对 ✓）；日间改前 +5 182 / 开关 147（差 −35 ✗）。

   【本用例钉什么（源码级）】
     T192a 弹窗头部：日间角标收成 inline-flex + 宽度自适应；标题 nowrap + 不参与收缩
     T192b 两走道：角标列（左）保留 44px 占位，开关列（右）的内边距必须**大于**它（同 44 就会
           对齐到标题行）；且两条规则是分开写的（合成一条又会同时改到两列）
   ★ 行为面由冒烟闸门把守（tools/smoke.js 的 layoutAuditProbe：真实 DOM 量「设置」行数、
     .sec-tag 挤压、预备拍 vs +5 的 top 差），反向验证见本轮报告：回退这两处 CSS ⇒ 三条断言变红。
   ================================================================================ */
"use strict";
const { ok, section, html } = require("../lib/harness");

section("T192a 日间弹窗头部：角标不独占整行（「设置」不再逐字竖排）");
{
  ok(/body\[data-theme="obs"\] \.dialog-head \.sec-tag\{display:inline-flex;width:auto;margin:0;flex:none\}/.test(html),
    "★★ 弹窗头部角标 = inline-flex + width:auto + flex:none（width:100% 会把标题挤成一字宽）");
  ok(/body\[data-theme="obs"\] \.dialog-title\{white-space:nowrap;flex:none\}/.test(html),
    "★★ 弹窗标题 nowrap + 不收缩（任何容器里都不该被挤成竖排）");
}

section("T192b 日间两走道对齐：右列内边距必须大于左列角标占位（否则对齐到标题行）");
{
  const both = (html.match(/body\[data-theme="obs"\] \.viz-head-grid \.viz-head > \.group\{padding-top:(\d+)px\}/) || [])[1];
  const right = (html.match(/body\[data-theme="obs"\] \.viz-head-grid \.viz-toggles\{padding-top:(\d+)px\}/) || [])[1];
  ok(both === "44", "★ 左列（角标列）保留 44px 占位让角标有位（实测 " + both + "）");
  ok(right !== undefined && parseInt(right, 10) > 44,
    "★★★ 右列（开关列）内边距 > 44px（实测 " + right + "）：46 就与左列角标行同高 ⇒ 预备拍会对齐到 BPM 标题");
  ok(parseInt(right, 10) >= 70 && parseInt(right, 10) <= 90,
    "★★ 右列内边距落在实测标定区间 70~90px（1440 实测 +5 相对列顶 79px）");
}
