/* BeatSight 自动化测试 · 块级和弦（v2.75.0 初版；v2.77.0 按小节一格重制）
   T144 系列。
   ---------------------------------------------------------------------------
   用户场景：正常曲式中一个节奏型会重复很多遍，每遍可能对应不同的和弦——
   型级标注（label，批 D）绑在型上，无法表达"每遍不同和弦"的结构性错位。

   语义（v2.75.0 拍板：和弦跟块走，不跟型走；v2.77.0 三项用户需求落地）：
     · 块级 chords = **按小节存储**——「|」分隔、每段 = 该块内一小节的和弦（可留空
       = 该小节不贴），不再均分。旧均分数据显示本来就每小节一颗（floor 公式），
       迁移展开与旧显示逐位一致、零损失；
     · 「段名猜和弦」（secChords 回落）**退役**——和弦来源只剩块级数据；存量段名
       后缀由加载期一次性迁移（戳键 beatsight.chdmig）搬进块并从段名剥掉；
     · 编辑入口搬进段编辑视图歌词网格每行左端（.arg-chd-cell，一行 = 一小节 = 一格，
       格内禁「|」）；块行「和弦 | 分段」文本框退役删除；
     · 白名单：normArrange 收 chords（cap 200 trim；脏值静默降级为省略，同 dir/zone 口径）；
     · 型级 label（预设模式）不参与编排显示——两场景各自独立。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const seedT144 = (blocks, secName, extra) => Object.assign({
  "beatsight.customs": JSON.stringify({ customs: [{ id: "c4b", name: "四小节型", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }),
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "t144", name: "T144",
    sections: [{ name: secName, blocks }] }] }),
  "beatsight.arrmig73": "1",        // 迁移戳：本组只测块级 chords，不受曲式 ×4 迁移干扰
  "beatsight.chdmig": "1",          // 迁移戳：隔离段名和弦迁移（迁移本身在 T144f/g 单测）
  "beatsight.demoSeeded": "1",      // demo 闩：防止 start() 首开带出演示曲把选中切走
  "beatsight.state": JSON.stringify({ v: 3, playMode: "arrange",
    arrangeSel: { id: "t144", from: 0, to: 0, loop: false } }),
}, extra || {});
const blk = (chords, repeats) => ({ ref: { type: "custom", id: "c4b" }, repeats: repeats || 1,
  ...(chords !== undefined ? { chords } : {}) });
const chipsIn = els => {
  const out = [];
  const walk = el => (el.children || []).forEach(c => {
    if (/(^| )bar-chord( |$)/.test(c.className)) out.push(c.textContent);
    walk(c);
  });
  walk(els["viz"]);
  return out;
};
const boot = (blocks, secName, extra) => {
  const app = loadApp(seedT144(blocks, secName, extra));
  app.beat.Presets.refreshAfterPatternChange();   // 曲式窗口重建（chordAtRow 在此被消费）
  return app;
};
const walkCls = (el, re, out) => (el.children || []).forEach(c => {
  if (re.test(c.className)) out.push(c);
  walkCls(c, re, out);
});

/* ============ 场景 T144a：块级 chords 按小节一颗（每遍不同和弦） ============ */
section("T144a 块级 chords · 四小节型 × 1 遍 + C|G|Am|F → 每小节一颗");
{
  const { els } = boot([blk("C|G|Am|F")], "主歌");
  eq(chipsIn(els).join(","), "C,G,Am,F",
    "★ 块级 chords 按小节存储——第 i 段 = 第 i 小节（用户场景落地）");
}

/* ============ 场景 T144b：唯一来源 · 块级 chords 即全部 ============ */
section("T144b 唯一来源 · 块级 chords 显示照常（段名不再参与）");
{
  const { els } = boot([blk("Am")], "主歌 C");   // 段名尾部的 C 不再被解析（机制退役）
  const chips = chipsIn(els);
  ok(chips.length > 0 && chips.every(t => t === "Am"),
    "★ 块级 chords：4 颗全是 Am——实际 " + chips.join(","));
}

/* ============ 场景 T144c：段名猜和弦退役 · 无块级 chords ⇒ 无胶囊 ============ */
section("T144c 退役 · 无块级 chords ⇒ 段名里的 C 不再出胶囊（老回落已删）");
{
  const { els } = boot([blk(undefined)], "主歌 C");
  eq(chipsIn(els).join(","), "",
    "★ secChords 回落退役——和弦只认块级数据，段名后缀不再是来源");
}

/* ============ 场景 T144d：白名单 · 脏 chords 静默降级 + 截断 ============ */
section("T144d 白名单 · 非字符串/纯空白省略；超长截 200");
{
  const { beat } = loadApp(seedT144([], "主歌"));
  beat.Store.upsertArrange({ id: "w1", name: "白名单", sections: [{ name: "s", blocks: [
    { ref: { type: "custom", id: "c4b" }, repeats: 1, chords: 123 },
    { ref: { type: "custom", id: "c4b" }, repeats: 1, chords: "   " },
    { ref: { type: "custom", id: "c4b" }, repeats: 1, chords: "X".repeat(210) },
  ] }] });
  const blocks = beat.Store.findArrange("w1").sections[0].blocks;
  ok(!("chords" in blocks[0]), "非字符串 chords ⇒ 省略（不牵连整条曲式）");
  ok(!("chords" in blocks[1]), "纯空白 chords ⇒ 省略");
  eq(blocks[2].chords, "X".repeat(200), "★ 超长 chords ⇒ 截 200（per-bar 长块需要更多余量）");
}

/* ============ 场景 T144e：UI · 歌词网格行左端的和弦格写回冷键 ============ */
section("T144e UI · 块行文本框退役；歌词网格行和弦格 → Store + 冷键");
{
  const { beat, els, storage } = loadApp(seedT144([blk(undefined, 1)], "主歌"));
  beat.Arrange.open();
  /* 块行不再有和弦输入框（v2.75.0 的 children[3] 已删） */
  const chip0 = els["argSections"].children[0].children[2].children[0];
  ok(!chip0.children.some(c => c.placeholder === "和弦 | 分段"),
    "★ 块行「和弦 | 分段」文本框已退役");
  /* 展开第 1 段歌词编辑器 → 歌词网格行左端出现和弦格（4 小节 = 4 格） */
  const sums = [];
  walkCls(els["argSections"], /(^| )arg-lyric-sum( |$)/, sums);
  ok(sums.length >= 1, "前提：段编辑有歌词摘要行");
  sums[0].fire("click");
  const cells = [];
  walkCls(els["argSections"], /(^| )arg-chd-cell( |$)/, cells);
  eq(cells.length, 4, "前提：4 小节段 = 4 颗和弦格（一行一格）");
  cells[0].value = "Am";
  cells[0].fire("change");
  eq(beat.Store.findArrange("t144").sections[0].blocks[0].chords, "Am",
    "★ 第 1 格写回 per-bar 串（第 1 段 = Am；尾部空段回收）");
  cells[2].value = "Bm";
  cells[2].fire("change");
  eq(beat.Store.findArrange("t144").sections[0].blocks[0].chords, "Am||Bm",
    "★ 第 3 格写回 → 尾部空段回收（Am||Bm）");
  beat.Store.persistArranges();
  const disk = JSON.parse(String(storage.get("beatsight.arranges")));
  eq(disk.arranges[0].sections[0].blocks[0].chords, "Am||Bm", "★ 落冷键 beatsight.arranges");
  cells[0].value = "";
  cells[0].fire("change");
  eq(beat.Store.findArrange("t144").sections[0].blocks[0].chords, "||Bm",
    "★ 清空 ⇒ 空段占位（其余格对位不变）");
  cells[2].value = "";
  cells[2].fire("change");
  ok(!("chords" in beat.Store.findArrange("t144").sections[0].blocks[0]),
    "★ 全空 ⇒ 字段删除（形状与老数据一致）");
  /* 格内禁「|」——竖线被剥成空格，不产生错位段 */
  cells[0].value = "C|Am";
  cells[0].fire("change");
  eq(beat.Store.findArrange("t144").sections[0].blocks[0].chords, "C Am",
    "★ 格内「|」剥成空格（一小节一个和弦，不产生错位段）");
}

/* ============ 场景 T144f：段名和弦迁移 · 后缀进块 + 段名剥净 ============ */
section("T144f 迁移 · 段名末尾和弦序列搬进块级 per-bar chords，段名剥后缀");
{
  /* 无 chdmig 戳 ⇒ 迁移在加载期执行。段 3 小节（块 ×3）+ 段名 2 个和弦：
     旧均分口径下显示为 C,C,Am（floor），迁移展开逐位一致 */
  const app = loadApp(seedT144([blk(undefined, 3)], "副歌 · 下 C·Am", {
    "beatsight.chdmig": "" }));
  const sec = app.beat.Store.findArrange("t144").sections[0];
  eq(sec.blocks[0].chords, "C|Am",
    "★ 后缀按块小节区间展开进块（12 小节块填前 2 格；旧均分显示本就是每小节 floor 取值，展开后逐位一致）");
  eq(sec.name, "副歌 · 下", "★ 段名剥掉和弦后缀");
}

/* ============ 场景 T144g：迁移幂等 · 同一份迁移后冷键再加载，结果逐位一致 ============ */
section("T144g 幂等 · 迁移后的冷键再进（无戳）不再二次加工");
{
  const first = loadApp(seedT144([blk(undefined, 3)], "副歌 · 下 C·Am", {
    "beatsight.chdmig": "" }));
  const disk = JSON.parse(String(first.storage.get("beatsight.arranges")));
  const again = loadApp({
    "beatsight.customs": seedT144([], "主歌")["beatsight.customs"],
    "beatsight.arranges": String(first.storage.get("beatsight.arranges")),
    "beatsight.arrmig73": "1",
    "beatsight.demoSeeded": "1",
    "beatsight.state": JSON.stringify({ v: 3, playMode: "arrange",
      arrangeSel: { id: "t144", from: 0, to: 0, loop: false } }),
  });
  const sec = again.beat.Store.findArrange("t144").sections[0];
  eq(JSON.stringify({ n: sec.name, c: sec.blocks[0].chords }),
    JSON.stringify({ n: disk.arranges[0].sections[0].name, c: disk.arranges[0].sections[0].blocks[0].chords }),
    "★ 二次加载逐位一致（戳键防重复迁移；已剥名无后缀可剥）");
}

/* ============ 场景 T144h：迁移不覆盖已填块 + 非和弦名不动 ============ */
section("T144h 迁移边界 · 已填块不覆盖；非和弦记号后缀不误伤");
{
  const app = loadApp(seedT144([blk("Xm", 2)], "副歌 · 高 C·Am", { "beatsight.chdmig": "" }));
  const sec = app.beat.Store.findArrange("t144").sections[0];
  eq(sec.blocks[0].chords, "Xm", "★ 用户已显式填的块不覆盖（块级本来就更优先）");
  eq(sec.name, "副歌 · 高", "★ 后缀仍剥（信息已冗余——剥掉防双份显示口径）");
  const app2 = loadApp(seedT144([blk(undefined, 1)], "段 · 只有歌词 没有和弦", { "beatsight.chdmig": "" }));
  const sec2 = app2.beat.Store.findArrange("t144").sections[0];
  ok(!("chords" in sec2.blocks[0]), "非和弦记号后缀 ⇒ 不解析不搬运（名字不动）");
  eq(sec2.name, "段 · 只有歌词 没有和弦", "★ 普通名字原样保留");
}

/* ============ 场景 T144i：demoBuildSpec · 段名已剥净 + 块级 per-bar 和弦 ============ */
section("T144i 演示曲 · 段名无后缀，逐小节和弦进块级 chords");
{
  const { beat } = loadApp(seedT144([], "主歌"));
  const spec = beat.demoBuildSpec();
  const chorus = spec.arrange.sections[2];   // 副歌 · 下（P2×4 = 1 块 4 小节）
  eq(chorus.name, "副歌 · 下", "★ demo 段名剥后缀");
  eq(chorus.blocks[0].chords, "G|C|Am|Dm", "★ demo 和弦进块级 per-bar（四小节四格）");
  const bridge = spec.arrange.sections[3];   // 收束（P2 + P1 = 两块各 1 小节）
  eq(bridge.blocks.map(b => b.chords || "").join(","), "G,G",
    "★ 多块段按块区间切分（每块一格）");
}
