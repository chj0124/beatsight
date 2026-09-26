/* BeatSight 自动化测试 · S1 骨架重排（v2.30.0）：段操作 ⋯ 菜单 + 曲式级 ⋯ 菜单 + 互斥纪律
   T106 系列（PLAN-v4 S1）。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html buildSecRow / mkSecMenu / toggleLibMenu 的注释同源）：
     · 段行 DOM 顺序不变（[段号, 段名, 块, 操作, 歌词]），卡片化是纯 CSS（order 重排）——
       t54/t60 的既有定位（裸下标 + 歌词轨 children[4]）不破；
     · ops = [起, 终, ▶, ⋯] 四颗：重排/删除收进 ⋯ 菜单（.arg-sec-menu，挂段行末尾 =
       children[5]，歌词轨之后），菜单项全文字标签 + aria 定位；动作后菜单自动收起；
     · 顶栏「复制」按钮退役：复制/删除收进曲式级 ⋯（.arg-lib-menu），与新建模板菜单互斥；
       重渲染会摘掉两张菜单（unbind 后的残影 = 死 UI）；
     · 菜单与换型候选（picking）互斥：开一方先关另一方（同一时间至多一处）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seed3 = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t106", name: "三段歌", sections: [
    { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
    { uid: "uB", name: "B段", blocks: [BL(1, 1)] },
    { uid: "uC", name: "C段", blocks: [BL(1, 1)] },
  ] },
]}) });
const rows = els => els["argSections"].children;
const opsOf = (els, i) => rows(els)[i].children[3];
const moreBtn = (els, i) => Array.prototype.find.call(opsOf(els, i).children,
  b => /更多段操作/.test(b.getAttribute("aria-label") || ""));
const menuOf = (els, i) => Array.prototype.find.call(rows(els)[i].children,
  c => /(^| )arg-sec-menu( |$)/.test(c.className));
const menuItem = (menu, re) => menu && Array.prototype.find.call(menu.children,
  b => re.test(b.getAttribute("aria-label") || ""));
const names = beat => beat.Store.findArrange("t106").sections.map(s => s.name).join("");

/* ================= 场景 T106a：段操作 ⋯ 菜单 · 结构 / toggle / 动作后自收 ================= */
section("T106a 段菜单 · ops 四颗 / 菜单五项 / toggle 收起 / 动作后不残留");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  eq(opsOf(els, 0).children.length, 2, "★ ops = [▶, ⋯] 2 颗（v2.31.0 S2：起/终退役，其余在菜单）");
  eq(opsOf(els, 0).children[0].getAttribute("aria-label"), "试听第 1 段（只放这一段一遍）", "下标 0 是「▶ 试听」");
  eq(opsOf(els, 0).children[1].getAttribute("aria-label"), "更多段操作（练这段 / 上移 / 下移 / 移到首尾 / 删除）", "下标 1 是「⋯」");

  moreBtn(els, 0).fire("click");
  const menu = menuOf(els, 0);
  ok(!!menu, "★ 点 ⋯ 展开菜单（挂在段行末尾）");
  eq(menu.children.length, 6, "★ 菜单 6 项（练这段/上移/下移/移到最前/移到最后/删除段）");
  eq(menuItem(menu, /上移第 1 段/).disabled, true, "首段「上移」禁用");
  eq(menuItem(menu, /移到最前/).disabled, true, "首段「移到最前」禁用");
  eq(menuItem(menu, /移到最后/).disabled, false, "首段「移到最后」可用");
  eq(menuItem(menu, /删除第 1 段/).disabled, false, "多段时「删除段」可用");

  moreBtn(els, 0).fire("click");
  ok(!menuOf(els, 0), "★ 再点 ⋯ = 菜单收起（toggle，不是常开）");

  /* 菜单动作：移到最后 + 动作后自收 */
  moreBtn(els, 0).fire("click");
  menuItem(menuOf(els, 0), /移到最后/).fire("click");
  eq(names(beat), "B段C段A段", "★ 菜单「移到最后」生效（A 段到末尾）");
  /* 残留检查扫**所有**段行（动作后段序变了，菜单若残留不一定是原来那一行） */
  const anyMenu = Array.prototype.some.call(rows(els),
    r => Array.prototype.some.call(r.children, c => /(^| )arg-sec-menu( |$)/.test(c.className)));
  ok(!anyMenu, "★ 动作后菜单不残留（save → 重渲染即收）");
  beat.Arrange.close();
}

/* ================= 场景 T106b：菜单与换型候选互斥（同一时间至多一处） ================= */
section("T106b 互斥 · 开候选先收菜单 / 开菜单先收候选");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  moreBtn(els, 0).fire("click");
  ok(!!menuOf(els, 0), "前提：菜单已展开");

  /* 开候选（点块上的「换」）→ 菜单先收 */
  rows(els)[0].children[2].children[0].children[3].fire("click");
  ok(!menuOf(els, 0), "★ 开候选先收菜单（picking 与 secMenuOpen 互斥）");
  ok(/(^| )arg-pick( |$)/.test(rows(els)[1].className), "候选行就在触点正下方（既有契约不破）");

  /* 开菜单 → 候选先收 */
  moreBtn(els, 0).fire("click");
  eq(rows(els).length, 3, "★ 开菜单先收候选（候选行消失，回到三段行）");
  ok(!!menuOf(els, 0), "菜单已展开");
  beat.Arrange.close();
}

/* ================= 场景 T106c：删除就近化 · chip ✕ / 确认流 / 单曲式隐藏「当前曲式」chip ================= */
section("T106c 删除就近化 · chip ✕ / 确认流 / 单曲式隐藏「当前曲式」chip");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  ok(!els["argCopy"] && !els["argDel"] && !els["argLibMore"],
    "★ 顶栏「复制 / 删除 / ⋯」全部退役（v2.35.0：复制只留模板菜单、删除就近化）");
  /* 单曲式 → 「当前曲式」chip 隐藏（.single；内容写入点不动，v2.35.0 用户提问④） */
  eq(els["argNowRow"].classList.contains("single"), true, "★ 单曲式 → 「当前曲式」chip 隐藏");
  /* 再建一条 → ≥2 条 → chip 显示 */
  els["argNew"].fire("click");
  els["argLibRow"].children.find(c => /arg-new-menu/.test(c.className)).children[0].fire("click");
  eq(els["argNowRow"].classList.contains("single"), false, "★ ≥2 条 → chip 显示（防「编辑 A 播着 B」错位）");

  /* 选中 chip 的 ✕：aria 到位、确认流删除 */
  els["argList"].children[1].fire("click");            // 选中新建的那条
  const delSpot = els["argList"].children[1].children[2];
  /* ★ 守卫先行：变异删掉 ✕ 时 children[2] 是 undefined——必须表现为本条具名失败，
     而不是下一行读 className 时崩溃（崩溃不是证据，DEVELOPMENT 反向验证纪律） */
  ok(!!delSpot && /arg-item-del/.test(delSpot.className), "★ 选中 chip 右侧出现删除点（v2.35.0 就近化）");
  ok(/删除曲式「/.test(delSpot.getAttribute("aria-label") || ""), "删除点 aria 写明曲式名");
  delSpot.fire("click");
  eq(beat.Modal.isOpen(), true, "删除曲式要确认（不是点了就没）");
  els["modalOk"].fire("click");
  eq(beat.Store.arranges.length, 1, "确认后曲式被删");
  beat.Arrange.close();
}

/* ================= 场景 T106d：重渲染摘菜单残影（unbind 后的死 UI 防御） ================= */
section("T106d 残影防御 · 重渲染后 argLibRow 里不留死菜单");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  els["argNew"].fire("click");
  ok(!!els["argLibRow"].children.find(c => /(^| )arg-new-menu( |$)/.test(c.className)), "前提：新建菜单已展开");
  /* 任何触发 arrangeRender 的操作（这里用曲式库重选）都该把菜单摘掉——
     菜单按钮的监听已被 unbindOverlay 全量解绑，残影 = "点了没反应"的死 UI。
     v2.35.0：曲式级 ⋯ 退役，宿主只剩 argLibRow 一个 */
  els["argList"].children[0].fire("click");
  ok(!els["argLibRow"].children.find(c => /(^| )arg-new-menu( |$)/.test(c.className)),
    "★ 重渲染后 argLibRow 里没有菜单残影");
  beat.Arrange.close();
}
