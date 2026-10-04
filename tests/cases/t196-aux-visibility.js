/* BeatSight 自动化测试 · 视听辅助开关的"随开关显隐/失效"三口径（v3.33.10 用户清单 1/3/4）
   T196
   ─────────────────────────────────────────────────────────────────────────────
   ① 显示歌词关 ⇒ 歌词位置三胶囊整组收起（此前一直显示）；
   ② 连续滚动开 ⇒ 歌词恒贴本行（模式裁决 if (S.scrollMode) return "follow" 短路）⇒ 三枚置灰 + 一行说明；
   ③ 连续滚动开 ⇒ 弹跳球没有球 ⇒ 整个开关隐藏（状态不丢，关掉即恢复）。
   三条都由 syncAuxVisibility() 从 S 推导；监听挂在 showLyricToggle / scrollModeToggle 上。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const pillsOf = els => (els["lyricPosGroup"].children || []).filter(c => /(^| )pill( |$)/.test(String(c.className)));

section("T196a 显示歌词关 ⇒ 位置三胶囊整组收起");
{
  const app = loadApp();
  eq(app.els["lyricPosGroup"].hidden, false, "前提：默认歌词开着 ⇒ 位置组可见");
  ok(pillsOf(app.els).length === 3, "前提：位置组里恰好三枚胶囊");
  app.els["showLyricToggle"].fire("click");
  eq(app.beat.Store.S.showLyric, false, "歌词已关");
  eq(app.els["lyricPosGroup"].hidden, true, "★★ 位置组整组收起（此前一直显示）");
}

section("T196b 连续滚动开 ⇒ 胶囊置灰 + 说明行显示 + 弹跳球开关隐藏；关掉全恢复");
{
  const app = loadApp();
  eq(app.els["bounceToggle"].hidden, false, "前提：默认弹跳球开关可见");
  app.els["scrollModeToggle"].fire("click");
  eq(app.beat.Store.S.scrollMode, true, "连续滚动已开");
  eq(app.els["bounceToggle"].hidden, true, "★★ 弹跳球开关隐藏（该档没有球）");
  eq(app.beat.Store.S.bounce, true, "★ 状态不丢：S.bounce 仍为真（关掉连续滚动即恢复）");
  eq(app.els["lyricPosNote"].hidden, false, "★★ 说明行显示");
  ok(pillsOf(app.els).every(p => p.disabled === true), "★★ 三枚位置胶囊全部置灰（该档不生效）");
  app.els["scrollModeToggle"].fire("click");
  eq(app.els["bounceToggle"].hidden, false, "★★ 关掉连续滚动 ⇒ 弹跳球开关恢复");
  eq(app.els["lyricPosNote"].hidden, true, "说明行一并收起");
  ok(pillsOf(app.els).every(p => p.disabled === false), "★★ 胶囊恢复可点");
}

section("T196c 两个条件取与：歌词关着时，连续滚动也不得让说明行露头");
{
  const app = loadApp();
  app.els["showLyricToggle"].fire("click");
  app.els["scrollModeToggle"].fire("click");
  eq(app.els["lyricPosNote"].hidden, true, "★★ 说明行不显示");
  eq(app.els["lyricPosGroup"].hidden, true, "位置组仍收起");
}

section("T196d 源码钉：函数三条口径 + 两个驱动开关的监听");
{
  ok(/function syncAuxVisibility\(\)\{/.test(html), "推导函数在位");
  ok(/g\.hidden = !lyricOn/.test(html) && /p\.disabled = scrollOn/.test(html) && /bt\.hidden = scrollOn/.test(html),
    "★★ 三条口径齐备（组收起 / 胶囊置灰 / 弹跳球隐藏）");
  ok(/\$\("showLyricToggle"\)\.addEventListener\("click", syncAuxVisibility\)/.test(html)
     && /\$\("scrollModeToggle"\)\.addEventListener\("click", syncAuxVisibility\)/.test(html),
    "★★ 两个驱动开关都挂了 syncAuxVisibility");
  ok(/id="lyricPosNote"/.test(html) && /\.lyric-pos-note\{/.test(html),
    "★ 说明行标记与样式在位");
}
