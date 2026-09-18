/* BeatSight 自动化测试 · 示例曲《在他乡》（v2.3.0）
   T63 系列。
   ---------------------------------------------------------------------------
   契约：示例数据逐格来自参考谱面（用户填的十六分格表），载入 = 7 个节奏型预设
   + 整首曲式（10 段，行=段）+ 每段歌词行（段内绝对 tick）。方向存手部动作
   （D=下扫/U=上扫，渲染层翻转）；弦区 0=低/1=全/2=高；空扫 = rest+dir；
   段长不足 4 小节按行末节奏型补扫（歌词/扫弦数据 1:1 不增删）。

   v2.4.1 起入口变了：overlay 里的「载入示例」按钮已删，改由 init 期的
   Arrange.ensureDemo() 自动把 7 个节奏型 + 曲式 + 歌词带出来（预设库自动带出）。
   所以本组不再点按钮，而是直接调确保入口，并补一条"自动带出、无需手动点"的断言。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");

const pByName = (beat, nm) => beat.Store.customs.find(c => c.name === nm);
const charAt = (beat, sec, ch) => beat.lyricCharsAt(beat.DEMO_ID, sec).find(c => c.ch === ch);
/* 「带出示例」的入口：v2.4.1 无按钮，走确保函数（幂等，可重复调） */
const bringDemo = beat => beat.Arrange.ensureDemo();
/* 首次打开的载入（seedDemo:false 让 S.demoSeeded 为假 → 装配层真的会带出示例）。
   其余用例默认 seedDemo:true（示例视作已带出），免得各自的老起点全被 +7 打偏。 */
const firstRun = () => loadApp(undefined, { seedDemo: false });

/* ================= 场景 T63a：载入 = 预设 + 曲式 + 歌词三件套 ================= */
section("T63a 示例载入 · 预设 / 曲式 / 歌词 / 和弦进段名");
{
  const { beat, els } = firstRun();
  /* ★ v2.4.1：init 期就自动带出——不点任何按钮，示例已经在库里 */
  eq(beat.Store.customs.length, 7, "★ 打开页面即自动带出 7 个示例节奏型（无需手动载入）");
  ok(!!beat.Store.findArrange(beat.DEMO_ID), "★ 曲式也自动落库");
  eq(beat.Store.lyrics.filter(l => l.arrangeId === beat.DEMO_ID).length, 10, "★ 歌词行一并带出（10 行）");
  beat.Arrange.open();
  const r = bringDemo(beat);
  ok(r && r.created === false, "★ 再次确保时认得已有数据（created=false，不重复建）");
  ok(beat.Store.demoSeeded(), "★ 带出后闩已落（下次启动不会再来一遍）");
  eq(beat.Store.customs.length, 7, "生成 7 个示例节奏型（5 基本型 + 收束 + 收尾）");
  const a = beat.Store.findArrange(beat.DEMO_ID);
  ok(!!a, "曲式落库（固定 id）");
  eq(a.sections.length, 10, "全曲 10 段（行=段）");
  ok(a.sections[1].name.includes("C·Am·Dm"), "★ 和弦序列写进段名（无和弦轨的落点）");
  ok(a.sections[8].name.includes("Am·Em·F·C·Am·Em"), "六和弦行完整进段名");
  eq(JSON.stringify(beat.arrangeProblems(a)), "[]", "曲式无引用/拍号问题");
  /* ★ v2.4.1：预设在侧栏可见——这是"能切换节奏型"的前提。
     旧版只 importPresets 不刷列表，数据在库里但侧栏看不到，用户就"切不了型"。
     ★ 必须在**扫弦轨**上看：示例 7 个型全带 dir，普通轨会被 hasStrum 过滤掉
       （这正是"仍在扫弦轨，普通轨隐藏"的设计口径），故先切轨再断言列表。
     ★ 用"递归取文本"而不是 el.textContent：沙箱 stub 的 textContent 是自己的字符串字段、
       不聚合子节点（真实 DOM 才聚合），直接读会是空串——那样这条断言恒假，
       测的就不是"列表里有没有示例"了 */
  const deepText = el => (el.textContent || "") +
    (el.children || []).map(deepText).join(" ");
  beat.Tracks.set("strum");
  const kids = els["presetList"].children;
  ok(kids.length > 0 && kids[0].className.includes("demo-section"),
     "★ 侧栏第一组就是示例曲（预设库第一位）");
  const demoBox = kids.find(x => x.className.includes("demo-group"));
  ok(!!demoBox, "示例组已渲染");
  eq(demoBox.children.length, 7, "示例组里 7 个节奏型条目");
  const demoTxt = deepText(demoBox);
  ok(demoTxt.includes("节奏型 1"), "★ 示例节奏型出现在侧栏预设列表里（能看到才切得动）");
  ok(!demoTxt.includes("在他乡 · 节奏型"),
     "★ 条目显示短名（剥掉「在他乡 · 」前缀）——分组头已交代曲名，逐条重复是噪声");
  ok(deepText(els["presetList"]).includes("内置预设"), "内置预设组仍在（示例是**新增**一组，不是替换）");
  beat.Tracks.set("plain");
  eq(els["presetList"].children.filter(x => x.className.includes("demo-section")).length, 0,
     "★ 普通轨下示例组整体隐藏（与「普通轨隐藏」的口径一致）");

  /* 歌词锚点抽查（段内绝对 tick = 小节×192 + 格×12，时值 = 格×12） */
  const xiang = charAt(beat, 1, "乡");
  eq([xiang.t, xiang.dur].join(), "72,48", "「乡」= 第 4 字带延音（t=72, dur=48＝两个八分）");
  eq(charAt(beat, 1, "慰").t, 552, "副歌上末字「慰」= 第 3 小节第 14 格");
  eq(charAt(beat, 0, "我").t, 120, "★ 开头「我」从第 3 拍后半进（t=120，不是段首）");
  eq(charAt(beat, 3, "﹣").dur, 192, "收束的延音占位「﹣」独占一整小节");
  eq(beat.lyricCharsAt(beat.DEMO_ID, 8).length, 28, "人静的雨夜 28 字全录");
  eq(beat.lyricSpanTicks(beat.DEMO_ID, 8), 1536, "★ 六小节的行 = repeats 2（段长 8 小节补到 4 的倍数）");
  eq(charAt(beat, 8, "庞").t, 1032, "「庞」= 段内第 6 小节第 6 格（1032 tick）");
  beat.Arrange.close();
}

/* ================= 场景 T63b：扫弦格映射（方向翻转 / 弦区 / 空扫 / 无动作） ================= */
section("T63b 示例载入 · 扫弦格映射逐格正确");
{
  const { beat, els } = firstRun();
  beat.Arrange.open();
  bringDemo(beat);
  const p1 = pByName(beat, "在他乡 · 节奏型1（十六分满扫）");
  eq(JSON.stringify(p1.bars[0][0]), JSON.stringify({ t: 12, rest: false, dir: "D", zone: 1 }),
     "P1 格0 = 全部弦下扫（F→zone1，谱面 ↓ 存 D）");
  eq(JSON.stringify(p1.bars[0][1]), JSON.stringify({ t: 12, rest: true, dir: "U" }),
     "P1 格1 = 空扫上扫（蓝括号：rest+dir，不带 zone）");
  eq(JSON.stringify(p1.bars[0][6]), JSON.stringify({ t: 12, rest: false, dir: "D", zone: 0 }),
     "P1 格6 = 低音弦区下扫（B→zone0）");
  const p4 = pByName(beat, "在他乡 · 节奏型4（雨夜）");
  eq(JSON.stringify(p4.bars[0][8]), JSON.stringify({ t: 12, rest: true }),
     "★ 无动作格 = 纯休止（无 dir 无 zone，与空扫区分开）");
  ok(beat.Store.customs.every(c => c.bars.length === 4
      && c.bars.every(b => b.reduce((s, x) => s + x.t, 0) === 192)), "7 个型每小节恰好 192 tick");
  /* 组合型：收束 = P2 + P1×3（行末型补齐） */
  const shou = pByName(beat, "在他乡 · 收束");
  eq(JSON.stringify(shou.bars[0][0]), JSON.stringify(pByName(beat, "在他乡 · 节奏型2（副歌）").bars[0][0]),
     "收束第 1 小节 = 节奏型2");
  eq(JSON.stringify(shou.bars[1]), JSON.stringify(p1.bars[0]), "收束第 2 小节 = 节奏型1");
  eq(JSON.stringify(shou.bars[3]), JSON.stringify(p1.bars[0]), "★ 补齐小节按行末型续扫（手不停、嘴休息）");
  beat.Arrange.close();
}

/* ================= 场景 T63c：幂等 ================= */
section("T63c 示例载入 · 重复调不重复建 / 预设残留可复用");
{
  const { beat, els } = firstRun();
  beat.Arrange.open();
  /* v2.4.1：init 已带出过一次，这里再调两次，验幂等 */
  const r2 = bringDemo(beat);
  const r3 = bringDemo(beat);
  eq(r2.created, false, "★ 第二次调认得出已有数据（不是静默重复建）");
  eq(r3.created, false, "第三次同理");
  eq(beat.Store.customs.length, 7, "★ 预设没翻倍");
  eq(beat.Store.arranges.length, 1, "曲式没翻倍");
  eq(beat.Store.lyrics.length, 10, "歌词行没翻倍");
  /* 用户删了曲式但留了预设：再带出时按名复用旧预设，不新建 */
  beat.Store.deleteArrange(beat.DEMO_ID);
  bringDemo(beat);
  eq(beat.Store.customs.length, 7, "★ 预设按名查重复用（仍是 7 个）");
  ok(!!beat.Store.findArrange(beat.DEMO_ID), "曲式重建");
  eq(beat.Store.lyrics.filter(l => l.arrangeId === beat.DEMO_ID).length, 10, "歌词随曲式重建");
  beat.Arrange.close();
}

/* ================= 场景 T63d：载入后真实可播（歌词锚点 + 循环本行） ================= */
section("T63d 示例载入 · 播放锚点 / 循环本行落点");
{
  const { beat } = firstRun();
  beat.Arrange.loadDemo();
  beat.Store.S.lyricCue = true;
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: false };
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2.4);
  /* 96BPM：1 拍 0.625s → 1 个十六分格 0.15625s；开头段第 1 小节「我多想」在格 10/12/14 */
  const cues = ac.hits.filter(h => h.kind === "noise" && h.filterFreq === 2000);
  eq(cues.length, 3, "开头小节「我多想」三声锚点（前两拍半纯扫弦当预备）");
  near(cues[0].t, 1.6425, 1e-6, "「我」= 格10 × 0.15625s + 0.08s 起点");
  near(cues[2].t, 2.2675, 1e-6, "「想」= 格14 × 0.15625s + 0.08s 起点");
  eq(beat.Store.S.playing, true, "示例曲正常播放中");
  beat.Controls.stop();
  /* 循环本行：直接落到桥段段（跨小节延音「夜」所在行） */
  beat.Arrange.loopLyricSection(beat.DEMO_ID, 6);
  eq(JSON.stringify([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to]), "[6,6]",
     "★ 循环本行落到桥段（与 F2 同一套机制）");
  const ye = charAt(beat, 6, "夜");
  eq([ye.t, ye.dur].join(), "192,144", "跨小节的「夜」：t=192（次小节首）dur=144 延至下一个「那」");
}
