/* BeatSight 自动化测试 · 网格 = 歌曲小节上的翻页窗口（v2.5.2 第 Ⅱ 期立窗口，v2.7.0 改翻页档）
   T70 系列。
   ---------------------------------------------------------------------------
   契约（v2.7.0 用户拍板，v2.8.0 req3 起窗口长度可调、本组用默认档 4）：
   网格是**歌曲小节序列上按 N 小节翻页的窗口**（N = 同屏行数档位，默认 4）——
   页内球从第 1 行逐行走到第 N 行（与预设模式同手感），跨页整体翻；
   页内第 N 小节期间，第 1 行临时替换成**下一小节**的内容（预告行，带徽标），
   解决"严格翻页后扫弦内容无法提前准备"的问题。
   （旧档 v2.5.2：逐小节滚动，当前小节恒为第 1 行——球永远在第一行跳，用户实拍否定。）
   ★ 行数档位的可调性另由 T79 系列守（改档位 → 网格与歌词轨一起变）；本组固定用默认 4。

   怎么观测"行内容"（本组的关键手法）：给不同段用**格子数不同**的型——
   四音型每小节 4 格、八音型每小节 8 格。于是"每行有几格"就是那一行属于哪个型的指纹，
   不用去读内部结构。
   ★ 驱动必须**同时**推时钟与调 paintFrame：窗口的重建挂在渲染侧（按可听位置），
     只调 scheduler 不会触发它（那正是"画面别提前跳"的设计要求）。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

/* n 个四分音符一小节 → 每行 n 个格子 */
const mkBars = (n, per) => Array.from({ length: n }, () =>
  Array.from({ length: per }, (_, i) => ({ t: 192 / per })));
/* 主视图每行的格子数（行 = .bar-row，格 = .cell）。与 t47/t62 同一套定位手法 */
const rowCells = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className))
  .map(r => r.children.filter(c => /(^| )cell( |$)/.test(c.className)).length);

/* 起一个曲式：段 A 用「四音型」（4 格/小节）×1 遍，段 B 用「八音型」（8 格/小节）×1 遍。
   → 全曲 8 小节：0-3 = 四音型，4-7 = 八音型。BPM 240 下一小节 1s（50 个 0.02s 驱动步）。 */
function startTwoStages(){
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  const r = beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "四音型", meter: 4, bars: mkBars(4, 4) },
    { name: "八音型", meter: 4, bars: mkBars(4, 8) },
  ] }));
  const [p4, p8] = beat.Store.customs.slice(-2);
  const v = beat.Store.upsertArrange({ name: "两段窗测试", sections: [
    { name: "A", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: p8.id }, repeats: 1 }] },
  ] });
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 1, loop: true };
  beat.setMode("playMode", "arrange", "测试");
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  return { beat, els, ac: FakeAudioContext.last, id: v.id };
}
/* 推 n 个 0.02s：时钟 + 调度 + **渲染**（窗口重建在渲染侧） */
function step(beat, ac, n){
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
  }
}
/* 命中数：统计 [a,b) 时间里落到音频时钟上的发声（与 t68 同一口径） */
const inWin0 = (ac, a, b) => ac.hits.filter(h => h.t >= a - 1e-6 && h.t < b - 1e-6).length;

/* ================= 场景 T70a：窗口按 4 小节翻页 + 页末预告行 ================= */
section("T70a 翻页窗口 · 页内窗口不动（球逐行走），页末第 1 行换预告，跨页整体翻");
{
  const { beat, els, ac } = startTwoStages();
  step(beat, ac, 2);
  eq(beat.Store.S.playing, true, "前提：曲式播放中");
  eq(rowCells(els).length, 4, "★ 网格 4 行（默认档的窗口长度）");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "第 1 小节起：四行 = 第 1-4 小节");

  step(beat, ac, 60);                       // 走过第 1 小节（1s = 50 步）→ 第 2 小节
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "★ 翻页档：第 2 小节窗口**不动**（球走到第 2 行）——旧滚动档这里末行已被换成第 5 小节");

  step(beat, ac, 50);                       // → 第 3 小节
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "第 3 小节窗口仍不动（球走到第 3 行）");

  step(beat, ac, 50);                       // → 第 4 小节（页内最后一行）→ 预告行生效
  eq(JSON.stringify(rowCells(els)), JSON.stringify([8, 4, 4, 4]),
     "★ 页内第 4 小节：第 1 行临时替换成**下一小节**（八音型预告），球在第 4 行");

  step(beat, ac, 50);                       // → 第 5 小节 → 翻页
  eq(JSON.stringify(rowCells(els)), JSON.stringify([8, 8, 8, 8]),
     "★ 翻到第二页：四行 = 第 5/6/7/8 小节（预告内容原地转正为第 1 行）");
  beat.Controls.stop();
}

/* ================= 场景 T70b：状态栏报的是歌曲小节号 ================= */
section("T70b 滚动窗口 · 状态栏报歌曲小节号（不是「第几行」）");
{
  const { beat, els, ac } = startTwoStages();
  step(beat, ac, 2);
  ok(/第 1 小节/.test(els["statusText"].textContent), "起播时报第 1 小节（实际「" + els["statusText"].textContent + "」）");
  step(beat, ac, 60);
  ok(/第 2 小节/.test(els["statusText"].textContent),
     "★ 滚到第 2 小节时报「第 2 小节」——若报的是行号会永远显示第 1 小节（实际「" + els["statusText"].textContent + "」）");
  step(beat, ac, 100);
  ok(/第 [45] 小节/.test(els["statusText"].textContent),
     "进第二段后继续跟着涨（实际「" + els["statusText"].textContent + "」）");
  beat.Controls.stop();
}

/* ================= 场景 T70c：预设模式不受影响 ================= */
section("T70c 滚动窗口 · 预设模式仍画「这个型」（行数 = 型的小节数，内容不跨型取）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  eq(beat.Store.S.playMode, "preset", "前提：预设模式（默认）");
  /* 内置四分基础：4 小节 × 4 格 */
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]), "4 小节的型 → 4 行、每行 4 格");
  /* 换成 1 小节的型 → 只有 1 行（型本身就是这样，不是滚动窗口的 4 行） */
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一小节", meter: 4, bars: mkBars(1, 4) }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  eq(rowCells(els).length, 1, "★ 预设模式下 1 小节的型就画 1 行（窗口只在曲式模式下生效）");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4]), "内容是这个型本身，不跨型取");
  beat.Controls.stop();
}

/* ================= 场景 T70e：卡片标题跟着窗口报歌曲小节范围 ================= */
section("T70e 翻页窗口 · 卡片标题报「歌曲第 N-M 小节」并随翻页换页");
{
  const { beat, els, ac } = startTwoStages();
  step(beat, ac, 2);
  ok(/歌曲第 1-4 小节/.test(els["vizTitle"].textContent),
     "★ 起播时标题 = 歌曲第 1-4 小节（实际「" + els["vizTitle"].textContent + "」）");
  step(beat, ac, 60);
  ok(/歌曲第 1-4 小节/.test(els["vizTitle"].textContent),
     "页内行进不换标题（实际「" + els["vizTitle"].textContent + "」）");
  step(beat, ac, 150);                       // 进到第 5 小节 → 翻页
  ok(/歌曲第 5-8 小节/.test(els["vizTitle"].textContent),
     "★ 翻页后标题换页（实际「" + els["vizTitle"].textContent + "」）");
  beat.Controls.stop();
  /* 预设模式下标题报的是"同屏 N 小节"（N = 型的小节数），不再写死 4 */
  const p = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  ok(/同屏 4 小节/.test(p.els["vizTitle"].textContent),
     "预设模式：同屏 4 小节（4 小节的型）");
}

/* ================= 场景 T70f：静音拍改按「乐句位置」判（1 小节的型才有意义） ================= */
section("T70f 滚动窗口 · 静音拍按乐句位置（每 4 小节静第 4 小节），不再按「型内最后一小节」");
{
  /* 1 小节的型：旧判据（schedBar === 型长-1）会把它**每个小节**都判成最后一小节 → 整段静音。
     新判据按线性乐句位置，1 小节的型每 4 遍静一次 —— 这才是"每 4 小节静音第 4 小节"。 */
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一小节", meter: 4, bars: mkBars(1, 4) }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Store.S.mute = true;
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 96BPM → 一小节 2.5s、首音 0.08s。驱动 4 小节（10s）。
     ★ 同时推 paintFrame，并在驱动途中采样状态栏（静音那一遍要说明"为什么没声音"） */
  let muteStatus = "";
  for (let i = 0; i < 500; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (/静音拍/.test(els["statusText"].textContent)) muteStatus = els["statusText"].textContent;
  }
  eq(inWin0(ac, 0.08, 2.58), 4, "第 1 遍（第 1 小节）4 声——旧判据下这里会是 0");
  eq(inWin0(ac, 2.58, 5.08), 4, "第 2 遍 4 声");
  eq(inWin0(ac, 5.08, 7.58), 4, "第 3 遍 4 声");
  eq(inWin0(ac, 7.58, 10.08), 0, "★ 第 4 遍被静音（每 4 小节静一次）——乐句相位判据生效");
  beat.Controls.stop();
  ok(/静音拍/.test(muteStatus),
     "★ 走到被静音的那一遍时状态栏写「静音拍 · 心中默数」（实测「" + (muteStatus || "未采样到") + "」）");
}
/* ================= 场景 T70d：窗口合成不出来时回落画当前型 ================= */
section("T70d 滚动窗口 · 窗口里的小节解析不出来时回落画当前型（不崩、不画半屏错内容）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  /* 段 B 引用一个**不存在**的型（结构校验拦不住：id 非空、类型合法，只有解析才知道它没了）。
     窗口合成时会撞上它 → 必须整体回落到"画当前型"，而不是画半屏或抛异常 */
  const v = beat.Store.upsertArrange({ name: "坏引用", sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1 }] },
    { name: "B", blocks: [{ ref: { type: "custom", id: "根本没有这个型" }, repeats: 1 }] },
  ] });
  ok(!!v, "前提：曲式能存进去（引用是否存在不在结构校验的职责里）");
  ok(beat.arrangeProblems(v).length > 0, "前提：arrangeProblems 确实报出了坏引用");
  beat.Store.S.arrangeSel = { id: v.id, from: 0, to: 1, loop: false };
  beat.setMode("playMode", "arrange", "测试");
  beat.Presets.refreshAfterPatternChange();          // 停止态：applyPatternChange → buildViz
  const cells = rowCells(els);
  ok(cells.length > 0, "★ 网格照常渲染出内容（不是空白页）");
  ok(cells.every(n => n > 0), "★ 每一行都有格子（没有半屏空行）");
  eq(cells.length, 4, "回落到「画当前型」：行数 = 当前型的小节数（内置四分基础 = 4）");
  beat.Controls.stop();
}

/* ================= 场景 T70g：示例曲实拍 —— 跨段处四行真的不同 ================= */
section("T70g 滚动窗口 · 示例曲逐小节谱：同一屏里出现不同的型（用户最初报的那个问题）");
{
  /* 判据用**每行的扫弦箭头数**（= 该行属于哪个型）：5 个型各是 16 格谱，
     但标记数不同 —— P1=16、P2=14、P3=14、P4=10、P5=16。于是"箭头数"就是型的指纹。 */
  const { beat, els } = loadApp(undefined, { seedDemo: false });
  eq(beat.Store.customs.length, 5, "前提：示例曲的 5 个单小节型已带出");
  const arrowsOf = () => els["viz"].children
    .filter(el => /(^| )bar-row( |$)/.test(el.className))
    .map(r => {
      const layer = r.children.find(c => /(^| )strums( |$)/.test(c.className));
      return layer ? layer.children.length : 0;
    });
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: beat.DEMO_ID, from: 0, to: 9, loop: true };
  beat.Controls.setBpm(240);                     // 一小节 1s → 好算
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 0 基歌曲小节 → 型（逐小节谱）：
     0=P1 | 1-8=P2 | 9=P1 | 10-15=P3 | 16-19=P5 | 20-21=P3 | 22-28=P4 | 29=P1 */
  eq(JSON.stringify(arrowsOf()), JSON.stringify([16, 14, 14, 14]),
     "第 1 小节起：四行 = 第 0-3 小节（P1 起头，接着三个 P2）");

  /* ★ 取样点一：第 8 小节（第 0 基）—— 这一屏同时装着 P2 与 P1、并跨进 P3：
     这正是 v2.6.0 之前做不到的（那时四行恒是同一个型的四份拷贝，窗口里放不下第二种型） */
  step(beat, ac, 420);                           // 约 8.4s → 进入第 9 个小节（0 基 8）
  eq(JSON.stringify(arrowsOf()), JSON.stringify([14, 16, 14, 14]),
     "★ 第 8 小节起：四行 = P2 / P1 / P3 / P3 ——**同一屏里出现了三种型**");
  ok(new Set(arrowsOf()).size > 1, "★★ 四行不再整齐划一（这就是「4 小节都是同一节奏型」被解决的样子）");

  /* ★ 取样点二：第 28 小节 —— 窗口越过曲尾后**绕回开头**（P4 / P1 / P1 / P2）。
     「绕回」是刻意的：让人提前看到"接下来回到哪"，标题也会如实说明 */
  step(beat, ac, 1000);                          // 约 28.4s → 第 29 个小节（0 基 28）
  eq(JSON.stringify(arrowsOf()), JSON.stringify([10, 16, 16, 14]),
     "★ 第 28 小节起：四行 = P4 / P1 / P1 / P2（跨曲尾绕回开头）");
  beat.Controls.stop();
}

/* ================= 场景 T70h：重新播放时窗口回到播放范围起点 ================= */
section("T70h 翻页窗口 · 重新播放要把窗口拨回起点（v2.6.0 修，真实浏览器发现）");
{
  const { beat, els, ac } = startTwoStages();
  step(beat, ac, 220);                           // 翻过页（4.4s → 第 5 小节）
  ok(/歌曲第 5-8 小节/.test(els["vizTitle"].textContent),
     "前提：窗口已翻离起点（实际「" + els["vizTitle"].textContent + "」）");
  beat.Controls.stop();
  beat.Controls.start();                         // 重新按播放
  step(beat, ac, 2);
  ok(/歌曲第 1-4 小节/.test(els["vizTitle"].textContent),
     "★ 重新播放 → 窗口回到播放范围起点（实际「" + els["vizTitle"].textContent + "」）");
  /* 为什么它不是"顺手加的断言"：winStart 是**跨播放会话留存**的状态，
     而开播 / 重锚 / 循环区间变更 / 上下文重建这四处都会把调度游标拨回范围起点——
     窗口不跟着丢弃，重新播放就会停在上次听到的地方，与声音对不上。
     （这条是真实浏览器实拍出来的：起播四行指纹本该 [16,14,14,14]，实测 [14,14,14,14]。） */
  eq(JSON.stringify(rowCells(els).length), "4", "窗口仍为默认 4 行");
  beat.Controls.stop();
}
