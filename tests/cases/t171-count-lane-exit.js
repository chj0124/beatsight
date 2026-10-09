/* T171 预备拍道退场（v3.12.0）：传送带「第 −1 小节」· 相对锚点 · 与其他跑道同款退场。
   ---------------------------------------------------------------------------
   背景（用户实拍二连）：
   ① 范围播放（起点在歌曲/型中段）：旧撤除判据用**绝对**可听小节号
      （countLaneLastCur >= rowEls.length），起点 cur ≥ 行数时开播即成立——
      预备拍一结束、道立刻消失（v3.11.x 修"变 4 拍长"时引入的新问题）。
   ② 完整播放：道靠 cur≥行数 撤除后，槽位被下一次网格重建的**通宽 4 拍**内容行
      回填——同一槽位"N 拍短条 → 4 拍通宽"，感知就是"跑道突然变成 4 拍长"。
   新口径（用户拍板）：预备拍道 = 传送带上的「第 −1 小节」——
   · 锚点 = **首个可听小节/片段号**（相对判据，与起点无关）；
   · 首个可听小节的最后一拍，道随整组 scrollDy 滑出 #viz 顶部裁剪区
     （与其他跑道的退场同一机制，无专门撤除动画；dy 轨迹归真机 CDP 专项）；
   · 播到第二个可听小节（cur > 锚点）或回卷（loopWrapped）→ 会话结束、
     道不再复活、row0 真实内容显形（该帧必已重建，新道 display:none、row0 新元素默认显形）。
   驱动手法（与 t70 同款）：同时推时钟 + scheduler + paintFrame——窗口重建与
   可听小节镜像都挂在渲染侧，只调 scheduler 不会触发。BPM 240 下一小节 = 1s。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, html } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const mkBars = (n, per) => Array.from({ length: n }, () =>
  Array.from({ length: per }, (_, i) => ({ t: 192 / per })));

/* 推 seconds：时钟 + 调度 + 渲染三时钟同跑；onFrame 每帧回调（逐帧采样用） */
function drive3(beat, ac, seconds, onFrame){
  const n = Math.ceil(seconds / 0.02);
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (onFrame) onFrame();
    if (!beat.Store.S.playing) return;
  }
}
/* 曲式：四音型 ×2 段（A=小节 0-3，B=小节 4-7），BPM 240，scroll rows=3，预备拍 2 拍 */
function arrangeSetup(from, to){
  const { beat, els } = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 2 },
    sel: { type: "builtin", idx: 1 },
  }));
  const r = beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(4, 4) },
  ] }));
  const p4 = beat.Store.customs.slice(-1)[0];
  const v = beat.Store.upsertArrange({ name: "退场测试", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
  ] });
  beat.Store.S.arrangeSel = { id: v.id, from, to, loop: true };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last };
}
const laneState = beat => {
  const iv = beat.Viz.internals();
  return { disp: iv.countLaneEl.style.display, row0: iv.rowEls[0].style.visibility,
           session: iv.countLane.session, startCur: iv.countLane.startCur,
           width: parseFloat(iv.countLaneEl.style.width || "NaN") };
};

section("T171a 范围播放起点在中段（曲式 from=5）：不立即撤 · 第二小节才退场");
{
  const { beat, els, ac } = arrangeSetup(5, 7);
  const perBeat = beat.Viz.internals().rowGeo[0].width / 4;
  const widths = [];
  /* 预备拍 2 拍（0.5s）+ 进首个可听小节 0.4s */
  drive3(beat, ac, 0.9, () => {
    const t = beat.Viz.internals().countLaneEl;
    if (t.style.display === "block" && t.style.width) widths.push(parseFloat(t.style.width));
  });
  eq(els["statusText"].textContent.indexOf("预备 ·") >= 0, false, "前提：已越过预备");
  let st = laneState(beat);
  eq(st.session, true, "前提：会话开启");
  eq(st.startCur, 5, "★ 锚点 = 首个可听小节（5，真实镜像锚定），与起点位置无关");
  eq(st.disp, "block",
    "★★ 起点在中段**不立即撤**——旧式绝对判据 cur(5) ≥ rowEls.length(4) 在此开播即成立"
    + "（用户实拍的「片段播放播完直接消失」），相对锚点下道继续以「刚播完的道」停在播放杆左侧");
  eq(st.row0, "hidden", "★ 首个可听小节内 row0 由道顶替");
  ok(widths.length > 5 && widths.every(w => Math.abs(w - perBeat * 2) < 2),
    "★★ 预备拍→首小节全程道宽恒 = 2×每拍像素（永不回跳 4 拍）",
    "min=" + Math.min(...widths) + " max=" + Math.max(...widths) + " 期望≈" + (perBeat * 2));

  /* 推进到第二个可听小节（5 → 6，1s/小节） */
  drive3(beat, ac, 1.2);
  st = laneState(beat);
  eq(beat.Viz.internals().scroll.cur, 6, "前提：可听小节推进到 6");
  eq(st.session, false, "★★ 播到第二个可听小节 → 会话结束（不再等 cur≥行数 才撤）");
  eq(st.disp, "none", "★ 道撤除（真实浏览器中它已随整组 dy 滑出 #viz 顶部裁剪区）");
  eq(st.row0, "", "★★ row0 显形 = 真实上一小节内容就位（不再留空槽、不再有通宽行突现）");

  /* 继续驱动跨过回卷（7 → 5）：道不复活 */
  drive3(beat, ac, 3.2);
  st = laneState(beat);
  eq(st.disp, "none", "★ 跨回卷后道不复活（会话已结束；回卷不再触发新的预备拍）");
  eq(st.row0, "", "★ 回卷后 row0 正常显示真实内容");
}

section("T171b 完整播放（预设，从 0 起）：第一小节后退场 · 宽度恒定");
{
  const app = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 2 },
    sel: { type: "builtin", idx: 1 },
  }));
  const { beat, els } = app;
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const perBeat = beat.Viz.internals().rowGeo[0].width / 4;
  const widths = [];
  drive3(beat, ac, 0.9, () => {
    const t = beat.Viz.internals().countLaneEl;
    if (t.style.display === "block" && t.style.width) widths.push(parseFloat(t.style.width));
  });
  eq(els["statusText"].textContent.indexOf("预备 ·") >= 0, false, "前提：已越过预备");
  let st = laneState(beat);
  eq(st.startCur, 0, "★ 锚点 = 0（完整播放的首个可听片段）");
  eq(st.disp, "block", "★ 首个可听片段内道显示");
  eq(st.row0, "hidden", "★ 首个可听片段内 row0 由道顶替");
  ok(widths.length > 5 && widths.every(w => Math.abs(w - perBeat * 2) < 2),
    "★ 完整播放：预备拍→交接全程道宽恒 = 2 拍",
    "min=" + Math.min(...widths) + " max=" + Math.max(...widths));

  /* 推进到第二个可听片段 */
  drive3(beat, ac, 1.3);
  st = laneState(beat);
  eq(st.session, false, "★★ 播到第二个可听片段 → 会话结束（首个片段的最后一拍即随 dy 出场）");
  eq(st.disp, "none", "★ 道撤除");
  eq(st.row0, "", "★ row0 显形（真实内容随本帧重建就位）");
}

section("T171c 单小节循环（from==to=3）：cur 恒不变，靠 loopWrapped 收尾");
{
  const { beat, els, ac } = arrangeSetup(3, 3);
  drive3(beat, ac, 0.9);
  eq(els["statusText"].textContent.indexOf("预备 ·") >= 0, false, "前提：已越过预备");
  let st = laneState(beat);
  eq(st.session, true, "前提：会话开启");
  eq(st.startCur, 3, "★ 锚点 = 3（唯一循环小节）");
  eq(st.disp, "block", "★ 第一轮内道显示");
  /* 单小节循环：cur 恒为 3，相对判据永不成立；第一次回卷（1s 后）由 loopWrapped 收尾 */
  drive3(beat, ac, 1.3);
  st = laneState(beat);
  eq(beat.Viz.internals().scroll.cur, 3, "前提：cur 恒为 3（单小节循环）");
  eq(st.session, false, "★★ 首次回卷 → 会话结束（loopWrapped 收尾，cur 不变也能退场）");
  eq(st.disp, "none", "★ 道撤除");
  eq(st.row0, "", "★ row0 显形（回卷后左邻槽 = 真实的上一圈内容）");
}

section("T171d 停止清理：会话中停止 → 道撤 + row0 复位 + 锚点失效");
{
  const { beat, els, ac } = arrangeSetup(5, 7);
  drive3(beat, ac, 0.9);
  eq(els["statusText"].textContent.indexOf("预备 ·") >= 0, false, "前提：已越过预备");
  eq(laneState(beat).session, true, "前提：会话进行中");
  beat.Controls.stop();
  const st = laneState(beat);
  eq(st.session, false, "★ 停止 → 会话结束（applyScrollRest 路径）");
  eq(st.disp, "none", "★ 停止 → 道撤除");
  eq(st.row0, "", "★ 停止 → row0 复位显形（静止态本就该显示真实内容）");
  eq(st.startCur, -1, "★ 停止 → 退场锚点失效（下次开播重新锚定）");
}

section("T171e 源码钉：退场机制形状（防旧机制回潮）");
{
  ok(/countLaneLastCur > countLaneStartCur \|\| loopWrapped \|\| lanePWrapped/.test(html),
    "★★ 撤除判据 = cur > 锚点 || 回卷 || 相位回退（三路任一，幂等）");
  ok(/countLanePrevP > 0\.75 && laneP < 0\.25/.test(html),
    "★★ 相位回退信号在位——预设单小节型/单小节范围循环的唯一退场信号"
    + "（cur 恒 0、schedBar 回跳 0<0 不置 loopWrapped，实测盲区）");
  ok(/if \(countLaneStartCur < 0\) countLaneStartCur = countLaneLastCur/.test(html),
    "★ 锚点在首个正常帧锚定（预备拍期间 ctx 段已把 lastCur 镜到首个可听小节）");
  ok(/if \(countLaneSession && countLaneEl\)\{/.test(html),
    "★★ paintBall 守卫只认 countLaneSession 一个开关（撤除分支与它同帧先跑）——"
    + "多写一条「lastCur ≤ 锚点」是冗余条件、无人能触发的死代码");
  ok(!/countLaneLastCur >= rowEls\.length/.test(html),
    "★★ 旧绝对判据 cur ≥ rowEls.length 已退役（范围播放开播即撤的根因）");
  ok(!/countLaneFading/.test(html),
    "★ 交叉淡出机制（v3.11.0~v3.11.2）整体退役——含 countLaneFading 旗与 opacity 淡出");
  ok(/get countLane\(\)/.test(html),
    "★ internals 暴露 countLane 读数（session/startCur/lastCur，供 DOM 级断言）");
}
