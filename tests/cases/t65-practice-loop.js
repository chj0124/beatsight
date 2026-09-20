/* BeatSight 自动化测试 · 练习循环（v2.4.3）
   T65 系列。
   ---------------------------------------------------------------------------
   契约（用户拍板「两种都要」→ 一个区间 = 一个开关）：
     ① 「循环本段」按钮 = 一键把区间置为整段 [0, 3]，已是整段时再点即关；
     ② 两个下拉「第 X 到第 Y 小节」= 精确指定，改完**顺手开启**循环；
     ③ 两者**互斥**：共用 S.loopRange.on 一个开关（物理上不可能出现两个真相）；
     ④ 只作用于预设模式；曲式模式下整个面板收起；
     ⑤ 持久化跟热键走（练习偏好，不是会话状态）；
     ⑥ 脏值一律经 clampLoop 归位，**且必须保证 from <= to**（空区间会让调度器卡死）。

   本组最要紧的两条断言，都不是"开关亮了没有"，而是**调度器真的按区间回绕了没有**：
     · T65d：从 [1,2] 起播，走满 3 小节，实际响过的小节编号必须**恒在 {1,2} 内**
       （若回绕没生效，第 3 小节会被排出来 → 立刻抓到）；
     · T65e：开播时游标必须落在 from（少了 loopStartBar，第一遍会从 0 白弹到 from，
       功能看着生效、起点是错的——这种"看起来对了"的缺陷只有断言起始小节才抓得到）。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

/* 从 FakeAudioContext 的排程记录里还原「每个音符落在第几小节（0 基）」。
   ★ 为什么不用 onsetBuf：它是**已发出**的端点，会被修剪（>8 条且早于 now-1s 就 shift），
     长驱动下早期小节会被丢掉。`ac.hits` 是桩上**只增不删**的发声流水，
     其 `t` 就是 osc.start(t) 的绝对音频时刻，是更可靠的独立来源。
   默认型是民谣扫弦：4/4、96BPM → 一小节 2.5s

   ★★ v2.4.3 的教训（本组第一版就是这么写错的，值得记下来）：
     把首音当 t0、再 floor((t-t0)/barSec) 得出的"小节号"**不是真的小节号**——
     循环开启后首音落在 from，于是 from 被标成 0、from+1 标成 1……整体平移。
     更糟的是：4 小节的型里各小节的**音符数完全相同**时，纯靠"时刻除小节长"
     根本无法区分第 1 与第 2 小节——两个不同的真相会给出同一串读数，
     于是"没回绕"与"回绕了但被平移"看起来一模一样（第一版正是在这里误判成"功能没生效"）。
     结论：**要断言小节身份，就得让各小节的发声可区分**。下面的 testBars 用
     「每小节音符数不同」的定制型（第 i 小节排 i+1 颗音），于是小节身份可由
     "音数"直接读出，与时刻平移、与 barSec 估算全都无关。 */
function barsScheduled(ac, barSec){
  const ts = ac.hits.filter(h => h.kind === "osc").map(h => h.t)
    .filter(t => typeof t === "number" && isFinite(t));
  if (!ts.length) return [];
  const t0 = Math.min(...ts);
  return ts.map(t => Math.floor((t - t0) / barSec + 1e-6));
}

/* 定制型：第 i 小节排 (i+1) 颗音（i=0..3 → 1/2/3/4 颗）。
   为什么这么排：一小节的"音数"就是它的指纹，于是从 ac.hits 里按小节切段、
   数每段几颗音，就能唯一确定"响过哪些小节"——不依赖任何时刻估算。
   ★ 时值必须取 **VALID_T 里的合法档**，且每小节和恰好 192（=meter×TPB，4×48）：
     · 1 颗 → 192
     · 2 颗 → 96 + 96
     · 3 颗 → 96 + 48 + 48        （不能用 192/3=64，64 不是合法档）
     · 4 颗 → 48 × 4
   不满足这两条会被 validatePreset 静默丢进隔离区，全组断言会以"没有音符"崩掉 */
const FP_TICKS = [[192], [96, 96], [96, 48, 48], [48, 48, 48, 48]];
const mkFingerprintBars = () => FP_TICKS.map(ts => ts.map(t => ({ t })));
/* 从排程流水里还原「按时间顺序响过的小节**音数**（指纹）」。
   切段依据仍是 barSec，但**不要求它精确对上小节边界**：
   因为各小节音数不同（1/2/3/4），一旦边界错位，某段就会读出不合法音数，
   于是"切段正确性"本身也能被断言覆盖（见 T65d 的第一条）。
   ★ 末段一律**丢弃**：驱动结束时最后一小节往往只排到一部分（其余音符还在前瞻窗口之外），
     那半段会读出一个偏小的数、把断言带偏。丢末段是刻画"完整听过的小节"的准确口径，
     不是回避问题——T65e 恰恰要用**首段**来验起点，首段永远是完整的。 */
function barFingerprints(ac, barSec){
  const ts = ac.hits.filter(h => h.kind === "osc").map(h => h.t)
    .filter(t => typeof t === "number" && isFinite(t)).sort((a, b) => a - b);
  if (!ts.length) return [];
  const t0 = ts[0];
  const seg = [];
  ts.forEach(t => {
    const k = Math.floor((t - t0) / barSec + 1e-6);
    (seg[k] = seg[k] || []).push(t);
  });
  const out = [];
  for (let k = 0; k < seg.length; k++) if (seg[k]) out.push(seg[k].length);
  return out.slice(0, Math.max(0, out.length - 1));
}
/* T65e 专用：只要**首段**（不去尾，因为要的正是"第一小节响了什么"） */
function firstFingerprint(ac, barSec){
  const ts = ac.hits.filter(h => h.kind === "osc").map(h => h.t)
    .filter(t => typeof t === "number" && isFinite(t)).sort((a, b) => a - b);
  if (!ts.length) return null;
  const t0 = ts[0];
  return ts.filter(t => Math.floor((t - t0) / barSec + 1e-6) === 0).length;
}

/* ================= 场景 T65a：默认值 / 脏值回退 / clampLoop 契约 ================= */
section("T65a 练习循环 · 默认关 / clampLoop 归一（from<=to）/ 脏值不炸");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  eq(JSON.stringify(S.loopRange), JSON.stringify({ on: false, from: 0, to: 3 }),
     "默认：关，区间为整段 [0,3]（LOOP_BARS-1）");

  const cl = beat.Store.clampLoop;
  /* ★ 核心契约：from > to 必须被交换，而不是各自钳制后留下一段空区间。
     from=3 / to=1 各自都在 [0,3] 内、都是"合法值"——只有跨字段归一能救 */
  eq(JSON.stringify(cl({ on: true, from: 3, to: 1 })),
     JSON.stringify({ on: true, from: 1, to: 3 }), "★ from>to 被交换（空区间不可能出现）");
  /* ★ v2.5.1 口径变化：clampLoop 的域从 [0, LOOP_BARS-1] 放宽到 [0, MAX_PAT_BARS-1]。
     为什么必须放宽：型不再恒为 4 小节，而 clampLoop 跑在**加载期**（那时还不知道当前型是谁）。
     于是钳制分两层，两条断言各守一层：
       ① clampLoop（加载期）= 只做**绝对域**，保证形状与 from<=to；
       ② loopRangeFor(n)（使用期）= 按当前型的小节数二次收窄。 */
  eq(JSON.stringify(cl({ on: true, from: 9, to: -4 })),
     JSON.stringify({ on: true, from: 0, to: 9 }), "越界值钳到绝对域 [0, MAX_PAT_BARS-1] 并交换");
  eq(JSON.stringify(cl({ on: true, from: beat.MAX_PAT_BARS, to: 1 })).includes('"from":1'),
     true, "超上限（= MAX_PAT_BARS）被钳回域内（上界是开的）");
  eq(cl({ on: true, from: beat.MAX_PAT_BARS + 99, to: 1 }).to, beat.MAX_PAT_BARS - 1,
     "远超上限也被钳到 MAX_PAT_BARS-1（两步：先钳域，再交换保证 from<=to）");
  eq(JSON.stringify(cl({ on: true, from: 1.4, to: 2.6 })),
     JSON.stringify({ on: true, from: 1, to: 3 }), "小数取整（clampRange 的 Math.round）");
  eq(cl(null).on, false, "null → 关");
  eq(cl("x").on, false, "字符串 → 关");
  eq(JSON.stringify(cl({ on: 1, from: "2", to: null })),
     JSON.stringify({ on: true, from: 0, to: 3 }), "非数 from/to 回退默认（on 走 !! 强转）");

  /* ★ 第二层：loopRangeFor(n) 按"当前型的小节数"把区间收窄。
     它才是"型变短之后不会指到不存在的小节"的保证——clampLoop 做不到（它不知道型有多长）。 */
  const lrf = beat.loopRangeFor;
  S.loopRange = { on: true, from: 5, to: 5 };
  eq(JSON.stringify(lrf(4)), JSON.stringify({ on: true, from: 3, to: 3 }),
     "★ 型只有 4 小节时，存下来的 5 被收窄到 3（末小节）");
  eq(JSON.stringify(lrf(1)), JSON.stringify({ on: true, from: 0, to: 0 }),
     "★ 型只有 1 小节时，区间收成 [0,0]（不越界、也不是空区间）");
  eq(JSON.stringify(lrf(30)), JSON.stringify({ on: true, from: 5, to: 5 }),
     "型比区间长 → 原值不动（收窄是单向的）");
  /* patBars：唯一真相源，脏入参退回默认小节数 */
  eq(beat.patBars({ bars: [[], [], [], [], [], []] }), 6, "patBars 读 bars.length（6 小节）");
  eq(beat.patBars(null), beat.DEF_BARS, "patBars(null) → 默认小节数");
  eq(beat.patBars({ bars: [] }), beat.DEF_BARS, "空 bars → 默认小节数（0 小节的型没有合法解释）");

  /* 脏种子：加载路径同样只过 clampLoop（绝对域）——**按型收窄在使用期做** */
  eq(JSON.stringify(loadApp(seedState({ loopRange: { on: true, from: 5, to: 5 } })).beat.Store.S.loopRange),
     JSON.stringify({ on: true, from: 5, to: 5 }),
     "脏种子 from=to=5 → 落在绝对域内，原样存入（收窄留到使用期）");
  eq(JSON.stringify(loadApp(seedState({ loopRange: "junk" })).beat.Store.S.loopRange),
     JSON.stringify({ on: false, from: 0, to: 3 }), "loopRange 非对象 → 全默认");
}

/* ================= 场景 T65b：两个下拉的生成 / 灰显 / 联动 ================= */
section("T65b 练习循环 · 下拉生成 4 项（1 基）/ 关闭时灰显 / 改动顺手开启");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  const from = els["loopFrom"], to = els["loopTo"];

  eq(from.options.length, 4, "起始下拉生成 LOOP_BARS=4 项");
  eq(to.options.length, 4, "结束下拉生成 4 项");
  eq(from.options.map(o => o.textContent).join(","), "1,2,3,4", "选项文案是 1 基（用户数小节从 1 起）");
  eq(from.options.map(o => o.value).join(","), "0,1,2,3", "选项值是 0 基（与 S.loopRange 同口径）");
  ok(from.disabled === true && to.disabled === true, "循环关闭时两个下拉灰显（位置稳定，不藏起来）");
  eq(els["loopToggle"].getAttribute("aria-checked"), "false", "开关 aria-checked=false");

  /* 改下拉 → 顺手开启循环（用户意图已明确，不该再要求点一次开关） */
  from.value = "1";
  from.fire("change");
  eq(S.loopRange.on, true, "★ 改下拉顺手开启循环");
  eq(S.loopRange.from, 1, "from 写进去了");
  ok(from.disabled === false && to.disabled === false, "开启后下拉恢复可用");
  eq(els["loopToggle"].getAttribute("aria-checked"), "true", "开关同步为 true（单一渲染入口）");
  eq(from.value, "1", "下拉回读 S.loopRange（UI 与状态同源）");

  /* 幂等：选项已建好就不再重建（否则每次刷新都重建 DOM，选中态会被冲掉） */
  const optEl = from.options[0];
  beat.Presets.buildPresetList();
  ok(from.options[0] === optEl, "★ 选项幂等：重复刷新不重建 option 节点");
  eq(from.value, "1", "重复刷新后选中态保持不变");
}

/* ================= 场景 T65c：「循环本段」按钮的开关与归位 ================= */
section("T65c 练习循环 · 「循环本段」= 整段开关（点一次开、再点关、带归位）");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  const btn = els["loopToggle"];

  btn.fire("click");
  eq(JSON.stringify(S.loopRange), JSON.stringify({ on: true, from: 0, to: 3 }),
     "点「循环本段」→ 区间 = 整段，开");
  eq(btn.getAttribute("aria-checked"), "true", "开关 aria-checked=true");

  btn.fire("click");
  eq(S.loopRange.on, false, "再点 → 关");
  eq(JSON.stringify({ from: S.loopRange.from, to: S.loopRange.to }), JSON.stringify({ from: 0, to: 3 }),
     "关掉后区间保留（用户下次开还是整段）");

  /* ★ 归位：先选 [1,2] 并开着，再点「循环本段」——
     它应把区间拉回整段，而不是"关掉一个开着的东西"就完事 */
  S.loopRange = { on: true, from: 1, to: 2 };
  beat.Presets.syncLoopUI();
  btn.fire("click");
  eq(JSON.stringify(S.loopRange), JSON.stringify({ on: true, from: 0, to: 3 }),
     "★ 区间非整段时点它 → 归位到整段（仍是开）");
  btn.fire("click");
  eq(S.loopRange.on, false, "整段 + 开 时再点 → 关（同一颗按钮兼管开关与归位）");
}

/* ================= 场景 T65d：调度器真的按区间回绕 ================= */
section("T65d 练习循环 · 调度回绕（★ 核心：响过的小节恒在区间内）");
{
  const BAR_SEC = 2.5;                    // 4/4 @96BPM → 一小节 2.5s
  /* ★ 用「指纹型」而不是默认型：第 i 小节排 i+1 颗音，于是小节身份可从音数直接读出。
     只靠时刻除小节长是**区分不出**第 1 与第 2 小节的（两颗小节音数相同）——
     本组第一版就是这样误判成"功能没生效"的（见 barsScheduled 的注释）。 */
  const seedFp = obj => seedState(obj);
  const loadFp = (lr) => {
    const h = loadApp(seedFp({ loopRange: lr }), {});
    h.beat.Store.importPresets(JSON.stringify({
      presets: [{ name: "指纹型", meter: 4, bars: mkFingerprintBars() }],
    }));
    h.beat.Store.S.sel = { type: "custom", id: h.beat.Store.customs[h.beat.Store.customs.length - 1].id };
    h.beat.Presets.refreshAfterPatternChange();
    return h;
  };

  /* 区间 [1,2]：第 1 小节 2 颗音、第 2 小节 3 颗音。
     若回绕生效，音数序列只可能是 2,3 的交替；第 0 小节(1 颗)与第 3 小节(4 颗)一次都不该出现 */
  const h = loadFp({ on: true, from: 1, to: 2 });
  eq(JSON.stringify(h.beat.Store.S.loopRange), JSON.stringify({ on: true, from: 1, to: 2 }), "区间种子被保留");
  h.beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, h.beat, 12);                   // 约 4.8 小节
  h.beat.Controls.stop();
  const fp = barFingerprints(ac, BAR_SEC);
  ok(fp.length > 0, "确实排了音符（前置条件：有东西可断言）");
  eq(fp.every(n => n === 2 || n === 3), true,
     `★ 每一小节的音数都只可能是 2 或 3（=第 1/2 小节的指纹），实得 ${JSON.stringify(fp)}`);
  ok(fp.includes(2) && fp.includes(3), "★ 两小节都真出现过（不是只循环了其中一节）");
  /* 交替性：相邻两小节必须不同（2→3 或 3→2），证明是在两节之间往复而非停在某一节 */
  eq(fp.every((n, i) => i === 0 || n !== fp[i - 1]), true,
     `★ 相邻小节必然交替（2↔3），实得 ${JSON.stringify(fp)}`);

  /* 对照：同一段时间、同样的曲子，关掉循环 → 必然走过第 0 与第 3 小节 */
  const c2 = loadFp({ on: false, from: 1, to: 2 });
  c2.beat.Controls.start();
  const ac2 = FakeAudioContext.last;
  drive(ac2, c2.beat, 12);
  c2.beat.Controls.stop();
  const fpOff = barFingerprints(ac2, BAR_SEC);
  eq(fpOff.includes(1) || fpOff.includes(4), true,
     `★ 对照：关掉循环后同样时长会走出区间（含第 0 或第 3 小节的指纹 1/4），实得 ${JSON.stringify(fpOff)}`);
  eq(JSON.stringify(fpOff) === JSON.stringify(fp), false, "★ 开关确实改变了调度结果（不是同一串读数）");
}

/* ================= 场景 T65e：起始游标落在 from ================= */
section("T65e 练习循环 · ★ 开播即落在 from（第一遍不白弹）");
{
  const BAR_SEC = 2.5;
  /* from=2 → 第 2 小节 3 颗音。若游标从 0 起，第一小节会排出 1 颗音 → 立刻抓到 */
  const h = loadApp(seedState({ loopRange: { on: true, from: 2, to: 3 } }), {});
  h.beat.Store.importPresets(JSON.stringify({
    presets: [{ name: "指纹型", meter: 4, bars: mkFingerprintBars() }],
  }));
  h.beat.Store.S.sel = { type: "custom", id: h.beat.Store.customs[h.beat.Store.customs.length - 1].id };
  h.beat.Presets.refreshAfterPatternChange();
  h.beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 只走约 1 小节多一点：够第一小节排完即可 */
  drive(ac, h.beat, 2.6);
  h.beat.Controls.stop();
  const first = firstFingerprint(ac, BAR_SEC);
  ok(first !== null, "确实排了音符");
  eq(first, 3, `★ 开播后第一小节的音数是 3（= from=2 的指纹），而不是 1（=第 0 小节）`);
}

/* ================= 场景 T65f：持久化（热键 250ms 防抖） ================= */
section("T65f 练习循环 · 写进热键 beatsight.state（练习偏好）");
{
  const { beat, els, storage } = loadApp();
  els["loopToggle"].fire("click");                 // → 开，[0,3]
  els["loopFrom"].value = "1"; els["loopFrom"].fire("change");
  els["loopTo"].value = "2"; els["loopTo"].fire("change");
  beat.Store.flush();                              // 尾部防抖，断言前必须落盘
  const hot = JSON.parse(storage.get("beatsight.state") || "{}");
  eq(JSON.stringify(hot.loopRange), JSON.stringify({ on: true, from: 1, to: 2 }),
     "loopRange 写进热键 beatsight.state");
  ok((storage.get("beatsight.state") || "").length < 1024,
     "热键载荷仍 < 1 KB（冷热分离纪律未破）");

  /* 往返：重开应用后区间还在（这才是"下次打开接着磨那两小节"） */
  const again = loadApp(seedState({ loopRange: { on: true, from: 1, to: 2 } }));
  eq(JSON.stringify(again.beat.Store.S.loopRange),
     JSON.stringify({ on: true, from: 1, to: 2 }), "重载后区间保持");
}

/* ================= 场景 T65g：曲式模式下整块收起 ================= */
section("T65g 练习循环 · 曲式模式收起（循环只管型内 4 小节）");
{
  const { beat, els } = loadApp();
  ok(!els["loopPanel"] || els["loopPanel"].hidden === false, "预设模式下循环面板可见");
  beat.Store.S.playMode = "arrange";
  beat.Presets.syncLoopUI();
  eq(els["loopPanel"].hidden, true, "★ 曲式模式 → 面板收起（与节目单推进不打架）");
  beat.Store.S.playMode = "preset";
  beat.Presets.syncLoopUI();
  eq(els["loopPanel"].hidden, false, "退回预设模式 → 面板重新露出");
}

/* ================= 场景 T65h：循环开着时换型不炸 ================= */
section("T65h 练习循环 · 播放中改区间 / 换型（rescheduleLoop 路径不炸不吞）");
{
  const { beat } = loadApp(seedState({ loopRange: { on: true, from: 1, to: 2 } }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);
  /* 播放中直接改区间 → 走 Audio.rescheduleLoop（游标跳回起点、时间轴对齐当下） */
  beat.Presets.setLoopRange({ from: 2, to: 3 });
  drive(ac, beat, 4);
  ok(beat.Store.S.playing === true, "改区间后仍在播（重排没把播放状态打断）");
  /* 播放中换型（走 resyncToNow）——循环开着时若游标落在区间外应被拽回区间起点 */
  beat.Controls.setSig(4);
  drive(ac, beat, 2);
  ok(beat.Store.S.playing === true, "循环中换型后仍在播");
  beat.Controls.stop();
  ok(beat.Store.S.playing === false, "停止正常（没有留下孤儿 interval）");
}
