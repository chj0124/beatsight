/* BeatSight 自动化测试 · 原生 select 触发框箭头
   T278：保留原生选项弹层与键盘语义，只统一触发框的箭头视觉。 */
"use strict";
const { section, ok, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

section("T278a 原生 select 保留，触发框使用统一矢量箭头");
{
  ok(/<select class="loop-sel" id="sigSel"[^>]*><\/select>/.test(html),
    "拍数控件仍是原生 select，不改成自绘按钮或弹层");
  ok(/<select class="loop-sel" id="editorTplSel"[^>]*><\/select>/.test(html),
    "编辑器模板同样保留原生 select");
  ok(/\.loop-sel\{[^}]*-webkit-appearance:none;appearance:none;/.test(CSS),
    "★ 原生默认箭头退役，由统一触发框样式接管");
  ok(/\.loop-sel\{[^}]*background-image:var\(--select-chev\);/.test(CSS),
    "★ 默认态使用自定义 chevron 矢量箭头");
  ok(/\.loop-sel\{[^}]*background-position:right var\(--sp-2\) center;[^}]*background-size:14px 14px;/.test(CSS),
    "★ 箭头 14×14px，右侧按间距令牌定位");
  ok(/\.loop-sel\{[^}]*padding-right:calc\(var\(--sp-4\) \+ var\(--sp-3\)\);/.test(CSS),
    "★ 右侧预留 28px，文字不压箭头");
  ok(/\.tg-flyout \.tr-panel \.loop-sel\{[^}]*padding-right:calc\(var\(--sp-4\) \+ var\(--sp-3\)\);/.test(CSS),
    "★ 紧凑面板覆盖规则也保留箭头空间");
}

section("T278b 箭头三态与双主题同源");
{
  [":root", "body[data-theme=\"obs\"]"].forEach(scope => {
    ["--select-chev", "--select-chev-hi", "--select-chev-focus"].forEach(name => {
      ok(new RegExp(name + ":url\\(\"data:image/svg\\+xml;utf8,<svg[^\"]+M6 9l6 6 6-6[^\"]+\"\\)").test(CSS),
        scope + " 定义 " + name + "（同一 V 形几何）");
    });
  });
  ok(/\.loop-sel:hover\{background-image:var\(--select-chev-hi\)\}/.test(CSS),
    "★ 悬停箭头提亮");
  ok(/\.loop-sel:focus-visible\{background-image:var\(--select-chev-focus\);border-color:var\(--green\)\}/.test(CSS),
    "★ 聚焦箭头与边框同用主题绿");
  ok(CSS.includes("stroke='%23B3B3B3'") && CSS.includes("stroke='%23FFFFFF'") && CSS.includes("stroke='%231ED760'"),
    "经典主题：默认 / 悬停 / 聚焦箭头颜色齐备");
  ok(CSS.includes("stroke='%23475569'") && CSS.includes("stroke='%230F172A'") && CSS.includes("stroke='%232563EB'"),
    "日间主题：默认 / 悬停 / 聚焦箭头颜色齐备");
}
