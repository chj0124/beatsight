/* BeatSight 自动化测试 · 整首连播 × 预备拍（v2.8.2 回归）
   T80。
   ---------------------------------------------------------------------------
   用户实拍 bug：「整首连播在打开预备拍时，小球动画会跳过第一小节的最后两拍。」

   根因：预备拍的**视觉门控**原先写作 `if (ciBeats > 0 && c.currentTime < loopStart)`
   （在 paintFrameBody 里）。而 ciBeats 在预备拍数完后**永不清零**（仅 stop() 清零），
   且 loopStart 会在播放途中被"型/块切换"重映射到未来——曲式（整首连播）每到一个段/块边界，
   schedOneStep 的挂起消费分支就执行 `loopStart = nextNoteTime - schedBar*sig*spb()`，
   把 loopStart 改写成**段边界那个未来时刻**（约等于前瞻窗口 scheduler 提前排到的那一刻）。
   于是门控重新成立：状态栏切回「预备拍 · 4 / 4」、paintFrameBody 在调用 paintBall 之前就
   early-return —— 小球冻结，且恰好冻在"段边界前一个前瞻窗口"那段时长上
   （前台 300ms ≈ 240BPM 下单拍 0.25s 还多，所以观感就是"跳过第一小节最后两拍"）。

   修复：引入独立的 ciEnd（= start() 里延时后的 loopStart），门控只认 ciEnd；
   ciEnd 仅在 start() 设置、stop() 清零，播放中不受任何 loopStart 重映射影响。
   见 index.html 的 ciStart/ciBeats/ciNext/ciLeft/ciEnd 声明处注释。

   本用例刻意让**第 1 段只有 1 小节**：这样第一个段边界就落在第 1 小节末尾，
   缺陷窗口（段边界前的 ~一个前瞻窗口）正好盖住第 1 小节的末拍，断言读起来直接对应
   "小球跳过第一小节最后两拍"这句用户描述。用 240BPM：一小节 = 4 拍 × 0.25s = 1s。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

/* 1 小节的自定义型（4 个四分：48×4 = 192 = 4×TPB，必须小计等于整小节才过结构校验）。
   用它的目的是让段长 = 1 小节，使"段边界"紧贴第 1 小节末尾——见文件头说明。 */
const ONE = { id: "one", name: "一小节型", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] };
const TWO = { id: "two", name: "一小节型B", meter: 4, bars: [[{ t: 24 }, { t: 48 }, { t: 48 }, { t: 72 }]] };
const arrangeSeed = (on, beats) => loadApp({
  "beatsight.customs": JSON.stringify({ v: 1, customs: [ONE, TWO] }),
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "t1", name: "一+一",
    sections: [
      { name: "A", blocks: [{ ref: { type: "custom", id: "one" }, repeats: 1 }] },
      { name: "B", blocks: [{ ref: { type: "custom", id: "two" }, repeats: 1 }] },
    ] }] }),
  "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange",
    arrangeSel: { id: "t1", from: 0, to: 1, loop: false },
    countIn: { on: on, beats: beats } }),
});

/* 逐帧驱动并采集状态栏读数：返回预备拍是否出现/结束、是否在结束后**又**出现，以及
   若干可观测事实。判据刻意做成"趋势不变量"（预备拍只该在开头出现一次），
   不写死任何一帧的时刻——帧与调度边界的对齐随前瞻窗口变化，写死会因时序误判。 */
function run(app, seconds){
  const beat = app.beat, els = app.els;
  const ac = FakeAudioContext.last;
  let sawCi = false, leftCi = false, reenter = null;
  let sawBar1Beat4 = false, reachedSec1 = false;
  const dt = 0.02, n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++){
    ac.currentTime += dt;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const st = els["statusText"].textContent;
    const isCi = st.indexOf("预备拍") >= 0;
    if (isCi){
      sawCi = true;
      if (leftCi && reenter === null) reenter = { t: +ac.currentTime.toFixed(3), st };
    } else if (sawCi) leftCi = true;
    if (st.indexOf("播放中 · 第 1 小节 · 4") >= 0) sawBar1Beat4 = true;
    if (beat.arrangeState().sec === 1) reachedSec1 = true;
    if (!beat.Store.S.playing) break;
  }
  return { beat, els, ac, sawCi, leftCi, reenter, sawBar1Beat4, reachedSec1 };
}

/* ================= 场景 T80：有预备拍 · 整首连播跨段不重入门控 ================= */
section("T80 整首连播 × 预备拍（跨段不再重入门控 / 小球不跳过首小节末拍）");
{
  const app = arrangeSeed(true, 4);
  app.beat.Controls.start();
  eq(app.beat.Store.S.countIn.on, true, "前提：预备拍已打开");
  eq(app.beat.arrangeState().mode, "arrange", "前提：处于曲式（整首连播）模式");

  const r = run(app, 2.4);
  ok(r.reachedSec1, "前提：已越过第 1 段/第 2 段的段边界（缺陷正是在这个边界重入门控）");
  ok(r.sawCi, "★ 起播确实进入了预备拍（不是把预备拍整个动画都丢了）");
  ok(r.leftCi, "预备拍正常结束、进入正式播放");
  ok(r.reenter === null,
     "★ 预备拍结束后**不再重入**（缺陷版在此处会因段边界把 loopStart 改写到未来而重入门控）："
     + (r.reenter ? `第 ${r.reenter.t}s 状态栏回退成「${r.reenter.st}」` : "全程只出现一次"));
  ok(r.sawBar1Beat4,
     "★ 第 1 小节末拍（第 4 拍）的状态栏读数出现过——缺陷版正是把它连同前一拍一起藏掉");
  r.beat.Controls.stop();
}

/* ================= 场景 T80b：无预备拍时行为不变（对照） ================= */
section("T80b 整首连播 · 关闭预备拍时不受影响（对照组）");
{
  const app = arrangeSeed(false, 4);
  app.beat.Controls.start();
  const r = run(app, 2.4);
  ok(r.reachedSec1, "关闭预备拍照常播放到第 2 段");
  ok(!r.sawCi, "★ 全程不出现「预备拍」（门控 else 分支 ciBeats=0/ciEnd=0 恒不进入）");
  ok(r.sawBar1Beat4, "第 1 小节末拍读数照常出现（既有行为一字未改）");
  r.beat.Controls.stop();
}
