/* BeatSight 自动化测试 · 老数据搬家的**回归矩阵**（v2.11.x 立）
   T91 系列。
   ---------------------------------------------------------------------------
   为什么单独成一组：迁移代码有个共同特征——**它只在新老数据相遇时才跑**，平时一次都不执行。
   于是它天然处于"覆盖率照绿、功能照坏"的盲区：老用户升级到新版，跑的是没人测过的那条路。

   而本轮（v2.11.2 / v2.11.3）恰好**动了数据形状**：
     · 删了 `trainer.start` / `trainer.last` / `trainer.plan` 三个字段；
     · 删了全量数据包里的 `log`（练习记录）一类；
     · 改了导入成功弹窗的文案（不再提练习记录）。
   这三件事的受害者**全是老数据**：新装的干净存档根本走不到这些分支。
   本组就是给"老数据 × 新代码"这个交叉面补一张网。

   矩阵的两条轴：
     轴① 数据来源（三种入口）：旧热键 beatsight.m2 / 新热键 beatsight.state / 全量数据包
     轴② 数据年代：v1（冷热未拆）· v2（已拆、含已删字段）· v3（当前）
   每条用例都要求：**照常加载 + 老字段静默消失 + 留下的字段一个不少**。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = o => ({ "beatsight.state": JSON.stringify(o) });
const seedM2 = o => ({ "beatsight.m2": JSON.stringify(o) });

/* console.warn 暂捕：沙箱与宿主共用同一个 console 对象；测试同步执行，用完即还 */
const captureWarn = () => {
  const list = [], orig = console.warn;
  console.warn = (...a) => list.push(a.map(String).join(" "));
  return { list, restore(){ console.warn = orig; } };
};

/* ================= 场景 T91：旧热键 v1（未冷热拆分）→ 现行 ================= */
section("T91 迁移矩阵 · 旧热键 beatsight.m2（v1，冷热未拆分）→ 冷热两键");
{
  /* 老包：customs 与热状态挤在一个键里，且 trainer 带着三个已删字段 */
  const legacy = {
    v: 3, bpm: 111, sig: 4,
    trainer: { on: true, start: 70, target: 120, step: 5, everyN: 2, last: { day: 3, stepIdx: 2 }, plan: { day: 2, days: 7 } },
    customs: [{ id: "r1", name: "老型", meter: 4, bars: [[{ t: 192 }]] }],
    sel: { type: "custom", id: "r1" },
  };
  const app = loadApp(seedM2(legacy));
  const S = app.beat.Store.S;

  eq(S.bpm, 111, "热状态照常读回（迁移不影响读）");
  eq(app.beat.Store.customs.length >= 1, true, "预设库从旧键里拆了出来");

  /* ★ 本轮的重点：老包里那三个已删字段，进到新代码后必须**一个都不留** */
  ok(!("start" in S.trainer), "★ 旧键里的 trainer.start 不进新状态（白名单抽取，零迁移代码）");
  ok(!("last" in S.trainer), "★ trainer.last（接续记录）不进新状态");
  ok(!("plan" in S.trainer), "★ trainer.plan（7 天计划）不进新状态");
  eq(Object.keys(S.trainer).sort().join(","), "everyN,on,step,target",
    "★ trainer 恰好只剩四个键（多了就是有人把删掉的字段又捡回来了）");
  eq(S.trainer.target, 120, "留下来的字段值一个没被改动");
  eq(S.trainer.step, 5, "step 原样");
  eq(S.trainer.everyN, 2, "everyN 原样");

  /* 旧键处置：拆成功 → 删旧键、留备份 */
  ok(!app.storage.has("beatsight.m2"), "拆分成功后删除旧键（否则老用户永远留着最大 715 KB 的废弃键）");
  ok(app.storage.has("beatsight.m2.bak"), "删除前已确保 .bak 备份存在（可人工回退）");

  /* 迁移完还能正常用：起点=当前 BPM 的新语义在这份老数据上也成立 */
  app.beat.Controls.setBpm(80);
  app.beat.Trainer.reset();
  eq(app.beat.Trainer.bpmFor(0), 80, "★ 老数据迁移后，训练起点就是当前 BPM（不再从某个存档值起步）");
  eq(app.beat.Trainer.total(), Math.ceil((120 - 80) / 5) + 1, "级数按新口径算（(120-80)/5 + 1）");
}

/* ================= 场景 T91b：写盘失败 → 旧键必须留住 ================= */
section("T91b 迁移矩阵 · 拆到一半写不进去 → 旧键留住，下次启动重试");
{
  const app = loadApp(seedM2({ v: 3, bpm: 190, customs: [] }), { throwOnWrite: true });
  ok(app.storage.has("beatsight.m2"), "★ 写后校验没过 → 保留旧键（否则老用户的数据就再也拆不过来了）");
  eq(app.beat.Store.S.bpm, 190, "本次会话照常用（读不受影响）");
  /* 半迁移：热键已在、冷键缺 → 不动旧键（不猜、不删，避免把已删预设从陈旧数据里复活） */
  const half = loadApp(Object.assign(seedM2({ v: 3, bpm: 200, customs: [{ id: "x", name: "陈旧", meter: 4, bars: [[{ t: 192 }]] }] }),
    { "beatsight.state": JSON.stringify({ v: 3, bpm: 200 }) }));
  ok(half.storage.has("beatsight.m2"), "★ 半迁移状态（热键在、冷键缺）→ 不动旧键（不猜、不删）");
  ok(!!half.beat.Store && !!half.beat.Controls, "且应用照常加载（半迁移不是错误态，是可重试的中间态）");
}

/* ================= 场景 T91c：老全量数据包（带已删的「练习记录」一类） ================= */
section("T91c 迁移矩阵 · 老数据包带 log（练习记录）→ 静默忽略，其余四类照进");
{
  /* ★ 这是一份**老版本导出**的包：字段名与形状都按当时来（歌词段叫 `lines`、
     块引用是 `{type:"builtin", idx:0}`），并且带着 v2.10.12 已删的 `log` 一类。
     拿"当前形状"造包是测不出迁移的——老包长得跟现在不一样，这正是要覆盖的东西。 */
  const pack = JSON.stringify({
    app: "beatsight", kind: "all", v: 1, version: "2.8.8",
    presets: [{ name: "包里的型", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }],
    arranges: [{ id: "a-old-1", name: "包里的曲式",
      sections: [{ name: "主歌", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 2 }] }] }],
    lines: [{ arrangeId: "a-old-1", sec: 0, chars: [{ t: 0, dur: 24, ch: "回" }] }],
    log: [{ t: 1700000000000, sec: 300, bpm: 96, name: "民谣扫弦" }],   // ← v2.10.12 已删的一类
    ear: { total: 10, right: 8, best: 5 },
  });
  const { beat, els } = loadApp();
  const res = beat.Store.importAll(pack);
  eq(res.ok, true, "★ 带已删字段的**老包**仍然可以导入（不为一条废弃字段把整包判为格式不对）");
  eq(res.added.presets, 1, "预设照进");
  eq(res.added.arranges, 1, "曲式照进");
  eq(res.added.lyrics, 1, "歌词照进");
  eq(res.added.ear > 0, true, "听辨战绩照进（合并了 " + res.added.ear + " 项）");
  ok(!("log" in res.added), "★ added 里没有 log 字段（这一类已随练习统计删除）");

  /* ★★ 本轮修的真 bug：弹窗此前会显示「练习记录 undefined 场」——`added` 里早就没有
     `log` 字段了，弹窗却还在读它。这里走**真实导入路径**（不是直接调 Store），
     断言的是用户真正会看到的那句话。
     ★ 注意：不能断言"整个 index.html 里没有『练习记录』四个字"——CHANGELOG 与
       v2.10.12 的删除注释里**理应**留着它（那是史实），要盯的是**用户可见文案**。 */
  const app2 = loadApp();
  app2.setFileText(pack);
  app2.els["importAllFile"].fire("change", { target: { files: [{ size: 100 }], value: "" } });
  const said = String(app2.els["modalMsg"].textContent || "");
  ok(/已导入/.test(said), "走真实导入路径成功（实际：" + said.slice(0, 80) + "）");
  ok(!/练习记录/.test(said), "★★ 用户看到的弹窗里不再提「练习记录」");
  ok(!/undefined/.test(said), "★★ 且不含 undefined（修之前这里会显示「练习记录 undefined 场」）");
  ok(/听辨战绩/.test(said), "改成说「听辨战绩已按更高值更新」：" + said.slice(0, 80));

  /* 再导出：log 不会环回外泄 */
  const re = JSON.parse(beat.Store.serializeAll());
  ok(!("log" in re), "★ 再导出的数据包里没有 log（已删的一类不会随导出环回）");
}

/* ================= 场景 T91d：arrangeSel 段下标 → 线性小节（两阶段） ================= */
section("T91d 迁移矩阵 · 播放范围「段下标 → 小节区间」的两阶段迁移");
{
  /* 三段曲式，每段 1 块 × 1 遍 × 内置型 0（4 小节）= 4 小节 → 全曲 12 小节（线性号 0..11）。
     ★ 块引用必须是 `{type:"builtin", idx:0}`：写成 `{name:"民谣扫弦"}` 是**当前**的另一种形状，
       而老存档里的引用长什么样，恰恰是本组要复刻的东西（参照 t51f 的 mk）。 */
  const mkArr = id => ({ id, name: id, sections: Array.from({ length: 3 }, () => ({ name: "s",
    blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] })) });
  const seedArr = { "beatsight.arranges": JSON.stringify({ v: 1, arranges: [mkArr("a1")] }) };
  const old = loadApp(Object.assign(seedState({ v: 3, playMode: "arrange", arrangeSel: { id: "a1", from: 1, to: 2 } }),
    seedArr));
  /* 装配层已在 patLenOf 注入之后跑过换算，所以这里读到的是**小节**区间 */
  const sel = old.beat.Store.S.arrangeSel;
  eq(sel.from, 4, "★ 旧口径段下标 1 → 迁移为该段起点小节 4");
  eq(sel.to, 11, "★ 段下标 2 → 迁移为该段末小节 11（0 基全曲 12 小节）");
  /* ★ 只发生一次：取走即清空 */
  eq(old.beat.Store.takeArrangeMig(), null, "★ takeArrangeMig 取过一次即为 null（迁移不是每次都重跑）");

  /* 带 v 的新值（已是小节口径）不该被再换算一次——否则会二次偏移 */
  const now = loadApp(Object.assign(seedState({ v: 3, playMode: "arrange", arrangeSel: { id: "a1", from: 4, to: 11, v: 2 } }),
    seedArr));
  eq(now.beat.Store.S.arrangeSel.from, 4, "★ 带 v:2 的小节区间**不再**被换算（幂等，不会被二次偏移）");
  eq(now.beat.Store.S.arrangeSel.to, 11, "to 同样原样");
}

/* ================= 场景 T91e：脏值矩阵（一批字段同时脏，不许崩） ================= */
section("T91e 迁移矩阵 · 脏值矩阵：一批字段同时脏也要照常加载");
{
  const dirty = {
    v: 3, bpm: "abc", sig: null, swing: {}, vol: -1, mute: "yes",
    trainer: { on: "1", target: null, step: -5, everyN: "x" },
    loopRange: { on: 1, from: 99, to: -99 },
    arrangeSel: "junk", sel: 42, timbre: 999, countIn: {}, plan: { junk: 1 },
  };
  const app = loadApp(seedState(dirty));
  const S = app.beat.Store.S;
  ok(!!S && !!app.beat.Controls, "★ 整包脏值 → 应用照常加载（不白屏）");
  eq(app.beat.diag.winErr, 0, "且没有脚本错误");
  ok(S.bpm >= 30 && S.bpm <= 240, "bpm 脏 → 钳回合法域：" + S.bpm);
  ok(S.trainer.step >= 1, "step 脏 → 钳回合法域：" + S.trainer.step);
  ok(S.trainer.everyN >= 1, "everyN 脏 → 钳回合法域：" + S.trainer.everyN);
  ok(!("plan" in S.trainer), "★ 老的 plan 字段即使出现在脏包里也不进状态");
  ok(S.loopRange.from <= S.loopRange.to, "★ 循环区间脏 → 仍保证 from ≤ to（空区间会让调度器死循环）");

  /* 壁纸那一键脏了，不该影响别的（它是独立的冷键）。★ v2.13.0：坏了回**出厂默认图**——
     "读不懂的偏好"应当落回出厂状态，而不是落回"什么都没有"那个只有用户点过「移除」才该有的态 */
  const both = loadApp(Object.assign(seedState({ v: 3, bpm: 96 }),
    { "beatsight.wallpaper": "这不是 JSON" }));
  const wall = both.beat.wallState();
  ok(wall && wall.img === both.beat.WALL_DEFAULT,
    "★ 壁纸键坏了 → 回出厂默认图（不弹窗，视觉偏好不值得惊动用户）");
  eq(wall.dim, both.beat.WALL_DIM_DEF, "  遮罩回默认值");
  eq(both.beat.Store.S.bpm, 96, "且不影响热键的正常读取");
  ok(!!both.beat.Store && !!both.beat.Controls, "后续模块照常装配");
}

/* ================= 场景 T91f：老存档 → 新版再存 → 再读（往返一致） ================= */
section("T91f 迁移矩阵 · 往返：老存档读进来 → 再存一次 → 形状已经是新的");
{
  const { beat, storage } = loadApp(seedM2({
    v: 3, bpm: 111,
    trainer: { on: true, start: 70, target: 120, step: 5, everyN: 2, last: { day: 3 } },
    customs: [{ id: "r1", name: "老型", meter: 4, bars: [[{ t: 192 }]] }],
  }));
  beat.Store.flush();
  const hot = JSON.parse(String(storage.get("beatsight.state")));
  eq(hot.v, 3, "写回的热键是 v3");
  eq(Object.keys(hot.trainer).sort().join(","), "everyN,on,step,target",
    "★★ 写回的 trainer 只剩四个键——**老字段不会跟着再写一遍**（迁移是单向的，不反弹）");
  ok(!/start|last|plan/.test(JSON.stringify(hot)), "热键里再搜不到 start / last / plan");

  /* 再读一次（模拟用户下次打开）：这次走的是**新键**路径，结论必须一致 */
  const again = loadApp({ "beatsight.state": String(storage.get("beatsight.state")),
    "beatsight.customs": String(storage.get("beatsight.customs")) });
  eq(Object.keys(again.beat.Store.S.trainer).sort().join(","), "everyN,on,step,target",
    "再读一次 → 仍是四个键（往返一致，不会越迁越多）");
  eq(again.beat.Store.S.bpm, 111, "bpm 仍是 111（迁移只发生一次，值不漂）");
}

/* ================= 场景 T91g：歌词冷键 v:1（段下标）→ v:2（段 uid）（v2.26.0） ================= */
section("T91g 迁移矩阵 · 歌词行寻址键：段下标 → 段 uid（老存档读到新版）");
{
  /* 老存档：曲式没有 uid 字段（v2.25.x 及更早），歌词行按 sec 下标寻址 */
  const legacyArr = { v: 1, arranges: [
    { id: "old-1", name: "老曲式", sections: [
      { name: "主歌", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1 }] },
      { name: "副歌", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 2 }] },
    ] },
  ]};
  const legacyLyr = { v: 1, lines: [
    { arrangeId: "old-1", sec: 0, chars: [{ t: 0, dur: 24, ch: "春" }] },
    { arrangeId: "old-1", sec: 1, chars: [{ t: 0, dur: 24, ch: "秋" }] },
  ]};
  const cap = captureWarn();
  const { beat, storage } = loadApp({ "beatsight.arranges": JSON.stringify(legacyArr),
    "beatsight.lyrics": JSON.stringify(legacyLyr) });
  cap.restore();

  const a = beat.Store.findArrange("old-1");
  eq(a.sections.length, 2, "老曲式照常读回（段本身没变）");
  ok(a.sections.every(s => typeof s.uid === "string" && s.uid),
    "★ 老曲式的段被补发了 uid（v2.26.0 起段必带身份）");
  eq(beat.Store.lyrics.length, 2, "★ 两行老歌词都迁进来了（没有被当成坏行整批丢掉）");
  eq(beat.Store.lyrics.filter(l => l.secUid === a.sections[0].uid)[0].chars[0].ch, "春",
    "★ sec:0 的那行落到了第 1 段的 uid 上");
  eq(beat.Store.lyrics.filter(l => l.secUid === a.sections[1].uid)[0].chars[0].ch, "秋",
    "sec:1 的那行落到第 2 段");
  ok(beat.Store.lyrics.every(l => !("sec" in l)), "★ 内存里不再有旧字段 sec");
  ok(!cap.list.some(s => s.includes("歌词行未通过结构校验")),
    "★ 迁移不靠「丢弃」过关（老用户打开不该看到歌词没了）");

  /* 老数据的往返：改一次触发落盘 → 冷键升 v:2，再读一次仍一致 */
  beat.Store.upsertLyric("old-1", a.sections[0].uid, [{ t: 0, dur: 24, ch: "夏" }]);
  const disk = JSON.parse(String(storage.get("beatsight.lyrics")));
  eq(disk.v, 2, "★ 触发落盘后冷键升到 v:2");
  const again = loadApp({ "beatsight.arranges": String(storage.get("beatsight.arranges")),
    "beatsight.lyrics": String(storage.get("beatsight.lyrics")) });
  eq(again.beat.Store.lyrics.length, 2, "再读一次：两行都在（迁移只发生一次）");
  eq(again.beat.Store.lyrics.filter(l => l.secUid === a.sections[0].uid)[0].chars[0].ch, "夏",
    "★ 往返一致：改过的字留住了，且仍挂在第 1 段");
}
