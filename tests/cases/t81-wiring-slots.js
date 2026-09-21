/* BeatSight 自动化测试 · 跨模块注入槽的装配与"未注入"行为（v2.8.6，审计 §A1）
   T81 系列。
   ---------------------------------------------------------------------------
   契约：跨模块注入槽（`let onXxx = null;` 的钩子、`let patLenOf = ...` 的型长查询）**必须被装配层
        接上**；没接上时，行为必须是**响亮失败**，而不是安静地退回一个"看起来合理"的默认值。

   为什么要有这一期（审计 §A1 的实测证据）：`patLenOf` 的默认实现原为 `() => DEF_BARS`，
   那是一句**恒 4 的静默谎言**——它与真实实现（按型实际小节数）语义完全不同，忘了注入不会崩，
   只会让段长悄悄退回「4 的倍数」（v2.5.1 前《在他乡》被从 30 小节垫成 44 小节正是这个口径的产物）。
   V8 覆盖率的「从未执行的函数」名单里就有它：**它在生产中恒被覆盖，却没有任何检查器保证这一点**。
   v2.8.6 把默认实现改为显式抛错，并新增 tools/check-wiring.js 静态守住"装没装"。

   这一期钉住的是**运行时那一半**（静态那一半由 tools/check-wiring.js 负责，见 §5）：
   本用例先证明"正常装配下段长是对的"，再摘掉注入，要求它抛错——两个方向都断言，
   否则"改成抛错"这件事本身可能悄悄退回旧行为而无人发现。

   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

section("T81 注入槽 · 钩子必须真被接上，patLenOf 未注入必须抛错（v2.8.6，审计 A1）");
{
  const app = loadApp();
  const beat = app.beat;

  /* ---- 1) 正常装配：段长按型实际小节数走（注入实现生效）----
     ref 取一个不存在的名字，走的是 `resolveRef → null → patBars(null) → DEF_BARS` 这条口径，
     即"老数据引用了不存在的型"那个真实场景——它由**注入的真实实现**兜，与默认值无关。 */
  eq(beat.secBars({ blocks: [{ ref: "__没有这个型__", repeats: 2 }] }), 8,
    "正常装配：段长 = 2 遍 × 4 小节（注入实现生效，默认值不参与）");
  eq(beat.secBars({ blocks: [{ ref: "__没有这个型__", repeats: 3 }] }), 12,
    "同一个口径：3 遍 × 4 小节");

  /* ---- 2) 摘掉注入：必须抛错，而不是安静地返回 4 的倍数 ---- */
  beat.setPatLenOf(null);
  let threwNull = "";
  try { beat.secBars({ blocks: [{ ref: "__没有这个型__", repeats: 2 }] }); }
  catch (e){ threwNull = String((e && e.message) || e); }
  ok(/patLenOf 未注入/.test(threwNull),
    "★ 未注入时段长查询**抛错**（旧实现会安静返回 8：段长静默错位、无人察觉）；实际收到 "
    + JSON.stringify(threwNull));

  /* ---- 3) 传非函数：走同一条"响亮失败"路径（setPatLenOf 的守卫不再退回假值）---- */
  beat.setPatLenOf(/** @type {any} */ (123));
  let threwDirty = "";
  try { beat.secBars({ blocks: [{ ref: "__没有这个型__", repeats: 1 }] }); }
  catch (e){ threwDirty = String((e && e.message) || e); }
  ok(/patLenOf 未注入/.test(threwDirty),
    "★ 传入非函数时同样抛错（守卫不再退回 DEF_BARS）；实际收到 " + JSON.stringify(threwDirty));

  /* ---- 4) 重新注入后恢复可用：证明这条抛错不是"死结"（否则生产路径一旦摘掉就再也回不来）---- */
  beat.setPatLenOf(ref => beat.patBars(beat.resolveRef(ref)));
  eq(beat.secBars({ blocks: [{ ref: "__没有这个型__", repeats: 3 }] }), 12,
    "重新注入真实实现后恢复（3 遍 × 4 小节）");

  /* ---- 5) 钩子侧的可观测抽查：onQuotaDone 是唯一"会被显式摘掉"的钩子 ----
     其余 10 个钩子的"是否被赋值"由 tools/check-wiring.js 静态保证（名单自动收列、不会腐烂），
     这里只查这一个**有对外读数**的，避免在测试里再维护一份会腐烂的钩子名单。 */
  ok(typeof beat.quota().hasDone === "boolean",
    "钩子读数可用：quota().hasDone 是布尔（onQuotaDone 的装配状态经此可观测）");
}
