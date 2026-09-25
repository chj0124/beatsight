/* BeatSight 自动化测试 · 预设模式的「N 行窗口」（v2.10.2）
   T87 系列。
   ---------------------------------------------------------------------------
   来源（用户实拍）：「行数按钮在一些情形中无效」——两张截图里档位分别是「2 行」与
   「4 行」高亮，网格却分别是 4 行 × 4 拍 与 1 行十六分扫弦型。底部还露出一枚孤立的
   绿色「范围循环」开关（预设模式本应隐藏）。

   两个根因：
     A. 档位说谎：`S.vizRows` 的唯一消费点是 `arrWinBars()`，而它只被曲式窗口用；
        预设模式 `vizPattern()` 直接返回 `activePattern()`、`vizBars = patBars(p)` 恒等于型长
        → 点档位除了重建一次 DOM 之外画面零变化。**这是 v2.8.0 的刻意设计**，
        本次是**行为变更**（用户拍板），不是修 bug。
     B. 开关漏网：`.arg-now{display:flex}` 是作者样式、优先级高于 UA 的 `[hidden]{display:none}`，
        而本文件 10 处 `[hidden]{display:none}` 补丁里**没有** `.arg-now`。

   用户拍板的设计（唯一需求来源）：
     Q1 型长 < N → 「重复该小节铺满 N 行」（1 小节的型 + 4 行档 = 同一小节铺 4 行）；
     Q2 型长 > N → 「N 行窗口随播放翻页」；
     Q3 底部孤立「范围循环」开关一并修掉。

   契约（本组钉住的）：
     · 预设模式的网格行数 = 同屏行数档位 N（**不再**随型走），窗口第 i 行 = 型的第 (W+i)%len 小节，
       W = winAnchor(可听小节) = floor(k/N)*N → 型长 ≤ N 时页锚恒为 0（窗口静止，老行为逐位不变）；
     · 翻页由**可听**小节驱动（不是调度游标 schedBar，那个早一个前瞻窗口 → 画面先翻声音后到）；
     · 型长 > N 且走到尾部时窗口**绕回**（同 arrWindowPat 的既有口径 (W+i)%len）；
     · `.arg-now[hidden]` 规则在 CSS 里真实存在（DOM 桩不跑 CSS，只能断言样式文本——见 T87f）。

   驱动口径与 t79 一致：BPM 240 → 一小节 1s；帧步长 0.02s。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 指纹型（与 t65 同一手法）：第 i 小节放 i+1 颗等分音 → **行内格子数直接暴露小节身份**。
   ★ 为什么必须用指纹型：默认型各小节音符数完全相同，「窗口停在第一页」与「窗口翻了但内容一样」
     给出字节相同的读数（t65 踩过这个坑，据此误判过功能没生效）。
   ★ 取值受 VALID_T 白名单约束：每格时值 192/per 必须落在
     [192,96,72,48,36,24,16,12,8,6] 里，故 per 只能取 1/2/4/8/16/24
     （3 会得到 64、6 会得到 32 —— 都不在白名单里，导入会被校验直接拒掉）。
     per 同时就是该小节的格子数（= 行内的音符数），指纹读的就是它 */
const PER = [1, 2, 4, 8, 16, 24];
const mkFinger = n => Array.from({ length: n }, (_, i) =>
  Array.from({ length: PER[i] }, () => ({ t: 192 / PER[i] })));
/* 主视图每行的格子数（行 = .bar-row，格 = .cell） */
const rowCells = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className))
  .map(r => r.children.filter(c => /(^| )cell( |$)/.test(c.className)).length);
const sig = els => rowCells(els).join(",");
const rowsPill = (els, n) => els["vizRowsRow"].children.find(c => c.dataset.rows === String(n));

/* 造一个"只有 n 小节"的自定义指纹型并选中它（预设模式，停机态即建好网格） */
function withPattern(beat, n, name){
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: name || (n + "小节指纹型"), meter: 4, bars: mkFinger(n) }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();     // 停机态：applyPatternChange → buildViz
}
/* 「当前行」= 带 .current 的那一行（repaintCells 全量路径写入）。
   ★ 这一读数把 rowOfOnset（端点 → 行号）也纳入了观测面：只断言窗口内容是不够的
     ——窗口可以翻对，而播放头/球仍按"旧模数"停在别的行上（v2.5.1 的整类错行 bug）。 */
const curRow = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className))
  .findIndex(r => /(^| )current( |$)/.test(r.className));
/* 驱动 n 步，返回 { seen, flips }：
     · seen  = **窗口签名的变化序列**（只在变化时记一笔）；
     · flips = 每次翻页那一帧的 { from, to, row }（row = 该帧的当前行）。
   ★ 为什么记序列而不是"驱动完读一次"：翻页是时间相关事件，断言"末帧长什么样"会把用例钉死在
     某一个驱动步数上；记变化序列则只需断言"首帧是哪一页、出现过哪一页"，
     对起播偏移（约 0.08s）与机器快慢都免疫。
   ★ 为什么 flips 记"那一帧"的行号：翻页与行号必须在**同一帧**收敛——
     新页的首行正是该页第 1 个小节所在的行，若 rowOfOnset 还在按行数钳制/按旧页算，
     这一帧的当前行就会指到别的行（这是本组唯一能钉住 rowOfOnset 的观测量）。 */
function driveSigs(beat, els, ac, n){
  const seen = [], flips = [];
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const s = sig(els);
    if (seen[seen.length - 1] !== s){
      if (seen.length) flips.push({ from: seen[seen.length - 1], to: s, row: curRow(els) });
      seen.push(s);
    }
  }
  return { seen, flips };
}

/* ================= 场景 T87a：型长 < N → 绕回重复铺满 N 行（用户拍板 Q1） ================= */
section("T87a 预设窗口 · 1 小节的型 + 4 行档 ⇒ 同一小节铺满 4 行（Q1）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  eq(beat.Store.S.playMode, "preset", "前提：预设模式（默认）");
  withPattern(beat, 1, "一小节指纹型");     // 该小节 1 颗音 → 每行 1 格
  eq(beat.patBars(beat.curPattern()), 1, "前提：型确实只有 1 小节");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([1, 1, 1, 1]),
     "★★ 1 小节的型 + 默认 4 行档 → 4 行，每行都是那一小节的内容（不再只画 1 行）");
}

/* ================= 场景 T87b：型长 == N → 恰好铺满一页（既有数据零变化） ================= */
section("T87b 预设窗口 · 4 小节的型 + 4 行档 ⇒ 恰好铺满、内容按顺序（既有行为逐位不变）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 4);
  eq(JSON.stringify(rowCells(els)), JSON.stringify([1, 2, 4, 8]),
     "★ 4 小节的型 + 4 行档 → 行 i 装第 i 小节（指纹：第 i 小节指定位数）");
}

/* ================= 场景 T87c：型长 > N → 按 N 行翻页，随播放滚动（用户拍板 Q2） ================= */
section("T87c 预设窗口 · 4 小节的型 + 2 行档 ⇒ 每 2 小节翻一页（Q2）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 4);
  eq(JSON.stringify(rowCells(els)), JSON.stringify([1, 2, 4, 8]), "起始（停机）：4 行档看满 4 小节");
  rowsPill(els, 2).fire("click");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([1, 2]),
     "★ 切到 2 行档（停机态锚在第 0 页）→ 只剩第 1-2 小节这两行");
  beat.Controls.setBpm(240);                    // 一小节 1s → 50 步/小节
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { seen, flips } = driveSigs(beat, els, ac, 260);   // 跨 4 个小节（两页）
  beat.Controls.stop();
  eq(seen[0], "1,2", "起播锚在第 0 页：第 1-2 小节（实际序列 " + seen.join(" → ") + "）");
  ok(seen.includes("4,8"),
     "★★ 播过 2 小节 → 窗口翻页成第 3-4 小节（实际序列 " + seen.join(" → ") + "）");
  /* v2.23.0：预告行上屏——球走到页内最后一行（第 2 小节在播）期间，第 1 行（最陈旧的
     行）换成页外下一片段（第 3 小节）→ 页指纹 [4,2]。这就是本特性要的用户手感。 */
  ok(seen.includes("4,2"),
     "★ v2.23.0 预告行：球在第 2 行期间第 1 行换成页外下一片段（第 3 小节）→ 页指纹 [4,2]"
     + "（实际序列 " + seen.join(" → ") + "）");
  eq(rowCells(els).length, 2, "翻页后行数不随页面变（窗口长度恒为档位值）");
  eq(sig(els), seen[seen.length - 1], "末帧仍在某个合法页上");
  /* ★ 翻页那一帧的当前行必须落在**新页的首行**（0）——这一条钉的是 rowOfOnset：
     端点存的是型内小节号，窗口化后必须换算成"新页里的偏移"，不能按行数钳制
     （旧写法 min(vizBars-1, e.bar) 会把第 3 小节的端点钳到第 1 行）。
     v2.23.0 起预告亮起/熄灭也会让页指纹变化（被 driveSigs 记成 flip），且那一刻
     球在页末行（row=1）——所以"row 必须为 0"的断言只对**真翻页**（to = 新页指纹）做。 */
  ok(flips.length >= 1, "至少记录到一次翻页（实际 " + JSON.stringify(flips) + "）");
  ok(flips.some(f => f.to === "4,8"),
     "翻页方向正确：出现过第 3-4 小节页（预告行上屏会让 from 带着预告指纹，"
     + "不再是干净的 1,2——见上一条断言）（实际 " + JSON.stringify(flips) + "）");
  ok(flips.filter(f => f.to === "4,8").every(f => f.row === 0),
     "★★ 每一次真翻页那一帧的当前行都是**新页第 0 行**（端点的小节号已按新页锚换算）——"
     + "旧写法 min(vizBars-1, e.bar) 会把第 3 小节的端点钳到第 1 行（实际 " + JSON.stringify(flips) + "）");
  ok(flips.filter(f => f.to === "4,2").every(f => f.row === 1),
     "★★ 预告亮起只发生在球位于页末行（第 2 行）的帧——预告是可听域语义，"
     + "不是无条件的常驻标识（实际 " + JSON.stringify(flips) + "）");
}

/* ================= 场景 T87d：型长 > N 且走到尾部 → 窗口绕回开头 ================= */
section("T87d 预设窗口 · 6 小节的型 + 4 行档 ⇒ 走到尾部绕回开头（同 arrWindowPat 口径）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 6);
  eq(JSON.stringify(rowCells(els)), JSON.stringify([1, 2, 4, 8]), "停机：第 0 页 = 第 1-4 小节");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const { seen, flips } = driveSigs(beat, els, ac, 270);   // 跨 5 个小节：足够走到第 2 页（页锚 = 4）
  beat.Controls.stop();
  eq(seen[0], "1,2,4,8", "起播锚在第 0 页（实际序列 " + seen.join(" → ") + "）");
  ok(seen.includes("16,24,1,2"),
     "★★ 页锚 4 的窗口 = 第 5、6 小节 + 绕回的第 1、2 小节（实际序列 " + seen.join(" → ") + "）");
  /* v2.23.0：预告行上屏——球走到页内最后一行（第 4 小节在播）期间，第 1 行换成页外
     下一片段（第 5 小节）→ 页指纹 [16,2,4,8]。长型（P > W）与短型淡显一刀切的两端。 */
  ok(seen.includes("16,2,4,8"),
     "★ v2.23.0 预告行：球在第 4 行（页末行）期间第 1 行换成页外下一片段（第 5 小节）"
     + "→ 页指纹 [16,2,4,8]（实际序列 " + seen.join(" → ") + "）");
  /* 预告亮起/熄灭也会让页指纹变化（driveSigs 记成 flip），所以"翻了几次"改按
     **真翻页**（to = 页锚 4 的窗口指纹）计数；row=0 的断言同理只对真翻页做。 */
  eq(flips.filter(f => f.to === "16,24,1,2").length, 1,
     "真翻页（到页锚 4）恰一次——预告行亮起/熄灭不计入翻页（实际 " + JSON.stringify(flips) + "）");
  const flipPage = flips.find(f => f.to === "16,24,1,2");
  ok(!!flipPage && flipPage.row === 0,
     "★★ 翻到页锚 4 那一帧的当前行 = 新页第 0 行（第 5 小节落在第 0 行）");
}

/* ================= 场景 T87e：档位是预设模式网格行数的唯一真相源（用户报的原始症状） ================= */
section("T87e 预设窗口 · 点档位 → 画面行数真的变（修复前恒为型长，用户报「按钮无效」）");
{
  const { beat, els, storage } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 4);
  eq(rowCells(els).length, 4, "对照：默认档 4 与型长 4 恰好相等——所以修复前最难察觉档位没生效");
  rowsPill(els, 1).fire("click");
  eq(rowCells(els).length, 1, "★ 「1 行」→ 1 行（修复前仍是 4 行）");
  rowsPill(els, 3).fire("click");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([1, 2, 4]),
     "★ 「3 行」→ 3 行，内容 = 第 1-3 小节");
  rowsPill(els, 4).fire("click");
  eq(rowCells(els).length, 4, "★ 「4 行」→ 4 行（往返可逆）");
  beat.Store.flush();                            // 档位是热键偏好，落盘后才能断言（同 T79g）
  eq(JSON.parse(storage.get("beatsight.state")).vizRows, 4, "最后一次点击的档位已落热键");
}

/* ================= 场景 T87f：Q3 · hidden 失效的开关行（CSS 覆盖） =================
   v2.10.14 改写：#argJump 行**常显**（播放键住进来了，整行 hidden 会把它一起藏掉），
   行级 hidden 契约随之废除——本组改盯仍带 hidden 的「范围循环」开关：
   .arg-now[hidden]{display:none} 那条补丁规则仍有别的 .arg-now 行在用，必须保留。 */
section("T87f 底部「范围循环」开关 · .arg-now 显式 [hidden]{display:none} 补丁仍在（Q3）");
{
  /* ★ DOM 桩不跑 CSS，所以这里只能断言**样式文本**——缺陷的本质是"作者样式的 display
     盖掉了 UA 的 [hidden]"，桩里永远复现不出来。故把"补丁存在"变成可判。 */
  ok(/\.arg-now\{[^}]*display\s*:\s*flex/.test(html),
     "前提：.arg-now 的 display 是 flex（作者样式，会盖掉 UA 的 [hidden]{display:none}）");
  ok(/\.arg-now\[hidden\]\s*\{\s*display\s*:\s*none\s*\}/.test(html),
     "★★ .arg-now[hidden]{display:none} 仍在——跳段行常显了，但其它 .arg-now 行的 hidden 语义还得靠它");
  ok(/\.vol-row\[hidden\]\s*\{\s*display\s*:\s*none\s*\}/.test(html),
     "对照：既有补丁 .vol-row[hidden] 仍在（本行照抄同一套约定，便于统一维护）");
  ok(!/id="argJump"[^>]*\shidden/.test(html),
     "★ 标记里 #argJump 不再带 hidden（v2.10.14：行常显，收口改为上/下段键置灰）");
  const { els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  eq(els["argJumpPrev"].disabled, true, "预设模式下「上一段」置灰（新的收口呈现面）");
  eq(els["argJumpNext"].disabled, true, "预设模式下「下一段」置灰");
}

/* ================= 场景 T87g：1 小节型 + 非默认练习循环 → 行号不越界 ================= */
section("T87g 预设窗口 · 1 小节的型 + 循环 [0,0] ⇒ 待命球与 .next 仍在窗口内（不越界）");
{
  /* 窗口化后「行号」与「型内小节号」不再是同一个数，而 S.loopRange 是**型内小节号**口径。
     若把窗口行数当型长传进 loopNextBar，1 小节的型 + 4 行档就会算出区间外的行号
     （本组是这条语义边界的哨兵；完整的手感回归仍在 t72-loop-rewind-ball）。 */
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  withPattern(beat, 1, "一小节指纹型");
  beat.Store.S.loopRange = { on: true, from: 0, to: 0 };
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let bad = 0, seenNext = 0, maxRow = -1;
  for (let i = 0; i < 160; i++){                // 3 个小节
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const cells = rowCells(els);
    if (cells.length !== 4) bad++;              // 行数必须恒为档位值
    maxRow = Math.max(maxRow, cells.length - 1);
    /* .next 预告格挂在第几行（找带 next 类的格子所在行） */
    els["viz"].children
      .filter(el => /(^| )bar-row( |$)/.test(el.className))
      .forEach((r, ri) => r.children.forEach(c => {
        if (/(^| )next( |$)/.test(c.className)){ seenNext++; if (ri < 0 || ri > 3) bad++; }
      }));
  }
  beat.Controls.stop();
  eq(bad, 0, "★ 全程没有任何越界行号（行数恒为 4、.next 恒落在 0-3 行）");
  ok(seenNext > 0, "★ .next 预告格确实出现过（本场景不是「什么都没发生」的假绿）");
  eq(maxRow, 3, "窗口行号上界 = 3（= 档位 4 - 1）");
}

/* ================= 场景 T87h：循环区间落在别的页 → .next 指向翻页后的那一行 ================= */
section("T87h 预设窗口 · 循环型内第 3-4 小节 + 2 行档 ⇒ .next 跨页指向第 0 行（行号 ≠ 型内小节号）");
{
  /* 这一条钉的是 prompt 里"渲染域传 vizBars 的那两处语义必须重新定"：
     S.loopRange 是**型内小节号**口径（此处 [2,3]，0 基），而 .next 要画在**行**上。
     旧写法 loopNextBar(bar, vizBars) 把"行号 1"当"型内第 2 小节"用 → 区间被 loopRangeFor(2)
     二次收窄成 [1,1]，.next 落在第 1 行（自己这一行）；正确结果应落在翻页后的第 0 行。 */
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  const flat4 = () => Array.from({ length: 4 }, () => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]);
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "四平小节", meter: 4, bars: flat4() }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  rowsPill(els, 2).fire("click");                        // 2 行档
  beat.Store.S.loopRange = { on: true, from: 2, to: 3 }; // 型内第 3-4 小节（0 基 2-3）
  beat.Controls.setBpm(240);                             // 一小节 1s；末格 48t = 0.25s ≈ 12 帧
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const rows = () => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  const curRow = () => rows().findIndex(r => /(^| )current( |$)/.test(r.className));
  const nextRows = () => {
    const out = [];
    rows().forEach((r, ri) => r.children.forEach(c => {
      if (/(^| )next( |$)/.test(c.className) && !out.includes(ri)) out.push(ri);
    }));
    return out;
  };
  let seenNextRow0WhileRow1 = 0, badRange = 0;
  for (let i = 0; i < 420; i++){                         // 跨 4 个小节（两遍循环）
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    const nr = nextRows();
    if (nr.some(r => r < 0 || r > 1)) badRange++;         // 行号必须恒在 [0, 行数-1]
    if (curRow() === 1 && nr.includes(0)) seenNextRow0WhileRow1++;
  }
  beat.Controls.stop();
  eq(badRange, 0, "★ 全程 .next 只出现在 0-1 行（循环区间是型内口径，不会被当成行号用）");
  ok(seenNextRow0WhileRow1 > 0,
     "★★ 在最后一行（第 1 行）播放时，.next 指向翻页后的第 0 行（实测命中 " + seenNextRow0WhileRow1 + " 帧）");
}

/* ================= 场景 T87i：停机复位也要按窗口取型（否则休止标记会复位到错的小节） ================= */
section("T87i 预设窗口 · 停机复位按窗口合成型取 rest（1 小节型铺 4 行，4 行都该带虚框）");
{
  /* resetForStop 原先取 curPattern() 并按行号索引小节 —— 窗口化后第 b 行装的不再是
     型的第 b 小节，1 小节的型在 b=1..3 上会取到 undefined → 那几行丢掉休止虚框。 */
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一小节带休止", meter: 4,
    bars: [[{ t: 96 }, { t: 96, rest: true }]] }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  const rows = () => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  const restRows = () => rows().filter(r => r.children.some(c => /(^| )rest( |$)/.test(c.className))).length;
  eq(rows().length, 4, "前提：1 小节的型 + 4 行档 → 4 行");
  eq(restRows(), 4, "前提：4 行都画出那一小节的休止格（内容同源）");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  for (let i = 0; i < 60; i++){ ac.currentTime += 0.02; beat.AudioEngine.scheduler(); beat.Viz.paintFrame(); }
  beat.Controls.stop();
  eq(restRows(), 4, "★★ 停机复位后 4 行仍带休止标记（复位按 vizPattern 取型，不是 curPattern().bars[行号]）");
}


/* ================= 场景 T87j：静音拍的行标识在窗口化后**变准了** ================= */
section("T87j 预设窗口 · 静音拍标识 = 乐句相位（档位 4 时与型长无关，1 小节的型也标得准）");
{
  /* 窗口锚恒为 N 的整数倍 → 第 b 行的线性小节位置 = winStart + b → 档位 4（= MUTE_PERIOD）时
     「行号 == 乐句相位」。而第 3 行的内容 (winStart+3) % 型长 恰好就是会被静音的那一小节，
     故对**任意型长**都标得对（v2.10.1 及以前拿 vizBars 当型长判据，1 小节的型标不出来）。
     档位 ≠ 4 时一页只覆盖乐句的一段，静音落点随翻页轮转 → 静态标不出，一行都不标。 */
  const mutedRows = els => els["viz"].children
    .filter(el => /(^| )bar-row( |$)/.test(el.className))
    .map((r, i) => /(^| )muted-bar( |$)/.test(r.className) ? i : -1)
    .filter(i => i >= 0);
  const build = (n, rows) => {
    const app = loadApp(seedState({ sel: { type: "builtin", idx: 1 }, mute: true, vizRows: rows }));
    const b = app.beat;
    b.Store.importPresets(JSON.stringify({ presets: [{ name: n + "小节", meter: 4, bars: mkFinger(n) }] }));
    b.Store.S.sel = { type: "custom", id: b.Store.customs[b.Store.customs.length - 1].id };
    b.Presets.refreshAfterPatternChange();
    return app;
  };
  eq(JSON.stringify(mutedRows(build(1, 4).els)), JSON.stringify([3]),
     "★★ 1 小节的型 + 4 行档 → 只有第 4 行标静音（= 那第 4 遍会被静，v2.10.1 标不出来）");
  eq(JSON.stringify(mutedRows(build(3, 4).els)), JSON.stringify([3]),
     "★★ 3 小节的型 + 4 行档 → 仍只有第 4 行（行号即乐句相位，与型长无关）");
  eq(JSON.stringify(mutedRows(build(4, 4).els)), JSON.stringify([3]),
     "★ 4 小节的型 + 4 行档 → 第 4 行（既有行为逐位不变）");
  eq(JSON.stringify(mutedRows(build(4, 2).els)), JSON.stringify([]),
     "★ 档位 2 ≠ 乐句周期 4 → 一页只覆盖乐句的一段，静态标不出（一行都不标）");
  const off = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));   // 静音拍关着
  eq(JSON.stringify(mutedRows(off.els)), JSON.stringify([]), "静音拍关着 → 一行都不标");
}
