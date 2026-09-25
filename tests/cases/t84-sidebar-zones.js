/* BeatSight 自动化测试 · 侧栏预设库三区分类（v2.9.0）
   T84 系列。
   ---------------------------------------------------------------------------
   契约：v2.9.0 整条删掉「当前轨」（普通节拍 / 带扫弦 两态切换条）这个运行期状态，
   侧栏预设库改为「节拍 / 扫弦 / 自定义」三区**常显**堆叠，分类判据是**内容**
   （hasStrum：谱里 dir 或 zone 任一存在）：
     · 节拍区：BUILTINS 与 customs 里不带扫弦记谱的型
     · 扫弦区：带扫弦记谱的型（内置「民谣扫弦」+ 示例曲 5 型 + 扫弦自定义）
     · 自定义区：曲式条目（Store.arranges，含内置示例曲《在他乡》）
   分区只重排**显示**：S.sel.idx 仍指向 BUILTINS 原始下标（不是分区后序位），
   删除自定义型按**对象身份**（customs.indexOf）定位，不按分区序位——
   分区后"显示序位 ≠ customs 下标"这个坑比旧版更深。

   v2.9.0 前的旧 t64（双入口拆分：轨状态 / 过滤 / 回退 / 门控 / 零迁移）整组随轨模型
   一并退役——本组只保留随三区分类存活的契约（判据 / 分区 / 分区下的下标安全）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 一个"纯 direction"谱（只有 dir，无 zone）：验证 hasStrum 只认 dir 也成立 */
const mkDirOnly = () => [0,1,2,3].map(() => [
  { t: 48, dir: "D" }, { t: 48, dir: "U" }, { t: 48 }, { t: 48 },
]);
/* 一个"纯 zone"谱（只有 zone，无 dir）：验证 hasStrum 只认 zone 也成立 */
const mkZoneOnly = () => [0,1,2,3].map(() => [
  { t: 48, zone: 0 }, { t: 48, zone: 2 }, { t: 48 }, { t: 48 },
]);
/* 与 mkZoneOnly 同骨架、但无 zone：作对照 */
const mkPlain = () => [0,1,2,3].map(() => [
  { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 },
]);

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

const isItem = el => /(^| )preset-item( |$)/.test(el.className);
const isSection = el => /(^| )preset-section( |$)/.test(el.className);
/* 条目显示名：presetItemEl 的结构是 item > box > .name（叶子，textContent 直接可读） */
const nameOf = it => it.children[0].children[0].textContent;
/* 三区边界：以三个 .preset-section 为界把列表孩子切成三段的条目 */
const zoneItems = els => {
  const kids = els["presetList"].children;
  const secs = kids.filter(isSection);
  const [a, b, c] = secs.map(s => kids.indexOf(s));
  return {
    secs,
    beat: kids.slice(a + 1, b).filter(isItem),
    strum: kids.slice(b + 1, c).filter(isItem),
    customs: kids.slice(c + 1).filter(isItem),
  };
};

/* ================= 场景 T84a：hasStrum 判据（dir 或 zone 任一） ================= */
section("T84a 三区分类 · hasStrum 判据：dir 或 zone 任一存在即为扫弦型");
{
  const { beat } = loadApp();
  const H = beat.hasStrum;
  ok(H({ bars: mkDirOnly() }) === true, "只有 dir（无 zone）→ 算扫弦");
  ok(H({ bars: mkZoneOnly() }) === true, "★ 只有 zone（无 dir）→ 也算扫弦（听感确实带扫弦）");
  ok(H({ bars: mkPlain() }) === false, "无 dir 无 zone → 普通型");
  /* dir:"" 是**存在**的空串（编辑器"不标注"档写的是 delete，不会留空串；
     但导入的脏数据可能带 dir:""）——按 !== undefined 判据它算"有 dir"。
     这里显式钉住这个边界：改判据时必须是有意识的选择，不能顺手漂移 */
  ok(H({ bars: [0,1,2,3].map(() => [{ t: 48, dir: "" }, { t: 48 }, { t: 48 }, { t: 48 }]) }) === true,
     "dir:\"\" 按「存在」判（判据是 !== undefined，与 VALID_DIR 的降级口径一致）");
  /* 防炸：坏输入不抛（它跑在列表渲染路径上） */
  ok(H(null) === false && H(undefined) === false && H({}) === false
     && H({ bars: null }) === false && H({ bars: [null] }) === false
     && H({ bars: [[null]] }) === false,
     "空/坏结构一律 false（不抛——它跑在列表渲染路径上）");
  /* ★ 分界线（v2.20.0 起 6 处）：内置 17 个型里民谣扫弦 + 示例 5 型带 dir（1+5=6），
     其余 11 个节拍型零 dir——分区判据 hasStrum 的内置域就此锁定 */
  eq(beat.BUILTINS.filter(H).length, 6, "内置型中 6 个带扫弦记谱（民谣扫弦 + 示例 5 型，v2.20.0 内置化）");
}

/* ================= 场景 T84b：三区分类（标题 / 顺序 / 判据 / 原始下标） ================= */
section("T84b 三区分类 · 标题顺序 / 按内容分区 / 分区不改内置下标");
{
  const { beat, els } = loadApp();
  const H = beat.hasStrum;
  /* 分类判据是**内容**（hasStrum），不是任何运行期状态——不再先切轨再断言列表 */
  const beatN = beat.BUILTINS.filter(p => !H(p)).length
    + beat.Store.customs.filter(c => !H(c)).length;
  const strumN = beat.BUILTINS.filter(p => H(p)).length
    + beat.Store.customs.filter(c => H(c)).length;
  const z = zoneItems(els);
  eq(z.secs.length, 3, "恰好三个分区标题（节拍 / 扫弦 / 自定义）");
  eq(JSON.stringify(z.secs.map(s => s.textContent)),
     JSON.stringify([`节拍 · ${beatN} 个`, `扫弦 · ${strumN} 个`, `自定义 · ${beat.Store.arranges.length} 首`]),
     "★ 三区标题按序常显（节拍 / 扫弦 / 自定义），第一区在列表头部");

  /* 内置项按内容落区：唯一带 dir 的「民谣扫弦」进扫弦区，其余 11 个进节拍区 */
  eq(JSON.stringify(z.beat.map(nameOf)),
     JSON.stringify(beat.BUILTINS.filter(p => !H(p)).map(p => p.name)),
     "★ 节拍区 = 全部不带扫弦记谱的内置型（顺序 = BUILTINS 原序）");
  eq(JSON.stringify(z.strum.map(nameOf)),
     JSON.stringify(beat.BUILTINS.filter(p => H(p)).map(p => p.name)),
     "★ 扫弦区 = 带扫弦记谱的内置型（民谣扫弦）");
  const builtinByName = nm => beat.BUILTINS.find(p => p.name === nm);
  ok(z.beat.every(it => { const p = builtinByName(nameOf(it)); return !!p && !H(p); }),
     "节拍区每一项都是 hasStrum=false 的型（分区判据与内容同源）");
  ok(z.strum.every(it => { const p = builtinByName(nameOf(it)); return !!p && H(p); }),
     "扫弦区每一项都是 hasStrum=true 的型");

  /* ★ 下标安全：分区只重排显示，S.sel.idx 仍指回 BUILTINS 原始下标。
     分区后「节拍区第 k 项」在 BUILTINS 里的下标已被跳过项前后错位——
     若拿分区序位当 idx，点任何一项都会选错型 */
  const rendered = () => zoneItems(els).beat.concat(zoneItems(els).strum);
  rendered().forEach((_, k) => {
    const it = rendered()[k];
    const nm = nameOf(it);
    it.fire("click");
    eq(beat.BUILTINS[beat.Store.S.sel.idx].name, nm,
       `★ 第 ${k} 项选中后 S.sel.idx 解析回被点的那一项（分区无整体偏移）`);
  });
}

/* ================= 场景 T84c：分区下删除自定义型按对象身份定位（不按分区序位） ================= */
section("T84c 三区分类 · 分区渲染下删除自定义型按对象身份定位（不按分区序位）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  /* 三个自定义型：第 1 个带 zone（落扫弦区），后两个普通（落节拍区）。
     于是"显示序位"与"customs 下标"必然错位：扫弦区的「甲-扫弦」是 customs[0]，
     节拍区的「乙」是 customs[1]、「丙」是 customs[2] */
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "甲-扫弦", meter: 4, bars: mkZoneOnly() },
    { name: "乙", meter: 4, bars: mkPlain() },
    { name: "丙", meter: 4, bars: mkPlain() },
  ] }));
  eq(beat.Store.customs.length, 3, "三个自定义型就位");
  /* 导入只落数据（Store 不该知道列表怎么画），要看到分区后的列表必须走一次刷新——
     与"列表渲染只有一个触发点"的分工一致：导入/删除/换型都经 refreshAfterPatternChange */
  beat.Presets.refreshAfterPatternChange();
  const z = zoneItems(els);
  /* ★ 分区里**同时**有内置型与自定义型（这是分区判据=内容的必然结果）：
     扫弦区 = 内置「民谣扫弦」+ 自定义「甲-扫弦」；节拍区 = 11 个内置型 + 自定义「乙」「丙」。
     故只筛出自定义名来断言它们的落区，不能拿整区与自定义集比 */
  const customNames = ["甲-扫弦", "乙", "丙"];
  eq(JSON.stringify(z.strum.map(nameOf).filter(n => customNames.includes(n))),
     JSON.stringify(["甲-扫弦"]),
     "带 zone 的自定义型落扫弦区（与内置「民谣扫弦」同区）");
  eq(JSON.stringify(z.beat.map(nameOf).filter(n => customNames.includes(n))),
     JSON.stringify(["乙", "丙"]),
     "无记谱的自定义型落节拍区（混在 11 个内置型之后）");

  /* 删「乙」：它在列表里是节拍区第 1 项，但在 customs 里下标是 1。
     若按分区序位删，会删掉 customs[0]（甲-扫弦）——这条断言就是防线。
     删除走 Modal.uiConfirm，需先确认弹窗再执行回调 */
  const target = els["presetList"].children.filter(isItem).find(it => nameOf(it) === "乙");
  const delBtn = target.children.find(c => /(^| )del( |$)/.test(c.className));
  ok(!!delBtn, "「乙」项有删除按钮");
  delBtn.fire("click", { stopPropagation(){} });
  /* 确认弹窗：modalOk 触发回调（Modal.uiConfirm 的确定按钮 id 是 modalOk） */
  els["modalOk"].fire("click");
  const left = beat.Store.customs.map(c => c.name);
  ok(left.indexOf("甲-扫弦") >= 0, "★ 「甲-扫弦」仍在（没有被错删——按对象身份定位）");
  ok(left.indexOf("乙") < 0, "「乙」已被删除（删的确实是点的那一项）");
  eq(left.length, 2, "恰好删掉一个");
  ok(left.indexOf("丙") >= 0, "「丙」未受影响");
}
