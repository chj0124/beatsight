/* BeatSight 自动化测试 · 练习闭环：统计汇总 / 记录入账与截断 / 训练计划 / 保活 / PWA / 统计导出
   T37–T46。练习统计、训练计划、后台保活与 PWA 注册。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, pill, ok, eq, near, section, drive } = require("../lib/harness");

/* ================= 场景 T37：练习统计汇总口径（v1.4，纯函数注入固定时钟） ================= */
section("T37 Stats · 本周时长 / 连续天数 / 速度纪录 / 近7天");
{
  loadApp();
  /* 固定时钟：2026-09-15（周二）12:00。本周起点 = 周一 09-14 00:00 */
  const now = new Date(2026, 8, 15, 12, 0, 0).getTime();
  const at = (offsetDays, hour) => { const d = new Date(2026, 8, 15, hour || 10, 0, 0); d.setDate(d.getDate() - offsetDays); return d.getTime(); };
  const sessions = [
    { t: at(0), sec: 60, bpm: 96, name: "a" },     // 今天
    { t: at(1), sec: 120, bpm: 100, name: "b" },   // 昨天（周一，本周内）
    { t: at(2), sec: 60, bpm: 90, name: "c" },     // 前天（上周日，本周外）
    { t: at(5), sec: 60, bpm: 88, name: "d" },     // 上周四，本周外
    { t: at(8), sec: 60, bpm: 120, name: "e" },    // 上上周，本周外
  ];
  const r = loadApp().beat.Stats.summarize(sessions, now);
  eq(r.weekSec, 180, "本周时长只算周一起（今天 60 + 周一 120 = 180s）");
  eq(r.streak, 3, "连续天数：今天→昨天→前天 = 3 天（大前天断档）");
  eq(r.maxBpm, 120, "速度纪录 = 历史最高 BPM");
  eq(r.count, 5, "累计场次 = 5");
  eq(r.days.length, 7, "近 7 天条图固定 7 根");
  ok(r.days[6].today && r.days[6].sec === 60, "最后一根是今天（60s）");
  eq(r.days[5].sec, 120, "昨天 120s");
  /* 今天没练时 streak 不归零，从昨天往回数 */
  const r2 = loadApp().beat.Stats.summarize([{ t: at(1), sec: 60, bpm: 96, name: "x" }], now);
  eq(r2.streak, 1, "今天未练：连续天数从昨天起算（streak=1，不归零）");
  const r3 = loadApp().beat.Stats.summarize([], now);
  eq(r3.streak, 0, "空记录：streak=0");
  eq(r3.maxBpm, 0, "空记录：速度纪录 0（UI 显示 —）");
}

/* ================= 场景 T38：练习记录入账（v1.4） ================= */
section("T38 练习记录 · ≥30s 自动入账 / 秒停与试听不计");
{
  const { beat, els, storage, fireWin } = loadApp();
  const S = beat.Store.S;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 31);
  beat.Controls.stop();
  eq(beat.Store.logSessions.length, 1, "播放 31 秒后停止 → 入账 1 场");
  const rec = beat.Store.logSessions[0] || {};   // 入账失败时也要让后续断言报「实际 undefined」而不是炸掉整套
  near(rec.sec, 31, 1.5, "时长取音频时钟差 ≈31s");
  eq(rec.bpm, 96, "记录当时的 BPM");
  eq(rec.name, "民谣扫弦 · 下-下上-上下上", "记录当时的节奏型名");
  ok(!!storage.get("beatsight.log"), "冷键 beatsight.log 已立即落盘（不防抖）");
  eq(JSON.parse(storage.get("beatsight.log")).v, 1, "log 格式 v:1");

  beat.Controls.start();
  drive(ac, beat, 2);
  beat.Controls.stop();
  eq(beat.Store.logSessions.length, 1, "播放 2 秒停止 → 不入账（<30s 视为误触/试音）");

  S.preview = true;                              // 编辑器试听不算练习
  beat.Controls.start();
  drive(ac, beat, 31);
  beat.Controls.stop();
  S.preview = false;
  eq(beat.Store.logSessions.length, 1, "试听 31 秒 → 不入账");

  /* 统计 overlay：入账后四卡与条图渲染；Esc 关闭；空格不误触播放 */
  els["statsBtn"].fire("click");
  ok(els["statsOverlay"].classList.contains("open"), "统计 overlay 打开");
  eq(els["statCount"].textContent, "1", "累计场次卡 = 1");
  eq(els["statRecord"].textContent, "96", "速度纪录卡 = 96");
  eq(els["statsBars"].children.length, 7, "近 7 天条图 7 根柱");
  ok(els["statsNote"].textContent.indexOf("柱高") >= 0, "有数据时的说明文案（v1.6 起文案改「柱高=当天分钟数」）");
  fireWin("keydown", { code: "Space" });
  ok(!S.playing, "统计打开时空格不触发播放");
  fireWin("keydown", { key: "Escape" });
  ok(!els["statsOverlay"].classList.contains("open"), "Esc 关闭统计 overlay");
}

/* ================= 场景 T39：练习记录加载校验与截断（v1.4） ================= */
section("T39 练习记录 · 脏条目丢弃 / 400 条环形截断 / 清除");
{
  const seed = { v: 1, sessions: [
    ...Array.from({ length: 405 }, (_, i) => ({ t: 1000000 + i * 1000, sec: 60, bpm: 96, name: "x" })),
    { t: "bad", sec: 60 },                        // 脏：t 非数字
    { t: 5, sec: -3 },                            // 脏：sec 非正
    { sec: 60 },                                  // 脏：缺 t
  ]};
  const { beat, storage } = loadApp({ "beatsight.log": JSON.stringify(seed) });
  eq(beat.Store.logSessions.length, 400, "加载即校验：405 条截到 400，3 条脏记录丢弃");
  beat.Store.appendSession({ t: Date.now(), sec: 31, bpm: 100, name: "new" });
  eq(beat.Store.logSessions.length, 400, "追加上限：401 → 截回 400（最旧的被淘汰）");
  eq(beat.Store.logSessions[399].name, "new", "最新的在最末");
  eq(JSON.parse(storage.get("beatsight.log")).sessions.length, 400, "落盘也是 400 条");

  /* 写失败路径（v1.6 补盖 L807）：log 落盘被拒（隐私模式）不炸交互链，且经既有通道可见（chip 变红） */
  const appW = loadApp({}, { throwOnWrite: true });
  appW.beat.Controls.start();
  drive(FakeAudioContext.last, appW.beat, 31);
  appW.beat.Controls.stop();
  eq(appW.beat.Store.logSessions.length, 1, "写失败时内存中仍入账（场次不丢，只是没落盘）");
  ok(appW.els["persistDot"].classList.contains("bad"), "log 写失败 → 顶栏状态点变红（与预设写失败同一通道）");

  /* 清除流程：弹确认框 → 确认 → 清空 + 落盘 + 文案回到空态 */
  const app2 = loadApp({ "beatsight.log": JSON.stringify({ v: 1, sessions: [{ t: Date.now(), sec: 60, bpm: 96, name: "y" }] }) });
  app2.els["statsBtn"].fire("click");
  app2.els["statsClear"].fire("click");
  app2.els["modalOk"].fire("click");
  eq(app2.beat.Store.logSessions.length, 0, "确认清除后记录归零");
  eq(app2.els["statsNote"].textContent.indexOf("还没有练习记录"), 0, "空态文案");
  eq(app2.els["statRecord"].textContent, "—", "空态速度纪录占位");
}

/* ================= 场景 T40：训练收成 → 上次训练（v1.4） ================= */
section("T40 训练计划 · 完成记 done / 中途停记 reached");
{
  /* 完成路径：70→90，步长 10，每级 1 小节 */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, start: 70, target: 90, step: 10, everyN: 1 } }) });
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 30);
  ok(!beat.Store.S.playing, "练到目标自动停止");
  const last = beat.Store.S.trainer.last;
  ok(!!last && last.done === true, "完成 → last.done=true");
  eq(last && last.reached, 90, "完成 → reached=目标 90");
  ok(els["trResumeBtn"].hidden === false, "「继续上次」按钮亮出");
  ok(els["trResumeBtn"].textContent.indexOf("再来一轮") >= 0, "完成后文案 = 再来一轮 · 70→90");

  /* 中途手动停：开训练 70→200，练 ~8s（过 ≥1 个小节边界）后停 */
  const app2 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, start: 70, target: 200, step: 10, everyN: 4 } }) });
  app2.beat.Controls.start();
  drive(FakeAudioContext.last, app2.beat, 8);
  app2.beat.Controls.stop();
  const last2 = app2.beat.Store.S.trainer.last;
  ok(!!last2 && last2.done === false, "中途停 → done=false");
  eq(last2 && last2.reached, 70, "中途停 → reached=当前级别 70");
  ok(app2.els["trResumeBtn"].textContent.indexOf("从 70 BPM 接着练") >= 0, "中途停文案 = 继续上次 · 从 70 BPM 接着练");

  /* 秒停不记录：开了训练但一个小节边界都没过 → 不产出 last */
  const app3 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, start: 70, target: 200, step: 10, everyN: 4 } }) });
  app3.beat.Controls.start();
  drive(FakeAudioContext.last, app3.beat, 1);
  app3.beat.Controls.stop();
  ok(!app3.beat.Store.S.trainer.last, "秒停 → 不记录（防误触污染接续点）");

  /* 持久化：last 随热键落盘，重启后还在 */
  app2.beat.Store.flush();
  const savedHot = JSON.parse(app2.storage.get("beatsight.state"));
  ok(savedHot.trainer.last && savedHot.trainer.last.reached === 70, "last 随 beatsight.state 持久化");
}

/* ================= 场景 T41：上次训练一键继续（v1.4） ================= */
section("T41 训练计划 · 「继续上次」接续行为");
{
  /* 无历史 → 按钮隐藏 */
  const app0 = loadApp();
  eq(app0.els["trResumeBtn"].hidden, true, "无训练历史 → 按钮不露面");

  /* 未完成：从练到的级别接着练（start 被推进到 reached，训练自动开启并起播） */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, start: 70, target: 150, step: 4, everyN: 4,
      last: { reached: 110, done: false, at: 1 } } }) });
  eq(els["trResumeBtn"].hidden, false, "有历史 → 按钮显示");
  els["trResumeBtn"].fire("click");
  const S = beat.Store.S;
  ok(S.trainer.on, "点击后训练开关自动打开");
  eq(S.trainer.start, 110, "起始被推进到上次练到的 110");
  eq(els["trStart"].value, 110, "起始输入框同步 110");
  ok(S.playing, "点击即起播");
  eq(S.bpm, 110, "起播速度 = 110");
  beat.Controls.stop();

  /* 已完成：再来一轮 → 不动 start，按原配置起播 */
  const app2 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, start: 70, target: 120, step: 4, everyN: 4,
      last: { reached: 120, done: true, at: 1 } } }) });
  app2.els["trResumeBtn"].fire("click");
  eq(app2.beat.Store.S.trainer.start, 70, "已完成 → 起始保持 70（再来一轮）");
  ok(app2.beat.Store.S.playing, "已完成 → 点击即起播");
  app2.beat.Controls.stop();

  /* 脏 last 回退：reached 超界钳制、非数字整条丢弃 */
  const app3 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, start: 70, target: 120, step: 4, everyN: 4, last: { reached: 999, done: false, at: 1 } } }) });
  eq(app3.beat.Store.S.trainer.last.reached, 240, "reached 超界钳到 240");
  const app4 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, start: 70, target: 120, step: 4, everyN: 4, last: { reached: "x" } } }) });
  ok(!app4.beat.Store.S.trainer.last, "reached 非数字 → last 整条丢弃");
}

/* ================= 场景 T42：后台保活（v1.4） ================= */
section("T42 KeepAlive · wakeLock 优先 / 静音音频兜底 / 开关持久化");
{
  /* 默认关；扳动后 persist 落盘 */
  const { beat, els, storage } = loadApp();
  const S = beat.Store.S;
  eq(S.keepAwake, false, "后台保活默认关");
  els["keepAwakeToggle"].fire("click");
  eq(S.keepAwake, true, "扳动后 keepAwake=true");
  ok(els["keepAwakeToggle"].classList.contains("on"), "开关视觉同步 on");
  eq(els["keepAwakeToggle"].getAttribute("aria-checked"), "true", "aria-checked 同源");
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).keepAwake, true, "开关状态持久化到热键");
  const app2 = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(app2.beat.Store.S.keepAwake, true, "重载后开关仍是开");

  /* wakeLock 路径：start 申请、stop 释放（同步 thenable 避免异步编排） */
  const calls = [];
  const lockObj = { released: false, release(){ this.released = true; }, addEventListener(){} };
  const nav = { wakeLock: { request(t){ calls.push(t); return { then(fn){ fn(lockObj); return { catch(){} }; } }; } } };
  const app3 = loadApp({}, { navigator: nav });
  app3.beat.Store.S.keepAwake = true;
  app3.beat.Controls.start();
  eq(JSON.stringify(calls), JSON.stringify(["screen"]), "播放中+开关开 → 申请 wakeLock('screen')");
  ok(app3.beat.KeepAlive.state().locked, "锁已持有");
  app3.beat.Controls.stop();
  ok(lockObj.released, "停止 → 释放 wakeLock");

  /* 无 wakeLock（iOS 老版本）→ 静音循环 audio 兜底；stop 释放 */
  const app4 = loadApp({}, { navigator: {} });
  app4.beat.Store.S.keepAwake = true;
  app4.beat.Controls.start();
  ok(app4.beat.KeepAlive.state().audio, "无 wakeLock → 静音音频兜底已起");
  app4.beat.Controls.stop();
  ok(!app4.beat.KeepAlive.state().audio, "停止 → 静音音频已停");

  /* 开关关着 → 播放也不申请任何保活 */
  const app5 = loadApp({}, { navigator: nav });
  app5.beat.Controls.start();
  eq(calls.length, 1, "开关关 → 播放不申请 wakeLock");
  app5.beat.Controls.stop();
}

/* ================= 场景 T43：PWA 注册按协议收口（v1.4） ================= */
section("T43 PWA · 仅 http(s) 注册 manifest + sw.js，file:// 完全跳过");
{
  /* file://：serviceWorker 在场也不许注册 */
  const regCalls = [];
  const navSW = { serviceWorker: { register(u){ regCalls.push(u); return { catch(){} }; } } };
  loadApp({}, { location: { protocol: "file:" }, navigator: navSW });
  eq(regCalls.length, 0, "file:// 协议 → 不注册 SW（单文件双击场景零副作用）");

  /* 无 location（极老/测试环境）→ 整段跳过不抛错（前面全部用例已在跑这条路径） */
  ok(true, "无 location 环境已在全部既有用例中验证不抛错");

  /* https：注册 sw.js + 注入 manifest link */
  const app = loadApp({}, { location: { protocol: "https:" }, navigator: navSW });
  eq(JSON.stringify(regCalls), JSON.stringify(["sw.js"]), "https → 注册 sw.js");
  const link = app.sandbox.document.head.children.find(c => c.rel === "manifest");
  ok(!!link && link.href === "manifest.webmanifest", "https → <link rel=manifest> 指向 manifest.webmanifest");

  /* 无 serviceWorker 能力（老浏览器）→ 只注入 manifest，不抛错 */
  const app2 = loadApp({}, { location: { protocol: "https:" }, navigator: {} });
  ok(!!app2.sandbox.document.head.children.find(c => c.rel === "manifest"), "无 SW 能力 → manifest 仍注入");
}

/* ================= 场景 T44：音色响度 · 噪声路径 makeup 增益补偿（v1.4.1） ================= */
section("T44 音色响度 · 木鱼/军鼓/踩镲 makeup 补偿，振荡器路径不受影响");
{
  /* 用户实拍：木鱼调到最大仍听不清。根因：滤波噪声路径缺 makeup gain——
     带通 Q=8 后噪声幅度只剩 ~1/14（≈−23dB），包络峰值却与振荡器路径同值。
     修复：noiseHit 按 min(makeup, peak × makeup) 送增益；上限=makeup 本身
     （= 满音量重拍应达到的增益，天然天花板；削波看信号幅度不看增益值，滤波噪声安全）。
     参照（vol=0.8, accentVol=1）：accent peak=0.8 / beat=0.64 / sub=0.4 */
  const noiseGain = (timbre, filterFreq, extra) => {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify(Object.assign(
      { v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre }, extra || {})) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const h = ac.hits.find(x => x.kind === "noise" && x.filterFreq === filterFreq);
    return h ? h.gain : undefined;
  };
  const MK = 14;                    // wood.makeup 的规格值：硬编码，不读 CONFIG——
  const DM = { snare: 5, hat: 2.5 };// 读 CONFIG 算期望值会让「改错 CONFIG」两边一起变（自指，反向验证会漏）

  near(noiseGain("wood", 2000), 0.8 * MK, 1e-6, "木鱼重拍 = 0.8 × makeup（补偿后）");
  near(noiseGain("wood", 1500), 0.64 * MK, 1e-6, "木鱼正拍 = 0.64 × makeup");
  near(noiseGain("wood", 1100), 0.4 * MK, 1e-6, "木鱼细分 = 0.4 × makeup");
  ok(noiseGain("wood", 2000) > noiseGain("wood", 1500)
     && noiseGain("wood", 1500) > noiseGain("wood", 1100), "木鱼层级保持：重拍 > 正拍 > 细分");

  near(noiseGain("drum", 1800), 0.64 * DM.snare, 1e-6, "军鼓 = 0.64 × snareMakeup");
  near(noiseGain("drum", 8000), 0.28 * DM.hat, 1e-6, "踩镲 = 0.28（含 hatGain 0.7）× hatMakeup");
  /* 底鼓是振荡器（sine 扫频，sweepTo=50），不得被 makeup 波及 */
  {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre: "drum" }) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const kick = ac.hits.find(x => x.kind === "osc" && x.sweepTo === 50);
    ok(kick && Math.abs(kick.gain - 0.8) < 1e-6, "底鼓（振荡器路径）增益不变 = 0.8");
  }
  /* click 路径完全不受影响（T18 已全量程覆盖，此处补一条噪声开关存在时的对照） */
  {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre: "click" }) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const h = ac.hits.find(x => x.kind === "osc" && x.freq === 1568);
    ok(h && Math.abs(h.gain - 0.8) < 1e-6, "click 重拍增益不变 = 0.8");
  }
  /* 上限 = makeup 本身：满音量重拍恰好顶到天花板，不会越界 */
  near(noiseGain("wood", 2000, { vol: 1 }), MK, 1e-6, "满音量时木鱼重拍 = makeup（天花板），不越界");
  /* 脏 makeup 回退 1（不补偿也不炸） */
  {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre: "wood" }) });
    beat.CONFIG.timbres.wood.makeup = "x";          // 直接污染配置（模拟未来改坏）
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const h = ac.hits.find(x => x.kind === "noise" && x.filterFreq === 2000);
    ok(h && Math.abs(h.gain - 0.8) < 1e-6, "脏 makeup → 回退不补偿（0.8），不产 NaN");
  }
}

/* ================= 场景 T45：7 天爬升计划（v1.5） ================= */
section("T45 训练计划 · 生成 / 今日参数 / 完成推进 / 顺延与收官");
{
  /* 生成：按当前 trainer 配置切 7 段（70→140，跨度 70，每天 10） */
  const { beat, els, storage } = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, start: 70, target: 140, step: 4, everyN: 1 } }) });
  const S = beat.Store.S;
  els["planGenBtn"].fire("click");
  ok(!!S.plan && S.plan.day === 1, "生成计划：day=1");
  eq(S.plan.baseStart, 70, "计划起点 = 当前起始 70");
  eq(S.plan.baseTarget, 140, "计划终点 = 当前目标 140");
  eq(els["planRow"].hidden, false, "今日卡显示");
  eq(els["planGenBtn"].hidden, true, "生成入口隐藏");
  eq(els["planInfo"].textContent, "7 天计划 · Day 1/7 · 今日 70→80 BPM", "Day1 今日段 70→80（跨度/7=10）");

  /* 今日参数与起播 */
  els["planStartBtn"].fire("click");
  ok(S.playing, "开始今日训练 → 起播");
  eq(S.trainer.start, 70, "今日起始写入 trainer.start");
  eq(S.trainer.target, 80, "今日目标写入 trainer.target");
  eq(els["trTarget"].value, 80, "目标输入框同步");
  beat.Controls.stop();                      // 手动停：当天不算完成
  eq(S.plan.day, 1, "中途手动停 → 当天不算完成（缺练顺延）");

  /* 完成当天 → 推进到 Day 2（完成一段才算，不靠日历） */
  els["planStartBtn"].fire("click");
  drive(FakeAudioContext.last, beat, 60);    // 70→80 step 4 everyN 1：4 级 × 1 小节
  ok(!S.playing, "练到当天目标自动停止");
  eq(S.plan && S.plan.day, 2, "完成当天 → 推进到 Day 2");
  eq(els["planInfo"].textContent, "7 天计划 · Day 2/7 · 今日 80→90 BPM", "Day2 今日段 80→90");
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).plan.day, 2, "计划进度随热键持久化");

  /* Day 7 完成 → 计划收官清空 + 完成提示 */
  const app2 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, start: 130, target: 140, step: 10, everyN: 1 },
    plan: { baseStart: 70, baseTarget: 140, day: 7 } }) });
  eq(app2.els["planInfo"].textContent, "7 天计划 · Day 7/7 · 今日 130→140 BPM", "Day7 今日段 130→140（收官日顶到总目标）");
  app2.els["planStartBtn"].fire("click");
  drive(FakeAudioContext.last, app2.beat, 60);
  eq(app2.beat.Store.S.plan, null, "Day 7 完成 → 计划清空");
  ok(app2.els["statusText"].textContent.indexOf("7 天计划完成") === 0, "收官提示文案");

  /* 退出计划：确认后清空；无计划时点退出不弹窗 */
  const app3 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, start: 70, target: 140, step: 4, everyN: 1 },
    plan: { baseStart: 70, baseTarget: 140, day: 3 } }) });
  app3.els["planEndBtn"].fire("click");
  app3.els["modalOk"].fire("click");
  eq(app3.beat.Store.S.plan, null, "确认退出 → 计划清空");
  eq(app3.els["planRow"].hidden, true, "退出后今日卡隐藏");
  eq(app3.els["planGenBtn"].hidden, false, "退出后生成入口回来");
  app3.els["planEndBtn"].fire("click");
  eq(app3.els["modalMask"].hidden, true, "无计划时点退出 → 不弹确认框");

  /* 计划进行中「继续上次」隐藏（计划本身就是接续机制，两个入口不并存） */
  const app4 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, start: 70, target: 140, step: 4, everyN: 1,
      last: { reached: 90, done: false, at: 1 } },
    plan: { baseStart: 70, baseTarget: 140, day: 2 } }) });
  eq(app4.els["trResumeBtn"].hidden, true, "计划进行中 → 继续上次隐藏");
  eq(app4.els["trainerPanel"].hidden, false, "计划进行中即使训练开关关着，面板也显示（计划卡要在）");

  /* 脏计划回退：目标≤起点 / day 越界 → 整条丢弃 */
  const app5 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    plan: { baseStart: 140, baseTarget: 70, day: 1 } }) });
  eq(app5.beat.Store.S.plan, null, "脏计划（目标≤起点）→ 丢弃");
  const app6 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    plan: { baseStart: 70, baseTarget: 140, day: 9 } }) });
  eq(app6.beat.Store.S.plan, null, "脏计划（day 越界）→ 丢弃");
}

/* ================= 场景 T46：统计增强（v1.6）：30 天视图 / 各节奏型纪录 / 导出 ================= */
section("T46 统计增强 · 7/30 天切换 / 各节奏型速度纪录 / 导出练习记录");
{
  /* summarize 的 30 天口径：10 天前的场次在 7 天视图不进桶、30 天视图进桶 */
  const now = new Date(2026, 8, 15, 12, 0, 0).getTime();
  const at = n => { const d = new Date(2026, 8, 15, 10, 0, 0); d.setDate(d.getDate() - n); return d.getTime(); };
  const list = [
    { t: at(10), sec: 300, bpm: 100, name: "民谣" },
    { t: at(1), sec: 60, bpm: 120, name: "民谣" },
    { t: at(0), sec: 60, bpm: 90, name: "Funk" },
  ];
  const S7 = loadApp().beat.Stats.summarize(list, now, 7);
  eq(S7.days.length, 7, "7 天视图 7 根柱");
  eq(S7.days.reduce((a, d) => a + d.sec, 0), 120, "7 天视图不含 10 天前的场次");
  const S30 = loadApp().beat.Stats.summarize(list, now, 30);
  eq(S30.days.length, 30, "30 天视图 30 根柱");
  eq(S30.days.reduce((a, d) => a + d.sec, 0), 420, "30 天视图含 10 天前的场次");
  eq(S30.range, 30, "range 标记 = 30");
  /* 各节奏型速度纪录：同名取最高、按 BPM 降序 */
  eq(JSON.stringify(S30.byPattern), JSON.stringify([{ name: "民谣", bpm: 120 }, { name: "Funk", bpm: 90 }]),
    "各节奏型纪录：民谣取最高 120、Funk 90");
  /* 默认参数兼容：不传 rangeDays = 7 天 */
  eq(loadApp().beat.Stats.summarize(list, now).days.length, 7, "rangeDays 缺省 = 7");

  /* UI：切换 30 天 → 30 根柱 + pill 高亮同源；重开 overlay 复位回 7 天 */
  const app = loadApp({ "beatsight.log": JSON.stringify({ v: 1, sessions: list }) });
  app.els["statsBtn"].fire("click");
  eq(app.els["statsBars"].children.length, 7, "打开默认 7 根柱");
  app.els["statsRangeRow"].fire("click", { target: pill({ range: "30" }) });
  eq(app.els["statsBars"].children.length, 30, "切到 30 天 → 30 根柱");
  const p30 = app.els["statsRangeRow"].children.find(c => c.dataset.range === "30");
  ok(p30.classList.contains("active") && p30.getAttribute("aria-pressed") === "true", "30 天 pill 高亮与 aria 同源");
  ok(app.els["statsByPattern"].textContent.indexOf("民谣 · 120 BPM") >= 0, "节奏型纪录行显示「民谣 · 120 BPM」");
  app.els["statsClose"].fire("click");
  app.els["statsBtn"].fire("click");
  eq(app.els["statsBars"].children.length, 7, "重开 overlay 复位回 7 天视图");

  /* 导出：有序列化内容 + 文件名带日期；空记录导出给提示不下载 */
  const parsed = JSON.parse(app.beat.Store.serializeLog());
  eq(parsed.kind, "practice-log", "导出格式 kind=practice-log");
  eq(parsed.sessions.length, 3, "导出含全部 3 场");
  app.els["statsExport"].fire("click");
  ok(true, "有记录时点导出不报错（下载走 Blob + a.click 通道）");
  const app2 = loadApp();
  app2.els["statsBtn"].fire("click");
  app2.els["statsExport"].fire("click");
  eq(app2.els["modalMsg"].textContent, "还没有练习记录可导出。", "空记录导出 → 提示而非下载空文件");
  app2.els["modalOk"].fire("click");
}
