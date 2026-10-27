/* BeatSight 自动化测试 · 歌曲行高亮与曲式状态读数的模式判据（v3.55.x）
   T266 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍）：普通节拍练习（preset 模式）时，「自定义」区里上次碰过的歌曲行
   仍然挂着 .active——右侧 📁/✎/× 图标恒显（v3.3.1 的「选中行恒显」口径被误触发）、
   meta（「10 段 · 6 个型」）被挤隐；同时「整首连播」状态行谎报「播放中 · 第 1/33 小节」、
   范围滑块播放头钉在第 1 小节。

   根因两条（修法见 index.html 对应注释）：
   ① S.arrangeSel.id 是**粘的**：exitArrangeForPreset 只翻 playMode、不清 id，
     buildArrangeItem 的 isActive 只比 id 不看模式 ⇒ 高亮残留；
   ② demoCurBar() 在「播放中但非曲式模式」时落到 `return S.arrangeSel.from`（=0），
     syncDemoRange 把返回值当"正在播这首歌"的证据 ⇒ 读数与播放头双双谎报。

   本组钉住的契约：
   · 歌曲行 .active = arrangeSel.id 匹配 **∧ 曲式模式**（两处口径逐字一致：
     构造期 isActive 与 syncSongPlayBtns 的运行期翻转）；
   · 普通节拍/试听播放中：状态行为空、播放头隐藏；
   · preset 模式下点 ▶ 整首连播：**不重建列表**（playArrange 不走 buildPresetList），
     高亮必须经运行期路径（syncSongPlayBtns，挂在 syncDemoRange 收口上）当场亮起；
   · 曲式模式停机：高亮保留（「已就绪」= 你正要操作的对象，v3.3.1 口径）。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 与 t73 同一口径：seedDemo:false 让示例曲真的带出（含歌曲行与范围滑块） */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }),
  { seedDemo: false });

const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
/* 歌曲行（每次现取：点预设会整树重建列表，旧引用指向已脱离文档的节点） */
const songRowOf = els => boxOf(els).children.find(x =>
  /(^| )preset-item( |$)/.test(x.className) && x.children[0].children[0].textContent === "《在他乡》（示例）");
const hasActive = row => !!row && /(^| )active( |$)/.test(String(row.className));
/* 整首连播状态行（demo-play-note）与范围滑块播放头（demo-range-head） */
const playNoteOf = els => boxOf(els).children[0].children[0];
const trackOf = els => {
  const host = els["pbProgress"];
  const wrap = host && host.children.find(x => /(^| )demo-range( |$)/.test(x.className));
  return (wrap || boxOf(els).children.find(x => /(^| )demo-range( |$)/.test(x.className))).children[0];
};
const headOf = els => trackOf(els).children.find(x => /(^| )demo-range-head( |$)/.test(x.className));
const fromOf = els => trackOf(els).children[1];   /* 两个 thumb：children[1]/[2]（t68 定位契约） */
/* ★ v3.35.3：歌曲行点击语义是展开/收起，整首连播在行尾 ▶（与 t73/t88 同款） */
const playAllOf = els => {
  const row = songRowOf(els);
  return row && row.children.find(x => /(^| )aud( |$)/.test(x.className));
};
/* stub 的 textContent 不聚合子节点（真实 DOM 会），找预设条目要递归取 */
const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const itemByName = (els, name) => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className)).find(x => deepText(x).includes(name));

/* ================= 场景 T266a：普通节拍播放中 · 高亮/读数/播放头三不残留 =================
   复现用户实拍的链路。★ 前提铺垫：seedDemo:false 触发「首次打开默认选中示例曲」
   （v2.13.0：arrange 模式停机、arrangeSel 已指向《在他乡》）——点预设退回单练后
   arrangeSel.id 仍粘着它（exitArrangeForPreset 只翻模式不清 id），再起播普通节拍，
   三条断言全部对着"粘性 id 仍在"这个前提。 */
section("T266a 普通节拍播放中 · ★ 歌曲行不高亮、状态行不谎报、播放头隐藏（粘性 arrangeSel 前提下）");
{
  const { beat, els } = loadDemo();
  eq(beat.Store.S.playMode, "arrange", "前提：首次打开默认选中示例曲（arrange 模式停机）");
  ok(hasActive(songRowOf(els)), "前提：此时歌曲行高亮（已选它，v3.3.1 选中口径）");

  /* 点预设退回单练（列表整树重建）→ 起播普通节拍（用户实拍场景） */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "前提：点预设退回单练");
  beat.Controls.start();
  eq(beat.Store.S.playing, true, "前提：普通节拍播放中");

  const ac = FakeAudioContext.last;
  drive(ac, beat, 5);                       // 走几个小节边界：refreshNow/onAudibleBar 都会刷 syncDemoRange

  const row = songRowOf(els);
  ok(!!row, "前提：歌曲行已渲染（列表重建后重新定位）");
  ok(beat.Store.S.arrangeSel.id, "前提：arrangeSel.id 仍指向《在他乡》（粘性——这正是旧缺陷的温床）");
  ok(!hasActive(row), "★ 歌曲行不再挂 .active（旧实现：只比 id 不看模式，高亮残留 → 图标恒显）");
  eq(playNoteOf(els).textContent, "", "★ 状态行不再谎报「播放中 · 第 N 小节」（旧实现：demoCurBar 落到 from=0）");
  ok(headOf(els).hidden === true, "★ 范围滑块播放头隐藏（旧实现：钉在第 1 小节）");
  beat.Controls.stop();
}

/* ================= 场景 T266b：preset 模式点 ▶ 整首连播 · 高亮当场亮起 =================
   点 ▶ 起播路径经 arrangeStart → flushPending → applyPatternChange 会重建列表，
   高亮由构造期 isActive 给出；T266d 则钉运行期路径（模式翻转不重建的场景）。 */
section("T266b preset 模式点 ▶ 整首连播 · ★ 高亮当场亮起 + ▶ 翻 ■ + 状态行如实报位");
{
  const { beat, els } = loadDemo();
  /* 首次打开是 arrange 选中态——先点预设退回单练（停机），得到"preset 模式 + 歌曲行无高亮"起点 */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "前提：点预设退回单练（停机）");
  ok(!hasActive(songRowOf(els)), "前提：起播前歌曲行无高亮（preset 模式）");

  playAllOf(els).fire("click");
  eq(beat.Store.S.playMode, "arrange", "点 ▶ → 曲式模式整首连播");
  eq(beat.Store.S.playing, true, "播放已起");
  ok(hasActive(songRowOf(els)), "★ 歌曲行当场挂 .active（进曲式模式即选中它）");
  eq(playAllOf(els).textContent, "■", "★ ▶ 同步翻成 ■（两态与高亮同一处收口）");

  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);
  ok(String(playNoteOf(els).textContent).includes("播放中"),
    "★ 曲式播放中状态行如实报位（实际「" + playNoteOf(els).textContent + "」）");
  beat.Controls.stop();
}

/* ================= 场景 T266c：曲式模式停机 · 高亮保留（「已就绪」语义不回退） =================
   v3.3.1 口径：选中行 = 你正要操作的对象 ⇒ 曲式模式停机（已选它、下次从头播）高亮保留，
   修复不得把这条一并修掉。 */
section("T266c 曲式模式停机 · ★ 高亮保留 + 状态行「已就绪」（既有语义回归）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  beat.Controls.stop();

  eq(beat.Store.S.playMode, "arrange", "前提：停机但仍在曲式模式");
  eq(beat.Store.S.playing, false, "前提：已停止");
  ok(hasActive(songRowOf(els)), "★ 停机高亮保留（已选曲式 = 正要操作的对象，v3.3.1 口径）");
  ok(String(playNoteOf(els).textContent).includes("已就绪"),
    "★ 状态行显示「整首连播 · 已就绪」（实际「" + playNoteOf(els).textContent + "」）");

  /* 收尾对照：再点预设退回单练 → 高亮随模式退出摘掉（与 T266a 同判据，钉停机分支） */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "点预设退回单练");
  ok(!hasActive(songRowOf(els)), "★ 退回预设模式后高亮摘掉（停机分支同样受模式判据管辖）");
}

/* ================= 场景 T266d：播放中拖范围滑块进曲式 · 运行期翻转（列表不重建） =================
   setRange 在**播放中**不调 applyPatternChange（避免重活打断播放链路）——模式翻成
   arrange 而列表纹丝不动，构造期 isActive 管不到这一瞬：高亮必须经 syncSongPlayBtns
   的运行期翻转（挂在 syncDemoRange 收口上）当场亮起。这是"两处判据"缺一不可的那条路径。 */
section("T266d 播放中拖范围滑块进曲式 · ★ 同一行节点不重建、高亮运行期亮起");
{
  const { beat, els } = loadDemo();
  itemByName(els, "四分基础").fire("click");     // 退回单练（停机）
  eq(beat.Store.S.playMode, "preset", "前提：预设模式停机");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1);
  eq(beat.Store.S.playing, true, "前提：普通节拍播放中");
  const row = songRowOf(els);
  ok(!hasActive(row), "前提：拖之前歌曲行无高亮");

  /* 播放中拖范围起点并提交（t88 同款单拇指两级事件）→ setRange 播放中分支不重建列表 */
  const e = fromOf(els);
  e.value = "3"; e.fire("input"); e.fire("change");
  eq(beat.Store.S.playMode, "arrange", "拖范围提交 → 进曲式模式");
  ok(songRowOf(els) === row, "前提：列表未重建（行节点同一引用——运行期路径存在的意义）");
  ok(hasActive(row), "★ 歌曲行高亮当场亮起（syncSongPlayBtns 运行期翻转，非构造期）");
  beat.Controls.stop();
}
