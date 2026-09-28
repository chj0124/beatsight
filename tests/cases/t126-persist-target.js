/* BeatSight 自动化测试 · 持久化目标一致性（v2.54.1）
   T126 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★★ 为什么要有这一组：v2.54.1 修的真缺陷是 Store.renameArrange 误调 persistCold()
      —— 曲式住在 beatsight.arranges，落盘却写进了只装预设的 beatsight.customs，
      表现是「改名看着成功了、刷新回退原名」。而当时 4,022 条断言与 98.2% 覆盖率**全绿**：
      既有 t116a 只断言内存数组，没有检查"写进了哪个键"。

   ★ 本组只盯一件事（覆盖率防不住、它防得住）：**改了哪个数组，就要写那个数组对应的键**。
      每条写路径做「三连」：
        ① 内存值       —— 内存改到了（这条原本就有，光有它会假绿）
        ② 对应冷键     —— 真的写进了正确的 localStorage 键（护栏）
        ③ 按同一份存档重载 —— 用户视角的终审：刷新还在
      另配一条反证（关键路径上"没写进别人的键"），防"改对了一半但顺手污染别的键"。

   ★ 新增任何 Store 写路径（rename* / group* / upsert* / delete*）都请在这里补一条三连。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const KEY = {
  customs: "beatsight.customs",
  arranges: "beatsight.arranges",
  lyrics: "beatsight.lyrics",
  bnames: "beatsight.builtinNames",
  groups: "beatsight.groups",
};
/* 把桩的存储倒成一份"下次开机看到的存档"（t97 同款手法） */
const dump = storage => { const o = {}; storage.forEach((v, k) => { o[k] = v; }); return o; };
const has = (storage, key, text) => String(storage.get(key) || "").indexOf(text) >= 0;
const newArrange = (beat, name) => beat.Store.upsertArrange({ name, sections: [
  { name: "A", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] },
] });

/* ================= 场景 T126a：曲式改名 → beatsight.arranges（v2.54.1 修的那条） ================= */
section("T126a 曲式改名 · 三连：内存 → beatsight.arranges → 重载（+ 不写进预设键）");
{
  const { beat, storage } = loadApp();
  const a = newArrange(beat, "原名");
  eq(beat.Store.renameArrange(a.id, "新名"), true, "改名返回 true");
  eq(beat.Store.findArrange(a.id).name, "新名", "① 内存已改");
  ok(has(storage, KEY.arranges, "新名"), "② 写进了曲式冷键 beatsight.arranges");
  ok(!has(storage, KEY.customs, "新名"), "② 反证：没被误写进预设冷键 beatsight.customs");
  const re = loadApp(dump(storage));
  eq(re.beat.Store.findArrange(a.id).name, "新名", "③ 重载后仍是新名（刷新不回退）");
}

/* ================= 场景 T126b：自定义型改名 → beatsight.customs ================= */
section("T126b 自定义型改名 · 三连：内存 → beatsight.customs → 重载");
{
  const { beat, storage } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "旧型", meter: 4, bars: [Array.from({ length: 4 }, () => ({ t: 48 }))] },
  ] })).ok, "导入一个自定义型");
  const c = beat.Store.customs[beat.Store.customs.length - 1];
  eq(beat.Store.renameCustom(c.id, "新型"), true, "改名返回 true");
  eq(beat.Store.customs.find(x => x.id === c.id).name, "新型", "① 内存已改");
  ok(has(storage, KEY.customs, "新型"), "② 写进了预设冷键 beatsight.customs");
  const re = loadApp(dump(storage));
  eq(re.beat.Store.customs.find(x => x.id === c.id).name, "新型", "③ 重载后仍是新型");
}

/* ================= 场景 T126c：内置型改名 → beatsight.builtinNames ================= */
section("T126c 内置型改名 · 三连：内存 → beatsight.builtinNames → 重载");
{
  const { beat, storage } = loadApp();
  const idx = 1;
  eq(beat.Store.renameBuiltin(idx, "内置新名"), true, "改名返回 true");
  eq(beat.BUILTINS[idx].name, "内置新名", "① 内存已改（显示层读到的是覆盖值）");
  ok(has(storage, KEY.bnames, "内置新名"), "② 写进了覆盖冷键 beatsight.builtinNames");
  const re = loadApp(dump(storage));
  eq(re.beat.BUILTINS[idx].name, "内置新名", "③ 重载后仍生效");
}

/* ================= 场景 T126d：分组改名 → beatsight.groups ================= */
section("T126d 分组改名 · 三连：内存 → beatsight.groups → 重载");
{
  const { beat, storage } = loadApp();
  eq(beat.Store.groupCreate("beat", "旧组"), true, "建一个空组");
  const g = beat.Store.groups[beat.Store.groups.length - 1];
  eq(beat.Store.groupRename(g.id, "新组"), true, "改名返回 true");
  eq(beat.Store.groups.find(x => x.id === g.id).name, "新组", "① 内存已改");
  ok(has(storage, KEY.groups, "新组"), "② 写进了分组冷键 beatsight.groups");
  const re = loadApp(dump(storage));
  eq(re.beat.Store.groups.find(x => x.id === g.id).name, "新组", "③ 重载后仍是新组");
}

/* ================= 场景 T126e：歌词写入 → beatsight.lyrics ================= */
section("T126e 歌词写入 · 三连：内存 → beatsight.lyrics → 重载");
{
  const { beat, storage } = loadApp();
  const a = newArrange(beat, "带词的曲");
  const uid = a.sections[0].uid;
  beat.Store.upsertLyric(a.id, uid, [{ t: 0, dur: 24, ch: "春" }]);
  eq(beat.Store.findLyric(a.id, uid).chars[0].ch, "春", "① 内存已写");
  ok(has(storage, KEY.lyrics, "春"), "② 写进了歌词冷键 beatsight.lyrics");
  const re = loadApp(dump(storage));
  eq(re.beat.Store.findLyric(a.id, uid).chars[0].ch, "春", "③ 重载后仍在");
}
