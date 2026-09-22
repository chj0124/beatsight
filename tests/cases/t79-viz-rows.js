/* BeatSight 自动化测试 · v2.8.0 req3 同屏行数档位（扫弦网格窗口与歌词轨共用）
   T79 系列。
   ---------------------------------------------------------------------------
   用户原话：「扫弦和歌词显示的行数改为可选择的，比如可调整为歌词两行，扫弦两行。」
   设计定调（用户拍板）：
     · **共用一个档位**——两轨是同一根时间轴上的上下两层，共用一个数才能逐行对齐
       （若各设一档，只要两轨行数不一致就立刻错行）；
     · 值域 1 / 2 / 3 / 4，默认 4（= 旧口径「同屏 4 小节」，老用户升级后逐位不变）。
   契约：
     · 档位 = 曲式滚动窗口长度（arrWinBars 的唯一来源 S.vizRows），网格与歌词轨同源；
     · 只在**曲式模式**生效——预设模式网格行数仍随型走（型多长画多行）；
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
  beat.Store.upsertLyric("t79", 0, [{ t: 0, dur: 24, ch: "一" }, { t: 192, dur: 24, ch: "二" }]);
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t79", from: 0, to: 0, loop: true };
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

/* ================= 场景 T79d：预设模式不受档位影响 ================= */
section("T79d 预设模式不受档位影响 · 网格行数仍随型走（型多长画多行）");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 }, vizRows: 2 }));
  eq(beat.Store.S.playMode, "preset", "前提：预设模式（默认）");
  eq(beat.Store.S.vizRows, 2, "档位已置 2");
  eq(JSON.stringify(rowCells(els)), JSON.stringify([4, 4, 4, 4]),
     "★ 预设模式仍画 4 行（= 型的 4 小节）——档位只对曲式窗口与歌词轨生效");
}

/* ================= 场景 T79e：改档位 → 网格与歌词轨一起重建（两轨共用同源） ================= */
section("T79e 曲式模式 · 改档位同步重建网格与歌词轨，标题按新窗口长度报区间");
{
  const { beat, els } = setup();
  eq(rowsPills(els).length, 4, "前提：档位按钮已生成");
  eq(rowCells(els).length, 4, "起始：曲式窗口默认 4 行");
  eq(beat.Viz.internals().lyricRows.length, 4, "起始：歌词轨同样 4 行（两轨共用档位）");
  ok(/歌曲第 1-4 小节/.test(els["vizTitle"].textContent),
     "起始标题报 1-4（实际「" + els["vizTitle"].textContent + "」）");

  rowsPill(els, 2).fire("click");
  eq(beat.Store.S.vizRows, 2, "★ 切到 2 行档");
  eq(rowCells(els).length, 2, "★★ 网格同步重建为 2 行");
  eq(beat.Viz.internals().lyricRows.length, 2, "★★ 歌词轨同步重建为 2 行（两轨行数同源）");
  ok(/歌曲第 1-2 小节/.test(els["vizTitle"].textContent),
     "★ 标题按新窗口长度报 1-2（实际「" + els["vizTitle"].textContent + "」）");
}

/* ================= 场景 T79f：播放中改档位后窗口按新长度翻页 ================= */
section("T79f 播放中 · 按新档位翻页（2 行档每 2 小节翻一次），行界判据与网格同口径");
{
  const { beat, els } = setup();
  rowsPill(els, 2).fire("click");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  step(beat, ac, 2);
  ok(/歌曲第 1-2 小节/.test(els["vizTitle"].textContent),
     "起播窗口 = 歌曲第 1-2 小节（实际「" + els["vizTitle"].textContent + "」）");
  eq(rowCells(els).length, 2, "网格 2 行");
  step(beat, ac, 130);                            // 跨过第 2 小节边界（起播有 ~0.2s 偏移，首小节约 60 步）→ 翻页
  ok(/歌曲第 3-4 小节/.test(els["vizTitle"].textContent),
     "★ 播过 2 小节 → 窗口按 2 行档翻页（实际「" + els["vizTitle"].textContent + "」）");
  eq(rowCells(els).length, 2, "翻页后仍是 2 行（窗口长度不随翻页变）");
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
