/* T209 第二首示例曲《我们能不能不分手》（v3.34.7）
   ---------------------------------------------------------------------------
   为什么单开一个用例文件：v3.34.7 之前示例曲是**单例**，所有断言都写在 t63/t152 里；
   加了第二首之后，那些文件只做了"跟随新事实更新"，**没有一条断言真正检查第二首**——
   等于新功能零覆盖。本文件补上。

   钉四件事：
     ① 第二首确实带出（10 段 / 33 小节），且**两首共存不互相覆盖**
     ② 它的 5 个节奏型是**内置**（不是用户自定义）——这是它能在别人机器上播的前提
     ③ 块引用落在 DEMO2_BUILTIN_BASE 区间，解析得到的正是那 5 个型
     ④ 歌词按段挂齐（8 段有词、2 段无词；总字数与数据一致）
   ★ 另有一条"用户删不掉型"的边界：内置型没有删除入口，故引用不会断。
   ============================================================================ */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const firstRun = () => loadApp(undefined, { seedDemo: false });

section("T209a 第二首示例曲 · 带出 / 段长 / 与第一首共存");
{
  const { beat } = firstRun();
  const d2 = beat.Store.findArrange("demo-wmbbf");
  ok(!!d2, "★ 第二首《我们能不能不分手》已带出（id = demo-wmbbf）");
  eq(d2.name, "《我们能不能不分手》（示例）", "曲式名带「（示例）」后缀，与第一首同构");

  eq(d2.sections.length, 10, "10 段（与源数据一致）");
  eq(beat.songBars(d2), 33, "★ 全曲 33 小节");
  eq(JSON.stringify(d2.sections.map(s => beat.secBars(s))),
     JSON.stringify([1, 7, 1, 3, 1, 7, 1, 7, 1, 4]),
     "★ 段长序列 = 1/7/1/3/1/7/1/7/1/4（与源数据逐段一致）");

  /* 两首共存：加第二首最怕的是"后写的把先写的挤掉"或"只带出一首" */
  ok(!!beat.Store.findArrange("demo-ztx"), "★ 第一首《在他乡》仍在库里（没被第二首挤掉）");
  eq(beat.Store.arranges.length, 2, "库里恰好两条示例曲");
  eq(beat.songBars(beat.Store.findArrange("demo-ztx")), 65,
     "★ 第一首的小节数不受本曲影响（★ 本版《在他乡》末尾新增尾声：64 → 65 小节）");
}

section("T209b 它的 5 个型必须是**内置**的（否则别人机器上播不了）");
{
  const { beat } = firstRun();
  /* ★ 本版：《我们》引子小节 = 琶音型（用户实报）；《在他乡》新增尾声琶音型 P6 插位 16
     ⇒ 本曲基址 16 → 17；全库 21 → 22；型名两首一并改编号制「节奏型N（《歌名》）」。 */
  eq(beat.BUILTINS.length, 22, "★ 内置库 11 + 《在他乡》6 + 《我们能不能不分手》5 = 22（★ 本版：《我们》琶音型 + 《在他乡》尾声 P6 插位）");
  eq(beat.Store.customs.length, 0,
     "★★ 自定义库保持空 —— 第二首的 5 个型**不是**用户自定义条目（原先是，v3.34.7 内置化）");

  const base = 17;   // DEMO2_BUILTIN_BASE = 11 + 6（★ 本版：《在他乡》P6 插位 ⇒ 本曲基址 16 → 17）
  const names = beat.BUILTINS.slice(base).map(p => p.name);
  eq(names.length, 5, "尾部恰好 5 个型（琶音型 = 节奏型1，数组顺序 = 挂载顺序与编号无关）");
  ok(names.every(n => n.includes("《我们能不能不分手》")),
     "★ 5 个型名都带出处标注（编号制「节奏型N（《歌名》）」）：" + names.join(" / "));
  ok(beat.BUILTINS.slice(base).some(p => p.bars.some(b => b.some(s => s.dir === "A"))),
     "★ 本版新增：含琶音型（节奏型1，引子开场，dir=\"A\"）");
  ok(beat.BUILTINS.slice(base).every(p => p.bars.length === 1
      && p.bars[0].reduce((s, x) => s + x.t, 0) === 192),
     "★ 5 个型各是 1 小节、恰好 192 tick（琶音型 = 四分×4，与首曲的 demo 型同规格）");
  ok(beat.BUILTINS.slice(11).every(p => p.desc === "4/4"),
    "★ 两首示例曲的子条目默认只显示拍号，不重复曲名、示例或单小节");
  ok((html.match(/desc: sp\.meter \+ "\/4" \+ \(sp\.bars\.length > 1/g) || []).length === 2,
    "★ 两批内置型共用多小节才追加小节数的生成公式");
}

section("T209c 块引用落在第二首的型基址区间，且解析得到那 5 个型");
{
  const { beat } = firstRun();
  const d2 = beat.Store.findArrange("demo-wmbbf");
  const idxs = [];
  d2.sections.forEach(s => s.blocks.forEach(b => {
    eq(b.ref.type, "builtin", "★ 引用是内置下标（不是 custom id）");
    idxs.push(b.ref.idx);
  }));
  const uniq = [...new Set(idxs)].sort((a, b) => a - b);
  eq(JSON.stringify(uniq), JSON.stringify([17, 18, 19, 20, 21]),
     "★★ 用到的型下标恰好 = DEMO2_BUILTIN_BASE(17) … +4 —— 与挂载顺序是同序契约（★ 本版基址 16→17：P6 插位，arpg52 迁移 +1 位移）");
  ok(idxs.every(i => beat.resolveRef({ type: "builtin", idx: i }) !== undefined),
     "★ 每个下标都解析得到型（无坏引用）");
  eq(JSON.stringify(beat.arrangeProblems(d2)), "[]", "曲式无引用/拍号问题");
  eq(beat.Arrange.demoStale(), false, "★ 稳态下 demoStale = false（不需要重建）");

  /* ★ 本版核心修正的钉子：段 1 是引子（琶音型 + 段名），段 7 的「我们」小节保持满扫 */
  eq(d2.sections[0].name, "引子 · 我们（第一遍）", "★★ 段 1 改名「引子 · 我们」（琶音小节 = 全曲开场手势）");
  eq(d2.sections[6].name, "副歌 · 我们（第二遍）", "★ 段 7 保持「副歌 · 我们」（第二遍乐队已进入，是货真价实的副歌小节）");
  const arp = beat.resolveRef(d2.sections[0].blocks[0].ref);
  eq(arp.name, "节奏型1（《我们能不能不分手》）", "★ 段 1 的块解析到琶音型（编号制新名）");
  eq(JSON.stringify(arp.bars[0][0]), JSON.stringify({ t: 48, rest: false, dir: "A" }),
     "★★ 段 1 第 1 拍 = 一记四分琶音（dir:A，validatePreset 归一后 rest:false 显式在库）");
  ok(arp.bars[0].slice(1).every(s => s.rest === true && s.dir === undefined),
     "★★ 后三拍 = 无动作（无 dir——「后面几拍都不扫弦」；延音不另标记，用户拍板）");
  eq(d2.sections[6].blocks[0].ref.idx, 17, "★ 段 7 仍指八分满扫（节奏型5，idx 17——P6 插位后的新家）");
}

section("T209d 歌词按段挂齐（8 段有词 / 2 段纯间奏）");
{
  const { beat } = firstRun();
  const lines = beat.Store.lyrics.filter(l => l.arrangeId === "demo-wmbbf");
  eq(lines.length, 8, "★ 8 段有歌词（段 3 / 段 4 是 3 小节与 1 小节的纯间奏，源数据里就没有词）");
  const total = lines.reduce((a, l) => a + (l.chars || []).length, 0);
  eq(total, 107, "★ 歌词总字数 = 107（与源数据一致）");
  /* 首句抽查：段 1 是「能不能不分手亲爱的别走…」 */
  const s1 = beat.Store.findArrange("demo-wmbbf").sections[1];
  const c1 = beat.lyricCharsAt("demo-wmbbf", s1.uid);
  eq(c1.map(c => c.ch).join(""), "能不能不分手亲爱的别走全世界都让你要爱我难道你就不会心",
     "★★ 首段歌词逐字正确（合并/换算没错位）");
  /* 段长与词的关系：词的 tick 必须落在该段内 */
  beat.Store.findArrange("demo-wmbbf").sections.forEach((s, i) => {
    const chars = beat.lyricCharsAt("demo-wmbbf", s.uid);
    if (!chars.length) return;
    const span = beat.lyricSpanTicks("demo-wmbbf", s.uid);
    const over = chars.filter(c => c.t + c.dur > span).length;
    eq(over, 0, "段 " + i + " 无字越界（词装得进该段真实小节数）");
  });
}
