/* BeatSight 自动化测试 · 音频延迟补偿（v2.14.0）
   T95 系列。
   ---------------------------------------------------------------------------
   需求（用户）：蓝牙耳机连电脑时有明显延迟——做一个"把声音统一提前"的补偿，
   按耳机设备存设置、能自动记住，再给一个"跟着敲"的校准向导。
   契约：
     · 数据 = 独立键 `beatsight.latency`：{v:1, profiles:[{id,name,ms}], currentId}；
       不进热键、不进「导出全部数据」（理由见 index.html 装配层那段与 DEVELOPMENT §3.18）。
     · 生效 = 所有发声统一提前 latencyMs（playClick / lyricCueHit 出口收口）；
       时间轴（loopStart / nextNoteTime）、onset 表、播放头与弹跳球**一字不动**。
     · 排程前瞻量 = schedWindow + 补偿（否则靠近窗口边缘的音会"排到过去"被立即播放）。
     · 向导 = 跟拍法：8 声固定间隔点击（**不吃补偿**）→ 敲击与最近一声求差 → 中位数；
       建议值含人的反应时间（刻意不扣除），落点是"偏大的起点"，最终靠滑杆微调。
   本文件的自建断言与"两处刻意不做的扣除"都以中位数/钳制/前瞻量为准——见各段注释。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, near, section, drive } = require("../lib/harness");

/** 造一份合法的延迟存档 @param {any[]} profiles @param {string} currentId */
const latStore = (profiles, currentId) => JSON.stringify({ v: 1, profiles, currentId });

/* ================= 场景 T95a：读档校验矩阵 ================= */
section("T95a 延迟补偿 · 读档校验（无键不落盘 / 脏值回落 / 逐条淘汰 / 钳制与净化）");
{
  const app = loadApp();
  const { beat, storage } = app;
  /** @param {any} raw 写进存储再读；null = 删键 */
  const readWith = raw => {
    if (raw === null) storage.delete(beat.LAT_KEY);
    else storage.set(beat.LAT_KEY, raw);
    return beat.latRead();
  };

  /* 无键 → 出厂默认，且**不落盘**（"从没做过选择"不该变成一份存档） */
  const def = readWith(null);
  eq(def.profiles.length, 1, "无键：出厂一条「默认」");
  eq(def.profiles[0].ms, 0, "出厂默认 ms = 0（不补偿）");
  eq(storage.has(beat.LAT_KEY), false, "★ 只是读，不落盘");

  /* 整包级脏值 → 回落出厂态 */
  eq(readWith("{bad json").profiles.length, 1, "坏 JSON → 回落");
  eq(readWith("[1,2,3]").profiles.length, 1, "非对象 → 回落");
  eq(readWith(JSON.stringify({ v: 1, profiles: "nope" })).profiles.length, 1, "profiles 非数组 → 回落");
  eq(readWith(JSON.stringify({ v: 1, profiles: [] })).currentId, "p0", "空数组 → 回落出厂态");

  /* 逐条淘汰：无 id / 重复 id */
  const r1 = readWith(latStore([
    { id: "", name: "无 id", ms: 100 },
    { id: "a", name: "A", ms: 100 },
    { id: "a", name: "重复", ms: 200 },
    null,
  ], "a"));
  eq(r1.profiles.length, 1, "无 id / 重复 id / null 条目全部淘汰（只剩 1 条）");
  eq(r1.profiles[0].name, "A", "留下的是第一条合法记录");

  /* ms 钳制与步长对齐：脏类型回 0、负数回 0、超限钳到上限、对齐到 5ms */
  const r2 = readWith(latStore([
    { id: "a", name: "A", ms: "180" },
    { id: "b", name: "B", ms: -50 },
    { id: "c", name: "C", ms: 1e6 },
    { id: "d", name: "D", ms: 182 },
  ], "a"));
  eq(r2.profiles[0].ms, 0, "字符串 ms → 0（只认数值类型，同壁纸遮罩的教训）");
  eq(r2.profiles[1].ms, 0, "负数 → 0");
  eq(r2.profiles[2].ms, beat.LAT_MAX, "超限 → 钳到 " + beat.LAT_MAX);
  eq(r2.profiles[3].ms, 180, "182 → 对齐步长 5（180）");

  /* 名字净化：非字符串可读化、空白兜底、超长截断 */
  const r3 = readWith(latStore([
    { id: "a", name: 42, ms: 0 },
    { id: "b", name: "   ", ms: 0 },
    { id: "c", name: "x".repeat(30), ms: 0 },
  ], "a"));
  eq(r3.profiles[0].name, "42", "数字名 → 可读字符串");
  eq(r3.profiles[1].name, "配置 2", "空白名 → 序号兜底");
  eq(r3.profiles[2].name.length, 24, "超长名截断到 24");

  /* 条数上限 + currentId 回落 */
  const many = Array.from({ length: 20 }, (_, i) => ({ id: "p" + i, name: "配置" + i, ms: 100 }));
  const r4 = readWith(latStore(many, "p19"));
  eq(r4.profiles.length, beat.LAT_MAX_PROFILES, "条数截到上限 " + beat.LAT_MAX_PROFILES);
  eq(r4.currentId, "p0", "currentId 指向被截掉的条目 → 回落第一条");
  eq(readWith(latStore(many.slice(0, 3), "p2")).currentId, "p2", "合法 currentId 原样保留");

  /* 启动收敛：种子存档 → 补偿生效 + 三个控件同源（这一条走的是完整 loadApp 路径） */
  const app2 = loadApp({ "beatsight.latency": latStore([{ id: "p9", name: "我的蓝牙耳机", ms: 200 }], "p9") });
  eq(app2.beat.latencyMs(), 200, "★ 启动即生效（latencyMs = 存档当前配置）");
  eq(String(app2.els["latMs"].value), "200", "滑杆同步到 200");
  eq(app2.els["latMsPct"].textContent, "200 ms", "读数同步");
  eq(app2.els["latProfileSel"].children.length, 1, "下拉一条配置");
  eq(app2.els["latProfileSel"].children[0].textContent, "我的蓝牙耳机", "配置名进入下拉");
}

/* ================= 场景 T95b：生效 —— 所有发声统一提前 ================= */
section("T95b 延迟补偿 · 生效：发声统一提前 offset；时间轴与 onset 表一字不动");
{
  /** 同一套驱动跑两次（0 / 200ms）比对 @param {number} ms */
  const run = ms => {
    const app = loadApp(ms > 0 ? { "beatsight.latency": latStore([{ id: "p0", name: "默认", ms }], "p0") } : {});
    const { beat } = app;
    beat.Controls.setBpm(120);
    beat.Controls.start();
    const ac = /** @type {any} */ (FakeAudioContext.last);
    ac.hits.length = 0;
    drive(ac, beat, 0.6);
    return { osc: ac.hits.filter(h => h.kind === "osc").map(h => h.t), beat };
  };
  const base = run(0);
  const comp = run(200);
  ok(base.osc.length >= 2, "基线发声 " + base.osc.length + " 声（120BPM 跑 0.6s）");
  /* ★ 不是"个数相同"：补偿把前瞻量加大（窗口 + 补偿），同一驱动窗口里会多排到
     后面的音——这正是扩容生效的证据之一（第一版按"个数相等"写，当场被这条差异打红） */
  ok(comp.osc.length >= base.osc.length,
    "补偿让单轮排得更远：基线 " + base.osc.length + " 声 / 补偿 " + comp.osc.length + " 声");
  for (let i = 0; i < base.osc.length; i++){
    near(comp.osc[i], base.osc[i] - 0.2, 1e-9, "第 " + (i + 1) + " 声恰好前移 200ms");
  }
  if (comp.osc.length > base.osc.length){
    near(comp.osc[base.osc.length] - comp.osc[base.osc.length - 1], 0.5, 1e-9,
      "★ 多排的那颗与上一颗仍相隔 500ms（平移不改变节奏关系）");
  }
  /* onset 表（弹跳球口径）与时间轴读数不动——它们标的是"节拍器时间轴" */
  near(comp.beat.onsetBuf()[0].t, base.beat.onsetBuf()[0].t, 1e-9,
    "★ onset 表第一颗的**时间轴**时刻不变（补偿只动「耳朵收到的那一刻」）");
  near(comp.beat.clock().loopStart, base.beat.clock().loopStart, 1e-9, "loopStart 不动");
}

/* ================= 场景 T95c：排程前瞻量随补偿加长 ================= */
section("T95c 延迟补偿 · 单轮就排到「窗口 + 补偿」处（否则边缘音符会被排到过去）");
{
  /** 只跑**第一轮**调度 @param {number} ms */
  const one = ms => {
    const app = loadApp(ms > 0 ? { "beatsight.latency": latStore([{ id: "p0", name: "默认", ms }], "p0") } : {});
    const { beat } = app;
    beat.Controls.setBpm(120);
    beat.Controls.start();
    const ac = /** @type {any} */ (FakeAudioContext.last);
    ac.hits.length = 0;
    ac.currentTime = 0.02;
    beat.AudioEngine.scheduler();
    return ac.hits.filter(h => h.kind === "osc").map(h => h.t);
  };
  const has = (arr, v) => arr.some(t => Math.abs(t - v) < 1e-9);
  const b = one(0), c = one(300);
  ok(!has(b, 0.58), "基线：单轮只排到窗口内（0.58s 那颗还没排）");
  ok(has(c, 0.28), "★ 带 300ms 补偿：单轮就排到 0.58s 那颗，且发声音频时刻 = 0.58 − 0.3 = 0.28");
}

/* ================= 场景 T95d：建议值计算 ================= */
section("T95d 延迟补偿 · 建议值（中位数 / 剔非数 / 钳制 / 步长对齐 / 样本下限）");
{
  const { beat } = loadApp();
  const S = beat.latSuggest;
  eq(S([]).ok, false, "空样本 → 不可用");
  eq(S([100, 110, 120]).ok, false, "3 下 < 下限 4 下 → 不可用");
  eq(S([100, 110, 120, 130]).ms, 115, "偶数样本取中间两个的平均（115）");
  eq(S([100, 110, 120, 130, 140]).ms, 120, "奇数样本取正中（120）");
  eq(S([100, "x", 110, 120, 130]).n, 4, "非数值样本被剔除（可用 4 下）");
  eq(S([600, 700, 800, 900]).ms, 500, "★ 超限 → 钳到 500");
  eq(S([-200, 100, 110, 120]).ms, 105, "有早敲（负差）也按中位数收");
  eq(S([100, 105, 110, 115]).ms, 110, "107.5 → 对齐 5ms 步长 → 110");
}

/* ================= 场景 T95e：校准发声不吃补偿 ================= */
section("T95e 延迟补偿 · 校准发声必须**原始时刻**（测的就是没补偿时多晚到）");
{
  const app = loadApp({ "beatsight.latency": latStore([{ id: "p0", name: "默认", ms: 250 }], "p0") });
  const { beat } = app;
  const out = beat.AudioEngine.calibPlay(3, 500);
  const ac = /** @type {any} */ (FakeAudioContext.last);
  const osc = ac.hits.filter(h => h.kind === "osc").map(h => h.t);
  eq(osc.length, 3, "排了 3 声");
  near(osc[0], out.anchorCtx + 1.2, 1e-9, "首声 = 锚点 + 1.2s 预热（★ 不吃 250ms 补偿）");
  near(osc[1], out.anchorCtx + 1.7, 1e-9, "第二声 +500ms");
  near(osc[2], out.anchorCtx + 2.2, 1e-9, "第三声 +1000ms");
  eq(out.times.length, 3, "返回各声时刻（测量侧用它换算预期墙钟）");
  eq(out.gapMs, 500, "返回间隔（供 UI 描述）");

  /* 校准结束后补偿照常生效 */
  beat.Controls.setBpm(120);
  beat.Controls.start();
  ac.hits.length = 0;
  ac.currentTime = 0.02;
  beat.AudioEngine.scheduler();
  const t0 = ac.hits.filter(h => h.kind === "osc").map(h => h.t)[0];
  near(t0, 0.08 - 0.25, 1e-9, "★ 校准后补偿恢复：首音 0.08 → −0.17");
}

/* ================= 场景 T95f：向导端到端 ================= */
section("T95f 延迟补偿 · 校准向导：跟拍 → 建议 → 采用；抢拍忽略 / 样本不足 / 取消");
{
  const app = loadApp();
  const { beat, els } = app;
  eq(beat.latState().wiz, "idle", "初始向导收起");
  eq(els["latWiz"].hidden, true, "面板初始 hidden");

  /* 播放中开校准 → 先停播 */
  beat.Controls.start();
  eq(beat.Store.S.playing, true, "先开着播放");
  app.setNow(1000);                        // 墙钟锚点：锚点对 = {ctx 0, perf 1000}
  els["latCalibBtn"].fire("click");
  eq(beat.Store.S.playing, false, "★ 开始校准会先停播（听得干净）");
  eq(beat.latState().wiz, "run", "进入 run");
  eq(els["latWiz"].hidden, false, "面板展开");
  eq(els["latWizTap"].hidden, false, "敲击键现身");

  /* 抢拍 / 杂敲：配不上任何一声 → 忽略（不污染样本、不推进进度） */
  app.setNow(1600);
  els["latWizTap"].fire("pointerdown");
  ok(/已记录 0 \/ 8/.test(els["latWizProg"].textContent), "★ 配不上的敲击被忽略");

  /* 八下敲击，每下晚 180ms → 建议值 = 180（中位数） */
  for (let k = 0; k < 8; k++){
    app.setNow(1000 + (1.2 + 0.5 * k) * 1000 + 180);   // 预期 = anchorPerf + (t − anchorCtx)×1000
    els["latWizTap"].fire("pointerdown");
  }
  eq(beat.latState().wiz, "done", "敲满 8 下即结算");
  const res = beat.latState().result;
  ok(res && res.ok && res.ms === 180, "建议值 = 180ms（实测 " + (res ? res.ms : "?") + "）");
  ok(/180/.test(els["latWizMsg"].textContent), "文案报出建议值");
  eq(els["latWizApply"].hidden, false, "「采用」按钮现身");

  /* 采用 → 写进当前配置 + 落盘 + 向导收回 */
  els["latWizApply"].fire("click");
  eq(beat.latencyMs(), 180, "★ 采用后补偿生效 = 180");
  eq(JSON.parse(app.storage.get(beat.LAT_KEY)).profiles[0].ms, 180, "已落盘");
  eq(beat.latState().wiz, "idle", "向导收回");
  eq(els["latWiz"].hidden, true, "面板收起");

  /* 样本不足：只敲 2 下，然后让自动收尾的定时器结算 */
  els["latCalibBtn"].fire("click");
  eq(beat.latState().wiz, "run", "重开一轮");
  for (let k = 0; k < 2; k++){
    app.setNow(1000 + (1.2 + 0.5 * k) * 1000 + 120);
    els["latWizTap"].fire("pointerdown");
  }
  app.runTimers();                         // 自动收尾定时器（桩里手动冲刷）
  eq(beat.latState().wiz, "done", "超时自动结算");
  ok(beat.latState().result.ok === false, "★ 样本 < 4 → 判定测不准");
  els["latWizApply"].fire("click");
  eq(beat.latencyMs(), 180, "测不准时「采用」不写值（防误采纳）");

  /* 取消：收面板、补偿不动 */
  els["latWizCancel"].fire("click");
  eq(beat.latState().wiz, "idle", "取消后回到 idle");
  eq(beat.latencyMs(), 180, "取消不改补偿值");
}

/* ================= 场景 T95g：每设备一套配置 ================= */
section("T95g 延迟补偿 · 配置 CRUD（新建/改名/删除/切换）与两级落盘、重载恢复");
{
  const app = loadApp();
  const { beat, els, storage } = app;
  const S = () => beat.latState();
  eq(S().profiles.length, 1, "出厂一条「默认」");
  eq(els["latDelBtn"].disabled, true, "只剩一条时删除禁用");

  /* 滑杆两级口径：input 生效不落盘，change 才写 */
  els["latMs"].value = "185";
  els["latMs"].fire("input");
  eq(beat.latencyMs(), 185, "input：补偿立即生效");
  eq(els["latMsPct"].textContent, "185 ms", "读数同步");
  eq(storage.has(beat.LAT_KEY), false, "拖动中不落盘");
  els["latMs"].fire("change");
  eq(JSON.parse(storage.get(beat.LAT_KEY)).profiles[0].ms, 185, "change：落盘");

  /* 新建：起点 = 当前值（新建动作本身不改变听感） */
  els["latNewBtn"].fire("click");
  eq(els["modalMask"].hidden, false, "新建 → 弹输入框");
  els["modalInput"].value = "我的蓝牙耳机";
  els["modalOk"].fire("click");
  eq(S().profiles.length, 2, "配置 +1");
  eq(S().profiles[1].name, "我的蓝牙耳机", "名字落上");
  eq(S().currentId, S().profiles[1].id, "新建后切到新配置");
  eq(beat.latencyMs(), 185, "★ 新配置起点 = 当前值（不突变）");
  eq(els["latDelBtn"].disabled, false, "两条时删除可用");
  eq(els["latProfileSel"].children.length, 2, "下拉两条");

  /* 改名：空名不生效、正常名生效 */
  els["latRenameBtn"].fire("click");
  els["modalInput"].value = "   ";
  els["modalOk"].fire("click");
  eq(S().profiles[1].name, "我的蓝牙耳机", "空名不改");
  els["latRenameBtn"].fire("click");
  els["modalInput"].value = "WH-1000XM4";
  els["modalOk"].fire("click");
  eq(S().profiles[1].name, "WH-1000XM4", "改名生效");

  /* 新配置单独调 60ms；切回默认 → 各回各家（证明"按设备一套"真的分了家） */
  els["latMs"].value = "60";
  els["latMs"].fire("input");
  els["latMs"].fire("change");
  eq(beat.latencyMs(), 60, "新配置调到 60");
  els["latProfileSel"].value = "p0";
  els["latProfileSel"].fire("change");
  eq(beat.latencyMs(), 185, "★ 切回默认 → 回到 185（配置按设备各自记账）");
  eq(JSON.parse(storage.get(beat.LAT_KEY)).currentId, "p0", "当前选择已落盘");

  /* 删除当前配置 → 落到剩下那条 */
  els["latProfileSel"].value = S().profiles[1].id;
  els["latProfileSel"].fire("change");
  els["latDelBtn"].fire("click");
  eq(els["modalMask"].hidden, false, "删除 → 确认框");
  els["modalOk"].fire("click");
  eq(S().profiles.length, 1, "配置 −1");
  eq(S().currentId, "p0", "删掉当前配置 → 切到剩下那条");
  eq(beat.latencyMs(), 185, "补偿值随当前配置回落");
  eq(els["latDelBtn"].disabled, true, "又只剩一条 → 删除再次禁用");

  /* 重载：记住上次用的配置 */
  const r = loadApp({ "beatsight.latency": storage.get(beat.LAT_KEY) });
  eq(r.beat.latencyMs(), 185, "重载后补偿值恢复");
  eq(String(r.els["latMs"].value), "185", "重载后滑杆恢复");
  eq(r.els["latProfileSel"].children.length, 1, "重载后配置列表恢复");
}

/* ================= 场景 T95g：校准守卫 —— 节拍音量为 0 时不许开始校准 ================= */
/* 来源（v2.18.0，补装配区那 38 行未覆盖里**真正该测**的两处之一）：
   校准靠"跟着敲"测量，若「节拍」音量是 0，用户敲的是一片静默——校准必然量出一堆垃圾样本。
   装配层（`latCalibStart`）因此在开跑前拦一道。这条守卫此前没有断言。 */
section("T95g 校准守卫 · 节拍音量为 0 时不许开始校准（否则用户跟着一片静默敲）");
{
  const app = loadApp();
  const { beat, els } = app;
  app.setNow(1000);                       // 墙钟锚点（进入 run 后要用）
  beat.Store.S.vol = 0;                   // 用户把「节拍」音量拉到了 0
  els["latCalibBtn"].fire("click");
  eq(beat.latState().wiz, "idle", "★ 音量为 0 ⇒ 校准不进入 run（守卫拦下）");
  eq(els["latWiz"].hidden, true, "★ 面板也不展开（不是「开了但没声音」的半状态）");
  /* 把音量拉回来 → 同一次点击立刻能进：证明守卫只挡 vol=0 那一种，不是把入口弄坏了 */
  beat.Store.S.vol = 0.8;
  els["latCalibBtn"].fire("click");
  eq(beat.latState().wiz, "run", "★ 音量恢复后立刻可校准（守卫的边界是 vol > 0）");
  eq(els["latWiz"].hidden, false, "面板展开");
}
