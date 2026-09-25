/* BeatSight 自动化测试 · 预设待命球绕行落行 + P ≤ W 轻量预告行（v2.24.0）
   T100 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍两连，2026-09-25，扫弦预设库）：
   ① 除「民谣扫弦」外全部：同屏行数 >1 时，播放到第二/三/四小节前，弹跳球的**预判
     （待命）动画**都钉在第 1 行——paintBall 待命球分支的旧公式 `segNext % vizBars`
     只在型长>行数时是对的答案；v2.23.0 修了主球（rowOfOnset 圈号解析）却漏了这处。
     民谣扫弦是 rep4 4 小节型（P===W），旧公式恰好逐位正确——"只有它是好的"。
   ② 扫弦区全部：播放到页面最后一行时从不出现预告行——presetPreviewSeg 旧口径
     P ≤ W 一律不预告，而扫弦 6 项在 4 行档下全部 P ≤ W（示例 5 型 = 1 小节，
     民谣扫弦 = 4 小节 = 行数）。
   用户拍板（AskUserQuestion，2026-09-25）：短型（P<W）加预告行；P===W 也加
   （方案 B，轻量挂法：只挂 class + 胶囊，零整树重建）。
   驱动口径：BPM 240 ⇒ 一小节 1s；T100a 用 0.005s 细步长（同 T72），其余 0.02s。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const rowEls = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className));
const curRow = els => rowEls(els).findIndex(r => /(^| )current( |$)/.test(r.className));
const hasPrev = r => /(^| )preview-row( |$)/.test(r.className);
const rowsPill = (els, n) => els["vizRowsRow"].children.find(c => c.dataset.rows === String(n));
const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
/* 胶囊可见性：标记胶囊用 hidden 摘显（测试桩 remove() 是空操作，hidden 两边语义一致） */
const capsuleOf = r => {
  const c = r.children.find(x => /(^| )bar-chord( |$)/.test(x.className));
  return (c && !c.hidden) ? c.textContent : null;
};
/* 导入一个 n 小节的「四分指纹型」（每小节 4 个四分音符，行尾留 1 拍终端弧窗口） */
function withQuarters(beat, n, name){
  const bar = [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }];
  beat.Store.importPresets(JSON.stringify({
    presets: [{ name, meter: 4, bars: Array.from({ length: n }, () => bar.map(s => ({ ...s }))) },
    ] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();     // 停机态：applyPatternChange → buildViz
}
/* 细步长驱动（同 T72 口径）：返回逐帧样本（含待命球姿态与端点表快照）。
   ★ internals 逐帧现取：长型页末预告会整树重建（设计如此），预先捕获的元素引用
     在重建后全部过期——读旧引用 = 读冻结值（T36 现象本身，别把它当读数）。 */
function drive(beat, ac, seconds, probe){
  const samples = [], onsets = new Map();
  for (let i = 0; i < Math.round(seconds / 0.005); i++){
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.t.toFixed(4), e));
    const iv = beat.Viz.internals();
    const b = nums(iv.ballEl.style.transform), w = nums(iv.waitEl.style.transform);
    samples.push(Object.assign({
      now: ac.currentTime,
      wait: iv.waitEl.style.display !== "none",
      wx: w[0], wy: w[1],
    }, probe ? probe(iv) : {}));
  }
  return { samples, onsets: [...onsets.values()].sort((a, b) => a.t - b.t) };
}

/* ================= 场景 T100a：★ 用户实拍 ①——短型待命球逐行接力 ================= */
section("T100a 待命球绕行 · 1 小节型 + 4 行档 ⇒ 第 k 圈的终端弧里待命球备在行 (k+1)%4，不再恒钉第 1 行");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withQuarters(beat, 1, "四分一小节");
  rowsPill(els, 4).fire("click");
  eq(rowEls(els).length, 4, "前提：4 行档渲染 4 行（P=1 < W=4，短型）");
  beat.Controls.setBpm(240);                    // 一小节 1s
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const loopStart = beat.clock().loopStart;
  const { samples, onsets } = drive(beat, ac, 7.2);
  beat.Controls.stop();
  ok(onsets.length >= 16, `前置：采到 ${onsets.length} 个端点（4 拍 × 4 圈以上）`);
  const barDur = beat.Store.S.sig * (60 / 240); // 1s
  const geoTop = beat.Viz.internals().rowGeo.map(g => g.top);   // 短型零重建，几何稳定
  let checked = 0; const bad = [];
  for (let k = 0; k < 6; k++){
    const lapOs = onsets.filter(e => e.t >= loopStart + k * barDur && e.t < loopStart + (k + 1) * barDur);
    if (lapOs.length < 4) continue;
    const L = lapOs[lapOs.length - 1];          // 本圈最后一颗音（第 4 拍）
    const win = samples.filter(s => s.now > L.t && s.now < loopStart + (k + 1) * barDur - 0.01 && s.wait);
    if (win.length < 3) continue;
    checked++;
    const expectRow = (k + 1) % 4;
    const top = geoTop[expectRow];
    const wl = win[win.length - 1];             // 末帧最贴近触地（wy→0，同 T72 口径）
    if (Math.abs(wl.wy - (top - 20)) >= 8) bad.push(`圈${k}: wy=${wl.wy.toFixed(0)} ≠ 行${expectRow}的 ${(top - 20).toFixed(0)}`);
  }
  ok(checked >= 4, `前置：至少 4 个终端弧窗口采到待命球（实际 ${checked}）`);
  eq(bad.length, 0,
     "★★ 待命球逐行接力：第 k 圈的终端弧里它备在行 (k+1)%4——旧公式 `segNext%行数` 下"
     + "恒在第 1 行，圈 0（应备在行 1）就会红（用户实拍：预判动画都显示在第一小节上）"
     + (bad.length ? "（" + bad.join("；") + "）" : ""));
}

/* ================= 场景 T100b：★ 用户实拍 ②——P===W 轻量预告行（民谣扫弦场景） ================= */
section("T100b 轻量预告 · 4 小节型 + 4 行档 ⇒ 球在第 4 行期间第 1 行挂 .preview-row + 「下一小节」胶囊，零重建");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withQuarters(beat, 4, "四分四小节");
  rowsPill(els, 4).fire("click");
  eq(rowEls(els).length, 4, "前提：4 行档渲染 4 行（P === W = 4，窗口恒第 0 页）");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv1 = beat.Viz.internals();
  let onLast = 0, offElsewhere = 0, bad = 0, sawLast = false, sawElse = false;
  for (let i = 0; i < 240; i++){                // 4.8s @0.02 ⇒ 球走完第 4 小节并绕回
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const rows = rowEls(els), r = curRow(els);
    const marked = hasPrev(rows[0]) || capsuleOf(rows[0]) !== null;
    if (r === 3){
      sawLast = true;
      if (marked && capsuleOf(rows[0]) === "下一小节 · 四分四小节") onLast++; else bad++;
    } else if (r >= 0 && r < 3){
      sawElse = true;
      if (!marked) offElsewhere++; else bad++;  // P===W 无绕行淡显：非页末帧第 1 行必须干净
    }
  }
  const iv2 = beat.Viz.internals();
  beat.Controls.stop();
  const rowsAfter = rowEls(els);
  ok(sawLast && sawElse, "前提：球在第 4 行与其余行都驻留过（否则本组是假绿）");
  ok(onLast > 10 && bad === 0,
     "★★ 球在第 4 行（页末行）期间第 1 行 = 预告行（.preview-row + 「下一小节 · 型名」胶囊），"
     + "离开即摘——旧口径 P===W 永不预告（实际 标记 " + onLast + " 帧 / 违例 " + bad + "）");
  ok(iv1.ballEl === iv2.ballEl && iv1.rowGeo === iv2.rowGeo,
     "★★ 全程零整树重建：轻量挂法不换行元素（T36「取一次 internals() 再驱动」契约保留）");
  ok(!hasPrev(rowsAfter[0]) && capsuleOf(rowsAfter[0]) === null,
     "★ 停机后标记与胶囊一并摘掉（resetForStop 清理）");
}

/* ================= 场景 T100c：短型（P<W）轻量预告行 + 与绕行淡显共存 ================= */
section("T100c 轻量预告 · 1 小节型 + 4 行档 ⇒ 球在第 4 行时第 1 行多挂胶囊；其余行只有绕行淡显");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withQuarters(beat, 1, "四分一小节");
  rowsPill(els, 4).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv1 = beat.Viz.internals();
  let capOn = 0, fadeOnly = 0, bad = 0, sawLast = false, sawMid = false, sawFirst = false;
  for (let i = 0; i < 300; i++){                // 6s ⇒ 球走完一圈多
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const rows = rowEls(els), r = curRow(els);
    const cap = capsuleOf(rows[0]);
    if (r === 3){
      sawLast = true;
      if (hasPrev(rows[0]) && cap === "下一小节 · 四分一小节") capOn++; else bad++;
    } else if (r === 1 || r === 2){
      sawMid = true;
      /* 短型绕行淡显：非在播行全部挂 .preview-row（行 0 也在内），但**没有**胶囊 */
      if (hasPrev(rows[0]) && cap === null) fadeOnly++; else bad++;
    } else if (r === 0){
      sawFirst = true;
      if (!hasPrev(rows[0]) && cap === null) ; else bad++;   // 在播行自己不淡显、无胶囊
    }
  }
  const iv2 = beat.Viz.internals();
  beat.Controls.stop();
  ok(sawLast && sawMid && sawFirst, "前提：球在行 0/1/2/3 都驻留过（否则本组是假绿）");
  ok(capOn > 5 && fadeOnly > 5 && bad === 0,
     "★★ 短型的预告 = 绕行淡显（既有）+ 页末胶囊（v2.24.0 新增）：胶囊只在球位于第 4 行时"
     + "出现在第 1 行，其余帧第 1 行只有淡显（实际 胶囊 " + capOn + " 帧 / 仅淡显 " + fadeOnly
     + " 帧 / 违例 " + bad + "）");
  ok(iv1.ballEl === iv2.ballEl, "★ 全程零整树重建（短型窗口恒第 0 页，轻量标记不触发 buildViz）");
}

/* ================= 场景 T100d：长型（P>W）走既有重建链——v2.23.0 行为回归 ================= */
section("T100d 长型回归 · 8 小节型 + 4 行档 ⇒ 页末预告仍走 winPrev* 重建链（真翻页口径不变）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withQuarters(beat, 8, "四分八小节");
  rowsPill(els, 4).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv1 = beat.Viz.internals();
  let pvOnLast = 0, cleanFirst = 0, sawLast = false, sawFirst = false;
  for (let i = 0; i < 480; i++){                // 9.6s ⇒ 跨两次翻页 + 两次页末预告
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const rows = rowEls(els), r = curRow(els);
    const cap = capsuleOf(rows[0]);
    if (r === 3){
      sawLast = true;
      if (hasPrev(rows[0]) && cap === "下一小节 · 四分八小节") pvOnLast++;
    } else if (r === 0){
      sawFirst = true;
      if (!hasPrev(rows[0]) && cap === null) cleanFirst++;
    }
  }
  const iv2 = beat.Viz.internals();
  beat.Controls.stop();
  ok(sawLast && sawFirst, "前提：球在页末行与页首行都驻留过（否则本组是假绿）");
  ok(pvOnLast > 10,
     "★★ 长型页末预告（winPrev* 重建链）照旧工作：球在页末行期间第 1 行换成页外下一片段"
     + "并挂胶囊（实际 " + pvOnLast + " 帧）");
  ok(cleanFirst > 10, "★ 页首行期间第 1 行无预告残留（预告随翻页重建被清）");
  ok(iv1.ballEl !== iv2.ballEl,
     "★ 长型翻页必然整树重建（与 v2.23.0 一致——轻量挂法只属于 P ≤ W 的预告）");
}

/* ================= 场景 T100e：长型页末待命球仍回落旧口径（让给预告行 → 第 1 行） ================= */
section("T100e 待命球回落 · 8 小节型 + 4 行档 ⇒ 页末终端弧里待命球落在第 1 行（翻页预告位）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withQuarters(beat, 8, "四分八小节");
  rowsPill(els, 4).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const loopStart = beat.clock().loopStart;
  const { samples, onsets } = drive(beat, ac, 5.2, iv => ({ row0Top: iv.rowGeo[0].top }));
  beat.Controls.stop();
  const barDur = beat.Store.S.sig * (60 / 240);
  /* 第 4 小节（型内 bar 3，页 0 末行）的终端弧窗口 */
  const lapOs = onsets.filter(e => e.bar === 3 && e.t >= loopStart + 3 * barDur && e.t < loopStart + 4 * barDur).sort((a, b) => a.t - b.t);
  ok(lapOs.length >= 4, `前置：采到第 4 小节的 ${lapOs.length} 个端点`);
  const L = lapOs[lapOs.length - 1];
  const win = samples.filter(s => s.now > L.t && s.now < loopStart + 4 * barDur - 0.01 && s.wait);
  ok(win.length > 3, `前置：页末终端弧窗口采到 ${win.length} 帧待命球`);
  const wl = win[win.length - 1];
  ok(!!wl && Math.abs(wl.wy - (wl.row0Top - 20)) < 8,
     "★★ 长型页末 nxt 已在下一页 ⇒ rowOfOnset 给不出（-1）→ 回落旧口径：待命球备在第 1 行"
     + "（翻页预告位，v2.7.0 曲式同款手感）（y=" + (wl ? wl.wy.toFixed(1) : "无")
     + " ≈ " + (wl ? (wl.row0Top - 20).toFixed(1) : "?") + "）");
}
