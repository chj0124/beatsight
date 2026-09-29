/* BeatSight 自动化测试 · 开练面板填充条 = 拇指中心口径（v2.82.0）
   T147 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html 共享区 rangeFillStyle / Arrange.syncPanelRead 注释同源）：

     · 为什么改：旧口径（left = f/n、width = (t−f+1)/n，"小节格子"百分比）与原生 range
       拇指的映射不同基——拇指中心落在 **(W − tW) 的内缩轨道**上（tW = 拇指宽）。
       30 小节曲子取段 3（5–8）时，绿条右端凸出拇指 ~22px、左端露 ~3px（用户实测
       "绿色细条凸出一截"，像素取证 2026-09-30）；侧栏示例曲滑块另有第三套口径
       （值占比、无 px 校正）。v2.82.0 三处收敛为 rangeFillStyle 一处事实源。
     · 新口径：绿条两端 = 两个拇指的**中心**——style 是 calc 字符串
       「calc(P% + K * var(--thumb-w))」，P = 值占比 ×100（与拇指同基），
       K = 内缩补偿系数（左端 0.5−p₀、宽度 −span）；px 项经 var(--thumb-w) 在 CSS 落地
       （16px / 窄屏 22px 随档位自动跟随），桩只断系数。
     · n ≤ 1（整首只有一小节）没有映射可言 → 整条填充（0% / 100%）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const fe = els => els["argRangeFrom"];
const te = els => els["argRangeTo"];
const fill = els => els["argRangeFill"];

/* 三段各 1 小节的曲式（builtin idx 0 是 4 小节的型，凑不出 3 小节 → 用自定义 1 小节型） */
function setup3(){
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "一小节", meter: 4, bars: [[{ t: 192 }]] },
  ] })).ok, "1 小节型导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "三小节", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "C", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  return { beat, els };
}

/* ============ 场景 T147a：段范围 → 端点 = 拇指中心 ============ */
section("T147a 面板填充条 · calc 两件套（百分比 + 内缩补偿）/ 拖动中实时跟随");
{
  const { beat, els } = setup3();
  fe(els).value = "2"; fe(els).fire("input");            // 只动起点（input = 拖动中，不落库重渲染）
  te(els).value = "3"; te(els).fire("input");
  /* n=3：v0=2 → p0 = 1/2；v1=3 → p1 = 1（n−1 = 2 个间隔） */
  eq(fill(els).style.left, "calc(50.0000% + 0.0000 * var(--thumb-w))",
     "★ 左端 = 起点 thumb 中心（p₀=1/2 → 补偿系数恰为 0：中点的内缩轨道与全宽重合）");
  eq(fill(els).style.width, "calc(50.0000% + -0.5000 * var(--thumb-w))",
     "★ 宽度 = 终点中心 − 起点中心（span=1/2，px 项 −0.5 拇指宽）");

  te(els).value = "2"; te(els).fire("input");            // 重合 → 零跨度
  eq(fill(els).style.width, "calc(0.0000% + 0.0000 * var(--thumb-w))", "重合 = 零跨度（不为负；−0 归一为 0）");
  beat.Arrange.close();
}

/* ============ 场景 T147b：整首 → 全轨（含 px 补偿的满条） ============ */
section("T147b 整首 · 左端 = +半拇指 / 宽度 = 100% − 1 拇指（两端都收回拇指中心）");
{
  const { beat, els } = setup3();
  beat.Arrange.allRange ? beat.Arrange.allRange() : els["argAllRange"].fire("click");
  eq(fill(els).style.left, "calc(0.0000% + 0.5000 * var(--thumb-w))",
     "★ 左端 = +半拇指（拇指中心缩进 8px，绿条从拇指中心起，不再探到拇指左边）");
  eq(fill(els).style.width, "calc(100.0000% + -1.0000 * var(--thumb-w))",
     "★ 宽度 = 100% − 1 拇指（右端同样收回到拇指中心——旧口径在这里凸出得最狠）");
  beat.Arrange.close();
}

/* ============ 场景 T147c：n=1（整首一小节）→ 整条填充（除零守卫） ============ */
section("T147c 单小节曲式 · 无映射可言 → 0% / 100%");
{
  /* builtin idx 0 是 4 小节的型——要凑 songBars=1 得用自定义 1 小节型 */
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "一小节", meter: 4, bars: [[{ t: 192 }]] },
  ] })).ok, "1 小节型导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "单小节曲", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  eq(fe(els).getAttribute("max"), "1", "前提：总小节 1（滑块 max=1）");
  fe(els).value = "1"; fe(els).fire("input");
  eq(fill(els).style.left, "0%", "★ n≤1 → 左端 0%（rangeFillStyle 的除零守卫）");
  eq(fill(els).style.width, "100%", "★ n≤1 → 整条填充");
  beat.Arrange.close();
}
