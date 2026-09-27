/* BeatSight 自动化测试 · 磁性吸附 + 跟播打轴（v2.48.0）
   T117 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · ②磁吸：拖动中半拍（LYRIC_BASE）内最近的发声锚点（secOnsetTicks）优先于格吸附，
       命中时 chip 直落锚点 + 蓝引导线画在其小节行内；**起点锚排除**（否则原地小拖被吸
       回起点，T116b 首跑即证）；锚点只在自由域 [min,max] 内参与（吸过去会顶进邻字）。
     · ①打轴：播放本段（单段循环、**不配爬坡**——BPM 一变节奏全歪），空格 = 当前字 t =
       可听位置（onset 端点 + 音频时钟插值，~1 tick 精度）吸附 12t，且不早于前字 + 1 格
       （快于十六分的敲击超出记谱粒度，顺移而不是让归一化丢字）；前字 dur 收到不越过
       本字（同因）；↓ = 跳过；Esc/打完自动结束；tap 期间 Space 不再是播放/暂停（键盘层）。
   桩口径：span = 192（一平方），perTick = 600/192 = 3.125；锚点集 = [0,48,72,96,144]。 */
"use strict";
const { loadApp, ok, eq, section, FakeAudioContext, drive } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => r.children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className))));

function setup(){
  const { beat, els, fireWin, fireDoc } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材S", meter: 4, bars: [[{ t:48, dir:"D" }, { t:24, dir:"U" }, { t:24, dir:"D" }, { t:48, dir:"U" }, { t:48 }]] },
  ] })).ok, "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  return { beat, els, fireWin, fireDoc, arr, id: arr.id, sec: arr.sections[0], uid: arr.sections[0].uid };
}
const PER_TICK = 600 / 192;
const px = ticks => ticks * PER_TICK;

/* ================= 场景 T117a：磁吸 —— 锚点优先于格 / 起点锚排除 / 引导线 ================= */
section("T117a 磁吸 · 半程内贴锚点 / 起点锚不回吸 / 引导线行内定位");
{
  const { beat, els, fireWin, id, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 96, dur: 24, ch: "眠" }, { t: 150, dur: 24, ch: "觉" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  eq(chips.length, 3, "三个字块上轨");

  /* 拖「春」到 tc=41：格吸附会给 36，磁吸给最近的锚点 48（|41−48|=7 ≤ 半拍 24） */
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + px(41) });
  eq(chips[0].style.left, "25%", "拖动中 chip 已被磁到锚点 48（48/192 = 25%）");
  const bar0 = lane.children[0];
  const guide = bar0.children.find(c => /arg-lyric-guide/.test(c.className));
  ok(!!guide, "★ 引导线画在锚点所在的小节行内");
  eq(guide && guide.style.left, "25%", "引导线与锚点同位");
  fireWin("pointerup", {});
  eq(beat.Store.findLyric(id, uid).chars[0].t, 48,
     "★ 松手落锚点 48——格吸附会给 36（round(41/12)=3），磁吸覆盖盲格");

  /* 再拖到 tc=60：格吸附会原地 60，磁吸给 72（a0=48 已排除——起点锚不回吸） */
  const chips2 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));
  chips2[0].fire("pointerdown", { clientX: 200 });
  fireWin("pointermove", { clientX: 200 + px(12) });
  fireWin("pointerup", {});
  eq(beat.Store.findLyric(id, uid).chars[0].t, 72,
     "★ tc=60 时格吸附会得 60，磁吸得 72（48 是起点锚，被排除）");

  /* 拖完引导线必摘 */
  const lane2 = byCls(lyOf(els, 0), "arg-lyric-lane");
  ok(!lane2.children.some(r => r.children.some(c => /arg-lyric-guide/.test(c.className))),
     "拖完引导线摘除（含松手提交路径）");
  beat.Arrange.close();
}

/* ================= 场景 T117b：跟播打轴 —— 端到端 ================= */
section("T117b 打轴 · 起播即单段循环 / 空格落字 / ↓ 跳过 / 打完自动收 / 不丢字");
{
  const { beat, els, fireWin, arr, id, sec, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();

  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  ok(beat.Arrange.tapState() !== null, "进入打轴态");
  eq(els["tapBar"].hidden, false, "主视图出现打轴悬浮条");
  eq(els["tapTotal"].textContent, "3", "总字数上条");

  const ac = FakeAudioContext.last;
  drive(ac, beat, 0.6);                                   // 起播 + 推进：onset 端点落地

  fireWin("keydown", { key: " ", code: "Space" });        // 敲第 1 字
  let st = beat.Arrange.tapState();
  ok(st !== null && st.k === 1, "敲击推进到第 2 字");
  let chars = beat.Store.findLyric(id, uid).chars;
  eq(chars.length, 3, "★ 敲击不丢字（归一化的「重叠丢弃」被顺移 + dur 收口挡住）");
  ok(chars[0].t > 0, "第 1 字 t = 敲击时刻（>0，不再是均分占位）");
  eq(chars[0].t % 12, 0, "落点吸附 12t（格）");
  eq(els["tapPos"].textContent, "2", "悬浮条进度同步");

  fireWin("keydown", { key: "ArrowDown" });               // 跳过「眠」
  st = beat.Arrange.tapState();
  eq(st && st.k, 2, "↓ 跳过：游标进到第 3 字（眠 未被赋新时刻）");
  ok(beat.Store.findLyric(id, uid).chars[1].t >= beat.Store.findLyric(id, uid).chars[0].t + 12,
     "被跳过的字不与前字重叠（≥ 前字 + 1 格），不丢");

  drive(ac, beat, 0.5);
  fireWin("keydown", { key: " ", code: "Space" });        // 敲第 3 字
  eq(beat.Arrange.tapState(), null, "★ 打完最后一字自动结束打轴");
  eq(els["tapBar"].hidden, true, "悬浮条收起");
  chars = beat.Store.findLyric(id, uid).chars;
  eq(chars.length, 3, "打轴全程零丢字");
  ok(chars.every(c => c.dur >= 12), "全部 dur ≥ 12（最短时值下限）");
  ok(chars[2].t >= chars[0].t, "字序与敲击序一致（后敲不早于先敲）");

  /* 重新进入 = 从头重打（无损重做语义） */
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  ok(beat.Arrange.tapState() !== null && beat.Arrange.tapState().k === 0, "重进打轴：游标回到第 1 字");
  beat.Arrange.tapEnd();
  eq(beat.Arrange.tapState(), null, "tapEnd 收起");
  beat.Arrange.close();
}

/* ================= 场景 T117c：打轴期键盘层 —— Space 不再是播放/暂停 ================= */
section("T117c 键盘层 · 打轴期空格改投打轴机 / 输入框打字优先");
{
  const { beat, els, fireWin, arr, id, sec, uid } = setup();
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  const playing0 = beat.Store.S.playing;
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  drive(FakeAudioContext.last, beat, 0.5);
  const playingInTap = beat.Store.S.playing;
  fireWin("keydown", { key: " ", code: "Space" });
  ok(beat.Store.S.playing === playingInTap && playingInTap !== playing0,
     "★ 打轴期空格 = 落字，播放状态不被切换（键盘层拦截在 Controls 之前）");
  beat.Arrange.tapEnd();
  beat.Arrange.close();
  void els;
}
