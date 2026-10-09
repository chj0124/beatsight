/* BeatSight 自动化测试 · resyncToNow 跨圈接续 + 循环起点挂起（v3.42.1 审计 P0-1 / P2-4）
   ---------------------------------------------------------------------------
   P0-1：resyncToNow 原先按「位置恒小于一圈」折叠重建（% loopTicks），而播放中
   nextNoteTime 跨圈单调增长、loopStart 从不重锚（回绕只动游标）——播过一圈后
   （1 小节型 @96BPM 仅 2.5s）播放中切型必然把 nextNoteTime 放到过去 → 下一调度周期
   被饥饿守卫劫持成 reanchor("starved")：相位重置、reanchorStarved 误计、假「后台断音」
   解释条（bgStarved 误置）。
   为什么 T20/T21 测不到：T20 只在 0.5 圈处切（其注释自认「1 小节型的 resync 行为另查」）；
   T21 守的四条不变量（立即切 / 不排过去 / 时刻单调 / 不中断）reanchor 路径全部满足。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

/* ================= 场景 T232a：播过整圈后切型 → 同相位接续，不再误触发饥饿重锚 ================= */
section("T232a 播过整圈（4 圈）后播放中切型：reanchor 不触发 + 新音不落在已排旧音之前");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.countIn.on = false;
  S.sel = { type: "builtin", idx: 0 };          // 四分基础：1 小节 4/4，圈长 2.5s @96BPM
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 10.0);                        // 4 整圈——旧实现此处切型必触发 reanchor
  const tClick = ac.currentTime;
  const nBefore = ac.hits.length;
  eq(beat.diag.reanchorStarved, 0, "前提：切型前零重锚（全程前台，从未被节流）");

  S.sel = { type: "builtin", idx: 7 };          // 三连音基础——预设点击在播放中走的就是这条路径
  beat.Presets.refreshAfterPatternChange();
  drive(ac, beat, 1.2);                         // 窗口 ≥ 1 圈内相位差 + 3 颗三连音（16t ≈ 0.208s）

  eq(beat.diag.reanchorStarved, 0, "★ 切型不触发饥饿重锚（旧实现必 +1：从未切过后台却被记为被饿）");
  eq(beat.activePattern().name, "三连音基础", "点下即生效（发声快照同步切到新型）");
  const oldTail = ac.hits.slice(0, nBefore).filter(h => h.t > tClick).map(h => h.t);
  const newHits = ac.hits.slice(nBefore);
  ok(newHits.length >= 3, "切换后持续发声（实测 " + newHits.length + " 颗）");
  if (oldTail.length){
    const firstNew = Math.min.apply(null, newHits.map(h => h.t));
    ok(firstNew >= Math.min.apply(null, oldTail) - 1e-3,
      "★ 只向前：新音不早于已排入的旧音（旧实现 10.07 < 旧尾 10.08 = 切换瞬间 10ms 双音重叠）");
  }
  const gaps = newHits.slice(1).map((h, i) => +(h.t - newHits[i].t).toFixed(3));
  ok(gaps.length > 0 && gaps.every(g => Math.abs(g - 0.208) < 0.01),
     "接续后全是三连音密度（≈0.208s/颗，实际 " + gaps.slice(0, 4).join(",") + "）");
  ok(S.playing, "播放未中断");
}

/* ================= 场景 T232b：整圈外重复点击同一型 → 跨点击零跳动（幂等） ================= */
section("T232b 近 3 圈处重复点击当前型：跨点击整段间隔恒为四分（不跳针/不漏音/不重音）");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.countIn.on = false;
  S.sel = { type: "builtin", idx: 0 };
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 7.3);                         // 近 3 圈、小节中段——旧实现在此重复点击也会被 reanchor 劫持
  beat.Presets.refreshAfterPatternChange();     // 重复点当前节奏型：应完全无副作用（T20 幂等口径的跨圈版）
  drive(ac, beat, 3.0);                         // 窗口跨过点击点前后各若干颗（0.625s/颗）
  const hits = ac.hits.map(h => h.t).filter(t => t >= 6.0);
  const gaps = hits.slice(1).map((t, i) => +(t - hits[i]).toFixed(3));
  ok(gaps.length > 4 && gaps.every(g => Math.abs(g - 0.625) < 0.005),
     "跨整圈重复点击整段间隔恒为四分 0.625s（实际 " + gaps.slice(0, 6).join(",") + "）");
  eq(beat.diag.reanchorStarved, 0, "重复点击同样不触发重锚");
}

/* ================= 场景 T232c：循环区间拽回 → 区间起点立即开始，不落过去/不等一圈 ================= */
section("T232c 循环区间拽回（区间外切型）：起点对齐「现在稍后」，reanchor 不触发");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.countIn.on = false;
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四分载体", meter: 4,
    bars: [0, 1, 2, 3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }));
  S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 9.0);                         // 游标在第 4 小节（b=3）
  const tClick = ac.currentTime;
  S.loopRange = { on: true, from: 0, to: 1 };   // 中途开循环 [第 1-2 小节]
  S.sel = { type: "builtin", idx: 7 };          // 切三连音 → resync：b=3 > to=1 → 拽回 from=0
  beat.Presets.refreshAfterPatternChange();
  drive(ac, beat, 0.6);
  eq(beat.diag.reanchorStarved, 0, "★ 拽回不借道 reanchor（旧实现 nextNoteTime 落到过去，被饥饿守卫劫持）");
  eq(beat.activePattern().name, "三连音基础", "切换已生效");
  const after = ac.hits.filter(h => h.t >= tClick).map(h => h.t);
  ok(after.length >= 2, "拽回后持续发声（实测 " + after.length + " 颗，含固有无法撤回的旧尾）");
  ok(after.every(t => t >= tClick - 1e-3), "无排到过去的音符");
  /* 拽回语义 = 从区间起点重新开始且**立即**（与 rescheduleLoop 同口径）：
     点击后 0.6s 内应出现三连音密度（0.208s）的相邻对——旧尾是四分密度（0.625s），混不进来 */
  const g208 = [];
  for (let i = 1; i < after.length; i++){
    if (after[i] - after[i - 1] > tClick + 0.6) break;
    if (Math.abs((after[i] - after[i - 1]) - 0.208) < 0.01) g208.push(i);
  }
  ok(g208.length >= 1, "★ 区间起点立即开始（0.6s 内出现三连音密度对，实际间隔 "
    + after.slice(1).map((t, i) => (t - after[i]).toFixed(3)).slice(0, 5).join(",") + "）");
}

/* ================= 场景 T232d：循环开着时拍号变化的挂起 → 在循环起点应用（P2-4） ================= */
section("T232d 循环 [3-4 小节] + 拍号变化挂起：游标永不经过 0 → 旧判据永久推迟，新判据在循环起点应用");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.countIn.on = false;
  /* 在播型必须真是 4 小节：loopRangeFor 会把区间按**当前型**的小节数收窄，
     1 小节型（如四分基础）下 [2,3] 会被收窄成 [0,0]——那是另一条合法路径，不是本场景 */
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四分载体", meter: 4,
    bars: [0, 1, 2, 3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }));
  S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "三拍载体", meter: 3,
    bars: [0, 1, 2, 3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }]) }] }));
  const target = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  S.loopRange = { on: true, from: 2, to: 3 };   // 循环第 3–4 小节：游标 2→3→2，**永不经过 0**
  beat.Controls.start();                        // 起播落在循环起点 bar 2（appliedSig=4）
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3.0);                         // 走进循环
  S.sig = 3;                                    // 目标型 3/4：选型路径已把拍号切到 3（appliedSig 仍 4）
  beat.Presets.scheduleRef(target);             // 与曲式块切换同一登记入口 → sigChgPending=true
  eq(beat.Presets.consumePending(0).applied, false,
    "★ 游标 0 不是本循环的起点（旧判据 schedBar===0 会在此立刻应用，与「等循环起点」的注释语义相悖）");
  drive(ac, beat, 6.0);                         // 游标 3→2（回到循环起点）→ 应用
  eq(beat.diag.reanchorStarved, 0, "前提：全程零重锚");
  eq(beat.activePattern().meter, 3,
    "★ 挂起的拍号切换在循环起点（第 3 小节）生效（旧实现：永不应用，直到停止才由 flushPending 兜底）");
  ok(S.playing, "应用过程播放不中断");
}
