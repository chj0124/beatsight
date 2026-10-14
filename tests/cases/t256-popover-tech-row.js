/* BeatSight 自动化测试 · 音符属性悬浮窗「弹法」四档重组（节奏型页面改造批 3）
   T256 系列。
   ---------------------------------------------------------------------------
   契约：
     · 弹法 = 既有字段的派生（stepTechOf）：str→分解（含 str=[]）、dir=A→琶音、
       dir D/U 或 zone 或 air→扫弦、其余→节拍（纯时值块，新块默认档）；数据模型零新增；
     · 点档落库分派：节拍→删 dir/zone/str/air（rest 保留）；从其他弹法切扫弦→默认实扫
       （rest=false, air=false、删 str、保留或默认 D/U、zone 保留）；琶音/分解→删空扫字段、
       rest=false；已是扫弦再点扫弦不推栈——空扫/实扫由 airRow 维护；
     · airRow 一次点击同步两个字段：空扫 = rest=true+air=true（不触发 onset），
       实扫 = rest=false+air=false（触发 onset）；方向与弦区不动；
     · 行显隐矩阵：beat→发声；strum→方向+弦区+手部；arp→弦区；pick→逐弦；
       restRow 只在节拍档出现，真实休止先回节拍；
     · 高亮由派生驱动；同档重按不推撤销栈，但旧休止琶音/分解同档点击仍负责恢复发声。
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

/* ================= 场景 T256b：弹法切换与空扫联动落库 ================= */
section("T256b 落库分派 · 默认实扫 / 琶音分解恢复发声 / 撤销可回退");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  /* 节拍档：扫弦格 → 删 dir（zone/air/str 本就无）；rest 保留 */
  edCellsOf(els, 0)[1].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "beat" }) });
  eq(norm(S0(beat)[1]), norm({ t: 48 }), "★ 点「节拍」→ dir 删除（回纯时值块）");
  /* 分解档：节拍格 → str=[]、删方向/空扫字段、rest=false */
  edCellsOf(els, 0)[0].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "pick" }) });
  eq(norm(S0(beat)[0]), norm({ t: 48, rest: false, str: [] }), "★ 点「分解」→ str=[] 且恢复发声");
  /* 扫弦档：分解格 → 删 str、默认下扫；从其他弹法进入时默认实扫（rest=false, air=false） */
  edCellsOf(els, 0)[4].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "strum" }) });
  eq(norm(S0(beat)[4]), norm({ t: 48, rest: false, dir: "D", air: false }),
     "★ 点「扫弦」→ 默认实扫（删 str、dir=D、air 显式 false）");
  /* 扫弦档：上扫格 → 同档重按（派生态已是 strum）→ 不推栈、dir/air 原样 */
  edCellsOf(els, 0)[2].fire("click");
  els["techRow"].fire("click", { target: pill({ tech: "strum" }) });
  eq(S0(beat)[2].dir, "U", "★ 已是扫弦（U）再点「扫弦」→ 同档不推栈、dir 保留（上扫不被重置）");
  /* 空扫联动：airRow 一次点击同时写 rest/air */
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  eq(norm(S0(beat)[2]), norm({ t: 48, rest: true, dir: "U", air: true }),
     "★ 点「空扫」→ rest=true + air=true（空扫不触发 onset）");
  /* 琶音档：带 zone+air 的空扫格 → dir=A、zone 保留、删 air、恢复发声 */
  edCellsOf(els, 0)[5].fire("click");
  els["airRow"].fire("click", { target: pill({ air: "on" }) });   // 先补 zone+air 组合（现为空扫态）
  els["techRow"].fire("click", { target: pill({ tech: "arp" }) });
  eq(norm(S0(beat)[5]), norm({ t: 48, rest: false, dir: "A", zone: 2 }),
     "★ 点「琶音」→ dir=A、zone 保留、air 删除、恢复发声");
  /* 撤销：弹法分派与 airRow 各是一步 */
  beat.Editor.undo();
  eq(norm(S0(beat)[5]), norm({ t: 48, rest: true, zone: 2, air: true }),
     "★ undo 一步退回点琶音前（空扫态保留）");
  beat.Editor.undo();
  eq(norm(S0(beat)[5]), norm({ t: 48, rest: false, zone: 2 }), "★ 再撤回 air 补写之前");
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
section("T256d 显隐矩阵 · 发声只在节拍；方向/弦区/手部/逐弦按弹法显隐");
{
  const { beat, els } = loadApp();
  openMaterial(beat, els);
  const hiddenOf = id => els[id].hidden === true;
  /* 节拍格（0）：发声显示，其余四行全收 */
  edCellsOf(els, 0)[0].fire("click");
  ok(hiddenOf("dirRow") && hiddenOf("zoneRow") && hiddenOf("airRow") && hiddenOf("strRow"),
     "★ 节拍档：方向/弦区/手部/逐弦全收（hidden）");
  ok(!hiddenOf("restRow"), "★ 节拍档：发声/休止显示（休止唯一入口）");
  /* 扫弦格（1）：方向 + 弦区 + 手部；发声/逐弦收 */
  edCellsOf(els, 0)[1].fire("click");
  ok(els["dirRow"].hidden !== true && els["zoneRow"].hidden !== true && els["airRow"].hidden !== true && hiddenOf("strRow"),
     "★ 扫弦档：方向/弦区/手部显示、逐弦收");
  ok(hiddenOf("restRow"), "★ 扫弦档：发声/休止收（扫弦必须发声）");
  /* 琶音格（3）：弦区；发声/方向/手部/逐弦收 */
  edCellsOf(els, 0)[3].fire("click");
  ok(hiddenOf("dirRow") && els["zoneRow"].hidden !== true && hiddenOf("airRow") && hiddenOf("strRow"),
     "★ 琶音档：方向/手部/逐弦收、弦区显示");
  ok(hiddenOf("restRow"), "★ 琶音档：发声/休止收（琶音必须发声）");
  /* 分解格（4）：逐弦显示；发声/方向/弦区/手部收 */
  edCellsOf(els, 0)[4].fire("click");
  ok(els["strRow"].hidden !== true && hiddenOf("dirRow") && hiddenOf("zoneRow") && hiddenOf("airRow"),
     "★ 分解档：逐弦显示、方向/弦区/手部收");
  ok(hiddenOf("restRow"), "★ 分解档：发声/休止收（分解必须发声）");
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

/* ================= 场景 T256f：实扫默认发声 / 空扫保留 / 旧琶音分解修复 ================= */
section("T256f 空扫语义 · 从休止进扫弦默认实扫，已有空扫不被同档误改");
{
  const FIXTURE = () => ({ name: "空扫语义素材", meter: 6, bars: [[
    { t: 48, rest: true },
    { t: 48, rest: true },
    { t: 48, rest: true },
    { t: 48, rest: true, dir: "D", air: true },
    { t: 48, rest: true, dir: "A" },
    { t: 48, rest: true, str: [{ s: 5, f: 7, tech: "P" }] },
  ]] });
  const openFixture = () => {
    const app = loadApp();
    const beat = app.beat, els = app.els;
    ok(beat.Store.importPresets(JSON.stringify({ presets: [FIXTURE()] })).ok, "空扫语义素材导入成功");
    beat.Store.S.sig = 6;
    beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
    beat.Presets.refreshAfterPatternChange();
    beat.Editor.open();
    return { beat, els };
  };
  /* 第一只 app：纯休止节拍格 → 三种弹法都应恢复发声（扫弦默认实扫）。 */
  const freshApp = openFixture();
  const beat = freshApp.beat, els = freshApp.els;
  const hiddenOf = id => els[id].hidden === true;
  const clickTech = tech => els["techRow"].fire("click", { target: pill({ tech }) });
  const select = (appEls, i) => edCellsOf(appEls, 0)[i].fire("click");
  const fresh = [
    { i: 0, tech: "strum", want: { t: 48, rest: false, dir: "D", air: false }, label: "扫弦" },
    { i: 1, tech: "arp", want: { t: 48, rest: false, dir: "A" }, label: "琶音" },
    { i: 2, tech: "pick", want: { t: 48, rest: false, str: [] }, label: "分解" },
  ];
  select(els, 0);
  ok(!hiddenOf("restRow") && els["restRow"].children.every(p => !p.disabled),
     "前提：纯节拍格的 restRow 显示且可用");
  fresh.forEach(({ i, tech, want, label }) => {
    select(els, i);
    clickTech(tech);
    eq(norm(S0(beat)[i]), norm(want), `★ 休止节拍 →「${label}」：恢复发声且字段落库正确`);
    ok(hiddenOf("restRow") && els["restRow"].children.every(p => p.disabled),
       `★「${label}」档 restRow 隐藏且禁用（不能退回休止）`);
  });
  /* 第二只 app：旧数据兼容性独立验证，撤销栈必须从零开始，才能钉「同档不推栈」。 */
  const legacyApp = openFixture();
  const lbeat = legacyApp.beat, lels = legacyApp.els;
  const lhidden = id => lels[id].hidden === true;
  const lclickTech = tech => lels["techRow"].fire("click", { target: pill({ tech }) });
  /* 旧版有方向空扫：rest=true 是语义本体，同档点「扫弦」不得误清；隐藏 restRow 也不能改。 */
  select(lels, 3);
  eq(norm(S0(lbeat)[3]), norm({ t: 48, rest: true, dir: "D", air: true }), "前提：旧空扫数据保留 rest=true+air=true");
  eq(lels["undoBtn"].disabled, true, "前提：尚无撤销记录");
  lels["restRow"].fire("click", { target: pill({ rest: "off" }) });
  eq(S0(lbeat)[3].rest, true, "★ 隐藏 restRow 的合成事件不能改空扫格（处理器二道防线）");
  lclickTech("strum");
  eq(norm(S0(lbeat)[3]), norm({ t: 48, rest: true, dir: "D", air: true }),
     "★ 已是空扫再点「扫弦」→ rest/air 原样保留，不被误改为实扫");
  eq(lels["undoBtn"].disabled, true, "★ 同档空扫重按不推撤销栈");
  /* 旧休止琶音/分解：这两档没有空扫概念，同档点击负责恢复发声。 */
  select(lels, 4);
  lels["restRow"].fire("click", { target: pill({ rest: "off" }) });
  lclickTech("arp");
  eq(norm(S0(lbeat)[4]), norm({ t: 48, rest: false, dir: "A" }),
     "★ 旧「琶音+休止」点同档 → rest=false、air 删除、dir=A 保留");
  select(lels, 5);
  lels["restRow"].fire("click", { target: pill({ rest: "off" }) });
  lclickTech("pick");
  eq(norm(S0(lbeat)[5]), norm({ t: 48, rest: false, str: [{ s: 5, f: 7 }] }),
     "★ 旧「分解+休止」点同档 → rest=false，str/品数保留（rest 格上的技巧已按 normStr 抹除）");
}
