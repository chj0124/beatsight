/* BeatSight 自动化测试 · 曲式模式的主界面收口（v2.6.3）
   T73 系列。
   ---------------------------------------------------------------------------
   两条用户实拍（同一场连播使用里的连续遭遇）：

   ① 退出曲式后跳段行残留：主界面「◀ 上一段 / 第 2/10 段 · 第 5/120 小节 / 下一段 ▶」
     在**预设模式 + 已停止**下还挂着。原因：argJump 的显隐只在 Arrange.refreshBar 里写，
     而"退出曲式"（点侧栏预设 / 校验失败回退）不经过 Arrange 的任何入口。
     修法：setMode 是 playMode 的唯一写入口（t66 契约），在它上面挂变更钩子
     （onPlayModeChange，装配层注入 Arrange.refreshBar）——模式一变就同步，不可能漏。
     ★ v2.10.14：收口的**呈现面**从「整行 hidden」改为「上/下段键 disabled 置灰」
       （跳段行常显——播放键住进了这一行；#argNowMeta 进度文字已删），
       钩子机制与同步时机不变，T73a/T73c 的断言随之改写（不是回归）。

   ② 曲式播放中，画面与节目单分裂：连播中 S.sel 被外力改写成别的型（旧实现：切成普通轨，
     ensureValidForTrack 把它回退成四分基础），refreshAfterPatternChange 拿 curPattern()
     （= S.sel）去 resyncToNow + 重建画面 → 标题/网格离开节目单，节目单却还在走；侧栏高亮
     与播放内容完全分裂。修法：曲式播放中的取型唯一来源是节目单——arrangePlayPattern()
     （游标处的块），refreshAfterPatternChange 的接续目标与 applyPatternChange 的回退链都改走它。
     v2.9.0：两态轨模型删除，触发源（切轨 → 回退）已不存在，但契约本身仍是红线——
     本组改用「直接改写 S.sel + 走一次刷新入口」复现旧触发条件（与生产无关的纯测试手段）。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 与 t68 同一口径：seedDemo:false 让它真的带出（示例 5 型 + 曲式 + 歌词）。
   v2.9.0：轨模型已删，起跑型与"在哪条轨"无关 */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }),
  { seedDemo: false });
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
/* ★ v3.35.3：歌曲行的点击语义改成了**展开/收起**，整首连播挪到行尾的 ▶。
   故 playAllOf 返回那颗 ▶（而不是歌曲行本身）——语义与 v2.28.0 的"唯一点击入口"一致。 */
const playAllOf = els => {
  const row = boxOf(els).children.find(x =>
    /(^| )preset-item( |$)/.test(x.className) && x.children[0].children[0].textContent === "《在他乡》（示例）");
  return row && row.children.find(x => /(^| )aud( |$)/.test(x.className));
};
/* stub 的 textContent 不聚合子节点（真实 DOM 会），找条目要递归取 */
const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
const itemByName = (els, name) => els["presetList"].children
  .filter(x => /(^| )preset-item( |$)/.test(x.className)).find(x => deepText(x).includes(name));

/* ================= 场景 T73a：退出曲式 → 跳段键立即置灰（图一） =================
   v2.10.14 口径改写：跳段行**常显**（播放键住进了这一行，整行隐藏会把它一起藏掉），
   模式退出的收口从「整行 hidden」改为「上/下段键 disabled 置灰」；
   「第 N/M 段」进度文字（#argNowMeta）已按用户要求删除，清空断言随之退役。 */
section("T73a 曲式退出收口 · ★ 点预设退回单练后，跳段键立即置灰（行常显，播放键不受影响）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);
  beat.Controls.stop();

  /* 前提：曲式模式下跳段键可用（playMode 进 arrange 时经钩子同步过一次） */
  eq(beat.Store.S.playMode, "arrange", "前提：整首连播后是曲式模式");
  eq(els["argJumpPrev"].disabled, false, "前提：曲式模式下「上一段」可用（钩子在进模式时已同步）");
  eq(els["argJumpNext"].disabled, false, "前提：曲式模式下「下一段」可用");

  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "点预设 → 退回预设模式（v2.5.0 契约不变）");
  eq(els["argJumpPrev"].disabled, true, "★ 「上一段」随模式退出立即置灰——不再残留可点状态");
  eq(els["argJumpNext"].disabled, true, "★ 「下一段」同步置灰");
  ok(String(els["argNowName"].textContent).length === 0 || !String(els["argNowName"].textContent).includes("在他乡"),
    "★ 曲式名一并清空（实际「" + els["argNowName"].textContent + "」）");
  eq(els["patternName"].textContent, "四分基础", "标题落在被点的预设上");
}

/* ================= 场景 T73b：曲式播放中的取型唯一来源是节目单（S.sel 拽不走画面）（图二） ================= */
section("T73b 曲式播放中 · ★ 标题/网格只跟节目单游标，与 S.sel 无关");
{
  const { beat, els } = loadDemo();
  beat.Controls.setBpm(240);                       // 1 小节 = 1s，驱动量小一点
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3.5);                            // 走进第 2 段（段长 1/3/4/…，3.5s ≈ 第 4 小节）
  const homeName = els["patternName"].textContent;
  /* ★ v3.36.18：底栏在**曲式模式**下显示的是短名——剥掉尾部「（《歌名》段落）」出处标注
     （见 index.html 的 stripSongTag；胶囊只剩 176px 给段名+型名，长形态 409px 塞不下）。
     契约本身没变（标题 = 节目单游标处的型），只是显示形态短了。换算走**实现导出的同一函数**
     （beat.stripSongTag），不在这抄一份正则——抄了就会与实现各走各的，正是本仓禁的手抄副本。 */
  eq(homeName, beat.stripSongTag((beat.arrangePlayPattern() || {}).name || ""),
    "前提：连播中标题 = 节目单游标处的型（曲式模式显示短名）（实际「" + homeName + "」）");

  /* v2.9.0：轨模型（含 ensureValidForTrack 回退）已删，没法再从 UI 切轨把 S.sel 改写。
     但旧缺陷的触发条件——"S.sel 指向别的型"——仍可由外力制造：直接改写 S.sel，
     再走一次 refreshAfterPatternChange（生产里模式/预设变更都经它）。修复后的契约：
     曲式播放中取型只认节目单，S.sel 怎么变都不拽走画面。 */
  beat.Store.S.sel = { type: "builtin", idx: 1 };   // 四分基础：故意与节目单游标处的型不同
  beat.Presets.refreshAfterPatternChange();
  eq(beat.Store.S.playMode, "arrange", "刷新不动播放模式（S.sel 只是「退回单练后选谁」的数据）");
  const afterName = els["patternName"].textContent;
  eq(afterName, beat.stripSongTag((beat.arrangePlayPattern() || {}).name || ""),
    `★ S.sel 被改写后标题仍是节目单的型（实际「${afterName}」）——旧实现这里变成「四分基础」`);
  ok(afterName !== "四分基础", "★ 画面没有被 S.sel 拽走");
  /* v2.10.16：原「网格仍是曲式窗口口径」的 vizTitle 断言随标题删除退役——
     曲式窗口口径的回归观察面 = T70/T75/T79 的网格内容断言 */

  /* 继续走：节目单照常推进，标题每过一个块都换——证明时间轴没被那次改写拽坏 */
  let sawOther = false;
  for (let k = 0; k < 40 && !sawOther; k++){
    drive(ac, beat, 0.5);
    const nm = els["patternName"].textContent;
    if (nm !== afterName) sawOther = true;
    eq(nm, beat.stripSongTag((beat.arrangePlayPattern() || {}).name || ""),
      `推进中标题始终 = 节目单游标处的型（第 ${k + 1} 步，实际「${nm}」）`);
  }
  ok(sawOther, "★ 节目单继续推进到了别的段/型（没有被 S.sel 改写卡死或拽回）");
  beat.Controls.stop();
}

/* ================= 场景 T73c：曲式播放中点预设 → 立即退回单练（v2.5.0 契约回归） ================= */
section("T73c 曲式播放中点预设 · 退回单练它（对等入口契约在新取型逻辑下仍成立）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  drive(ac, beat, 3);
  itemByName(els, "四分基础").fire("click");

  eq(beat.Store.S.playMode, "preset", "播放中点预设 → 退回预设模式");
  eq(els["patternName"].textContent, "四分基础", "标题立即换成分外被点的型");
  /* v2.10.16：原「网格口径回到预设模式」的 vizTitle 断言随标题删除退役——模式切换本身已由上一条 S.playMode 断言覆盖 */
  eq(els["argJumpPrev"].disabled, true, "★ 跳段键同步置灰（v2.10.14：行常显，收口改为置灰）");
  eq(beat.Store.S.playing, true, "播放不中断（就地接续，不是停了重来）");
  const n0 = ac.hits.length;
  drive(ac, beat, 2);
  ok(ac.hits.length > n0, "退回后继续按四分基础发声");
  eq(els["patternName"].textContent, "四分基础", "接续后标题稳定");
  beat.Controls.stop();
}

/* ================= 场景 T73d（v3.12.0 重写）：拍号控件删除后的语义 =================
   原始缺陷（v2.42.5 修）：整首连播《在他乡》时点 2/4/3/4，音符格子画出网格框架叠上侧栏——
   曲式按 4/4 逐格授权（扫弦谱 16 格/小节、歌词锚点同源），切拍号后渲染层拿 2/4 的行跨度
   （barTicks = vizSig×TPB = 8）去切 16 tick 的谱面，sliceSteps 的 K=1 档原样放行全部步进，
   第 9–16 格的 left 落在 100%–200%（桩实测 8 个元素 left>100%）。
   v2.42.5 的修法是**拦截用户点击 + sig-lock 置灰**（治症状）；
   ★ v3.12.0 的修法是**拔掉那个入口**（治根因）：手动拍号控件整块删除，
   界面不再存在任何"把拍号切到与当前型/歌曲不一致"的路径——原缺陷随之无从复发。
   本场景改钉三件事：① 控件确已删除；② 曲式起播仍会把拍号对齐到歌曲（那条对齐守卫还在）；
   ③ 程序性 setSig 出口仍可用（选型/跳段/听辨/试听恢复都靠它）。 */
section("T73d 拍号控件删除 · 曲式起播对齐仍在 + 程序性出口仍可用（v3.12.0）");
{
  const { beat, els } = loadDemo();
  ok(!els["sigRow"], "★★ 前提：拍号控件已删除（桩里取不到 #sigRow）");
  playAllOf(els).fire("click");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1);
  eq(beat.Store.S.playMode, "arrange", "前提：整首连播中");
  eq(beat.Store.S.sig, 4, "★★ 曲式起播仍把拍号对齐到歌曲的 4/4（原 v2.42.5 的起播对齐守卫还在）");
  /* 对照：程序性对齐路径仍放行（选型/跳段/听辨/试听恢复的对齐都走 Controls.setSig 出口） */
  beat.Controls.setSig(2);
  eq(beat.Store.S.sig, 2, "程序性 setSig 仍可用（控件删除只拔掉 UI 入口，不动状态出口）");
  beat.Controls.setSig(4);
  /* 退出曲式（点预设）→ 选型自动对齐拍号 */
  itemByName(els, "四分基础").fire("click");
  eq(beat.Store.S.playMode, "preset", "点预设退回预设模式");
  eq(beat.Store.S.sig, 4, "★ 退回预设后拍号由选中型决定（四分基础 = 4/4）");
  beat.Controls.stop();
}
