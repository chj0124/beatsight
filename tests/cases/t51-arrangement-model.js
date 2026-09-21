/* BeatSight 自动化测试 · 曲式编排的数据模型（v2.0.0 S2）
   T51 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本组守两件事：
     ① **结构校验**在 Store（脏数据不该进内存）——段/块/遍数/上限/总小节数
     ② **解析校验**在共享区的 arrangeProblems（引用是否存在、拍号是否一致）——
        因为那要 resolveRef()，而它在 Store 之后。这条边界是刻意的，别混。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 引用与块都从 BUILTINS 下标取，不硬编码名字（内置库增删时名字会变、下标也不会移位得更少） */
const B = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const A = (name, sections) => ({ name, sections });
const SEC = (...blocks) => ({ name: "段", blocks });

/* ================= 场景 T51：结构校验（Store 侧，5 条） ================= */
section("T51 曲式模型 · 结构校验（脏结构不得进内存）");
{
  const { beat } = loadApp();
  const S = beat.Store;
  const good = A("测试曲式", [SEC(B(0, 1))]);
  ok(!!S.upsertArrange(good), "基准：最小合法曲式（1 段 1 块 1 遍）可保存");
  S.deleteArrange(S.arranges[0].id);
  eq(S.arranges.length, 0, "清理干净再逐条测（下面每条都从空库开始）");

  const bad = [
    [null, "null"],
    [{}, "缺 name/sections"],
    ["abc", "字符串"],
    [A("", [SEC(B(0, 1))]), "name 为空"],
    [A("   ", [SEC(B(0, 1))]), "name 只有空白"],
    [A("x", []), "sections 为空数组"],
    [A("x", "abc"), "sections 非数组"],
    [A("x", Array.from({ length: 25 }, () => SEC(B(0, 1)))), "25 段（超上限 24）"],
    [A("x", [{ name: "s", blocks: [] }]), "某段没有块"],
    [A("x", [{ name: "s", blocks: Array.from({ length: 9 }, () => B(0, 1)) }]), "9 块（超上限 8）"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 0 }] }]), "repeats = 0"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 17 }] }]), "repeats = 17（超上限 16）"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: "abc" }] }]), "repeats 非数字"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "weird", idx: 0 }, repeats: 1 }] }]), "ref.type 未知"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "builtin" }, repeats: 1 }] }]), "builtin 缺 idx"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "builtin", idx: -1 }, repeats: 1 }] }]), "builtin idx 为负"],
    [A("x", [{ name: "s", blocks: [{ ref: { type: "custom", id: "" }, repeats: 1 }] }]), "custom id 为空"],
    [A("x", [{ name: "s", blocks: [{ repeats: 1 }] }]), "块缺 ref"],
    [A("x", [{ name: "s", blocks: [null] }]), "块是 null"],
  ];
  const leaked = bad.filter(([v]) => S.upsertArrange(v) !== null).map(([, why]) => why);
  eq(leaked.length, 0, `18 种脏结构全部被拒（漏过的：${JSON.stringify(leaked)}）`);
  eq(S.arranges.length, 0, "被拒的结构一个都没进内存");

  /* 上限的**边界**：恰好 8 块 / 16 遍 要能过（差一个就该拒，上面已测）。
     注意这两个上限不能在同一条曲式里同时踩满——8 块 × 16 遍 × 4 小节 = 512 小节，
     早被总小节上限（256）拦下了。所以分开测。 */
  ok(S.upsertArrange(A("边界块", [SEC(...Array.from({ length: 8 }, () => B(0, 1)))])) !== null,
     "8 块（恰好在上限）可保存");
  S.arranges.length = 0;
  ok(S.upsertArrange(A("边界遍", [SEC(B(0, 16))])) !== null, "16 遍（恰好在上限）可保存");
  S.arranges.length = 0;

  /* 总小节数：16 段 × 4 块 × 1 遍 × 4 小节 = 256（恰好上限）→ 过；17 段 → 272 → 拒 */
  ok(S.upsertArrange(A("满上限", Array.from({ length: 16 }, () => SEC(...Array.from({ length: 4 }, () => B(0, 1)))))) !== null,
     "总 256 小节（恰好上限）可保存");
  S.arranges.length = 0;
  eq(S.upsertArrange(A("超长", Array.from({ length: 17 }, () => SEC(...Array.from({ length: 4 }, () => B(0, 1)))))), null,
     "总 272 小节（超上限 256）被拒");

  /* name 超长是**截断**而不是拒绝（与 presetNameInput 的 slice(0,40) 同口径） */
  const long = S.upsertArrange(A("字".repeat(60), [SEC(B(0, 1))]));
  eq(long.name.length, 40, "name 超长 → 截断到 40 字（不是拒绝）");
  /* repeats 小数是**取整**而不是拒绝（与 countIn.beats 的 Math.round 同口径） */
  S.arranges.length = 0;
  const r24 = S.upsertArrange(A("取整", [SEC({ ref: { type: "builtin", idx: 0 }, repeats: 2.4 })]));
  eq(r24.sections[0].blocks[0].repeats, 2, "repeats 2.4 → 取整为 2");
}

/* ================= 场景 T51b：字段白名单 ================= */
section("T51b 曲式模型 · 只留白名单字段（脏字段不得漏进内存）");
{
  const { beat } = loadApp();
  const S = beat.Store;
  const v = S.upsertArrange(A("白名单", [
    { name: "s", evil: 1, blocks: [{ ref: { type: "builtin", idx: 2, evil: 2 }, repeats: 1, evil: 3 }] },
  ]));
  eq(JSON.stringify(Object.keys(v).sort()), JSON.stringify(["id", "name", "sections"]),
     "曲式对象只留 id / name / sections");
  eq(v.sections[0].evil, undefined, "段级脏字段被剥掉");
  ok(!("evil" in v.sections[0].blocks[0]), "块级脏字段被剥掉");
  eq(JSON.stringify(v.sections[0].blocks[0].ref), JSON.stringify({ type: "builtin", idx: 2 }),
     "ref 只留 type / idx（不带上意外字段）");
}

/* ================= 场景 T51c：id 生成与 upsert 语义 ================= */
section("T51c 曲式模型 · id 生成 / 更新而非追加 / 删除");
{
  const { beat } = loadApp();
  const S = beat.Store;
  const a1 = S.upsertArrange(A("第一", [SEC(B(0, 1))]));
  const a2 = S.upsertArrange(A("第二", [SEC(B(0, 1))]));
  ok(/^a\d/.test(a1.id) && /^a\d/.test(a2.id), "无名曲式自动生成 id（a + 时间戳 + 序号）");
  ok(a1.id !== a2.id, "连续两次新建拿到不同 id（会话内单调序号防同毫秒撞号）");
  eq(S.arranges.length, 2, "两条都进了库");

  const upd = S.upsertArrange({ id: a1.id, name: "第一改", sections: [SEC(B(0, 2))] });
  eq(S.arranges.length, 2, "同 id 再存是**更新**而不是追加");
  eq(S.arranges.find(x => x.id === a1.id).name, "第一改", "内容被更新");
  eq(S.arranges.find(x => x.id === a1.id).sections[0].blocks[0].repeats, 2, "改后的遍数生效");
  eq(upd.id, a1.id, "返回的对象 id 不变");

  eq(S.findArrange(a1.id).name, "第一改", "findArrange 按 id 命中");
  eq(S.findArrange("nope"), null, "findArrange 找不到 → null（不是 undefined，这里刻意用 null）");
  eq(S.deleteArrange(a1.id), true, "删除返回 true");
  eq(S.deleteArrange(a1.id), false, "重复删除返回 false");
  eq(S.arranges.length, 1, "删完只剩一条");
  eq(S.findArrange(a1.id), null, "删掉之后查不到");
}

/* ================= 场景 T51d：加载与落盘 ================= */
section("T51d 曲式模型 · 冷键加载（坏条目丢弃）/ 落盘 / 写失败可见");
{
  const mk = (id, name) => ({ id, name, sections: [{ name: "s", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] }] });
  /* 数组里混好坏：只留好的，坏的不进内存也不炸 */
  const app = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    mk("ok1", "好的A"), { name: "缺 sections" }, mk("ok2", "好的B"),
    { name: "段超上限", sections: Array.from({ length: 25 }, () => ({ name: "s", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] })) },
    null,
  ]}) });
  eq(app.beat.Store.arranges.length, 2, "5 条里只有 2 条合法（坏条目丢弃，不炸）");
  /* 取名字时兜一层空对象：变异后库里可能混进原始脏条目，直接 x.name 会让**整套测试崩溃**
     而不是给出具名失败（反向验证 M13 踩到过） */
  eq(app.beat.Store.arranges.map(x => (x || {}).name).join(","), "好的A,好的B", "留下的是好的两条");
  eq(app.beat.Store.arranges[0].id, "ok1", "id 原样保留");

  /* 坏 JSON → 空库，不白屏 */
  const b2 = loadApp({ "beatsight.arranges": "not json{{" });
  eq(b2.beat.Store.arranges.length, 0, "坏 JSON → 曲式库为空（不白屏）");
  const b3 = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: "不是数组" }) });
  eq(b3.beat.Store.arranges.length, 0, "arranges 不是数组 → 空库");

  /* 落盘 → 重新加载能读回（round-trip） */
  const b4 = loadApp();
  const saved = b4.beat.Store.upsertArrange(A("往返", [SEC(B(0, 2), B(2, 1))]));
  ok(!!b4.storage.get("beatsight.arranges"), "upsert 后冷键已落盘");
  const b5 = loadApp({ "beatsight.arranges": b4.storage.get("beatsight.arranges") });
  eq(b5.beat.Store.arranges.length, 1, "重新加载读回 1 条");
  eq(JSON.stringify(b5.beat.Store.arranges[0]), JSON.stringify(saved),
     "★ 往返后逐字段一致（两块的段也完整保留）");

  /* 写失败要走既有的一次性提示（不静默） */
  const b6 = loadApp({}, { throwOnWrite: true });
  b6.beat.Store.upsertArrange(A("写失败", [SEC(B(0, 1))]));
  eq(b6.beat.Store.arranges.length, 1, "写盘失败不影响内存里的曲式（当场还能用）");
  ok(b6.els["brandChip"].textContent.includes("保存失败"), "写失败 → 顶栏 chip 明示");
  b6.els["modalOk"].fire("click");
}

/* ================= 场景 T51e：arrangeProblems（需要解析的两条） ================= */
section("T51e 曲式模型 · 引用存在性 / 拍号一致性（arrangeProblems）");
{
  const { beat } = loadApp();
  const P = beat.arrangeProblems;
  const BUILTINS = beat.BUILTINS;
  /* 找一个 6/8 的内置预设（拍号与默认 4/4 不同） */
  const idx68 = BUILTINS.findIndex(p => p.meter === 6);
  ok(idx68 >= 0, "内置库里存在 6/8 预设（拍号不一致的用例要用它）");

  eq(JSON.stringify(P(A("好", [SEC(B(0, 1)), SEC(B(1, 2))]))), "[]", "全 4/4 → 无问题");
  const p1 = P(A("缺块", [{ name: "s", blocks: [] }]));
  ok(p1.some(x => x.includes("第 1 段没有任何内容")), "空段被指出（实际 " + JSON.stringify(p1) + "）");
  const p2 = P(A("引用死了", [SEC({ ref: { type: "custom", id: "ghost" }, repeats: 1 })]));
  ok(p2.some(x => x.includes("不存在")), "引用不存在的预设被指出（实际 " + JSON.stringify(p2) + "）");
  const p3 = P(A("混拍号", [SEC(B(0, 1)), SEC(B(idx68, 1))]));
  ok(p3.some(x => x.includes("拍号不一致")), "4/4 与 6/8 混用被指出（实际 " + JSON.stringify(p3) + "）");
  ok(p3.some(x => x.includes("6/8")), "提示里报出具体的拍号名，而不是只说「不一致」");
  eq(JSON.stringify(P(null)), JSON.stringify(["曲式结构不完整"]), "结构不完整 → 单条提示");
  /* 自定义预设存在时应当通过（用真实导入的自定义预设，而不是内置） */
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "自定4", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }));
  const cid = beat.Store.customs[0].id;
  eq(JSON.stringify(P(A("用自定义", [SEC({ ref: { type: "custom", id: cid }, repeats: 1 })]))), "[]",
     "引用存在的自定义预设 → 无问题");
}

/* ================= 场景 T51f：S.playMode / S.arrangeSel 的加载与钳制 ================= */
section("T51f 曲式模型 · playMode / arrangeSel 热键字段（含越界钳制）");
{
  const mk = (id, secs) => ({ id, name: id, sections: Array.from({ length: secs }, () => ({ name: "s",
    blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] })) });
  const seed = JSON.stringify({ v: 1, arranges: [mk("a3", 3), mk("a1", 1)] });

  const d = loadApp({ "beatsight.arranges": seed }).beat.Store.S;
  eq(d.playMode, "preset", "默认播放模式是预设");
  eq(JSON.stringify(d.arrangeSel), JSON.stringify({ id: "", from: 0, to: 0, loop: false, byLyric: false }),
     "默认 arrangeSel 指向空曲式、范围 0–0、不循环");

  const dirty = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "xyz", arrangeSel: "abc" }) }).beat.Store.S;
  eq(dirty.playMode, "preset", "playMode 脏值 → 回退 preset");
  eq(JSON.stringify(dirty.arrangeSel), JSON.stringify({ id: "", from: 0, to: 0, loop: false, byLyric: false }),
     "arrangeSel 脏值 → 回退默认");

  /* id 不存在（曲式被删了）→ 整条选择作废、回退预设模式 */
  const dead = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "arrange", arrangeSel: { id: "nope", from: 1, to: 2, loop: true } }) }).beat.Store.S;
  eq(dead.playMode, "preset", "★ 选中的曲式不存在 → 回退预设模式（否则会停在一个不存在的曲式上）");
  eq(dead.arrangeSel.id, "", "id 一并清空");

  /* 存在 → 保留；from/to 钳制到该曲式的段范围（a3 有 3 段 → 合法下标 0..2） */
  const okv = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "arrange", arrangeSel: { id: "a3", from: 1, to: 1, loop: true } }) }).beat.Store.S;
  eq(okv.playMode, "arrange", "选中存在的曲式 → 进曲式模式");
  eq(JSON.stringify(okv.arrangeSel), JSON.stringify({ id: "a3", from: 1, to: 1, loop: true, byLyric: false }),
     "from/to/loop 原样保留");

  const clamp = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "arrange", arrangeSel: { id: "a3", from: 5, to: 9, loop: true } }) }).beat.Store.S;
  eq(clamp.arrangeSel.from, 2, "from 越界 → 钳到末段（段数 3 → 下标 2）");
  eq(clamp.arrangeSel.to, 2, "to 越界 → 一并钳到末段（且不小于 from）");

  const clamp2 = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "arrange", arrangeSel: { id: "a1", from: 1, to: 0, loop: false } }) }).beat.Store.S;
  eq(clamp2.arrangeSel.from, 0, "a1 只有 1 段 → from 钳到 0");
  eq(clamp2.arrangeSel.to, 0, "to 被抬到 ≥ from（不会出现 to < from 的空范围）");

  /* ★ to < from 必须被抬到 from。这条**必须在多段曲式上测**：单段曲式里末段下标就是 0，
     钳制与不钳制都得到 0，测不出区别（反向验证时踩到过）。
     用 3 段的 a3、from=2 to=0：无守卫会得到 to=0 → 范围 [2,0] 为空 → 范围循环直接跑飞 */
  const clamp3 = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "arrange", arrangeSel: { id: "a3", from: 2, to: 0, loop: true } }) }).beat.Store.S;
  eq(clamp3.arrangeSel.from, 2, "from 合法（2 < 3 段）→ 原样保留");
  eq(clamp3.arrangeSel.to, 2, "★ to < from → 抬到 from（无守卫会得到 0，范围变空）");

  /* 热键落盘：两个字段都要写进去 */
  const app = loadApp({ "beatsight.arranges": seed, "beatsight.state": JSON.stringify({ v: 3,
    playMode: "arrange", arrangeSel: { id: "a3", from: 1, to: 2, loop: true } }) });
  app.beat.Store.flush();
  const hot = JSON.parse(app.storage.get("beatsight.state"));
  eq(hot.playMode, "arrange", "热键带 playMode");
  eq(JSON.stringify(hot.arrangeSel), JSON.stringify({ id: "a3", from: 1, to: 2, loop: true, byLyric: false }),
     "热键带完整 arrangeSel");
  ok(app.storage.get("beatsight.state").length < 1024,
     "热键仍 < 1 KB（新增字段没有破坏冷热分离，实际 " + app.storage.get("beatsight.state").length + " 字节）");
}
