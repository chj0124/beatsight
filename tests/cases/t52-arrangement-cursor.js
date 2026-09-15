/* BeatSight 自动化测试 · 曲式节目单步进的三个纯函数（v2.0.0 S3）
   T52 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   这三个函数是**纯函数**（只吃传进来的曲式对象与范围），所以本组不用搭播放沙箱——
   loadApp 一次拿到函数引用即可，剩下的全是固定数据断言。

   最重要的一条：**arrNextBar 是唯一的一份步进逻辑**。scheduler（实际排程）与
   predictNext（弹跳球预测）都必须走它——两边各写一份的话，一旦在段/块边界不一致
   就会分叉，而分叉会同时打坏弹跳球、播放头、待命球交接，且极难复现。
   S4 会做这个接线，本组先把函数本身的语义钉死。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });

/* ================= 场景 T52：secBars（段长由数据派生） ================= */
section("T52 节目单步进 · secBars（段长 = Σ遍数 × 4，不存字段）");
{
  const { beat } = loadApp();
  const { secBars } = beat;
  eq(secBars({ blocks: [BL(0, 1)] }), 4, "1 块 × 1 遍 = 4 小节（(a) 型最小段）");
  eq(secBars({ blocks: [BL(0, 2)] }), 8, "1 块 × 2 遍 = 8 小节（(a) 型的主歌/副歌）");
  eq(secBars({ blocks: [BL(0, 1), BL(2, 1)] }), 8, "2 块 × 1 遍 = 8 小节（(b) 型：两个不同乐句）");
  eq(secBars({ blocks: [BL(0, 2), BL(2, 3)] }), 20, "2 块（2+3 遍）= 20 小节");
  eq(secBars({ blocks: [BL(0, 16), BL(1, 16)] }), 128, "两块各 16 遍 = 128 小节");
  /* 段长必须与 blocks 同步——它是**算出来**的，不是存下来的 */
  const sec = { blocks: [BL(0, 1)] };
  const before = secBars(sec);
  sec.blocks.push(BL(1, 1));
  eq(secBars(sec), before + 4, "★ 加了一块后段长立刻跟着变（没有「存下来的段长」会不同步）");
}

/* ================= 场景 T52b：blockAt（段内小节 → 块 + 块内小节） ================= */
section("T52b 节目单步进 · blockAt（块边界 / schedBar 回绕 / 越界）");
{
  const { beat } = loadApp();
  const { blockAt } = beat;

  /* (a) 型：1 块 × 2 遍 = 8 小节，型内的 4 小节循环要自然回绕两次 */
  const a = { blocks: [BL(0, 2)] };
  eq(blockAt(a, 0).blockIdx, 0, "第 0 小节在块 0");
  eq(blockAt(a, 3).localBar, 3, "第 3 小节的块内位置 = 3");
  eq(blockAt(a, 3).schedBar, 3, "第 3 小节 → 型内游标 3");
  eq(blockAt(a, 4).localBar, 4, "第 4 小节仍在块 0（块内位置 4）");
  eq(blockAt(a, 4).schedBar, 0, "★ 第 4 小节 → 型内游标回到 0（同型重复，循环回绕）");
  eq(blockAt(a, 7).schedBar, 3, "第 7 小节 → 型内游标 3（第二遍的最后一小节）");
  const seen = [0,1,2,3,4,5,6,7].map(b => blockAt(a, b).schedBar);
  eq(JSON.stringify(seen), JSON.stringify([0,1,2,3,0,1,2,3]),
     "8 小节的 schedBar 序列 = 0,1,2,3,0,1,2,3（严格在 0..3 内）");

  /* (b) 型：2 块 × 1 遍 = 8 小节，第 5 小节起换块 */
  const b = { blocks: [BL(0, 1), BL(2, 1)] };
  eq(blockAt(b, 0).blockIdx, 0, "第 0 小节在块 0");
  eq(blockAt(b, 3).blockIdx, 0, "第 3 小节仍在块 0");
  eq(blockAt(b, 4).blockIdx, 1, "★ 第 4 小节换到块 1（(b) 型的第二个乐句）");
  eq(blockAt(b, 4).localBar, 0, "换块时块内位置归零");
  eq(blockAt(b, 4).schedBar, 0, "换块时型内游标也归零（新块从它自己的第 0 小节开始）");
  eq(blockAt(b, 7).blockIdx, 1, "第 7 小节仍在块 1");
  eq(blockAt(b, 4).ref.idx, 2, "换块后拿到的是新块的 ref（不是沿用块 0）");

  /* ★ 两个块**遍数不同**时，块边界必须按"累加"算而不是"每 4 小节一换"。
     [2 遍, 1 遍]：第 0–7 小节在块 0，第 8 小节才换块 1。
     若按 bar/4 算，第 4 小节就会被误判进块 1 —— 但遍数相同的段（上面那个 b）
     两种算法结果一样，测不出差别，所以这条**必须用不同遍数的块** */
  const c = { blocks: [BL(0, 2), BL(2, 1)] };
  eq(blockAt(c, 7).blockIdx, 0, "第 7 小节仍在块 0（块 0 有 2 遍 = 8 小节）");
  eq(blockAt(c, 7).schedBar, 3, "第 7 小节 → 块 0 第二遍的最后一小节（型内游标 3）");
  eq(blockAt(c, 8).blockIdx, 1, "★ 第 8 小节才换块 1（按累加算边界，不是每 4 小节换）");
  eq(blockAt(c, 8).localBar, 0, "换块时块内位置归零");

  /* 越界：**返回 null 而不是静默钳到最后一块**——那会把"游标跑飞"变成"播错内容" */
  eq(blockAt(b, 8), null, "bar = 段长（越界）→ null");
  eq(blockAt(b, 99), null, "bar 远超段长 → null");
  eq(blockAt(b, -1), null, "bar 为负 → null");
  eq(blockAt(null, 0), null, "段为 null → null");
  ok(blockAt(b, 0) !== blockAt(b, 4), "不同块返回不同结果（不是同一个对象被复用）");
}

/* ================= 场景 T52c：arrNextBar 的推进与边界 ================= */
section("T52c 节目单步进 · arrNextBar（段边界 / 块边界 / 范围 / 循环）");
{
  const { beat } = loadApp();
  const { arrNextBar, secBars } = beat;
  /* 3 段：4 / 8 / 8 小节，第 3 段是 (b) 型（两块，不同预设） */
  const a = { name: "T", sections: [
    { name: "前奏", blocks: [BL(0, 1)] },                 // 4 小节
    { name: "主歌", blocks: [BL(1, 2)] },                 // 8 小节（(a) 型）
    { name: "副歌", blocks: [BL(2, 1), BL(4, 1)] },       // 8 小节（(b) 型）
  ] };
  const R = { from: 0, to: 2, loop: false };
  /* 步进结果一律兜空对象：变异后 arrNextBar 可能返回 null（走到越界位置），
     直接读 .sec 会让**整套测试崩溃**而不是给出具名失败（反向验证 V4/V5 踩到过）。
     兜底里的 blockChanged/sectionChanged 故意取 true：null 表示"该停了"，
     把它当成"位置 -1"时这两个标志取 true 才能让"推进/换段"类断言一起变红 */
  const nx = (...args) => arrNextBar(...args) || { sec: -1, bar: -1, blockIdx: -1,
    localBar: -1, schedBar: -1, blockChanged: true, sectionChanged: true };

  /* 起点：bar < 0 → 返回范围首段的第 0 小节 */
  const s0 = nx(a, R, 0, -1);
  eq(JSON.stringify([s0.sec, s0.bar, s0.localBar, s0.schedBar]), JSON.stringify([0, 0, 0, 0]),
     "未开始（bar<0）→ 落到首段第 0 小节");
  eq(s0.sectionChanged, true, "起点算作「进入新段」（调用方据此初始化显示）");
  ok(s0.pattern && s0.pattern.name === beat.BUILTINS[0].name, "起点就带出解析后的节奏型对象");

  /* 段内推进 */
  const s1 = nx(a, R, 0, 0);
  eq(JSON.stringify([s1.sec, s1.bar]), JSON.stringify([0, 1]), "段内 +1 小节");
  eq(s1.sectionChanged, false, "段内推进不标 sectionChanged");
  eq(s1.blockChanged, false, "同一块内不标 blockChanged");

  /* 段边界：第 1 段第 3 小节（末）→ 第 2 段第 0 小节 */
  const edge = nx(a, R, 0, 3);
  eq(JSON.stringify([edge.sec, edge.bar, edge.localBar]), JSON.stringify([1, 0, 0]),
     "★ 第 1 段走完 → 第 2 段第 0 小节（小节边界换段）");
  eq(edge.sectionChanged, true, "跨段被标出来");
  eq(edge.blockChanged, true, "跨段也换块 → 需要挂起切换");

  /* 第 2 段是 (a) 型（1 块 × 2 遍）：走完 8 小节才换行，中间不换块 */
  eq(nx(a, R, 1, 3).blockChanged, false, "★ (a) 型段内跨「遍」不换块（同一预设连着放）");
  eq(nx(a, R, 1, 3).sectionChanged, false, "(a) 型段内跨遍也不换段");
  eq(JSON.stringify([nx(a, R, 1, 3).sec, nx(a, R, 1, 3).bar]), JSON.stringify([1, 4]),
     "(a) 型段内继续推进小节");
  const edge2 = nx(a, R, 1, 7);
  eq(JSON.stringify([edge2.sec, edge2.bar]), JSON.stringify([2, 0]), "第 2 段走完 8 小节 → 第 3 段");

  /* 第 3 段是 (b) 型：第 4 小节跨块 → blockChanged（但不换段） */
  const bc = nx(a, R, 2, 3);
  eq(JSON.stringify([bc.sec, bc.bar, bc.blockIdx]), JSON.stringify([2, 4, 1]),
     "★ (b) 型段内第 4 小节换到块 1");
  eq(bc.blockChanged, true, "(b) 型跨块 → 需要挂起切换");
  eq(bc.sectionChanged, false, "但没换段（不是 sectionChanged）");

  /* 末尾：不循环 → null */
  /* 期望 null 的断言**必须走 arrNextBar 原函数**：nx 会把 null 兜成对象，这类断言就永远成立不了 */
  eq(arrNextBar(a, R, 2, 7), null, "★ 走到范围末尾且不循环 → null（调用方应停止播放）");

  /* 循环 → 回到 from */
  const RL = { from: 0, to: 2, loop: true };
  const wrap = nx(a, RL, 2, 7);
  eq(JSON.stringify([wrap.sec, wrap.bar]), JSON.stringify([0, 0]), "循环 → 回到范围起点（第 0 段第 0 小节）");
  eq(wrap.sectionChanged, true, "回绕也算换段");

  /* 单段循环（from === to）：这正是"只练副歌" */
  const ONE = { from: 1, to: 1, loop: true };
  eq(JSON.stringify([nx(a, ONE, 1, 7).sec, nx(a, ONE, 1, 7).bar]), JSON.stringify([1, 0]),
     "★ 单段循环：第 1 段走完回到它自己的第 0 小节（只练主歌）");
  eq(arrNextBar(a, { from: 1, to: 1, loop: false }, 1, 7), null, "单段不循环 → 走完即停");

  /* 范围越界时钳制（S.arrangeSel 加载时已钳过一次，这里是第二道） */
  eq(arrNextBar(a, { from: 0, to: 99, loop: false }, 2, 7), null, "to 超段数 → 钳到末段，仍会在末段末尾停");
  /* ★ to 超段数且**循环**：不钳制 to 就会走进不存在的第 3 段 → 返回 null（本该回绕），
     于是"只练副歌"会莫名其妙地停在半路。这条才是能分出"钳制与否"的用例——
     上面那条 loop:false 的两种实现都返回 null，测不出差别（反向验证 V11 踩到过） */
  eq(JSON.stringify([nx(a, { from: 0, to: 99, loop: true }, 2, 7).sec,
    nx(a, { from: 0, to: 99, loop: true }, 2, 7).bar]),
    JSON.stringify([0, 0]), "★ to 超段数且循环 → 仍回绕到范围起点（不是走进不存在的段后停住）");
  const back = nx(a, { from: 2, to: 2, loop: true }, 0, 0);
  eq(back.sec, 2, "★ 当前位置在范围之前 → 拉回 from（跳段后立刻生效，不会留在旧段）");
  eq(back.bar, 0, "拉回时小节归零");

  /* 完整走一遍：段/小节序列必须与段长一一对应（防"少一/多一"） */
  /* 这个循环**必须用 arrNextBar 原样判 null**（nx 会把它兜成对象 → 永不终止）。
     走完一遍的序列是对"每段小节数"的最强校验：少一/多一都会被它抓住 */
  const path = [];
  let cur = arrNextBar(a, R, 0, -1);
  /* 上界是必须的：不循环时 arrNextBar 必须能在末段末尾返回 null；若它永远不返回 null
     （比如把"末尾停止"改成了回绕），这个循环会挂死——挂死会让整条自验卡住，
     而这不是具名失败。加一个远大于预期长度的上界，把"无限回绕"变成一条断言。 */
  let guard = 0;
  while (cur && guard++ < 1000){ path.push(cur.sec + ":" + cur.bar); cur = arrNextBar(a, R, cur.sec, cur.bar); }
  ok(guard < 1000, "★ 不循环时能在末段末尾停下（不会无限回绕——上界被触发说明它没停）");
  eq(path.length, 4 + 8 + 8, "走完一遍共 20 小节（4+8+8）");
  eq(path[0], "0:0", "第一个是 0 段第 0 小节");
  eq(path[path.length - 1], "2:7", "最后一个是末段第 7 小节");
  const perSec = [0, 1, 2].map(s => path.filter(p => p.startsWith(s + ":")).length);
  eq(JSON.stringify(perSec), JSON.stringify([4, 8, 8]),
     "★ 每段的小节数与 secBars 一致（少一/多一都会被这条抓住）");
}

/* ================= 场景 T52d：blockChanged 比的是"解析后的型" ================= */
section("T52d 节目单步进 · blockChanged 比解析后的型（同型跨块不挂起）");
{
  const { beat } = loadApp();
  const { arrNextBar } = beat;
  /* 段内两个块引用**同一个**预设 → 跨块时 blockChanged 必须为 false
     （无型可换还重置 schedBar，画面会白跳一下，方案 R9） */
  const same = { name: "S", sections: [{ name: "s", blocks: [BL(3, 1), BL(3, 1)] }] };
  const cross = arrNextBar(same, { from: 0, to: 0, loop: false }, 0, 3);
  eq(cross.blockIdx, 1, "确实跨到块 1 了");
  eq(cross.blockChanged, false, "★ 但两个块是同一个预设 → 不标 blockChanged（不必挂起）");
  eq(cross.schedBar, 0, "块内位置仍归零（型内的 4 小节循环照常回到第 0 小节）");

  /* 不同预设 → true */
  const diff = { name: "D", sections: [{ name: "s", blocks: [BL(3, 1), BL(5, 1)] }] };
  eq(arrNextBar(diff, { from: 0, to: 0, loop: false }, 0, 3).blockChanged, true,
     "不同预设跨块 → blockChanged = true");

  /* 引用一个已被删掉的预设：pattern 为 undefined，但仍能给出位置（调用方回退） */
  const dead = { name: "X", sections: [{ name: "s", blocks: [{ ref: { type: "custom", id: "ghost" }, repeats: 1 }] }] };
  const d = arrNextBar(dead, { from: 0, to: 0, loop: false }, 0, -1);
  eq(JSON.stringify([d.sec, d.bar]), JSON.stringify([0, 0]), "引用失效仍能算出位置（不炸）");
  eq(d.pattern, undefined, "但 pattern 解析不到 → undefined（调用方据此回退）");
}

/* ================= 场景 T52e：坏数据不猜 ================= */
section("T52e 节目单步进 · 坏数据返回 null 而不是硬撑");
{
  const { beat } = loadApp();
  const { arrNextBar } = beat;
  eq(arrNextBar(null, { from: 0, to: 0, loop: true }, 0, -1), null, "曲式为 null → null");
  eq(arrNextBar({ sections: [] }, { from: 0, to: 0, loop: true }, 0, -1), null, "空曲式 → null");
  eq(arrNextBar({ sections: "x" }, { from: 0, to: 0, loop: true }, 0, -1), null, "sections 非数组 → null");
  /* 段长与 blocks 不一致（脏数据）时，blockAt 会返回 null → 这里也必须返回 null 而不是死循环 */
  eq(arrNextBar({ sections: [{ name: "s", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 0 }] }] },
     { from: 0, to: 0, loop: true }, 0, -1), null, "段长为 0（repeats=0）→ null（不会死循环）");
}
