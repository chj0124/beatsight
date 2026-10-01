/* T160 滚动模式预备拍：预滚 + 球钉播放头（v3.1.2，用户实拍两连报）。
   报障一：scroll 下预备拍球沿用 paged 静态 geoOf 幽灵步，行被传送带位移推走后
   球悬在行外（截图：球 (523,25)，行在别处）→ 修复 = scroll 改球钉播放头（球钉在
   scrollCenter 槽的顶带上方，x 恒 = 槽中央 − 8）。
   报障二：预备拍期间条纹丝不动"直接出现在左边" → 新交互 = 预滚：条以播放速度
   从右滑入，开播瞬间第 1 小节起点恰好抵达播放头（shift 线性收到 0，零跳变）。 */
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

section("T160 滚动预备拍 · 预滚滑入 + 球钉播放头 + 开播零跳变");
{
  const app = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 4 },
    sel: { type: "builtin", idx: 1 },
  }));
  const { beat, els } = app;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  let iv = beat.Viz.internals();
  const geo0 = iv.rowGeo[0];
  const rest = iv.scroll.dx;                       // 开播对齐位 = C − left（静止态）
  ok(rest > 0, "前提：静止态 dx > 0（当前行右移半行宽）", "rest=" + rest);
  const center = iv.scroll.center;
  const geoC = iv.rowGeo[center];                  // 球钉的槽 = scrollCenter 槽
  const C = geoC.left + geoC.width / 2;

  /* ① 预滚：预备拍期间条以播放速度左移。1 秒 = 1.6 拍 × 每拍 W/RBc；
     RBc=2 时 = 0.8 个行宽。断言用相对量：滑距 > 0.5 个行宽（1.6 拍 ≥ 0.8 行 × 富余） */
  let first = null, last = null;
  drive(ac, beat, 1.0, () => {
    beat.Viz.paintFrame();                         // 预滚位移发生在渲染帧（drive 只跑调度）
    const d = beat.Viz.internals().scroll.dx;
    if (first === null) first = d; last = d;
  });
  ok(first - last > geo0.width * 0.2 && first > last,
    "★ 预备拍期间条在预滚（1 秒内左移 ≥ 0.2 个行宽，速度 = 播放速度）",
    "first=" + first + " last=" + last);

  /* ② 球钉播放头：x 恒 = scrollCenter 槽中央 − 8，不随条走；y 在该槽顶带上方
     ★ 球引用 drive 后现取（buildViz 若重建，旧引用脱节——§4.17.2） */
  const b = beat.Viz.internals().ballEl;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(b.style.transform);
  ok(!!m, "前提：球 transform 可解析", b.style.transform);
  near(+m[1], C - 8, 2, "★ 预备拍球 x 钉在播放头（scrollCenter 槽中央 − 8）");
  ok(+m[2] <= geoC.top - 20 + 1 && +m[2] >= geoC.top - 20 - 120,
    "★ 预备拍球 y 在 scrollCenter 槽顶带上（抛物线弧内）",
    "y=" + m[2] + " 基准=" + (geoC.top - 20));

  /* ③ 预滚收尾零跳变：预备拍→播放的过渡帧，dx 差恒为一帧的正常位移（≤40px），
     且跨过过渡后 dx 继续同向递减（速度无突变） */
  let prev = null, maxJump = 0, dxAtHandover = null;
  drive(ac, beat, 1.8, () => {
    beat.Viz.paintFrame();
    const d = beat.Viz.internals().scroll.dx;
    const counting = els["statusText"].textContent.indexOf("预备拍") >= 0;
    if (!counting && dxAtHandover === null) dxAtHandover = d;   // 开播第一帧
    if (prev !== null) maxJump = Math.max(maxJump, Math.abs(d - prev));
    prev = d;
  });
  ok(maxJump < 40, "★ 预滚 → 播放衔接零跳变（相邻帧 dx 差恒为一帧的正常位移）",
    "最大帧间差 " + maxJump + "px");
  near(dxAtHandover, rest, 30,
    "★ 开播第一帧 dx = 静止态（第 1 小节起点正对播放头，预滚恰好收完）",
    "交接 dx=" + dxAtHandover);
}

section("T160b 分页预备拍球 · 幽灵步回归（拆分后 paged 路径不变）");
{
  const app = loadApp(seedState({ countIn: { on: true, beats: 4 }, sel: { type: "builtin", idx: 1 } }));
  const { beat } = app;
  const iv = beat.Viz.internals();
  const geo0 = iv.rowGeo[0];
  eq(beat.Store.S.scrollMode, false, "前提：分页模式");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const xs = [];
  drive(ac, beat, 1.2, () => {
    beat.Viz.paintFrame();
    const b = beat.Viz.internals().ballEl;
    const m = /translate\(([-\d.]+)px/.exec(b.style.transform);
    if (m) xs.push(+m[1]);
  });
  ok(xs.length >= 3, "前提：采样到球的多个位置", "样本 " + xs.length);
  ok(xs[xs.length - 1] > xs[0] + geo0.width / 4,
    "★ 分页预备拍：球沿行向右走幽灵步（未受 scroll 拆分影响）",
    "x " + xs[0] + " → " + xs[xs.length - 1]);
  ok(xs.every(x => x >= geo0.left - 20 && x <= geo0.left + geo0.width + 20),
    "★ 分页预备拍：球始终在行 0 的 x 范围内（不再悬到行外）");
}
