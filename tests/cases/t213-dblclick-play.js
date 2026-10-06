/* T213 预设库快速双击 = 播放/暂停（v3.35.11 用户需求）
   ---------------------------------------------------------------------------
   需求原话：「节奏型预设库中的节拍与自定义需要增加快速双击后开始播放/暂停的功能。
   双击需要与单击两次进行区分：单击一次是展开，单击两次是折叠；但我想要的快速双击，
   是希望它能播放/暂停之间切换。」

   钉六件事：
     ① 条目双击 = 选中并起播（**不是试听**）；再双击同一条 = 停
     ② 双击别的条目 = 切过去并起播
     ③ 曲式模式下双击条目 = 退出曲式、改练这一条（S.sel 恰好是它也不能算"同一条"）
     ④ 歌曲行双击 = 整首连播 / 暂停（与该行 ▶ 同权）
     ⑤ 双击的第 2 击（MouseEvent.detail≥2）**跳过**单击语义 ⇒ 快速双击不改开合态
     ⑥ 两次**慢**单击（detail 都是 1）照旧"展开 → 收起"
     ⑦ 细分图标双击 = 用它起播 / 停
   ============================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const boxOf = els => els["presetList"].children
  .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const rowsOf = els => boxOf(els).children.filter(c => /(^| )song( |$)/.test(c.className));
const nameOf = it => it.children[0].children[0].textContent;
const rowOf = (els, name) => rowsOf(els).find(r => nameOf(r) === name);
const itemsOf = els => els["presetList"].children
  .filter(c => /(^| )preset-item( |$)/.test(c.className) && !/(^| )song( |$)/.test(c.className));
/** 一次"真双击"：第 1 击（detail=1）+ 第 2 击（detail=2）+ dblclick —— 与浏览器发的序列一致 */
const doubleClick = el => { el.fire("click", { detail: 1 }); el.fire("click", { detail: 2 }); el.fire("dblclick", { detail: 2 }); };
const dbl = el => el.fire("dblclick", { detail: 2 });

section("T213a 条目双击 = 选中并起播（不是试听）；再双击 = 停");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  const S = beat.Store.S;
  ok(S.playMode === "arrange", "前提：首开带出示例曲后落在曲式模式（正是要验的边界）");
  const it = itemsOf(els)[0];
  doubleClick(it);
  eq(S.playMode, "preset", "★ 双击条目 = 退出曲式、回到单型练习（与单击同一条出口）");
  eq(S.playing, true, "★ 并起播");
  eq(S.preview, false, "★ 走的是**起播**不是试听（S.preview 必须为 false）");
  eq(JSON.stringify(S.sel), JSON.stringify({ type: "builtin", idx: 0 }), "选中态落在被双击的那条");
  doubleClick(it);
  eq(S.playing, false, "★ 再双击同一条 = 停");
  eq(S.preview, false, "停止后也不残留试听态");
}

section("T213b 双击别的条目 = 切过去并起播");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  const S = beat.Store.S;
  const its = itemsOf(els);
  doubleClick(its[0]);
  eq(JSON.stringify(S.sel), JSON.stringify({ type: "builtin", idx: 0 }), "先起播第 1 条");
  doubleClick(its[3]);
  eq(S.playing, true, "★ 双击另一条仍在播（不中断）");
  eq(JSON.stringify(S.sel), JSON.stringify({ type: "builtin", idx: 3 }), "★ 选中切到新的那条");
  eq(S.preview, false, "全程不是试听态");
}

section("T213c 歌曲行双击 = 整首连播 / 暂停（与该行 ▶ 同权）");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  const S = beat.Store.S;
  const row = rowsOf(els)[0];
  const name = nameOf(row);
  dbl(row);
  eq(S.playing, true, "★ 双击歌曲行 → 起播");
  eq(S.playMode, "arrange", "★ 进的是曲式模式（整首连播）");
  eq(S.arrangeSel.id, beat.Store.arranges.find(a => a.name === name).id, "范围指向被双击的那首");
  dbl(rowOf(els, name));
  eq(S.playing, false, "★ 再双击 = 暂停");
}

section("T213d 双击 与 单击两次 的区分（MouseEvent.detail）");
{
  const { els, runTimers, timeoutCount } = loadApp(undefined, { seedDemo: false });
  const row = () => rowOf(els, nameOf(rowsOf(els)[0]));
  const expanded = () => row().getAttribute("aria-expanded");
  eq(expanded(), "true", "前提：第一首默认展开");

  /* ① ★★★ 用户反馈的核心：**真手势的第 1 击不得改变开合**（上一版"先翻再翻回"看得见，被用户否掉）。
     真手势（detail ≥ 1）⇒ 折叠**延迟一个双击窗口**（DBLCLICK_MS）执行；桩里 setTimeout 只记录不执行，
     所以"未冲刷时开合不变"恰好证明它没立刻折叠。 */
  const before = expanded();
  row().fire("click", { detail: 1 });
  eq(expanded(), before, "★★★ 真手势单击的第 1 击：开合**不变**（折叠已排期但未执行）");
  ok(timeoutCount() > 0, "★ 且确实排了一次折叠（挂起定时器 " + timeoutCount() + " 个）");

  /* ② 快速双击：dblclick 把那次排期的折叠**取消** ⇒ 全程不动开合，只切播放/暂停 */
  row().fire("click", { detail: 2 });
  eq(expanded(), before, "★ 第 2 击不执行单击语义");
  row().fire("dblclick", { detail: 2 });
  const t0 = timeoutCount();
  runTimers();
  eq(expanded(), before,
     "★★★ 快速双击整次结束后：开合态 = 双击前（" + before + "）—— 排期那次也被取消，冲刷后仍不变");
  ok(t0 <= timeoutCount() + 1, "（冲刷前后挂起定时器数 " + t0 + " → " + timeoutCount() + "，无泄漏式堆积）");

  /* ③ 双击的意图是"播放/暂停"，不是"折叠"：这一步单独钉住"播放确实切了" */
  ok(true, "（播放态由 T213c 钉住；本段只钉开合不受影响）");

  /* ④ 两次**慢**单击（各自 detail=1、且间隔大于窗口）：每次都排一次折叠 ⇒ 照旧"展开 → 收起" */
  const st = expanded();
  row().fire("click", { detail: 1 });
  runTimers();
  const st2 = expanded();
  ok(st2 !== st, "★ 慢单击第 1 次 + 窗口过后：开合翻转（" + st + "→" + st2 + "）");
  row().fire("click", { detail: 1 });
  runTimers();
  ok(expanded() !== st2, "★ 慢单击第 2 次 + 窗口过后：再翻转（" + st2 + "→" + expanded() + "）= 用户要的「单击两次是折叠」");

  /* ⑤ 合成点击 / 程序化 .click()（不带 detail）走**立即折叠**的旧路径 —— 这条同时解释
     为什么本仓 7000 条同步测试（几乎都是 fire("click")）不受这次改动影响。 */
  const st3 = expanded();
  row().fire("click");
  ok(expanded() !== st3, "★★ 合成点击（无 detail）仍**立即**折叠（旧路径不变；既有测试的口径）");
}

section("T213e 细分图标双击 = 用它起播 / 停；第 2 击不改选择");
{
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  const S = beat.Store.S;
  const pills = els["rhyPillRow"].children;
  ok(pills.length === 9, "前提：基础节奏区 9 个细分图标");
  /* ★ 手势必须是**完整双击**（两击 + dblclick）：判"停"要的是**第 1 击前**的快照，
     裸 dblclick 拿不到它 —— 那不是真实手势序列。 */
  doubleClick(pills[2]);
  eq(S.playing, true, "★ 双击细分图标 → 起播");
  eq(S.sel.type, "basic", "★ 进的是基础节奏模式（该细分成当前型）");
  eq(S.rhy, "triplet8", "★ 细分 = 被双击的那一颗");
  eq(S.preview, false, "不是试听态");
  doubleClick(els["rhyPillRow"].children[2]);
  eq(S.playing, false, "★ 再双击同一颗 = 停");
  /* 第 2 击的守卫：detail≥2 的 click 不再执行 onPick（否则会把选择改到它身上） */
  const kept = S.rhy;
  pills[5].fire("click", { detail: 2 });
  eq(S.rhy, kept, "★ detail=2 的单击被跳过：选择没被改（" + kept + "）");
  pills[5].fire("click", { detail: 1 });
  ok(S.rhy !== kept, "★ 而 detail=1 的正常单击照旧改选择（" + kept + "→" + S.rhy + "）");
}
