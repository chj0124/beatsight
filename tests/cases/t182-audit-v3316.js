/* BeatSight 自动化测试 · v3.31.6 落地批次（P1-A 试听游标 rAF 链 + B4 渲染循环死亡防线）
   ---------------------------------------------------------------------------
   依赖桩的 **opt-in rAF 队列**（loadApp 第二参 { rafQueue:true }）：
     · requestAnimationFrame 记录不执行、cancelAnimationFrame 按 id 摘除；
     · app.flushRaf() 手动冲刷一轮、app.rafPending() 数挂起数。
   ★ 反向验证锚点见各节注释：回退修复 → 具名断言变红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* ================= T182a：P1-A 试听游标 rAF 链不叠加 ================= */
section("T182a 歌词试听 · 换段重进 rAF 链恒为 1（此前链数 = 重进次数、帧率只降不升）");
{
  const app = loadApp({}, { rafQueue: true });
  const { beat } = app;
  ok(beat.Store.upsertArrange({ id: "a-pv", name: "双段", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
    { name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 2 }] },
  ] }), "两段曲式");
  const a = beat.Store.findArrange("a-pv");
  const sec0 = a.sections[0], sec1 = a.sections[1];
  /* 试听 A → 重进 B → 再回 A：三次重进后队列里应只有 paintFrame + 1 条游标链 */
  beat.Arrange.previewSection(a, 0, sec0, 0);
  beat.Arrange.previewSection(a, 1, sec1, 0);
  beat.Arrange.previewSection(a, 0, sec0, 0);
  /* 队列口径：boot 的双 rAF 占 1 条常驻（bootOuter），start() 注册 paintFrame 占 1 条，
     游标链恒为 1 条 → 稳定 3；无修复时每次重进旧链不取消、线性增长（3→4→5）。 */
  eq(app.rafPending(), 3, "★ 三次重进后挂起 3 条（boot 常驻 + paintFrame + 唯一游标链；此前链数随重进增长）");
  app.flushRaf();                                      // 冲刷一轮：各回调自续注册
  eq(app.rafPending(), 3, "★ 冲刷后仍恒 3（链恒为 1；此前每轮线性增长）");
  /* 停止：游标链摘除、paintFrame 被 stop 取消 → 只剩 boot 常驻 */
  beat.Arrange.previewStop();
  eq(app.rafPending(), 1, "★ 停止后只剩 boot 常驻（previewStop cancel 游标链 + stop cancel paintFrame）");
  /* 反向验证锚点：删掉 previewSection/previewStop 的 pvGen++/cancelAnimationFrame → 上面三条变红。 */
}

/* ================= T182b：B4 渲染循环死亡防线（真排帧能力恢复后可测） ================= */
section("T182b 渲染帧异常 · 异常被兜住且下一帧照常排上（渲染循环不死）");
{
  const app = loadApp({}, { rafQueue: true });
  const { beat, sandbox } = app;
  beat.Controls.start();                               // 注册 paintFrame 自续链（+ boot 常驻 1 条）
  eq(app.rafPending(), 2, "前提：boot 常驻 + paintFrame 已挂起");
  const statusEl = sandbox.document.getElementById("statusText");
  Object.defineProperty(statusEl, "textContent", {
    set(){ throw new Error("注入的渲染故障"); }, get(){ return ""; }, configurable: true,
  });
  app.flushRaf();                                      // 执行 bootOuter（挂 bootInner）+ paintFrame（体内异常）
  eq(beat.diag.frameErr, 1, "★ 帧内异常被兜住并计数（不是裸崩，flushRaf 也未被异常穿透）");
  eq(beat.Store.S.playing, false, "★ 异常按边界语义停播（onFrameError → stop，而非静默死亡或空转）");
  eq(app.rafPending(), 1, "★ 队列只剩 boot 常驻（stop 取消了刚续期的 paintFrame——停播即收链，不是死循环）");
  delete statusEl.textContent;                         // 摘掉注入 setter（stop 也要写 statusText）
  beat.Controls.stop();
  /* 本用例是既有设计（paintFrame 先续期后执行）的回归防线，无「回退变异」——设计本身即守卫。 */
}
