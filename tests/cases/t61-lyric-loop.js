/* BeatSight 自动化测试 · F2 按歌词行选段循环（v2.2.0）
   T61 系列。
   ---------------------------------------------------------------------------
   契约：歌词行身份 = (曲式id, 段 uid)（v2.26.0 起），故「循环本行」=「只播这一段 + 循环 + 变速爬坡」。
     · 爬坡粒度：loopPerSec 开启时每循环一整段升一级（每级 = secBars(当前段) 小节），
       而不是 everyN 小节——句跟句练；
     · 循环边界按段内绝对 tick：跨小节的字（dur 越过小节线）完整落在段内，
       回卷只发生在段尾，没有"字被边界切开"的情形；
     · 测试基准：BUILTINS[1] 四分基础 4/4 × 1 遍 = 4 小节 = 768 tick；
       240 BPM 下 1 小节 = 1s。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seed = extra => ({
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t1", name: "歌词曲", sections: [
      { uid: "s1", name: "主歌", blocks: [BL(1, 1)] },    // 4 小节
      { uid: "s2", name: "副歌", blocks: [BL(1, 2)] },    // 8 小节
    ] },
  ]}),
  "beatsight.state": JSON.stringify(Object.assign(
    /* v2.11.2：原 `bpm:240 + trainer.start:60`（靠 start() 把 BPM 拽到起始值）改为**直接把
       bpm 设为 60** —— 起点现在是"开播时的当前 BPM"，不再有 start 可拽。实际播放速度不变 */
    { v: 3, bpm: 60, playMode: "preset",
      trainer: { on: true, target: 68, step: 2, everyN: 99 } },   // everyN=99：只有 loopPerSec 才升得动
    extra)),
});
const noiseCues = ac => ac.hits.filter(h => h.kind === "noise" && h.filterFreq === 2000);

/* ================= 场景 T61a：落点 = 该段单曲循环 + 爬坡开启 ================= */
section("T61a 歌词行循环 · 落点范围 / 爬坡开启 / 段长即一级");
{
  const { beat } = loadApp(seed());
  beat.Store.upsertLyric("t1", "s2", [{ t: 0, dur: 24, ch: "光" }]);
  beat.Arrange.loopLyricSection("t1", "s2");
  eq(beat.Store.S.playMode, "arrange", "进入曲式模式");
  eq(JSON.stringify([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to]), "[4,11]",
     "★ 范围 = 只有该行（段）自己（v2.10.7：写入该段的起止小节，副歌 = 小节 4..11）");
  eq(beat.Store.S.arrangeSel.loop, true, "循环开");
  eq(beat.Store.S.trainer.on, true, "变速训练器被一并开启");
  eq(beat.Trainer.setLoopPerSec(true), true, "★ 爬坡粒度 = 每段一级（不是每 everyN 小节）");
  eq(beat.Store.S.bpm, 60, "停机落点后 BPM 定位到起始速度");

  /* 不存在/越界段 → 静默不动作 */
  const b2 = JSON.stringify(beat.Store.S.arrangeSel);
  beat.Arrange.loopLyricSection("t1", "s10");
  beat.Arrange.loopLyricSection("ghost", 0);
  eq(JSON.stringify(beat.Store.S.arrangeSel), b2, "★ 段不存在/曲式不存在 → 选择不变（不猜）");
}

/* ================= 场景 T61b：行循环边界与爬坡步进 ================= */
section("T61b 歌词行循环 · 循环边界正确 / 每段升一级 / 到目标自动停");
{
  const { beat } = loadApp(seed());
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "夜" }]);
  beat.Arrange.loopLyricSection("t1", "s1");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 段 0 = 4 小节；60→68 step2 = 5 级（60/62/64/66/68）。loopPerSec 下每级 = 4 小节。
     驱动按每级实际秒数走（60BPM 段=16s，之后逐级略快），给足余量 */
  const driveSteps = (app, beat, ac, seconds) => {
    const dt = 0.02, n = Math.ceil(seconds / dt);
    for (let i = 0; i < n && beat.Store.S.playing; i++){ ac.currentTime += dt; beat.AudioEngine.scheduler(); }
  };
  driveSteps(null, beat, ac, 80);
  eq(beat.Store.S.playing, false, "★ 练到目标级并练满一段后自动停（爬坡与循环同一条边界链）");
  eq(beat.Store.S.bpm, 68, "最终到达目标 68 BPM（起点 = 开播时的当前速度 60）");
  /* v2.11.2：原「训练收成写进 S.trainer.last」两条断言删除——按钮下线后 last 已不存在 */
}

/* ================= 场景 T61c：爬坡步进精确性（每段一级，一段不差） ================= */
section("T61c 歌词行循环 · 爬坡步进精确（60→62→64，每级一段）");
{
  const { beat } = loadApp(seed({ trainer: { on: true, target: 66, step: 2, everyN: 1 } }));
  /* everyN=1 是陷阱：若 loopPerSec 没生效，每 1 小节就升一级（4 小节爬到 68 超目标）。
     正确行为 = 每 4 小节（一段）才升一级 */
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "夜" }]);
  beat.Arrange.loopLyricSection("t1", "s1");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const step = seconds => { const dt = 0.02, n = Math.ceil(seconds / dt);
    for (let i = 0; i < n && beat.Store.S.playing; i++){ ac.currentTime += dt; beat.AudioEngine.scheduler(); } };
  step(4.5);
  eq(beat.Store.S.bpm, 60, "第一段内 BPM 不动（loopPerSec：一段内不升级）");
  step(12);                                   // 越过第 4 小节边界（60BPM 段长 16s）
  eq(beat.Store.S.bpm, 62, "★ 练满一整段才升一级（60 → 62，不是每小节升）");
  step(16);                                   // 第二段 62BPM ≈ 15.5s
  eq(beat.Store.S.bpm, 64, "第二段满 → 64（步进 +2 精确）");
  beat.Controls.stop();
}

/* ================= 场景 T61d：跨小节的字在行循环内完整 ================= */
section("T61d 歌词行循环 · 跨小节的字完整 / 边界回卷不切断");
{
  /* v2.11.2：原 `start:60, target:60` —— 旧代码会把 target 抬到「起始+1」=61，
     从而不会一开播就判完成。现在 start 没了，直接写 target:61 复刻同一个效果 */
  const { beat } = loadApp(seed({ trainer: { on: true, target: 61, step: 2, everyN: 1 } }));
  beat.Store.S.lyricCue = true;
  /* 「夜」从小节 4（t=576）延音 240tick（跨小节 4 与段尾）：锚点只有 t=576 一个；
     「星」在段首 t=0。60BPM 下 1 拍 = 1s、1 小节 4s、1 段 16s，锚点时刻 = 0.08 / 12.08 / 16.08 / 28.08 */
  beat.Store.upsertLyric("t1", "s1", [
    { t: 576, dur: 240, ch: "夜" },
    { t: 0, dur: 24, ch: "星" },
  ]);
  beat.Arrange.loopLyricSection("t1", "s1");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const dt2 = 0.02; for (let i = 0; i < Math.ceil(30 / dt2); i++){ ac.currentTime += dt2; beat.AudioEngine.scheduler(); }
  const cues = noiseCues(ac);
  const ts = cues.map(h => +h.t.toFixed(3));
  near(ts[0], 0.08, 1e-3, "「星」锚点 = 段首");
  near(ts[1], 12.08, 1e-3, "「夜」锚点 = 段内 t=576（576tick × 1s/48tick = 12s）");
  near(ts[2], 16.08, 1e-3, "★ 回卷后「星」在下一遍段首准点再响（循环按段内 tick 重算）");
  near(ts[3], 28.08, 0.3, "下一遍的「夜」= 段尾回卷后再到 t=576（调度 25ms 粒度，容差 0.3s）");
  ok(!cues.some(h => h.t > 12.081 && h.t < 16.079),
     "★ 延音覆盖区间 [12.08, 16.08) 内零锚点（跨小节的字不产生边界回声）");
  beat.Controls.stop();
}

/* ================= 场景 T61e：byLyric 意图标记 · 开播重推 · 非歌词入口不残留（审计 P1-4） ================= */
section("T61e 歌词行循环 · byLyric 意图标记 / 开播重推 / 非歌词入口不泄漏");
{
  /* loopPerSec 无读 getter，用 bpm 的实际走向反推它的真值：
     everyN=1 陷阱下——loopPerSec 若为 true，要练满一整段（4 小节）才升一级；false 则每 1 小节升 */
  const { beat } = loadApp(seed({ trainer: { on: true, target: 66, step: 2, everyN: 1 } }));
  const step = seconds => { const dt = 0.02, n = Math.ceil(seconds / dt);
    for (let i = 0; i < n && beat.Store.S.playing; i++){ ac.currentTime += dt; beat.AudioEngine.scheduler(); } };

  /* 1) 歌词行落点 → byLyric 置真（意图持久化，跨停机/开播存活） */
  beat.Arrange.loopLyricSection("t1", "s1");
  eq(beat.Store.S.arrangeSel.byLyric, true, "★ 歌词行循环在 arrangeSel 上留 byLyric 意图标记");

  /* 2) 改用普通跳段 → 清标记。跳段单段循环与歌词行循环在 from/to/loop 上同形，
        唯 byLyric 能区分——不清就会把「整段一级」悄悄带进普通练习 */
  beat.Arrange.jumpTo(1);
  eq(beat.Store.S.arrangeSel.byLyric, false, "★ 跳段（非歌词入口）清掉 byLyric");

  /* 3) 开播：Controls.start 在 reset 后按 byLyric 重推 loopPerSec=false →
        everyN=1 生效，每 1 小节升一级（若残留为 true，此步 BPM 仍停在 60） */
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  step(4.5);
  eq(beat.Store.S.bpm, 62, "★ 非歌词入口按 everyN 升一级（loopPerSec 未从歌词会话泄漏）");
  beat.Controls.stop();
}
