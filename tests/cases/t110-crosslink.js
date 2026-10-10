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
const openPick = (els, i, blk) => { rows(els)[i].children[2].children[blk].children[3].fire("click"); };   // v2.77.0：和弦输入框退役，换钮下标 4→3
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
  /* 内置型 pill：无 ✎（内容恒定），有扫弦型示例（内置示例 P1「十六分满扫（《在他乡》前奏）」，带 dir） */
  const builtinStrum = pillBy(pick, /十六分满扫（《在他乡》前奏）/);
  ok(!!builtinStrum, "前提：候选里有内置扫弦型（示例 P1；v3.35.5 取代已删的民谣扫弦）");
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
  /* ★ v3.31.0：歌词字号加了 min(..., 24px) 上限（铺满档 --cs 无界增长会把字撑出固定行高，
     实测 1920 铺满 = 30.9px 塞进 26px 字块）。故钉"按 --cs 缩放"时一并钉住上限。 */
  ok(src.includes("--cs") && src.includes("font-size:min(calc(14px * var(--cs,1)),21px)"),
    "★ 铺满时格内字形按 --cs 等比放大（歌词字号随网格宽缩放；v3.31.0 起带上限 21px，"
    + "上限 ≥ 正常档的 20.3px 故不影响非铺满观感）");
  /* v3.0.0（PLAN-v9 批 0）：断点 1440→1280 + 第 4 轨 168px（预设库块，收起态跨两行）；
     r1 = 音量｜BPM｜三开关｜预设库，r2 左三列 = 行数拍号（展开抽屉时抽屉占 r2、行数行下推 r3）。
     其余轨道语义（首列可收缩 / safe center 溢出回退）逐字沿用 v2.76.2 的结论。 */
  /* v3.0.0 批 5：第 2 轨（BPM）从 `1fr` 改成 `minmax(min-content,312px)`、末轨 168 → 413px——
     用户要求"BPM 卡宽度与音量卡一致，腾出的空间给预设库（它要放 6 个入口按钮）"。
     两条刚性轨都保留 min-content 下限（v2.76.2 的 Windows 度量结论不变）。 */
  /* 控制芯重排（PLAN-v9 批 2）：v3.13.0 丁方案两列网格退役 → 单列居中芯（402）。
     断言改为钉新形态：块布局 + 芯容器居中 + 402 上限。 */
  ok(src.includes("html body .card .viz-head-grid{display:block;max-width:none;margin:0 auto}")
     && src.includes(".viz-head-grid .card-head-left .group{max-width:402px;margin:0 auto}"),
    "★★ 控制芯（PLAN-v9 批 2，取代 v3.13.0 丁）：两列网格退役 → ≥1280 单列、芯 402px 居中"
    + "（内容宽 = 标签槽 52 + 间距 10 + 滑杆 340，中轴 = 跑道中轴）");
  ok(src.includes("max-width:1000px"),
    "★★ v3.13.0：控制区限宽 1000px（1440 实测两块各 ~484、两侧各 ~165 恒定）——现役于 560–1279.9 堆叠档");
  ok(!src.includes(".viz-head-grid .viz-rows-row{background:transparent}"),
    "★ v3.3.0：行数拍号行的单独去底补丁已删（四块统一无底后它成了死规则）");
  ok(src.includes("background:transparent;border-radius:10px;padding:12px 16px}"),
    "★ v3.3.0：组容器底整条去掉（四块统一 transparent，圆角与 12/16 内边距保留）");
  ok(!src.includes(".card-head-left{grid-row"),
    "★★ v2.39.0：竖跨执行错误已修——音量列不再 grid-row 竖跨（否则 BPM 被挤到右侧列）");
  ok(!src.includes("grid-column:1 / 4;grid-row:2"),
    "★★ v3.3.0：行数拍号行不再显式占 r2——自动落第 4 轨（与音量/BPM/开关同一行），跨列与行号特化全部退役");
  ok(src.includes(".viz-head-grid .card-head-left{"),
    "★★ 控制芯重排（PLAN-v9 批 2）：共用选择器只剩 .card-head-left（.viz-toggles 分支随开关列退役）");
  /* ★ v3.12.0：`.viz-rows-row .group{flex-direction:row…}` 随并排行整块退役——
     那条规则服务的是"同屏行数面板 + 拍号面板并列"，两者一搬一删后已无对象；
     同屏行数在设置里改用 `.group` 默认 column 骨架（标签在上、档位在下，与 Swing 组同款）。
     ★ 断言前剥注释："留名字作纪念"不算违规（仓内 `.page-foot` 同款口径）。 */
  const srcNoCmt = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
  ok(!srcNoCmt.includes(".viz-rows-row"),
    "★★ v3.12.0：`.viz-rows-row` 相关规则全部退役（搬块之后不留死规则）");
  ok(/<div class="group">\s*<div class="group-label">同屏行数 · 扫弦与歌词共用<\/div>\s*<div class="viz-rows" id="vizRowsRow"/.test(src),
    "★★ v3.12.0：同屏行数住进设置弹窗的 .group 骨架（与 Swing 组同款：标签在上、档位在下）"
    + "——v3.45.4 起 .group 不再带内联 margin-top（间距令牌 16/8 收口，见 index.html .set-pane 规范注释）");
  ok(/\.pb-ctx \.pat-now\{[^}]*white-space:nowrap/.test(src),
    "★ 型名单行省略——无 nowrap 时省略号失效、长型名折两行撑破底栏胶囊（同 v2.40.0 原意，"
    + "v3.4.1 起宿主为底栏胶囊 .pb-ctx）");
  ok(src.includes(".viz-head-grid .viz-toggles .toggle-pill{background:transparent;border:0}"),
    "★★ v2.40.0：组内开关胶囊去自带底色（--card 深、宽随文案参差）——每组只留组底一层");
  /* v3.13.0：`body.wide-full .viz-head-grid` 的三轨特化整块退役——第 3 块 v3.12.0 已退、
     且宽屏满幅下控制区按丁方案恒定 1000 居中（base ≥1280 规则原样生效），不再另立轨道。 */
  ok(!/body\.wide-full \.viz-head-grid\{grid-template-columns/.test(src),
    "★★ v3.13.0：宽屏满幅的三轨特化已退役（跑道拉满、控制区恒定 1000 居中——两套轨道口径并一处）");
  /* ★ v3.19.0：「三开关块独占第二行 + fit-content」退役——三列均分后开关列 = col 3
     （width:100% 吃满列宽），钉位移交 t168（开关列纵排）与 t175（交错顺序）。 */
  ok(!src.includes('grid-column:1 / -1;grid-row:2;justify-self:center;width:fit-content}'),
    "★★★ v3.19.0：开关块独占第二行的落位规则已退役（三列均分，开关列 = col 3）");
  ok(!src.includes("body.wide-full .viz-head-grid .viz-rows-row"),
    "★ v3.3.0：宽屏下「行数拍号复位」规则随显式占位一并删除（它原本就是为抵消 r2 跨列而写，现在没有可抵消的东西）");
  ok(src.includes(".viz-head-grid .viz-head{display:contents}")
     && !/\n\s*\.viz-head\{display:contents\}/.test(src),
    "★★ v2.41.0：壳溶解带 .viz-head-grid 前缀——裸 `.viz-head{display:contents}` 会被更靠后的"
    + " `.card-head{display:flex}` 同特异性压掉（v2.38 起三版从未生效：音量+BPM 被装进同一网格项，"
    + "间隙 48/14 混用、宽屏第 4 列空置）");
  ok(!/.viz-head-grid .viz-rows-row\{[^}]*margin-bottom:\s*0/.test(src),
    "★★ v3.3.0：行 2 的 margin 清零规则已删（它服务的 r2 轨道不存在了）；行距由栅格 row-gap 统一管");
  /* ★★★ v3.42.0（用户拍板）：条从"元素自身背景"搬到 ::-webkit-slider-runnable-track，并**左右各内缩
     半个钮径**（圆头挂出端头）——填充仍是 --vfill 分段渐变，只是坐标系随之变成"内缩后的条宽"。 */
  /* ★ 第四轮（用户拍板选丙）：内缩量从半钮径改成**一整钮径 + 4px**——半钮径时条端仍被不透明圆头盖住，
     端点观感与旧版一致（用户实拍）；整钮径后条端落在圆头之外、恒留 4px 空隙，挂出才肉眼可见。 */
  /* ★ v3.42.0 第六轮：五轮「圆头挂出」尝试**整体回退**（根因：Chrome 让拇指跑在轨道盒里，内缩轨道造不出挂出）
     ⇒ 本条恢复 v2.41.0 原始口径：绿色填充 = 元素自身背景上的 --vfill 分段渐变。 */
  ok(src.includes("input[type=range]:not(.arg-range-input){background:linear-gradient(to right,var(--green) var(--vfill,0%),var(--line) var(--vfill,0%))"),
    "★★ v2.41.0：滑杆已走过段绿色填充（--vfill 分段渐变）；编排页播放范围双滑块 :not 排除"
    + "（双轨叠一轨、区间语义，各自左起填充会读错范围）");
  ok(/function paintRange\((?:\/\*\*[^*]*\*\/ )?el\)/.test(src) && src.includes("paintRange($(\"bpmSlider\"))")
     && src.includes("document.addEventListener(\"input\","),
    "★★ v2.41.0：填充统一走装配区 paintRange（--vfill）——拖动 document 级 input 委托全覆盖，"
    + "程序化改值在 setBpm / wallPaintDim / latApply 各补一发（函数声明提升，跨模块可见）");
  ok((src.match(/<template id="helpFigs/g) || []).length === 5 &&
     (src.match(/id="mountFigs/g) || []).length === 5,
    "★ 帮助示意图按章节拆 5 组 template+挂载点（归位到各节文字旁）");
}
