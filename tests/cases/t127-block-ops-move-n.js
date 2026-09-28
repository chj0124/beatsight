/* BeatSight 自动化测试 · 编排块级操作 + 段移到第 N 段（v2.55.0，C2 / C4）
   T127 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★ 覆盖 Batch 1a 的两条新交互（此前段菜单 / 块菜单都没有 UI 级回归）：
     · C2 块胶囊 ⋯ 菜单：左移 / 右移 / 复制 / 删除（+ 块默认沿用上一次型）。
     · C4 段 ⋯ 菜单「移到第 N 段」：数字提示跳到任意位；越界 / 取消 / 非数字 = 无操作。

   ★ 定位口径（与 t121 同源）：argSections.children[i] = 段行；段行 children 顺序
     [段号, 段名, 块区, 操作区, 歌词轨, (菜单行)]；菜单行共用 .arg-sec-menu 类，
     以 aria-label 含「块操作菜单」/「段操作菜单」区分。每次 fire 都会触发 arrangeRender
     重建，故操作后必须重新按 id 取 argSections.children。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const blockChips = blks => blks.children.filter(c => /(^| )arg-block( |$)/.test(c.className));
const menuOf = (secRow, sub) => secRow.children.find(c =>
  c.getAttribute && c.getAttribute("aria-label") && c.getAttribute("aria-label").includes(sub));
/* btnOf 同时匹配 aria-label 与 textContent：段菜单「移到第 N 段」项的 aria-label 是
   "把第 X 段移到指定位置"，而可见文案才是 "移到第 N 段"，单看 aria-label 会漏掉它。 */
const btnOf = (menu, sub) => menu.children.find(c =>
  c.getAttribute && ((c.getAttribute("aria-label") || "").includes(sub) || (c.textContent || "").includes(sub)));
const idxs = (beat, id, i) => beat.Store.findArrange(id).sections[i].blocks.map(b => b.ref.type === "builtin" ? b.ref.idx : b.ref.id);

function setup(){
  const { beat, els } = loadApp();
  ok(beat.Store.upsertArrange({ name: "编排", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }, { ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
    { name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 1 }] },
    { name: "C", blocks: [{ ref: { type: "builtin", idx: 3 }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);   // 干净起点：只剩这一首
  beat.Arrange.open();
  return { beat, els, id: arr.id };
}

/* ================= T127a：+ 块默认沿用上一次型（C2） ================= */
section("T127a +块 · 默认沿用上一次型（连续加同型块）");
{
  const { beat, els, id } = setup();
  let secRow = els["argSections"].children[0];
  const blks = byCls(secRow, "arg-blocks");
  const addBtn = blks.children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("加一块"));
  ok(!!addBtn, "＋块按钮存在");
  const before = beat.Store.findArrange(id).sections[0].blocks.length;
  const lastRef = JSON.parse(JSON.stringify(beat.Store.findArrange(id).sections[0].blocks[before - 1].ref));
  addBtn.fire("click");
  eq(beat.Store.findArrange(id).sections[0].blocks.length, before + 1, "块数 +1");
  eq(JSON.stringify(beat.Store.findArrange(id).sections[0].blocks[before].ref),
    JSON.stringify(lastRef), "★ 新块沿用上一次型（idx1）");
  beat.Arrange.close();
}

/* ================= T127b：块菜单 · 左移 / 右移 / 复制 / 删除（C2） ================= */
section("T127b 块菜单 · 左移禁用 / 复制 / 右移 / 删除");
{
  const { beat, els, id } = setup();
  const openBlockMenu = j => {
    const sr = els["argSections"].children[0];
    const cs = blockChips(byCls(sr, "arg-blocks"));
    cs[j].children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("更多操作")).fire("click");
    return menuOf(els["argSections"].children[0], "块操作菜单");
  };
  /* 初始段 A = [idx0, idx1] */
  let menu = openBlockMenu(0);
  ok(!!menu, "块菜单展开");
  eq(btnOf(menu, "左移一位").disabled, true, "★ 第 1 块左移禁用（无左侧邻居）");
  eq(btnOf(menu, "右移一位").disabled, false, "第 1 块可右移");
  /* 复制第 1 块 → [idx0, idx1, idx0] */
  btnOf(menu, "复制").fire("click");
  eq(idxs(beat, id, 0).length, 3, "复制 → 3 块");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([0, 0, 1]), "复制块插在原块之后，同型");
  /* 重开第 2 块（idx1）菜单，右移 → [idx0, idx0, idx1] */
  menu = openBlockMenu(1);
  eq(btnOf(menu, "右移一位").disabled, false, "第 2 块可右移");
  btnOf(menu, "右移一位").fire("click");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([0, 1, 0]), "★ 右移：idx1 落到末尾");
  /* 删除第 1 块（idx0，位于 [idx0, idx1, idx0] 的下标 0）→ [idx1, idx0] */
  menu = openBlockMenu(0);
  btnOf(menu, "删除第").fire("click");
  eq(JSON.stringify(idxs(beat, id, 0)), JSON.stringify([1, 0]), "★ 删除：剩 2 块，顺序保持");
  beat.Arrange.close();
}

/* ================= T127c：段菜单「移到第 N 段」+ 越界/取消无操作（C4） ================= */
section("T127c 段菜单 · 移到第 N 段 / 越界无操作 / 取消无操作");
{
  const { beat, els, id } = setup();
  const openSecMenu = i => {
    const sr = els["argSections"].children[i];
    byCls(sr, "arg-ops").children.find(c =>
      c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("更多段操作")).fire("click");
    return menuOf(els["argSections"].children[i], "段操作菜单");
  };
  const names = () => beat.Store.findArrange(id).sections.map(s => s.name);
  eq(JSON.stringify(names()), JSON.stringify(["A", "B", "C"]), "初始顺序 A/B/C");
  /* 段 A（第 1 段）移到第 3 段 */
  let menu = openSecMenu(0);
  ok(!!btnOf(menu, "移到第 N 段"), "段菜单含「移到第 N 段」");
  btnOf(menu, "移到第 N 段").fire("click");
  eq(els["modalInput"].hidden, false, "提示输入框出现");
  els["modalInput"].value = "3";
  els["modalOk"].fire("click");
  eq(JSON.stringify(names()), JSON.stringify(["B", "C", "A"]), "★ 段 A 跳到第 3 段");
  /* 越界：把段 B（现第 1 段）移到第 9 段（共 3 段）→ 无操作 */
  menu = openSecMenu(0);
  btnOf(menu, "移到第 N 段").fire("click");
  els["modalInput"].value = "9";
  els["modalOk"].fire("click");
  eq(JSON.stringify(names()), JSON.stringify(["B", "C", "A"]), "★ 越界（9 > 3）= 无操作");
  /* 取消：空值确定 → 无操作。
     ★ 越界那条走的是 early-return（不清除 secMenuOpen），所以菜单其实还开着——
     再 fire「⋯」会触发 toggle 把它关掉。这里直接复用已打开的菜单，而不是重新点开。 */
  menu = menuOf(els["argSections"].children[0], "段操作菜单");
  ok(!!menu, "★ 越界（无操作）后菜单仍开（可重试，不误关）");
  btnOf(menu, "移到第 N 段").fire("click");
  els["modalInput"].value = "";
  els["modalOk"].fire("click");
  eq(JSON.stringify(names()), JSON.stringify(["B", "C", "A"]), "★ 取消（空值）= 无操作");
  beat.Arrange.close();
}

/* ================= T127d：单块段的删除/移动禁用（C2 守卫） ================= */
section("T127d 单块段 · 删除 / 左移 / 右移 均禁用");
{
  const { beat, els, id } = setup();
  /* 段 B（第 2 段）只有 1 块 */
  const sr = els["argSections"].children[1];
  const cs = blockChips(byCls(sr, "arg-blocks"));
  eq(cs.length, 1, "段 B 只有 1 块");
  cs[0].children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("更多操作")).fire("click");
  const menu = menuOf(els["argSections"].children[1], "块操作菜单");
  ok(!!menu, "单块段也能开块菜单（仅看禁用态）");
  eq(btnOf(menu, "删除第").disabled, true, "★ 仅 1 块时删除禁用（一段至少 1 块）");
  eq(btnOf(menu, "左移一位").disabled, true, "仅 1 块时左移禁用");
  eq(btnOf(menu, "右移一位").disabled, true, "仅 1 块时右移禁用");
  eq(btnOf(menu, "复制").disabled, false, "复制始终可用");
  beat.Arrange.close();
}
