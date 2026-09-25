/* BeatSight 自动化测试 · 示例曲版本迁移 + 曲式模式下的选中语义（v2.6.4 / v2.9.0 / v2.20.0）
   T74 系列。
   ---------------------------------------------------------------------------
   ① 曲式模式下的「假选中」（v2.6.4）：曲式播放根本不读 S.sel，侧栏却在被回退的
      S.sel 上画"选中"高亮 → 像"已经选中了四分基础"。
     修法：曲式模式下一律不画选中高亮（isActive = S.playMode !== "arrange" && …），
     S.sel 只在退回单练后作数。
     v2.9.0：两态轨模型（含 ensureValidForTrack 回退）删除，"切轨"这个触发源已消失；
     本组保留仍成立的高亮契约，去掉依赖轨 UI 的步骤。

   ② 整首连播出 120 小节（参考谱是 30 小节）。成因：示例型**名字**从 v2.4.4 起没变，
     内容却从「4 小节型」换成过「1 小节型」（v2.6.0）；ensureDemo 按名查重，
     把"旧型 + 新曲式"的混杂态判成"数据齐全"——30 小节 × 4 = 120。
     修法：同名再比内容（demoPresetEq），不一致就地收敛回参考谱（保住 id）；
     init 加"闩已落但内容对不上"的迁移分支（demoStale）；
     用户**删掉**曲式的恒 false——只收敛，不复活。

   ③ v2.20.0 内置化：示例 5 型并入 BUILTINS（下标 12–16）——上面 ② 的两类混杂态
     （型内容落后 / 删示例型弄坏曲式）在数据层已不可能发生：内置型内容恒对、删不掉。
     本组改钉**迁移与改编**契约：
       · 迁移（migrateDemoToBuiltins，启动期一次）：v2.19.x 及更早落盘的
         "customs 示例型 + 曲式 custom 引用"整体收进内置库、曲式引用重映射为内置下标、
         S.sel 同步重映射、幂等（二次启动零改动）；
       · 旧曲式里的坏引用（v2.19.x"删示例型"的现场）由 demoStale 抓到 →
         启动层自动 ensureDemo 重建曲式（内置化后引用全为内置下标，坏块一并治愈）；
       · 改编路径：内置型不可删、不可改，但可经编辑器「另存为自定义」（-副本）——
         编辑器基于 curPattern() 建草稿的既有语义天然覆盖内置源。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* v2.9.0：轨模型已删，起跑型与"在哪条轨"无关 */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }),
  { seedDemo: false });
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const playAllOf = els => boxOf(els).children.find(x => /(^| )demo-play-row( |$)/.test(x.className)).children[0];
const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const itemByName = (els, name) => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className)).find(x => deepText(x).includes(name));
const activeItems = els => els["presetList"].children.filter(x =>
  /(^| )preset-item( |$)/.test(x.className) && /(^| )active( |$)/.test(x.className));
const snapshot = storage => { const s = {}; storage.forEach((v, k) => { s[k] = v; }); return s; };

/* 把一台"新机器"手工倒退回 v2.19.x 的数据形状（内置化迁移的唯一输入）：
   customs 灌入 5 个示例型（规范谱内容、当前名）、曲式块的内置引用改回 custom id。
   opts.legacyName：把 P4 改回 v2.9.0 旧名（复刻 v2.19.1 之前的名字世代）
   opts.selIdx    ：把 S.sel 指向第 i 个示例 custom（复刻"正选中它"的升级现场）
   返回 5 个 custom id（下标 = 示例序号 0..4） */
const makeLegacy = (beat, opts) => {
  const spec = beat.demoBuildSpec().presets;
  const r = beat.Store.importPresets(JSON.stringify(spec));
  eq(r.ok, true, "前提：老形状 customs 灌入成功");
  const ids = beat.Store.customs.slice(-5).map(c => c.id);
  beat.Store.findArrange(beat.DEMO_ID).sections.forEach(s => s.blocks.forEach(b => {
    if (b.ref.type === "builtin") b.ref = { type: "custom", id: ids[b.ref.idx - 12] };
  }));
  if (opts && opts.legacyName !== undefined) beat.Store.customs.slice(-5)[3].name = opts.legacyName;
  beat.Store.persistCold();               // customs 落盘
  beat.Store.persistArranges();           // 改过的曲式引用落盘（upsertArrange 之外的手改）
  if (opts && opts.selIdx !== undefined){
    beat.Store.S.sel = { type: "custom", id: ids[opts.selIdx] };
    beat.Store.flush();                   // 防抖热键立即落盘（快照要带上 S.sel）
  }
  return ids;
};
const totalBars = beat => beat.songBars(beat.Store.findArrange(beat.DEMO_ID));

/* ================= 场景 T74a：曲式播放中 → 不制造假选中（图三） ================= */
section("T74a 曲式播放中 · ★ 侧栏无假高亮（曲式不读 S.sel）；点预设退回后高亮恢复");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  const selBefore = JSON.stringify(beat.Store.S.sel);

  /* v2.9.0：轨 UI 已删，S.sel 不能被"切轨"改写了——直接断言它的语义不变即可 */
  eq(beat.Store.S.playMode, "arrange", "整首连播后是曲式模式");
  eq(JSON.stringify(beat.Store.S.sel), selBefore, "曲式播放不动 S.sel（它只是'退回预设后选谁'）");
  eq(activeItems(els).length, 0,
    "★ 列表里**没有**任何条目被高亮——不制造'已选中'的假象（高亮语义 = 正在练这个型）");
  ok(String(els["patternName"].textContent).length > 0, "标题有内容（跟节目单）");

  /* 出口仍是对等入口：点任一节奏型 = 退回单练它（BUILTINS[1] = 四分基础） */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "点预设退回预设模式");
  eq(JSON.stringify(beat.Store.S.sel), JSON.stringify({ type: "builtin", idx: 1 }), "S.sel 落到被点的型");
  eq(els["patternName"].textContent, "四分基础", "标题跟上");
  eq(activeItems(els).length, 1, "退回预设模式后选中高亮恢复（高亮语义与模式一致）");
  beat.Controls.stop();
}

/* ================= 场景 T74b：曲式停止态 → 同样无假高亮（停止时展示待命型是 v2.0.2 的设计） ================= */
section("T74b 曲式停止态 · S.sel 不变 + 无假高亮 + 画面是待命型（v2.0.2 设计）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 2);
  beat.Controls.stop();
  const selBefore = JSON.stringify(beat.Store.S.sel);
  eq(JSON.stringify(beat.Store.S.sel), selBefore, "★ 停止态 S.sel 不变（曲式播放不动它）");
  eq(activeItems(els).length, 0, "★ 停止 + 曲式 = 依旧无选中高亮");
  eq(els["patternName"].textContent, beat.demoBuildSpec().presets[0].name,
    "停止 + 曲式 = 显示待命型（播放范围起点，这里是 P1），与画面其它部分一致");
}

/* ================= 场景 T74c：内置化迁移端到端（v2.20.0） =================
   复刻 v2.19.x 用户机器：customs 落盘 5 个示例型、曲式块按 custom id 引用。
   再启动一次——migrateDemoToBuiltins 应收走示例型、曲式引用重映射为内置下标，
   全曲结构与歌词分毫不动；第三次启动零改动（幂等）。 */
section("T74c 内置化迁移 · ★ v2.19.x 形状落盘 → 再启动自动收走示例型 + 曲式重映射内置下标");
{
  const first = loadApp(undefined, { seedDemo: false });
  const ids = makeLegacy(first.beat);
  eq(first.beat.Store.customs.length, 5, "前提：customs 是 v2.19.x 形状（5 个示例 custom）");
  ok(first.beat.Store.findArrange(first.beat.DEMO_ID).sections
    .every(s => s.blocks.every(b => b.ref.type === "custom")),
    "前提：曲式块按 custom id 引用（旧协议）");

  const second = loadApp(snapshot(first.storage));
  eq(second.beat.Store.customs.length, 0, "★ 启动迁移收走 5 个示例 custom（自定义库转空）");
  const a = second.beat.Store.findArrange(second.beat.DEMO_ID);
  ok(a.sections.every(s => s.blocks.every(b =>
    b.ref.type === "builtin" && b.ref.idx >= 12 && b.ref.idx <= 16)),
    "★ 曲式块引用已重映射为内置下标 12–16（DEMO_BUILTIN_BASE=12 + refIdx）");
  eq(second.beat.songBars(a), 30, "★ 全曲 30 小节分毫未变");
  eq(second.beat.Store.lyrics.filter(l => l.arrangeId === second.beat.DEMO_ID).length, 10,
    "歌词 10 行完好（迁移不动歌词之外的用户数据）");
  eq(JSON.stringify(second.beat.arrangeProblems(a)), "[]", "★ 重映射后曲式零问题（整首可播）");
  /* 逐块对齐规范谱：重映射的下标序 = demoBuildSpec 的 refIdx 序 */
  const gotIdx = a.sections.flatMap(s => s.blocks.map(b => b.ref.idx - 12)).join(",");
  const wantIdx = second.beat.demoBuildSpec().arrange.sections
    .flatMap(s => s.blocks.map(b => b.refIdx)).join(",");
  eq(gotIdx, wantIdx, "★ 每个块的内置下标 - 12 = 规范谱 refIdx（映射无错位）");

  /* 幂等：第三次启动零改动（customs 仍空、曲式引用原样） */
  const third = loadApp(snapshot(second.storage));
  eq(third.beat.Store.customs.length, 0, "★ 幂等：三次启动 customs 仍空（零改动）");
  const a3 = third.beat.Store.findArrange(third.beat.DEMO_ID);
  eq(JSON.stringify(a3.sections), JSON.stringify(a.sections), "★ 曲式引用原样（不是每次启动都重写）");
  eq(ids.length, 5, "（前提自检：5 个 id 已取到）");
}

/* ================= 场景 T74d：S.sel 重映射 + 旧名世代 + 坏引用自动治愈（v2.20.0） =================
   ① 正选中某个示例 custom 时升级 → S.sel 同步改成内置下标（选择不丢）；
   ② v2.9.0 旧短名（雨夜扫弦）落盘 → 四级兜底照认回收走（不挑名字世代）；
   ③ v2.19.x 的 bug 现场：用户删过 P5、曲式里留着坏引用 → 迁移不猜不复活，
     demoStale 抓到坏引用 → 启动层自动 ensureDemo 重建曲式（升级即治愈）。 */
section("T74d 内置化迁移 · ★ S.sel 重映射 + 旧名认回 + 坏引用升级即治愈");
{
  /* ① S.sel 重映射 */
  const f1 = loadApp(undefined, { seedDemo: false });
  makeLegacy(f1.beat, { selIdx: 2 });                       // 正选中 P3
  const s1 = loadApp(snapshot(f1.storage));
  eq(JSON.stringify(s1.beat.Store.S.sel), JSON.stringify({ type: "builtin", idx: 14 }),
    "★ 正选中的示例 custom（P3）迁移成内置下标 12+2=14（选择不丢）");

  /* ② 旧名世代认回 */
  const f2 = loadApp(undefined, { seedDemo: false });
  makeLegacy(f2.beat, { legacyName: "雨夜扫弦" });          // P4 退回 v2.9.0 旧名
  const s2 = loadApp(snapshot(f2.storage));
  eq(s2.beat.Store.customs.length, 0,
    "★ 旧名「雨夜扫弦」的示例型同样被认回收走（四级兜底覆盖所有名字世代）");
  ok(s2.beat.BUILTINS.some(p => p.name === "前密后疏扫（《在他乡》主歌二）"),
    "★ 内置库里 P4 仍是当前特征名（迁移只收旧 custom，不改内置名）");

  /* ③ 坏引用自动治愈 */
  const f3 = loadApp(undefined, { seedDemo: false });
  makeLegacy(f3.beat);
  const p5 = f3.beat.Store.customs.slice(-5)[4];            // 用户删掉 P5（v2.19.x 可删）
  f3.beat.Store.customs.splice(f3.beat.Store.customs.indexOf(p5), 1);
  f3.beat.Store.persistCold();
  const s3 = loadApp(snapshot(f3.storage));
  eq(s3.beat.Store.customs.length, 0, "★ 其余 4 个照常收走（不因一个坏引用放弃整批迁移）");
  const a3 = s3.beat.Store.findArrange(s3.beat.DEMO_ID);
  ok(a3 && a3.sections.every(s => s.blocks.every(b => b.ref.type === "builtin")),
    "★ 曲式已治愈：所有块引用内置下标（demoStale 抓到坏引用 → 启动层 ensureDemo 重建）");
  eq(s3.beat.songBars(a3), 30, "★ 治愈后全曲回到 30 小节");
}

/* ================= 场景 T74e：用户删掉曲式 → 绝不复活（只收敛，不复活） ================= */
section("T74e 删除保护 · ★ 曲式被删 → demoStale 恒 false，启动不复活（尊重删除）");
{
  const first = loadApp(undefined, { seedDemo: false });
  first.beat.Store.deleteArrange(first.beat.DEMO_ID);       // 用户删掉整首曲式
  eq(first.beat.Arrange.demoStale(), false, "★ 曲式被删 → 不算落后（不触发收敛/复活）");
  const second = loadApp(snapshot(first.storage));
  ok(!second.beat.Store.findArrange(second.beat.DEMO_ID), "★ 再启动曲式仍然不在（没偷偷补回来）");
  eq(second.beat.Store.customs.length, 0, "★ 自定义库保持空（示例型已内置、删不掉，也无需收走）");
  /* v2.20.0：侧栏亮出「恢复示例曲」——删了想找回来时的显式入口（不自动复活，但给路）。
     note 是动态 createElement 的（不走 getElementById），从列表 children 里找 */
  ok(!!second.els["presetList"].children.find(x => x.id === "demoRestoreNote"),
    "★ 侧栏亮「示例曲未在库里」提示 + 恢复入口");
}

/* ================= 场景 T74f：内置型不可删、但可另存为自定义（改编出口） =================
   内置化把"删按钮"从示例型上拿掉了；改编走编辑器既有语义：
   选中内置型 → 「编辑节奏型」→ 基于 curPattern() 建"-副本"草稿 → 保存进 customs。
   从此"我想要个变体"（合法需求）与"把示例删了"（v2.19.x 的 bug 源头）在 UI 上分家。 */
section("T74f 改编路径 · ★ 内置示例型无删除按钮；经编辑器另存为自定义（-副本）");
{
  const { beat, els } = loadDemo();
  const target = itemByName(els, "下上扫 · 密（《在他乡》副歌）");
  ok(!!target, "前提：扫弦区里有内置示例条目");
  /* 内置条目没有删除按钮（buildPresetItem 才有）——删除路径在 UI 上不存在 */
  ok(!target.children.some(c => /(^| )del( |$)/.test(c.className)),
    "★ 内置示例条目无删除按钮（不可删，是这批素材的属性而非 bug）");
  target.fire("click");
  eq(beat.Store.S.sel.type, "builtin", "前提：已选中内置示例型");
  eq(beat.Store.customs.length, 0, "前提：自定义库空");

  beat.Editor.open();
  const d = beat.Editor.draft();
  ok(d && d.name.indexOf("下上扫 · 密（《在他乡》副歌）") === 0
      && d.name.indexOf("-副本") > 0,
    "★ 草稿 = 基于内置型的新副本（-副本），内置本体不被直接改");
  eq(beat.Store.customs.length, 0, "★ 打开编辑器不动库（保存才落）");
  els["presetNameInput"].value = "我的副歌变体";
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, 1, "★ 另存成功：自定义库恰好 1 条（与内置隔离）");
  eq(beat.Store.customs[0].name, "我的副歌变体", "★ 新条目名来自草稿名输入框");
  eq(beat.Store.S.sel.type, "custom", "★ 保存后选中的是新的自定义型");
  eq(beat.BUILTINS.length, 17, "★ 内置库纹丝不动（17 = 12 + 示例 5）");
  beat.Controls.stop();
}
