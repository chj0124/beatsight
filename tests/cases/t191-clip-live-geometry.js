/* BeatSight 自动化测试 · 裁剪高度必须读「实时行几何」而不是 cacheGeo 快照（v3.33.7 回归）
   T191
   ---------------------------------------------------------------------------
   【缺陷】`vizClipH()` / `lyricClipH()` 原先只用 cacheGeo 的快照标量
   （`rowGeo` / `scrollSlotH` / `vizRowBoxH`）推算裁剪高度。而 `rowGeo` 是**上一次**量测的快照：
   只要"布局变了、cacheGeo 还没重采"（窗口跨 960 断点、主题/标注档切换、量测撞在过渡帧、
   预备拍道替换行 0…），裁剪盒就与真实行组不一致。
   ★ 用户实拍（v3.33.6，滚动 + 两标注关/chord-xl）：裁剪线落在「行顶 + 72px」，而该行真实盒高 86px
     ⇒ 右上角那条跑道的节奏型/歌词被裁。滚动模式每小节都会 buildViz 重写高度 ⇒ 该现象**只持续一小节**
     （与用户第一轮"持续到第二跑道开始播放才恢复"同一签名）。

   【修法】裁剪高度改读**实时 DOM 几何**：
     · `vizClipH()` = 末条可见槽 `rowEls[last].offsetTop + offsetHeight`（缺口时回落到公式）；
     · `lyricClipH()` = max(vizClipH(), 末条可见槽歌词行 `y + 行高 + 6`)；
     · 覆盖层锚点也用实时行盒高（rowEls[i].offsetHeight），避免陈旧标量把整轨歌词顶偏。

   【本用例钉什么】
     T191a 把末条可见行的实时几何改掉（不重采 cacheGeo），走"不重建"的歌词轨入口后，
           两个裁剪盒都必须跟着实时几何走（旧实现只会跟着陈旧快照 → 具名断言红）
     T191b 源码钉：三处都读实时几何，公式只作回落
     T191c 分页不变（裁剪交还内容高度）

   ★ 反向验证（tools/reverse-verify-v3337.py）：M10 vizClipH 退回只用快照公式 → T191a 红；
     M11 lyricClipH 退回只用快照公式 → T191a 红；M12 锚点退回快照行盒高 → T191a 红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const arrSeed = (extra) => ({
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t1", name: "裁剪曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
  ]}),
  "beatsight.state": JSON.stringify(Object.assign(
    { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 3, loop: true } }, extra)),
});
const seedWords = (beat) => beat.Store.upsertLyric("t1", "s1",
  [{ t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" }]);

/* ================= T191a：裁剪盒跟着**实时行几何**走 ================= */
section("T191a 末条可见行的实时几何变了（未重采 cacheGeo）→ 两个裁剪盒都跟着变");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const int = app.beat.Viz.internals();
  const lane = app.els["lyricLane"];
  const before = parseInt(lane.style.height, 10);
  ok(before > 0, "前提：歌词轨有裁剪盒高（" + before + "）");
  /* 探针：只改**实时 DOM 几何**（桩里 = 行元素的 _rowTop），不动 cacheGeo 快照 */
  const rows = app.beat.Store.S.scrollRows;
  const iRow = Math.min(rows, int.rowEls.length) - 1;
  const iLyr = Math.min(rows, int.lyricRows.length) - 1;
  const lastRow = int.rowEls[iRow];
  lastRow._rowTop = (lastRow._rowTop === undefined ? 0 : lastRow._rowTop) + 100;
  /* 走"不重建"的歌词轨入口：内部 setLyricInlineOn 类状态未翻转 ⇒ 不会重采几何 */
  app.beat.Viz.rebuildLyricLane();
  const after = parseInt(lane.style.height, 10);
  ok(after > before, "★★ 裁剪盒跟着实时行几何长高（" + before + " → " + after + "）——旧实现只信快照，会原地不动");
  const vizClip = lastRow.offsetTop + lastRow.offsetHeight;
  const lr = int.lyricRows[iLyr];
  const need = lr.y + lr.el.offsetHeight + 6;
  eq(after, Math.max(vizClip, need),
    "★ 歌词轨盒高 = max(#viz 实时裁剪高, 末条可见槽歌词行底 + 6)（实测 " + after + " vs " + Math.max(vizClip, need) + "）");
}

/* ================= T191a-2：chord-xl 档（两标注关）歌词在行盒内 —— 此时"歌词行底"是绑定约束 ================= */
section("T191a-2 chord-xl 档下，盒高必须取到「歌词行底 + 6」（这一档歌词住在行盒内，行盒底不够）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.els["rulerLabToggle"].click();            // 关座次尺
  app.els["durLabelToggle"].click();            // 关时值标注 ⇒ .chord-xl ⇒ 锚点 = 行顶 + 50（行盒内）
  app.beat.Viz.buildViz();
  const int = app.beat.Viz.internals();
  const rows = app.beat.Store.S.scrollRows;
  const iRow = Math.min(rows, int.rowEls.length) - 1;
  const iLyr = Math.min(rows, int.lyricRows.length) - 1;
  const lastRow = int.rowEls[iRow];
  const lr = int.lyricRows[iLyr];
  const laneH = parseInt(app.els["lyricLane"].style.height, 10);
  const vizClip = lastRow.offsetTop + lastRow.offsetHeight;
  const need = lr.y + lr.el.offsetHeight + 6;
  ok(need > vizClip,
    "前提：这一档歌词行底（" + need + "）确实低于行盒底（" + vizClip + "）——旧公式只取 min 会裁掉那几像素");
  eq(laneH, Math.max(vizClip, need), "★ 盒高 = 歌词行底 + 6（实测 " + laneH + " vs " + Math.max(vizClip, need) + "）");
}

/* ================= T191b：源码钉 ================= */
section("T191b 源码钉：三处读实时几何，快照公式只作回落");
{
  ok(/const last = rowEls\[Math\.min\(scrollRows\(\), rowEls\.length\) - 1\];/.test(html),
    "★★ vizClipH() 读实时的 rowEls[末条可见槽]");
  ok(/return Math\.round\(last\.offsetTop \+ last\.offsetHeight\);/.test(html),
    "★★ vizClipH() 用实时 offsetTop + offsetHeight（行盒底）");
  ok(/const lr = lyricRows\[Math\.min\(scrollRows\(\), lyricRows\.length\) - 1\];/.test(html),
    "★★ lyricClipH() 读实时的末条可见槽歌词行");
  ok(/Math\.round\(lr\.y \+ lr\.el\.offsetHeight \+ 6\)/.test(html),
    "★★ lyricClipH() 用实时锚点 + 实测行高 + 6px");
  ok(/Math\.max\(vizH, need\)/.test(html), "★ 歌词轨盒高与 #viz 裁剪高取大（不会比网格剪刀还短）");
  ok(/\(\(rowEls\[i\] && rowEls\[i\]\.offsetHeight\) \|\| vizRowBoxH\)/.test(html),
    "★★ 覆盖层锚点也用实时行盒高（陈旧标量不再把整轨歌词顶偏）");
  ok(/return Math\.round\(r0\.top \+ \(scrollRows\(\) - 1\) \* scrollSlotH \+ vizRowBoxH\);/.test(html),
    "★ 快照公式仍在（仅作行元素缺失时的回落）");
}

/* ================= T191c：分页不变 ================= */
section("T191c 分页仍交还内容高度（不带 scroll 的裁剪）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const viz = app.els["viz"];
  viz.style.height = "1px";
  app.beat.Store.S.scrollMode = false;
  app.beat.Viz.relayout();
  eq(viz.style.height, "", "★ 分页下 #viz 高度被清空");
}
