/* BeatSight 自动化测试 · 预备拍入场动画 + 幽灵步飞缘（v3.29.0）
   T176 系列。
   ---------------------------------------------------------------------------
   本用例守护 v3.29.0 的两处改动（方案：plan-v3130-countin-entrance.md）：

   ① **恢复预备拍入场动画**（编舞 A）。用户需求原话：「播放完预备拍后准备播放第一小节时，
      小球是有预备动画的」——v2.42.6（a679758）的「回卷前行首先有球等着」被 v3.0.0 批 8
      当 bug 删掉了。批 8 的误诊：把「预备拍 4/4 时主球 + 待命球同框」当病根，但同框
      （双重奏）本来就是**全 app 每一次行交接**的既有交接语言（paintBall 终端弧段至今
      健在、从未被投诉）。用户当年在手机上的真身观感是「凭空出现一颗静止的球」，
      那是「行边界 + 下一行开头空拍」的**双静止**（窄屏拆行 K=2 让行边界落进小节内部，
      而球是 onset 驱动的），与同框无关、本次不动。
  ② **幽灵步飞缘修复**（编舞 B）。1 行档 + 窄屏拆行时，预备拍哒 3/哒 4 主球飞出跑道
      右缘（x 冲到 ~679，行宽仅 358）——根因是行号取了模、行内位置却用取模后的行号。

   ★★ 驱动几何：**双几何**是本用例的关键。用户报的 bug 只在**移动端**出现：
      rowW=358（手机 #viz 实宽）+ 示例曲十六分满扫 ⇒ K=2（一小节拆两行）。
      桌面 rowW=600 ⇒ K=1、拆行复现不出来。两个几何都要跑（方案 §4.1）。
   ★★ 落点口径（**实测修正**，勿按"首个发声音"想当然）：预备拍入场的落点是
      **行首**（端点锚 cumT=0 ⇒ tick 0 ⇒ x = 行左缘 − 8），不是"下一行首个发声音"
      ——那是**接力**（paintBall）的语义。两者在本曲恰好同值（《在他乡》首音在 tick 0），
      但用一个"前导休止型"就能把差别测出来（T176b）。另：onsetBuf 在 ciEnd 前 ~0.35s
      才进端点，空缓冲时回退也取 tick 0 ⇒ 与锚同值 ⇒ **全程无中途跳变**（实测）。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, near, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const SPB = 60 / 96;                                   // 96BPM 下一拍 = 0.625s

/* 双几何：桌面 K=1（默认行为基线） / 移动 K=2（用户报障的那个几何）。
   seedDemo:false = 走「首次带出示例曲」，那是唯一能加载《在他乡》十六分满扫的路径
   —— 只给 rowW 而选内置型（sel.idx）时型内最短时值大，K 退化为 1，拆行复现不出来。
   （harness 的 seedDemo 语义是反的：true=预置闩=库里没有示例曲，见 harness 注释。） */
const MOBILE = { rowW: 358, seedDemo: false };
const DESKTOP = { rowW: 600, seedDemo: false };

/** 逐帧采样：推音频时钟 + 调度 + 渲染，记录主球/待命球姿态
    @param {any} beat @param {any} ac @param {number} seconds @param {number} [dt] */
function sample(beat, ac, seconds, dt){
  const step = dt || 0.005;
  const out = [];
  for (let i = 0; i < Math.round(seconds / step); i++){
    ac.currentTime += step;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const iv = beat.Viz.internals();
    const b = nums(iv.ballEl ? iv.ballEl.style.transform : "");
    const w = nums(iv.waitEl ? iv.waitEl.style.transform : "");
    out.push({
      t: ac.currentTime,
      ballOn: !!iv.ballEl && iv.ballEl.style.display !== "none",
      bx: b[0], by: b[1], btf: iv.ballEl ? iv.ballEl.style.transform : "",
      waitOn: !!iv.waitEl && iv.waitEl.style.display !== "none",
      wx: w[0], wy: w[1], wtf: iv.waitEl ? iv.waitEl.style.transform : "",
    });
  }
  return out;
}
/** 把预备拍与 ciEnd 一起取好（每个场景重复三次，抽出来）
    @param {any} beat */
function ciTimes(beat){
  const end = beat.clock().loopStart;
  return { start: end - 4 * SPB, end };
}
/** 取样本，越界返回 NaN 占位——**变异后"待命球完全不出现"时必须表现为具名断言失败，
    而不是 `shown[0].wx` 抛 TypeError 崩掉整个套件**（崩溃不是证据，本仓库纪律）。
    @param {any[]} arr @param {number} i */
function at(arr, i){
  const x = arr[i];
  return x || { t: NaN, bx: NaN, by: NaN, wx: NaN, wy: NaN, btf: "", bOn: false, waitOn: false, ballOn: false };
}

/* =========================================================================== */
section("T176a 桌面几何（K=1）· 预备拍最后一拍：待命球抛物线入场（真的在动 / 起跳合式 / 触地 = 音乐第一拍 / 交接连续）");
{
  const app = loadApp(seedState({ countIn: { on: true, beats: 4 } }), DESKTOP);
  const beat = app.beat;
  eq(beat.Viz.internals().vizRowBeats, 4, "T176a0 前提：桌面行宽 ⇒ 每行 = 整小节（K=1）");
  beat.Controls.setBpm(96);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const ci = ciTimes(beat);
  const g0 = beat.Viz.internals().rowGeo[0];
  ac.currentTime = ci.start + 3 * SPB - 0.03;          // 最后一拍起点之前一点
  const s = sample(beat, ac, SPB + 0.20);

  const shown = s.filter(x => x.waitOn);
  ok(shown.length >= 60, "T176a1 最后一拍待命球**在场**（逐帧可见，v3.29.0 恢复 v2.42.6 入场）");
  const tf = new Set(shown.map(x => x.wtf));
  ok(tf.size >= 10, "T176a2 待命球**逐帧位移**（≥10 种 transform——直接防「在但没动」那类漏检）");
  const first = at(shown, 0), last = at(shown, shown.length - 1);
  near(first.wx, last.wx - 0.2 * g0.width, 2.5, "T176a3 起跳点 = 落点 − 20% 行宽（与接力待命球同式）");
  near(last.wx, g0.left - 8, 1.5, "T176a4 落点 = 第 0 行行首（端点锚 cumT=0 ⇒ tick 0 ⇒ 行左缘 − 8）");
  near(last.wy, g0.top - 20, 1.5, "T176a5 触地 y = 第 0 行基线（行顶 − 20）");
  near(last.t, ci.end, 0.02, "T176a6 触地时刻 = 音乐第一拍 ciEnd（±1 帧）");
  ok(first.wx < g0.left, "T176a7 起跳点在**跑道行左缘之外**（分页 .viz 无横向裁剪，v2.42.6 原样）");

  const after = s.filter(x => x.t >= ci.end);
  const bAfter = after.find(x => x.ballOn);
  ok(!!bAfter, "T176a8 ciEnd 之后主球接管（可见）");
  if (bAfter){
    ok(Math.abs(bAfter.bx - last.wx) < 16,
      "T176a9 交接连续：|主球接管帧 x − 待命球末帧 x| < 球径 16px（ciEnd 无瞬移接缝）");
  }
  ok(after.every(x => !x.waitOn), "T176a10 交接后待命球恒隐藏（无残留帧）");
}

/* =========================================================================== */
section("T176b 落地口径实测钉死：落点是**行首**（不是「首个发声音」——那是接力的语义），两个型同值");
{
  /* 前导休止型：[休 休 四分 四分]（首个发声音在 tick 96 = 半行）。
     若落点跟随"首个发声音"，这里应落在半行处；实测落在**行首**（端点锚 cumT=0），
     且空缓冲回退值与锚同值 ⇒ 无中途跳变。这条把口径差异钉死，防止日后被"顺手改成
     首个发声音"（那会引入中途跳变，因为 onsetBuf 要到 ciEnd 前 ~0.35s 才进端点）。 */
  const app = loadApp(seedState({ countIn: { on: true, beats: 4 } }), DESKTOP);
  const beat = app.beat;
  beat.Store.importPresets(JSON.stringify({
    presets: [{ name: "前导休止型", meter: 4, bars: [[{ t: 48, rest: true }, { t: 48, rest: true }, { t: 48 }, { t: 48 }]] }],
  }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.setBpm(96);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const ci = ciTimes(beat);
  const g0 = beat.Viz.internals().rowGeo[0];
  ac.currentTime = ci.start + 3 * SPB - 0.03;
  const s = sample(beat, ac, SPB + 0.10);
  const shown = s.filter(x => x.waitOn);
  ok(shown.length >= 60, "T176b1 前导休止型同样入场（落点判定与是否有休止无关）");
  const tf = new Set(shown.map(x => x.wtf));
  ok(tf.size >= 10, "T176b2 前导休止型轨迹同样逐帧连续（无中途跳变）");
  const last = at(shown, shown.length - 1);
  near(last.wx, g0.left - 8, 1.5,
    "T176b3 落点仍是**行首**（不是首个发声音的半行位——口径与接力不同，实测钉死）");
  ok(Math.abs(last.wx - (g0.left + 0.5 * g0.width - 8)) > 100,
    "T176b4 反证：落点明显不等于「首个发声音」位置（半行），i.e. 上面那条不是巧合");
}

/* =========================================================================== */
section("T176c 移动端几何（K=2，用户报障的那个几何）：同一份编舞、落点仍在第 0 行行首");
{
  const app = loadApp(seedState({ countIn: { on: true, beats: 4 } }), MOBILE);
  const beat = app.beat;
  const iv0 = beat.Viz.internals();
  eq(iv0.vizRowBeats, 2, "T176c0 前提：手机行宽 + 十六分满扫 ⇒ K=2（一小节拆两行，正是用户报障的几何）");
  beat.Controls.setBpm(96);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const ci = ciTimes(beat);
  const g0 = beat.Viz.internals().rowGeo[0];
  ac.currentTime = ci.start + 3 * SPB - 0.03;
  const s = sample(beat, ac, SPB + 0.20);
  const shown = s.filter(x => x.waitOn);
  ok(shown.length >= 60, "T176c1 移动端最后一拍待命球在场");
  const tf = new Set(shown.map(x => x.wtf));
  ok(tf.size >= 10, "T176c2 移动端待命球逐帧位移（≥10 种 transform）");
  const last = at(shown, shown.length - 1);
  near(last.wx, g0.left - 8, 1.5, "T176c3 移动端落点 = 第 0 行行首（与桌面对齐，不随拆行漂移）");
  near(last.wy, g0.top - 20, 1.5, "T176c4 移动端触地 y = 第 0 行基线");
  /* 幽灵步在移动端照常走位（精确的行归属见 T176e） */
  const ghost = s.filter(x => x.ballOn);
  ok(ghost.length >= 60, "T176c5 幽灵步照常走位（主球预备拍全程可见，行归属见 T176e）");
}

/* =========================================================================== */
section("T176d vizRows 矩阵（1/2/3/4）× 移动几何：落点恒第 0 行行首；**1 行档主球不再飞出右缘**（编舞 B）");
{
  for (const n of [1, 2, 3, 4]){
    const app = loadApp(seedState({ countIn: { on: true, beats: 4 }, vizRows: n }), MOBILE);
    const beat = app.beat;
    eq(beat.Viz.internals().vizRowBeats, 2, `T176d${n}0 前提：移动几何 K=2（vizRows=${n}）`);
    beat.Controls.setBpm(96);
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    const ci = ciTimes(beat);
    const rg = beat.Viz.internals().rowGeo;
    const g0 = rg[0];
    ac.currentTime = ci.start - 0.02;
    const s = sample(beat, ac, 4 * SPB + 0.05);
    const ball = s.filter(x => x.ballOn);
    const maxX = Math.max(...ball.map(x => x.bx));
    const minX = Math.min(...ball.map(x => x.bx));
    ok(maxX <= g0.left + g0.width + 1,
      `T176d${n}1 预备拍全程主球**不飞出跑道右缘**（maxX=${maxX.toFixed(0)} ≤ 行右缘）`);
    ok(minX >= g0.left - 9,
      `T176d${n}2 预备拍全程主球不飞出跑道左缘（minX=${minX.toFixed(0)}）`);
    const shown = s.filter(x => x.waitOn);
    const last = shown[shown.length - 1];
    ok(!!last, `T176d${n}3 待命球入场（四档行数一致）`);
    if (last) near(last.wx, g0.left - 8, 1.5, `T176d${n}4 落点恒第 0 行行首（与显示行数无关）`);
  }
}

/* =========================================================================== */
section("T176e 幽灵步行归属：vizRows ≥ 2 时哒 1–3 在第 0 行、哒 4 到第 1 行（v2.42.6 既有，保留）；1 行档在第 0 行走完");
{
  /* 行归属按"离哪一行基线最近"判（行数不定，不能写死 rg[1]） */
  const rowAt = (iv, y) => {
    let best = -1, bd = 1e9;
    iv.rowGeo.forEach((g, i) => { const d = Math.abs(y - (g.top - 20)); if (d < bd){ bd = d; best = i; } });
    return best;
  };
  for (const n of [1, 2, 4]){
    const app = loadApp(seedState({ countIn: { on: true, beats: 4 }, vizRows: n }), MOBILE);
    const beat = app.beat;
    beat.Controls.setBpm(96);
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    const ci = ciTimes(beat);
    const seq = [], xs = [];
    for (const k of [0.5, 1.5, 2.5, 3.5]){           // 哒 1..4 的中段（pos = k）
      ac.currentTime = ci.start + k * SPB;
      beat.AudioEngine.scheduler();
      beat.Viz.paintFrame();
      const iv = beat.Viz.internals();
      const b = nums(iv.ballEl.style.transform);
      seq.push(rowAt(iv, b[1]));
      xs.push(b[0]);
    }
    /* rowIdx = floor(pos/2) = 0,0,1,1；row = rowIdx % 显示行数
       ⇒ vizRows=1 全落第 0 行（在可见行重走一遍）、vizRows ≥ 2 走 0,0,1,1
       （vizRows ≥ 2 时本式与修复前**逐位相同**——只有 1 行档吃到编舞 B 的修正） */
    const want = n === 1 ? "0,0,0,0" : "0,0,1,1";
    eq(seq.join(","), want, `T176e${n}a 幽灵步行归属 = [${want}]（vizRows=${n}，K=2）`);
    if (n === 1){
      near(xs[0], xs[2], 0.6, "T176e1b 1 行档：哒 1 与哒 3 同 x（在第 0 行**重走一遍**，不再飞出右缘）");
      near(xs[1], xs[3], 0.6, "T176e1c 1 行档：哒 2 与哒 4 同 x（同上）");
    }
  }
}

/* =========================================================================== */
section("T176f 接力护栏（防误碰 G5）：移动端三个行边界的待命球全部健在、且在动；第 3 拍落点不在行首");
{
  const app = loadApp(seedState({ countIn: { on: true, beats: 4 } }), MOBILE);
  const beat = app.beat;
  beat.Controls.setBpm(96);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const ci = ciTimes(beat);
  ac.currentTime = ci.end - 0.05;
  const s = sample(beat, ac, 5.0, 0.01);             // 覆盖到 ciEnd+4.95（第 2 小节的第三个行边界在 +3.75）
  const rg = beat.Viz.internals().rowGeo;
  const g1 = rg[1];
  /* 行边界时刻（K=2：段 = 2 拍 = 1.25s）：行0→1 @ciEnd+1.25、行1→2 @+2.5、行2→3 @+3.75
     （vizRows=2 ⇒ 第 2 小节翻页，行2/行3 映射回 row0/row1，与 T176d 的行归属同源） */
  const bounds = [[1.25, "行0→行1（第1小节 拍2→3，小节内）"], [2.5, "行1→行2（第1小节→第2小节）"], [3.75, "行2→行3（第2小节 拍2→3，小节内）"]];
  for (const [off, name] of bounds){
    /* 窗口要罩住**整段入场飞行**：待命球从行边界前 ~0.5 拍起跳、落到下一行首个发声音
       （本曲第 3 拍前两格是空扫 ⇒ 落点比行边界晚 ~0.31s），故窗口取 [边界−0.45, 边界+0.52] */
    const lo = ci.end + off - 0.45, hi = ci.end + off + 0.52;
    const win = s.filter(x => x.t > lo && x.t < hi);
    const sh = win.filter(x => x.waitOn);
    ok(sh.length >= 3, `T176f 接力健在：${name} 待命球出现（${sh.length} 帧）`);
    const tf = new Set(sh.map(x => x.wtf));
    ok(tf.size >= 3, `T176f 接力健在：${name} 待命球逐帧在动（${tf.size} 种 transform）`);
    if (name.indexOf("行0→行1") === 0 && sh.length){
      const land = sh[sh.length - 1];
      ok(land.wx > g1.left + 0.15 * g1.width,
        `T176f 第 3 拍落点**不在行首**（x=${land.wx.toFixed(0)} > 行首+15% ⇒ 「&」位特殊落点未被改动）`);
      const bAfter = s.filter(x => x.t > land.t).find(x => x.ballOn);
      if (bAfter) near(land.wx, bAfter.bx, 16, "T176f 该边界交接连续（|Δx| < 球径）");
    }
  }
  /* 空拍静止语义（球"音到才动"）仍在：ciEnd 之后存在主球连续静止段 */
  let run = 0, best = 0, prev = null;
  for (const x of s){
    if (prev !== null && x.btf === prev) { run++; best = Math.max(best, run); }
    else run = 0;
    prev = x.btf;
  }
  ok(best >= 8, `T176f 空拍静止语义保留（主球存在 ≥8 帧（80ms）的静止段，实测最长 ${best} 帧）`);
}

/* =========================================================================== */
section("T176g 边界情形：ciBeats=1 无特判；REDUCE_MOTION 静止在落点");
{
  /* 1 拍预备拍：唯一一拍即最后一拍 ⇒ 同份编舞（待命球照常入场） */
  const app = loadApp(seedState({ countIn: { on: true, beats: 1 } }), DESKTOP);
  const beat = app.beat;
  beat.Controls.setBpm(96);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const end = beat.clock().loopStart, start = end - 1 * SPB;
  const g0 = beat.Viz.internals().rowGeo[0];
  ac.currentTime = start + 0.01;
  const s = sample(beat, ac, 1 * SPB);
  const shown = s.filter(x => x.waitOn);
  ok(shown.length >= 60, "T176g1 ciBeats=1：待命球照常入场（无特判）");
  const last = shown[shown.length - 1];
  if (last) near(last.wx, g0.left - 8, 1.5, "T176g2 ciBeats=1：落点同样是第 0 行行首");

  /* REDUCE_MOTION：p 恒 1 ⇒ 待命球静止在落点、不做落下动作（既有降级纪律） */
  const appR = loadApp(seedState({ countIn: { on: true, beats: 4 } }), { rowW: 600, seedDemo: false, reduceMotion: true });
  const beatR = appR.beat;
  beatR.Controls.setBpm(96);
  beatR.Controls.start();
  const acR = FakeAudioContext.last;
  const ciR = ciTimes(beatR);
  const g0R = beatR.Viz.internals().rowGeo[0];
  acR.currentTime = ciR.start + 3 * SPB - 0.02;
  const sR = sample(beatR, acR, SPB);
  const shownR = sR.filter(x => x.waitOn);
  ok(shownR.length >= 60, "T176g3 REDUCE_MOTION：待命球仍在场（去动作、留位置）");
  const tfR = new Set(shownR.map(x => x.wtf));
  eq(tfR.size, 1, "T176g4 REDUCE_MOTION：待命球**静止在落点**（transform 全程唯一）");
  const lastR = shownR[shownR.length - 1];
  if (lastR) near(lastR.wx, g0R.left - 8, 1.5, "T176g5 REDUCE_MOTION：静止位置 = 落点");
}

/* =========================================================================== */
section("T176h 滚动模式回归：预备拍全程待命球不出现（v3.1.3 独立拍板，本次零改动）");
{
  const app = loadApp(seedState({ scrollMode: true, scrollRows: 3, countIn: { on: true, beats: 4 }, sel: { type: "builtin", idx: 1 } }));
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let seen = 0, frames = 0;
  for (let i = 0; i < 600; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    frames++;
    const d = beat.Viz.internals().waitEl.style.display;
    if (d != null && d !== "none") seen++;
    if (!beat.Store.S.playing) break;
  }
  ok(frames > 100, `T176h1 预备拍窗口确实跑到（${frames} 帧）`);
  eq(seen, 0, "T176h2 滚动模式预备拍待命球零出场（scroll 口径与本次改动无关）");
}
