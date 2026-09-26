/* BeatSight 自动化测试 · S2 开练面板（v2.31.0）：歌曲地图 + 双滑块 + 练这段 + 起/终退役
   T107 系列（PLAN-v4 S2）。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html renderPanel / syncPanelRead / onPanelRange 的注释同源）：
     · 开练面板 #argPanel 是编排卡片右栏的静态区（窄屏 ≤640px 变底部固定条，CSS 文本级断言）；
     · 歌曲地图：每段一粒 .arg-map-seg，flexGrow = 段小节数（比例断言盯内联 style），
       范围覆盖的段带 .in-range；点某段 = setRange(段起止)（loop 恒开）；
     · 双滑块：min/max = 小节刻度 1..TB（与侧栏同口径），input 只写 S + 视觉，
       change 提交才跑 setRange；起点越过终点 → 对方被顶走（双向归一，clampLoop 同口径）；
     · 段行「起 / 终」退役：ops = [▶, ⋯]，范围入口收敛为 地图/滑块 + ⋯「练这段」。
   断言口径变更说明（对 t54e/f）：这不是回归，是"两颗钮分设 from/to"收敛为
   "一键整段范围 + loop 恒开"的结构性重排；精确范围由本组的滑块用例接守。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 三段各 4 小节（共 12 小节，小节 0..11） */
const seed3 = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t107", name: "三段歌", sections: [
    { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
    { uid: "uB", name: "B段", blocks: [BL(1, 1)] },
    { uid: "uC", name: "C段", blocks: [BL(1, 1)] },
  ] },
]}) });
const rows = els => els["argSections"].children;
const moreBtn = (els, i) => Array.prototype.find.call(rows(els)[i].children[3].children,
  b => /更多段操作/.test(b.getAttribute("aria-label") || ""));
const menuOf = (els, i) => Array.prototype.find.call(rows(els)[i].children,
  c => /(^| )arg-sec-menu( |$)/.test(c.className));
const menuItem = (menu, re) => menu && Array.prototype.find.call(menu.children,
  b => re.test(b.getAttribute("aria-label") || ""));

/* ================= 场景 T107a：面板结构 + 歌曲地图 ================= */
section("T107a 开练面板 · 静态区齐套 / 地图比例与高亮 / 点段 = 练这段");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  /* 面板齐套：地图 / 双滑块 / 读数 / 循环 / 全部 / 两个播放钮 / 问题提示 */
  ok(!!els["argMap"] && !!els["argRangeFrom"] && !!els["argRangeTo"] && !!els["argRangeRead"],
    "★ 面板静态区齐套（地图 + 双滑块 + 读数）");
  ok(!!els["argLoopBtn"] && !!els["argAllRange"] && !!els["argPlay"] && !!els["argPlayRange"] && !!els["argProblems"],
    "★ 循环 / 全部 / 两个播放钮 / 问题提示都在面板里");
  ok(!els["argRangeRow"], "★ 旧「播放范围」行已退役（argRangeRow 不在标记里）");

  /* 地图：段数一致，flexGrow 比例 = 段小节数（桩无 getBoundingClientRect，盯内联值） */
  const segs = Array.prototype.filter.call(els["argMap"].children,
    c => /(^| )arg-map-seg( |$)/.test(c.className));
  eq(segs.length, 3, "地图段数 = 段数");
  eq(segs.map(s => s.style.flexGrow).join(","), "4,4,4", "★ 每段 flexGrow = 段小节数（等比分宽）");

  /* 初始 arrangeSel = [0,0]（两 thumb 重合在第 1 小节）→ 只有第 1 段高亮 */
  eq(segs[0].classList.contains("in-range"), true, "初始范围在第 1 小节 → 第 1 段高亮");
  eq(segs[1].classList.contains("in-range"), false, "第 2 段未覆盖（无高亮）");

  /* 点第 2 段 = 练这段（setRange(4,7)，loop 恒开） */
  segs[1].fire("click");
  const sel = beat.Store.S.arrangeSel;
  eq(JSON.stringify([sel.from, sel.to]), "[4,7]", "★ 点地图第 2 段 → 范围 = 小节 4..7");
  eq(sel.loop, true, "范围循环恒开（点段 = 只循环练这一段）");
  eq(beat.Store.S.playMode, "arrange", "进入曲式模式（setRange 同一出口）");
  beat.Arrange.close();
}

/* ================= 场景 T107b：双滑块 · 两级处理 / 双向归一 / 读数同步 ================= */
section("T107b 双滑块 · input 只写 S / change 提交 / 越过顶走 / 读数与高亮跟随");
{
  const { beat, els } = loadApp(seed3());
  const S = beat.Store.S;
  beat.Arrange.open();
  const fe = els["argRangeFrom"], te = els["argRangeTo"];
  eq(fe.max, "12", "★ 滑块刻度 = 小节数（1..12，与侧栏同口径）");

  /* input（拖动中）：只写 S 与视觉，不切模式（重活在 change）。
     初始 arrangeSel = [0,0]（两 thumb 重合在第 1 小节）：from 拖到 5 → 越过 to → to 被顶走 */
  fe.value = "5"; fe.fire("input");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), "[4,4]",
    "★ input 阶段 from/to 已落 S；from 越过 to → to 被顶到 from（0 基 4）");
  eq(S.playMode, "preset", "★ 拖动途中不切曲式模式（重活只在提交那步）");

  /* change（提交）：setRange 全链路（模式 / persist / 主界面反馈） */
  fe.fire("change");
  eq(S.playMode, "arrange", "★ 提交才进曲式模式（与侧栏同一口径）");

  /* 起点越过终点 → 对方被顶走（双向归一，不是各自钳出空区间）：
     to 拖到 3（小于 from=5）→ from 被拉到 3，两个 thumb 重合 = 只练这 1 小节 */
  te.value = "3"; te.fire("input");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), "[2,2]", "★ to 越过 from → from 被拉到 to（重合 = 只练这 1 小节）");
  te.fire("change");

  /* 读数与填充条跟随：再把 to 拖回 12 → 范围小节 3..12（0 基 2..11） */
  te.value = "12"; te.fire("input"); te.fire("change");
  ok(/第 3–12 小节 · 第 1 → 3 段/.test(els["argRangeRead"].textContent || ""),
    "★ 读数翻译成小节 + 段（songBarAt 反解）");
  ok((els["argRangeFill"].style.width || "").includes("83.3"), "★ 填充条宽度 = 范围占比（10/12）");

  /* 「全部」回整首 */
  els["argAllRange"].fire("click");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), "[0,11]", "「全部」= 整首");
  beat.Arrange.close();

  /* 脏值兜底：非数字输入按 1 处理（与侧栏同款 clamp，不产生 NaN） */
  const app2 = loadApp(seed3());
  app2.beat.Arrange.open();
  const f2 = app2.els["argRangeFrom"];
  f2.value = "abc"; f2.fire("input"); f2.fire("change");
  ok(Number.isFinite(app2.beat.Store.S.arrangeSel.from), "★ 脏值 → clamp 兜底（不落 NaN 进 arrangeSel）");
  app2.beat.Arrange.close();
}

/* ================= 场景 T107c：起/终退役 + 地图高亮随 ⋯「练这段」联动 ================= */
section("T107c 起/终退役 · 练这段写范围 · 地图高亮跟随");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  /* 段行上不再有起/终（ops = [▶, ⋯] 两颗，aria 里再无「设为播放起点/终点」） */
  const opArias = Array.prototype.map.call(rows(els)[0].children[3].children,
    b => b.getAttribute("aria-label") || "");
  ok(!opArias.some(a => /设为播放起点|设为播放终点/.test(a)), "★ 段行起/终已退役（D1 落地）");

  /* ⋯「练这段」→ 范围 + 地图高亮联动（第 2 段 in-range、1/3 段不在） */
  moreBtn(els, 1).fire("click");
  menuItem(menuOf(els, 1), /只练第 2 段/).fire("click");
  const segs = Array.prototype.filter.call(els["argMap"].children,
    c => /(^| )arg-map-seg( |$)/.test(c.className));
  eq(segs[0].classList.contains("in-range"), false, "第 1 段不在范围内（无高亮）");
  eq(segs[1].classList.contains("in-range"), true, "★ 第 2 段高亮（范围 = 4..7）");
  eq(segs[2].classList.contains("in-range"), false, "第 3 段不在范围内");
  beat.Arrange.close();
}

/* ================= 场景 T107d：布局 CSS 契约（源码文本级，同 t101 口径） ================= */
section("T107d 布局 · v2.35.0 顶部走带条吸顶 / 640 底部固定条 / 双栏 grid 已删除");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  ok(src.includes(".arg-transport{position:sticky;top:12px"),
    "★ v2.35.0：「开练」是顶部全宽走带条（sticky 吸顶，替代 320px 右栏——地图不再被压扁）");
  ok(!src.includes(".arg-work{display:grid"), "★ 双栏 grid 已随右栏布局一并删除");
  ok(src.includes(".arg-transport{position:fixed;top:auto;left:0;right:0;bottom:0"),
    "★ ≤640px：走带条变底部固定条（top:auto 显式复位——sticky 的 top 跟进来的话 fixed+top+bottom 会拉满整屏）");
  ok(src.includes(".arg-transport .arg-map{display:none}"),
    "底条隐藏地图行（窄行放不下 10 段）");
  ok(src.includes("calc(10px + env(safe-area-inset-bottom,0px)"),
    "底条带 safe-area 内边距（全面屏不被手势条压住）");
}
