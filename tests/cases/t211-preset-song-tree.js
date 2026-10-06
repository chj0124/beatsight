/* T211 预设库「歌 → 型」两级（v3.35.3）
   ---------------------------------------------------------------------------
   用户需求：「把扫弦与自定义合并；把自定义里的歌曲设计成点击展开里面所有节奏型，
   就能取代原来扫弦一栏的作用。」

   钉六件事：
     ① 「扫弦」区退役——侧栏只剩 节拍 / 自定义 两区
     ② 歌曲行 = 可展开的行：点行只切展开态，**不起播**（语义从 v2.28.0 的"点=连播"让位）
     ③ 整首连播挪到行尾的 ▶，语义与原来的条目点击逐位一致（曲式模式 + 范围整首 + 循环 + 起播）
     ④ 展开内容 = 该曲式**实际引用**的型（按首次出现去重、保序）
     ⑤ 展开出来的型与库里其它条目同权：点它 = 退回单练它
     ⑥ 默认只展开**当前正在编排的那首**（手风琴式，与编排页大纲树同一条约定）
   ============================================================================ */
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 示例曲是**首次打开**才带出的（harness 默认落"已带出"的闩）⇒ 显式 seedDemo:false */
const loadDemo = () => loadApp(undefined, { seedDemo: false });

const boxOf = els => els["presetList"].children
  .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const nameOf = it => it.children[0].children[0].textContent;
const rowsOf = els => boxOf(els).children.filter(c => /(^| )song( |$)/.test(c.className));
const rowOf = (els, name) => rowsOf(els).find(r => nameOf(r) === name);
const playBtnOf = row => row && row.children.find(c => /(^| )aud( |$)/.test(c.className));
const inSongOf = els => boxOf(els).children.filter(c => /(^| )in-song( |$)/.test(c.className));

section("T211a 扫弦区退役 · 侧栏只剩 节拍 / 自定义 两区");
{
  const { els, beat } = loadDemo();
  const secs = els["presetList"].children.filter(x => x.className === "preset-section");
  eq(secs.length, 2, "★ 恰好两个分区标题");
  eq(secs[0].textContent, "节拍 · 11 个", "第一区 = 11 个不带扫弦记谱的内置型");
  eq(secs[1].textContent, `自定义 · ${beat.Store.arranges.length} 个`, "第二区 = 归属行（曲式 + 只有归属的行）");
  ok(!secs.some(s => /扫弦/.test(s.textContent)), "★ 侧栏里不再有「扫弦」这一栏");
}

section("T211b 歌曲行 · 点行只切展开态，不起播");
{
  const { els, beat } = loadDemo();
  const row = rowOf(els, "《我们能不能不分手》（示例）");
  ok(!!row, "前提：第二首示例曲有歌曲行");
  eq(row.getAttribute("aria-expanded"), "false", "★ 默认只展开当前那首（手风琴式）：第二首是折叠的");
  eq(inSongOf(els).length, 5, "前提：此时展开的是第一首（《在他乡》5 个型）");
  const modeBefore = beat.Store.S.playMode;      // 首开带出示例曲后本就落在曲式模式，故比"前后不变"
  row.fire("click");
  const row2 = rowOf(els, "《我们能不能不分手》（示例）");
  eq(row2.getAttribute("aria-expanded"), "true", "★ 点行 = 展开");
  eq(inSongOf(els).length, 5 + 4, "★ 两首都展开时，共 9 个示例型可见（5 + 4）");
  eq(beat.Store.S.playing, false, "★★ 点行**不起播**（展开/收起是纯视图动作）");
  eq(beat.Store.S.playMode, modeBefore, "★★ 也不切模式（整首连播才切曲式模式）");
  row2.fire("click");
  eq(rowOf(els, "《我们能不能不分手》（示例）").getAttribute("aria-expanded"), "false", "★ 再点 = 收起");
  eq(inSongOf(els).length, 5, "收起后它的型不再渲染");
}

section("T211c 行尾 ▶ · 整首连播（与 v2.28.0 的条目点击逐位同义）");
{
  const { els, beat } = loadDemo();
  const btn = playBtnOf(rowOf(els, "《在他乡》（示例）"));
  ok(!!btn, "★ 歌曲行尾有 ▶（整首连播入口）");
  btn.fire("click");
  eq(beat.Store.S.playMode, "arrange", "★ 点 ▶ = 切曲式模式");
  eq(beat.Store.S.playing, true, "★ 一键即开播");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 0, to: 63, loop: true, byLyric: false }),
     "★ 范围 = 整首 + 开循环（与 v2.28.0 的「点条目即整首连播」逐位一致）");
  beat.Controls.stop();
}

section("T211d 展开内容 = 该曲式引用到的型（去重保序）");
{
  const { els, beat } = loadDemo();
  const a = beat.Store.findArrange(beat.DEMO_ID);
  /* 期望序 = 逐段逐块解析引用、按首次出现去重（与 songPatterns 同一判据，但这里独立算一遍） */
  const want = [];
  const seen = new Set();
  a.sections.forEach(sec => sec.blocks.forEach(blk => {
    const r = blk.ref;
    const k = r.type === "builtin" ? "b" + r.idx : "c" + r.id;
    if (seen.has(k)) return;
    const p = beat.resolveRef(r);
    if (!p) return;
    seen.add(k); want.push(p.name);
  }));
  eq(inSongOf(els).map(nameOf).join(" | "), want.join(" | "),
     "★ 展开列出的型 = 曲式块引用到的型，去重保序（不是「库里所有扫弦型」）");
  eq(inSongOf(els).length, 5, "《在他乡》用到 5 个型（9 段共用）");
}

section("T211e 歌下的型与库里其它条目同权 · 点它 = 退回单练它");
{
  const { els, beat } = loadDemo();
  const item = inSongOf(els).find(x => nameOf(x) === "下上扫 · 密（《在他乡》副歌）");
  ok(!!item, "前提：歌下能看到这个型");
  beat.Store.S.playMode = "arrange";                     // 造一个"正在连播"的状态
  item.fire("click");
  eq(beat.Store.S.playMode, "preset", "★ 点它 = 退回预设模式（单练它）");
  ok(String(beat.activePattern().name).indexOf("下上扫 · 密（《在他乡》副歌）") >= 0,
     "★ 生效的型跟着换成它（实际「" + beat.activePattern().name + "」）");
  beat.Controls.stop();
}

section("T211f 歌曲行带 📁（归组）但不带 ✎；歌下的型带 ✎/▶ 不带 📁");
{
  const { els } = loadDemo();
  const row = rowOf(els, "《在他乡》（示例）");
  ok(row.children.some(c => /(^| )grp( |$)/.test(c.className)), "歌曲行保留 📁 归组入口");
  ok(row.children.some(c => /(^| )aud( |$)/.test(c.className)), "歌曲行有 ▶");
  const inner = inSongOf(els)[0];
  ok(!inner.children.some(c => /(^| )grp( |$)/.test(c.className)),
     "★ 歌下的型**不带 📁**——它属于这首歌，归到哪个组不是它自己的问题");
  ok(inner.children.some(c => /(^| )aud( |$)/.test(c.className)), "歌下的型带 ▶ 试听");
  ok(inner.children.some(c => /(^| )ren( |$)/.test(c.className)), "★ 歌下的内置型仍带 ✎ 改名（能力不丢）");
}

section("T211g 展开态是纯浏览态 · 不落盘");
{
  const { els, storage } = loadDemo();
  rowOf(els, "《我们能不能不分手》（示例）").fire("click");
  const raw = storage.get("beatsight.state") || "";
  ok(raw.indexOf("songOpen") < 0 && raw.indexOf("in-song") < 0,
     "★ 展开态不进热键（会话内记忆即可，刷新回默认）");
}
section("T211h 歌曲行 ▶ 的两态（v3.35.6 用户实拍）· 播放中变 ■、再点即暂停");
{
  const { els, beat } = loadDemo();
  /* ★ 每次**现取**：起播/停机都会重建列表，旧引用是脱离文档的冻结值（本仓踩过多次的老坑） */
  const rowsNow = () => boxOf(els).children.filter(c => /(^| )song( |$)/.test(c.className));
  const btnNow = i => playBtnOf(rowsNow()[i]);
  ok(!!btnNow(0), "前提：歌曲行有 ▶");
  eq(btnNow(0).textContent, "▶", "未播放时是 ▶");
  btnNow(0).fire("click");
  eq(beat.Store.S.playing, true, "点 ▶ → 起播");
  eq(btnNow(0).textContent, "■", "★ 播放中该行的按钮变成 ■（暂停）");
  ok(/暂停/.test(String(btnNow(0).getAttribute("aria-label"))), "★ aria-label 同步成「暂停…」（读屏也读得对）");
  eq(btnNow(1).textContent, "▶", "★ 另一首仍是 ▶（只标正在播的那一首）");
  btnNow(0).fire("click");
  eq(beat.Store.S.playing, false, "★ 再点同一颗 → 暂停");
  eq(btnNow(0).textContent, "▶", "★ 暂停后变回 ▶");
  btnNow(1).fire("click");
  eq(beat.Store.S.playing, true, "点第二首的 ▶ → 起播它");
  eq(btnNow(1).textContent, "■", "★ ■ 跟着换到第二首");
  eq(btnNow(0).textContent, "▶", "★ 第一首回到 ▶（同一时刻只有一首在播）");
  beat.Controls.stop();
  eq(btnNow(0).textContent, "▶", "★ 从主播放键停机后，歌曲行也回到 ▶（两处状态同源）");
}
