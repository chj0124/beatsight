/* BeatSight 自动化测试 · 自定义节奏型覆盖保存与内置只读边界（T272） */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const PRESET = () => ({ name: "我的练习", song: "练习曲", meter: 4,
  bars: [[{ t: 48, str: [{ s: 2, f: 3 }] }, { t: 48 }, { t: 48 }, { t: 48 }]] });
const loadCustom = () => {
  const app = loadApp();
  app.beat.Store.importPresets(JSON.stringify({ presets: [PRESET()] }));
  const p = app.beat.Store.customs[0];
  app.beat.Store.upsertArrange({ id: "custom-save-test", name: "练习曲",
    sections: [{ name: "A", blocks: [{ ref: { type: "custom", id: p.id }, repeats: 1 }] }] });
  return { ...app, p };
};

section("T272-1 自定义覆盖保存 · 原 ID / 原引用 / 修改生效");
{
  const { beat, els, p } = loadCustom();
  const id = p.id;
  beat.Editor.openWith(p, { type: "custom", id });
  eq(beat.Editor.draft().name, "我的练习", "编辑自定义不再自动追加「-副本」");
  eq(els["savePresetBtn"].textContent, "保存修改", "主按钮 = 保存修改");
  eq(els["saveCopyBtn"].hidden, false, "自定义另存副本入口可见");
  ok(String(els["editorRefNote"].textContent).includes("自动更新"), "引用提示明确覆盖后自动生效");
  beat.Editor.draft().bars[0][0].str = [{ s: 2, dead: true }];
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, 1, "覆盖保存不新增条目");
  eq(beat.Store.customs[0].id, id, "原 ID 保留");
  eq(JSON.stringify(beat.Store.customs[0].bars[0][0].str), JSON.stringify([{ s: 2, dead: true }]),
     "修改内容写回原型");
  const ref = beat.Store.findArrange("custom-save-test").sections[0].blocks[0].ref;
  eq(ref.id, id, "曲式仍引用同一 ID");
  eq(JSON.stringify(beat.resolveRef(ref).bars[0][0].str), JSON.stringify([{ s: 2, dead: true }]),
     "曲式解析立即得到修改后的内容，无需换型");
}

section("T272-2 自定义另存副本 · 新 ID / 原型不动");
{
  const { beat, els, p } = loadCustom();
  const id = p.id;
  beat.Editor.openWith(p, { type: "custom", id });
  els["saveCopyBtn"].fire("click");
  eq(beat.Store.customs.length, 2, "另存副本新增一个条目");
  eq(beat.Store.customs[0].id, id, "原型 ID 不变");
  ok(beat.Store.customs[1].id !== id, "副本使用新 ID");
  eq(beat.Store.customs[1].name, "我的练习-副本", "副本名自动追加后缀");
}

section("T272-3 内置/示例曲只读 · 只能新增副本");
{
  const { beat, els } = loadApp();
  const builtin = beat.BUILTINS[0];
  const before = JSON.stringify(builtin);
  beat.Editor.openWith(builtin, { type: "builtin", idx: 0 });
  eq(els["savePresetBtn"].textContent, "保存为预设", "内置主按钮不是覆盖保存");
  eq(els["saveCopyBtn"].hidden, true, "内置不显示自定义覆盖/副本双按钮");
  ok(String(els["editorRefNote"].textContent).includes("只读"), "内置提示明确只读");
  els["songNameInput"].value = "内置副本";
  els["songNameInput"].fire("input");
  const n = beat.Store.customs.length;
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, n + 1, "内置只能新增自定义副本");
  eq(JSON.stringify(builtin), before, "内置/示例曲内容逐位不变");
}
