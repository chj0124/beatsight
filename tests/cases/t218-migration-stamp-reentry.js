/* BeatSight 自动化测试 · 一次性迁移的幂等戳（v3.36.6，本轮审计 A2 / A3）
   T218
   ──────────────────────────────────────────────────────────────────────────────────────
   由来（2026-10-07 第二轮取证）：4 个一次性迁移块（bnmig35 / chdsp36 / arrmig73 / chdmig）
     此前都是「写数据」与「写戳」两个**独立 try/catch** + **空 catch** ——
     「数据写成功、戳没写进去」（配额恰在两次 setItem 之间耗尽 / 隐私模式）会让下次启动
     **重放**整条迁移。桩实测代价：arrmig73 的块 repeats 4→16（段长翻两番）、
     bnmig35 的内置下标 4→3（型指错）；且 4 处读戳都是空 catch ⇒ 全程静默。

   ★★ 既有 t51 / t91 的「幂等」断言是**橡皮图章**：它们手工喂了戳（注释自己写着
     「带戳：跳过迁移」），测的是「戳在」那半边**安全的**分支；真正会出错的
     「戳进行中 / 戳读不到」那半边没人测 —— T218 补的正是那一半。

   反向验证（改坏后必须变红，已实测）：
     · 把 migState 里非「1」戳的跳过分支去掉（退回重放）→ T218b 红；
     · 把 persistCold 的 diagColdWrite 挪回存储写入的 try 内 → T218e 红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const ARR = "beatsight.arranges";
const MIG = id => "beatsight.mig." + id;
const snap = storage => { const o = {}; storage.forEach((v, k) => { o[k] = v; }); return o; };
/* 老存档：builtin 块 idx=5 / repeats=1（迁移后应为 idx=4 / repeats=4） */
const seedX = () => ({ [ARR]: JSON.stringify({ arranges: [{ id: "user-x", name: "我的曲式", sections: [
  { name: "A", blocks: [{ ref: { type: "builtin", idx: 5 }, repeats: 1 }] }] }] }) });
const xOf = storage => {
  const d = JSON.parse(storage.get(ARR) || "null");
  const r = (d.arranges || []).find(x => x.id === "user-x");
  return r ? { idx: r.sections[0].blocks[0].ref.idx, repeats: r.sections[0].blocks[0].repeats } : null;
};

/* ================= T218a：首次迁移正常完成 ================= */
section("T218a 首次迁移：数据迁一次 + 新老戳都落上");
{
  const { beat, storage } = loadApp(seedX(), { seedDemo: false });
  eq(JSON.stringify(xOf(storage)), JSON.stringify({ idx: 4, repeats: 4 }),
    "前提：内置下标 −1（5→4）、repeats ×4（1→4）各发生一次");
  eq(storage.get(MIG("arrmig73")), "1", "★ 新戳置为「完成」");
  eq(storage.get("beatsight.arrmig73"), "1", "★ 老戳一并落上（降级回 v3.36.5 不会被重放）");
  eq(beat.Store.migAttention(), 0, "正常路径没有需要关注的迁移");
}

/* ================= T218b：数据已写、完成戳没落上 ⇒ 不得重放 ================= */
section("T218b ★★★ 戳停在「进行中」⇒ 二次启动不得重放（修前实测损坏的路径）");
{
  const first = loadApp(seedX(), { seedDemo: false });
  const s = snap(first.storage);
  s[MIG("arrmig73")] = "p";        // 进行中：数据已写、完成戳没落上（配额恰卡在两次写之间）
  const again = loadApp(s, { seedDemo: false });
  eq(JSON.stringify(xOf(again.storage)), JSON.stringify({ idx: 4, repeats: 4 }),
    "★★★ repeats 仍是 4（修前会变 16 —— 段长翻两番）、下标仍是 4（修前会再减一次）");
  ok(again.beat.Store.migAttention() > 0,
    "★ 且这一次被**上报**（migAttention>0），不再静默");
}

/* ================= T218c：老戳兼容（存量用户不被重放） ================= */
section("T218c ★★ 只认老戳的存量用户：跳过、且不计入异常");
{
  const first = loadApp(seedX(), { seedDemo: false });
  const s = snap(first.storage);
  delete s[MIG("arrmig73")];        // 只剩老戳（v3.36.5 及以前落的形态）
  s["beatsight.arrmig73"] = "1";
  const again = loadApp(s, { seedDemo: false });
  eq(JSON.stringify(xOf(again.storage)), JSON.stringify({ idx: 4, repeats: 4 }),
    "★ 老戳被认作「已完成」，不重放");
  eq(again.beat.Store.migAttention(), 0, "老戳是正常状态，不计入需关注");
}

/* ================= T218d：一个字都没写进去 ⇒ 清戳、下次干净重试 ================= */
section("T218d 存储写不进去 ⇒ 不残留「进行中」戳（否则数据永远迁不了）");
{
  const { beat, storage } = loadApp(seedX(), { seedDemo: false, throwOnWrite: true });
  ok(!storage.has(MIG("arrmig73")),
    "★ 没留下「进行中」戳（留了会让下次启动跳过 ⇒ 迁移被永久卡住）；实际="
    + JSON.stringify(storage.get(MIG("arrmig73"))));
  ok(beat.Store.migAttention() > 0, "写不进去会被上报（不再空 catch 静默）");
}

/* ================= T218f：「进行中」写上、数据写失败 ⇒ 清戳、下次干净重试 ================= */
section("T218f ★★ 部分失败的可恢复侧：数据一个字都没写进去 ⇒ 清掉「进行中」戳");
{
  /* 只让 beatsight.arranges 这一个键写失败（v3.36.6 给桩加的按键注入）：
     "进行中"戳写成功、数据写失败 ⇒ 必须**清戳**，否则下次启动会因"戳在"而永久跳过该迁移。 */
  const { beat, storage } = loadApp(seedX(), { seedDemo: false, throwOnWriteFor: "beatsight.arranges" });
  ok(!storage.has(MIG("arrmig73")), "★ 数据没写进去时清掉了戳（留下的后果是迁移被永久卡住）");
  ok(!storage.has("beatsight.arrmig73"), "老戳也没落（迁移没有完成）");
  /* ★ 与 T218d 的语义差别是**刻意的**：清戳这条路下次启动会自动重试（盘上没动过），
     属"可恢复"，不报警；migAttention 只计"永久卡住"（戳进行中/读不到/记不了戳）。
     真正的存储故障会由常规写路径的「保存失败」chip 照出来，不靠这里重复报。 */
  eq(beat.Store.migAttention(), 0, "★ 可恢复路径不占报警（下次启动会干净重试）");
}

/* ================= T218e：加载期迁移路径不得产生假「保存失败」 ================= */
section("T218e ★★ 加载期迁移的冷键写入不报假失败（Diagnostics 的 TDZ，v3.36.6 修）");
{
  /* 造 v2.19.x 形状：customs 里还有示例型 ⇒ 下次启动触发内置化迁移，
     而那条路径会在 Store IIFE 求值期调 persistCold()（此时 Diagnostics 仍在其后的 TDZ）。 */
  const first = loadApp(undefined, { seedDemo: false });
  first.beat.Store.importPresets(JSON.stringify(first.beat.demoBuildSpec().presets));
  const ids = first.beat.Store.customs.slice(-5).map(c => c.id);
  first.beat.Store.findArrange(first.beat.DEMO_ID).sections.forEach(sec => sec.blocks.forEach(bl => {
    if (bl.ref.type === "builtin") bl.ref = { type: "custom", id: ids[bl.ref.idx - 11] };
  }));
  first.beat.Store.persistCold();
  first.beat.Store.persistArranges();

  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => { warns.push(a.map(String).join(" ")); };
  let second = null;
  try { second = loadApp(snap(first.storage)); } finally { console.warn = orig; }

  eq(second.beat.Store.customs.length, 0, "前提：内置化迁移确实发生了（示例型被收走）");
  ok(!warns.some(w => /本地保存失败/.test(w)),
    "★★ 加载期迁移不产生假「保存失败」告警（修前实测打印 Cannot access Diagnostics before initialization，"
    + "写其实成功了）；本次告警=" + JSON.stringify(warns));
}
