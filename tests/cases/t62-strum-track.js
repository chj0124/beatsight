/* BeatSight 自动化测试 · 扫弦轨升级（v2.2.0）
   T62 系列。
   ---------------------------------------------------------------------------
   契约：
     · zone ∈ {0,1,2} = 低/中/高弦区；省略 = 默认中弦区（老数据零迁移）；
     · zone **参与发声**（strumZoneHit 带通三频段 700/1400/2800Hz）但不碰时间轴；
     · 空扫（rest + dir）保持静默——rest 的不发声判定在 zone 分支之前；
     · 渲染：主视图 zone 格挂 .cell-zone.z{0,1,2} 色带；编辑器挂 .ed-zone 文字徽标；
     · 编辑：dirRow（方向三档）+ zoneRow（弦区四档：默认/低/中/高）同套纪律——
       pushUndo 先行、同档重按不推栈。 */
"use strict";
const { loadApp, FakeAudioContext, pill, drive, ok, eq, near, section } = require("../lib/harness");

/* 主视图格与徽标（与 t47 同一定位手法） */
function cellsOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b].children.filter(el => /(^| )cell( |$)/.test(el.className));
}
function zoneOf(els, b, i){
  const c = cellsOf(els, b)[i];
  return c ? (c.children.find(ch => /(^| )cell-zone /.test(ch.className)) || null) : null;
}
function edCellsOf(els, b){ return els["editorBars"].children[b].children[1].children; }

/* 种一个三段扫弦谱：低/中/高各一颗 + 一颗空扫（rest+dir+zone） + 一颗无 zone 对照 */
const mkBars = () => [0,1,2,3].map(() => [
  { t: 48, dir: "D", zone: 0 },        // 低弦区下扫
  { t: 48, dir: "D", zone: 1 },        // 中弦区下扫
  { t: 48, dir: "U", zone: 2 },        // 高弦区上扫
  { t: 48, rest: true, dir: "D", zone: 2 },  // 空扫（带 zone 数据，但不该发声）
]);

/* ================= 场景 T62a：zone 数据层 ================= */
section("T62a 扫弦轨 · zone 校验 / 默认省略 / 脏值降级");
{
  const { beat } = loadApp();
  const St = beat.Store;
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "弦区", meter: 4, bars: mkBars() }] })).ok,
     "含 zone 的预设导入成功");
  const p = St.customs[St.customs.length - 1];
  eq(p.bars[0][0].zone, 0, "zone=0 保留");
  eq(p.bars[0][3].zone, 2, "空扫槽上的 zone 保留（数据层面合法）");
  /* 脏 zone 静默降级为省略（与 dir 同口径） */
  ok(St.importPresets(JSON.stringify({ presets: [{ name: "脏zone", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48, zone: 5 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] })).ok,
     "zone=5 不导致导入失败（纯装饰/发声字段，静默降级）");
  eq(St.customs[St.customs.length - 1].bars[0][0].zone, undefined, "非法 zone 被丢弃");
  /* 往返 */
  const ex = St.serializePresets();
  ok(/"zone": ?0/.test(ex), "导出 JSON 保留 zone");
}

/* ================= 场景 T62b：三弦区音色可区分 ================= */
section("T62b 扫弦轨 · 三弦区音色可区分 / 空扫静默 / 时刻不动");
{
  const { beat } = loadApp();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "弦区", meter: 4, bars: mkBars() }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1.2);                       // 240BPM 默认 96 → 一小节 2s；走 1.2s 覆盖前三颗
  beat.Controls.stop();
  const zones = ac.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass"
    && [700, 1400, 2800].includes(h.filterFreq));
  eq(zones.length, 3, "三颗发声音符各出一声（空扫不出声）");
  eq(zones[0].filterFreq, 700, "★ 低弦区 = 700Hz（闷）");
  eq(zones[1].filterFreq, 1400, "★ 中弦区 = 1400Hz");
  eq(zones[2].filterFreq, 2800, "★ 高弦区 = 2800Hz（亮）");
  ok(zones[0].filterFreq < zones[1].filterFreq && zones[1].filterFreq < zones[2].filterFreq,
     "三档频率单调可盲听区分");
  /* 空扫静默：第 4 颗（rest）在 hits 里无对应。默认 96BPM → 1 拍 0.625s，48tick = 1 拍 */
  const ts = zones.map(h => +h.t.toFixed(3));
  near(ts[0], 0.08, 1e-6, "时刻不漂（zone 不碰时间轴）");
  near(ts[1], 0.705, 1e-6, "第二颗 = +0.625s（96BPM 一拍）");
}

/* ================= 场景 T62c：渲染层 zone 色带 ================= */
section("T62c 扫弦轨 · 主视图色带 / 编辑器徽标 / 空扫不挂色带");
{
  const { beat, els } = loadApp();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "弦区", meter: 4, bars: mkBars() }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  ok(zoneOf(els, 0, 0) && zoneOf(els, 0, 0).className.includes("z0"), "低弦区格挂 .z0 色带");
  ok(zoneOf(els, 0, 2) && zoneOf(els, 0, 2).className.includes("z2"), "高弦区格挂 .z2 色带");
  eq(zoneOf(els, 0, 3), null, "★ 空扫格不挂色带（静默格不给有声错觉）");

  /* 编辑器徽标（Editor.open 基于当前选中预设的副本，故在切走之前看） */
  beat.Editor.open();
  const zb = edCellsOf(els, 0)[0].children.find(c => /(^| )ed-zone /.test(c.className));
  ok(!!zb && zb.textContent === "低", "编辑器内联出 zone 文字徽标（读屏/色弱可达）");
  beat.Editor.tryClose();

  /* 无 zone 的格不挂（老数据零迁移的直接体现） */
  beat.Store.S.sel = { type: "builtin", idx: 1 };
  beat.Presets.refreshAfterPatternChange();
  eq(cellsOf(els, 0).filter(c => c.children.some(ch => /(^| )cell-zone /.test(ch.className))).length, 0,
     "无 zone 预设 → 全图零色带");
}

/* ================= 场景 T62d：录入 UI（zoneRow 四档） ================= */
section("T62d 扫弦轨 · zoneRow 写入 / 撤销 / 同档不推栈");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  eq(els["zoneRow"].children.length, 4, "弦区四档（默认/低/中/高）");
  ok(els["zoneRow"].children.every(b => b.disabled), "未选中音符 → 四档全禁");
  edCellsOf(els, 0)[0].fire("click");          // 民谣扫弦第 1 格（无 zone）
  ok(els["zoneRow"].children.every(b => !b.disabled), "选中后启用");
  eq(els["zoneRow"].children[0].getAttribute("aria-pressed"), "true", "无 zone → 「默认」档高亮");
  els["zoneRow"].fire("click", { target: pill({ zone: "2" }) });
  eq(beat.Editor.draft().bars[0][0].zone, 2, "点「高弦区」→ 草稿写入 zone=2");
  eq(els["zoneRow"].children[3].getAttribute("aria-pressed"), "true", "高亮跟到「高弦区」");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0][0].zone, undefined, "★ 撤销回退 zone（与方向同一套 undo 纪律）");
  /* 同档重按不推栈 */
  edCellsOf(els, 0)[0].fire("click");
  els["zoneRow"].fire("click", { target: pill({ zone: "0" }) });
  els["zoneRow"].fire("click", { target: pill({ zone: "0" }) });
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0][0].zone, undefined, "同档重按不污染撤销栈（撤一次回到无 zone）");
  /* 回默认 = 删字段 */
  edCellsOf(els, 0)[0].fire("click");
  els["zoneRow"].fire("click", { target: pill({ zone: "1" }) });
  els["zoneRow"].fire("click", { target: pill({ zone: "" }) });
  eq(beat.Editor.draft().bars[0][0].zone, undefined, "点「默认」→ 删字段（不是写 1）");
  beat.Editor.tryClose();
}
