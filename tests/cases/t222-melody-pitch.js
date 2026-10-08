/* BeatSight 自动化测试 · 旋律谱（v3.37.0；B 期契约）
   T222 系列。
   ---------------------------------------------------------------------------
   由来（用户需求 + 三项拍板）：可视化区增加「与段落对应的旋律谱」。
   ★ v3.37.0 B 期（模型迁移）：音高的锚点从「字」挪到「格子」——
     · 行级 notes 姊妹轨（LyricLine.notes = [{t, dur, p}]，与 chars 同网格同坐标系）；
     · A 期字级 p 在 normLyricLine **一次性迁移**为 notes（t/dur 照抄、p 照搬），
       此后字对象回到纯 {t, dur, ch}；
     · 谱锚在格上**不随字移动**：换位/平移/对齐/打轴改的是字的位置，谱留在原地；
     · 字身上的上标由「谱 × 字区间」**派生**（charPitchMark：恰一颗 = 度数/音名、
       延音 =「-」、一字多音 =「·」串显）；不与字重叠的谱渲染成独立音符块（前奏/间奏/尾奏）。
   B 期纯函数与贴谱流/纯谱行的用例在 t223-melody-notes.js；本文件钉：
     · 纯函数折算与贴词后缀解析（T222a/b——B 期未动，照旧）；
     · A→B 迁移与字对象纯形（T222c）；
     · 贴词全链路（T222d：后缀音高落 notes、纯文字重贴不清谱、保位重建）；
     · 「字动谱不动」各路径 + 行级撤销快照（T222e）；
     · 设置三态（T222f——B 期未动，照旧）；
     · 音高组按钮的行级谱语义（T222g）；
     · 练习视图三态派生渲染（T222h）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section } = require("../lib/harness");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));
const miniByAria = (ly, frag) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.getAttribute("aria-label") &&
  c.getAttribute("aria-label").indexOf(frag) >= 0);
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));

/* 夹具（t118 同款）：一个 4/4 段（span=192t）+ 打开编排页并展开歌词编辑区 */
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
const paste = (els, text) => {
  const box = byCls(lyOf(els, 0), "arg-lyric-paste");
  box.value = text;
  box.fire("change");
};
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};

/* ============ T222a：音高纯函数（度数折算 / 音名 / 调主） ============ */
section("T222a 纯函数 · midi↔简谱/音名折算（keySemiOf / jianpuOf / pitchNameOf）");
{
  const { beat } = loadApp();
  eq(beat.keySemiOf("C"), 60, "调主 C = C4 = 60");
  eq(beat.keySemiOf("F#"), 66, "调主 F# = 66");
  eq(beat.keySemiOf("Bb"), 70, "同音异名 Bb = A# = 70");
  eq(beat.keySemiOf("不是调"), 60, "★ 非法调名回落 C（不静默换调）");
  eq(beat.pitchNameOf(60), "C4", "音名：60 = C4");
  eq(beat.pitchNameOf(61), "C#4", "音名：61 = C#4");
  eq(beat.pitchNameOf(72), "C5", "音名：72 = C5");
  eq(beat.pitchNameOf(58), "A#3", "音名：58 = A#3（八度向下取整）");
  /* 简谱（C 调）：自然音级 + 八度点 + 升降号 */
  const C = beat.keySemiOf("C");
  eq(beat.jianpuOf(60, C), "1", "C 调 do = 1");
  eq(beat.jianpuOf(62, C), "2", "re = 2");
  eq(beat.jianpuOf(67, C), "5", "sol = 5");
  eq(beat.jianpuOf(69, C), "6", "la = 6（同八度，不带点）");
  eq(beat.jianpuOf(71, C), "7", "si = 7（半音差 11 单列，不得掉成 #6）");
  eq(beat.jianpuOf(72, C), "1'", "★ 高八度 = 1'");
  eq(beat.jianpuOf(57, C), "6,", "★ 低八度的 la = 6,（A3=57 落在 C3–B3 那一档：d=−3 → rel 9、oct −1）");
  eq(beat.jianpuOf(59, C), "7,", "低八度的 si = 7,（B3=59：d=−1 → rel 11、oct −1）");
  eq(beat.jianpuOf(61, C), "#1", "升半音 = #1（升号制）");
  eq(beat.jianpuOf(66, C), "#4", "66 = #4");
  eq(beat.jianpuOf(70, C), "#6", "70（b7 同音）统一显示 #6（确定性优先）");
  /* 简谱（G 调）：首调折算——G4=67 是 do */
  const G = beat.keySemiOf("G");
  eq(beat.jianpuOf(67, G), "1", "G 调 do = G4");
  eq(beat.jianpuOf(62, G), "5,", "★ G 调下方纯五度（D4=62）= 低八度 sol = 5,（首调，不是音名的 D）");
  eq(beat.jianpuOf(74, G), "5", "G 调 D5=74 = sol（同一八度内）");
  eq(beat.jianpuOf(81, G), "2'", "G 调 A5=81 = 高八度 re");
  /* 双渲染收口 */
  eq(beat.pitchTextOf(67, "jp", ""), "5", "pitchTextOf jp = 简谱");
  eq(beat.pitchTextOf(67, "nm", ""), "G4", "pitchTextOf nm = 音名（不读调主）");
  eq(beat.pitchTextOf(67, "off", ""), "5", "pitchTextOf 其余档按 jp（编辑轨 off 时的显示口径）");
}

/* ============ T222b：贴词后缀解析（终止规则 / 数字歌词保护 / 双写法） ============ */
section("T222b parseLyricTextPitch · 后缀紧跟字 + 止于空白/串尾");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  eq(JSON.stringify(beat.parseLyricTextPitch("我5 多6 想1'", C)),
    JSON.stringify([{ ch: "我", p: 67 }, { ch: "多", p: 69 }, { ch: "想", p: 72 }]),
    "★★ 空格分隔的「我5 多6 想1'」→ 三字各带 p（67/69/72）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我多", C)),
    JSON.stringify([{ ch: "我" }, { ch: "多" }]),
    "★ 纯文字与旧口径逐位一致：两字、无 p 字段");
  eq(JSON.stringify(beat.parseLyricTextPitch("想你的365天", C)),
    JSON.stringify([{ ch: "想" }, { ch: "你" }, { ch: "的" }, { ch: "3" }, { ch: "6" }, { ch: "5" }, { ch: "天" }]),
    "★★★ 数字歌词保护：「365」不被吃成音高（3 后面跟着 6、不是空白——终止规则的意义）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我5多6", C)),
    JSON.stringify([{ ch: "我" }, { ch: "5" }, { ch: "多" }, { ch: "6" }]),
    "★ 不带空格的「我5多6」不解析（5/6 成为独立字，所见即所得）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我#1' 啊", C)),
    JSON.stringify([{ ch: "我", p: 73 }, { ch: "啊" }]),
    "★ 记号前置写法 #1' 也认（= 1#' = 73）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我b7 你", C)),
    JSON.stringify([{ ch: "我", p: 70 }, { ch: "你" }]),
    "★ b7 = 降七级（C 调 70，与 #6 同音异名）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我9 你0", C)),
    JSON.stringify([{ ch: "我" }, { ch: "9" }, { ch: "你" }, { ch: "0" }]),
    "★ 8/9/0 不是度数 → 成为普通字（不炸、不静默吞）");
  eq(JSON.stringify(beat.matchPitchSuffix("我1'''", 1, C)),
    JSON.stringify({ len: 4, p: 96 }), "1''' = 96 恰好压在 PITCH_MAX 上，合法");
  eq(beat.matchPitchSuffix("我1''''", 1, C), null,
    "★ 越出 PITCH_MAX(96) 的后缀整体无效（1'''' = 108 → 该 token 退回普通字）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我1''", C)),
    JSON.stringify([{ ch: "我", p: 84 }]),
    "1'' = +2 八度 = 84，仍在域内");
}

/* ============ T222c：A→B 迁移（char.p 一次性并入 notes，字对象回纯形） ============ */
section("T222c normLyricLine · A 期 p 迁移为 notes / 脏值剥离 / 显式 notes 为准");
{
  const app = fixture();
  const { beat, id, uid } = app;
  beat.Store.upsertLyric(id, uid, [
    { t: 0, dur: 24, ch: "一", p: 60 }, { t: 24, dur: 24, ch: "二", p: 999 },
    { t: 48, dur: 24, ch: "三", p: 60.5 }, { t: 72, dur: 24, ch: "四" }]);
  const l = beat.Store.findLyric(id, uid);
  eq(JSON.stringify(l.notes), '[{"t":0,"dur":24,"p":60}]',
    "★★ 合法 p 迁入 notes（t/dur 照抄、p 照搬）；越界 999 与非整数 60.5 剥离");
  ok(l.chars.every(c => !("p" in c)),
    "★★ 字对象回到纯 {t,dur,ch}（两套真相源不并存——B 期起 p 不随字走）");
  eq(JSON.stringify(l.chars[3]), '{"t":72,"dur":24,"ch":"四"}',
    "无 p 的字序列化形状与旧格式逐位一致（localStorage 存量零 churn）");
  /* 显式提交谱 = 本次真相：残留 char.p 静默丢弃（手改脏值不产生第二真相源） */
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一", p: 60 }],
    { notes: [{ t: 0, dur: 24, p: 67 }] });
  const l2 = beat.Store.findLyric(id, uid);
  eq(JSON.stringify(l2.notes), '[{"t":0,"dur":24,"p":67}]',
    "★ 显式 notes 为准——行里已有谱时残留 char.p 不迁移（B 期形状优先）");
  ok(l2.chars.every(c => !("p" in c)), "字对象仍纯形");
  beat.Arrange.close();
}

/* ============ T222d：贴词全链路（distribute → 拆双轨落库 → 回填 round-trip） ============ */
section("T222d distribute 全链路 · 后缀音高落 notes / 纯文字重贴不清谱 / 回填一进一出");
{
  const app = fixture();
  const { beat, els, id, uid } = app;
  paste(els, "我5 多6 想1' 去");
  const cs = chars(beat, id, uid);
  const line = () => beat.Store.findLyric(id, uid);
  eq(cs.length, 4, "四个字落库（后缀被吃、不是八颗）");
  eq(JSON.stringify(cs[0]), '{"t":0,"dur":24,"ch":"我"}',
    "★ 字块纯形——后缀音高不落 chars（拆双轨：字归字、谱归谱）");
  eq(JSON.stringify(line().notes),
    '[{"t":0,"dur":24,"p":67},{"t":24,"dur":24,"p":69},{"t":48,"dur":24,"p":72}]',
    "★★ 我5 → 67、多6 → 69、想1' → 72（高八度）三颗音符 1:1 落在字位上");
  ok(!line().notes.some(n => n.t === 72), "「去」不带后缀 → 无音符（两法混用自由）");
  /* 回填 round-trip：prefill 从行级谱派生（1:1 形才带后缀）、空格分隔 */
  eq(byCls(lyOf(els, 0), "arg-lyric-paste").value, "我5 多6 想1' 去",
    "★★ 回填 = 字 + 简谱后缀、空格分隔（与解析器一进一出同一套写法）");
  const before = JSON.stringify(line());
  paste(els, byCls(lyOf(els, 0), "arg-lyric-paste").value);   // 回填原样再贴一遍
  eq(JSON.stringify(line()), before,
    "★★ round-trip 逐位幂等（回填文本再贴一遍 = 原数据，字与谱都不动）");
  /* ★ B 期语义：纯文字重贴 = 字是内容权威，**谱不是**——谱锚在格上原样保留 */
  paste(els, "我多想去");
  ok(chars(beat, id, uid).every(c => !("p" in c)), "纯文字重贴 → 字块仍纯形");
  eq(line().notes.length, 3, "★★ 纯文字重贴不清谱（谱锚在格上——间奏谱不被贴词误删）");
  /* 纯词口径：从未有谱的行，回填不空格分隔（与 v2 时代逐位一致） */
  const app2 = fixture();
  paste(app2.els, "我多想去");
  eq(byCls(lyOf(app2.els, 0), "arg-lyric-paste").value, "我多想去",
    "无音高的回填不加空格（旧行为不变）");
  ok(!app2.beat.Store.findLyric(app2.id, app2.uid).notes, "无谱行不写 notes 键（落盘形状与旧格式逐位一致）");
  app2.beat.Arrange.close();
  /* 保位重建：改一个字，位置保留；后缀谱覆盖重叠段（新为准）、间奏谱保留 */
  beat.Store.upsertLyric(id, uid, chars(beat, id, uid).slice(),
    { notes: line().notes.concat([{ t: 144, dur: 24, p: 64 }]) });  // 造一颗「间奏谱」（词原样）
  paste(els, "我5 多6 想1' 啊");
  const cs3 = chars(beat, id, uid);
  eq(cs3[3].ch, "啊", "末字替换成功");
  eq(cs3[0].t, 0, "保位重建：换字不动已排位置");
  ok(line().notes.some(n => n.t === 144 && n.p === 64),
    "★★ 间奏谱原样保留（重贴词只覆盖它谱到的那几个音）");
  ok(line().notes.some(n => n.t === 48 && n.p === 72), "前字位的谱照旧（mergeLineNotes 不误伤）");
  beat.Arrange.close();
}

/* ============ T222e：字动谱不动（换位/平移/对齐/打轴）+ 行级撤销快照 + 编辑轨渲染 ============ */
section("T222e 谱保真 · 字的位置路径都不动谱 / 行级快照 {chars, notes} 整行回放");
{
  const app = fixture();
  const { beat, els, id, uid, arr } = app;
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一", p: 60 }, { t: 48, dur: 24, ch: "二", p: 64 }]);
  const notes0 = () => JSON.stringify(beat.Store.findLyric(id, uid).notes);
  eq(notes0(), '[{"t":0,"dur":24,"p":60},{"t":48,"dur":24,"p":64}]', "前提：A 期 p 已迁移为两颗音符");

  /* ⑦ 编辑轨渲染恒显 + aria 恒带音高（派生：谱 × 字区间。先于打轴做：startTap 会关浮层回主视图） */
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");   // 收起再展开：按新词重渲染
  const chip0 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[0];
  ok(chip0.getAttribute("aria-label").indexOf("音高 1") > 0,
    "★★ 字块 aria-label 恒带「音高」（60 在 C 调派生为简谱 1；读屏不依赖视觉开关）");
  const txt0 = chip0.children.find(c => /arg-lyric-char/.test(c.className));
  const pit0 = (txt0.children || []).find(c => /arg-lyric-pit/.test(c.className));
  ok(!!pit0 && pit0.textContent === "1",
    "★ 编辑轨音高上标恒显（默认 off 档也按简谱显示——编辑面看得到数据）");

  /* ① swapChars：时序互换（下标位各留原字、t/dur 互换）——纯函数产物不带 p、谱不动 */
  const sw = beat.Arrange.swapChars(chars(beat, id, uid), 0);
  eq(JSON.stringify(sw), '[{"t":48,"dur":24,"ch":"一"},{"t":0,"dur":24,"ch":"二"}]',
    "★ 换位：字块纯形（换的是「哪个字占哪段旋律」，不是旋律本身）");
  eq(notes0(), '[{"t":0,"dur":24,"p":60},{"t":48,"dur":24,"p":64}]',
    "★★ 换位后行级谱纹丝不动（谱锚在格上，不随字换位）");

  /* ② shiftLyricChars：平移只动 t——谱留在原地（词被挪离音符时上标如实消失） */
  const sh = beat.Arrange.shiftLyricChars(chars(beat, id, uid), 0, 24, 192);
  eq(sh[0].t, 24, "平移 +1 格");
  ok(!("p" in sh[0]), "★ 平移产物纯形（p 不再随字走）");
  eq(notes0(), '[{"t":0,"dur":24,"p":60},{"t":48,"dur":24,"p":64}]', "★★ 平移后谱纹丝不动");

  /* ③ alignLyricToRhythm：对齐只重排字的位置——谱全员保留 */
  const sec = arr.sections[0];
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 48, ch: "一", p: 60 }, { t: 96, dur: 48, ch: "二", p: 67 }]);
  const beforeAlign = notes0();
  beat.Arrange.alignLyricToRhythm(arr, sec, beat.Store.findLyric(id, uid));
  ok(chars(beat, id, uid).every(c => !("p" in c)), "对齐产物纯形");
  eq(notes0(), beforeAlign, "★★ 对齐后谱全员原样（位置被重排、谱没丢）");

  /* ⑤ 行级撤销快照：一步 = 整行 {chars, notes}——不存在「字回去了谱没回去」的半态
     （先于打轴做：startTap 会关浮层回主视图） */
  paste(els, "一1 二2");                       // lyricCommit 第 1 步（两字两音）
  const snap1 = JSON.stringify(beat.Store.findLyric(id, uid));
  paste(els, "一1 二2 三3");                    // 第 2 步
  ok(beat.Arrange.lyricUndo(id, uid) === true, "undo 成功");
  eq(JSON.stringify(beat.Store.findLyric(id, uid)), snap1,
    "★★ undo 回放整行快照（字与谱同时回到提交前）");
  ok(beat.Arrange.lyricRedo(id, uid) === true, "redo 成功");
  eq(beat.Store.findLyric(id, uid).chars.length, 3, "redo 回到第 2 步（三字）");
  eq(beat.Store.findLyric(id, uid).notes.length, 3, "★ redo 的谱也同步（三颗音）");
  ok(beat.Arrange.lyricUndo(id, uid) === true, "再 undo 一步（回到贴词前）");

  /* ④ 打轴快照（startTap）：字快照纯形；打轴只改 t/dur，谱天然保留 */
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一", p: 60 }, { t: 48, dur: 24, ch: "二", p: 64 }]);
  const beforeTap = notes0();
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  const t1 = beat.Arrange.tapState();
  ok(!!t1, "前提：进入打轴态");
  ok(t1.chars.every(c => !("p" in c)), "★ 打轴快照纯形（v3.37.0 B 期：谱不在字身上）");
  beat.Arrange.tapEnd();
  eq(notes0(), beforeTap, "★★ 打轴入口/出口谱原样（upsertLyric 缺省「保留现谱」）");
  beat.Arrange.close();
}

/* ============ T222f：设置三态（默认关 / 切换 / 持久化 / 随歌词开关显隐） ============ */
section("T222f 设置三态 · 默认 off / 点按切换 / 进热键载荷 / 歌词关时整组收起");
{
  const app = fixture();
  const { beat, els } = app;
  eq(beat.Store.S.pitchNotation, "off", "★ 默认 off（不带音高的老用户画面逐位不变）");
  const grp = els["pitchNotationGroup"];
  eq(grp.hidden, false, "前提：歌词开着 ⇒ 音高组可见");
  const pill = name => (grp.children || []).find(b => b.dataset && b.dataset.pn === name);
  ok(!!pill("jp") && !!pill("nm"), "三枚胶囊齐备（off/jp/nm）");
  pill("jp").fire("click");
  eq(beat.Store.S.pitchNotation, "jp", "★ 点「简谱」→ S.pitchNotation = jp");
  ok(pill("jp").classList.contains("active"), "按压态同步（.active）");
  pill("nm").fire("click");
  eq(beat.Store.S.pitchNotation, "nm", "★ 点「音名」→ nm");
  /* 持久化：热键载荷（beatsight.state）带上 pitchNotation（persist 是防抖的，用 flush 立即落盘） */
  beat.Store.flush();
  eq(JSON.parse(app.storage.get("beatsight.state")).pitchNotation, "nm",
    "★★ 热键载荷带 pitchNotation（显示偏好跟热键走）");
  /* 歌词关 ⇒ 音高组随位置组一起收起（syncAuxVisibility ④） */
  els["showLyricToggle"].fire("click");
  eq(grp.hidden, true, "★★ 显示歌词关 ⇒ 音高三态组整组收起");
}

/* ============ T222g：精修「音高」组按钮（行级谱语义：± 作用于交叠音符 / 清除摘净） ============ */
section("T222g 音高按钮 · 无音符从调主起 / ±半音 / Shift=八度 / 清除摘净 / 无选中守卫");
{
  const app = fixture();
  const { beat, els, fireWin, id, uid } = app;
  /* 一（无音符）@0 + 二（p 60 迁移为一颗音符）@48 */
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一" }, { t: 48, dur: 24, ch: "二", p: 60 }]);
  const line = () => beat.Store.findLyric(id, uid);
  const notesOf = () => JSON.stringify(line().notes);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");   // 收起再展开：按新词重渲染
  const upBtn = () => miniByAria(lyOf(els, 0), "音高升半音");
  const dnBtn = () => miniByAria(lyOf(els, 0), "音高降半音");
  const clrBtn = () => miniByAria(lyOf(els, 0), "清除选中字的音高标注");
  ok(!!upBtn() && !!dnBtn() && !!clrBtn(), "三颗音高按钮在（升/降/清除）");

  /* 无选中：announce 指路、不落库 */
  const before = JSON.stringify(line());
  upBtn().fire("click");
  eq(JSON.stringify(line()), before, "无选中：数据不动");
  ok((els["srAnnounce"].textContent || "").indexOf("先点按选中") === 0, "无选中：announce 指路");

  /* 选中第一颗（身上无音符）：+ = 新建一颗（t/dur = 字的区间，从调主 C4=60 起，本步 ± 不生效） */
  const sel0 = () => { const c = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[0];
    c.fire("pointerdown", { clientX: 100 }); fireWin("pointerup", {}); };
  sel0();
  upBtn().fire("click");
  eq(notesOf(), '[{"t":0,"dur":24,"p":60},{"t":48,"dur":24,"p":60}]',
    "★ 无音符的字 + 从调主起（C4=60；新建音符 = 字的区间，输出按 t 升序）");
  ok(line().chars.every(c => !("p" in c)), "★ 字对象纯形不动（谱只进 notes）");
  ok((els["srAnnounce"].textContent || "").indexOf("「一」音高 1") >= 0, "announce 报简谱结果");

  /* ± 半音；Shift = ±12——作用于「与选中字交叠」的那颗音符，邻字音符不动 */
  upBtn().fire("click");
  ok(line().notes.some(n => n.t === 0 && n.p === 61), "再 + 半音 → 61");
  ok(line().notes.some(n => n.t === 48 && n.p === 60), "★ 邻字音符不受影响（整行保真）");
  upBtn().fire("click", { shiftKey: true });
  ok(line().notes.some(n => n.t === 0 && n.p === 73), "★ Shift 点按 = +12（八度）");
  dnBtn().fire("click");
  ok(line().notes.some(n => n.t === 0 && n.p === 72), "− 半音 → 72");

  /* 目标回退：字身上没有「覆盖字首」的音符时，± 作用于字内起音的首颗（一字多音的编辑入口） */
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 48, ch: "一" }, { t: 48, dur: 24, ch: "二", p: 60 }],
    { notes: [{ t: 24, dur: 24, p: 62 }, { t: 48, dur: 24, p: 64 }] });
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  sel0();
  upBtn().fire("click");
  ok(line().notes.some(n => n.t === 24 && n.p === 63),
    "★ 字内起音回退：字首无覆盖音符 ⇒ ± 落到字内首颗（t24 的 62→63）");
  ok(line().notes.some(n => n.t === 48 && n.p === 64), "邻段音符不受回退路径影响");

  /* 越界守卫：把交叠音符顶到 PITCH_MAX 再 + ⇒ 不落库、announce 报到头 */
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 24, ch: "一" }, { t: 48, dur: 24, ch: "二", p: 60 }],
    { notes: [{ t: 0, dur: 24, p: 96 }, { t: 48, dur: 24, p: 60 }] });
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  sel0();
  const beforeEdge = JSON.stringify(line());
  upBtn().fire("click", { shiftKey: true });
  eq(JSON.stringify(line()), beforeEdge, "★ 越出 PITCH_MAX：不落库");
  ok((els["srAnnounce"].textContent || "").indexOf("到头") > 0, "越界：announce 报到头");

  /* 清除：摘掉与该字重叠的**全部**音符（一字多音一次摘净）；邻字音符保留 */
  beat.Store.upsertLyric(id, uid,
    [{ t: 0, dur: 48, ch: "一" }, { t: 48, dur: 24, ch: "二", p: 60 }],
    { notes: [{ t: 0, dur: 24, p: 60 }, { t: 24, dur: 24, p: 62 }, { t: 48, dur: 24, p: 64 }] });
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  sel0();
  clrBtn().fire("click");
  eq(notesOf(), '[{"t":48,"dur":24,"p":64}]',
    "★★ 清除摘净与字重叠的全部音符（t0/t24 两颗一次摘掉），邻字音符保留");
  eq(JSON.stringify(line().chars[0]), '{"t":0,"dur":48,"ch":"一"}',
    "★ 清除后的字序列化形状 = 旧格式（谱删干净、字零 churn）");
  clrBtn().fire("click");
  ok((els["srAnnounce"].textContent || "").indexOf("本来就没有") > 0, "再清除：announce 说明无变化");
  beat.Arrange.close();
}

/* ============ T222h：练习视图三态渲染（off 不画 / jp 简谱 / nm 音名） ============ */
section("T222h 练习视图三态 · 字 span 内上标随开关换写法 / off 不画");
{
  /* t60 同款种子：BUILTINS[1]（四分基础 4/4）× 1 = 4 小节 = 768t；曲式模式 + 4 行档 */
  const BL = { ref: { type: "builtin", idx: 1 }, repeats: 1 };
  const app = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t1", name: "旋律曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }),
  });
  const { beat, els } = app;
  /* B 期：谱在行级 notes——字「一」(0–96t) 与音符 p=67 交叠 ⇒ 上标由 charPitchMark 派生 */
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 96, ch: "一" }],
    { notes: [{ t: 0, dur: 96, p: 67 }] });
  const laneChips = () => {
    const rows = els["lyricLane"].children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
    return Array.prototype.concat.apply([], rows.map(r =>
      (r.children || []).filter(c => /(^| )lyric-chip( |$)/.test(c.className))));
  };
  const pitOf = chip => {
    const label = (chip.children || []).find(c => /lyric-char/.test(c.className));
    return label ? (label.children || []).find(c => /lyric-pit/.test(c.className)) : null;
  };

  beat.Store.S.pitchNotation = "jp";
  beat.Viz.buildLyricLane();
  ok(laneChips().length > 0, "前提：主视图歌词字块在（曲式模式）");
  ok(laneChips().some(c => { const q = pitOf(c); return q && q.textContent === "5"; }),
    "★ jp 档：字 span 内上标 = 简谱「5」");

  beat.Store.S.pitchNotation = "nm";
  beat.Viz.buildLyricLane();
  ok(laneChips().some(c => { const q = pitOf(c); return q && q.textContent === "G4"; }),
    "★ nm 档：同一份 p=67 显示成音名 G4（存储始终是半音整数）");

  beat.Store.S.pitchNotation = "off";
  beat.Viz.buildLyricLane();
  ok(!laneChips().some(c => pitOf(c)), "★★ off 档：不画上标（默认态，老用户画面）");
  ok(beat.pitchTextOf(67, "jp", "") === "5", "前提自检：67 在 C 调 = 5（上面两条的换算依据）");
}
