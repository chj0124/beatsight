/* BeatSight 自动化测试 · #viz 裁剪高度的单一来源与"变更后重落"（v3.33.6 回归）
   T190
   ---------------------------------------------------------------------------
   【缺陷】`#viz` 的裁剪高度只在 buildViz 里写过一次，而它的输入（`scrollSlotH` /
   `vizRowBoxH`）会被**之后的**动作改掉——最典型的是歌词 follow 模式给 #viz 挂
   `.lyric-inline-on`：`.bar-row` 的 margin-bottom 20 → 52（行距 106 → 138），
   裁剪盒却仍按 20 算，**矮 2×(138−106)=64px** ⇒ 最下面那条可见跑道的**节奏型被裁掉半行**。
   这条路径**不需要整页重建**：装配层「显示歌词」/「歌词位置」、`Viz.relayout()` 的播放分支
   （主题 / 座次尺 / 时值标注 / 宽屏铺满 / resize）、以及首建（buildViz 先 cacheGeo 再算高度、
   随后 buildLyricLane 才挂类；播放中重采样走 relayout 播放分支、不重写高度 ⇒ 兜不住）。
   ★ 用户实拍：**什么都不动、直接播放** → 第三条跑道的节奏型只显示上半截，而它下面那条歌词
     却已经露出来（v3.33.5 把歌词轨盒高改成按当前几何算，这个矛盾才显形）。

   【修法】高度收成单一来源：`vizClipH()` 算、`applyVizClip()` 写（唯一写入点，高度真变了
   再补一次 cacheGeo）；`lyricClipH()` 复用 `vizClipH()`；三处"改布局的人"各重落一次
   （buildViz / setLyricInlineOn / relayout 播放分支）。

   【本用例钉什么】
     T190a 行距翻转（显示歌词开关）后，**陈旧/被改坏的 #viz 高度必须被写回**
           （探针：先把高度改成 1px，再翻转开关；不重落就停在 1px ⇒ 具名断言红）
     T190b 播放中 `Viz.relayout()` 同样要把高度写回（同一探针）
     T190c 歌词轨盒高 = `#viz 高 + 锚点偏移 2 + 行高 + 6`（两个盒子同源，不是各算一份）
     T190d 分页：`#viz` 高度必须交还给内容（不带 scroll 的裁剪）——不变性断言，M7/M8 不会让它红
     T190e 源码钉：单一来源 + 三处调用点 + 旧的内联公式已消失

   ★ 反向验证锚点（tools/reverse-verify-v3336.py）：M7 去掉 setLyricInlineOn 里的重落 →
     T190a 红；M8 去掉 relayout 播放分支里的重落 → T190b 红；M9 让 lyricClipH 自己重写一份公式 →
     T190e 的"单一来源"红。
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

const vizEl = els => els["viz"];
/* 两个盒子必须同源：歌词轨盒高 = #viz 裁剪高 + 2 + 行高 + 6（全从 DOM 读，不碰内部标量） */
const bothBoxesAgree = (app, tag) => {
  const int = app.beat.Viz.internals();
  const vizH = parseInt(vizEl(app.els).style.height, 10);
  const laneH = parseInt(app.els["lyricLane"].style.height, 10);
  const rowH = int.lyricRows[0].el.offsetHeight || 28;
  eq(laneH, vizH + 2 + rowH + 6, tag + "：歌词轨盒高 = #viz 裁剪高 + 2 + 行高 + 6（实测 " + laneH + " vs " + (vizH + 2 + rowH + 6) + "）");
};

/* ================= T190a：行距翻转后必须把 #viz 高度写回 ================= */
section("T190a 显示歌词开关翻转（行距 20↔52）后，#viz 裁剪高度被重落（陈旧值必须被纠正）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const viz = vizEl(app.els);
  eq(app.beat.Store.S.scrollMode, true, "前提：滚动模式");
  ok(!!viz.style.height, "前提：#viz 有裁剪高度（" + viz.style.height + "）");
  /* 探针：把高度改成明显错误的值 = 模拟"行距变了、高度还是旧的" */
  viz.style.height = "1px";
  app.els["showLyricToggle"].click();                 // 关：摘 .lyric-inline-on（行距翻转）
  ok(viz.style.height !== "1px",
    "★★ 行距翻转后 #viz 高度被重落（不是停在探针值 1px）——实测 " + viz.style.height);
  app.els["showLyricToggle"].click();                 // 再开：挂类，回到 follow
  bothBoxesAgree(app, "★ 翻转回来后");
}

/* ================= T190b：播放中 relayout 也要重落 ================= */
section("T190b 播放中 Viz.relayout() 后，#viz 裁剪高度被重落（主题/resize/标注开关都走这条路）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  app.beat.Controls.start();
  eq(app.beat.Store.S.playing, true, "前提：播放中");
  const viz = vizEl(app.els);
  viz.style.height = "1px";
  app.beat.Viz.relayout();                            // 播放分支：cacheGeo → 重落高度 → …
  ok(viz.style.height !== "1px",
    "★★ relayout 播放分支把高度重落（不是停在探针值 1px）——实测 " + viz.style.height);
  bothBoxesAgree(app, "★ relayout 之后");
  app.beat.Controls.stop();
}

/* ================= T190c：新建树时两个盒子同源 ================= */
section("T190c 新建树（buildViz）后，歌词轨盒高与 #viz 裁剪高同源");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  bothBoxesAgree(app, "★ buildViz 之后");
}

/* ================= T190d：分页交还高度（不变性） ================= */
section("T190d 分页：#viz 高度交还给内容（不带 scroll 的裁剪）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  const viz = vizEl(app.els);
  viz.style.height = "1px";
  app.beat.Store.S.scrollMode = false;                // 切回分页（停止态 → relayout 走 buildViz）
  app.beat.Viz.relayout();
  eq(viz.style.height, "", "★ 分页下 #viz 高度被清空（交还内容高度）");
}

/* ================= T190e：源码钉 ================= */
section("T190e 源码钉：高度单一来源（vizClipH 算 / applyVizClip 写）+ 三处重落 + 旧内联公式已消失");
{
  ok(/function vizClipH\(\)\{/.test(html), "★ vizClipH() 在位（#viz 裁剪高的单一来源）");
  ok(/function applyVizClip\(\)\{/.test(html), "★ applyVizClip() 在位（唯一写入点）");
  ok(/const vizH = vizClipH\(\);/.test(html), "★ lyricClipH() 复用 vizClipH()，不再各写一份公式");
  ok(!/const vizH = Math\.round\(r0\.top \+ \(scrollRows\(\) - 1\) \* scrollSlotH \+ vizRowBoxH\)/.test(html),
    "★★ 旧的内联公式（lyricClipH 里那份）已消失");
  ok(!/viz\.style\.height = Math\.round\(r0\.top/.test(html),
    "★★ buildViz 里那次直接写高度已消失（改走 applyVizClip）");
  const calls = (html.match(/^\s+applyVizClip\(\);$/gm) || []).length;
  ok(calls >= 3, "★★ " + calls + " 处调用 applyVizClip（buildViz / setLyricInlineOn / relayout）");
  ok(/\n    applyVizClip\(\);\n/.test(html), "★ setLyricInlineOn 里有重落（4 空格缩进那处）");
}
