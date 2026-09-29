/* BeatSight 自动化测试 · 型级标注（v2.72.0，1.3）
   T141 系列。
   ---------------------------------------------------------------------------
   用户要求（1.3，拍板：型级）：给节奏型配「和弦或自由文案」的标注，
   显示在可视化区域**每小节行首**（与曲式和弦胶囊同一位置同一口径）。

   机理与契约：
     · 数据：pattern 加可选 `label` 字段（≤40 字符，trim）。留空不写字段 ⇒
       老存档/老导出包对象形状零变化（零迁移）。
     · 白名单两处：validatePreset（导入/加载归一）与 serializePresets（导出）
       都必须带 label——否则导出即丢（T141d 钉死）。
     · 显示：chordAtRow 增设预设模式分支——贴 curPattern().label，只在每小节
       第一片行（b % subsPerBar() === 0）返回（与曲式"每小节贴一次"同构；
       1 小节型 = 每行贴）。曲式分支（secChords 路径）一字未动。
     · 编辑器：名称旁加「标注」输入框；保存留空不写字段；副本流程继承源型标注。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const TPB = 48;
const bar4 = () => [{ t: TPB }, { t: TPB }, { t: TPB }, { t: TPB }];
const withLabel = label => ({ name: "练习C", meter: 4, bars: [bar4(), bar4(), bar4(), bar4()], ...(label !== undefined ? { label } : {}) });
/* 冷键预置（beatsight.customs = {customs:[…]}，validatePreset 在加载期归一）。
   ★ 必须带 id：真实应用的 customs 全都有 id（保存/导入路径生成）；无 id 的种子
   会让 selectedPreset 解析不到（S.sel.id=undefined）——测试种子要贴真形状 */
const seedCold = list => ({ "beatsight.customs": JSON.stringify({ customs: list.map((p, i) => ({ ...p, id: "c141-" + i })) }) });
const chordsIn = els => {
  const out = [];
  const walk = el => (el.children || []).forEach(c => {
    if (/(^| )bar-chord( |$)/.test(c.className)) out.push(c.textContent);
    walk(c);
  });
  walk(els["viz"]);
  return out;
};
const selCustom = (beat, storage, i) => {
  const list = JSON.parse(storage.get("beatsight.customs")).customs;
  beat.Store.S.sel = { type: "custom", id: list[i].id };
  beat.Presets.applyPatternChange();
};

/* ================= 场景 T141a：预设模式 · 有标注 ⇒ 每小节行首贴胶囊 ================= */
section("T141a 标注显示 · 预设模式每小节行首一颗胶囊（首片行才贴）");
{
  const { beat, els, storage } = loadApp();
  eq(beat.Store.importPresets(JSON.stringify([withLabel("C")])).ok, true, "导入带标注的型成功");
  selCustom(beat, storage, 0);
  const chips = chordsIn(els);
  ok(chips.length >= 4, "★ 4 小节型在窗口内 → 每小节行首一颗胶囊——实际 " + chips.length + " 颗");
  ok(chips.every(t => t === "C"), "★ 胶囊文本 = 标注「C」（每小节重复贴）");
}

/* ================= 场景 T141b：无标注 ⇒ 预设模式不挂胶囊（现状零变化） ================= */
section("T141b 无标注 ⇒ 不挂胶囊；曲式模式判据一字未动");
{
  const { beat, els, storage } = loadApp(seedCold([withLabel(undefined)]));
  selCustom(beat, storage, 0);
  eq(chordsIn(els).length, 0, "★ 无标注 ⇒ 预设模式零胶囊（老用户所见不变）");
  /* 曲式分支源码级钉死：v2.77.0 起路径 = 块级 per-bar 取值，段名解析回落已退役 */
  ok(/segs\[barIn\]/.test(html) && !/const cs = secChonds?\(secBlk\.name\);/.test(html) &&
     !/const cs = secChords\(secBlk\.name\);/.test(html),
    "★ 曲式和弦路径 = 块级 per-bar（段名解析回落退役；存量由加载期迁移搬进块）");
}

/* ================= 场景 T141c：编辑器 · 回填 / 保存 / 副本继承 ================= */
section("T141c 编辑器 · 标注输入框：回填、留空不写字段、副本继承");
{
  const { beat, els, storage } = loadApp(seedCold([withLabel("Am7")]));
  selCustom(beat, storage, 0);
  els["editBtn"].fire("click");                              // 打开编辑器（副本流程）
  eq(els["patLabelInput"].value, "Am7", "★ 副本继承源型标注（输入框回填 Am7）");
  els["patLabelInput"].value = "Dm7";
  els["savePresetBtn"].fire("click");
  const last = JSON.parse(beat.Store.serializePresets()).presets.pop();
  eq(last.label, "Dm7", "★ 保存写入标注（导出面可见）");
  ok(!!JSON.parse(storage.get("beatsight.customs")).customs.find(c => c.label === "Dm7"),
    "★ 标注落冷键 beatsight.customs（编辑器保存即新增的既有口径）");
  /* 留空不写字段：形状与老对象一致 */
  els["editBtn"].fire("click");
  els["patLabelInput"].value = "   ";
  els["savePresetBtn"].fire("click");
  const last2 = JSON.parse(beat.Store.serializePresets()).presets.pop();
  ok(!("label" in last2), "★ 留空（纯空白）⇒ 对象上不写 label 字段（零迁移形状）");
}

/* ================= 场景 T141d：导入白名单 · 脏标注静默降级 + 导出往返 ================= */
section("T141d 白名单 · 非字符串/纯空白省略，超长截 40（同 dir/zone 口径）；导出往返不丢");
{
  const { beat } = loadApp();
  beat.Store.importPresets(JSON.stringify([
    withLabel(123),                       // 非字符串 → 省略
    withLabel("   "),                     // 纯空白 → 省略
    withLabel("X".repeat(50)),            // 超长 → 截 40
  ]));
  const list = JSON.parse(beat.Store.serializePresets()).presets;
  ok(!("label" in list[0]), "非字符串标注 ⇒ 省略（不牵连整条预设）");
  ok(!("label" in list[1]), "纯空白标注 ⇒ 省略");
  eq(list[2].label, "X".repeat(40), "★ 超长标注 ⇒ 截 40（与 name 同一长度纪律）");
  /* 导出→导入往返：label 不丢（带标注的条目在往返后仍在且值不变） */
  beat.Store.importPresets(beat.Store.exportPresets());
  const round = JSON.parse(beat.Store.serializePresets()).presets.filter(p => p.name === "练习C" && "label" in p);
  ok(round.length >= 1 && round.every(p => p.label === "X".repeat(40)), "★ 导出→导入往返，标注不丢");
}

/* ================= 场景 T141e：「|」分段（v2.72.1，方案丙） =================
   桩环境 K=1（每行 = 整小节，无真实宽度不分片）——桌面语义下：
   · 每段占小节的 1/段数 横向区间，**同行并排多颗**，frac 定位（style.left 百分比）；
   · 1 小节型「C | Am」→ 4 行 × 每行 2 颗（C@0%、Am@50%）——用户原需求；
   · 4 小节型「C | G | Am | F」→ 4 行 × 每行 4 颗（C,G,Am,F）；
   · 无「|」⇒ 每行单颗行首（批 D 逐位不变）。 */
section("T141e 分段标注 · 同行多颗按比例定位；首颗恒第一段；无「|」逐位不变");
{
  const { beat, els, storage } = loadApp(seedCold([{ name: "分段1", meter: 4, bars: [bar4()], label: "C | Am" }]));
  selCustom(beat, storage, 0);
  const chips = chordsIn(els);
  eq(chips.length, 8, "★ 1 小节型 × 4 行 × 每行 2 颗 = 8（前半 C 后半 Am 在同一行并排）");
  eq(chips.filter(t => t === "C").length, 4, "每行首颗 = C");
  eq(chips.filter(t => t === "Am").length, 4, "每行次颗 = Am");
  const firstRow = els["viz"].children.filter(c => /bar-row/.test(c.className))[0]
    .children.filter(c => /bar-chord/.test(c.className));
  eq(firstRow[0].style.left, "calc(0.00% + 6px)", "★ 首颗定位 0%（前半）");
  eq(firstRow[1].style.left, "calc(50.00% + 6px)", "★ 次颗定位 50%（后半）");
}

section("T141e-2 分段 4 段 · 每行 4 颗按序；无「|」逐位不变");
{
  const { beat, els, storage } = loadApp(seedCold([{ name: "分段4", meter: 4,
    bars: [bar4(), bar4(), bar4(), bar4()], label: "C | G | Am | F" }]));
  selCustom(beat, storage, 0);
  const chips = chordsIn(els);
  eq(chips.length, 16, "4 小节型 × 4 行 × 每行 4 颗 = 16");
  eq(chips.slice(0, 4).join(","), "C,G,Am,F", "★ 每行 4 颗按序 C,G,Am,F（每拍一个和弦）");
  /* 无「|」⇒ 批 D 现状逐位不变 */
  const c = loadApp(seedCold([withLabel("C")]));
  selCustom(c.beat, c.storage, 0);
  const chips2 = chordsIn(c.els);
  ok(chips2.length === 4 && chips2.every(t => t === "C"), "无「|」单段 ⇒ 每行单颗行首（批 D 行为不变）");
}
