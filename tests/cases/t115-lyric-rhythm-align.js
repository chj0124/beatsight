/* BeatSight 自动化测试 · 歌词「按节奏对齐」+ 节奏参考层 + 键盘微调（v2.46.0）
   T115 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块 secOnsetTicks / alignLyricToRhythm 注释同源）：
     · 锚点 = 段内**发声音符起点**（逐块 × 遍数展开成段内绝对 tick）；
       空扫（rest+dir）不作落点（手在动嘴也不该唱，用户拍板）；
     · 纯节拍型（hasStrum 为假）退回**拍点**（同"无扫弦记谱的谱本身就是节拍器"，v2.9.0）；
     · 锚点先经 LYRIC_GRID 整除过滤——normLyricLine 会把 t 吸附到十六分格（v2.1.0 契约），
       三连音位对上去也会被吸附走样，故不列为对齐目标（参考层刻度仍如实画出全部起点）；
     · 一键对齐覆盖手动位置且歌词无撤销栈 → 必须经 Modal.uiConfirm（v0.4.6：原生 confirm
       在沙盒 iframe 被静默拦截，一律走应用内弹窗）；
     · 键盘微调每次击键直接落库，但**原位更新字块、不 arrangeRender**（焦点不能丢）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const rows = els => els["argSections"].children;
const lyOf = (els, i) => rows(els)[i].children.find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const findBtn = (ly, text) => ly.children.find(c => c.textContent === text);
const walk = (el, out) => { out.push(el); (el.children || []).forEach(c => walk(c, out)); return out; };
/* v2.80.0：lane 里混进了块头节奏型行（.arg-pat-row）——"第 N 小节那一行"必须**按类过滤**后取，
   lane.children[N] 这个写法在块头行插入后会把下标整体带偏（不是回归，是行容器的取法换了） */
const rowOf = (lane, i) => lane.children
  .filter(c => /(^| )arg-lyric-row( |$)/.test(c.className))[i];

/* 四个一平方块素材：S=带扫弦 / R=空扫开头 / P=纯节拍 / T=三连音开头 */
const P_S = [{ t:48, dir:"D" }, { t:24, dir:"U" }, { t:24, dir:"D" }, { t:48, dir:"U" }, { t:48 }];
const P_R = [{ t:48, rest:true, dir:"D" }, { t:48, dir:"D" }, { t:48 }, { t:48 }];
const P_P = [{ t:48 }, { t:48 }, { t:48 }, { t:48 }];
const P_T = [{ t:16 }, { t:16 }, { t:16 }, { t:48 }, { t:48 }, { t:48 }];

/* 建曲式：五段各测一个口径。返回 { beat, els, arr, id, sec(...) } */
function setup(){
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材S", meter: 4, bars: [P_S] },
    { name: "素材R", meter: 4, bars: [P_R] },
    { name: "素材P", meter: 4, bars: [P_P] },
    { name: "素材T", meter: 4, bars: [P_T] },
  ] })).ok, "四个一平方块素材导入成功");
  const [s, r, p, t] = beat.Store.customs.slice(-4).map(x => x.id);
  const BL = (id, reps) => ({ ref: { type: "custom", id }, repeats: reps });
  ok(beat.Store.upsertArrange({ name: "对齐曲式", sections: [
    { name: "S×2", blocks: [BL(s, 2)] },
    { name: "R",   blocks: [BL(r, 1)] },
    { name: "P",   blocks: [BL(p, 1)] },
    { name: "T",   blocks: [BL(t, 1)] },
    { name: "S+P", blocks: [BL(s, 1), BL(p, 1)] },
  ] }), "曲式通过结构校验");
  const arr = beat.Store.findArrange("对齐曲式") || beat.Store.arranges[beat.Store.arranges.length - 1];
  ok(!!arr && arr.sections.length === 5, "曲式已落库（5 段）");
  return { beat, els, arr, id: arr.id, sec: i => arr.sections[i] };
}

/* ================= 场景 T115a：锚点展开口径 ================= */
section("T115a secOnsetTicks · 实扫锚点 / 空扫排除 / 拍点回退 / 三连过滤 / 跨块展开");
{
  const { beat, arr, sec } = setup();
  const A = beat.Arrange;
  eq(JSON.stringify(A.secOnsetTicks(sec(0))),
     JSON.stringify([0,48,72,96,144, 192,240,264,288,336]),
     "S×2：型内锚点 0/48/72/96/144 逐遍展开（第二遍 +192）");
  eq(JSON.stringify(A.secOnsetTicks(sec(1))), JSON.stringify([48,96,144]),
     "★ 空扫（rest+dir）不作落点：小节首的空扫不在锚点里");
  eq(JSON.stringify(A.secOnsetTicks(sec(2))), JSON.stringify([0,48,96,144]),
     "★ 纯节拍型退回拍点（每拍一下，同 v2.9.0「谱本身即节拍器」口径）");
  eq(JSON.stringify(A.secOnsetTicks(sec(3))), JSON.stringify([0,48,96,144]),
     "★ 三连音位（16t/32t）被 LYRIC_GRID 整除过滤（吸附契约下对上去会走样）");
  const mixed = A.secOnsetTicks(sec(4));
  eq(mixed.length, 9, "跨块：S(1 小节 5 锚点) + P(1 小节 4 拍点) = 9 个锚点");
  eq(mixed[5], 192, "跨块：块 2（纯节拍）首拍 = 1 小节 × 192t = 192，紧接块 1 的 144");
  eq(mixed[8], 336, "跨块：块 2 末拍 = 192 + 144 = 336");
  void arr;
}

/* ================= 场景 T115b：一键对齐（数据层） ================= */
section("T115b alignLyricToRhythm · 逐字对锚点 / dur=到下一字 / 余字顺排越界即丢");
{
  const { beat, arr, sec } = setup();
  const A = beat.Arrange;
  const uid0 = sec(0).uid, uid2 = sec(2).uid;
  const text = "春眠不觉晓处处闻啼鸟";                        // 10 字 = S×2 段的 10 个锚点
  beat.Store.upsertLyric(arr.id, uid0, text.split("").map((ch, k) => ({ t: k * 24, dur: 24, ch })));
  const line = beat.Store.findLyric(arr.id, uid0);
  A.alignLyricToRhythm(arr, sec(0), line);
  const chars = beat.Store.findLyric(arr.id, uid0).chars;
  eq(chars.map(c => c.t).join(","), "0,48,72,96,144,192,240,264,288,336",
     "★ 第 k 字落在第 k 个发声锚点上（覆盖均分占位）");
  eq(chars.map(c => c.dur).join(","), "48,24,24,48,48,48,24,24,48,24",
     "dur = 到下一字的距离（末字基准八分），全在 [12, lyricMaxDur] 域内");
  eq(chars.map(c => c.ch).join(""), text, "字与顺序原样保留（只重排位置）");

  /* 余字顺排 + 越界即丢：纯节拍段 span=192、4 拍点；6 字 → 4 对齐 + 168 处 1 字 + 192 起丢弃 */
  beat.Store.upsertLyric(arr.id, uid2, "一二三四五六".split("").map((ch, k) => ({ t: k * 24, dur: 24, ch })));
  A.alignLyricToRhythm(arr, sec(2), beat.Store.findLyric(arr.id, uid2));
  const got = beat.Store.findLyric(arr.id, uid2).chars;
  eq(got.length, 5, "★ 4 个拍点 + 1 个余字（t=168）；t=192 起越出段长即丢（同 distribute 口径）");
  eq(got[4].t, 168, "余字自最后一个锚点按基准单位（24t）顺排");
  eq(got.map(c => c.ch).join(""), "一二三四五", "丢的是排不下的尾字，字序不乱");
}

/* ================= 场景 T115c：一键对齐（v2.52.0 V4：确认弹窗降级为 announce） =================
   v2.49.0 歌词有了撤销栈，「覆盖手动位置」不再需要弹窗硬挡——点击即对齐，
   announce 指路 Ctrl+Z；误触 = 一步撤销（原确认弹窗断言随语义退役，这不是回归）。 */
section("T115c 按节奏对齐 · 点击即生效 / announce 指路撤销 / 可撤销");
{
  const { beat, els, arr, sec } = setup();
  const uid0 = sec(0).uid;
  beat.Store.upsertLyric(arr.id, uid0, [{ t: 0, dur: 24, ch: "春" }, { t: 24, dur: 24, ch: "眠" },
    { t: 48, dur: 24, ch: "不" }, { t: 72, dur: 24, ch: "觉" }, { t: 96, dur: 24, ch: "晓" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);                 // 让我的曲式成为 arranges[0]（open 的默认选中）
  beat.Arrange.open();
  const ly = lyOf(els, 0);
  ok(!!ly, "段行的歌词区可定位");
  sumOf(ly).fire("click");                                // 展开（arrangeRender 重建，重新取）
  const ly2 = lyOf(els, 0);
  const aln = findBtn(ly2, "按节奏对齐");
  ok(!!aln, "展开态出现「按节奏对齐」按钮");
  aln.fire("click");
  eq(beat.Store.findLyric(arr.id, uid0).chars.map(c => c.t).join(","), "0,48,72,96,144",
     "★ 点击即对齐：5 字逐一对到 5 个锚点（V4：不再弹确认）");
  ok((els["srAnnounce"].textContent || "").indexOf("已对齐 5 字") === 0 &&
     (els["srAnnounce"].textContent || "").indexOf("Ctrl+Z") > 0,
     "★ announce 说清结果与撤销出路");
  ok(beat.Arrange.lyricUndo(arr.id, uid0) === true, "对齐可撤销（一步）");
  eq(beat.Store.findLyric(arr.id, uid0).chars.map(c => c.t).join(","), "0,24,48,72,96",
     "撤销 → 回到对齐前的手动位置");
  beat.Arrange.close();
}

/* ================= 场景 T115d：键盘微调（原位更新、焦点不丢） =================
   ★ 素材留空隙：均分 24t 满铺时 dur=24 顶死邻居（cap = next.t − dur = 自身 t），
     键盘/拖动都无路可走——那不是 bug，是「不吃邻居」边界公式的必然。 */
section("T115d 键盘 · ←/→ 一格 / Shift 一拍 / 邻居边界钳制 / 原位更新");
{
  const { beat, els, arr, sec } = setup();
  const uid0 = sec(0).uid;
  beat.Store.upsertLyric(arr.id, uid0,
    [{ t: 0, dur: 24, ch: "春" }, { t: 48, dur: 24, ch: "眠" }, { t: 96, dur: 24, ch: "觉" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  ok(!!lane, "展开态有字块轨");
  /* v2.77.0：行容器包 [和弦格][字块行]——字块行取行容器的 barrow 孩子；v2.80.0：行容器按类取 */
  const barrow0 = rowOf(lane, 0).children.find(c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
  const chips = barrow0.children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className));
  eq(chips.length, 3, "第一小节行：3 个字块");
  const chip1 = chips[1];                                  // 「眠」t=48，两侧有空隙
  chip1.fire("keydown", { key: "ArrowRight" });
  eq(beat.Store.findLyric(arr.id, uid0).chars[1].t, 54, "→ 移一格（+6t）并已落库");
  chip1.fire("keydown", { key: "ArrowRight", shiftKey: true });
  eq(beat.Store.findLyric(arr.id, uid0).chars[1].t, 72, "Shift+→ 请求 +48 但被上限钳住（后字 t − dur = 96−24 = 72）");
  chip1.fire("keydown", { key: "ArrowLeft", shiftKey: true });
  chip1.fire("keydown", { key: "ArrowLeft", shiftKey: true });
  eq(beat.Store.findLyric(arr.id, uid0).chars[1].t, 24, "← 两拍回到 24 后被钳住（下限 = 前字 t+dur = 24）");
  const leftPct = chip1.style.left;
  chip1.fire("keydown", { key: "ArrowLeft" });
  eq(chip1.style.left, leftPct, "★ 被钳住时不重绘不落库，字块原位样式不变（同一节点、焦点未丢）");
  chip1.fire("keydown", { key: "ArrowRight", shiftKey: true });
  eq(beat.Store.findLyric(arr.id, uid0).chars[1].t, 72, "Shift+→ 到 72（上限 = 后字 t − dur = 96−24）");
  chip1.fire("keydown", { key: "ArrowDown" });            // 无关键：不应产生任何变更
  eq(beat.Store.findLyric(arr.id, uid0).chars[1].t, 72, "非方向键不产生变更");
  beat.Arrange.close();
}

/* ================= 场景 T115e：节奏参考层（拍线 + 时值块轮廓） =================
   ★ v2.80.0（乙）断言口径改写，这不是回归：旧的 `.arg-lyric-onset` 起点圆点退役，
   换成**贴满的时值块轮廓**（.arg-lyric-note）——圆点只答"从哪起"，答不出"占多久"，
   而"字该对哪颗音"是宽度问题。起点信息由轮廓左缘承载，故：
     · 数量口径 5 → 仍为音符**总数**（备注：含休止的型轮廓数量 = 含休止颗数，见 R 段）；
     · 「纯节拍型不叠点」这条旧断言的方向反了——现在纯节拍型**照样画**轮廓
       （4 个均分块），因为它此刻就是"拍分组框"，非均分时值正要靠它看出来。 */
section("T115e 参考层 · 拍线数 / 时值轮廓数与几何 / 纯节拍与休止");
{
  const { beat, els, arr, sec } = setup();
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                      // S×2 段
  const lane = byCls(lyOf(els, 0), "arg-lyric-lane");
  const bar0 = rowOf(lane, 0).children.find(c => /(^| )arg-lyric-barrow( |$)/.test(c.className));   // v2.77.0：行容器内的字块行
  const beats = bar0.children.filter(c => /(^| )arg-lyric-beat( |$)/.test(c.className));
  eq(beats.length, 4, "拍线 = 段拍号 4 条");
  eq(/ dn /.test(" " + beats[0].className + " "), true, "小节首拍加重（.dn）");
  const notes = bar0.children.filter(c => /(^| )arg-lyric-note( |$)/.test(c.className));
  eq(notes.length, 5, "时值轮廓 = 该小节 5 颗音（贴满，一颗一块）");
  eq(notes.map(n => n.style.left).join(","), "0%,25%,37.5%,50%,75%",
     "★ 轮廓左缘 = 音符起点占比（0/48/72/96/144 ÷ 192）");
  eq(notes.map(n => n.style.width).join(","), "25%,12.5%,12.5%,25%,25%",
     "★ 轮廓宽度 = 时值占比（48/24/24/48/48 ÷ 192，间隙不属于任何一颗音）");
  ok(bar0.children.indexOf(notes[0]) < bar0.children.indexOf(beats[0]),
     "轮廓先于拍线挂载（DOM 序 = 轮廓在底、拍线在面）");
  ok(beats.every(b => b.getAttribute("aria-hidden") === "true") &&
     notes.every(n => n.getAttribute("aria-hidden") === "true"),
     "参考层整体 aria-hidden（读屏走字块自己的 aria-label）");
  sumOf(lyOf(els, 0)).fire("click");                      // 收起，换另外两段
  sumOf(lyOf(els, 2)).fire("click");                      // P 段（纯节拍）
  const laneP = byCls(lyOf(els, 2), "arg-lyric-lane");
  const barP = rowOf(laneP, 0).children.find(c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
  const notesP = barP.children.filter(c => /(^| )arg-lyric-note( |$)/.test(c.className));
  eq(notesP.length, 4, "★ 纯节拍型也画轮廓（4 个均分块：拍线答层级，轮廓答时值）");
  eq(barP.children.filter(c => /(^| )arg-lyric-beat( |$)/.test(c.className)).length, 4, "拍线照画");
  sumOf(lyOf(els, 2)).fire("click");
  sumOf(lyOf(els, 1)).fire("click");                      // R 段（首颗空扫 rest+dir）
  const laneR = byCls(lyOf(els, 1), "arg-lyric-lane");
  const barR = rowOf(laneR, 0).children.find(c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
  const notesR = barR.children.filter(c => /(^| )arg-lyric-note( |$)/.test(c.className));
  eq(notesR.length, 4, "含休止型：轮廓数 = 音符总数（含休止）");
  eq(notesR.filter(n => /(^| )rest( |$)/.test(n.className)).length, 1, "★ 休止画虚线空框（.rest）");
  beat.Arrange.close();
}

/* ============ T115x 贴词保位：改字 / 插字 / 删字都不得重置已排好的位置 ============
   用户实报：「我已经把歌词排好位置，但之后如果改动歌词，又会导致已排好的位置恢复原样」。
   根因：贴词框的 change 直接调 distribute，而 distribute **不读旧数据**，一律
   `t = k × LYRIC_BASE` 全量重建 ⇒ 改一个字就把整句位置冲掉。
   本组钉住三种情形（用户拍板「三种都按上表处理」）。 */
section("T115x 贴词保位 · 改字/插字/删字都不重置位置");
{
  const { beat, els } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "保位素材", meter: 4, bars: [[
    { t: 24, dir: "D" }, { t: 24, dir: "U" }, { t: 24, dir: "D" }, { t: 24, dir: "U" },
    { t: 24, dir: "D" }, { t: 24, dir: "U" }, { t: 24, dir: "D" }, { t: 24, dir: "U" }]] }] })), "素材导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "保位曲式", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 2 }] }] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  const uid = arr.sections[0].uid;
  beat.Store.deleteArrange(beat.DEMO_ID);

  /* ★ 手工"排好"的位置：0 / 72 / 120（**不是**均分的 0 / 24 / 48）——保位与否一眼可辨 */
  const seed = () => beat.Store.upsertLyric(arr.id, uid, [
    { t: 0, dur: 24, ch: "一" }, { t: 72, dur: 24, ch: "二" }, { t: 120, dur: 48, ch: "三" }]);
  const chars = () => (beat.Store.findLyric(arr.id, uid) || { chars: [] }).chars;
  const at = (ch) => { const c = chars().find(x => x.ch === ch); return c ? c.t : null; };
  const runCase = (text) => {
    seed();
    beat.Arrange.close(); beat.Arrange.open();                      // 重渲染（贴词框初值来自库）
    const ly = els["argSections"].children[0].children
      .find(c => /(^| )arg-lyric( |$)/.test(c.className));
    ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className)).fire("click");
    const ly2 = els["argSections"].children[0].children
      .find(c => /(^| )arg-lyric( |$)/.test(c.className));
    const box = ly2.children.find(c => /(^| )arg-lyric-paste( |$)/.test(c.className));
    box.value = text;
    box.fire("change");
    return chars().map(c => c.ch + "@" + c.t).join(" ");
  };

  /* ① 改字：二 → 四（同位置换字）⇒ 位置必须原地不动 */
  eq(runCase("一四三"), "一@0 四@72 三@120",
     "★★ 改字：换掉的那个字**保留原位置**（改前被重置成 0/24/48）");
  /* ② 插字：在二、三之间插入五 ⇒ 一/二/三 位置不动，新字落在空隙里 */
  const ins = runCase("一二五三");
  ok(ins.indexOf("一@0") === 0 && ins.includes("二@72") && ins.includes("三@120"),
     "★★ 插字：原有三个字位置不动（改前全被重置）", "实际 " + ins);
  const t5 = at("五");
  ok(t5 !== null && t5 > 72 && t5 < 120,
     "★ 插入的新字落在左右两字的**空隙**里（72 < t < 120）", "实际 t=" + t5);
  /* ③ 删字：删掉二 ⇒ 一、三 位置不动 */
  eq(runCase("一三"), "一@0 三@120",
     "★★ 删字：剩下的字位置不动（改前被重置成 0/24）");
}
