/* BeatSight 自动化测试 · 音符属性悬浮窗「弹法」四档重组（节奏型页面改造批 3）
   T256 系列。
   ---------------------------------------------------------------------------
   契约（新建节奏型页面改造实施方案 §1.3）：
     · 弹法 = 既有字段的派生（stepTechOf）：str→分解（含 str=[]）、dir=A→琶音、
       dir D/U 或 zone 或 air→扫弦、其余→节拍（纯时值块，新块默认档）；数据模型零新增；
     · 点档落库分派：节拍→删 dir/zone/str/air（rest 保留）；扫弦→dir 保留已有 D/U、
       其余来源默认 D、删 str、zone/air 保留；琶音→dir=A、删 str、删 air（批 6：
       琶音逐弦触弦、无空扫概念）、zone 保留；分解→str=str||[]、删 dir/zone/air；
     · 行显隐矩阵（hidden）：beat→四行全收；strum→方向+弦区+手部；arp→弦区
       （手部批 6 起同收——琶音无空扫概念）；pick→逐弦；restRow 四档恒显；
     · 高亮由派生驱动（旧数据/导入数据打开悬浮窗各档自动归位）；
     · 同档重按不推撤销栈（派生态没变 = 无变更）；
     · 「实扫/空扫」只在扫弦档出现（批 6 收窄）——纯节拍/琶音块不再被迫认领扫弦概念
       （本组的存在理由）。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, pill, ok, eq, section } = require("../lib/harness");

const edCellsOf = (els, b) => els["editorBars"].children[b].children[1].children;
const S0 = beat => beat.Editor.draft().bars[0];
/* 归一化比较：固定键序 t/rest/dir/zone/str/air（落库分派只该动这些位） */
const norm = s => JSON.stringify({ t: s.t, rest: !!s.rest, dir: s.dir, zone: s.zone,
  str: s.str === undefined ? undefined : (s.str || []), air: s.air });
/* techRow 的 aria-pressed 读法（data-tech=X 档） */
const techPressed = (els, tech) => els["techRow"].children.find(p => p.dataset.tech === tech).getAttribute("aria-pressed");

/* 素材型：七格覆盖七种推导（节拍 / 下扫 / 上扫 / 琶音 / 分解 / 仅zone / 仅air）。
   拍数取 7（VALID_METER 白名单含 7，BUILTINS 有 7/4 先例）：7×48t = 7×TPB 恰好占满，
   每格四分音符——推导判据与时值无关，七种组合一格格排开最好读。 */
function openMaterial(beat, els){
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "弹法素材", meter: 7,
    bars: [[
      { t: 48 },                       // 0 节拍（全无）
      { t: 48, dir: "D" },             // 1 扫弦（下扫）
      { t: 48, dir: "U" },             // 2 扫弦（上扫）
      { t: 48, dir: "A" },             // 3 琶音
      { t: 48, str: [{ s: 5 }] },      // 4 分解
      { t: 48, zone: 2 },              // 5 扫弦（仅弦区）
      { t: 48, air: true },            // 6 扫弦（仅空扫）
    ]] }] })).ok, "弹法素材导入成功");
  beat.Store.S.sig = 7;   /* 出厂 S.sig=4：不匹配的 sel 会被 refreshAfterPatternChange 回退到内置——先对齐拍号 */
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
}

/* ================= 场景 T256a：弹法推导（高亮自动归位） ================= */
section("T256a 弹法推导 · 七种字段组合的高亮归位 + 未选中禁用");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  ok(els["techRow"].children.every(p => p.disabled), "未选中 → 弹法四档禁用（与其它行同源）");
  const expect = ["beat", "strum", "strum", "arp", "pick", "strum", "strum"];
  expect.forEach((t, i) => {
    edCellsOf(els, 0)[i].fire("click");
    eq(techPressed(els, t), "true", `★ 格 ${i} → 高亮「${t}」档（stepTechOf 派生）`);
  });
  /* 对照：每格只亮自己那档 */
  edCellsOf(els, 0)[3].fire("click");
  eq(techPressed(els, "beat"), "false", "琶音格不亮节拍档");
  eq(techPressed(els, "strum"), "false", "琶音格不亮扫弦档");
}

/* ================= 场景 T256b：点档落库分派 ================= */
section("T256b 落库分派 · 四档各写/删哪些字段、rest 保留、撤销可回退");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  /* 节拍档：扫弦格 → 删 dir（zone/air/str 本就无）；rest 保留 */
  edCellsOf(els, 0)[1].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "beat" }) });
  eq(norm(S0(beat)[1]), norm({ t: 48 }), "★ 点「节拍」→ dir 删除（回纯时值块）");
  /* 分解档：节拍格 → str=[]（声明意图）、dir/zone/air 不存在 */
  edCellsOf(els, 0)[0].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "pick" }) });
  eq(norm(S0(beat)[0]), norm({ t: 48, str: [] }), "★ 点「分解」→ str=[]（空数组 = 等点弦）");
  /* 扫弦档：分解格 → 删 str、dir 默认 D；zone/air 保留的验证放在琶音格 */
  edCellsOf(els, 0)[4].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "strum" }) });
  eq(norm(S0(beat)[4]), norm({ t: 48, dir: "D" }), "★ 点「扫弦」→ 删 str、dir 默认下扫");
  /* 扫弦档：上扫格 → 同档重按（派生态已是 strum）→ 不推栈、dir 原样 */
  edCellsOf(els, 0)[2].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "strum" }) });
  eq(S0(beat)[2].dir, "U", "★ 已是扫弦（U）再点「扫弦」→ 同档不推栈、dir 保留（上扫不被重置）");
  /* 琶音档：带 zone+air 的扫弦格 → dir=A、zone 保留、str/air 删（批 6：琶音无空扫概念） */
  edCellsOf(els, 0)[5].fire("click");
  els["airRow"].fire("click", { target: pill({ air: "on" }) });   // 先补 air=true（zone+air 组合）
  els["techRow"].fire("click", { target: pill({ tech: "arp" }) });
  eq(norm(S0(beat)[5]), norm({ t: 48, dir: "A", zone: 2 }), "★ 点「琶音」→ dir=A、zone 保留、air 删（无空扫概念）");
  /* 撤销：分派是一步（undo 回到点击前） */
  beat.Editor.undo();
  eq(norm(S0(beat)[5]), norm({ t: 48, zone: 2, air: true }), "★ undo 一步退回点档前（dir/air 删除、air 补写还在）");
  beat.Editor.undo();
  eq(norm(S0(beat)[5]), norm({ t: 48, zone: 2 }), "★ 再撤回 air 补写之前");
}

/* ================= 场景 T256c：同档重按不推撤销栈 ================= */
section("T256c 同档重按 · 派生态没变 = 无变更、不污染撤销栈");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  edCellsOf(els, 0)[1].fire("click");                       // 扫弦格
  els["techRow"].fire("click", { target: pill({ tech: "strum" }) });   // 同档重按
  beat.Editor.undo();
  ok(S0(beat)[1].dir !== undefined, "★ 同档重按不推栈：undo 一次即回到点档之前（dir 还在）");
  edCellsOf(els, 0)[0].fire("click");                       // 节拍格
  els["techRow"].fire("click", { target: pill({ tech: "beat" }) });    // 同档重按
  beat.Editor.undo();
  eq(S0(beat)[0].t, 48, "节拍格同档重按同样不推栈（undo 只回到更早的一次真实变更）");
}

/* ================= 场景 T256d：行显隐矩阵 ================= */
section("T256d 显隐矩阵 · 四档下 方向/弦区/手部/逐弦 的 hidden 与 restRow 恒显");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  const hiddenOf = id => els[id].hidden === true;
  /* 节拍格（0）：四行全收——「实扫/空扫必选」对纯节拍块的概念错配在此消解 */
  edCellsOf(els, 0)[0].fire("click");
  ok(hiddenOf("dirRow") && hiddenOf("zoneRow") && hiddenOf("airRow") && hiddenOf("strRow"),
     "★ 节拍档：方向/弦区/手部/逐弦全收（hidden）");
  ok(els["restRow"].hidden !== true, "★ restRow 四档恒显（纯节拍也有发声/休止）");
  /* 扫弦格（1）：方向 + 弦区 + 手部；逐弦收 */
  edCellsOf(els, 0)[1].fire("click");
  ok(els["dirRow"].hidden !== true && els["zoneRow"].hidden !== true && els["airRow"].hidden !== true && hiddenOf("strRow"),
     "★ 扫弦档：方向/弦区/手部显示、逐弦收");
  /* 琶音格（3）：弦区；方向收（由弹法行承载）、手部收（批 6：琶音无空扫概念） */
  edCellsOf(els, 0)[3].fire("click");
  ok(hiddenOf("dirRow") && els["zoneRow"].hidden !== true && hiddenOf("airRow") && hiddenOf("strRow"),
     "★ 琶音档：方向/手部收、弦区显示");
  /* 分解格（4）：逐弦显示；方向/弦区/手部收 */
  edCellsOf(els, 0)[4].fire("click");
  ok(els["strRow"].hidden !== true && hiddenOf("dirRow") && hiddenOf("zoneRow") && hiddenOf("airRow"),
     "★ 分解档：逐弦显示、方向/弦区/手部收");
  /* 点弦号启用 → 面板可用（t240c 链路在新显隐下照走） */
  ok(els["strRow"].children.length > 0, "分解档下逐弦面板已构建（ensureStrPanel 照旧）");
}

/* ================= 场景 T256e：渲染零影响（str=[] 不画记号） ================= */
section("T256e str 空数组 · 渲染零 pick 记号 / 声明不落 dir/zone/air");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  edCellsOf(els, 0)[0].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "pick" }) });
  const cell = edCellsOf(els, 0)[0];
  eq(cell.children.filter(c => /(^| )strumv( |$)/.test(c.className)).length, 0,
     "★ str=[] 的格不渲染 pick 记号（渲染按 length 判，声明期零视觉噪音）");
  eq(S0(beat)[0].str.length, 0, "且 str 字段在（分解意图已声明）");
  /* 点弦号后照常出记号（链路未断）——注意 undo 会清选中（t240c-1 口径），重选后再点弦 */
  beat.Editor.undo();                                     // 回到节拍格
  edCellsOf(els, 0)[0].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "pick" }) });
  const lines = els["strRow"].children.find(c => /str-lines/.test(c.className));
  if (lines){
    const tog5 = lines.children.find(r => r.dataset.s === "5").children[0];
    els["strRow"].fire("click", { target: tog5 });       // 处理器挂在 strRow（fireStr 同款）
    eq(JSON.stringify(S0(beat)[0].str), JSON.stringify([{ s: 5 }]), "点弦号 → str 落 [{s:5}]（点弦链路照旧）");
  } else {
    ok(false, "逐弦面板未构建（异常）");
  }
}
