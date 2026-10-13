/* BeatSight 自动化测试 · 编辑器「发声 / 空扫」两组开关（v3.52.0，两轴独立）
   T249 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   背景（用户拍板 2026-10-14）：`rest`（发声/休止）与 `air`（实扫/空扫）是**两条独立轴**——
   实扫/空扫 各自都能配 发声/休止，四种组合都合法：
     · 发声 + 实扫 = 普通扫弦；· 休止 + 实扫 = 触弦不出声（切音）；
     · 发声 + 空扫 = 手过不触弦但这一格出声；· 休止 + 空扫 = 手过不触弦且不出声。
   restRow 只改 rest，airRow 只改 air，方向行只改 dir——三组各动自己那一位、互不决定。
   本组钉：四组合的 pressed/hint、两组各只改自己那一位、同档重按不推栈、
   airRow 在逐弦（str）格上禁用。 */
"use strict";
const { loadApp, pill, ok, eq, section } = require("../lib/harness");

/* 编辑器第 b 小节的格子（editorBars.children[b].children[1].children = edcell 列） */
function edCellsOf(els, b){ return els["editorBars"].children[b].children[1].children; }
/* 休止档（data-rest="on"）的 aria-pressed —— 与 rest 同源 */
function restPressed(els){ return els["restRow"].children[1].getAttribute("aria-pressed"); }
/* 空扫档（data-air="on"）的 aria-pressed —— 与 air 同源 */
function airPressed(els){ return els["airRow"].children[1].getAttribute("aria-pressed"); }
function select(els, b, i){ edCellsOf(els, b)[i].fire("click"); }
const S0 = beat => beat.Editor.draft().bars[0];
/* 归一化比较：固定键序 t/rest/dir/air，避免插入顺序差异 */
const norm = s => JSON.stringify({ t: s.t, rest: !!s.rest, dir: s.dir, air: s.air });

/* 四组合素材：① 发声+实扫 ② 休止+实扫（air 显式 false）③ 发声+空扫 ④ 休止+空扫 */
function openFour(beat, els){
  const r = beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四组合素材", meter: 4,
    bars: [[{ t:48, dir:"D" }, { t:48, rest:true, dir:"D", air:false }, { t:48, air:true }, { t:48, rest:true, air:true }]] }] }));
  ok(r.ok, "四组合素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
}

/* ================= 场景 T249a：四组合的 pressed / hint ================= */
section("T249a 两组开关 · 四组合的 pressed 与提示语");
{
  const { beat, els } = loadApp();
  openFour(beat, els);

  select(els, 0, 0);   // 发声 + 实扫
  eq(restPressed(els), "false", "发声 + 实扫 → 休止档 false");
  eq(airPressed(els), "false", "发声 + 实扫 → 空扫档 false");
  ok(els["restHint"].textContent.includes("发声中"), "restHint 报发声中");
  ok(els["airHint"].textContent.includes("实扫"), "airHint 报实扫中");

  select(els, 0, 1);   // 休止 + 实扫（切音）
  eq(restPressed(els), "true", "休止 + 实扫 → 休止档 true");
  eq(airPressed(els), "false", "休止 + 实扫 → 空扫档 false（两轴互不决定）");
  ok(els["restHint"].textContent.includes("休止中"), "restHint 报休止中");
  ok(els["airHint"].textContent.includes("实扫"), "airHint 仍报实扫中（air 未动）");

  select(els, 0, 2);   // 发声 + 空扫
  eq(restPressed(els), "false", "发声 + 空扫 → 休止档 false（rest 未被 air 拖动）");
  eq(airPressed(els), "true", "发声 + 空扫 → 空扫档 true");
  ok(els["airHint"].textContent.includes("空扫"), "airHint 报空扫中");

  select(els, 0, 3);   // 休止 + 空扫
  eq(restPressed(els), "true", "休止 + 空扫 → 休止档 true");
  eq(airPressed(els), "true", "休止 + 空扫 → 空扫档 true");
}

/* ================= 场景 T249b：两组各只改自己那一位 ================= */
section("T249b 两组开关 · restRow 只改 rest / airRow 只改 air");
{
  const { beat, els } = loadApp();
  openFour(beat, els);

  /* airRow：只改 air */
  select(els, 0, 0);   // 发声 + 实扫
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  eq(norm(S0(beat)[0]), norm({ t:48, dir:"D", air:true }),
     "点「空扫」：air=true，rest/dir 不动 ⇒ 发声 + 空扫");
  els["airRow"].fire("click", { target: pill({ air: "off" }) });
  eq(norm(S0(beat)[0]), norm({ t:48, dir:"D", air:false }),
     "点「实扫」：air=false，rest/dir 不动 ⇒ 发声 + 实扫");

  /* restRow：只改 rest */
  select(els, 0, 2);   // 发声 + 空扫
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  eq(norm(S0(beat)[2]), norm({ t:48, air:true, rest:true }),
     "点「休止」：rest=true，air 不动 ⇒ 休止 + 空扫");
  els["restRow"].fire("click", { target: pill({ rest: "off" }) });
  eq(norm(S0(beat)[2]), norm({ t:48, air:true, rest:false }),
     "点「发声」：rest=false，air 仍 true ⇒ 发声 + 空扫");

  /* 休止（无方向）→ 空扫：无方向空扫 */
  select(els, 0, 0);
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  eq(norm(S0(beat)[0]), norm({ t:48, dir:"D", rest:true, air:true }),
     "休止 + 空扫（带方向）—— 两轴各自成立");
}

/* ================= 场景 T249c：同档重按不推撤销栈 ================= */
section("T249c 两组开关 · 同档重按不产生变更、不污染撤销栈");
{
  const { beat, els } = loadApp();
  openFour(beat, els);
  select(els, 0, 0);   // 发声 + 实扫
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 空扫（push #1）
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 同档重按 → 不推
  beat.Editor.undo();
  ok(S0(beat)[0].air !== true, "同档重按不推栈：undo 一次即回到空扫之前（air 非 true）");
  eq(S0(beat)[0].rest, false, "rest 未被动过");

  select(els, 0, 1);   // 休止 + 实扫
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });   // 同档重按 → 不推
  els["restRow"].fire("click", { target: pill({ rest: "off" }) });  // 发声（push）
  beat.Editor.undo();
  eq(S0(beat)[1].rest, true, "restRow 同档重按不推栈：undo 一次回到休止");
}

/* ================= 场景 T249d：格子带 str ⇒ airRow 禁用（逐弦优先） ================= */
section("T249d 两组开关 · 格子带 str 时 airRow 禁用、restRow 仍可用");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "逐弦素材", meter: 4,
    bars: [[{ t:48, str:[{ s:5 }] }, { t:48, dir:"D" }, { t:48 }, { t:48 }]] }] })).ok, "逐弦素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  select(els, 0, 0);
  ok(els["airRow"].children.every(p => p.disabled), "★ 格带 str → airRow 两档禁用（逐弦优先）");
  ok(els["airHint"].textContent.includes("逐弦优先"), "airHint 报「逐弦优先」");
  ok(els["restRow"].children.every(p => !p.disabled), "restRow 仍可用（空拨由 restRow 表达）");
  select(els, 0, 1);   // 无 str 的格
  ok(els["airRow"].children.every(p => !p.disabled), "无 str 的格 → airRow 恢复可用");
}
