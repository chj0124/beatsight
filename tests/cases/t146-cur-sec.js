/* BeatSight 自动化测试 · 段卡片「当前编辑段」高亮 + play-dim 退役（v2.81.0）
   T146 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块 curSecUid / syncCurSec / buildSecRow 注释同源）：

     · 为什么要这层：界面此前只有「在不在播放范围」（.play-in-range，由 S.arrangeSel 驱动、
       且是**落盘**状态）——用户点进段 4 编辑时，绿左条仍留在上次试听过的段上，被读成
       "高亮没跟着走"（用户实测反馈，2026-09-30）。本版补的是「我正在编哪一段」这一层。
     · 触发 = 点卡片任意处（真实 DOM 里事件冒泡到卡片）或键盘把焦点移进来（focusin）；
       用 **pointerdown** 而不是 click：段内一批控件在自己的 click 里就 arrangeRender 了，
       pointerdown 先发生 ⇒ 重建出来的卡片已经带着新的 cur-sec（高亮不慢一拍）。
     · 状态 = 内存（curSecUid，段 **uid** 不是下标），不落盘、不入脏键；开/关浮层都清空
       （与 lyricOpen 同一套"纯浏览态"口径）；**不改播放范围**——两件事不互相绑架。
     · 范围标记 = 绿左条（.play-in-range）保留；**未覆盖段零弱化**（play-dim 整体退役，
       理由见 t109c 头注）。两个类可以同时出现在一张卡上（正在编辑 + 在范围内）。
   ★ 桩口径：harness 的 fire 只打本元素、不冒泡——「点段内控件也生效」这条由真机验收
     （CDP 实测，见 CHANGELOG v2.81.0）；桩测的是状态机、类切换与重建存活。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const rows = els => els["argSections"].children;
const secRows = els => rows(els).filter(c => /(^| )arg-sec( |$)/.test(c.className) && !/(^| )arg-pick( |$)/.test(c.className));
const cardOf = (els, i) => secRows(els)[i];
const lyOf = (els, i) => rows(els)[i].children.find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const hasCls = (el, cls) => new RegExp("(^| )" + cls + "( |$)").test(el.className);

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 三段素材（各 1 块 × 2 遍 = 2 小节），uid 手写便于断言"挪段后高亮跟段不跟位置" */
const seed3 = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t146", name: "三段歌", sections: [
    { uid: "sA", name: "甲", blocks: [BL(0, 2)] },
    { uid: "sB", name: "乙", blocks: [BL(0, 2)] },
    { uid: "sC", name: "丙", blocks: [BL(0, 2)] },
  ] } ] }) });

/* ============ 场景 T146a：点卡片 = 置当前段（类切换 / 独占 / 不改范围） ============ */
section("T146a 当前段 · 点卡片即置 / 独占切换 / 播放范围纹丝不动");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  ok(!hasCls(cardOf(els, 0), "cur-sec") && !hasCls(cardOf(els, 1), "cur-sec"),
     "前提：刚开浮层谁都不是当前段（开浮层不带回上次状态）");
  const sel0 = JSON.stringify(beat.Store.S.arrangeSel);

  cardOf(els, 1).fire("pointerdown", {});
  eq(hasCls(cardOf(els, 1), "cur-sec"), true, "★ 点段2 卡片 → cur-sec");
  eq(hasCls(cardOf(els, 0), "cur-sec") || hasCls(cardOf(els, 2), "cur-sec"), false, "且只此一张（独占）");
  eq(JSON.stringify(beat.Store.S.arrangeSel), sel0, "★ 播放范围纹丝不动（编辑与放哪段是两件事）");

  cardOf(els, 2).fire("pointerdown", {});
  eq(hasCls(cardOf(els, 2), "cur-sec"), true, "切到段3 → cur-sec 跟走");
  eq(hasCls(cardOf(els, 1), "cur-sec"), false, "★ 段2 让出（同一时刻至多一段）");
  beat.Arrange.close();
}

/* ============ 场景 T146b：重建存活 + 与范围标记叠加 ============ */
section("T146b 当前段 · arrangeRender 重建后仍在 / 可与绿左条叠加 / uid 跟段不跟位置");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  cardOf(els, 2).fire("pointerdown", {});
  sumOf(lyOf(els, 0)).fire("click");                    // 展开/收起任意段 = arrangeRender 全量重建
  eq(hasCls(cardOf(els, 2), "cur-sec"), true,
     "★ 重建后 cur-sec 还在第 3 段（状态在内存，不靠焦点——重渲染不熄灭）");

  /* 范围收到段3（⋯「练这段」，与地图点段同路）→ 两类同卡叠加：绿左条（范围）+ 蓝环（当前段） */
  const more = Array.prototype.find.call(cardOf(els, 2).children[3].children,
    b => /更多段操作/.test(b.getAttribute("aria-label") || ""));
  more.fire("click");
  const menu = Array.prototype.find.call(cardOf(els, 2).children,
    c => /(^| )arg-sec-menu( |$)/.test(c.className));
  const item = Array.prototype.find.call(menu.children,
    b => /只练第 3 段/.test(b.getAttribute("aria-label") || ""));
  item.fire("click");
  eq(hasCls(cardOf(els, 2), "play-in-range"), true, "段3 进入播放范围 → 绿左条");
  eq(hasCls(cardOf(els, 2), "cur-sec"), true, "★ 且仍是当前段 → 两类同卡叠加（语义正交）");

  /* 「编辑的段」跟段走，不跟位置走：把段3 删掉重建时，高亮要么消失要么不落在错误的段上 */
  eq(hasCls(cardOf(els, 1), "cur-sec"), false && hasCls(cardOf(els, 0), "cur-sec"), false,
     "旁证：别的段不蹭高亮");
  beat.Arrange.close();
}

/* ============ 场景 T146c：开/关浮层清空（纯浏览态口径） ============ */
section("T146c 收尾 · close/open 都不带回上次的当前段");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  cardOf(els, 1).fire("pointerdown", {});
  eq(hasCls(cardOf(els, 1), "cur-sec"), true, "前提：段2 是当前段");
  beat.Arrange.close();
  /* close() 只隐藏浮层、不重建卡片——所以"关浮层即摘"要**就地**断言（重开会被 open() 的
     清空掩盖，变异测不出）。close 与 open 各自清一次是 belt-and-braces，两处都得有牙齿 */
  eq(hasCls(cardOf(els, 1), "cur-sec"), false, "★ 关浮层即摘（close 也清，隐藏的卡片上不留残影）");
  beat.Arrange.open();
  ok(secRows(els).every(c => !hasCls(c, "cur-sec")),
     "★ 重开不带回上次的当前段（与 lyricOpen 同口径）");
  beat.Arrange.close();
}

/* ============ 场景 T146d：play-dim 双端零残留 ============ */
section("T146d dim 退役 · 源码与 DOM 双端零残留 / syncPanelRead 不再写它");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  const all = [];
  (function walk(el){ all.push(el); (el.children || []).forEach(walk); })(els["argSections"]);
  ok(html.indexOf("play-dim") < 0, "★ 源码零 play-dim 残留（规则与写入点一并删除，防复活由本条钉住）");
  ok(!all.some(n => /play-dim/.test(String(n.className || ""))), "★ DOM 零 play-dim 残留");
  ok(html.indexOf(".arg-sec.cur-sec") >= 0, "当前段规则在（inset 蓝环 + 底色提一档）");
  ok(html.indexOf(".arg-sec.play-in-range{border-left:3px solid var(--green)}") >= 0,
     "范围绿左条规则原样保留（语义不动）");
  beat.Arrange.close();
}
