/* BeatSight 自动化测试 · 内置预设小节完整性（catalog 级不变量）
   T267 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍）：选「Take Five 律动 · 5/4」练习，小球滚动与播放都不对。
   根因：bars 写成 [D(48)×3, D(24)×2] = 192t ≠ meter×TPB = 240t（整差 1 拍）。
   后果三件（同源）：
     · 播放：调度器按**内容步长**推进（schedOneStep 逐 step 累加 nextNoteTime，
       小节回绕不看 meter×TPB）⇒ 实际循环 = 4 拍，「5/4 律动」听起来是 4/4；
     · 网格：行按 segTicks() = meter×TPB = 240t 铺宽，格子只占 80%，第 5 拍列恒空白；
     · 播放头/球：终端弧按「行右界 = 240t」倒推（endT = prev.t + (240−168)·spb），
       而音频 0.5 拍后就回卷换行——杆的扫速与球的落点同格子/声音三方错位。
   该不变量（每小节严格 = meter×48）对 customs/导入有 validatePreset 拦截，
   但 BUILTINS 是源码常量、不经过校验——数据表写错只能靠测试拦（本组 T267a）。

   修法：补末位 D(48) → [48,48,48,24,24,48] = 240t，节奏「1 2 3 4& 5」——
   3+2 分组下 2 组起拍（第 4 拍）同步化，与 accents [0,3] 对位。

   本组钉住的契约：
   · T267a 全目录扫描：每个内置型每小节 sum === meter×TPB（含示例曲带出的 10 个型）；
   · T267b Take Five 数据形状：6 音符、onset=[0,48,96,144,168,192]、accents=[0,3]；
   · T267c 播放循环：每 240t 窗口 6 次发声、循环步长 = 恰 5 拍（回卷不再提前 1 拍）；
   · T267d 网格铺满：行内 6 格、末格右缘 = 100%（修复前 5 格只铺到 80%）。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");

/* ★★ 样本必须带上真机早已置位的迁移戳（t214/t237 的教训）：桩的 localStorage 每轮新建，
   缺戳会让 bnmig35（内置下标整体 −1）每轮重放，把种子的 sel.idx 挪 1 位。
   五枚全带 = 「现代机器」的诚实模拟（arpg52 无老戳形态，走新前缀）。 */
const MODERN_STAMPS = {
  "beatsight.mig.bnmig35": "1", "beatsight.mig.chdsp36": "1",
  "beatsight.mig.arpg52": "1", "beatsight.mig.arrmig73": "1", "beatsight.mig.chdmig": "1",
};
const NAME = "Take Five 律动 · 5/4";
/* 选台走名字→下标（EAR_GROUPS 同款口径：下标随内置库增删会移位，名字不会） */
const pickTakeFive = () => loadApp({ ...MODERN_STAMPS,
  "beatsight.state": JSON.stringify({ sel: { type: "builtin",
    idx: loadApp({ ...MODERN_STAMPS }).beat.BUILTINS.findIndex(p => p.name === NAME) } }) });

/* ================= 场景 T267a：catalog 级不变量——每小节严格填满 meter×TPB ================= */
section("T267a 全目录扫描 · ★ 每个内置型每小节 sum === meter×TPB（validatePreset 不覆盖源码常量）");
{
  const { beat } = loadApp({ ...MODERN_STAMPS });
  const all = beat.BUILTINS;
  ok(all.length >= 11, "前提：内置库在场（含示例曲带出的型，实际 " + all.length + " 个）");
  let bad = [];
  all.forEach((p, i) => p.bars.forEach((bar, bi) => {
    const sum = bar.reduce((a, s) => a + s.t, 0);
    if (sum !== p.meter * 48) bad.push(`[${i}]${p.name}·第${bi + 1}小节 ${sum}t≠${p.meter * 48}t`);
  }));
  eq(bad.length, 0, "★ 全目录零违规" + (bad.length ? "：" + bad.join("；") : ""));
  /* 钉住本bug的直接落点：修复前这里是唯一一条违规（192t vs 240t） */
  const tf = all.find(p => p.name === NAME);
  ok(!!tf, "前提：Take Five 在库");
  eq(tf.bars.reduce((a, b) => a + b.reduce((x, s) => x + s.t, 0), 0), 240, "★ Take Five 小节 = 240t（修复前 192t）");
}

/* ================= 场景 T267b：Take Five 数据形状 ================= */
section("T267b Take Five 数据形状 · ★ 6 音符铺满 5 拍（「1 2 3 4& 5」）");
{
  const { beat } = loadApp({ ...MODERN_STAMPS });
  const tf = beat.BUILTINS.find(p => p.name === NAME);
  eq(tf.meter, 5, "拍号 5/4");
  eq(JSON.stringify(tf.accents), JSON.stringify([0, 3]), "重拍分组 3+2（第 1、4 拍）");
  eq(tf.bars.length, 1, "1 小节型");
  const bar = tf.bars[0];
  eq(bar.length, 6, "★ 6 音符（修复前 5 个 = 只写完 4 拍）");
  let cum = 0; const onsets = [];
  bar.forEach(s => { onsets.push(cum); cum += s.t; });
  eq(JSON.stringify(onsets), JSON.stringify([0, 48, 96, 144, 168, 192]),
    "★ onset 序列 = 0/48/96/144/168/192（「1 2 3 4& 5」，末音落在第 5 拍）");
  eq(cum, 240, "★ 小节总和 = 240t = 5 拍（整数严格相等，同 validatePreset 口径）");
}

/* ================= 场景 T267c：播放循环——声音铺满 5 拍，回卷不再提前 ================= */
section("T267c 播放循环 · ★ 每 240t 窗口 6 击、循环步长恰 5 拍（调度器按内容步长推进）");
{
  const { beat } = pickTakeFive();
  eq(beat.curPattern().name, NAME, "前提：选中 Take Five");
  beat.Controls.setBpm(60);                 // 1 拍 = 1s，间隔即拍数
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 6);                       // > 1 个完整循环 + 起始前瞻
  const h = ac.hits.map(x => x.t);
  const t0 = h[0];
  /* 第一窗口（240t = 5s）内的击点相对时刻 =「1 2 3 4& 5」（修复前只有 5 击且第 5 击
     已是下一遍的「1」——循环步长 192t，5/4 听成 4/4） */
  const first = h.filter(t => t < t0 + 5).map(t => +(t - t0).toFixed(3));
  eq(JSON.stringify(first), JSON.stringify([0, 1, 2, 3, 3.5, 4]), "★ 第一小节 6 击 = 0/1/2/3/3.5/4s");
  near(h[6] - t0, 5, 1e-6, "★ 循环步长 = 5s = 240t（修复前 4s = 192t，第 5 拍被吞）");
  const gaps = h.slice(1, 12).map((t, i) => t - h[i]);
  ok(gaps.every(g => g <= 1 + 1e-9), "★ 相邻击点间隔 ≤ 1 拍（回卷缺口不大于一拍，球无长弧）");
  beat.Controls.stop();
}

/* ================= 场景 T267d：网格铺满——末格右缘 = 100% ================= */
section("T267d 网格铺满 · ★ 行内 6 格、右缘 100%（修复前 5 格只铺 80%，第 5 拍列恒空白）");
{
  const { beat, els } = pickTakeFive();
  beat.Presets.refreshAfterPatternChange();   // 停止态 → buildViz（t79 同款路径）
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  ok(rows.length >= 1, "前提：行已渲染");
  const cells = rows[0].children.filter(c => /(^| )cell( |$)/.test(c.className));
  eq(cells.length, 6, "★ 行内 6 格（修复前 5 格）");
  const right = parseFloat(cells[cells.length - 1].style.left) + parseFloat(cells[cells.length - 1].style.width);
  eq(right, 100, "★ 末格右缘 = 100%（修复前 80%，行尾 1/5 恒空白）");
  eq(parseFloat(cells[0].style.left), 0, "首格左缘 0（铺满的另一端）");
}
