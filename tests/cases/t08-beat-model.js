/* BeatSight 自动化测试 · 节奏模型：旧数据迁移 / 三连音 tick / Swing / 奇数拍 / 播放中切拍号
   T8–T12。tick 制数据模型与发声时机的核心回归。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, near, section, drive } = require("../lib/harness");

/* ================= 场景 T8：v0.7.0 localStorage 浮点 → tick 迁移 ================= */
section("T8 Store · 旧浮点数据迁移 tick + 备份");
{
  const oldData = { bpm: 100, sig: 4, sel: { type: "custom", id: "cold1" },
    customs: [{ id: "cold1", name: "旧预设", meter: 4,
      bars: [0,1,2,3].map(() => [{ d: 1 }, { d: 0.5 }, { d: 0.5 }, { d: 0.75 }, { d: 0.25 }, { d: 1 }]) }] };
  const { beat, storage } = loadApp({ "beatsight.m2": JSON.stringify(oldData) });
  const c = beat.Store.customs[0];
  eq(c.bars[0][0].t, 48, "迁移：d=1 → t=48");
  eq(c.bars[0][3].t, 36, "迁移：d=0.75 → t=36");
  ok(c.bars[0].every(s => s.d === undefined), "迁移后无残留 d 字段");
  ok(storage.has("beatsight.m2.bak"), "迁移前已备份 beatsight.m2.bak");
  eq(JSON.parse(storage.get("beatsight.m2.bak")).customs[0].bars[0][0].d, 1, "备份保留原始浮点数据");
  /* v1.3.0 契约更新：写目标由单键 beatsight.m2 改为冷热分离的
     beatsight.state（热）/ beatsight.customs（冷）。旧键降级为只读的迁移来源。
     persist() 现在是 250ms 防抖，要断言落盘内容必须显式 flush()（页面隐藏/pagehide 也走它） */
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).v, 3, "flush 后热键写入 beatsight.state（v:3）");
  eq(JSON.parse(storage.get("beatsight.customs")).customs.length, 1, "迁移后的预设写入冷键 beatsight.customs");
  eq(JSON.parse(storage.get("beatsight.customs")).customs[0].bars[0][0].t, 48, "冷键里是迁移后的 tick（非原始浮点 d）");
  eq(beat.curPattern().name, "旧预设", "迁移后 id 引用仍命中原预设");
}

/* ================= 场景 T9：三连音数据模型 ================= */
section("T9 节奏模型 · 三连音 tick 校验");
{
  const { beat } = loadApp();
  const Store = beat.Store;
  const triplet = { presets: [{ name: "三连音测试", meter: 4,
    bars: [0,1,2,3].map(() => Array.from({ length: 12 }, () => ({ t: 16 }))) }]};
  ok(Store.importPresets(JSON.stringify(triplet)).ok, "八分三连音 ×12 = 4 拍 整数校验通过");
  const badTriplet = { presets: [{ name: "残缺三连音", meter: 4,
    bars: [[{ t: 16 }, { t: 16 }, { t: 48 }, { t: 48 }, { t: 48 }], [], [], []] }]};
  ok(Store.importPresets(JSON.stringify(badTriplet)).ok === false, "残缺三连音组（2/3 组）时值不足拒绝");
  const c = Store.customs[0];
  eq(c.bars[0].reduce((a, s) => a + s.t, 0), 192, "三连音小节和 = 4×48 = 192t（整数严格相等，无浮点容差）");
}

/* ================= 场景 T10：Swing 发声时机偏移 ================= */
section("T10 Swing · 后半拍八分发声延后，时间轴不动");
{
  /* 八分摇滚（idx 2，24t×8），BPM 96 → spb=0.625s；swing 67 → 后半拍延后 (67-50)/50×24t=8.16t≈0.10625s */
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "builtin", idx: 2 }, swing: 67 }) });
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);
  const hits = ac.hits.slice(0, 4);
  eq(hits.length, 4, "一小节内 4 次发声已记录");
  const spb = 60 / 96;
  near(hits[1].t - hits[0].t, (24 + 8.16) / 48 * spb, 1e-6, "第 1→2 颗间隔 = 24t + 8.16t（swing 延后）");
  near(hits[2].t - hits[1].t, (24 - 8.16) / 48 * spb, 1e-6, "第 2→3 颗间隔 = 24t - 8.16t（下一颗按时进入）");
  near(hits[0].t, 0.08, 1e-6, "第 1 颗（正拍）不受 swing 影响");

  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "builtin", idx: 2 }, swing: 50 }) });
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  drive(ac2, b2, 1.5);
  const h2 = ac2.hits;
  near(h2[1].t - h2[0].t, 0.5 * spb, 1e-6, "swing=50（直）时八分间隔均匀");
}

/* ================= 场景 T11：奇数拍重拍分组 ================= */
section("T11 奇数拍 · 重拍分组发音");
{
  /* Take Five 律动（idx 9）：meter 5，accents [0,3]，[48,48,48,24,24] */
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sig: 5, sel: { type: "builtin", idx: 9 } }) });
  eq(beat.curPattern().name, "Take Five 律动 · 5/4", "5/4 下选中 Take Five 预设");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 4);
  const hits = ac.hits.slice(0, 5);
  eq(hits[0].freq, 1568, "第 1 拍重拍音（1568Hz）");
  eq(hits[1].freq, 1046.5, "第 2 拍普通正拍音");
  eq(hits[3].freq, 1568, "第 4 颗（第 4 拍 = 3+2 分组点）重拍音");
  eq(hits[4].freq, 784, "第 5 颗（后半拍八分 = 细分位）细分音 784Hz");

  /* 基本回退节奏 5/4 默认 2+3 分组（D4 决策） */
  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({ sig: 5 }) });
  eq(JSON.stringify(b2.curPattern().accents), JSON.stringify([0, 2]), "5/4 回退节奏默认重拍分组 2+3");
  const { beat: b3 } = loadApp({ "beatsight.m2": JSON.stringify({ sig: 7 }) });
  eq(JSON.stringify(b3.curPattern().accents), JSON.stringify([0, 3, 5]), "7/4 回退节奏默认重拍分组 3+2+2");
}

/* ================= 场景 T12：播放中切拍号无缝生效（v0.4.0 机制 tick 制回归） ================= */
section("T12 播放中切换 · 小节边界无缝应用（tick 制回归）");
{
  const { beat, els } = loadApp();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 播放 1 秒后切到 3/4（华尔兹 idx 6，meter 3）：挂起到循环起点 */
  drive(ac, beat, 1);
  beat.Store.S.sel = { type: "builtin", idx: 6 };
  beat.Controls.setSig(3);
  beat.Presets.refreshAfterPatternChange();
  eq(beat.Store.S.sig, 3, "拍号状态立即切换");
  drive(ac, beat, 8);
  eq(beat.Store.S.playing, true, "切换后播放未中断");
  ok(ac.hits.length > 8, "切换后持续发声");
}

