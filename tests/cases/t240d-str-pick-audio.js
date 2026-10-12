/* BeatSight 自动化测试 · 逐弦拨弦（str）发声层
   T240d 系列（v3.47.0）。
   ---------------------------------------------------------------------------
   契约（PLAN-v10-str-pick §5）：
     · 声音只有两种，判据 = 这一格拨了几根弦：
         单弦（str 长度 1）= pluckHit 固定拨弦音（triangle 392→196 + 2600Hz 噪声激励，
           **参数恒定**——换弦号/品号/技巧，调用参数逐位相同，这本身就是断言对象）；
         多弦（≥2）= 既有 strumZoneHit 全扫口径（700+2800Hz 双频段同刻，成本与弦数无关）；
         无 str = 既有 zone 逻辑逐位不变；
     · str 优先于 zone（stepVoiceOf 唯一裁决）；声部走 S.strumVol（扫弦音量滑条挂接）；
     · onset 一步一条（多弦格也只有一条；rest+str 无声无 onset）；
     · strumGrid 补拍语义不变：扫弦声（含 str）不算「顶掉」节拍器——每拍补声照旧；
     · 时刻一字不动（T62e 同款不变量）：str 不碰时间轴。
   声音断言走 FakeAudioContext.hits（osc: freq/type/sweepTo/gain；noise: filterFreq/gain）。 */
"use strict";
const { loadApp, ok, eq, near, section, drive } = require("../lib/harness");

/* 一小节四种格：单弦带品 / 多弦加花 / 空拨 / 单弦带品带技巧（根音弦刻意各不同） */
const BARS = () => [[
  { t: 48, str: [{ s: 6, f: 5 }] },                     // pick1（beat0 重拍）
  { t: 48, str: [{ s: 1 }, { s: 2 }] },                 // pickN（多弦）
  { t: 48, rest: true, str: [{ s: 5 }] },               // 空拨：无声无 onset
  { t: 48, str: [{ s: 4, f: 12, tech: "O" }] },         // pick1（技巧+品都不同）
]];
const loadStr = () => {
  const app = loadApp();
  app.beat.Store.importPresets(JSON.stringify({ presets: [{ name: "分解", meter: 4, bars: BARS() }] }));
  app.beat.Store.S.sel = { type: "custom", id: app.beat.Store.customs[app.beat.Store.customs.length - 1].id };
  app.beat.Store.S.strumVol = 0.8;                      // 显式定值（倍率断言的基准）
  app.beat.Presets.refreshAfterPatternChange();
  return app;
};
/* pluck 识别：triangle + 扫频目标 196（桩的 setValueAtTime 不存值，freq 读 0——
   sweepTo 来自 exponentialRampToValueAtTime，是 FakeParam 里唯一落账的频率写法） */
const plucksOf = ac => ac.hits.filter(h => h.kind === "osc" && h.type === "triangle" && h.sweepTo === 196);
const pluckNoiseOf = ac => ac.hits.filter(h => h.kind === "noise" && h.filterFreq === 2600);
const gridOf = ac => ac.hits.filter(h => h.kind === "osc" && (h.freq === 1046.5 || h.freq === 1568));

/* ================= 场景 T240d-1：stepVoiceOf 声部判定（唯一裁决） ================= */
section("T240d-1 逐弦 · stepVoiceOf：str 优先于 zone / 三案收口");
{
  const { beat } = loadStr();
  const sv = beat.AudioEngine.stepVoiceOf;
  eq(JSON.stringify(sv({ str: [{ s: 5 }] })), JSON.stringify({ strum: true, kind: "pick1", zone: 1 }),
     "单弦 → pick1");
  eq(JSON.stringify(sv({ str: [{ s: 5 }, { s: 2 }] })), JSON.stringify({ strum: true, kind: "pickN", zone: 1 }),
     "多弦 → pickN");
  eq(JSON.stringify(sv({ str: [{ s: 5 }], zone: 0 })), JSON.stringify({ strum: true, kind: "pick1", zone: 1 }),
     "★ str 存在时 zone 失效（str 优先）");
  eq(JSON.stringify(sv({ str: [{ s: 5 }, { s: 1 }], dir: "A" })), JSON.stringify({ strum: true, kind: "pickN", zone: 1 }),
     "★ str + dir 共存 → 仍按弦数裁决（dir 是记谱不进发声）");
  eq(JSON.stringify(sv({ dir: "D" })), JSON.stringify({ strum: true, kind: "zone", zone: 1 }),
     "dir-only → 补全扫（既有口径）");
  eq(JSON.stringify(sv({ zone: 0 })), JSON.stringify({ strum: true, kind: "zone", zone: 0 }),
     "zone=0 → 低弦区（既有口径）");
  eq(JSON.stringify(sv({})), JSON.stringify({ strum: false, kind: "zone", zone: undefined }),
     "裸时值 → 节拍声部（既有口径）");
}

/* ================= 场景 T240d-2：单弦 pluckHit 恰好一次 + 参数恒定 ================= */
section("T240d-2 逐弦 · 单弦一格一拨 / 参数与弦号品号技巧无关 / 声部音量挂接");
{
  const { beat } = loadStr();
  beat.Controls.start();
  const ac = (require("../lib/harness").FakeAudioContext).last;
  drive(ac, beat, 2.4);                       // 96BPM：一小节 2.5s，收在回卷前覆盖 4 拍
  beat.Controls.stop();
  const inBar = h => h.t < 2.5;               // 调度前瞻窗口会提前排进下一小节首格——按小节界过滤
  const plucks = plucksOf(ac).filter(inBar), pNoise = pluckNoiseOf(ac).filter(inBar);
  eq(plucks.length, 2, "★ 两个单弦格各恰好一次 pluckHit（多弦/空拨格不出拨弦音）");
  eq(pNoise.length, 2, "触弦噪声激励与体音同刻各一次");
  /* 时刻不漂（str 不碰时间轴）：cell0 = 起播 +0.08 窗口；cell3 = +3 拍 */
  near(plucks[0].t, 0.08, 1e-6, "第 1 格时刻不漂");
  near(plucks[1].t, 0.08 + 3 * 0.625, 1e-6, "第 4 格 = +3 拍（rest 格不占 onset 时刻）");
  /* ★ 参数恒定：换弦号（⑥→④）、品号（5→12）、技巧（无→O），调用参数逐位相同 */
  eq(plucks[1].type, plucks[0].type, "音色 type 相同");
  eq(plucks[1].sweepTo, plucks[0].sweepTo, "扫频目标相同（392→196 定值，无频率参数）");
  eq(plucks[1].gain, plucks[0].gain, "峰值相同（同为 beat 档；重拍档 v3.39.0 起与正拍齐平）");
  eq(pNoise[1].gain, pNoise[0].gain, "噪声激励峰值同比例");
  eq(pNoise[0].t.toFixed(3), plucks[0].t.toFixed(3), "噪声与体音同刻");
  /* 多弦格：全扫口径双频段同刻、无拨弦音 */
  const zones = ac.hits.filter(h => h.kind === "noise" && (h.filterFreq === 700 || h.filterFreq === 2800));
  eq(zones.length, 2, "多弦格 = 700+2800 全扫双频段（不按弦组细分）");
  eq(zones[0].t.toFixed(3), zones[1].t.toFixed(3), "两频段同刻");
  near(zones[0].t, 0.705, 1e-6, "多弦格时刻 = 第 2 拍");
  /* 空拨（rest+str）：扫弦声部无声（该拍的节拍器网格点击不属于本格声部，另行断言） */
  const restT = (0.08 + 2 * 0.625).toFixed(3);
  const strumVoiceAtRest = ac.hits.filter(h => Math.abs(h.t - restT) < 1e-9
    && ((h.kind === "osc" && h.sweepTo === 196) || (h.kind === "noise" && [700, 2800, 2600].includes(h.filterFreq))));
  eq(strumVoiceAtRest.length, 0, "★ rest+str 格扫弦声部全程无声");
  /* onset 一步一条：发声格 3 颗 → 本小节 onsetBuf 3 条（多弦格也只 1 条；前瞻排入的下一小节不算） */
  eq(beat.onsetBuf().filter(o => o.t < 2.5).length, 3, "★ onsetBuf 条数 = 发声格数（一步一条，与弦数无关）");
  /* strumGrid 补拍：扫弦声不算顶掉——每拍节拍器照旧补声 */
  ok(gridOf(ac).length >= 4, "★ 纯 str 型下节拍器网格照旧每拍补声（扫弦声不算顶掉）");
  /* 声部音量挂接：S.strumVol 减半 → 峰值等比例减半（节拍音量不动） */
  const g1 = plucks[0].gain;
  const app2 = loadStr();
  app2.beat.Store.S.strumVol = 0.4;
  app2.beat.Controls.start();
  const ac2 = (require("../lib/harness").FakeAudioContext).last;
  drive(ac2, app2.beat, 0.3);
  app2.beat.Controls.stop();
  const p2 = plucksOf(ac2)[0];
  near(p2.gain, g1 / 2, 1e-9, "★ strumVol 减半 → pluck 峰值等比（声部挂 S.strumVol）");
  ok(p2.gain > 0, "声部音量真实生效（非静默路径）");
}
