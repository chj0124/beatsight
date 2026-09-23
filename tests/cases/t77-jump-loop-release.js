/* BeatSight 自动化测试 · 跳段的「范围循环」解除开关（v2.7.3）
   T77 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   用户实拍：点「◀ 上一段」/「下一段 ▶」后永远困在那一段循环。
   根因（链路，不是单点）：
     jumpTo 把范围锁成单段并打开循环（from=to=k, loop=true）→
     arrNextBar 段尾遇 loop 为真就 `s = from` 回卷、永不返回 null →
     onArrangeEnd 永不触发 → 播放永不收尾。
   且整条链路没有任何"恢复整曲"的出口。v2.7.3 在跳段行补一个常驻开关作出口：
     · 与编排面板的「范围循环」**共用 S.arrangeSel.loop**（同源，两处入口同步）；
     · 关掉 = 解除锁定：loop 置假；若范围是跳段收成的单段，to 放开到曲末
       （用户选定：从当前段一路播到曲末后停，而不是原地再放一遍就停）；
     · 范围本就是多段时只关循环，不动用户设的 from/to。

   刻意用 240 BPM：内置型每遍 4 小节，240BPM 下 1 小节 = 1s → 4s 一段，
   驱动多少秒 = 走了多少小节，断言不用换算。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 每段 = 一遍「四分基础」（4/4、4 小节），故一段 = 4s @240BPM */
const SEC4 = (name) => ({ name, blocks: [BL(1, 1)] });

function startArrange(sections, sel){
  const app = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1,
      arranges: [{ id: "t1", name: "练习曲", sections }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
      arrangeSel: Object.assign({ id: "t1", from: 0, to: 0, loop: false }, sel) }),
  });
  app.beat.Controls.start();
  return { app, beat: app.beat, els: app.els, ac: FakeAudioContext.last };
}
const three = () => [SEC4("A"), SEC4("B"), SEC4("C")];
const checked = els => els["argJumpLoopBtn"].getAttribute("aria-checked");
/* v2.11.1：范围循环钮改 jump-btn 双态图标后 className 不再带 on/off（那是 toggle-pill 的口径），
   开/关的唯一真相 = aria-checked（setToggle 的 className 整写会抹掉 jump-btn/loop-btn 类，已弃用） */
const isOn = els => els["argJumpLoopBtn"].getAttribute("aria-checked") === "true";

/* ================= 场景 T77：跳段默认锁定循环 + 开关同步 ================= */
section("T77 跳段 · 默认锁定循环 / 开关与字段同源");
{
  const { beat, els } = startArrange(three(), { from: 0, to: 2, loop: false });
  const S = beat.Store.S;
  beat.Controls.stop();

  eq(els["argJumpLoopBtn"].hidden, false, "★ 跳段行的「范围循环」开关常驻（不随单段而隐藏）");
  eq(checked(els), "false", "初始未循环 → 开关 off");

  /* 停止时跳段：基准 = 当前定位（from=0 → 段 0）→ 下一段 = 第 2 段 */
  els["argJumpNext"].fire("click");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([4, 7]),
     "★ 跳段把范围锁成单段（第 2 段 = 小节 4..7，v2.10.7 按小节存）");
  eq(S.arrangeSel.loop, true, "★ 且默认打开循环（反复磨这一段）");
  eq(checked(els), "true", "★ 开关随之同步为 on（refreshBar 一处收口）");
  ok(isOn(els), "视觉同步（class 切到 on，与 setToggle 语义同源）");

  /* 同一字段、两处入口：打开编排面板渲染后，面板那个「范围循环」也该是 on */
  beat.Arrange.open();
  eq(els["argLoopBtn"].getAttribute("aria-checked"), "true",
     "★ 编排面板的「范围循环」与跳段行开关同源（同一字段，无第二份真相）");
  beat.Arrange.close();
  beat.Controls.stop();
}

/* ================= 场景 T77b：解除锁定（单段 → 放行到曲末） ================= */
section("T77b 跳段 · 关掉开关 = 解除锁定，单段范围放开到曲末");
{
  const { beat, els } = startArrange(three(), { from: 0, to: 2, loop: false });
  const S = beat.Store.S;
  beat.Controls.stop();
  els["argJumpNext"].fire("click");                       // 锁到第 2 段
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([4, 7]), "前提：单段锁定（小节 4..7）");

  els["argJumpLoopBtn"].fire("click");
  eq(S.arrangeSel.loop, false, "★ 关掉 = 解除循环");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([4, 11]),
     "★ 单段范围放开到曲末（第 2 段 → 第 3 段 = 小节 4..11），继续往下播而不是原地再放一遍");
  eq(checked(els), "false", "开关回到 off");

  /* 再开回来：只恢复循环，范围不再收窄（用户可继续按起/终自行设范围） */
  els["argJumpLoopBtn"].fire("click");
  eq(S.arrangeSel.loop, true, "★ 再开 = 恢复循环");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([4, 11]),
     "范围不动（开循环不偷偷改用户设的范围）");
  beat.Controls.stop();
}

/* ================= 场景 T77c：多段范围只关循环、不动 from/to ================= */
section("T77c 跳段 · 多段范围关循环时不改起/终");
{
  const { beat, els } = startArrange(three(), { from: 0, to: 2, loop: true });
  const S = beat.Store.S;
  eq(checked(els), "true", "前提：整首范围 + 循环中 → 开关 on");

  els["argJumpLoopBtn"].fire("click");
  eq(S.arrangeSel.loop, false, "★ 关掉循环");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([0, 11]),
     "★ 多段范围原样保留（只关循环，不把整首听变成「从当前段到曲末」；全曲 = 小节 0..11）");
  beat.Controls.stop();
}

/* ================= 场景 T77d：面板开关 ↔ 跳段行开关双向同源 ================= */
section("T77d 跳段 · 面板「范围循环」改动也同步到跳段行开关");
{
  const { beat, els } = startArrange(three(), { from: 0, to: 2, loop: false });
  const S = beat.Store.S;
  beat.Arrange.open();
  els["argLoopBtn"].fire("click");                        // 面板里打开范围循环
  eq(S.arrangeSel.loop, true, "面板开关写入同一字段");
  eq(checked(els), "true", "★ 跳段行开关跟着亮（refreshBar 同源刷新，反向也通）");
  beat.Arrange.close();
  beat.Controls.stop();
}

/* ================= 场景 T77e：解除后真的能走出那一段（播放行为） ================= */
section("T77e 跳段 · 解除后从当前段播到曲末后停（不再无限循环该段）");
{
  /* 三段各 4 小节：240BPM → 每段 4s，整首 12s */
  const { beat, ac, els } = startArrange(three(), { from: 0, to: 0, loop: true });
  const S = beat.Store.S;

  /* 锁在第 1 段（from=to=0, loop=true）：走 4.3s——若真锁住，越段边界仍回到第 0 小节 */
  drive(ac, beat, 4.3);
  eq(beat.arrangeState().sec, 0, "★ 锁定中：走完第 1 段的 4 小节后回卷到第 1 段（不自进）");
  eq(S.playing, true, "锁定中是持续循环、不收尾");

  /* 解除：loop 置假、to 放开到曲末（第 3 段 = 小节 11） */
  els["argJumpLoopBtn"].fire("click");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([0, 11]), "解除后范围 = 第 1→3 段（小节 0..11）");

  const seen = new Set();
  const stopped = drive(ac, beat, 12.5, () => {
    if (S.playMode === "arrange" && S.playing) seen.add(beat.arrangeState().sec);
  });
  ok(stopped, "★ 播到曲末后自然停（drive 提前返回 = S.playing 已置假）");
  eq(S.playing, false, "★ 不再无限循环");
  ok(seen.has(1) && seen.has(2), "★ 确实走过了第 2、3 段（解除后继续往下播，不是原地打转）");
  ok((els["statusText"].textContent || "").includes("曲式播放完毕"), "★ 收尾状态栏给出「曲式播放完毕」");
  beat.Controls.stop();
}
