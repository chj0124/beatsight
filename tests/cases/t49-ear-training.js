/* BeatSight 自动化测试 · 听辨训练（v1.10.0）
   T49 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本组有一条断言比其余都重要：**答案必须真的在候选里**。出题一旦错位，
   用户会「答对了却判错」——那是最伤信任的一类 bug，而且肉眼测不出来（题面看起来永远正常）。 */
"use strict";
const { loadApp, FakeAudioContext, driveFrames, ok, eq, section } = require("../lib/harness");

const at = els => ({          // 读 DOM 桩上的类名/文案一律经此：元素按 id 惰性创建，直接解引用会炸掉整套
  txt: id => { const e = els[id]; return e ? e.textContent : "(未创建)"; },
  cls: id => { const e = els[id]; return e ? e.className : "(未创建)"; },
});

/* ================= 场景 T49：易混组表的完整性 ================= */
section("T49 听辨训练 · 易混组表完整性（开发期错误要在测试里炸）");
{
  const { beat } = loadApp();
  const G = beat.EAR_GROUPS;
  ok(Array.isArray(G) && G.length >= 2, "至少两组易混题（实际 " + (G ? G.length : "?") + " 组）");
  const bad = [];
  G.forEach((g, gi) => {
    if (typeof g.name !== "string" || !g.name.trim()) bad.push(`第 ${gi} 组缺 name`);
    if (!Array.isArray(g.keys) || g.keys.length < 2) bad.push(`第 ${gi} 组候选少于 2 个`);
    else {
      g.keys.forEach(k => { if (!beat.BUILTINS.find(p => p.name === k)) bad.push(`第 ${gi} 组的「${k}」在内置库里找不到`); });
      if (new Set(g.keys).size !== g.keys.length) bad.push(`第 ${gi} 组有重复候选`);
    }
  });
  eq(bad.length, 0, `组表全部可解析（问题：${JSON.stringify(bad)}）`);
  /* 候选必须真的容易混：不能出现「两个候选其实是同一段时值」这种无解题 */
  const dupPat = [];
  G.forEach((g, gi) => {
    const sig = g.keys.map(k => {
      const p = beat.BUILTINS.find(x => x.name === k);
      return p ? p.bars[0].map(s => s.t).join(",") : k;
    });
    if (new Set(sig).size !== sig.length) dupPat.push(gi);
  });
  eq(dupPat.length, 0, "同组候选的时值序列互不相同（否则是一道无解题）");
  eq(beat.EAR_BARS, 2, "每题固定放 2 小节");
}

/* ================= 场景 T49b：出题（纯函数，rand 注入） ================= */
section("T49b 听辨训练 · 出题：答案必在候选内 + 位置随机");
{
  const { beat } = loadApp();
  const G = beat.EAR_GROUPS;
  /* ① 固定序列 → 逐项断言结构 */
  const seq = [0.99, 0.1, 0.7, 0.3, 0.5];
  let k = 0;
  const q = beat.Ear.makeQuestion(() => seq[(k++) % seq.length]);
  ok(!!q, "makeQuestion 返回了题目");
  eq(q.cands.length, G[q.groupIdx].keys.length, "候选数 = 该组的 keys 数");
  eq(q.cands[q.answerIdx], q.answer, "answerIdx 指向的就是 answer 本身（不是看起来像的另一个对象）");
  ok(q.answerIdx >= 0 && q.answerIdx < q.cands.length, "answerIdx 在候选范围内");
  ok(q.cands.includes(q.answer), "★ 答案在候选里（这条错了用户会「答对却判错」）");
  eq(q.cands.filter(p => G[q.groupIdx].keys.includes(p.name)).length, q.cands.length,
    "每个候选都来自本组 keys（不会混进别组的节奏型）");

  /* ② 300 次随机：打乱真的发生 + 答案位置分布均匀（否则会学出「总选 A」的歪策略） */
  const qs = [];
  for (let i = 0; i < 300; i++){ const x = beat.Ear.makeQuestion(Math.random); if (x) qs.push(x); }
  eq(qs.length, 300, "300 次随机出题都拿到了题目（题库没有凑不满的组）");
  eq(qs.filter(x => x.cands.includes(x.answer)).length, qs.length, "300 次随机出题，答案全部在候选内");
  const orderKept = qs.filter(x => x.cands.every((p, i) => p.name === G[x.groupIdx].keys[i])).length;
  ok(orderKept < qs.length * 0.5,
     `打乱确实发生（保持原顺序的只有 ${orderKept}/${qs.length} 次；若不打乱会是 ${qs.length}）`);
  const pos = [0, 0, 0];
  qs.forEach(x => { pos[x.answerIdx]++; });
  ok(pos.every(n => n > qs.length * 0.12),
     `答案位置分布均匀（A/B/C = ${pos.join("/")}；答案总在同一位置的话，用户会靠位置猜）`);
}

/* ================= 场景 T49c：进入 / 播放 / 自动停 ================= */
section("T49c 听辨训练 · 进入即停播 + 自动放 2 小节后停");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  const t = at(els);

  /* 先让主播放跑起来：进入听辨必须把它停掉，否则两路声音叠在一起 */
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 2);
  eq(S.playing, true, "进入前主播放正在跑");

  els["earBtn"].fire("click");
  eq(S.playing, true, "进入后自动出题并播放（playing = true）");
  eq(S.preview, true, "处于试听态（S.preview = true）");
  const ps = beat.previewState();
  eq(ps.isDraft, false, "试听对象不是编辑器草稿（previewRef 已泛化，不再写死 draft）");
  const st = beat.Ear.state();
  eq(ps.name, st.answerName, "试听的正是本题答案（不是别的节奏型）");
  eq(beat.quota().bars, beat.EAR_BARS, "会话播放额度 = 2 小节（走练习量同一套到点停，不用定时器）");
  eq(S.sig, beat.BUILTINS.find(p => p.name === st.answerName).meter, "渲染拍号跟着题目走");
  eq(t.cls("earOverlay").includes("open"), true, "overlay 已打开");
  ok(t.txt("earPlayBtn").includes("播放中"), "播放期间按钮显示「播放中…」（实际「" + t.txt("earPlayBtn") + "」）");

  /* 放完自动停：2 小节按题目拍号算，7/4 最慢（8.75s），给到 12s 余量 */
  const before = beat.Store.logSessions.length;
  driveFrames(ac, beat, 12);
  eq(S.playing, false, "2 小节放完自动停（不用手点）");
  eq(beat.quota().bars, 0, "额度已清零");
  eq(beat.Ear.state().playing, false, "模块内部 playing 标志同步回落");
  eq(t.txt("earPlayBtn"), "重听", "停后按钮变「重听」（尚未作答）");
  eq(beat.Store.logSessions.length, before, "试听不计入练习记录（S.preview 通道的既有语义）");
  ok(!t.txt("statusText").includes("已练满"),
     "不显示「已练满 N 小节」——试听不是练习（实际「" + t.txt("statusText") + "」）");
}

/* ================= 场景 T49d：作答 / 判分 / 连对 / 战绩落盘 ================= */
section("T49d 听辨训练 · 判分 / 连对 / 冷键落盘");
{
  const app = loadApp();
  const beat = app.beat, els = app.els;
  const t = at(els);
  const cands = () => els["earCands"].children;

  eq(beat.Store.earStats.total, 0, "初始战绩为 0");
  els["earBtn"].fire("click");
  eq(cands().length, 3, "渲染出 3 张候选卡");
  eq(cands()[0].children.filter(c => c.className === "ear-strip").length, 1, "每张卡带一条记谱（.ear-strip）");
  eq(cands()[0].children[1].children.filter(c => /(^| )ear-block( |$)/.test(c.className || "")).length > 0, true,
     "记谱里画出了音符块");
  ok(!t.txt("earNote").includes("正确答案"), "未作答时不揭示答案（提示里写了答案就白练了）");

  /* ① 故意答错（顺便验证「作答即停」：答题时还在播，答完必须停） */
  let st = beat.Ear.state();
  eq(beat.Store.S.playing, true, "作答前题目还在播");
  const wrongIdx = (st.answerIdx + 1) % st.names.length;
  cands()[wrongIdx].fire("click");
  st = beat.Ear.state();
  eq(beat.Store.S.playing, false, "作答即停（都答完了不必把剩下的小节放完）");
  eq(beat.quota().bars, 0, "作答停播时额度一并作废（否则下一题会带着旧额度「放一半就停」）");
  eq(st.answered, true, "已作答");
  eq(st.picked, wrongIdx, "记下了选择");
  eq(st.streak, 0, "答错 → 连对归零");
  eq(beat.Store.earStats.total, 1, "累计题数 +1");
  eq(beat.Store.earStats.right, 0, "答对数为 0");
  ok(cands()[st.answerIdx].className.includes("right"), "正确答案那张卡描绿（答错时用户才知道错在哪）");
  ok(cands()[wrongIdx].className.includes("wrong"), "选错的那张卡描红");
  ok(cands().every(c => c.disabled), "作答后全部候选禁用（防重复作答）");
  ok(t.txt("earNote").includes(st.answerName), "提示里揭示正确答案的名字");
  const totalBefore = beat.Store.earStats.total;
  cands()[0].fire("click");
  eq(beat.Store.earStats.total, totalBefore, "作答后重复点击被拒（累计题数不变）");

  /* ② 连对两题 */
  const answerRight = () => cands()[beat.Ear.state().answerIdx].fire("click");
  els["earPlayBtn"].fire("click");                    // 「下一题」
  answerRight();
  eq(beat.Ear.state().streak, 1, "答对 → 连对 1");
  els["earPlayBtn"].fire("click");
  answerRight();
  eq(beat.Ear.state().streak, 2, "再答对 → 连对 2");
  eq(beat.Store.earStats.best, 2, "最高连对跟随更新");
  eq(beat.Store.earStats.right, 2, "答对数 = 2");
  eq(beat.Store.earStats.total, 3, "累计 = 3");
  eq(t.txt("earAcc"), "67%", "正确率 = 2/3 ≈ 67%（实际「" + t.txt("earAcc") + "」）");
  ok(!!app.storage.get("beatsight.ear"), "冷键 beatsight.ear 已立即落盘");
  eq(JSON.parse(app.storage.get("beatsight.ear")).best, 2, "落盘的 best 正确");

  /* ③ 答错一次 → 连对归零，但 best 不回退 */
  els["earPlayBtn"].fire("click");                    // 「下一题」——作答后的卡片已无处理器，必须先换题
  const s2 = beat.Ear.state();
  eq(s2.answered, false, "换题后回到未作答状态");
  cands()[(s2.answerIdx + 1) % s2.names.length].fire("click");
  eq(beat.Ear.state().streak, 0, "答错 → 连对归零");
  eq(beat.Store.earStats.best, 2, "最高连对不回退");
}

/* ================= 场景 T49e：退出恢复 / 键盘路由 / 焦点陷阱 ================= */
section("T49e 听辨训练 · 退出恢复 + Escape + 空格不误触 + inert");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  const t = at(els);
  const sigBefore = S.sig;

  els["earBtn"].fire("click");
  ok(S.preview, "进入后处于试听态");
  const mainBg = app.sandbox.document.getElementById("mainBg");
  eq(mainBg.inert, true, "overlay 打开 → 背景 .main 置 inert（焦点陷阱与编辑器/统计同套）");

  /* 空格不得误触播放；Escape 关闭 */
  beat.Controls.stop();                              // 先停掉自动播放，便于观察空格是否真的没反应
  app.fireWin("keydown", { code: "Space" });
  eq(S.playing, false, "overlay 打开时空格不误触播放");
  app.fireWin("keydown", { key: "Escape" });
  eq(t.cls("earOverlay").includes("open"), false, "Escape 关闭听辨训练");
  eq(mainBg.inert, false, "关闭后摘除 inert");
  eq(S.preview, false, "退出即摘掉试听态");
  eq(beat.previewState().name, null, "previewRef 已清空（下一题不会误用上一题的对象）");
  eq(S.sig, sigBefore, "拍号还原为进入前的值");
  eq(S.playing, false, "退出后未在播放");

  /* 关闭按钮路径 */
  els["earBtn"].fire("click");
  eq(t.cls("earOverlay").includes("open"), true, "再次进入");
  els["earClose"].fire("click");
  eq(t.cls("earOverlay").includes("open"), false, "「返回练习」按钮同样关闭");
  beat.Controls.stop();
}

/* ================= 场景 T49f：冷键加载校验 + 清零 ================= */
section("T49f 听辨训练 · 脏战绩回退 / 清零");
{
  const dirty = [
    { total: -5, right: -1, best: -2 },
    { total: 10, right: 99, best: 3 },          // right > total 会算出 >100% 正确率
    { total: "abc", right: null, best: {} },
    { total: 3.7, right: 1.2, best: "x" },
    {},
  ];
  const bad = [];
  dirty.forEach((d, i) => {
    const { beat } = loadApp({ "beatsight.ear": JSON.stringify(d) });
    const e = beat.Store.earStats;
    if (!(e.total >= 0 && e.right >= 0 && e.right <= e.total && e.best >= 0))
      bad.push(`#${i} → ${JSON.stringify(e)}`);
  });
  eq(bad.length, 0, `5 种脏战绩全部被夹到合法范围（越界的：${JSON.stringify(bad)}）`);
  const { beat: b2 } = loadApp({ "beatsight.ear": JSON.stringify({ total: 10, right: 99, best: 3 }) });
  eq(b2.Store.earStats.right, 10, "right 被 min(total, …) 夹住（不会出现 990% 正确率）");
  const { beat: b3 } = loadApp({ "beatsight.ear": "not json{{" });
  eq(b3.Store.earStats.total, 0, "坏 JSON → 回退全 0，不白屏");

  /* 清零：确认弹窗 → 归零 → 冷键同步 */
  const app = loadApp({ "beatsight.ear": JSON.stringify({ total: 8, right: 5, best: 4 }) });
  const bt = app.beat, et = at(app.els);
  eq(bt.Store.earStats.total, 8, "初始读到 8 题");
  app.els["earBtn"].fire("click");
  eq(et.txt("earTotal"), "8", "overlay 里显示已加载的战绩");
  app.els["earReset"].fire("click");
  app.els["modalOk"].fire("click");
  eq(bt.Store.earStats.total, 0, "清零 → 累计题数归零");
  eq(bt.Store.earStats.best, 0, "清零 → 最高连对归零");
  eq(JSON.parse(app.storage.get("beatsight.ear")).total, 0, "冷键同步写入");
  eq(et.txt("earTotal"), "0", "界面同步刷新");
  eq(et.txt("earAcc"), "—", "无题时正确率显示 —（而不是 NaN）");
}

/* ================= 场景 T49g：入口小字 + 与练习量互不干扰 ================= */
section("T49g 听辨训练 · 入口小字 / 不抢练习量的判定");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  const t = at(els);
  ok(t.txt("earMini").includes("听节奏"), "无战绩时入口旁给一句说明（实际「" + t.txt("earMini") + "」）");
  ok(!t.txt("earMini").includes("正确率"), "无战绩时不显示正确率（避免 0/0 的假数字）");

  /* 把练习量设成「练 1 小节就停」，再进听辨：额度分支必须**优先**，
     否则试听会在第 1 小节就被练习量截断，还会弹出「已练满 1 小节」这种错文案 */
  S.limit = { mode: "bars", n: 1 };
  els["earBtn"].fire("click");
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 12);
  eq(S.playing, false, "听辨放完自动停");
  eq(beat.limitState().bars, beat.EAR_BARS,
     `放满 2 小节才停（练习量设的是 1 小节，被会话额度正确压过；实际 ${beat.limitState().bars} 小节）`);
  ok(!t.txt("statusText").includes("已练满"), "练习量的到点文案没有被听辨训练误触发");
  els["earClose"].fire("click");
  beat.Controls.stop();

  /* 有战绩后入口小字换成数字 */
  const app2 = loadApp({ "beatsight.ear": JSON.stringify({ total: 10, right: 7, best: 3 }) });
  const t2 = at(app2.els);
  ok(t2.txt("earMini").includes("70%"), "有战绩后显示正确率（实际「" + t2.txt("earMini") + "」）");
  ok(t2.txt("earMini").includes("最高连对 3"), "并显示最高连对");
}
