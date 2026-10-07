/* BeatSight 自动化测试 · 底栏读数合流 + 正在播放呼吸点（v3.36.18）
   T221 系列。
   ─────────────────────────────────────────────────────────────────────────────
   由来（用户 2026-10-07 晚的三个决定）：
     · 「当前曲式 · 段名」从**预设库抽屉**搬进**底栏常驻胶囊**。理由不是"看着重复"，
       而是**可见性正好装反了**：抽屉默认关着 ⇒ 曲式播放中"我播到第几段"根本看不见
       （真机 CDP 实测 chipVisible=false），而常驻在胶囊里的却是型名——它名字里内嵌的
       「（《歌名》段落）」是**作谱时的出处标注**（静态不变），不是"你在哪"。
     · 曲式模式下底栏显示 **段名 + 型名**（用户指定）。
     · 预设库给**正在发声**的节奏型加"呼吸点"——此前曲式播放中列表**一条标记都没有**
       （pushBuiltinItem / buildPresetItem 的 isActive 都带 S.playMode !== "arrange" 守卫），
       而"正在响的型"与"选中的型"在连播中必然分裂
       （真机实测：响「下上扫 · 密（副歌）」、选中「四分基础」）。

   ★ 宽度账（真机实测 1440px，它决定了形态）：.pb-ctx 宽 320px，扣掉 ‹ /「浏览节奏型」/
     边距后只剩 **176px** 给「段名 + 型名」；「段名 · 型名短」=173px 放得下，
     带曲式名 + 带出处后缀的长形态 =409px 塞不进去 ⇒ 曲式模式下段名不带曲式名
     （完整上下文进胶囊 title）、型名剥出处后缀（stripSongTag，显示层剥离、数据层不动）。
   ================================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 与 t73 同一口径：seedDemo:false 让它真的把示例曲带出来（5 型 + 曲式 + 歌词） */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }), { seedDemo: false });
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
/* 歌曲行的「▶」= 整首连播（v3.35.3 起展开/收起与起播已分开） */
const playAllOf = els => {
  const row = boxOf(els).children.find(x =>
    /(^| )preset-item( |$)/.test(x.className) && x.children[0].children[0].textContent === "《在他乡》（示例）");
  return row && row.children.find(x => /(^| )aud( |$)/.test(x.className));
};
/* 桩的 textContent 不聚合子节点（真实 DOM 会），取文本要递归 */
const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const walk = el => (el.children || []).reduce((acc, c) => acc.concat(c, walk(c)), []);
/* 节奏型条目 = 列表里除「歌曲行」以外的 preset-item（歌曲行自带 .song，且它表达的是"曲式"不是"型"） */
const patternItems = els => walk(els["presetList"])
  .filter(x => /(^| )preset-item( |$)/.test(x.className) && !/(^| )song( |$)/.test(x.className));
const withClass = (els, cls) => patternItems(els).filter(x => new RegExp("(^| )" + cls + "( |$)").test(x.className));
const itemByName = (els, name) => patternItems(els).find(x => deepText(x).includes(name));

/* ================= T221a：段名位搬进底栏胶囊（源码级） ================= */
section("T221a 段名位 · ★ 从抽屉搬进底栏胶囊（全页只此一处，原位置不留第二份）");
{
  const btn = /<button class="pb-ctx" id="presetLibBtn"[\s\S]*?<\/button>/.exec(html);
  ok(!!btn, "前提：取到底栏胶囊标记段（锚点有效）");
  ok(/id="argNowName"/.test(btn[0]), "★★ 段名位 #argNowName 住在底栏胶囊内（播放中不必开抽屉就能看见）");
  ok(!/id="argNowRow"/.test(html),
    "★★ 原位置（抽屉里的 #argNowRow）整块退役——去重判据是「只写一次」，不是「两处显示一样」");
  ok((html.match(/id="argNowName"/g) || []).length === 1, "★ 全页恰好 1 个 #argNowName（无重复 id）");
  ok(btn[0].indexOf('id="argNowName"') < btn[0].indexOf('id="patternName"'),
    "★ 顺序 = 段名 → 型名（用户指定）");
  ok(!/\.arg-now\.single \.arg-now-name/.test(html),
    "★★ v2.35.0 的「单曲式隐藏」机制退役（职责已从「服务哪一条曲式」变成「我在第几段」）");
}

/* ================= T221b：段名位只在曲式模式出现，且随可听段推进 ================= */
section("T221b 段名位 · ★ 曲式播放中可见并随段推进；退回预设模式即收起");
{
  const { beat, els } = loadDemo();
  eq(beat.Store.S.playMode, "arrange", "前提：带出示例曲后落在曲式模式");
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1.5);
  eq(beat.Store.S.playing, true, "前提：正在播放");
  eq(els["argNowName"].getAttribute("hidden"), null, "★ 曲式播放中段名位可见（hidden 已摘除）");
  const first = String(els["argNowName"].textContent || "");
  ok(first.length > 0, "★ 且写着段名（实际「" + first + "」）");
  drive(ac, beat, 9);
  ok(els["argNowName"].textContent !== first,
    "★ 跨段后段名跟着换（实际「" + els["argNowName"].textContent + "」，此前「" + first + "」）");
  /* 曲式名不在文本里（176px 装不下），而在胶囊 title 里——原 chip「指示服务哪一条曲式」的职责不丢 */
  const title = String(els["presetLibBtn"].getAttribute("title") || "");
  ok(title.includes("在他乡"), "★★ 曲式名进胶囊 title（宽度取舍见文件头）：「" + title + "」");
  beat.Controls.stop();

  /* 退回预设模式 ⇒ 段名位收起：段名只在曲式模式下有意义，不拿旧读数糊弄人 */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "前提：点预设退回单练");
  eq(els["argNowName"].getAttribute("hidden"), "hidden", "★ 预设模式下段名位收起");
}

/* ================= T221c：型名剥出处后缀（曲式模式）/ 原样（预设模式） ================= */
section("T221c 底栏型名 · ★★ 曲式模式剥掉尾部出处标注，预设模式保留全名");
{
  const { beat, els } = loadDemo();
  /* 先钉纯函数本身（它是显示层剥法的唯一实现，测试直接调它、不抄第二份正则） */
  eq(beat.stripSongTag("下上扫 · 密（《在他乡》副歌）"), "下上扫 · 密", "★ 剥掉结尾「（《歌名》段落）」");
  eq(beat.stripSongTag("八分满扫（《我们能不能不分手》副歌）"), "八分满扫", "★ 同上（第二首示例曲的型）");
  eq(beat.stripSongTag("民谣扫弦 · 下-下上-上下上"), "民谣扫弦 · 下-下上-上下上", "★ 没有出处标注 ⇒ 原样");
  eq(beat.stripSongTag("我的型（练习用）"), "我的型（练习用）",
    "★★ 非「（《…》…）」形式的括号一律不动——不误删用户自己起的名字");
  eq(beat.stripSongTag("前（《歌》段）后（《歌》段）"), "前（《歌》段）后", "★ 只剥**结尾**那一段");

  /* 桩级：曲式播放中底栏 = 短名 */
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 4);
  const full = (beat.arrangePlayPattern() || {}).name || "";
  ok(/（《/.test(full), "前提：此刻节目单游标处的型确实带出处标注（否则本条测不到东西）：" + full);
  eq(els["patternName"].textContent, beat.stripSongTag(full), "★★ 曲式模式底栏显示短名");

  /* 桩级：退回预设模式后 = 全名（那时没有段名作对照，出处是唯一线索） */
  itemByName(els, "十六分满扫").fire("click");
  eq(beat.Store.S.playMode, "preset", "前提：点歌下的型 = 退回单练它");
  eq(els["patternName"].textContent, "十六分满扫（《在他乡》前奏）", "★★ 预设模式保留全名（出处标注不剥）");
  beat.Controls.stop();
}

/* ================= T221d：正在播放的呼吸点 ================= */
section("T221d 呼吸点 · ★★ 只点亮**正在发声**的那条，与「选中」是两种视觉、互不冒充");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 4);
  eq(beat.Store.S.playing, true, "前提：正在播放");
  const on = withClass(els, "playing");
  eq(on.length, 1, "★★ 恰好一条带呼吸点（不会同时亮两条，也不会一条都不亮）");
  const sounding = (beat.activePattern() || {}).name || "";
  ok(on.length === 1 && deepText(on[0]).includes(beat.stripSongTag(sounding)),
    "★★ 亮的那条 = 正在发声的型（亮「" + (on[0] ? deepText(on[0]).slice(0, 24) : "无")
    + "」／正在响「" + sounding + "」）");
  /* 与「选中」相互独立：曲式模式下本就不下选中高亮（v2.6.4 既有契约），
     两种视觉因此不会在同一行打架——这也是"呼吸点必须绑发声而不是绑 S.sel"的可见证据 */
  eq(withClass(els, "active").length, 0, "★ 曲式模式下不亮「选中」——两种视觉各说各的事");
  beat.Controls.stop();
  eq(withClass(els, "playing").length, 0,
    "★★ 停机后呼吸点熄灭（appliedPat 此时仍指着「待命型」，但那不是「正在播放」）");
}
