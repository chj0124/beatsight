/* BeatSight 自动化测试 · 跳段按钮基准 + 翻页预告行（v2.7.0）
   T75 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍 + 用户拍板的方案）：
   ① 停止 + 段序条定位第 3 段后点「下一段」无反应——按钮基准恒用调度游标 arrSec
     （上次播到哪），而 jumpTo 只改 arrangeSel.from 不动它，两者分裂后按钮就跳错或哑掉。
     修法：播放中基准 = arrSec（正在播的段），停止时基准 = arrangeSel.from（当前定位）。
   ② 整首连播时球永远在第 1 行跳（滚动窗口：当前小节恒为第 1 行）。
     改成按 4 小节翻页后，页内第 4 小节看不到"下一小节"（扫弦型可能变）——
     用户方案：页内第 4 小节期间把第 1 行（最陈旧的历史）替换成下一小节内容 + 预告信息。
     本组钉：替换内容、预告信息胶囊、预告行不被"已弹"刷白、待命球落在预告行、
     范围末尾不循环时**不**替换、范围循环时预告 = 范围起点（不是 k+1）。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const mkBars = (n, per) => Array.from({ length: n }, () =>
  Array.from({ length: per }, (_, i) => ({ t: 192 / per })));
const rowCells = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className))
  .map(r => r.children.filter(c => /(^| )cell( |$)/.test(c.className)).length);
const row0 = els => els["viz"].children.find(el => /(^| )bar-row( |$)/.test(el.className));
/* v2.8.0：预告信息并入和弦胶囊（不再单独挂 .preview-badge），改读第 1 行内的 .bar-chord */
const badgeOf = els => {
  const r = row0(els);
  const b = r && r.children.find(c => /(^| )bar-chord( |$)/.test(c.className));
  return b ? b.textContent : "";
};
function step(beat, ac, n){
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
  }
}
/* 两段曲式：A = 四音型（4 格/小节）4 小节，B = 八音型（8 格/小节）4 小节。
   240BPM 下一小节 1s。返回 {beat, els, ac, idA, idB} */
function startTwoStages(loop){
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(4, 4) },
    { name: "八音型", meter: 4, bars: mkBars(4, 8) },
  ] }));
  const [p4, p8] = beat.Store.customs.slice(-2);
  const v = beat.Store.upsertArrange({ name: "两段窗测试", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: p8.id }, repeats: 1 }] },
  ] });
  /* v2.10.7：from/to 是线性小节号——全曲 = 小节 0..7（A 段 4 + B 段 4），不再是段下标 0..1 */
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 7, loop: !!loop };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last, v };
}

/* ================= 场景 T75a：跳段按钮基准分语境 ================= */
section("T75a 跳段基准 · ★ 停止时相对当前定位（实拍「下一段无反应」），播放中相对正在播的段");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 0 } }),
    { seedDemo: false });
  const boxOf = () => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
  /* v2.28.0：「整首连播」按钮已删（条目点击 = 同一 playArrange 出口），改点示例曲条目 */
const playAllOf = () => boxOf().children.find(x =>
  /(^| )preset-item( |$)/.test(x.className) && x.children[0].children[0].textContent === "在他乡（示例）");
  /* v2.10.4：段序条已换成「播放范围」双滑块。定位第 3 小节 = 把两个 thumb 拖到第 3 小节重合，
     并走完 input（拖动中）+ change（提交）两级——只发 input 不会应用范围 */
  const rangeOf = () => boxOf().children.find(x => /(^| )demo-range( |$)/.test(x.className));
  const setRange = (f, t) => {
    const track = rangeOf().children[1];
    const fromEl = track.children[1], toEl = track.children[2];
    fromEl.value = String(f); toEl.value = String(t);
    fromEl.fire("input"); toEl.fire("input");
    fromEl.fire("change"); toEl.fire("change");
  };
  playAllOf().fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);                              // 96BPM ≈ 1.2 小节 → 已进第 2 段（arrSec=1）
  beat.Controls.stop();

  setRange(3, 3);                                  // 范围滑块定位第 3 小节（两个 thumb 重合；0-based from=2，落在段 1 内）
  eq(beat.Store.S.arrangeSel.from, 2, "前提：已定位到第 3 小节（v2.10.7 小节口径）");
  els["argJumpNext"].fire("click");
  eq(beat.Store.S.arrangeSel.from, 4,
    "★ 停止时点「下一段」→ 跳到下一段的起点（小节 2 在段 1 内 → 下一段 = 段 2 起点 = 小节 4；不再是零反馈）");
  els["argJumpPrev"].fire("click");
  eq(beat.Store.S.arrangeSel.from, 1, "★ 再点「上一段」→ 回到上一段起点（段 2 → 段 1 起点 = 小节 1）");
  /* v2.10.14：原这里还有一条 argNowMeta 定位文案断言——说明文字已按用户要求删除，
     定位的可见反馈 = 侧栏范围滑块 thumb 即时移动（上面两条 from 断言已覆盖） */

  /* 播放中：基准 = 正在播的段（与跳段行显示的「第 N 段」一致） */
  beat.Controls.start();
  drive(ac, beat, 3);                              // 重新播，走进某段
  const cur = Math.max(0, beat.Store.S.arrangeSel.from);
  els["argJumpNext"].fire("click");
  ok(beat.Store.S.arrangeSel.from >= cur, "播放中点「下一段」不往回跳（基准 = 在播段）");
  beat.Controls.stop();
}

/* ================= 场景 T75b：预告行的内容 / 预告信息胶囊 / 已弹豁免 ================= */
section("T75b 预告行 · ★ 第 1 行换成下一小节 + 胶囊「下一小节 · 型名」+ 不被已弹刷白");
{
  const { beat, els, ac } = startTwoStages(true);
  step(beat, ac, 160);                             // ≈3.2s → 歌曲第 4 小节（页内最后一行）
  eq(JSON.stringify(rowCells(els)), JSON.stringify([8, 4, 4, 4]),
     "前提：第 1 行已替换成下一小节（八音型 8 格，见 T70a 同点位）");
  ok(/(^| )preview-row( |$)/.test(row0(els).className), "★ 第 1 行带预告行标识（.preview-row 降透明）");
  eq(badgeOf(els), "下一小节 · 八音型", "★ 胶囊文字 =「下一小节 · 型名」（本段无和弦，故只剩预告信息）");
  /* 预告行 = 未来：所有格子必须是 upcoming（绝不出现 played）；
     唯一的亮色可以是 .next 预告格（那正是它该亮的一格） */
  const cls0 = row0(els).children.filter(c => /(^| )cell( |$)/.test(c.className)).map(c => c.className);
  ok(cls0.every(c => !/(^| )played( |$)/.test(c)), "★ 预告行没有任何格子被「已弹」刷白（未来不是历史）");
  ok(cls0.every(c => /(^| )upcoming( |$)/.test(c)), "预告行全部按未弹画");

  step(beat, ac, 50);                              // → 第 5 小节：翻页，预告转正
  ok(!/(^| )preview-row( |$)/.test(row0(els).className), "★ 翻页后预告标识消失（第 1 行回到正常身份）");
  eq(badgeOf(els), "", "预告信息胶囊一并撤掉");
  beat.Controls.stop();
}

/* ================= 场景 T75c：页末待命球落在预告行（跨页接力不断） ================= */
section("T75c 预告行 · ★ 页内第 4 小节终端弧期间，待命球落在第 1 行（预告行）首音上");
{
  const { beat, els, ac } = startTwoStages(true);
  const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const samples = [];
  /* ★ 每帧重取 internals()：进页末那一帧 paintFrameBody 会为预告行 rebuild 网格，
     buildViz 重新创建 waitEl——缓存的旧引用从那一刻起指向被丢弃的节点（样式定格） */
  for (let i = 0; i < Math.round(4.4 / 0.005); i++){       // 跑过页末（3.75s 终端弧起）
    ac.currentTime += 0.005;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const iv = beat.Viz.internals();
    const w = nums(iv.waitEl.style.transform);
    samples.push({ now: ac.currentTime, shown: iv.waitEl.style.display !== "none", wx: w[0], wy: w[1] });
  }
  const W = samples.filter(s => s.now > 3.75 && s.now < 3.99 && s.shown);
  ok(W.length > 10, `前提：页末终端弧期间待命球可见（${W.length} 帧）`);
  const rg = beat.Viz.internals().rowGeo;
  const wl = W[W.length - 1];
  /* 断言「最近行基线 = 第 1 行」而不是贴地：采样帧在弧段末尾（p≈0.94），
     待命球与主球同相位仍有几 px 的腾空——要比的是它属于哪一行，不是此刻的高度 */
  const dists = rg.map(g => Math.abs(wl.wy - (g.top - 20)));
  eq(dists.indexOf(Math.min(...dists)), 0,
    `★ 待命球落点在第 1 行（y=${wl.wy.toFixed(1)}，预告行基线 ${(rg[0].top - 20).toFixed(1)}）`
    + `，而不是第 3/4 行（${(rg[2].top - 20).toFixed(0)}/${(rg[3].top - 20).toFixed(0)}）`);
  beat.Controls.stop();
}

/* ================= 场景 T75d：范围播完不循环 → 不带预告 ================= */
section("T75d 预告行边界 · ★ 范围末尾不循环：没有「下一小节」，第 1 行不替换、无预告信息");
{
  const { beat, els, ac } = startTwoStages(false);           // loop = false
  beat.Store.S.arrangeSel = { id: beat.Store.S.arrangeSel.id, from: 0, to: 3, loop: false };   // 只播 A 段（小节 0..3）
  step(beat, ac, 160);                             // ≈3.2s → A 段第 4 小节（也是范围末小节）
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "★ 页内第 4 小节但**不替换**——节目单在此结束，没有「下一小节」可预告");
  eq(badgeOf(els), "", "无预告信息胶囊");
  ok(!/(^| )preview-row( |$)/.test(row0(els).className), "无预告行标识");
  step(beat, ac, 80);                              // 走完范围
  eq(beat.Store.S.playing, false, "范围播完自动停止（节目单语义未变）");
}

/* ================= 场景 T75e：范围循环时预告 = 范围起点（不是 k+1） ================= */
section("T75e 预告行边界 · ★ 只循环 A 段时，页末预告的是范围起点（四音型），不是歌曲 k+1（八音型）");
{
  const { beat, els, ac, v } = startTwoStages(true);
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 3, loop: true };   // 只循环 A 段（小节 0..3）
  step(beat, ac, 160);                             // ≈3.2s → A 段第 4 小节（页末）
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "★ 预告 = 范围起点（四音型）——若按歌曲 k+1 取会是八音型（8 格），立刻露馅");
  eq(badgeOf(els), "下一小节 · 四音型",
     "★ 胶囊也是范围起点的型名（内容与节目单同源：走 arrNextBar，不走 k+1）");
  beat.Controls.stop();
}

/* ================= 场景 T75f：范围比同屏行数短时，循环回卷前也要预告（v2.15.2 修） =================
   用户实拍：同屏 4 行 + 只循环第 1–2 小节 → 播到第 2 小节（= 范围末小节）第 1 行**没有**变成
   预告行；把同屏行数改成 2、同一个范围就正常。
   根因：previewSegFor 的判据是"播到的片段 == **页的最后一行**"，而分页锚点
   winAnchorSeg(seg) = floor(seg/W)*W 用的是**歌曲片段的绝对编号**，与 S.arrangeSel.from 无关。
   于是"范围长度 < W"（例：2 小节范围 + 4 行档）时，范围里没有任何一小节能落在页的最后一行上
   ⇒ 循环回卷前永远没有提前量——而回卷恰恰是最需要提前量的时刻（型可能整个换掉）。
   本组用真实示例曲《在他乡》（第 1 小节 = 十六分满扫（《在他乡》前奏）、第 2 小节起 = 下上扫 · 密（《在他乡》副歌））钉死这条。 */
function startDemoRange(N, from, to){
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  beat.Arrange.ensureDemo();
  const a = beat.Store.arranges[0];
  beat.Store.S.arrangeSel = { id: a.id, from, to, loop: true, byLyric: false };
  beat.setMode("playMode", "arrange", "T75f");
  beat.Controls.setBpm(240);                       // 一小节 = 1s ⇒ 50 步
  beat.Presets.refreshAfterPatternChange();
  const pill = els["vizRowsRow"].children.find(c => c.dataset.rows === String(N));
  ok(!!pill, "前提：找到 " + N + " 行档位 pill");
  pill.fire("click");
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last };
}
const rowEls = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const cellCls = r => r.children.filter(c => /(^| )cell( |$)/.test(c.className)).map(c => c.className);

section("T75f 预告行 · ★★ 范围短于同屏行数：4 行档 + 只循环第 1–2 小节");
{
  const { beat, els, ac } = startDemoRange(4, 0, 1);
  eq(rowEls(els).length, 4, "前提：4 行档渲染 4 行（窗口 = 歌曲第 1–4 小节）");
  step(beat, ac, 75);                              // ≈1.5s ⇒ 循环第 2 小节（= 范围末小节）
  ok(/(^| )preview-row( |$)/.test(row0(els).className),
     "★★ 循环第 2 小节（范围末小节）第 1 行必须是预告行（修前：不是——这就是用户实拍的那一帧）");
  eq(badgeOf(els), "C（下一小节 · 十六分满扫（《在他乡》前奏））",
     "★ 胶囊 =「和弦名（下一小节 · 型名）」；预告的是回卷目标 = 范围起点（不是歌曲 k+1）");
  const cls0 = cellCls(row0(els));
  ok(cls0.length > 0 && cls0.every(c => !/(^| )played( |$)/.test(c)),
     "★ 预告行一格都没被「已弹」刷白（未来不是历史）");
  step(beat, ac, 50);                              // 回卷到循环第 1 小节
  ok(!/(^| )preview-row( |$)/.test(row0(els).className), "回到循环第 1 小节后预告标识立刻消失");
  beat.Controls.stop();
}

section("T75f 对照 · 同范围 + 2 行档（本来就正常，钉住不许退化）");
{
  const { beat, els, ac } = startDemoRange(2, 0, 1);
  eq(rowEls(els).length, 2, "前提：2 行档渲染 2 行");
  step(beat, ac, 75);
  ok(/(^| )preview-row( |$)/.test(row0(els).className), "★ 2 行档同范围：预告行照常出现");
  eq(badgeOf(els), "C（下一小节 · 十六分满扫（《在他乡》前奏））", "胶囊一致");
  beat.Controls.stop();
}

section("T75f 对照 · 4 行档 + 范围 1–4（页末与范围末重合，原行为不许变）");
{
  const { beat, els, ac } = startDemoRange(4, 0, 3);
  step(beat, ac, 175);                             // ≈3.5s ⇒ 循环第 4 小节（页末 = 范围末）
  ok(/(^| )preview-row( |$)/.test(row0(els).className), "★ 对齐时预告行照常出现");
  eq(badgeOf(els), "C（下一小节 · 十六分满扫（《在他乡》前奏））", "胶囊一致");
  beat.Controls.stop();
}

section("T75f 反例 · 循环关闭时不许凭空造预告（没有「下一小节」可预告）");
{
  const { beat, els, ac } = startDemoRange(4, 0, 1);
  beat.Store.S.arrangeSel.loop = false;
  step(beat, ac, 75);                              // 范围末小节
  ok(!/(^| )preview-row( |$)/.test(row0(els).className),
     "★ 不循环 ⇒ arrNextBar 返回 null ⇒ 第 1 行不许变预告行");
  beat.Controls.stop();
}

/* ================= 场景 T75g：范围起点不在页首 / 跨页时，预告行仍只落在循环末小节（v2.16.0） =================
   来源：v2.15.2 只补了"范围末片段也要触发"这条判据，但"页"的锚点仍是**歌曲片段的绝对编号**，
   于是范围起点不落在页首时窗口会混进范围外的小节、预告行也会挂错行：
     · 范围末小节恰好落在某页第 1 行（= 在播行，没有更陈旧的行能让出去）→ 漏报；
     · 旧的"页末"判据又会在范围中间误报一次。
   v2.16.0 把 winAnchorSeg 改成**相对播放范围起点对齐**后，第一页从范围起点开始，
   两处残留一起消失。本组钉死它。 */
section("T75g 跨页 · ★★ 4 行档 + 范围 2–3：预告行只落在循环末小节，且范围首小节不许误报");
{
  const { beat, els, ac } = startDemoRange(4, 1, 2);       // 范围 = 歌曲第 2–3 小节（0基 1..2）
  eq(rowEls(els).length, 4, "前提：4 行档渲染 4 行");
  step(beat, ac, 25);                                      // 0.5s ⇒ 循环第 1 小节（= 范围起点）
  ok(!/(^| )preview-row( |$)/.test(row0(els).className),
     "★ 范围第 1 小节不许预告（旧口径会在这里误报一次）");
  step(beat, ac, 50);                                      // 1.5s ⇒ 循环第 2 小节（= 范围末小节）
  ok(/(^| )preview-row( |$)/.test(row0(els).className),
     "★★ 循环末小节第 1 行 = 预告行（修前：不出现——漏报）");
  eq(badgeOf(els), "C（下一小节 · 下上扫 · 密（《在他乡》副歌））",
     "★ 胶囊预告的是回卷目标 = 范围起点那一小节（不是歌曲 k+1）");
  ok(cellCls(row0(els)).every(c => !/(^| )played( |$)/.test(c)), "★ 预告行不被已弹刷白");
  step(beat, ac, 50);                                      // 回卷到循环第 1 小节
  ok(!/(^| )preview-row( |$)/.test(row0(els).className), "回卷后预告标识立刻消失");
  beat.Controls.stop();
}

section("T75g 跨页 · 2 行档同一对范围（行数与范围长度相等，钉住不许退化）");
{
  const { beat, els, ac } = startDemoRange(2, 1, 2);
  eq(rowEls(els).length, 2, "前提：2 行档渲染 2 行");
  step(beat, ac, 25);
  ok(!/(^| )preview-row( |$)/.test(row0(els).className), "★ 循环第 1 小节不预告");
  step(beat, ac, 50);
  ok(/(^| )preview-row( |$)/.test(row0(els).className), "★ 循环末小节第 1 行 = 预告行");
  eq(badgeOf(els), "C（下一小节 · 下上扫 · 密（《在他乡》副歌））", "胶囊一致");
  beat.Controls.stop();
}

section("T75g 跨页 · 4 行档 + 范围 2–5（范围长于行数且跨页）：预告仍只在范围末小节");
{
  const { beat, els, ac } = startDemoRange(4, 1, 4);       // 范围 = 第 2–5 小节（0基 1..4）
  step(beat, ac, 75);                                      // 1.5s ⇒ 循环第 2 小节
  ok(!/(^| )preview-row( |$)/.test(row0(els).className),
     "★ 循环第 2 小节不预告（旧口径会在页末那一次误报）");
  step(beat, ac, 100);                                     // 3.5s ⇒ 循环第 4 小节（= 范围末小节）
  ok(/(^| )preview-row( |$)/.test(row0(els).className),
     "★★ 范围末小节（歌曲第 5 小节）第 1 行 = 预告行（修前：被 seg<=winStart 守卫拦掉，漏报）");
  eq(badgeOf(els), "C（下一小节 · 下上扫 · 密（《在他乡》副歌））",
     "★ 胶囊 =「和弦名（下一小节 · 型名）」；和弦名取的是**回卷目标那一小节**的（第 2 小节 = C）");
  beat.Controls.stop();
}

section("T75g 页锚点副作用 · 窗口第一行 = 播放范围起点那一小节");
{
  /* v2.16.0 的可见行为变更：窗口起点跟着播放范围走。4 行档 + 范围 2–3 ⇒ 窗口 = 第 2–5 小节，
     第 1 行的和弦名 = 第 2 小节的（"C"），而不是旧口径下窗口首小节（第 1 小节）的 */
  const { beat, els, ac } = startDemoRange(4, 1, 2);
  step(beat, ac, 25);
  eq(badgeOf(els), "C", "★ 窗口第 1 行 = 范围起点（第 2 小节）的和弦");
  beat.Controls.stop();
  /* 对照：整首连播（from=0）时窗口起点仍是歌曲第 1 小节 —— 零影响 */
  const { beat: b2, els: e2, ac: a2 } = startDemoRange(4, 0, 29);
  step(b2, a2, 25);
  eq(badgeOf(e2), "C", "★ 整首连播窗口仍从第 1 小节开始（from=0 时逐位等于旧口径）");
  b2.Controls.stop();
}
