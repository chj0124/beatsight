/* BeatSight 自动化测试 · 块级和弦（v2.75.0，2.3' 编排和弦跟块走）
   T144 系列。
   ---------------------------------------------------------------------------
   用户场景：正常曲式中一个节奏型会重复很多遍，每遍可能对应不同的和弦——
   型级标注（label，批 D）绑在型上，无法表达"每遍不同和弦"的结构性错位。

   语义（用户拍板：和弦跟块走，不跟型走）：
     · 编排的**每个块**加可选 chords（「|」分段按**块内小节**均分，复用 label 语法）：
       块 = 四小节型 × 1 遍 + "C | G | Am | F" → 每小节一个和弦；
       块 = 四小节型 × 4 遍 + 同串 → 每遍一个和弦（遍与小节在此重合）；
     · 显示优先级：块级 chords > 段名解析（secChords 保留为回落，路径一字未动）；
     · 白名单：normArrange 收 chords（≤80 trim；脏值静默降级为省略，同 dir/zone 口径）；
     · 型级 label（预设模式）不参与编排显示——两场景各自独立。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const seedT144 = (blocks, secName) => ({
  "beatsight.customs": JSON.stringify({ customs: [{ id: "c4b", name: "四小节型", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }),
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "t144", name: "T144",
    sections: [{ name: secName, blocks }] }] }),
  "beatsight.arrmig73": "1",        // 迁移戳：本组只测块级 chords，不受曲式 ×4 迁移干扰
  "beatsight.demoSeeded": "1",      // demo 闩：防止 start() 首开带出演示曲把选中切走
  "beatsight.state": JSON.stringify({ v: 3, playMode: "arrange",
    arrangeSel: { id: "t144", from: 0, to: 0, loop: false } }),
});
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
const boot = (blocks, secName) => {
  const app = loadApp(seedT144(blocks, secName));
  app.beat.Presets.refreshAfterPatternChange();   // 曲式窗口重建（chordAtRow 在此被消费）
  return app;
};

/* ============ 场景 T144a：块级 chords 按小节均分（每遍不同和弦） ============ */
section("T144a 块级 chords · 四小节型 × 1 遍 + C|G|Am|F → 每小节一颗");
{
  const { els } = boot([blk("C | G | Am | F")], "主歌");
  eq(chipsIn(els).join(","), "C,G,Am,F",
    "★ 块级 chords 按块内小节均分——每小节一个和弦（用户场景落地）");
}

/* ============ 场景 T144b：优先级 · 块级 chords > 段名解析 ============ */
section("T144b 优先级 · 段名带和弦 + 块级 chords ⇒ 块级赢");
{
  const { els } = boot([blk("Am")], "主歌 C");   // 段名尾部有 C（secChords 会解析出它）
  const chips = chipsIn(els);
  ok(chips.length > 0 && chips.every(t => t === "Am"),
    "★ 块级 chords 优先：4 颗全是 Am（段名的 C 被块级覆盖）——实际 " + chips.join(","));
}

/* ============ 场景 T144c：回落 · 无块级 chords ⇒ 段名解析照常 ============ */
section("T144c 回落 · 无块级 chords ⇒ secChords 段名解析照常（老行为零变化）");
{
  const { els } = boot([blk(undefined)], "主歌 C");
  const chips = chipsIn(els);
  ok(chips.length > 0 && chips.every(t => t === "C"),
    "★ 无块级 chords ⇒ 回落段名解析（C 每小节一颗）——实际 " + chips.join(","));
}

/* ============ 场景 T144d：白名单 · 脏 chords 静默降级 + 截断 ============ */
section("T144d 白名单 · 非字符串/纯空白省略；超长截 80");
{
  const { beat } = loadApp(seedT144([], "主歌"));
  beat.Store.upsertArrange({ id: "w1", name: "白名单", sections: [{ name: "s", blocks: [
    { ref: { type: "custom", id: "c4b" }, repeats: 1, chords: 123 },
    { ref: { type: "custom", id: "c4b" }, repeats: 1, chords: "   " },
    { ref: { type: "custom", id: "c4b" }, repeats: 1, chords: "X".repeat(90) },
  ] }] });
  const blocks = beat.Store.findArrange("w1").sections[0].blocks;
  ok(!("chords" in blocks[0]), "非字符串 chords ⇒ 省略（不牵连整条曲式）");
  ok(!("chords" in blocks[1]), "纯空白 chords ⇒ 省略");
  eq(blocks[2].chords, "X".repeat(80), "★ 超长 chords ⇒ 截 80（| 分段串允许更长）");
}

/* ============ 场景 T144e：UI · 块行和弦输入写回冷键 ============ */
section("T144e UI · 块行「和弦 | 分段」输入 → Store + 冷键");
{
  const { beat, els, storage } = loadApp(seedT144([blk(undefined)], "主歌"));
  beat.Arrange.open();
  /* 块 chip 子节点：名(0) 遍数(1) 单位(2) 和弦输入(3) 换(4) 删(5) ⋯(6) */
  const chd = els["argSections"].children[0].children[2].children[0].children[3];
  ok(!!chd && chd.placeholder === "和弦 | 分段", "前提：块行有和弦输入框");
  chd.value = "C | Am";
  chd.fire("change");
  eq(beat.Store.findArrange("t144").sections[0].blocks[0].chords, "C | Am",
    "★ 输入写回 Store（块级字段）");
  beat.Store.persistArranges();
  const disk = JSON.parse(String(storage.get("beatsight.arranges")));
  eq(disk.arranges[0].sections[0].blocks[0].chords, "C | Am", "★ 落冷键 beatsight.arranges");
  chd.value = "";
  chd.fire("change");
  ok(!("chords" in beat.Store.findArrange("t144").sections[0].blocks[0]),
    "★ 清空 ⇒ 字段删除（形状与老数据一致）");
}
