/* BeatSight 自动化测试 · 示例曲《我们能不能不分手》段 1 和弦错字（v3.36.3，用户实报）
   ============================================================================
   现象：段 1 的和弦写成「C 琶音」（音名与修饰语之间多一个空格），与全仓其它和弦标记
         （「C」「Am」「F G」「Em Am」…：音名**紧贴**修饰语）不一致。
   为什么不能只改字面量：块级 per-bar 和弦是**随曲式落进冷键**的 —— 用户那份早已落盘，
     只改代码，存量用户看到的还是错的 ⇒ 必须配一次性迁移（戳键 beatsight.chdsp36）。
   本组钉四件事：
     ① 代码字面量（全新带出的曲式就是对的）；
     ② 迁移：旧字面量就地改对 + 冷键回写 + 置戳；
     ③ 幂等：戳已在时不再扫（第二次启动零改动）；
     ④ 不越界：只认领这一首示例曲，用户自己曲式里的同样写法不动。
   ============================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BAD = "C 琶音", GOOD = "C琶音";
/* ★ 预置样本必须**结构忠实**：手写一个"1 段 1 块"的最小 fixture 是测不到迁移的 ——
   启动期有一条"示例曲结构与谱面对不上就按代码收敛"的分支（v2.6.4 demoStale，见 oneStale），
   它会把这个 fixture 直接重建成代码里的样子（于是和弦也顺带变成对的），断言看着绿、其实没验迁移。
   故样本统一**从应用自己带出的曲式序列化**而来，只把那一处和弦改回旧字面量。 */
const faithfulDemo2 = () => {
  const { beat } = loadApp(undefined, { seedDemo: true });
  beat.Arrange.ensureAllDemos();
  const a = beat.Store.arranges.find(r => r.id === "demo-wmbbf");
  return JSON.parse(JSON.stringify(a));
};
const seedWith = (arrange, extra) => Object.assign({
  "beatsight.demoSeeded": "1",
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [arrange] }),
}, extra || {});
/** 把序列化样本改回"存量用户落盘的样子"：① 那一处和弦用旧写法；② 段名动过（用户编辑）。
   ② 是**关键**：它让"这是用户的曲式、不是刚被重建的"变成可断言的事实 —— 启动期那条
   `else if (Arrange.demoStale())` 收敛分支若命中会整段重建，样本里改的段名就会消失；
   段名还在 ⇒ 这次改对和弦的**只能是本迁移**，断言不会把"被重建"误当"迁移生效"。 */
const withBadChord = () => {
  const a = faithfulDemo2();
  a.sections[0].name = "我改的段名（用户编辑）";
  return JSON.parse(JSON.stringify(a).split(GOOD).join(BAD));
};
/* 冷键读回：桩给的 storage 可能是 Map，也可能是 localStorage 形状的对象 —— 两种都吃 */
const stored = (app, k) => (app.storage && typeof app.storage.getItem === "function")
  ? app.storage.getItem(k) : (app.storage && app.storage.get ? app.storage.get(k) : null);
const demo2 = Store => Store.arranges.find(r => r.id === "demo-wmbbf");
const chordOf = Store => { const a = demo2(Store); return a && a.sections[0].blocks[0].chords; };

section("T214a 字面量：全新带出的示例曲，段 1 和弦 = 「C琶音」");
{
  const { beat } = loadApp(undefined, { seedDemo: true });
  beat.Arrange.ensureAllDemos();
  eq(chordOf(beat.Store), GOOD, "★★ 段 1 和弦 = " + GOOD + "（用户实报的错字是 " + JSON.stringify(BAD) + "）");
  ok(JSON.stringify(beat.Store.arranges).indexOf(BAD) < 0, "★★ 整个曲式库都不含带空格的写法");
  ok(JSON.stringify(beat.Store.arranges).indexOf(GOOD) >= 0, "★ 非空跑前提：确实检查到了这段和弦");
}

section("T214b 一次性迁移：已落盘的旧字面量就地改对（不改代码也能见效）");
{
  const app = loadApp(seedWith(withBadChord()), { seedDemo: true });
  eq(chordOf(app.beat.Store), GOOD, "★★★ 载入后**内存里**的曲式已是 " + GOOD + "（迁移必须发生在曲式读入之前）");
  ok(String(stored(app, "beatsight.arranges")).indexOf(BAD) < 0, "★★ 冷键已回写（下次启动不再是错的）");
  eq(stored(app, "beatsight.chdsp36"), "1", "★ 迁移戳已置（幂等的依据）");
}

/* ★ 为什么这里**没有**"戳已置 ⇒ 保持原样"那条断言：
   写它时发现，本环境下示例曲 2 的曲式**每次启动都会被启动期那条「结构与谱面对不上就收敛」分支重建**
   （实测 `secBars` 逐段 4,28,4,12… vs 谱面 1,7,1,3…，块 `repeats:4`、引用 `idx 15`）——
   于是"只让迁移生效、别的路径都不动它"这个场景在桩里构造不出来，硬写只会得到一条**假绿**。
   戳键本身的行为由 T214b 的"戳已置"断言把守（那是迁移唯一的幂等依据）；
   上面这件事已作为**独立发现**记进 CHANGELOG，不在本组假装验过。 */

section("T214d 不越界：用户自己曲式里的同样写法不动");
{
  const own = { v: 1, arranges: [{ id: "my-own", name: "我的练习",
    sections: [{ name: "段 1", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1, chords: BAD }] }] }] };
  const app = loadApp({ "beatsight.demoSeeded": "1", "beatsight.arranges": JSON.stringify(own) }, { seedDemo: true });
  const mine = app.beat.Store.arranges.find(r => r.id === "my-own");
  eq(mine.sections[0].blocks[0].chords, BAD,
     "★★ 只认领这一首示例曲（id 命中为主、名字兜底）—— 用户自己的数据一字不改");
}