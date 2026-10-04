/* BeatSight 自动化测试 · v3.33.2 滚动模式「进场行缺歌词」修复
   ---------------------------------------------------------------------------
   【用户报障】滚动模式下当前节奏型向上滚动时，最下面那条**新滚动上来**的节奏型
   没有歌词，等它完全到达应到的位置时歌词才突然出现。
   【根因】槽位数这个数在两处各写了一份判据，而两份只共同覆盖了传送带特例：
     · 网格（buildViz）：`(scrollRows()===1) ? 3 : scrollRows()+1`  ← 多行档 **+1**（进场行）
     · 歌词（buildLyricLane）：`(scrollMode && scrollRows()===1) ? 3 : arrWinBars()` ← **没有 +1**
   ⇒ 3 行档下网格 4 行、歌词 3 行；那条从裁剪区外滑进来的**进场行没有歌词行**，
     等它滑到应到位置（成为第 3 槽）词才凭空出现。
   【修法】抽 `slotRowCount()` 单一来源，网格与歌词轨共用；歌词轨随之建 rows+1 条。
   【本用例钉什么】
     T186a 三档（分页 / 滚动 3 行 / 滚动 1 行）下**两轨行数恒等**，且各档槽位数符合定义
     T186b ★ 进场行**带着词一起进来**（用户报障的正体）：4 个槽都有词，且末槽是**新**一节
     T186c 逐槽横移/纵移对齐覆盖**全部槽**（含进场行）——t155 因歌词只有 3 条而漏比了第 4 槽
   ★ 反向验证锚点：把 `buildLyricLane` 的 `laneRows` 退回
     `(S.scrollMode && scrollRows() === 1) ? 3 : arrWinBars()` → T186a/T186b/T186c 红
     （预期恰好这 3 组的"两轨行数相等 / 进场行有词 / 第 4 槽对齐"三类断言变红）。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, driveFrames, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
/* 4 小节曲式（内置型 1 = 四分基础 4/4，1 遍 = 4 小节）；lo (loop) 控制是否回卷 */
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "滚动曲", sections: [{ uid: "s1", name: "A", blocks: [BL(1, 1)] }] },
]}) });
const seedState = (extra, loop) => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 3, loop } }, extra));
const arrSeed = (extra, loop = true) => Object.assign(seedArr(), { "beatsight.state": seedState(extra, loop) });

/* 每小节一个不同的字：第 1–4 小节 = 一 / 二 / 三 / 四（段内 tick 起点 0/192/384/576） */
const WORDS = ["一", "二", "三", "四"];
const seedWords = (beat) => beat.Store.upsertLyric("t1", "s1",
  WORDS.map((ch, i) => ({ t: i * 192, dur: 24, ch })));

const intOf = beat => beat.Viz.internals();
const rowsOf = beat => intOf(beat).rowEls.length;
const lyRowsOf = beat => intOf(beat).lyricRows.length;
/* 各槽的歌词字（空槽 → ""） */
const slotWords = beat => intOf(beat).lyricRows.map(r => r.chars.map(c => c.ch).join(""));
const dxOf = s => { const m = /translate\((-?[\d.]+)px,/.exec(s || ""); return m ? +m[1] : NaN; };
const dyOf = s => { const m = /,\s*(-?[\d.]+)px\)/.exec(s || ""); return m ? +m[1] : NaN; };

/* 推播放到 seconds 秒（240BPM/4-4 ⇒ 1 小节 = 1 秒），逐帧 scheduler + paintFrame */
function seek(beat, ac, seconds){
  const n = Math.round(seconds / 0.04);
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.04;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (!beat.Store.S.playing) break;
  }
}

/* ================= T186a：三档下两轨行数恒等（槽位数单一来源） ================= */
section("T186a 分页 / 滚动 3 行 / 滚动 1 行：网格与歌词轨行数恒等（同一份 slotRowCount）");
{
  /* ① 分页模式：两轨都 = 窗口行数（S.vizRows） */
  const page = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ vizRows: 2, showLyric: true }, false) }));
  seedWords(page.beat);
  page.beat.Store.S.scrollMode = false;
  page.beat.Viz.reloadScroll();
  eq(page.beat.Store.S.vizRows, 2, "前提：分页 2 行档");
  eq(rowsOf(page.beat), 2, "分页：网格 2 行");
  eq(lyRowsOf(page.beat), 2, "★ 分页：歌词轨同为 2 行（行数同源，未受影响）");
  eq(rowsOf(page.beat), lyRowsOf(page.beat), "分页：两轨行数相等");

  /* ② 滚动 3 行档：= rows+1 = 4（含进场行） */
  const s3 = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(s3.beat);
  s3.beat.Viz.buildViz();
  eq(intOf(s3.beat).scroll.rows, 3, "前提：滚动 3 行档");
  eq(intOf(s3.beat).scroll.slotN, 4, "★ 3 行档槽位数 = rows+1 = 4（多出的一行是进场行）");
  eq(rowsOf(s3.beat), 4, "网格 4 行（含进场行）");
  eq(lyRowsOf(s3.beat), 4, "★★ 歌词轨也是 4 行——修复前此处是 3（进场行没有词可显示）");
  eq(rowsOf(s3.beat), lyRowsOf(s3.beat), "★ 滚动 3 行档：两轨行数**恒等**");

  /* ③ 滚动 1 行档（传送带）：两边都 3（上一 / 当前 / 下一），不受影响 */
  const s1 = loadApp(arrSeed({ scrollMode: true, scrollRows: 1, showLyric: true }));
  seedWords(s1.beat);
  s1.beat.Viz.buildViz();
  eq(intOf(s1.beat).scroll.rows, 1, "前提：滚动 1 行档（传送带）");
  eq(intOf(s1.beat).scroll.slotN, 3, "★ 传送带槽位数 = 3（上一/当前/下一，逐位不变）");
  eq(rowsOf(s1.beat), 3, "传送带：网格 3 行");
  eq(lyRowsOf(s1.beat), 3, "传送带：歌词轨 3 行（此档修复前后一致，是既有正确行为）");
  eq(rowsOf(s1.beat), lyRowsOf(s1.beat), "传送带：两轨行数相等");
}

/* ================= T186b：★ 进场行带着词一起进来（用户报障的正体） ================= */
section("T186b ★ 进场行有歌词（此前它没有词，要等滑到位置才突然出现）");
{
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(beat);
  beat.Viz.buildViz();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  seek(beat, ac, 2.2);                       // 离开起播瞬间，窗口稳定在 winStart=0/1 附近

  const w = slotWords(beat);
  const ws = intOf(beat).scroll.winStart;
  /* ★ 守卫（技能纪律：变异会让"行少了"，裸取 w[3].length 会**崩**，而崩溃不是证据）。
     下面的取值一律包在 if 里，让"行数不对"表现为**具名断言失败**。 */
  eq(w.length, 4, "★ 4 个槽都建了歌词行");
  if (w.length === 4){
    ok(w[0].length > 0 && w[1].length > 0 && w[2].length > 0 && w[3].length > 0,
      "★★ 四个槽**全都有词**——修复前第 4 槽（进场行）是空的，那条新滚上来的节奏型没有歌词");
    /* 末槽承载的是**新一节**的词（不是上一槽的重复）——这才是"新滚动上来"的那一条 */
    ok(w[3] !== w[2], "★★ 末槽的词与上一槽不同（它是**新**一节，不是重复铺满）");
    /* 逐槽与理论窗口内容比对：槽 i 的词 = 第 (winStart+i) 小节（循环范围内折回） */
    for (let i = 0; i < 4; i++){
      const bar = (ws + i) % 4;
      eq(w[i], WORDS[bar], `槽 ${i} 的词 = 第 ${bar + 1} 小节（winStart=${ws}）`);
    }
  }
}

/* ================= T186c：逐槽对齐覆盖全部槽（含进场行） ================= */
section("T186c 歌词行与网格行逐槽同组 (dx, dy)——含进场行（t155 只比了前 3 槽）");
{
  const { beat } = loadApp(arrSeed({ scrollMode: true, scrollRows: 3, showLyric: true }));
  seedWords(beat);
  beat.Viz.buildViz();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  seek(beat, ac, 1.6);

  const int = intOf(beat);
  /* ★ 守卫：行数不对时不要崩在 undefined.style / undefined.y 上（崩溃不是证据） */
  eq(int.lyricRows.length, int.rowEls.length, "前提：两轨行数恒等（4 / 4）");
  eq(int.lyricRows.length, 4, "前提：4 个槽（含进场行）");
  if (int.lyricRows.length === 4 && int.rowEls.length === 4){
    for (let i = 0; i < 4; i++){
      eq(dxOf(int.lyricRows[i].el.style.transform), dxOf(int.rowEls[i].style.transform),
        `★ 歌词行 ${i} 与网格行 ${i} 横移严格相同（含第 4 槽进场行）`);
      eq(dyOf(int.lyricRows[i].el.style.transform), int.lyricRows[i].y + int.scroll.dy,
        `★ 歌词行 ${i} 纵移 = 自身锚点 y + 本帧 dy`);
    }
    /* 进场行的锚点在**裁剪区之下**（这正是"它从下面滑进来"的几何前提）：必须大于前一行 */
    const y3 = int.lyricRows[3].y, y2 = int.lyricRows[2].y;
    ok(y3 > y2, `★ 进场行锚点在第 3 槽之下（y3=${Math.round(y3)} > y2=${Math.round(y2)}，故它是"从下方滑入"）`);
  }
}
