/* BeatSight 自动化测试 · ③ 精修 的功能分组（3 行 / 5 组 / 可折叠 / 组级联动）（v3.33.20）
   T204 系列。
   ---------------------------------------------------------------------------
   用户拍板：「改功能，3 行」——13 颗按钮按功能分五组、排 3 行，组头可折叠，
   且「换位 / 时值」两组需要先选中一个字块（组级联动）。

   ★ 硬约束（本文件最重要的一条）：歌词区**必须保持扁平**——组头不包容器、
     按钮仍是 ly 的**直接子节点**。分行靠 `.arg-lyric-rowsep`（flex-basis:100% 的零高元素），
     而不是靠行容器。T204c 专门钉这条：`ly` 里不许出现包住按钮的新容器。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");
const src = html;

const cls = (el, c) => !!(el && el.className) && new RegExp("(^| )" + c + "( |$)").test(el.className);
const kids = (root, c) => (root.children || []).filter(x => cls(x, c));

/** 建「一个块的曲式 + 贴词 + 展开」夹具，返回该段的 .arg-lyric 元素 */
function fixture(){
  const app = loadApp();
  const { beat, els } = app;
  /* 4/4 一小节 = 192t：必须是 24×8 才通过 importPresets 的校验（96t 会被淘汰进隔离区） */
  const bars = [[{ t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }]];
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "分组夹具", meter: 4, bars }] })), "素材型导入");
  const id = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "分组曲式", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.upsertLyric(arr.id, arr.sections[0].uid, [
    { t: 0, dur: 24, ch: "一" }, { t: 24, dur: 24, ch: "二" },
    { t: 48, dur: 24, ch: "三" }, { t: 72, dur: 24, ch: "四" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  const ly = els["argSections"].children[0].children
    .find(c => /(^| )arg-lyric( |$)/.test(c.className));
  ok(!!ly, "前提：段行在");
  const sum = ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
  sum.fire("click");
  const ly2 = els["argSections"].children[0].children
    .find(c => /(^| )arg-lyric( |$)/.test(c.className));
  ok(!!ly2, "前提：展开后重取段元素（arrangeRender 整树重建）");
  return { beat, ly: ly2 };
}

section("T204a 行 / 组 · 组头与行分隔的数量与顺序");
{
  const { ly } = fixture();
  const heads = kids(ly, "arg-lyric-grp").map(h => h.textContent);
  /* v3.37.0（旋律谱 A 期）：五组三行 → 六组四行——新增「音高」组（音高− / 音高+ / 无音高），
     与「时值」同款"需先选中字块"的组级联动（T204d 同步覆盖） */
  eq(heads.join(" / "), "历史 / 范围 / 整段平移 / 换位 / 时值 / 音高",
     "★ 六个功能组的组头按顺序齐备（v3.37.0 增音高组）");
  eq(kids(ly, "arg-lyric-rowsep").length, 3,
     "★★ 恰好 3 条行分隔 ⇒ 精修按钮排成 **4 行**（v3.37.0 音高组入列）");
}

section("T204b 可折叠 · 组头切 hidden，aria-expanded 单一真相");
{
  const { ly } = fixture();
  const g = kids(ly, "arg-lyric-grp")[2];                       // 整段平移
  eq(g.getAttribute("aria-expanded"), "true", "默认展开");
  const SHIFT = ["◀1拍", "◀半拍", "◀1格", "1格▶", "半拍▶", "1拍▶"];
  const members = kids(ly, "arg-mini").filter(b => SHIFT.indexOf(b.textContent) >= 0);
  eq(members.length, 6, "前提：平移组 6 颗");
  ok(members.every(m => !m.hidden), "展开态：成员可见");
  g.fire("click");
  eq(g.getAttribute("aria-expanded"), "false", "★ 点一下 → 收起");
  ok(members.every(m => m.hidden === true), "★★ 收起 = 该组 6 颗逐个 hidden（不改 DOM 结构）");
  g.fire("click");
  ok(members.every(m => !m.hidden), "再点 → 展开");

  /* v3.33.21: 桩里 hidden 只是个**属性**、没有 CSS ⇒ 上面那条在桩里恒绿，而真机上
     `.arg-mini{display:inline-flex}` 会盖过 UA 给 [hidden] 的 display:none，于是"点了没反应"。
     用户实报「无法折叠」的真实根因——这条**只能靠源码钉**。 */
  ok(/\.arg-mini\[hidden\]\{display:none\}/.test(src),
     "CSS 补丁在位：.arg-mini[hidden]{display:none}（display 会盖过 UA 的 hidden）");
  ok(/\.arg-mini\{[^}]*display:inline-flex/.test(src),
     "前提：.arg-mini 确实设了 display ⇒ 该补丁必需，不是冗余");
}

section("T204c 硬约束 · 歌词区仍然扁平（组头不包容器）");
{
  const { ly } = fixture();
  /* 承载按钮的**必须**是 ly 本身：所有 .arg-mini 的 parentNode 都指向 ly */
  const btns = kids(ly, "arg-mini");
  ok(btns.length >= 13, "前提：精修按钮都在（" + btns.length + " 颗）");
  const wrapped = btns.filter(b => b.parentNode !== ly);
  eq(wrapped.length, 0,
     "★★ 没有一颗按钮被新的分组容器包走（parentNode 全 = ly）——扁平契约不破，t60/t108 定位零迁移");
}

section("T204d 组级联动 · 未选中字块时「换位 / 时值」整组置灰并给原因");
{
  const { ly } = fixture();
  const grpBtn = (name) => kids(ly, "arg-lyric-grp").find(g => g.textContent === name);
  const swap = kids(ly, "arg-mini").find(b => /与后字换位/.test(b.textContent));
  const dur = kids(ly, "arg-mini").filter(b => /时值[−+]1格/.test(b.textContent));
  eq(dur.length, 2, "前提：时值组 2 颗");
  ok(swap && swap.disabled === true, "★ 未选中：换位置灰");
  ok(dur.every(b => b.disabled === true), "★ 未选中：时值两颗都置灰");
  eq(swap.title, "先点按选中一个字块", "★★ 置灰**同时给出原因**（不是静默不可点）");
  ok(/需先选中一个字块/.test(grpBtn("换位").getAttribute("aria-label")),
     "★ 组头的 aria-label 也说清了原因");
  ok(kids(ly, "arg-mini").filter(b => /撤销|重做/.test(b.textContent)).every(b => b.disabled === true),
     "对照：历史组按**栈长**置灰（空栈 ⇒ 也灰，但原因不同、不挂「先选中」文案）");
}

section("T204e 范围组 · 显式按压态");
{
  const { ly } = fixture();
  const scopes = kids(ly, "arg-mini").filter(b => b.textContent === "✓ 全部字" || b.textContent === "从选中字");
  eq(scopes.length, 2, "前提：范围组 2 颗");
  eq(scopes.map(b => b.getAttribute("aria-pressed")).join(","), "true,false",
     "★ 默认「全部字」= pressed（显式单选语义，无容器故用 aria-pressed 而非伪造 radiogroup）");
}
