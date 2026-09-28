/* BeatSight 自动化测试 · 播放范围落盘去重（v2.61.0，审计 Q3）
   T130 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★★ 为什么要有这一组：审计 Q3 指出「预设区 onRangeInput」与「曲式侧栏 onPanelRange」两处
      「拖播放范围」入口各自内联写了同一组 S.arrangeSel 的 5 个字段（id/from/to/byLyric/loop），
      是复制粘贴债、语义易漂（历史上 v2.16.0 就因为其中一处漏写 loop 出了"有范围没循环"的坑）。
      v2.61.0 把这组写抽成唯一写入口 writeArrangeRange(a, f, t)，两处只调它。

   ★ 本组守两件事：
      T130a 去重契约（源级）：writeArrangeRange 仅定义一次；S.arrangeSel.from = f - 1 / to = t - 1
            这两行只出现在共享函数内（无第二处内联复制）；两个拖范围入口都调用了它。
            —— 这把"两个入口写出状态逐字段一致"钉死在源结构上：只要任一处又内联复制，
               行计数立刻从 1 变 2，测试红。
      T130b 行为（侧栏入口 onPanelRange 经共享函数写出正确状态）：1-based 读数转 0-based 线性下标、
            byLyric 复位、loop 恒开、以及"起点越过终点"的交叉对齐。
            预设区入口 onRangeInput 不挂 id、桩里无法按事件触发，但其"写出什么"已由 T130a 的
            源级契约保证与 onPanelRange 同源（同调 writeArrangeRange），故行为正确性落在 onPanelRange
            这条可驱动的路径上即可覆盖共享函数本身。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 读源码做"去重契约"断言；BEATSIGHT_HTML 指向被测构建时以它为准（与 run.js 同口径） */
const HTML_PATH = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");
const count = (s, sub) => s.split(sub).length - 1;

section("T130a 播放范围去重（审计 Q3）· 共享纯函数 writeArrangeRange 成为唯一写入口");
{
  eq(count(HTML, "function writeArrangeRange("), 1, "writeArrangeRange 仅定义一次");
  eq(count(HTML, "S.arrangeSel.from = f - 1;"), 1, "S.arrangeSel.from = f - 1 仅出现在共享函数内（无第二处内联复制）");
  eq(count(HTML, "S.arrangeSel.to = t - 1;"), 1, "S.arrangeSel.to = t - 1 仅出现在共享函数内");
  ok(count(HTML, "writeArrangeRange(a, f, t)") >= 2, "两个拖范围入口（onRangeInput / onPanelRange）都调用了 writeArrangeRange");
}

section("T130b 侧栏入口 onPanelRange 经共享函数写出正确状态（含越界交叉对齐）");
{
  // seedDemo:false → 不预置 demoSeeded 冷键 → 应用走"首次带出"分支，创建示例曲并选中
  // （loadApp 默认会置闩，导致示例曲不创建、arranges 为空、cur() 早退）
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  // seedDemo 默认带出示例曲并选中（curId = arranges[0].id），onPanelRange 不会早退
  const a = beat.Store.findArrange(beat.Store.S.arrangeSel.id) || beat.Store.arranges[0];
  ok(!!a, "存在当前曲式，onPanelRange 不会早退");
  // onPanelRange 用 cur()（编辑选中项 curId）取当前曲式；示例曲带出时 curId 尚未落，
  // 需显式 open 一次把它设为编辑选中项，否则 onPanelRange 会早退（行为同真实 UI 选曲式）
  beat.Arrange.open(a.id);
  const M = a ? a.sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + (b.repeats || 1), 0), 0) : 0;
  ok(M >= 5, "示例曲至少有 5 小节，便于设范围读数（实测 " + M + "）");

  // ① 起点 3、终点 5（1-based）→ from=2 / to=4（0-based 线性小节）
  els["argRangeFrom"].value = "3";
  els["argRangeTo"].value = "5";
  els["argRangeFrom"].fire("input", {});   // 触发 onPanelRange(true, false)
  eq(beat.Store.S.arrangeSel.from, 2, "① 起点 3 → from=2（0-based 线性小节）");
  eq(beat.Store.S.arrangeSel.to,   4, "① 终点 5 → to=4");
  eq(beat.Store.S.arrangeSel.id,   a.id, "① id 指向当前曲式");
  eq(beat.Store.S.arrangeSel.byLyric, false, "① 手动拖范围 = 普通区间语义（byLyric 复位）");
  eq(beat.Store.S.arrangeSel.loop, true, "① 拖出范围 = 范围循环恒开（loop 恒开）");

  // ② 越界交叉：起点设 5、终点设 3（isFrom=true）→ 终点被顶到起点 → from=to=4
  els["argRangeFrom"].value = "5";
  els["argRangeTo"].value   = "3";
  els["argRangeFrom"].fire("input", {});
  eq(beat.Store.S.arrangeSel.from, 4, "② 起点越界超过终点：终点被顶到起点（from=4）");
  eq(beat.Store.S.arrangeSel.to,   4, "② 交叉对齐后 to=4（与 onRangeInput 同口径，源级契约保证）");
}
