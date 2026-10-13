/* BeatSight 自动化测试 · 编辑器「发声开关」——实扫 ↔ 空扫 ↔ 休止一键翻转（v2.45.0）
   T114 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   背景：空扫 = 休止槽带 dir（v2.1.0 口径），但编辑器此前没有任何直接切换两者的控件——
   调色板替换会破坏小节时值（休止块只有四分一种）且抹掉 dir/zone，非四分时长的互换实际做不到。
   v2.45.0 加 #restRow 单 toggle：只翻 rest 一位，dir/zone 一字不动、不补默认方向（用户拍板 a 方案）。
   本组不变量：翻转不碰 t（时长不动 → barSum 不变 → 保存可用性不受影响）；
   dir/zone 穿越翻转原样保留；空扫在发声层静默、其余音符时刻一字不动。 */
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

/* ================= 场景 T114b：restRow 只改 rest（时长/方向/弦区不动） ================= */
section("T114b 发声开关 · restRow 只改 rest：dir/zone 保留、时长不动、撤销可逆");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "翻转素材", meter: 4,
    bars: [0,1,2,3].map(() => [{ t:48, dir:"D", zone:0 }, { t:24, dir:"U" }, { t:48 }, { t:72 }]) }] })).ok,
    "混合时值带方向/弦区的预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();

  edCellsOf(els, 0)[0].fire("click");                 // 选中 {t:48, dir:"D", zone:0}
  let st = restState(els);
  ok(!st.disabled, "选中发声音符 → 开关启用");
  eq(st.pressed, "false", "发声中 → 休止档 false");
  ok(st.hint.includes("发声中"), "restHint 反映当前态");

  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  const s0 = beat.Editor.draft().bars[0][0];
  eq(s0.rest, true, "点「休止」→ 该步 rest=true");
  eq(s0.dir, "D", "★ dir 原样保留（发声行不碰方向）");
  eq(s0.zone, 0, "★ zone 原样保留");
  eq(s0.t, 48, "★ t 一字不动（rest 是占位字段不是时值）");
  eq(beat.Editor.draft().bars[0].reduce((n, s) => n + s.t, 0), 192,
     "barSum 不变（192）——小节完整性不受影响");
  eq(s0.air, false, "★ 休止 + 方向 → air 落显式 false（= 实扫 + 休止，不是空扫）");
  st = restState(els);
  eq(st.pressed, "true", "翻转后休止档 true（与高亮同源）");
  ok(/ rest /.test(" " + edCellsOf(els, 0)[0].className + " "), "编辑器格子挂上 .rest（灰底休止样式）");
  const sv0 = edCellsOf(els, 0)[0].children.filter(c => /(^| )strumv( |$)/.test(c.className));
  eq(sv0.length, 1, "实扫 + 休止仍有竖箭头");
  ok(sv0.every(c => /(^| )dn( |$)/.test(c.className) && !/(^| )ghost( |$)/.test(c.className)),
     "★ 实扫 + 休止 = 实心箭头（air=false ⇒ 不带 ghost）");

  beat.Editor.undo();
  const back = beat.Editor.draft().bars[0][0];
  eq(back.rest, false, "撤销 → rest 翻回发声");
  eq(back.dir, "D", "撤销后 dir 仍在（快照是整步 JSON，自然保真）");
  ok(els["restRow"].children[0].disabled, "撤销清了选中（edSel=null）→ 开关回到禁用");
}

/* ================= 场景 T114c：airRow 只改 air（四组合，rest/dir 不动） ================= */
section("T114c 空扫开关 · airRow 只改 air：实扫/空扫各配发声 or 休止");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "两轴素材", meter: 4,
    bars: [[{ t:48, dir:"D" }, { t:48, rest:true }, { t:48 }, { t:48 }]] }] })).ok, "两轴素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();

  /* ① 发声 + 实扫 → 空扫：rest 不动（仍发声），dir 保留 */
  edCellsOf(els, 0)[0].fire("click");
  eq(airState(els).pressed, "false", "实扫 + 发声 → 空扫档 false");
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  let s0 = beat.Editor.draft().bars[0][0];
  eq(s0.air, true, "点「空扫」→ air=true");
  eq(s0.rest, false, "★ rest 不动（空扫 + 发声：这一格仍出声）");
  eq(s0.dir, "D", "★ dir 保留（有方向空扫 = 带箭头蓝虚线）");
  ok(/(^| )ghost( |$)/.test((edCellsOf(els, 0)[0].children.filter(c => /(^| )strumv( |$)/.test(c.className))[0] || {}).className),
     "空扫 + 发声 → .ghost 蓝虚线");

  /* ② 空扫 + 发声 → 点「实扫」：rest 仍不动（改回实扫但依旧发声） */
  els["airRow"].fire("click", { target: pill({ air: "off" }) });
  s0 = beat.Editor.draft().bars[0][0];
  eq(s0.air, false, "点「实扫」→ air=false");
  eq(s0.rest, false, "★ rest 仍不动（实扫 + 发声）");
  eq(s0.dir, "D", "★ dir 不动");

  /* ③ 休止（无方向）→ 空扫：得「无方向空扫 + 休止」= 无头蓝虚线杆 */
  edCellsOf(els, 0)[1].fire("click");
  eq(airState(els).hint.includes("空扫"), true, "空扫行提示点出「手过不触弦」");
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  const s1 = beat.Editor.draft().bars[0][1];
  eq(s1.air, true, "休止格点「空扫」→ air=true");
  eq(s1.rest, true, "★ rest 不动（空扫 + 休止）");
  eq(s1.dir, undefined, "无方向 → 无头空扫");
  const sv1 = edCellsOf(els, 0)[1].children.filter(c => /(^| )strumv( |$)/.test(c.className));
  eq(sv1.length, 1, "无方向空扫仍生成记号");
  ok(/(^| )ghost( |$)/.test((sv1[0] || {}).className) && /(^| )air( |$)/.test((sv1[0] || {}).className) && !/(^| )(dn|up|arp)( |$)/.test((sv1[0] || {}).className),
     "★ 无方向空扫 = .strumv.ghost.air（无头蓝虚线杆）");

  /* ④ 再点「实扫」：air=false，rest 仍休止 → 纯休止 */
  els["airRow"].fire("click", { target: pill({ air: "off" }) });
  const s1b = beat.Editor.draft().bars[0][1];
  eq(s1b.air, false, "点「实扫」→ air=false");
  eq(s1b.rest, true, "rest 仍休止");
  eq(edCellsOf(els, 0)[1].children.filter(c => /(^| )strumv( |$)/.test(c.className)).length, 0,
     "纯休止（无方向、air=false）不生成记号");

  /* 反向：从空扫点「发声」——发声行只改 rest，空扫标记保留 */
  edCellsOf(els, 0)[0].fire("click");
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 空扫
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });   // 休止
  let s0c = beat.Editor.draft().bars[0][0];
  eq(s0c.air, true, "★ 「发声/休止」行不动空扫标记（air 仍 true）");
  eq(s0c.rest, true, "rest 已改为休止 → 空扫 + 休止");
  els["restRow"].fire("click", { target: pill({ rest: "off" }) });
  s0c = beat.Editor.draft().bars[0][0];
  eq(s0c.air, true, "★ 再点「发声」：air 仍 true（空扫 + 发声）");
  eq(s0c.rest, false, "rest=false");
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
