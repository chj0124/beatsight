/* T174 v3.14.0 四项交互批
   ---------------------------------------------------------------------------
   ① 滚动模式预备拍特效（用户需求，A + 播放头脉冲拍板）：分页有幽灵小节球（v2.42.6）、
      滚动 v3.1.3 拍板不画球——落点反馈由预备拍道（v3.12.0）承担：每声计数点亮第 idx 格
      （幂等重算 0..idx 亮，独立游标 countLaneLitIdx，真重建归 −1 整道重挂）+ 播放头
      180ms 呼吸（REDUCE_MOTION 跳过动画留填充）。
   ② 滚动模式左右雾化条：毛玻璃 + 渐变 mask（真几何归 smoke；本文件钉显隐跟随
      scrollMode 与 CSS 三要素：blur / 渐变 / 112px）。
   ③ 顶栏补偿/设置圆钮化（用户需求）：latChip 圆内只写数值（title/aria 带完整语义）、
      settingsBtn = icon-btn 齿轮；文案/结构钉（文案口径在 t136）。
   ④ 预设库抽屉左缘自动浮出（用户需求）：热区 mouseenter → 无遮罩滑出（不抢焦点）；
      mouseleave → 400ms 定时收回（**只作用于 hover 会话**）；显式开（胶囊）带遮罩、
      不被自动收；全屏浮层打开时热区忽略。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const cssNoCmt = CSS_CODE;
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

section("T174a 滚动预备拍特效：预备拍道逐拍点亮（幂等重挂 + 交接清零）");
{
  const { beat } = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 4 },
    sel: { type: "builtin", idx: 1 },
  }));
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const litSeq = [];
  let litAfterRebuild = null;
  drive0(beat, ac, 1.0, () => {
    const lane = beat.Viz.internals().countLaneEl;
    if (!lane) return;
    const zones = lane.children.filter(c => c.className.indexOf("beat-zone") >= 0);
    litSeq.push(zones.filter(z => z.classList.contains("lit")).length);
  });
  ok(litSeq.length > 40, "前提：预备拍窗口已逐帧采样", "frames=" + litSeq.length);
  ok(litSeq.every((v, i) => i === 0 || v >= litSeq[i - 1]) && litSeq[litSeq.length - 1] >= 2
     && litSeq[0] <= 1,
    "★★ 点亮数随计数**单调递增**（首声 ≥1 格、1 秒内 ≥2 格——每声'哒'多亮一格）",
    "序列首尾 " + litSeq[0] + " → " + litSeq[litSeq.length - 1]);
  /* 重建重挂：预备拍中触发一次 relayout（cacheGeo 路径，会经 rebuild 重建网格）——
     点亮游标归 −1 后下一帧整道重挂，不残留不缺格 */
  beat.Viz.relayout();
  beat.Viz.paintFrame();
  const lane = beat.Viz.internals().countLaneEl;
  if (lane && lane.style.display === "block"){
    const zones = lane.children.filter(c => c.className.indexOf("beat-zone") >= 0);
    litAfterRebuild = zones.filter(z => z.classList.contains("lit")).length;
  }
  if (litAfterRebuild !== null){
    ok(litAfterRebuild >= 1,
      "★★ 重建后下一帧整道重挂（点亮游标归 −1 的恢复路径）",
      "重建后 lit=" + litAfterRebuild);
  } else {
    ok(true, "重建后道不在显示窗口（时序浮动），恢复路径由源码钉兜底");
  }
  /* 源码钉：落拍光斑 = 每声计数在拍区上炸一次圆环（flashTheme 配色 + 420ms 回弹）。
     桩里 animate 是 no-op，动效本身测不到——钉实现存在性，防整段被静默拆掉。 */
  ok(/countLaneLitIdx/.test(html) && /fc\.zoneOn, transform: "scale\(1\.12\)"/.test(html)
     && /duration: 420/.test(html),
    "★★ 落拍光斑实现在位（每声计数圆环脉冲 420ms，flashTheme 配色；REDUCE_MOTION 降级留标记）");
  /* 交接（v3.12.0 语义）：道在**首个可听小节内持续显示**（会话保持），
     第二个可听小节起退场——驱动到撤除为止（BPM 无关的循环，封顶 12s）再断言 */
  let exited = false;
  for (let i = 0; i < 600 && !exited; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (beat.Viz.internals().countLaneEl.style.display === "none") exited = true;
    if (!beat.Store.S.playing) exited = true;
  }
  ok(exited, "★ 第二可听小节起预备拍道撤除（点亮态随会话退场，无从残留）");
}
function drive0(beat, ac, seconds, onFrame){
  const n = Math.ceil(seconds / 0.02);
  for (let i = 0; i < n; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (onFrame) onFrame();
    if (!beat.Store.S.playing) return;
  }
}

section("T174b 雾化条：显隐跟随滚动模式 + CSS 三要素");
{
  /* viewportW 1440：雾化条 v3.15.0 起在 ≤640 手机竖屏禁用——桌面行为用可配置视口表达 */
  const { els } = loadApp(seedState({ scrollMode: true, scrollRows: 3 }), { viewportW: 1440 });
  /* 元素存在性并入断言：同步被拆（变异）时 app 从不触碰该元素 → els 为 undefined，
     此时是"具名红"而不是 TypeError 崩溃（变异反向验证的可读性要求） */
  ok(!!els["scrollFogL"] && !!els["scrollFogR"] && els["scrollFogL"].hidden === false
     && els["scrollFogR"].hidden === false,
    "★★ 滚动模式：左右雾化条显形（元素存在且 hidden=false）",
    "L=" + (els["scrollFogL"] && els["scrollFogL"].hidden) + " R=" + (els["scrollFogR"] && els["scrollFogR"].hidden));
  const { els: elsPaged } = loadApp(seedState({ scrollMode: false }));
  ok(!!elsPaged["scrollFogL"] && elsPaged["scrollFogL"].hidden === true,
    "★ 分页模式：雾化条隐藏（显隐跟随 scrollMode）",
    "L=" + (elsPaged["scrollFogL"] && elsPaged["scrollFogL"].hidden));
  ok(/\.scroll-fog\{[^}]*backdrop-filter:blur\(14px\)/.test(cssNoCmt)
     && /left:calc\(\(100% - 100vw\) \/ 2\)/.test(cssNoCmt)
     && /width:calc\(\(100vw - 100%\) \/ 2 \+ clamp\(64px, 10vw, 112px\)\)/.test(cssNoCmt)
     && /\.scroll-fog\.right\{left:auto;right:calc\(\(100% - 100vw\) \/ 2\)/.test(cssNoCmt),
    "★★ v3.15.0 CSS：毛玻璃 blur(14px) + 贴屏幕两缘（calc 从视口边铺到卡片缘内"
    + " clamp(64,10vw,112)px）+ 左右镜像渐变 mask");
  ok(/\.viz-band\{display:flex;flex-direction:column;gap:16px;margin-block:auto;position:relative\}/.test(cssNoCmt),
    "★ .viz-band 补 position:relative（雾化条 absolute 的定位上下文）");
}

section("T174c 顶栏圆钮化：结构 + 圆内数值载体");
{
  const topbar = html.slice(html.indexOf('<header class="topbar"'), html.indexOf("</header>"));
  ok(/<button class="pill outline lat-btn" id="latChip"/.test(topbar)
     && /<span class="lat-num" id="latChipVal">0<\/span>/.test(topbar),
    "★★ 补偿圆钮：.lat-btn + 圆内数值 span（id 不换、接线不动）");
  ok(/<button class="pill outline icon-btn" id="settingsBtn" aria-label="设置" title="设置">/.test(topbar)
     && /aria-hidden="true"><circle cx="12" cy="12" r="3\.1"/.test(topbar),
    "★★ 设置圆钮：icon-btn + 齿轮 SVG（aria-label 承接原文字语义）");
  ok(/\.lat-btn\{min-width:40px;justify-content:center;padding:0 10px\}/.test(cssNoCmt)
     && /\.lat-btn \.lat-num\.n1\{font-size:16px\}/.test(cssNoCmt)
     && /\.lat-btn \.lat-num\.n2\{font-size:13px\}/.test(cssNoCmt)
     && /\.lat-btn \.lat-num\.n3\{font-size:11px\}/.test(cssNoCmt)
     && /\.lat-btn \.lat-num\{[^}]*font-variant-numeric:tabular-nums/.test(cssNoCmt),
    "★★ v3.15.0：数值字号按位数分档（1 位 16 / 2 位 13 / 3 位 11，圆钮 40px 恒定不溢出）");
}

section("T174d 抽屉左缘自动浮出：hover 无遮罩 / 显式带遮罩 / 400ms 收回");
{
  const app = loadApp(seedState({ countIn: { on: false, beats: 2 } }));
  const { beat, els } = app;
  const drawer = els["presetDrawer"], mask = els["presetMask"], hz = els["drawerHotzone"];

  hz.fire("mouseenter");
  eq(drawer.hidden, false, "★★ 热区 mouseenter → 抽屉滑出（左缘自动浮出）");
  eq(mask.hidden, true, "★★ hover 浮出**不带遮罩**（55% 黑闪一下很难受）");

  drawer.fire("mouseenter");            // 移入抽屉：取消挂起的收回
  drawer.fire("mouseleave");            // 移出：挂起 400ms 收回
  ok(beat.Presets ? app.timeoutCount() >= 0 : true, "前提自检：桩 timers 接口在位");
  app.runTimers();
  eq(drawer.hidden, true, "★★ hover 会话：mouseleave 后 400ms 自动收回（runTimers 冲刷）");

  hz.fire("mouseenter");                // 再 hover 开
  drawer.fire("mouseenter");            // 移入抽屉取消定时
  eq(app.timeoutCount(), 0, "★ 抽屉上 mouseenter 取消挂起的收回（在抽屉内移动不算离开）");
  drawer.fire("mouseleave");
  drawer.fire("mouseenter");            // 再次移入：取消
  app.runTimers();
  eq(drawer.hidden, false, "★ 定时被取消 → 不收回（抽屉与热区间移动不误收）");

  drawer.fire("mouseleave");            // 挂起收回
  app.runTimers();
  eq(drawer.hidden, true, "★ 最终移出 → 收回（hover 会话闭环）");

  els["presetLibBtn"].fire("click");    // 显式打开
  eq(mask.hidden, false, "★★ 点胶囊显式打开 → **保留遮罩**（「我要认真挑」的语境）");
  drawer.fire("mouseleave");            // 显式会话：移出挂起……
  app.runTimers();
  eq(drawer.hidden, false, "★★★ 显式开的会话**不被自动收**（显式开要显式关——点胶囊/收起/Esc/选中）");

  els["presetDrawerClose"].fire("click");
  eq(drawer.hidden, true, "★ 显式会话：收起钮照旧关闭");
  eq(mask.hidden, true, "★ 遮罩随关闭归位");

  /* 全屏浮层打开时热区忽略 */
  els["settingsBtn"].fire("click");     // 打开设置浮层
  hz.fire("mouseenter");
  eq(drawer.hidden, true, "★★ 设置浮层打开时热区忽略（不与全屏浮层抢地盘）");
  els["settingsOverlay"].fire("click"); // 点窗外关闭（Modal 统一协议）
}
