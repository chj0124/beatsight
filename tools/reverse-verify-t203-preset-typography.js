#!/usr/bin/env node
/* 反向变异验证（T203 · 预设库文字层级与同行排版）。只改临时副本，必须出现具名 ✗。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-t203-preset-typography.html");
function once(src, oldText, newText, name){
  const n = src.split(oldText).length - 1;
  if (n !== 1) throw new Error(name + "：锚点出现 " + n + " 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 区标题退回 12px 弱色", s => once(s,
    ".preset-section{font-size:14px;color:var(--t1);font-weight:600;margin:14px 0 0;",
    ".preset-section{font-size:12px;color:var(--t2);font-weight:600;margin:14px 0 8px;", "M1"),
   ["区标题 14px", "区标题使用主文字色"]],
  ["M2 名称说明禁止换行", s => once(s,
    "display:flex;align-items:baseline;flex-wrap:wrap;gap:0 8px",
    "display:flex;align-items:baseline;flex-wrap:nowrap;gap:0 8px", "M2"),
   ["可换行的基线 flex 行"]],
  ["M3 说明恢复独立行间距并拒绝省略", s => once(s,
    ".preset-item .meta{font-size:11px;color:var(--t3);margin-top:0;flex:1 1 120px;min-width:0;",
    ".preset-item .meta{font-size:11px;color:var(--t3);margin-top:3px;flex:1 1 0;min-width:12px;", "M3"),
   ["说明占据剩余空间", "长名称/说明不会挤爆条目"]],
  ["M4 删除完整悬停提示", s => once(s,
    "nm.textContent = name; nm.title = name;",
    "nm.textContent = name;", "M4"),
   ["省略后仍保留完整名称与说明"]],
  ["M5 说明取消右对齐", s => once(s,
    "min-width:0;text-align:right;",
    "min-width:0;text-align:left;", "M5"),
   ["说明铺满剩余空间并右对齐"]],
  ["M6 拍数移出折叠体", s => {
    const block = `          <span class="basic-slot">\n            <span class="lab">拍数</span>\n            <select class="loop-sel" id="sigSel" aria-label="拍数：基础节奏每小节几拍（0 为每拍均等、不分重拍）"></select>\n          </span>\n`;
    const moved = once(s, block, "", "M6 摘除");
    return once(moved, '        <div id="rhyBeatBox">', block + '        <div id="rhyBeatBox">', "M6 移位");
   }, ["拍数位于折叠体第一行", "拍数与细分都在 #rhyBeatBox 内"]],
  ["M7 拍数重新孤立贴右", s => once(s,
    ".basic-slot{display:flex;align-items:center;justify-content:flex-start;gap:6px}",
    ".basic-slot{display:flex;align-items:center;justify-content:flex-end;gap:6px}", "M7"),
   ["拍数与下方内容共用左缘"]],
  ["M8 操作图标默认可见并压字", s => once(s,
    "opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s",
    "opacity:1;visibility:visible;pointer-events:auto;transition:opacity .12s", "M8"),
   ["操作按钮默认不占位、不进 Tab 顺序"]],
  ["M9 操作状态连名称一起隐藏", s => once(s,
    ".preset-item.active .meta{opacity:0}",
    ".preset-item.active .meta,.preset-item.active .name{opacity:0}", "M9"),
   ["名称始终显示"]],
  ["M10 最右图标与说明右缘错位", s => once(s,
    ".preset-item .preset-actions{position:absolute;right:6px",
    ".preset-item .preset-actions{position:absolute;right:4px", "M10"),
   ["最右图标与说明共用 12px 内容右缘"]],
  ["M11 分区首条目间距改为 12px", s => once(s,
    ".preset-section+.preset-arrange-group>.preset-item:first-child{padding-top:8px}",
    ".preset-section+.preset-arrange-group>.preset-item:first-child{padding-top:12px}", "M11"),
   ["分区首条目上内边距 8px"]],
  ["M12 播放绿点再次偏上", s => once(s,
    "margin-top:-3px;border-radius:50%",
    "margin-top:-6px;border-radius:50%", "M12"),
   ["真正垂直居中"]],
  ["M13 歌曲说明恢复 120px 换行基准", s => once(s,
    ".preset-item.song>div:first-child{flex-wrap:nowrap}\n.preset-item.song .meta{flex:1 1 0}",
    ".preset-item.song>div:first-child{flex-wrap:wrap}\n.preset-item.song .meta{flex:1 1 120px}", "M13"),
   ["长歌名与说明不再被 120px 基准宽度挤成两行"]],
  ["M14 示例子说明恢复重复曲名与单小节", s => {
    const anchor = 'desc: sp.meter + "/4" + (sp.bars.length > 1 ? " · " + sp.bars.length + " 小节" : "")';
    const count = s.split(anchor).length - 1;
    if (count !== 2) throw new Error("M14：锚点出现 " + count + " 次，预期两首各一处");
    return s.replace(anchor, 'desc: "4/4 · 示例曲名重复 · 单小节"');
   }, ["默认只显示拍号"]],
  ["M15 歌曲子条目恢复换行", s => once(s,
    ".preset-item.in-song>div:first-child{flex-wrap:nowrap}\n.preset-item.in-song .meta{flex:1 1 0}",
    ".preset-item.in-song>div:first-child{flex-wrap:wrap}\n.preset-item.in-song .meta{flex:1 1 120px}", "M15"),
   ["歌曲子条目也禁止名称与 4/4 换行"]],
  ["M16 子条目恢复父级字号", s => once(s,
    ".preset-item.in-song .name{font-size:12px;font-weight:500;color:var(--t2)}",
    ".preset-item.in-song .name{font-size:13px;font-weight:500;color:var(--t1)}", "M16"),
   ["子节奏型名称比父级小一级"]],
  ["M17 曲式模式重新收起循环面板", s => once(s,
    "p.hidden = false;\n    const toggle = $(\"loopToggle\");",
    "p.hidden = !usable;\n    const toggle = $(\"loopToggle\");", "M17"),
   ["曲式模式 → 面板不收起"]],
  ["M18 操作组恢复固定槽位", s => once(s,
    "display:flex;align-items:center;gap:4px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s",
    "display:block;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s", "M18"),
   ["操作组按实际按钮数量排列"]],
  ["M19 折叠箭头退回文本基线", s => once(s,
    'content:"▸";display:inline-flex;align-items:center;justify-content:center;',
    'content:"▸";display:inline-block;', "M19"),
   ["折叠箭头有独立居中盒"]],
];
let hitN = 0, missN = 0;
const ONLY = process.env.MUT_ONLY || "";
for (const [name, fn, keys] of MUTANTS){
  if (ONLY && !name.startsWith(ONLY + " ")) continue;
  let mut;
  try { mut = fn(orig); } catch (e){ console.log("!! " + e.message); missN++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, ["tests/run.js"], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8",
    timeout: 1800000, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").map(l => l.trim()).filter(l => l.startsWith("✗")).map(l => l.slice(1).trim());
  const hit = failed.filter(f => keys.some(k => f.includes(k)));
  console.log("=".repeat(72) + "\n变异：" + name);
  if (hit.length){
    for (const f of hit.slice(0, 5)) console.log("   ✗ " + f.slice(0, 110));
    console.log("  ✓ 具名断言变红：" + hit.length + " 条"); hitN++;
  } else {
    console.log("  ⚠ 无具名断言变红");
    for (const f of failed.slice(0, 5)) console.log("     (实际红的是) ✗ " + f.slice(0, 110));
    missN++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72) + "\n命中 " + hitN + " / 未命中 " + missN);
process.exit(missN ? 1 : 0);
