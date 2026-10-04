/* BeatSight 自动化测试 · v3.33.3 滚动模式「最下面那条跑道的歌词被裁掉」修复
   ---------------------------------------------------------------------------
   【用户实拍】滚动模式（3 行档）下，**最下面那条跑道**（还没轮到播放、位于可见行最下）
   的歌词看不到 / 位置不对；等它成为当前槽（窗口推进一格）才"恢复"。
   【真根因】歌词轨在滚动下带**横向 mask**（`.viz.scroll-mode ~ .lyric-lane`，视口两缘渐隐），
   而 `mask-clip` 的缺省值是 **border-box** ⇒ **mask 会把盒子之外的渲染一并裁掉**
   （这才是"上下裁到盒子"的真正实现——不是 `clip-path`，也不是 `overflow`）。
   而本盒的盒高原先被设成**与 #viz 逐位同高**（只到"行盒底"），歌词行的锚点却是「行盒底 + 2」
   ⇒ 最下那条可见跑道（index = rows−1）的歌词（行盒底 +2 ~ +2+行高）**整行落在盒外被裁**。
   实测（1440、3 行档、示例曲）：#viz 高 420 → 槽 0/1/2 的歌词底 = 174/312/**450**
   ⇒ 槽 2（450）超出盒高 420 被裁；窗口推进一格后它成为中间槽（锚点上移 138）即恢复
   —— 用户说「一直持续到第二跑道开始播放才恢复」，时机完全吻合。
   【修法】盒高 = #viz 高 + 末行歌词所需（锚点偏移 2 + 行高 + 6px 余量）= 456；
   进场行（再下一槽，歌词底 588）远在 456 之上 ⇒ 仍被裁，不会多出一行。
   【本用例钉什么】三档下"最下可见行歌词在盒内 + 进场行歌词在盒外"的关系式（不写死像素），
   以及分页档口径不变。
   ★ 反向验证锚点：把盒高退回 `vizClipH`（= 与 #viz 同高）→ T187a/T187b 红、其余不动。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "滚动曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
]}) });
const seedState = (extra, loop) => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 3, loop } }, extra));
const arrSeed = (extra, loop = true) => Object.assign(seedArr(), { "beatsight.state": seedState(extra, loop) });

const WORDS = ["一", "二", "三", "四"];
const seedWords = beat => beat.Store.upsertLyric("t1", "s1",
  WORDS.map((ch, i) => ({ t: i * 192, dur: 24, ch })));

const intOf = beat => beat.Viz.internals();
/** 歌词轨的"裁剪刀" = 它的盒高（滚动下 mask 的 mask-clip: border-box 按此裁） */
const laneH = els => parseFloat(els["lyricLane"].style.height);
/** 第 i 条歌词行的底 = 结构层锚点 y + 该行实测行高（与帧内摆位同源） */
const lyricBottom = (beat, i) => {
  const r = intOf(beat).lyricRows[i];
  if (!r) return null;
  return r.y + (r.el.offsetHeight || 28);
};

/* ================= T187a：最下可见行的歌词必须在盒内 ================= */
section("T187a 滚动 3 行档：最下可见行（index = rows−1）的歌词底 ≤ 歌词轨盒高");
{
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(beat);
  beat.Viz.buildViz();
  const rows = intOf(beat).scroll.rows;
  const h = laneH(els);
  ok(h > 0 && !isNaN(h), "前提：滚动档歌词轨设了盒高（" + els["lyricLane"].style.height + "）");
  ok(h > parseFloat(els["viz"].style.height),
    `★★ 盒高(${h}) 必须**大于** #viz 高(${els["viz"].style.height})——修复前两者相等，`
    + "最下可见行的歌词（锚在「行盒底 + 2」）整行落在盒外，被横向 mask 的 border-box 裁掉");
  const bottom = lyricBottom(beat, rows - 1);
  ok(bottom !== null, "前提：最下可见行有歌词行对象");
  if (bottom !== null){
    ok(bottom <= h,
      `★★ 最下可见行歌词底(${bottom}) ≤ 盒高(${h})——那正是用户报障的那一条（此前被裁掉）`);
  }
}

/* ================= T187b：进场行（再下一槽）的歌词仍必须在盒外 ================= */
section("T187b ★ 进场行（index = rows）的歌词仍在盒外——盒高不得开到含住它");
{
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(beat);
  beat.Viz.buildViz();
  const rows = intOf(beat).scroll.rows;
  eq(intOf(beat).lyricRows.length, rows + 1, "前提：槽数 = rows+1（进场行存在）");
  const h = laneH(els);
  const entryTop = intOf(beat).lyricRows[rows].y;
  ok(entryTop > h,
    `★ 进场行歌词顶(${entryTop}) > 盒高(${h})——它本该在盒外（只在垂直登场时滑入），`
    + "这条防「把盒高开到两行高」那类假修复");
}

/* ================= T187c：盒高与末行歌词的关系式（同一来源，不写死像素） ================= */
section("T187c 盒高 == #viz 高 + 锚点偏移 2 + 该行实测行高 + 6px 余量");
{
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(beat);
  beat.Viz.buildViz();
  const h = laneH(els), vizH = parseFloat(els["viz"].style.height);
  const rowH = intOf(beat).lyricRows[0].el.offsetHeight || 28;
  eq(h - vizH, 2 + rowH + 6,
    "★ 差值 == 锚点偏移 2 + 行高 + 6px 余量（与实现同一来源；写死像素的断言会随行高变化而假红）");
}

/* ================= T187d：分页档原口径不变 ================= */
section("T187d 分页 follow：不由滚动逻辑设盒高（原口径逐位不变）");
{
  const { beat, els } = loadApp(Object.assign(seedArr(),
    { "beatsight.state": seedState({ vizRows: 2, showLyric: true, lyricPos: "follow" }, false) }));
  seedWords(beat);
  beat.Store.S.scrollMode = false;
  beat.Viz.reloadScroll();
  const lane = els["lyricLane"];
  eq(lane.classList.contains("scroll-clip"), false, "分页档不带 .scroll-clip");
  ok(beat.Viz.effectiveLyricPos() === "follow", "前提：位置档解析为 follow（覆盖层模式）");
  eq(lane.style.height, "",
    "★ 分页档不设盒高（桩口径：覆盖层高度由 getBoundingClientRect 分支设置，桩缺该方法）——"
    + "v3.33.3 的余量只加在滚动档");
  eq(els["viz"].style.height, "", "分页档 #viz 也不设裁剪高度（原口径）");
}
