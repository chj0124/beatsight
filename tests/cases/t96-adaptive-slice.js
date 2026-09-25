/* BeatSight 自动化测试 · 窄屏自适应分片（v2.15.0）
   T96 系列。
   ---------------------------------------------------------------------------
   需求（用户）：手机上竖屏时"一行一小节"把十六分型挤得看不清，希望按宽度自适应——
   特别窄时一行只显示半小节、甚至四分之一。
   契约（见 index.html Viz 的"行内切分"区块与 DEVELOPMENT §3.19）：
     · 档位 = **每行几拍**（vizRowBeats），候选 = 拍数的约数（降序），判据 = 最短格宽度
       ≥ SLICE_MIN_CELL(24px)；切点必落在整拍上；整屏统一一档。
     · 行 = 小节的**一片**：窗口、翻页、端点映射、弹跳球、座次尺、状态栏读数全部走"片段"；
       跨行长音在两侧各成一段（.cutl/.cutr），截断片段的时值标签被压制。
     · **K=1 是安全边界**：每行 = 整小节时全链逐位等于分片之前（既有 t79/t87/t89 全绿即证）。
   本文件专测"分片之后"的那一半：判据边界 / 两个宽度的对照 / 跨行片段 / 帧路径翻行 /
   曲式模式 + 歌词轨的片段口径。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, driveFrames } = require("../lib/harness");

const rowsOf = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const cellsOf = r => r.children.filter(el => /(^| )cell( |$)/.test(el.className));
/* 只数**时值标签**（.cell-label）——组标签（.cell-label.group，如"十六 ×4"）不算：
   它是短音符合并标注，与"这颗音多长"无关（T96c 的压制断言只关心前者） */
const labelsOf = r => r.children.filter(el => /(^| )cell-label( |$)/.test(el.className) && !/(^| )group( |$)/.test(el.className));
const rulerOf = r => r.children.filter(el => /(^| )ruler-lab( |$)/.test(el.className)).map(el => el.textContent);
const zonesOf = r => r.children.filter(el => /(^| )beat-zone( |$)/.test(el.className));
const cls = el => String(el.className);
/* 让当前型换成内置的第 idx 个（并触发一次重建），返回 {beat, els} */
function pickBuiltin(app, idx){
  app.beat.Store.S.sel = { type: "builtin", idx };
  app.beat.Presets.refreshAfterPatternChange();
}

/* ================= 场景 T96a：判据（纯函数边界） ================= */
section("T96a 分片判据 · 每行几拍 = f(行宽, 拍号, 最短时值)");
{
  const { beat } = loadApp();
  const C = beat.Viz.chooseRowBeats;
  /* 4/4 + 十六分（12t）：600px 够读 → 整小节；300px 拆半；140px 拆到 1 拍 */
  eq(C(600, 4, 12), 4, "600px × 十六分：最短格 37.5px ≥ 24 → 整小节");
  eq(C(300, 4, 12), 2, "300px × 十六分：18.75px 不够读 → 半小节（2 拍）");
  eq(C(140, 4, 12), 1, "140px × 十六分：半小节仍不够 → 每行 1 拍");
  /* 内容密度相关：四分型在任何宽度都不拆 */
  eq(C(300, 4, 48), 4, "300px × 四分型：格子 75px → 不拆（稀疏型不需要分片）");
  /* 三十二分（6t）在宽屏也拆 */
  eq(C(600, 4, 6), 2, "600px × 三十二分：18.75px 不够读 → 半小节");
  /* 奇数拍：候选是拍数的约数（5 → 5/1），切点仍落在整拍上 */
  eq(C(600, 5, 12), 5, "5/4 × 600px：格子 30px → 不拆");
  eq(C(300, 5, 12), 1, "5/4 × 300px：15px 不够读 → 拆到每行 1 拍（约数候选里没有'半小节'）");
  /* 6/8：候选 6/3/2/1 */
  eq(C(300, 6, 16), 3, "6/8 × 300px × 八三连：25px → 半小节（3 拍）");
  /* 脏输入兜底 */
  eq(C(0, 4, 12), 4, "行宽为 0（尚未布局）→ 按整小节兜底");
  eq(C(600, 0, 12), 4, "拍号脏 → 兜底 4");
  eq(C(600, 4, 0), 4, "最短时值脏（0）→ 按 1 拍算 → 600px 绰绰有余 → 整小节");
  eq(C(100, 4, 6), 1, "极窄且极密：所有候选都不达标 → 兜底 1 拍/行（再细就不是行了）");
}

/* ================= 场景 T96b：同型两宽度对照（核心需求） ================= */
section("T96b 同一十六分型 · 600px 整小节 vs 300px 半小节（格数 / 座次尺 / 跑道都跟着分片）");
{
  /* 宽屏：整小节（K=1）——与分片之前逐位相同 */
  const wide = loadApp(undefined, { rowW: 600 });
  pickBuiltin(wide, 5);                                  // 内置 5 = Funk 十六分（16 格 × 4 小节）
  {
    const rs = rowsOf(wide.els);
    eq(wide.beat.Viz.internals().vizRowBeats, 4, "600px：每行 4 拍（整小节）");
    eq(cellsOf(rs[0]).length, 16, "600px：第 1 行 16 格");
    eq(zonesOf(rs[0]).length, 4, "600px：跑道 4 段（每拍一段）");
    eq(rulerOf(rs[0]).join(","), "1,e,&,a,2,e,&,a,3,e,&,a,4,e,&,a", "600px：座次尺报 1→4 拍");
    ok(cls(cellsOf(rs[0])[1]).indexOf("cutl") < 0 && cls(cellsOf(rs[0])[1]).indexOf("cutr") < 0,
       "600px：没有续接片段（行 = 完整小节）");
  }
  /* 窄屏：半小节（K=2）——同一份数据，只因为宽度就换了粒度 */
  const narrow = loadApp(undefined, { rowW: 300 });
  pickBuiltin(narrow, 5);
  {
    const rs = rowsOf(narrow.els);
    eq(narrow.beat.Viz.internals().vizRowBeats, 2, "★ 300px：每行 2 拍（半小节）");
    eq(cellsOf(rs[0]).length, 8, "★ 第 1 行只装前半小节（16 格 → 8 格）");
    eq(cellsOf(rs[1]).length, 8, "★ 第 2 行装后半小节");
    eq(zonesOf(rs[0]).length, 2, "跑道 2 段（本行 2 拍）");
    eq(rulerOf(rs[0]).join(","), "1,e,&,a,2,e,&,a", "★ 座次尺只报本行覆盖的拍（1、2）");
    eq(rulerOf(rs[1]).join(","), "3,e,&,a,4,e,&,a", "★ 第 2 行从第 3 拍数起（不是又从 1 开始）");
    ok(/12\.5%/.test(cellsOf(rs[0])[0].style.width), "格子宽度按**行跨度**算（12t/96t = 12.5%）");
    /* 网格线只画行内的拍边界：4/4 半小节 = 1 条 */
    const gls = narrow.els["viz"].children.filter(el => cls(el) === "grid-line");
    eq(gls.length, 1, "★ 拍网格线随分片减到 1 条（不再横贯整屏画 3 条）");
  }
}

/* ================= 场景 T96c：跨行长音 → 续接片段（cutl/cutr）+ 标签压制 ================= */
section("T96c 跨行长音 · 两侧各成一段（虚线续边）/ 截断片段不打时值标签");
{
  /* 一小节：十二分 ×4（0..48）+ 二分 96t（48..144，跨过 96t 的中线）+ 附点八 36t + 十二分。
     全部是合法时值（VALID_T），最短 12t → 300px 下 K=2，且 96t 那颗恰被切在 96t 边界上。 */
  const mk = () => ({ presets: [{ name: "跨行长音", meter: 4, bars: [
    [{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:96 },{ t:36 },{ t:12 }],
  ] }] });
  /* 窄屏：切分生效 */
  const narrow = loadApp(undefined, { rowW: 300 });
  const imp1 = narrow.beat.Store.importPresets(JSON.stringify(mk()));
  ok(imp1.ok, "跨行长音预设导入成功" + (imp1.ok ? "" : "（原因：" + imp1.why + "）"));
  narrow.beat.Store.S.sel = { type:"custom", id: narrow.beat.Store.customs[narrow.beat.Store.customs.length - 1].id };
  narrow.beat.Presets.refreshAfterPatternChange();
  {
    const rs = rowsOf(narrow.els);
    const r0 = cellsOf(rs[0]), r1 = cellsOf(rs[1]);
    eq(r0.length, 5, "前半小节 5 格（4 颗十六分 + 二分的截尾）");
    ok(/cutr/.test(cls(r0[4])), "★ 长音的截尾片段带 .cutr（右边断开）");
    eq(r1.length, 3, "后半小节 3 格（二分的截头 + 附点八 + 十六分）");
    ok(/cutl/.test(cls(r1[0])), "★ 长音的截头片段带 .cutl（左边断开）");
    ok(cls(r1[1]).indexOf("cut") < 0, "后续音符不是续接片段");
    ok(/50%/.test(r1[0].style.width), "截头片段宽度 = 48t/96t = 50%（按截断后的时值画）");
    /* 两处会重写 className 的路径（setCell 的逐帧重绘 / resetForStop 的停机复位）都要保留续接标记——
       v2.15.0 实测踩过：只写在建树里，播放第一帧的全量重绘就把虚线边洗掉了 */
    narrow.beat.Controls.setBpm(120);
    narrow.beat.Controls.start();
    driveFrames(FakeAudioContext.last, narrow.beat, 0.05);
    ok(/cutr/.test(cls(cellsOf(rowsOf(narrow.els)[0])[4])), "★ 播放中逐帧重绘（setCell）后 .cutr 仍在");
    narrow.beat.Controls.stop();
    ok(/cutl/.test(cls(cellsOf(rowsOf(narrow.els)[1])[0])), "★ 停机复位（resetForStop）后 .cutl 仍在");
    eq(labelsOf(rs[0]).length, 0, "★★ 截尾片段**不**打时值标签（它截断后是 48t，真值是 96t）");
    eq(labelsOf(rs[1]).map(l => l.textContent).join(","), "附点八", "截头片段同样不打标签（只剩 36t 那颗有）");
    ok(!/二分/.test(labelsOf(rs[1]).map(l => l.textContent).join(",")), "★ 全文没有「二分」——被切开的 96t 从未以完整时值示人");
  }
  /* 宽屏对照：整小节 → 长音完整、有标签、无续接片段 */
  const wide = loadApp(undefined, { rowW: 600 });
  ok(wide.beat.Store.importPresets(JSON.stringify(mk())).ok, "（宽屏）预设导入成功");
  wide.beat.Store.S.sel = { type:"custom", id: wide.beat.Store.customs[wide.beat.Store.customs.length - 1].id };
  wide.beat.Presets.refreshAfterPatternChange();
  {
    const rs = rowsOf(wide.els);
    eq(cellsOf(rs[0]).length, 7, "600px：整小节 7 格（长音不切）");
    eq(labelsOf(rs[0]).map(l => l.textContent).join(","), "二分,附点八", "★ 宽屏下长音有独立时值标签（对照组：压制只发生在截断片段上）");
    ok(cls(cellsOf(rs[0])[4]).indexOf("cut") < 0, "宽屏下无 .cutl/.cutr");
  }
}

/* ================= 场景 T96d：帧路径 —— 播到第 2 片时换行 + 状态栏读数折回小节口径 ================= */
section("T96d 帧路径 · 播过第 2 拍翻到第 2 行；状态栏仍报「第几小节 · 第几拍」的小节口径");
{
  const app = loadApp(undefined, { rowW: 300 });
  const { beat, els } = app;
  pickBuiltin(app, 5);                                   // Funk 十六分
  beat.Controls.setBpm(120);                             // 1 拍 = 0.5s → 第 2 片从 0.5s 起
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const rows = () => rowsOf(els);
  const cur = () => rows().findIndex(r => r.classList.contains("current"));
  let hitRow1 = false, statusAt = "";
  for (let i = 0; i < 240 && !hitRow1; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (cur() === 1){ hitRow1 = true; statusAt = els["statusText"] ? els["statusText"].textContent : ""; }
    if (!beat.Store.S.playing) break;
  }
  ok(hitRow1, "★ 播放推进到第 2 行（半小节窗口走完第 2 拍即翻行）");
  eq(statusAt, "播放中 · 第 1 小节 · 3",
    "★ 第 2 行内报「第 3 拍」——读数折回小节口径（不是又报第 1 拍）；行号 ≠ 小节号（仍属第 1 小节）");
}

/* ================= 场景 T96e：曲式模式 + 歌词轨的片段口径 ================= */
section("T96e 曲式模式 · 网格与歌词轨都按片切（同一小节的后半在下一行）");
{
  const { beat, els } = loadApp(undefined, { rowW: 300 });
  /* 两段歌，每段 1 小节；型是十六分（minStep 12 → 300px 下 K=2） */
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "十六", meter: 4,
    bars: [[{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },
            { t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 },{ t:12 }]] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t96", name: "两段歌", sections: [
    { name: "A段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
    { name: "B段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] });
  /* v2.26.0：段 uid 由 normArrange 补发（动态），按位置现取 */
  const u96 = i => beat.Store.findArrange("t96").sections[i].uid;
  /* A 段两个字分别落在前半（t=0）与后半（t=96）；B 段一个字在前半 */
  beat.Store.upsertLyric("t96", u96(0), [{ t: 0, dur: 24, ch: "一" }, { t: 96, dur: 24, ch: "二" }]);
  beat.Store.upsertLyric("t96", u96(1), [{ t: 0, dur: 24, ch: "三" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t96", from: 0, to: 1, loop: false };
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 0.3);                            // 让窗口/歌词轨建起来
  const iv = beat.Viz.internals();
  eq(iv.vizRowBeats, 2, "曲式模式同样按 2 拍/行分片");
  const rs = rowsOf(els);
  eq(rulerOf(rs[0]).join(","), "1,e,&,a,2,e,&,a", "第 1 行 = 歌曲第 1 小节的前半");
  eq(rulerOf(rs[1]).join(","), "3,e,&,a,4,e,&,a", "第 2 行 = 同一小节的后半（连排）");
  eq(rulerOf(rs[2]).join(","), "1,e,&,a,2,e,&,a", "第 3 行 = 第 2 小节的前半");
  /* 歌词轨：行 = 片；跨片的字各归各行 */
  const lr = iv.lyricRows;
  eq(lr.length, 4, "歌词轨 4 行（与网格同档）");
  eq(lr[0].barTicks, 96, "★ 歌词行跨度 = 片 = 96t（不是整小节 192t）");
  ok(lr[0].chars.length === 1 && lr[0].chars[0].ch === "一", "A 段「一」落在第 1 行（前半）");
  ok(lr[1].chars.length === 1 && lr[1].chars[0].ch === "二", "★ A 段「二」落在第 2 行（同一小节的后半）");
  ok(lr[2].chars.length === 1 && lr[2].chars[0].ch === "三", "B 段「三」落在第 3 行（下一小节前半）");
  eq(lr[3].chars.length, 0, "B 段后半无字（数据如此）");
  eq(lr[1].chars[0].lt, 0, "「二」在它所在行的行内偏移为 0（重基到片起点——不是 96）");
}
