/* BeatSight 自动化测试 · KeepAlive 在途竞态 + 帧内 cum 缓存正确性 + 预备拍计数零重复写
   （v3.42.1 审计 P2-1 / P2-6 / P3-7）
   ---------------------------------------------------------------------------
   P2-1：wakeLock request 落定前的重入会发出第二个请求——两个 .then 都执行 lock = l，
   先落定的那枚被覆盖且永不 release（静默耗电到页面隐藏）。v2.8.13 只修了「落定时已过期」，
   「在途重入」这一半由 lockReq 标志补上（T42b 的对称补全）。
   P2-6：paintFrameBody 的 cum 前缀和按 steps 数组身份缓存——本场景用逐小节异构的
   4 小节载体钉「跨小节切换缓存不串味」。
   P3-7：滚动预备拍的 statusText 改为状态翻转才写。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

/* ================= 场景 T234a：KeepAlive 在途竞态（T42b 的对称补全） ================= */
section("T234a wakeLock 请求在途时重入 sync：不得发出第二个 request");
{
  const calls = [];
  const late = [];
  const lockObj = { released: false, release(){ this.released = true; }, addEventListener(){} };
  /* 手动可控 thenable（与 T42b 同款）：回调入队、测试显式落定 */
  const nav = { wakeLock: { request(t){ calls.push(t); return { then(fn){ late.push(fn); return { catch(){} }; } }; } } };
  const app = loadApp({}, { navigator: nav });
  const S = app.beat.Store.S;
  S.keepAwake = true;
  app.beat.Controls.start();              // acquire：request #1（在途，尚未落定）
  app.beat.KeepAlive.sync();              // ★ 在途重入（真实触发源：起播后立即回前台的 visibilitychange）
  eq(calls.length, 1, "★ 在途未落定：重入不再发起第二次 request（旧实现会发两个请求，先落定的锁被覆盖泄漏）");
  late[0](lockObj);                       // 落定
  ok(app.beat.KeepAlive.state().locked, "落定后锁正常持有");
  app.beat.KeepAlive.sync();              // 已持有 → 不再申请
  eq(calls.length, 1, "已持有 → 不重复申请（既有守卫不变）");
  app.beat.Controls.stop();
  ok(lockObj.released, "停止 → 释放");

  /* 在途中停止：落定的锁就地释放（v2.8.13「过期即放」语义在 lockReq 下保持） */
  const late2 = [];
  const lock2 = { released: false, release(){ this.released = true; }, addEventListener(){} };
  const nav2 = { wakeLock: { request(){ return { then(fn){ late2.push(fn); return { catch(){} }; } }; } } };
  const app2 = loadApp({}, { navigator: nav2 });
  app2.beat.Store.S.keepAwake = true;
  app2.beat.Controls.start();
  app2.beat.Controls.stop();              // 落定前停止（在途窗口内）
  late2[0](lock2);
  ok(!app2.beat.KeepAlive.state().locked && lock2.released, "在途中停止：过期锁就地释放（T42b 语义不变）");
  app2.beat.KeepAlive.sync();             // 停止后再 sync：不再申请
  ok(!app2.beat.KeepAlive.state().locked, "停止态 sync 不申请（lockReq 已随落定清位）");
}

/* ================= 场景 T234b：帧内 cum 前缀和缓存——跨小节切换不串味 ================= */
section("T234b 逐小节异构载体连播数圈：每帧 --f 与手工前缀和一致（缓存跨帧/跨小节均正确）");
{
  const app = loadApp();
  const S = app.beat.Store.S;
  S.countIn.on = false;
  /* 四小节各不同构：bar0 四分 / bar1 八分 / bar2 附点 / bar3 三连音——每小节的 steps
     是不同数组对象，缓存随小节切换重建；圈内多帧命中同一缓存 */
  app.beat.Store.importPresets(JSON.stringify({ presets: [{ name: "异构载体", meter: 4, bars: [
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    Array.from({ length: 8 }, () => ({ t: 24 })),
    [{ t: 36 }, { t: 12 }, { t: 36 }, { t: 12 }, { t: 36 }, { t: 12 }, { t: 36 }, { t: 12 }],
    Array.from({ length: 12 }, () => ({ t: 16 }))
  ] }] }));
  S.sel = { type: "custom", id: app.beat.Store.customs[app.beat.Store.customs.length - 1].id };
  app.beat.Presets.refreshAfterPatternChange();
  app.beat.Controls.start();
  const ac = FakeAudioContext.last;
  const cellsOf = () => [].concat.apply([], app.beat.Viz.internals().cellEls);
  const fOf = el => parseFloat(el.style["--f"] || "0");

  /* 手工前缀和（与实现同一公式，独立复算） */
  const cumOf = steps => { const c = []; let a = 0; for (const s of steps){ c.push(a); a += s.t; } c.push(a); return c; };
  const RAW = [
    [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }],
    Array.from({ length: 8 }, () => ({ t: 24 })),
    [{ t: 36 }, { t: 12 }, { t: 36 }, { t: 12 }, { t: 36 }, { t: 12 }, { t: 36 }, { t: 12 }],
    Array.from({ length: 12 }, () => ({ t: 16 }))
  ];
  const BARS = RAW.map(cumOf);
  const STEPS_N = [4, 8, 8, 12];
  const BAR_SEC = 2.5;                          // 96BPM 4/4

  /* 采样点只取**第 1 行**（bar 0 与 bar 2）：P>W 分页下 row = bar % 2，
     而页末行（row 1）在可听位置进入时会原地替换成预告行——那是另一条语义，不混进本场景 */
  const samples = [1.0, 1.8, 5.3, 5.9, 10.2];
  let si = 0;
  for (let i = 0; i < 560 && si < samples.length; i++){
    ac.currentTime += 0.02;
    app.beat.AudioEngine.scheduler();
    app.beat.Viz.paintFrame();
    if (ac.currentTime >= samples[si]){
      const t = ac.currentTime;
      const L = ac.hits[0].t;                   // 首颗发声 = loopStart（countIn 关，首音在 tick 0）
      const bar = Math.floor((t - L) / BAR_SEC) % 4;
      const tib = ((t - L) % BAR_SEC) / 0.625 * 48;
      const row = bar % 2;                      // 2 行窗口：页 0 = bar 0-1，页 1 = bar 2-3
      const cum = BARS[bar];
      let active = 0;
      for (let k = 0; k < STEPS_N[bar]; k++){ if (tib >= cum[k]) active = k; }
      const dur = cum[active + 1] - cum[active];
      const expect = dur < 24 ? 1 : Math.min(1, (tib - cum[active]) / dur);   // <半拍整块白（窄格口径）
      const cells = app.beat.Viz.internals().cellEls[row];
      let actEl = null, actIdx = -1;
      for (let k = 0; k < cells.length; k++){
        if (cells[k].classList.contains("active")){ actEl = cells[k]; actIdx = k; }
      }
      ok(actEl && actIdx === active, "t=" + t.toFixed(2) + "s（bar " + bar + " · row " + row
        + "）：active 格下标 " + actIdx + " = 手工推算 " + active);
      ok(actEl && Math.abs(fOf(actEl) - expect) < 0.01, "t=" + t.toFixed(2) + "s：--f "
        + fOf(actEl).toFixed(3) + " ≈ 手工前缀和推算 " + expect.toFixed(3) + "（缓存未串味）");
      si++;
    }
  }
  eq(si, samples.length, "前提：所有采样点都已到达（驱动窗足够长）");
  app.beat.Controls.stop();
}

/* ================= 场景 T234c：滚动预备拍计数——文本按拍翻转，帧间不重复写也不漏写 ================= */
section("T234c 滚动预备拍 statusText：预备 · N / 4 逐拍翻转（翻转才写的等价性）");
{
  const app = loadApp({ "beatsight.state": JSON.stringify({
    scrollMode: true, scrollRows: 3, countIn: { on: true, beats: 4 } }) });
  const beat = app.beat;
  const S = beat.Store.S;
  const statusEl = () => app.sandbox.document.getElementById("statusText");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  /* 每拍 0.625s：逐拍断言文本翻转（比「每帧都写」更强的契约——翻转漏了这里必红） */
  for (let b = 0; b < 4; b++){
    ac.currentTime = 0.1 + b * 0.625 + 0.2;   // 落在第 b+1 拍的中段
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    eq(statusEl().textContent, "预备 · " + (b + 1) + " / 4", "第 " + (b + 1) + " 拍读数正确");
    /* 同拍内再走几帧：文本必须保持（翻转才写不产生漏更） */
    for (let k = 0; k < 5; k++){
      ac.currentTime += 0.02;
      beat.AudioEngine.scheduler();
      beat.Viz.paintFrame();
    }
    eq(statusEl().textContent, "预备 · " + (b + 1) + " / 4", "第 " + (b + 1) + " 拍内多帧保持");
  }
  /* 预备拍数完 → 正式播放接管，文本脱离「预备 ·」前缀 */
  ac.currentTime = 0.1 + 4 * 0.625 + 0.3;
  beat.AudioEngine.scheduler();
  beat.Viz.paintFrame();
  ok(statusEl().textContent.indexOf("预备 ·") < 0, "预备拍数完 → 文本切换为正式播放读数");
  beat.Controls.stop();
}
