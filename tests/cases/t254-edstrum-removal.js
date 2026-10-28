/* BeatSight 自动化测试 · 编辑器内联 .ed-strum 字形退役（v3.52.0）
   T254 系列。
   ---------------------------------------------------------------------------
   v2.74.0 引入主视图同款 .strumv 大竖箭头时，刻意保留了 v1.9.0 的 .ed-strum ↑↓
   内联字形（"方向沿用 ed-strum 字形"）。大箭头已完整表达方向、aria-label 兜底读屏，
   小箭头纯冗余（用户图二反馈）⇒ v3.52.0 整块删除：CSS 两条规则 + 编辑器渲染分支。
   本组钉：全仓（剥注释后）再无 .ed-strum 的任何**活用法**；且主视图 .strumv.dn/.up
   方向规则未伤（删的是编辑器那一份冗余记号，不是箭头本体）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const src = html;
/* 剥掉块注释与行首行注释后剩下的「活代码」——断言 .ed-strum 不再出现在标记 / JS / CSS 选择器里 */
const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const edCellsOf = (els, b) => els["editorBars"].children[b].children[1].children;
/* 递归收集一棵树下所有元素的 className（桩 children 与真 DOM 同构） */
function classesUnder(node, out){
  (node.children || []).forEach(c => { out.push(c.className || ""); classesUnder(c, out); });
  return out;
}

section("T254 .ed-strum 全仓退役（标记 / JS / CSS 选择器）；主视图方向规则未伤");
{
  ok(!/ed-strum/.test(codeOnly), "★ 全仓（剥注释后的活代码）再无 .ed-strum 的任何活用法");
  ok(!/class=["']?[^"'>]*ed-strum/.test(codeOnly), "标记里不再声明 ed-strum 类");
  ok(/\.strumv\.dn::after\{/.test(src) && /\.strumv\.up::after\{/.test(src),
     "★ 主视图 .strumv.dn::after / .up::after 方向规则仍在（删的只是编辑器那份冗余字形）");
  ok(/\.strumv\.dn::after\{[^}]*border-bottom:10px solid var\(--peak\)\}/.test(src) &&
     /\.strumv\.up::after\{[^}]*border-top:10px solid var\(--peak\)\}/.test(src),
     "方向三角着色规则逐位不变（主视图口径未伤）");
}

section("T254 运行时 · 编辑器 / 主视图都不产出 .ed-strum 节点");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "方向素材", meter: 4,
    bars: [[{ t:48, dir:"D" }, { t:48, dir:"U" }, { t:48, rest:true, dir:"D" }, { t:48 }]] }] })).ok,
    "方向素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  const edClasses = classesUnder(els["editorBars"], []);
  ok(edClasses.length > 0, "编辑器渲染出节点（否则本断言是空集）");
  eq(edClasses.filter(c => /(^| )ed-strum( |$)/.test(c)).length, 0,
     "★ 编辑器子树里零 .ed-strum 节点");

  beat.Viz.buildViz();
  const vizClasses = classesUnder(els["viz"], []);
  eq(vizClasses.filter(c => /(^| )ed-strum( |$)/.test(c)).length, 0, "主视图子树里零 .ed-strum 节点");
  eq(vizClasses.filter(c => /(^| )strumv( |$)/.test(c)).length > 0, true,
     "对照：主视图仍有 .strumv 竖箭头（证明上面的「零」不是因为没渲染）");
}
