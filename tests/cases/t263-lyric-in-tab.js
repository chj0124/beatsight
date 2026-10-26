/* BeatSight 自动化测试 · 歌词嵌入六线谱：偏好、入口、中央几何与播放状态（PLAN-v15） */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const STRUM4 = Array.from({ length: 4 }, () => ({ t: 48, dir: "D" }));
function setupSong(beat, steps = STRUM4, chars){
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "谱内测试型", meter: 4, bars: [steps] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t263", name: "谱内测试曲", sections: [
    { uid: "s263", name: "主歌", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] });
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t263", from: 0, to: 0, loop: true };
  beat.Store.S.lyricPos = "tab";
  beat.Store.S.pitchNotation = "off";
  beat.Store.upsertLyric("t263", "s263", chars || [
    { t: 0, dur: 24, ch: "你" }, { t: 48, dur: 24, ch: "好" },
  ]);
  beat.Viz.buildViz();
}
const numOf = s => { const m = /translateY\(([-0-9.]+)px\)/.exec(s || ""); return m ? Number(m[1]) : NaN; };

section("T263a tab 持久化、脏值回退与 auto 旧行为");
{
  const app = loadApp({ "beatsight.state": JSON.stringify({ v: 3, lyricPos: "tab" }) });
  eq(app.beat.Store.S.lyricPos, "tab", "tab 是合法保存值");
  app.beat.Store.flush();
  eq(JSON.parse(app.storage.get("beatsight.state")).lyricPos, "tab", "tab 随热键落盘");
  const dirty = loadApp({ "beatsight.state": JSON.stringify({ v: 3, lyricPos: "bogus" }) });
  eq(dirty.beat.Store.S.lyricPos, "auto", "脏 lyricPos 回退 auto");
  eq(app.beat.Viz.effectiveLyricPos(), "follow", "默认行宽下 tab 仅稳定回退，不改保存值");
  const autoWide = loadApp({}, { rowW: 1200 });
  eq(autoWide.beat.Viz.effectiveLyricPos(), "follow", "auto 宽屏仍 follow，不自动 tab");
  const autoNarrow = loadApp({}, { rowW: 500 });
  eq(autoNarrow.beat.Viz.effectiveLyricPos(), "bottom", "auto 窄屏仍 bottom");
}

section("T263b 入口由视口与实际网格宽度共同决定");
{
  const wide = loadApp({}, { rowW: 1200, viewportW: 1200 });
  eq(wide.beat.Viz.canOfferLyricTab(), true, "宽视口 + 宽网格 → 开放");
  const tab = wide.els["lyricPosGroup"].children.find(p => p.dataset.pos === "tab");
  eq(tab.hidden, false, "谱内按钮在合格布局显示");
  const narrow = loadApp({}, { rowW: 500, viewportW: 500 });
  eq(narrow.beat.Viz.canOfferLyricTab(), false, "窄视口不开放");
  eq(narrow.els["lyricPosGroup"].children.find(p => p.dataset.pos === "tab").hidden, true,
    "移动端/窄屏不显示谱内按钮");
  const squeezed = loadApp({}, { rowW: 800, viewportW: 1200 });
  eq(squeezed.beat.Viz.canOfferLyricTab(), false, "桌面视口但侧栏挤压到 800 → 不开放");
}

section("T263c 移动端 tab→follow，偏好保留；合格桌面恢复 tab");
{
  const mobile = loadApp({}, { rowW: 500, viewportW: 500 });
  setupSong(mobile.beat);
  eq(mobile.beat.Store.S.lyricPos, "tab", "移动端不改写保存偏好");
  eq(mobile.beat.Viz.lyricLayoutState().actual, "follow", "移动端实际贴行");
  eq(mobile.beat.Viz.lyricLayoutState().reason, "layout", "回退原因是布局");
  const desktop = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(desktop.beat);
  eq(desktop.beat.Viz.lyricLayoutState().actual, "tab", "合格桌面实际谱内");
  eq(desktop.beat.Viz.lyricLayoutState().reason, "", "合格桌面无回退原因");
}

section("T263d 谱内中央几何、单一歌词轨与行高守恒");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat);
  const lane = app.els["lyricLane"], int = app.beat.Viz.internals();
  ok(lane.classList.contains("in-tab") && lane.classList.contains("overlay"), "谱内仍是同一覆盖歌词轨");
  ok(app.els["viz"].classList.contains("lyric-in-tab-on"), "网格挂谱内作用域类");
  ok(app.els["viz"].classList.contains("lyric-inline-on"), "谱内保留行距补偿");
  for (let i = 0; i < int.lyricRows.length; i++){
    eq(numOf(int.lyricRows[i].el.style.transform), int.rowGeo[i].top + 8,
      "44px 格子带 / 28px 歌词行 → 行顶 + 8（中央）");
  }
  ok(!app.els["viz"].children.some(c => /lyric-row|lyric-lane/.test(c.className)),
    "歌词节点不进入 #viz，网格 DOM 不变量保留");
  app.beat.Store.S.lyricPos = "follow"; app.beat.Viz.buildViz();
  ok(app.els["viz"].classList.contains("lyric-inline-on"), "回退 follow 行距不变");
  ok(!lane.classList.contains("in-tab"), "follow 不保留谱内类");
  const after = app.beat.Viz.internals();
  const rowH = after.rowEls[0].offsetHeight || 86;
  eq(numOf(after.lyricRows[0].el.style.transform),
    after.rowGeo[0].top + rowH + 2, "follow 仍是行盒底 + 2，而非中央");
}

section("T263e 逐弦 56px 档同式居中，不跟随弦号上下跳");
{
  const picked = STRUM4.map((s, i) => ({ t: 48, str: [{ s: i + 1, f: i }] }));
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat, picked);
  ok(app.els["viz"].classList.contains("has-pick"), "前提：进入逐弦 56px 档");
  const int = app.beat.Viz.internals();
  eq(numOf(int.lyricRows[0].el.style.transform), int.rowGeo[0].top + 14,
    "56px 格子带 / 28px 歌词行 → 行顶 + 14（不是整行 98px 的中心）");
  eq(app.beat.Viz.lyricLayoutState().actual, "tab", "逐弦本身不禁止谱内");
}

section("T263f 播放状态与逐字进度复用原时间源");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat);
  const a = app.beat.Store.findArrange("t263");
  app.beat.Viz.paintLyric(12, 0, a, 0);
  const row = app.beat.Viz.internals().lyricRows[0];
  ok(row.chipEls[0].classList.contains("on"), "第一个字在自己的 t/dur 内进入 on");
  eq(row.fillEls[0].style.transform, "scaleX(0.500)", "逐字进度仍是 scaleX（12/24）");
  app.beat.Viz.paintLyric(24, 0, a, 0);
  ok(row.chipEls[0].classList.contains("played"), "唱完转 played，状态来源未分叉");
  const src = html;
  ok(/#lyricLane\.in-tab \.lyric-head\{display:none!important\}/.test(src), "谱内不显示第二根歌词播放头");
  ok(src.includes("paintLyric(headTick, audK, arrCur, headBar)"), "播放进度源仍是歌曲时间 headTick");
  const charRule = src.match(/#lyricLane\.in-tab \.lyric-char\{([^}]*)\}/);
  ok(!!charRule && !/text-stroke|text-shadow/.test(charRule[1]),
    "谱内歌词使用纯色，不带深色描边或光晕");
  ok(!/#lyricLane\.in-tab \.lyric-chip\.played \.lyric-char/.test(src),
    "唱完恢复普通色，不保留 played 特殊色");
  ok(/#lyricLane\.in-tab \.lyric-chip \.lfill\{display:none\}/.test(src),
    "谱内不显示逐字下划线");
  const start = src.indexOf("  function paintLyric("), end = src.indexOf("  /** 歌词轨播放头", start);
  const body = start >= 0 && end > start ? src.slice(start, end) : "";
  ok(!!body && !/fitLyricTabLayout|getBoundingClientRect/.test(body),
    "谱内排版测量不得进入 paintLyric 逐帧路径");
}

section("T263g 连续滚动与总开关优先");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat);
  app.beat.Store.S.scrollMode = true; app.beat.Viz.buildViz();
  eq(app.beat.Viz.effectiveLyricPos(), "tab", "连续滚动允许显式 tab");
  eq(app.beat.Viz.lyricLayoutState().reason, "", "谱内连续滚动不再产生 scroll 回退原因");
  app.beat.Store.S.scrollMode = false; app.beat.Store.S.showLyric = false; app.beat.Viz.buildViz();
  eq(app.els["lyricLane"].hidden, true, "显示歌词关优先于 tab");
  ok(!app.els["viz"].classList.contains("lyric-in-tab-on"), "关闭后摘谱内作用域类");
}
