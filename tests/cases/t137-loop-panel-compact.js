/* BeatSight 自动化测试 · 循环本段行精简（v2.69.0，2.6）
   T137 系列。
   ---------------------------------------------------------------------------
   用户要求（2.6 + 截图）：循环本段**关闭**时，「第 X 到 Y 小节」选择器整段与
   「只反复磨这几小节」注脚不该占位；**打开**时只留「第 X 到 Y 小节」单行紧凑，
   「循环本段」与上方卡片文案左缘对齐。

   机理与契约（复核确认，见批 A 假设复核）：
     · 面板仅存在于预设模式；曲式模式下整面板本就 hidden（t65/t68 已钉）——改它不影响曲式。
     · 下拉在开关关闭时本就 disabled（"选区间即开循环"入口在关闭态不可达）
       ⇒ 关时隐藏零功能损失。原设计「关时灰掉不藏起（位置稳定）」由用户拍板推翻，
       syncLoopUI 的既定设计注释已同步改写（不留自相矛盾的说明）。
     · 灰度注脚 .loop-desc 整体删除：元素 + CSS 规则都不存在（孤儿规则守门在 check-orphan-css）。
     · loopHint 保留：它承担「正在循环第 X-Y 小节（共 Z 小节）」的读数，与行内不重复。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const isHidden = el => el.hidden === true;

/* ================= 场景 T137a：关闭态 ⇒ 范围段与分隔点隐藏、注脚不存在 ================= */
section("T137a 循环本段 · 关闭态收干净（用户拍板：藏而非灰）");
{
  const { els } = loadApp();
  ok(els["loopPanel"].hidden === false, "前提：预设模式下面板可见");
  ok(isHidden(els["loopRange"]), "★ 关闭时「第 X 到 Y 小节」整段 hidden");
  ok(isHidden(els["loopSep"]), "分隔点同步隐藏");
  ok(html.indexOf("loop-desc") === -1,
    "★ 灰度注脚 .loop-desc 已连根删除（标记 + CSS 均无残留）");
  ok(els["loopFrom"].disabled === true, "关闭时下拉仍 disabled（兜底，防隐藏期间误触发）");
  ok(els["loopToggle"].getAttribute("aria-checked") === "false", "开关语义不变（aria-checked=false）");
}

/* ================= 场景 T137b：开启态 ⇒ 范围段现身、单行紧凑 ================= */
section("T137b 循环本段 · 开启态只留「第 X 到 Y 小节」");
{
  const { beat, els } = loadApp();
  els["loopToggle"].fire("click");            // → 开（一键整段）
  const rng = els["loopRange"], sep = els["loopSep"];
  ok(!isHidden(rng), "★ 开启时「第 X 到 Y 小节」现身");
  ok(!isHidden(sep), "分隔点同步现身（单行：循环本段 · 第 X 到 Y 小节）");
  ok(els["loopFrom"].disabled === false && els["loopTo"].disabled === false, "下拉恢复可用");
  eq(els["loopToggle"].getAttribute("aria-checked"), "true", "开关语义同步（单一渲染入口）");
  ok(!!els["loopHint"], "loopHint 保留（承担「正在循环第 X-Y 小节（共 Z 小节）」读数）");
}

/* ================= 场景 T137c：往返可逆 + 注释同步（不留自相矛盾的说明） ================= */
section("T137c 循环本段 · 开关往返显隐可逆；syncLoopUI 注释已随行为改写");
{
  const { els } = loadApp();
  els["loopToggle"].fire("click");
  ok(!isHidden(els["loopRange"]), "开 → 现身");
  els["loopToggle"].fire("click");
  ok(isHidden(els["loopRange"]), "★ 关 → 再隐藏（往返可逆）");
  /* 既定设计更改留痕：syncLoopUI 里不许再残留「灰掉而不是藏起来」的旧口径注释 */
  ok(html.indexOf("灰掉而不是藏起来") === -1,
    "★ syncLoopUI 的旧设计注释已改写（行为与说明不矛盾）");
  ok(/\.loop-panel \.toggle-pill\{padding-left:0\}/.test(html),
    "★ 「循环本段」与卡片文案左缘对齐（面板作用域内归零内缩，照 .viz-toggles 先例）");
}
