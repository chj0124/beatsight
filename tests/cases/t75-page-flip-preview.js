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
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(4, 4) },
    { name: "八音型", meter: 4, bars: mkBars(4, 8) },
  ] }));
  const [p4, p8] = beat.Store.customs.slice(-2);
  const v = beat.Store.upsertArrange({ name: "两段窗测试", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: p8.id }, repeats: 1 }] },
  ] });
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 1, loop: !!loop };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last, v };
}

/* ================= 场景 T75a：跳段按钮基准分语境 ================= */
section("T75a 跳段基准 · ★ 停止时相对当前定位（实拍「下一段无反应」），播放中相对正在播的段");
{
  const { beat, els } = loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 0 } }),
    { seedDemo: false });
  const boxOf = () => els["presetList"].children.find(x => /(^| )preset-demo-group( |$)/.test(x.className));
  const playAllOf = () => boxOf().children.find(x => /(^| )demo-play-row( |$)/.test(x.className)).children[0];
  const secRowOf = () => boxOf().children.find(x => /(^| )demo-sec-row( |$)/.test(x.className));
  playAllOf().fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);                              // 96BPM ≈ 1.2 小节 → 已进第 2 段（arrSec=1）
  beat.Controls.stop();

  secRowOf().children[2].fire("click");            // 段序条定位第 3 段
  eq(beat.Store.S.arrangeSel.from, 2, "前提：已定位到第 3 段");
  els["argJumpNext"].fire("click");
  eq(beat.Store.S.arrangeSel.from, 3,
    "★ 停止时点「下一段」→ 第 4 段（旧实现 = jumpTo(arrSec+1) = 原地第 3 段，无反应）");
  els["argJumpPrev"].fire("click");
  eq(beat.Store.S.arrangeSel.from, 2, "★ 再点「上一段」→ 回到第 3 段（相对定位步进）");
  ok(/第 3 段/.test(els["argNowMeta"].textContent), "定位文案同步（实际「" + els["argNowMeta"].textContent + "」）");

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
  beat.Store.S.arrangeSel = { id: beat.Store.S.arrangeSel.id, from: 0, to: 0, loop: false };   // 只播 A 段 4 小节
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
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 0, loop: true };   // 只循环 A 段
  step(beat, ac, 160);                             // ≈3.2s → A 段第 4 小节（页末）
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "★ 预告 = 范围起点（四音型）——若按歌曲 k+1 取会是八音型（8 格），立刻露馅");
  eq(badgeOf(els), "下一小节 · 四音型",
     "★ 胶囊也是范围起点的型名（内容与节目单同源：走 arrNextBar，不走 k+1）");
  beat.Controls.stop();
}
