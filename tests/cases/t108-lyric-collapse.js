/* BeatSight 自动化测试 · S3 歌词折叠（v2.32.0）：摘要行 + 展开态 + 锚点提示音全局化
   T108 系列（PLAN-v4 S3）。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html mkLyricRow 的注释同源）：
     · 歌词区默认折叠为**摘要行**（arg-lyric-sum）：状态签（歌词 ✓ N 字 / 未贴歌词）+
       前几字预览 + ▸ 展开编辑；折叠态不渲染粘贴框 / 清除 / 字块轨 / 循环本行；
     · 展开态记在内存 Set（键 = arrangeId|secUid），**不持久化**（D2 拍板：纯浏览态），
       Arrange.open()/close() 清空——重开浮层回到默认折叠；
     · 展开与收起是纯 UI 动作，**不碰歌词数据**（Store.findLyric 返回同一对象）；
     · 锚点提示音（S.lyricCue）是全局开关，收进开练面板（argLyricCue，全书唯一一份），
       段行内不再出现 arg-lyric-cue。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seed2 = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t108", name: "两段歌", sections: [
    { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
    { uid: "uB", name: "B段", blocks: [BL(1, 1)] },
  ] },
]}), "beatsight.lyrics": JSON.stringify({ v: 2, lines: [
  { arrangeId: "t108", secUid: "uA", chars: [{ t: 0, dur: 24, ch: "春" }, { t: 24, dur: 24, ch: "眠" }] },
]}) });
const rows = els => els["argSections"].children;
const lyOf = (els, i) => rows(els)[i].children[4];
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
const byCls = (row, pred) => row.children.find(c => (pred instanceof RegExp ? pred.test(c.className) : pred(c)));

/* ================= 场景 T108a：默认折叠 · 摘要内容 / 控件不渲染 ================= */
section("T108a 默认折叠 · 摘要签 / 预览 / 控件不渲染 / aria-expanded");
{
  const { beat, els } = loadApp(seed2());
  beat.Arrange.open();
  const lyA = lyOf(els, 0), lyB = lyOf(els, 1);
  ok(/(^| )arg-lyric( |$)/.test(lyA.className), "歌词行仍在段行 children[4]（t60 定位不破）");

  /* 有词段：状态签 + 预览；无词段：未贴（★ 桩的 textContent 不聚合子节点——断言逐个 span） */
  const sumA = sumOf(lyA);
  ok(!!sumA, "★ 摘要行是歌词行第一个子节点");
  const tagA = sumA.children.find(c => /arg-lyric-tag/.test(c.className));
  eq(tagA && tagA.textContent, "歌词 ✓ 2 字", "★ 状态签给出字数");
  const prevA = sumA.children.find(c => /arg-lyric-preview/.test(c.className));
  eq(prevA && prevA.textContent, "春眠", "预览给出前几个字");
  eq(sumA.getAttribute("aria-expanded"), "false", "aria-expanded = false（读屏可读折叠态）");
  const sumB = sumOf(lyB);
  const tagB = sumB.children.find(c => /arg-lyric-tag/.test(c.className));
  eq(tagB && tagB.textContent, "未贴歌词", "无词段状态签 = 未贴歌词");

  /* 折叠态：编辑控件一概不渲染 */
  ok(!byCls(lyA, /arg-lyric-paste/) && !byCls(lyA, /arg-lyric-lane/) && !byCls(lyA, /arg-lyric-loop/),
    "★ 折叠态无粘贴框 / 字块轨 / 循环本行（段高从 ~130px 压到一行）");
  ok(!byCls(lyA, /arg-lyric-cue/), "★ 段行内无锚点开关（已收进开练面板，S3）");
  ok(!!els["argLyricCue"], "锚点开关在开练面板（全局唯一一份）");

  /* 展开收起不碰数据 */
  const before = beat.Store.findLyric("t108", "uA");
  sumA.fire("click");
  eq(beat.Store.findLyric("t108", "uA"), before, "★ 展开 = 纯 UI 动作（歌词行对象分毫未动）");
  beat.Arrange.close();
}

/* ================= 场景 T108b：展开 / 收起 · 控件出现 / 重渲染保持 / 关浮层重置 ================= */
section("T108b 展开态 · 控件齐套 / 重渲染保持 / 关浮层即重置（不持久化）");
{
  const { beat, els } = loadApp(seed2());
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                     // 展开 A 段
  const lyA = lyOf(els, 0);
  eq(sumOf(lyA).getAttribute("aria-expanded"), "true", "aria-expanded = true");
  ok(!!byCls(lyA, /arg-lyric-paste/) && !!byCls(lyA, /arg-lyric-lane/), "★ 展开出粘贴框与字块轨");
  ok(!!byCls(lyA, /arg-lyric-loop/), "有词段展开后出现「循环本行」");
  ok(!byCls(lyOf(els, 1), /arg-lyric-paste/), "B 段仍折叠（展开态按段独立）");

  /* 落库触发重渲染 → 展开态保持（Set 跨渲染存活） */
  byCls(lyA, /arg-lyric-paste/).value = "春眠不觉晓";
  byCls(lyA, /arg-lyric-paste/).fire("change");
  const lyA2 = lyOf(els, 0);
  ok(!!byCls(lyA2, /arg-lyric-paste/), "★ 落库重渲染后仍保持展开（不是每次都重新点开）");
  eq(byCls(lyA2, /arg-lyric-paste/).value, "春眠不觉晓", "粘贴框回显新词");

  /* 收起 */
  sumOf(lyA2).fire("click");
  ok(!byCls(lyOf(els, 0), /arg-lyric-paste/), "★ 收起后控件消失");

  /* ★ 关浮层 = 重置（不持久化，D2）：必须在**展开态**下关——先收起再关的话
     Set 本来就空，变异（不清 Set）测不出来，断言只是恒绿的橡皮章 */
  sumOf(lyOf(els, 0)).fire("click");                     // 再展开
  ok(!!byCls(lyOf(els, 0), /arg-lyric-paste/), "前提：A 段处于展开态");
  beat.Arrange.close();
  beat.Arrange.open();
  ok(!byCls(lyOf(els, 0), /arg-lyric-paste/), "★ 展开态下关浮层，重开回到默认折叠（展开态是纯浏览态）");
  beat.Arrange.close();
}

/* ================= 场景 T108c：锚点提示音 · 面板唯一一份 / 状态读写 ================= */
section("T108c 锚点提示音 · 全书一份 / 面板开关读写 / 展开态不影响");
{
  const { beat, els } = loadApp(seed2());
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");
  /* 全书计数：argSections（10 段规模也不例外的契约在这里用 2 段钉）内 0 个 cue，面板 1 个 */
  const cueInRows = rows(els).filter(r => !!byCls(r.children[4] || {}, /arg-lyric-cue/)).length;
  eq(cueInRows, 0, "★ 段行内 0 个锚点开关（旧实现每段一个）");
  eq(els["argLyricCue"].getAttribute("aria-checked"), "false", "默认关");
  els["argLyricCue"].fire("click");
  eq(beat.Store.S.lyricCue, true, "面板开关写入 S.lyricCue");
  eq(els["argLyricCue"].getAttribute("aria-checked"), "true", "aria 同步");
  beat.Arrange.close();
}
