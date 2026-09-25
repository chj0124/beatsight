/* BeatSight 自动化测试 · 全量数据包导出导入（v2.8.8，本轮审计「业务短板」项）
   T82 系列。
   ---------------------------------------------------------------------------
   要钉住的是**跨设备迁移这条路的完整性**，不是 JSON 长什么样：
     · 曲式 / 歌词 / 练习记录 / 听辨战绩此前只能存本机，而 `file://` 与 `https://`
       是两个 origin、localStorage 不共享 —— 换设备或换通道，这几类数据整份消失；
     · 它们恰好是**重做代价最高**的一类（曲式逐段编、歌词逐字对到十六分格、记录攒几个月），
       比预设更值得有备份通道。

   三条语义必须各自钉死，不能只测"导入成功"：
     ① 预设走**严格**校验（任一坏条目 → 整批拒绝，与 importPresets 同口径）；
     ② 曲式 / 歌词走**逐条归一**（坏条目丢弃并计数，与它们落盘时同口径）——
        为一条坏数据废掉整包，代价与收益不成比例；
     ③ 导入是**合并**而非替换（撞 id / 撞 (曲式,段) 时以本机已有为准），
        否则"导入"会静默抹掉用户正在用的那一份，而这没法撤销。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 一份最小可用的全量包：内置型引用（idx 0 = 民谣扫弦，4 小节）作块，2 遍 = 8 小节 */
const PACK = () => ({
  app: "beatsight", kind: "all", v: 1, version: "test",
  presets: [{ name: "导入型 A", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }],
  arranges: [{ id: "a-import-1", name: "导入曲式",
    sections: [{ name: "主歌", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 2 }] }] }],
  lines: [{ arrangeId: "a-import-1", sec: 0, chars: [{ t: 0, dur: 24, ch: "回" }] }],
  /* ★ v2.10.12：原 `log` 段（练习记录）随练习统计删除 —— 数据包不再含/不再读这一类 */
  ear: { total: 7, right: 5, best: 4 },
});

/* ================= 场景 T82：导出包含全部四类冷数据 ================= */
section("T82 全量数据包 · 导出把四类冷数据都带走（此前只有预设能带走）");
{
  const { beat } = loadApp();
  const pack = JSON.parse(beat.Store.serializeAll());
  eq(pack.kind, "all", "kind=all（与预设包 kind=presets 可区分）");
  eq(pack.v, 1, "带 schema 版本字段（日后改形状时导入侧能分派，见审计 §4.5）");
  ["presets", "arranges", "lines", "ear"].forEach(k => {
    ok(Array.isArray(pack[k]) || (k === "ear" && pack[k] && typeof pack[k] === "object"),
      "包含 " + k + " 段");
  });
}

/* ================= 场景 T82b：导入是合并，四类都进得来 ================= */
section("T82b 全量数据包 · 导入四类数据（合并语义）");
{
  const { beat } = loadApp();
  const before = beat.Store.customs.length;
  const res = beat.Store.importAll(JSON.stringify(PACK()));
  ok(res.ok, "导入成功（" + JSON.stringify(res) + "）");
  eq(res.added.presets, 1, "预设 +1");
  eq(res.added.arranges, 1, "曲式 +1");
  eq(res.added.lyrics, 1, "歌词 +1");
  /* ★ v2.10.12：原「练习记录」的导入断言（按 t 找得到 / sec 原样 / bpm 与 name 缺省归一化）、
     以及「只带 start 键的旧形状被丢弃」的口径断言，随练习记录一起删除 ——
     数据包里的 `log` 字段现在被**静默忽略**，不再进内存 */
  eq(beat.Store.customs.length, before + 1, "预设真的进了库（不是只报了个数）");
  eq(beat.Store.arranges.some(a => a.id === "a-import-1"), true, "曲式按 id 进库");
  /* v2.26.0：寻址键是段 uid。包里给的是**旧格式**（sec 下标），导入路径同样过一遍迁移，
     故这一行会被绑到曲式第 1 段的 uid 上（而不是原样留着下标） */
  const impUid = beat.Store.findArrange("a-import-1").sections[0].uid;
  eq(beat.Store.lyrics.some(l => l.arrangeId === "a-import-1" && l.secUid === impUid), true, "歌词行进库");
  ok(beat.Store.lyrics.every(l => !("sec" in l)), "★ 迁移后的行里不再有旧字段 sec（落盘只写 secUid）");
  /* 听辨战绩是**累计量**：逐字段取较大值，而不是覆盖（覆盖会把本机更高的纪录抹低） */
  ok(beat.Store.earStats.best >= 4, "听辨战绩取较大值（best ≥ 4，实际 " + beat.Store.earStats.best + "）");
}

/* ================= 场景 T82c：重复导入不重复累加（合并而非追加） ================= */
section("T82c 全量数据包 · 同一份再导一次：曲式/歌词不重复，预设照常追加");
{
  const { beat } = loadApp();
  beat.Store.importAll(JSON.stringify(PACK()));
  const arr0 = beat.Store.arranges.length, lyr0 = beat.Store.lyrics.length;
  const res = beat.Store.importAll(JSON.stringify(PACK()));
  ok(res.ok, "第二次导入同样成功（导入不该是一次性操作）");
  eq(res.added.arranges, 0, "同 id 曲式不再累加（以本机已有为准）");
  eq(res.added.lyrics, 0, "同 (曲式,段) 歌词行不再累加");
  eq(beat.Store.arranges.length, arr0, "曲式总数不变");
  eq(beat.Store.lyrics.length, lyr0, "歌词总数不变");
}

/* ================= 场景 T82d：校验口径各不相同 ================= */
section("T82d 全量数据包 · 预设严格整批拒绝 / 曲式歌词逐条丢弃");
{
  const { beat } = loadApp();
  const bad = PACK();
  bad.presets = [{ name: "坏型", meter: 4, bars: [[{ t: 48 }]] }];   // 小节没填满 192t
  const r1 = beat.Store.importAll(JSON.stringify(bad));
  eq(r1.ok, false, "预设不过校验 → **整批**拒绝（与 importPresets 同口径）");
  ok(/格式不正确/.test(r1.error), "错误文案指向具体预设：" + r1.error);
  eq(beat.Store.arranges.some(a => a.id === "a-import-1"), false,
    "整批拒绝时曲式也不会半途写进去（要么全进，要么不进）");

  const bad2 = PACK();
  bad2.arranges = [{ id: "x", name: "坏曲式", sections: [] }];        // sections 为空 → normArrange 淘汰
  const r2 = beat.Store.importAll(JSON.stringify(bad2));
  eq(r2.ok, true, "曲式坏条目 → 只丢弃这一条，整包照常导入");
  eq(r2.added.arranges, 0, "该曲式没进库");
  eq(r2.skipped.arranges, 1, "跳过数被记下来（否则用户不知道少了一条）");
  eq(r2.added.presets, 1, "同一包里的预设仍然进了（不为一条坏曲式废掉整包）");
}

/* ================= 场景 T82e：体量与类型护栏 ================= */
section("T82e 全量数据包 · 体量与类型护栏（与 importPresets 同一组）");
{
  const { beat } = loadApp();
  eq(beat.Store.importAll("not json").ok, false, "非 JSON → 拒绝");
  eq(beat.Store.importAll(JSON.stringify({ kind: "something-else" })).ok, false,
    "不是 BeatSight 数据包 → 拒绝（kind 不匹配）");
  eq(beat.Store.importAll("x".repeat(2 * 1024 * 1024 + 10)).ok, false, "超过 2 MB → 拒绝");
  /* 老预设包（kind:"presets"）也必须能吃进来：用户手上只有那份 JSON 时，
     不该让他"先去找到另一种导出" */
  const legacy = { app: "beatsight", kind: "presets", v: 2,
    presets: [{ name: "老包里的型", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] };
  const r = beat.Store.importAll(JSON.stringify(legacy));
  ok(r.ok && r.added.presets === 1, "老预设包也能被「导入全部数据」吃进来（不逼用户找另一种导出）");
}

/* ================= 场景 T82f：导出真的走下载路径 / 两类容量闸门 ================= */
section("T82f 全量数据包 · 导出接线 + 容量闸门（库内总量 / 记录环形上限）");
{
  const { beat } = loadApp();
  /* exportAll 必须真的调下载工具，而不是"算出字符串就完事"。
     凭据分两层：① 它返回 true（exportPresets 同一套语义）；
     ② 下载工具本身已被既有用例断言过走 Blob + objectURL（`downloadJSON` 是两条导出路径共用的
        唯一实现）——所以这里不做"再造一个 URL 探针"的事，只钉住"确实调到了出口"。 */
  const grab = beat.Store.serializeAll();
  ok(/^\{/.test(grab) && JSON.parse(grab).kind === "all", "serializeAll 产出可直接落盘的全量包");
  eq(beat.Store.exportAll(), true, "exportAll 返回 true（已发起下载，与 exportPresets 同一语义）");

  /* 库内总量闸门：importPresets 早有这条，全量包必须同口径（否则绕过上限的另一条路） */
  const { beat: b2 } = loadApp();
  const fill = () => { while (b2.Store.customs.length < 500) b2.Store.customs.push({ name: "占位", meter: 4, bars: [[{ t: 192 }]] }); };
  fill();
  const full = b2.Store.importAll(JSON.stringify({
    kind: "all", presets: [{ name: "再来一个", meter: 4, bars: [[{ t: 192 }]] }] }));
  eq(full.ok, false, "库里已满 500 → 拒绝（与 importPresets 同一道总量闸门）");
  ok(/超过上限/.test(full.error), "错误文案说清是上限问题：" + full.error);

  /* 练习记录的环形上限：它是**冷键的容量约束**，导入不得绕过——
     否则一份攒了很久的备份能把 beatsight.log 撑到任意大 */
  const { beat: b3 } = loadApp();
}

/* ================= 场景 T82g：听辨战绩只认白名单键（P3 工程卫生） ================= */
section("T82g 全量数据包 · 听辨战绩键名白名单（垃圾键不进内存 / 不环回外泄）");
{
  const { beat } = loadApp();
  const res = beat.Store.importAll(JSON.stringify({
    kind: "all", ear: { total: 7, right: 5, best: 4, evil: 999 } }));
  ok(res.ok, "带多余键的包仍可导入（多余键被忽略，不是整包拒绝）");
  eq(beat.Store.earStats.total, 7, "白名单内的 total 正常合并");
  ok(beat.Store.earStats.best >= 4, "白名单内的 best 正常合并（累计量取较大值）");
  /* 反向验证锚点：合并若回退成 `Object.keys(data.ear)`，evil 会写进内存 ear，
     下面两条立刻变红——① earStats.evil 不再是 undefined；② 再导出的 ear 带上 evil */
  ok(beat.Store.earStats.evil === undefined, "白名单外的键不进内存 earStats（实际 "
    + beat.Store.earStats.evil + "）");
  const re = JSON.parse(beat.Store.serializeAll()).ear;
  eq(Object.keys(re).sort().join(","), "best,right,total",
    "再导出的 ear 只含 total/right/best（垃圾键不会随导出环回）");
}

/* ================= 场景 T82h：歌词合并受总量上限约束（P3 工程卫生） ================= */
section("T82h 全量数据包 · 歌词合并受 lyricMaxLines 总量约束（与加载路径同口径）");
{
  const { beat } = loadApp();
  /* v2.26.0：行按段 uid 寻址，故这里给的是**新格式**（secUid 直接给全）。
     （旧格式 sec 下标要能解析到曲式才成立，本场景只关心容量闸门，不掺那条路） */
  const lines = Array.from({ length: 300 }, (_, i) => ({
    arrangeId: "a-cap-" + i, secUid: "u" + i, chars: [{ t: 0, dur: 24, ch: "字" }] }));
  const r = beat.Store.importAll(JSON.stringify({ kind: "all", lines }));
  ok(r.ok, "大批歌词行可导入");
  /* 反向验证锚点：合并若不受上限约束（删掉那句容量判断），这里会是 300 而非 256 */
  eq(beat.Store.lyrics.length, 256,
    "导入后歌词被截到 lyricMaxLines=256——外部包顶不穿容量上限");
  eq(r.added.lyrics, 256, "加入计数如实反映只进了 256 行");
  eq(r.skipped.lyrics, 300 - 256, "剩余 44 行计入 skipped（用户知道被截了多少）");
}
