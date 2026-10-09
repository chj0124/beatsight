/* BeatSight 自动化测试 · 歌词显示位置（PLAN-v7，v2.86.0）
   T149 系列 —— 伴随节奏 / 底部 两模式基础断言（取代旧「歌词跟随条」测试）。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html 内注释同源）：
     · 总开关 S.showLyric（取代 v2.84.0 lyricFollow）；关 ⇒ 任何位置都不画歌词。
     · 位置 S.lyricPos（auto / follow / bottom）：auto 按窄屏（≤960px）解析为 bottom，
       否则 follow；follow = 歌词轨切覆盖层叠到 #viz 上、逐行 translateY 贴自己小节行下缘；
       bottom = 底部整块歌词轨（现状）。
     · 两种位置模式共用同一套 .lyric-chip 字块着色；字以绝对定位落**右下**（v3.38.1 口径：left 26px·--cs / right 6px·--cs / bottom 1px）。
     · #viz 的 DOM 与网格不变量零改动（R1）：歌词行都在 #lyricLane（#viz 兄弟），从不插进 #viz。
   基准段落：BUILTINS[1]（四分基础，4/4）× 1 遍 = 4 小节。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "歌词曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL(1, 1)] }] },
]}) });
const seedState = extra => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", vizRows: 4,   /* v3.1.0：出厂默认 2，本文件按 4 行档断言 */
    arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }, extra));

const numOf = s => { const m = /translateY\(([-0-9.]+)px\)/.exec(s || ""); return m ? parseFloat(m[1]) : NaN; };
/* jsdom 下 offsetHeight/offsetTop 全为 0，cacheGeo 的 vizRowBoxH 回落常量 86；故覆盖层公式
   在桩里解析为 rowGeo[i].top(=0) + 86 + 2。boxH 从真实量取、取不到回退 86，与 cacheGeo 同口径。 */
function boxH(beat){ const r0 = beat.Viz.internals().rowEls[0]; return (r0 && r0.offsetHeight) ? r0.offsetHeight : 86; }

section("T149a 结构层 · follow 模式 → 覆盖层 + 逐行 translateY 贴自己小节下缘");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow" }) }));
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Viz.buildViz();
  const lane = els["lyricLane"];
  const int = beat.Viz.internals();
  ok(!lane.hidden, "follow 模式 + 有词 → 歌词轨显示");
  ok(lane.classList.contains("overlay"), "★ follow 模式 → #lyricLane 加 .overlay（覆盖层定位）");
  ok(int.lyricRows.length === 4, "窗口 4 行歌词行（与网格 4 行一一对应）");
  const bh = boxH(beat);
  for (let i = 0; i < int.lyricRows.length; i++){
    const tr = int.lyricRows[i].el.style.transform;
    ok(/translateY\(/.test(tr), "★ 行 " + i + " 有 translateY（叠到对应小节下缘）");
    eq(numOf(tr), int.rowGeo[i].top + bh + 2, "★ 行 " + i + " 位移 = rowGeo[" + i + "].top + 行盒高 + 2（贴行下缘）");
  }
  // 行序校验：用 rowGeo 模拟真实落差（桩里 top 全 0，无法区分行序 → 直接改 rowGeo 验证公式按行取）
  int.rowGeo[3].top = 300;
  beat.Viz.buildLyricLane();   // 重建（不重采 rowGeo，沿用刚改的落差）
  const lane2 = els["lyricLane"];
  ok(numOf(lane2.children[3].style.transform) > numOf(lane2.children[0].style.transform),
    "★ 行 3 的 translateY 明显大于行 0（覆盖层按行贴合各自小节，非整块堆叠）");
  // 网格不变量不破：#viz 内仍恰 4 个 .bar-row，且歌词行从不插进 #viz
  const viz = els["viz"];
  eq(viz.children.filter(c => /(^| )bar-row( |$)/.test(c.className)).length, 4, "★ 不破 R1：#viz 内仍恰 4 个 .bar-row");
  ok(![/lyric-row/, /lyric-lane/].some(re => viz.children.some(c => re.test(c.className))),
    "★ 歌词行不在 #viz 内（覆盖层是 #viz 的兄弟节点）");
}

section("T149b 结构层 · bottom 模式 → 底部流式堆叠（现状回归护栏）");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "bottom" }) }));
  beat.Store.upsertLyric("t1", "s1", [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },
  ]);
  beat.Viz.buildViz();
  const lane = els["lyricLane"];
  ok(!lane.hidden, "bottom 模式 + 有词 → 歌词轨显示");
  ok(!lane.classList.contains("overlay"), "bottom 模式 → 无 .overlay（保持底部流式，现状行为）");
  ok(lane.children.every(r => !/translateY\(/.test(r.style.transform || "")),
    "bottom 模式 → 行无内联 translateY（纯流式堆叠）");
}

section("T149c 总开关 · 显示歌词关 ⇒ 两种位置模式都不画歌词");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: false, lyricPos: "follow" }) }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Viz.buildViz();
  ok(els["lyricLane"].hidden, "follow 模式 + 显示歌词关 → 歌词轨隐藏");
  // 切到 bottom 仍隐藏
  beat.Store.S.lyricPos = "bottom";
  beat.Viz.buildViz();
  ok(els["lyricLane"].hidden, "bottom 模式 + 显示歌词关 → 同样隐藏（总开关优先级最高）");
}

section("T149d 无词窗口 · 整轨收起不占位（与旧版同义）");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow" }) }));
  beat.Viz.buildViz();   // 曲式有词但本用例未 upsert 歌词 → 窗口无词行
  ok(els["lyricLane"].hidden, "无词窗口 → 歌词轨隐藏（不占位）");
  ok(!els["lyricLane"].classList.contains("overlay"), "无词窗口 → 不进覆盖层");
}

section("T149e 文字对齐 · 字在各自节奏 chip 内靠左（D2）");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  ok(/\.lyric-char\{[^}]*left:calc\(26px \* var\(--cs,1\)\)[^}]*right:auto[^}]*text-align:left/.test(src),
    "★ CSS：歌词字**靠左**（left: 26px·--cs / right:auto / bottom: 1px / text-align:left）——v3.38.1 补9 用户口径（与音名档统一）");
}

section("T149f 旧跟随条已退役 · 无 lyric-follow 元素 / 无 .lyric-follow-on 行距类 / 双关放大清理");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow" }) }));
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  beat.Viz.buildViz();
  ok(![...els["viz"].children].some(c => c.id === "lyricFollow"), "★ #viz 内无 #lyricFollow 浮动元素");
  ok(!els["viz"].classList.contains("lyric-follow-on"), "★ #viz 无 .lyric-follow-on 行距补偿类（已清理）");
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  ok(!/\.lyric-follow\{/.test(src), "★ CSS：.lyric-follow 规则已删（无死样式）");
  ok(!/#viz\.no-ruler\.no-durlab \.lyric-follow/.test(src), "★ CSS：双关放大 .lyric-follow 规则已删");
  // 旧接口退役：出口面不再暴露 syncFollowChrome / paintFollow 相关内部件
  const int = beat.Viz.internals();
  ok(int.lyricFollowEl === undefined && int.followRow === undefined,
    "★ internals 不再暴露 lyricFollowEl / followRow（旧跟随条状态已移除）");
}

section("T149g 行距补偿 · follow 挂 .lyric-inline-on / bottom·off 摘类（PLAN-v7 修复重叠）");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  // CSS 值锁定：空带里住两个——歌词行（普通 28px 锚行盒底+2 / xl 双关进标注带 行高 32 锚 行顶+50）
  // + 下一行的行首和弦胶囊（普通 top:-18px 高 13px / xl 放大 top:-36px 高 24px）。
  // 行距：普通 52px（清开歌词带+胶囊带）；xl 双关时歌词进标注带（v2.84.0 守恒值）→ 行距 48px 即清开。
  ok(/#viz\.lyric-inline-on \.bar-row\{margin-bottom:52px\}/.test(src),
    "★ CSS：桌面行距补偿 20→52px（#viz.lyric-inline-on .bar-row，普通：清开歌词带+胶囊带）");
  ok(/#viz\.lyric-inline-on\.chord-xl \.bar-row\{margin-bottom:48px\}/.test(src),
    "★ CSS：xl 双关行距 48px（v2.86.0 移植 v2.84.0 守恒值：歌词进标注带后 xl 不需 70）");
  ok(/#viz\.no-ruler\.no-durlab \.lyric-row\{height:32px\}/.test(src),
    "★ CSS：xl 双关歌词行高 32px（v2.84.0 跟随条同口径，进释放出的标注带）");
  ok(/#viz\.no-ruler\.no-durlab \.lyric-row \.lyric-chip\{height:30px\}/.test(src),
    "★ CSS：xl 双关字块高 30px");
  /* ★ v3.31.0：同 .lyric-char，加上限（双关档正常上限 24.65px，故卡 25px） */
  ok(/#viz\.no-ruler\.no-durlab \.lyric-row \.lyric-char\{font-size:min\(calc\(17px \* var\(--cs, 1\)\), 25px\);font-weight:800\}/.test(src),
    "★ CSS：xl 双关字 17px·800（v3.31.0 起带上限 25px）");
  ok(/@media[\s\S]*#viz\.lyric-inline-on \.bar-row\{margin-bottom:52px\}/.test(src),
    "★ CSS：窄屏行距补偿 10→52px（媒体查询内与桌面同值）");
  ok(/@media[\s\S]*#viz\.lyric-inline-on\.chord-xl \.bar-row\{margin-bottom:48px\}/.test(src),
    "★ CSS：窄屏 xl 联动规则同 48px");
  ok(/@media[\s\S]*#viz\.no-ruler\.no-durlab \.lyric-row\{height:28px\}/.test(src),
    "★ CSS：窄屏 xl 行高回落 28px（窄屏标注带仅 32px，与 translateY(+36) 配套）");
  ok(/\.lyric-char\{[^}]*left:calc\(26px \* var\(--cs,1\)\)[^}]*right:auto[^}]*text-align:left/.test(src),
    "★ CSS：歌词字**靠左**（left: 26px·--cs / right:auto / bottom: 1px / text-align:left）——v3.38.1 补9 用户口径（与音名档统一）");
  ok(/S\.showLyric && Viz\.effectiveLyricPos\(\) === "follow"\) Viz\.relayout\(\)/.test(src),
    "★ JS：follow 期间切座次尺/时值标注（xl 开/关改行距）→ Viz.relayout() 重采 rowGeo");
  // JS：follow → 挂类（腾出歌词带）；切 bottom / 关总开关 → 摘类
  const f = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow" }) }));
  f.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  f.beat.Viz.buildViz();
  ok(f.els["viz"].classList.contains("lyric-inline-on"), "★ follow → #viz 挂 .lyric-inline-on（腾出歌词带）");
  f.beat.Store.S.lyricPos = "bottom";
  f.beat.Viz.buildViz();
  ok(!f.els["viz"].classList.contains("lyric-inline-on"), "切 bottom → 摘类（正常流式，不需补偿）");
  const off = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: false, lyricPos: "follow" }) }));
  off.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  off.beat.Viz.buildViz();
  ok(!off.els["viz"].classList.contains("lyric-inline-on"), "显示歌词关 + follow → 仍摘类（总开关优先）");
}

section("T149h 双关放大（两标注都关）· 歌词行上移进释放标注带（移植 v2.84.0，修 v2.86 空带回归）");
{
  const bothOff = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow", showRuler: false, showDurLabel: false }) }));
  bothOff.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  bothOff.beat.Viz.buildViz();
  ok(bothOff.els["viz"].classList.contains("chord-xl"), "★ 两标注都关 ⇒ #viz 挂 .chord-xl（双关放大）");
  ok(bothOff.els["viz"].classList.contains("lyric-inline-on"), "★ follow + 双关 ⇒ 仍挂 .lyric-inline-on（行距补偿照旧）");
  const int = bothOff.beat.Viz.internals();
  const w = bothOff.els["viz"].offsetWidth;
  const expect = w <= 960 ? 36 : 50;        // 窄屏标注带仅 32px → +36；桌面进 50–82px 释放带 → +50
  const laneEl = bothOff.els["lyricLane"];
  for (let i = 0; i < laneEl.children.length; i++){
    const tr = laneEl.children[i].style.transform || "";
    if (!/translateY/.test(tr)) continue;
    eq(numOf(tr), int.rowGeo[i].top + expect,
      "行 " + i + " 位移 = rowGeo[" + i + "].top + " + expect + "（进释放出的标注带，非行盒底+2）");
  }
  // 反向：双关时若 translateY 仍用 行盒底+2（被删的跟随条回归点）→ 上方空 44px，断言应逐行不成立
  const bad = laneEl.children[0].style.transform || "";
  ok(numOf(bad) !== (int.rowGeo[0].top + 86 + 2), "★ 双关行 0 不再锚行盒底（+88）→ 空带复用语生效");
}

section("T149i 窄屏口径 = CSS 视口断点（修 961–1392px 视口歌词带压格子底重叠）");
{
  // 错位场景：viz 行宽 600（旧逻辑判窄屏 → +36）但视口 1200（CSS 桌面、格 44px、应 +50）
  const mis = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow", showRuler: false, showDurLabel: false }) }), { rowW: 600, viewportW: 1200 });
  mis.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  mis.beat.Viz.buildViz();
  const int = mis.beat.Viz.internals();
  const laneEl = mis.els["lyricLane"];
  for (let i = 0; i < laneEl.children.length; i++){
    const tr = laneEl.children[i].style.transform || "";
    if (!/translateY/.test(tr)) continue;
    eq(numOf(tr), int.rowGeo[i].top + 50,
      "错位场景（viz600/视口1200）：双关行 " + i + " 用桌面 +50，歌词带不再压格子底（修复前误算 +36）");
  }
  const first = laneEl.children[0].style.transform || "";
  ok(numOf(first) !== (int.rowGeo[0].top + 36), "★ 错位场景不再误用窄屏 +36（本 bug 回归点）");

  // 等宽口径回归：viewport 缺省 = ROW_W，600 仍判窄屏 +36（存量行为不变）
  const same = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ showLyric: true, lyricPos: "follow", showRuler: false, showDurLabel: false }) }), { rowW: 600 });
  same.beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "你" }]);
  same.beat.Viz.buildViz();
  const int2 = same.beat.Viz.internals();
  for (let i = 0; i < same.els["lyricLane"].children.length; i++){
    const tr = same.els["lyricLane"].children[i].style.transform || "";
    if (!/translateY/.test(tr)) continue;
    eq(numOf(tr), int2.rowGeo[i].top + 36, "缺省口径（viz600=视口600）：仍 +36（存量行为锁定）");
  }
}

section("T149j 冷启动 · 双关类必须在首次 buildViz 之前就位（v2.87.0 修首屏歌词压和弦胶囊）");
{
  /* ★ 与 T149h 的关键差别：这里**不调用任何 buildViz / relayout**——断言的是「页面加载完成的那一刻」。
     T149h 走的是"类已挂好之后再重建"的路径，所以本版之前它一直绿；缺口正在冷启动这一格：
     装配区曾把 syncVizLabelToggles() 排在首次 buildViz（Presets.refreshAfterPatternChange）之后，
     于是首屏 placeLaneOverlay 读到 bothOff=false → 歌词行按普通模式锚 行盒底+2（+88），
     类随后才挂上、行距 52→48 与胶囊尺寸都变了，却没人重排 → 歌词带压在下一行和弦胶囊上
     （用户实拍重叠），点播放触发重建才自愈。 */
  const cold = loadApp(Object.assign(seedArr(), {
    "beatsight.state": seedState({ showLyric: true, lyricPos: "follow", showRuler: false, showDurLabel: false }),
    "beatsight.lyrics": JSON.stringify({ v: 2, lines: [
      { arrangeId: "t1", secUid: "s1", chars: [{ t: 0, dur: 24, ch: "你" }, { t: 192, dur: 24, ch: "好" }] },
    ]}),
  }), { viewportW: 1200 });
  ok(cold.els["viz"].classList.contains("chord-xl"), "★ 冷启动（零重建）：#viz 已挂 .chord-xl");
  ok(cold.els["viz"].classList.contains("lyric-inline-on"), "★ 冷启动：已挂 .lyric-inline-on（行距补偿随 follow）");
  const int = cold.beat.Viz.internals();
  const bh = boxH(cold.beat);
  let seen = 0;
  for (let i = 0; i < cold.els["lyricLane"].children.length; i++){
    const tr = cold.els["lyricLane"].children[i].style.transform || "";
    if (!/translateY/.test(tr)) continue;
    seen++;
    eq(numOf(tr), int.rowGeo[i].top + 50,
      "★ 冷启动双关行 " + i + " 锚 行顶+50（修复前 = 行盒底+2 的 +" + (bh + 2) + "，压下一行和弦胶囊）");
  }
  ok(seen > 0, "★ 冷启动确有歌词行被定位（否则上面的逐行断言是空转）");
  /* 源码顺序钉：这条规则本身要可执行——否则下次有人把调用挪回去，只有上面那条断言在红，
     而"该挪到哪一行"没人拦。同时锁「只允许一个启动调用点」：补第二处会让变异反向验证哑火。 */
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const iSync = src.indexOf("\nsyncVizLabelToggles();");
  const iFirstViz = src.indexOf("\nPresets.refreshAfterPatternChange();");
  ok(iSync > 0 && iFirstViz > 0 && iSync < iFirstViz,
    "★ 源码顺序：启动期 syncVizLabelToggles() 早于首次 buildViz（Presets.refreshAfterPatternChange）");
  eq(src.split("\nsyncVizLabelToggles();").length - 1, 1,
    "★ 启动调用点只有一个（补第二处收敛点会让反向验证哑火）");
}
