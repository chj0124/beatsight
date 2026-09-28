/* BeatSight 自动化测试 · 选择性导入/导出（v2.65.0，X1）
   ---------------------------------------------------------------------------
   要钉住的是「只搬所需」这条路的完整性：
     · serializeAll(opts) 支持 parts 过滤（presets/arranges/lyrics/ear/settings）；
       不传 opts 仍导全部（含 settings），PACK_V 升到 2，末尾附 parts 字段；
     · 壁纸不进导出（t92 口径延续——视觉偏好非数据资产）；
     · 导入前 previewImport 做纯只读 dry-run，计数口径逐字对齐 importAll；
     · 设置导入：groups 整包替换 + builtinNames 按下标合并（往返一致）。
   ★ 反向验证锚点：删掉 importAll 里的 settings 分支 → res.settings 全 0、
     previewImport 的「分组/改名覆盖」计数也无处对上；删掉 parts 过滤 →
     serializeAll({parts:["presets"]}) 仍会带出 arranges/settings。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* ================= 场景 T83x-a：serializeAll 按 parts 过滤 ================= */
section("T83x-a 选择性导出 · serializeAll 按 parts 过滤（PACK_V=2）");
{
  const { beat } = loadApp();
  const full = JSON.parse(beat.Store.serializeAll());
  eq(full.v, 2, "PACK_V 升到 2");
  ok(Array.isArray(full.presets) && Array.isArray(full.arranges)
    && Array.isArray(full.lines) && full.ear, "默认（无 parts）导出含全部四类");
  ok(full.settings && Array.isArray(full.settings.groups)
    && typeof full.settings.builtinNames === "object", "默认导出含 settings（分组 + 改名覆盖）");
  ok(full.parts.indexOf("settings") >= 0, "parts 字段标注含 settings");

  const onlyP = JSON.parse(beat.Store.serializeAll({ parts: ["presets"] }));
  ok(Array.isArray(onlyP.presets), "只导 presets → 含 presets");
  eq(onlyP.arranges, undefined, "只导 presets → 不含 arranges");
  eq(onlyP.settings, undefined, "只导 presets → 不含 settings");
  eq(onlyP.parts.join(","), "presets", "parts 字段只写 presets");

  const onlyS = JSON.parse(beat.Store.serializeAll({ parts: ["settings"] }));
  ok(onlyS.settings && Array.isArray(onlyS.settings.groups), "只导 settings → 含 settings.groups");
  eq(onlyS.presets, undefined, "只导 settings → 不含 presets");
}

/* ================= 场景 T83x-b：壁纸不进导出 ================= */
section("T83x-b 选择性导出 · 壁纸不进（t92 口径延续）");
{
  const { beat } = loadApp();
  ok(!/wallpaper/.test(beat.Store.serializeAll()), "serializeAll 全量也不含 wallpaper");
  ok(!/wallpaper/.test(beat.Store.serializeAll({ parts: ["settings"] })), "只导 settings 也不含 wallpaper");
}

/* ================= 场景 T83x-c：exportAllSel 接线 + 空勾选拦截 ================= */
section("T83x-c 选择性导出 · exportAllSel 接线 + 空勾选拦截");
{
  const { beat } = loadApp();
  eq(beat.Store.exportAllSel([]), false, "空 parts → 返回 false（不发起下载）");
  eq(beat.Store.exportAllSel(["presets", "lyrics"]), true,
    "有 parts → 返回 true（已发起下载，走 downloadJSON）");
}

/* ================= 场景 T83x-d：previewImport 纯只读且计数 == importAll 落盘数 ================= */
section("T83x-d 导入冲突预览 · previewImport 纯只读 + 计数 == importAll 落盘数");
{
  const { beat } = loadApp();
  const earBefore = { total: beat.Store.earStats.total, right: beat.Store.earStats.right,
    best: beat.Store.earStats.best };
  const pack = {
    app: "beatsight", kind: "all", v: 2, version: "t",
    presets: [{ name: "预览型", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }],
    arranges: [{ id: "a-pv-1", name: "预览曲式",
      sections: [{ name: "主歌", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 2 }] }] }],
    lines: [{ arrangeId: "a-pv-1", sec: 0, chars: [{ t: 0, dur: 24, ch: "回" }] }],
    ear: { total: 9, right: 6, best: 5 },
    settings: { groups: [{ id: "g1", name: "我的组", zone: "beat",
      members: [{ type: "builtin", idx: 0 }], open: true }], builtinNames: { "0": "改名民谣" } }
  };
  const pv = beat.Store.previewImport(JSON.stringify(pack));
  ok(pv.ok, "previewImport 成功");
  const find = (/** @type {string} */ k) => pv.parts.find(p => p.kind === k);
  eq(find("节奏型").action, "新增", "节奏型=新增");
  eq(find("节奏型").count, 1, "节奏型 1 个");
  eq(find("曲式").action, "新增", "曲式=新增");
  eq(find("曲式").count, 1, "曲式 1 条");
  eq(find("歌词").action, "新增", "歌词=新增");
  eq(find("歌词").count, 1, "歌词 1 行");
  const expectEar = ["total", "right", "best"].filter(kk => pack.ear[kk] > earBefore[kk]).length;
  eq(find("听辨战绩").action, "合并", "听辨战绩=合并");
  eq(find("听辨战绩").count, expectEar, "听辨战绩合并字段数 == 高于本机的字段数");
  eq(find("分组").action, "替换", "分组=替换");
  eq(find("分组").count, 1, "分组 1 个");
  eq(find("改名覆盖").action, "合并", "改名覆盖=合并");
  eq(find("改名覆盖").count, 1, "改名覆盖 1 个");

  /* ★ 关键不变量：previewImport 是纯只读，绝不能落盘 / 改内存 */
  eq(beat.Store.customs.length, 0, "★ previewImport 未改变预设库");
  eq(beat.Store.arranges.length, 0, "★ previewImport 未写曲式");
  eq(beat.Store.lyrics.length, 0, "★ previewImport 未写歌词");

  /* 现在真正导入，计数应与预览逐一对上 */
  const res = beat.Store.importAll(JSON.stringify(pack));
  ok(res.ok, "importAll 成功");
  eq(res.added.presets, find("节奏型").count, "落盘预设数 == 预览数");
  eq(res.added.arranges, find("曲式").count, "落盘曲式数 == 预览数");
  eq(res.added.lyrics, find("歌词").count, "落盘歌词数 == 预览数");
  eq(res.added.ear, find("听辨战绩").count, "合并战绩数 == 预览数");
  eq(res.settings.groups, find("分组").count, "导入分组数 == 预览数");
  eq(res.settings.builtinNames, find("改名覆盖").count, "导入改名覆盖数 == 预览数");
}

/* ================= 场景 T83x-e：设置导入 分组整包替换 + 改名覆盖合并（往返一致） ================= */
section("T83x-e 设置导入 · 分组整包替换 + 改名覆盖合并（往返一致）");
{
  const { beat } = loadApp();
  const out1 = JSON.parse(beat.Store.serializeAll({ parts: ["settings"] }));
  ok(Array.isArray(out1.settings.groups), "导出 settings 成功（分组数组）");
  const foreign = { app: "beatsight", kind: "all", v: 2, version: "t",
    settings: { groups: [{ id: "gX", name: "外来组", zone: "strum",
      members: [{ type: "custom", id: "c1" }], open: false }], builtinNames: { "2": "改名金属" } } };
  const r = beat.Store.importAll(JSON.stringify(foreign));
  ok(r.ok, "只含 settings 的包可导入");
  eq(beat.Store.groups.length, 1, "分组被整包替换为 1 个（不是合并追加）");
  eq(beat.Store.groups[0].id, "gX", "分组 id 为外来那份");
  /* 往返：再导出 settings，应等于导入的 */
  const back = JSON.parse(beat.Store.serializeAll({ parts: ["settings"] }));
  eq(back.settings.groups.length, 1, "往返：分组仍为 1 个");
  eq(back.settings.groups[0].id, "gX", "往返：分组 id 一致");
  eq(back.settings.builtinNames["2"], "改名金属", "往返：改名覆盖 idx2 一致");
  eq(back.settings.builtinNames["0"], undefined, "往返：未导入的 idx0 改名覆盖不在内");
}

/* ================= 场景 T83x-f：预览 坏预设整批报错 / 无数据文件 parts 为空 ================= */
section("T83x-f 预览 · 坏预设整批报错 + 无数据文件 parts 为空");
{
  const { beat } = loadApp();
  const bad = { app: "beatsight", kind: "all", v: 2, version: "t",
    presets: [{ name: "坏", meter: 4, bars: [[{ t: 48 }]] }] };   // 小节没填满 192t
  const pvBad = beat.Store.previewImport(JSON.stringify(bad));
  eq(pvBad.ok, false, "含坏预设 → previewImport 直接报错（整批语义，不进预览）");
  const pvEmpty = beat.Store.previewImport(JSON.stringify({ app: "beatsight", kind: "all", v: 2, version: "t" }));
  ok(pvEmpty.ok && pvEmpty.parts.length === 0, "没有任何数据的包 → 预览 parts 为空（UI 据此提示无可导入）");
  /* 选择性文件（只含曲式）只预览曲式一行 */
  const pvArr = beat.Store.previewImport(JSON.stringify({ app: "beatsight", kind: "all", v: 2, version: "t",
    arranges: [{ id: "a-only-1", name: "只曲式", sections: [{ name: "A", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1 }] }] }] }));
  ok(pvArr.ok && pvArr.parts.length === 1 && pvArr.parts[0].kind === "曲式", "只含曲式的包 → 预览只列曲式一行");
}
