/* BeatSight 自动化测试 · 六线底纹（v2.4.2 引入开关 · v2.10.1 补启动收敛 · ★ 本版开关退役）
   T86 系列。
   ---------------------------------------------------------------------------
   沿革：v2.10.1 修「开关说谎」（标记写死 on/true、启动不收敛）；v2.10.6 补「开关随型显隐」。
   ★ 本版（用户拍板）：设置里的 tabToggle 开关**退役**——六线底纹对带扫弦记谱的型**恒显**，
   显隐收敛为单条件 syncTabLayer：`.viz` 是否带 no-tab 只看 vizHasStrum()。
   S.showTab 字段随之删除：老存档里的旧键被加载白名单自然忽略（T86b 守这条——
   「上次关掉底纹」的用户升级后底纹回来，这正是本版的行为变更，不是回归）。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const isBarRow = el => /(^| )bar-row( |$)/.test(el.className);
const isTab = el => /(^| )tab( |$)/.test(el.className);
/* 每小节的 .tab 层（不带扫弦记谱的小节没有 ⇒ 该位是 undefined），顺序 = 行的顺序 */
const tabsOf = els => els["viz"].children.filter(isBarRow)
  .map(r => r.children.find(isTab));
const hasNoTab = els => els["viz"].classList.contains("no-tab");

/* ================= 场景 T86a：扫弦型下底纹恒显（无开关可关） ================= */
section("T86a 六线底纹 · 扫弦型下恒显（tabToggle 已退役）");
{
  const { beat, els } = loadApp();
  /* ★ v3.35.5：出厂默认型是四分基础（节拍型）——本场景要"有底纹"的扫弦谱，
     显式切到内置示例型（dir-only、带记谱）承载同一契约。★ 本版：型名改编号制。 */
  beat.Store.S.sel = { type: "builtin", idx: 11 };     // 节奏型1（《在他乡》）
  beat.Presets.applyPatternChange();
  eq(beat.Store.S.showTab, undefined, "★ S.showTab 字段已删除（读取为 undefined，不是残留的布尔）");
  ok(!hasNoTab(els), "★ 扫弦型下 .viz 不带 no-tab（底纹恒显，无开关可关）");

  const tabs = tabsOf(els);
  ok(tabs.length > 0 && tabs.every(Boolean),
     "★ 当前扫弦型（示例 P1）带记谱 ⇒ 每行都建了 .tab（下面看得到线是「真有东西」，不是空跑）");
  /* v2.26.1：弦线改由 CSS 渐变画（DOM 瘦身），这里仍要证明"看得见"不是空跑——
     只是客体从"6 个 <i>"换成"容器存在 + 层没被 no-tab 藏 + 渐变规则在"。 */
  ok(tabs.every(t => t.children.length === 0),
     "★ 每层 .tab 零子节点（六条线是 CSS 渐变，不是 6 个 <i>——与 t47 同口径）");
  ok(/\.tab\{[^}]*repeating-linear-gradient/.test(html),
     "★ .tab 的规则里确有渐变（线由它画出来，「看得见」有客体）");
}

/* ================= 场景 T86b：老存档 showTab:false 被自然忽略（零迁移） ================= */
section("T86b 六线底纹 · 老存档 showTab:false 被白名单忽略（字段删除零迁移）");
{
  const app = loadApp(seedState({ showTab: false }));
  app.beat.Store.S.sel = { type: "builtin", idx: 11 };   // 节奏型1（《在他乡》）
  app.beat.Presets.applyPatternChange();
  eq(app.beat.Store.S.showTab, undefined, "★ 种入 showTab:false 也读不到字段（旧键自然忽略）");
  ok(!hasNoTab(app.els), "★★ 「上次关掉底纹」的老用户升级后底纹恒显（本版行为变更的钉子）");
}

/* ================= 场景 T86c：显隐只由「型是否带记谱」单条件决定 ================= */
section("T86c 六线底纹 · 节拍型恒不显 / 扫弦型恒显（双向可逆）");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type: "builtin", idx: 0 };      // 四分基础（节拍型，零 dir/zone）
  beat.Presets.applyPatternChange();
  ok(hasNoTab(els), "★ 节拍型 ⇒ .viz 带 no-tab（画了箭头就等于承认这是扫弦谱，语义矛盾）");
  beat.Store.S.sel = { type: "builtin", idx: 11 };     // 切回扫弦型
  beat.Presets.applyPatternChange();
  ok(!hasNoTab(els), "★ 切回扫弦型 ⇒ no-tab 摘除（底纹恢复，双向可逆）");
}

/* ================= 场景 T86d：源码钉（开关删干净 + 单条件收敛） ================= */
section("T86d 六线底纹 · 开关与字段删干净 / syncTabLayer 单条件");
{
  ok(!/id="tabToggle"/.test(html), "★★ 标记里已无 tabToggle（开关退役，不是留着灰掉）");
  ok(!/S\.showTab/.test(html), "★★ 源码里连注释都不再出现 S.showTab（字段删除，历史留痕以「showTab」不带 S. 前缀书写）");
  ok(/classList\.toggle\("no-tab", !vizHasStrum\(\)\)/.test(html),
     "★ syncTabLayer 收敛为单条件（no-tab 只看 vizHasStrum）");
  ok(/\.viz\.no-tab \.tab\{display:none\}/.test(html), "★ 显隐落点仍是 CSS 类（.viz.no-tab .tab）");
}
