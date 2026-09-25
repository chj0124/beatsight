/* BeatSight 自动化测试 · 预设模式窗口手感对齐曲式（v2.23.0）
   T99 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍）：「播放十六分满扫（《在他乡》前奏），同屏行数为 2，但可视化区域
   始终在第一行播放。我理想中：播放到第 2 行时，第 1 行为预告行。」

   用户拍板的两个设计（AskUserQuestion 各选"推荐"）：
     · 短型（型片段数 P < 窗口行数 W）→ 球逐行绕行：行 = (圈号×每圈片段数+圈内片段) % W，
       非在播行 = "绕回的未来"整体淡显（.preview-row，opacity .55）；
     · 长型（P ≥ W）页末预告一并补齐——修订后只服务**真翻页**的 P > W（P === W 窗口
       恒第 0 页无翻页，预告内容 = 第 1 行现内容，零信息量，且页末整树重建打翻
       "取一次 internals() 再驱动"的整类用例，T36 实测偏差涨到 186 tick）。

   圈号是**解析量**（v2.23.0 后半）：行号 = 端点发声时刻 e.t 对 (loopStart, 圈长) 取商，
   不是帧间差分状态机——初版被 setBpm 的 loopStart 重锚误触发（相位缩放看起来像
   "回卷"，球跳一整行，偏差 186 tick ≈ 一小节），S3 钉死这条。

   驱动口径与 t79/t87 一致：BPM 240 → 一小节 1s；帧步长 0.02s。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const PER = [1, 2, 4, 8, 16, 24];
const mkFinger = n => Array.from({ length: n }, (_, i) =>
  Array.from({ length: PER[i] }, () => ({ t: 192 / PER[i] })));
const rowEls = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className));
const curRow = els => rowEls(els).findIndex(r => /(^| )current( |$)/.test(r.className));
const hasPrev = r => /(^| )preview-row( |$)/.test(r.className);
const rowsPill = (els, n) => els["vizRowsRow"].children.find(c => c.dataset.rows === String(n));
function withPattern(beat, n){
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: n + "小节指纹型", meter: 4, bars: mkFinger(n) }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();     // 停机态：applyPatternChange → buildViz
}
/* 把「当前行序列」折成**变化序列**（相邻去重），并给出每段的驻留帧数。
   ★ 断言"球逐行绕行"的本质是变化序列的形状：严格 +1（模 W）、每段驻留 ≈ 一小节。
     驻留帧数把"圈号被误加"变成可观测：误加一圈 = 提前翻转 = 某段驻留骤减。 */
function fold(seq){
  const changes = [], dwell = [];
  for (let i = 0; i < seq.length; i++){
    if (!i || seq[i] !== seq[i - 1]){ changes.push(seq[i]); dwell.push(1); }
    else dwell[dwell.length - 1]++;
  }
  return { changes, dwell };
}

/* ================= 场景 T99a：★ 用户实拍场景——1 小节型 + 2 行档，球逐行绕行 ================= */
section("T99a 预设绕行 · 1 小节的型 + 2 行档 ⇒ 球逐行走满 2 行再绕回（用户实拍场景）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 1);
  rowsPill(els, 2).fire("click");
  eq(rowEls(els).length, 2, "前提：2 行档渲染 2 行（同 T87a 的铺满口径，1 小节内容两行都有）");
  beat.Controls.setBpm(240);                    // 一小节 1s ⇒ 50 帧
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const seq = [];
  for (let i = 0; i < 230; i++){                // 4.6s ⇒ 跨 4 个小节边界
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    seq.push(curRow(els));
  }
  beat.Controls.stop();
  const { changes, dwell } = fold(seq);
  eq(changes[0], 0, "起播球在第 0 行（实际序列 " + changes.join("→") + "）");
  ok(changes.length >= 4,
     "★★ 4.6s 跨 4 个小节边界 ⇒ 球至少换 4 次行——「始终在第一行播放」的反面（实际 "
     + changes.join("→") + "，驻留 " + dwell.join(",") + "）");
  ok(changes.every((r, i) => r === (i % 2)),
     "★★ 行序列严格 0→1→0→1 交替（绕行 = +1 模 2，不是瞬移/重复）（实际 " + changes.join("→") + "）");
  ok(dwell.slice(1, -1).every(d => d >= 35),
     "★ 每次换行的驻留都接近一小节（50 帧，容差 35 起）——圈号没有提前/滞后翻转；"
     + "首段含起播偏移、末段是采样窗口的截断尾巴，都不参与（实际驻留 " + dwell.join(",") + "）");
}

/* ================= 场景 T99b：非在播行 = 淡显的预告行（用户要的手感） ================= */
section("T99b 预设绕行 · 球所在行之外的全部行挂 .preview-row（W=2 时即「第 1 行为预告行」）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 1);
  rowsPill(els, 2).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let sawRow0 = false, sawRow1 = false, badTag = 0;
  for (let i = 0; i < 210; i++){                // 4.2s ⇒ 球在两行各驻留过
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const rows = rowEls(els), r = curRow(els);
    if (r === 0){
      sawRow0 = true;
      if (hasPrev(rows[0])) badTag++;           // 在播行自己不许淡显
      if (!hasPrev(rows[1])) badTag++;          // 非在播行必须淡显
    } else if (r === 1){
      sawRow1 = true;
      if (hasPrev(rows[1])) badTag++;
      if (!hasPrev(rows[0])) badTag++;
    }
  }
  beat.Controls.stop();
  ok(sawRow0 && sawRow1, "前提：球在两行都驻留过（否则本组是假绿）");
  eq(badTag, 0,
     "★★ 淡显只落在非在播行：球在行 0 ⇒ 行 1 淡显、球在行 1 ⇒ 行 0 淡显——"
     + "播放到第 2 行时第 1 行就是预告行（用户拍板的原话）");
}

/* ================= 场景 T99c：★ 播放中改速不跳行（解析圈号对 setBpm 重锚鲁棒） =================
   初版圈计数是帧间差分状态机（phase = currentTime − loopStart，回跳 0.25s 记一圈）。
   setBpm 重锚 loopStart 保证"位置连续"，但相位按新速率缩放——看起来就像回跳，
   圈数被误加 → 球跳一整行（T36 实测偏差 186 tick ≈ 一小节）。改解析圈号后：
   (e.t − loopStart)/圈长 连续，圈号不可能因变速抖动。本组钉死它。 */
section("T99c 预设绕行 · 播放中 setBpm ⇒ 球行序列不重复、不跳变、驻留不塌缩");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 1);
  rowsPill(els, 2).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const seq = [];
  for (let i = 0; i < 60; i++){                 // 1.2s：一次正常翻转（240BPM）
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    seq.push(curRow(els));
  }
  beat.Controls.setBpm(200);                    // ★ 大幅降速 = 重锚相位缩放最大的场景之一
  for (let i = 0; i < 150; i++){                // 3s @ 200BPM ≈ 2.5 小节
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    seq.push(curRow(els));
  }
  beat.Controls.stop();
  const { changes, dwell } = fold(seq);
  ok(changes.every((r, i) => r === (i % 2)),
     "★★ 改速后行序列仍严格 0→1→0→1 交替——没有任何一次因重锚被误判成回卷"
     + "（实际 " + changes.join("→") + "，驻留 " + dwell.join(",") + "）");
  ok(dwell.slice(1).every(d => d >= 35),
     "★ 每段驻留都接近一小节（改速后 200BPM 一小节 1.2s = 60 帧）——重锚没有让圈号抖动"
     + "（实际驻留 " + dwell.join(",") + "）");
}

/* ================= 场景 T99d：短型 + 循环 [0,0] ⇒ 每圈只走 1 片，球每小节进 1 行 =================
   解析圈号的"每圈片段数"口径 = **循环区间的片段数**（不是整型 P）：
   2 小节型 + 循环 [0,0] 时圈内恒片段 0，球仍要每小节进 1 行（绕行语义 = 走遍窗口行），
   而不是 (lap×P+seg)%W 的隔行跳。1 小节型两口径恰好相等（T87g 场景），这里用
   2 小节型把它们区分开。 */
section("T99d 预设绕行 · 2 小节的型 + 循环 [0,0] + 4 行档 ⇒ 球每小节进 1 行（0→1→2→3）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 2);
  beat.Store.S.loopRange = { on: true, from: 0, to: 0 };
  rowsPill(els, 4).fire("click");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const seq = [];
  for (let i = 0; i < 430; i++){                // 8.6s ⇒ 跨 8 个小节边界，球应走完两整圈
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    seq.push(curRow(els));
  }
  beat.Controls.stop();
  const { changes, dwell } = fold(seq);
  ok(changes.length >= 8,
     "★★ 8.6s 跨 8 个小节边界 ⇒ 球至少换 8 次行（每圈只走 1 片 = 每小节进 1 行）（实际 "
     + changes.join("→") + "）");
  ok(changes.every((r, i) => r === (i % 4)),
     "★★ 行序列严格 0→1→2→3→0 逐行推进（每圈片段数 = 循环区间 = 1 片，不是隔行跳）（实际 "
     + changes.join("→") + "）");
}

/* ================= 场景 T99e：P === W 不预告（T36 的结构性哨兵） =================
   4 小节型 + 4 行档：窗口恒第 0 页、球逐行走完全部行、无翻页——预告内容就是第 1 行
   的现内容（零信息量），且页末整树重建会换掉全部 DOM 引用。v2.22.1 基线里这一场景
   全程零重建（T87b「既有行为逐位不变」契约）；初版实现让 P===W 也预告，T36 的
   internals() 旧引用读数冻结、偏差涨到 186 tick。本组钉：全程无预告 + 引用稳定。 */
section("T99e 预设绕行 · 4 小节的型 + 4 行档 ⇒ 全程无预告行、DOM 引用稳定（T36 哨兵）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 4);
  eq(rowEls(els).length, 4, "前提：4 行档渲染 4 行（P === W，窗口恒第 0 页）");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv1 = beat.Viz.internals();             // 起播即取——T36 同款"取一次再用"的用法
  let prevSeen = 0;
  for (let i = 0; i < 180; i++){                // 3.6s ⇒ 球走完第 4 小节（页末行）
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (rowEls(els).some(hasPrev)) prevSeen++;  // 任何一行带预告淡显都算
  }
  const iv2 = beat.Viz.internals();
  beat.Controls.stop();
  eq(prevSeen, 0,
     "★★ P === W 全程零预告：短型淡显只服务 P < W，长型预告只服务 P > W——"
     + "P === W 既无翻页也无绕行淡显，行为与 v2.10.2 逐位一致");
  ok(iv1.ballEl === iv2.ballEl && iv1.rowGeo === iv2.rowGeo,
     "★★ 全程零整树重建：ballEl / rowGeo 引用恒定——「取一次 internals() 再驱动」的"
     + "整类用例（T30/T36/T41/T72…）依赖这条结构性契约");
}
