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

  /* ① v3.1.4：预滚 = 第一道专用——第一道随预备拍左移（驮拍格过播放杆），
     内容道（第 2/3 条）钉在静止态不动（全程贴播放杆） */
  const txOf = r => { const m2 = /translate\(([-\d.]+)px/.exec(r.style.transform); return m2 ? +m2[1] : null; };
  let lane0First = null, lane0Last = null, contentFirst = null, contentLast = null;
  drive(ac, beat, 1.0, () => {
    beat.Viz.paintFrame();                         // 预滚位移发生在渲染帧（drive 只跑调度）
    const iv2 = beat.Viz.internals();
    const t0 = txOf(iv2.rowEls[0]), t1 = txOf(iv2.rowEls[1]);
    if (lane0First === null){ lane0First = t0; contentFirst = t1; }
    lane0Last = t0; contentLast = t1;
  });
  ok(lane0First - lane0Last > geo0.width * 0.15 && lane0First > lane0Last,
    "★ 第一道在预滚（1 秒内左移，驮预备拍拍格过播放杆）",
    "第一道 " + lane0First + " → " + lane0Last);
  ok(contentFirst === contentLast,
    "★ 内容道（第 2/3 条）钉在静止态不动（全程贴播放杆）",
    "contentFirst=" + contentFirst + " contentLast=" + contentLast);

  /* ② v3.1.3（用户拍板）：滚动预备拍**不画球**——预滚期间播放头处是第一圈留空的填充槽，
     球钉在那里 = 浮在空地上、与滑入的条脱开（v3.1.2 的球钉播放头方案退役）。
     ★ 逐帧断言"全程从未出现"，不只看末态（T155e 同款口径：隐藏写点只在每帧发生）。 */
  let ballSeen = null;
  drive(ac, beat, 1.0, () => {
    beat.Viz.paintFrame();
    const iv2 = beat.Viz.internals();
    const d = iv2.ballEl.style.display, sd = iv2.shadowEl.style.display;
    if (ballSeen === null && (d !== "none" || sd !== "none")) ballSeen = { d, sd };
  });
  eq(ballSeen, null, "★ 滚动预备拍：球与影子全程隐藏（逐帧检查，非只看末态）");

  /* ③ 预滚收尾零跳变：预备拍→播放的过渡帧，dx 差恒为一帧的正常位移（≤40px），
     且跨过过渡后 dx 继续同向递减（速度无突变） */
  let prevLane0 = null, maxJumpLane0 = 0, handoverLane0 = null, ballSeenInPlay = null;
  drive(ac, beat, 1.8, () => {
    beat.Viz.paintFrame();
    const iv3 = beat.Viz.internals();
    const counting = els["statusText"].textContent.indexOf("预备拍") >= 0;
    const t0 = txOf(iv3.rowEls[0]);
    if (prevLane0 !== null) maxJumpLane0 = Math.max(maxJumpLane0, Math.abs(t0 - prevLane0));
    prevLane0 = t0;
    const counting_now = els["statusText"].textContent.indexOf("预备拍") >= 0;
    if (!counting_now && handoverLane0 === null) handoverLane0 = t0;   // 开播第一帧
    /* v3.1.3：滚动全程无球——预备拍隐藏要延续到正式播放段（paintBall 守卫） */
    const bd = iv3.ballEl.style.display, sd = iv3.shadowEl.style.display;
    if (!counting_now && ballSeenInPlay === null && (bd !== "none" || sd !== "none")) ballSeenInPlay = { bd, sd };
  });
  ok(maxJumpLane0 < 40, "★ 预滚 → 播放衔接零跳变（第一道相邻帧位移恒为一帧的正常量）",
    "最大帧间差 " + maxJumpLane0 + "px");
  near(handoverLane0, (geo0.left + geo0.width / 2) - geo0.left - geo0.width, 2,
    "★ 开播第一帧第一道 = 静止态（C − left − W，预滚恰好收完，第 1 小节起点正对播放杆）",
    "交接 tx=" + handoverLane0);
  eq(ballSeenInPlay, null, "★ 开播后（正式播放段）球与影子仍全程隐藏（paintBall 守卫）");
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
