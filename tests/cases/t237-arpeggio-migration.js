/* BeatSight 自动化测试 · arpg52 一次性迁移（本版，用户实报 + 补充）
   ============================================================================
   本迁移（戳键 beatsight.mig.arpg52）把存量数据对齐到本版三件事：
     ① 《我们能不能不分手》段 1：改名「副歌 · 我们（第一遍）」→「引子 · 我们（第一遍）」、
       块引用改指琶音型（节奏型1）——第 1 小节实为琶音（用户实报），oneStale 查不出
       （换引用两侧都是 1 小节、段长不变）。
     ② 《在他乡》新增尾声琶音型 P6，按**同序契约**插位 BUILTINS[16] ⇒《我们》五型
       基址 16 → 17——插入点后（旧下标 16..19）的**四表面**内置引用整体 +1
       （sel 热键 / 曲式块 / groups 成员 / builtinNames 键），与 v3.35.5 bnmig35 同构。
     ③ 型名改编号制——型名不落冷键，零负担。
   ★ 两类存量形状都必须收敛（迁移按**值域**认领）：
     · 正式版存量（≤ v3.45.9）：段 1 引用 16（八分满扫），Q5 尚不存在；
     · 未发布内测形状（本批首版曾把琶音型挂在 20）：段 1 引用 20。
   本组钉：① 两类形状都收敛 ② 幂等 ③ 四表面位移 ④ 保守边界/不越界 ⑤ 无垃圾键。
   ============================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const OLD_NAME = "副歌 · 我们（第一遍）", NEW_NAME = "引子 · 我们（第一遍）";
const ARP_NAME = "节奏型1（《我们能不能不分手》）";   // 琶音型（编号制新名）
const USER_EDIT = "我改的段名（用户编辑）";

/* ★ 预置样本必须**结构忠实**（t214 的教训）：从应用自己带出的曲式序列化而来，
   只把下标/段名改回迁移前的旧形状，并在段 2 落一个用户编辑作防重建标记。 */
const liveDemo2 = () => {
  const { beat } = loadApp(undefined, { seedDemo: false });
  return JSON.parse(JSON.stringify(beat.Store.findArrange("demo-wmbbf")));
};
/** 把现形状改回**正式版存量**（≤ v3.45.9）：[17..20] → −1（即 16..19），段 1 → 16，段 1 名回旧名 */
const releaseShape = () => {
  const a = liveDemo2();
  a.sections.forEach(s => s.blocks.forEach(b => {
    if (b.ref.idx >= 17 && b.ref.idx <= 20) b.ref.idx -= 1;
  }));
  a.sections[0].blocks[0].ref.idx = 16;
  a.sections[0].name = OLD_NAME;
  a.sections[1].name = USER_EDIT;      // 防重建标记：启动收敛若介入会消失
  return a;
};
/** 把现形状改回**未发布内测形状**（本批首版：琶音型曾挂 20）：[17..21] → −1，段 1 → 20 */
const devShape = () => {
  const a = liveDemo2();
  a.sections.forEach(s => s.blocks.forEach(b => {
    if (b.ref.idx >= 17 && b.ref.idx <= 21) b.ref.idx -= 1;
  }));
  a.sections[0].blocks[0].ref.idx = 20;
  a.sections[0].name = OLD_NAME;
  a.sections[1].name = USER_EDIT;
  return a;
};
/* ★★ 样本必须带上真机上早已置位的**老迁移戳**（t214 的教训），否则桩里每轮重跑历史迁移。
   dev 形状另带 arpg51 戳——本批首版机器上它已置位，arpg52 必须照样接得住。 */
const MODERN_STAMPS = { "beatsight.arrmig73": "1", "beatsight.bnmig35": "1", "beatsight.chdmig": "1", "beatsight.chdsp36": "1" };
const seedWith = (arrange, extra) => Object.assign({
  "beatsight.demoSeeded": "1",
  "beatsight.arranges": JSON.stringify({ v: 1, arranges: [arrange] }),
}, MODERN_STAMPS, extra || {});
const stored = (app, k) => (app.storage && typeof app.storage.getItem === "function")
  ? app.storage.getItem(k) : (app.storage && app.storage.get ? app.storage.get(k) : null);
const arpIdx = app => app.beat.BUILTINS.findIndex(p => p.name === ARP_NAME);
const d2 = app => app.beat.Store.findArrange("demo-wmbbf");

section("T237a 正式版存量（≤ v3.45.9）收敛：段 1 改名换琶音 + 其余引用 +1");
{
  const app = loadApp(seedWith(releaseShape()));
  const ARP = arpIdx(app);
  eq(ARP, 21, "前提：琶音型（节奏型1）住在新基址尾部 21（P6 插位 16 ⇒ 基址 17..21）");
  const a = d2(app);
  eq(a.sections[0].name, NEW_NAME, "★★★ 段 1 改名「引子 · 我们」");
  eq(a.sections[0].blocks[0].ref.idx, ARP, "★★★ 段 1 引用 16 → 琶音型 21（内存里已对）");
  eq(app.beat.resolveRef(a.sections[0].blocks[0].ref).name, ARP_NAME, "★ 改完解析得到琶音型（不是坏引用）");
  eq(a.sections[6].blocks[0].ref.idx, 17, "★★★ 段 7（第二遍副歌）16 → 17（八分满扫的新家）");
  eq(a.sections[1].blocks[0].ref.idx, 18, "★★★ 段 2（Q2）17 → 18");
  eq(app.beat.resolveRef(a.sections[6].blocks[0].ref).name, "节奏型5（《我们能不能不分手》）", "★ 段 7 解析回八分满扫（+1 后仍指同一个型）");
  eq(a.sections[1].name, USER_EDIT, "★ 段 2 的用户编辑保留（启动收敛没介入）");
  const cold = JSON.parse(stored(app, "beatsight.arranges"));
  eq(cold.arranges[0].sections[0].blocks[0].ref.idx, ARP, "★★ 冷键已回写（下次启动不再改）");
  eq(stored(app, "beatsight.mig.arpg52"), "1", "★ 迁移戳已置（幂等的依据）");
}

section("T237b 内测形状（琶音型曾挂 20 + arpg51 戳已在）同样收敛");
{
  const app = loadApp(seedWith(devShape(), { "beatsight.mig.arpg51": "1" }));
  const ARP = arpIdx(app);
  const a = d2(app);
  eq(a.sections[0].name, NEW_NAME, "★★★ 段 1 改名（旧 arpg51 戳不拦新迁移——两套形状一套规则）");
  eq(a.sections[0].blocks[0].ref.idx, ARP, "★★★ 段 1 引用 20 → 琶音型 21");
  eq(a.sections[6].blocks[0].ref.idx, 17, "★★★ 段 7 16 → 17（+1 位移照走）");
  eq(a.sections[1].blocks[0].ref.idx, 18, "★★★ 段 2 17 → 18");
  eq(a.sections[1].name, USER_EDIT, "★ 用户编辑保留");
}

section("T237c 幂等：戳已在 ⇒ 不再扫（第二次启动零改动）");
{
  const app = loadApp(seedWith(releaseShape(), { "beatsight.mig.arpg52": "1" }));
  const a = d2(app);
  eq(a.sections[0].name, OLD_NAME, "★★★ 戳已置时一字不动——迁移只跑一次");
  eq(a.sections[0].blocks[0].ref.idx, 16, "★★★ 引用停在旧值（不重放、不二次位移）");
  eq(a.sections[6].blocks[0].ref.idx, 16, "★★★ 段 7 也停在旧值（bnmig35 当年二次位移的事故不复现）");
}

section("T237d 四表面位移：sel 热键 / groups 成员 / builtinNames 键同步 +1");
{
  const seed = seedWith(releaseShape(), {
    "beatsight.state": JSON.stringify({ v: 3, sel: { type: "builtin", idx: 16 } }),
    "beatsight.groups": JSON.stringify({ v: 1, groups: [{ name: "我的组", members: [{ type: "builtin", idx: 17 }, { type: "builtin", idx: 15 }] }] }),
    "beatsight.builtinNames": JSON.stringify({ v: 1, names: { "16": "我的十六", "15": "十五不动" } }),
  });
  const app = loadApp(seed);
  eq(app.beat.Store.S.sel.idx, 17, "★★ sel 16 → 17（热键内存副本，persist 随后重写）");
  const g = JSON.parse(stored(app, "beatsight.groups"));
  eq(g.groups[0].members[0].idx, 18, "★★ groups 成员 17 → 18");
  eq(g.groups[0].members[1].idx, 15, "★ 插入点之前（15）不动");
  const bn = JSON.parse(stored(app, "beatsight.builtinNames"));
  eq(bn.names["17"], "我的十六", "★★ builtinNames 键 16 → 17（改名覆盖跟着型走）");
  eq(bn.names["15"], "十五不动", "★ 键 15 不动");
  eq(bn.names["16"], undefined, "★ 旧键 16 不残留");
}

section("T237e 保守边界 / 不越界：用户改过的引用不认领、非本曲的段名不动");
{
  /* 段 1 被用户换成过别的型（idx 18）→ 不改成琶音（是他的数据）；但 18 ∈ [16..19] ⇒ 位移照走（+1 保号）；
     段名恰是旧名 ⇒ 名照改（名与引用是两条独立认领，各认各的） */
  const edited = releaseShape();
  edited.sections[0].blocks[0].ref.idx = 18;
  const app1 = loadApp(seedWith(edited));
  const a1 = d2(app1);
  eq(a1.sections[0].blocks[0].ref.idx, 19, "★★ 段 1 引用 ≠ {16,20} 不换琶音——但位移照走（18 → 19，仍是用户选的那个型）");
  eq(a1.sections[0].name, NEW_NAME, "★ 段名 = 旧名 ⇒ 照样改名（引用不认领不拦名认领）");
  /* 段名等于旧名 ⇒ 改名（名与引用是两条独立认领） */
  const renamed = releaseShape();
  renamed.sections[0].name = "我自己的段名";
  const app2 = loadApp(seedWith(renamed));
  eq(d2(app2).sections[0].name, "我自己的段名", "★ 段名 ≠ 旧名不认领（同上，双向都钉）");
  eq(d2(app2).sections[0].blocks[0].ref.idx, arpIdx(app2), "★ 但引用 16 照样换琶音（错谱要修的正是这条）");
  /* 别人的曲式：段名不动；引用 16..19 属于全局位移范围（bnmig35 口径）→ 照走 */
  const mine = {
    id: "my-song", name: "我自己写的歌",
    sections: [
      { name: OLD_NAME, blocks: [{ ref: { type: "builtin", idx: 16 }, repeats: 1 }] },
      { name: "别段", blocks: [{ ref: { type: "builtin", idx: 15 }, repeats: 1 }] },
    ],
  };
  const app3 = loadApp(seedWith(mine));
  const back = app3.beat.Store.findArrange("my-song");
  eq(back.sections[0].name, OLD_NAME, "★★ 用户的曲式段名不动（哪怕恰好同名）");
  eq(back.sections[0].blocks[0].ref.idx, 17, "★ 引用 16 → 17（全局位移：仍指原来那个型，bnmig35 同口径）");
  eq(back.sections[1].blocks[0].ref.idx, 15, "★ 插入点之前的引用不动");
}

section("T237f 无垃圾键（migFinish 守卫的回归钉，本批首版抓到的实缺陷）");
{
  const app = loadApp(seedWith(releaseShape()));
  ok([...app.storage.keys()].every(k => typeof k === "string"),
     "★★★ 迁移后无 undefined/null 冷键（arpg52 不在老戳表里 ⇒ 不落老戳，不会 setItem(undefined)）");
  eq(app.storage.get("beatsight.mig.arpg52"), "1", "★ 落的是新前缀戳 beatsight.mig.arpg52");
}
