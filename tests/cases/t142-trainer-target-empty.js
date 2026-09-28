/* BeatSight 自动化测试 · 变速训练目标留空（v2.73.0，2.3）
   T142 系列。
   ---------------------------------------------------------------------------
   用户要求（2.3）：变速训练的目标允许**留空**（只想循环、不想爬到某个数）。
   语义：target = null（默认）；开开关时空目标拒开并指路参数行；输入期非法/低于
   当前 BPM 拒收不落盘。不变式：S.trainer.on === true ⇒ target 非空（两道闸保证）。
   （默认值 / 输入钳制 / 拒收回退的基础断言在 t01，本组只补 trainer 行为面。） */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* ================= 场景 T142a：空目标不给开（弹窗指路参数行） ================= */
section("T142a 空目标 · 开开关 → 拒开 + 弹窗");
{
  const { beat, els } = loadApp();                     // 默认 target = null
  eq(beat.Store.S.trainer.target, null, "前提：默认 target = null");
  els["trainerToggle"].fire("click");
  eq(beat.Store.S.trainer.on, false, "★ 空目标 ⇒ 开关拒开（on 仍 false）");
  ok(els["modalMask"].hidden === false, "★ 弹窗出现（指路右侧参数行）");
  els["modalOk"].fire("click");
}

/* ================= 场景 T142b：设合法目标 → 能开；爬坡到点自动停 ================= */
section("T142b 合法目标 · 开关正常开启（不变式成立）");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  S.bpm = 60; S.trainer.target = 100; S.trainer.step = 20;
  els["trainerToggle"].fire("click");
  eq(S.trainer.on, true, "★ 合法目标（100 > 60）→ 开关正常开启");
  ok(els["modalMask"].hidden === true, "无弹窗");
  els["trainerToggle"].fire("click");
  eq(S.trainer.on, false, "关闭永远允许（不会被锁在训练里）");
}

/* ================= 场景 T142c：老存档有值原样保留（零迁移） ================= */
section("T142c 老存档 · target 数值原样保留（默认值只对缺失/脏值生效）");
{
  const app = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, target: 140, step: 5, everyN: 2 } }) });
  const t = app.beat.Store.S.trainer;
  eq(t.target, 140, "★ 老存档 target = 140 原样保留（不被 null 覆盖）");
  eq(t.step, 5, "step 同样原样");
}
