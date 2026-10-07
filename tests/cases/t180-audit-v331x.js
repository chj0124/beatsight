/* BeatSight 自动化测试 · v3.31.x 落地审计 ②交互/状态收口（P0-3/P0-4/P1-1/P1-2/P1-4/P1-5/P1-6/P1-7/P2-1/P2-4/P3-* + S-2/S-3/S-4）
   ---------------------------------------------------------------------------
   逐条对应审计报告的缺陷编号（P0-1 由 check-lint 的 no-children-array-method 与
   smoke 真 DOM 探针把守；P0-2/P1-3/P1-8/P1-9 在 t179）。
   ★ 反向验证锚点（变异清单，见各节注释）：每条至少一处「回退修复 → 具名断言变红」。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
/* ★ v3.35.7：型可能挂在歌行/「未归属」行下（不在 presetList 直接子节点）⇒ 按名字取条目要走整棵子树 */
const presetItems = els => {
  const out = [];
  const walk = n => Array.from(n.children || []).forEach(c => {
    if (/(^| )preset-item( |$)/.test(c.className)) out.push(c);
    walk(c);
  });
  walk(els["presetList"]);
  return out;
};
const audBtnOf = item => item.children.find(c => (c.className || "").split(/\s+/).indexOf("aud") >= 0);
const itemByName = (els, name) => presetItems(els).find(p => p.children[0] && p.children[0].children[0]
  && p.children[0].children[0].textContent === name);
/* ★ v3.35.7：无归属的自定义型挂在「未归属」行下、默认收起；取型前先展开它。 */
const expandOrphanRow = els => {
  const orph = presetItems(els).find(c => /(^| )song-only( |$)/.test(c.className));
  if (orph && orph.getAttribute("aria-expanded") === "false") orph.fire("click");
};
const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));

/* ================= 场景 T180a：P0-4 试听换对象还原拍号 ================= */
section("T180a 预设试听 · 换对象后停止，拍号还原到选中型（此前错配→basicPattern 静默回退）");
{
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, sel: { type: "builtin", idx: 1 } }) });
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "三拍试听甲", meter: 3, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }]] },
    { name: "五拍试听乙", meter: 5, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] },
  ] }));
  beat.Presets.buildPresetList();
  expandOrphanRow(els);                             // ★ v3.35.7：两条导入型无归属 → 挂在「未归属」行下，先展开
  const mSel = beat.curPattern().meter;             // builtin/1 = 四分基础 4/4
  const a = itemByName(els, "三拍试听甲"), b = itemByName(els, "五拍试听乙");
  ok(!!a && !!b, "前提：两条不同拍号的导入型已在列表");
  audBtnOf(a).fire("click");
  eq(beat.Store.S.sig, 3, "试听 3/4 → 拍号临时对齐");
  const b2 = itemByName(els, "五拍试听乙");         // 试听会触发列表重建：引用每次现取（t118 同口径）
  audBtnOf(b2).fire("click");                       // ★ 换对象（P0-4 正体：旧拍号被覆盖的路径）
  eq(beat.Store.S.sig, 5, "换试听 5/4 → 拍号跟新题");
  const b3 = itemByName(els, "五拍试听乙");
  audBtnOf(b3).fire("click");                       // 停止试听
  eq(beat.Store.S.preview, false, "试听已退出");
  eq(beat.Store.S.sig, mSel, "★ 停止后 S.sig == 选中型拍号（此前停在 3，curPattern 静默回退 basicPattern）");
  eq(beat.curPattern().meter, mSel, "★ curPattern() 返回选中型（不再静默回退基础型）");
  /* 反向验证锚点：删掉切换分支的 stopAudition() 还原 → 上面两条 eq 变红（sig 停在 3）。 */
}

/* ================= 场景 T180b：P0-3 候选试听不被无关写操作持久化 ================= */
section("T180b 候选试听 · 无关曲式写操作不得把「试听的型」落库（此前静默换型成真）");
{
  const { beat, els, storage } = loadApp();
  ok(beat.Store.upsertArrange({ id: "a-main", name: "主角", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }, { ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
  ] }), "曲式 A 落库");
  ok(beat.Store.upsertArrange({ id: "a-other", name: "配角", sections: [
    { name: "B", blocks: [{ ref: { type: "builtin", idx: 2 }, repeats: 1 }] },
  ] }), "曲式 B 落库");
  const origRef = JSON.stringify(beat.Store.findArrange("a-main").sections[0].blocks[1].ref);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  /* 打开第 1 段第 2 块的换型候选行并点一个非当前候选的 ▶（t129 的 UI 路径） */
  const secRow = els["argSections"].children.filter(c => !/(^| )arg-pick( |$)/.test(c.className))[0];
  const blks = byCls(secRow, "arg-blocks");
  const chip = blks.children.find(c => c.className && /(^| )arg-block( |$)/.test(c.className)
    && Array.prototype.some.call(c.children, k => k.getAttribute && k.getAttribute("aria-label")
      && k.getAttribute("aria-label").includes("换第 1 段第 2 块")));
  ok(!!chip, "前提：第 2 块的块行");
  Array.prototype.find.call(chip.children, k => k.getAttribute && k.getAttribute("aria-label")
    && k.getAttribute("aria-label").includes("换第 1 段第 2 块")).fire("click");
  const pick = els["argSections"].children.find(c => c.className && c.className.includes("arg-pick"));
  ok(!!pick, "候选行展开");
  const pills = Array.prototype.filter.call(byCls(pick, "arg-blocks").children,
    c => c.className && c.className.includes("arg-mini"));
  const cand = pills.find(p => !(p.textContent || "").startsWith("✓"));
  ok(!!cand, "前提：有非当前候选");
  Array.prototype.find.call(cand.children, c => c.className && c.className.includes("arg-pill-play")).fire("click");
  ok(!!beat.Arrange.candPreviewState(), "★ 进入候选试听态");
  const refInMem = JSON.stringify(beat.Store.findArrange("a-main").sections[0].blocks[1].ref);
  ok(refInMem !== origRef, "内存里确实是候选型");

  /* ★ 试听期间给**另一条**曲式改名（此前会把候选 ref 一起序列化落库） */
  ok(beat.Store.renameArrange("a-other", "配角改"), "改名成功（触发 persistArranges）");
  eq(beat.Arrange.candPreviewState(), null, "★ 守卫先还原：候选试听态被收口（不把试听态吞进盘）");
  eq(JSON.stringify(beat.Store.findArrange("a-main").sections[0].blocks[1].ref), origRef,
     "★ 主角曲式的 ref 仍是原值（未被候选污染）");
  const saved = JSON.parse(storage.get("beatsight.arranges"));
  const savedMain = saved.arranges.find(x => x.id === "a-main");
  eq(JSON.stringify(savedMain.sections[0].blocks[1].ref), origRef,
     "★ 冷键里也是原值（此前「只试听过、从未确认」的型被持久化）");
  /* 反向验证锚点：删掉 Arrange 的 setArrPersistGuard 注入 → 上面三条断言变红。 */
}

/* ================= 场景 T180c：P1-1 Modal Enter 焦点感知 ================= */
section("T180c 弹窗 · 焦点在「取消」上按 Enter 走取消（此前执行确认）");
{
  const app = loadApp();
  const { beat, els, sandbox, fireWin } = app;
  let called = false;
  beat.Modal.uiConfirm("危险操作确认", () => { called = true; });
  ok(beat.Modal.isOpen(), "前提：弹窗开");
  sandbox.document.activeElement = els["modalCancel"];   // 焦点在取消上
  fireWin("keydown", { key: "Enter" });
  eq(called, false, "★ 取消焦点上按 Enter 不执行确认");
  eq(beat.Modal.isOpen(), false, "弹窗已关（按取消语义关闭）");
  /* 反向验证锚点：把 closeModal 的焦点判定退回恒 true → called 变 true、本条变红。 */
}

/* ================= 场景 T180d：P1-2 训练完成态复位 ================= */
section("T180d 训练 · 完成后开关复位，重播不再自动停（此前「训练卡死循环」）");
{
  const { beat, els, storage } = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, target: 90, step: 10, everyN: 1 } }) });
  beat.Controls.setBpm(70, false);
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 30);
  eq(beat.Store.S.playing, false, "练到目标自动停止");
  eq(beat.Store.S.trainer.on, false, "★ 完成后开关复位（此前恒 true）");
  eq(els["trainerToggle"].className.includes("off"), true, "★ 开关 UI 复位");
  beat.Controls.start();                             // 重播：应以 90 正常播放
  drive(FakeAudioContext.last, beat, 6);
  eq(beat.Store.S.playing, true, "★ 重播持续播放（此前每 everyN 小节再次自动停）");
  beat.Controls.stop();
  beat.Store.flush();                                // 桩不执行防抖定时器：显式落热键
  const savedHot = JSON.parse(storage.get("beatsight.state"));
  eq(savedHot.trainer.on, false, "★ 复位进热键（重载不再复现）");
  /* 反向验证锚点：删掉完成分支的 S.trainer.on=false → 重播断言红（playing 变 false）。 */
}

/* ================= 场景 T180e：P1-4 听辨按稳定下标出题（改名免疫） ================= */
section("T180e 听辨 · 改名内置型不破坏题组（此前按显示名匹配、改名即失效）");
{
  const { beat } = loadApp();
  const idx = beat.BUILTINS.findIndex(p => p.name === "八分摇滚");
  ok(idx >= 0, "前提：八分摇滚在内置库");
  beat.Store.renameBuiltin(idx, "我的摇滚");
  for (let k = 0; k < 30; k++){
    const q = beat.Ear.makeQuestion(Math.random);
    ok(!!q, "★ 改名后仍能出题（此前 cands 凑不够 2 个 → 概率性 null）");
    eq(q.cands.length, 3, "候选恒 3 个");
  }
  beat.Store.renameBuiltin(idx, "");                 // 恢复原名（清覆盖）
  eq(beat.BUILTINS[idx].name, "八分摇滚", "恢复原名");
  /* 反向验证锚点：把 makeQuestion 的 idxs 分支退回按名字 find → 上面 30 次循环出现 null、变红。 */
}

/* ================= 场景 T180f：P1-5 srcRefs 主入口提示生效 ================= */
section("T180f 编辑器 · 「被 N 首曲式引用」提示在主入口生效（此前恒空）");
{
  /* ★ v3.35.5：带 bnmig35 戳——sel 与下面曲式块的 idx1 必须同为新表下标，提示才验得到 */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, sel: { type: "builtin", idx: 1 } }),
    "beatsight.bnmig35": "1" });
  ok(beat.Store.upsertArrange({ id: "a-src", name: "引用四分基础", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
  ] }), "曲式引用 builtin idx1");
  beat.Editor.open();                                // 主入口：openWith(curPattern())
  ok(els["editorRefNote"].textContent.indexOf("被 1 首曲式引用") >= 0,
     "★ 提示显示引用数（此前 src.type/idx 恒 undefined → 恒空）");
  beat.Editor.tryClose();
  /* 反向验证锚点：把 srcRefs 退回 type/idx 判据 → 提示为空、本条变红。 */
}

/* ================= 场景 T180g：P1-6 键盘移字搬行 ================= */
section("T180g 歌词 · 键盘 ←/→ 跨小节移动就地搬行（此前字块渲染错行）");
{
  const { beat, els, fireWin } = loadApp();
  ok(beat.Store.upsertArrange({ name: "搬行曲式", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
  ] }), "两小节曲式（4/4 四分基础 ×2 遍 = 2 小节）");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  const id = arr.id, uid = arr.sections[0].uid;
  beat.Arrange.open();
  const ly0 = lyOf(els, 0);
  const sum = byCls(ly0, "arg-lyric-sum");
  sum.fire("click");                                 // 展开（空词，t118 同序）
  beat.Store.upsertLyric(id, uid, [{ t: 192, dur: 24, ch: "啊" }]);  // t=192 = 第 2 行起点（桩 span=384 / 行 192t 的行边界）
  sum.fire("click"); sum.fire("click");              // 收起再展开：按新词重渲染（t118 同序）
  const ly = lyOf(els, 0);
  const lane = byCls(ly, "arg-lyric-lane");
  const chips = chipsOf(lane);
  eq(chips.length, 1, "前提：一个字块");
  const chip = chips[0];
  const parentBefore = chip.parentNode;
  chip.fire("pointerdown", { clientX: 100 });        // 点按选中
  fireWin("pointerup", {});
  chip.fire("keydown", { key: "ArrowLeft" });        // t=192 → 180：跨回第 1 行
  ok(chip.parentNode !== parentBefore,
     "★ 跨行后字块已搬进新行容器（此前留在旧行按新坐标定位 → 错位一整行）");
  const ch = beat.Store.findLyric(id, uid);
  eq(ch.chars[0].t, 180, "数据按网格粒度移动（192 − 12）");
  beat.Arrange.close();
  /* 反向验证锚点：删掉 moveChipKey 的 appendChild 搬行 → parentNode 不变、断言变红。 */
}

/* ================= 场景 T180h：P1-7 旧键 null 条目不崩 ================= */
section("T180h 迁移 · 旧键 customs 含 null 条目照常启动（此前整站白屏）");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ v: 2, customs: [
    null,
    { name: "老四四", meter: 4, bars: [[{ d: 1 }, { d: 1 }, { d: 1 }, { d: 1 }]] },
  ] }) });
  ok(!!beat.Store.S, "★ Store 正常初始化（此前 c.bars 抛 TypeError → S 缺失）");
  eq(beat.Store.customs.length, 1, "合法条目照常迁移（d→t 换算），null 条目跳过");
  eq(beat.Store.customs[0].bars[0][0].t, 48, "d=1 → t=48（老格式迁移未受影响）");
  /* 反向验证锚点：删掉 forEach 首行的条目守卫 → loadApp 直接抛错（崩溃型被拦），
     按变异纪律 1 人工确认堆栈指向本迁移循环后再验收。 */
}

/* ================= 场景 T180i：P2-1 随机静音缓存封顶 ================= */
section("T180i 静音拍 · 随机缓存封顶（此前按组号无界增长）");
{
  const { beat } = loadApp();
  beat.Store.S.mute = true;
  beat.Store.S.muteCfg = { period: 4, count: 1, random: true };
  for (let g = 0; g < 3000; g++) beat.muteBarMuted(g * 4);   // 每 period 一条缓存键
  ok(beat.muteCacheSize() <= 2049, "★ 缓存被 2048 封顶（此前 3000 条且随播放无界）");
  /* 反向验证锚点：删掉 muteRandSet 里的封顶 → 上面 ok 变红（size 3000）。 */
}

/* ================= 场景 T180j：P2-4 无拍号段贴词 ================= */
section("T180j 歌词 · 引用失效段的 fit 判据收口（此前静默存进不可见轨道）");
{
  const { beat } = loadApp();
  ok(beat.Store.upsertArrange({ id: "a-bad", name: "坏引用", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: "c-ghost" }, repeats: 2 }] },
  ] }), "曲式落库（块引用不存在）");
  const sec = beat.Store.findArrange("a-bad").sections[0];
  eq(beat.lyricSpanTicks("a-bad", sec.uid), 0,
     "★ 引用失效段的 span=0（distribute 的 fit=0 分支可达的前提——此前 span=0 时 fit 取 chars.length 绕过提示）");
  /* 反向验证锚点：把 distribute 的 fit 退回 span>0?…:chars.length → 真机贴词后冷键多一行且
     无提示弹窗；桩环境无粘贴 UI 完整链路，该变异标注为「需真机/冒烟驱动」。 */
}

/* ================= 场景 T180k：P3-1/P3-5/P3-7/P3-8 + S-2/S-3/S-4 ================= */
section("T180k 杂项收口 · 焦点/域/组id/zone折叠 + suspended恢复 + 滑杆锁定 + 预备拍改速");
{
  /* P3-1：空串预填焦点进输入框 */
  const a1 = loadApp();
  const inp1 = a1.els["modalInput"];
  let focused = null;
  const origFocus = inp1.focus;
  inp1.focus = () => { focused = inp1; };
  a1.beat.Modal.uiPrompt("移出分组？", "", () => {});
  eq(focused, inp1, "★ 空串预填 → 焦点送进输入框（此前真值判据落到确定键）");
  inp1.focus = origFocus;

  /* P3-5：setBpm 钳制与滑杆属性同源 */
  const a2 = loadApp();
  a2.beat.Controls.setBpm(999, false);
  eq(a2.beat.Store.S.bpm, 240, "★ 上限 = 滑杆 max（读属性，不再硬编码）");
  a2.beat.Controls.setBpm(-999, false);
  eq(a2.beat.Store.S.bpm, 30, "★ 下限 = 滑杆 min");
  a2.els["bpmSlider"].min = "40"; a2.els["bpmSlider"].max = "200";   // 模拟调域
  a2.beat.Controls.setBpm(999, false);
  eq(a2.beat.Store.S.bpm, 200, "★ 调域后钳制跟随（此前静默钳回 240）");

  /* P3-8：组 id 会话单调（同毫秒建删建不撞） */
  const a3 = loadApp();
  a3.beat.Store.groupCreate("beat", "组甲");
  const g1 = a3.beat.Store.groups[0].id;
  a3.beat.Store.groupDelete(g1);
  a3.beat.Store.groupCreate("beat", "组乙");
  const g2 = a3.beat.Store.groups[0].id;
  ok(g1 !== g2, "★ 同毫秒建→删→建 id 互异（此前 groups.length 回退 → 撞号）");

  /* P3-7：demoPresetEq 内容认型的 zone 折叠（null 与缺省同记号）——
     直接对拍构造样本（DEMO_STRUMS 字面量写显式 null、validatePreset 归一为省略，
     此前 spec 侧 "null" vs 数据侧 "" 永不相等，内容认型首选腿恒 false）。 */
  const a4 = loadApp();
  const withNull = { meter: 4, bars: [[{ t: 12 }, { t: 12, zone: null }]] };
  const omitted = { meter: 4, bars: [[{ t: 12 }, { t: 12 }]] };
  eq(a4.beat.demoPresetEq(omitted, withNull), true,
     "★ zone null 与缺省折叠判等（此前分叉 → 内容认型首选腿恒 false）");

  /* S-2：播放中 suspended → 尝试恢复（此前恢复链无入口） */
  const a5 = loadApp();
  a5.beat.Controls.start();
  const ctx = FakeAudioContext.last;
  const r0 = ctx.resumeCount;
  ctx.setState("suspended");
  eq(ctx.resumeCount > r0, true, "★ 播放中 suspended → resume 被调（此前只有 interrupted/closed 有分支）");
  a5.beat.Controls.stop();

  /* S-3：训练中滑杆锁定 */
  const a6 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, target: 200, step: 10, everyN: 4 } }) });
  a6.beat.Controls.syncBpmUI();
  eq(a6.els["bpmSlider"].disabled, true, "★ 训练中滑杆锁定（与 ±5 同口径，此前漏锁）");
  a6.beat.Store.S.trainer.on = false;
  a6.beat.Controls.syncBpmUI();
  eq(a6.els["bpmSlider"].disabled, false, "训练关 → 滑杆解锁");

  /* S-4：预备拍进行中改速 → 剩余拍按新 tempo 重排、末拍恒在 loopStart−1 拍 */
  const a7 = loadApp({ "beatsight.state": JSON.stringify({ v: 3, countIn: { on: true, beats: 4 } }) });
  const { beat: b7 } = a7;
  b7.Controls.start();
  ok(b7.ciState().left > 0, "前提：预备拍进行中（ciLeft>0）");
  const loop0 = b7.ciState().loop;
  b7.Controls.setBpm(120, false);
  const cs = b7.ciState();
  ok(cs.left > 0, "预备拍仍在进行");
  eq(cs.loop, loop0, "loopStart 在预备拍期间不漂（主锚点不动）");
  const spbNow = 60 / b7.Store.S.bpm;
  const off = Math.abs((cs.loop - cs.next) - cs.left * spbNow);
  ok(off < 1e-6, "★ ciNext = loopStart − ciLeft×spb(新)（末拍恒落在正式首音前一拍，此前新旧速度混用）");
  b7.Controls.stop();
  /* 反向验证锚点：删掉 setBpm 的 ciLeft 分支 → 上面 off 断言变红（ciNext 还按旧 spb 排）。 */
}

/* ================= 场景 T180l：P3-3 删光曲式清底栏 ================= */
section("T180l 预设库 · 删光曲式后底栏范围控件清空（此前滞留死滑块）");
{
  const { beat, els } = loadApp();
  beat.Store.deleteArrange(beat.DEMO_ID);            // 出厂示例曲在库 → 删光
  eq(beat.Store.arranges.length, 0, "前提：曲式库已空");
  beat.Presets.buildPresetList();
  /* 纪律 3（变异下不崩溃）：安全读取——回退修复后这两个元素可能未被创建（懒桩），
     用哨兵值报「未创建」而不是让整套用例 TypeError。 */
  const pbKids = els["pbProgress"] ? els["pbProgress"].children.length : "(未创建)";
  const psKids = els["pbSub"] ? els["pbSub"].children.length : "(未创建)";
  eq(pbKids, 0, "★ 空库 → pbProgress 清空（此前滞留一套死滑块）");
  eq(psKids, 0, "★ 空库 → pbSub 清空");
  /* 反向验证锚点：删掉 buildArrangeGroup 空库分支的两行 innerHTML 清理 → 上面两条变红。 */

  /* ★★ v3.36.10（批次② D2，本轮审计 C-10）：自定义库为空时要给一条**去新建**的引导。
     此前这个状态在界面上一声不响——审计问的正是"清空预设库后界面长什么样"，实测：
     只剩内置「节拍」区，没有任何提示（新用户首开也是这个状态）。 */
  const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
  ok(deepText(els["presetList"]).includes("还没有自己的节奏型"),
    "★★ 空自定义库 → 有「去新建一个」的引导（此前一片空白）");
  /* 反向：有型时不该出现——引导只在**真的一个自定义型都没有**时给，不打扰有型的人 */
  const b2 = loadApp();
  b2.beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "有型的用户", meter: 4, song: "歌", bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  b2.beat.Presets.buildPresetList();
  ok(!deepText(b2.els["presetList"]).includes("还没有自己的节奏型"),
    "★ 有自定义型时不出现该引导（不打扰有型的人）");
}
