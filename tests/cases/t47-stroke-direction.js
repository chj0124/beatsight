/* BeatSight 自动化测试 · 扫弦方向标注（v1.9.0）
   T47 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   dir 对无扫弦记谱的谱只是纯记谱层字段、对带扫弦记谱的谱参与声部归属（v2.7.1），但无论哪种谱它都
   「不碰时间轴」——加一个标注不应该让任何一颗音的时刻发生变化（T47e）。 */
"use strict";
const { loadApp, FakeAudioContext, pill, ok, eq, section, drive, html } = require("../lib/harness");

/* 取主视图（#viz）第 b 小节的格子元素。行/格在 children 里与 beat-zone、ruler-lab、
   cell-label、组标签混排，故按 class 过滤而不是按下标取 */
function cellsOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b].children.filter(el => /(^| )cell( |$)/.test(el.className));
}
/* v2.4.2：方向标注由「14px 方形徽标」换成**贯穿弦区的竖箭头** .strumv。
   断言口径随之改为「读 class 上的语义」，而不是"读字形的 textContent"——
   箭头是纯 CSS 画的（::before 三角形），DOM 里**没有文字**可读，
   方向/弦区/空扫三者全部编码在类名里（.dn/.up、.kF/.kB/.kT、.ghost）。
   这个改口径本身是好事：旧写法把"画了什么字形"当契约，一改字形就得改测试；
   新写法测的是"数据有没有正确翻译成可读的谱面信息"，与像素无关。 */
/* ★ v2.4.3：箭头改挂独立图层 .strums（格子的**兄弟**，不是子节点）。
   格子是 height:44px + overflow:hidden，而箭头要 8→53 贯穿六线 + 尖端外延，
   挂进格子里必然上下都裁（实测 24/24 全裁，用户截图里的"缺尖端"即此）。
   ★ 层里的孩子是**紧凑**的（无方向的格不产生节点），所以"层里第 i 个"≠"第 i 格"：
     只有全格都有方向时才偶然相等。定位一律走 data-i（生产代码在节点上写了格子下标），
     否则窄格隐藏那类"只有部分格有箭头"的场景会整体错位（T47b 当场红过一次）。
   返回形状与旧版一致：拿不到就 null，让"没生成"走同一分支 */
function strumLayerOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b] ? rows[b].children.find(ch => /(^| )strums( |$)/.test(ch.className)) || null : null;
}
function strumOf(els, b, i){
  const l = strumLayerOf(els, b);
  if (!l) return null;
  return l.children.find(c => c.dataset && c.dataset.i === String(i)) || null;
}
/* class → { dir, zone, air } 的解析器：测试里一律经它取值，不再裸读 className */
function strumInfo(els, b, i){
  const sm = strumOf(els, b, i);
  if (!sm) return null;
  const cl = " " + sm.className + " ";
  return {
    up: / up /.test(cl),           // 箭头画在底端 = 上扫（数据 'U'）
    dn: / dn /.test(cl),           // 箭头画在顶端 = 下扫（数据 'D'）
    zone: / kF /.test(cl) ? "full" : (/ kB /.test(cl) ? "bass" : (/ kT /.test(cl) ? "treble" : "?")),
    air: / ghost /.test(cl),       // 蓝色虚线 = 空扫
  };
}
/* 六线底纹：.strumv 的几何基准（--gtop / --gt），缺了它箭头就没有"弦"可压 */
function tabOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b] ? rows[b].children.find(ch => /(^| )tab( |$)/.test(ch.className)) || null : null;
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

  /* ---- ① 内置民谣扫弦：方向字段与其名称逐字对应（v2.1.0 的翻转只在渲染层，数据一字未动） ---- */
  const folk = BUILTINS[0];
  eq(folk.name, "民谣扫弦 · 下-下上-上下上", "idx 0 仍是民谣扫弦");
  eq(folk.bars[0].map(s => s.dir).join(""), "DDUUDU",
     "字段 = 下 下 上 上 下 上 —— 记的是**手部动作**，不是画出来的箭头");
  ok(folk.bars.every(b => b.map(s => s.dir).join("") === "DDUUDU"), "rep4 展开后 4 小节方向全同");
  ok(folk.bars[0].every(s => s.t !== undefined && s.rest === false), "带 dir 的步仍保留 t / rest 原字段（未破坏结构）");

  /* ---- ② 其余 11 个内置预设一个 dir 都不带（防止误加） ---- */
  eq(BUILTINS.slice(1).filter(p => p.bars.some(b => b.some(s => s.dir !== undefined))).length, 0,
     "只有民谣扫弦带方向标注，其余内置预设零 dir");

  /* ---- ③ 渲染：字形按**手部动作**翻转（v2.1.0 全局翻转：下扫=↑、上扫=↓） ---- */
  beat.Viz.buildViz();
  ok(!!strumOf(els, 0, 0), "idx0 第 1 格渲染出 .strumv 竖箭头");
  eq(JSON.stringify(strumInfo(els, 0, 0)), JSON.stringify({ up:false, dn:true, zone:"full", air:false }),
     "第 1 格 dir=\"D\"（下扫）→ 箭头画在顶端（.dn），贯穿六线（.kF）");
  eq(JSON.stringify(strumInfo(els, 0, 2)), JSON.stringify({ up:true, dn:false, zone:"full", air:false }),
     "第 3 格 dir=\"U\"（上扫）→ 箭头画在底端（.up）");
  eq(strumLayerOf(els, 0).children.length, strumLayerOf(els, 0).children.filter(c => /(^| )strumv( |$)/.test(c.className)).length,
     "每格最多一个箭头（不重复挂）——层里第 i 个就是第 i 格的那一支");
  /* 12t 十六分格也有箭头——**这正是「箭头必须画在格内」的原因**：
     时值标签行只给 t≥24 的格发标签，若把箭头挂在标签行，切分位上的这颗下扫就丢了，
     而它恰恰是民谣扫弦里最需要提示的一颗（其宽度 6.25%，窄格隐藏逻辑会管它） */
  eq((strumInfo(els, 0, 4) || {}).dn, true, "12t 十六分格同样带箭头（不因无时值标签而丢失）");
  Store.S.sel = { type: "builtin", idx: 1 };            // 四分基础：无 dir
  beat.Presets.refreshAfterPatternChange();
  eq([0,1,2,3].reduce((n, b) => { const l = strumLayerOf(els, b); return n + (l ? l.children.length : 0); }, 0), 0,
     "切到无 dir 的预设 → 全图零箭头（老数据零迁移的直接体现）");

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
  eq(last().dir, "D", "休止槽上的 dir **保留** = 空扫（v2.1.0 放开 rest 限制）");
  eq(last().rest, true, "它仍然是不发声的休止槽（放开的是标注，不是发声）");

  /* ---- ④b 空扫渲染：休止槽带 dir → 蓝色**虚线**箭头 .strumv.ghost，与实心箭头互斥 ---- */
  Store.S.sel = { type:"custom", id: Store.customs[Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  const air = strumInfo(els, 0, 0);
  ok(!!air, "休止槽带 dir → 渲染 .strumv.ghost（蓝色虚线），而不是实心箭头");
  eq(air ? air.air : null, true, "该箭头带 .ghost（空扫专用虚线样式）");
  eq(air ? air.dn : null, true, "空扫方向同样按手部动作翻转：dir=\"D\" → .dn（箭头朝上）");
  eq(air ? air.zone : null, "full", "空扫无前一记实扫 → 弦区落默认「全部弦」（不被 ghost 吞掉）");
  /* ★ 这里不能写 eq(strumOf(...), null)：eq() 会对实际值做 JSON.stringify，
     而桩元素带 parentNode 循环引用 → TypeError 直接把整个测试进程炸掉（已踩过）。
     判"没有第二个箭头"要用计数，不要用元素与 null 相等 */
  eq(strumLayerOf(els, 0).children.length, 1,
     "空扫格只有**一支**箭头（ghost 是同一个元素的变体类，不是并列的第二个元素）");

  /* ---- ⑤ 导出 → 导入往返保留 dir ---- */
  ok(Store.importPresets(JSON.stringify(mk("U"))).ok, "合法 dir=\"U\" 导入成功");
  const exported = Store.serializePresets();
  ok(/"dir": ?"U"/.test(exported), "导出 JSON 里保留 dir 字段");
  const target = JSON.parse(exported).presets.filter(p => p.name === "方向校验").pop();
  eq(target.bars[0][0].dir, "U", "往返后 dir 值不变");
}

/* ================= 场景 T47b：窄格隐藏箭头 + v2.4.2 六线底纹 / 弦区跨距 ================= */
section("T47b 扫弦方向 · 窄格自动隐藏（不裁半支箭头）/ 六线底纹 / zone→弦区跨距");
{
  /* 一小节：48t(25%→150px) + 6t(3.125%→18.75px) + 96t(50%) + 36t + 6t(窄) = 192t。
     桩的行宽固定 600px，故 6t 格 ≈18.75px；v2.4.2 的 STRUM_MIN_W 由 20 降到 14，
     18.75 ≥ 14 → **这两个 6t 窄格现在反而可见了**。为了让"隐藏"这条分支仍被真正走到，
     改用 3t 格（1.5625% → 9.375px < 14）。这个改动是有意的：阈值变了，
     用例就必须跟着找到新的临界点，否则测的是一段永远为真的分支。 */
  /* ★ v2.4.2 的临界点变了（STRUM_MIN_W 20 → 14），而**合法时值的最小档就是 6t**
     （VALID_T = [192,96,72,48,36,24,16,12,8,6]），不能再靠"把格子做得更窄"来触发隐藏——
     6t 在桩的默认行宽 600px 上是 18.75px ≥ 14，反而**可见**了。
     所以改为把**行宽调窄**：桩支持 loadApp 的第二参 opts 覆盖行宽（见 harness 的 rowW），
     192px 行宽下 6t 格 = 6.25px < 14 → 隐藏分支被真正走到，而 48t 格 = 48px 仍可见。
     这样测的仍是同一条规则（"格宽 < 阈值就整体隐藏"），只是把两个档位的相对关系摆对。 */
  const { beat, els } = loadApp(undefined, { rowW: 192 });
  const bars = [0,1,2,3].map(() => [
    { t:48, dir:"D" }, { t:6, dir:"U" }, { t:96 }, { t:36 }, { t:6, dir:"D" },
  ]);
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "窄格方向", meter: 4, bars }] })).ok,
     "含三十二分音符（t=6，合法 tick 的最小档）的带方向预设导入成功");
  ok(beat.Store.customs.length > 0, "预设确实落到 customs（下面要靠它取 id，先守住这条前提）");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  /* 取 display 一律经此函数：箭头不存在时回 "(无箭头)"，不让「没生成」把整套测试炸掉
     （反向验证时踩到过——变异掉箭头生成后 T47b 直接 TypeError，后面的用例一条都跑不到） */
  const disp = (b, i) => { const sm = strumOf(els, b, i); return sm ? sm.style.display : "(无箭头)"; };
  ok(!!strumOf(els, 0, 0), "48t 宽格生成了箭头");
  eq(disp(0, 0), "", "48t 宽格（192px 行宽下 = 48px）：箭头可见（display 未置 none）");
  ok(!!strumOf(els, 0, 1), "6t 窄格也生成了箭头（只是被隐藏，不是没生成）");
  eq(disp(0, 1), "none", "6t 窄格（192px 行宽下 = 6.25px < 14）：箭头隐藏");
  eq(disp(0, 4), "none", "末位 6t 窄格：同样隐藏");
  ok(strumOf(els, 0, 3) === null, "无 dir 的格不生成箭头（不是隐藏，是压根没有）");

  /* ---- v2.4.2 新增：六线底纹存在、六条线、且只在带扫弦记谱的谱上出现 ---- */
  const tab = tabOf(els, 0);
  ok(!!tab, "带扫弦记谱的谱：每行铺了一层 .tab 六线底纹");
  eq(tab ? tab.children.length : 0, 6, "★ 底纹恰好六条弦线（不是 5 也不是 7）");
  eq(tabOf(els, 3) ? true : false, true, "四行**每行**都有底纹（逐行铺，不是只铺第一行）");
  /* 线的 y 用 CSS 变量算出，桩不跑样式引擎，故只验证"确实按 li 递增写了 top" */
  eq(tab.children[0].style.top, "calc(var(--gtop) + 0 * var(--gt))", "第 1 条弦线 top 由变量推出");
  eq(tab.children[5].style.top, "calc(var(--gtop) + 5 * var(--gt))", "第 6 条弦线 top 由变量推出");

  /* ---- v2.4.2 新增：zone → 弦区跨距（这才是"照搬参考页"的核心语义） ---- */
  const zoneBars = [0,1,2,3].map(() => [
    { t:48, dir:"D", zone:0 }, { t:48, dir:"D", zone:1 }, { t:48, dir:"D", zone:2 },
    { t:48, dir:"U" },                                    // 缺省 zone → 全部弦
  ]);
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "弦区跨距", meter: 4, bars: zoneBars }] })).ok,
     "三档弦区预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  eq((strumInfo(els, 0, 0) || {}).zone, "bass", "zone=0 → .kB（只跨下三线 = 低音区）");
  eq((strumInfo(els, 0, 1) || {}).zone, "full", "zone=1 → .kF（贯穿六线 = 全部弦）");
  eq((strumInfo(els, 0, 2) || {}).zone, "treble", "zone=2 → .kT（只跨上三线 = 高音区）");
  eq((strumInfo(els, 0, 3) || {}).zone, "full", "缺省 zone → .kF（老数据零迁移：没有 zone 就是全部弦）");

  /* ---- v2.4.2 新增：空扫的弦区**跟随前一记实扫**（参考页明文语义） ---- */
  const followBars = [0,1,2,3].map(() => [
    { t:48, dir:"D", zone:2 },        // 高音区实扫
    { t:48, rest:true, dir:"D" },     // 空扫 → 应跟到 treble，而不是回落 full
    { t:48, rest:true, dir:"U" },     // 再一记空扫 → 仍跟 treble（空扫不更新"前一记"）
    { t:48, dir:"D", zone:0 },        // 低音区实扫 → 此后基准变 bass
  ]);
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "空扫跟随", meter: 4, bars: followBars }] })).ok,
     "空扫跟随预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  const f1 = strumInfo(els, 0, 1), f2 = strumInfo(els, 0, 2);
  eq(f1 ? f1.zone : null, "treble", "★ 空扫沿用**前一记实扫**的弦区（treble），不回落 full");
  eq(f1 ? f1.air : null, true, "它确实是空扫（.ghost）");
  eq(f2 ? f2.zone : null, "treble", "连续空扫仍保持 treble（空扫不更新「前一记弦区」）");
  /* 跨小节重置：弦区跟随不越过小节边界（小节是扫弦谱的语义单位） */
  const b1i0 = strumInfo(els, 1, 0);
  eq(b1i0 ? b1i0.zone : null, "treble", "第 2 小节第 1 格是高音区实扫（数据如此）");
  const restartBars = [0,1,2,3].map(() => [
    { t:48, rest:true, dir:"D" },     // 小节首格就是空扫，没有"前一记"
    { t:48, dir:"D", zone:0 }, { t:48 }, { t:48 },
  ]);
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "空扫无前记", meter: 4, bars: restartBars }] })).ok,
     "小节首格空扫预设导入成功");
  beat.Store.S.sel = { type:"custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  eq((strumInfo(els, 0, 0) || {}).zone, "full",
     "无前一记实扫的空扫 → 落全部弦（不是 undefined、不是空箭头）");
  eq((strumInfo(els, 1, 0) || {}).zone, "full",
     "★ 第 2 小节首格同样是空扫、同样从 full 重起（弦区跟随不跨小节）");
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
  eq(els["dirRow"].children[0].getAttribute("aria-pressed"), "true", "当前是下扫 → 「↑ 下扫」档 aria-pressed=true（与高亮同源）");
  eq(els["dirRow"].children[1].getAttribute("aria-pressed"), "false", "「↓ 上扫」档未选中");

  /* 点 ↑ 上扫 */
  els["dirRow"].fire("click", { target: pill({ dir: "U" }) });
  eq(beat.Editor.draft().bars[0][0].dir, "U", "点「↓ 上扫」→ 草稿该步 dir 变 U");
  eq(els["dirRow"].children[1].getAttribute("aria-pressed"), "true", "切换后「↓ 上扫」档 aria-pressed=true");
  const edStrums = edCellsOf(els, 0)[0].children.filter(c => c.className === "ed-strum");
  eq(edStrums.length, 1, "编辑器格子内联出一个方向标注");
  eq((edStrums[0] || {}).textContent, "↓", "编辑器内显示 ↓（dir=\"U\" 上扫，与主视图同义同翻转）");

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

/* ================= 场景 T47d：编辑器 · 休止槽 = 空扫（v2.1.0 放开） ================= */
section("T47d 扫弦方向 · 休止槽 = 空扫（可标注）");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type:"builtin", idx: 5 };       // Funk 十六分：idx 3 / 6 / 11 为休止符
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  edCellsOf(els, 0)[3].fire("click");                  // idx 3 是休止符
  ok(els["dirRow"].children.every(b => !b.disabled),
     "选中休止符 → 三档照常启用（v2.1.0 放开：休止槽上的方向 = 空扫）");
  ok(els["dirHint"].textContent.includes("空扫"), "提示语点明语义（不是「不可标注」了）");
  els["dirRow"].fire("click", { target: pill({ dir: "D" }) });
  eq(beat.Editor.draft().bars[0][3].dir, "D", "休止槽上写入 dir（空扫）");
  const airs = edCellsOf(els, 0)[3].children.filter(c => c.className === "ed-air");
  eq(airs.length, 1, "编辑器内联出 .ed-air（蓝括号），不是 .ed-strum");
  eq((airs[0] || {}).textContent, "↑", "空扫字形同样翻转：dir=\"D\" → ↑");
  eq(edCellsOf(els, 0)[3].children.filter(c => c.className === "ed-strum").length, 0,
     "空扫格不出现实心徽标（两变体互斥）");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0][3].dir, undefined, "撤销把空扫标注一并退回（与其它草稿变更同一套纪律）");
}

/* ================= 场景 T47e：dir 的声部语义（v2.7.1 改写 / v2.9.0 收口） =================
   v2.7.1 之前：dir 是纯记谱层，发不发声、怎么发声都与它无关（旧 T47e 守"逐位不变"）。
   v2.7.1 起 dir 参与**声部归属**（带 dir 的发声音符归扫弦声部）。
   v2.9.0：两态轨模型删除——旧实现靠"普通轨门控 dir 发声"的那道防线（原场景①）随轨模型
     一起消失，判据改按**内容**（hasStrum：带 dir 或 zone 的型整体归扫弦声部）。
     所以原场景①（普通轨发声门控）退役；存活的不变量只剩一条——dir 只改声部与叠加网格，
     **时刻一字不动**（时间轴不变量不死）。 */
section("T47e 扫弦方向 · dir-only 谱归扫弦声部 + 只改声部不动时间轴");
{
  const bars = [0,1,2,3].map(() => [{ t:48 }, { t:24 }, { t:24 }, { t:36 }, { t:12 }, { t:48 }]);
  /* dir-only 谱 = 民谣扫弦形状。v2.7.1 后每小节 = 6 声扫弦 + 4 声拍点网格，
     与无 dir 孪生（无网格、6 声节拍音）对比：原 6 颗音的时刻必须原样含在其中 */
  const strumWithDir = playSeq(null, 3);                   // 默认即民谣扫弦（带 dir，hasStrum）
  const strumWithout = playSeq(beat => {
    beat.Store.customs.push({ id:"c-twin2", name:"无方向孪生2", meter:4, bars });
    beat.Store.S.sel = { type:"custom", id:"c-twin2" };
  }, 3);
  const timesWith = strumWithDir.map(h => h[0]), timesWithout = strumWithout.map(h => h[0]);
  ok(timesWithout.every(t => timesWith.includes(t)),
     "★ 扫弦轨：dir 只改声部——原每颗音的时刻在新发声序列里逐位都在（时间轴未动）");
  ok(timesWith.length > timesWithout.length, "扫弦轨下网格拍点叠加在扫弦之上（声部并列，不是替代）");
}

/* ================= 场景 T47f：箭头 CSS 三角形方向与类名语义同源（v2.4.3 回归） ================= */
section("T47f 扫弦方向 · CSS 三角形方向回归（dn=▲ border-bottom / up=▼ border-top）");
{
  /* v2.4.3「尖端收进跨距」的编辑顺手把 .dn::after/.up::after 的 **border 方向写反了**
     （dn 误用 border-top → ▼、up 误用 border-bottom → ▲）：D/U 渲染整个颠倒
     （用户截图：全部箭头变"顶端 ▼ + 下垂长杆"），且 ghost/hit 染色全部失配——
     ghost/hit up 的三角被 border-bottom-color:transparent 整个隐掉（截图中蓝色虚线无头即此）。
     桩不跑样式引擎，测不了像素；但 border 方向是**源码级契约**：dn 的三角必须用
     border-bottom（▲ 尖朝上 = D→↑）、up 必须用 border-top（▼ 尖朝下 = U→↓），
     与 CSS 注释的方向映射、与 ghost/hit 的染色配对三者绑定。直接对标记文本断言，
     哪天再动这两行，测试当场红。 */
  const dn = (html.match(/\.strumv\.dn::after\{[^}]*\}/) || [""])[0];
  const up = (html.match(/\.strumv\.up::after\{[^}]*\}/) || [""])[0];
  ok(dn !== "" && up !== "", "标记里存在 .strumv.dn::after / .up::after 两条规则（否则本组测的是空集）");
  ok(/border-bottom:7px solid/.test(dn) && !/border-top:7px solid/.test(dn),
     "dn 三角用 border-bottom（▲ 尖朝上 = D→↑）——v2.4.3 曾误写 border-top 导致整组箭头颠倒");
  ok(/border-top:7px solid/.test(up) && !/border-bottom:7px solid/.test(up),
     "up 三角用 border-top（▼ 尖朝下 = U→↓），与 dn 严格配对");
  /* 染色规则与方向映射的配对也要守住：base 变体染 border-bottom-color（dn 的 ▲）、
     .up 变体染 border-top-color（up 的 ▼）。方向若再翻转而染色不改，ghost/hit 的头会整个消失或失色 */
  ok(/\.strumv\.ghost::after\{border-bottom-color:var\(--blue\)\}/.test(html) &&
     /\.strumv\.ghost\.up::after\{border-top-color:var\(--blue\);border-bottom-color:transparent\}/.test(html),
     "ghost 染色与方向映射同源（base 染 ▲ / .up 染 ▼）——失配时空扫的三角整个消失（v2.4.3 实测）");
  ok(/\.strumv\.hit::after\{border-bottom-color:var\(--green\)\}/.test(html) &&
     /\.strumv\.hit\.up::after\{border-top-color:var\(--green\);border-bottom-color:transparent\}/.test(html),
     "hit 染色与方向映射同源（同上）");
}
