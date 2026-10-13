/* BeatSight 自动化测试 · 无方向空扫（air）导入白名单与导出往返（v3.52.0）
   T252 系列。
   ---------------------------------------------------------------------------
   air 走 validatePreset（导入唯一入口）时与 dir/zone 同一口径：脏值**静默降级为省略**，
   不牵连整条预设；并且**只在 rest===true 且值为 true 时保留**（air 只在休止格上有意义）。
   老版本应用导入含 air 的导出包时整体丢弃 air（同 str 先例，可接受）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const load = () => loadApp();
/* 一小节里放一个待测 step（其余三格补满时值），避免动手造满 4 小节 */
function oneStep(step){
  return { presets: [{ name: "air白名单", meter: 4,
    bars: [[step, { t:48 }, { t:48 }, { t:48 }]] }] };
}
const lastStep = St => St.customs[St.customs.length - 1].bars[0][0];

section("T252a air 白名单 · 只在 rest===true 且值为 true 时保留");
{
  const { beat } = load();
  const St = beat.Store;
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, air:true }))).ok, "rest+air 导入成功");
  eq(lastStep(St).air, true, "★ rest+air:true → 保留 air");

  ok(St.importPresets(JSON.stringify(oneStep({ t:48, air:true }))).ok, "非休止 + air 导入成功（不失败）");
  eq(lastStep(St).air, undefined, "★ 非休止（rest 缺省）上的 air 被省略（air 只在休止格有意义）");

  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:false, air:true }))).ok, "rest:false + air 导入成功");
  eq(lastStep(St).air, undefined, "★ rest:false 上的 air 被省略");
}

section("T252b air 白名单 · 脏值静默降级（字符串 / 数字 / null）");
{
  const { beat } = load();
  const St = beat.Store;
  for (const bad of ["yes", 1, 0, null]){
    ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, air: bad }))).ok,
       `rest+air=${JSON.stringify(bad)} 不导致导入失败`);
    eq(lastStep(St).air, undefined, `★ 脏值 air=${JSON.stringify(bad)} → 字段省略（不牵连整条预设）`);
  }
}

section("T252c air 导出往返 · 逐字保真，老型不含 air 键");
{
  const { beat } = load();
  const St = beat.Store;
  ok(St.importPresets(JSON.stringify(oneStep({ t:48, rest:true, air:true }))).ok, "air 型导入成功");
  const ex = JSON.parse(St.serializePresets());
  const back = ex.presets[ex.presets.length - 1];
  eq(back.bars[0][0].air, true, "★ 导出 JSON 保留 air（往返不丢）");
  ok(St.importPresets(JSON.stringify({ presets: [back] })).ok, "导出包再导入成功");
  eq(JSON.stringify(St.customs[St.customs.length - 1].bars), JSON.stringify(back.bars),
     "★ import→export→import bars 逐字相等（含 air；id 由落库补，故只比 bars）");

  /* 老数据零迁移：无 air 的型导出不含 air 键 */
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "老型", meter: 4,
    bars: [[{ t:48, rest:true, dir:"D" }, { t:48 }, { t:48 }, { t:48 }]] }] })).ok, "无 air 老型导入成功");
  const oldP = St.customs[St.customs.length - 1];
  ok(oldP.bars.flat().every(s => !("air" in s)), "老数据经校验后不新增 air 键（零迁移）");
  ok(!/"air"/.test(JSON.stringify(JSON.parse(St.serializePresets()).presets.find(x => x.name === "老型"))),
     "★ 老型导出串不含 air（字节不变）");
}
