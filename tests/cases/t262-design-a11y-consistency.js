/* BeatSight 自动化测试 · 设计一致性与可达性收口（vNext）
   T262 系列。
   ---------------------------------------------------------------------------
   契约：
     · 文本输入框不再用 outline:none 抹掉焦点；搜索框把焦点环画在容器上；
     · 正文级警示文字走 --danger-fg（日间深红），实心危险按钮仍走 --red；
     · 样式表里的主题强调透明色统一走 rgba(var(--green-rgb), α)，不再写死经典绿；
     · 窄屏座次尺 / 时值标注最低 10px，放不下时交给既有 fitCellAnnotations 隐藏。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_NOCOMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const ROOT = CSS.slice(CSS.indexOf(":root{"), CSS.indexOf("\n}", CSS.indexOf(":root{")));
const OBS = CSS.slice(CSS.indexOf('body[data-theme="obs"]{'), CSS.indexOf("\n}", CSS.indexOf('body[data-theme="obs"]{')));
const ruleOf = sel => {
  const i = CSS_NOCOMMENTS.indexOf(sel);
  return i < 0 ? "" : CSS_NOCOMMENTS.slice(i, CSS_NOCOMMENTS.indexOf("}", i) + 1);
};

section("T262a 焦点可见性 · 文本输入不抹 outline，搜索框焦点环在容器上");
{
  ok(/:focus-visible\{outline:2px solid var\(--green\);outline-offset:2px\}/.test(CSS_NOCOMMENTS),
     "★ 全局 :focus-visible 焦点环在位（2px + offset）");
  ok(/\.pd-search:focus-within\{[^}]*outline:2px solid var\(--green\)/.test(CSS_NOCOMMENTS),
     "★★ 预设搜索框把焦点环画在容器上（内部 input 的 outline:0 由它兜住）");
  ok(!/\.tr-inp\{[^}]*outline:none/.test(CSS_NOCOMMENTS),
     "★★ 参数数字输入 .tr-inp 不再 outline:none");
  ok(!/\.name-input\{[^}]*outline:none/.test(CSS_NOCOMMENTS),
     "★★ 文本输入 .name-input 不再 outline:none");
  ok(!/\.str-fret\{[^}]*outline:none/.test(CSS_NOCOMMENTS),
     "★★ 逐弦品数输入 .str-fret 不再 outline:none");
  ok(!/\.arg-chd-cell:focus\{[^}]*outline:none/.test(CSS_NOCOMMENTS),
     "★★ 编排页和弦格 focus 不再抹 outline");
  ok(/input\[type=range\]:focus-visible::-webkit-slider-thumb\{[^}]*rgba\(var\(--green-rgb\),\.55\)/.test(CSS_NOCOMMENTS),
     "★ 滑杆仍走自定义 thumb 焦点环（不误恢复轨道 outline）");
}

section("T262b 警示前景色 · --danger-fg 分权且日间达 AA");
{
  ok(/--danger-fg:var\(--red\)/.test(ROOT), "★ 经典主题 --danger-fg 继承 --red（经典视觉不变）");
  ok(/--danger-fg:#B91C1C/.test(OBS), "★ 日间主题 --danger-fg = #B91C1C");
  [
    ".status.bad{",
    ".tg-flyout .f-note.warn{",
    "#trainerProg.warn{",
    ".preset-item .del:hover{",
    ".edbar-label.bad .n,",
    ".hint.bad-hint{",
    ".arg-block.dead{",
    ".arg-item-del:hover{",
  ].forEach(sel => ok(ruleOf(sel).includes("color:var(--danger-fg)"),
     "★ " + sel + " 正文警示色走 --danger-fg"));
  ok(!/(^|[^\w-])color:var\(--red\)/.test(CSS_NOCOMMENTS),
     "★★ 样式表不再有真正的 color:var(--red)（--red 只承担底色/描边，不再承担浅底正文）");

  const lum = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0);
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  ok(ratio("#B91C1C", "#EDF0F5") >= 4.5 && ratio("#B91C1C", "#E3E8F0") >= 4.5,
     "★★ #B91C1C 在 --card2/--cell 上均 ≥4.5:1（实测 "
       + ratio("#B91C1C", "#EDF0F5").toFixed(2) + " / " + ratio("#B91C1C", "#E3E8F0").toFixed(2) + "）");
}

section("T262c 主题令牌 · 样式表不再写死经典绿透明色");
{
  ok(!/rgba\(30,215,96,/.test(CSS_NOCOMMENTS),
     "★★ <style> 内不再有 rgba(30,215,96,…)（经典值由 --green-rgb 展开，日间随主题翻蓝）");
  [
    ".bar-row.current::before{",
    ".cell.next{",
    ".cell.active{",
    ".lyric-chip.on{",
    ".preset-arrange-group{border-left:2px solid rgba(var(--green-rgb),.45)",
    ".arg-map-seg.in-range{",
    ".arg-lyric-tag.ok{",
    ".arg-ol-row.sel{",
    ".arg-item.sel{background:rgba(var(--green-rgb),.13)",
  ].forEach(sel => ok(CSS_NOCOMMENTS.includes(sel),
     "★ " + sel + " 的主题透明色走 --green-rgb"));
}

section("T262d 窄屏标注下限 · 10px 起步，放不下就藏");
{
  ok(/\.ruler-lab\{top:52px;font-size:10px\}/.test(CSS_NOCOMMENTS),
     "★ 窄屏座次尺 9px → 10px");
  ok(/\.cell-label\{top:38px;font-size:10px\}/.test(CSS_NOCOMMENTS),
     "★ 窄屏时值标注 8px → 10px");
}
