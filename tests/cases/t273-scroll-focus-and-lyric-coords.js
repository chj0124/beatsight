/* BeatSight 自动化测试 · 连续滚动单行专注视图 + 谱内歌词行内坐标（T273） */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

section("T273a scroll-belt 只在连续滚动 1 行生效");
{
  const app = loadApp();
  const { beat, els } = app;
  beat.Store.S.scrollMode = true;
  beat.Store.S.scrollRows = 1;
  beat.Viz.reloadScroll();
  ok(els.viz.classList.contains("scroll-mode"), "前提：连续滚动类已挂");
  ok(els.viz.classList.contains("scroll-belt"), "滚动 1 行挂大号专注视图类");
  beat.Store.S.scrollRows = 3;
  beat.Viz.reloadScroll();
  ok(!els.viz.classList.contains("scroll-belt"), "滚动 3 行摘下大号类，保持原密度");
  beat.Store.S.scrollRows = 1;
  beat.Store.S.scrollMode = false;
  beat.Viz.reloadScroll();
  ok(!els.viz.classList.contains("scroll-belt"), "分页不挂大号类（分页 1 行档也已退役）");
}

section("T273b 单行谱面 ×1.5，标注带不放大，普通 / 逐弦 / 窄屏整组联动");
{
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  ok(/#viz\.scroll-belt\{--cell-h:66px;--pick-h:66px;--pick-sy:1\.179;--gt:13px/.test(css),
    "桌面普通档：44→66，弦距与拨弦记号同步");
  ok(/#viz\.scroll-belt \.bar-row\{height:108px\}/.test(css)
    && /#viz\.scroll-belt \.ruler-lab\{top:89px\}/.test(css)
    && /#viz\.scroll-belt \.cell-label\{top:70px\}/.test(css),
    "普通整行 66+42=108，座次尺与时值标注重排");
  ok(/#viz\.scroll-belt\.has-pick\{--cell-h:84px;--pick-h:84px;--pick-sy:1\.5;--gt:16\.6px/.test(css),
    "桌面逐弦档：56→84，弦距与拨弦记号同步");
  ok(/#viz\.scroll-belt\.has-pick \.bar-row\{height:126px\}/.test(css)
    && /#viz\.scroll-belt\.has-pick \.ruler-lab\{top:107px\}/.test(css)
    && /#viz\.scroll-belt\.has-pick \.cell-label\{top:88px\}/.test(css),
    "逐弦整行 84+42=126，座次尺与时值标注重排");
  ok(/#viz\.scroll-belt,#viz\.scroll-belt\.has-pick\{--cell-h:51px;--pick-h:51px;--pick-sy:\.911;--gt:10px/.test(css),
    "窄屏普通与逐弦统一 34→51，不被桌面 has-pick 特异性截留");
  ok(/#viz\.scroll-belt \.bar-row,#viz\.scroll-belt\.has-pick \.bar-row\{height:83px\}/.test(css),
    "窄屏整行 51+32=83");
  ok(/const tabH = viz\.classList\.contains\("scroll-belt"\)\s*\? \(\(cell && cell\.offsetHeight\) \|\| \(viz\.classList\.contains\("has-pick"\) \? 84 : 66\)\)/.test(html),
    "大号单行的谱内歌词居中读实际格高，逐弦回退 84、普通回退 66");
  ok(/: \(viz\.classList\.contains\("has-pick"\) \? 56 : \(\(cell && cell\.offsetHeight\) \|\| 44\)\);/.test(html),
    "普通逐弦档仍按 56px 居中，不改变旧行为");
}

section("T273c 歌词与箭头分别消去各自行位移，再比较行内坐标");
{
  const start = html.indexOf("  function fitLyricTabLayout(");
  const end = html.indexOf("  function layoutLyricLane()", start);
  const body = start >= 0 && end > start ? html.slice(start, end) : "";
  ok(!!body, "前提：取得谱内避让函数");
  ok(/const grid = rowEls\[ri\], gr = grid \? grid\.getBoundingClientRect\(\) : rr;/.test(body),
    "箭头有自己的网格行坐标基准");
  ok(/symbols\.push\(\{ left: mr\.left - gr\.left - pad, right: mr\.right - gr\.left \+ pad \}\)/.test(body),
    "箭头减网格行 rect，消去滚动位移");
  ok(/x: lr\.left - rr\.left, w: lr\.width/.test(body),
    "歌词仍减歌词行 rect，双方都是行内局部坐标");
  ok(!/mr\.left - rr\.left|mr\.right - rr\.left/.test(body),
    "不得把未同步落位的箭头屏幕坐标直接减歌词行屏幕坐标");
}
