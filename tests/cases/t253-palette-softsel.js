/* BeatSight 自动化测试 · 音符块库软选中（v3.52.0）
   T253 系列。
   ---------------------------------------------------------------------------
   块库退役「四分休止符」项（10 项：全/二分/附点四/四分/附点八/八分/八三连/十六分/十六三连/三十二），
   形状归块库、状态（发/止 · 实/空）归悬浮窗。
   软选中（v3.52.0）：palette 点击在「无手动选中」时追加到当前小节并**软选中**新块
   （edSel.auto=true）——悬浮层跟随、但下一次点块库仍**追加**（不切成替换流），
   这正是「追加音符块 → 悬浮窗翻休止/空扫」两步流的关键；手动点块（无 auto）后下一击恢复**替换**。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const edCellsOf = (els, b) => els["editorBars"].children[b].children[1].children;
const trackOf = (els, b) => els["editorBars"].children[b].children[1];
const title = els => els["paletteTitle"].textContent;

/* ================= 场景 T253a：块库 10 项、末项不再是休止符 ================= */
section("T253a 块库 · 10 项且末项为三十二分（休止符退役）");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  const pal = els["palette"].children;
  eq(pal.length, 10, "★ 音符块库 10 项（v3.52.0 删四分休止符）");
  eq(pal[9].children[1].children[0].textContent, "三十二分", "★ 末项 = 三十二分（不再是休止符）");
  ok(pal.every(p => !/(^| )rest( |$)/.test(p.children[0].className)),
     "块库里不再有任何 .bar.rest 的休止块示意");
}

/* ================= 场景 T253b：追加 → 软选中（悬浮层可用、标题仍「追加」） ================= */
section("T253b 块库 · 追加后自动软选中（悬浮层跟随、paletteTitle 仍报追加）");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  const pal = els["palette"].children;
  const n0 = beat.Editor.draft().bars[0].length;
  pal[3].fire("click");   // 四分音符 → 追加
  eq(beat.Editor.draft().bars[0].length, n0 + 1, "点击块库 → 追加一个音符块");
  ok(/点击追加到/.test(title(els)), "★ 软选中后 paletteTitle 仍报「追加」（连点追加流不被切成替换流）");
  eq(edCellsOf(els, 0)[n0].getAttribute("aria-pressed"), "true", "★ 新块自动选中（aria-pressed=true）");
  ok(els["airRow"].children.every(p => !p.disabled), "★ 软选中 → 悬浮层可用（airRow 未禁用）");
}

/* ================= 场景 T253c：连点追加不切替换 ================= */
section("T253c 块库 · 连点三次全部追加（软选中不切成替换流）");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  const pal = els["palette"].children;
  const n0 = beat.Editor.draft().bars[0].length;
  pal[3].fire("click"); pal[3].fire("click"); pal[3].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0 + 3, "★ 连点三次 → 追加三枚（不是替换成一枚）");
}

/* ================= 场景 T253d：手动点块后下一击变替换 ================= */
section("T253d 块库 · 手动选中后下一击恢复替换；替换后回到软选中");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  const pal = els["palette"].children;
  edCellsOf(els, 0)[0].fire("click");   // 手动选中第 0 格
  ok(/点击替换选中/.test(title(els)), "手动选中 → paletteTitle 报「替换」");
  const n1 = beat.Editor.draft().bars[0].length;
  pal[3].fire("click");   // 替换选中块
  eq(beat.Editor.draft().bars[0].length, n1, "★ 手动选中后点击块库 = 替换（长度不变）");
  eq(beat.Editor.draft().bars[0][0].t, 48, "选中块被替换成四分音符（t=48）");
  ok(/点击替换选中/.test(title(els)),
     "★ 替换保留手动选中（软选中只在追加路径产生）→ 标题仍报「替换」");
}

/* ================= 场景 T253e：轨道空白 / 撤销清选中 ================= */
section("T253e 块库 · 轨道空白点击与撤销都清选中（回到追加语义）");
{
  const { beat, els } = loadApp();
  beat.Editor.open();
  const pal = els["palette"].children;
  pal[3].fire("click");   // 先追加一个（软选中）
  const track = trackOf(els, 0);
  track.fire("click", { target: track });
  ok(/点击追加到/.test(title(els)), "点轨道空白 → 取消选中（追加语义）");
  edCellsOf(els, 0)[0].fire("click");   // 手动选中
  ok(/点击替换选中/.test(title(els)), "先手动选中（替换语义）");
  beat.Editor.undo();                   // 栈非空（前面追加推过）→ 清选中
  ok(/点击追加到/.test(title(els)), "★ 撤销清选中 → 回到追加语义");
}
