/* BeatSight 自动化测试 · v2.37.0：编排↔编辑器双向关联 + 宽屏适配 + 帮助图文反转
   T110 系列。
   ---------------------------------------------------------------------------
   契约锚点：
     · 候选胶囊（pickPill）：扫弦型带「↑↓」类型徽标（编排页此前对型的扫弦属性零可见性）；
       自定义型带 ✎ → Editor.openWith(该型)——编辑器保存 = 生成新副本（不覆盖原版），
       故跳转语义是"造变体"而非"就地改"；内置型内容恒定，不给 ✎；
     · Editor.openWith(src)：open() 的参数化（open() = openWith(curPattern())）；
       源型被引用时编辑器显示「被 N 首曲式引用…保存会生成新副本」提示（引用不追踪的
       真相在最易误解场景讲清）；未被引用 → 提示留空；
     · 宽屏铺满适配（v2.38 起）：封顶撤销（网格与歌词轨都全宽同起点）、格内字形按 --cs
       等比放大；卡片头居中分布 2×2（v2.39：r1 音量｜BPM｜三开关并列、r2 行数拍号占满、
       四块组容器底）——均为源码文本级断言（同 t101/t107d 口径）；
     · 帮助示意图：<template> 惰性挂载（不占 DOM 预算），覆盖 7 幅（源码文本级，t55 守）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");
const fs = require("fs");
const path = require("path");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 统一用例装配：一条内置曲式 + importPresets 造一个自定义型 + 给段 A 追加引用它的块。
   ★ 引用 id 必须取 importPresets 分配的运行时 id（它按会话序号生成，不能预先写死） */
const mkCase = () => {
  const app = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t110", name: "引用曲式", sections: [
      { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
    ] },
  ]}) });
  app.beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "我的扫弦", meter: 4, bars: [[{ t: 192, dir: "D" }]] }] }));
  const cid = app.beat.Store.customs[0].id;
  const a = app.beat.Store.findArrange("t110");
  a.sections[0].blocks.push({ ref: { type: "custom", id: cid }, repeats: 1 });
  app.beat.Store.upsertArrange(a);
  return app;
};
/* 候选/编辑器定位助手 */
const rows = els => els["argSections"].children;
const openPick = (els, i, blk) => { rows(els)[i].children[2].children[blk].children[3].fire("click"); };
const pickRowOf = els => Array.prototype.find.call(rows(els), r => /(^| )arg-pick( |$)/.test(r.className));
const pillBy = (pick, re) => Array.prototype.find.call(pick.children[1].children,
  c => re.test(c.textContent || ""));
const pillChild = (pill, cls) => pill.children.find(c => cls.test(c.className));

/* ================= 场景 T110a：候选胶囊 · 类型徽标 + ✎ 只给自定义型 ================= */
section("T110a 候选胶囊 · 扫弦徽标 / ✎ 仅自定义 / 点击跳编辑器");
{
  const { beat, els } = mkCase();
  beat.Arrange.open();
  openPick(els, 0, 0);                                   // 段 1 块 1（内置型）的「换」
  const pick = pickRowOf(els);
  ok(!!pick, "前提：候选就地展开");
  /* 自定义区的那颗「我的扫弦」pill：有 ✎；扫弦型（dir 记谱）有 ↑↓ 徽标 */
  const customPill = pillBy(pick, /我的扫弦/);
  ok(!!customPill, "前提：候选里有自定义型");
  const ed = pillChild(customPill, /arg-pill-edit/);
  ok(!!ed, "★ 自定义型候选带 ✎（去编辑器造副本）");
  ok(/去编辑器/.test(ed.getAttribute("aria-label") || ""), "✎ aria 写明跳转语义");
  const tag = pillChild(customPill, /arg-pill-tag/);
  ok(!!tag && tag.textContent === "↑↓", "★ 扫弦型候选带「↑↓」类型徽标（可见性补齐）");
  /* 内置型 pill：无 ✎（内容恒定），有扫弦型示例（BUILTINS[0] 民谣扫弦带 dir） */
  const builtinStrum = pillBy(pick, /民谣扫弦/);
  ok(!!builtinStrum, "前提：候选里有内置扫弦型");
  ok(!builtinStrum.children.find(c => /arg-pill-edit/.test(c.className)),
    "★ 内置型不带 ✎（内容恒定，无副本可造）");
  beat.Arrange.close();
}

/* ================= 场景 T110b：✎ 点击 → 编辑器载入该型为底稿 ================= */
section("T110b ✎ 跳转 · 编辑器打开 / 底稿 = 该型副本 / 编排浮层保持打开");
{
  const { beat, els } = mkCase();
  beat.Arrange.open();
  openPick(els, 0, 0);
  const customPill = pillBy(pickRowOf(els), /我的扫弦/);
  const ed = pillChild(customPill, /arg-pill-edit/);
  ed.fire("click");
  /* ★ 守卫先行：跳转被删时编辑器根本不开——必须表现为具名失败而非后面读 draft 崩溃 */
  ok(els["editor"].classList.contains("open"), "★ ✎ 点击 → 编辑器打开（跳转生效）");
  eq(beat.Arrange.isOpen(), true, "★ 编排浮层保持打开（编辑器叠在其上，同设置→使用方法的层叠）");
  eq(beat.Store.S.playMode === "preview" || !beat.Store.S.playing, true, "进编辑器即停播");
  ok((beat.Editor.draft().name || "").includes("我的扫弦"), "★ 底稿名含源型名（-副本）");
  eq(beat.Editor.draft().bars.length, 1, "底稿小节 = 源型小节");
  beat.Editor.tryClose();
  eq(beat.Arrange.isOpen(), true, "编辑器关闭后回到编排页（层级还原）");
  beat.Arrange.close();
}

/* ================= 场景 T110c：编辑器源型引用提示 ================= */
section("T110c 引用提示 · 被 N 首曲式引用 / 未引用留空（引用不追踪的真相）");
{
  const { beat, els } = mkCase();
  beat.Arrange.open();
  openPick(els, 0, 0);
  const customPill = pillBy(pickRowOf(els), /我的扫弦/);
  pillChild(customPill, /arg-pill-edit/).fire("click");
  const note = els["editorRefNote"].textContent || "";
  ok(/被 1 首曲式引用/.test(note) && note.includes("引用曲式"), "★ 引用提示给出曲式名与计数");
  ok(/新副本/.test(note) && /仍用原版/.test(note), "★ 提示讲清「引用不追踪」：保存 = 新副本，原曲式仍用原版");
  beat.Editor.tryClose();

  /* 未被引用的自定义型 → 提示留空 */
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "无引用型", meter: 4, bars: [[{ t: 192 }]] }] }));
  beat.Arrange.open();
  openPick(els, 0, 0);
  const orphan = pillBy(pickRowOf(els), /无引用型/);
  pillChild(orphan, /arg-pill-edit/).fire("click");
  eq(els["editorRefNote"].textContent, "", "★ 未被引用 → 提示留空（不制造噪音）");
  beat.Editor.tryClose();
  beat.Arrange.close();
}

/* ================= 场景 T110d：宽屏适配 + 帮助示意图（源码文本级契约） ================= */
section("T110d 源码契约 · 走带条密度封顶 / 歌词字号微调 / 示意图 template 惰性挂载");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  ok(!src.includes("body.wide-full .viz{max-width"),
    "★★ v2.38.0：铺满封顶已撤销——网格与歌词轨都全宽同起点（对齐恢复，用户实拍错位已修）");
  ok(src.includes("--cs") && src.includes("font-size:calc(16px * var(--cs, 1))"),
    "★ 铺满时格内字形按 --cs 等比放大（歌词字号/格标签/座次尺随网格宽缩放）");
  ok(src.includes(".viz-head-grid{display:grid;grid-template-columns:auto auto auto"),
    "★ 卡片头居中分布（2×2：r1 音量｜BPM｜三开关并列，r2 行数拍号占满整行，v2.39.0）");
  ok(!src.includes(".card-head-left{grid-row"),
    "★★ v2.39.0：竖跨执行错误已修——音量列不再 grid-row 竖跨（否则 BPM 被挤到右侧列）");
  ok(src.includes(".viz-rows-row{grid-column:1 / 4;grid-row:2"),
    "★ 行数拍号行 grid-column:1/4 占满整行（v2.38 的 2/4 悬空第三列已退役）");
  ok(src.includes(".viz-head-grid .card-head-left,") && src.includes("background:var(--card2);border-radius:10px;padding:12px 16px"),
    "★★ v2.39.0：四块组容器底（--card2 圆角 + 12/16 内边距）——修「散/悬空/填充感」，纯 CSS 零新增节点");
  ok(src.includes(".viz-rows-row .group{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center"),
    "★★ v2.40.0：拍号面板 flex-direction:row——.group 基础 column + align-items:center 恰成水平居中"
    + "（标签悬空、按钮下沉一行）；row 后与行数面板同款「标签左、按钮右」，同基线");
  ok(/\.status \.pat-now\{[^}]*white-space:nowrap/.test(src),
    "★ v2.40.0：型名单行省略——无 nowrap 时省略号失效、长型名折两行悬在状态行右上");
  ok(src.includes(".viz-head-grid .viz-toggles .toggle-pill{background:transparent;border:0}"),
    "★★ v2.40.0：组内开关胶囊去自带底色（--card 深、宽随文案参差）——每组只留组底一层");
  ok(src.includes("body.wide-full .viz-head-grid{grid-template-columns:auto auto auto auto;justify-content:space-between"),
    "★★ v2.40.0：宽屏铺满四块一行（音量｜BPM｜三开关｜行数拍号）+ space-between 拉开，与铺满网格同宽呼应");
  ok(src.includes("body.wide-full .viz-head-grid .viz-rows-row{grid-column:auto;grid-row:auto}"),
    "★ v2.40.0：宽屏下行数拍号块取消 1/4 跨列（回到第 4 列）；非宽屏 ≥1280 维持 2×2 不变");
  ok((src.match(/<template id="helpFigs/g) || []).length === 5 &&
     (src.match(/id="mountFigs/g) || []).length === 5,
    "★ 帮助示意图按章节拆 5 组 template+挂载点（归位到各节文字旁）");
}
