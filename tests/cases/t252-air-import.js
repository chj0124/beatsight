/* BeatSight 自动化测试 · 空扫（air）导入白名单 / 老数据推断 / 导出往返（v3.52.0，两轴独立）
   T252 系列。
   ---------------------------------------------------------------------------
   `air` 与 `rest` 独立。validatePreset（导入唯一入口）：
     · `air` 是显式布尔 → 以它为准（真/假都保留：false = 实扫，供「实扫 + 休止」往返保真）；
     · `air` 缺省（或非布尔脏值）→ 老数据推断：`rest && dir` 读作空扫（补 air=true）；其余缺省。
   老版本应用导入含 air 的导出包时整体丢弃 air（同 str 先例）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const load = () => loadApp();
function oneStep(step){
  return { presets: [{ name: "air白名单", meter: 4, bars: [[step, { t:48 }, { t:48 }, { t:48 }]] }] };
}
const lastStep = St => St.customs[St.customs.length - 1].bars[0][0];

section("T252a air 白名单 · 显式布尔为准（true/false 都保留）");
{
  const { beat } = load();
  const St = beat.Store;
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, air:true }))).ok, "rest+air:true 导入成功");
  eq(lastStep(St).air, true, "air:true → 保留 true（空扫+休止）");
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, dir:"D", air:false }))).ok, "rest+dir+air:false 导入成功");
  eq(lastStep(St).air, false, "★ air:false → 保留 false（实扫+休止，不再被误读为空扫）");
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, air:true }))).ok, "非休止 + air:true 导入成功");
  eq(lastStep(St).air, true, "★ air 与 rest 独立：非休止上的 air:true 也保留（空扫+发声）");
}

section("T252b 老数据推断 · 缺省 air 时「休止 + 方向」读作空扫");
{
  const { beat } = load();
  const St = beat.Store;
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, dir:"D" }))).ok, "老数据 rest+dir 导入成功");
  eq(lastStep(St).air, true, "★ 缺省 air + rest&dir → 推断 air=true（老空扫）");
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true }))).ok, "老数据纯休止导入成功");
  eq(lastStep(St).air, undefined, "缺省 air + 纯休止 → 无 air（不是空扫）");
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, dir:"D" }))).ok, "老数据实扫导入成功");
  eq(lastStep(St).air, undefined, "缺省 air + 非休止 → 无 air（实扫）");
}

section("T252c air 脏值 · 非布尔按缺省处理（不牵连整条预设）");
{
  const { beat } = load();
  const St = beat.Store;
  for (const bad of ["yes", 1, 0, null]){
    ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, air: bad }))).ok,
       `rest+air=${JSON.stringify(bad)} 不导致导入失败`);
    eq(lastStep(St).air, undefined, `脏值 air=${JSON.stringify(bad)}（纯休止）→ 无 air`);
  }
  /* 脏值 + rest&dir → 退回老数据推断（读作空扫） */
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, dir:"D", air: "yes" }))).ok, "rest+dir+脏air 导入成功");
  eq(lastStep(St).air, true, "脏值不改变「rest&dir ⇒ 空扫」的老数据推断");
}

section("T252d air 导出往返 · 逐字保真，老型不含 air 键");
{
  const { beat } = load();
  const St = beat.Store;
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, dir:"D", air:false }))).ok, "实扫+休止导入成功");
  const ex = JSON.parse(St.serializePresets());
  const back = ex.presets[ex.presets.length - 1];
  eq(back.bars[0][0].air, false, "★ 导出保留 air:false（实扫+休止往返不丢）");
  ok(St.importPresets(JSON.stringify({ presets: [back] })).ok, "导出包再导入成功");
  eq(JSON.stringify(St.customs[St.customs.length - 1].bars), JSON.stringify(back.bars),
     "★ import→export→import bars 逐字相等（air:false 未被误读为空扫）");

  /* 老数据零迁移：无 air 的纯休止型导出不含 air 键 */
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "老型", meter: 4,
    bars: [[{ t:48, rest:true }, { t:48 }, { t:48 }, { t:48 }]] }] })).ok, "无 air 老型导入成功");
  const oldP = St.customs[St.customs.length - 1];
  ok(oldP.bars.flat().every(s => !("air" in s)), "老数据（纯休止）经校验后不新增 air 键");
  ok(!/"air"/.test(JSON.stringify(JSON.parse(St.serializePresets()).presets.find(x => x.name === "老型"))),
     "★ 老型导出串不含 air（字节不变）");
}
