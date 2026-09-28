/* BeatSight 自动化测试 · 曲式结构撤销/重做（v2.56.0，C1）
   T128 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★ 覆盖 Batch 1b 的新能力（此前曲式结构改动不可撤销——这是编一首完整曲式时
     最大的失误成本）：以 Arrange.save() 为唯一结构写入口，每次 save 在落库前把
     「改前快照」压入按 arrangeId 各自的 50 步会话内存栈；撤销 = 回贴改前快照并把
     当前态压 redo；重做 = 反向。整份 arrange 深拷、secUid 原样保留（歌词按 secUid
     寻址，撤销段/块不能丢词）。

   ★ 定位口径（与 t106 / t127 同源）：argSections.children[i] = 段行（忽略 .arg-pick
     候选行）；段行 children 顺序 [段号, 段名, 块区, 操作区, 歌词轨, (菜单行)]；
     块胶囊 .arg-block 含 [名称, .arg-reps 遍数输入, 单位, 换, ✕, ⋯]；每次 fire 都
     触发 arrangeRender 重建，故操作后必须重新按 id 取 argSections.children。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const secRows = els => Array.prototype.filter.call(els["argSections"].children,
  c => !/(^| )arg-pick( |$)/.test(c.className));
const blockChips = blks => blks.children.filter(c => /(^| )arg-block( |$)/.test(c.className));
const menuOf = (secRow, sub) => secRow.children.find(c =>
  c.getAttribute && c.getAttribute("aria-label") && c.getAttribute("aria-label").includes(sub));
const btnOf = (menu, sub) => menu.children.find(c =>
  c.getAttribute && ((c.getAttribute("aria-label") || "").includes(sub) || (c.textContent || "").includes(sub)));
const ids = (beat, id) => beat.Store.findArrange(id).sections.map(s => s.uid);
const idxs = (beat, id, i) => beat.Store.findArrange(id).sections[i].blocks.map(b => b.ref.type === "builtin" ? b.ref.idx : b.ref.id);
const names = (beat, id) => beat.Store.findArrange(id).sections.map(s => s.name);

function setup(){
  const { beat, els } = loadApp();
  ok(beat.Store.upsertArrange({ name: "编排", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }, { ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
    { name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 1 }] },
    { name: "C", blocks: [{ ref: { type: "builtin", idx: 3 }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  return { beat, els, id: arr.id };
}
/* 打开块级 ⋯ 菜单（返回菜单行，已重新取段行） */
function openBlockMenu(els, i, j){
  const sr = secRows(els)[i];
  blockChips(byCls(sr, "arg-blocks"))[j]
    .children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("更多操作")).fire("click");
  return menuOf(secRows(els)[i], "块操作菜单");
}
/* 打开段级 ⋯ 菜单 */
function openSecMenu(els, i){
  byCls(secRows(els)[i], "arg-ops").children.find(c =>
    c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("更多段操作")).fire("click");
  return menuOf(secRows(els)[i], "段操作菜单");
}

/* ================= T128a：段删除 → 撤销（含 secUid 原样保留） ================= */
section("T128a 段删除 · 撤销恢复段与 secUid");
{
  const { beat, els, id } = setup();
  eq(ids(beat, id).length, 3, "初始 3 段");
  openSecMenu(els, 0);
  btnOf(menuOf(secRows(els)[0], "段操作菜单"), "删除第").fire("click");
  eq(els["modalOk"].hidden, false, "删除段要确认");
  els["modalOk"].fire("click");
  eq(ids(beat, id).length, 2, "★ 删除后剩 2 段");
  eq(JSON.stringify(names(beat, id)), JSON.stringify(["B", "C"]), "顺序 B/C");
  eq(els["argUndo"].disabled, false, "★ 删除后可撤销（按钮启用）");
  els["argUndo"].fire("click");
  eq(ids(beat, id).length, 3, "★ 撤销恢复 3 段");
  eq(JSON.stringify(names(beat, id)), JSON.stringify(["A", "B", "C"]), "★ secUid 原样：顺序 A/B/C 复原（歌词按 uid 寻址不丢）");
  eq(els["argUndo"].disabled, true, "撤销栈空 → 按钮禁用");
  eq(els["argRedo"].disabled, false, "redo 栈有内容 → 重做可用");
  beat.Arrange.close();
}

/* ================= T128b：块删除 → 撤销 ================= */
section("T128b 块删除 · 撤销恢复块");
{
  const { beat, els, id } = setup();
  eq(idxs(beat, id, 0).length, 2, "段 A 初始 2 块");
  const menu = openBlockMenu(els, 0, 0);
  btnOf(menu, "删除第").fire("click");
  eq(idxs(beat, id, 0).length, 1, "★ 删除后剩 1 块");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([1]), "剩下的是 idx1");
  els["argUndo"].fire("click");
  eq(idxs(beat, id, 0).length, 2, "★ 撤销恢复 2 块");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([0, 1]), "★ 顺序 [0,1] 复原");
  beat.Arrange.close();
}

/* ================= T128c：块右移 → 撤销（顺序回退） ================= */
section("T128c 块右移 · 撤销回退顺序");
{
  const { beat, els, id } = setup();
  let menu = openBlockMenu(els, 0, 0);          // 块 0 = idx0
  btnOf(menu, "右移一位").fire("click");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([1, 0]), "★ 右移 → [1,0]");
  els["argUndo"].fire("click");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([0, 1]), "★ 撤销回退 → [0,1]");
  beat.Arrange.close();
}

/* ================= T128d：＋块 → 撤销 ================= */
section("T128d ＋块 · 撤销去掉新增块");
{
  const { beat, els, id } = setup();
  const blks = byCls(secRows(els)[0], "arg-blocks");
  const addBtn = blks.children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("加一块"));
  addBtn.fire("click");
  eq(idxs(beat, id, 0).length, 3, "＋块后 3 块");
  els["argUndo"].fire("click");
  eq(idxs(beat, id, 0).length, 2, "★ 撤销回到 2 块");
  beat.Arrange.close();
}

/* ================= T128e：改遍数（repeats）→ 撤销 ================= */
section("T128e 改遍数 · 撤销恢复遍数");
{
  const { beat, els, id } = setup();
  const reps = blockChips(byCls(secRows(els)[0], "arg-blocks"))[0]
    .children.find(c => c.className && c.className.indexOf("arg-reps") >= 0);
  ok(!!reps, "块 0 有遍数输入");
  reps.value = "4";
  reps.fire("change");
  eq(beat.Store.findArrange(id).sections[0].blocks[0].repeats, 4, "★ 遍数改为 4");
  els["argUndo"].fire("click");
  eq(beat.Store.findArrange(id).sections[0].blocks[0].repeats, 1, "★ 撤销恢复遍数 1");
  beat.Arrange.close();
}

/* ================= T128f：重做（redo）恢复被撤销的操作 ================= */
section("T128f 重做 · 恢复被撤销的块删除");
{
  const { beat, els, id } = setup();
  const menu = openBlockMenu(els, 0, 0);
  btnOf(menu, "删除第").fire("click");
  eq(idxs(beat, id, 0).length, 1, "删除后 1 块");
  els["argUndo"].fire("click");
  eq(idxs(beat, id, 0).length, 2, "撤销后 2 块");
  eq(els["argRedo"].disabled, false, "重做可用");
  els["argRedo"].fire("click");
  eq(idxs(beat, id, 0).length, 1, "★ 重做再次删除 → 1 块");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([1]), "★ 重做结果 = 原删除结果");
  beat.Arrange.close();
}

/* ================= T128g：无操作不污染历史 + 空撤销无效 ================= */
section("T128g 无操作不压栈 · 空撤销无副作用");
{
  const { beat, els, id } = setup();
  eq(els["argUndo"].disabled, true, "初始无可撤销");
  /* 段名改成原值（空操作）→ save 落库但前后快照相同，不应压栈 */
  const nm = byCls(secRows(els)[0], "arg-name");
  nm.value = "A";
  nm.fire("change");
  eq(els["argUndo"].disabled, true, "★ 空操作不污染历史（按钮仍禁用）");
  /* 空撤销：栈空，调用无副作用、不报错 */
  const before = JSON.stringify(beat.Store.findArrange(id).sections);
  els["argUndo"].fire("click");
  eq(JSON.stringify(beat.Store.findArrange(id).sections), before, "★ 空撤销不改结构");
  beat.Arrange.close();
}

/* ================= T128h：每首曲式历史独立 ================= */
section("T128h 历史按曲式隔离 · 切曲式不串栈");
{
  const { beat, els } = loadApp();
  /* 甲给 2 块（否则删块会被「一段至少 1 块」守卫挡下，构不成真实历史） */
  ok(beat.Store.upsertArrange({ name: "甲", sections: [{ name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }, { ref: { type: "builtin", idx: 1 }, repeats: 1 }] }] }), "甲落库");
  ok(beat.Store.upsertArrange({ name: "乙", sections: [{ name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 1 }] }] }), "乙落库");
  const 甲 = beat.Store.arranges.find(a => a.name === "甲").id;
  const 乙 = beat.Store.arranges.find(a => a.name === "乙").id;
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  eq(beat.Store.findArrange(甲).sections[0].blocks.length, 2, "甲初始 2 块");
  /* 在甲上删块 */
  const m = openBlockMenu(els, 0, 0);
  btnOf(m, "删除第").fire("click");
  eq(beat.Store.findArrange(甲).sections[0].blocks.length, 1, "★ 甲删块后剩 1 块");
  eq(els["argUndo"].disabled, false, "★ 甲有撤销历史");
  /* 切到乙（点击曲式库 chip，按 Store.arranges 顺序 = 第 2 个） */
  els["argList"].children[1].fire("click");
  eq(els["argUndo"].disabled, true, "★ 切到乙：乙无历史 → 按钮禁用");
  els["argUndo"].fire("click");   // 对乙空撤销
  eq(beat.Store.findArrange(甲).sections[0].blocks.length, 1, "★ 乙的空撤销不波及甲（甲仍 1 块）");
  eq(beat.Store.findArrange(乙).sections[0].blocks.length, 1, "乙结构不变");
  /* 切回甲并撤销 */
  els["argList"].children[0].fire("click");
  els["argUndo"].fire("click");
  eq(beat.Store.findArrange(甲).sections[0].blocks.length, 2, "★ 切回甲撤销 → 块复原为 2");
  beat.Arrange.close();
}

/* ================= T128i：换型（pickPill）→ 撤销恢复 ref ================= */
section("T128i 换型 · 撤销恢复原节奏型");
{
  const { beat, els, id } = setup();
  const before = idxs(beat, id, 0)[0];
  eq(before, 0, "段 A 块 0 初始 idx0");
  /* 点块上的「换」开候选 */
  blockChips(byCls(secRows(els)[0], "arg-blocks"))[0]
    .children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("换第")).fire("click");
  const pickRow = Array.prototype.find.call(els["argSections"].children, c => /(^| )arg-pick( |$)/.test(c.className));
  ok(!!pickRow, "★ 候选行出现");
  /* 选第一个非当前的候选（class 不含 cur）——不依赖具体预设名 */
  const pill = Array.prototype.find.call(byCls(pickRow, "arg-blocks").children,
    c => c.tagName === "BUTTON" && !/(^| )cur( |$)/.test(c.className));
  ok(!!pill, "找到非当前的候选（可换型）");
  pill.fire("click");
  const after = idxs(beat, id, 0)[0];
  ok(after !== before, "★ 换型生效（ref 改变：" + before + " → " + after + "）");
  els["argUndo"].fire("click");
  eq(idxs(beat, id, 0)[0], before, "★ 撤销恢复原节奏型（idx" + before + "）");
  beat.Arrange.close();
}
