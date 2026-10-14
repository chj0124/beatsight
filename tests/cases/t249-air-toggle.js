/* BeatSight 自动化测试 · 编辑器「发声 / 空扫」两组开关
   T249 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   当前契约：restRow 只在「节拍」档显示并只改 rest；琶音/分解必须发声。
   airRow 只在「扫弦」档显示，且一次点击联动 air/rest：空扫 = air=true+rest=true（不触发 onset），
   实扫 = air=false+rest=false。旧版 rest+弹法组合仍可导入与渲染，不批量迁移；
   本组钉旧组合展示、联动写库、同档重按不推栈与逐弦格显隐。 */
"use strict";
const { loadApp, pill, ok, eq, section } = require("../lib/harness");

const edCellsOf = (els, b) => els["editorBars"].children[b].children[1].children;
const select = (els, b, i) => edCellsOf(els, b)[i].fire("click");
const S0 = beat => beat.Editor.draft().bars[0];
const restPressed = els => els["restRow"].children[1].getAttribute("aria-pressed");
const airPressed = els => els["airRow"].children[1].getAttribute("aria-pressed");
const restHiddenDisabled = els => els["restRow"].hidden === true && els["restRow"].children.every(p => p.disabled);
const norm = s => JSON.stringify({ t: s.t, rest: !!s.rest, dir: s.dir, air: s.air });

/* 旧版四组合素材：① 发声+实扫 ② 休止+实扫 ③ 发声+空扫 ④ 休止+空扫 */
function openFour(beat, els){
  const r = beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四组合素材", meter: 4,
    bars: [[{ t:48, dir:"D" }, { t:48, rest:true, dir:"D", air:false }, { t:48, air:true }, { t:48, rest:true, air:true }]] }] }));
  ok(r.ok, "四组合素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
}

/* 纯节拍对照：一颗发声格 + 一颗休止格（restRow 唯一合法使用场景） */
function openBeatPair(beat, els){
  const r = beat.Store.importPresets(JSON.stringify({ presets: [{ name: "节拍休止素材", meter: 2,
    bars: [[{ t:48 }, { t:48, rest:true }]] }] }));
  ok(r.ok, "纯节拍素材导入成功");
  beat.Store.S.sig = 2;
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
}

/* ================= 场景 T249a：旧组合保留，restRow 不再出现在弹法档 ================= */
section("T249a 旧数据四组合 · rest/air 原样保留，restRow 在非节拍档隐藏禁用");
{
  const { beat, els } = loadApp();
  openFour(beat, els);

  select(els, 0, 0);
  eq(airPressed(els), "false", "发声 + 实扫 → 空扫档 false");
  eq(S0(beat)[0].rest, false, "发声 + 实扫：rest=false 原样保留");
  ok(restHiddenDisabled(els), "★ 扫弦档 restRow 隐藏且禁用（扫弦必须发声）");
  eq(els["restHint"].textContent, "", "隐藏 restRow 不残留 hint");
  ok(els["airHint"].textContent.includes("实扫"), "airHint 报实扫中");

  select(els, 0, 1);
  eq(airPressed(els), "false", "旧休止 + 实扫 → 空扫档 false");
  eq(S0(beat)[1].rest, true, "旧休止 + 实扫：rest=true 不迁移");
  ok(restHiddenDisabled(els), "★ 旧休止扫弦也不显示 restRow（改发声点同档弹法修复）");
  ok(els["airHint"].textContent.includes("实扫"), "airHint 仍报实扫中");

  select(els, 0, 2);
  eq(airPressed(els), "true", "发声 + 空扫 → 空扫档 true");
  eq(S0(beat)[2].rest, true, "旧「air=true」导入归一：rest=true（空扫不再触发 onset）");
  ok(restHiddenDisabled(els), "空扫属扫弦档，restRow 同样收起");
  ok(els["airHint"].textContent.includes("空扫"), "airHint 报空扫中");

  select(els, 0, 3);
  eq(airPressed(els), "true", "旧休止 + 空扫 → 空扫档 true");
  eq(S0(beat)[3].rest, true, "旧休止 + 空扫：rest=true 不迁移");
  ok(restHiddenDisabled(els), "旧休止空扫的 restRow 也隐藏禁用");
}

/* ================= 场景 T249b：两组各只改自己那一位 ================= */
section("T249b 两组开关 · 扫弦实空联动 / 节拍档 restRow 只改 rest");
{
  const { beat, els } = loadApp();
  openFour(beat, els);
  select(els, 0, 0);
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  eq(norm(S0(beat)[0]), norm({ t:48, rest:true, dir:"D", air:true }),
     "点「空扫」：air=true 且 rest=true（空扫有记谱但不触发 onset）");
  els["airRow"].fire("click", { target: pill({ air: "off" }) });
  eq(norm(S0(beat)[0]), norm({ t:48, rest:false, dir:"D", air:false }),
     "点「实扫」：air=false 且 rest=false（实扫触发 onset）");

  const app2 = loadApp();
  openBeatPair(app2.beat, app2.els);
  select(app2.els, 0, 0);
  eq(restPressed(app2.els), "false", "纯节拍发声格 → 休止档 false");
  ok(app2.els["restHint"].textContent.includes("发声中"), "restHint 报发声中");
  app2.els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  eq(norm(S0(app2.beat)[0]), norm({ t:48, rest:true }), "节拍格点「休止」：只改 rest=true，时值不变");
  app2.els["restRow"].fire("click", { target: pill({ rest: "off" }) });
  eq(norm(S0(app2.beat)[0]), norm({ t:48, rest:false }), "节拍格点「发声」：只改 rest=false");
}

/* ================= 场景 T249c：同档重按不推撤销栈 ================= */
section("T249c 两组开关 · 同档重按不产生变更、不污染撤销栈");
{
  const { beat, els } = loadApp();
  openFour(beat, els);
  select(els, 0, 0);
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  beat.Editor.undo();
  ok(S0(beat)[0].air !== true, "airRow 同档重按不推栈：undo 一次即回到空扫之前");
  eq(S0(beat)[0].rest, false, "rest 未被动过");

  const app2 = loadApp();
  openBeatPair(app2.beat, app2.els);
  select(app2.els, 0, 1);
  app2.els["restRow"].fire("click", { target: pill({ rest: "on" }) });
  app2.els["restRow"].fire("click", { target: pill({ rest: "off" }) });
  app2.beat.Editor.undo();
  eq(S0(app2.beat)[1].rest, true, "restRow 同档重按不推栈：undo 一次回到休止");
}

/* ================= 场景 T249d：逐弦格的手部/发声行都收起 ================= */
section("T249d 显隐 · str 格 airRow 禁用、restRow 隐藏；回节拍后 restRow 恢复");
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
  ok(restHiddenDisabled(els), "★ 分解档 restRow 隐藏且禁用（分解必须发声）");
  select(els, 0, 2);
  ok(!els["restRow"].hidden && els["restRow"].children.every(p => !p.disabled),
     "回纯节拍格 → restRow 恢复显示与可用");
  ok(els["airRow"].hidden === true, "纯节拍格 airRow 收起（手部动作归扫弦）");
}
