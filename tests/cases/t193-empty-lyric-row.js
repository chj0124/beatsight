/* BeatSight 自动化测试 · 无歌词时不得在跑道下方画空条（v3.33.8 回归）
   T193
   ---------------------------------------------------------------------------
   【现象】用户实拍："在没有歌词的情形下，依然会在跑道下面渲染"——跑道下方多出一条浅色圆角空条。
   【根因】那条空条是**当前槽**歌词行的底纹 `.lyric-row.cur{background:rgba(var(--veil),.05)}`。
     底纹的语义是"这一行是正在唱的那一行"，但该槽**一个 chip 都没有**时它照画
     ⇒ 看起来像凭空多出一条歌词带（预设/间奏段、或本窗口无词的槽都会命中）。
   【修法】空行（无 chip）打 `lyr-empty`，底纹规则排除它：`.lyric-row.cur.lyr-empty{background:none}`；
     标记在**建行时**与帧内状态同步两处都写（前者防"sig 未变跳过"的漏标）。
   ★ 名字不用 `.empty`：仓库的"死样式清单"里有同名历史条目（t131 同族闸门会当场红）。
   ================================================================================ */
"use strict";
const { loadApp, ok, section, html } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const arrSeed = () => ({
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t1", name: "无词曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
  ]}),
  "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
    arrangeSel: { id: "t1", from: 0, to: 3, loop: true } }),
});

section("T193a 无词窗口：每一行歌词都带 lyr-empty（底纹据此不画）");
{
  const app = loadApp(arrSeed());
  app.beat.Viz.buildViz();
  const rows = app.beat.Viz.internals().lyricRows;
  ok(rows.length >= 1, "前提：歌词轨建出了行（" + rows.length + "）");
  ok(rows.every(r => (r.chipEls ? r.chipEls.length : 0) === 0), "前提：本例窗口内没有任何歌词 chip");
  ok(rows.every(r => r.el.classList.contains("lyr-empty")),
    "★★ 无词的行都带 lyr-empty ⇒ .lyric-row.cur 的底纹被排除（不再凭空渲染空条）");
}

section("T193b 有词窗口：行不带 lyr-empty（当前槽底纹照旧保留）");
{
  const app = loadApp(arrSeed());
  app.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" }]);
  app.beat.Viz.buildViz();
  const rows = app.beat.Viz.internals().lyricRows;
  const withChips = rows.filter(r => r.chipEls && r.chipEls.length);
  ok(withChips.length >= 1, "前提：窗口里有带词的行（" + withChips.length + " 行）");
  ok(withChips.every(r => !r.el.classList.contains("lyr-empty")),
    "★★ 带词的行**不带** lyr-empty ⇒ 当前槽的底纹不受影响（不能把底纹一并修没）");
}

section("T193c 源码钉：底纹排除规则在位，且用的是不会被死样式清单拦下的类名");
{
  ok(/\.lyric-row\.cur\.lyr-empty\{background:none\}/.test(html),
    "★★ 底纹规则 .lyric-row.cur.lyr-empty{background:none} 在位");
  ok(/classList\.toggle\("lyr-empty", \(r\.chipEls && r\.chipEls\.length\)\)|classList\.toggle\("lyr-empty", !\(row\.chipEls && row\.chipEls\.length\)\)/.test(html)
    || (html.match(/lyr-empty"/g) || []).length >= 2,
    "★ 建行时与帧内同步两处都写标记（至少 2 处）");
  ok(!/\.empty\{/.test(html), "★ 没有引入 .empty 这个与死样式清单同名的类");
}
