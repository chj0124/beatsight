/* BeatSight 自动化测试 · 原生 select 触发框箭头与弹窗自动完成
   T278：保留原生选项弹层与键盘语义，只统一触发框视觉；关闭非预期的 Chrome 历史建议。 */
"use strict";
const { section, ok, eq, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

section("T278a 原生 select 保留，触发框恢复 14px 线性箭头");
{
  ok(/<select class="loop-sel" id="sigSel"[^>]*><\/select>/.test(html),
    "拍数控件仍是原生 select，不改成自绘按钮或弹层");
  ok(/<select class="loop-sel" id="editorTplSel"[^>]*><\/select>/.test(html),
    "编辑器模板同样保留原生 select");
  ok(/\.loop-sel\{[^}]*-webkit-appearance:none;appearance:none;/.test(CSS),
    "★ 原生默认箭头退役，由统一触发框样式接管");
  ok(/\.loop-sel\{[^}]*background-image:var\(--select-chev\);/.test(CSS),
    "★ 默认态使用自定义 chevron 图标");
  ok(/\.loop-sel\{[^}]*background-position:right var\(--sp-2\) center;[^}]*background-size:14px 14px;/.test(CSS),
    "★ 箭头恢复 14×14px，右侧按间距令牌定位");
  ok(/\.loop-sel\{[^}]*padding-right:calc\(var\(--sp-4\) \+ var\(--sp-3\)\);/.test(CSS),
    "★ 右侧恢复 28px 留白");
  ok(/\.tg-flyout \.tr-panel \.loop-sel\{[^}]*padding-right:calc\(var\(--sp-4\) \+ var\(--sp-3\)\);/.test(CSS),
    "★ 紧凑面板同步恢复箭头留白");
  ok(!CSS.includes("<rect x='1' y='1' width='22' height='22' rx='5'"),
    "★ 淡底圆角图标槽完全移除");
  ok(CSS.includes("M6 9l6 6 6-6") && !CSS.includes("M4 8l8 8 8-8"),
    "★ 恢复上一版 V 形路径");
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

section("T278c 分组弹窗关闭浏览器自动完成");
{
  ok(/<input class="name-input modal-input" id="modalInput" hidden aria-labelledby="modalMsg" autocomplete="off">/.test(html),
    "★ modalInput 显式 autocomplete=off，不再弹出 Chrome 历史组名建议及重定位三角");
}

section("T278d 目标 BPM 占位空间与全量 placeholder 清单");
{
  ok(/\.tg-flyout #trTarget\{width:64px;min-width:64px;max-width:100%\}/.test(CSS),
    "★ 目标 BPM 输入框放宽到 64px，并保留窄容器上限");
  ok(/\.tg-flyout #trEvery\{width:64px;min-width:64px;max-width:100%\}/.test(CSS),
    "★ 每级输入框同步放宽，两行第二列标签保持对齐");
  ok(/for \(let s = 1; s <= 6; s\+\+\)/.test(html)
      && /fret\.setAttribute\("placeholder", "品"\)/.test(html),
    "★ 动态生成的 6 个品数占位输入框也纳入真实浏览器空间检查");
  const placeholders = [...html.matchAll(/<input[^>]*placeholder=/g)].map(m => (m[0].match(/id="([^"]+)"/) || [])[1]);
  eq(placeholders.length, 5, "★ 静态标记中的 5 处 placeholder 均已纳入检查");
  ["trTarget", "presetSearch", "strFillIn", "patLabelInput", "songNameInput"].forEach(id => {
    ok(placeholders.includes(id), "placeholder 清单覆盖 #" + id);
  });
}
