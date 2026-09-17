/* BeatSight 自动化测试 · 2026-09-17 全维度审计「P0 批次」的回归用例（T58–T58e）
   ---------------------------------------------------------------------------
   这批修的几件事有个共同点：**不发作时看不出来**。所以每个用例都要把"修之前会怎样"钉住，
   否则日后有人把防线改回去，闸门（覆盖率 97%/90% 阈值）照样是绿的。

     T58  · P0-1  localStorage 整体抛错时仍能加载 —— 修之前是整页白屏（Store IIFE 求值即失败）
     T58b · P0-2  加载期脏值只判"是不是数字"就放行 —— step:0 会让爬坡既不升速也永不自动停
     T58c · P0-2  组合约束：目标不得 ≤ 起始（否则训练一开就判"完成"）
     T58d · P0-7  步长不整除时的总级数 —— Math.round 会低估一级，于是永远卡在次高档
     T58e · P0-8  #bpmNum 是真按钮（键盘可达）、#viz 对读屏隐藏

   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   注意 T58b/T58c 的预置数据用的是**热键 beatsight.state**（v1.3.0 冷热分离后的主键），
   用旧键 beatsight.m2 也能测，但那是迁移路径，不是这里的靶子。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

/* ================= 场景 T58：localStorage 整体不可用 ================= */
section("T58 P0-1 · getItem 一律抛错（沙盒 iframe / 站点数据被禁用）仍能加载");
{
  /* 桩的 throwOnRead 就是这个场景：容器策略让每一次 getItem 都抛 SecurityError。
     修之前：Store 模块开头那行裸调 getItem 让 IIFE 在**求值期**抛出 → `const S = Store.S` 拿不到 →
     整个内联脚本从那一行起就没能跑完（等价于整页白屏）。这也是"本地双击能用、
     嵌在别人的页面/沙盒里就白屏"这类报障的根因。
     ⚠ 这里必须自己接住异常：不接的话用例会以未捕获异常中断整个套件，
       把"这一条没通过"变成"后面全都没跑"，根因反而被淹没（变异验证时实测过）。 */
  let beat = null, loadErr = null;
  try {
    beat = loadApp({ "beatsight.state": JSON.stringify({ v:3, bpm: 100 }) }, { throwOnRead: true }).beat;
  } catch(e){
    loadErr = e;
  }
  ok(!!beat, "读盘全部抛错时应用仍能加载（S 及后续 16 个模块都装配成功）"
    + (loadErr ? `——实际在求值期抛出了 ${loadErr.message}，即整页白屏` : ""));
  if (beat){
    const S = beat.Store.S;
    eq(S.bpm, 96, "读盘全部失败时 BPM 回落到默认 96（而不是白屏）");
    eq(S.sig, 4, "拍号回默认 4");
    eq(S.trainer.start, 70, "trainer 回默认值");
    ok(!!beat.Viz && !!beat.Audio && !!beat.Controls && !!beat.Trainer,
      "S 之后的模块全部可用（说明 Store 没有在求值期抛出）");
  }
}

/* ================= 场景 T58b：训练器脏值的「域」钳制 ================= */
section("T58b P0-2 · 加载期脏值补域钳制（step/everyN/start/target/bpm）");
{
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v:3, bpm: 0,
    trainer: { on: true, start: 900, target: 5, step: 0, everyN: 0 } }) });
  const S = beat.Store.S, t = S.trainer;
  eq(t.step, 1, "step:0 → 钳到下限 1（否则 total() 变 Infinity，爬坡永不升速也永不停）");
  eq(t.everyN, 1, "everyN:0 → 钳到下限 1（否则每级小节数判定失效）");
  eq(t.start, 236, "start:900 → 钳到上限 236");
  eq(t.target, 237, "target:5 被抬回「起始 +1」（与 UI 侧 bindTrParam 同一规则）");
  eq(S.bpm, 30, "bpm:0 → 钳到下限 30（纵深防御：装配层的 setBpm 也会钳一次）");
}

/* ================= 场景 T58c：目标 ≤ 起始的组合约束 ================= */
section("T58c P0-2 · 目标不高于起始时抬回 起始+1");
{
  /* 只钳各自的值不够：合法 start=100 + 合法 target=40 交叉后，bpmFor(0) = min(40,100) = 40，
     而 40 >= target(40) 成立 —— 训练一开就被判「练到目标」立刻停。 */
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v:3, trainer: { start: 100, target: 40 } }) });
  eq(beat.Store.S.trainer.target, 101, "target:40 抬回 101（起始 100 + 1）");
}

/* ================= 场景 T58d：步长不整除时的总级数（P0-7 的核心回归） ================= */
section("T58d P0-7 · 步长不整除时也要练到目标（70→100 步长 7）");
{
  /* 原式 Math.round((target-start)/step)+1：round(30/7)=round(4.29)=4 → 总级数 5 → 最高级
     bpmFor(4)=min(100,98)=98，而 onBarBoundary 用 bpmFor(idx) >= target 判完成 →
     98 >= 100 永不成立，trStepIdx 被 Math.min 钉死在 4：每 everyN 小节重复设 98 BPM，
     既不升速也永不自动停。改用 ceil 后总级数 6、末级正好落在 100。 */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({
    trainer: { on: true, start: 70, target: 100, step: 7, everyN: 1 } }) });
  const S = beat.Store.S;
  eq(beat.Trainer.total(), 6, "总级数 6（round 会算成 5，少一级就永远够不到目标）");
  eq(beat.Trainer.bpmFor(beat.Trainer.total() - 1), 100, "末级正好等于目标 100（不再停在 98）");

  beat.Controls.start();
  eq(S.bpm, 70, "从起始 70 起步");
  const ac = FakeAudioContext.last;
  const stopped = drive(ac, beat, 60);
  ok(stopped, "练到目标后自动停止（修之前会一直停不下来）");
  eq(S.bpm, 100, "停止时速度就是目标 100");
  /* statusText 是**按需创建**的桩元素（`$("statusText")` 被调用过才存在）。卡死的版本里
     永远不会走到"完成"分支，于是它压根没被创建——直接读 textContent 会 TypeError 把整个套件
     打断（变异验证时实测）。这里显式带上"没走到完成分支"这个读数，既是断言也是诊断。 */
  eq(els["statusText"] ? els["statusText"].textContent : "(未走到完成分支，statusText 从未被赋值)",
    "训练完成 · 达到 100 BPM", "完成提示文案");
}

/* ================= 场景 T58e：两处无障碍（P0-8） ================= */
section("T58e P0-8 · BPM 大数字是按钮、可视化网格对读屏隐藏");
{
  const { els } = loadApp();
  eq(els["bpmNum"].tagName, "BUTTON", "#bpmNum 是真按钮（Tab 可达 / 读屏能报 / Enter-Space 可用）");
  ok(!!els["viz"] && els["viz"].getAttribute("aria-hidden") === "true",
    "#viz 带 aria-hidden（格子里每格一个文本节点，播放时约 360 个，不该淹没读屏）");
}
