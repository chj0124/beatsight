/* BeatSight 自动化测试 · 节奏型导出字段清单的唯一真相源（v3.36.6，本轮审计 A1）
   T217
   ──────────────────────────────────────────────────────────────────────────────────────
   由来（2026-10-07 第二轮取证）：`customs[].song`（v3.35.7「节奏型绑定归属」）当初加进了
     `validatePreset` 白名单与 `serializePresets` 的手写清单，**唯独漏了 `serializeAll`
     的第二份手写清单** —— 走「导出全部数据」换设备的用户，归属**静默丢失**、全落进
     「未归属」。而 v3.35.7 起「每个型都归属于一个名字」正是这一版的组织方式。

   ★ 实测形状（修前）：3 个带 song 的型 → serializeAll **0/3** 带 song、serializePresets 3/3；
     换机往返后 customs[].song = [undefined×3]，三个型全部落进「未归属」行。
   ★ 导入侧**无辜**：validatePreset 一直收 song；把同一包的 presets 补回 song 即 3/3 恢复。
   ★ t212 只钉 serializePresets 那一侧（它的反向验证变异也只打在那份清单上）——这正是
     本缺陷能穿过当时 7000+ 条断言的原因。

   ★★ 防复发的关键是 T217c：**两个序列化器的字段集必须一致（id 除外）**。
     只钉「serializeAll 带 song」是不够的 —— 下一个新字段会再漏一次；字段集一致性让
     「两份手写清单」这件事本身不可能再漂移。

   反向验证（改坏后必须变红，已实测）：
     · 把 packPreset 里的 `song` 一项删掉 → T217a / T217b / T217c 红；
     · 让 serializeAll 退回自己的手写清单（不调 packPreset）→ T217c 红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const mkSong = (name, song) => ({ name, meter: 4, song, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] });
/* 字段集比较：id 是两条路径**刻意**的唯一差异（全量包带原 id 供包内引用重映射），排除掉 */
const keySet = o => Object.keys(o).filter(k => k !== "id").sort().join(",");

/* ================= T217a：全量包必须带 song（本缺陷的正体） ================= */
section("T217a ★★★ 全量包 presets 带 song（修前 0/3 —— 换机归属全丢）");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  beat.Store.customs.push(mkSong("型A", "歌一"), mkSong("型B", "歌二"), mkSong("型C", "歌三"));
  const pack = JSON.parse(beat.Store.serializeAll());
  eq(pack.presets.length, 3, "前提：全量包里 3 条预设");
  eq(pack.presets.filter(p => "song" in p).length, 3,
    "★★★ 三条都带 song（修前恒为 0 ——「导出全部数据」会把归属整个丢掉）");
  eq(pack.presets[0].song, "歌一", "归属值逐条对上");
}

/* ================= T217b：换机往返（导出全部 → 新设备导入全部） ================= */
section("T217b ★★★ 换机往返：归属原样保留（此前全落「未归属」）");
{
  const a = loadApp(undefined, { seedDemo: false });
  a.beat.Store.customs.push(mkSong("型A", "歌一"), mkSong("型B", "歌二"), mkSong("型C", "歌三"));
  const pack = a.beat.Store.serializeAll();

  const b = loadApp(undefined, { seedDemo: false });
  const r = b.beat.Store.importAll(pack);
  eq(r && r.ok, true, "前提：全量包导入成功");
  eq(b.beat.Store.customs.map(c => c.song).join(","), "歌一,歌二,歌三",
    "★★★ 三个型的归属逐条保留（修前是 undefined,undefined,undefined）");
}

/* ================= T217c：两个序列化器的字段集一致（防复发的关键） ================= */
section("T217c ★★★ 导出字段集一致：serializeAll ⊇ serializePresets（id 除外）");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  /* 全字段样本（accents + song + label）+ 只有归属的样本 + 什么都没有的老型 */
  beat.Store.customs.push(
    { id: "c-t217-1", name: "全字段", meter: 4, accents: [0, 2], song: "歌", label: "备忘",
      bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] },
    Object.assign(mkSong("只有归属", "歌二"), { id: "c-t217-2" }),
    { id: "c-t217-3", name: "无归属老型", meter: 4,
      bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] },
  );
  const pres = JSON.parse(beat.Store.serializePresets()).presets;
  const all = JSON.parse(beat.Store.serializeAll()).presets;
  eq(all.length, pres.length, "前提：两条路径导出同样条数");
  ok(all.every((p, i) => keySet(p) === keySet(pres[i])),
    "★★★ 逐条字段集一致（id 除外）—— 这是「下一个新字段不会再漏」的机器保证；实际 all="
    + JSON.stringify(all.map(keySet)) + " / pres=" + JSON.stringify(pres.map(keySet)));
  ok(all.every(p => "id" in p) && pres.every(p => !("id" in p)),
    "两条路径的唯一刻意差异是 id（全量包带原 id 供包内引用重映射）");
}

/* ================= T217d：留空不写字段（与 validatePreset 同口径） ================= */
section("T217d ★ 没归属的型不凭空多出 song 键（留空不写字段）");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  beat.Store.customs.push({ name: "无归属老型", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] });
  const all = JSON.parse(beat.Store.serializeAll()).presets[0];
  const pres = JSON.parse(beat.Store.serializePresets()).presets[0];
  ok(!("song" in all) && !("song" in pres),
    "两条路径都不写 song 键（脏值/留空静默降级为省略，同 label / dir / zone 口径）");
}

/* ================= T217e：选择性导出（同一函数的另一入口） ================= */
section("T217e ★★ exportAllSel 的 presets 部件同样带 song（同因中招）");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  beat.Store.customs.push(mkSong("型A", "歌一"));
  const sel = JSON.parse(beat.Store.serializeAll({ parts: ["presets"] }));
  eq(sel.presets[0].song, "歌一",
    "★★ 选择性导出勾「预设」时归属也在（它与「导出全部数据」共用 serializeAll）");
}
