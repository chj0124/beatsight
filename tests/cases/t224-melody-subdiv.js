/* BeatSight 自动化测试 · 旋律细分：三十二分格 + `_`/`__` 时值后缀（v3.38.0）
   T224 系列。
   ---------------------------------------------------------------------------
   本次「一劳永逸」的落点是把**量化原子**从十六分（T16=12t）降到三十二分（T32=6t），
   并把「底档 = 八分」从 `2 * LYRIC_GRID` 解耦成独立常量 `LYRIC_BASE = T8`：
     · 前者让 32 分音符可表达（旧网格根本落不下 6t）；
     · 后者才是真正的坑——若仍写 `2 * LYRIC_GRID`，「八分」会跟着网格偏成 12t，
       贴谱/磁吸/时值±1 格全部指错（t224d 源码钉专门锁这条）。
   文本入口（贴谱）用尾部后缀定档：无 = 八分（24t）、`_` = 十六分（12t）、`__` = 三十二分（6t），
   最多两条（`___` 不开的档 ⇒ 整句不落）。`-` 延长前音、`0` 休止同样吃后缀，
   于是 gap 与 dur 都能按 24 > 12 > 6 贪心分档 ⇒ **无损往返**（serialize ∘ parse = 恒等）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const src = html;
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const miniByAria = (ly, frag) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.getAttribute("aria-label") &&
  c.getAttribute("aria-label").indexOf(frag) >= 0);

/* 夹具（t223 同款）：一个 4/4 段（span=192t）+ 打开编排页并展开歌词编辑区 */
function fixture(){
  const app = loadApp();
  const { beat, els } = app;
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材T", meter: 4, bars: [[{ t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }]] },
  ] })).ok, "素材型导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式T", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                  // 展开歌词编辑区
  return Object.assign(app, { id: arr.id, uid: arr.sections[0].uid, arr: arr });
}

/* ============ T224a：parseMelodyTokens 时值后缀（_ 十六分 / __ 三十二分 / ___ 不落） ============ */
section("T224a parseMelodyTokens · `_`/`__` 定档（含 - 延长 / 0 休止吃后缀 / 三条下划线整句不落）");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  const J = x => JSON.stringify(x);
  eq(J(beat.parseMelodyTokens("5_", C)),
    J({ notes: [{ t: 0, dur: 12, p: 67 }], bad: null }),
    "★「5_」十六分：dur=12（= LYRIC_BASE >> 1）");
  eq(J(beat.parseMelodyTokens("5__", C)),
    J({ notes: [{ t: 0, dur: 6, p: 67 }], bad: null }),
    "★「5__」三十二分：dur=6（= LYRIC_BASE >> 2，本次新开的最小档）");
  eq(J(beat.parseMelodyTokens("5 5_", C)),
    J({ notes: [{ t: 0, dur: 24, p: 67 }, { t: 24, dur: 12, p: 67 }], bad: null }),
    "★★ 后缀只吃本档：前一颗仍八分，后一颗十六分、起点顺推 24");
  eq(J(beat.parseMelodyTokens("5_ 6", C)),
    J({ notes: [{ t: 0, dur: 12, p: 67 }, { t: 12, dur: 24, p: 69 }], bad: null }),
    "★ 上一档变短 ⇒ 下一颗起点前移（cursor 按实际 step 累加）");
  eq(J(beat.parseMelodyTokens("5__ 6", C)),
    J({ notes: [{ t: 0, dur: 6, p: 67 }, { t: 6, dur: 24, p: 69 }], bad: null }),
    "★ 三十二分档同理：下一颗起点 = 6");
  eq(J(beat.parseMelodyTokens("5___", C)),
    J({ notes: null, bad: "5___" }),
    "★★ 三条下划线 = 不开的档（比三十二分更细）⇒ 整句不落");
  eq(J(beat.parseMelodyTokens("x_", C)),
    J({ notes: null, bad: "x_" }),
    "★ 非法音高体 + 后缀 ⇒ bad（后缀不掩盖坏体）");
  eq(J(beat.parseMelodyTokens("5 -_", C)),
    J({ notes: [{ t: 0, dur: 36, p: 67 }], bad: null }),
    "★★「-」吃后缀：延长**细档**（24 + 16分12 = 36）");
  eq(J(beat.parseMelodyTokens("5 -__", C)),
    J({ notes: [{ t: 0, dur: 30, p: 67 }], bad: null }),
    "★「-__」延长三十二分档（24 + 6 = 30）");
  eq(J(beat.parseMelodyTokens("5_ -", C)),
    J({ notes: [{ t: 0, dur: 36, p: 67 }], bad: null }),
    "★ 本体细档 + 八分延音 = 36（档位可混）");
  eq(J(beat.parseMelodyTokens("0_ 5", C)),
    J({ notes: [{ t: 12, dur: 24, p: 67 }], bad: null }),
    "★★ 休止吃后缀：16 分休止把后一音推到 t=12（细档 gap 可表达）");
  eq(J(beat.parseMelodyTokens("0__ 5", C)),
    J({ notes: [{ t: 6, dur: 24, p: 67 }], bad: null }),
    "★ 32 分休止 ⇒ 后一音起于 t=6");
  eq(J(beat.parseMelodyTokens("0_ -__ 5", C)),
    J({ notes: [{ t: 18, dur: 24, p: 67 }], bad: null }),
    "★ 休止两档累加（12 + 6 = 18），后一音起点 = 18");
  eq(J(beat.parseMelodyTokens("0", C)), J({ notes: [], bad: null }),
    "★ 单「0」= 一档纯休止（无音符，非 bad）");
}

/* ============ T224b：melodySerialize 细档贪心分档 + 空档细档休止 ============ */
section("T224b melodySerialize · dur/gap 按 24 > 12 > 6 贪心分档（无损可回填）");
{
  const { beat } = loadApp();
  eq(beat.melodySerialize([{ t: 0, dur: 36, p: 60 }], ""), "1 -_",
    "★ dur=36 ⇒ 八分 + 十六分延音「1 -_」");
  eq(beat.melodySerialize([{ t: 0, dur: 18, p: 60 }], ""), "1_ -__",
    "★★ dur=18 ⇒ 十六分本体 + 三十二分延音「1_ -__」（本体取最小可行档）");
  eq(beat.melodySerialize([{ t: 0, dur: 30, p: 60 }], ""), "1 -__",
    "★ dur=30 ⇒「1 -__」");
  eq(beat.melodySerialize([{ t: 0, dur: 42, p: 60 }], ""), "1 -_ -__",
    "★ dur=42 ⇒ 24 + 12 + 6 三档「1 -_ -__」");
  eq(beat.melodySerialize([{ t: 18, dur: 24, p: 67 }], ""), "0_ 0__ 5",
    "★★ 空档 gap=18 ⇒ 细档休止序列「0_ 0__」（不是丢弃）");
  eq(beat.melodySerialize([{ t: 6, dur: 6, p: 60 }], ""), "0__ 1__",
    "★ 32 分偏移 + 32 分时值全可表达");
  eq(beat.melodySerialize([{ t: 0, dur: 72, p: 60 }], ""), "1 - -",
    "★ 纯 24t 对齐的长音输出与旧版逐位一致（不无故掺 `_`）");
}

/* ============ T224c：无损往返 —— serialize ∘ parse = 恒等（属性断言） ============ */
section("T224c 无损往返 · 任意「6t 对齐 · 升序 · 不重叠」notes ⇒ 序列化再解析逐位还原");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  const fixtures = [
    [{ t: 0, dur: 24, p: 60 }],
    [{ t: 0, dur: 36, p: 60 }],
    [{ t: 0, dur: 18, p: 60 }],
    [{ t: 0, dur: 30, p: 60 }],
    [{ t: 0, dur: 42, p: 60 }],
    [{ t: 18, dur: 24, p: 67 }],
    [{ t: 6, dur: 6, p: 60 }, { t: 24, dur: 12, p: 62 }],
    [{ t: 0, dur: 48, p: 60 }, { t: 60, dur: 18, p: 67 }, { t: 96, dur: 6, p: 69 }],
    [{ t: 12, dur: 6, p: 64 }, { t: 30, dur: 36, p: 65 }],
    [{ t: 6, dur: 6, p: 60 }, { t: 12, dur: 6, p: 62 }, { t: 18, dur: 6, p: 64 }, { t: 24, dur: 6, p: 65 }],
  ];
  let bad = 0;
  for (const notes of fixtures){
    const txt = beat.melodySerialize(notes, "C");
    const back = beat.parseMelodyTokens(txt, C);
    if (JSON.stringify(back.notes) !== JSON.stringify(notes) || back.bad) bad++;
  }
  eq(bad, 0, "★★ " + fixtures.length + " 组 6t 对齐的 notes 全部无损往返（包含 32 分连打）");
}

/* ============ T224d：数据区解耦 —— GRID=T32(6t) / BASE=T8(24t) 独立常量 ============ */
section("T224d 数据区 · LYRIC_GRID=T32、LYRIC_BASE=T8 独立（不再 2 * LYRIC_GRID）");
{
  const { beat } = loadApp();
  eq(beat.LYRIC_GRID, 6, "★ 量化原子降到三十二分：LYRIC_GRID = 6t");
  eq(beat.LYRIC_BASE, 24, "★ 底档仍是八分：LYRIC_BASE = 24t");
  eq(beat.LYRIC_MIN_DUR, 6, "★ 最短时值 = 1 格 = 6t（可拖动抓手的下限）");
  ok(beat.LYRIC_BASE !== 2 * beat.LYRIC_GRID,
    "★★ 解耦钉：BASE（24）≠ 2 × GRID（12）——若还写 2*GRID，八分会偏成 12t");
  ok(/const LYRIC_BASE = T8;/.test(src), "★ 源码钉：LYRIC_BASE 写死为 T8");
  ok(!/LYRIC_BASE\s*=\s*2\s*\*\s*LYRIC_GRID/.test(src),
    "★★ 源码钉：`2 * LYRIC_GRID` 那种派生写法已不存在（改格的连带坑已封）");
}

/* ============ T224e：normLyricLine 6t 归一（保住细档 / 吸附 / 重叠跳过） ============ */
section("T224e normLyricLine notes · 6t 细档原样保留 / 离格吸附 / 重叠跳过");
{
  const app = fixture();
  const { beat, id, uid } = app;
  /* 细档（非 12t 倍数）原样保留——旧网格会把这些吸附/丢掉 */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 0, dur: 18, p: 60 }, { t: 18, dur: 6, p: 62 }] });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), '[{"t":0,"dur":18,"p":60},{"t":18,"dur":6,"p":62}]',
    "★★ 18/6 这类非 12 倍数的时值原样入库（三十二分能力真正打开）");
  /* 12t 对齐的存量音仍合法（6t 的倍数，向后兼容） */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 12, dur: 12, p: 60 }] });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), '[{"t":12,"dur":12,"p":60}]',
    "★ 存量十六分（12t）仍是 6t 倍数 ⇒ 原样保留（老数据零 churn）");
  /* 离格吸附到 6t：t20 → 18、dur20 → 18 */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 20, dur: 20, p: 60 }] });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), '[{"t":18,"dur":18,"p":60}]',
    "★ 离格值吸附到 6t 格（20 → 18）");
  /* 重叠：跳过靠后的那颗（与字同口径） */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 0, dur: 12, p: 60 }, { t: 6, dur: 24, p: 62 }] });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes), '[{"t":0,"dur":12,"p":60}]',
    "★ 半交叠的靠后者跳过（6 < 前颗末点 12）");
  beat.Arrange.close();
}

/* ============ T224f：复制段保住细档 + 贴谱 UI 文案带 `_`/`__` 说明 ============ */
section("T224f 细档随行拷 + 贴谱入口文案（title / uiPrompt / uiAlert 都教 `_`/`__`）");
{
  const app = fixture();
  const { beat, els, id, uid } = app;
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 6, dur: 6, p: 60 }, { t: 18, dur: 36, p: 62 }] });
  const r = beat.Store.duplicateSection(id, uid);
  ok(!!r && !!r.uid, "前提：复制段成功");
  eq(JSON.stringify(beat.Store.findLyric(id, r.uid).notes),
    '[{"t":6,"dur":6,"p":60},{"t":18,"dur":36,"p":62}]',
    "★★ 复制段保住 32 分细档（谱随行拷不做网格降精度）");

  const melBtn = () => miniByAria(lyOf(els, 0), "贴旋律谱");
  ok(!!melBtn(), "前提：贴谱按钮在");
  ok((melBtn().title || "").indexOf("__ 变三十二分") >= 0,
    "★★ 按钮 title 教 `_`/`__` 档位（用户从悬停就能知道怎么打 32 分）");
  melBtn().fire("click");
  ok((els["modalMsg"].textContent || "").indexOf("__ = 三十二分") >= 0,
    "★★ 贴谱弹窗提示带后缀说明（就地可读，不用翻帮助）");
  els["modalInput"].value = "5 x 6";
  els["modalOk"].fire("click");
  ok((els["modalMsg"].textContent || "").indexOf("__ 三十二分") >= 0,
    "★★ 拒收提示也教档位（bad token 时报的是同一套写法）");

  /* 贴谱真的能落 32 分：清空并确定后落库 */
  els["modalOk"].fire("click");                        // 关掉 alert
  melBtn().fire("click");
  els["modalInput"].value = "1 2__";                   // 八分 + 三十二分
  els["modalOk"].fire("click");
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes),
    '[{"t":0,"dur":24,"p":60},{"t":24,"dur":6,"p":62}]',
    "★★ 贴谱端到端：32 分音符落库（t=24 dur=6）");
  beat.Arrange.close();
}
