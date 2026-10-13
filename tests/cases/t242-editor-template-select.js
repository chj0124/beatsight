/* BeatSight 自动化测试 · 编辑器模板下拉（v3.48.0 新功能）
   T242 系列。
   ---------------------------------------------------------------------------
   契约（编辑器顶栏「模板」下拉，#editorTplSel）：
     · 选项 = 占位「选模板…」+ 内置（value "b{idx}"，文案「内置 · 名」）+ 我的预设
       （value "c{id}"，文案「我的 · 名」）；每次 openWith 重建（自定义列表会变）；
     · 载入 = 只换**内容**（meter/accents/bars）——名称/标注/归属保留用户已填；
       标题（editorTitle）改挂新底稿名；
     · pushUndo 先行 = 一步可撤销（与换拍数同一纪律）；dirty 先确认（uiConfirm）；
     · 动作型下拉：选完拨回占位（value ""）——它是动作不是状态。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

section("T242-1 模板下拉 · 选项构成 / 载入替换 / 名称归属保留 / 撤销 / 回占位");
{
  const { beat, els } = loadApp();
  const Ed = beat.Editor, St = beat.Store;
  St.importPresets(JSON.stringify({ presets: [{ name: "我的分解", meter: 3,
    bars: [0, 1, 2].map(() => [{ t: 48, str: [{ s: 5 }] }, { t: 48 }, { t: 48 }]) }] }));
  Ed.open();
  const sel = els["editorTplSel"];
  ok(!!sel, "前提：模板下拉存在（#editorTplSel）");
  eq(sel.children[0].value, "", "首项 = 占位（value 空串）");
  eq(sel.children[0].textContent, "选模板…", "占位文案「选模板…」");
  eq(sel.children.length, 1 + beat.BUILTINS.length + 1,
     "选项数 = 占位 1 + 内置 N + 我的预设 1");
  const names = sel.children.map(o => o.textContent);
  ok(names.includes("内置 · " + beat.BUILTINS[0].name), "内置项在列（「内置 · 」前缀分组）");
  ok(names.includes("我的 · 我的分解"), "我的预设项在列（「我的 · 」前缀分组）");
  ok(sel.children.every(o => o.value === "" || String(o.value)[0] === "b" || String(o.value)[0] === "c"),
     "value 协议：b{内置下标} / c{自定义 id}");

  /* 载入内置 0：内容整体替换、标题改挂、名称/归属保留、回占位 */
  const tpl = beat.BUILTINS[0];
  const nameBefore = els["presetNameInput"].value;
  const barsBefore = JSON.stringify(Ed.draft().bars);
  const meterBefore = Ed.draft().meter;
  sel.value = "b0"; sel.fire("change");
  eq(JSON.stringify(Ed.draft().bars), JSON.stringify(tpl.bars), "★ 载入模板 → bars 整体替换");
  eq(Ed.draft().meter, tpl.meter, "★ 拍号随模板");
  eq(sel.value, "", "★ 选完回占位（动作型下拉，不摆假态）");
  ok(String(els["editorTitle"].textContent).includes("「" + tpl.name + "」"), "标题改挂新底稿名");
  eq(els["presetNameInput"].value, nameBefore, "★ 名称保留（不替用户改名）");
  eq(els["songNameInput"].value, "", "★ 归属保留（空仍空）");
  ok(!Ed.draft().bars[0][0] || Ed.draft().bars[0][0] !== tpl.bars[0][0],
     "载入是拷贝不是引用（编辑草稿不回流内置型）");

  /* 撤销：一步退回模板前 */
  Ed.undo();
  eq(JSON.stringify(Ed.draft().bars), barsBefore, "★ Ctrl+Z 一步退回模板前内容");
  eq(Ed.draft().meter, meterBefore, "撤销含拍号（快照 {m, b}，同换拍数口径）");
  Ed.tryClose();
}

section("T242-2 模板下拉 · dirty 先确认（丢弃保护与换拍数同口径）");
{
  const { beat, els } = loadApp();
  const Ed = beat.Editor;
  Ed.open();
  els["presetNameInput"].fire("input");           // 改名 = dirty（v3.31.x 挂的监听）
  const before = JSON.stringify(Ed.draft().bars);
  els["editorTplSel"].value = "b1"; els["editorTplSel"].fire("change");
  eq(JSON.stringify(Ed.draft().bars), before, "★ dirty 时先确认：未点确定内容不变");
  eq(els["editorTplSel"].value, "", "未确认也回占位（先拨回再问，同拍数下拉手法）");
  els["modalOk"].fire("click");                   // uiConfirm 确定
  eq(JSON.stringify(Ed.draft().bars), JSON.stringify(beat.BUILTINS[1].bars), "★ 确认后载入");
  Ed.tryClose();
}

section("T242-3 模板下拉 · 自定义型作模板 + 脏项防御");
{
  const { beat, els } = loadApp();
  const Ed = beat.Editor, St = beat.Store;
  St.importPresets(JSON.stringify({ presets: [{ name: " myTpl ", meter: 3,
    bars: [0, 1].map(() => [{ t: 48 }, { t: 48, rest: true }, { t: 48 }]) }] }));
  const mine = St.customs[St.customs.length - 1];
  Ed.open();
  const sel = els["editorTplSel"];
  sel.value = "c" + mine.id; sel.fire("change");
  eq(JSON.stringify(Ed.draft().bars), JSON.stringify(mine.bars), "★ 我的预设同样可作模板载入");
  eq(Ed.draft().meter, 3, "自定义模板的拍号随载");
  /* 脏 value（不存在的 id / 空串）不炸不动草稿 */
  const now = JSON.stringify(Ed.draft().bars);
  sel.value = "c__no_such_id__"; sel.fire("change");
  sel.value = ""; sel.fire("change");
  eq(JSON.stringify(Ed.draft().bars), now, "脏 value / 占位回火：草稿不动、不抛错");
  Ed.tryClose();
}
