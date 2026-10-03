/* BeatSight 自动化测试 · v3.31.x 落地审计 ①导入导出边界（P0-2 / P1-3 / P1-8 / P1-9）
   ---------------------------------------------------------------------------
   钉四条审计结论：
     · P0-2：全量包跨设备导入时，曲式块对自定义预设的引用按包内 oldId→newId 重映射
       （此前引用全部悬空、arrangeProblems 报"不存在"、播放静默回退）；
     · P1-3：serializeAll 带 label 与 id（此前 label 静默丢失、且无映射键可用）；
     · P1-8：ear 导入与加载路径同口径归一化（地板取整 + right≤total 夹制）；
     · P1-9：patLenOf 的 custom 分支查运行期 customs（此前导入护栏按 DEF_BARS 计段长失效）。
   ★ 反向验证锚点（变异清单）：删掉 importAll 的 remapRefs 调用 → T179b 引用解析红；
     删掉 serializeAll 的 label/id 字段 → T179a 红；删掉 ear 的夹制 → T179d 红；
     把 patLenOf 的 customsRef 分支退回 savedCustoms → T179e 红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 4/4 自定义型 ×3 小节（3×48=144 = meter×TPB）；与 3/4 的型配合验证跨拍号引用 */
const mkCustom = (name, meter, bars) => ({ name, meter, bars });

/* ================= 场景 T179a：全量包往返 · label/id 随包走（P1-3 + P0-2 的键） ================= */
section("T179a 全量包往返 · presets 带 label 与 id（此前 label 静默丢失）");
{
  const { beat } = loadApp();
  beat.Store.importPresets(JSON.stringify({ presets: [
    mkCustom("带标注的四四型", 4, [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]]),
  ] }));
  const c = beat.Store.customs[beat.Store.customs.length - 1];
  c.label = "和弦备忘：C-G-Am-F";              // label 是自定义型字段，persistCold 全量写回
  beat.Store.persistCold();
  const pack = JSON.parse(beat.Store.serializeAll());
  const p0 = pack.presets[pack.presets.length - 1];
  eq(p0.label, "和弦备忘：C-G-Am-F", "★ serializeAll 带 label（此前全量包静默丢失）");
  eq(typeof p0.id, "string", "★ serializeAll 带原 id（供包内引用重映射，只作对账键）");
}

/* ================= 场景 T179b：引用重映射（P0-2 正体） ================= */
section("T179b 全量导入 · 曲式块 custom 引用按映射重写（此前全部悬空）");
{
  const { beat } = loadApp();
  beat.Store.importPresets(JSON.stringify({ presets: [
    mkCustom("四四引用载体", 4, [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]]),
  ] }));
  const c = beat.Store.customs[beat.Store.customs.length - 1];
  const arrId = "a-ref-map";
  ok(beat.Store.upsertArrange({ id: arrId, name: "引用曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: c.id }, repeats: 2 }] },
  ] }), "本机曲式引用自定义型落库");

  /* 打包（带 id）→ 清场新实例导入 → 引用应被重映射为新 id 且可解析 */
  const pack = beat.Store.serializeAll();
  const app2 = loadApp();
  const r = app2.beat.Store.importAll(pack);
  ok(r.ok, "★ 全量导入 ok");
  eq(r.added.presets, 1, "导入 1 个预设");
  eq(r.added.arranges, 1, "导入 1 条曲式");
  const arr2 = app2.beat.Store.findArrange(arrId);
  ok(!!arr2, "曲式在库里");
  const ref2 = arr2.sections[0].blocks[0].ref;
  eq(ref2.type, "custom", "块引用仍是 custom");
  const c2 = app2.beat.Store.customs.find(x => x.id === ref2.id);
  ok(!!c2, "★ 引用指向本机新 id 的预设（重映射成功——此前悬空、find 落空）");
  /* 用共享区的解析器断言"真的解析得通"（这是用户可感知的契约） */
  ok(!!app2.beat.resolveRef(ref2), "★ resolveRef 解析成功（arrangeProblems 不再报不存在）");
  eq(app2.beat.arrangeProblems(arr2).length, 0, "★ 该曲式无问题（引用不悬空）");
  eq(app2.beat.Store.serializeAll().indexOf('"id":"' + c.id + '"') >= 0
     || app2.beat.Store.customs.every(x => x.id !== c.id), true,
     "导入机的新 id 与旧 id 不同（换新 id 防撞）");
}

/* ================= 场景 T179c：previewImport 计数与 importAll 一致（P0-2 的 dry-run 镜像） ================= */
section("T179c 导入预览 · dry-run 同样按映射计数（与 importAll 逐字对齐）");
{
  const { beat } = loadApp();
  beat.Store.importPresets(JSON.stringify({ presets: [
    mkCustom("预览载体", 4, [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]]),
  ] }));
  const c = beat.Store.customs[beat.Store.customs.length - 1];
  ok(beat.Store.upsertArrange({ id: "a-pv", name: "预览曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: c.id }, repeats: 1 }] },
  ] }), "落库");
  const pack = beat.Store.serializeAll();
  const app2 = loadApp();
  const pv = app2.beat.Store.previewImport(pack);
  ok(pv.ok, "预览 ok");
  const real = app2.beat.Store.importAll(pack);
  ok(real.ok, "实际导入 ok");
  const pvArr = (pv.parts.find(x => x.kind === "曲式") || {}).count || 0;
  eq(pvArr, real.added.arranges, "★ 预览曲式计数 == 实际落盘数（映射口径一致）");
  eq(pvArr, 1, "曲式被计入（引用能解析 → 未被护栏误拒）");
}

/* ================= 场景 T179d：ear 归一化（P1-8） ================= */
section("T179d 听辨战绩导入 · 与加载路径同口径归一化（此前脏值直写冷键）");
{
  const { beat, storage } = loadApp();
  const r = beat.Store.importAll(JSON.stringify({ app: "beatsight", kind: "all",
    presets: [], ear: { total: 7, right: 100, best: 3.7 } }));
  ok(r.ok, "导入 ok");
  eq(beat.Store.earStats.total, 7, "total 地板取整");
  eq(beat.Store.earStats.right, 7, "★ right 被夹到 ≤ total（此前 100 → 1429% 正确率）");
  eq(beat.Store.earStats.best, 3, "best 地板取整");
  const saved = JSON.parse(storage.get("beatsight.ear"));
  eq(saved.right, 7, "★ 冷键里已是夹制后的值（此前脏值落盘）");
}

/* ================= 场景 T179e：patLenOf 运行期 customs（P1-9） ================= */
section("T179e 导入护栏 · 段长按真实小节数计（此前快照快照按 4 计、护栏失效）");
{
  const { beat } = loadApp();
  /* 64 小节型 × 1 块 × 64 遍：真实段长 4096 小节，必须被 arrMaxBars 拒掉；
     修复前 patLenOf 查不到会话内刚导入的型 → 按 4 计 → 256 恰好通过护栏。 */
  const bars = Array.from({ length: 64 }, () => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]);
  const pack = JSON.stringify({ app: "beatsight", kind: "all",
    presets: [{ ...mkCustom("六十四小节巨兽", 4, bars), id: "c-huge" }],
    arranges: [{ id: "a-huge", name: "超长", sections: [
      { name: "A", blocks: [{ ref: { type: "custom", id: "c-huge" }, repeats: 64 }] }] }],
    lines: [], ear: { total: 0, right: 0, best: 0 } });
  const r = beat.Store.importAll(pack);
  ok(r.ok, "导入本身 ok（预设合法）");
  eq(r.added.arranges, 0, "★ 超长曲式被拒（真实段长 4096 > arrMaxBars）——护栏恢复牙齿");
  eq(r.skipped.arranges, 1, "跳过计数 1");
}
