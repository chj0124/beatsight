/* BeatSight 自动化测试 · 练习闭环：本期分布 / 未碰清单 / 听辨并入统计（v1.11.0）
   T50 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本组的关键是**两个口径不能混**：
     · maxBpm / byPattern 是**全时段极值**（"我最高打到过多少"必须跨期看）
     · practice / untouched 是**本期**（"这周练了哪些、哪块没碰"只在窗口内才成立）
   混掉的后果很隐蔽：切到"近 7 天"却把三个月前的纪录算进"本期练过"，用户会以为自己在练，
   实际那一项这周一次没碰。所以下面有几条专门盯着窗口边界。 */
"use strict";
const { loadApp, pill, ok, eq, section } = require("../lib/harness");

/* 真实日志里存的是 activePattern().name —— 民谣扫弦的全名带后缀，不是"民谣扫弦" */
const FOLK = "民谣扫弦 · 下-下上-上下上";

/* ================= 场景 T50：本期分布与未碰清单（纯函数，固定时钟） ================= */
section("T50 练习分布 · 本期口径 / 全时段口径 / 未碰清单");
{
  const { beat } = loadApp();
  /* 固定时钟：2026-09-16（周三）12:00。近 7 天窗口 = 09-10 00:00 起 */
  const now = new Date(2026, 8, 16, 12, 0, 0).getTime();
  const at = (day, h, mi) => new Date(2026, 8, day, h, mi || 0, 0).getTime();
  /* 按时间升序（真实日志是追加写的）。刻意放两个卡在窗口边界上的会话 */
  const log = [
    { t: at(9, 10),    sec: 60, bpm: 120, name: "民谣扫弦" },     // 09-09：窗口外
    { t: at(9, 23, 59), sec: 30, bpm: 110, name: "Funk 十六分" }, // 09-09 23:59：差一分钟进窗口
    { t: at(10, 0),    sec: 30, bpm: 90,  name: "八分摇滚" },     // 09-10 00:00：恰在窗口起点上
    { t: at(13, 10),   sec: 60, bpm: 88,  name: "切分节奏型" },   // 09-13（周日，本周外）
    { t: at(14, 10),   sec: 60, bpm: 90,  name: "民谣扫弦" },     // 09-14（周一，本周内）
    { t: at(15, 10),   sec: 60, bpm: 96,  name: "民谣扫弦" },
    { t: at(16, 9),    sec: 60, bpm: 100, name: "民谣扫弦" },
  ];
  const avail = ["民谣扫弦", "切分节奏型", "八分摇滚", "Funk 十六分", "三连音基础"];
  const r = beat.Stats.summarize(log, now, 7, avail);

  /* ---- 全时段口径 ---- */
  eq(r.maxBpm, 120, "速度纪录取全时段最高（含窗口外那场 120）");
  eq(r.byPattern[0].name, "民谣扫弦", "各节奏型纪录榜首位仍是全时段最高的那个");
  eq(r.byPattern[0].bpm, 120, "纪录榜用全时段值（不是本期最高 100）");
  eq(r.count, 7, "累计场次 = 全部日志条数");

  /* ---- 本期口径 ---- */
  eq(r.practice.length, 3, "本期练过 3 种（民谣 / 切分 / 八分摇滚）");
  const folk = r.practice[0];
  eq(folk.name, "民谣扫弦", "按场次降序，民谣扫弦居首");
  eq(folk.count, 3, "民谣扫弦本期 3 场");
  eq(folk.minBpm, 90, "★ 本期最低 90——**不含**窗口外那场的 120");
  eq(folk.maxBpm, 100, "★ 本期最高 100——全时段 120 不算进本期区间");
  eq(JSON.stringify(folk.recent), JSON.stringify([90, 96, 100]), "迷你趋势取本期最近 ≤5 场，按时间升序");
  eq(JSON.stringify(r.practice.map(p => p.name)), JSON.stringify(["民谣扫弦", "切分节奏型", "八分摇滚"]),
     "同场次时按时长降序（切分 60s 在八分摇滚 30s 之前）");
  /* 取下标前一律兜一层空对象：变异后 practice 可能少一项，直接解引用会让**整套测试崩掉**、
     后面所有用例一条都跑不到（v1.3.1 起的老教训：断言要"报错"不要"崩溃"） */
  const third = r.practice[2] || {};
  eq(third.minBpm, 90, "八分摇滚落在窗口起点 09-10 00:00 上 → 算本期（含端点）");
  eq(JSON.stringify(third.recent), JSON.stringify([90]), "单场只给一个点（面板不画趋势）");

  /* ---- 未碰清单 ---- */
  eq(JSON.stringify(r.untouched.map(u => u.name)), JSON.stringify(["Funk 十六分", "三连音基础"]),
     "未碰清单 = 可用清单 − 本期练过的（Funk 十六分虽在窗口外练过，本期仍是没碰）");
  const fk = r.untouched.find(u => u.name === "Funk 十六分") || {};
  const san = r.untouched.find(u => u.name === "三连音基础") || {};
  eq(fk.ever, true, "Funk 十六分：练过，只是本期没碰");
  eq(san.ever, false, "三连音基础：从没练过");
  eq(r.untouched.findIndex(u => u.name === "民谣扫弦"), -1, "练过的不会出现在未碰清单里");

  /* ---- 其余既有口径不许被改动 ---- */
  eq(r.weekSec, 180, "本周（周一起 09-14）时长不受新逻辑影响：3 × 60s（09-13 是周日，不算）");
  eq(r.streak, 4, "连续天数：16→15→14→13（12 断档）= 4");
  eq(r.days.length, 7, "日柱仍固定 7 根");

  /* ---- 换成 30 天视图：窗口一变，本期口径跟着变，全时段口径不动 ---- */
  const r30 = beat.Stats.summarize(log, now, 30, avail);
  eq(r30.practice.length, 4, "近 30 天：Funk 十六分 也进入本期（4 种）");
  eq(r30.practice.find(p => p.name === "民谣扫弦").maxBpm, 120, "近 30 天：民谣扫弦本期最高变成 120");
  eq(r30.maxBpm, 120, "全时段纪录与窗口无关，仍是 120");

  /* ---- 纯函数不猜全局：不给 available 就不产出未碰清单 ---- */
  eq(beat.Stats.summarize(log, now, 7).untouched.length, 0, "不传 available → 未碰清单为空（不自己去读 BUILTINS）");
  ok(beat.Stats.summarize(log, now, 7).untouched !== undefined,
     "缺省参数下字段仍在（调用方不必判 undefined）");

  /* ---- 趋势只留**最近** 5 场 ----
     7 场才分得出"最近 5 场"与"最早 5 场"：写 slice(0,5) 会错留最早那 5 场，
     而这样画出来的趋势是"很久以前那几天"，与"我现在的状态"正好相反 */
  const many = Array.from({ length: 7 }, (_, i) => ({
    t: at(10 + i, 10), sec: 60, bpm: 80 + i * 5, name: "多场测试",
  }));
  const rm = beat.Stats.summarize(many, now, 7);
  eq(rm.practice[0].count, 7, "7 场都在窗口内");
  eq(rm.practice[0].recent.length, 5, "趋势最多留 5 个点");
  eq(JSON.stringify(rm.practice[0].recent), JSON.stringify([90, 95, 100, 105, 110]),
     "留的是最近 5 场（不是最早 5 场）");

  /* ---- 「最后练习于」按自然日差，不按毫秒差 ----
     毫秒差口径在跨天时会给出错误的"今天"：昨晚 23:59 → 今晨 00:29 只差 30 分钟，
     round(0.02) = 0 → "今天"，可那明明是昨天。这是最容易写错、也最难在白天发现的一处 */
  eq(beat.Stats.agoText(new Date(2026, 8, 16, 0, 0).getTime(), now), "今天", "今天零点 → 今天");
  eq(beat.Stats.agoText(new Date(2026, 8, 15, 23, 59).getTime(), new Date(2026, 8, 16, 0, 29).getTime()),
     "昨天", "★ 昨晚 23:59 → 今晨 00:29 是「昨天」（毫秒差口径会算成「今天」）");
  eq(beat.Stats.agoText(new Date(2026, 8, 14, 23, 59).getTime(), new Date(2026, 8, 16, 0, 1).getTime()),
     "2 天前", "前天 23:59 → 今天 00:01 是「2 天前」");
  eq(beat.Stats.agoText(new Date(2026, 8, 10, 12).getTime(), now), "6 天前", "6 天前");
}

/* ================= 场景 T50b：面板渲染 ================= */
section("T50b 练习分布 · 面板渲染 / 趋势条 / 未碰提示 / 听辨卡");
{
  const DAY = 86400000;
  const now = Date.now();
  /* 用**真实时钟**播种（面板 statsRender() 读 Date.now()）：三场民谣扫弦 90→96→100 形成上升趋势 */
  const seedLog = {
    v: 1, sessions: [
      /* 名字必须与 activePattern().name 逐字一致（日志存的是全名）——
         写成短名会让它既出现在"本期练过"又出现在"从没练过"，测试反而看不出真问题 */
      { t: now - 2 * DAY, sec: 60, bpm: 90,  name: FOLK },
      { t: now - 1 * DAY, sec: 60, bpm: 96,  name: FOLK },
      { t: now,           sec: 60, bpm: 100, name: FOLK },
      { t: now - 1 * DAY, sec: 60, bpm: 88,  name: "切分节奏型" },
    ],
  };
  const app = loadApp({ "beatsight.log": JSON.stringify(seedLog),
    "beatsight.ear": JSON.stringify({ total: 12, right: 8, best: 5 }) });
  const els = app.els, beat = app.beat;
  const txt = id => { const e = els[id]; return e ? e.textContent : "(未创建)"; };

  els["statsBtn"].fire("click");
  eq(txt("statEar"), "67%", "听辨正确率并入统计卡（8/12 ≈ 67%）");
  ok(txt("statEarLab").includes("最高连对 5"), "标签里带上最高连对（实际「" + txt("statEarLab") + "」）");
  ok(txt("statEarLab").includes("共 12 题"), "并说明样本量——小样本的百分比不该被当真");

  const rows = els["statsPatList"].children;
  eq(rows.length, 2, "本期练过 2 种 → 2 行");
  const first = rows[0];
  const firstName = first.children[0];
  eq(firstName.className, "pat-name", "第一列是名字");
  eq(firstName.textContent, FOLK, "按场次降序，民谣扫弦居首");
  const spark = first.children[1];
  eq(spark.className, "spark", "第二列是迷你趋势");
  eq(spark.children.length, 3, "3 场 → 3 根趋势条");
  ok(spark.children.every(b => /%$/.test(b.style.height)), "趋势条用百分比高度（窄屏也能自适应）");
  eq(((rows[1] || { children: [] }).children[1] || { children: [] }).children.length, 0,
     "只有 1 场的节奏型不画趋势（两点连不成趋势）");
  const meta = first.children[2];
  eq(meta.className, "pat-meta", "第三列是数值");
  eq(meta.children.length, 3, "数值列 = 场次 + BPM 区间 + 最后练习于（三个元素，测试才能逐项断言）");
  ok(/^3 场$/.test(meta.children[0].textContent), "场次（实际「" + meta.children[0].textContent + "」）");
  ok(meta.children[1].textContent === "90→100 BPM", "本期 BPM 区间（实际「" + meta.children[1].textContent + "」）");
  ok(/^最后 (今天|昨天|\d+ 天前)$/.test(meta.children[2].textContent),
     "最后练习于按自然日差（实际「" + meta.children[2].textContent + "」）");
  ok(txt("statsPatHead").includes("2 种"), "表头给出本期覆盖的种类数");
  ok(txt("statsUntouched").includes("本期没碰的"), "未碰清单有提示（实际「" + txt("statsUntouched") + "」）");
  ok(txt("statsUntouched").includes("从没练过"), "区分「本期没碰」与「从没练过」");

  els["statsClose"].fire("click");

  /* ---- 空记录：不显示假数字 ---- */
  const app2 = loadApp();
  const els2 = app2.els;
  const txt2 = id => { const e = els2[id]; return e ? e.textContent : "(未创建)"; };
  els2["statsBtn"].fire("click");
  eq(txt2("statEar"), "—", "听辨未开始时显 —（不是 0%——0% 会被读成「全错」）");
  ok(txt2("statEarLab").includes("尚未开始"), "并说明是尚未开始");
  eq(txt2("statsPatHead"), "", "无记录时不显示表头");
  eq(txt2("statsUntouched"), "", "无记录时不显示未碰清单（满屏都说没碰没有意义）");
  eq(els2["statsPatList"].children.length, 0, "无记录时分布区为空");
  els2["statsClose"].fire("click");
}

/* ================= 场景 T50c：切窗口后分布跟着变 ================= */
section("T50c 练习分布 · 切 7/30 天视图，本期口径跟着变");
{
  const DAY = 86400000, now = Date.now();
  const app = loadApp({ "beatsight.log": JSON.stringify({ v: 1, sessions: [
    { t: now - 2 * DAY,  sec: 60, bpm: 96,  name: FOLK },          // 7 天内
    { t: now - 20 * DAY, sec: 60, bpm: 104, name: "Funk 十六分" },  // 7 天外 / 30 天内
  ]}) });
  const els = app.els;
  const rows = () => els["statsPatList"].children.map(r => r.children[0].textContent);
  els["statsBtn"].fire("click");
  eq(JSON.stringify(rows()), JSON.stringify([FOLK]), "近 7 天：只列窗口内的");
  ok(els["statsUntouched"].textContent.includes("Funk 十六分"), "20 天前练过的算「本期没碰」");
  els["statsRangeRow"].fire("click", { target: pill({ range: "30" }) });   // 切「近 30 天」
  eq(JSON.stringify(rows()), JSON.stringify([FOLK, "Funk 十六分"]), "近 30 天：两场都进本期");
  ok(!els["statsUntouched"].textContent.includes("Funk 十六分"), "切窗后它不再是未碰项");
  els["statsClose"].fire("click");
}

/* ================= 场景 T50d：战绩冷键写失败也要可见（不静默） ================= */
section("T50d 练习分布 · 听辨战绩落盘失败要走既有的一次性提示");
{
  const app = loadApp({}, { throwOnWrite: true });
  app.beat.Store.recordEar(true, 1);
  eq(app.beat.Store.earStats.total, 1, "写盘失败不影响内存里的战绩（当场还能用）");
  eq(app.els["brandChip"].textContent, "v" + app.beat.VERSION + " · 保存失败",
     "写失败 → 顶栏 chip 明示（与练习记录/预设同一条通道，不静默）");
  ok(app.els["persistDot"].classList.contains("bad"), "写失败 → 状态点变红");
  app.els["modalOk"].fire("click");
}

/* ================= 场景 T50e：超过 8 种时的截断提示 ================= */
section("T50e 练习分布 · 超过 8 种只列前 8，并明确告知被截断了");
{
  const DAY = 86400000, now = Date.now();
  /* 12 种各练一场：列表只画 8 行，但**必须告诉用户还有 4 种没显示**——
     静默截断会让人以为自己这周只练了 8 种 */
  const names = ["四分基础", "八分摇滚", "附点布鲁斯", "切分节奏型", "Funk 十六分", "华尔兹分解",
    "摇曳 6/8", "三连音基础", "Take Five 律动 · 5/4", "Money 型 · 7/4", "特雷斯略 3+3+2",
    "民谣扫弦 · 下-下上-上下上"];
  const app = loadApp({ "beatsight.log": JSON.stringify({ v: 1,
    sessions: names.map((n, i) => ({ t: now - (i % 3) * DAY, sec: 60, bpm: 90 + i, name: n })) }) });
  const els = app.els;
  const txt = id => { const e = els[id]; return e ? e.textContent : "(未创建)"; };
  els["statsBtn"].fire("click");
  eq(els["statsPatList"].children.length, 8, "超过 8 种时只画 8 行");
  ok(txt("statsPatHead").includes("12 种"), "表头仍报出真实种类数（实际「" + txt("statsPatHead") + "」）");
  ok(txt("statsPatHead").includes("只列前 8 种"), "并明确写出被截断（实际「" + txt("statsPatHead") + "」）");
  els["statsClose"].fire("click");
}
