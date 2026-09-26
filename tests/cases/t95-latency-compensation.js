/* BeatSight 自动化测试 · 音频延迟补偿（v2.14.0）
   T95 系列。
   ---------------------------------------------------------------------------
   需求（用户）：蓝牙耳机连电脑时有明显延迟——做一个"把声音统一提前"的补偿，
   按耳机设备存设置、能自动记住。
   契约：
     · 数据 = 独立键 `beatsight.latency`：{v:1, profiles:[{id,name,ms}], currentId}；
       不进热键、不进「导出全部数据」（理由见 index.html 装配层那段与 DEVELOPMENT §3.18）。
     · 生效 = 所有发声统一提前 latencyMs（playClick / lyricCueHit 出口收口）。
     · ★ v2.42.4 起锚点契约（修订 v2.14.0 原契约）：**起播 / ctx 重建重锚时，时间轴锚点
       （loopStart）整体顺延补偿量**——否则首颗音的发声时刻落在 ctx.currentTime 之前，
       Web Audio 把整包过去的包络钳到当下 → 首拍完全无声（v2.14.0 原判"只是晚一点"
       是错误的表现模型）。顺延后：发声时刻与不补偿时逐位相同，补偿改变的是
       「耳机听到的那一刻」（= 发声 + 链路延迟 = 画面落点）；稳态相对关系不变。
       onset 表与 loopStart 随锚点整体顺延（T95b 逐位断言）。
     · 排程前瞻量 = schedWindow + 补偿（否则稳态时靠近窗口边缘的音会被排到过去）。
   v2.42.1：校准向导（跟拍法）整包退役——原 T95d（建议值）/ T95e（校准发声不吃
   补偿）/ T95f（向导端到端）/ 校准守卫四个场景随之删除；保留路径（滑杆微调 +
   多设备配置）由 T95a/b/c/g 覆盖，手动校准的参考起步值走纯文案、由 t102 断言。
   v2.42.4：新增 T95h（首声必须排在未来，start 与 ctx 重建两条路径）。 */
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
section("T95b 延迟补偿 · 生效：锚点顺延补偿量，发声不落过去、节奏关系不变");
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
  /* ★ v2.42.4 契约：锚点顺延补偿量后，发声时刻 = (原锚点 + 补偿) + k·spb − 补偿，
     与不补偿时**逐位相同**——补偿改变的是「耳机听到的那一刻」（= 发声 + 链路延迟
     = 画面落点），不是发声时刻本身。若前瞻量忘了含补偿，这里的逐位相同会破
     （补偿场景的发声会被窗口边缘钳住、滞后于基线）——所以它同时是前瞻量的守卫。 */
  ok(comp.osc.length >= base.osc.length,
    "补偿让单轮排得不比基线少：基线 " + base.osc.length + " 声 / 补偿 " + comp.osc.length + " 声");
  for (let i = 0; i < base.osc.length; i++){
    near(comp.osc[i], base.osc[i], 1e-9, "第 " + (i + 1) + " 声发声时刻与不补偿时逐位相同（顺延的是锚点）");
  }
  ok(comp.osc.length > 0 && comp.osc[0] > 0.02,
    "★ 首颗音排在未来（修复前 t=−0.12 排进过去，包络被钳没 = 首拍无声）");
  if (comp.osc.length > base.osc.length){
    near(comp.osc[base.osc.length] - comp.osc[base.osc.length - 1], 0.5, 1e-9,
      "★ 多排的那颗与上一颗仍相隔 500ms（顺延不改变节奏关系）");
  }
  /* onset 表与 loopStart：随锚点整体顺延补偿量（原契约「一字不动」在起播时刻物理上
     不可满足——锚点不动则首声必落过去；v2.42.4 起改为「顺延补偿量」，稳态相对关系不变） */
  near(comp.beat.onsetBuf()[0].t, base.beat.onsetBuf()[0].t + 0.2, 1e-9,
    "★ onset 表整体顺延补偿量（+200ms）");
  near(comp.beat.clock().loopStart, base.beat.clock().loopStart + 0.2, 1e-9,
    "★ loopStart 顺延补偿量（+200ms）");
}

/* ================= 场景 T95c：排程前瞻量随补偿加长 ================= */
section("T95c 排程前瞻量 = 窗口 + 补偿（网格触达越过普通窗口）");
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
    const emitted = ac.hits.filter(h => h.kind === "osc").map(h => h.t);
    return { emitted, now: ac.currentTime, last: emitted.length ? emitted[emitted.length - 1] : 0 };
  };
  const b = one(0), c = one(500);
  ok(b.last > 0 && b.last <= b.now + 0.3 + 1e-9,
    "基线：单轮网格触达 ≤ now+窗口0.3（最后一颗发声音频时刻 " + b.last.toFixed(2) + "）");
  ok(c.last > c.now,
    "★ 500ms 补偿：首颗音的发声时刻排在未来（锚点 0.58 − 补偿 0.5 = 0.08）");
  /* 网格触达 = 发声音频时刻 + 补偿：500ms 下首颗的网格时刻 0.58 已越过基线的窗口边界
     0.32 —— 发声时刻却与基线同处一个窗口内。这正是「look = win + 补偿」在起播时刻的体现：
     没有加长的话，顺延后的网格（0.58 起）在普通窗口里一颗都排不到，首声会被推迟到
     首个调度周期能追上的时刻（听感 = 起播明显空拍） */
  ok(c.last + 0.5 > c.now + 0.3 + 1e-9,
    "★ 单轮网格触达（发声音频时刻 + 补偿）越过 now+窗口——前瞻量确实含补偿");
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

/* ================= 场景 T95h：首声必须排在未来（v2.42.4，start 与 ctx 重建两条路径） =================
   缺陷（用户实测报障）：设置补偿后第一拍的节拍声消失——起播锚点只预留 0.08s，补偿 >80ms 时
   首颗音的发声时刻（锚点 − 补偿）落在 ctx.currentTime 之前，Web Audio 把整包过去的包络
   钳到当下 → 零长度发声。修复 = 锚点整体顺延补偿量（start() 与 watchCtx 重锚两处同改）。
   反向验证：回退两处锚点 → 本场景全部变红。 */
section("T95h 首声排在未来 · start 与 ctx 重建重锚（修复首拍静默）");
{
  /* 路径一：start() 起播 */
  const app = loadApp({ "beatsight.latency": latStore([{ id: "p0", name: "TWS", ms: 200 }], "p0") });
  const { beat } = app;
  beat.Controls.start();
  const ac = /** @type {any} */ (FakeAudioContext.last);
  ac.hits.length = 0;
  beat.AudioEngine.scheduler();
  const first = ac.hits.filter(h => h.kind === "osc").map(h => h.t)[0];
  ok(first !== undefined, "起播第一轮就排出了首颗节拍音");
  ok(first > ac.currentTime,
    "★ start()：200ms 补偿下首颗音排在未来（t=" + (first === undefined ? "无" : first.toFixed(3)) +
    " > currentTime=" + ac.currentTime.toFixed(3) + "；修复前 t=−0.12 被钳没 = 无声）");

  /* 路径二：ctx 被系统关闭后的重锚（watchCtx 的 closed 分支）——同款锚点，同款修复 */
  ac.state = "closed";
  ac.onstatechange();
  const ac2 = /** @type {any} */ (FakeAudioContext.last);
  ok(ac2 !== ac, "ctx 被关闭后已重建新上下文");
  ac2.hits.length = 0;
  beat.AudioEngine.scheduler();
  const first2 = ac2.hits.filter(h => h.kind === "osc").map(h => h.t)[0];
  ok(first2 !== undefined && first2 > ac2.currentTime,
    "★ ctx 重建重锚：首颗音同样排在未来（同款锚点同款修复，别只修 start 漏了这里）");
}
