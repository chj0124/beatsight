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
/* #restRow 的当前态：{ disabled, pressed, hint }。pressed 读 aria-pressed（与 .active 同源，
   由 setPressed 一处写全——v1.3.0「开关三件套」纪律） */
function restState(els){
  const p = els["restRow"].children[0];
  return { disabled: !!p.disabled, pressed: p.getAttribute("aria-pressed"), hint: els["restHint"].textContent };
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
  eq(st.pressed, "false", "未选中 → aria-pressed=false（不显示「休止中」的假态）");
  eq(st.hint, "先在上方选中一个音符", "未选中时提示如何操作");
  eq(els["restRow"].children.length, 1, "单 pill toggle（不是三档行）");
}

/* ================= 场景 T114b：发声 → 休止（dir/zone 保留，t 不动） ================= */
section("T114b 发声开关 · 发声翻休止：dir/zone 保留、时长不动、撤销可逆");
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
  eq(st.pressed, "false", "发声中 → aria-pressed=false");
  ok(st.hint.includes("发声中"), "提示语反映当前态");
  ok(st.hint.includes("空扫"), "已有方向时提示语点明「翻过去即成空扫」");

  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  const s0 = beat.Editor.draft().bars[0][0];
  eq(s0.rest, true, "点击开关 → 该步 rest=true");
  eq(s0.dir, "D", "★ dir 原样保留（翻转不碰标注）");
  eq(s0.zone, 0, "★ zone 原样保留");
  eq(s0.t, 48, "★ t 一字不动（rest 是占位字段不是时值）");
  eq(beat.Editor.draft().bars[0].reduce((n, s) => n + s.t, 0), 192,
     "barSum 不变（192）——小节完整性不受翻转影响，保存可用性不受牵连");
  st = restState(els);
  eq(st.pressed, "true", "翻转后 aria-pressed=true（与高亮同源）");
  ok(st.hint.includes("空扫"), "休止 + 方向 → 提示语点明它已是空扫");
  const cellCls = " " + edCellsOf(els, 0)[0].className + " ";
  ok(/ rest /.test(cellCls), "编辑器格子挂上 .rest（灰底休止样式）");
  /* v2.74.0（2.7）：空扫字形改 .strumv.ghost 蓝虚线（ed-air 退役，主视图同款） */
  const ghosts = edCellsOf(els, 0)[0].children.filter(c => /(^| )ghost( |$)/.test(c.className));
  eq(ghosts.length, 1, "★ 休止槽带方向 → 内联 .strumv.ghost 蓝虚线，不是 .ed-strum");

  beat.Editor.undo();
  const back = beat.Editor.draft().bars[0][0];
  eq(back.rest, false, "撤销 → rest 翻回发声");
  eq(back.dir, "D", "撤销后 dir 仍在（快照是整步 JSON，自然保真）");
  ok(els["restRow"].children[0].disabled, "撤销清了选中（edSel=null）→ 开关回到禁用");
}

/* ================= 场景 T114c：无方向的发声 → 普通休止（不补默认方向） =================
   用户拍板 a 方案：toggle 只翻 rest。「休止」与「空扫」是两个既有合法状态，
   路径交给用户自己接（再点方向档），不替用户塞 dir:"D" 制造意外。 */
section("T114c 发声开关 · 无方向音符翻过去是普通休止（不自动补方向）");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "无方向素材", meter: 4,
    bars: [0,1,2,3].map(() => [{ t:48 }, { t:48 }, { t:48 }, { t:48 }]) }] })).ok, "纯节拍预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  edCellsOf(els, 0)[0].fire("click");
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  const s0 = beat.Editor.draft().bars[0][0];
  eq(s0.rest, true, "翻转后 rest=true");
  eq(s0.dir, undefined, "★ 不自动补默认方向（决策点 a）：它现在是普通休止，不是空扫");
  ok(restState(els).hint.includes("休止中") && !restState(els).hint.includes("空扫"),
     "提示语区分「普通休止」与「空扫」两种翻转结果");
  /* 要空扫：再点方向档即成（两步路径的另一半，走的是既有 dirRow 通道） */
  edCellsOf(els, 0)[0].fire("click");
  els["dirRow"].fire("click", { target: pill({ dir: "D" }) });
  eq(beat.Editor.draft().bars[0][0].dir, "D", "补方向后同一格升级为空扫（rest+dir）");
  ok(restState(els).hint.includes("空扫"), "提示语随之点明空扫");
}

/* ================= 场景 T114d：空扫/休止 → 发声（反向翻转） ================= */
section("T114d 发声开关 · 空扫翻回发声：dir 保留、恢复实心标注");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "空扫素材", meter: 4,
    bars: [0,1,2,3].map(() => [{ t:48, rest:true, dir:"D" }, { t:48 }, { t:48 }, { t:48 }]) }] })).ok,
    "空扫预设导入成功（rest+dir 合法记谱）");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  edCellsOf(els, 0)[0].fire("click");
  let st = restState(els);
  eq(st.pressed, "true", "选中空扫 → aria-pressed=true");
  ok(st.hint.includes("空扫"), "提示语点明当前是空扫");
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  const s0 = beat.Editor.draft().bars[0][0];
  eq(s0.rest, false, "点击开关 → rest=false（恢复发声）");
  eq(s0.dir, "D", "★ dir 原样保留——空扫翻回去就是带方向的实扫");
  const strums = edCellsOf(els, 0)[0].children.filter(c => c.className === "ed-strum");
  eq(strums.length, 1, "编辑器内联回实心方向标注（不再是 .ed-air）");

  /* 连点两次 = 翻转往返：栈里两条，undo 一次回到「休止」那步（每击必变更，无同态分支） */
  edCellsOf(els, 0)[0].fire("click");
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  eq(beat.Editor.draft().bars[0][0].rest, true, "再翻一次 → 回到休止（toggle 可逆）");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0][0].rest, false, "undo 一次 → 回到发声（每次点击各占一条快照）");
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
