/* BeatSight 自动化测试 · 编辑器「发声 / 空扫」开关
   T114 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   当前契约：restRow 只在「节拍」档出现；琶音/分解必须发声。
   真实休止先从其他弹法切回「节拍」（清弹法字段、保留 rest），再翻 rest。
   airRow 联动 air/rest：空扫不触发 onset，实扫触发 onset；数据层旧组合不批量迁移。
   核心不变量：翻转不碰 t（barSum 不变），空扫/休止只减自己的 onset、其余音符时刻一字不动。 */
"use strict";
const { loadApp, FakeAudioContext, pill, ok, eq, section, drive } = require("../lib/harness");

/* 编辑器第 b 小节的格子（edbar 的 children = [label, track]，track 的 children = edcell）。
   editorRender() 会重建编辑器 DOM，选中/翻转后必须重新取元素（T47c 的老教训） */
function edCellsOf(els, b){
  return els["editorBars"].children[b].children[1].children;
}
/* #restRow 的当前态（v3.52.0 双档 [发声(off)|休止(on)]）：{ disabled, pressed, hint }。
   pressed 读「休止」档的 aria-pressed（与 .active 同源，由 setPressed 一处写全——「开关三件套」纪律） */
function restState(els){
  const on = els["restRow"].children[1];
  return { disabled: !!on.disabled, pressed: on.getAttribute("aria-pressed"), hint: els["restHint"].textContent };
}
/* #airRow 的当前态（v3.52.0 新增，双档 [实扫(off)|空扫(on)]）：pressed 读「空扫」档 */
function airState(els){
  const on = els["airRow"].children[1];
  return { disabled: !!on.disabled, pressed: on.getAttribute("aria-pressed"), hint: els["airHint"].textContent };
}
/* 播放 seconds 秒，回传 hits（{t, freq}）——用于证明翻转在发声层只减一声、时刻一字不动 */
function playSeq(setup, seconds){
  const { beat } = loadApp();
  if (setup) setup(beat);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, seconds);
  beat.Controls.stop();
  return ac.hits.map(h => [h.t, h.freq]);
}

/* ================= 场景 T114a：未选中 → 禁用 + 提示 ================= */
section("T114a 发声开关 · 未选中禁用与提示");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  const st = restState(els);
  ok(st.disabled, "未选中音符 → 开关禁用（禁用而不是弹窗报错，与方向/弦区行同一交互约定）");
  eq(st.pressed, "false", "未选中 → 休止档 aria-pressed=false（不显示「休止中」的假态）");
  eq(st.hint, "", "未选中 → hint 空串（PLAN-v11 B2：悬浮层未选中即隐藏，占位话术退役）");
  eq(els["restRow"].children.length, 2, "restRow 两档 [发声 | 休止]（v3.52.0，不再是单 toggle）");
  eq(els["airRow"].children.length, 2, "airRow 两档 [实扫 | 空扫]（v3.52.0 新增）");
  const ast = airState(els);
  ok(ast.disabled, "未选中 → airRow 两档同样禁用");
  eq(ast.pressed, "false", "未选中 → 空扫档 aria-pressed=false");
  eq(ast.hint, "", "未选中 → airHint 空串");
}

/* ================= 场景 T114b：扫弦 → 节拍 → 休止（时值不动、撤销可逆） ================= */
section("T114b 发声开关 · 休止唯一路径：先切「节拍」再翻 rest");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "翻转素材", meter: 4,
    bars: [0,1,2,3].map(() => [{ t:48, dir:"D", zone:0 }, { t:24, dir:"U" }, { t:48 }, { t:72 }]) }] })).ok,
    "混合时值带方向/弦区的预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();

  edCellsOf(els, 0)[0].fire("click");                 // 选中扫弦格 {t:48, dir:"D", zone:0}
  let st = restState(els);
  ok(st.disabled && els["restRow"].hidden === true, "★ 扫弦档 restRow 隐藏且禁用（扫弦必须发声）");
  eq(st.hint, "", "隐藏行不残留发声提示");
  els["techRow"].fire("click", { target: pill({ tech: "beat" }) });
  const beat0 = beat.Editor.draft().bars[0][0];
  eq(beat0.dir, undefined, "先切「节拍」→ dir 删除");
  eq(beat0.zone, undefined, "先切「节拍」→ zone 删除");
  eq(beat0.rest, false, "切「节拍」保留当前发声状态（之后可再选休止）");
  st = restState(els);
  ok(!st.disabled && els["restRow"].hidden !== true, "节拍档 restRow 恢复显示与可用");

  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  const s0 = beat.Editor.draft().bars[0][0];
  eq(s0.rest, true, "再点「休止」→ 该步 rest=true");
  eq(s0.dir, undefined, "★ 纯节拍休止不带方向");
  eq(s0.zone, undefined, "★ 纯节拍休止不带弦区");
  eq(s0.air, undefined, "★ 纯节拍休止不带空扫字段");
  eq(s0.t, 48, "★ t 一字不动（rest 是占位字段不是时值）");
  eq(beat.Editor.draft().bars[0].reduce((n, s) => n + s.t, 0), 192,
     "barSum 不变（192）——小节完整性不受影响");
  st = restState(els);
  eq(st.pressed, "true", "翻转后休止档 true（与高亮同源）");
  ok(/ rest /.test(" " + edCellsOf(els, 0)[0].className + " "), "编辑器格子挂上 .rest（灰底休止样式）");
  eq(edCellsOf(els, 0)[0].children.filter(c => /(^| )strumv( |$)/.test(c.className)).length, 0,
     "纯节拍休止不画扫弦记号");

  beat.Editor.undo();
  const back = beat.Editor.draft().bars[0][0];
  eq(back.rest, false, "撤销一步 → 回到发声的节拍格");
  eq(back.dir, undefined, "此时仍是纯节拍（undo 不会跨两步）");
  beat.Editor.undo();
  const back2 = beat.Editor.draft().bars[0][0];
  eq(back2.dir, "D", "再撤一步 → 回到原扫弦方向");
  eq(back2.zone, 0, "原弦区随快照恢复");
  ok(els["restRow"].children[0].disabled, "撤销清了选中（edSel=null）→ 开关回到禁用");
}

/* ================= 场景 T114c：airRow 联动 air/rest（dir 不动） ================= */
section("T114c 空扫开关 · airRow 联动 air/rest：实扫/空扫往返，dir 不动");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "空扫素材", meter: 4,
    bars: [[{ t:48, dir:"D" }, { t:48, rest:true }, { t:48 }, { t:48 }]] }] })).ok, "空扫素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();

  /* ① 实扫 → 空扫：air/rest 同步翻转为空扫态（air 记谱，rest 抑 onset），dir 保留 */
  edCellsOf(els, 0)[0].fire("click");
  eq(airState(els).pressed, "false", "实扫档初始 false");
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  let s0 = beat.Editor.draft().bars[0][0];
  eq(s0.air, true, "点「空扫」→ air=true");
  eq(s0.rest, true, "★ rest=true（空扫不触发节拍器 onset，前音由演奏延续）");
  eq(s0.dir, "D", "★ dir 保留（有方向空扫 = 带箭头蓝虚线）");
  ok(/(^| )ghost( |$)/.test((edCellsOf(els, 0)[0].children.filter(c => /(^| )strumv( |$)/.test(c.className))[0] || {}).className),
     "空扫 → .ghost 蓝虚线");

  /* ② 空扫 → 实扫：air/rest 同步翻转回发声态 */
  els["airRow"].fire("click", { target: pill({ air: "off" }) });
  s0 = beat.Editor.draft().bars[0][0];
  eq(s0.air, false, "点「实扫」→ air=false");
  eq(s0.rest, false, "★ rest=false（实扫触发节拍器 onset）");
  eq(s0.dir, "D", "★ dir 不动");

  /* 纯节拍休止不提供手部行；旧版 rest+air 的渲染兼容由 T250 守。 */
  edCellsOf(els, 0)[1].fire("click");
  ok(els["airRow"].hidden === true, "★ 节拍休止格：airRow 隐藏（手部动作归扫弦档）");
}

/* ================= 场景 T114d：撤销往返（两组开关各自入栈） ================= */
section("T114d 两组开关 · 撤销往返保真");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "往返素材", meter: 4,
    bars: [[{ t:48, dir:"D" }, { t:48 }, { t:48 }, { t:48 }]] }] })).ok, "往返素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  edCellsOf(els, 0)[0].fire("click");
  const before = JSON.stringify(beat.Editor.draft().bars[0][0]);
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 空扫
  ok(/"air":true/.test(JSON.stringify(beat.Editor.draft().bars[0][0])), "写入 air:true");
  beat.Editor.undo();
  eq(JSON.stringify(beat.Editor.draft().bars[0][0]), before, "★ 撤销整步 JSON 逐字回到原形（rest/dir/air 全保真）");
}

/* ================= 场景 T114e：发声层——空扫静默，其余音符时刻一字不动 =================
   同一型的两个孪生版本（仅某一步 rest 不同）各播一遍：命中数恰差 1（那颗扫弦），
   全部命中时刻的集合不变（节拍器网格照常补拍——hasStrum 谱的网格按步进区间扫，
   rest 步只静默自己的扫弦声，不吃掉落在它区间里的网格拍点）。
   ★ 素材一律 zone:0（低弦区 = 单频段一声）：若用 dir-only 格，调度层会补成全扫（zone=1），
     全扫是双频段两声，"差几声"的口径就不干净了（首跑实测：期望 -1 实得 -2）。 */
section("T114e 发声开关 · 空扫静默 + 时间轴不变量");
{
  const mk = (name, rest) => ({ name, meter: 4,
    bars: [0,1,2,3].map(() => [
      { t:48, dir:"D", zone:0 }, rest ? { t:48, rest:true, dir:"D", zone:0 } : { t:48, dir:"D", zone:0 },
      { t:48, dir:"U", zone:0 }, { t:48, dir:"D", zone:0 },
    ]) });
  const before = playSeq(beat => {
    beat.Store.importPresets(JSON.stringify({ presets: [mk("孪生-实扫", false)] }));
    beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  }, 2);
  const after = playSeq(beat => {
    beat.Store.importPresets(JSON.stringify({ presets: [mk("孪生-空扫", true)] }));
    beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  }, 2);
  eq(after.length, before.length - 1, "★ 恰好少一声（被翻成空扫的那颗扫弦），不是少一整拍");
  const tSet = arr => [...new Set(arr.map(h => h[0]))].sort((a, b) => a - b);
  eq(JSON.stringify(tSet(after)), JSON.stringify(tSet(before)),
     "★ 全部命中时刻一字不动（网格拍点仍在空扫的区间里响）——翻转不碰时间轴");
}
