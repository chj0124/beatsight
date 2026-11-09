/* T277：冷键写入读数与调度热路径缓存。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

section("T277a 冷键写入最近值 / 峰值 / p95 只统计真实成功写入");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  const seq = [0, 10, 20, 50];
  sandbox.performance.now = () => seq.shift();
  const pack = name => JSON.stringify({ presets: [{ name, meter: 4,
    bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] });
  beat.Store.importPresets(pack("一"));
  beat.Store.importPresets(pack("二"));
  const stat = beat.Diagnostics.coldWrite();
  eq(stat.ms, 30, "最近一次冷键写入耗时 30ms");
  eq(stat.maxMs, 30, "峰值冷键写入耗时 30ms");
  eq(stat.p95Ms, 30, "两次样本的 p95 为 30ms");
  eq(stat.samples, 2, "两次真实写入进入样本");
  const before = beat.Diagnostics.coldWrite();
  beat.Store.persistCold();
  eq(beat.Diagnostics.coldWrite().samples, before.samples, "判重跳过不污染样本");
  eq(beat.Diagnostics.coldWrite().p95Ms, before.p95Ms, "判重跳过不改变 p95");

  const failed = loadApp({}, { throwOnWrite: true });
  failed.sandbox.performance.now = () => 0;
  failed.beat.Store.importPresets(pack("失败"));
  eq(failed.beat.Diagnostics.coldWrite().samples, 0, "写失败不进入成功样本");
  eq(failed.beat.Diagnostics.coldWrite().maxMs, -1, "无成功样本时峰值保持 -1");
}

section("T277b 稳定播放快照缓存 hasStrum，试听草稿每轮重算");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  let calls = 0;
  const original = sandbox.hasStrum;
  sandbox.hasStrum = pat => { calls++; return original(pat); };
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  calls = 0;
  beat.AudioEngine.scheduler();
  beat.AudioEngine.scheduler();
  eq(calls, 1, "★ 同一 appliedPat 连续两轮调度只扫描一次");
  beat.Store.S.sel = { type: "builtin", idx: 1 };
  beat.Presets.refreshAfterPatternChange();
  eq(calls > 1, true, "换型后重新扫描");
  const beforePreview = calls;
  beat.Store.S.preview = true;
  beat.AudioEngine.scheduler();
  beat.AudioEngine.scheduler();
  eq(calls - beforePreview, 2, "★ 试听草稿可能原地修改，两轮都重算");
  beat.Controls.stop();
  ok(!!ac, "音频上下文已建立");
}
