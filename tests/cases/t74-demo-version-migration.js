/* BeatSight 自动化测试 · 示例曲版本迁移 + 曲式模式下的选中语义（v2.6.4 / v2.9.0）
   T74 系列。
   ---------------------------------------------------------------------------
   ① 曲式模式下的「假选中」（v2.6.4）：曲式播放根本不读 S.sel，侧栏却在被回退的
      S.sel 上画"选中"高亮 → 像"已经选中了四分基础"。
     修法：曲式模式下一律不画选中高亮（isActive = S.playMode !== "arrange" && …），
     S.sel 只在退回单练后作数。
     v2.9.0：两态轨模型（含 ensureValidForTrack 回退）删除，"切轨"这个触发源已消失；
     本组保留仍成立的高亮契约，去掉依赖轨 UI 的步骤。

   ② 整首连播出 120 小节（参考谱是 30 小节）。成因：示例型**名字**从 v2.4.4 起没变，
     内容却从「4 小节型」换成过「1 小节型」（v2.6.0）；ensureDemo 按名查重，
     把"旧型 + 新曲式"的混杂态判成"数据齐全"——30 小节 × 4 = 120。
     修法：同名再比内容（demoPresetEq），不一致就地收敛回参考谱（保住 id）；
     init 加"闩已落但内容对不上"的迁移分支（demoStale）；
     用户**删掉**曲式的恒 false——只收敛，不复活。
     v2.9.0：示例型改通用名、曲式块按**下标**引用；认型改按**内容**（demoIndexOf）。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* v2.9.0：轨模型已删，起跑型与"在哪条轨"无关 */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }),
  { seedDemo: false });
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const playAllOf = els => boxOf(els).children.find(x => /(^| )demo-play-row( |$)/.test(x.className)).children[0];
const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const itemByName = (els, name) => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className)).find(x => deepText(x).includes(name));
const activeItems = els => els["presetList"].children.filter(x =>
  /(^| )preset-item( |$)/.test(x.className) && /(^| )active( |$)/.test(x.className));
/* v2.9.0：示例型已改通用名（十六分满扫（《在他乡》前奏） 等），不能再按旧名前缀认。
   名字取自规范谱（demoBuildSpec），mangleToOld4Bar 只改内容不碰名字，故 mangle 后仍认得出 */
const demoPats = beat => {
  const names = beat.demoBuildSpec().presets.map(p => p.name);
  return beat.Store.customs.filter(c => names.includes(c.name));
};
/* 把 5 个示例型就地改成 v2.4.x 时代的「4 小节旧版」（同名同 id、内容 ×4）——
   这正是用户机器上"旧型 + 新曲式"混杂态的复刻 */
const mangleToOld4Bar = beat => {
  demoPats(beat).forEach(c => { c.bars = [c.bars[0], c.bars[0], c.bars[0], c.bars[0]]; });
  beat.Store.persistCold();
};
const totalBars = beat => beat.songBars(beat.Store.findArrange(beat.DEMO_ID));

/* ================= 场景 T74a：曲式播放中 → 不制造假选中（图三） ================= */
section("T74a 曲式播放中 · ★ 侧栏无假高亮（曲式不读 S.sel）；点预设退回后高亮恢复");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  const selBefore = JSON.stringify(beat.Store.S.sel);

  /* v2.9.0：轨 UI 已删，S.sel 不能被"切轨"改写了——直接断言它的语义不变即可 */
  eq(beat.Store.S.playMode, "arrange", "整首连播后是曲式模式");
  eq(JSON.stringify(beat.Store.S.sel), selBefore, "曲式播放不动 S.sel（它只是'退回预设后选谁'）");
  eq(activeItems(els).length, 0,
    "★ 列表里**没有**任何条目被高亮——不制造'已选中'的假象（高亮语义 = 正在练这个型）");
  ok(String(els["patternName"].textContent).length > 0, "标题有内容（跟节目单）");

  /* 出口仍是对等入口：点任一节奏型 = 退回单练它（BUILTINS[1] = 四分基础） */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "点预设退回预设模式");
  eq(JSON.stringify(beat.Store.S.sel), JSON.stringify({ type: "builtin", idx: 1 }), "S.sel 落到被点的型");
  eq(els["patternName"].textContent, "四分基础", "标题跟上");
  eq(activeItems(els).length, 1, "退回预设模式后选中高亮恢复（高亮语义与模式一致）");
  beat.Controls.stop();
}

/* ================= 场景 T74b：曲式停止态 → 同样无假高亮（停止时展示待命型是 v2.0.2 的设计） ================= */
section("T74b 曲式停止态 · S.sel 不变 + 无假高亮 + 画面是待命型（v2.0.2 设计）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  beat.Controls.stop();
  const selBefore = JSON.stringify(beat.Store.S.sel);
  eq(JSON.stringify(beat.Store.S.sel), selBefore, "★ 停止态 S.sel 不变（曲式播放不动它）");
  eq(activeItems(els).length, 0, "★ 停止 + 曲式 = 依旧无选中高亮");
  eq(els["patternName"].textContent, beat.demoBuildSpec().presets[0].name,
    "停止 + 曲式 = 显示待命型（播放范围起点，这里是 P1），与画面其它部分一致");
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

/* ================= 场景 T74f：v2.9.0 旧通用名 → v2.19.1 特征名（改名迁移端到端） =================
   v2.19.1 把 P2–P5 的场景名（副歌/主歌/雨夜/桥段扫弦）改成特征名（下上扫 · 密（《在他乡》副歌） 等）。
   本组复刻"用户机器上是 v2.19.0 之前落盘的名字"：名字退回旧名、内容保持规范谱，
   再启动一次——migrateDemoPatternNames 应把名字收敛、**不碰内容与 id、不重复建型**。 */
section("T74f v2.19.1 改名迁移 · ★ 旧名「雨夜扫弦」落盘 → 启动自动收敛为「前密后疏扫（《在他乡》主歌二）」");
{
  const first = loadApp(undefined, { seedDemo: false });
  eq(first.beat.Store.customs.length, 5, "前提：示例 5 型已在库");
  /* 把 P4 改回 v2.9.0 旧名（内容保持参考谱）——正是 v2.19.1 之前用户机器上的形状 */
  const spec = first.beat.demoBuildSpec().presets;
  const p4old = first.beat.Store.customs.find(c => c.name === spec[3].name);
  ok(!!p4old, "前提：P4 在库（现名「前密后疏扫（《在他乡》主歌二）」）");
  p4old.name = "雨夜扫弦";
  first.beat.Store.persistCold();

  const seed = {};
  first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  const after = second.beat.Store.customs.find(c => c.name === "前密后疏扫（《在他乡》主歌二）");
  ok(!!after, "★ 旧名「雨夜扫弦」已在启动时收敛为「前密后疏扫（《在他乡》主歌二）」");
  ok(!second.beat.Store.customs.some(c => c.name === "雨夜扫弦"), "★ 旧名不再存在（幂等收敛，不是并列共存）");
  eq(second.beat.Store.customs.length, 5, "★ 没有重复建型（不是新建第 6 个）");
  eq(after && after.id, p4old.id, "★ id 原样保住——曲式块按 id 引用，改名不能断链");
  eq(JSON.stringify(after && after.bars), JSON.stringify(p4old.bars),
    "★ 内容未被迁移触碰（migrate 只动 name；内容收敛是 ensureDemo 的事）");
  eq(JSON.stringify(second.beat.Store.customs.map(c => c.name).sort()),
    JSON.stringify(spec.map(p => p.name).sort()),
    "★ 5 个型名与规范谱一一对应（其余 4 个名字分毫未动）");
}
