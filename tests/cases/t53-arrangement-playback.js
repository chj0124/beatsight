/* BeatSight 自动化测试 · 曲式播放集成（v2.0.0 S4）
   T53 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本组守的是 S3 那三个纯函数**接进播放之后**的行为——纯函数对不等于播出来对。

   刻意用 240 BPM：一小节 = 4 拍 × 0.25s = 1s，于是"段边界"就落在整秒上，
   驱动多少秒 = 走了多少小节，断言读起来不用换算。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const A = (name, sections) => ({ name, sections });
/* 一条 4/4 自定义节奏型：每小节 = [16 分, 8 分, 8 分, 附点 4 分]，音符起始位置 cum = {0, 24, 72, 120}。
   与四分基础（idx 1，cum = {0, 48, 96, 144}）只在 0 处重合——这样"预测用的是哪个型的音符位置"
   才能看出来（用它当第 2 块，跨块后预测不该出现 48/96 这些只属于旧型的位置） */
const OFFBEAT = { name: "细分型", meter: 4,
  bars: [0, 1, 2, 3].map(() => [{ t: 24 }, { t: 48 }, { t: 48 }, { t: 72 }]) };

/* 搭一个曲式 → 进入曲式模式 → 开始播放。返回 { app, beat, els, ac } */
function startArrange(raw, sel){
  const app = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1,
    arranges: [Object.assign({ id: "t1" }, raw)] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
      arrangeSel: Object.assign({ id: "t1", from: 0, to: 0, loop: false }, sel) }) });
  app.beat.Controls.start();
  return { app, beat: app.beat, els: app.els, ac: FakeAudioContext.last };
}

/* ================= 场景 T53：跨段切换 ================= */
section("T53 曲式播放 · 跨段换型（无缝 / schedBar 归零 / 不跳针）");
{
  /* 两段各 4 小节：A = 民谣扫弦（6 颗/小节），B = 八分摇滚（8 颗/小节） */
  const two = A("两段", [
    { name: "A", blocks: [BL(0, 1)] },
    { name: "B", blocks: [BL(2, 1)] },
  ]);
  const { beat, ac } = startArrange(two, { from: 0, to: 1 });
  const S = beat.Store.S;
  eq(beat.arrangeState().mode, "arrange", "进入曲式模式");
  eq(JSON.stringify([beat.arrangeState().sec, beat.arrangeState().bar]), JSON.stringify([0, 0]),
     "★ 起点 = 范围首段的第 0 小节（不是沿用一个没初始化的游标）");
  eq(beat.activePattern().name, beat.BUILTINS[0].name, "起点播的是第 1 段的型");
  eq(beat.clock().schedBar, 0, "型内游标从 0 起");

  /* 走 4.2s = 越过第 4/5 小节之间的段边界（240BPM：1 小节 = 1s） */
  drive(ac, beat, 4.2);
  eq(S.playing, true, "跨段不中断播放");
  eq(JSON.stringify([beat.arrangeState().sec, beat.arrangeState().bar]), JSON.stringify([1, 0]),
     "★ 第 4 小节走完 → 第 2 段第 0 小节");
  eq(beat.activePattern().name, beat.BUILTINS[2].name, "★ 换成了第 2 段的型（不是沿用第 1 段）");
  eq(beat.clock().schedBar, 0, "★ 换块后型内游标归零（新块从它自己的第 0 小节开始）");
  const buf = beat.onsetBuf();
  ok(buf.every((e, i) => i === 0 || e.t > buf[i - 1].t), "★ 跨段后端点时刻仍严格递增（没跳针、没排到过去）");
  /* 不要用"所有 hit 都 >= 当前 loopStart"来判"不排到过去"：loopStart 每次换块都会
     重映射到当前小节，早期小节的声音当然早于它——那条断言本身就是错的。
     "不排到过去"由上面的"端点严格递增"守住（与 T21/T22 同一套判据） */
  ok(!!beat.onsetNext(), "★ 跨段后弹跳球仍有下一跳（球在段边界不停住）");
  beat.Controls.stop();
}

/* ================= 场景 T53b：弹跳球预测走 arrNextBar ================= */
section("T53b 曲式播放 · 落点预测走节目单（新块的第 1 拍是休止时）");
{
  /* 自定义预设必须与曲式在**同一个沙箱实例**里——建在另一个实例里的话，
     这条曲式里的引用是死的（引到一个不存在的 id），测的就不是想测的东西了 */
  const app2 = loadApp({
    "beatsight.customs": JSON.stringify({ v: 1, customs: [Object.assign({ id: "cx" }, OFFBEAT)] }),
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "t2", name: "跨块",
      sections: [{ name: "s", blocks: [BL(1, 1), { ref: { type: "custom", id: "cx" }, repeats: 1 }] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
      arrangeSel: { id: "t2", from: 0, to: 0, loop: false } }) });
  const b2 = app2.beat;
  eq(b2.Store.customs.length, 1, "自定义预设已就位（引用不是死的）");
  eq(JSON.stringify(b2.arrangeProblems(b2.Store.arranges[0])), "[]", "这条曲式没有问题");
  eq(JSON.stringify(b2.Store.arranges[0].sections[0].blocks[0].ref), JSON.stringify({ type: "builtin", idx: 1 }),
     "第 1 块是四分基础（与第 2 块的音符位置集合只在 0 处重合）");
  b2.Controls.start();
  /* ★ FakeAudioContext.last 是跨实例保留的静态值，**必须在 start() 之后取**——
     在 start 之前取会拿到上一个用例遗留的旧上下文，于是驱动的是别人的时钟、
     本例的状态一动不动（断言会以为"游标没推进"，是假象） */
  const ac2 = FakeAudioContext.last;
  /* 两块各 4 小节：第 4/5 小节之间是块边界。走 4.2s 越过去 */
  drive(ac2, b2, 4.2);
  eq(b2.Store.S.playing, true, "跨块不中断播放");
  eq(b2.arrangeState().bar, 4, "已在第 2 块（段内第 4 小节）");
  eq(b2.arrangeState().blockIdx, 1, "块游标也换了");
  const nx = b2.onsetNext();
  ok(!!nx, "跨块后有预测落点");
  eq(nx && nx.bar, 0, "预测落点标的是新块的行号");
  /* 落点必须落在**新块**的音符位置集合 {0,24,72,120} 里；48/96/144 只属于第 1 块（四分基础）。
     注意别写死"等于某一个 cum"：预测的是"下一颗还没排进缓冲的"，具体是哪一颗取决于
     采样时刻（已排进缓冲的那几颗不算），写死就会因为时序而误判。 */
  ok([0, 24, 72, 120].includes(nx && nx.cumT),
     "★ 预测的落点用的是第 2 块的音符位置（实际 cum " + (nx && nx.cumT) + "；48/96/144 只属于第 1 块）");
  ok(![48, 96, 144].includes(nx && nx.cumT), "★ 且没有误用第 1 块的音符位置");
  b2.Controls.stop();
}

/* ================= 场景 T53c：范围、循环与停止 ================= */
section("T53c 曲式播放 · 整首放完停止 / 范围循环 / 单段循环");
{
  const two = A("两段", [
    { name: "A", blocks: [BL(0, 1)] },
    { name: "B", blocks: [BL(2, 1)] },
  ]);
  /* 不循环 → 8 小节（8s）后停止 */
  const a1 = startArrange(two, { from: 0, to: 1, loop: false });
  drive(a1.ac, a1.beat, 8.6);
  eq(a1.beat.Store.S.playing, false, "★ 走完范围末尾且不循环 → 停止");
  eq(a1.els["statusText"].textContent, "曲式播放完毕", "状态说明是「曲式播放完毕」（不是笼统的「已停止」）");
  ok(a1.beat.Store.logSessions.length === 0, "曲式播放不足 30s 不记练习（既有口径不变）");

  /* 循环 → 回到第 1 段继续播 */
  const a2 = startArrange(two, { from: 0, to: 1, loop: true });
  drive(a2.ac, a2.beat, 8.6);
  eq(a2.beat.Store.S.playing, true, "★ 循环时走完范围继续播（不停止）");
  eq(beat_sec(a2), 0, "回绕到第 1 段");
  a2.beat.Controls.stop();

  /* 单段循环（只练副歌） */
  const a3 = startArrange(two, { from: 1, to: 1, loop: true });
  eq(JSON.stringify([a3.beat.arrangeState().sec, a3.beat.arrangeState().bar]), JSON.stringify([1, 0]),
     "起点就是范围首段（第 2 段）");
  eq(a3.beat.activePattern().name, a3.beat.BUILTINS[2].name, "起点播第 2 段的型");
  drive(a3.ac, a3.beat, 8.6);
  eq(a3.beat.Store.S.playing, true, "单段循环不会停");
  eq(beat_sec(a3), 1, "★ 始终停在第 2 段（只练副歌）");
  a3.beat.Controls.stop();
}
function beat_sec(h){ return h.beat.arrangeState().sec; }

/* ================= 场景 T53d：播放中改范围 = 跳段 ================= */
section("T53d 曲式播放 · 播放中改范围（跳段在小节边界生效）");
{
  const two = A("两段", [
    { name: "A", blocks: [BL(0, 1)] },
    { name: "B", blocks: [BL(2, 1)] },
  ]);
  const { beat, ac } = startArrange(two, { from: 0, to: 1, loop: true });
  drive(ac, beat, 1.2);                      // 第 1 段第 1 小节
  eq(beat_sec({ beat }), 0, "改动前在第 1 段");
  /* 把范围改成"只播第 2 段"——这就是跳段用的机制：
     下一小节边界上 arrNextBar 发现当前位置在范围之前，会拉回 from 并归零小节 */
  beat.Store.S.arrangeSel = { id: "t1", from: 1, to: 1, loop: true };
  drive(ac, beat, 1.1);                      // 越过下一个小节边界
  eq(beat.Store.S.playing, true, "跳段不中断播放");
  eq(beat_sec({ beat }), 1, "★ 下一个小节边界后已在第 2 段（跳段生效，不需要相位换算）");
  eq(beat.arrangeState().bar, 0, "跳过去时小节归零");
  eq(beat.activePattern().name, beat.BUILTINS[2].name, "换成了第 2 段的型");
  /* ★ 型内游标也必须由节目单决定（不能沿用上一个块里递增出来的值）：
     跳段前在第 1 段第 1 小节，仅靠 (schedBar+1)%4 会得到 2，而新块的第 0 小节才是正确的落点 */
  eq(beat.clock().schedBar, 0, "★ 跳段后型内游标归零（不是沿用上一段递增出来的 2）");
  beat.Controls.stop();
}

/* ================= 场景 T53e：与练习量、变速训练器的叠加 ================= */
section("T53e 曲式播放 · 练习量按小节照常累计 / 曲式模式不记入预设路径");
{
  const two = A("两段", [
    { name: "A", blocks: [BL(0, 1)] },
    { name: "B", blocks: [BL(2, 1)] },
  ]);
  const { app, beat, ac } = startArrange(two, { from: 0, to: 1, loop: true });
  beat.Store.S.limit = { mode: "bars", n: 6 };     // 240BPM：6 小节 = 6s
  drive(ac, beat, 2.5);
  eq(beat.limitState().bars, 2, "练习量按小节累计（与曲式无关，既有口径不变）");
  drive(ac, beat, 4.0);                            // 越过 6 小节
  eq(beat.Store.S.playing, false, "★ 练满 6 小节 → 停止（练习量优先于「曲式还没放完」）");
  ok(app.els["statusText"].textContent.includes("已练满"),
     "停止原因是练习量（实际「" + app.els["statusText"].textContent + "」）");
  ok(!app.els["statusText"].textContent.includes("曲式播放完毕"), "不会误报成曲式放完");

  /* 曲式模式下的播放不应把"当前预设"改掉（S.sel 是独立的） */
  const before = JSON.stringify(beat.Store.S.sel);
  const { beat: b2, ac: ac2 } = startArrange(two, { from: 0, to: 1, loop: true });
  drive(ac2, b2, 4.5);
  eq(JSON.stringify(b2.Store.S.sel), before, "★ 曲式播放不改动 S.sel（换的是 appliedPat，不是用户的选择）");
  b2.Controls.stop();
}

/* ================= 场景 T53g：全休止的块 —— 预测必须能跨过去 ================= */
section("T53g 曲式播放 · 中间夹一个全休止的块（预测与待命球都要能跨过去）");
{
  /* 整小节休止的型：每小节一颗 192t 的休止符（合法时值），整块没有一颗发声点。
     它对应真实场景里的"间奏休止 / 静音数拍"。 */
  const ALLREST = { id: "rx", name: "全休止", meter: 4,
    bars: [0, 1, 2, 3].map(() => [{ rest: true, t: 192 }]) };
  const app = loadApp({
    "beatsight.customs": JSON.stringify({ v: 1, customs: [ALLREST] }),
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "t3", name: "夹休止",
      sections: [{ name: "s", blocks: [
        BL(1, 1),                                          // 0–3 小节：四分基础
        { ref: { type: "custom", id: "rx" }, repeats: 1 },  // 4–7 小节：全休止
        BL(2, 1),                                          // 8–11 小节：八分摇滚
      ] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
      arrangeSel: { id: "t3", from: 0, to: 0, loop: false } }) });
  const b = app.beat;
  b.Controls.start();
  const ac = FakeAudioContext.last;                        // ★ 必须在 start() 之后取

  /* 在第 1 块的最后一小节（3.5s）看"下一行"：应该是全休止那个块，而不是第 1 块自己的第 0 小节 */
  drive(ac, b, 3.5);
  eq(b.arrangeState().bar, 3, "现在在第 1 块的最后一小节");
  const row = b.arrangeNextRow();
  ok(!!row, "有下一行");
  eq(row && row.pattern.name, "全休止",
     "★ 待命球的下一行是**全休止块**（不是第 1 块自己的第 0 小节）——走的是 arrNextBar");
  eq(row && row.bar, 0, "且从新块的第 0 小节开始");
  /* ⚠ 上面断的是 arrangeNextRow **这个契约**，不是"paintBall 真的用了它"。
     后者改的是渲染层（待命球的落点），自动化断言覆盖不到——按 T22 的既有先例
     （"paintBall 的抛物线/挤压拉伸是纯函数映射，由人工截图验收"），
     这一处列入 S5 的人工验收清单：块边界时待命球应停在**新块**首颗音的位置。 */

  /* 开进全休止块（4–7 小节）：整块没有发声点，但预测必须能跨到再下一块（否则球在休止块里停住）。
     不断言"具体第几小节"——那取决于帧与边界的对齐，写死会因时序而误判 */
  drive(ac, b, 1.5);
  const barNow = b.arrangeState().bar;
  ok(barNow >= 4 && barNow <= 7, `已进入全休止块（当前段内第 ${barNow} 小节，全休止占 4–7）`);
  eq(b.activePattern().name, "全休止", "当前播的是全休止型");
  const nx = b.onsetNext();
  ok(!!nx,
     "★ 全休止块里弹跳球仍有下一跳（预测跨到了再下一块，不是被困在 4 小节里）");
  ok(nx && nx.t > ac.currentTime, "预测落点在未来");
  b.Controls.stop();
}

/* ================= 场景 T53f：曲式失效时退回预设模式 ================= */
section("T53f 曲式播放 · 曲式被删 / 引用失效时退回预设模式，不留下半状态");
{
  const two = A("两段", [{ name: "A", blocks: [BL(0, 1)] }]);
  /* playMode=arrange 但指向一个不存在的 id → S2 的加载校验已把它退回 preset；
     这里再验一次"运行时"：直接把 playMode 设成 arrange 并 start，必须被 arrangeStart 拉回来 */
  const { beat } = startArrange(two, { from: 0, to: 0, loop: false });
  beat.Controls.stop();
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "已被删掉", from: 0, to: 3, loop: true };
  beat.Controls.start();
  eq(beat.Store.S.playMode, "preset", "★ 曲式不存在 → 退回预设模式（不留下「在曲式模式但没曲式」的半状态）");
  eq(beat.Store.S.arrangeSel.id, "", "并清空选择");
  ok(!!beat.activePattern(), "仍能正常发声（回退到当前选中的预设 / 基础节奏）");
  beat.Controls.stop();
}

/* ================= 场景 T53h：时值可视化渲染的是曲式的型 ================= */
section("T53h 曲式播放 · viz 网格 = 曲式的型，不是选中预设（v2.0.2 回归）");
{
  /* 用户实拍 bug：曲式播放时网格仍是「当前选中的预设」，球按曲式的落点跳 → 音画错位。
     根因：buildViz 用了 curPattern() 而非 activePattern()。用「选中预设 ≠ 曲式首块的型」
     的场景钉死它：默认选中民谣扫弦（6 格/行），曲式首块是四分基础（4 格/行）——
     渲染错了立刻能数出来 */
  const one = A("一段", [{ name: "A", blocks: [BL(1, 1)] }]);
  const { beat, els, ac } = startArrange(one, { from: 0, to: 0 });
  const countCells = row => row.children.filter(c => /(^| )cell( |$)/.test(c.className)).length;
  eq(beat.curPattern().name, beat.BUILTINS[0].name, "前提：当前选中民谣扫弦（与曲式的型不同）");
  eq(countCells(els["viz"].children[0]), beat.BUILTINS[1].bars[0].length,
     "★ 网格 = 曲式首块的型（四分基础 4 格），不是选中预设（6 格）");
  drive(ac, beat, 1.2);
  eq(countCells(els["viz"].children[0]), beat.BUILTINS[1].bars[0].length,
     "播放中越过小节边界后网格仍是曲式的型");
  beat.Controls.stop();
}

/* ================= 场景 T53i：往回跳段下一个小节边界即生效 ================= */
section("T53i 曲式播放 · 「◀ 上一段」下一边界即生效（v2.0.2 回归）");
{
  /* 用户实拍 bug：播放中点「上一段」毫无反应——arrNextBar 只拉回 s < from，
     从不处理 s > to，要等当前段整段播完才绕回 */
  const two = A("两段", [
    { name: "A", blocks: [BL(0, 2)] },   // 8 小节
    { name: "B", blocks: [BL(2, 2)] },   // 8 小节
  ]);
  const { beat, els, ac } = startArrange(two, { from: 0, to: 1 });
  drive(ac, beat, 9.2);                  // 240BPM：1 小节 = 1s → 第 2 段第 1 小节
  eq(beat.arrangeState().sec, 1, "前提：已在第 2 段");
  els["argJumpPrev"].fire("click");
  drive(ac, beat, 1.2);                  // 过一个小节边界
  eq(JSON.stringify([beat.arrangeState().sec, beat.arrangeState().bar]), JSON.stringify([0, 0]),
     "★ 下一边界即回到第 1 段第 0 小节（不再等第 2 段播完）");
  beat.Controls.stop();
}

/* ================= 场景 T53j：曲式拍号 ≠ 当前拍号时对齐 ================= */
section("T53j 曲式播放 · 曲式拍号（6/8）≠ 当前拍号时同步 S.sig（v2.0.2 回归）");
{
  /* 曲式整首同拍号，但可能与当前 S.sig 不同；不同步的话 vizSig / loopStart 重映射 /
     predictNextArrange 的 barDur 全按错的拍号算——球与播放头错位的另一半根因 */
  const sway = A("摇曳曲", [{ name: "A", blocks: [BL(7, 1)] }]);   // 摇曳 6/8
  const { beat, els, ac } = startArrange(sway, { from: 0, to: 0, loop: true });
  eq(beat.Store.S.sig, 6, "★ 进入曲式播放时 S.sig 切到曲式拍号（6/8）");
  ok((els["vizTitle"].textContent || "").includes("6/8"), "viz 标题跟着变 6/8");
  drive(ac, beat, 1.0);
  ok(beat.Store.S.playing, "6/8 曲式正常播放不中断");
  beat.Controls.stop();
}

/* ================= 场景 T53k：待命球按可听位置选行 ================= */
section("T53k 曲式播放 · 待命球目标行按可听位置算（v2.0.2 回归）");
{
  /* 用户实拍 bug（截图）：当前小节（第 4 行）末尾的终端弧上，待命球指向第 2 行而不是
     回卷的第 1 行。根因：待命球用调度游标 arrSec/arrBar 选行，而调度游标比声音**早一个
     前瞻窗口**——终端弧的最后 ~150ms 里它已进到下一小节，arrangeNextRow 指到再下一行。
     修复：onset 携带入缓冲时的节目单位置（aSec/aBar），待命球按最后落地端点（=可听位置）算。
     场景：单段两块（各 1 遍），可听走到第 4 小节（bar 3）末尾时，调度游标已进入第 5 小节——
     待命球必须指向 bar 0（第 5 小节 = 块 1 的第 0 行），而不是 bar 1 */
  const one = A("单段两块", [{ name: "A", blocks: [BL(1, 1), BL(2, 1)] }]);
  const { beat, ac } = startArrange(one, { from: 0, to: 0, loop: true });
  /* internals() 每轮重取：块边界调度时 buildViz 会重建球元素，缓存的引用会脱节 */
  let caught = null;
  for (let i = 0; i < 600 && !caught; i++){
    ac.currentTime += 0.02;
    beat.Audio.scheduler();
    beat.Viz.paintFrame();
    const iv = beat.Viz.internals();
    const buf = beat.onsetBuf();
    let aud = null;
    for (const e of buf){ if (e.t <= ac.currentTime) aud = e; else break; }
    if (!aud || aud.bar !== 3) continue;                       // 可听位置：第 4 行
    if (beat.arrangeState().bar === 3) continue;               // 调度游标必须已先行过界
    if (iv.waitEl.style.display === "none") continue;          // 待命球在跳（终端弧）
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(iv.waitEl.style.transform);
    if (m) caught = { y: +m[2], g0: iv.rowGeo[0].top - 20, g1: iv.rowGeo[1].top - 20 };
  }
  ok(!!caught, "捕捉到「可听 bar 3 末尾 + 调度游标已过界 + 待命球可见」的窗口");
  if (caught)
    ok(Math.abs(caught.y - caught.g0) < Math.abs(caught.y - caught.g1),
       `★ 待命球跳向第 1 行（y=${caught.y}，地线 ${caught.g0}），不是第 2 行（地线 ${caught.g1}）`);
  beat.Controls.stop();
}

/* ================= 场景 T53l：曲式引用的型已消失（v2.0.2 审计 D2） ================= */
section("T53l 曲式播放 · 引用的自定义型被删后仍在曲式里 → 退回预设且可见告知（v2.0.2 回归）");
{
  /* 与 T53f 不同：T53f 是"整首曲式被删"（arrangeCur 找不到），本用例是"曲式还在、
     但它引用的自定义预设没了"。结构校验（normArrange）拦不住这种——id 非空、类型合法，
     只有解析（resolveRef）才知道型不见了。这正是 D2 要消灭的静默降级：v2.0.2 之前
     用户按下播放，播出来是别的型，却没有任何提示（"我选的曲式，播的却是别的"）。 */
  const ghost = { ref: { type: "custom", id: "ghost" }, repeats: 1 };
  const bad = A("坏引用", [
    { name: "A", blocks: [ghost] },
    { name: "B", blocks: [ghost] },
  ]);
  const { beat, els } = startArrange(bad, { from: 0, to: 1 });

  eq(JSON.stringify(beat.Store.arranges[0].sections[0].blocks[0].ref),
     JSON.stringify({ type: "custom", id: "ghost" }),
     "前提：坏引用通过了结构校验、确实进了内存（结构层拦不住「型不存在」）");
  eq(beat.Store.S.playMode, "preset", "★ 播放前重判发现坏引用 → 退回预设模式（不再按坏曲式硬播）");
  eq(beat.Store.S.playing, true, "退回预设**不中断播放**（用户按的是播放，静音比换型更意外）");
  eq(beat.Store.S.arrangeSel.id, "", "退回时清空 arrangeSel（不留下指向坏曲式的半状态）");
  ok(!!beat.activePattern(), "仍能正常发声（回退到当前预设 / 基础节奏）");

  eq(els["modalMask"].hidden, false, "★ 可见告知——不再静默降级");
  const msg = els["modalMsg"].textContent;
  ok(msg.indexOf("暂时不能播放") >= 0, "文案点明这首曲式不能播放：" + msg);
  ok(msg.indexOf("第 1 段第 1 块") >= 0 && msg.indexOf("第 2 段第 1 块") >= 0,
     "★ 问题清单逐条列出（两段的坏引用都在，不是只报第一条）：" + msg);
  ok(msg.indexOf("引用的节奏型不存在") >= 0, "点明根因是引用不存在（用户知道该去补哪个预设）");
  beat.Controls.stop();
}
