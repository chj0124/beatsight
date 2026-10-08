/* BeatSight 自动化测试 · 落点单一事实源 getDropTarget + ghost 预览 + 读数气泡（v2.50.0）
   T120 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · D1：落点计算只有一个真相——ghost 预览与松手提交**共用 getDropTarget**；
       预览-提交一致性 = 「拖动中 ghost 的 left/width」与「松手落库的 t/dur」由同一函数
       同一输入算出。四分支：格吸附 / 磁吸命中 / 邻界钳住 / 换位（overR ≥ 邻字半程）。
     · D3：拖动中字块上浮（transform 视觉位移，tick 换算零改动）+ 读数气泡
       「第 X 小节 · 第 Y 拍（相对原位 ±N 格）」；松手/取消 ghost 与气泡必摘
       （摘除走 hidden + remove 双保险——桩的 remove 是空操作，hidden 才可断言）。
   桩口径：span = 192（一平方），perTick = 600/192 = 3.125；锚点集 = [0,48,72,96,144]。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
/* v2.77.0：行容器包 [和弦格][字块行]——字块取行容器里的 barrow 孩子 */
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));
const ofCls = (root, cls) => root.children.filter(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
/* ghost/bubble 挂在小节行（barrow）内，不在 lane 直接子级——逐行收集 */
const inLane = (lane, cls) => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => (r.children || []).filter(c => new RegExp("(^| )" + cls + "( |$)").test(c.className))));

function setup(){
  const { beat, els, fireWin } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材S", meter: 4, bars: [[{ t:48, dir:"D" }, { t:24, dir:"U" }, { t:24, dir:"D" }, { t:48, dir:"U" }, { t:48 }]] },
  ] })).ok, "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Store.upsertLyric(arr.id, arr.sections[0].uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }, { t: 150, dur: 24, ch: "觉" }]);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  return { beat, els, fireWin, id: arr.id, uid: arr.sections[0].uid, span: 192 };
}
const PER_TICK = 600 / 192;
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};
/** 构造 getDropTarget 的输入（纯函数单测：不经 UI，直接给 drag 形状的对象） */
function dOf(mode, over){
  return { mode: mode, k: 0, t0: 0, d0: 24, t: over.t, d: over.d || 24,
    overR: over.overR || 0, overL: over.overL || 0, magnet: over.magnet === undefined ? -1 : over.magnet,
    chars: [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }, { t: 150, dur: 24, ch: "觉" }],
    lctx: { span: 192 } };
}

/* ================= 场景 T120a：getDropTarget 四分支单测 ================= */
section("T120a 单一事实源 · 格吸附 / 磁吸命中 / 邻界钳住 / 换位判定（+ dur 分支）");
{
  const { beat } = setup();
  const gdt = beat.Arrange.getDropTarget;
  ok(!!gdt, "getDropTarget 已导出");
  let r = gdt(dOf("move", { t: 41 }));                     // 吸附 round(41/6)=7 → 42
  eq(r.t, 42, "★ 格吸附：41 → 42");
  eq(r.swap, 0, "格吸附不换位");
  r = gdt(dOf("move", { t: 41, magnet: 48 }));             // 磁吸优先于格吸附
  eq(r.t, 48, "★ 磁吸命中：48 压过格吸附 36");
  eq(r.magnet, 48, "magnet 原样透出");
  r = gdt(dOf("move", { t: 200 }));                        // 越界：钳到 next.t - dur = 72
  eq(r.t, 72, "★ 邻界钳住：200 → 72（cap = 96−24）");
  r = gdt(dOf("move", { t: 72, overR: 24 }));              // overR 24 ≥ 邻字半程 12 → 与后字换位
  eq(r.swap, 1, "★ 换位判定：overR×2 ≥ 邻字 dur");
  eq(r.t, 96, "换位落点 = 邻字原位 96");
  r = gdt(dOf("move", { t: 72, overR: 11 }));              // 不足半程 → 不换
  eq(r.swap, 0, "overR×2 = 22 < 24：不换位");
  r = gdt(dOf("dur", { t: 0, d: 37 }));                    // dur 分支：吸附 36，被 next.t 钳制
  eq(r.dur, 36, "★ dur 分支：37 → 36（格吸附）");
  eq(r.t, 0, "dur 分支不动起点");
}

/* ================= 场景 T120b：ghost 预览-提交一致性 ================= */
section("T120b 预览-提交一致性 · 拖动中 ghost.left = 提交 t 的换算值");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 41 * PER_TICK });  // tc=41 → 磁吸 48
  const ghosts = inLane(lane, "arg-lyric-ghost");
  eq(ghosts.length, 1, "拖动中 ghost 上轨");
  eq(ghosts[0].style.left, "25%", "★ ghost.left = 48/192 = 25%（与最终提交同一函数算出）");
  fireWin("pointerup", {});
  eq(chars(beat, id, uid)[0].t, 48, "松手提交 t=48 —— 与预览逐位一致");
  beat.Arrange.close();
}

/* ================= 场景 T120c：ghost/气泡松手必摘（含 pointercancel） ================= */
section("T120c 建摘对称 · 松手摘除 / pointercancel 摘除（hidden 双保险）");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  chipsOf(lane)[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 41 * PER_TICK });
  let ghost = inLane(lane, "arg-lyric-ghost")[0];
  let bubble = inLane(lane, "arg-lyric-bubble")[0];
  ok(!!ghost && !!bubble, "ghost 与气泡都在");
  fireWin("pointerup", {});
  eq(ghost.hidden, true, "★ 松手后 ghost 摘除（hidden）");
  eq(bubble.hidden, true, "★ 松手后气泡摘除（hidden）");

  /* pointercancel 路径（不触发重渲染，摘除逻辑必须自己成立） */
  const lane2 = byCls(lyOf(els, 0), "arg-lyric-lane");
  chipsOf(lane2)[1].fire("pointerdown", { clientX: 200 });
  fireWin("pointermove", { clientX: 200 + 20 * PER_TICK });
  ghost = inLane(lane2, "arg-lyric-ghost")[0];
  bubble = inLane(lane2, "arg-lyric-bubble")[0];
  ok(!!ghost && !!bubble && ghost.hidden === false, "第二次拖动：ghost/气泡重建且可见");
  fireWin("pointercancel", {});
  eq(ghost.hidden, true, "★ pointercancel 后 ghost 摘除");
  eq(bubble.hidden, true, "★ pointercancel 后气泡摘除");
  eq(/(^| )dragging( |$)/.test(chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[1].className), false,
     "cancel 后 dragging 类摘除");
  beat.Arrange.close();
}

/* ================= 场景 T120d：气泡读数格式 + 换位脉冲 ================= */
section("T120d 气泡格式 · 小节/拍/相对原位格数；swap-hint 脉冲挂邻字");
{
  const { beat, els, fireWin, id, uid } = setup();
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 41 * PER_TICK });
  const bubble = inLane(lane, "arg-lyric-bubble")[0];
  eq(bubble.textContent, "第 1 小节 · 第 2 拍（相对原位 +8 格）",
     "★ 气泡文本：48t = 第 1 小节 · 第 2 拍，+48t = +8 格（6t/格）");
  fireWin("pointerup", {});

  /* 顶着「眠」推过半程 → swap-hint 挂邻字；松手换位提交 + hint 摘除 */
  const lane2 = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips2 = chipsOf(lane2);
  chips2[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + 120 * PER_TICK });  // tc=120，钳到 72，overR=48 ≥ 12
  const chips3 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));
  eq(/(^| )swap-hint( |$)/.test(chips3[1].className), true, "★ 换位预览：邻字「眠」挂 swap-hint");
  fireWin("pointerup", {});
  /* 换位语义：春 接 眠 的原位 96；眠 接 春 的原位（本场景第一次拖拽后 = 48）。
     落库按 t 排序 → chars[0]=眠@48、chars[1]=春@96 */
  const after = chars(beat, id, uid);
  eq(after[0].ch + "|" + after[0].t, "眠|48", "换位提交：眠 接 春 的原位 48");
  eq(after[1].ch + "|" + after[1].t, "春|96", "换位提交：春 落 眠 的原位 96");
  eq(/(^| )swap-hint( |$)/.test(chips3[1].className), false, "松手后 swap-hint 摘除");
  beat.Arrange.close();
}
