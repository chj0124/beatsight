/* BeatSight 自动化测试 · 曲式改名 + 字块拖动新语义（v2.47.0）
   T116 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块注释同源）：
     · 1A：曲式库 chip 加 ✎ → uiPrompt → Store.renameArrange（空名拒绝 / trim / 40 上限 /
       立即落盘）；示例曲（DEMO_ID）锁定改名（pen 无 handler + aria-disabled，点击无响应即禁用）；
     · F1：拖动的边界与提交读 pointerdown 时的 Store 现值快照（drag.chars）——
       v2.46.0 键盘移动会换掉行对象，旧实现读闭包 lctx.chars 会把键盘修改静默回滚；
     · F2：拖动中连续跟手（不吸附），松手吸附 12t；被邻居钳住还在推 → chip 红边（.blocked）；
     · F4 甲（用户拍板）：顶着邻字推过其「半程」（越过量 ≥ 邻字 dur/2）松手 = 与邻字
       交换时序（t/dur 互换，字各随索引位）；越过量取末态（推过去又拉回 = 不换）。
   桩口径：lane.offsetWidth = 600（ROW_W），perTick = 600/span；dx(px) = 期望tick × 600/span。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const rows = els => els["argSections"].children;
const lyOf = (els, i) => rows(els)[i].children.find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
/* v2.77.0：行容器包 [和弦格][字块行]——字块取行容器里的 barrow 孩子 */
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));

/* S 型一平方（5 颗发声，锚点 0/48/72/96/144）；span = 1 小节 × 192t = 192；
   桩内 perTick = 600/192 = 3.125，即 1 tick = 3.125px。
   withDemo=true 时走「首次打开带出示例曲」分支（seedDemo:false = 闩缺位）——测示例曲锁定用 */
function setup(withDemo){
  const { beat, els, fireWin, storage } = loadApp(undefined, withDemo ? { seedDemo: false } : {});
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材S", meter: 4, bars: [[{ t:48, dir:"D" }, { t:24, dir:"U" }, { t:24, dir:"D" }, { t:48, dir:"U" }, { t:48 }]] },
  ] })).ok, "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "改名素材", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  return { beat, els, fireWin, storage, arr, id: arr.id, sec: arr.sections[0] };
}
const PER_TICK = 600 / 192;
const px = ticks => ticks * PER_TICK;

/* ================= 场景 T116a：曲式改名（1A） ================= */
section("T116a 曲式改名 · ✎ → uiPrompt → 落盘 / 空名拒绝 / 示例曲锁定");
{
  const { beat, els, arr, id, storage } = setup(true);
  beat.Arrange.open();
  const items = els["argList"].children.filter(c => /(^| )arg-item( |$)/.test(c.className));
  eq(items.length, 3, "曲式库三行（两首示例曲 + 素材）");
  const penDemo = items[0].children.find(c => /arg-item-ren/.test(c.className));
  /* v3.34.7：示例曲变两首，用户自建的那条排在其后 → 下标 2（原 1） */
  const penMine = items[2].children.find(c => /arg-item-ren/.test(c.className));
  ok(!!penDemo && !!penMine, "每行都有 ✎");
  eq(penDemo.getAttribute("aria-disabled"), "true", "★ 示例曲 ✎ 禁用（aria-disabled）");
  ok(penDemo.title.includes("复制"), "禁用也讲清出路（title 指向「复制一份」）");
  const msgSeen = () => !!els["modalMsg"];              // 桩惰性建节点：modalMsg 出现 = 弹窗开过
  ok(!msgSeen(), "前提：此前的操作没有开过任何弹窗");
  penDemo.fire("click");
  ok(!msgSeen(), "★ 点禁用的 ✎ → 无弹窗（禁用而不是弹窗报错）");

  penMine.fire("click");
  eq(els["modalInput"].hidden, false, "改名弹窗带输入框");
  eq(els["modalInput"].value, "改名素材", "预填当前名");
  els["modalInput"].value = "我的第一首歌";
  els["modalOk"].fire("click");
  eq(beat.Store.findArrange(id).name, "我的第一首歌", "★ 确认 → 名字落库");
  /* ★★ v2.54.1：这里原本只断言内存数组，于是「写错冷键」这类缺陷全绿漏过——
     曲式住在 beatsight.arranges，而 renameArrange 当时误调了只写 beatsight.customs 的 persistCold()，
     表现为"改完看起来成功了、刷新回退原名"。补上「目标冷键 + 重载」两连。 */
  ok(String(storage.get("beatsight.arranges") || "").includes("我的第一首歌"),
    "★ 曲式冷键 beatsight.arranges 真的写了（不是只改内存）");
  ok(!String(storage.get("beatsight.customs") || "").includes("我的第一首歌"),
    "★ 反证：没被误写进预设冷键 beatsight.customs");
  {
    const seed = {}; storage.forEach((v, k) => { seed[k] = v; });
    eq(loadApp(seed, { seedDemo: false }).beat.Store.findArrange(id).name, "我的第一首歌",
      "★★ 重载后仍是新名（刷新不回退——v2.54.1 修的就是这条）");
  }

  penMine.fire("click");
  els["modalInput"].value = "   ";
  els["modalOk"].fire("click");
  eq(beat.Store.findArrange(id).name, "我的第一首歌", "空名拒绝（同 renameCustom 口径）");
  beat.Arrange.close();
}

/* ================= 场景 T116b：F1 现值快照 —— 键盘修改不被拖动回滚 ================= */
section("T116b 拖动现值 · 键盘移动后拖动提交不回滚 / 小拖动吸附回原位 = 不动库");
{
  const { beat, els, fireWin, arr, id, sec } = setup();
  const uid = sec.uid;
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  const chips = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));

  /* 键盘把「眠」从 48 移到 60（v2.46.0 通道，原位更新不重渲染） */
  chips[1].fire("keydown", { key: "ArrowRight" });
  eq(beat.Store.findLyric(id, uid).chars[1].t, 60, "键盘移动落库（60）");

  /* 再拖「春」（t=0）+12tick：提交若读过期闭包字表，会把「眠」的 60 回滚成 48 */
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + px(12) });
  fireWin("pointerup", {});
  const after = beat.Store.findLyric(id, uid).chars;
  eq(after[0].t, 12, "拖动正常落库（春 → 12）");
  eq(after[1].t, 60, "★ 键盘修改保留（不再被过期字表回滚——F1）");

  /* 小拖动（< 半格）→ 吸附回原位 → 不动库不重绘 */
  const lineBefore = beat.Store.findLyric(id, uid);
  const chips2 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"));
  chips2[2].fire("pointerdown", { clientX: 200 });
  fireWin("pointermove", { clientX: 200 + px(3) });
  fireWin("pointerup", {});
  ok(beat.Store.findLyric(id, uid) === lineBefore, "★ 小拖动吸附回原值 → 行对象不变（v2.1.0 同口径）");
  beat.Arrange.close();
}

/* ================= 场景 T116c：F4 甲 换位 + F2 钳住反馈 ================= */
section("T116c 换位 · 满铺锁死有出路 / 越过量取末态 / 红边反馈");
{
  const { beat, els, fireWin, arr, id, sec } = setup();
  const uid = sec.uid;
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "你" }, { t: 24, dur: 24, ch: "好" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  let lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  let chips = chipsOf(lane);

  /* 满铺布局：chip0 被「好」顶死（min == max == 0）——旧实现此态永远拖不动 */
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + px(200) });      // 推过邻字半程（≥ dur/2 = 12）
  eq(/blocked/.test(chips[0].className), true, "★ 顶着推 → 红边反馈（.blocked），不再静默");
  fireWin("pointerup", {});
  let after = beat.Store.findLyric(id, uid).chars;
  eq(after[0].ch + after[1].ch, "好你", "★ 换位发生：好 到 0、你 到 24（满铺锁死的出路）");
  eq(after[0].t + "/" + after[1].t, "0/24", "时序互换后归一化按 t 排序");

  /* 反向换位：拉回去 = 换回来 */
  lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  chips = chipsOf(lane);
  chips[1].fire("pointerdown", { clientX: 200 });
  fireWin("pointermove", { clientX: 200 - px(200) });      // 向左推过前字半程
  fireWin("pointerup", {});
  after = beat.Store.findLyric(id, uid).chars;
  eq(after[0].ch + after[1].ch, "你好", "★ 反向推过半程 = 换回来");

  /* 未过半程 → 普通钳制移动，不换位 */
  lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  chips = chipsOf(lane);
  chips[0].fire("pointerdown", { clientX: 100 });
  fireWin("pointermove", { clientX: 100 + px(8) });        // 越界 8t < dur/2 = 12
  ok(/blocked/.test(chips[0].className), "越界即红边（哪怕未达换位阈值）");
  fireWin("pointerup", {});
  after = beat.Store.findLyric(id, uid).chars;
  eq(after[0].ch + after[1].ch, "你好", "未过半程 → 不换位");
  beat.Arrange.close();
}

/* ================= 场景 T116d：时值抓手 —— 钳住反馈 + 吸附落库 ================= */
section("T116d 时值抓手 · 顶住红边 / 松手吸附 / 小抖动不动库");
{
  const { beat, els, fireWin, arr, id, sec } = setup();
  const uid = sec.uid;
  /* v2.52.0（D5）：窄块（dur < 30）不渲染抓手——抓手路径改用宽块（dur 48）夹具；
     邻字紧贴（t=48）保持「顶住 → 回原值」的原语义 */
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 48, ch: "你" }, { t: 48, dur: 48, ch: "好" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const chips = chipsOf(lane);
  const grip0 = chips[0].children[1];

  grip0.fire("pointerdown", { clientX: 300 });
  fireWin("pointermove", { clientX: 300 + px(200) });      // 顶住邻字起点（96）还想加长
  eq(/blocked/.test(chips[0].className), true, "★ 时值被顶住 → 红边反馈");
  fireWin("pointerup", {});
  eq(beat.Store.findLyric(id, uid).chars[0].dur, 48, "顶住 → 吸附回原时值 → 不动库");
  ok(!/blocked/.test(chips[0].className), "抬手摘掉红边");

  const lineBefore = beat.Store.findLyric(id, uid);
  grip0.fire("pointerdown", { clientX: 300 });
  fireWin("pointermove", { clientX: 300 - px(48) });       // 向左收 48t → 期望 0 → 钳在最短 12t
  fireWin("pointerup", {});
  eq(beat.Store.findLyric(id, uid).chars[0].dur, 12, "★ 向左收到下限 12t 落库");
  eq(beat.Store.findLyric(id, uid) === lineBefore, false, "有变更 → 行对象更新");
  beat.Arrange.close();
}

/* ============ T116x：复制段（v3.33.29，用户需求「一段会重复多遍」） ============ */
section("T116x 复制段 · 新 uid / 连歌词 / 名字加序号 / 插在原段之后");
{
  const { beat } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "复制素材", meter: 4,
    bars: [[{ t: 48, dir: "D" }, { t: 48, dir: "U" }, { t: 48, dir: "D" }, { t: 48, dir: "U" }]] }] })), "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "复制曲式", sections: [
    { name: "主歌", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "副歌", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  const s0 = arr.sections[0];
  beat.Store.upsertLyric(arr.id, s0.uid, [{ t: 0, dur: 24, ch: "甲" }, { t: 48, dur: 24, ch: "乙" }]);
  const before = arr.sections.length;
  const r = beat.Store.duplicateSection(arr.id, s0.uid);
  ok(!!r, "复制返回结果");
  const a2 = beat.Store.findArrange(arr.id);
  eq(a2.sections.length, before + 1, "段数 +1");
  eq(a2.sections[1].uid, r.uid, "★★ 副本插在**原段之后**");
  ok(a2.sections[1].uid !== s0.uid, "★★ 副本换了**新 uid**（身份不能与原段共用）");
  eq(a2.sections[1].name, "主歌 (2)", "★ 名字自动加序号");
  eq(a2.sections[1].blocks.length, s0.blocks.length, "★ 块结构一并复制");
  const l1 = beat.Store.findLyric(arr.id, r.uid);
  ok(!!l1 && l1.chars.length === 2 && l1.chars[0].ch === "甲",
     "★★ **歌词一起复制**（新 uid 下同一份词）");
  const l0 = beat.Store.findLyric(arr.id, s0.uid);
  ok(!!l0 && l0.chars !== l1.chars, "★ 是深拷贝（不是同一个数组引用）");
  beat.Store.duplicateSection(arr.id, s0.uid);
  eq(beat.Store.findArrange(arr.id).sections[1].name, "主歌 (3)", "★ 再次复制 ⇒ 序号递增到 (3)");
}
