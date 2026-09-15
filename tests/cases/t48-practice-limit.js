/* BeatSight 自动化测试 · 练习量控制（v1.9.0）
   T48 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本组的关键不在「会不会停」，而在「**什么时候**停」——所以要断言到具体时刻与具体小节数：
   早停 = 偷走用户的练习量，晚停 = 到点了还在响。两者都算缺陷。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, near, section, drive } = require("../lib/harness");

/* 默认预设是「民谣扫弦」：4/4，一小节 4 拍。96 BPM → 每拍 0.625s → 一小节 2.5s */
const BAR_SEC = 2.5;

/* 读 DOM 桩上的文案一律经这两个函数：元素按 id 惰性创建，若被测代码根本没碰过它，
   els[id] 就是 undefined。直接取 .textContent 会让**整套测试炸掉**（后面所有用例一条都跑不到），
   而报「实际 (未创建)」才能准确定位问题——这是 v1.3.1「断言不该炸掉后续用例」的教训，
   反向验证时又踩到一次（去掉进度刷新 → 到 T48 第 26 行直接 TypeError） */
const prog = els => { const e = els["limitProg"]; return e ? e.textContent : "(未创建)"; };
const status = els => { const e = els["statusText"]; return e ? e.textContent : "(未创建)"; };

/* ================= 场景 T48：档位 / 持久化 / 加载校验 ================= */
section("T48 练习量 · 档位生成 / 默认值 / 脏值回退 / 热键");
{
  const { beat, els, storage } = loadApp();
  const S = beat.Store.S;

  eq(JSON.stringify(S.limit), JSON.stringify({ mode:"off", n:0 }), "默认「不限」");
  eq(els["limitRow"].children.length, 6, "档位按钮由 LIMIT_PRESETS 生成（6 档）");
  const labels = els["limitRow"].children.map(b => b.textContent);
  eq(JSON.stringify(labels), JSON.stringify(["不限","8 小节","16 小节","32 小节","5 分钟","10 分钟"]),
     "档位文案与数据表一致（含单位，读写都不会歧义）");
  eq(els["limitRow"].children[0].getAttribute("aria-pressed"), "true", "默认选中「不限」");
  eq(els["limitRow"].children[1].getAttribute("aria-pressed"), "false", "其余档位未选中");
  eq(prog(els), "", "未播放且不限 → 进度区为空");

  /* 点「32 小节」：S.limit 更新 + 高亮与 aria 同源 + 热键落盘 */
  els["limitRow"].children[3].fire("click");
  eq(JSON.stringify(S.limit), JSON.stringify({ mode:"bars", n:32 }), "点「32 小节」→ S.limit 更新");
  eq(els["limitRow"].children[3].getAttribute("aria-pressed"), "true", "被点档位 aria-pressed=true");
  eq(els["limitRow"].children[0].getAttribute("aria-pressed"), "false", "「不限」取消选中");
  beat.Store.flush();                          // 热键是 250ms 尾部防抖，断言前必须落盘（同 T24）
  const hotRaw = storage.get("beatsight.state") || "{}";
  const hot = JSON.parse(hotRaw);
  eq(JSON.stringify(hot.limit), JSON.stringify({ mode:"bars", n:32 }), "练习量写进热键 beatsight.state");
  ok(hotRaw.length < 1024, "热键载荷仍 < 1 KB（冷热分离纪律未破，实际 " + hotRaw.length + " 字节）");

  /* 脏值一律回退「不限」：表即白名单，不额外写一套域校验 */
  const dirty = [
    { mode:"bars", n:7 },        // 表外小节数
    { mode:"min", n:5.5 },       // 表外分钟数
    { mode:"hour", n:5 },        // 未知 mode
    { mode:"bars" },             // 缺 n
    { n:8 },                     // 缺 mode
    "bars", 1, true, null, { mode:null, n:null }, { mode:"off", n:99 },
  ];
  const bad = dirty.filter(v => {
    const { beat: b2 } = loadApp({ "beatsight.state": JSON.stringify({ v:3, limit: v }) });
    const L = b2.Store.S.limit;
    return !(L.mode === "off" && L.n === 0);
  });
  eq(bad.length, 0, `10 种脏 limit 全部回退「不限」（未回退的：${JSON.stringify(bad)}）`);

  /* 合法值必须保留，且 S.limit 不能是档位表项的引用——否则改 S.limit 会污染模块级常量 */
  const { beat: b3 } = loadApp({ "beatsight.state": JSON.stringify({ v:3, limit: { mode:"min", n:5 } }) });
  eq(JSON.stringify(b3.Store.S.limit), JSON.stringify({ mode:"min", n:5 }), "合法档位 (min,5) 正常加载");
  b3.Store.S.limit.n = 999;
  eq(b3.LIMIT_PRESETS.find(p => p.mode === "min" && p.n === 5) ? 5 : 0, 5,
     "改 S.limit 不污染 LIMIT_PRESETS（加载时是拷贝，不是引用）");
}

/* ================= 场景 T48b：bars 模式 —— 恰好在第 N 小节边界停 ================= */
section("T48b 练习量 · 按小节：不提前、不多走");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  S.limit = { mode:"bars", n:8 };              // 8 小节 = 20s 音乐
  beat.Controls.start();
  const ac = FakeAudioContext.last;

  eq(drive(ac, beat, 18), false, "练到约 7 小节（18s）时仍在播放——不提前停");
  eq(S.playing, true, "18s 时 S.playing 仍为 true");
  const progAt7 = prog(els);
  ok(/^已练 [1-7] \/ 8 小节$/.test(progAt7), "进度文案随小节数实时刷新（实际「" + progAt7 + "」）");

  eq(drive(ac, beat, 6), true, "继续推进 → 到点自动停止");
  eq(S.playing, false, "已停止");
  eq(beat.limitState().bars, 8, "恰在第 8 小节边界停（不多走一节）");
  /* 音频层面的「不多不少」——比任何时刻断言都硬：民谣扫弦每小节 6 个音，8 小节恰好 48 个。
     若真早停会少几个音、真晚停会多出第 9 小节的音 */
  eq(ac.hits.length, 48, "发声恰好 = 8 小节 × 6 音 = 48 个音（音频不多不少）");
  eq(status(els), "已练满 8 小节 · 自动停止", "状态栏文案说明停止原因");
  eq(prog(els), "", "停止后清空进度区");
  /* 停止时刻的**墙钟**会比小节边界早，这是设计使然，不是早停：
     小节计数是在**排程**时累加的（调度器按前瞻窗口 150ms + 一个音符时长向前排，最远约 0.8s），
     所以「第 8 小节已排完」这一刻的墙钟 ≈ 边界 − 0.8s。此时 stop() 只停时钟与画面，
     **不会取消已排入音频时钟的振荡器**——那 8 小节的音一个不少地响完，听感上不多不少。
     这与既有「变速训练器到目标自动停」（Trainer.onBarBoundary → Controls.stop）是同一条路径、
     同一种行为；此处断言只是把这条边界钉住，防止日后有人把计数挪到别处变成真的早停/晚停。
     ——所以真正的判据是 limitBars === 8（上一行已断言），这里只钉「墙钟不得早于一个排程跨度」 */
  const boundary = 0.08 + 8 * BAR_SEC;                    // 20.08s
  ok(ac.currentTime <= boundary && ac.currentTime >= boundary - 0.85,
     `墙钟停止时刻落在 [边界−0.85s, 边界] 内（实际 ${ac.currentTime.toFixed(3)}s，边界 ${boundary}s）`);
}

/* ================= 场景 T48c：min 模式 —— 按音频时钟，预备拍不计入 ================= */
section("T48c 练习量 · 按分钟：时钟口径 / 预备拍不计入");
{
  const { beat } = loadApp();
  beat.Store.S.limit = { mode:"min", n:5 };    // 5 分钟 = 300s
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  eq(drive(ac, beat, 200), false, "200 秒（< 5 分钟）时仍在播放");
  eq(drive(ac, beat, 120), true, "越过 5 分钟 → 自动停止");
  eq(beat.Store.S.playing, false, "已停止");
  near(ac.currentTime, 300.08, 0.1, "停止时刻 = 循环起点 + 300s（音频时钟口径，与练习记录同源）");
}

/* ================= 场景 T48d：预备拍不吃练习量额度 ================= */
section("T48d 练习量 · 预备拍的 N 拍不计入");
{
  const { beat, els } = loadApp();
  beat.Store.S.countIn = { on:true, beats:4 };
  beat.Store.S.limit = { mode:"min", n:5 };
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  eq(prog(els), "", "预备拍期间不显示练习量进度（基准点尚未取）");
  /* 预备拍 4 拍 @96BPM = 2.5s；若无扣除应在 300.08s 停，正确实现应到 302.58s 才停 */
  eq(drive(ac, beat, 300), false, "走到 300s 仍未停——预备拍的 2.5s 没被算进练习量");
  eq(drive(ac, beat, 10), true, "继续推进 → 停止");
  near(ac.currentTime, 0.08 + 4 * 0.625 + 300, 0.15, "停止时刻 = 预备拍结束 + 300s（预备拍被正确排除）");

  /* bars 模式同样不被预备拍影响（预备拍不产生小节边界） */
  const { beat: b2 } = loadApp();
  b2.Store.S.countIn = { on:true, beats:4 };
  b2.Store.S.limit = { mode:"bars", n:8 };
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  eq(drive(ac2, b2, 20), false, "bars 模式：预备拍 + 20s 仍未停（8 小节 = 20s 音乐，需另加 2.5s 预备拍）");
  eq(drive(ac2, b2, 6), true, "继续 → 停止");
  eq(b2.limitState().bars, 8, "bars 模式同样恰在第 8 小节边界停");
}

/* ================= 场景 T48e：与变速训练器共存 —— 谁先到谁停 ================= */
section("T48e 练习量 × 变速训练器 · 先到者停且文案区分");
{
  /* ① 练习量先到：8 小节额度，训练器要爬 70→120（步长 4 共 13 级），远不止 8 小节 */
  const { beat, els } = loadApp();
  Object.assign(beat.Store.S.trainer, { on:true, start:70, target:120, step:4, everyN:1 });
  beat.Store.S.limit = { mode:"bars", n:8 };
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  eq(drive(ac, beat, 40), true, "练习量先到 → 自动停止");
  eq(status(els), "已练满 8 小节 · 自动停止", "文案说明是练习量到点（不是训练完成）");
  eq(beat.Store.S.playing, false, "已停止");

  /* ② 训练器先到：额度放宽到 32 小节，训练器 1 级就完成（70→74） */
  const { beat: b2, els: e2 } = loadApp();
  Object.assign(b2.Store.S.trainer, { on:true, start:70, target:74, step:4, everyN:1 });
  b2.Store.S.limit = { mode:"bars", n:32 };
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  eq(drive(ac2, b2, 12), true, "训练器先到 → 自动停止");
  ok(/训练完成/.test(status(e2)),
     "文案说明是训练完成（实际「" + status(e2) + "」）");
  ok(b2.limitState().bars < 32, "此时练习量额度远未用完（计数 " + b2.limitState().bars + " / 32）");
}

/* ================= 场景 T48f：不限模式行为零变化 ================= */
section("T48f 练习量 · 不限档位不改变任何既有行为");
{
  const { beat } = loadApp();
  eq(beat.Store.S.limit.mode, "off", "默认即「不限」");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  eq(drive(ac, beat, 30), false, "「不限」下播放 30 秒不会自动停（既有行为零变化）");
  eq(beat.Store.S.playing, true, "仍在播放");
  near(ac.currentTime, 30, 0.05, "虚拟时钟推进到 30s");
  beat.Controls.stop();
  eq(beat.Store.S.playing, false, "手动停止仍正常");
  /* 「不限」时计数器仍在涨（它是无条件的记账），但不参与判定——这里顺带证明两者解耦 */
  ok(beat.limitState().bars > 0, "计数器照常累加（记账与判定解耦）");
}

/* ================= 场景 T48g：重新开始必须归零 ================= */
section("T48g 练习量 · 每轮开始归零（否则第二轮会秒到点）");
{
  const { beat, els } = loadApp();
  beat.Store.S.limit = { mode:"bars", n:8 };
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 4);
  const midBars = beat.limitState().bars;
  ok(midBars > 0, "第一轮练习累计了小节数（实际 " + midBars + "）");
  beat.Controls.stop();
  beat.Controls.start();
  eq(beat.limitState().bars, 0, "重新开始 → 小节计数归零");
  ok(prog(els) === "已练 0 / 8 小节",
     "进度文案同步回到 0（实际「" + prog(els) + "」）");
  eq(drive(ac, beat, 5), false, "归零后 5 秒不会「秒到点」（实际可继续练）");
  eq(beat.Store.S.playing, true, "仍在播放");
  beat.Controls.stop();
}

/* ================= 场景 T48h：播放中改档位立即生效 ================= */
section("T48h 练习量 · 播放中改档位（已超额则立刻到点）");
{
  const { beat, els } = loadApp();
  beat.Store.S.limit = { mode:"bars", n:32 };
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  eq(drive(ac, beat, 30), false, "32 小节额度下练 30 秒（约 12 小节）不会停");
  const done = beat.limitState().bars;
  ok(done >= 8, "此时已练小节数 ≥ 8（实际 " + done + "）");
  els["limitRow"].children[1].fire("click");        // 真实路径：点「8 小节」档
  eq(JSON.stringify(beat.Store.S.limit), JSON.stringify({ mode:"bars", n:8 }), "档位即时更新");
  eq(drive(ac, beat, 1), true, "已超额 → 下一个调度周期即停（不必停下重开）");
  eq(status(els), "已练满 8 小节 · 自动停止", "文案随新档位（不是旧档位 32）");
}
