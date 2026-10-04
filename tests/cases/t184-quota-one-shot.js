/* BeatSight 自动化测试 · v3.31.8 部署对账与额度串台修复批次（P1-1：onQuotaDone 单例串台）
   ---------------------------------------------------------------------------
   根因（他方审计 P1-1，本地逐行复现确认）：limitPulse 触发后不摘 onQuotaDone，而逐段
   试听（段行 ▶）只设 playQuota 不设回调 → 若此前做过候选试听（回调已挂），段试听到点会
   执行上一任的 stopCandPreview(false)：「候选试听结束，未改动曲式」错播报 + ref 被回退。
   修法两处：① limitPulse 回调一次性（先摘再调）；② 段行 ▶ 入口先 stopCandPreview(true)
   收口候选试听 + 显式 onQuotaDone = null。
   ★ 反向验证锚点：删 ① 的一次性摘除 → T184b 变红；删 ② 的两行 → T184a 变红。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, driveFrames, ok, eq, section } = require("../lib/harness");

const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const secRows = els => Array.prototype.filter.call(els["argSections"].children,
  c => !/(^| )arg-pick( |$)/.test(c.className));
const blockChips = blks => blks.children.filter(c => /(^| )arg-block( |$)/.test(c.className));
const refOf = (beat, id, i, j) => beat.Store.findArrange(id).sections[i].blocks[j].ref;

function setup(){
  const app = loadApp();
  const { beat, els } = app;
  ok(beat.Store.upsertArrange({ name: "编排", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }, { ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
    { name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 1 }] },
    { name: "C", blocks: [{ ref: { type: "builtin", idx: 3 }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  return { app, beat, els, id: arr.id };
}
/* 打开第 i 段第 j 块的换型候选行，返回 .arg-pick 行 */
function openPicker(els, i, j){
  const chip = blockChips(byCls(secRows(els)[i], "arg-blocks"))[j];
  chip.children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("换第 " + (i + 1) + " 段第 " + (j + 1) + " 块")).fire("click");
  return els["argSections"].children.find(c => c.className && c.className.includes("arg-pick"));
}
const pillsOf = pickRow => byCls(pickRow, "arg-blocks").children.filter(c => c.className && c.className.includes("arg-mini"));
const playBtnOf = pill => pill.children.find(c => c.className && c.className.includes("arg-pill-play"));
const isCur = pill => (pill.textContent || "").startsWith("✓");
/* 段行 ▶（逐段试听，ops 里唯一常显动作钮） */
const tryBtnOf = (els, i) => {
  const ops = byCls(secRows(els)[i], "arg-ops");
  return Array.prototype.find.call(ops.children, b => /试听第 (\d+) 段/.test(b.getAttribute("aria-label") || ""));
};
/* 驱动到播放停止（或预算帧数耗尽）；ac 用 FakeAudioContext.last */
function driveUntilStop(beat, ac, maxFrames){
  for (let i = 0; i < maxFrames; i++){
    if (!beat.Store.S.playing) return true;
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
  }
  return !beat.Store.S.playing;
}

/* ================= T184a：候选试听挂起 → 段行 ▶ → 候选收口、无串台播报 ================= */
section("T184a 额度串台 · 候选试听挂起时点段行 ▶：候选试听先收口（ref 还原、无错播报）");
{
  const { app, beat, els, id } = setup();
  beat.Controls.setBpm(240);                    // 1 小节 1s，帧数可预算
  const pickRow = openPicker(els, 0, 0);
  ok(!!pickRow, "前提：换型候选行展开");
  const cand = pillsOf(pickRow).find(p => !isCur(p));
  ok(!!cand, "前提：有非当前候选");
  playBtnOf(cand).fire("click");                // 候选试听：内存换型 + onQuotaDone 挂上
  ok(beat.Arrange.candPreviewState() != null, "前提：已进入候选试听态");
  ok(beat.quota().hasDone, "前提：候选试听的到点回调已挂（hasDone=true）");
  eq(JSON.stringify(refOf(beat, id, 0, 0).idx), JSON.stringify(1), "前提：块 ref 已临时换成候选");

  tryBtnOf(els, 1).fire("click");               // 点第 2 段 ▶（逐段试听）
  ok(beat.Arrange.candPreviewState() == null,
     "★ 进入逐段试听即收口候选试听（修复前 candPreview 仍挂 → 到点触发上一任回调）");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 0 }),
     "★ 被候选试听临时换掉的 ref 已还原（修复前残留候选型，段试听听错型）");
  ok(!beat.quota().hasDone, "★ 到点回调已摘（修复前上一任回调仍武装）");
  eq(beat.quota().bars, 1, "前提：逐段试听额度 = B 段 1 小节");

  const ac = FakeAudioContext.last;
  ok(driveUntilStop(beat, ac, 200), "放完这一段自动停（额度到点）");
  const said = els["srAnnounce"].textContent || "";
  ok(said.indexOf("候选试听结束，未改动曲式") === -1,
     "★ 全程无「候选试听结束」串台播报（修复前此处必现）");
  ok(said.indexOf("已停止候选试听") === -1, "★ 也无收口播报（stopCandPreview(true) 静默，入口自有播报）");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 0 }),
     "★ 放完 ref 仍是原值（无第二次还原事件）");
  beat.Controls.stop();
  beat.Arrange.close();
}

/* ================= T184b：limitPulse 回调一次性（先摘再调）——Ear 路径 =================
   用听辨训练测①：Ear 的回调**不清** onQuotaDone（候选试听的回调内部会自清，测不出①）。 */
section("T184b 额度串台 · limitPulse 回调一次性：听辨到点后 hasDone 归 false（Ear 路径）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els;
  els["earBtn"].fire("click");                  // 进入听辨训练：自动出题并放 2 小节（额度=EAR_BARS）
  ok(beat.quota().hasDone, "前提：听辨的到点回调已挂（hasDone=true）");
  eq(beat.quota().bars, beat.EAR_BARS, "前提：额度 = 题目 2 小节");
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 12);                    // 2 小节 @96BPM ≈ 5s，给 12s 余量（t49c 同款）
  eq(beat.Store.S.playing, false, "前提：放到额度自动停（回调路径真实执行）");
  eq((els["srAnnounce"].textContent || "").indexOf("放完了，请选择") > -1, true,
     "前提：听辨回调确实执行（播报在）");
  ok(!beat.quota().hasDone,
     "★ 回调执行后即被摘（hasDone=false）——修复前恒 true，只设 playQuota 的下一任消费者会串台");
  beat.Controls.stop();
  beat.Ear.close();
}

/* ================= T184c：候选试听额度修序（stop 先于设额度） =================
   previewCandidate 原先「设额度 → stop（清零）→ start」，额度被自己的 stop 吞掉，
   「到量自动停」实为范围末尾兜底、onQuotaDone 永不执行（覆盖率零执行名单在册）。
   v3.31.8 改为「stop → 设额度 → start」，候选试听到量路径从此真实可测。 */
section("T184c 额度串台 · 候选试听额度真实生效：放完该型小节数自动停 + 正常播报");
{
  const { beat, els, id } = setup();
  beat.Controls.setBpm(240);
  const pickRow = openPicker(els, 0, 0);
  const cand = pillsOf(pickRow).find(p => !isCur(p));
  playBtnOf(cand).fire("click");                // 候选试听（1 小节额度）
  ok(beat.quota().hasDone, "前提：到点回调已挂");
  eq(beat.quota().bars, 1, "前提：额度 = 候选型 1 小节");
  const ac = FakeAudioContext.last;
  ok(driveUntilStop(beat, ac, 200), "★ 放到额度自动停（修序前额度被自己的 stop 清零、只能等范围末尾）");
  ok(beat.Arrange.candPreviewState() == null, "★ 到点回调收口了候选试听（candPreview 置空）");
  eq((els["srAnnounce"].textContent || "").indexOf("候选试听结束，未改动曲式") > -1, true,
     "★ 正常路径的到点播报在（本组证明回调真的执行过）");
  ok(!beat.quota().hasDone, "到点后 hasDone=false（回调自清 + limitPulse 一次性双保险）");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 0 }),
     "★ 到点还原 ref 为原值");
  beat.Controls.stop();
  beat.Arrange.close();
}
