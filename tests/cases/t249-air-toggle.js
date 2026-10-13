/* BeatSight 自动化测试 · 编辑器「发声 / 空扫」两组开关（v3.52.0）
   T249 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   背景（用户拍板 2026-10-14）：v2.45.0 的 #restRow 是**单 toggle**（只翻 rest），
   无法表达「相邻空扫块只给首块标方向、其余块无方向」这一记谱习惯。v3.52.0 拆成两组开关：
     · #restRow 两档 [发声 | 休止]  → 翻 rest（发声 = 删 air，dir 保留）；
     · #airRow  两档 [实扫 | 空扫]  → 写 air / 清 dir（空扫 = rest=true, air=true，dir 保留；
        实扫 = 删 air，且休止格上的 dir 一并删 = 普通休止）。
   空扫判据统一为 rest && (dir || air)。本组钉：四态同步（pressed/hint/disabled）、
   §2.2 耦合表逐行、同档重按不推栈、撤销整步 JSON 往返、strCovered 禁用。 */
"use strict";
const { loadApp, pill, ok, eq, section } = require("../lib/harness");

/* 编辑器第 b 小节的格子（editorBars.children[b].children[1].children = edcell 列） */
function edCellsOf(els, b){ return els["editorBars"].children[b].children[1].children; }
/* 休止档（data-rest="on"）的 aria-pressed —— 与 rest 状态同源 */
function restPressed(els){ return els["restRow"].children[1].getAttribute("aria-pressed"); }
/* 空扫档（data-air="on"）的 aria-pressed —— 与「是否空扫」同源 */
function airPressed(els){ return els["airRow"].children[1].getAttribute("aria-pressed"); }
function select(els, b, i){ edCellsOf(els, b)[i].fire("click"); }
const S0 = beat => beat.Editor.draft().bars[0];

/* 四态素材：发声(无方向) / 发声(有方向) / 休止(无方向) / 空扫(rest+dir) */
function openFour(beat, els){
  const r = beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四态素材", meter: 4,
    bars: [[{ t:48 }, { t:48, dir:"D" }, { t:48, rest:true }, { t:48, rest:true, dir:"D" }]] }] }));
  ok(r.ok, "四态素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
}

/* ================= 场景 T249a：四态同步（pressed / hint） ================= */
section("T249a 两组开关 · 四态同步（pressed 与提示语）");
{
  const { beat, els } = loadApp();
  openFour(beat, els);

  select(els, 0, 0);   // 发声 · 无方向
  eq(restPressed(els), "false", "发声 → restRow 休止档 aria-pressed=false");
  eq(els["restRow"].children[0].getAttribute("aria-pressed"), "true", "发声档 aria-pressed=true");
  eq(airPressed(els), "false", "发声 → airRow 空扫档 false（实扫档高亮）");
  eq(els["airRow"].children[0].getAttribute("aria-pressed"), "true", "实扫档 aria-pressed=true");
  ok(els["restHint"].textContent.includes("发声中"), "restHint 报发声");
  ok(els["airHint"].textContent.includes("无方向空扫"), "airHint 报「空扫即成无方向空扫」");

  select(els, 0, 1);   // 发声 · 有方向
  eq(restPressed(els), "false", "发声(有方向) → 休止档 false");
  eq(airPressed(els), "false", "发声(有方向) → 空扫档 false");
  ok(els["restHint"].textContent.includes("已有方向即成空扫"), "restHint 点明已有方向即空扫");
  ok(els["airHint"].textContent.includes("方向保留为箭头"), "airHint 报「空扫保留方向为箭头」");

  select(els, 0, 2);   // 休止 · 无方向
  eq(restPressed(els), "true", "休止 → 休止档 true");
  eq(airPressed(els), "false", "休止(无方向) → 空扫档 false");
  ok(els["restHint"].textContent.includes("休止中"), "restHint 报休止中");
  ok(els["airHint"].textContent.includes("标记手部虚扫"), "airHint 报「点空扫标记手部虚扫」");

  select(els, 0, 3);   // 空扫 · 有方向
  eq(restPressed(els), "true", "空扫 → 休止档 true");
  eq(airPressed(els), "true", "空扫 → 空扫档 true（rest && dir）");
  ok(els["restHint"].textContent.includes("空扫中"), "restHint 报空扫中");
  ok(els["airHint"].textContent.includes("手过不触弦"), "airHint 报空扫（手过不触弦）");
}

/* ================= 场景 T249b：§2.2 耦合表逐行 ================= */
section("T249b 两组开关 · §2.2 耦合表逐行（不同字段、无重叠路径）");
{
  /* 归一化比较：固定键序 t/rest/dir/air 取值，避免插入顺序差异（air 后来追加 → 排在 dir 之后） */
  const norm = s => JSON.stringify({ t: s.t, rest: !!s.rest, dir: s.dir, air: s.air });

  /* airRow 部分 */
  const { beat, els } = loadApp();
  openFour(beat, els);

  select(els, 0, 0);   // 发声 · 无方向
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 空扫
  eq(norm(S0(beat)[0]), norm({ t:48, rest:true, air:true }),
     "空扫：rest=true + air=true；无 dir ⇒ 无方向空扫");
  els["airRow"].fire("click", { target: pill({ air: "off" }) });    // 实扫
  eq(norm(S0(beat)[0]), norm({ t:48, rest:true }),
     "实扫：删 air；休止但无 dir ⇒ 普通休止");

  select(els, 0, 1);   // 发声 · 有方向 D
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 空扫
  eq(norm(S0(beat)[1]), norm({ t:48, rest:true, air:true, dir:"D" }),
     "空扫：rest=true + air=true，dir 保留 ⇒ 带箭头空扫");
  els["airRow"].fire("click", { target: pill({ air: "off" }) });    // 实扫
  eq(norm(S0(beat)[1]), norm({ t:48, rest:true }),
     "实扫：删 air 且休止格上的 dir 一并删 ⇒ 普通休止（留箭头就不是实扫）");

  /* restRow 部分（另起一局，避免上面 airRow 已改动素材） */
  const b2 = loadApp();
  openFour(b2.beat, b2.els);
  select(b2.els, 0, 1);   // 发声 · 有方向 D
  b2.els["restRow"].fire("click", { target: pill({ rest: "on" }) });    // 休止
  eq(norm(S0(b2.beat)[1]), norm({ t:48, rest:true, dir:"D" }),
     "休止：rest=true，dir/air 原样保留（已有方向即成空扫）");
  b2.els["restRow"].fire("click", { target: pill({ rest: "off" }) });   // 发声
  eq(norm(S0(b2.beat)[1]), norm({ t:48, dir:"D" }),
     "发声：rest=false，dir 保留（无 air 可删）");

  select(b2.els, 0, 0);   // 发声 · 无方向 —— 先记成无方向空扫，再翻回发声
  b2.els["airRow"].fire("click", { target: pill({ air: "on" }) });
  b2.els["restRow"].fire("click", { target: pill({ rest: "off" }) });
  eq(norm(S0(b2.beat)[0]), norm({ t:48 }),
     "发声：rest=false 且删 air ⇒ 回到纯发声音符");
}

/* ================= 场景 T249c：同档重按不推撤销栈 ================= */
section("T249c 两组开关 · 同档重按不产生变更、不污染撤销栈");
{
  const { beat, els } = loadApp();
  openFour(beat, els);
  select(els, 0, 0);   // 发声
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 空扫（push #1）
  els["airRow"].fire("click", { target: pill({ air: "on" }) });     // 同档重按 → 不推
  beat.Editor.undo();
  eq(S0(beat)[0].rest, false, "同档重按不推栈：undo 一次即回到空扫之前（发声）");
  ok(S0(beat)[0].air === undefined, "air 字段一并回退");

  select(els, 0, 2);   // 休止
  els["restRow"].fire("click", { target: pill({ rest: "on" }) });   // 同档重按 → 不推
  els["restRow"].fire("click", { target: pill({ rest: "off" }) });  // 发声（push）
  beat.Editor.undo();
  eq(S0(beat)[2].rest, true, "restRow 同档重按不推栈：undo 一次回到休止（发声那次被撤回）");
}

/* ================= 场景 T249d：撤销整步 JSON 往返保真 ================= */
section("T249d 两组开关 · 撤销整步 JSON 往返（air/dir/rest 全保真）");
{
  const { beat, els } = loadApp();
  openFour(beat, els);
  select(els, 0, 1);   // 发声 + dir D
  const before = JSON.stringify(S0(beat)[1]);
  els["airRow"].fire("click", { target: pill({ air: "on" }) });
  ok(/"air":true/.test(JSON.stringify(S0(beat)[1])), "写入 air:true（快照为整步 JSON）");
  beat.Editor.undo();
  eq(JSON.stringify(S0(beat)[1]), before, "★ 撤销后整步 JSON 逐字回到原形（rest/dir/air 全保真）");
}

/* ================= 场景 T249e：格子带 str ⇒ airRow 禁用（逐弦优先） ================= */
section("T249e 两组开关 · 格子带 str 时 airRow 禁用、restRow 仍可用");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "逐弦素材", meter: 4,
    bars: [[{ t:48, str:[{ s:5 }] }, { t:48 }, { t:48 }, { t:48 }]] }] })).ok, "逐弦素材导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  select(els, 0, 0);
  ok(els["airRow"].children.every(p => p.disabled), "★ 格带 str → airRow 两档禁用（逐弦优先）");
  ok(els["airHint"].textContent.includes("逐弦优先"), "airHint 报「逐弦优先：清空全部弦后可改空扫」");
  ok(els["restRow"].children.every(p => !p.disabled), "restRow 仍可用（空拨由 restRow 表达，air 记谱无从附挂）");
  /* 无 str 的格 → airRow 恢复可用 */
  select(els, 0, 1);
  ok(els["airRow"].children.every(p => !p.disabled), "无 str 的格 → airRow 恢复可用");
  eq(els["airHint"].textContent, els["airHint"].textContent.replace("逐弦优先：清空全部弦后可改空扫", ""),
     "airHint 不再报逐弦优先");
}
