/* BeatSight 自动化测试 · 扫弦轨升级（v2.2.0）
   T62 系列。
   ---------------------------------------------------------------------------
   契约：
     · zone ∈ {0,1,2} = 低/中/高弦区；省略 = 默认中弦区（老数据零迁移）；
     · zone **参与发声**（strumZoneHit 带通三频段 700/1400/2800Hz）但不碰时间轴；
     · 空扫（rest + dir）保持静默——rest 的不发声判定在 zone 分支之前；
     · 渲染：主视图 zone 呈现为**箭头弦区跨距** .strumv.k{0,1,2}→.kB/.kF/.kT
       （v2.4.2 前是 .cell-zone.z{0,1,2} 色带）；编辑器仍挂 .ed-zone 文字徽标；
     · 编辑：dirRow（方向三档）+ zoneRow（弦区四档：默认/低/中/高）同套纪律——
       pushUndo 先行、同档重按不推栈。
   v2.4.0 起（双入口拆分）本组统一在**扫弦轨**上运行：zone 的音色与弦区跨距是扫弦轨的呈现，
   普通轨下 zone 既不发弦区音色也不画箭头底纹（那两条由 T64g / T64h 专测）。 */
"use strict";
const { loadApp, FakeAudioContext, pill, drive, ok, eq, near, section, html } = require("../lib/harness");

/* ★ v2.4.0：本组所有用例都在扫弦轨上跑。
   用 seed 显式声明 track:"strum"（而不是靠 sel 反推），这样"本组测的是扫弦轨"这件事
   写在用例里、不依赖迁移规则的实现细节——将来迁移规则若调整，本组语义不变。
   同时把 sel 指到非扫弦型（idx 1），避免加载期回退干扰本组自己的 sel 赋值 */
const STRUM_SEED = () => ({
  "beatsight.state": JSON.stringify({ track: "strum", sel: { type: "builtin", idx: 1 } }),
});
const loadStrum = () => loadApp(STRUM_SEED());

/* 主视图格与徽标（与 t47 同一定位手法） */
function cellsOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b].children.filter(el => /(^| )cell( |$)/.test(el.className));
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
  const { beat } = loadStrum();
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
  const { beat } = loadStrum();
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

/* ================= 场景 T62c：渲染层 zone → 箭头跨距 ================= */
/* v2.4.2：zone 的视觉呈现由「徽标下方 2px 色带 .cell-zone.z*」改为
   **箭头自身的弦区跨距**（.kB/.kF/.kT）——照搬参考页的六线谱读法：
   弦区不再是一条带子，而是"这支箭头压在哪几条弦上"。
   随之坐标口径也变了：从前问"哪一格的色带是 z0"，现在问"哪一格的箭头带 .kB"。 */
/* ★ v2.4.3 定位口径变更（用户截图报「箭头缺尖端」的修复）：
   箭头不再挂在格子**里面**，而是挂在与格子并列的独立图层 `.strums` 里。
   根因：.cell 是 height:44px + overflow:hidden，而箭头要 top:8px / height:45px
   （8→53 贯穿六线）→ 底部被裁 9px、尖端在 top:-5px 又被裁掉头顶，24/24 支全中。
   于是"格 → 找它的 strumv 子节点"这条定位**永远返回 null**（测试当场炸，正是它该做的）。
   新口径：第 b 行的 `.strums` 层里第 i 支箭头 = 第 i 格的箭头（两层逐位同构）。 */
function strumLayerOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  const row = rows[b];
  return row ? (row.children.find(ch => /(^| )strums( |$)/.test(ch.className)) || null) : null;
}
function arrowOf(els, b, i){
  const l = strumLayerOf(els, b);
  if (!l) return null;
  /* ★ v2.4.3：层里的孩子是**紧凑**的（无方向的格不产生节点），"层里第 i 个"≠"第 i 格"。
     一律按 data-i（生产代码写的格子下标）找 */
  return l.children.find(c => c.dataset && c.dataset.i === String(i)) || null;
}
const zkOf = (els, b, i) => {
  const a = arrowOf(els, b, i);
  if (!a) return null;
  const cl = " " + a.className + " ";
  return / kF /.test(cl) ? "kF" : (/ kB /.test(cl) ? "kB" : (/ kT /.test(cl) ? "kT" : "?"));
};
section("T62c 扫弦轨 · 主视图箭头弦区跨距 / 编辑器徽标 / 空扫沿用前一记");
{
  const { beat, els } = loadStrum();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "弦区", meter: 4, bars: mkBars() }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  eq(zkOf(els, 0, 0), "kB", "低弦区格 → 箭头带 .kB（只跨下三线）");
  eq(zkOf(els, 0, 1), "kF", "中弦区格 → 箭头带 .kF（贯穿六线）");
  eq(zkOf(els, 0, 2), "kT", "高弦区格 → 箭头带 .kT（只跨上三线）");
  /* ★ 空扫的弦区**沿用前一记实扫**（参考页明文），而不是读自己的 zone 字段。
     mkBars() 里空扫自己带 zone:2，但前一记实扫是 zone:2 的高弦区——两值恰好相同，
     所以这条断言本身证明不了"跟随"生效。真正的跟随判据在 T47b 的 followBars 里
     （前一记 treble、自己的字段缺失/不同，才看得出是跟着走还是读自己）。
     这里只守"空扫也有弦区、且画成虚线"这两条与 T62 相关的性质。 */
  eq(zkOf(els, 0, 3), "kT", "空扫格同样有弦区（跟随前一记实扫：这里是 zone2 的高弦区）");
  eq((arrowOf(els, 0, 3) || {}).className.includes("ghost"), true, "★ 它是虚线 .ghost（静默格不给有声错觉）");

  /* ★ v2.4.3：箭头必须挂在**兄弟图层** .strums 里，不能是格子的子节点。
     这条是本版"箭头缺尖端"那个截图缺陷的回归守门：
     格子是 height:44px + overflow:hidden，而箭头要 8→53（45px 高）+ 尖端外延，
     挂进去必然上下都裁（实测 24/24 全裁）。所以断言落在**父子关系**上，
     而不是"箭头类名对不对"——类名一直是对的，错的是它挂在谁下面 */
  const cells0 = cellsOf(els, 0);
  eq(cells0.filter(c => c.children.some(ch => /(^| )strumv( |$)/.test(ch.className))).length, 0,
     "★ 格子里一支箭头都没有（挂进去必被 overflow:hidden 裁掉尖端）");
  const lyr = strumLayerOf(els, 0);
  ok(!!lyr, "★ 扫弦轨第 0 行存在独立的箭头图层 .strums");
  /* ★ 修正口径（v2.4.3 自测时抓到）：层里的孩子是**紧凑**的——无方向的格不产生节点，
     所以 children.length ≠ 格数，只有"全格都有方向"时才偶然相等。
     断言改成守**真正的**对应关系：每个箭头都带 data-i，且取值恰好是 {0..n-1} 的子集，
     每个取值都指向一个真实存在的格。这才是"层与格可互相定位"的可验形式。 */
  const ids = lyr.children.map(c => c.dataset && c.dataset.i);
  eq(ids.filter(x => x === undefined).length, 0,
     "★ 每支箭头都带 data-i（层与格的定位只靠它，不靠子节点序数）");
  eq(ids.every(x => { const n = +x; return Number.isInteger(n) && n >= 0 && n < cells0.length; }), true,
     "★ 每个 data-i 都落在格数范围内（不会指到不存在的格）");
  eq(new Set(ids).size, ids.length, "★ data-i 互不重复（一支箭头只认一格）");
  eq(ids.filter(x => /(^| )strumv( |$)/.test(lyr.children[+x].className)).length, ids.length,
     "★ 层里的孩子全是箭头节点（没有混进占位元素）");
  /* 图层是格子的兄弟、且在格子之前挂入（buildViz 先 append 层、再 append 格）。
     ★ 为什么"在格子之前"仍然盖在格子上方：两者都绝对定位，层带 z-index:2、格子 z-index:1，
       覆盖关系由 z-index 决定而不是 DOM 次序。原断言写成"层在格子之后"是按直觉猜的，
       与实现相反（实测抓着）；这里改成断言**实际成立的那条**——z-index 才是口径 */
  const row0 = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className))[0];
  ok(row0.children.indexOf(lyr) < row0.children.indexOf(cells0[0]),
     "★ 图层先于格子挂入（覆盖靠 z-index:2 而非 DOM 次序，见 .strums 的 CSS 注释）");
  eq(/z-index:2/.test(html), true, "★ .strums 声明的 z-index:2 仍在（层次口径的真相源）");

  /* 编辑器徽标（Editor.open 基于当前选中预设的副本，故在切走之前看）。
     ★ 编辑器里 zone **仍是文字徽标**（低/中/高），不跟着换成箭头跨距：
     编辑器是"改参数"的地方，箭头是大屏上的读谱速记；文字对读屏与色弱可达，
     在小尺寸的 edcell 里也比"跨几毫米的一段线"更明确。两处不同形是刻意的。 */
  beat.Editor.open();
  const zb = edCellsOf(els, 0)[0].children.find(c => /(^| )ed-zone /.test(c.className));
  ok(!!zb && zb.textContent === "低", "编辑器内联出 zone 文字徽标（读屏/色弱可达）");
  beat.Editor.tryClose();

  /* 无 zone 的格不挂（老数据零迁移的直接体现）。
     ★ v2.4.3：改数 `.strums` 图层里的箭头（格子本身已不再承载 strumv），
     且此时是普通轨/无扫弦型 → 该层**根本不创建**（轨门控），故用可空访问 */
  beat.Store.S.sel = { type: "builtin", idx: 1 };
  beat.Presets.refreshAfterPatternChange();
  const l0 = strumLayerOf(els, 0);
  eq(l0 ? l0.children.length : 0, 0, "无 zone/dir 预设 → 全图零箭头（且不创建箭头层）");
}

/* ================= 场景 T62d：录入 UI（zoneRow 四档） ================= */
section("T62d 扫弦轨 · zoneRow 写入 / 撤销 / 同档不推栈");
{
  const { beat, els } = loadStrum();
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
