/* BeatSight 自动化测试 · 区内子分组（批次④，v2.22.0）
   T98 系列。
   ---------------------------------------------------------------------------
   契约：节拍/扫弦两区内可建**命名的子分组**——条目经 📁 按钮移入（输组名，
   同名组直接移入；清空并确定 = 移出），组头可折叠（如分区）、可改名、可删组
   （散员不删条目）。两条铁律：
     · 组是**视图组织**：成员是引用（builtin idx / custom id），条目本体从不
       住进组里——删组 = 组对象消失 = 成员自然回到散员流；
     · 组头与条目同为 #presetList 的**直接子节点**（.preset-group，绝不套
       wrapper）——测试逐层遍历 children，多一层全线失配。
   共同约束：单归属（同一 ref 同时只在一个组）；成员按内容复检区归属
   （hasStrum 漂移 → 退回散员流）；组数据落冷键 beatsight.groups，
   逐组白名单校验（缺名/坏区/坏 ref 整组丢弃）；**无组时渲染与 v2.21.0
   逐字节一致**（回归红线）。自定义区（曲式）v2.22.0 不参与，v2.25.0 起三区
   全开放（T98i 改判 + t101 端到端）——区标题 ＋ 新建 / 拖拽归组见 t101。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const items = els => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className));
const itemByName = (els, name) => items(els).find(x => deepText(x).includes(name));
const groupHeads = els => els["presetList"].children.filter(x => x.className === "preset-group");
const groupBtnOf = item => item && item.children.find(c => /(^| )grp( |$)/.test(c.className));
const groupsOf = storage => JSON.parse(storage.get("beatsight.groups") || "null");
/* 区切片：以两个区头（textContent 以 from/to 开头的 .preset-section）之间为界——
   用前缀匹配：区内条目增删会改计数文案（"节拍 · 11 个"→"12 个"），前缀才是稳定锚 */
const zoneSlice = (els, fromText, toText) => {
  const kids = Array.from(els["presetList"].children);
  const a = kids.findIndex(x => x.className === "preset-section" && x.textContent.startsWith(fromText));
  const b = toText
    ? kids.findIndex(x => x.className === "preset-section" && x.textContent.startsWith(toText))
    : kids.length;
  return kids.slice(a + 1, b);
};

/* ================= 场景 T98a：无组回归——渲染与 v2.21.0 逐字节一致 ================= */
section("T98a 无组回归 · ★ 零组时无任何新节点混入（条目直接子节点 / 三区标题逐字 / 顺序不变）");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  ok(groupHeads(els).length === 0, "★ 无组时侧栏零个 .preset-group 节点");
  eq(JSON.stringify(els["presetList"].children.filter(x => x.className === "preset-section").map(x => x.textContent)),
    JSON.stringify(["节拍 · 11 个", "扫弦 · 6 个", "自定义 · 1 首"]),
    "★ 三区标题逐字不变（计数口径 = 区内全部条目数，分组不改总数）");
  /* 条目顺序：节拍区 = BUILTINS[1..11] 原序（组缺席 → 散员流原样） */
  const beatKids = zoneSlice(els, "节拍 · 11 个", "扫弦 · 6 个");
  eq(beatKids.length, 11, "节拍区孩子 = 11 个条目（不多不少，无组头混入）");
  ok(beatKids.every(x => /(^| )preset-item( |$)/.test(x.className)), "节拍区全是 preset-item（扁平结构）");
  ok(deepText(beatKids[0]).includes("四分基础"), "节拍区第一条仍是四分基础（BUILTINS[1]，顺序未动）");
  /* 选中照常：分组基础设施没碰 pick 路径 */
  itemByName(els, "四分基础").fire("click");
  eq(JSON.stringify(beat.Store.S.sel), JSON.stringify({ type:"builtin", idx:1 }), "选中路径原样");
  beat.Controls.stop();
}

/* ================= 场景 T98b：建组移入端到端（UI 路径 + 冷键 + 重启） ================= */
section("T98b 建组移入 · ★ 📁 → 输组名 → 组头出现/条目归位/冷键落盘/重启保持");
{
  const first = loadApp(undefined, { seedDemo: false });
  const item = itemByName(first.els, "四分基础");
  ok(!!groupBtnOf(item), "★ 内置条目带 📁 移入分组按钮");
  groupBtnOf(item).fire("click");
  eq(first.els["modalInput"].value, "", "不在任何组时输入框为空（预填 = 当前组名）");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  const heads = groupHeads(first.els);
  eq(heads.length, 1, "★ 组头出现");
  ok(deepText(heads[0]).includes("热身") && deepText(heads[0]).includes("· 1 个"),
    "组头文案 = 组名 + 可见成员数（计数不撒谎）");
  /* 条目归位：节拍区内，组头在前、成员条目随其后、散员在最后 */
  const beatKids = zoneSlice(first.els, "节拍", "扫弦");
  eq(beatKids[0].className, "preset-group", "★ 组头在区头之后第一个（组在前、散员在后）");
  ok(deepText(beatKids[1]).includes("四分基础"), "★ 成员条目紧跟组头（原序从散员流消失）");
  eq(beatKids.length, 12, "★ 区孩子总数守恒 = 组头 1 + 成员 1 + 散员 10（11 个内置，1 个进组）");
  eq(JSON.stringify(groupsOf(first.storage)),
    JSON.stringify({ v:1, groups:[{ id: heads[0].dataset.gid, name:"热身", zone:"beat",
      members:[{ type:"builtin", idx:1 }], open:true }] }),
    "★ 冷键 beatsight.groups 落盘（ref = builtin idx 协议；组头 data-gid 与之同源）");
  /* 重启：组结构原样回来 */
  const seed = {}; first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  const h2 = groupHeads(second.els);
  eq(h2.length, 1, "★ 重启后组还在");
  ok(deepText(h2[0]).includes("热身"), "组名保持");
  const beatKids2 = zoneSlice(second.els, "节拍", "扫弦");
  ok(deepText(beatKids2[1]).includes("四分基础"), "成员归位保持");
  eq(second.beat.Store.groups[0].id, groupsOf(first.storage).groups[0].id, "组 id 稳定（改名/删组靠它定位）");
}

/* ================= 场景 T98c：移入语义三合一（同名并入 / 跨类型同组 / 空名移出） ================= */
section("T98c 移入语义 · ★ 同名组并入不新建 / 内置+自定义同组 / 清空 = 移出 / 预填当前组名");
{
  const first = loadApp(undefined, { seedDemo: false });
  first.beat.Store.importPresets(JSON.stringify([{ name: "练习型A", meter: 4,
    bars: [Array.from({ length: 4 }, () => ({ t: 48 }))] }]));
  first.beat.Presets.refreshAfterPatternChange();
  /* 内置先建组 */
  groupBtnOf(itemByName(first.els, "四分基础")).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  /* 自定义型移入**同名**组 → 并入不新建 */
  const customItem = itemByName(first.els, "练习型A");
  ok(!!groupBtnOf(customItem), "★ 自定义条目也带 📁（内置/自定义同构挂载）");
  groupBtnOf(customItem).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  const heads = groupHeads(first.els);
  eq(heads.length, 1, "★ 同名组（同区）只有一个——并入而非新建");
  ok(deepText(heads[0]).includes("· 2 个"), "组内两个成员（内置 + 自定义跨类型同组）");
  eq(first.beat.Store.groups[0].members.length, 2, "冷键成员数同步");
  /* 再点内置条目的 📁：预填当前组名 */
  groupBtnOf(itemByName(first.els, "四分基础")).fire("click");
  eq(first.els["modalInput"].value, "热身", "★ 在组内时预填当前组名（清空确定 = 移出的出口可见）");
  first.els["modalInput"].value = "";
  first.els["modalOk"].fire("click");
  const heads2 = groupHeads(first.els);
  eq(heads2.length, 1, "移出一个成员后组还在（空组保留，架子不拆）");
  ok(deepText(heads2[0]).includes("· 1 个"), "成员数回到 1");
  const beatKids = zoneSlice(first.els, "节拍", "扫弦");
  ok(deepText(beatKids[2]).includes("四分基础"),
    "★ 移出的条目回到散员流开头（散员按 BUILTINS 原序，四分基础是节拍区第一个内置）");
  eq(first.beat.Store.groups[0].members.length, 1, "冷键同步：只剩自定义成员");
}

/* ================= 场景 T98d：组折叠（含"分区折叠盖组"的两级真值表） ================= */
section("T98d 组折叠 · ★ 组头点击收放 / 区收着时组跟着收 / 区再展开组仍收 / 重启记忆 open");
{
  const first = loadApp(undefined, { seedDemo: false });
  groupBtnOf(itemByName(first.els, "四分基础")).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  const head = groupHeads(first.els)[0];
  eq(head.getAttribute("aria-expanded"), "true", "默认展开");
  head.fire("click");
  eq(head.getAttribute("aria-expanded"), "false", "★ 点击组头 → 收起");
  const beatKids = zoneSlice(first.els, "节拍", "扫弦");
  ok(beatKids[1].hidden === true, "★ 成员条目被 hidden（折叠只置 hidden、不删节点——分区同款契约）");
  eq(beatKids.length, 12, "节点一个不少（hidden 不删）");
  /* 两级真值表：区收着 → 组头跟收、组内组外全收；区再展开 → 散员出来、**组成员仍收** */
  first.els["presetList"].children.find(x => x.className === "preset-section" && x.textContent === "节拍 · 11 个").fire("click");
  ok(head.hidden === true, "★ 区收着 → 组头跟着收");
  ok(beatKids[1].hidden === true && beatKids[2].hidden === true, "组内组外全部 hidden");
  first.els["presetList"].children.find(x => x.className === "preset-section" && x.textContent === "节拍 · 11 个").fire("click");
  ok(head.hidden === false, "区展开 → 组头回来");
  ok(beatKids[2].hidden === false, "散员（区孩子第 3 个起）出来");
  ok(beatKids[1].hidden === true, "★ 组成员仍收着（组自己的折叠没被区开合掀掉——单遍扫描的真值表）");
  head.fire("click");
  ok(beatKids[1].hidden === false, "组再展开 → 成员出来");
  /* 折叠状态落冷键（跟组对象走），重启记忆 */
  const seed = {}; first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  eq(groupHeads(second.els)[0].getAttribute("aria-expanded"), "true", "重启后组展开态保持");
  eq(second.beat.Store.groups[0].open, true, "open 字段落盘");
}

/* ================= 场景 T98e：组改名（✎ → 组名变 / 成员与冷键同步） ================= */
section("T98e 组改名 · ✎ → uiPrompt → 组头/冷键同步，成员引用分毫不动");
{
  const first = loadApp(undefined, { seedDemo: false });
  groupBtnOf(itemByName(first.els, "四分基础")).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  const head = groupHeads(first.els)[0];
  head.children.find(c => /(^| )ren( |$)/.test(c.className)).fire("click");
  eq(first.els["modalInput"].value, "热身", "对话框预填当前组名");
  first.els["modalInput"].value = "基本功";
  first.els["modalOk"].fire("click");
  ok(deepText(groupHeads(first.els)[0]).includes("基本功"), "★ 组头显示新名");
  eq(first.beat.Store.groups[0].name, "基本功", "冷键同步");
  eq(first.beat.Store.groups[0].members.length, 1, "成员引用分毫不动");
}

/* ================= 场景 T98f：删组（散员不删条目 + 幂等） ================= */
section("T98f 删组 · × → uiConfirm → 组消失/成员全部散回/条目本身健在可选中");
{
  const first = loadApp(undefined, { seedDemo: false });
  groupBtnOf(itemByName(first.els, "四分基础")).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  const head = groupHeads(first.els)[0];
  head.children.find(c => /(^| )del( |$)/.test(c.className)).fire("click");
  ok(String(first.els["modalMsg"].textContent).includes("移回原区") &&
     String(first.els["modalMsg"].textContent).includes("条目本身不受影响"),
    "★ 删除确认把后果说清楚（散员 ≠ 删条目）");
  first.els["modalOk"].fire("click");
  eq(groupHeads(first.els).length, 0, "★ 组头消失");
  ok(!!itemByName(first.els, "四分基础"), "条目本身健在");
  itemByName(first.els, "四分基础").fire("click");
  eq(JSON.stringify(first.beat.Store.S.sel), JSON.stringify({ type:"builtin", idx:1 }),
    "★ 散员照常可选可播（删组没有碰条目本体）");
  first.beat.Controls.stop();
  eq(first.beat.Store.groups.length, 0, "冷键同步清空");
}

/* ================= 场景 T98g：删自定义型 → 组引用同步摘除 ================= */
section("T98g 联动清理 · ★ 删组内 custom → groupPruneCustom 摘引用，冷键不留幽灵成员");
{
  const first = loadApp(undefined, { seedDemo: false });
  first.beat.Store.importPresets(JSON.stringify([{ name: "练习型A", meter: 4,
    bars: [Array.from({ length: 4 }, () => ({ t: 48 }))] }]));
  first.beat.Presets.refreshAfterPatternChange();
  groupBtnOf(itemByName(first.els, "练习型A")).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  eq(first.beat.Store.groups[0].members.length, 1, "前提：custom 已在组内");
  itemByName(first.els, "练习型A").children.find(c => /(^| )del( |$)/.test(c.className)).fire("click");
  first.els["modalOk"].fire("click");                 // 删除预设确认
  eq(first.beat.Store.groups[0].members.length, 0, "★ 组引用同步摘除");
  eq(JSON.stringify(groupsOf(first.storage).groups[0].members), JSON.stringify([]),
    "★ 冷键不留幽灵成员（渲染层跳过 + 删除时清理，双保险的前一半落了盘）");
  eq(groupHeads(first.els).length, 1, "组本身保留（空组架子在，还能再移入）");
}

/* ================= 场景 T98h：脏冷键白名单（同 builtinNames 口径） ================= */
section("T98h 校验边界 · ★ 非法组整组丢弃 / 非法 ref 逐条丢弃 / 重复 ref 单归属 / 合法组照常应用");
{
  const dirty = loadApp({ "beatsight.groups": JSON.stringify({ v:1, groups: [
    { id:"g1", name:"好组", zone:"beat", members:[{ type:"builtin", idx:1 }], open:false },
    { id:"g2", name:"   ", zone:"beat", members:[] },                        // 空白名 → 丢弃
    { id:"g3", name:"坏区", zone:"foo", members:[] },                        // 非法区（v2.25.0 起 beat/strum/custom 三区全合法，"foo" 才是坏的）→ 丢弃
    { id:"g4", name:"坏ref", zone:"strum", members:[{ type:"builtin", idx:99 }] },  // 越界 ref 整组无合法成员
    { id:"g5", name:"坏类型", zone:"beat", members:[{ type:"nonsense" }] },  // 坏 ref 类型 → 整组空
    { id:"g1", name:"重id", zone:"beat", members:[] },                       // id 重复 → 丢弃后者
    { id:"g6", name:"单归属", zone:"strum", members:[{ type:"builtin", idx:1 }] }, // idx1 已在 g1 → 该条丢弃
  ] }) });
  eq(JSON.stringify(dirty.beat.Store.groups.map(g => g.name)),
    JSON.stringify(["好组", "坏ref", "坏类型", "单归属"]),
    "★ 只有结构合法的组活下来（空白名/坏区/重id 整组丢弃；坏 ref 逐条丢弃后空组保留）");
  eq(dirty.beat.Store.groups[0].name, "好组");
  eq(dirty.beat.Store.groups[0].members.length, 1, "合法成员照常应用");
  eq(dirty.beat.Store.groups[0].open, false, "open 字段照常应用");
  eq(groupHeads(dirty.els).length, 4, "侧栏渲染 4 个组头（含空组——架子在，还能再移入）");
  const beatKids = zoneSlice(dirty.els, "节拍", "扫弦");
  ok(deepText(beatKids[0]).includes("热身") === false && beatKids[0].className === "preset-group",
    "好组渲染在节拍区（组头第一个孩子）");
}

/* ================= 场景 T98i：v2.25.0 边界（自定义区参与分组 + 组不进导出） =================
   v2.22.0 的旧边界「曲式条目无 📁（自定义区不分组）」由 v2.25.0 推翻——用户拍板
   三区全开放：曲式条目与节奏型同权（📁 触屏入口 + 桌面拖拽），组员 = 曲式 id。
   不变的半条：组是本机的视图组织，**不进预设备份**（接收方自己组织）。 */
section("T98i 边界 · ★ 曲式条目有 📁（三区全开放）；预设备份不含组数据");
{
  const first = loadApp(undefined, { seedDemo: false });
  /* 曲式条目（自定义区）有 📁：与节奏型条目同权 */
  const arrangeBox = first.els["presetList"].children
    .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
  ok(!!arrangeBox, "前提：自定义区有曲式容器");
  const arrangeItem = arrangeBox.children.find(c => /(^| )preset-item( |$)/.test(c.className));
  ok(!!arrangeItem && !!groupBtnOf(arrangeItem),
    "★ 曲式条目有 📁 移入分组入口（v2.25.0 三区全开放，触屏归组与节奏型同权）");
  /* 组不进导出：预设备份是节奏型谱面数据，组是本机的视图组织 */
  first.beat.Store.importPresets(JSON.stringify([{ name: "练习型B", meter: 4,
    bars: [Array.from({ length: 4 }, () => ({ t: 48 }))] }]));
  first.beat.Presets.refreshAfterPatternChange();       // importPresets 不刷 UI：与真实调用点同口径补一次
  groupBtnOf(itemByName(first.els, "练习型B")).fire("click");
  first.els["modalInput"].value = "热身";
  first.els["modalOk"].fire("click");
  const exp = JSON.parse(first.beat.Store.serializePresets());
  eq(exp.presets.length, 1, "预设备份照旧只有 1 个型");
  ok(JSON.stringify(exp).indexOf("热身") < 0, "★ 导出内容不含组（组不随备份走，接收方自己组织）");
}
