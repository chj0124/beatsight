/* BeatSight 自动化测试 · v2.8.0 req3 同屏行数档位（扫弦网格窗口与歌词轨共用）
   T79 系列。
   ---------------------------------------------------------------------------
   用户原话：「扫弦和歌词显示的行数改为可选择的，比如可调整为歌词两行，扫弦两行。」
   设计定调（用户拍板）：
     · **共用一个档位**——两轨是同一根时间轴上的上下两层，共用一个数才能逐行对齐
       （若各设一档，只要两轨行数不一致就立刻错行）；
     · 值域 1 / 2 / 3 / 4，默认 4（= 旧口径「同屏 4 小节」，老用户升级后逐位不变）。
   契约：
     · 档位 = 网格的**窗口长度**（arrWinBars 的唯一来源 S.vizRows），网格与歌词轨同源；
     · ★ **两种模式都生效**（v2.10.2 行为变更）：N 恒等于网格行数——
       曲式模式下窗口 = 歌曲的 N 个连续小节；预设模式下窗口 = 当前型的 N 个连续小节位
       （型短于 N 绕回重复铺满 N 行，型长于 N 按 N 行翻页）。
       v2.8.0~v2.10.1 只对曲式窗口与歌词轨生效，预设模式画"型的全部小节"
       ——那让档位按钮在预设模式下点下去毫无反应（用户实拍：「行数按钮在一些情形中无效」）；
     · 加载走白名单（VIZ_ROW_COUNTS），脏值/越界回落到 4；
     · 改档位是用户视图偏好，进热键载荷（beatsight.state）。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* n 个四分音符一小节 → 每行 n 个格子（与 t70 同一手法） */
const mkBars = (n, per) => Array.from({ length: n }, () =>
  Array.from({ length: per }, (_, i) => ({ t: 192 / per })));
/* 主视图每行的格子数（行 = .bar-row，格 = .cell） */
const rowCells = els => els["viz"].children
  .filter(el => /(^| )bar-row( |$)/.test(el.className))
  .map(r => r.children.filter(c => /(^| )cell( |$)/.test(c.className)).length);
/* 档位按钮（Controls.syncRowsUI 经 buildPillRow 生成，天然带 data-rows=N） */
const rowsPills = els => els["vizRowsRow"].children.filter(c => c.dataset.rows !== undefined);
const rowsPill = (els, n) => rowsPills(els).find(c => c.dataset.rows === String(n));

/* 曲式 = 一段 ×8 遍的一小节型（8 个歌曲小节），段内第 1 / 第 2 小节各一个字
   —— 歌词轨因此每屏都有字（否则整轨收起，行数断言无从谈起）。
   BPM 240 → 一小节 1s（50 个 0.02s 驱动步）。 */
function setup(){
  const app = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  const { beat } = app;
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "一板", meter: 4, bars: mkBars(1, 4) }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t79", name: "八小节歌", sections: [
    { name: "唯一段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 8 }] },
  ] });
  /* v2.26.0：段 uid 由 normArrange 补发（动态），按位置现取 */
  const u79 = i => beat.Store.findArrange("t79").sections[i].uid;
  beat.Store.upsertLyric("t79", u79(0), [{ t: 0, dur: 24, ch: "一" }, { t: 192, dur: 24, ch: "二" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t79", from: 0, to: 7, loop: true };
  beat.Controls.setBpm(240);
  beat.Presets.refreshAfterPatternChange();       // 停止态：applyPatternChange → buildViz
  return app;
}
/* 推 n 个 0.02s：时钟 + 调度 + **渲染**（窗口重建挂在渲染侧，必须一起推） */
function step(beat, ac, n){
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
  }
}

/* ================= 场景 T79a：档位 = 窗口长度，arrWinBars 现读 S.vizRows ================= */
section("T79a 档位即窗口长度 · arrWinBars() 与 S.vizRows 同一真相源，默认 4");
{
  const { beat } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  eq(beat.Store.S.vizRows, 4, "默认档 = 4（旧口径「同屏 4 小节」，老用户升级后逐位不变）");
  eq(beat.Viz.arrWinBars(), 4, "arrWinBars() 现读 S.vizRows（不是写死的常量）");
  beat.Store.S.vizRows = 2;
  eq(beat.Viz.arrWinBars(), 2, "★ 改 S.vizRows → arrWinBars 立刻跟着变（运行期可调的前提）");
}

/* ================= 场景 T79b：档位选择器（值表生成的 pill 行） ================= */
section("T79b 档位选择器 · 一行 pill 由 VIZ_ROW_COUNTS 生成、带 data-rows、选中态跟着 S.vizRows");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  const pills = rowsPills(els);
  eq(pills.length, 4, "四个档位按钮（值域 1-4 由值表生成，不在标记里写死）");
  eq(pills.map(p => p.dataset.rows).join(","), "1,2,3,4", "每个按钮带 data-rows=N（测试与样式按档位定位）");
  eq(pills.map(p => p.textContent).join(","), "1 行,2 行,3 行,4 行", "文案 = 「N 行」（含单位，读写都不歧义）");
  eq(pills.filter(p => p.classList.contains("active")).map(p => p.dataset.rows).join(","), "4",
     "默认档 4 高亮（初始选中态来自已加载的 S.vizRows）");
  eq(rowsPill(els, 2).getAttribute("aria-pressed"), "false", "未选中档 aria-pressed=false（无障碍）");
  rowsPill(els, 2).fire("click");
  eq(beat.Store.S.vizRows, 2, "★ 点「2 行」→ S.vizRows = 2");
  eq(rowsPill(els, 2).getAttribute("aria-pressed"), "true", "★ 选中态立刻刷新到「2 行」");
  eq(rowsPill(els, 4).getAttribute("aria-pressed"), "false", "旧档取消选中");
}

/* ================= 场景 T79c：加载校验（白名单，脏值一律不可信） ================= */
section("T79c 加载校验 · 脏值 / 越界走白名单回落到默认 4");
{
  eq(loadApp(seedState({ vizRows: 9 })).beat.Store.S.vizRows, 4, "越界 9 → 4");
  eq(loadApp(seedState({ vizRows: 0 })).beat.Store.S.vizRows, 4, "0（不在白名单）→ 4");
  eq(loadApp(seedState({ vizRows: "x" })).beat.Store.S.vizRows, 4, "非数脏值 → 4");
  eq(loadApp(seedState({ vizRows: 3 })).beat.Store.S.vizRows, 3, "合法非默认档 3 → 3（照读）");
  eq(loadApp(seedState({ vizRows: 1 })).beat.Store.S.vizRows, 1, "下限档 1 → 1");
}

/* ================= 场景 T79d：预设模式同样受档位控制（v2.10.2 行为变更） ================= */
section("T79d 预设模式同样受档位控制 · 这就是用户报「行数按钮无效」的那条路径");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 }, vizRows: 2 }));
  eq(beat.Store.S.playMode, "preset", "前提：预设模式（默认）");
  eq(beat.Store.S.vizRows, 2, "档位已置 2");
  /* 内置四分基础是 4 小节的型；4 行档恰好看满，2 行档则是"第 1-2 小节"这一页 */
  eq(rowCells(els).length, 2, "★ 预设模式也画 2 行（窗口化后档位在两模式下都生效）");
  /* v2.10.16：原这里有一条 vizTitle「同屏 2 小节」断言，随标题删除退役——行数断言已覆盖 */
  /* ★ 这就是用户报的原始症状：点档位 → 画面行数真的跟着变（修复前恒为 4 行） */
  rowsPill(els, 4).fire("click");
  eq(rowCells(els).length, 4, "★★ 点「4 行」→ 预设模式网格立刻变 4 行（修复前这里恒为 4，看不出任何变化）");
  rowsPill(els, 1).fire("click");
  eq(rowCells(els).length, 1, "★★ 点「1 行」→ 只剩 1 行（档位是网格行数的唯一真相源）");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4]), "内容的 4 格不变：换的是窗口，不是型");
}

/* ================= 场景 T79e：改档位 → 网格与歌词轨一起重建（两轨共用同源） ================= */
section("T79e 曲式模式 · 改档位同步重建网格与歌词轨，标题按新窗口长度报区间");
{
  const { beat, els } = setup();
  eq(rowsPills(els).length, 4, "前提：档位按钮已生成");
  eq(rowCells(els).length, 4, "起始：曲式窗口默认 4 行");
  eq(beat.Viz.internals().lyricRows.length, 4, "起始：歌词轨同样 4 行（两轨共用档位）");

  rowsPill(els, 2).fire("click");
  eq(beat.Store.S.vizRows, 2, "★ 切到 2 行档");
  eq(rowCells(els).length, 2, "★★ 网格同步重建为 2 行");
  eq(beat.Viz.internals().lyricRows.length, 2, "★★ 歌词轨同步重建为 2 行（两轨行数同源）");
}

/* ================= 场景 T79f：播放中改档位后窗口按新长度翻页 ================= */
section("T79f 播放中 · 按新档位翻页（2 行档每 2 小节翻一次），行界判据与网格同口径");
{
  const { beat, els } = setup();
  rowsPill(els, 2).fire("click");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  step(beat, ac, 2);
  eq(rowCells(els).length, 2, "★ 起播窗口 = 2 行（v2.10.16：原「歌曲第 1-2 小节」标题断言随标题删除退役）");
  step(beat, ac, 130);                            // 跨过第 2 小节边界（起播有 ~0.2s 偏移，首小节约 60 步）→ 翻页
  eq(rowCells(els).length, 2, "★ 播过 2 小节 → 窗口按 2 行档翻页（行数不变，翻页看内容更替）");
  eq(beat.Viz.internals().lyricRows.length, 2, "翻页后歌词轨仍与网格同行数（2 行）");
  beat.Controls.stop();
}

/* ================= 场景 T79g：档位进热键载荷（用户视图偏好） ================= */
section("T79g 持久化 · 档位写进热键 beatsight.state（下次打开还看同样的行数）");
{
  const { beat, els, storage } = setup();
  rowsPill(els, 3).fire("click");
  beat.Store.flush();                             // 热键是尾部防抖，断言前必须落盘（同 T24/T48）
  const raw = storage.get("beatsight.state") || "{}";
  eq(JSON.parse(raw).vizRows, 3, "★ 载荷带 vizRows=3（用户视图偏好，跟热键走）");
  const app = loadApp(seedState({ vizRows: 3 }));
  eq(app.beat.Store.S.vizRows, 3, "★ 带 vizRows=3 重新加载 → 档位照读（跨会话留存）");
}

/* ================= 场景 T79h：曲式 + 1 行档 ⇒ 不做预告行（v2.10.3 修） ================= */
section("T79h 曲式 + 1 行档 · 预告行不成立：行内容 = 当前小节、格子照常有 .active（白填充的前提）");
{
  /* 用户实拍症状：「播放自定义整首连播时，小球正常滚动，但格子里的白色动画不会自动填满」。
     根因在预告行的判据：`k === winAnchor(k) + N - 1` 在 **N = 1** 时恒成立
     （winAnchor(k) = floor(k/1)*1 = k），于是曲式模式下唯一那一行每帧都被当成「未来」：
       ① 内容换成下一小节；② 整行加 .preview-row（降权 55%）；
       ③ setCell 的 isPreview 豁免让它**永远拿不到 .active / .played**。
     而白色填充的底色只长在 `.cell.played .fill` / `.cell.active .fill` 上
     （`.cell .fill` 本身是 background:transparent）→ 帧内每帧写入的 scaleX(进度) 全部不可见。
     球不受影响，因为 paintBall 走自己的 onsetBuf/onsetNext，与「格子 class + CSS」这条链无关
     ——「只有半边坏」正是这个 bug 最难自查的地方，所以下面把三条症状都钉住。

     ★ 观测手法与 T70g 同一套：**格子数 = 型的指纹**。四格型 / 八格型一眼分得出那一行
       属于哪个小节，不用去读内部结构。
     ★ 反向验证（回退修复后这三条必须变红，实测具名 ✗ 3 条）：
       · 把守卫退回 `arrWinBars() < 1`（= 删掉它）→ 「全程没有预告行」实际 260、
         「每帧恰有 1 个 .active 格」实际 0、「行内容 = 当前可听小节」实际 56；
       · 把守卫放宽到 `< 3`（连 2 行档一起吃掉）→ 只有下面那条对照组变红。
       注意后一条：**T75（预告行）拦不住它**——T75 全程用默认 4 行档，
       "N≥2 仍要预告" 这个边界只由本组的对照组钉住。 */
  const buildSong = rowsN => {
    const app = loadApp(seedState({ sel: { type: "builtin", idx: 1 }, vizRows: rowsN }));
    const { beat, els } = app;
    beat.Store.importPresets(JSON.stringify({ presets: [
      { name: "四格", meter: 4, bars: mkBars(1, 4) },
      { name: "八格", meter: 4, bars: mkBars(1, 8) },
    ] }));
    const [p4, p8] = beat.Store.customs.slice(-2);
    /* 小节 0-1 = 四格型；小节 2-5 = 八格型（全曲 6 小节，范围循环） */
    const arr = beat.Store.upsertArrange({ name: "一行档曲式", sections: [
      { name: "A", blocks: [{ ref: { type: "custom", id: p4.id }, repeats: 2 }] },
      { name: "B", blocks: [{ ref: { type: "custom", id: p8.id }, repeats: 4 }] },
    ] });
    beat.Store.S.playMode = "arrange";
    beat.Store.S.arrangeSel = { id: arr.id, from: 0, to: 5, loop: true };
    beat.Controls.setBpm(240);                     // 一小节 1s = 50 个 0.02s 驱动步
    beat.Presets.refreshAfterPatternChange();
    return { beat, els, arr };
  };
  /* 逐帧同时推时钟、调度与渲染（窗口重建挂在渲染侧，只推 scheduler 不会触发）。
     判据一律落在**当前行**（带 .current 的那一行，由 repaintCells 按本帧 bar 打上）：
       · 它必须恰有 1 个 .active 格 —— 白色填充（.cell.active .fill）能不能显示的前提；
       · 它的格子数必须 = 当前**可听**小节的指纹（4 / 8 格）——即"行内容跟得上球"。
     两档共用同一套判据，于是"1 行档坏了、2 行档没坏"这件事是被同一条尺子量出来的。 */
  const runFrames = (beat, els, ac, arr, n) => {
    const view = { framesAll: 0, frames: 0, active1: 0, preview: 0, mismatch: 0, kinds: new Set() };
    for (let i = 0; i < n; i++){
      ac.currentTime += 0.02;
      beat.AudioEngine.scheduler();
      beat.Viz.paintFrame();
      const rs = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
      if (!rs.length) continue;
      view.framesAll++;
      if (rs.some(r => r.classList.contains("preview-row"))) view.preview++;
      const cur = rs.findIndex(r => r.classList.contains("current"));
      if (cur < 0) continue;                       // 还没进入播放（无 .current 行）：不计入
      const cells = rs[cur].children.filter(c => /(^| )cell( |$)/.test(c.className));
      view.frames++;
      view.kinds.add(cells.length);
      if (cells.filter(c => c.classList.contains("active")).length === 1) view.active1++;
      const p = beat.Viz.audibleArrangePos();
      if (p && cells.length !== ((beat.songBarBefore(arr, p.sec) + p.bar) < 2 ? 4 : 8)) view.mismatch++;
    }
    return view;
  };

  /* ---- 1 行档：预告行必须整体关闭 ---- */
  const one = buildSong(1);
  eq(rowCells(one.els).length, 1, "前提：1 行档下网格只有 1 行");
  eq(JSON.stringify(rowCells(one.els)), JSON.stringify([4]), "停机锚在播放范围起点（小节 0 = 四格型）");
  one.beat.Controls.start();
  const v1 = runFrames(one.beat, one.els, FakeAudioContext.last, one.arr, 260);
  one.beat.Controls.stop();
  eq(v1.framesAll, 260, "驱动了 260 帧（≈5.2s，跨 5 个小节）");
  eq(v1.preview, 0,
     "★★ 1 行档全程没有预告行（修复前 260/260 —— 这正是「唯一那行被当成未来」的源头）");
  ok(v1.frames >= 250, "有效采样帧 ≥250（帧数够多，下面的恒等式不是空转）");
  eq(v1.active1, v1.frames,
     "★★ 每帧恰有 1 个 .active 格（只有 .cell.active .fill 才有白底；修复前恒为 0 → 填充不可见）");
  eq(v1.mismatch, 0,
     "★★ 每帧行内容 = 当前可听小节（修复前整屏是下一小节，指纹与节目单差一小节）");
  ok(v1.kinds.has(4) && v1.kinds.has(8),
     "★ 全程两种型都出现过（4 格 / 8 格都命中，本场景不是「只撞上一种型」的假绿）");

  /* ---- 对照：守卫只能吃掉 N=1，N≥2 的预告行一字不动 ---- */
  const two = buildSong(2);
  eq(rowCells(two.els).length, 2, "前提：2 行档下网格 2 行");
  two.beat.Controls.start();
  const v2 = runFrames(two.beat, two.els, FakeAudioContext.last, two.arr, 260);
  two.beat.Controls.stop();
  ok(v2.preview > 0, "★★ 2 行档照旧出现预告行（修复只关掉 N=1，没把预告机制一起关掉）");
  eq(v2.active1, v2.frames, "2 行档每帧同样恰有 1 个 .active 格（对照：这条路径本来就没坏）");
  eq(v2.mismatch, 0, "2 行档：预告行只占第 1 行，当前行的内容仍与节目单同源");
}

/* ================= 场景 T79h：填充层的推进量写在格子的 --f 上（v2.26.1 DOM 瘦身） ================= */
section("T79h 填充层 · 推进量 = 格子上的 CSS 变量 --f（不再是每格一个 .fill 子节点）");
{
  /* ★ 为什么必须在**桩**里也钉一条：v2.26.1 把填充层从「每格一个 .fill 子节点」改成
     .cell::before 伪元素之后，"推进量到底写没写进去"这件事桩测不到（桩没有伪元素），
     真机冒烟才量得到（smoke 里有一条读 ::before 计算 transform 的断言）。
     于是这里补上另一半：**值被写进 --f** 由桩钉（本场景），**值真的生效**由真机钉。
     少了这一条，"整条不写 --f"会在桩里全绿（技能里的假绿纪律）。 */
  const app = loadApp();
  app.beat.Controls.start();
  const ac = FakeAudioContext.last;
  const cellsOf = () => [].concat.apply([], app.beat.Viz.internals().cellEls);
  const fOf = el => parseFloat(el.style["--f"] || "0");
  ok(cellsOf().length > 0, "前提：网格里有格子");

  let maxF = 0, partF = 0;
  for (let i = 0; i < 120; i++){
    ac.currentTime += 0.02;
    app.beat.AudioEngine.scheduler();
    app.beat.Viz.paintFrame();
    const fs = cellsOf().map(fOf);
    maxF = Math.max(maxF, Math.max.apply(null, fs.concat([0])));
    if (fs.some(v => v > 0 && v < 1)) partF++;      // 逐帧推进的中间态（0 < scaleX < 1）
  }
  ok(maxF > 0, "★ 播放中确有格子被填（--f > 0）");
  ok(partF > 0, "★★ 见过「填了一半」的中间态（逐帧推进真的在跑，不是只写了 0/1 两档）");

  app.beat.Controls.stop();
  ok(cellsOf().every(el => fOf(el) === 0), "★ 停机复位：全部格子的 --f 回到 0（不留残影）");
}
