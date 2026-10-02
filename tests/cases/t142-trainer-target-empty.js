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
  /* ★ v3.3.1（用户拍板的方案甲）：目标搬进参数槽后，弹窗拒开会**死锁**（点开关没反应、
     又看不到目标框）。改为"把槽打开 + 焦点送进目标框 + 就地写原因"，故这里三条一起钉：
     ① 不再弹窗；② 槽（#trainerPanel）被打开；③ 原因写在 #trainerProg 那一行。 */
  ok(els["modalMask"].hidden === true, "★★ 不再弹窗拒开（v3.3.1 改口径；弹窗会让「目标在槽里」变成死锁）");
  eq(els["trainerPanel"].hidden, false, "★★ 改为把参数槽打开——目标框摆到眼前");
  ok(/目标 BPM|先填/.test(els["trainerProg"].textContent), "★ 原因就地写在进度行（不靠弹窗）",
    "实际：" + els["trainerProg"].textContent);
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
