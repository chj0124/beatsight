/* BeatSight 自动化测试 · 歌词轨裁剪盒高（v3.33.5 回归）
   T189 —— 「最下面那条跑道的歌词整行落在裁剪盒外」的回归（滚动模式独有）
   ---------------------------------------------------------------------------
   【缺陷】scroll 下 #viz 与歌词轨的**纵向剪刀都是自身盒高**（歌词轨另有 mask 的 border-box
   兜底），而歌词行锚在「行盒底 + 2」；盒高原先取「与 #viz 逐位同高」= 只到最后一行的**行盒底**
   ⇒ **最下面那条可见跑道的歌词整行落在盒外被裁**：
     · 滚动 3 行档 → 第 3 槽（当前那条下面那条）的歌词看不到，要等窗口推进一格（它成为中间槽）
       才出现——这正是用户实拍「持续到第二跑道开始播放时才恢复」的形状；
     · 滚动 1 行档（传送带）→ 盒高只够一行，**三槽歌词线全被裁：整档没有词**（实测三槽同 y）。
   分页不受影响（无 scroll-clip、无 mask 纵向裁剪）。

   【修法】抽 `lyricClipH()` 作盒高的**单一来源**：`#viz 裁剪高 + 锚点偏移 2 + 行高 + 6px 余量`；
   `placeLaneOverlay` 的两处写入（scroll 分支 + 末尾 getBoundingClientRect 分支）共用它。

   【本用例钉什么】
     T189a 滚动 3 行 + 两标注开：最下一槽歌词**整行在盒内**；进场行**仍在盒外**（防"开得过大"的假修复）
     T189b 滚动 1 行（传送带）+ 两标注开：三槽歌词线都被 dy 叠到同一条线上，且该线整行在盒内
     T189c 分页逐位不变：不加 .scroll-clip、不设 scroll 的末行余量
     T189d 源码钉：盒高只算一处（lyricClipH 单一来源 + 两处共用 clipH）

   ★ 反向验证锚点（tools/reverse-verify-v3335.py）：
     · M5 盒高退回「与 #viz 同高」→ T155d 新口径 + T189a/T189b 整组红；
     · M6 盒高开成「一个整槽」→ T189a 的「进场行仍在盒外」红（防过修）。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "滚动曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
]}) });
const seedState = (extra) => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 3, loop: true } }, extra));
const arrSeed = (extra) => Object.assign(seedArr(), { "beatsight.state": seedState(extra) });
const seedWords = (beat) => beat.Store.upsertLyric("t1", "s1",
  [{ t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" }]);

const intOf = beat => beat.Viz.internals();
const laneH = els => parseInt(els["lyricLane"].style.height, 10);
const vizH = els => parseInt(els["viz"].style.height, 10);
const rowH = int => (int.lyricRows[0].el.offsetHeight || 28);
/* 传送带：三槽歌词行被 dy 叠置到同一条视觉线上——显示位 = y − (rowGeo[i].top − rowGeo[0].top) */
const beltLine = (int, i) => int.lyricRows[i].y - (int.rowGeo[i].top - int.rowGeo[0].top);

/* ================= T189a：滚动 3 行 · 最下一槽歌词整行在盒内 ================= */
section("T189a 滚动 3 行 + 两标注开：最下一槽歌词整行在裁剪盒内；进场行仍在盒外");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const int = intOf(app.beat), S = app.beat.Store.S;
  eq(S.scrollMode, true, "前提：滚动模式");
  eq(S.scrollRows, 3, "前提：3 行档（可见 3 槽 + 1 条进场行）");
  eq(S.showRuler, true, "前提：座次尺开着——歌词锚在「行盒底 +2」，正是缺陷的触发条件");
  eq(S.showDurLabel, true, "前提：时值标注开着");
  const H = laneH(app.els), V = vizH(app.els), R = rowH(int);
  ok(H > V, "★ 裁剪盒高**大于** #viz 高（多出末行歌词所需）——实测 " + H + " > " + V);
  ok(H === V + 2 + R + 6, "★ 且差值 = 锚点偏移 2 + 行高 " + R + " + 6px 余量（关系式，不写死像素）");
  const last = int.scroll.rows - 1;                       // 3 行档 → 第 3 槽（索引 2）
  eq(int.lyricRows.length, 4, "前提：4 个槽（含进场行）");
  ok(int.lyricRows[last].y + R <= H,
    "★★ 第 3 槽歌词**整行在盒内**（缺陷版：" + (int.lyricRows[last].y + R) + " > " + V + " ⇒ 整行被裁）");
  const entry = int.lyricRows[last + 1];
  ok(!!entry && entry.y > H,
    "★ 进场行（第 4 槽）歌词顶仍在盒外（y=" + (entry ? entry.y : "?") + " > 盒高 " + H + "）——"
    + "防「把盒子开得过大」这类假修复");
}

/* ================= T189b：传送带 · 三槽歌词线都在盒内 ================= */
section("T189b 滚动 1 行（传送带）+ 两标注开：三槽歌词线叠成一条且整行在盒内（此前整档没有词）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 1, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const int = intOf(app.beat);
  eq(app.beat.Store.S.scrollRows, 1, "前提：1 行档（传送带）");
  eq(int.scroll.slotN, 3, "前提：传送带 3 槽（上一 / 当前 / 下一）");
  const H = laneH(app.els), V = vizH(app.els), R = rowH(int);
  eq(int.lyricRows.length, 3, "前提：歌词轨 3 行");
  const disp = int.lyricRows.map((r, i) => beltLine(int, i));
  ok(disp.every(v => Math.abs(v - disp[0]) < 0.01),
    "★ 三槽歌词行被 dy 叠置到**同一条线**（传送带语义：随各自槽 dx 水平拼成一条连续歌词线）",
    "disp=" + JSON.stringify(disp));
  for (let i = 0; i < int.lyricRows.length; i++){
    ok(disp[i] + R <= H,
      "★★ 第 " + i + " 槽歌词整行在盒内（缺陷版：" + (disp[i] + R) + " > " + V + " ⇒ **整档没有词**）");
  }
}

/* ================= T189c：分页逐位不变 ================= */
section("T189c 分页：不加 .scroll-clip、不设 scroll 的末行余量（逐位不变）");
{
  const app = loadApp(arrSeed({ vizRows: 3, showLyric: true, lyricPos: "follow" }, false));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const lane = app.els["lyricLane"];
  eq(app.beat.Store.S.scrollMode, false, "前提：分页模式");
  ok(!lane.classList.contains("scroll-clip"), "★ 分页不加 .scroll-clip（纵向裁剪是 scroll 专属）");
  eq(lane.style.height, "", "★ 分页不写 scroll 的裁剪盒高（逐位不变；分页由文档流自身高度承担）");
}

/* ================= T189d：源码钉（盒高只算一处） ================= */
section("T189d 源码钉：lyricClipH 单一来源，两处写入共用同一个数");
{
  ok(/function lyricClipH\(/.test(html), "★ lyricClipH() 在位（盒高的单一来源）");
  ok(/const clipH = S\.scrollMode \? lyricClipH\(\) : 0;/.test(html),
    "★ 盒高在 scroll 分支**只算一次**（clipH），末尾分支复用");
  ok(/lane\.style\.height = \(clipH \|\| viz\.offsetHeight\) \+ "px";/.test(html),
    "★★ 末尾 getBoundingClientRect 分支复用它：scroll 用 clipH、分页回落到 viz 高");
  ok(!/lane\.style\.height = viz\.offsetHeight \+ "px";/.test(html),
    "★★ 旧的「无条件写成 #viz 高」那一行已消失（它就是缺陷本体）");
  /* ★ 判据要按**调用点**数，不能按裸串：源码里三处注释也写着 lyricClipH()，裸串会数成 4
     （首跑实测假红）。唯一调用点是 `const clipH = S.scrollMode ? lyricClipH() : 0;`。 */
  eq((html.match(/S\.scrollMode \? lyricClipH\(\) : 0/g) || []).length, 1,
    "★ lyricClipH() 只有一个调用点（两处写入共用一个数）");
}
