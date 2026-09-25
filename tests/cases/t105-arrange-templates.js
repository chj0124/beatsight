/* BeatSight 自动化测试 · G2 编辑效率之一：模板新建 + 复制曲式（v2.27.0）
   T105 系列（PLAN-v3 阶段二 S2）。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html buildTemplateArrange 的注释同源）：
     · 四条模板路（空白 / 主副歌骨架 / 完整流行曲式 / 复制当前）全是**纯数据预填**，
       产物一律走 Store.upsertArrange——结构校验、段 uid 发放、持久化都在同一条边界上；
     · 「空白」的产物与 v2.26.x 一键直建**逐位相同**（主歌 1 块 × 2 遍）——
       它的语义就是"跟以前一样从零开始"，不许顺手改结构；
     · 骨架/完整流行按**当前选中型**预填，遍数 = ceil(目标小节 / 型的实际小节数)（patBars）；
     · 复制 = 深拷贝 + 副本命名（重名自动"副本 / 副本2 …"）；**不复制歌词行**
       （与「导出整包」的合并语义一致：词挂原件，副本从空白词开始）；
     · 段 uid 跨曲式允许重复（唯一性判据是**同曲式内**）——副本带着原 uid 不是错。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });

/* 打开编排面板、点开模板菜单、点第 k 个模板 pill。
   菜单是运行时生成的节点（挂在 #argActions 里），按类名定位——桩没有元素级 querySelector。 */
function pickTemplate(beat, els, k){
  beat.Arrange.open();
  els["argNew"].fire("click");
  const menu = els["argActions"].children.find(c => /(^| )arg-new-menu( |$)/.test(c.className));
  ok(!!menu, "前提：模板菜单已展开");
  eq(menu.children.length, 4, "前提：菜单四项");
  menu.children[k].fire("click");
}
/* v2.30.0（S1）：「复制」从顶栏常驻按钮收进曲式级 ⋯ 菜单——打开菜单、返回「复制当前曲式」按钮。
   每次复制都会触发 arrangeRender（重建列表 + 摘掉两张菜单），所以每次复制都要重新开菜单。 */
function libCopyBtn(beat, els){
  beat.Arrange.open();
  els["argLibMore"].fire("click");
  const menu = els["argActions"].children.find(c => /(^| )arg-lib-menu( |$)/.test(c.className));
  ok(!!menu, "前提：曲式操作菜单已展开");
  return Array.prototype.find.call(menu.children, b => /复制当前曲式为副本/.test(b.getAttribute("aria-label") || ""));
}
const secNames = (beat, id) => beat.Store.findArrange(id).sections.map(s => s.name).join("|");
const rep0 = (beat, id) => beat.Store.findArrange(id).sections[0].blocks[0].repeats;

/* ================= 场景 T105a：四条模板路的预填结构 ================= */
section("T105a 模板 · 空白 = 旧默认 / 骨架与完整流行按当前型折算遍数");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type: "builtin", idx: 1 };      // 四分基础（4 小节）——遍数折算可心算
  eq(beat.patBars(beat.BUILTINS[1]), 4, "前提：BUILTINS[1] 是 4 小节型");
  beat.Arrange.close();

  pickTemplate(beat, els, 0);                          // 空白
  eq(beat.Store.arranges.length, 1, "空白：建了一条");
  const a0 = beat.Store.arranges[0];
  eq(a0.name, "新曲式", "空白：默认名");
  eq(a0.sections[0].blocks[0].repeats, 2, "★ 空白 = 旧一键直建的同款结构（主歌 1 块 × 2 遍，不许变）");
  beat.Arrange.close();

  pickTemplate(beat, els, 1);                          // 主副歌骨架
  const a1 = beat.Store.arranges[1];
  eq(a1.name, "主副歌骨架", "骨架：模板名进库名");
  eq(a1.sections.length, 2, "骨架：两段");
  eq(secNames(beat, a1.id), "主歌|副歌", "骨架：主歌 + 副歌");
  eq(rep0(beat, a1.id), 2, "★ 目标 8 小节 ÷ 型 4 小节 = 2 遍（ceil 折算）");
  eq(JSON.stringify(a1.sections[0].blocks[0].ref), JSON.stringify({ type: "builtin", idx: 1 }),
    "★ 块引用 = 当前选中的型（预填不是写死 BUILTINS[0]）");
  beat.Arrange.close();

  pickTemplate(beat, els, 2);                          // 完整流行曲式
  const a2 = beat.Store.arranges[2];
  eq(a2.sections.length, 6, "完整流行：六段");
  eq(secNames(beat, a2.id), "前奏|主歌|副歌|间奏|主歌二|副歌二", "完整流行：段序固定");
  eq(a2.sections[0].blocks[0].repeats, 1, "前奏 4 小节 ÷ 4 = 1 遍");
  eq(a2.sections[1].blocks[0].repeats, 2, "主歌 8 小节 ÷ 4 = 2 遍");
  beat.Arrange.close();

  /* 1 小节型折算：目标 8 小节 = 8 遍（ceil 方向不能反——少了凑不满目标小节数）。
     用自定义型做，不依赖内置库的挂载序：1 小节 = bars.length === 1 */
  const one = loadApp();
  one.beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "单小节", meter: 4, bars: [[{ t: 192 }]] }] }));
  one.beat.Store.S.sel = { type: "custom", id: one.beat.Store.customs[0].id };
  pickTemplate(one.beat, one.els, 1);
  const c1 = one.beat.Store.arranges[0];
  eq(c1.sections[0].blocks[0].ref.type, "custom", "★ 自定义型同样能当模板的预填源");
  eq(c1.sections[0].blocks[0].repeats, 8, "★ 1 小节型 → 目标 8 小节 = 8 遍（ceil 不会算成 7）");
  one.beat.Arrange.close();
}

/* ================= 场景 T105b：复制当前曲式（深拷贝 / 命名 / 不带词） ================= */
section("T105b 复制曲式 · 副本独立 / 重名递增 / 歌词行不跟着复制");
{
  const seed = { "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "src", name: "原曲", sections: [
      { uid: "u1", name: "主歌", blocks: [BL(1, 1)] },
      { uid: "u2", name: "副歌", blocks: [BL(1, 2)] },
    ] },
  ]}), "beatsight.lyrics": JSON.stringify({ v: 2, lines: [
    { arrangeId: "src", secUid: "u1", chars: [{ t: 0, dur: 24, ch: "春" }] },
  ]}) };
  const { beat, els } = loadApp(seed);
  beat.Store.S.sel = { type: "builtin", idx: 1 };
  beat.Arrange.open();
  const cp = libCopyBtn(beat, els);
  eq(cp.disabled, false, "有当前曲式 → 「复制」可用");
  cp.fire("click");
  eq(beat.Store.arranges.length, 2, "复制出一条");
  const dup = beat.Store.arranges[1];
  eq(dup.name, "原曲 副本", "★ 副本命名 = 原名 + 「副本」");
  eq(dup.id !== "src", true, "副本是新 id");
  eq(dup.sections.length, 2, "段数一致");
  eq(dup.sections[0].blocks[0].repeats, 1, "块内容一致（深拷贝）");
  eq(dup.sections[0].uid, "u1", "段 uid 随段带过来（跨曲式重复是允许的：唯一性判据是同曲式内）");
  eq(beat.Store.lyrics.filter(l => l.arrangeId === dup.id).length, 0,
    "★ 歌词行不跟着复制（词挂原件；副本从空白词开始，与导出整包的合并语义一致）");
  eq(beat.Store.lyrics.filter(l => l.arrangeId === "src").length, 1, "原件的词分毫未动");
  eq(beat.Store.S.arrangeSel.id, dup.id, "复制后选中副本");
  eq(beat.Store.S.arrangeSel.to, beat.songBars(dup) - 1, "范围 = 副本整首");

  /* ★ 深拷贝断言：改副本的块不影响原件（浅拷贝会共享 blocks 数组） */
  const d2 = JSON.parse(JSON.stringify(dup));
  d2.sections[0].blocks[0].repeats = 9;
  beat.Store.upsertArrange(d2);
  eq(beat.Store.findArrange("src").sections[0].blocks[0].repeats, 1, "★ 改副本不动原件（blocks 是拷贝不是引用）");
  beat.Arrange.close();

  /* 重名递增：原件现在叫「原曲」，库里已有「原曲 副本」→ 再复制得「原曲 副本2」 */
  beat.Store.S.arrangeSel.id = "src";
  els["argList"].children[0].fire("click");            // 选中原件
  const cp2 = libCopyBtn(beat, els);
  cp2.fire("click");
  eq(beat.Store.arranges[2].name, "原曲 副本2", "★ 重名自动递增（副本 / 副本2 / 副本3 …）");
  beat.Arrange.close();

  /* 没有当前曲式：曲式级 ⋯ 整体置灰（点了也是空动作，不建出空壳） */
  const solo = loadApp();
  solo.beat.Arrange.open();
  eq(solo.els["argLibMore"].disabled, true, "★ 空库时曲式级「⋯」禁用（没有可复制的对象）");
  solo.beat.Arrange.close();
}

/* ================= 场景 T105c：模板产物一律过 upsertArrange（反向验证锚点） ================= */
section("T105c 模板 · 落库走同一条校验边界 / uid 恒发放");
{
  const { beat, els, storage } = loadApp();
  beat.Store.S.sel = { type: "builtin", idx: 1 };
  pickTemplate(beat, els, 2);                          // 完整流行
  const a = beat.Store.arranges[0];
  /* ★ 守卫：冷键不存在时 storage.get 返回 undefined——直接 JSON.parse 会让本用例
     崩溃（崩溃不是证据）。守卫后，"没落冷键"表现为下面这条**具名断言失败**。 */
  const diskRaw = storage.get("beatsight.arranges");
  const disk = diskRaw ? JSON.parse(diskRaw) : { arranges: [] };
  eq(disk.arranges.length, 1,
    "★ 模板产物已持久化（走的是 upsertArrange 那条冷键，不是只进内存）");
  ok(a.sections.every(s => typeof s.uid === "string" && s.uid),
    "★ 模板建的段与手编的段同权：都带稳定 uid（歌词挂得上）");
  const sameUid = a.sections.some((s, i) => a.sections.findIndex(x => x.uid === s.uid) !== i);
  eq(sameUid, false, "同曲式内 uid 互不相同");
  beat.Arrange.close();
  const again = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: beat.Store.arranges }) });
  eq(again.beat.Store.arranges[0].sections.length, 6, "模板产物读回照常（结构合法，不是靠运气过的校验）");
}
