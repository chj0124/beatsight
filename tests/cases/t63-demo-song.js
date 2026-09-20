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
  eq(beat.Store.customs.length, 5, "★ 打开页面即自动带出 5 个示例节奏型（无需手动载入）");
  ok(!!beat.Store.findArrange(beat.DEMO_ID), "★ 曲式也自动落库");
  eq(beat.Store.lyrics.filter(l => l.arrangeId === beat.DEMO_ID).length, 10, "★ 歌词行一并带出（10 行）");
  beat.Arrange.open();
  const r = bringDemo(beat);
  ok(r && r.created === false, "★ 再次确保时认得已有数据（created=false，不重复建）");
  ok(beat.Store.demoSeeded(), "★ 带出后闩已落（下次启动不会再来一遍）");
  eq(beat.Store.customs.length, 5, "生成 5 个示例节奏型（《在他乡》的 5 个单小节扫弦型）");
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
  /* ★ v2.5.0 口径修正：原来数的是 `children.length === 7`（第一个子节点恰好是第 1 个型时成立）——
     它测的其实不是"7 个型"，而是"组里恰好有 7 个孩子"。加了整首连播那一行之后这条必然假，
     而它并不代表功能坏了。改为按**条目类名**数：`preset-item` 才是"节奏型条目"这个语义 */
  const demoItems = demoBox.children.filter(x => /(^| )preset-item( |$)/.test(x.className));
  eq(demoItems.length, 5, "示例组里 5 个节奏型条目（v2.6.0 起型 = 单小节原子单元）");
  /* v2.5.0：整首连播入口与段序条（用户反馈「只能重复练习单一节奏型」的落点）。
     两者都是示例分组的**直接子节点**（扁平挂法，见 buildDemoSongRow 的注释），
     按钮在「整首连播」那一行内部 */
  const playRow = demoBox.children.find(x => /(^| )demo-play-row( |$)/.test(x.className));
  ok(!!playRow, "★ 示例组里有「整首连播」那一行");
  const playAll = playRow && playRow.children[0];
  ok(!!playAll, "★ 示例组里有「整首连播」按钮");
  eq(playAll.textContent, "整首连播", "按钮文案");
  const secRow = demoBox.children.find(x => /(^| )demo-sec-row( |$)/.test(x.className));
  ok(!!secRow, "★ 示例组里有段序条");
  eq(secRow.children.length, 10, "★ 段序条按原曲顺序列出全部 10 段");
  eq(secRow.children[0].textContent, "1 开头", "第 1 段短标签 = 序号 + 段名（「 · 」之前那段）");
  eq(secRow.children[7].textContent, "8 主歌二", "第 8 段短标签");
  ok(String(secRow.children[0].getAttribute("aria-label")).includes("只循环这一段"),
     "段号的语义写进 aria-label（点它 = 只循环那一段）");
  eq(secRow.getAttribute("role"), "group", "段序条是 pill 组（与其余 pill 组同契约）");
  eq(secRow.children[0].getAttribute("aria-pressed"), "false",
     "★ 未在编排这首示例曲时整条不高亮（悬空高亮比没有高亮更容易误读）");
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
  eq(beat.lyricSpanTicks(beat.DEMO_ID, 8), 1152, "★ 六小节的行 = 6 小节 × 192（v2.6.0 起不再垫到 8）");
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
  ok(beat.Store.customs.every(c => c.bars.length === 1
      && c.bars[0].reduce((s, x) => s + x.t, 0) === 192), "★ 5 个型各是**1 小节**、恰好 192 tick");
  /* 收束不再是"组合型"：它是**两小节、两块**（v2.6.0 第 Ⅳ 期的核心改动）。
     原先那个 4 小节的「收束」型就是"把 4 小节循环硬套到逐小节谱上"的产物 */
  const a4 = beat.Store.findArrange(beat.DEMO_ID);
  eq(JSON.stringify(a4.sections[3].blocks.map(b => b.repeats)), JSON.stringify([1, 1]),
     "★ 「收束」段 = 2 个块、各 1 遍（不再是型里的 4 小节补齐）");
  eq(JSON.stringify(a4.sections[9].blocks.map(b => b.repeats)), JSON.stringify([1, 1]),
     "★ 「你忍不住的」段同理 = 2 块各 1 遍");
  eq(beat.secBars(a4.sections[3]), 2, "收束段长 = 2 小节（原先垫成 4）");
  eq(beat.Store.customs.some(c => c.name.includes("收束")), false,
     "★ 「收束」不再是独立型（它本就是两个相邻小节各用一个型）");
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
  eq(beat.Store.customs.length, 5, "★ 预设没翻倍");
  eq(beat.Store.arranges.length, 1, "曲式没翻倍");
  eq(beat.Store.lyrics.length, 10, "歌词行没翻倍");
  /* 用户删了曲式但留了预设：再带出时按名复用旧预设，不新建 */
  beat.Store.deleteArrange(beat.DEMO_ID);
  bringDemo(beat);
  eq(beat.Store.customs.length, 5, "★ 预设按名查重复用（仍是 5 个）");
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
  /* ★ 只数**第 1 小节内**的锚点（v2.6.0）：段 1 现在是 1 小节，下一小节就属于段 2 了，
     而「副歌 · 上」第 1 行有 7 个字——调度器的前瞻窗口会把它们的锚点一并排进来。
     （旧数据下段 1 = 4 小节、只有第 1 小节有词，所以当时"整段只出 3 声"恰好等价） */
  const inBar1 = cues.filter(c => c.t < 2.5);
  eq(inBar1.length, 3, "★ 第 1 小节「我多想」三声锚点（前两拍半纯扫弦当预备）");
  near(inBar1[0].t, 1.6425, 1e-6, "「我」= 格10 × 0.15625s + 0.08s 起点");
  near(inBar1[2].t, 2.2675, 1e-6, "「想」= 格14 × 0.15625s + 0.08s 起点");
  eq(beat.Store.S.playing, true, "示例曲正常播放中");
  beat.Controls.stop();
  /* 循环本行：直接落到桥段段（跨小节延音「夜」所在行） */
  beat.Arrange.loopLyricSection(beat.DEMO_ID, 6);
  eq(JSON.stringify([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to]), "[6,6]",
     "★ 循环本行落到桥段（与 F2 同一套机制）");
  const ye = charAt(beat, 6, "夜");
  eq([ye.t, ye.dur].join(), "192,144", "跨小节的「夜」：t=192（次小节首）dur=144 延至下一个「那」");
}

/* ================= 场景 T63e：逐小节谱（v2.6.0 第 Ⅳ 期） ================= */
section("T63e 示例载入 · 《在他乡》= 30 小节逐小节谱（段长 1/3/4/2/4/2/4/2/6/2）");
{
  const { beat } = firstRun();
  const a = beat.Store.findArrange(beat.DEMO_ID);
  /* ★ v2.6.0 的核心：全曲 30 小节（此前把段长垫到 4 的倍数 → 44 小节）。
     逐小节数据来自参考页的 `var BARS`（每小节带自己的 strum 字段） */
  eq(beat.songBars(a), 30, "★ 全曲 30 小节（v2.6.0 前是被垫出来的 44 小节）");
  eq(JSON.stringify(a.sections.map(s => beat.secBars(s))),
     JSON.stringify([1, 3, 4, 2, 4, 2, 4, 2, 6, 2]),
     "★ 段长 = 真实小节数（不再是 4 的倍数）");

  /* ★ 逐小节谱 → 块的映射：相邻同型合并成一块（块 = 型 × N 遍）。
     这一串就是整首歌的骨架，任何一处错位都会在这里现形 */
  const runs = a.sections.flatMap(s => s.blocks.map(b =>
    b.repeats + "×" + String(beat.resolveRef(b.ref).name).replace("在他乡 · ", ""))).join(" | ");
  eq(runs,
     "1×节奏型1（十六分满扫） | 3×节奏型2（副歌） | 4×节奏型2（副歌） | 1×节奏型2（副歌） | 1×节奏型1（十六分满扫）"
     + " | 4×节奏型3（主歌） | 2×节奏型3（主歌） | 4×节奏型5（桥段） | 2×节奏型3（主歌）"
     + " | 6×节奏型4（雨夜） | 1×节奏型4（雨夜） | 1×节奏型1（十六分满扫）",
     "★ 全曲 12 个块，逐段逐块与参考页的 30 小节表对齐");

  /* ★★ 最要紧的一条：**段长与词行逐小节对齐**。
     以前段长被垫过（1→4、2→4、6→8），多出来的小节"手不停嘴休息"；
     现在两者必须**逐小节一一对应**。判据用"有没有字越界被剔除"：
     段长一旦短于词行所需，末行的字会落在段外而被剔除（共享区 lyricCharsAt 会滤掉）；
     段长一旦长于词行，末尾会出现没有词的空白小节（下面另有一条按小节数比） */
  eq(JSON.stringify(a.sections.map((s, i) => {
    const span = beat.lyricSpanTicks(beat.DEMO_ID, i);
    return beat.lyricCharsAt(beat.DEMO_ID, i).filter(c => c.t + c.dur > span).length;
  })), JSON.stringify(a.sections.map(() => 0)),
     "★ 没有字越界：每段的词行都装得进该段的真实小节数");

  /* 词行数 = 段长（行=小节）。用"最后一行落在第几小节"间接钉：最后一行必须落在段内最后一小节 */
  eq(JSON.stringify(a.sections.map((s, i) => {
    const chars = beat.lyricCharsAt(beat.DEMO_ID, i);
    if (!chars.length) return -1;
    const barTicks = 192;               // 4/4 一小节 = 4 拍 × 48 tick（与 beat.TPB 同值）
    return Math.floor(Math.max.apply(null, chars.map(c => c.t)) / barTicks);
  })), JSON.stringify([0, 2, 3, 1, 3, 1, 3, 1, 5, 1]),
     "★ 每段最后一行落在该段最后一小节（行=小节的直接判据）");
}
