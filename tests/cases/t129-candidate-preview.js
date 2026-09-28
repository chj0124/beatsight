/* BeatSight 自动化测试 · 换型候选就地试听（v2.57.0，C3）
   T129 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★ 覆盖 Batch 1c 的新能力：候选 pill 上的 ▶ 只播该型一遍——**不触发换型、
     不落库、不入撤销历史**（审计 P1-4：比较多个型时被迫反复改回、产生无意义冷键写入）。
     实现要点：previewCandidate 把目标块 ref 在【内存】临时换成候选型（绝不经 Arrange.save），
     到量 / 再点 ▶ / 关浮层 / 任何结构写（save 顶部保险）都还原。

   ★ 定位口径（与 t106 / t127 / t128 同源）：argSections.children[i] = 段行
     （忽略 .arg-pick 候选行）；块胶囊 .arg-block 含 [名称, .arg-reps, 单位, 换, ✕, ⋯]；
     「换」按钮 aria = 「换第 N 段第 M 块的节奏型」；展开后 .arg-pick 行内 .arg-blocks
     装 [三区标题(.arg-pick-zone) + 候选 .arg-mini 胶囊]；候选胶囊第一子元素即 ▶
     （.arg-pill-play，role=button），其后是文字（当前型带「✓ 」前缀）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const secRows = els => Array.prototype.filter.call(els["argSections"].children,
  c => !/(^| )arg-pick( |$)/.test(c.className));
const blockChips = blks => blks.children.filter(c => /(^| )arg-block( |$)/.test(c.className));
const refOf = (beat, id, i, j) => beat.Store.findArrange(id).sections[i].blocks[j].ref;

function setup(){
  const { beat, els } = loadApp();
  ok(beat.Store.upsertArrange({ name: "编排", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }, { ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
    { name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 1 }] },
    { name: "C", blocks: [{ ref: { type: "builtin", idx: 3 }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  return { beat, els, id: arr.id };
}
/* 打开第 i 段第 j 块的换型候选行，返回 .arg-pick 行（已重新取段行） */
function openPicker(els, i, j){
  const chip = blockChips(byCls(secRows(els)[i], "arg-blocks"))[j];
  chip.children.find(c => c.getAttribute("aria-label") && c.getAttribute("aria-label").includes("换第 " + (i + 1) + " 段第 " + (j + 1) + " 块")).fire("click");
  return els["argSections"].children.find(c => c.className && c.className.includes("arg-pick"));
}
/* 候选胶囊（.arg-mini）：pills[0] = 当前型（✓），pills[1] = 第一个非当前候选 */
const pillsOf = pickRow => byCls(pickRow, "arg-blocks").children.filter(c => c.className && c.className.includes("arg-mini"));
const playBtnOf = pill => pill.children.find(c => c.className && c.className.includes("arg-pill-play"));
const isCur = pill => (pill.textContent || "").startsWith("✓");

/* ================= T129a：▶ 出现且 stopPropagation 防触发换型 ================= */
section("T129a 候选 ▶ 出现 · 点击只试听不换型（stopPropagation）");
{
  const { beat, els, id } = setup();
  const pickRow = openPicker(els, 0, 0);
  ok(!!pickRow, "★ 换型候选行展开");
  const pills = pillsOf(pickRow);
  ok(pills.length > 1, "候选多于 1 个（含当前 + 至少一个非当前）");
  const allHavePlay = pills.every(p => !!playBtnOf(p));
  ok(allHavePlay, "★ 每个候选 pill 都有 ▶（.arg-pill-play）");
  const cand = pills.find(p => !isCur(p));          // 非当前候选
  const before = JSON.stringify(refOf(beat, id, 0, 0));
  playBtnOf(cand).fire("click");
  ok(!!beat.Arrange.candPreviewState(), "★ 点 ▶ 后进入候选试听态（candPreview 非空 → 胶囊换型 handler 未跑，stopPropagation 生效）");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 1 }), "★ 试听中主引擎读到的是候选 idx1（内存临时换型，复用发声通道）");
  eq(els["argUndo"].disabled, true, "★ 仅试听不产生可撤销历史（没有走 save / 落库）");
  beat.Arrange.stopCandPreview(true);
  eq(JSON.stringify(refOf(beat, id, 0, 0)), before, "★ 停止后内存 ref 复原为原 idx0");
  beat.Arrange.close();
}

/* ================= T129b：试听内存换型可还原 + 不经 save 污染落库 ================= */
section("T129b 试听内存换型可还原 · 不污染后续结构写");
{
  const { beat, els, id } = setup();
  const origRef = JSON.parse(JSON.stringify(refOf(beat, id, 0, 0)));   // {builtin,0}
  const pickRow = openPicker(els, 0, 0);
  const cand = pillsOf(pickRow).find(p => !isCur(p));
  playBtnOf(cand).fire("click");
  ok(!!beat.Arrange.candPreviewState(), "★ 进入候选试听态");
  eq(JSON.stringify(beat.Arrange.candPreviewState().origRef), JSON.stringify(origRef), "★ 记住了还原目标（origRef = 原 idx0）");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 1 }), "试听中内存 ref 临时变成候选 idx1");
  /* ★ 关键：试听期间做一次真实结构写（改遍数），save 顶部应先还原 ref 再落库——
     证明候选试听的临时换型绝不会漏进已提交的曲式 */
  const chip = blockChips(byCls(secRows(els)[0], "arg-blocks"))[0];
  const reps = chip.children.find(c => c.className && c.className.includes("arg-reps"));
  reps.value = "3"; reps.fire("change");
  eq(refOf(beat, id, 0, 0).idx, 0, "★ 真实保存后 ref 仍是原 idx0（候选试听未污染落库）");
  eq(beat.Store.findArrange(id).sections[0].blocks[0].repeats, 3, "遍数改动已落库（对照：真保存生效）");
  eq(JSON.stringify(beat.Arrange.candPreviewState()), JSON.stringify(null), "★ 结构写把候选试听态清空（candPreview 已还原并置空）");
  beat.Arrange.close();
}

/* ================= T129c：再点 ▶ 停止（到量/手动同一还原路径） ================= */
section("T129c 再点同一 ▶ 停止试听 · 内存 ref 复原");
{
  const { beat, els, id } = setup();
  const origRef = JSON.parse(JSON.stringify(refOf(beat, id, 0, 0)));
  const pickRow = openPicker(els, 0, 0);
  const cand = pillsOf(pickRow).find(p => !isCur(p));
  playBtnOf(cand).fire("click");
  ok(!!beat.Arrange.candPreviewState(), "第一次点 ▶ 进入试听");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 1 }), "试听中 ref = 候选 idx1");
  playBtnOf(cand).fire("click");                    // 再点同一个 ▶（isCandActive → 停止）
  eq(JSON.stringify(beat.Arrange.candPreviewState()), JSON.stringify(null), "★ 再点 ▶ 停止：candPreview 置空");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify(origRef), "★ 停止后内存 ref 复原为原 idx0");
  beat.Arrange.close();
}

/* ================= T129d：换型前先清试听（ref 即永久，无需还原） ================= */
section("T129d 点胶囊换型 · 先清试听再提交（候选变永久）");
{
  const { beat, els, id } = setup();
  const pickRow = openPicker(els, 0, 0);
  const cand = pillsOf(pickRow).find(p => !isCur(p));            // 第一个非当前 = idx1
  const other = pillsOf(pickRow).find(p => !isCur(p) && p !== cand);  // 第二个非当前 = idx2
  playBtnOf(cand).fire("click");
  ok(!!beat.Arrange.candPreviewState(), "换型前先进入试听态（试听 idx1）");
  other.fire("click");                                          // 点另一个候选胶囊本体 = 换型到 idx2（提交）
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify({ type: "builtin", idx: 2 }), "★ 换型提交：ref 永久变 idx2（未被误还原成原 idx0）");
  eq(JSON.stringify(beat.Arrange.candPreviewState()), JSON.stringify(null), "★ 换型后候选试听态已清（未残留）");
  eq(els["argUndo"].disabled, false, "★ 换型产生了可撤销的历史（证明是真实提交，不是试听残留）");
  beat.Arrange.close();
}

/* ================= T129e：关浮层还原候选试听 ================= */
section("T129e 关浮层 · 还原内存候选换型");
{
  const { beat, els, id } = setup();
  const origRef = JSON.parse(JSON.stringify(refOf(beat, id, 0, 0)));
  const pickRow = openPicker(els, 0, 0);
  const cand = pillsOf(pickRow).find(p => !isCur(p));
  playBtnOf(cand).fire("click");
  ok(!!beat.Arrange.candPreviewState(), "关浮层前处于试听态");
  beat.Arrange.close();                             // close() 应调 stopCandPreview 还原
  eq(JSON.stringify(beat.Arrange.candPreviewState()), JSON.stringify(null), "★ 关浮层后 candPreview 置空");
  eq(JSON.stringify(refOf(beat, id, 0, 0)), JSON.stringify(origRef), "★ 关浮层后内存 ref 复原为原 idx0");
}
