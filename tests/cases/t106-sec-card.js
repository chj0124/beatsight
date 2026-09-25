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
  eq(opsOf(els, 0).children.length, 4, "★ ops = [起, 终, ▶, ⋯] 4 颗（重排/删除已收进菜单）");
  eq(opsOf(els, 0).children[0].getAttribute("aria-label"), "把第 1 段设为播放起点", "下标 0 仍是「起」（t54 定位不破）");
  eq(opsOf(els, 0).children[1].getAttribute("aria-label"), "把第 1 段设为播放终点", "下标 1 仍是「终」");
  eq(opsOf(els, 0).children[2].getAttribute("aria-label"), "试听第 1 段（只放这一段一遍）", "下标 2 是「▶ 试听」");
  eq(opsOf(els, 0).children[3].getAttribute("aria-label"), "更多段操作（上移 / 下移 / 移到首尾 / 删除）", "下标 3 是「⋯」");

  moreBtn(els, 0).fire("click");
  const menu = menuOf(els, 0);
  ok(!!menu, "★ 点 ⋯ 展开菜单（挂在段行末尾）");
  eq(menu.children.length, 5, "★ 菜单 5 项（上移/下移/移到最前/移到最后/删除段）");
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

/* ================= 场景 T106c：曲式级 ⋯ 菜单 · 结构 / 互斥 / 删除确认流 ================= */
section("T106c 曲式菜单 · 顶栏两颗 / 复制与删除 / 与新建菜单互斥");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  ok(!els["argCopy"] && !els["argDel"], "★ 顶栏「复制 / 删除」按钮已退役（v2.30.0 S1）");
  /* 桩从标记惰性建元素、不建静态父子关系（argNew.parentNode 为 null），
     所以 argActions.children 在桩里是空的——顶栏构成按"元素存在性"断言，
     子节点数留给真实浏览器的 smoke 兜（见 t106c 后半的菜单互斥流程） */
  ok(!!els["argNew"] && !!els["argLibMore"], "顶栏 = 新建 + ⋯ 两颗");
  eq(els["argLibMore"].disabled, false, "有当前曲式 → ⋯ 可用");

  els["argLibMore"].fire("click");
  const lib = els["argActions"].children.find(c => /(^| )arg-lib-menu( |$)/.test(c.className));
  ok(!!lib, "★ 曲式级菜单展开（挂在 #argActions 里）");
  eq(lib.children.length, 2, "菜单两项（复制当前曲式 / 删除当前曲式）");
  ok(/复制当前曲式为副本/.test(lib.children[0].getAttribute("aria-label") || ""), "复制项 aria 到位");

  /* 与新建模板菜单互斥：开新建先收曲式菜单 */
  els["argNew"].fire("click");
  ok(!els["argActions"].children.find(c => /(^| )arg-lib-menu( |$)/.test(c.className)),
    "★ 开新建菜单先收曲式菜单");
  const newMenu = els["argActions"].children.find(c => /(^| )arg-new-menu( |$)/.test(c.className));
  ok(!!newMenu, "新建菜单已展开");
  /* 开曲式菜单先收新建菜单（反向同样互斥） */
  els["argLibMore"].fire("click");
  ok(!els["argActions"].children.find(c => /(^| )arg-new-menu( |$)/.test(c.className)),
    "★ 开曲式菜单先收新建菜单");
  const lib2 = els["argActions"].children.find(c => /(^| )arg-lib-menu( |$)/.test(c.className));
  ok(!!lib2, "曲式菜单已展开");

  /* 删除当前曲式：确认弹窗流（与旧「删除」按钮同一语义） */
  const delBtn = Array.prototype.find.call(lib2.children,
    b => /删除当前曲式/.test(b.getAttribute("aria-label") || ""));
  delBtn.fire("click");
  eq(beat.Modal.isOpen(), true, "删除曲式要确认（不是点了就没）");
  els["modalOk"].fire("click");
  eq(beat.Store.arranges.length, 0, "确认后曲式被删");
  beat.Arrange.close();
}

/* ================= 场景 T106d：重渲染摘菜单残影（unbind 后的死 UI 防御） ================= */
section("T106d 残影防御 · 重渲染后 argActions 里不留死菜单");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  els["argLibMore"].fire("click");
  ok(!!els["argActions"].children.find(c => /(^| )arg-lib-menu( |$)/.test(c.className)), "前提：曲式菜单已展开");
  /* 任何触发 arrangeRender 的操作（这里用曲式库重选）都该把菜单摘掉——
     菜单按钮的监听已被 unbindOverlay 全量解绑，残影 = "点了没反应"的死 UI */
  els["argList"].children[0].fire("click");
  ok(!els["argActions"].children.find(c => /(^| )arg-(new|lib)-menu( |$)/.test(c.className)),
    "★ 重渲染后 argActions 里没有菜单残影");
  beat.Arrange.close();
}
