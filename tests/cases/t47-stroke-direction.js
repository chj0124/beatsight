/* BeatSight 自动化测试 · 扫弦方向标注（v1.9.0）
   T47 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   dir 是**纯记谱层字段**，所以本组有一半篇幅用来证明它「不碰时间轴」——
   加一个标注不应该让任何一个音的时刻或音高发生变化（T47e）。 */
"use strict";
const { loadApp, FakeAudioContext, pill, ok, eq, section, drive } = require("../lib/harness");

/* 取主视图（#viz）第 b 小节的格子元素。行/格在 children 里与 beat-zone、ruler-lab、
   cell-label、组标签混排，故按 class 过滤而不是按下标取 */
function cellsOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b].children.filter(el => /(^| )cell( |$)/.test(el.className));
}
function strumOf(els, b, i){
  const c = cellsOf(els, b)[i];
  if (!c) return null;
  return c.children.find(ch => ch.className === "cell-strum") || null;
}
/* 编辑器第 b 小节的格子（edbar 的 children = [label, track]，track 的 children = edcell） */
function edCellsOf(els, b){
  return els["editorBars"].children[b].children[1].children;
}
/* 播放 seconds 秒并回传「相对首个音的时刻 + 音高 + 类型」序列——用于证明两条路径发声一致 */
function playSeq(setup, seconds){
  const { beat } = loadApp();
  if (setup) setup(beat);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, seconds);
  beat.Controls.stop();
  const t0 = ac.hits.length ? ac.hits[0].t : 0;
  return ac.hits.map(h => [Number((h.t - t0).toFixed(6)), h.freq, h.type || ""]);
}

/* ================= 场景 T47：数据 / 渲染 / 校验 / 往返 ================= */
section("T47 扫弦方向 · 数据 / 渲染 / 脏值降级 / 导出往返");
{
  const { beat, els } = loadApp();
  const BUILTINS = beat.BUILTINS;
  const Store = beat.Store;

  /* ---- ① 内置民谣扫弦：方向与其名称逐字对应 ---- */
  const folk = BUILTINS[0];
  eq(folk.name, "民谣扫弦 · 下-下上-上下上", "idx 0 仍是民谣扫弦");
  eq(folk.bars[0].map(s => s.dir).join(""), "DDUUDU", "方向 = ↓↓↑↑↓↑，与名称「下-下上-上下上」逐字对应");
  ok(folk.bars.every(b => b.map(s => s.dir).join("") === "DDUUDU"), "rep4 展开后 4 小节方向全同");
  ok(folk.bars[0].every(s => s.t !== undefined && s.rest === false), "带 dir 的步仍保留 t / rest 原字段（未破坏结构）");

  /* ---- ② 其余 11 个内置预设一个 dir 都不带（防止误加） ---- */
  eq(BUILTINS.slice(1).filter(p => p.bars.some(b => b.some(s => s.dir !== undefined))).length, 0,
     "只有民谣扫弦带方向标注，其余内置预设零 dir");

  /* ---- ③ 渲染：带 dir 出徽标、不带不出 ---- */
  beat.Viz.buildViz();
  ok(!!strumOf(els, 0, 0), "idx0 第 1 格渲染出 .cell-strum 徽标");
  eq((strumOf(els, 0, 0) || {}).textContent, "↓", "第 1 格 = 下扫 ↓");
  eq((strumOf(els, 0, 2) || {}).textContent, "↑", "第 3 格 = 上扫 ↑");
  eq(cellsOf(els, 0)[0].children.filter(c => c.className === "cell-strum").length, 1,
     "每格最多一个徽标（不重复挂）");
  /* 12t 十六分格也有徽标——**这正是「箭头必须画在格内」的原因**：
     时值标签行只给 t≥24 的格发标签，若把箭头挂在标签行，切分位上的这颗下扫就丢了，
     而它恰恰是民谣扫弦里最需要提示的一颗（其宽度 6.25%，窄格隐藏逻辑会管它） */
  eq((strumOf(els, 0, 4) || {}).textContent, "↓", "12t 十六分格同样带徽标（不因无时值标签而丢失）");
  Store.S.sel = { type: "builtin", idx: 1 };            // 四分基础：无 dir
  beat.Presets.refreshAfterPatternChange();
  eq([0,1,2,3].reduce((n, b) => n + cellsOf(els, b).filter(c =>
    c.children.some(ch => ch.className === "cell-strum")).length, 0), 0,
     "切到无 dir 的预设 → 全图零徽标（老数据零迁移的直接体现）");

  /* ---- ④ 导入校验：脏 dir 静默降级，不牵连整条预设 ---- */
  const mk = dir => ({ presets: [{ name: "方向校验", meter: 4,
    bars: [0,1,2,3].map(() => [{ t:48, dir }, { t:48 }, { t:48 }, { t:48 }]) }] });
  const last = () => Store.customs[Store.customs.length - 1].bars[0][0];
  ok(Store.importPresets(JSON.stringify(mk("x"))).ok, "dir=\"x\" 不导致导入失败（纯装饰字段，静默降级）");
  eq(last().dir, undefined, "非法 dir 被丢弃 → 无标注");
  ok(Store.importPresets(JSON.stringify(mk(1))).ok, "dir=1（非字符串）同样不导致失败");
  eq(last().dir, undefined, "非字符串 dir 被丢弃");
  const rRest = Store.importPresets(JSON.stringify({ presets: [{ name: "方向校验3", meter: 4,
    bars: [0,1,2,3].map(() => [{ t:48, rest:true, dir:"D" }, { t:48 }, { t:48 }, { t:48 }]) }] }));
  ok(rRest.ok, "休止符带 dir 不导致失败");
  eq(last().dir, undefined, "休止符上的 dir 被抹掉（休止不承载扫弦动作）");

  /* ---- ⑤ 导出 → 导入往返保留 dir ---- */
  ok(Store.importPresets(JSON.stringify(mk("U"))).ok, "合法 dir=\"U\" 导入成功");
  const exported = Store.serializePresets();
  ok(/"dir": ?"U"/.test(exported), "导出 JSON 里保留 dir 字段");
  const target = JSON.parse(exported).presets.filter(p => p.name === "方向校验").pop();
  eq(target.bars[0][0].dir, "U", "往返后 dir 值不变");
}

/* ================= 场景 T47b：窄格隐藏徽标 ================= */
section("T47b 扫弦方向 · 窄格自动隐藏（不裁半个徽标）");
{
  /* 一小节：48t(25%→150px) + 6t(3.125%→18.75px) + 96t(50%) + 36t + 6t(窄) = 192t。
     桩的行宽固定 600px，故 6t 格 ≈18.75px < 阈值 20 → 应隐藏；48t 格 150px → 应可见 */
  const { beat, els } = loadApp();
  const bars = [0,1,2,3].map(() => [
    { t:48, dir:"D" }, { t:6, dir:"U" }, { t:96 }, { t:36 }, { t:6, dir:"D" },
  ]);
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "窄格方向", meter: 4, bars }] })).ok,
     "含三十二分音符（t=6，在合法 tick 集合内）的带方向预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  /* 取 display 一律经此函数：徽标不存在时回 "(无徽标)"，不让「没生成」把整套测试炸掉
     （反向验证时踩到过——变异掉徽标生成后 T47b 直接 TypeError，后面的用例一条都跑不到） */
  const disp = (b, i) => { const sm = strumOf(els, b, i); return sm ? sm.style.display : "(无徽标)"; };
  ok(!!strumOf(els, 0, 0), "48t 宽格生成了徽标");
  eq(disp(0, 0), "", "48t 宽格：徽标可见（display 未置 none）");
  ok(!!strumOf(els, 0, 1), "6t 窄格也生成了徽标（只是被隐藏，不是没生成）");
  eq(disp(0, 1), "none", "6t 窄格：徽标隐藏");
  eq(disp(0, 4), "none", "末位 6t 窄格：同样隐藏");
  ok(strumOf(els, 0, 3) === null, "无 dir 的格不生成徽标（不是隐藏，是压根没有）");
}

/* ================= 场景 T47c：编辑器三档（民谣扫弦，全为非休止） ================= */
section("T47c 扫弦方向 · 编辑器三档可用性与写入");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  eq(els["dirRow"].children.length, 3, "方向三档（↓ / ↑ / 不标注）");
  ok(els["dirRow"].children.every(b => b.disabled), "未选中音符 → 三档全部禁用");
  eq(els["dirHint"].textContent, "先在上方选中一个音符", "未选中时提示如何操作");

  /* 选中第 1 小节第 1 格（民谣扫弦 48t，dir="D"）。
     注意 render() 会重建编辑器 DOM，选中后必须重新取元素，不能复用点击前的引用 */
  edCellsOf(els, 0)[0].fire("click");
  ok(els["dirRow"].children.every(b => !b.disabled), "选中非休止音符 → 三档启用");
  ok(els["dirHint"].textContent.includes("四分"), "提示语回显选中音符的时值");
  eq(els["dirRow"].children[0].getAttribute("aria-pressed"), "true", "当前是下扫 → ↓ 档 aria-pressed=true（与高亮同源）");
  eq(els["dirRow"].children[1].getAttribute("aria-pressed"), "false", "↑ 档未选中");

  /* 点 ↑ 上扫 */
  els["dirRow"].fire("click", { target: pill({ dir: "U" }) });
  eq(beat.Editor.draft().bars[0][0].dir, "U", "点「↑ 上扫」→ 草稿该步 dir 变 U");
  eq(els["dirRow"].children[1].getAttribute("aria-pressed"), "true", "切换后 ↑ 档 aria-pressed=true");
  const edStrums = edCellsOf(els, 0)[0].children.filter(c => c.className === "ed-strum");
  eq(edStrums.length, 1, "编辑器格子内联出一个方向标注");
  eq((edStrums[0] || {}).textContent, "↑", "编辑器内显示 ↑（与主视图同义）");

  /* 撤销回退方向（pushUndo 已把 dir 一并纳入快照） */
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0][0].dir, "D", "撤销 → 方向退回下扫");
  ok(els["undoBtn"].disabled, "撤到底后撤销按钮禁用（栈已空，下一条断言才有意义）");

  /* 点「不标注」清除 */
  edCellsOf(els, 0)[0].fire("click");
  els["dirRow"].fire("click", { target: pill({ dir: "" }) });
  eq(beat.Editor.draft().bars[0][0].dir, undefined, "点「不标注」→ 删除 dir 字段");
  eq(els["dirRow"].children[2].getAttribute("aria-pressed"), "true", "「不标注」档 aria-pressed=true");

  /* 重复点当前档位：不产生变更、不污染撤销栈。
     验证手法——若它真的推了栈，撤一次应回到「dir 仍是空」的上一步；
     实际撤一次应回到「点上标注之前」（dir="D"） */
  els["dirRow"].fire("click", { target: pill({ dir: "" }) });   // 再点一次「不标注」
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0][0].dir, "D", "重复点当前档位不推撤销栈：撤一次回到「回到 D」那步之前");
}

/* ================= 场景 T47d：编辑器 · 休止符不可标注 ================= */
section("T47d 扫弦方向 · 休止符不可标注");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type:"builtin", idx: 5 };       // Funk 十六分：idx 3 / 6 / 11 为休止符
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  edCellsOf(els, 0)[3].fire("click");                  // idx 3 是休止符
  ok(els["dirRow"].children.every(b => b.disabled), "选中休止符 → 三档禁用");
  eq(els["dirHint"].textContent, "休止符不承载扫弦动作", "给出明确原因，而不是静默无反应");
  els["dirRow"].fire("click", { target: pill({ dir: "D" }) });
  eq(beat.Editor.draft().bars[0][3].dir, undefined, "休止符上不会被写入 dir（处理器同样拦截）");
}

/* ================= 场景 T47e：dir 是纯记谱层，发声逐位不变 ================= */
section("T47e 扫弦方向 · 不改变任何发声");
{
  const withDir = playSeq(null, 3);                    // 默认即民谣扫弦（带 dir）
  /* 结构完全相同、只少了 dir 的孪生预设 */
  const bars = [0,1,2,3].map(() => [{ t:48 }, { t:24 }, { t:24 }, { t:36 }, { t:12 }, { t:48 }]);
  const without = playSeq(beat => {
    beat.Store.customs.push({ id:"c-twin", name:"无方向孪生", meter:4, bars });
    beat.Store.S.sel = { type:"custom", id:"c-twin" };
  }, 3);
  ok(withDir.length > 0 && without.length > 0, "两条路径都产生了发声（断言不是空对空）");
  eq(JSON.stringify(withDir), JSON.stringify(without),
     "加 dir 前后每个音的时刻 / 音高 / 类型逐位相同（未触碰时间轴）");
}
