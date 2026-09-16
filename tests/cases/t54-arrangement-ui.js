/* BeatSight 自动化测试 · 曲式编排 UI（v2.0.0 S5）
   T54 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本组只管"编出来"这一段：CRUD、范围设置、主界面那一行、overlay 的开合与键盘。
   **播放行为本身由 T53 守**，这里不重复。

   行内结构（与 Arrange.render 对应，改 UI 时这两边要一起动）：
     .arg-sec    → [段号, input.arg-name, .arg-blocks, .arg-ops]
     .arg-blocks → N × .arg-block + 一个「+ 块」
     .arg-block  → [预设名 span, input.arg-reps(遍数), 「换」, 「✕」]
     .arg-ops    → [起, 终, ↑, ↓, ✕]
   「沙箱不支持 <select>」是这套"小按钮直接设在段行上"的原因之一，别改成下拉。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const A = (id, name, sections) => ({ id, name, sections });
const SEC = (name, ...blocks) => ({ name, blocks });

/* 无曲式 / 有一条两段的曲式 */
const bare = () => loadApp();
const seeded = () => loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  A("a1", "练习曲", [SEC("主歌", BL(0, 2)), SEC("副歌", BL(2, 1), BL(4, 1))]),
]}) });
/* 下标速查（改 UI 时对照）：
     .arg-ops   = [起0, 终1, ↑2, ↓3, ✕4]
     .arg-block = [名0, 遍数1, 单位2, 换3, ✕4]（"单位"也是元素，所以换/✕ 都在 +1 位）
     .arg-blocks = N × .arg-block + 一个「+ 块」（在最后） */
const secRows = els => els["argSections"].children;

/* ================= 场景 T54：overlay 开合与键盘 ================= */
section("T54 曲式 UI · overlay 开合 / Escape / 背景 inert");
{
  const app = seeded();
  const { beat, els } = app;
  eq(beat.Arrange.isOpen(), false, "初始未打开");
  els["argOpen"].fire("click");
  eq(beat.Arrange.isOpen(), true, "点「编排曲式」打开");
  ok(els["arrangeOverlay"].classList.contains("open"), "overlay 加上 open 类");
  /* 背景 inert：与编辑器/统计/听辨同一套（Modal.refreshInert） */
  const mainBg = app.sandbox.document.getElementById("mainBg");
  eq(mainBg.inert, true, "★ overlay 打开 → 背景置 inert（焦点不会跑出 overlay）");
  fireKey(app, "Escape");
  eq(beat.Arrange.isOpen(), false, "Escape 关闭");
  eq(mainBg.inert, false, "关闭后摘除 inert");
  els["argOpen"].fire("click");
  els["argClose"].fire("click");
  eq(beat.Arrange.isOpen(), false, "「返回练习」关闭");

  /* overlay 打开时空格不误触播放（与编辑器/统计/听辨同套） */
  els["argOpen"].fire("click");
  fireKey(app, " ", "Space");
  eq(beat.Store.S.playing, false, "★ overlay 打开时空格不启动播放（键盘归 overlay 管）");
  beat.Arrange.close();
}
function fireKey(app, key, code){ app.fireWin("keydown", { key, code: code || key, ctrlKey: false, metaKey: false }); }

/* ================= 场景 T54b：曲式库列表 ================= */
section("T54b 曲式 UI · 曲式库列表 / 选中 / 新建");
{
  const { beat, els } = bare();
  beat.Arrange.open();
  eq(els["argList"].children.length, 1, "空库时只有一句提示（不是空列表）");
  ok((els["argList"].children[0].textContent || "").includes("还没有曲式"), "提示文案到位");

  els["argNew"].fire("click");
  eq(beat.Store.arranges.length, 1, "新建出一条曲式");
  eq(beat.Store.arranges[0].name, "新曲式", "默认名");
  eq(secRows(els).length, 1, "新建的曲式默认有 1 段");
  ok(els["argList"].children[0].className.includes("sel"), "新建后自动选中");

  els["argNew"].fire("click");
  eq(beat.Store.arranges.length, 2, "再建一条");
  eq(els["argList"].children.length, 2, "列表有两条");
  /* 点第 1 条切回去 */
  els["argList"].children[0].fire("click");
  ok(els["argList"].children[0].className.includes("sel"), "点选切换选中态");
  ok(!els["argList"].children[1].className.includes("sel"), "另一条取消选中");
  beat.Arrange.close();
}

/* ================= 场景 T54c：段落的增删改序 ================= */
section("T54c 曲式 UI · 段落：改名 / 加段 / 上移下移 / 删除");
{
  const { beat, els } = seeded();
  beat.Arrange.open();
  eq(secRows(els).length, 2, "两条段");
  const row0 = secRows(els)[0];
  eq(row0.children[1].value, "主歌", "段名输入框显示当前名");

  /* 改名走 change 事件（与编辑器/训练参数同口径） */
  row0.children[1].value = "前奏";
  row0.children[1].fire("change");
  eq(beat.Store.arranges[0].sections[0].name, "前奏", "改名已落库");
  eq(secRows(els)[0].children[1].value, "前奏", "重渲染后仍是新名");

  /* 加段 */
  els["argAddSec"].fire("click");
  eq(secRows(els).length, 3, "加了一段");
  eq(secRows(els)[2].children[3].children[3].disabled, true, "★ 最后一段的「↓」禁用");
  eq(secRows(els)[0].children[3].children[2].disabled, true, "★ 第一段的「↑」禁用");

  /* 上移：把第 3 段移到第 2 位 */
  const before = beat.Store.arranges[0].sections.map(s => s.name);
  secRows(els)[2].children[3].children[2].fire("click");   // ↑（index 2；index 1 是「终」，别点错）
  const after = beat.Store.arranges[0].sections.map(s => s.name);
  eq(after[1], before[2], "上移生效（原第 3 段到第 2 位）");
  eq(after[2], before[1], "被顶下去的是原第 2 段");
  eq(after.length, 3, "段数不变（是移动不是复制）");

  /* 删除：走确认弹窗 */
  secRows(els)[0].children[3].children[4].fire("click");   // ✕
  eq(beat.Modal.isOpen(), true, "删除要确认（不是点了就没）");
  els["modalOk"].fire("click");
  eq(secRows(els).length, 2, "确认后删掉一段");

  /* 只剩一段时不允许再删 */
  secRows(els)[0].children[3].children[4].fire("click");
  eq(beat.Modal.isOpen(), true, "还能删（当前 2 段）");
  els["modalOk"].fire("click");
  eq(secRows(els).length, 1, "剩 1 段");
  eq(secRows(els)[0].children[3].children[4].disabled, true, "★ 只剩一段时「✕」禁用（一首曲式至少 1 段）");
  beat.Arrange.close();
}

/* ================= 场景 T54d：块（预设 / 遍数 / 增删） ================= */
section("T54d 曲式 UI · 块：遍数 / 换预设 / 加块 / 删块");
{
  const { beat, els } = seeded();
  beat.Arrange.open();
  const sec1 = secRows(els)[1];                       // 副歌：2 块
  eq(sec1.children[2].children.length, 3, "2 个块 + 1 个「+ 块」");

  /* 遍数：夹到 1..16 */
  const reps = sec1.children[2].children[0].children[1];
  reps.value = "3"; reps.fire("change");
  eq(beat.Store.arranges[0].sections[1].blocks[0].repeats, 3, "遍数改为 3");
  reps.value = "99"; reps.fire("change");
  eq(beat.Store.arranges[0].sections[1].blocks[0].repeats, beat.CONFIG ? 16 : 16, "★ 超上限夹到 16");
  reps.value = "0"; reps.fire("change");
  eq(beat.Store.arranges[0].sections[1].blocks[0].repeats, 1, "★ 低于下限夹到 1（不会出现 0 遍的段）");

  /* 换预设：点「换」→ 下方出现候选 → 点一个 */
  const pickBtn = sec1.children[2].children[0].children[3];   // 换（单位 span 占了 index 2）
  pickBtn.fire("click");
  eq(secRows(els).length, 3, "★ 出现了一行候选预设（不是弹窗、不切走）");
  const pickRow = secRows(els)[2];
  ok(pickRow.children[1].children.length >= 12, "候选里含 12 个内置预设（实际 " + pickRow.children[1].children.length + "）");
  const target = beat.BUILTINS[3].name;
  pickRow.children[1].children[3].fire("click");
  eq(beat.Store.arranges[0].sections[1].blocks[0].ref.idx, 3, "换成了第 4 个内置预设");
  eq(secRows(els).length, 2, "选完候选行消失");
  eq(secRows(els)[1].children[2].children[0].children[0].textContent, target, "块上显示新预设名");

  /* 加块 */
  secRows(els)[1].children[2].children[2].fire("click");   // 「+ 块」（在最后）
  eq(beat.Store.arranges[0].sections[1].blocks.length, 3, "加了一块");

  /* 删块：最后一块不许删 */
  const sec0 = secRows(els)[0];                       // 主歌：1 块
  sec0.children[2].children[0].children[4].fire("click");     // ✕
  eq(beat.Modal.isOpen(), true, "★ 只剩一块时删会被告知（不是静默删掉导致段变空）");
  els["modalOk"].fire("click");
  eq(beat.Store.arranges[0].sections[0].blocks.length, 1, "块没被删");
  beat.Arrange.close();
}

/* ================= 场景 T54e：播放范围 ================= */
section("T54e 曲式 UI · 播放范围：起/终 / 循环 / 全部");
{
  const { beat, els } = seeded();
  beat.Arrange.open();
  const S = beat.Store.S;
  /* 点列表 = 切"正在编辑哪条曲式"（不写播放选择） */
  els["argList"].children[0].fire("click");
  /* 播放选择的 id 由「起 / 终」写入 */
  secRows(els)[1].children[3].children[1].fire("click");   // 终
  eq(S.arrangeSel.id, "a1", "★ 设范围时把曲式 id 一并记进 arrangeSel");
  eq(S.arrangeSel.to, 1, "「终」设为第 2 段");
  /* 把第 2 段设为「起」→ to 不得小于 from，所以 from=1 时 to 至少 1 */
  secRows(els)[1].children[3].children[0].fire("click");   // 起
  eq(S.arrangeSel.from, 1, "「起」设为第 2 段");
  ok(S.arrangeSel.to >= S.arrangeSel.from, "★ to 不会小于 from（范围不会变空）");

  /* 全部 */
  els["argRangeRow"].children[1].fire("click");            // 「全部」
  eq(S.arrangeSel.from, 0, "「全部」把起点拉回第 1 段");
  eq(S.arrangeSel.to, 1, "终点是末段");

  /* 循环开关 */
  eq(els["argLoopBtn"].getAttribute("aria-checked"), "false", "循环默认关");
  els["argLoopBtn"].fire("click");
  eq(S.arrangeSel.loop, true, "点开循环");
  eq(els["argLoopBtn"].getAttribute("aria-checked"), "true", "aria-checked 同步（读屏能读到状态）");
  els["argLoopBtn"].className = els["argLoopBtn"].className;  // 触发一次读取，无副作用
  ok(els["argLoopBtn"].className.includes("on"), "样式切到 on（与后台保活等开关同一套 setToggle）");
  beat.Arrange.close();
}

/* ================= 场景 T54f：播放入口与主界面那一行 ================= */
section("T54f 曲式 UI · 播放入口 / 主界面显示 / 跳段");
{
  const { beat, els } = seeded();
  const S = beat.Store.S;
  beat.Arrange.open();
  els["argList"].children[0].fire("click");

  /* 主界面：非曲式模式下不显示跳转行 */
  eq(els["argJump"].hidden, true, "非曲式模式下隐藏跳转行");
  ok((els["argNowName"].textContent || "").includes("练习曲"), "编排里选中后，主界面显示曲式名");

  /* 「从头播」→ 进曲式模式、范围是全曲、开始播放 */
  els["argPlay"].fire("click");
  eq(beat.Arrange.isOpen(), false, "点播放会关闭 overlay");
  eq(S.playMode, "arrange", "进入曲式模式");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([0, 1]), "「从头播」的范围是全曲");
  eq(S.playing, true, "且已开始播放");
  eq(els["argJump"].hidden, false, "★ 曲式模式下显示跳转行");
  beat.Controls.stop();

  /* 「播选中范围」：先把范围设成只播第 2 段 */
  beat.Arrange.open();
  secRows(els)[1].children[3].children[0].fire("click");   // 起 = 第 2 段
  secRows(els)[1].children[3].children[1].fire("click");   // 终 = 第 2 段
  els["argPlayRange"].fire("click");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([1, 1]), "「播选中范围」只播第 2 段");
  eq(S.playing, true, "开始播放");
  beat.Controls.stop();

  /* 跳段：把范围设为"只播这一段并循环"，下一个小节边界生效 */
  els["argJumpNext"].fire("click");
  eq(S.arrangeSel.loop, true, "★ 跳段会打开循环（只练这一段）");
  eq(JSON.stringify([S.arrangeSel.from, S.arrangeSel.to]), JSON.stringify([1, 1]), "跳到第 2 段");
}

/* ================= 场景 T54g：跳段的即时反馈与单段隐藏（v2.0.2） ================= */
section("T54g 曲式 UI · 跳段即时反馈 / 单段隐藏跳段按钮");
{
  /* 用户实拍 bug：跳段按钮「点了没反应」——旧实现只改范围等边界拉回，
     停止状态/往回跳时界面零变化；单段曲式（新建默认）更是字面意义的哑键 */
  const { beat, els } = seeded();
  beat.Arrange.open();
  els["argList"].children[0].fire("click");
  els["argPlay"].fire("click");
  beat.Controls.stop();                                   // 停止状态下点跳段
  els["argJumpNext"].fire("click");
  ok((els["argNowMeta"].textContent || "").includes("第 2 段"),
     "★ 停止时点「下一段」立即显示目标段（不再是零反馈）");
  ok((els["argNowName"].textContent || "").includes("副歌"), "段名同步切到目标段");

  /* 单段曲式：两个跳段按钮整体隐藏（v2.0.2：不显示 > 禁用置灰），位置信息仍由 meta 显示 */
  const solo = bare();
  solo.beat.Arrange.open();
  solo.els["argNew"].fire("click");
  solo.els["argPlay"].fire("click");
  eq(solo.els["argJump"].hidden, false, "曲式模式下跳段行仍在（显示位置信息）");
  eq(solo.els["argJumpPrev"].hidden, true, "★ 单段曲式「◀ 上一段」隐藏");
  eq(solo.els["argJumpNext"].hidden, true, "★ 单段曲式「下一段 ▶」隐藏");
  solo.beat.Controls.stop();
}
