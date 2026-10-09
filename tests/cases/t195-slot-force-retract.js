/* BeatSight 自动化测试 · 变速训练参数槽的"一次性提示"必须能收回（v3.33.10 用户实拍缺陷）
   T195
   ─────────────────────────────────────────────────────────────────────────────
   【复现】BPM == 目标 → 点变速训练：开关不开（闸门拒绝、就地给原因），参数槽展开；
     此后槽**再也不自动收回**——占槽记账只在 on[k] 变真时清空（syncParamSlots 内那条），
     被拒时 on[k] 永远为假 ⇒ 记账永远挂着。
   【修法】把"原因"当一次性提示：改目标 / 改 BPM / 卡片内点别处 任一发生即撤（clearSlotForce）。
   【本用例范围】前两条驱动路径在桩里可驱动（trTarget / bpmSlider）；第三条（卡片内点击）
     需要事件冒泡 + querySelector，桩不具备 ⇒ 只钉源码（T195d），几何/行为在浏览器冒烟里验。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const arm = () => {
  const app = loadApp();
  app.beat.Store.S.bpm = 120;                  // BPM == 目标 ⇒ 闸门拒绝
  app.beat.Store.S.trainer.target = 120;
  app.els["trainerToggle"].fire("click");
  return app;
};

section("T195a 复现：BPM==目标 → 开关被拒但槽展开给原因（前提行为不变）");
{
  const app = arm();
  eq(app.beat.Store.S.trainer.on, false, "前提：开关没被打开（闸门拒绝）");
  eq(app.els["trainerPanel"].hidden, false, "前提：参数槽被占槽记账打开（就地给原因）");
  ok(/已不低于目标/.test(app.els["trainerProg"].textContent), "原因写在进度行里");
  ok(/\bwarn\b/.test(app.els["trainerProg"].className), "同时挂上注意态 .warn");
}

section("T195b 改目标 ⇒ 槽必须收回（缺陷：此前永不收回）");
{
  const app = arm();
  app.els["trTarget"].fire("change");
  eq(app.els["trainerPanel"].hidden, true, "★★ 改目标后参数槽收回");
  /* ★ v3.41.0（用户纠正 · 撤回 G4）：读数行随变速训练生死——撤掉原因后回到**空串** */
  eq(app.els["trainerProg"].textContent, "", "★★ 原因文案撤掉、读数行回到空（撤回 G4）");
  ok(!/\bwarn\b/.test(app.els["trainerProg"].className), "★★ 注意态一并摘除");
}

section("T195c 改 BPM ⇒ 槽必须收回");
{
  const app = arm();
  app.els["bpmSlider"].fire("input");
  eq(app.els["trainerPanel"].hidden, true, "★★ 拖 BPM 滑杆后参数槽收回");
}

section("T195d 源码钉：三处清空点齐备，且卡片点击是委托监听（排除开关与原因区）");
{
  ok(/function clearSlotForce\(\)\{/.test(html) && /paramSlotForce = "";/.test(html),
    "★★ clearSlotForce 在位（清记账 + 撤文案 + 摘注意态 + 重算槽位）");
  ok(/tg\.addEventListener\("change", clearSlotForce\)/.test(html) && /tg\.addEventListener\("input", clearSlotForce\)/.test(html),
    "★★ 清空点①：目标框 change/input");
  ok(/bs\.addEventListener\("input", clearSlotForce\)/.test(html) && /bn\.addEventListener\("change", clearSlotForce\)/.test(html),
    "★★ 清空点②：BPM 滑杆/数字");
  ok(/card\.addEventListener\("click", e => \{/.test(html)
     && /closest\("#trainerToggle, #trainerPanel, #trainerFlyout, #trainerProg"\)/.test(html),
    "★★ 清空点③：卡片内委托点击（开关本身与原因区被排除，点开关仍能刷新原因）");
  /* ★★ 回归钉：委托监听里若用 evEl(e)（= currentTarget = 卡片本身），
     "是不是点在开关上"永远判不出来 ⇒ 点开关打开的原因会被当场撤掉（v3.33.10 实拍）。 */
  ok(!/const t = evEl\(e\)/.test(html) && /const t = \/\*\* @type \{Element\|null\} \*\/ \(e\.target\)/.test(html),
    "★★ 卡片委托监听必须取 e.target，不得复用 evEl(e)（currentTarget 假阴性）");
}
