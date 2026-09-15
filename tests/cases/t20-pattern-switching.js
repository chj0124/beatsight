/* BeatSight 自动化测试 · 节奏型切换：点下即生效 / 全组合不变量扫描 / 弹跳球 onset 表
   T20–T22。切换语义与可视化数据的交叉验证。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

/* ================= 场景 T20：播放中切换节奏型 · 点下即生效（v1.1.1） ================= */
section("T20 播放中切节奏型 · 点下即生效（不再等小节边界）+ 不跳针 + 停止无残留");
{
  /* 用户实拍 bug：播放三连音基础时点「四分基础」，第 1 小节仍走三连音，要等小节边界才换。
     根因：refreshAfterPatternChange 在播放中一律挂起到小节边界。
     v1.1.1 改为 Audio.resyncToNow() 就地接续：不动时间轴，只把「已走过的 tick」在新节奏型里
     重新定位到第一个可接的音符起点。 */
  const { beat, els, sandbox } = loadApp();
  const S = beat.Store.S;
  const statusEl = sandbox.document.getElementById("statusText");
  S.sel = { type: "builtin", idx: 8 };              // 三连音基础：12 × 16t = 一小节
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1.2);                             // 96BPM 4/4 → 一小节 2.5s，此刻仍在第 1 小节内
  const tClick = ac.currentTime;
  const nBefore = ac.hits.length;
  eq(els["patternName"].textContent, "三连音基础", "开播时标题为三连音基础");

  S.sel = { type: "builtin", idx: 1 };              // 四分基础（同为 4/4）
  beat.Presets.refreshAfterPatternChange();

  /* 核心断言：不等小节边界，点完标题就换 */
  eq(els["patternName"].textContent, "四分基础", "点下立刻换型（标题即变，不再等小节边界）");
  eq(beat.activePattern().meter, 4, "发声快照同步切到新节奏型");
  eq(beat.Presets.consumePending(1).applied, false, "立即生效路径不留挂起");

  drive(ac, beat, 3.2);
  const hits = ac.hits.slice(nBefore);
  ok(hits.length >= 4, "切换后持续发声（实测 " + hits.length + " 颗）");
  ok(hits.every(h => h.t >= tClick), "新音符不排在过去（无时间倒流、不重现已走过的部分）");
  const gaps = hits.slice(1).map((h, i) => +(h.t - hits[i].t).toFixed(4));
  ok(gaps.length > 0 && gaps.every(g => g === 0.625), "切换后全是四分密度（0.625s/颗，实际 " + gaps.slice(0, 4).join(",") + "）");
  ok(S.playing, "播放未中断");

  /* 不跳针（幂等）：中途重复点同一个节奏型，跨点击的整段音轨间隔必须恒为规整四分。
     这比「数条数」硬——窗口相位不同条数本来就会差 1，但只要有漏音、重音或相位跳动，
     间隔里必然出现 1.25s（漏一颗）或 0（重一颗） */
  const nAll = ac.hits.length;
  drive(ac, beat, 1.2);
  const preClick = ac.hits.slice(nAll).map(h => h.t);
  beat.Presets.refreshAfterPatternChange();         // 重复点当前节奏型：应完全无副作用
  drive(ac, beat, 1.2);
  const all = ac.hits.slice(nAll).map(h => h.t);
  const allGaps = all.slice(1).map((t, i) => +(t - all[i]).toFixed(4));
  ok(preClick.length >= 1, "点击前已有音符可对照（实测 " + preClick.length + " 颗）");
  ok(allGaps.length > 0 && allGaps.every(g => g === 0.625),
     "跨重复点击整段间隔恒为四分（无跳针/漏音/重音，实际 " + allGaps.slice(0, 5).join(",") + "）");
  ok(!statusEl.textContent.includes("第 5 小节"), "读数未脱轨");

  /* 停止兜底：切换后立刻停止，标题必须与选中节奏型一致（半切换残留回归） */
  S.sel = { type: "builtin", idx: 2 };              // 八分摇滚
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.stop();
  eq(els["patternName"].textContent, beat.curPattern().name, "停止后标题与选中节奏型一致（无半切换残留）");
  eq(beat.activePattern().name, beat.curPattern().name, "停止后发声快照与选中节奏型一致");
}

/* ================= 场景 T21：全组合切换不变量扫描（v1.1.1） ================= */
section("T21 播放中切节奏型 · 全组合不变量扫描（9×9 组合 × 3 个点击相位）");
{
  /* 「就地接续」是相位换算逻辑，最容易在边界（稀疏↔密集、奇数拍↔4/4、小节末）出破例，
     单点用例覆盖不到。这里把 9 个代表性节奏型两两对切 × 3 个点击相位全跑一遍，
     只守四条硬不变量：立即切换 / 不排到过去 / 时刻严格递增 / 播放不中断。

     v1.3.0（审计 P2-17）加 FULL_SCAN 开关：243 组是本套件最耗时的一段（每格都要新建沙箱 +
     驱动十几秒音频）。默认跑抽样 9 组，FULL_SCAN=1 跑全量——CI 跑全量，本地改代码时跑抽样。
     抽样取自同一批代表值（稀疏 / 密集 / 奇数拍 / 三连音），守的是同一组不变量，只是覆盖面小。
     下面的组合数断言按实际跑的组数校验，所以「抽样模式被静默改成全量」或反过来都能被发现。 */
  const FULL = process.env.FULL_SCAN === "1";
  const IDXS_ALL = [0, 1, 2, 5, 6, 8, 9, 10, 11];
  const WAITS_ALL = [0.35, 1.7, 3.1];
  /* 抽样：4 个节奏型（扫弦/四分/切分/三连音）× 点击相位取「中段」——最易出破例的小节末相位留给全量 */
  const idxs = FULL ? IDXS_ALL : [0, 1, 5, 8];
  const waits = FULL ? WAITS_ALL : [1.7];
  console.log("      · 模式：" + (FULL ? "全量" : "抽样（FULL_SCAN=1 跑全量）")
    + " · " + idxs.length + "×" + idxs.length + "×" + waits.length + " = " + (idxs.length * idxs.length * waits.length) + " 组");
  const problems = [];
  let cases = 0;
  for (const from of idxs) for (const to of idxs) for (const wait of waits){
    const { beat, els } = loadApp();
    const S = beat.Store.S;
    S.sel = { type: "builtin", idx: from };
    beat.Presets.refreshAfterPatternChange();
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, wait);
    const tClick = ac.currentTime, n0 = ac.hits.length;
    const fromName = els["patternName"].textContent;
    S.sel = { type: "builtin", idx: to };
    const mt = beat.BUILTINS[to].meter;
    if (mt !== S.sig) beat.Controls.setSig(mt);
    beat.Presets.refreshAfterPatternChange();
    const toName = beat.curPattern().name;
    drive(ac, beat, 12);
    const seg = ac.hits.slice(n0).map(h => h.t);
    cases++;
    const tag = fromName + " → " + toName + " @" + wait + "s";
    if (els["patternName"].textContent !== toName) problems.push(tag + "：标题未立即切换");
    if (seg.some(t => t < tClick - 1e-9)) problems.push(tag + "：音符排到过去");
    for (let i = 1; i < seg.length; i++) if (!(seg[i] > seg[i - 1])) problems.push(tag + "：时刻非严格递增");
    if (!S.playing) problems.push(tag + "：播放被中断");
    if (seg.length < 4) problems.push(tag + "：切换后发声过少（" + seg.length + "）");
  }
  eq(cases, idxs.length * idxs.length * waits.length, "扫描组合数");
  ok(problems.length === 0, "全部组合满足不变量（" + cases + " 组，破例 " + problems.length + "）");
  problems.slice(0, 8).forEach(p => console.log("      · " + p));
}

/* ================= 场景 T22：弹跳球 onset 表（v1.2） ================= */
section("T22 弹跳球 onset 表：端点=真实发声时刻 / 静音照记 / 休止跳过 / 预测永远有下一跳");
{
  /* 弹跳球的每个落点都来自 onsetBuf/onsetNext（Audio 写、Viz 只读）。这里守数据层的硬不变量；
     渲染层（paintBall 的抛物线/挤压拉伸）是纯函数映射，由人工截图验收。 */
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.sel = { type: "builtin", idx: 1 };            // 四分基础
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);                              // 96BPM：四分 0.625s/颗

  const buf = beat.onsetBuf();
  ok(buf.length >= 2, "onset 缓冲覆盖当前跳跃区间（实测 " + buf.length + " 条，保留最近 1s 且至少 8 条 + 前瞻）");
  ok(buf.every((e, i) => i === 0 || e.t > buf[i - 1].t), "端点时刻严格递增");
  const recentHits = ac.hits.filter(h => h.t > ac.currentTime - 1);   // 缓冲只留最近 1s，对照同窗口
  ok(recentHits.length > 0 && recentHits.every(h => buf.some(e => Math.abs(e.t - h.t) < 1e-9)),
     "最近 1s 内每个发声时刻都能在 onset 表找到（落点=真实发声时刻）");
  const nx = beat.onsetNext();
  ok(!!nx, "预测落点存在（球永远有目的地）");
  ok(nx && nx.t > buf[buf.length - 1].t, "预测落点总在最后一个已排程端点之后");
  ok(nx && nx.t > ac.currentTime, "预测落点在未来（不受 150ms 前瞻窗口限制）");
  eq(nx && +(nx.t - buf[buf.length - 1].t).toFixed(4), 0.625, "四分基础：预测与缓冲的间距即四分密度");

  /* Swing：后半八分落点后移 (67-50)/50×24t = 8.16t ≈ 0.10625s → 相邻间距一长一短交替 */
  const w = loadApp();
  const S2 = w.beat.Store.S;
  S2.sel = { type: "builtin", idx: 2 };           // 八分摇滚
  w.beat.Presets.refreshAfterPatternChange();
  S2.swing = 67;
  w.beat.Controls.start();
  const ac2 = FakeAudioContext.last;
  drive(ac2, w.beat, 2);
  const gaps = w.beat.onsetBuf().map((e, i, a) => i ? +(e.t - a[i - 1].t).toFixed(4) : null).slice(1);
  const LONG = 0.4188, SHORT = 0.2063;            // 0.3125 ± 0.10625
  ok(gaps.length >= 2 && gaps.every(g => Math.abs(g - LONG) < 2e-3 || Math.abs(g - SHORT) < 2e-3),
     "Swing 67%：落点间距一长一短（实测 " + gaps.slice(0, 4).join(",") + "）");
  ok(gaps.every((g, i) => i === 0 || Math.abs(g - gaps[i - 1]) > 0.1), "Swing 落点严格长短交替（球的运动跟随律动）");

  /* 静音拍：第 4 小节不发声但端点照记（视觉照常——静音小节里球是唯一节拍来源） */
  const m3 = loadApp();
  const S3 = m3.beat.Store.S;
  S3.sel = { type: "builtin", idx: 1 };
  m3.beat.Presets.refreshAfterPatternChange();
  S3.mute = true;
  m3.beat.Controls.start();
  const ac3 = FakeAudioContext.last;
  drive(ac3, m3.beat, 9);                          // 第 4 小节窗口 7.5–10s，修剪保留最近 1s
  const buf3 = m3.beat.onsetBuf();
  ok(buf3.some(e => e.bar === 3), "静音小节的端点照常记入（球照跳）");
  ok(!ac3.hits.some(h => h.t >= 8 && h.t < 10), "静音小节无声（对照：声音确实没了，只剩球）");

  /* 休止符：占时不发声也不产生落点——球做长跳跨过 */
  const restPat = { id: "r1", name: "含休止", meter: 4,
    bars: [0, 1, 2, 3].map(() => [{ t: 48, rest: false }, { t: 24, rest: true }, { t: 24, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }]) };
  const r = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, customs: [restPat], sel: { type: "custom", id: "r1" } }) });
  r.beat.Controls.start();
  const ac4 = FakeAudioContext.last;
  drive(ac4, r.beat, 3);
  ok(r.beat.onsetBuf().every(e => e.cumT !== 48), "休止符位置（cumT=48）不产生落点");

  /* resync 点下即生效：切换后预测立刻跟随新节奏型（不等小节边界、不留旧型残影） */
  const q = loadApp();
  const S5 = q.beat.Store.S;
  S5.sel = { type: "builtin", idx: 8 };           // 三连音基础
  q.beat.Presets.refreshAfterPatternChange();
  q.beat.Controls.start();
  const ac5 = FakeAudioContext.last;
  drive(ac5, q.beat, 1.2);
  S5.sel = { type: "builtin", idx: 1 };           // 点下切四分基础
  q.beat.Presets.refreshAfterPatternChange();
  drive(ac5, q.beat, 0.2);                         // 一个调度周期内预测必已换新
  const nx5 = q.beat.onsetNext();
  ok(nx5 && nx5.cumT % 48 === 0, "切换后预测落点立即按新节奏型（四分网格）");
  ok(q.beat.onsetBuf().every((e, i, a) => i === 0 || e.t > a[i - 1].t), "切换后 onset 表仍严格递增（不排到过去）");
}

