/* BeatSight 自动化测试 · 视听辅助开关的随开关显隐/失效（T196） */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const pillsOf = els => (els["lyricPosGroup"].children || []).filter(c => /(^| )pill( |$)/.test(String(c.className)));

section("T196a 显示歌词关 ⇒ 位置四胶囊整组收起");
{
  const app = loadApp();
  eq(app.els["lyricPosGroup"].hidden, false, "前提：默认歌词开着 ⇒ 位置组可见");
  ok(pillsOf(app.els).length === 4, "前提：位置组里恰好四枚胶囊");
  app.els["showLyricToggle"].fire("click");
  eq(app.beat.Store.S.showLyric, false, "歌词已关");
  eq(app.els["lyricPosGroup"].hidden, true, "★★ 位置组整组收起（此前一直显示）");
}

section("T196b 连续滚动只禁 bottom；关掉全部恢复");
{
  const app = loadApp();
  app.els["scrollModeToggle"].fire("click");
  eq(app.beat.Store.S.scrollMode, true, "连续滚动已开");
  eq(app.els["lyricPosNote"].hidden, true, "★★ 未请求 bottom 时不显示限制说明");
  ok(pillsOf(app.els).every(p => p.disabled === (p.dataset.pos === "bottom")),
    "★★ auto/follow/tab 可选，只有 bottom 置灰");
  ok(!("bounceToggle" in app.els), "★ 弹跳球开关已退役（本版三开关删除，桩里也无此元素）");
  app.els["scrollModeToggle"].fire("click");
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

section("T196d 源码钉：函数口径 + 两个驱动开关的监听");
{
  ok(/function syncAuxVisibility\(\)\{/.test(html), "推导函数在位");
  ok(/g\.hidden = !lyricOn/.test(html) && /p\.disabled = pitchBlocked \|\| scrollBlocked/.test(html),
    "★★ 组收起与音高/滚动禁用口径齐备");
  ok(!/bt\.hidden = scrollOn/.test(html), "★ 「弹跳球开关随滚动隐藏」的源码已删干净（开关不存在了）");
  ok(/\$\("showLyricToggle"\)\.addEventListener\("click", syncAuxVisibility\)/.test(html)
     && /\$\("scrollModeToggle"\)\.addEventListener\("click", syncAuxVisibility\)/.test(html),
    "★★ 两个驱动开关都挂了 syncAuxVisibility");
  ok(/id="lyricPosNote"/.test(html) && /\.lyric-pos-note\{/.test(html),
    "★ 说明行标记与样式在位");
}
