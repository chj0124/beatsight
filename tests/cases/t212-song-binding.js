/* T212 节奏型绑定歌名（v3.35.7）
   ---------------------------------------------------------------------------
   用户需求：「以后编辑节奏型之后，仍然把它归到自定义里面，但需要用户给一个歌名或名称，
   然后再去曲式编排里面继续编辑。」

   钉六件事：
     ① 保存**必填歌名**：空着 ⇒ 保存键禁用 + 状态栏指出差的是哪一步（不是点了才报错）
     ② 填新名 ⇒ 自动建同名曲式（1 段 1 块 = 刚保存的这个型）；已有同名曲式则**不动它**
     ③ 歌名随预设落库（customs[].song）并进导出面（validatePreset 白名单）⇒ 备份可往返
     ④ 库：歌行展开 = 曲式引用到的型 ∪ **归属**这首歌的自定义型
     ⑤ 库：无归属的老型进「未归属」行（可展开、无 ▶）；歌名在、曲式没了也有一行
     ⑥ 编排页换型候选：置顶区「本归属 · <曲式名>」，且同一颗胶囊不在两处重复
   ============================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const boxOf = els => els["presetList"].children
  .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const rowsOf = els => boxOf(els).children.filter(c => /(^| )song( |$)/.test(c.className));
const nameOf = it => it.children[0].children[0].textContent;
const rowOf = (els, name) => rowsOf(els).find(r => nameOf(r) === name);
const inSongOf = els => boxOf(els).children.filter(c => /(^| )in-song( |$)/.test(c.className));
const deepItems = els => {
  const out = [];
  const walk = n => Array.from(n.children || []).forEach(c => { out.push(c); walk(c); });
  walk(els["presetList"]);
  return out;
};
/** 打开编辑器并填好歌名（本套件只关心「绑定」这一段，拍面一律用当前型的合法副本） */
const editorWithSong = (els, song) => {
  els["editBtn"].fire("click");
  if (song !== undefined){
    els["songNameInput"].value = song;
    els["songNameInput"].fire("input");
  }
};

section("T212a 保存必填歌名 · 空着时保存键禁用并说明差在哪一步");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  els["editBtn"].fire("click");
  eq(els["savePresetBtn"].disabled, true, "★ 歌名为空 ⇒ 保存禁用（没有「单独创建一条节奏型」这回事）");
  /* ★ v3.35.9：缺归属的提示在**字段旁**（输入框标红 + 提示转红字），卡片头只报草稿级问题 */
  ok(els["songHint"].textContent.includes("还差一步") && els["songNameInput"].classList.contains("bad"),
     "★ 提示就在归属字段旁，且输入框标红（实际「" + els["songHint"].textContent + "」）");
  ok(!/归属/.test(els["editorStatus"].textContent), "★ 卡片头那行只报草稿级问题");
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, 0, "★ 且真的存不进去（禁用 + 处理器里再兜一道）");
  els["songNameInput"].value = "绑名测试歌";
  els["songNameInput"].fire("input");
  eq(els["savePresetBtn"].disabled, false, "填上歌名 ⇒ 保存可用");
  ok(/校验通过/.test(els["editorStatus"].textContent), "状态栏转为校验通过");
}

section("T212b 保存 ⇒ 歌名落库 + 自动建同名曲式（已有则不动）");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  const n0 = beat.Store.arranges.length;
  editorWithSong(els, "我的新歌");
  els["presetNameInput"].value = "前奏型";
  els["savePresetBtn"].fire("click");
  const c = beat.Store.customs[beat.Store.customs.length - 1];
  eq(beat.Store.customs.length, 1, "保存成功");
  eq(c.song, "我的新歌", "★ customs[].song 落库 = 归属歌名");
  eq(beat.Store.arranges.length, n0 + 1, "★ 没有同名曲式 ⇒ 自动建了一条");
  const a = beat.Store.arranges.find(x => x.name === "我的新歌");
  ok(!!a, "★ 曲式名 = 歌名");
  eq(a.sections.length, 1, "★ 1 段");
  eq(a.sections[0].blocks.length, 1, "★ 1 块");
  eq(JSON.stringify(a.sections[0].blocks[0].ref), JSON.stringify({ type: "custom", id: c.id }),
     "★ 那一块引用的就是刚保存的这个型（去编排页就有起点）");
  eq(a.sections[0].blocks[0].repeats, 1, "1 遍");
  ok(!a.sections[0].blocks.some(b => b.ref.type === "builtin"), "新曲式里不放内置型凑数");
  const n1 = beat.Store.arranges.length;
  editorWithSong(els, "我的新歌");
  els["presetNameInput"].value = "副歌型";
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, 2, "第二条型也存下了");
  eq(beat.Store.arranges.length, n1, "★ 已有同名曲式 ⇒ 不动它（不重复建）");
  eq(beat.Store.arranges.find(x => x.name === "我的新歌").sections[0].blocks.length, 1,
     "★ 也不往已有曲式里自动塞块（用户的编排决定权不被抢）");
}

section("T212c 歌名随导出/导入往返（validatePreset 白名单）");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  editorWithSong(els, "往返测试歌");
  els["presetNameInput"].value = "往返型";
  els["savePresetBtn"].fire("click");
  const json = beat.Store.serializePresets();
  ok(/"song": ?"往返测试歌"/.test(json), "★ 导出 JSON 里带 song 字段");
  const { beat: b2 } = loadApp(undefined, { seedDemo: false });
  b2.Store.importPresets(json);
  eq(b2.Store.customs.length, 1, "导入成功");
  eq(b2.Store.customs[0].song, "往返测试歌", "★ 导入后归属原样保留（备份换机后仍挂同一首歌下）");
  const { beat: b3 } = loadApp(undefined, { seedDemo: false });
  b3.Store.importPresets(JSON.stringify({ presets: [{ name: "脏歌名", meter: 4, song: 42,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  eq(b3.Store.customs[0].song, undefined, "★ 脏 song（非字符串）静默降级为省略，不牵连整条预设");
}

section("T212d 库 · 歌行展开 = 引用到的型 ∪ 归属这首歌的型");
{
  /* ★ 示例曲是**首次打开**才带出的：harness 默认落「已带出」的闩 ⇒ 要显式 seedDemo:false */
  const { els } = loadApp(undefined, { seedDemo: false });
  editorWithSong(els, "《在他乡》（示例）");
  els["presetNameInput"].value = "我加的前奏型";
  els["savePresetBtn"].fire("click");
  const row = rowOf(els, "《在他乡》（示例）");
  ok(!!row, "前提：示例曲有歌曲行");
  if (row.getAttribute("aria-expanded") === "false") row.fire("click");
  const names = inSongOf(els).map(nameOf);
  ok(names.includes("我加的前奏型"), "★ 归属这首歌的自定义型出现在它的展开内容里（实际 " + names.join("、") + "）");
  ok(names.includes("十六分满扫（《在他乡》前奏）"), "★ 原有「曲式引用到的型」一条不少");
  eq(names.filter(n => n === "我加的前奏型").length, 1, "★ 只出现一次（引用 ∪ 归属 要去重）");
  ok(rowsOf(els).every(r => nameOf(r) !== "未归属"), "有归属的型不进「未归属」行");
}

section("T212e 库 · 「未归属」行与「歌名在、曲式没了」行");
{
  const { beat, els } = loadApp();
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "老型无归属", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] },
    { name: "老型有歌名", meter: 4, song: "已经删掉的歌", bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }
  ] }));
  beat.Presets.refreshAfterPatternChange();
  const orph = rowOf(els, "未归属");
  ok(!!orph, "★ 无归属的老型有「未归属」行可进");
  ok(orph.classList.contains("song-only"), "该行是 song-only（只有归属、没有曲式）");
  ok(!orph.children.some(c => /(^| )aud( |$)/.test(c.className)),
     "★ 它没有 ▶（没有曲式可播，不给一个按了没反应的按钮）");
  orph.fire("click");
  const deep1 = deepItems(els).filter(c => /(^| )in-song( |$)/.test(c.className)).map(nameOf);
  ok(deep1.includes("老型无归属"), "★ 展开后看到那个型");
  const named = rowOf(els, "已经删掉的歌");
  ok(!!named, "★ 歌名还在、曲式没了 ⇒ 也有自己一行（否则这条型无处可去）");
  named.fire("click");
  const deep2 = deepItems(els).filter(c => /(^| )in-song( |$)/.test(c.className)).map(nameOf);
  ok(deep2.includes("老型有歌名"), "★ 展开后看到它");
}

section("T212f 编排页候选 · 「本归属」置顶且不重复");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  editorWithSong(els, "《在他乡》（示例）");
  els["presetNameInput"].value = "候选置顶型";
  els["savePresetBtn"].fire("click");
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "无关型", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  beat.Arrange.open();
  const secs = els["argSections"].children;
  const pickBtn = secs[0].children[2].children[0].children[3];
  ok(!!pickBtn, "前提：找到块 chip 的「换」钮");
  pickBtn.fire("click");
  const pickRow = els["argSections"].children[1];
  ok(!!pickRow && /(^| )arg-pick( |$)/.test(pickRow.className), "前提：候选行就地在下方");
  const zones = pickRow.children[1].children
    .filter(c => /(^| )arg-pick-zone( |$)/.test(c.className)).map(z => z.textContent);
  eq(zones[0], "本归属 · 《在他乡》（示例）", "★ 第一个区头是「本归属」（置顶）");
  const songZoned = [], rest = [];
  let zone = "";
  pickRow.children[1].children.forEach(c => {
    if (/(^| )arg-pick-zone( |$)/.test(c.className)){ zone = c.textContent; return; }
    if (!/(^| )arg-mini( |$)/.test(c.className)) return;
    (zone.indexOf("本归属") === 0 ? songZoned : rest).push(String(c.textContent).replace("✓ ", ""));
  });
  ok(songZoned.some(t => t.indexOf("候选置顶型") >= 0), "★ 归属本项的型进了「本归属」区");
  ok(songZoned.some(t => t.indexOf("十六分满扫") >= 0), "★ 这条曲式引用到的型也进了「本归属」区");
  ok(!rest.some(t => t.indexOf("候选置顶型") >= 0), "★ 且不在下面分区里重复出现");
  ok(rest.some(t => t.indexOf("无关型") >= 0), "前提：不属于本项的型仍在「自定义」区（候选没被砍掉）");
}
section("T212g 已在组里的型不重复渲染（组里一份、未归属行不再来一份）");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "组里的型", meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  const id = beat.Store.customs[0].id;
  ok(beat.Store.groupMove({ type: "custom", id }, "beat", "我的组"), "前提：把这条型移进节拍区的一个组");
  beat.Presets.refreshAfterPatternChange();
  const deep = [];
  const walk = n => Array.from(n.children || []).forEach(c => { deep.push(c); walk(c); });
  walk(els["presetList"]);
  const shown = deep.filter(c => /(^| )in-song( |$)/.test(c.className)
      || /(^| )preset-item( |$)/.test(c.className))
    .filter(c => String((c.children[0] && c.children[0].children[0] || {}).textContent || "").includes("组里的型"));
  eq(shown.length, 1, "★ 库里只渲染一份（此前会在「组员」与「未归属」两处各来一份）");
  ok(rowsOf(els).every(r => nameOf(r) !== "未归属"),
     "★ 且不再出现在「未归属」行（它已经有家了：那个组）");
}

