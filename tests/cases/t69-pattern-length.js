/* BeatSight 自动化测试 · 型的小节数自由化（v2.5.1，第 Ⅰ 期）
   T69 系列。
   ---------------------------------------------------------------------------
   契约：**一个节奏型的小节数由它自己的 `bars.length` 决定**（域 [1, MAX_PAT_BARS]），
         `DEF_BARS` 退化为"新建型的默认值"。

   为什么要有这一期（真实用例逼出来的）：《在他乡》的扫弦是**逐小节指名**的——
   节奏型 1~5 各是 1 小节的型，段长是 1/3/4/2/4/2/4/2/6/2（全曲 30 小节）。
   而此前 `secBars = Σrepeats × 4` 把段长锁死成 4 的倍数 → 30 小节被垫成 44 小节、
   每段里同一个小节被盖 4 遍（用户报的"4 小节都是同一节奏型"就是这么来的）。

   本期只做**能力放开**，不改任何既有行为：现有数据全是 4 小节的型，逐位不变。
   因此断言分两类：
     · 放开类：1 小节 / 6 小节的型能过校验、网格行数跟着走、段长按实际小节数累加；
     · 不变类：4 小节的型（含内置全部 12 个）行为与 v2.5.0 逐位相同。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const loadStrum = () => loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }));

/* 造 n 小节的型：每小节 4 个四分音符（和 = 192 = 4×TPB） */
const mkBars = n => Array.from({ length: n }, () => [
  { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 },
]);
/* 主视图的行（每行 = 一小节）。与 t47/t62/t64 同一套定位手法 */
const rowsOf = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));

/* 导入一个 n 小节的型并选中它，返回 {beat, els, id} */
function withPattern(n, opts){
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }), opts);
  const r = beat.Store.importPresets(JSON.stringify({ presets: [{ name: n + "小节型", meter: 4, bars: mkBars(n) }] }));
  if (!r.ok) return { beat, els, id: "", error: r.error };
  const c = beat.Store.customs[beat.Store.customs.length - 1];
  beat.Store.S.sel = { type: "custom", id: c.id };
  beat.Presets.refreshAfterPatternChange();
  return { beat, els, id: c.id };
}

/* ================= 场景 T69a：校验域放开 ================= */
section("T69a 型长自由化 · 1 小节与 6 小节都能过校验 / 超上限与 0 小节被拒");
{
  const { beat } = loadApp();
  const okImp = bars => beat.Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars }] })).ok;

  ok(okImp(mkBars(1)), "★ 1 小节的型能导入（真实用例里节奏型 1~5 都是 1 小节）");
  ok(okImp(mkBars(6)), "★ 6 小节的型能导入（《在他乡》第 11-16 小节那一段）");
  eq(beat.Store.customs.length, 2, "两个都进了库（不是「导入成功却被隔离」）");

  /* 老口径（bars.length !== 4 直接拒收）在这两条上会全红——这正是本期放开的对象 */
  ok(!okImp(mkBars(beat.MAX_PAT_BARS + 1)),
     "★ 超过 MAX_PAT_BARS(" + beat.MAX_PAT_BARS + ") 被拒（导入护栏：没有它，一份坏 JSON 能造出卡死主线程的型）");
  ok(!okImp([]), "0 小节的型被拒（它没有任何合法解释：渲染/发声/段长全要除以它）");
  ok(!okImp(Array.from({ length: 2 }, () => [{ t: 48 }, { t: 48 }, { t: 48 }])),
     "时值不合法（小节不满）仍被拒——放开的是「有几小节」，不是「每小节多长」");
  eq(beat.Store.customs.length, 2, "被拒的三例都没进库");
}

/* ================= 场景 T69b：网格行数 = 型的小节数 ================= */
section("T69b 型长自由化 · 网格行数随型走（1 / 4 / 6 小节）");
{
  const one = withPattern(1);
  eq(rowsOf(one.els).length, 1, "★ 1 小节的型 → 网格 1 行");
  const six = withPattern(6);
  eq(rowsOf(six.els).length, 6, "★ 6 小节的型 → 网格 6 行");
  const def = loadStrum();
  /* 内置民谣扫弦（4 小节）——本期必须逐位不变 */
  eq(rowsOf(def.els).length, 4, "4 小节的型仍是 4 行（既有数据零变化）");
  ok(rowsOf(def.els).length === 4 && def.beat.BUILTINS.every(p => p.bars.length === 4),
     "全部 12 个内置型的 bars 长度都仍是 4（放开只对**新数据**生效）");
}

/* ================= 场景 T69c：播放按型的小节数回绕 ================= */
section("T69c 型长自由化 · 一小节的型按 1 小节循环 / 六小节的型按 6 小节走");
{
  /* 默认 96BPM → 一小节 2.5s。驱动 2.2s：只够排完第 1 小节（第 2 遍的首音在 2.58s） */
  const one = withPattern(1);
  one.beat.Controls.start();
  const ac1 = FakeAudioContext.last;
  drive(ac1, one.beat, 2.2);
  one.beat.Controls.stop();
  eq(ac1.hits.length, 4, "★ 1 小节的型：2.2s 内只响 4 声（一小节 4 个四分）——回绕模数是 1");
  near(ac1.hits[0].t, 0.08, 1e-6, "首音在一个循环起点");

  const six = withPattern(6);
  six.beat.Controls.start();
  const ac6 = FakeAudioContext.last;
  drive(ac6, six.beat, 2.2);
  six.beat.Controls.stop();
  eq(ac6.hits.length, 4, "6 小节的型：前 2.2s 仍只响第 1 小节的 4 声（没有提前回绕）");
}

/* ================= 场景 T69d：静音拍 = 型内最后一小节 ================= */
section("T69d 型长自由化 · 静音拍仍是「型内最后一小节」（4 小节的型行为不变）");
{
  const { beat } = loadStrum();
  const S = beat.Store.S;
  S.mute = true;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 默认选中的是内置第 1 个「四分基础」（4 小节、每小节 4 个四分）→ 驱动 4 小节（10s）看末小节是否静音 */
  drive(ac, beat, 9.8);
  beat.Controls.stop();
  const inWin = (a, b) => ac.hits.filter(h => h.t >= a - 1e-6 && h.t < b - 1e-6).length;
  eq(inWin(0.08, 2.58), 4, "第 1 小节 4 声");
  eq(inWin(2.58, 5.08), 4, "第 2 小节 4 声");
  eq(inWin(5.08, 7.58), 4, "第 3 小节 4 声");
  eq(inWin(7.58, 10.08), 0, "★ 第 4 小节（型内最后一小节）静音——与 v2.5.0 逐位相同");
}

/* ================= 场景 T69e：段长按型实际小节数累加（注入生效） ================= */
section("T69e 型长自由化 · 曲式段长 = Σ(遍数 × 型的小节数)，注入漏了会退回 4 的倍数");
{
  const { beat } = loadApp();
  const c = (n, reps) => ({ blocks: [{ ref: { type: "custom", id: n }, repeats: reps }] });
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "三小节", meter: 4, bars: mkBars(3) },
    { name: "六小节", meter: 4, bars: mkBars(6) },
  ] }));
  const [p3, p6] = beat.Store.customs.slice(-2);

  eq(beat.secBars(c(p3.id, 1)), 3, "★ 1 遍 × 3 小节的型 = 3 小节（老口径会算成 4）");
  eq(beat.secBars(c(p6.id, 2)), 12, "★ 2 遍 × 6 小节的型 = 12 小节（老口径会算成 8）");
  eq(beat.secBars(c("不存在的id", 2)), 8, "引用解析不出来 → 退回默认口径（4×2），交给 arrangeProblems 去报错");
  /* blockAt 的块边界与型内游标同样按型长走。
     块 0 = 3 小节的型 × 2 遍 = 6 小节（bar 0..5），块 1 = 6 小节的型 × 1 遍（bar 6..11） */
  const sec = { blocks: [{ ref: { type: "custom", id: p3.id }, repeats: 2 }, { ref: { type: "custom", id: p6.id }, repeats: 1 }] };
  eq(beat.secBars(sec), 12, "多块：3×2 + 6×1 = 12");
  eq(beat.blockAt(sec, 5).blockIdx, 0, "第 6 小节（0 基 5）仍在第 1 块（该块跨 6 小节）");
  eq(beat.blockAt(sec, 5).schedBar, 2, "★ 型内游标按 3 回绕（5 % 3 = 2，同型第 2 遍的末小节）");
  eq(beat.blockAt(sec, 4).schedBar, 1, "第 5 小节 → 型内第 1 小节（4 % 3 = 1）");
  eq(beat.blockAt(sec, 6).blockIdx, 1, "第 7 小节（0 基 6）进入第 2 块");
  eq(beat.blockAt(sec, 6).localBar, 0, "且是该块的第 0 小节");
  eq(beat.blockAt(sec, 12), null, "越界返回 null（不静默钳到最后一个块）");
}

/* ================= 场景 T69f：练习循环的下拉项数 = 型的小节数 ================= */
section("T69f 型长自由化 · 练习循环下拉项数随型走 / 一键「循环本段」按型全长");
{
  const six = withPattern(6);
  six.beat.Presets.syncLoopUI();
  eq(six.els["loopFrom"].options.length, 6, "★ 6 小节的型 → 起始下拉 6 项");
  eq(six.els["loopTo"].options.map(o => o.textContent).join(","), "1,2,3,4,5,6", "选项文案 1 基到 6");
  six.els["loopToggle"].fire("click");             // 「循环本段」
  eq(JSON.stringify(six.beat.Store.S.loopRange),
     JSON.stringify({ on: true, from: 0, to: 5 }), "★ 一键循环整段 = [0, 5]（型有多长就循环多长）");
  ok(String(six.els["loopHint"].textContent).includes("6 小节"),
     "提示文案跟着型走（实际「" + six.els["loopHint"].textContent + "」）");

  const def = loadStrum();
  eq(def.els["loopFrom"].options.length, 4, "4 小节的型仍是 4 项（既有行为零变化）");
}
