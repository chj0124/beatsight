/* BeatSight 自动化测试 · 歌词区节奏型可视化（v2.80.0）
   T145 系列。甲 = 块头节奏型行，乙 = 行内时值块轮廓。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html Arrange 模块 mkLyricRefs / mkPatBar / mkPatHeadRow 注释同源）：

     · 乙 · 行内轮廓：每小节行按该小节的音符**逐颗**画贴满轮廓（left = 起点占比、
       width = 时值占比，与主界面 v2.78.0 同口径）；含休止（虚线框）、含纯节拍型；
       旧的 .arg-lyric-onset 起点圆点退役——轮廓左缘就是起点，画两遍是噪音。
       DOM 序 = 轮廓 → 拍线 → 字块（字块天然压顶，不靠 z-index）。
     · 甲 · 块头行：每个**块**一条（按块计数，不去重型），插在该块第 1 小节之前；
       只在**贴了词**的展开态出现（2026-09-30 定案）；左列「型名 ×N 遍〔· 共N 小节〕」+
       右列该型的第 1 小节（时值块 + 休止虚线 + 十六分刻度 + 骑缝线 + .strumv 箭头）。
     · 硬约束三：① 块头行的 className 不含 arg-lyric-row（CSS counter 只数元素个数，
       蹭上就让之后所有小节序号集体 +1）；② 歌词行数不变（= secBars，counter 基数）；
       ③ 游标/引导线/ghost/气泡的行级挂载点走显式 rowWrapEls，不再靠 lane.children[row]。

   夹具：一段「A×3 → B×2 → A×1」= 8 小节（A = 1 小节四分×4 的纯节拍型；
   B = 2 小节扫弦型，首小节 5 颗音含 1 颗空扫 rest+dir）。 */
"use strict";
const { loadApp, ok, eq, section, html, FakeAudioContext, drive } = require("../lib/harness");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const walk = (el, out) => { out.push(el); (el.children || []).forEach(c => walk(c, out)); return out; };
/* v2.80.0：lane 里混进了块头节奏型行——"第 N 小节行"必须按类过滤取，不能按下标 */
const rowsOf = lane => lane.children.filter(c => /(^| )arg-lyric-row( |$)/.test(c.className));
const patRowsOf = lane => lane.children.filter(c => /(^| )arg-pat-row( |$)/.test(c.className));
const kids = (el, cls) => el.children.filter(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const barrowOf = row => row.children.find(c => /(^| )arg-lyric-barrow( |$)/.test(c.className));

/* A = 纯节拍（四分×4）；B = 扫弦，bar1 含一颗空扫、bar2 两颗二分 */
const A_BAR = [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }];
const B_BAR1 = [{ t: 48, dir: "D", zone: 0 }, { t: 24, dir: "U", rest: true },
                { t: 24, dir: "D" }, { t: 48, dir: "U", zone: 2 }, { t: 48, dir: "D" }];
const B_BAR2 = [{ t: 96, dir: "D" }, { t: 96, dir: "U" }];

/** 建「混段（A×3→B×2→A×1，已贴词）+ 无词段（A×1，未贴词）」两条曲式段的测试夹具 */
function setup(){
  const { beat, els, fireWin } = loadApp();
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材A", meter: 4, bars: [A_BAR] },
    { name: "素材B", meter: 4, bars: [B_BAR1, B_BAR2] },
  ] })).ok, "两个素材型导入成功");
  const [pa, pb] = beat.Store.customs.slice(-2).map(x => x.id);
  const BL = (id, reps) => ({ ref: { type: "custom", id }, repeats: reps });
  ok(beat.Store.upsertArrange({ name: "可视化曲式", sections: [
    { name: "混段", blocks: [BL(pa, 3), BL(pb, 2), BL(pa, 1)] },   // 3 + 4 + 1 = 8 小节
    { name: "无词段", blocks: [BL(pa, 1)] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  const sec = arr.sections[0], uid = sec.uid;
  beat.Store.upsertLyric(arr.id, uid,
    [{ t: 0, dur: 48, ch: "一" }, { t: 400, dur: 48, ch: "二" }, { t: 1000, dur: 48, ch: "三" }]);
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                     // 展开第 1 段
  return { beat, els, fireWin, arr, id: arr.id, sec: sec, uid: uid };
}
const laneOf = (els, i) => byCls(lyOf(els, i), "arg-lyric-lane");

/* ============ 场景 T145a：乙 · 行内时值块轮廓（几何 / 休止 / 普遍形式） ============ */
section("T145a 乙 · 行内轮廓 · 贴满几何 / 休止虚线 / 纯节拍也画 / DOM 序");
{
  const { beat, els } = setup();
  const lane = laneOf(els, 0);
  const rows = rowsOf(lane);
  eq(rows.length, 8, "前提：歌词行 = 段长 8 小节（行槽口径不受块头行影响）");

  /* 第 1 小节 = A 的第 1 遍（四分×4） */
  const barA = barrowOf(rows[0]);
  const notesA = kids(barA, "arg-lyric-note");
  const beatsA = kids(barA, "arg-lyric-beat");
  eq(notesA.length, 4, "★ 四分均分型：轮廓块 = 音符数 4");
  eq(notesA.map(n => n.style.left).join(","), "0%,25%,50%,75%", "★ 轮廓左缘 = 起点占比");
  eq(notesA.map(n => n.style.width).join(","), "25%,25%,25%,25%", "★ 轮廓宽度 = 时值占比（贴满，零间隙）");
  eq(beatsA.length, 4, "拍线数不变（= pat.meter 4 条）");
  eq(/ dn /.test(" " + beatsA[0].className + " "), true, "小节首拍加重（.dn）依旧");
  ok(notesA.every(n => n.getAttribute("aria-hidden") === "true"), "轮廓 aria-hidden（读屏走字块 aria-label）");
  ok(barA.children.indexOf(notesA[0]) < barA.children.indexOf(beatsA[0]),
     "★ DOM 序：轮廓先挂（在底）、拍线后挂（在面）");
  const chips = kids(barA, "arg-lyric-chip");
  ok(chips.length > 0 && barA.children[barA.children.length - 1] === chips[chips.length - 1],
     "★ 字块仍是 barrow 的最后一层孩子（轮廓插队也压不下去）");

  /* 第 4 小节 = B 的第 1 小节（含一颗空扫 rest+dir） */
  const barB = barrowOf(rows[3]);
  const notesB = kids(barB, "arg-lyric-note");
  eq(notesB.length, 5, "★ 含休止型：轮廓数 = 音符总数 5（含休止，不是只画发声颗）");
  eq(notesB.filter(n => /(^| )rest( |$)/.test(n.className)).length, 1, "★ 休止 = 虚线空框（.rest）");
  eq(notesB.map(n => n.style.left).join(","), "0%,25%,37.5%,50%,75%", "轮廓左缘按累计 tick（0/48/72/96/144）");
  eq(notesB.map(n => n.style.width).join(","), "25%,12.5%,12.5%,25%,25%", "轮廓宽度 = 时值（附点/短音靠它看得出来）");

  /* ★ 纯节拍型（hasStrum = false，旧口径会被整段跳过）照样画轮廓：
     上面那 4 块本身就是证据——素材A 无任何 dir/zone，轮廓仍然逐颗铺满 */
  eq(notesA.length, 4, "★ 纯节拍型也画轮廓（退回 hasStrum 门槛会让它掉到 0 块）");
  eq(kids(barrowOf(rows[1]), "arg-lyric-note").length, 4, "第 2 小节（同属素材A）同样画");
  const allInline = [];
  walk(lane, allInline);
  ok(html.indexOf("arg-lyric-onset") < 0, "★ 源码零 arg-lyric-onset 残留（旧圆点彻底退役）");
  ok(!allInline.some(n => /arg-lyric-onset/.test(String(n.className || ""))),
     "★ DOM 零 arg-lyric-onset 残留（双端收敛）");
  beat.Arrange.close();
}

/* ============ 场景 T145b：甲 · 块头行的数量与位置 ============ */
section("T145b 甲 · 块头行 · 按块计数 / 落在块的第一小节之前 / 同型不去重");
{
  const { beat, els } = setup();
  const lane = laneOf(els, 0);
  const children = lane.children;
  /* 预期文档序：P(块1) 行行行 P(块2) 行行行行 P(块3) 行 —— P = 块头行 */
  const seq = children.map(c => /arg-pat-row/.test(c.className) ? "P"
    : (/arg-lyric-row/.test(c.className) ? "行" : "?")).join("");
  eq(seq, "P行行行P行行行行P行", "★ 文档序 = 每个块头行紧跟自己的第 1 小节之前");
  const pats = patRowsOf(lane);
  eq(pats.length, 3, "★ A×3 → B×2 → A×1 = 恰 3 条块头行（按块，不按型去重）");
  /* 变异守卫（v2.80.0 纪律）：块头行可能被整体删除/改写——后续取值先判存在性，
     让变异表现为「具名断言失败」而不是 TypeError 崩掉整个套件（崩溃不是证据） */
  /* 每条块头行**之后**的第一条歌词行 = 该块的第一小节（0 / 3 / 7） */
  const afterRow = p => {
    const i = children.indexOf(p);
    for (let k = i + 1; k < children.length; k++){
      if (/arg-lyric-row/.test(children[k].className)) return rowsOf(lane).indexOf(children[k]);
    }
    return -1;
  };
  eq(pats.map(afterRow).join(","), "0,3,7", "★ 三条分别落在第 1 / 第 4 / 第 8 小节之前（各块的首小节）");
  const names = pats.map(p => p.children[0].textContent);
  eq(names.filter(n => n.indexOf("素材A") === 0).length, 2, "同型出现两次 = 两条块头行（A 在第 1、3 块）");
  ok(!pats.some(p => /(^| )arg-lyric-row( |$)/.test(p.className)),
     "★ 块头行不带 arg-lyric-row（counter 不吃序号）");
  beat.Arrange.close();
}

/* ============ 场景 T145c：甲 · 块头行内容（型名 / 一遍 / 箭头 / 缝） ============ */
section("T145c 甲 · 块头内容 · ×N 遍 · 共N小节 / 时值块 / ghost 箭头 / 骑缝线");
{
  const { beat, els } = setup();
  const lane = laneOf(els, 0);
  const pats = patRowsOf(lane);
  ok(pats.length === 3, "前提：三条块头行在（变异会在此处红，后续取值随之跳过——崩溃不是证据）");
  if (pats.length === 3){
    eq(pats[0].children[0].textContent, "素材A ×3 遍", "★ 左列 = 型名 + ×N 遍（单小节型不注共N）");
    eq(pats[1].children[0].textContent, "素材B ×2 遍 · 共2 小节",
       "★ 多小节型补注「· 共N 小节」（右列只画了第 1 小节，防误读）");
    eq(pats[2].children[0].textContent, "素材A ×1 遍", "最后一个块：×1 遍");
    ok(pats.every(p => p.children[0].getAttribute("aria-hidden") === "true" &&
       p.children[1].getAttribute("aria-hidden") === "true"), "整行纯视觉（读屏各歌词行自带 label）");

    const barA = pats[0].children[1];
    eq(barA.className, "arg-pat-bar", "右列 = arg-pat-bar");
    const cellsA = kids(barA, "arg-pat-cell");
    eq(cellsA.length, 4, "时值块数 = bars[0] 的音符数 4");
    eq(cellsA.map(c => c.style.left).join(","), "0%,25%,50%,75%", "时值块左缘 = 起点占比");
    eq(cellsA.map(c => c.style.width).join(","), "25%,25%,25%,25%", "时值块宽度 = 时值占比（贴满）");
    const subs = kids(cellsA[0], "arg-pat-sub");
    eq(subs.length, 4, "★ 块内十六分刻度 = 该格的十六分数（四分 = 4 条）");
    eq(subs.map(s => s.style.left).join(","), "0%,25%,50%,75%",
       "★ 刻度 left 是**格内**占比（分母 = 本格时值，不是小节总长）");
    const seamA = barA.children.filter(c => /(^| )seams( |$)/.test(c.className));
    eq(seamA.length, 1, "行尾挂一层 .seams 覆盖层");
    ok(String(seamA[0].style.background).indexOf("var(--seam-strong)") >= 0,
       "★ 拍边界存在 2px 强缝（v2.79.0 语汇：线更强 = 拍分组层级更高）");
    eq(barA.children.filter(c => /(^| )strumv( |$)/.test(c.className)).length, 0,
       "★ 纯节拍型（无扫弦记谱）不画箭头（与主视图 hasStr 门控同口径）");

    /* B 的块头：5 颗音全带 dir → 5 支箭头，其中空扫 1 支 .ghost；弦区跟随前一记实扫 */
    const barB = pats[1].children[1];
    const cellsB = kids(barB, "arg-pat-cell");
    eq(cellsB.length, 5, "B 首小节 5 颗音 → 5 个时值块");
    eq(cellsB.filter(c => /(^| )rest( |$)/.test(c.className)).length, 1, "其中 1 颗休止（虚线框）");
    const strums = barB.children.filter(c => /(^| )strumv( |$)/.test(c.className));
    eq(strums.length, 5, "★ 扫弦型：箭头数 = 带 dir 的音符数 5（含空扫）");
    eq(strums.filter(s => /(^| )ghost( |$)/.test(s.className)).length, 1, "★ 空扫 = 蓝虚线 .ghost 箭头");
    eq(strums.filter(s => /(^| )kB( |$)/.test(s.className)).length, 2,
       "★ 空扫沿用前一记实扫的弦区（第 2 支 ghost 沿用 kB，落到 kF 之前）");
    eq(strums.map(s => s.style.left).join(","), "12.5%,31.25%,43.75%,62.5%,87.5%",
       "箭头水平 = 各格中心（主界面同一套百分比口径）");
    const seamB = barB.children.filter(c => /(^| )seams( |$)/.test(c.className))[0];
    ok(String(seamB.style.background).indexOf("rgba(var(--veil),.18)") >= 0,
       "★ 拍内存在 1px 墨色弱缝（强/弱两级都出现 = 拍分组层级可读）");
  }
  beat.Arrange.close();
}

/* ============ 场景 T145d：甲 · 安全边界（这种场景不插行） ============ */
section("T145d 甲 · 边界 · 未贴词段不插 / 折叠态零变化 / counter 安全");
{
  const { beat, els } = setup();
  const lane = laneOf(els, 0);
  eq(patRowsOf(lane).length, 3, "前提：贴词段 3 条");
  sumOf(lyOf(els, 0)).fire("click");                     // 收起
  const lyF = lyOf(els, 0);
  ok(!byCls(lyF, "arg-lyric-lane"), "★ 折叠态没有 lane，块头行自然为零（摘要视图逐位不变）");

  sumOf(lyOf(els, 1)).fire("click");                     // 第 2 段：没贴过词
  const lane2 = laneOf(els, 1);
  ok(!!lane2, "无词段展开后仍有歌词行槽（v2.35.0：每小节一行保持节奏感）");
  eq(rowsOf(lane2).length, 1, "无词段行槽 = 1 小节");
  eq(patRowsOf(lane2).length, 0,
     "★ 未贴词的段不插块头行（2026-09-30 定案：它是给「贴词对齐」当参照物的）");

  /* counter 安全：counter-increment 全局只有一处且挂在 .arg-lyric-row 上 */
  eq((html.match(/counter-increment:argbar/g) || []).length, 1,
     "★ counter-increment:argbar 全局仅一处（块头行不得吃小节序号）");
  ok(/\.arg-lyric-row\{[^}]*counter-increment:argbar/.test(html), "且只挂在 .arg-lyric-row 上");
  ok(/\.arg-pat-row\{[^}]*\}/.test(html) &&
     !/\.arg-pat-row\{[^}]*counter-increment/.test(html), "块头行那条规则本身不带 counter-increment");

  /* 竖线对齐：块头行左列宽必须与和弦格同宽（否则型名列与和弦列不在一条竖线上） */
  /** @param {string} cls @returns {string} */
  const wpx = cls => {
    const m = new RegExp("\\." + cls + "\\{[^}]*width:(\\d+)px").exec(html);
    return m ? m[1] : "";
  };
  eq(wpx("arg-pat-name"), wpx("arg-chd-cell"),
     "★ 块头行左列宽 = 和弦格宽（两列对在同一条竖线上，实测 " + wpx("arg-chd-cell") + "px）");
  ok(/\.arg-pat-bar\{[^}]*height:30px/.test(html), "块头条桌面档 30px（拍板档位）");
  ok(/\.arg-pat-bar\{height:36px/.test(html), "窄屏（≤640）跟随字块行升到 36px");
  beat.Arrange.close();
}

/* ============ 场景 T145e：游标回归（lane 里有块头行时仍挂对小节行） ============ */
section("T145e 游标回归 · 挂载点走显式行数组，块头行不再把下标带偏");
{
  const { beat, els, sec, id, uid } = setup();
  beat.Arrange.previewSection(beat.Store.findArrange(id), 0, sec, 0);
  drive(FakeAudioContext.last, beat, 0.6);               // 端点落地 + 时钟前进
  beat.Arrange.syncPreviewCursor();                      // 桩无 rAF：直接调
  const pos = beat.Arrange.sectionPosTicks(id, uid, sec);
  ok(pos !== null && pos > 0, "段内可听位置可读（端点驱动）");
  const lane = laneOf(els, 0);                           // 试听后重渲：现取
  const all = walk(lane, []);
  const cursor = all.find(n => /(^| )arg-lyric-cursor( |$)/.test(String(n.className || "")));
  ok(!!cursor && cursor.hidden === false, "游标已上轨且可见");
  if (cursor){
    const rows = rowsOf(lane);
    const rowIdx = Math.max(0, Math.min(rows.length - 1, Math.floor(pos / 192)));
    ok(cursor.parentNode === rows[rowIdx],
       "★ 游标挂在**第 " + rowIdx + " 小节的行容器**上（不是 lane、不是块头行）");
    ok(patRowsOf(lane).indexOf(cursor.parentNode) < 0, "★ 挂载点不与块头行混淆");
    const expLeft = (pos - rowIdx * 192) / 192 * 100 + "%";
    eq(cursor.style.left, expLeft, "游标 left = sectionPosTicks 的换算值（位置源不变）");
  }
  beat.Arrange.close();
}
