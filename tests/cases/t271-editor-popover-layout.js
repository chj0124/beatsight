/* BeatSight 自动化测试 · 音符属性浮层逐弦网格溢出（T271） */
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, section } = require("../lib/harness");
const html = fs.readFileSync(process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html"), "utf8");
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1].replace(/\/\*[\s\S]*?\*\//g, "");
const rule = sel => {
  const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{[^}]*\\}").exec(css);
  return m ? m[0] : "";
};

section("T271 逐弦两列网格 · 原生技巧下拉不得顶出浮层右缘");
{
  const grid = rule(".ed-str .str-lines");
  ok(grid.includes("width:100%") && grid.includes("min-width:0"),
     "网格作为 flex 子项可收缩，不按最长内容向外撑");
  ok(grid.includes("grid-template-columns:repeat(2,minmax(0,1fr))"),
     "两列 minmax(0,1fr)，第二列不获得隐式 min-content 外溢");
  ok(rule(".str-line").includes("min-width:0"), "每行允许在列内收缩");
  const fret = rule(".str-fret");
  ok(fret.includes("box-sizing:border-box") && fret.includes("flex:0 0 48px"),
     "品数框 48px 含内边距与边框，不额外撑宽");
  const tech = rule(".ed-str .str-tech");
  ok(tech.includes("width:0") && tech.includes("min-width:0") && tech.includes("max-width:100%") && tech.includes("flex:1 1 auto"),
     "原生 select 以剩余空间伸缩，最长技巧选项不决定列宽");
}
