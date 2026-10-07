/* BeatSight 自动化测试 · 静音拍相位契约（v3.36.7，本轮审计 P1-4）
   T220
   ──────────────────────────────────────────────────────────────────────────────────────
   由来（2026-10-07 只读审计 P1-4）：reanchor / rescheduleLoop 会重置 schedBar/schedStep，
   并把 schedPlayBar 归零。审计的裁定是 **不修代码**——重锚的语义就是「重新起一轮」，
   归零是正确行为；缺的是**一条把它钉成契约的单测**：否则以后有人「顺手」改成保留相位，
   没有任何东西会红。

   ★ 为什么这条值得钉：schedPlayBar 是静音拍与「每 N 小节」的**唯一相位源**（见共享区注释）。
     它一旦被改成"保留"，后果是**重锚后的第一个静音周期与用户已听见的节奏错位一次**——
     不报错、不崩溃，只是听起来"这一组静音怎么提前/延后了一小节"。

   反向验证（改坏后必须变红，已实测）：
     · 把某处重锚的 `schedPlayBar = 0` 删掉（保留相位）→ T220c 红。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

/** 固定模式：每 4 小节一组、静组内末尾 1 个 ⇒ 线性小节 3 / 7 / 11… 被静 */
const withMute = () => {
  const app = loadApp();
  app.beat.Store.S.mute = true;
  app.beat.Store.S.muteCfg = { period: 4, count: 1, random: false };
  return app;
};

/* ================= T220a：判据本身 ================= */
section("T220a 静音拍判据（固定模式）：组内末尾 count 个被静");
{
  const { beat } = withMute();
  [[0, false], [1, false], [2, false], [3, true],
   [4, false], [7, true], [8, false]].forEach(([i, v]) =>
    eq(beat.muteBarMuted(i), v, "线性小节 " + i + " 被静 = " + v));
}

/* ================= T220b：正常播放相位推进 ================= */
section("T220b ★ 正常播放：相位随小节单调推进（静音拍才有到点的那一刻）");
{
  const { beat } = withMute();
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  eq(beat.schedPlayBar(), 0, "起播时相位从 0 起");
  let maxSeen = 0;
  for (let i = 0; i < 250; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    maxSeen = Math.max(maxSeen, beat.schedPlayBar());
  }
  ok(maxSeen >= 3, "★ 推进后相位走过至少 3 个小节（实际最大 " + maxSeen + "）");
}

/* ================= T220c：重锚 ⇒ 相位归零（契约本体） ================= */
section("T220c ★★★ 契约：重锚 = 重新起一轮 ⇒ 相位归零（审计 P1-4）");
{
  const { beat } = withMute();
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  for (let i = 0; i < 250; i++){ ac.currentTime += 0.02; beat.AudioEngine.scheduler(); }
  const before = beat.schedPlayBar();
  ok(before > 0, "前提：重锚前相位已推进到 " + before);

  ac.currentTime += 60;                 // 模拟后台被节流 60 秒 ⇒ 游标远远落后 ⇒ 饥饿重锚
  beat.AudioEngine.scheduler();
  eq(beat.diag.reanchorStarved, 1, "前提：确实发生了一次饥饿重锚");
  eq(beat.schedPlayBar(), 0,
    "★★★ 重锚后相位归零 —— 语义是「重新起一轮」：静音拍的周期从第 0 小节重算，"
    + "而非接着重锚前的相位走。审计裁定这是**正确**行为，本用例把它钉成契约"
    + "（改「保留相位」必须让这条变红，而不是靠人记得）");
  eq(beat.muteBarMuted(0), false, "配套：第 0 小节不被静 ⇒ 重锚后的第一个小节一定有声");
}
