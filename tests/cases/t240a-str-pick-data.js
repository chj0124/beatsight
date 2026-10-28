/* BeatSight 自动化测试 · 逐弦拨弦（str）数据层
   T240a 系列（v3.47.0，分解和弦伴奏 53231323 家族）。
   ---------------------------------------------------------------------------
   契约（PLAN-v10-str-pick 拍板记录）：
     · step.str = [{s:1–6, f?:0–24, tech?:"H"|"P"|"S"|"O"}]，按 s 升序、去重、非空；
     · 脏值静默降级省略（同 dir/zone 口径）：s 越界/重复/空数组 → 字段消失；
       f 越界/非整数、tech 脏 → 只丢该子字段；rest 格上的 tech 抹除（无声的技巧无从谈起）；
     · validatePreset 收 str 白名单（导入/落库唯一入口）；packPreset 随 bars 透传（t217 口径）；
     · demoPresetEq 规范化带上 str（两侧各过 normStr 收敛）；
     · hasStrum 判据扩展（stepHasStrumLike）：纯 str 型也算扫弦谱——六线层/扫弦声部/
       歌词锚点/补拍四处同享这一份判据；
     · 老数据零迁移：无 str 的步骤经校验/导出后逐位不变。
   本组只测数据层；渲染（t240b）/编辑器（t240c）/发声（t240d）各归各组。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const load = () => loadApp();

/* ================= 场景 T240a-1：normStr 归一化矩阵 ================= */
section("T240a-1 逐弦 · normStr 合法多形态 / 脏值降级 / rest 抹 tech");
{
  const { beat } = load();
  const ns = beat.normStr;
  /* 合法多形态：升序去重、f/tech 可选 */
  eq(JSON.stringify(ns([{ s: 5 }, { s: 1 }]), undefined), JSON.stringify([{ s: 1 }, { s: 5 }]),
     "乱序输入 → 按 s 升序");
  eq(JSON.stringify(ns([{ s: 3 }, { s: 3, f: 2 }]), undefined), JSON.stringify([{ s: 3 }]),
     "重复 s → 保留首个");
  eq(JSON.stringify(ns([{ s: 2, f: 0, tech: "P" }]), undefined), JSON.stringify([{ s: 2, f: 0, tech: "P" }]),
     "f=0（空品记号）与 tech 合法保留");
  eq(JSON.stringify(ns([{ s: 6, f: 24 }]), undefined), JSON.stringify([{ s: 6, f: 24 }]),
     "f=24（上界）合法");
  /* 输入数组不被原地改动（归一化产出新数组） */
  const rawIn = [{ s: 5 }, { s: 1 }];
  ns(rawIn, false);
  eq(rawIn.length, 2, "归一化不改写输入数组");
  /* s 脏：越界 / 非整数 / 非数 → 逐条丢弃 */
  eq(ns([{ s: 0 }, { s: 7 }, { s: 2 }], false).length, 1, "s=0 与 s=7 越界被丢，合法条目保留");
  eq(ns([{ s: 2.5 }, { s: "3" }], false), undefined, "非整数/非数字 s → 全脏 → undefined");
  /* 逐条降级不牵连：脏条目只丢自己 */
  eq(JSON.stringify(ns([{ s: 9 }, { s: 4, f: 3 }], false)), JSON.stringify([{ s: 4, f: 3 }]),
     "脏条目只丢自己（不牵连整型）");
  /* f 脏：只丢 f，条目保留 */
  eq(JSON.stringify(ns([{ s: 4, f: 25 }, { s: 1, f: -1 }, { s: 2, f: 1.5 }, { s: 3, f: "2" }], false)),
     JSON.stringify([{ s: 1 }, { s: 2 }, { s: 3 }, { s: 4 }]), "f 越界/负/非整数/非数字 → 只丢品号");
  /* tech 脏：只丢 tech */
  eq(JSON.stringify(ns([{ s: 3, tech: "X" }, { s: 1, tech: "h" }], false)), JSON.stringify([{ s: 1 }, { s: 3 }]),
     "tech 不在白名单（含小写）→ 丢 tech");
  eq(VALID_TECHLESS_CHECK(beat.VALID_TECH), true, "tech 白名单 = H/P/S/O（拍板定稿）");
  /* 空数组 / 非数组 → undefined（= 没这个字段） */
  eq(ns([], false), undefined, "空数组 → undefined");
  eq(ns(undefined, false), undefined, "undefined → undefined");
  eq(ns("5323", false), undefined, "非数组 → undefined");
  /* rest 格上的 tech 抹除；f 保留（空拨也可以标品——品号是记谱，技巧是无声动作语义） */
  eq(JSON.stringify(ns([{ s: 5, f: 3, tech: "P" }], true)), JSON.stringify([{ s: 5, f: 3 }]),
     "rest 格 tech 被抹除、f 保留");
  eq(JSON.stringify(ns([{ s: 5, tech: "O" }], true)), JSON.stringify([{ s: 5 }]),
     "rest 格只剩 tech → 抹成裸弦点");
  /* 一格多弦（加花 ⑤3+②2+①0） */
  eq(JSON.stringify(ns([{ s: 5, f: 3 }, { s: 2, f: 2 }, { s: 1, f: 0 }], false)),
     JSON.stringify([{ s: 1, f: 0 }, { s: 2, f: 2 }, { s: 5, f: 3 }]), "一格多弦（加花）升序保留各自品数");
}
/* 白名单形状断言的本地小助手（避免上面直接引用未定义标识符） */
function VALID_TECHLESS_CHECK(v){ return Array.isArray(v) && v.join("") === "HPSO"; }

/* ================= 场景 T240a-2：validatePreset 收放 / 导出往返 / 老数据不变 ================= */
section("T240a-2 逐弦 · validatePreset 白名单 / 导出往返 / 老数据逐位不变");
{
  const { beat } = load();
  const St = beat.Store;
  const mkBars = str => [0,1,2,3].map(() => [{ t: 24, ...(str ? { str } : {}) }, { t: 24 }, { t: 48 }, { t: 96 }]);
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "分解", meter: 4,
    bars: mkBars([{ s: 5, f: 3 }, { s: 2, tech: "P" }]) }] })).ok, "含合法 str 的预设导入成功");
  const p = St.customs[St.customs.length - 1];
  eq(JSON.stringify(p.bars[0][0].str), JSON.stringify([{ s: 2, tech: "P" }, { s: 5, f: 3 }]),
     "导入后 str 已归一（升序、白名单内）");
  /* 脏 str 静默降级：整字段消失，导入不失败 */
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "脏str", meter: 4,
    bars: mkBars([{ s: 9 }]) }] })).ok, "全脏 str 不导致导入失败（静默降级）");
  eq(St.customs[St.customs.length - 1].bars[0][0].str, undefined, "全脏 str → 字段省略");
  /* rest + tech：导入时抹除 */
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "空拨", meter: 4,
    bars: [[{ t: 24, rest: true, str: [{ s: 5, tech: "H" }] }, { t: 24 }, { t: 48 }, { t: 96 }],
            [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] })).ok,
     "rest+str 导入成功");
  eq(JSON.stringify(St.customs[St.customs.length - 1].bars[0][0].str), JSON.stringify([{ s: 5 }]),
     "rest 格的 tech 被抹除（静默，不牵连）");
  /* 导出往返（t217 口径：packPreset 的 bars 透传） */
  const ex = JSON.parse(St.serializePresets());
  const back = ex.presets[ex.presets.length - 1];
  eq(JSON.stringify(back.bars[0][0].str), JSON.stringify([{ s: 5 }]), "导出 JSON 保留 str（往返不丢）");
  /* 再导入 = 字节级同一形状 */
  ok(St.importPresets(JSON.stringify({ presets: [back] })).ok, "导出包再导入成功");
  eq(JSON.stringify(St.customs[St.customs.length - 1].bars[0][0].str), JSON.stringify([{ s: 5 }]),
     "往返后再导入 str 逐位一致");
  /* 老数据零迁移：无 str 的型导出不含 str 键 */
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "老型", meter: 4,
    bars: [[{ t: 48, dir: "D" }, { t: 48 }, { t: 96 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
            [{ t: 48 }, { t: 48 }, { t: 96 }], [{ t: 48 }, { t: 48 }, { t: 96 }]] }] })).ok,
     "无 str 老型导入成功");
  const oldP = St.customs[St.customs.length - 1];
  ok(oldP.bars.flat().every(s => !("str" in s)), "老数据经校验后不新增 str 键（零迁移）");
  ok(!/"str"/.test(JSON.stringify(JSON.parse(St.serializePresets())
    .presets.find(x => x.name === "老型"))), "老型导出串不含 str（字节不变）");
}

/* ================= 场景 T240a-3：demoPresetEq 规范化 / hasStrum 扩展 ================= */
section("T240a-3 逐弦 · demoPresetEq 带 str 比对 / hasStrum 与 stepHasStrumLike");
{
  const { beat } = load();
  /* demoPresetEq：str 参与内容比对（两侧各过 normStr 收敛） */
  const spec = { meter: 4, bars: [[{ t: 48, str: [{ s: 5, f: 3 }] }, { t: 48, str: [{ s: 3 }] },
    { t: 48, str: [{ s: 2 }] }, { t: 48, str: [{ s: 1 }] }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] };
  const stored = { meter: 4, bars: [[{ t: 48, str: [{ s: 5, f: 3 }] }, { t: 48, str: [{ s: 3 }] },
    { t: 48, str: [{ s: 2 }] }, { t: 48, str: [{ s: 1 }] }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] };
  eq(beat.demoPresetEq(stored, spec), true, "str 相同 → 内容一致");
  const spec2 = JSON.parse(JSON.stringify(spec));
  spec2.bars[0][1].str = [{ s: 2 }];
  eq(beat.demoPresetEq(stored, spec2), false, "str 不同 → 内容不一致（比对已带上 str）");
  /* hasStrum 扩展：纯 str 型判为扫弦谱（hasStrumLike 的钉子） */
  const pureStr = { bars: [[{ t: 48, str: [{ s: 5 }] }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] };
  eq(beat.hasStrum(pureStr), true, "★ 纯 str 型（无 dir/zone）判为扫弦谱");
  eq(beat.hasStrum({ bars: [[{ t: 48, rest: true, str: [{ s: 5 }] }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }), true, "rest+str（空拨）同样算扫弦记谱");
  eq(beat.hasStrum({ bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }), false, "无记谱仍是纯节拍谱");
  eq(beat.hasStrum({ bars: [[{ t: 48, str: [] }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }], [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }), false, "空数组 str 不算记谱（脏值已降级）");
  /* 单格判据同源 */
  eq(beat.stepHasStrumLike({ str: [{ s: 1 }] }), true, "stepHasStrumLike：str 命中");
  eq(beat.stepHasStrumLike({ dir: "D" }), true, "stepHasStrumLike：dir 命中");
  eq(beat.stepHasStrumLike({ zone: 0 }), true, "stepHasStrumLike：zone 命中");
  eq(beat.stepHasStrumLike({}), false, "stepHasStrumLike：裸时值不命中");
}

/* ================= 场景 T240a-4：parseStrFill 解析器 ================= */
section("T240a-4 逐弦 · parseStrFill 合法混写 / 非法词 / 空输入");
{
  const { beat } = load();
  const pf = beat.parseStrFill;
  const okList = r => JSON.stringify(r.list);
  eq(okList(pf("5:3 3 2 3 1 3 2 3")),
     JSON.stringify([{ s: 5, f: 3 }, { s: 3 }, { s: 2 }, { s: 3 }, { s: 1 }, { s: 3 }, { s: 2 }, { s: 3 }]),
     "53231323 带根音品数 → 逐颗解析");
  eq(okList(pf("2:0H")), JSON.stringify([{ s: 2, f: 0, tech: "H" }]), "带品带技巧 2:0H");
  eq(okList(pf("3P")), JSON.stringify([{ s: 3, tech: "P" }]), "无品带技巧 3P");
  eq(okList(pf("6 1  4:12S")), JSON.stringify([{ s: 6 }, { s: 1 }, { s: 4, f: 12, tech: "S" }]),
     "多空格混写合法（filter 收口）");
  eq(pf("5:25").ok, false, "品数 25 越界 → 失败");
  eq(pf("7").ok, false, "弦号 7 → 失败");
  eq(pf("0").ok, false, "弦号 0 → 失败");
  eq(okList(pf("5:x")), JSON.stringify([{ s: 5, dead: true }]), "5:x → ⑤弦哑音");
  eq(pf("5:xH").ok, false, "哑音不得再叠加连接技巧");
  eq(pf("5x").ok, false, "尾巴带杂字符 → 失败");
  eq(pf("5:3,3").ok, false, "逗号分词 → 失败（只认空格）");
  eq(pf("").ok, false, "空输入 → 失败");
  ok(String(pf("abc").why).length > 0, "失败带可读 why");
}

/* ================= 场景 T240a-5：连接解析 / 哑音与 P.M. 数据契约 ================= */
section("T240a-5 技巧连接 · 同弦前音 / 哑音互斥 / P.M. 区间与导入往返");
{
  const { beat } = load();
  eq(JSON.stringify(beat.normStr([{ s: 2, f: 7, tech: "S", dead: true }], false)),
     JSON.stringify([{ s: 2, dead: true }]), "dead 与 f/tech 互斥，只保留哑音");
  eq(JSON.stringify(beat.normStr([{ s: 2, f: 7, dead: true }], true)),
     JSON.stringify([{ s: 2, f: 7 }]), "rest+dead 按空拨处理，不保留哑音技巧");
  const bar = [
    { t: 24, str: [{ s: 2, f: 3 }] },
    { t: 24, str: [{ s: 1, f: 7 }, { s: 2, f: 5, tech: "S" }] },
    { t: 24, str: [{ s: 2, f: 0, tech: "P" }] },
    { t: 24, str: [{ s: 2, f: 4, tech: "H" }] },
    { t: 24, str: [{ s: 3, f: 2, tech: "O" }] },
    { t: 24, str: [{ s: 4, f: 9, tech: "S", dead: true }] },
    { t: 48 },
  ];
  eq(JSON.stringify(beat.techLinksFor(bar)), JSON.stringify([
    { from: 0, to: 1, s: 2, tech: "S", fromF: 3, toF: 5 },
    { from: 1, to: 2, s: 2, tech: "P", fromF: 5, toF: 0 },
    { from: 2, to: 3, s: 2, tech: "H", fromF: 0, toF: 4 },
  ]), "H/P/S 只连接最近同弦带品音；O 与 dead 不产连接");
  eq(beat.techLinksFor([{ t: 48, str: [{ s: 2, f: 5, tech: "H" }] }]).length, 0,
     "孤立旧技巧不产错误连接也不丢数据");
  const pmBar = [0, 1, 2, 3, 4].map(i => ({ t: 24, str: [{ s: 2 }], ...(i > 0 && i < 4 ? { pm: true } : {}) }));
  pmBar.push({ t: 96 });
  eq(JSON.stringify(beat.pmRunsFor(pmBar)), JSON.stringify([{ from: 1, to: 3 }]), "连续 pm 合并为一个区间");
  const St = beat.Store;
  const bars = [0, 1, 2, 3].map(() => [
    { t: 48, str: [{ s: 2, f: 3 }] },
    { t: 48, str: [{ s: 2, dead: true }], pm: true },
    { t: 48, pm: true },
    { t: 48, rest: true, str: [{ s: 2 }], pm: true },
  ]);
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "技巧迁移", meter: 4, bars }] })).ok,
     "含 dead/pm 的预设导入成功");
  const p = St.customs[St.customs.length - 1];
  eq(JSON.stringify(p.bars[0][1].str), JSON.stringify([{ s: 2, dead: true }]), "dead 经导入白名单保留");
  eq(p.bars[0][1].pm, true, "逐弦发声格的 pm 保留");
  eq("pm" in p.bars[0][2], false, "无 str 的 pm 静默省略");
  eq("pm" in p.bars[0][3], false, "rest 空拨的 pm 静默省略");
  const out = JSON.parse(St.serializePresets()).presets.find(x => x.name === "技巧迁移");
  eq(out.bars[0][1].pm, true, "dead/pm 随导出往返");
}
