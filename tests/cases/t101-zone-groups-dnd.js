/* BeatSight 自动化测试 · 区标题新建分组 + 条目拖拽归组 + 自定义区分组（v2.25.0）
   T101 系列。
   ---------------------------------------------------------------------------
   需求（用户拍板，AskUserQuestion 四项全按推荐）：
     ① 区标题（节拍/扫弦/自定义）旁加「新建分组」＋ → 建一个空组（组头在标题下一级）；
     ② 条目上的 📁 在桌面收起（触屏保留常显——原生拖拽在触屏不可用，按钮是唯一入口）；
     ③ 桌面归组 = 原生拖拽：条目拖到组头/组成员上松手 = 移入该组（折叠组也能接，
        移入后自动展开）；拖到区标题/散员上松手 = 移出分组；
     ④ 三区全开放（v2.22.0 的"自定义区不参与"边界推翻）：组员 = 曲式 id，
        曲式删除时组引用同步摘除（groupPruneArrange，对称 groupPruneCustom）；
     ⑤ ✎ 改名图标桌面悬停/聚焦显示，触屏常显。
   不变量：组仍是视图组织（成员是引用）；单归属；跨区拖放直接忽略；
   区标题 textContent 逐字不变（＋ 按钮无文字节点，字形走 CSS ::before）。
   驱动手法：DnD 用 fire("dragstart"/"drop", { dataTransfer: 假桩 })——应用侧
   拖拽身份走模块级 dragItem，不依赖 DataTransfer 序列化（见 makeDraggable 注释）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const items = els => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className));
const itemByName = (els, name) => items(els).find(x => deepText(x).includes(name));
const groupBtnOf = item => item && item.children.find(c => /(^| )grp( |$)/.test(c.className));
const renBtnOf = item => item && item.children.find(c => /(^| )ren( |$)/.test(c.className));
const groupsOf = storage => JSON.parse(storage.get("beatsight.groups") || "null");
const sectionEl = (els, prefix) => els["presetList"].children
  .find(x => x.className === "preset-section" && String(x.textContent).startsWith(prefix));
const addBtnOf = sec => sec.children.find(c => c.className === "sec-add");
const fakeDT = () => ({ setData(){}, effectAllowed: "", dropEffect: "" });
/* 在桩上走一遍完整的拖放序列：dragstart（源）→ dragover + drop（目标）。
   与真实浏览器的事件序一致（dragover 必须先于 drop，应用在 dragover 里 preventDefault 放行） */
const dragTo = (src, dst) => {
  src.fire("dragstart", { dataTransfer: fakeDT() });
  dst.fire("dragover", { dataTransfer: fakeDT() });
  dst.fire("drop", { dataTransfer: fakeDT() });
};

/* ================= 场景 T101a：区标题 ＋ 新建分组（空组架子 + 冷键 + 重启） ================= */
section("T101a 新建分组 · ★ 区标题 ＋ → 输组名 → 空组头出现在标题下一级（冷键落盘 / 重启稳定）");
{
  const first = loadApp(undefined, { seedDemo: false });
  eq(groupHeadsCount(first.els), 0, "前提：初始无组");
  const sec = sectionEl(first.els, "节拍");
  ok(!!addBtnOf(sec), "★ 区标题带「新建分组」＋ 按钮（节拍区）");
  ok(!!addBtnOf(sectionEl(first.els, "扫弦")) && !!addBtnOf(sectionEl(first.els, "自定义")),
     "★ 扫弦/自定义区标题同样带 ＋（三区全开放）");
  addBtnOf(sec).fire("click");
  eq(first.els["modalInput"].value, "", "新建分组对话框输入框为空（不预填）");
  first.els["modalInput"].value = "热身组";
  first.els["modalOk"].fire("click");
  const heads = groupHeadsCount(first.els);
  eq(heads, 1, "空组头出现在节拍区（组头在标题下一级，架子先搭好）");
  const g = (groupsOf(first.storage) || { groups: [] }).groups[0];
  ok(g && g.zone === "beat" && g.name === "热身组" && g.members.length === 0 && g.open === true,
     "★ 冷键落盘：zone/name/空 members/open 全部就位");
  /* 同名幂等：再建同名组不产生第二条 */
  addBtnOf(sectionEl(first.els, "节拍")).fire("click");
  first.els["modalInput"].value = "热身组";
  first.els["modalOk"].fire("click");
  eq(groupHeadsCount(first.els), 1, "同名组幂等（不重复建，与 groupMove 同名移入同一哲学）");
  /* 重启稳定（storage 是 Map → 展开成 seed 对象喂给新实例） */
  const second = loadApp(Object.fromEntries(first.storage), { seedDemo: false });
  eq(groupHeadsCount(second.els), 1, "重启后空组架子还在（组不随条目存在与否消失）");
  /* 标题文案逐字不差：＋ 按钮无文字节点，textContent 铁律不破（t63/t84 的契约） */
  eq(String(sectionEl(first.els, "节拍").textContent), "节拍 · 11 个",
     "★ ＋ 按钮不污染标题 textContent（逐字契约保持）");
}
function groupHeadsCount(els){
  return els["presetList"].children.filter(x => x.className === "preset-group").length;
}

/* ================= 场景 T101b：拖拽归组端到端（dragstart → 组头 drop） ================= */
section("T101b 拖拽归组 · ★ 条目拖到组头松手 = 移入（data-grp / 计数 / 冷键 / 散员流收窄）");
{
  const app = loadApp(undefined, { seedDemo: false });
  const { els, storage } = app;
  addBtnOf(sectionEl(els, "节拍")).fire("click");
  els["modalInput"].value = "热身组";
  els["modalOk"].fire("click");
  const item = itemByName(els, "四分基础");
  ok(!item.dataset.grp, "前提：条目还没进组（无 data-grp）");
  const head = els["presetList"].children.find(x => x.className === "preset-group");
  dragTo(item, head);
  const item2 = itemByName(els, "四分基础");
  ok(!!item2.dataset.grp, "★ 移入成功：条目带 data-grp（applyFold 的组开合标记）");
  ok(deepText(els["presetList"].children.find(x => x.className === "preset-group")).includes("· 1 个"),
     "★ 组头计数跟随（组名 · 1 个）");
  const g = (groupsOf(storage) || { groups: [] }).groups[0];
  ok(g.members.length === 1 && g.members[0].type === "builtin" && g.members[0].idx === 1,
     "★ 冷键落盘：成员 = builtin 引用（组是视图组织，条目本体从未搬家）");
  /* 拖到**组成员**上 = 归入同组（组头窄、成员行宽，都是该组的领地） */
  const member = itemByName(els, "四分基础");
  const other = itemByName(els, "八分摇滚");
  dragTo(other, member);
  const g2 = (groupsOf(storage) || { groups: [] }).groups[0];
  eq(g2.members.length, 2, "★ 拖到组成员上同样归组（单归属：自动摘旧位再入新组）");
}

/* ================= 场景 T101c：拖回区标题 = 移出分组 + 跨区拖放忽略 ================= */
section("T101c 移出与跨区 · ★ 条目拖到区标题松手 = 移出回散员流；跨区拖放整体忽略");
{
  const app = loadApp(undefined, { seedDemo: false });
  const { els, storage } = app;
  addBtnOf(sectionEl(els, "节拍")).fire("click");
  els["modalInput"].value = "热身组";
  els["modalOk"].fire("click");
  dragTo(itemByName(els, "四分基础"),
         els["presetList"].children.find(x => x.className === "preset-group"));
  eq((groupsOf(storage) || { groups: [] }).groups[0].members.length, 1, "前提：四分基础已在组里");
  /* 拖到节拍区标题 = 移出（空 name = groupMove 的移出口） */
  dragTo(itemByName(els, "四分基础"), sectionEl(els, "节拍"));
  eq((groupsOf(storage) || { groups: [] }).groups[0].members.length, 0,
     "★ 拖回区标题松手 = 移出分组（条目回散员流；空组架子保留）");
  const item = itemByName(els, "四分基础");
  ok(!item.dataset.grp, "★ 移出后 data-grp 摘除（applyFold 不再把它当组成员）");
  /* 跨区拖放忽略：beat 条目拖到扫弦区的组头/标题上，什么也不该发生。
     先给扫弦区建一个组作落点；组头必须取**扫弦区**那个——beat 区的热身组空组
     也在列表里，无脑 find 第一个 .preset-group 会拿到它（那是一次合法落点） */
  addBtnOf(sectionEl(els, "扫弦")).fire("click");
  els["modalInput"].value = "扫弦组";
  els["modalOk"].fire("click");
  const strumHead = els["presetList"].children
    .filter(x => x.className === "preset-group")[1];   // [0]=节拍·热身组，[1]=扫弦·扫弦组
  dragTo(itemByName(els, "四分基础"), strumHead);
  const gs = (groupsOf(storage) || { groups: [] }).groups;
  eq(gs.find(g => g.name === "扫弦组").members.length, 0,
     "★ 跨区拖放忽略：beat 条目拖到扫弦组头 = 无操作（组是区内子分组）");
  eq(gs.find(g => g.name === "热身组").members.length, 0, "源组也没被误摘（zone 校验在 groupMove 之前）");
}

/* ================= 场景 T101d：自定义区分组（曲式条目归组 + 删除清理） ================= */
section("T101d 自定义区 · ★ 曲式条目拖进自定义区的组；删除曲式后组引用同步摘除");
{
  /* seedDemo:false = 走"首次带出"分支 → 自定义区有示例曲《在他乡》可归组
     （loadApp() 默认 demoSeeded=1，自定义区是空的） */
  const app = loadApp(undefined, { seedDemo: false });
  const { els, storage, beat } = app;
  addBtnOf(sectionEl(els, "自定义")).fire("click");
  els["modalInput"].value = "练习歌单";
  els["modalOk"].fire("click");
  const wrapper = els["presetList"].children
    .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
  const head = wrapper.children.find(x => x.className === "preset-group");
  ok(!!head, "★ 自定义区的空组头出现在 wrapper 内（曲式区容器契约保持）");
  const arrangeItem = wrapper.children.find(c => /(^| )preset-item( |$)/.test(c.className));
  ok(!!groupBtnOf(arrangeItem), "★ 曲式条目带 📁（触屏归组入口与节奏型同权）");
  dragTo(arrangeItem, head);
  const g = (groupsOf(storage) || { groups: [] }).groups[0];
  ok(g.zone === "custom" && g.members.length === 1 && g.members[0].type === "arrange",
     "★ 冷键：custom 区组、成员 = arrange 引用（曲式 id）");
  /* drop 的回调里 refresh 会整树重建 → wrapper 是全新节点，必须重取（旧引用读不到新状态） */
  const wrapper2 = els["presetList"].children
    .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
  const head2 = wrapper2.children.find(x => x.className === "preset-group");
  const member = wrapper2.children.find(c => /(^| )preset-item( |$)/.test(c.className));
  ok(!!member.dataset.grp, "★ 成员带 data-grp（wrapper 内 applyFold 两级真值表的数据基础）");
  /* 删除曲式 → 组引用同步摘除（groupPruneArrange，对称 groupPruneCustom）。
     删除 UI 在编排面板里，这里直接走 Store 口（同一份后端），面板路径由既有测试覆盖 */
  const arrangeId = g.members[0].id;
  beat.Store.deleteArrange(arrangeId);
  beat.Presets.refreshAfterPatternChange();
  const gAfter = (groupsOf(storage) || { groups: [] }).groups[0];
  eq(gAfter.members.length, 0, "★ 删除曲式后组引用摘除（冷键不留幽灵成员；空组架子保留）");
}

/* ================= 场景 T101e：✎/📁 的设备分流（CSS 媒体查询契约） ================= */
section("T101e 显隐分流 · ★ 桌面 ✎ 悬停显示/📁 收起（CSS 媒体查询）；触屏两者常显");
{
  /* CSS 文本级断言：harness 导出的 html 就是 index.html 原文。
     块提取：媒体块以「行首 }」收尾（块内规则全是单行，无跨行嵌套），比找某条规则
     的闭合括号稳——后者会被规则体内的分号文本坑掉（首版就栽在这） */
  const mi = html.indexOf("@media (hover: hover) and (pointer: fine)");
  ok(mi >= 0, "★ 存在 hover 环境媒体查询块（桌面分流的前提）");
  const block = html.slice(mi, html.indexOf("\n}", mi) + 2);
  ok(block.includes(".preset-item .grp{display:none}"),
     "★ 桌面（可 hover）：📁 收起——归组走拖拽，条目行不再常驻按钮");
  ok(block.includes(".preset-item:hover .ren") && block.includes(".preset-item .ren{opacity:0"),
     "★ 桌面：✎ 平时透明、悬停显示（用户需求 1 的本体）");
  ok(block.includes(".preset-item:focus-within .grp{display:inline-block}"),
     "★ 键盘可达性：聚焦条目时 📁/✎ 回来（键盘用户不因悬停分流失去入口）");
  /* 无条件规则里不得藏 display:none（触屏默认常显的保证） */
  const before = html.slice(0, mi);
  ok(!/\.preset-item \.grp\{[^}]*display:\s*none/.test(before),
     "★ 媒体查询块之外没有 .grp 的隐藏规则——触屏（不进该块）两按钮常显");
  /* 桌面上 ✎/📁 按钮仍在 DOM（只是被 CSS 收起）：功能路径不删，触屏与键盘共用 */
  const app = loadApp(undefined, { seedDemo: false });
  const item = itemByName(app.els, "四分基础");
  ok(!!renBtnOf(item) && !!groupBtnOf(item),
     "★ DOM 里 ✎/📁 恒在（分设备只发生在 CSS 层，JS 路径单一）");
}
