/* BeatSight 自动化测试 · 歌词跟随条（方案乙，v2.83.0）
   T149 系列。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html 内注释同源）：
     · 跟随条 #lyricFollow 是 #viz 内绝对定位单行条，复用 lyricRows[curIdx] 数据，
       零新数据层；定位全靠 transform: translateY（top 恒 0），帧内零 layout 读取。
     · 有词窗口给 #viz 加 .lyric-follow-on（行距 20→48）以腾出胶囊下方空带；
       预设/无词/停机 → 跟随条隐藏且行距类移除。
     · 不破 T27 不变量：#viz 内 .bar-row 数量与"不含 follow"（follow 不带 bar-row class）。
   基准段落：BUILTINS[1]（四分基础，4/4）× 1 遍 = 4 小节。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "歌词曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL(1, 1)] }] },
]}) });
const seedState = extra => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }, extra));

const numOf = s => { const m = /translateY\(([-0-9.]+)px\)/.exec(s || ""); return m ? parseFloat(m[1]) : NaN; };

section("T149a 结构层 · 有词挂载跟随条 + 行距补偿 + 不破 bar-row 不变量");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Viz.buildViz();
  const viz = els["viz"];
  const follow = beat.Viz.internals().lyricFollowEl;
  ok(follow, "跟随条元素存在");
  ok([...viz.children].some(c => c.id === "lyricFollow"), "跟随条挂在 #viz 内（绝对定位层）");
  eq([...viz.children].filter(c => c.id === "lyricFollow").length, 1, "#viz 内恰 1 个 .lyric-follow");
  ok(viz.classList.contains("lyric-follow-on"), "有词窗口给 #viz 加 .lyric-follow-on（行距 20→48）");
  ok(follow.hidden, "停机（未播放）→ 跟随条隐藏");
  const barRows = viz.children.filter(c => /(^| )bar-row( |$)/.test(c.className));
  eq(barRows.length, 4, "★ 不破 T27 不变量：#viz 内仍恰 4 个 .bar-row");
  ok(!barRows.some(r => /(^| )lyric-follow( |$)/.test(r.className)), "跟随条不带 bar-row class（不被误算作网格行）");
}

section("T149b 帧层 · 跟随当前行 + 换行跟随 + 字块着色");
{
  const { beat } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" },     // 第 1 小节 → 行 0
    { t: 192, dur: 24, ch: "好" },   // 第 2 小节 → 行 1
  ]);
  beat.Viz.buildViz();
  const int = beat.Viz.internals();
  beat.Viz.paintLyric(0, 0, undefined, 0);   // 强制当前行 = 0（a 走内部 arrangeCur）
  const follow = int.lyricFollowEl;
  ok(!follow.hidden, "当前行有词 → 跟随条显示");
  eq(beat.Viz.internals().followRow, 0, "followRow = 0");
  const chips = follow.children.filter(c => /(^| )lyric-chip/.test(c.className));
  eq(chips.length, 1, "行 0 字块 = 1（你）");
  eq(chips[0].children[1].textContent, "你", "字块文字复用 lyricRows[0]");
  ok(/translateY\(/.test(follow.style.transform), "translateY 已设置（贴当前行下缘）");
  const y0 = numOf(follow.style.transform);
  ok(y0 > 0, "translateY 在行下缘（>0）");

  beat.Viz.paintLyric(0, 1, undefined, 1);    // 当前行 → 1
  eq(beat.Viz.internals().followRow, 1, "换行 → followRow = 1");
  const chips1 = follow.children.filter(c => /(^| )lyric-chip/.test(c.className));
  eq(chips1.length, 1, "行 1 字块 = 1（好）");
  eq(chips1[0].children[1].textContent, "好", "字块文字随行切换");
  const y1 = numOf(follow.style.transform);
  ok(y1 > y0, "★ translateY 随当前行下移（换行跟随）");

  beat.Viz.paintLyric(0, -1, undefined, -1);  // 停机/预备 → 隐藏
  ok(follow.hidden, "当前行 = -1 → 跟随条隐藏");
}

section("T149c 收起不变量 · 预设模式/无词 → 跟随条隐藏 + 行距还原");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Viz.buildViz();
  ok(beat.Viz.internals().lyricFollowEl.hidden, "曲式有词 → 跟随条已建但停机隐藏");
  ok(els["viz"].classList.contains("lyric-follow-on"), "曲式有词 → 行距类在");

  beat.Store.S.playMode = "preset";
  beat.Viz.buildViz();
  ok(beat.Viz.internals().lyricFollowEl.hidden, "预设模式 → 跟随条隐藏");
  ok(!els["viz"].classList.contains("lyric-follow-on"), "预设模式 → 行距类移除（行距还原，零残留）");
}

section("T149d 双关放大 · 座次尺+时值标注都关 ⇒ 跟随条移入行内（translateY 用行内偏移 + CSS 增高增大）");
{
  const { beat } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Store.S.showRuler = false;
  beat.Store.S.showDurLabel = false;
  beat.Viz.buildViz();
  const follow = beat.Viz.internals().lyricFollowEl;
  beat.Viz.paintLyric(0, 0, undefined, 0);
  ok(!follow.hidden, "双关模式 → 跟随条仍显示");
  const topIn = beat.Viz.internals().rowGeo[0].top;   // 每次 buildViz 后重新取（cacheGeo 会重排数组，旧引用失效）
  eq(numOf(follow.style.transform) - topIn, 50, "★ 双关 ⇒ 位移 = FOLLOW_INSET_Y(50)，即移入行内原标注带（对照普通模式 +88）");
  // 对照普通模式：把两开关打开后应回到 +88 口径
  beat.Store.S.showRuler = true;
  beat.Store.S.showDurLabel = true;
  beat.Viz.buildViz();
  beat.Viz.paintLyric(0, 0, undefined, 0);
  const topOut = beat.Viz.internals().rowGeo[0].top;
  const barH = beat.Viz.internals().rowEls[0].offsetHeight;   // 行盒高（真实浏览器 86；jsdom 下回退值，环境无关地用真实量）
  eq(numOf(follow.style.transform) - topOut, barH + 2, "普通模式 ⇒ 位移 = 行盒高 + 2（贴行下缘，与双关的 50 明显不同）");
  // CSS 放大规则存在（增高 32px / 字 17px 800）——jsdom 不解析 class 计算样式，故直接查源
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  ok(/#viz\.no-ruler\.no-durlab \.lyric-follow\{height:32px\}/.test(src), "CSS：双关放大 .lyric-follow{height:32px} 已就位");
  ok(/#viz\.no-ruler\.no-durlab \.lyric-follow \.lyric-char\{font-size:calc\(17px \* var\(--cs, 1\)\);font-weight:800\}/.test(src), "CSS：双关放大 .lyric-char{font-size:17px;font-weight:800} 已就位");
}

section("T149e 设置开关 · 歌词跟随条关 ⇒ 隐藏并退回纯底部轨（行距类零残留）");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Viz.buildViz();
  ok(els["viz"].classList.contains("lyric-follow-on"), "默认开 → 行距类在、跟随条挂上");
  beat.Store.S.lyricFollow = false;
  beat.Viz.buildViz();   // buildLyricLane → showFollow → syncFollowChrome → hideFollow
  ok(beat.Viz.internals().lyricFollowEl.hidden, "设置关 → 跟随条隐藏");
  ok(!els["viz"].classList.contains("lyric-follow-on"), "设置关 → 行距类移除（行距还原，零残留）");
  beat.Viz.paintLyric(0, 0, undefined, 0);   // 播放路径也不应冒出来
  ok(beat.Viz.internals().lyricFollowEl.hidden, "设置关 + 播放 → 跟随条仍隐藏");
}

section("T149f 双关放大往返 · 模式切换无残留、位移正确跟随");
{
  const { beat } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Viz.buildViz();
  const follow = beat.Viz.internals().lyricFollowEl;
  // 普通 → 双关
  beat.Store.S.showRuler = false; beat.Store.S.showDurLabel = false;
  beat.Viz.buildViz(); beat.Viz.paintLyric(0, 0, undefined, 0);
  eq(numOf(follow.style.transform) - beat.Viz.internals().rowGeo[0].top, 50, "双关 ⇒ 行内偏移 50");
  ok(!follow.hidden, "双关 ⇒ 显示");
  // 双关 → 普通
  beat.Store.S.showRuler = true; beat.Store.S.showDurLabel = true;
  beat.Viz.buildViz(); beat.Viz.paintLyric(0, 0, undefined, 0);
  const barH = beat.Viz.internals().rowEls[0].offsetHeight;
  eq(numOf(follow.style.transform) - beat.Viz.internals().rowGeo[0].top, barH + 2, "普通 ⇒ 贴行下缘（行盒高 + 2）");
  ok(!follow.hidden, "普通 ⇒ 显示");
  // 普通 → 关跟随条
  beat.Store.S.lyricFollow = false;
  beat.Viz.buildViz();
  ok(follow.hidden, "关跟随条 ⇒ 隐藏");
  // 关 → 开（行距类应复挂）
  beat.Store.S.lyricFollow = true;
  beat.Viz.buildViz(); beat.Viz.paintLyric(0, 0, undefined, 0);
  ok(!follow.hidden, "再开 ⇒ 显示（行距类复挂，零残留）");
}
