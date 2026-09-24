/* BeatSight 自动化测试 · 「范围小节数 < 同屏行数」时的下一行落点（v2.10.8）
   T89 系列。
   ---------------------------------------------------------------------------
   来源（用户实报）：用侧栏「播放范围」滑块**只选 1 小节**，但同屏行数大于 1 时，
   小球在当前小节快结束时把"预备动画"画到了**下一小节的位置**（第 2 行）——
   而按播放范围，下一小节其实是**当前小节自己**（循环回卷），所以它该留在第 1 行。
   同理：选 2 小节而行数 > 2、选 3 小节而行数 > 3 也都这样。

   触发判据（本组的立论）：记 L = 范围小节数（`to - from + 1`）、W = 同屏行数
   （`S.vizRows`，值表 VIZ_ROW_COUNTS = [1,2,3,4]）。**只有 W > L 才出错**：
     · L=1 时 W∈{2,3,4}；L=2 时 W∈{3,4}；L=3 时 W=4；
     · L=4 永远出不了错（W 最大 4，凑不出 W > L）——这正好解释了用户为什么只提到 1/2/3。
   为什么 W ≤ L 是对的：范围末小节恰好落在窗口最后一行，`bar === vizBars - 1` → 走
   "有预告行就让给第 1 行"那条既有分支，绕回范围起点，看着是对的。

   根因：曲式模式下"下一行"是**位置式**算的（`min(W-1, bar+1)`，页末有预告则 0；
   `.next` 走 `loopNextBar` → `(bar+1)%W`），与"循环回卷"解耦。而排程侧
   `arrNextBar` 在 v2.10.7 已改为在线性小节号上步进、**正确实现了回卷**
   （越过范围末小节 → 回范围起点）。于是球用"**正确小节的音符**"画在了"**错误的行**"上：
   `cand`（取音符用的内容下标）来自节目单、是对的，`rowNext` 却是位置式推的。
   → 范围短于窗口时，范围末小节的下一小节是**范围起点**，它落在当前行或更前面的一行。

   本组钉住的契约（v2.10.8）：
     · 待命球与 `.next` 预告格**同口径**：都按"下一小节真正落在哪一行"算
       （`rowOfSongBar`：行号 = 小节号 − 窗口起点，按 songBars 取模，须落在 [0, W)）；
     · 算不出（需翻页 / 范围播完）时**回落**既有口径 —— 故"向前翻页时球落到第 1 行"
       与"范围播完不循环"两条既有行为逐位不变；
     · W ≤ L 的对照组必须与修复前逐位一致（T89c）。

   ★ 元素引用每次现取：翻页会走 buildViz → 重建整棵树，缓存的 waitEl / cellEls
     从那一刻起指向被丢弃的节点（样式定格），断言会读到旧值（t75 踩过同一个坑）。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 与 t88 的 loadDemo 同一口径（harness 默认把"示例已出"的闩落上，要真载入示例曲
   必须显式 seedDemo:false）；rows 走 seed 而不是运行期赋值——改行数必须重建整棵树，
   走 seed 才能保证"网格与档位同源"的那条不变式在开播前就成立 */
const loadDemo = rows => loadApp(seedState({ sel: { type: "builtin", idx: 1 }, vizRows: rows }),
  { seedDemo: false });

/* 范围 [from, to] + 起播。用示例曲《在他乡》：段长 1/3/4/2/4/2/4/2/6/2，
   所以线性小节 0 = 段 0（单小节段），范围 [0,0] 就是用户实报的"只选第 1 小节"。
   240BPM 下一小节 1s，采样窗口取 5.2s 足够跑完 L ≤ 4 的两整轮 */
function startRange(from, to, rows){
  const { beat, els } = loadDemo(rows);
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from, to, loop: true, byLyric: false };
  beat.setMode("playMode", "arrange", "T89");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last };
}

/* 待命球画在第几行：它的 y = 该行顶部 − 20 − 一个抛物线高度（∈[0, bounce.max]）。
   桩里行距 86px 远大于 bounce.max（48px），所以各行的"向上 H 区间"互不重叠、行号唯一确定 */
function waitRow(iv, bounceMax){
  if (!iv.waitEl || iv.waitEl.style.display === "none") return null;
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(iv.waitEl.style.transform);
  if (!m) return "NOSHAPE";
  const y = parseFloat(m[2]);
  for (let r = 0; r < iv.rowGeo.length; r++){
    const base = iv.rowGeo[r].top - 20;
    if (y <= base + 1e-6 && y > base - bounceMax - 1e-6) return r;
  }
  return "OUT(" + y + ")";
}
/* 当前"正在播"的行（.current）与 `.next` 预告格所在的行/格 */
const curRowOf = iv => iv.rowEls.findIndex(r => /(^| )current( |$)/.test(r.className));
function nextCellOf(iv){
  for (let b = 0; b < iv.cellEls.length; b++)
    for (let i = 0; i < iv.cellEls[b].length; i++)
      if (/(^| )next( |$)/.test(iv.cellEls[b][i].className)) return { b, i };
  return null;
}
/* 逐帧采样：scheduler + paintFrame 双时钟同时跑（与真实浏览器同构）。
   返回 cur → 观察到的待命球行集合 / `.next` 跨界时落在的行集合，以及各行的可见帧数 */
function sample(beat, ac, seconds){
  const bounceMax = beat.CONFIG.bounce.max;
  const dt = 0.02, n = Math.ceil(seconds / dt);
  const waitAt = new Map(), nextAt = new Map(), seen = new Map(), hidden = new Map();
  for (let i = 0; i < n; i++){
    ac.currentTime += dt;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const iv = beat.Viz.internals();                 // ★ 每帧现取：翻页会重建节点
    const cur = curRowOf(iv);
    const wr = waitRow(iv, bounceMax);
    if (wr !== null){
      if (!waitAt.has(cur)) waitAt.set(cur, new Set());
      waitAt.get(cur).add(wr);
      seen.set(cur, (seen.get(cur) || 0) + 1);
    } else {
      hidden.set(cur, (hidden.get(cur) || 0) + 1);
    }
    /* ni === 0 ⟺ 预告格跨到了"下一行"（同一行内前进时 ni = active+1 ≥ 1） */
    const nc = nextCellOf(iv);
    if (nc && nc.i === 0){
      if (!nextAt.has(cur)) nextAt.set(cur, new Set());
      nextAt.get(cur).add(nc.b);
    }
  }
  const fmt = m => [...m.keys()].sort((a, b) => a - b)
    .map(k => k + "→" + [...m.get(k)].sort((a, b) => a - b).join("/")).join("  ");
  return { waitAt, nextAt, seen, hidden, waitStr: fmt(waitAt), nextStr: fmt(nextAt) };
}

/* ================= 场景 T89a：触发判据 W > L —— 待命球回到"下一小节真正所在的那一行" ================= */
section("T89a 范围短于窗口（W > L）· 待命球落在下一小节**真正**所在的那一行，不是位置式 +1");
{
  /* 表格覆盖全部 W > L 的组合 + W = L 的对照。期望值 = (cur+1) % L：
     from 恒为 0 ⇒ 第 x 小节的行号就是 x（窗口锚在 0），而"第 cur 行的下一小节"= (cur+1)%L，
     它在该页的行号也等于 (cur+1)%L —— 于是期望式与"范围/窗口"两组参数解耦，一眼可读 */
  const CASES = [
    { L: 1, W: 2, seconds: 2.2 }, { L: 1, W: 3, seconds: 2.2 }, { L: 1, W: 4, seconds: 2.2 },
    { L: 2, W: 3, seconds: 5.2 }, { L: 2, W: 4, seconds: 5.2 },
    { L: 3, W: 4, seconds: 5.2 },
    /* 对照：W = L。旧实现本来就是对的（范围末小节恰在窗口最后一行 → 走预告行那条分支），
       放进同一张表是为了让"修完仍然对"这件事也被机器盯着 */
    { L: 2, W: 2, seconds: 5.2 }, { L: 3, W: 3, seconds: 5.2 }, { L: 4, W: 4, seconds: 5.2 },
  ];
  for (const c of CASES){
    const tag = `L=${c.L} W=${c.W}`;
    const { beat, ac } = startRange(0, c.L - 1, c.W);
    const r = sample(beat, ac, c.seconds);
    /* 先证明断言不空：每一行都真的被观察到过（否则 Set 比对会在空集上"通过"） */
    const rowsSeen = [...r.seen.keys()].sort((a, b) => a - b);
    eq(rowsSeen.join(","), Array.from({ length: c.L }, (_, i) => i).join(","),
      `[${tag}] ★ 前提：范围里每一行都观察到过待命球（否则下面的比对是空断言）`);
    let bad = null;
    for (const [cur, set] of r.waitAt){
      for (const w of set){
        if (w !== (cur + 1) % c.L) bad = `第 ${cur + 1} 行（该行下一小节 = 第 ${(cur + 1) % c.L + 1} 小节）→ 球画在第 ${w + 1} 行`;
      }
    }
    eq(bad, null,
      `[${tag}] ★★ 待命球落在下一小节真正所在的那一行（实际 ${r.waitStr}）`);
    beat.Controls.stop();
  }
}

/* ================= 场景 T89b：`.next` 预告格同口径（同一根因的另一处症状） ================= */
section("T89b `.next` 预告格 · 与待命球同口径（v2.10.7 及更早两者都按位置式 +1，一起错）");
{
  for (const c of [{ L: 1, W: 4, seconds: 2.2 }, { L: 2, W: 4, seconds: 5.2 }, { L: 3, W: 4, seconds: 5.2 }]){
    const tag = `L=${c.L} W=${c.W}`;
    const { beat, ac } = startRange(0, c.L - 1, c.W);
    const r = sample(beat, ac, c.seconds);
    ok(r.nextAt.size > 0, `[${tag}] 前提：确实观察到过"预告格跨到下一行"（否则下面没得比）`);
    let bad = null;
    for (const [cur, set] of r.nextAt){
      for (const b of set){
        if (b !== (cur + 1) % c.L) bad = `第 ${cur + 1} 行 → 预告格亮在第 ${b + 1} 行`;
      }
    }
    eq(bad, null, `[${tag}] ★★ 预告格也落在下一小节真正所在的那一行（实际 ${r.nextStr}）`);
    /* 待命球与预告格必须**逐位一致**——两者是同一份口径的两个消费者，分叉就是 bug */
    eq(r.nextStr, r.waitStr, `[${tag}] ★ 待命球与预告格同口径（两处不会各说各话）`);
    beat.Controls.stop();
  }
}

/* ================= 场景 T89c：W ≤ L 与"整首"不回归 ================= */
section("T89c 对照 · W ≤ L 与整首连播的既有落点逐位不变（本修复不许动它们）");
{
  /* 整首 30 小节 + 4 行档：页末（第 4 行）的下一小节在下一页 → 球必须仍落在**第 1 行**
     （预告行那条既有分支），而不是被新逻辑算成别的行 */
  const whole = startRange(0, 29, 4);
  const rw = sample(whole.beat, whole.ac, 5.2);
  eq(rw.waitStr, "0→1  1→2  2→3  3→0",
    "★★ 整首 + 4 行档：页内照旧 +1，页末（第 4 行）翻页 → 落第 1 行（预告行那条分支未被改动）");
  whole.beat.Controls.stop();
  /* 往后的行（第 5 行起）属于下一页，窗口会翻 → 只断言"每行都对上台词表"，见 T89a 的对照表 */
  const l4 = startRange(0, 3, 4);
  const r4 = sample(l4.beat, l4.ac, 5.2);
  eq(r4.waitStr, "0→1  1→2  2→3  3→0",
    "★ L=4 W=4（W = L 的临界）：与整首逐位一致（范围末小节恰在末行 → 走翻页分支）");
  l4.beat.Controls.stop();
  /* 非 0 起点的范围：行号要按"范围起点落在窗口第几行"推，而不是写死 (cur+1)%L。
     ★ v2.16.0：页锚点改为**相对播放范围起点对齐**后，范围起点恒落在窗口第 1 行（行号 0）——
     于是范围 = 第 3–4 小节（from=2）+ 4 行档时，第 3 小节 = 行 0、第 4 小节 = 行 1，
     下一小节的行号就是 (cur+1)%L，与 T89a 的 from=0 那组同形。
     （修前窗口按歌曲绝对编号分页，第 3 小节落在行 2，故此处期望曾是 "2→3  3→2"。） */
  const mid = startRange(2, 3, 4);
  const rm = sample(mid.beat, mid.ac, 5.2);
  eq(rm.waitStr, "0→1  1→0",
    "★★ 范围不从第 1 小节开始时同样对（第 3 小节 → 第 2 行；第 4 小节回卷 → 第 1 行）");
  mid.beat.Controls.stop();
}

/* ================= 场景 T89d：走用户真实路径（拖侧栏滑块只选 1 小节） ================= */
section("T89d 端到端 · 用户实报路径：拖侧栏「播放范围」滑块选 1 小节 + 同屏 4 行");
{
  const { beat, els } = loadDemo(4);
  const box = els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
  ok(!!box, "前提：侧栏「自定义」区里有曲式分组（含播放范围滑块）");
  const range = box.children.find(x => /(^| )demo-range( |$)/.test(x.className));
  const track = range.children[1];
  const fromEl = track.children[1], toEl = track.children[2];
  /* 两个 thumb 拖到重合 = 只循环这一个小节（v2.10.7 小节口径）。必须同时发 input 与 change：
     只发 input 只刷视觉、不提交（T88d 钉过这条） */
  fromEl.value = "1"; toEl.value = "1";
  fromEl.fire("input"); toEl.fire("input");
  fromEl.fire("change"); toEl.fire("change");
  eq([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to].join(","), "0,0",
    "★ 滑块选中的就是第 1 小节（1-based 显示 → 0-based 0,0）");
  eq(beat.Store.S.playMode, "arrange", "拖滑块即进入曲式模式（与 T88b 同契约）");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const r = sample(beat, FakeAudioContext.last, 2.2);
  ok(r.seen.get(0) > 0, "前提：第 1 行期间确实观察到过待命球");
  eq([...r.waitAt.get(0) || []].join(","), "0",
    "★★ 用户实报场景：球留在**第 1 行**（当前小节自己那行），不再跑到第 2 行");
  eq([...r.nextAt.get(0) || []].join(","), "0",
    "★★ 预告格同样留在第 1 行");
  beat.Controls.stop();
}

/* ================= 场景 T89e：不循环的范围 —— 不许出现"假的回卷" ================= */
section("T89e 回落路径 · loop=OFF 时球照常逐行前进、范围播完即隐藏（回卷只该发生在真回卷时）");
{
  /* loop=false + 范围 [0,2]（4 行档）：
       第 1 小节 → 球在第 2 行；第 2 小节 → 第 3 行；第 3 小节（范围末）→ 没有"下一小节"，球隐藏。
     ★ 这条同时是"修复没有把回卷无差别地引到所有场景上"的守卫：回卷只该发生在
       arrNextBar 真的回卷时（loop 开着），不是无条件的。
     ★ 不写成"范围 [0,0] + 不循环"：那种组合下第 1 小节就是范围末小节，
       cand 会落到型外、球一帧都不画 —— 断言会在空集上"通过"，是假绿（已实测踩过）。 */
  const { beat } = loadDemo(4);
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 2, loop: false };
  beat.setMode("playMode", "arrange", "T89e");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;                          // ★ 必须在 start() 之后取
  const r = sample(beat, ac, 5.2);
  eq([...(r.waitAt.get(0) || [])].join(","), "1",
    "★ 第 1 小节 → 球在第 2 行（不循环时照常顺序前进）");
  eq([...(r.waitAt.get(1) || [])].join(","), "2",
    "★ 第 2 小节 → 球在第 3 行");
  ok(!r.waitAt.has(2), "★★ 范围末小节（第 3 小节）没有再下一小节 → 球不画（回落到既有的隐藏路径）");
  ok((r.hidden.get(2) || 0) > 0,
    "★ 且第 3 小节确实被观察到过（不是「整段没跑到」造成的空断言）");
  ok(beat.Store.S.playing === false, "范围播完且不循环 → 播放已停止");
  /* 曲式被删：arrangeCur() 变 null → 新逻辑返回 -1，一路静默回落 */
  beat.Store.deleteArrange(beat.DEMO_ID);
  const t = (() => { try{ beat.Viz.paintFrame(); return null; }catch(e){ return e.message; } })();
  eq(t, null, "★ 曲式已不在库里时继续驱动不抛（守卫与既有口径一致）");
}

/* ================= 场景 T89f：回卷落点边界（v2.16.0 页锚点对齐后复检） ================= */
section("T89f 边界 · 范围内回卷的球行落点（v2.16.0 页锚点相对播放范围对齐后复检）");
{
  /* v2.10.8 当时把这一类标为"已知边界"：窗口按**歌曲绝对编号**分页，而播放范围可落在任意小节上，
     于是"范围起点 / 范围末小节落在页第几行"会随歌曲位置漂移，跨页回卷那一档未覆盖。
     v2.16.0 把页锚点改成**相对播放范围起点对齐**后，第一页恒从范围起点开始 ——
     本构造（4 行档 + 范围第 4–5 小节，0-based [3,4]）的两个小节现在稳定落在第 0/1 行，
     回卷属于"同一页内"那一档，落点 = 预告行（第 1 行）。
     ★ 范围**长于行数**时仍可能有"往回翻页"的回卷（范围末小节在第 k 页、范围起点在第 1 页），
       那一档现在由预告行机制兜住（预告行内容 = 回卷目标），不在本场景断言之列。 */
  const { beat, ac } = startRange(3, 4, 4);
  const r = sample(beat, ac, 6.2);
  const at = new Map();
  for (const [cur, set] of r.waitAt){ if (cur === 0) at.set(cur, [...set].join(",")); }
  eq(at.get(0), "1",
    "★ 第 4 小节（窗口第 1 行）→ 下一小节（第 5 小节）落在第 2 行");
  /* 同一对范围里，范围末小节的回卷走预告行那条分支：球落到第 1 行 */
  eq([...(r.waitAt.get(1) || [])].join(","), "0",
    "★ 第 5 小节（范围末小节）回卷 → 第 4 小节落在第 1 行（预告行那条分支）");
  beat.Controls.stop();
}
