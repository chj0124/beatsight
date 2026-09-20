/* BeatSight 自动化测试 · 切轨假选中 + 示例曲版本迁移（v2.6.4）
   T74 系列。
   ---------------------------------------------------------------------------
   两条用户实拍：

   ① 连播（曲式模式）中切到普通轨，侧栏「四分基础」被高亮、可视化却还在在他乡——
     像"切不过去"。成因：ensureValidForTrack 在曲式模式下仍把 S.sel 回退成普通型，
     制造了一个"已选中"的假象（曲式播放根本不读 S.sel）。
     修法：曲式模式下不回退（S.sel 只是"退回预设后选谁"）；trackNote 在曲式模式下
     给"以节目单为准"的提示；进出模式经 onPlayModeChange 各刷一次。

   ② 整首连播出 120 小节（参考谱是 30 小节）。成因：示例型**名字**从 v2.4.4 起没变，
     内容却从「4 小节型」换成过「1 小节型」（v2.6.0）；ensureDemo 按名查重，
     把"旧型 + 新曲式"的混杂态判成"数据齐全"——30 小节 × 4 = 120。
     修法：同名再比内容（demoPresetEq），不一致就地收敛回参考谱（保住 id）；
     init 加"闩已落但内容对不上"的迁移分支（demoStale）；
     用户**删掉**曲式的恒 false——只收敛，不复活。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const loadDemo = () => loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }),
  { seedDemo: false });
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-demo-group( |$)/.test(x.className));
const playAllOf = els => boxOf(els).children.find(x => /(^| )demo-play-row( |$)/.test(x.className)).children[0];
const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const itemByName = (els, name) => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className)).find(x => deepText(x).includes(name));
const demoPats = beat => beat.Store.customs.filter(c => c.name.startsWith("在他乡 · 节奏型"));
/* 把 5 个示例型就地改成 v2.4.x 时代的「4 小节旧版」（同名同 id、内容 ×4）——
   这正是用户机器上"旧型 + 新曲式"混杂态的复刻 */
const mangleToOld4Bar = beat => {
  demoPats(beat).forEach(c => { c.bars = [c.bars[0], c.bars[0], c.bars[0], c.bars[0]]; });
  beat.Store.persistCold();
};
const totalBars = beat => beat.songBars(beat.Store.findArrange(beat.DEMO_ID));

/* ================= 场景 T74a：曲式播放中切轨 → 不再有假选中（图三） ================= */
section("T74a 曲式播放中切普通轨 · ★ S.sel 不被回退、列表无假高亮、模式提示在");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  const selBefore = JSON.stringify(beat.Store.S.sel);

  els["trackRow"].children[0].fire("click");                 // 切到普通轨
  eq(JSON.stringify(beat.Store.S.sel), selBefore,
    "★ 切轨不再回退 S.sel（曲式播放不读它；它只是'退回预设后选谁'）");
  eq(beat.Store.S.playMode, "arrange", "播放模式不受影响");
  const highlighted = els["presetList"].children.filter(x =>
    /(^| )preset-item( |$)/.test(x.className) && /(^| )active( |$)/.test(x.className));
  eq(highlighted.length, 0, "★ 列表里**没有**任何条目被高亮——不再制造'已选中四分基础'的假象");
  ok(String(els["trackNote"].textContent).includes("节目单"),
    "★ 轨说明换成模式提示（实际「" + els["trackNote"].textContent + "」）");
  ok(String(els["patternName"].textContent).includes("在他乡"), "标题仍跟节目单");

  /* 出口仍是对等入口：点任一节奏型 = 退回单练它（BUILTINS[1] = 四分基础） */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "点预设退回预设模式");
  eq(JSON.stringify(beat.Store.S.sel), JSON.stringify({ type: "builtin", idx: 1 }), "S.sel 落到被点的型");
  eq(els["patternName"].textContent, "四分基础", "标题跟上");
  const litNow = els["presetList"].children.filter(x =>
    /(^| )preset-item( |$)/.test(x.className) && /(^| )active( |$)/.test(x.className));
  eq(litNow.length, 1, "退回预设模式后选中高亮恢复（高亮语义与模式一致）");
  ok(!String(els["trackNote"].textContent).includes("节目单"),
    "★ 退出曲式后模式提示同步消失（onPlayModeChange 钩子刷的）");
  beat.Controls.stop();
}

/* ================= 场景 T74b：曲式停止态切轨 → 同样不制造假选中 ================= */
section("T74b 曲式停止态切普通轨 · S.sel 不变 + 提示在（停止时展示待命型是 v2.0.2 的设计）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  beat.Controls.stop();
  const selBefore = JSON.stringify(beat.Store.S.sel);
  els["trackRow"].children[0].fire("click");
  eq(JSON.stringify(beat.Store.S.sel), selBefore, "★ 停止态切轨同样不回退 S.sel");
  ok(String(els["trackNote"].textContent).includes("节目单"), "模式提示在");
  ok(String(els["patternName"].textContent).includes("在他乡"),
    "停止 + 曲式 = 显示待命型（播放范围起点），与画面其它部分一致");
}

/* ================= 场景 T74c：120 小节混杂态 → 收敛回参考谱 ================= */
section("T74c 示例版本迁移 · ★ 旧型(4 小节) + 新曲式 = 120 小节 → demoStale 抓住 → 收敛回 30");
{
  const { beat } = loadApp(undefined, { seedDemo: false });      // 新谱种子
  eq(totalBars(beat), 30, "前提：新种子全曲 30 小节");
  eq(beat.Arrange.demoStale(), false, "前提：新种子不算落后");

  mangleToOld4Bar(beat);                                          // 弄旧：型 ×4 小节
  eq(totalBars(beat), 120, "★ 复现用户实拍：旧型 + 新曲式 = 120 小节（30×4）");
  eq(beat.Arrange.demoStale(), true, "★ demoStale 抓得出混杂态（按名查重抓不出）");

  const idBefore = demoPats(beat).map(c => c.id);
  const r = beat.Arrange.ensureDemo();
  eq(r.updated, 5, "★ 5 个旧型被就地收敛（返回值报告了更新数）");
  eq(totalBars(beat), 30, "★ 收敛后全曲回到 30 小节");
  eq(JSON.stringify(demoPats(beat).map(c => c.id)), JSON.stringify(idBefore),
    "★ id 原样保住——曲式块按 id 引用，换 id 会把整首曲式打成坏引用");
  ok(demoPats(beat).every(c => c.bars.length === 1), "★ 5 个型都回到 1 小节的参考谱");
  eq(beat.Arrange.demoStale(), false, "收敛后不再落后");
  eq(beat.Arrange.ensureDemo().updated, 0, "★ 幂等：再跑一遍 0 更新（不是每次都重写一遍）");
}

/* ================= 场景 T74d：init 迁移端到端（闩已落 + 内容旧 → 下次启动自动收敛） ================= */
section("T74d init 迁移 · ★ 闩已落但内容旧 → 启动自动收敛（不需要用户手动恢复）");
{
  const first = loadApp(undefined, { seedDemo: false });
  mangleToOld4Bar(first.beat);
  eq(totalBars(first.beat), 120, "前提：第一份会话已是 120 小节混杂态");
  /* 把第一份会话的 localStorage 原样倒进第二份（含已落的闩）——模拟用户下次打开 */
  const seed = {};
  first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  ok(demoPats(second.beat).every(c => c.bars.length === 1), "★ 再启动后 5 个型已收敛回 1 小节");
  eq(totalBars(second.beat), 30, "★ 全曲回到 30 小节");
  eq(second.beat.Arrange.demoStale(), false, "落后标记消除");
  eq(second.beat.Store.lyrics.filter(l => l.arrangeId === second.beat.DEMO_ID).length, 10,
    "歌词 10 行完好（迁移不动歌词之外的用户数据）");
}

/* ================= 场景 T74e：用户删掉曲式 → 绝不复活（只收敛，不复活） ================= */
section("T74e 删除保护 · ★ 曲式被删 → demoStale 恒 false，启动不复活（尊重删除）");
{
  const first = loadApp(undefined, { seedDemo: false });
  mangleToOld4Bar(first.beat);
  first.beat.Store.deleteArrange(first.beat.DEMO_ID);            // 用户删掉整首曲式
  eq(first.beat.Arrange.demoStale(), false, "★ 曲式被删 → 不算落后（不触发收敛/复活）");
  const seed = {};
  first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  ok(!second.beat.Store.findArrange(second.beat.DEMO_ID), "★ 再启动曲式仍然不在（没偷偷补回来）");
  ok(demoPats(second.beat).length > 0 && demoPats(second.beat).every(c => c.bars.length === 4),
    "留下的示例型保持用户手里的样子，不被隔空改写");
}
