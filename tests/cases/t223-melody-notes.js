/* BeatSight 自动化测试 · 旋律谱 B 期：notes 姊妹轨（v3.37.0）
   T223 系列。
   ---------------------------------------------------------------------------
   B 期契约（与 index.html「旋律轨 B 期」头注释同源，t222 钉 A→B 迁移与字侧语义）：
     · 音符 = {t, dur, p}，与 chars 同网格（十六分吸附）、同坐标系（段内绝对 tick），
       存在行级 notes 里（notes 非空才写键——无谱行落盘形状与旧格式逐位一致）；
     · 贴谱 = token 流（每档 = 八分 = 2 格）：「5 6 1'」顺排、「-」延长前音、「0」休止、
       非法 token 整句不落（半句谱比没有谱更难排查）；
     · 字 ↔ 音非 1:1 的三种情形全走「求交派生」：一音多字 = 延音线（tie）、
       一字多音 = 串显（multi）、无词段 = 独立音符块（standaloneNotes，前奏/间奏/尾奏）；
     · 贴词后缀与既有谱 mergeLineNotes：新贴的覆盖重叠段、间奏谱原样保留。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const miniByAria = (ly, frag) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.getAttribute("aria-label") &&
  c.getAttribute("aria-label").indexOf(frag) >= 0);

/* 夹具（t222 同款）：一个 4/4 段（span=192t）+ 打开编排页并展开歌词编辑区 */
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

/* ============ T223a：parseMelodyTokens（顺排 / 延长 / 休止 / 非法整句不落） ============ */
section("T223a parseMelodyTokens · token 流：每档一音 / - 延长 / 0 休止 / bad 整句不落");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  eq(JSON.stringify(beat.parseMelodyTokens("5 6 1'", C)),
    JSON.stringify({ notes: [{ t: 0, dur: 24, p: 67 }, { t: 24, dur: 24, p: 69 }, { t: 48, dur: 24, p: 72 }], bad: null }),
    "★★ 顺排：每 token 一颗音符，t 每档 +24（八分）");
  eq(JSON.stringify(beat.parseMelodyTokens("5 -", C)),
    JSON.stringify({ notes: [{ t: 0, dur: 48, p: 67 }], bad: null }),
    "★「-」延长前一颗一档");
  eq(JSON.stringify(beat.parseMelodyTokens("5 0 6", C)),
    JSON.stringify({ notes: [{ t: 0, dur: 24, p: 67 }, { t: 48, dur: 24, p: 69 }], bad: null }),
    "★「0」休止一档（只占位不产音符）");
  eq(JSON.stringify(beat.parseMelodyTokens("0 - 5", C)),
    JSON.stringify({ notes: [{ t: 48, dur: 24, p: 67 }], bad: null }),
    "★ 休止后的「-」= 再休一档（不炸、不产音符）");
  eq(JSON.stringify(beat.parseMelodyTokens("5 x 6", C)),
    JSON.stringify({ notes: null, bad: "x" }),
    "★★ 非法 token ⇒ {notes:null, bad:该token}——整句不落（半句谱更难排查）");
  eq(JSON.stringify(beat.parseMelodyTokens("1''''", C)),
    JSON.stringify({ notes: null, bad: "1''''" }),
    "★ 越出 PITCH_MAX 的 token 也走 bad（1'''' = 108 > 96）");
  eq(beat.parseMelodyTokens("1'''", C).notes[0].p, 96, "1''' = 96 恰好压线，合法");
  eq(beat.parseMelodyTokens("1", beat.keySemiOf("G")).notes[0].p, 67,
    "★ 首调：G 调的 1 = 67（度数按调主折算）");
  eq(beat.parseMelodyTokens("1,", C).notes[0].p, 48, "低八度记号「,」也认（1, = 48）");
  eq(JSON.stringify(beat.parseMelodyTokens("", C)), JSON.stringify({ notes: [], bad: null }),
    "空串 = 空谱（清空并确定的解析产物）");
}

/* ============ T223b：melodySerialize（回填一进一出 / 长音补 - / 离格跳过） ============ */
section("T223b melodySerialize · 与解析器一进一出 / dur 补「-」/ 离格尽力而为");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  const txt = "5 6 1' 5 - 0 3";
  const r = beat.parseMelodyTokens(txt, C);
  eq(beat.melodySerialize(r.notes, ""), txt,
    "★★ 回填文本再贴一遍 = 原文（serialize ∘ parse 幂等）");
  eq(beat.melodySerialize([{ t: 0, dur: 72, p: 60 }], ""), "1 - -",
    "★ dur 三档 = 音符 + 两个「-」");
  eq(beat.melodySerialize([{ t: 24, dur: 24, p: 60 }], ""), "0 1",
    "空档 = 「0」休止补位");
  eq(beat.melodySerialize([{ t: 12, dur: 24, p: 60 }], ""), "0_ 1",
    "★ 十六分偏移（t=12）可无损表达：空档 12t = 「0_」，音符本体「1」（v3.38.0 细分后不再跳过）");
  eq(beat.melodySerialize([{ t: 7, dur: 24, p: 60 }], ""), "",
    "离格（非 6t 倍数）的脏值仍跳过——防御位，回填是再编辑的起点");
  eq(beat.melodySerialize([], ""), "", "空谱 → 空串");
  eq(beat.melodySerialize([{ t: 0, dur: 24, p: 67 }], "G"), "1",
    "★ 序列化按调主（G 调的 67 = 1）——与解析同键可逆");
}

/* ============ T223c：charPitchMark / pitchMarkText（求交派生四形态） ============ */
section("T223c charPitchMark · pitch / tie / multi / null 四形态（渲染层唯一来源）");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  /* 恰一颗音符自字首覆盖 → pitch */
  eq(JSON.stringify(beat.charPitchMark([{ t: 0, dur: 24, p: 67 }], { t: 0, dur: 24 })),
    JSON.stringify({ kind: "pitch", seq: [{ p: 67 }] }),
    "恰一颗音符自字首起 → kind=pitch");
  /* 音符起于字前（跨字延音）→ tie */
  eq(JSON.stringify(beat.charPitchMark([{ t: 0, dur: 48, p: 67 }], { t: 24, dur: 24 })),
    JSON.stringify({ kind: "tie", seq: [{ tie: true }] }),
    "★★ 一音多字：后续字只派生延音线（kind=tie）");
  /* 延音 + 字内起音 → multi（串显） */
  eq(JSON.stringify(beat.charPitchMark(
      [{ t: 0, dur: 36, p: 60 }, { t: 36, dur: 12, p: 62 }], { t: 24, dur: 24 })),
    JSON.stringify({ kind: "multi", seq: [{ tie: true }, { p: 62 }] }),
    "★★ 延音 + 字内新音 → kind=multi（「-·2」形的来源）");
  /* 一字多音（都起于字内）→ multi */
  eq(JSON.stringify(beat.charPitchMark(
      [{ t: 0, dur: 24, p: 60 }, { t: 24, dur: 24, p: 62 }], { t: 0, dur: 48 })),
    JSON.stringify({ kind: "multi", seq: [{ p: 60 }, { p: 62 }] }),
    "★★ 一字多音：seq 按时序串两颗（kind=multi）");
  eq(beat.charPitchMark([{ t: 48, dur: 24, p: 67 }], { t: 0, dur: 24 }), null,
    "字与音符无交 → null（不画标注）");
  eq(beat.charPitchMark([], { t: 0, dur: 24 }), null, "无谱 → null");
  /* pitchMarkText：jp / nm 双渲染 + tie 记号 */
  eq(beat.pitchMarkText(beat.charPitchMark([{ t: 0, dur: 24, p: 67 }], { t: 0, dur: 24 }), "jp", ""), "5",
    "pitchMarkText jp：67 → 简谱 5");
  eq(beat.pitchMarkText(beat.charPitchMark([{ t: 0, dur: 24, p: 67 }], { t: 0, dur: 24 }), "nm", ""), "G4",
    "pitchMarkText nm：67 → G4（数据同一份，写法随开关）");
  eq(beat.pitchMarkText(
    beat.charPitchMark([{ t: 0, dur: 36, p: 60 }, { t: 36, dur: 12, p: 62 }], { t: 24, dur: 24 }), "jp", ""),
    "-·2", "multi 的显示文本 =「-·2」（延音 + 第二音）");
}

/* ============ T223d：standaloneNotes / mergeLineNotes（独立音符与谱合并） ============ */
section("T223d standaloneNotes / mergeLineNotes · 独立音符判定 + 重贴覆盖语义");
{
  const { beat } = loadApp();
  /* standaloneNotes：不与任何字重叠的音符 */
  eq(JSON.stringify(beat.standaloneNotes([], [{ t: 0, dur: 24, p: 60 }])),
    JSON.stringify([{ t: 0, dur: 24, p: 60 }]),
    "★★ 纯谱行（chars 空）⇒ 全部音符独立（前奏/间奏/尾奏的地盘）");
  eq(JSON.stringify(beat.standaloneNotes([{ t: 0, dur: 24 }], [{ t: 0, dur: 24, p: 60 }, { t: 48, dur: 24, p: 62 }])),
    JSON.stringify([{ t: 48, dur: 24, p: 62 }]),
    "与字重叠的音符不独立；错开的音符独立");
  eq(beat.standaloneNotes([{ t: 0, dur: 24 }], []).length, 0, "无谱 → 空");
  eq(beat.standaloneNotes([{ t: 0, dur: 48 }], [{ t: 24, dur: 48, p: 60 }]).length, 0,
    "★ 半交叠也算重叠（时序相交判定，不是包含判定）——该音符不独立");
  /* mergeLineNotes：新贴覆盖重叠段、其余保留、输出升序 */
  eq(JSON.stringify(beat.mergeLineNotes([{ t: 96, dur: 24, p: 64 }], [{ t: 0, dur: 24, p: 67 }])),
    JSON.stringify([{ t: 0, dur: 24, p: 67 }, { t: 96, dur: 24, p: 64 }]),
    "不重叠 ⇒ 全保留 + 按 t 升序");
  eq(JSON.stringify(beat.mergeLineNotes([{ t: 0, dur: 48, p: 60 }], [{ t: 24, dur: 48, p: 62 }])),
    JSON.stringify([{ t: 24, dur: 48, p: 62 }]),
    "★★ 与新音符重叠的旧音符让位（重贴改谱，新为准）");
  eq(JSON.stringify(beat.mergeLineNotes([{ t: 0, dur: 24, p: 60 }], [])),
    JSON.stringify([{ t: 0, dur: 24, p: 60 }]),
    "★ 空进件 ⇒ 既有谱原样（纯文字重贴不清谱的来源）");
  eq(beat.mergeLineNotes(null, [{ t: 0, dur: 24, p: 60 }]).length, 1, "无旧谱 ⇒ 新谱照收");
}

/* ============ T223e：贴谱入口（预填 / 写入 / 非法拒收 / 清空 / 纯谱行） ============ */
section("T223e 贴谱 · uiPrompt 全量替换 · bad 拒收 · 清空并确定 · 空段贴谱 = 纯谱行");
{
  const app = fixture();
  const { beat, els, id, uid } = app;
  const melBtn = () => miniByAria(lyOf(els, 0), "贴旋律谱");
  const melDo = text => { melBtn().fire("click"); els["modalInput"].value = text; els["modalOk"].fire("click"); };
  ok(!!melBtn(), "前提：贴谱按钮在（arg-mini，aria 带段号）");

  /* 空段直接贴谱 = 纯谱行（前奏）：词都没有，谱先落地 */
  melDo("1 2 3");
  const l0 = beat.Store.findLyric(id, uid);
  ok(!!l0, "★★ 空段贴谱 ⇒ 行存在（chars 空不判 null——纯谱行）");
  eq(l0.chars.length, 0, "★★ 纯谱行：chars 为空数组（前奏没有词）");
  eq(JSON.stringify(l0.notes),
    '[{"t":0,"dur":24,"p":60},{"t":24,"dur":24,"p":62},{"t":48,"dur":24,"p":64}]',
    "★★ 三颗音符顺排落库（C 调 1 2 3 = 60/62/64）");
  ok((els["srAnnounce"].textContent || "").indexOf("已写入 3 颗音符") >= 0, "announce 报写入颗数");

  /* 预填 = melodySerialize（回填文本与解析器同一套写法） */
  melBtn().fire("click");
  eq(els["modalInput"].value, "1 2 3", "★ 预填 = 行级谱的序列化形");
  els["modalCancel"].fire("click");                     // 取消：不写
  eq(beat.Store.findLyric(id, uid).notes.length, 3, "取消 ⇒ 数据不动");

  /* 非法 token：整句不落、uiAlert 说明、数据原样 */
  melDo("5 x 6");
  ok((els["modalMsg"].textContent || "").indexOf("不是有效的简谱 token") > 0,
    "★★ bad token → uiAlert 指名道姓（不静默吞）");
  eq(beat.Store.findLyric(id, uid).notes.length, 3, "★★ 拒收后原谱原样（整句不落）");
  els["modalOk"].fire("click");                         // 关掉 alert

  /* 清空并确定 = 只清谱（纯谱行 ⇒ 词谱双空 ⇒ 行删除） */
  melDo("");
  eq(beat.Store.findLyric(id, uid), null,
    "★★ 清空并确定：词谱全空 ⇒ 行删除（清除与删除同一道门）");

  /* 有词的段：清谱不清词 */
  const box = byCls(lyOf(els, 0), "arg-lyric-paste");
  box.value = "我多想去"; box.fire("change");
  melDo("1 2");
  eq(beat.Store.findLyric(id, uid).notes.length, 2, "有词段贴谱：词不动、谱入库");
  melDo("");
  const lW = beat.Store.findLyric(id, uid);
  eq(lW.chars.length, 4, "★★ 清空并确定只清谱——词还在（清词是「清除」按钮的地盘）");
  ok(!lW.notes, "谱已清（notes 键不写——落盘形状回旧格式）");
  beat.Arrange.close();
}

/* ============ T223f：独立音符块渲染（主视图 + 编辑轨 / off 档也显示） ============ */
section("T223f 独立音符块 · 主视图 notechip / 编辑轨 aria / 纯谱行不算空行");
{
  /* 主视图：曲式模式 + 纯谱行（t222h 同款种子） */
  const BL = { ref: { type: "builtin", idx: 1 }, repeats: 1 };
  const app = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t1", name: "旋律曲", sections: [{ uid: "s1", name: "间奏", blocks: [BL] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }),
  });
  const { beat, els } = app;
  /* 纯谱行：一颗音符与字重叠（不独立），一颗在间奏区（独立） */
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 48, ch: "唱" }],
    { notes: [{ t: 0, dur: 48, p: 67 }, { t: 192, dur: 48, p: 69 }] });
  beat.Viz.buildLyricLane();
  const rows = els["lyricLane"].children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
  const chipsOfRow = r => (r.children || []).filter(c => /(^| )lyric-chip( |$)/.test(c.className));
  const notes = rows.flatMap(r => chipsOfRow(r).filter(c => /(^| )notechip( |$)/.test(c.className)));
  const noteText = chip => (chip.children || []).find(c => /lyric-char/.test(c.className));
  eq(notes.length, 1, "★★ 主视图只画独立音符块（与字重叠的走字上标，不重复画）");
  eq(notes[0] ? noteText(notes[0]).textContent : "(无)", "6", "★ off 档独立音符也显示（默认按简谱——这是「数据有没有」的谱面）");
  ok(rows.some(r => chipsOfRow(r).length > 0 && !/(^| )lyr-empty( |$)/.test(r.className) &&
      chipsOfRow(r).every(c => /notechip/.test(c.className))),
    "★ 只有音符块的行不是空行（.lyr-empty 不挂——间奏不画幽灵底纹）");
  ok(els["lyricLane"].hidden === false, "纯谱/间奏让轨道可见（不再整轨收起）");

  /* 编辑轨：aria 逐颗报读 */
  const app2 = fixture();
  const { beat: b2, els: e2, id: id2, uid: uid2 } = app2;
  b2.Store.upsertLyric(id2, uid2, [], { notes: [{ t: 0, dur: 24, p: 60 }, { t: 24, dur: 24, p: 62 }] });
  sumOf(lyOf(e2, 0)).fire("click"); sumOf(lyOf(e2, 0)).fire("click");   // 收起再展开：按新谱重渲染
  const lane2 = byCls(lyOf(e2, 0), "arg-lyric-lane");
  const allNote = (function collect(node){
    let out = [];
    for (const c of (node.children || [])){
      if (/(^| )notechip( |$)/.test(c.className)) out.push(c);
      out = out.concat(collect(c));
    }
    return out;
  })(lane2);
  eq(allNote.length, 2, "★ 编辑轨纯谱行画满独立音符块");
  ok(!!allNote[0] && allNote[0].getAttribute("aria-label").indexOf("第 1 颗独立音符") === 0,
    "★ 独立音符块 aria 逐颗报读（读屏可数）");
  const edTxt = c => (c.children || []).find(x => /arg-lyric-char/.test(x.className));
  eq(allNote[0] ? edTxt(allNote[0]).textContent : "(无)", "1", "编辑轨 off 档按简谱显示（恒显口径同字上标）");
  b2.Arrange.close();
}

/* ============ T223g：notes 结构校验（重叠/域外/吸附/上限）与加载期迁移 ============ */
section("T223g normLyricLine notes · 吸附 / 重叠跳过 / 域外剥离 / 上限钳 / 加载期迁移");
{
  const app = fixture();
  const { beat, id, uid } = app;
  /* 重叠：跳过靠后的那颗（与字同口径）；t/dur 吸附十六分格 */
  beat.Store.upsertLyric(id, uid, [], { notes: [
    { t: 0, dur: 48, p: 60 }, { t: 24, dur: 24, p: 62 },          // 与前颗重叠 → 跳过
    { t: 50, dur: 25, p: 64 },                                    // 吸附：t→48? 50/12≈4.17→48（但 48 < lastEnd 48? 否，t=48≥48）→ 保留 dur→24
    { t: 72, dur: 24, p: 999 }, { t: 96, dur: 24, p: 60.5 },      // 域外/非整数 → 剥离
  ] });
  eq(JSON.stringify(beat.Store.findLyric(id, uid).notes),
    '[{"t":0,"dur":48,"p":60},{"t":48,"dur":24,"p":64}]',
    "★ 重叠跳后（t24 那颗让位）、吸附取整（t50→48 / dur25→24）、域外剥离（999 / 60.5）");
  /* 上限钳：513 颗只留 512（与 lyricMaxChars 同口径：加载时有界可钳） */
  const many = []; for (let i = 0; i < 513; i++) many.push({ t: i * 12, dur: 12, p: 60 });
  beat.Store.upsertLyric(id, uid, [], { notes: many });
  eq(beat.Store.findLyric(id, uid).notes.length, 512, "★ lyricMaxNotes=512 上限钳");
  /* 加载期迁移：存量 A 期字级 p（localStorage 里的老数据）→ 加载即迁 notes、字回纯形 */
  const seed = {
    "beatsight.lyrics": JSON.stringify({ v: 2, lines: [
      { arrangeId: "t1", secUid: "s1", chars: [
        { t: 0, dur: 24, ch: "一", p: 60 }, { t: 24, dur: 24, ch: "二" } ] },
    ] }),
  };
  const old = loadApp(seed);
  const ol = old.beat.Store.findLyric("t1", "s1");
  eq(JSON.stringify(ol.notes), '[{"t":0,"dur":24,"p":60}]',
    "★★ 加载期迁移：A 期 p → notes（t/dur 照抄、p 照搬）");
  ok(ol.chars.every(c => !("p" in c)), "★★ 迁移后字对象纯形（存量零 churn 地完成换轨）");
  /* 幂等：迁移后的行再加载一遍，谱不翻倍（notes 键已带 = 不再走迁移分支） */
  old.beat.Store.flush && old.beat.Store.flush();
  const seed2 = {}; old.storage.forEach((v, k) => { seed2[k] = v; });
  const again = loadApp(seed2);
  eq(JSON.stringify(again.beat.Store.findLyric("t1", "s1").notes), '[{"t":0,"dur":24,"p":60}]',
    "★ 幂等：再加载谱不翻倍（v:2 落盘带 notes 键，迁移分支不再触发）");
  beat.Arrange.close();
}

/* ============ T223h：谱随行拷（复制段）+ lyricNotesAt 越界剔除 ============ */
section("T223h 复制段带谱 / lyricNotesAt 越界剔除与缓存失效");
{
  const app = fixture();
  const { beat, id, uid } = app;
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一" }],
    { notes: [{ t: 0, dur: 24, p: 60 }, { t: 96, dur: 24, p: 64 }] });
  const r = beat.Store.duplicateSection(id, uid);
  ok(!!r && !!r.uid, "前提：复制段成功");
  const cp = beat.Store.findLyric(id, r.uid);
  ok(!!cp, "★★ 复制段 = 复制整行内容（词与谱同拷——姊妹轨语义）");
  eq(JSON.stringify(cp.notes), '[{"t":0,"dur":24,"p":60},{"t":96,"dur":24,"p":64}]',
    "★ 谱随行拷（含间奏谱）");
  eq(cp.chars.length, 1, "词也随行拷");
  /* 纯谱行同样可复制 */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 0, dur: 24, p: 60 }] });
  const r2 = beat.Store.duplicateSection(id, uid);
  const cp2 = beat.Store.findLyric(id, r2.uid);
  ok(!!cp2 && cp2.chars.length === 0 && cp2.notes.length === 1,
    "★ 纯谱行复制：chars 空 + notes 一颗（前奏段复制不再丢内容）");
  /* lyricNotesAt：越界音符剔除（与字同口径同缓存） */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 0, dur: 24, p: 60 }, { t: 200, dur: 24, p: 62 }] });
  const got = beat.lyricNotesAt(id, uid);
  eq(JSON.stringify(got), '[{"t":0,"dur":24,"p":60}]',
    "★ 越出段落的音符被剔除（渲染/发声侧只见段内谱）");
  /* 缓存失效：行对象替换后 lyricNotesAt 见新谱（身份失效一次管两条轨） */
  beat.Store.upsertLyric(id, uid, [], { notes: [{ t: 24, dur: 24, p: 67 }] });
  eq(beat.lyricNotesAt(id, uid)[0].p, 67, "★ 行替换后缓存自动失效（改谱立即可见）");
  beat.Arrange.close();
}
