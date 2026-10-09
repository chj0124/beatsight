/* BeatSight 自动化测试 · 预备拍窗口 × 歌词轨「结构层重锚」（v3.33.4 回归）
   T188。
   ---------------------------------------------------------------------------
   【用户报障】滚动 3 行档、预备拍开着时，触发侧栏 → 点示例曲 → 鼠标移出（侧栏 400ms
   后自动收回）→ **第三跑道的歌词错位**，一直持续到第二跑道开始播放（= 预备拍结束、
   首个可听小节起播）才恢复正常。

   【根因（两条路径叠加，缺一不可）】
     ① `setPresetDrawer()` 开/合各调一次 `Viz.relayout()`（v3.0.0 批 4 遗留；当时抽屉是
        **内联**的、会撑高控制卡把 #viz 下移）。v3.3.0 起抽屉已是 `position:fixed` 覆盖层，
        开合**不改布局** ⇒ 这次调用早成空转。
        而 relayout 的**播放分支**走 `layoutLyricLane → placeLaneOverlay`，后者只写
        `translateY(y)` —— 横向槽位移 x 被**整条抹掉**。
     ② 预备拍期间 `paintFrameBody` 在 `ciBeats > 0 && now < ciEnd` 分支里 `return`（见源码
        那处注释），帧循环**根本没走到**滚动摆位块 ⇒ 被抹掉的 x 没人补，一直挂到预备拍结束。
     ⇒ 表现：歌词整轨停在轨道左缘（丢掉一个 dx，开局相位下约半条轨宽）；
        预备拍结束的那一帧帧循环恢复，歌词**瞬间**归位——与用户描述的恢复时机逐帧吻合。

   【修法】抽 `lyricRestX()` 作 x 的**单一来源**（applyScrollRest 与 placeLaneOverlay 共用），
     让结构层重锚歌词轨时把静止 x 一起落下去；顺带摘掉侧栏那次失效的 relayout（根因①入口）。

   【本用例钉什么】
     T188a ★ 预备拍窗口内调一次 `Viz.relayout()` 后，歌词行横移仍与网格行**逐位相同**
           （缺陷版在这里变成 `translateY(...)` ⇒ dxOf 读成 NaN ⇒ 具名断言红，不崩）
     T188b 对照：同一场景**不调** relayout，歌词行本就对齐——把"缺陷窗口 = 预备拍 + 结构层重锚"
           这个坐标钉死（只改预备拍、或只改 relayout 都过不了这两条）
     T188c 预备拍**结束后**一帧仍与网格同组（修复不得只在预备拍窗口内成立）
     T188d 分页模式逐位不变（placeLaneOverlay 仍写 translateY，横向位移是 scroll 专属）
     T188e 源码钉：`setPresetDrawer` 不得再调 `Viz.relayout()`；`lyricRestX` 必须是两处共用

   ★ 反向验证锚点：把 `placeLaneOverlay` 里那句改回 `translateY(...)`（或把 `lyricRestX(i)` 换回
     就地展开且只给 applyScrollRest 用）→ T188a/T188c 的"横移严格相同"整组变红。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, html } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 4 小节曲式（内置型 1 = 四分基础 4/4，1 遍 = 4 小节）；lo 控制是否回卷 */
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "滚动曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
]}) });
const seedState = (extra, loop) => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 3, loop } }, extra));
const arrSeed = (extra, loop) => Object.assign(seedArr(), { "beatsight.state": seedState(extra, loop) });
/* 240BPM / 4-4 ⇒ 1 小节 = 1s、1 拍 = 0.25s；4 拍预备拍 = 1s 窗口 */

const WORDS = ["一", "二", "三", "四"];
const seedWords = (beat) => beat.Store.upsertLyric("t1", "s1",
  WORDS.map((ch, i) => ({ t: i * 192, dur: 24, ch })));

const intOf = beat => beat.Viz.internals();
/* translate(Xpx, ...) 解析：注意 `translateY(242px)` **不匹配** ⇒ 返回 NaN，
   这正是缺陷版要触发的形状（具名断言失败，而不是崩在 undefined 上） */
const dxOf = s => { const m = /translate\((-?[\d.]+)px,/.exec(s || ""); return m ? +m[1] : NaN; };
const inCountIn = els => els["statusText"].textContent.indexOf("预备 ·") >= 0;

/* 推进 n 帧（音频时钟 + scheduler + paintFrame）；返回最后一帧是否仍在预备拍窗口 */
function step(app, ac, n, dt){
  const beat = app.beat;
  let ci = false;
  for (let i = 0; i < n; i++){
    ac.currentTime += dt;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    ci = inCountIn(app.els);
    if (!beat.Store.S.playing) break;
  }
  return ci;
}
/* 走进预备拍窗口（状态栏文案是产品的公开读法，t80 同源） */
function enterCountIn(app){
  const { beat, els } = app;
  const ac = FakeAudioContext.last;
  for (let i = 0; i < 60; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (inCountIn(els)) return ac;
    if (!beat.Store.S.playing) break;
  }
  return ac;
}

/* ================= T188a：★ 预备拍中 relayout（= 侧栏开合那一步）后仍同组 ================= */
section("T188a ★ 预备拍窗口内一次 relayout 后，歌词行横移仍与网格行逐位相同");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true, countIn: { on: true, beats: 4 } }, true));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  app.beat.Controls.start();
  const ac = enterCountIn(app);

  const inCi0 = inCountIn(app.els);
  ok(inCi0, "前提：已进入预备拍窗口（打不到这个窗口，本用例就测不到缺陷）");
  step(app, ac, 4, 0.02);
  const i0 = intOf(app.beat);
  eq(dxOf(i0.lyricRows[2].el.style.transform), dxOf(i0.rowEls[2].style.transform),
    "前提：relayout 前歌词行 2 与网格行 2 已同组横移");

  /* ★ 触发侧栏那一步（开与合各调一次，取一次即可复现） */
  app.beat.Viz.relayout();
  step(app, ac, 3, 0.02);

  ok(inCountIn(app.els), "★ 断言时仍在预备拍窗口内——缺陷正是靠这个窗口'挂住'不恢复的");
  const int = intOf(app.beat);
  eq(int.lyricRows.length, int.rowEls.length, "前提：两轨槽数恒等");
  for (let i = 0; i < int.lyricRows.length; i++){
    eq(dxOf(int.lyricRows[i].el.style.transform), dxOf(int.rowEls[i].style.transform),
      "★★ 预备拍中 relayout 后：歌词行 " + i + " 横移与网格行 " + i + " 严格相同（缺陷版此处是 translateY ⇒ NaN）");
  }
  app.beat.Controls.stop();
}

/* ================= T188b：对照——不调 relayout 时本就对齐 ================= */
section("T188b 对照：同一场景不调 relayout，预备拍全程歌词与网格同组（缺陷窗口坐标=预备拍+结构层重锚）");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true, countIn: { on: true, beats: 4 } }, true));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  app.beat.Controls.start();
  const ac = enterCountIn(app);
  ok(inCountIn(app.els), "前提：已进入预备拍窗口");
  let bad = -1;
  for (let f = 0; f < 30; f++){
    step(app, ac, 1, 0.02);
    const int = intOf(app.beat);
    for (let i = 0; i < int.lyricRows.length; i++){
      if (dxOf(int.lyricRows[i].el.style.transform) !== dxOf(int.rowEls[i].style.transform)){ bad = f; break; }
    }
    if (bad >= 0) break;
  }
  eq(bad, -1, "★ 不调 relayout：预备拍全程两轨横移恒相同（所以缺陷必须同时满足'预备拍'与'结构层重锚'）");
  app.beat.Controls.stop();
}

/* ================= T188c：预备拍结束后仍同组（修复不能只在窗口内成立） ================= */
section("T188c 预备拍窗口内 relayout 后，预备拍结束（第二跑道起播）仍与网格同组");
{
  const app = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true, countIn: { on: true, beats: 4 } }, true));
  seedWords(app.beat);
  app.beat.Viz.buildViz();
  app.beat.Controls.start();
  const ac = enterCountIn(app);
  app.beat.Viz.relayout();
  step(app, ac, 3, 0.02);
  /* 推过预备拍：封顶 2s（4 拍 @240BPM = 1s，留一倍余量） */
  let left = false;
  for (let i = 0; i < 100 && !left; i++){
    step(app, ac, 1, 0.02);
    left = !inCountIn(app.els);
  }
  ok(left, "前提：预备拍已结束（进入正式播放）");
  step(app, ac, 2, 0.02);
  const int = intOf(app.beat);
  ok(int.lyricRows.length > 0, "前提：歌词轨仍在（窗口里有词）");
  for (let i = 0; i < int.lyricRows.length; i++){
    eq(dxOf(int.lyricRows[i].el.style.transform), dxOf(int.rowEls[i].style.transform),
      "★★ 预备拍结束后：歌词行 " + i + " 横移与网格行 " + i + " 仍严格相同");
  }
  app.beat.Controls.stop();
}

/* ================= T188d：分页模式逐位不变（横向位移是 scroll 专属） ================= */
section("T188d 分页 follow：歌词行仍写 translateY（横向位移是 scroll 专属，不受本次修复影响）");
{
  /* ★ 显式 lyricPos:"follow"：桩的视口宽 = 行宽 600 ⇒ narrow() 为真，
     "auto" 会解析成 bottom（流式、根本不进 placeLaneOverlay）——那样这条断言就是空的。
     本用例要钉的是「分页 **follow** 仍写 translateY」，故把位置档写死。 */
  const { beat } = loadApp(arrSeed({ vizRows: 2, showLyric: true, lyricPos: "follow" }, false));
  seedWords(beat);
  beat.Viz.buildViz();
  const int = intOf(beat);
  eq(beat.Store.S.scrollMode, false, "前提：分页模式");
  eq(beat.Viz.effectiveLyricPos(), "follow", "前提：歌词位置档 = follow（走覆盖层定位路径）");
  ok(int.lyricRows.length > 0, "前提：歌词轨已建（窗口里有词）");
  for (let i = 0; i < int.lyricRows.length; i++){
    const tr = int.lyricRows[i].el.style.transform;
    ok(/^translateY\(/.test(tr),
      "★ 分页：歌词行 " + i + " 仍是 translateY（无槽横移，逐位不变）——实际 " + JSON.stringify(tr));
  }
}

/* ================= T188e：源码钉（根因入口不得复活 / 单一来源不得分叉） ================= */
section("T188e 源码钉：侧栏不再 relayout；x 的单一来源 lyricRestX 必须两处共用");
{
  const seg = /function setPresetDrawer\([\s\S]*?\n\}/.exec(html);
  ok(!!seg, "前提：能在源码里定位 setPresetDrawer（源码钉的前提）");
  if (seg){
    /* ★ 判据必须是**代码行**而不是裸串：本函数体内现在就有一句注释写着「原本调过一次
       Viz.relayout()」——用裸 \/Viz\.relayout\(\)\/ 去测会把那句注释当成调用（首跑实测假红）。
       故按"整行只有这一句调用"匹配：缺陷版那行是两空格缩进的 `  Viz.relayout();`。 */
    ok(!/^\s*Viz\.relayout\(\);?\s*$/m.test(seg[0]),
      "★★ setPresetDrawer 不得再调 Viz.relayout()——v3.3.0 起抽屉是 fixed 覆盖层，开合不改布局；"
      + "而它在预备拍窗口里会写坏歌词轨横移（用户实拍报障的入口）");
  }
  ok(/function lyricRestX\(/.test(html), "★ x 的单一来源 lyricRestX 在位（applyScrollRest 与 placeLaneOverlay 共用）");
  ok((html.match(/lyricRestX\(i\)/g) || []).length >= 2,
    "★★ 两条写入路径都走 lyricRestX(i)（静止态落位 + 结构层重锚），判据只此一份");
  ok(/S\.scrollMode \? lyricRestX\(i\) : null/.test(html),
    "★ 结构层重锚只在 scroll 下落 x（分页维持 translateY 逐位不变）");
}
