/* BeatSight 自动化测试 · 条目改名（批次③，v2.21.0）
   T97 系列。
   ---------------------------------------------------------------------------
   契约：预设库每个**节奏型**条目（内置 + 自定义）名字旁有 ✎ 改名图标
   （曲式条目已有 overlay 内改名入口，不在本批）。两条后端：
     · 内置型 = **覆盖**：BUILTINS[i].name 运行期改写（显示层十几处读取点全链路
       生效），持久化只落 beatsight.builtinNames（idx → 名）；源名以数据区快照
       BUILTIN_SRC_NAMES 为还原基准，**清空并确定 = 恢复原名**。
     · 自定义型 = 直接改 c.name（用户数据）→ beatsight.customs 落盘；曲式块按
       **id** 引用，改名对曲式零影响。空名 = 取消。
   共同约束：名字 trim + 40 字上限（与曲式名同口径）；不校验重名（识别靠
   内容/下标/id，名字不是任何一方的命名空间）；脏冷键逐条白名单、不污染内存。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const itemByName = (els, name) => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className)).find(x => deepText(x).includes(name));
const renameBtnOf = item => item && item.children.find(c => /(^| )ren( |$)/.test(c.className));
const bnamesOf = storage => JSON.parse(storage.get("beatsight.builtinNames") || "null");

/* ================= 场景 T97a：内置型改名端到端（UI 路径 + 重启持久） ================= */
section("T97a 内置型改名 · ✎ → uiPrompt 覆盖 → 列表/标题/冷键/重启全链路");
{
  const first = loadApp(undefined, { seedDemo: true });
  const item = itemByName(first.els, "十六分满扫（《在他乡》前奏）");
  ok(!!item, "前提：扫弦区有内置示例条目 P1");
  const pen = renameBtnOf(item);
  ok(!!pen, "★ 内置条目带 ✎ 改名图标");
  pen.fire("click");
  eq(first.els["modalMsg"].textContent,
    "重命名内置型「十六分满扫（《在他乡》前奏）」（清空并确定 = 恢复原名）",
    "★ 对话框提示带**源名**（覆盖态下用户也能看到原名是什么）");
  eq(first.els["modalInput"].value, "十六分满扫（《在他乡》前奏）", "输入框预填当前名");
  /* 确认改名 */
  first.els["modalInput"].value = "我的前奏型";
  first.els["modalOk"].fire("click");
  eq(first.beat.BUILTINS[12].name, "我的前奏型", "★ BUILTINS[12].name 被覆盖（运行期生效）");
  eq(first.beat.Store.builtinSrcName(12), "十六分满扫（《在他乡》前奏）", "★ 源名快照原样保留（还原基准）");
  ok(deepText(first.els["presetList"]).includes("我的前奏型"), "★ 侧栏条目立即显示新名");
  eq(JSON.stringify(bnamesOf(first.storage)),
    JSON.stringify({ v: 1, names: { "12": "我的前奏型" } }), "★ 冷键 beatsight.builtinNames 落盘");
  /* 选中它 → 主界面标题跟新名（显示层全链路生效的直接证据） */
  itemByName(first.els, "我的前奏型").fire("click");
  eq(first.els["patternName"].textContent, "我的前奏型", "★ 选中后主界面标题 = 覆盖名");
  first.beat.Controls.stop();
  /* 重启：覆盖从冷键重新套上（不是靠内存残留） */
  const seed = {}; first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  eq(second.beat.BUILTINS[12].name, "我的前奏型", "★ 重启后覆盖名仍在（加载即套）");
  ok(deepText(second.els["presetList"]).includes("我的前奏型"), "重启后侧栏显示覆盖名");
  eq(second.beat.Store.builtinSrcName(12), "十六分满扫（《在他乡》前奏）", "源名快照不受重启影响");
}

/* ================= 场景 T97b：恢复原名（清空并确定） ================= */
section("T97b 恢复原名 · ★ 清空输入并确定 → 回源名 + 冷键覆盖清除 + 重启稳定");
{
  const first = loadApp(undefined, { seedDemo: true });
  first.beat.Store.renameBuiltin(12, "我的前奏型");          // 先造一个覆盖态（数据层直改）
  first.beat.Presets.refreshAfterPatternChange();            // Store 不碰 UI：刷新交给调用方（与真实 UI 回调同口径）
  eq(first.beat.BUILTINS[12].name, "我的前奏型", "前提：覆盖态已就位");
  const item = itemByName(first.els, "我的前奏型");
  renameBtnOf(item).fire("click");
  eq(first.els["modalInput"].value, "我的前奏型", "对话框预填的是覆盖名");
  first.els["modalInput"].value = "";                        // 清空 = 恢复原名
  first.els["modalOk"].fire("click");
  eq(first.beat.BUILTINS[12].name, "十六分满扫（《在他乡》前奏）", "★ 恢复为源名（快照还原）");
  eq(JSON.stringify(bnamesOf(first.storage)), JSON.stringify({ v: 1, names: {} }),
    "★ 冷键覆盖已清除（不留幽灵条目）");
  const seed = {}; first.storage.forEach((v, k) => { seed[k] = v; });
  const second = loadApp(seed);
  eq(second.beat.BUILTINS[12].name, "十六分满扫（《在他乡》前奏）", "★ 重启后仍是源名");
}

/* ================= 场景 T97c：自定义型改名（直接改 + 曲式按 id 不受影响） ================= */
section("T97c 自定义型改名 · ✎ → c.name 直改；曲式块按 id 引用零影响；重启持久");
{
  const first = loadApp(undefined, { seedDemo: true });
  first.beat.Store.importPresets(JSON.stringify([{ name: "练习型A", meter: 4,
    bars: [Array.from({ length: 4 }, () => ({ t: 48 }))] }]));
  const c = first.beat.Store.customs[0];
  const v = first.beat.Store.upsertArrange({ name: "我的曲式",
    sections: [{ name: "主歌", blocks: [{ ref: { type: "custom", id: c.id }, repeats: 2 }] }] });
  ok(!!v, "前提：曲式已引用该自定义型");
  first.beat.Presets.refreshAfterPatternChange();
  const item = itemByName(first.els, "练习型A");
  ok(!!renameBtnOf(item), "★ 自定义条目也带 ✎（内置/自定义同构挂载）");
  renameBtnOf(item).fire("click");
  first.els["modalInput"].value = "慢速热身";
  first.els["modalOk"].fire("click");
  eq(c.name, "慢速热身", "★ c.name 直改");
  ok(deepText(first.els["presetList"]).includes("慢速热身"), "侧栏立即跟新");
  const a2 = first.beat.Store.findArrange(v.id);
  eq(JSON.stringify(a2.sections[0].blocks[0].ref), JSON.stringify({ type: "custom", id: c.id }),
    "★ 曲式块引用分毫未动（按 id，不按名）");
  eq(first.beat.songBars(a2), 2, "曲式长度不变（resolveRef 仍解析到它）");
  const seed = {}; first.storage.forEach((v2, k) => { seed[k] = v2; });
  const second = loadApp(seed);
  eq(second.beat.Store.customs[0].name, "慢速热身", "★ 重启后名字保持（beatsight.customs 落盘）");
}

/* ================= 场景 T97d：校验与边界（空名 / 超长 / 脏下标 / 原生 API） ================= */
section("T97d 校验边界 · 空名拒绝 / 40 字截断 / 非法下标 / 脏冷键白名单");
{
  const beat = loadApp(undefined, { seedDemo: true }).beat;
  /* 自定义：空名 = 取消（false），名字不动 */
  beat.Store.importPresets(JSON.stringify([{ name: "练习型B", meter: 4,
    bars: [Array.from({ length: 4 }, () => ({ t: 48 }))] }]));
  const c = beat.Store.customs[0];
  eq(beat.Store.renameCustom(c.id, "   "), false, "★ 空白名 → false（取消）");
  eq(c.name, "练习型B", "名字未被改成空白");
  eq(beat.Store.renameCustom(c.id, "x".repeat(50)), true, "超长名接受但截断");
  eq(c.name, "x".repeat(40), "★ 40 字上限（与曲式名同口径）");
  /* 内置：非法下标 false；空名恢复源名 */
  eq(beat.Store.renameBuiltin(-1, "x"), false, "★ 负下标 → false");
  eq(beat.Store.renameBuiltin(99, "x"), false, "★ 越界下标 → false");
  eq(beat.Store.renameBuiltin(0, ""), true, "空名 = 恢复原名（合法操作）");
  eq(beat.BUILTINS[0].name, "民谣扫弦 · 下-下上-上下上", "★ BUILTINS[0] 回源名");
  eq(beat.Store.builtinSrcName(0), "民谣扫弦 · 下-下上-上下上", "源名快照一致");
  /* 脏冷键：越界/非数字/空白条目全被丢弃，合法条目照常应用 */
  const dirty = loadApp({ "beatsight.builtinNames":
    JSON.stringify({ v: 1, names: { "0": "合法覆盖", "99": "越界", "abc": "非数字", "1": "   " } }) });
  eq(dirty.beat.BUILTINS[0].name, "合法覆盖", "★ 合法条目照常应用");
  eq(dirty.beat.BUILTINS[1].name, "四分基础", "★ 空白覆盖被丢弃（不污染源名）");
  eq(dirty.beat.BUILTINS.length, 17, "越界/非数字条目不影响库结构");
}

/* ================= 场景 T97e：改名与内置化迁移共存（v2.20.0 语义不受影响） ================= */
section("T97e 共存 · 覆盖名不碰内容/识别；迁移照常收走旧 custom");
{
  /* 第一会话：给 P4 起覆盖名 + 造 v2.19.x 老形状（customs 灌示例型、曲式引用 custom id）
     seedDemo:false → 走"首次带出"分支，demo arrange 才会真的进库（true = 模拟已删示例曲的老用户） */
  const first = loadApp(undefined, { seedDemo: false });
  first.beat.Store.renameBuiltin(15, "前密后疏 · 我惯用的力度");
  const spec = first.beat.demoBuildSpec().presets;
  first.beat.Store.importPresets(JSON.stringify(spec));
  const ids = first.beat.Store.customs.slice(-5).map(c => c.id);
  first.beat.Store.findArrange(first.beat.DEMO_ID).sections.forEach(s => s.blocks.forEach(b => {
    if (b.ref.type === "builtin") b.ref = { type: "custom", id: ids[b.ref.idx - 12] };
  }));
  first.beat.Store.persistCold(); first.beat.Store.persistArranges();
  eq(JSON.stringify(first.beat.BUILTINS[15].bars), JSON.stringify(spec[3].bars),
    "★ 覆盖只动 name，bars 内容与规范谱逐位一致（内容仍是唯一标识）");
  /* 第二会话：迁移照常跑，覆盖名互不干扰 */
  const sd = {}; first.storage.forEach((v, k) => { sd[k] = v; });
  const second = loadApp(sd);
  eq(second.beat.Store.customs.length, 0, "★ 迁移照常收走示例 custom（改名覆盖不影响认型）");
  ok(second.beat.Store.findArrange(second.beat.DEMO_ID).sections
    .every(s => s.blocks.every(b => b.ref.type === "builtin" && b.ref.idx >= 12 && b.ref.idx <= 16)),
    "★ 曲式引用照常重映射到内置下标");
  eq(second.beat.BUILTINS[15].name, "前密后疏 · 我惯用的力度", "★ 覆盖名原样保留（两套冷键互不干扰）");
  ok(deepText(second.els["presetList"]).includes("前密后疏 · 我惯用的力度"),
    "侧栏显示覆盖名（用户视角无迁移痕迹）");
}
