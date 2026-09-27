/* BeatSight 自动化测试 · 字块拖动二维跟手 + 行序号（v2.53.0）
   T124 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · A·perTick 1:1：分行后换算口径 = 行宽 ÷ 每行 tick（旧口径 ÷ 全段 tick 会让
       字块视觉速度 = 鼠标速度 × 行数——「字块偏离鼠标」根因）。拖 300px（行宽 600 的一半）
       字块走行内 50%。
     · B·纵向换行：真浏览器按指针 Y 定目标行（geo 几何，桩无 gBCR）；字块元素跨行时就地
       搬行（appendChild 到目标 barrow）——两种路径下 t 都是唯一事实源，视觉行一律按 t
       推导；邻居钳制把 t 拉回哪行字块就回哪行（「不吃邻居」跨行依然成立）。
     · C·上浮仅触屏：-22px 防遮挡 lift 只在 pointerType=touch 时挂 .touch 类。
     · 行序号：CSS 伪元素 + counter（零 DOM 节点），lane 左内边距让位。
   桩口径：span = 384（两平方），barTicks = 192，rows = 2，行宽 600 → perTick = 3.125。
   geo 在桩上恒 null → 纵向 Y 路径由真机验收，桩测「t 越过行边界即搬行」的回退路径。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => r.children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className))));

function setup(){
  const { beat, els, fireWin } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材S", meter: 4, bars: [[{ t:48, dir:"D" }, { t:24, dir:"U" }, { t:24, dir:"D" }, { t:48, dir:"U" }, { t:48 }]] },
  ] })).ok, "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 2 }] },   // 两小节 → 两行
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  return { beat, els, fireWin, id: arr.id, uid: arr.sections[0].uid };
}
const PER_TICK = 600 / 192;                             // 行宽 600 / 每行 192tick
const px = ticks => ticks * PER_TICK;
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};

/* ================= 场景 T124a：横向 1:1 + 跨行就地搬行 ================= */
section("T124a 二维跟手 · 行内 1:1（300px = 50%）/ 拖过行边界字块搬进下一行");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 300, dur: 24, ch: "眠" }]);   // 眠 在第 2 行
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  eq(lane.children.length, 2, "两小节 = 两行");
  const chip0 = chipsOf(lane)[0];
  ok(chip0.parentNode === lane.children[0], "起点在第 1 行（恒等比较：parentNode 与 children 循环引用，不走 eq 的 JSON 序列化）");

  chip0.fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 300 });         // +300px = 96 tick（行宽一半）
  eq(chip0.style.left, "50%", "★ 行内 1:1：300px → 行内 50%（旧口径会 ×2 飞到 100%）");
  ok(chip0.parentNode === lane.children[0], "96 tick 仍在第 1 行");

  fireWin("pointermove", { clientX: 100 + 600 });         // +600px = 192 tick → 越过行边界
  ok(chip0.parentNode === lane.children[1], "★ 跨过行边界：字块就地搬进第 2 行（不再滑出行外）");
  eq(chip0.style.left, "0%", "第 2 行行首");
  fireWin("pointerup", {});
  eq(chars(beat, id, uid)[0].t, 192, "★ 松手落 192（磁吸 192 = 第 2 行首个锚点，与预览同源）");

  /* 反向：拖回第 1 行 */
  const lane2 = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chip = chipsOf(lane2)[0];                          // 春@192 在第 2 行
  chip.fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 - 300 });          // −300px = −96 tick → 96（第 1 行）
  ok(chip.parentNode === lane2.children[0], "★ 反向跨行：字块搬回第 1 行");
  fireWin("pointerup", {});
  eq(chars(beat, id, uid)[0].t, 96, "落 96（磁吸 96）");
  beat.Arrange.close();
}

/* ================= 场景 T124b：邻居边界跨行语义 =================
   桩无 geo → 行由 t 推导（横向口径）：拖过邻字半程 = 换位接管（F4 甲，v2.47 既有语义）；
   真浏览器 geo 路径下跨行手势只钳制不换位（v2.53 B：换行 ≠ 换位），由真机验收。 */
section("T124b 不吃邻居 · 桩口径：拖过邻字半程 = 换位接管 / 钳制内自由移动");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chip0 = chipsOf(lane)[0];
  chip0.fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 600 });          // 想直接拖到第 2 行（192），越过眠半程
  fireWin("pointerup", {});                                // 换位在松手时提交
  eq(chars(beat, id, uid)[0].ch, "眠",
     "★ 越过邻字半程 → 换位接管（F4 甲）：眠@0、春@96（跨行长拖不是穿透）");
  eq(chars(beat, id, uid)[1].t, 96, "春 接 眠 的原位 96");
  beat.Arrange.close();
}

/* ================= 场景 T124c：上浮仅触屏 ================= */
section("T124c 触屏标记 · touch 才挂 .touch（上浮），鼠标不浮");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  let lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  let chip = chipsOf(lane)[0];
  chip.fire("pointerdown", { clientX: 100, pointerType: "touch" });
  fireWin("pointermove", { clientX: 130, pointerType: "touch" });   // 触屏阈 8px：30px 过阈
  eq(/(^| )touch( |$)/.test(chip.className), true, "★ 触屏拖拽挂 .touch（上浮生效）");
  fireWin("pointerup", { pointerType: "touch" });

  lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  chip = chipsOf(lane)[0];
  chip.fire("pointerdown", { clientX: 100 });              // 鼠标（无 pointerType）
  fireWin("pointermove", { clientX: 130 });
  eq(/(^| )touch( |$)/.test(chip.className), false, "★ 鼠标拖拽无 .touch（字块贴指针）");
  eq(/(^| )dragging( |$)/.test(chip.className), true, "拖拽态本身照常");
  fireWin("pointerup", {});
  beat.Arrange.close();
}

/* ================= 场景 T124d：CSS 契约（t101 同口径） ================= */
section("T124d CSS 契约 · 行序号伪元素 / lane 序号位 / 上浮规则仅 .touch");
{
  ok(/\.arg-lyric-barrow::before\{content:counter\(argbar\)/.test(html),
     "★ 行序号 = 伪元素 + counter（零 DOM 节点）");
  ok(/\.arg-lyric-lane\{[^}]*counter-reset:argbar/.test(html) &&
     /\.arg-lyric-lane\{[^}]*padding-left:18px/.test(html),
     "★ lane 计数复位 + 左内边距让出序号位");
  ok(/\.arg-lyric-chip\.dragging\.touch\{transform:translateY\(-22px\)/.test(html) &&
     !/\.arg-lyric-chip\.dragging\{[^}]*transform/.test(html),
     "★ 上浮 transform 只在 .dragging.touch（鼠标不浮）");
}
