/* BeatSight 自动化测试 · 无方向空扫（air）在发声层静默（v3.52.0）
   T251 系列。
   ---------------------------------------------------------------------------
   air 是**纯记谱层字段**（同 dir/zone/str）：scheduler 一行都不读它。
     · T251a 孪生型仅某步 air 不同（纯休止 vs 无方向空扫）→ 发声输出**逐位相同**（air 不加声）；
     · T251b 发声音符 → 无方向空扫 → 恰好少一声（那颗），全部命中时刻集合不变。
   ★ 素材一律 zone:0（低弦区 = 单频段一声）：若用 dir-only 格，调度层会补成全扫（zone=1），
     全扫是双频段两声，"差几声"的口径就不干净了（同 t114e 的踩坑记录）。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

function playSeq(setup, seconds){
  const { beat } = loadApp();
  if (setup) setup(beat);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, seconds);
  beat.Controls.stop();
  return ac.hits.map(h => [h.t, h.freq]);
}

/* ================= 场景 T251a：air 只是记谱，不加声 ================= */
section("T251a air 静默 · 纯休止 vs 无方向空扫 → 发声逐位相同");
{
  const mk = (name, air) => ({ name, meter: 4,
    bars: [0,1,2,3].map(() => [
      { t:48, dir:"D", zone:0 }, { t:48, rest:true, zone:0 }, { t:48, dir:"U", zone:0 }, { t:48, dir:"D", zone:0 },
    ].map((s, i) => (i === 1 && air) ? { t:48, rest:true, air:true, zone:0 } : s)) });
  const a = playSeq(beat => {
    beat.Store.importPresets(JSON.stringify({ presets: [mk("孪生-纯休止", false)] }));
    beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  }, 2);
  const b = playSeq(beat => {
    beat.Store.importPresets(JSON.stringify({ presets: [mk("孪生-空扫", true)] }));
    beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  }, 2);
  eq(JSON.stringify(b), JSON.stringify(a),
     "★ 仅某步 air 不同（纯休止 ↔ 无方向空扫）→ 命中序列逐位相同（air 不产生任何声音）");
}

/* ================= 场景 T251b：发声音符翻成无方向空扫 = 少一声、时间轴不动 ================= */
section("T251b air 静默 · 发声 → 无方向空扫：恰少一声、全部命中时刻不变");
{
  const mk = (name, air) => ({ name, meter: 4,
    bars: [0,1,2,3].map(() => [
      { t:48, dir:"D", zone:0 },
      air ? { t:48, rest:true, air:true, zone:0 } : { t:48, dir:"D", zone:0 },
      { t:48, dir:"U", zone:0 }, { t:48, dir:"D", zone:0 },
    ]) });
  const before = playSeq(beat => {
    beat.Store.importPresets(JSON.stringify({ presets: [mk("孪生-发声", false)] }));
    beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  }, 2);
  const after = playSeq(beat => {
    beat.Store.importPresets(JSON.stringify({ presets: [mk("孪生-空扫", true)] }));
    beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  }, 2);
  eq(after.length, before.length - 1, "★ 恰好少一声（被翻成无方向空扫的那颗），不是少一整拍");
  const tSet = arr => [...new Set(arr.map(h => h[0]))].sort((a, b) => a - b);
  eq(JSON.stringify(tSet(after)), JSON.stringify(tSet(before)),
     "★ 全部命中时刻一字不动——air 不碰时间轴");
}
