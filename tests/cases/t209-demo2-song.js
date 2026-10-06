/* T209 第二首示例曲《我们能不能不分手》（v3.34.7）
   ---------------------------------------------------------------------------
   为什么单开一个用例文件：v3.34.7 之前示例曲是**单例**，所有断言都写在 t63/t152 里；
   加了第二首之后，那些文件只做了"跟随新事实更新"，**没有一条断言真正检查第二首**——
   等于新功能零覆盖。本文件补上。

   钉四件事：
     ① 第二首确实带出（10 段 / 33 小节），且**两首共存不互相覆盖**
     ② 它的 4 个节奏型是**内置**（不是用户自定义）——这是它能在别人机器上播的前提
     ③ 块引用落在 DEMO2_BUILTIN_BASE 区间，解析得到的正是那 4 个型
     ④ 歌词按段挂齐（8 段有词、2 段无词；总字数与数据一致）
   ★ 另有一条"用户删不掉型"的边界：内置型没有删除入口，故引用不会断。
   ============================================================================ */
const { loadApp, ok, eq, section } = require("../lib/harness");

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
  eq(beat.songBars(beat.Store.findArrange("demo-ztx")), 64,
     "★ 第一首的小节数不受影响（64 小节）");
}

section("T209b 它的 4 个型必须是**内置**的（否则别人机器上播不了）");
{
  const { beat } = firstRun();
  eq(beat.BUILTINS.length, 21, "★ 内置库 12 + 《在他乡》5 + 《我们能不能不分手》4 = 21");
  eq(beat.Store.customs.length, 0,
     "★★ 自定义库保持空 —— 第二首的 4 个型**不是**用户自定义条目（原先是，本版内置化）");

  const base = 17;   // DEMO2_BUILTIN_BASE = 12 + 5
  const names = beat.BUILTINS.slice(base).map(p => p.name);
  eq(names.length, 4, "尾部恰好 4 个型");
  ok(names.every(n => n.includes("《我们能不能不分手》")),
     "★ 4 个型名都带出处标注（仓库惯例「特征名（《歌名》段落）」）：" + names.join(" / "));
  ok(names.some(n => n.includes("八分满扫")), "含「八分满扫」");
  ok(names.some(n => n.includes("切音")), "含「切音」型");
  ok(beat.BUILTINS.slice(base).every(p => p.bars.length === 1
      && p.bars[0].reduce((s, x) => s + x.t, 0) === 192),
     "★ 4 个型各是 1 小节、恰好 192 tick（与首曲的 demo 型同规格）");
}

section("T209c 块引用落在第二首的型基址区间，且解析得到那 4 个型");
{
  const { beat } = firstRun();
  const d2 = beat.Store.findArrange("demo-wmbbf");
  const idxs = [];
  d2.sections.forEach(s => s.blocks.forEach(b => {
    eq(b.ref.type, "builtin", "★ 引用是内置下标（不是 custom id）");
    idxs.push(b.ref.idx);
  }));
  const uniq = [...new Set(idxs)].sort((a, b) => a - b);
  eq(JSON.stringify(uniq), JSON.stringify([17, 18, 19, 20]),
     "★★ 用到的型下标恰好 = DEMO2_BUILTIN_BASE(17) … +3 —— 与挂载顺序是同序契约");
  ok(idxs.every(i => beat.resolveRef({ type: "builtin", idx: i }) !== undefined),
     "★ 每个下标都解析得到型（无坏引用）");
  eq(JSON.stringify(beat.arrangeProblems(d2)), "[]", "曲式无引用/拍号问题");
  eq(beat.Arrange.demoStale(), false, "★ 稳态下 demoStale = false（不需要重建）");
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
