/* BeatSight 自动化测试 · G3 段稳定 uid —— 歌词按段绑定（v2.26.0）
   T103 系列。
   ---------------------------------------------------------------------------
   ★ 为什么要有这一组：歌词行此前按 (曲式id, **段下标**) 寻址。下标是**位置**不是**身份**，
     于是「把第 1 段下移」「删掉中间某一段」之后，挂在下标上的那行词会**跟着位置走**，
     落到另一个段上——用户的心智是"这行词属于我写的那一段"，段挪到哪儿它就跟到哪儿。
     v2.26.0 把寻址键换成段 uid（normArrange 在段新建时发一次，此后随段对象搬移）。

   本组盯的是「段一挪，词跟不跟得上」这一条契约，以及旧冷键（v:1，段下标）的迁移口径。
   ★ 迁移的语义边界（必须记住）：它把**当前**的下标对应关系冻结成 uid 绑定，
     修复的是"未来不再错位"；历史上已经错位的词机器无从判断本意，不追溯修复。

   基准：BUILTINS[1]（四分基础 4/4）× 1 遍 = 4 小节 = 4×4×48 = 768 tick。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 三段各 4 小节；uid 显式写死，让"哪一行词属于哪一段"在断言里可读 */
const SECS = () => [
  { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
  { uid: "uB", name: "B段", blocks: [BL(1, 1)] },
  { uid: "uC", name: "C段", blocks: [BL(1, 1)] },
];
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t103", name: "三段歌", sections: SECS() },
]}) });
/* 三段各录一个字：A=一 / B=二 / C=三 */
const seedWords = app => {
  const St = app.beat.Store;
  St.upsertLyric("t103", "uA", [{ t: 0, dur: 24, ch: "一" }]);
  St.upsertLyric("t103", "uB", [{ t: 0, dur: 24, ch: "二" }]);
  St.upsertLyric("t103", "uC", [{ t: 0, dur: 24, ch: "三" }]);
};
/* 段行结构：[段号, 段名, 块列, 操作钮, 歌词轨]；操作钮 = [起, 终, ↑, ↓, ✕] */
const opsOf = (app, i) => app.els["argSections"].children[i].children[3];
const clickDown = (app, i) => opsOf(app, i).children[3].fire("click");
const clickUp = (app, i) => opsOf(app, i).children[2].fire("click");
const names = app => app.beat.Store.findArrange("t103").sections.map(s => s.name).join("");
const uids = app => app.beat.Store.findArrange("t103").sections.map(s => s.uid).join(",");

/* 取某一段挂的第一个字；段上没有行时返回「无」而不是抛错——
   ★ 反向验证（变异测试）时"行丢掉了"必须表现为**具名断言失败**，不能让整个套件崩在
   `null.chars`（崩溃不是证据，见 DEVELOPMENT 的反向验证纪律） */
const wordOf = (St, uid) => {
  const l = St.findLyric("t103", uid);
  return (l && l.chars.length) ? l.chars[0].ch : "无";
};

/* console.warn 暂捕：沙箱与宿主共用同一个 console 对象；测试同步执行，用完即还 */
const captureWarn = () => {
  const list = [], orig = console.warn;
  console.warn = (...a) => list.push(a.map(String).join(" "));
  return { list, restore(){ console.warn = orig; } };
};

/* ================= 场景 T103a：段下移 → 歌词跟着段走（本组的主断言） ================= */
section("T103a 段稳定 uid · 段下移后歌词仍挂原段（旧口径下标会串段）");
{
  const app = loadApp(seedArr());
  seedWords(app);
  const St = app.beat.Store;
  eq(names(app), "A段B段C段", "前提：三段顺序 A/B/C");
  eq(uids(app), "uA,uB,uC", "★ 段 uid 是显式身份（不是下标）");

  app.beat.Arrange.open();
  clickDown(app, 0);                       // 把 A 段下移一位 → B/A/C
  eq(names(app), "B段A段C段", "段真的挪了位（A 从第 1 位到第 2 位）");
  eq(uids(app), "uB,uA,uC", "★ uid 跟着段一起搬（它是段的字段，不是位置）");

  /* ★ 主断言：A 段的词「一」仍在 A 段上，没有跟着下标 0 落到 B 段头上 */
  eq(wordOf(St, "uA"), "一", "★ A 段的词仍是「一」（挂在 uid 上，不挂位置）");
  eq(wordOf(St, "uB"), "二", "B 段的词仍是「二」");
  /* 旧口径会串段的证据：现在下标 0 是 B 段，若按 (id, 0) 取词，取到的是 B 的词「二」——
     而 A 段的词本该还在 A 上。两边必须都能各取各自的 */
  const at0 = St.findArrange("t103").sections[0];
  eq(wordOf(St, at0.uid), "二", "下标 0 现在是 B 段 → 它的词是「二」（未串）");
  const at1 = St.findArrange("t103").sections[1];
  eq(wordOf(St, at1.uid), "一", "★ 下标 1 现在是 A 段 → 它的词是「一」（跟着段走了）");
  app.beat.Arrange.close();

  /* 再上移回原位：仍各归各（来回搬不产生漂移） */
  app.beat.Arrange.open();
  clickUp(app, 1);
  eq(names(app), "A段B段C段", "移回原位");
  eq(wordOf(St, "uA"), "一", "来回搬之后词仍在原段");
  app.beat.Arrange.close();
}

/* ================= 场景 T103b：段删除 → 该段歌词不再现身，后方段歌词仍挂原段 ================= */
section("T103b 段稳定 uid · 删中间段：被删段的词不再现身，后方段不受影响");
{
  const app = loadApp(seedArr());
  seedWords(app);
  const St = app.beat.Store;
  app.beat.Arrange.open();
  opsOf(app, 1).children[4].fire("click");      // 删 B 段（走 uiConfirm）
  app.els["modalOk"].fire("click");             // 确认
  eq(names(app), "A段C段", "B 段已删");

  /* 被删段的 uid 已不在曲式里 → 它的词永远取不到（span 0 = "这一段不存在"） */
  eq(St.findArrange("t103").sections.some(s => s.uid === "uB"), false, "uB 已随段消失");
  eq(app.beat.lyricSpanTicks("t103", "uB"), 0, "★ 被删段：span 0（渲染侧取不到这一行）");
  /* 后方段（C）的 uid 与词都没被这次删除动到——旧口径下 C 会前移到下标 1 而丢掉自己的词 */
  eq(wordOf(St, "uC"), "三", "★ C 段的词仍是「三」（没有因为 B 被删而错位）");
  eq(app.beat.lyricSpanTicks("t103", "uC"), 768, "C 段的段长照旧（4 小节 × 192）");
  eq(wordOf(St, "uA"), "一", "A 段同样不受影响");
  app.beat.Arrange.close();
}

/* ================= 场景 T103c：旧冷键（v:1，段下标）加载迁移 ================= */
section("T103c 旧冷键迁移 · sec 下标 → 段 uid，落盘升 v:2");
{
  const legacy = { v: 1, lines: [
    { arrangeId: "t103", sec: 0, chars: [{ t: 0, dur: 24, ch: "一" }] },
    { arrangeId: "t103", sec: 1, chars: [{ t: 0, dur: 24, ch: "二" }] },
    { arrangeId: "t103", sec: 2, chars: [{ t: 0, dur: 24, ch: "三" }] },
  ]};
  const cap = captureWarn();
  const app = loadApp(Object.assign(seedArr(),
    { "beatsight.lyrics": JSON.stringify(legacy) }));
  cap.restore();
  const St = app.beat.Store;
  eq(St.lyrics.length, 3, "三行旧歌词全部迁进来（没被当成坏行丢掉）");
  eq(wordOf(St, "uA"), "一", "★ sec:0 → uA（按下标换成了该段当时的 uid）");
  eq(wordOf(St, "uB"), "二", "sec:1 → uB");
  eq(wordOf(St, "uC"), "三", "sec:2 → uC");
  ok(St.lyrics.every(l => !("sec" in l)), "★ 内存里不再有旧字段 sec（行形状已是 {arrangeId, secUid, chars}）");
  ok(!cap.list.some(s => s.includes("未通过结构校验")), "迁移不产生坏行告警（不是靠丢弃过关的）");

  /* 改一行触发落盘 → 冷键升 v:2 且写的是 secUid */
  St.upsertLyric("t103", "uA", [{ t: 0, dur: 24, ch: "壹" }]);
  const disk = JSON.parse(app.storage.get("beatsight.lyrics"));
  eq(disk.v, 2, "★ 落盘版本号升到 v:2");
  ok(disk.lines.every(l => typeof l.secUid === "string" && !("sec" in l)),
    "★ 落盘的每一行都只带 secUid（旧形状不再写回）");
}

/* ================= 场景 T103d：迁移幂等（同一份旧冷键连加载两次） ================= */
section("T103d 迁移幂等 · 同一份旧冷键加载两次，结果逐位一致");
{
  const legacy = { v: 1, lines: [
    { arrangeId: "t103", sec: 0, chars: [{ t: 0, dur: 24, ch: "一" }] },
    { arrangeId: "t103", sec: 2, chars: [{ t: 0, dur: 24, ch: "三" }] },
  ]};
  const snap = () => {
    const app = loadApp(Object.assign(seedArr(), { "beatsight.lyrics": JSON.stringify(legacy) }));
    return app.beat.Store.lyrics.map(l => l.arrangeId + "|" + l.secUid + "|" + l.chars.map(c => c.ch).join(""));
  };
  eq(JSON.stringify(snap()), JSON.stringify(snap()), "★ 两次加载结果逐位相同（迁移不写回、不重复迁移）");
  eq(snap().length, 2, "两行都在");

  /* 已经迁好（v:2 / secUid）的冷键再加载一次：走快路径，不再动 */
  const done = { v: 2, lines: [
    { arrangeId: "t103", secUid: "uB", chars: [{ t: 0, dur: 24, ch: "二" }] },
  ]};
  const app2 = loadApp(Object.assign(seedArr(), { "beatsight.lyrics": JSON.stringify(done) }));
  eq(app2.beat.Store.lyrics.length, 1, "新格式冷键直接读取（不走迁移）");
  eq(app2.beat.Store.lyrics[0].secUid, "uB", "secUid 原样保留（不会被重发号）");
  eq(app2.beat.Store.lyrics[0].chars[0].ch, "二", "词不受影响");
}

/* ================= 场景 T103e：下标越界的旧行 → 按段名兜底 / 兜不住就丢 ================= */
section("T103e 迁移兜底 · 下标越界：按段名找回 / 找不回则丢弃计数");
{
  const legacy = { v: 1, lines: [
    { arrangeId: "t103", sec: 9, secName: "C段", chars: [{ t: 0, dur: 24, ch: "三" }] },  // 越界但能按名找回
    { arrangeId: "t103", sec: 9, chars: [{ t: 0, dur: 24, ch: "丢" }] },                  // 越界且无名 → 丢
    { arrangeId: "t103", sec: 7, secName: "没有这一段", chars: [{ t: 0, dur: 24, ch: "无" }] }, // 名也找不到 → 丢
  ]};
  const cap = captureWarn();
  const app = loadApp(Object.assign(seedArr(), { "beatsight.lyrics": JSON.stringify(legacy) }));
  cap.restore();
  eq(app.beat.Store.lyrics.length, 1, "只留按段名找回的那一行");
  const back = app.beat.Store.lyrics.find(l => l.chars[0].ch === "三");
  ok(!!back, "★ 越界的旧行没被整批丢掉（按段名找回那一档生效）");
  eq(back ? back.secUid : "", "uC", "★ 越界的旧行按段名落回 C 段（不是乱挂）");
  ok(cap.list.some(s => s.includes("2 条歌词行未通过结构校验")), "★ 兜不住的两行计入坏行告警（口径同结构校验失败）");
}

/* ================= 场景 T103f：按歌词行循环 —— 段重排后仍循环"那一段" ================= */
section("T103f 歌词行循环 · 收段 uid，段重排后循环的是原段而不是原位置");
{
  /* 三段各 4 小节 → 小节 0..3 / 4..7 / 8..11 */
  const app = loadApp(seedArr());
  seedWords(app);
  const St = app.beat.Store;
  app.beat.Arrange.loopLyricSection("t103", "uB");
  eq(JSON.stringify([St.S.arrangeSel.from, St.S.arrangeSel.to]), "[4,7]",
    "前提：B 段在下标 1 → 范围 = 小节 4..7");

  /* 把 B 段上移一位 → B 占小节 0..3（★ 只点一次：第 1 段的「↑」是 disabled 的空动作，
     点了也不会动库，写两次只会给断言掺进一个假前提） */
  app.beat.Arrange.open();
  clickUp(app, 1);
  eq(names(app), "B段A段C段", "B 段已移到首位");
  app.beat.Arrange.close();

  app.beat.Arrange.loopLyricSection("t103", "uB");
  eq(JSON.stringify([St.S.arrangeSel.from, St.S.arrangeSel.to]), "[0,3]",
    "★ 仍按 uid 找 B 段 → 范围跟着它挪到小节 0..3（旧口径会去循环现在的下标 1 = A 段）");
  eq(St.S.arrangeSel.byLyric, true, "byLyric 意图照旧置真");

  /* 传一个不存在的 uid = 空动作（不猜、不改状态） */
  const before = JSON.stringify([St.S.arrangeSel.from, St.S.arrangeSel.to]);
  app.beat.Arrange.loopLyricSection("t103", "ghost");
  eq(JSON.stringify([St.S.arrangeSel.from, St.S.arrangeSel.to]), before,
    "★ uid 找不到对应段 → 不动播放范围（不落到「某一小节」的半状态）");
}

/* ================= 场景 T103g：uid 的发放与唯一性（normArrange 判据） ================= */
section("T103g uid 发放 · 新建补发 / 重复重发 / 整存整取继承");
{
  const app = loadApp();
  const St = app.beat.Store;
  /* 不带 uid 的曲式 → 补发，且段间互不相同 */
  const v = St.upsertArrange({ id: "g1", name: "无 uid", sections: [
    { name: "一", blocks: [BL(1, 1)] }, { name: "二", blocks: [BL(1, 1)] },
  ]});
  ok(!!v, "曲式通过校验");
  eq(v.sections.length, 2, "两段");
  ok(typeof v.sections[0].uid === "string" && v.sections[0].uid.length > 0, "★ 缺 uid → 补发");
  ok(v.sections[0].uid !== v.sections[1].uid, "★ 同曲式内 uid 互不相同");

  /* 同曲式内 uid 重复 = 脏数据 → 后者重发 */
  const dup = St.upsertArrange({ id: "g2", name: "撞号", sections: [
    { uid: "same", name: "一", blocks: [BL(1, 1)] }, { uid: "same", name: "二", blocks: [BL(1, 1)] },
  ]});
  eq(dup.sections[0].uid, "same", "第一条保留自带 uid");
  ok(dup.sections[1].uid !== "same", "★ 撞号的后者被重发（否则两段的词会互相覆盖）");

  /* 脏 uid（非字符串 / 空串）→ 重发 */
  const bad = St.upsertArrange({ id: "g3", name: "脏 uid", sections: [
    { uid: 123, name: "一", blocks: [BL(1, 1)] }, { uid: "", name: "二", blocks: [BL(1, 1)] },
  ]});
  ok(typeof bad.sections[0].uid === "string" && bad.sections[0].uid.length > 0, "★ 非字符串 uid → 重发");
  ok(bad.sections[1].uid.length > 0, "空串 uid → 重发");

  /* 整存整取：调用方不带 uid 地重写同一条曲式 → 按位置继承旧号（示例曲重建就是这条路） */
  const kept = St.upsertArrange({ id: "g1", name: "无 uid（重写）", sections: [
    { name: "一", blocks: [BL(1, 1)] }, { name: "二", blocks: [BL(1, 1)] },
  ]});
  eq(kept.sections[0].uid, v.sections[0].uid, "★ 重写同一条曲式 → 段身份保持不变（挂着的词不会失配）");
  eq(kept.sections[1].uid, v.sections[1].uid, "第二段同理");
}
