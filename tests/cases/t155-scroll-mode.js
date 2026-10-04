/* BeatSight 自动化测试 · 连续滚动模式（PLAN-v9，v3.0.0）
   T155 系列 —— 六场景：布局 / 时序 / 两播放模式 / 歌词 / 球 / loopRange 回卷。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html 内注释同源）：
     · S.scrollMode（默认 **关**）+ S.scrollRows（1|3，脏值回落 3）。
     · scroll 的窗口 = 以当前小节为中心的一段**连续节目单**：winStart = max(0, cur − floor(rows/2))，
       当前小节落在第 scrollCenter = cur − winStart 行（开头几小节被顶到上边界）。
       ★ winStart 恒**非负**：它是本模块多处"窗口未锚"哨兵（<0）的载体，scroll 下不能为负。
     · 建 **rows+1** 行（末行是进场行，垂直登场期间从裁剪区外滑入）；`#viz` 高度裁到 rows 行。
     · 行 i 横移 dx_i = C − left_i − clamp(p − off_i, 0, 1)·W（p = 小节内进度，off_i = i − center）：
       当前点恒在 C = 行宽一半；邻槽被 clamp 冻结在 ±W/2（上一小节露尾、下一小节露头）。
     · 垂直登场：最后一拍（p ∈ [0.75,1)）内整组 smooth 上移一行（rows=3 才有；rows=1 与演示一致不做）。
     · 一行恒等于**整小节**（vizRowBeats = vizSig），不进 chooseRowBeats。
     · scroll 无预告行 / 无尾迹 / 无待命球；歌词恒 follow 且随槽同组 (dx,dy) 平移。
   桩的几何：rowGeo[i].top = 58 + i×86（ROW_TOP0/ROW_H，跨用例累加故只断言**差值**），
   行宽 ROW_W = 600 ⇒ C = 300；vizRowBoxH = offsetHeight = 44。 */
"use strict";
const { loadApp, FakeAudioContext, driveFrames, drive, ok, eq, near, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 4 小节曲式（内置型 1 = 四分基础 4/4，1 遍 = 4 小节） */
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "滚动曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
]}) });
const seedState = extra => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 3, loop: true } }, extra));
const arrSeed = extra => Object.assign(seedArr(), { "beatsight.state": seedState(extra) });

const ROW_RE = /(^| )bar-row( |$)/;
const barRows = viz => viz.children.filter(c => ROW_RE.test(c.className));
/* translate(Xpx, Ypx) 解析（scroll 的行槽共用一条 transform） */
const dxOf = s => { const m = /translate\((-?[\d.]+)px,/.exec(s || ""); return m ? +m[1] : NaN; };
const dyOf = s => { const m = /,\s*(-?[\d.]+)px\)/.exec(s || ""); return m ? +m[1] : NaN; };
const headX = s => { const m = /translateX\((-?[\d.]+)px\)/.exec(s || ""); return m ? +m[1] : NaN; };
/* 期望的槽横移（与产品同一个公式，独立写一遍：错在实现里就会被这条抓住） */
const expDx = (C, left, W, p, off) => C - left - Math.min(1, Math.max(0, p - off)) * W;
const scrollOf = beat => beat.Viz.internals().scroll;

/* 把棋子的可听位置推到「第 k 小节内的 p 位置」：k 小节 = k 秒（240BPM/4-4），帧步 0.04s */
function seek(beat, ac, seconds, keepGoing){
  const n = Math.round(seconds / 0.04);
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.04;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (!keepGoing && !beat.Store.S.playing) break;
  }
}

/* =========================================================================== */
section("T155a 布局 · 默认分页 / scroll 行数与高度 / 播放头钉中央（rows=1 与 3 参数化）");
{
  /* —— 首断言：默认必须还是分页（PLAN §7 反向变异「默认 scrollMode 误设 true」） —— */
  const def = loadApp(arrSeed({}));
  eq(def.beat.Store.S.scrollMode, false, "★ 默认 scrollMode=false（老用户升级后仍是既有翻页口径）");
  eq(def.beat.Store.S.scrollRows, 3, "★ scrollRows 默认 3（脏值/未存一律回落 3）");
  ok(!def.els["viz"].className.includes("scroll-mode"), "★ 默认 #viz 不带 .scroll-mode");
  eq(def.beat.Viz.arrWinBars(), def.beat.Store.S.vizRows, "默认窗口长度 = 同屏行数档位（scroll 未接管）");
}
for (const rows of [1, 3]){
  /* —— 冷启动即 scroll：不做任何重建，首帧就断言（衔接 v2.87.0 启动顺序铁律 / T149j 同构） —— */
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: rows }));
  const int = beat.Viz.internals();
  const viz = els["viz"];
  eq(beat.Store.S.scrollRows, rows, `rows=${rows}：存档直读`);
  ok(viz.className.includes("scroll-mode"), `rows=${rows}：冷启动首帧 #viz 已带 .scroll-mode（无需重建）`);
  eq(beat.Viz.arrWinBars(), rows, `rows=${rows}：arrWinBars 由 scrollRows 接管`);
  /* ★ v3.0.0 批 6：rows=1 走**传送带**（用户拍板）——建 3 槽（上一/当前/下一，首尾相接）、
     中心行 = 1；rows=3 维持 rows+1（末行是进场行，D19）。 */
  const belt = rows === 1;
  const slotN = belt ? 3 : rows + 1;
  const centerN = belt ? 1 : Math.floor(rows / 2);
  eq(barRows(viz).length, slotN, `★ rows=${rows}：建 ${slotN} 槽（${belt ? "传送带：上一/当前/下一" : "末行是进场行，D19"}）`);
  eq(int.vizRowBeats, beat.Store.S.sig, `★ rows=${rows}：一行恒等于整小节（不进 chooseRowBeats）`);
  /* ★ v3.0.0 批 4：当前行**恒**在中央，起点因此允许为负。
     批 1–3 曾是"起点钳到 0、当前行在前几小节被顶到上边界"，那会多出一次垂直位移
     （用户实拍：「第一小节播完后先向上滚、又弹回来」）。 */
  eq(int.scroll.center, centerN, `★ rows=${rows}：当前行**恒**在中央（${belt ? "传送带取 1" : "floor(rows/2)"}），不随小节数漂移`);
  eq(int.scroll.winStart, 0 - centerN,
    `★ rows=${rows}：winStart = cur − center（**允许为负**——"未锚"已改由独立判据承担）`);
  /* 高度裁剪 = 首行顶 + (rows−1)×槽距 + 行盒高，与 slotH 同源不写死 */
  const r0 = int.rowGeo[0];
  eq(viz.style.height, Math.round(r0.top + (rows - 1) * int.scroll.slotH + 44) + "px",
    `★ rows=${rows}：#viz 高度裁到 ${rows} 行（进场行在裁剪区外）`);
  ok(!/^-\d/.test(viz.style.height), `rows=${rows}：高度为正数（不写死常量、不吃脏 slotH）`);
  /* ★★ 静止态（批 4 新增，问题 3 的回归钉）：**未播放**时行槽就必须已经摆好。
     批 1–3 只在帧内（paintFrameBody）写行槽 transform，于是切到连续滚动后、按下播放之前，
     画面还是旧模式那种"行从左侧铺满"的样子 —— 用户实报「刚开始的画面仍是旧样子，播放后才切换」。
     判据必须从 DOM 的 transform 读（读内部 dx 变量等于与实现共用同一个来源）。 */
  const half = int.rowGeo[0] ? int.rowGeo[0].width / 2 : 0;
  const dxs0 = int.rowEls.map(r => dxOf(r.style.transform));
  ok(half > 0 && dxs0.every(v => isFinite(v)),
    `rows=${rows}：★★ 未播放时每一行都已写过横移（不是等播放后才摆）`, "dx=" + JSON.stringify(dxs0));
  near(dxs0[int.scroll.center], half, 0.51,
    `rows=${rows}：★★ 未播放时**当前行**右移半行宽（当前点正落在行中央）`);
  ok(Math.abs(headX(int.ph.style.transform) - (int.rowGeo[int.scroll.center].left + half)) < 0.51,
    `rows=${rows}：★★ 未播放时播放头已在当前行中央`,
    "播放头 x=" + headX(int.ph.style.transform) + " / 期望 " + (int.rowGeo[int.scroll.center].left + half));
  if (rows > 1){
    ok(dxs0.some(v => Math.abs(v + half) < 0.51),
      `rows=${rows}：★ 未播放时上一槽冻结在左半屏（dx = −半行宽）`, "dx=" + JSON.stringify(dxs0));
  }
}

section("T155a2 播放中 · 播放头恒在行中央 + 行槽按 clamp 相位横移");
{
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3 }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const C = 300;                                         // ROW_W/2（桩行左缘恒 0）
  let headStable = true, sawPhase0 = false, sawPhase1 = false, maxDy = 0, dySame = true;
  const centerSeen = new Set();        // 问题 4 的回归钉：当前行**全程**不得漂移
  for (let i = 0; i < 120; i++){
    ac.currentTime += 0.04;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const int = beat.Viz.internals();
    const s = int.scroll;
    centerSeen.add(s.center);
    if (headX(int.ph.style.transform) !== C) headStable = false;
    /* ★ dy 必须从**真正写进 DOM 的 transform** 里读，不能读内部变量 s.dy——
       反向验证实测：读内部变量时，把行的 transform 写死成 0px 也照样全绿（断言与实现
       共用同一个来源 = 橡皮图章）。行槽的 dy 是整组统一值，逐行核对顺便守住这条不变量。 */
    const dys = int.rowEls.map(r => dyOf(r.style.transform));
    maxDy = Math.max(maxDy, Math.abs(dys[s.center]));
    if (dys.some(v => Math.abs(v - dys[0]) > 0.15)) dySame = false;
    /* 当前槽：dx 必须等于 C − left − p·W；反解出 p 并检查邻槽被 clamp 冻结 */
    const gc = int.rowGeo[s.center];
    const p = (C - gc.left - s.dx) / gc.width;
    if (p < 0.05) sawPhase0 = true;
    if (p > 0.95) sawPhase1 = true;
    for (let k = 0; k < int.rowEls.length; k++){
      const g = int.rowGeo[k];
      const want = expDx(C, g.left, g.width, Math.min(1, Math.max(0, p)), k - s.center);
      const got = dxOf(int.rowEls[k].style.transform);
      if (!(Math.abs(got - want) < 0.15)){
        ok(false, `第 ${i} 帧 行 ${k} 横移应 ${want.toFixed(1)} 实 ${got}（off=${k - s.center}, p=${p.toFixed(3)}）`);
        break;
      }
    }
  }
  ok(headStable, "★ 播放全程播放头恒在行中央（不再逐帧 translateX 扫过整行）");
  ok(sawPhase0 && sawPhase1, "★ 观察到 p 遍历 [0,1)：相位确实在小节内推进（不是钉死在某一格）");
  ok(maxDy > 1, `★ rows=3 有垂直登场：最后一拍内整组上移（从 DOM transform 读得最大 |dy| = ${maxDy.toFixed(1)}px）`);
  ok(dySame, "★ 整组行槽的 dy 完全一致（垂直登场是整组平移，不是逐行各挪各的）");
  eq([...centerSeen].join(","), "1",
    "★★ 当前行**全程恒为 1**（不随小节推进而漂移）——这是「第一小节播完后先上滚又弹回」的回归钉："
    + "批 1–3 起点钳到 0 时，cur=0 的 center 是 0、cur=1 才变 1，那一格跳动就表现为多余的来回");
  /* 尾迹在 scroll 下必须关（PLAN §7「尾迹 scroll 下未隐藏」） */
  eq(beat.Viz.internals().tg.style.display, "none", "★ scroll 下尾迹光晕关闭（它语义是「播放头身后的痕迹」，而 scroll 下头钉着不动）");
  eq(barRows(els.viz).length, 4, "播放中行数不变（仍 rows+1）");
}

section("T155b 时序 · 登场在一拍内完成、beat0 同帧复位（rows=1 传送带：无垂直登场 + 相位不 clamp）");
{
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 1 }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let maxDy = 0;
  /* 传送带判据：相邻槽的 dx 恒差一个行宽（首尾相接），且相位可越出 [0,1]
     （上一槽 phase>1、下一槽 phase<0 —— clamp 版本这两者会被钉在 1/0， dx 差不再是行宽） */
  let gapOk = true, sawOver = false, sawUnder = false;
  const C = 300;
  for (let i = 0; i < 80; i++){
    ac.currentTime += 0.04;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    maxDy = Math.max(maxDy, Math.abs(scrollOf(beat).dy));
    const int = beat.Viz.internals();
    const rows = int.rowEls.map(r => dxOf(r.style.transform));
    const W = int.rowGeo[0].width;
    for (let k = 1; k < rows.length; k++){
      if (rows[k] === null || rows[k-1] === null || Math.abs((rows[k] - rows[k-1]) - W) > 0.15) gapOk = false;
    }
    const gc = int.rowGeo[int.scroll.center];
    const pCur = (C - gc.left - int.scroll.dx) / gc.width;         // 当前行反解相位
    if (pCur - (0 - int.scroll.center) > 1.001) sawOver = true;    // 上一槽相位 >1（未被 clamp）
    if (pCur - (2 - int.scroll.center) < -0.001) sawUnder = true;  // 下一槽相位 <0
  }
  eq(maxDy, 0, "★ rows=1 不做垂直滚动（|dy| 恒 0，与演示一致）");
  eq(beat.Viz.internals().rowEls.length, 3, "★ rows=1 传送带建 3 槽（上一/当前/下一）");
  ok(gapOk, "★★ 传送带：相邻槽 dx 恒差一个行宽（首尾相接成一条线，不 clamp 就做不到）");
  ok(sawOver || sawUnder, "★ 相位越出 [0,1]（clamp 已去掉——这是传送带与旧「冻结邻槽」的本质区别）");
}
{
  /* dy 的"一节一拍内完成"用采样密度换证据：0.005s 步长下必须采到接近 −slotH 的极值 */
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3 }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let maxDy = 0, worst = 0;
  for (let i = 0; i < 1600; i++){
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const s = scrollOf(beat);
    maxDy = Math.max(maxDy, Math.abs(s.dy));
    /* 复位检查：小节刚换（p 很小）时 dy 必须已经归零 —— 否则小节接缝处会闪一帧错位 */
    const int = beat.Viz.internals();
    const gc = int.rowGeo[s.center];
    const p = (300 - gc.left - s.dx) / gc.width;
    if (p >= 0 && p < 0.02) worst = Math.max(worst, Math.abs(s.dy));
  }
  ok(maxDy > beat.Viz.internals().scroll.slotH * 0.9,
    `★ 登场位移达到一整个槽距（观测 ${maxDy.toFixed(1)} ≥ 0.9×${beat.Viz.internals().scroll.slotH}）`);
  ok(worst < 1, `★ beat0 处 dy 已同帧复位（p<0.02 时 |dy| 最大仅 ${worst.toFixed(2)}px，接缝无跳变）`);
  ok(beat.Viz.internals().scroll.slotH > 0, "槽距由相邻行矩形 top 差采集（非写死）");
}

section("T155c 两播放模式 · 预设模式 P=1 短型各槽同内容");
{
  /* 预设模式（内置默认型 = 1 小节）：P=1 < rows ⇒ 各槽都铺同一小节的内容 */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 240, scrollMode: true, scrollRows: 3 }) });
  eq(beat.Store.S.playMode, "preset", "预设模式装载");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1.5);
  const int = beat.Viz.internals();
  eq(barRows(els.viz).length, 4, "预设模式 scroll 同样建 rows+1 行");
  const p = beat.Viz;
  ok(p.arrWinBars() === 3, "预设模式 arrWinBars 同样由 scrollRows 接管");
  /* 每槽的格子数应完全相同（P=1 绕回铺满：各槽同内容） */
  const counts = int.cellEls.map(c => c.length);
  ok(counts.length === 4 && counts.every(n => n === counts[0] && n > 0),
    `★ 预设 P=1：各槽格子数一致（${counts.join("/")}）—— 绕回铺满而非空槽`);
  /* 两模式都不该出现预告行（PLAN §7「预告行 scroll 下未关」） */
  ok(!int.rowEls.some(r => r.classList.contains("preview-row")), "★ scroll 下无 .preview-row（预告行恒关）");
  eq(int.scroll.winPrevSeg, -1, "★ scroll 下 winPrevSeg 恒 −1");
}
{
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3 }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 2.2);
  const int = beat.Viz.internals();
  ok(int.scroll.cur >= 1, `曲式模式可听小节号随播放推进（cur=${int.scroll.cur}）`);
  ok(!int.rowEls.some(r => r.classList.contains("preview-row")), "★ 曲式 scroll 下同样无 .preview-row");
}

section("T155d 歌词 · scroll 下恒 follow 且随槽同组 (dx,dy)");
{
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true, lyricPos: "bottom" }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" }]);
  beat.Viz.buildViz();
  eq(beat.Viz.effectiveLyricPos(), "follow", "★ scroll 下 lyricPos 存档 bottom 也被强制为 follow（PLAN T155d）");
  const lane = els["lyricLane"];
  ok(lane.classList.contains("overlay"), "歌词轨切覆盖层定位");
  ok(lane.classList.contains("scroll-clip"), "★ 歌词覆盖层加 .scroll-clip（它是 #viz 的兄弟节点，不吃 #viz 的裁剪）");
  eq(lane.style.height, els["viz"].style.height, "★ 歌词轨裁剪高度与 #viz 同源（同一行数与槽距算出来的）");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1.2);
  const int = beat.Viz.internals();
  /* ★★ v3.33.2 口径变更（**这不是回归**）：原先这里写 3，注释是"不含裁剪区外的进场行"——
     那句话描述的是**当时的实现**，而不是需求：网格建的是 rows+1（多出的一行是 D19 的进场行，
     登场期间从裁剪区外滑进来），歌词轨却只照抄了传送带那一支、漏了多行的 +1。
     后果是那条滑进来的行**没有词**，等它滑到应到位置（成为第 3 槽）词才出现——用户实拍报障。
     现两轨行数**逐位同源**（`slotRowCount()` 单一来源，见 index.html 该函数注释），故改为 4。
     判据仍是"两轨行数相等"，只是那个相等的值跟着网格走（下一条断言直接钉相等，比写死数字稳）。 */
  eq(int.lyricRows.length, int.rowEls.length,
    "★★ 歌词行数 == 网格行数（含裁剪区外的进场行——它滑进来时就必须带着词）");
  eq(int.lyricRows.length, 4, "3 行档下两轨都是 4 个槽（rows+1 = 进场行）");
  /* 逐行核对：歌词行的 X 必须与同序号网格行的 X 完全一致（同一个 C/left/W/off） */
  for (let i = 0; i < int.lyricRows.length; i++){
    eq(dxOf(int.lyricRows[i].el.style.transform), dxOf(int.rowEls[i].style.transform),
      `★ 歌词行 ${i} 与网格行 ${i} 横移严格相同`);
    eq(dyOf(int.lyricRows[i].el.style.transform), int.lyricRows[i].y + int.scroll.dy,
      `★ 歌词行 ${i} 纵移 = 自身锚点 y + 本帧 dy（随强拍登场一起走）`);
  }
  ok(Math.abs(int.scroll.dy) >= 0, "dy 为有限数（歌词叠加不吃 NaN）");
}
{
  /* 切回分页：覆盖层类与裁剪高度都要撤干净，不能留下 scroll 的痕迹 */
  const { beat, els } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3 }));
  beat.Viz.buildViz();
  beat.Store.S.scrollMode = false;
  beat.Viz.reloadScroll();
  ok(!els["viz"].className.includes("scroll-mode"), "关 scroll 后 #viz 摘掉 .scroll-mode");
  eq(els["viz"].style.height, "", "★ 关 scroll 后 #viz 高度交还内容（裁剪不能留下）");
  eq(beat.Viz.arrWinBars(), beat.Store.S.vizRows, "关 scroll 后窗口长度回到同屏行数档位");
  eq(barRows(els.viz).length, beat.Store.S.vizRows, "★ 关 scroll 后行数回到 S.vizRows（无 rows+1 残留）");
}

section("T155e 球 · v3.1.3 起 scroll 全程无球（主球/影子/待命球）；切回分页复原");
{
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3 }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* ★ 逐帧断言"全程从未出现"，而不是只看末态：待命球的三个写点里，paintBall 接力段与
     预备拍段都只在**特定时机**写，只看末态会漏掉它们（反向验证实测：删掉任一门，末态仍是 none）。 */
  let seen = null;
  for (let i = 0; i < 200; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    /* ★ 判据必须用 `!== "none"`，不能写 `d &&`——待命球"显示"时 display 是空串 ""（falsy），
       写成 `d &&` 会把每一次显示都静默跳过，这条断言就废了（反向验证实测踩到）。 */
    const d = beat.Viz.internals().waitEl.style.display;
    if (d != null && d !== "none"){ seen = { frame: i, v: d }; break; }
  }
  eq(seen, null, "★ scroll 下待命球**全程**不出现（逐帧检查，非只看末态）");
  const int = beat.Viz.internals();
  eq(int.waitEl.style.display, "none", "★ scroll 下待命球隐藏（整个模式不画）");
  /* v3.1.3（用户拍板）：主球与影子同样**全程不画**——滚动模式的落点感由播放头 +
     内容滚动 + 声音承担，球没有可靠的落点参照。逐帧口径同待命球（隐藏写点每帧发生）。 */
  let ballSeen = null;
  drive(ac, beat, 1.0, () => {
    beat.Viz.paintFrame();
    const iv2 = beat.Viz.internals();
    const d = iv2.ballEl.style.display, sd = iv2.shadowEl.style.display;
    if (ballSeen === null && (d !== "none" || sd !== "none")) ballSeen = { d, sd };
  });
  eq(ballSeen, null, "★ scroll 播放中主球与影子**全程**不出现（逐帧检查，非只看末态）");
  eq(beat.Viz.internals().tg.style.display, "none", "尾迹同样关闭");
}
{
  /* ★ 预备拍是待命球的**唯一天然出场窗口**（也是它第三个写点所在），单独覆盖一遍：
     漏掉那条守卫时，scroll + 预备拍下它会照常亮起来（反向验证实测结论）。 */
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, countIn: { on: true, beats: 4 } }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let seen = null, frames = 0;
  for (let i = 0; i < 600; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    frames++;
    const d = beat.Viz.internals().waitEl.style.display;
    if (d != null && d !== "none"){ seen = { frame: i, v: d }; break; }
    if (!beat.Store.S.playing) break;
  }
  ok(frames > 100, `预备拍窗口确实跑到了（${frames} 帧）`);
  eq(seen, null, "★ scroll 下预备拍的最后一拍也不放待命球（写点第三处已开守卫）");
}
{
  /* 切回分页 → 待命球机制复原（不是在 scroll 里把它永久关掉） */
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3 }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 0.4);
  beat.Store.S.scrollMode = false;
  beat.Viz.reloadScroll();
  driveFrames(ac, beat, 1.6);
  ok(beat.Viz.internals().tg.style.display !== "none", "★ 切回分页后尾迹恢复（display 不再是 none）");
}

section("T155f 节目单回卷 · 范围末的下槽 = 范围起点（按范围取模，非位置式 +1）");
{
  /* 用一个**每小节内容都不同**的四小节型当载体，才能从画面上区分"槽里到底是第几小节"。
     区分手段选 rest 标记（每小节 rest 的步数不同）：同一型内容完全相同的话，
     "回卷"与"位置式 +1"在 DOM 上一模一样，断言就是橡皮图章。 */
  const res = [4, 1, 0, 3].map(n => [0, 1, 2, 3].map(k =>
    k < n ? { t: 48, rest: true } : { t: 48 }));           // bar0 全休 / bar1 1 休 / bar2 无休 / bar3 3 休
  /* 预设模式的 loopRange 是同一件事的更直接载体：它同样"管一个型内部的小节范围"，
     且不必和曲式的加载迁移（v:2 线性小节号）缠在一起。 */
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 240,
    scrollMode: true, scrollRows: 3, loopRange: { on: true, from: 0, to: 1 } }) });
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四小节", meter: 4, bars: res }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  eq(beat.Store.S.loopRange.on, true, "前置：指定小节循环开着");
  eq(beat.Store.S.loopRange.to, 1, "前置：循环范围压到 [0,1]（前两小节）");
  beat.Viz.resetWindow();
  beat.Viz.buildViz();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1.3);                              // 240BPM ⇒ 落在第 1 小节内
  const int = beat.Viz.internals();
  const s = int.scroll;
  eq(s.cur, 1, "前置：可听位置已在范围末（第 1 小节）");
  ok(int.rowEls.length === 4, "前置：rows=3 ⇒ 4 个槽");
  /* 每行 rest 格数（可区分小节）；范围内 [0,1] 回卷 ⇒ 期望 [bar0, bar1, bar0, bar1] = [4,1,4,1] */
  const restCount = int.cellEls.map(cs => cs.filter(c => /(^| )rest( |$)/.test(c.className)).length);
  eq(restCount.join(","), "4,1,4,1",
    "★ 四槽内容 = [第0, 第1, 第0, 第1]：末两槽按**范围长度**回卷到范围起点"
    + "（位置式 +1 会得到 [4,1,0,3] ⇒ 把第 2、3 小节提前画出来了，而实际播放会回卷）");
  eq(s.winStart, s.cur - s.center, "winStart 恒 = cur − center（窗口起点与当前行同一套口径）");
}
{
  /* 反面对照：范围 = 全曲（loop 关）时**不**回卷，末槽就该是范围外的下一小节 */
  const res = [4, 1, 0, 3].map(n => [0, 1, 2, 3].map(k =>
    k < n ? { t: 48, rest: true } : { t: 48 }));
  const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 240,
    scrollMode: true, scrollRows: 3, loopRange: { on: true, from: 0, to: 1 } }) });
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四小节", meter: 4, bars: res }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Store.S.loopRange.on = false;                       // ★ 唯一变量：循环关掉
  beat.Viz.resetWindow();
  beat.Viz.buildViz();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1.3);
  const int = beat.Viz.internals();
  const restCount = int.cellEls.map(cs => cs.filter(c => /(^| )rest( |$)/.test(c.className)).length);
  eq(restCount.join(","), "4,1,0,3",
    "★ 对照：loop 关 ⇒ 不按范围回卷，四槽 = 连续的 [第0,第1,第2,第3]（与调度侧同一判据）");
}
