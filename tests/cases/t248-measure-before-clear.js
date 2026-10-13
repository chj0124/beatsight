/* BeatSight 自动化测试 · 重建前先量、清空后不读（v3.51.1 回归）
   T248
   ---------------------------------------------------------------------------
   【现象】用户实报：歌词位置选「集中在底部」时，页面向下滚动后按播放、或播放到当前页最后一行，
     页面会被自动滚回上方（歌词滑出视野）；而「贴在每行小节下」档不会。
   【根因】#lyricLane 在底部档是**流内块**（follow 档是脱流覆盖层）。buildViz / buildLyricLane
     都是「先 clear（innerHTML=""）→ 再重建」，而原实现在「已清空、行未重建」的空窗里读了一次
     布局（buildViz 取 wpx、buildLyricLane 取 laneW）⇒ 浏览器被按"缩矮的文档"强制排版一次，
     滚动位置被钳回 / 重锚；行重建后高度恢复，滚动位置却不返还。
   【修法】把两次量测都提到 clear 之前 —— 「清空 → 重建」对布局成为原子操作。
   【本用例】用桩的布局读数计数器（PROBE.layoutReads）在元素的**空窗期内**计数：
     修复后必须为 0；回退修复（把量测挪回 clear 之后）即 > 0 ⇒ 断言变红。
   ================================================================================ */
"use strict";
const { loadApp, ok, section, PROBE } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const arrSeed = pos => ({
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t1", name: "回弹曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 2)] }] },
  ]}),
  "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
    arrangeSel: { id: "t1", from: 0, to: 7, loop: true }, lyricPos: pos }),
});

/* 给元素挂「空窗期布局读数」探针：innerHTML 清空后进入空窗，首次 appendChild 关闭空窗；
   期间发生的任何布局读取（PROBE.layoutReads 增量）都记进 readsWhileEmpty。 */
function trackEmpty(el){
  const st = { clears: 0, appends: 0, readsWhileEmpty: 0, _openAt: null };
  const d = Object.getOwnPropertyDescriptor(el, "innerHTML");
  Object.defineProperty(el, "innerHTML", {
    configurable: true, enumerable: true,
    get(){ return d.get.call(el); },
    set(v){
      d.set.call(el, v);
      if (el.children.length === 0){ st.clears++; st._openAt = PROBE.layoutReads; }
    },
  });
  const orig = el.appendChild;
  el.appendChild = function(c){
    if (st._openAt !== null){ st.readsWhileEmpty += PROBE.layoutReads - st._openAt; st._openAt = null; }
    st.appends++;
    return orig.call(el, c);
  };
  return st;
}

section("T248a 底部档整树重建：#viz 与 #lyricLane 在空窗期内零布局读取");
{
  const app = loadApp(arrSeed("bottom"));
  const stViz = trackEmpty(app.els.viz);
  const stLane = trackEmpty(app.els.lyricLane);
  app.beat.Viz.buildViz();
  ok(stViz.clears >= 1 && stViz.appends >= 1, "前提：#viz 经历了一次「清空 → 重建」");
  ok(stLane.clears >= 1 && stLane.appends >= 1, "前提：#lyricLane 经历了一次「清空 → 重建」");
  ok(stViz.readsWhileEmpty === 0, "★★ #viz 在空窗期内零布局读取（量测已提到 clear 之前）");
  ok(stLane.readsWhileEmpty === 0, "★★ #lyricLane 在空窗期内零布局读取 —— 页面回弹的根因");
}

section("T248b 贴行档同样零读取（两档同一条重建链，不因歌词位置而分叉）");
{
  const app = loadApp(arrSeed("follow"));
  const stViz = trackEmpty(app.els.viz);
  const stLane = trackEmpty(app.els.lyricLane);
  app.beat.Viz.buildViz();
  ok(stViz.clears >= 1 && stViz.appends >= 1, "前提：贴行档也重建了网格");
  ok(stLane.clears >= 1 && stLane.appends >= 1, "前提：贴行档也重建了歌词轨");
  ok(stViz.readsWhileEmpty === 0, "★★ 贴行档 #viz 空窗期零布局读取");
  ok(stLane.readsWhileEmpty === 0, "★★ 贴行档 #lyricLane 空窗期零布局读取");
}
