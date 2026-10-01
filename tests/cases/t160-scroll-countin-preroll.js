/* T160 滚动模式预备拍 · v3.2.2 同构预备拍道。
   演进：v3.1.2 整组预滚（列车串，否决）→ v3.1.3 scroll 无球 →
   v3.1.4~v3.1.9 合成条（虚线框/拍格盒，用户实拍"不是同一类东西"，否决）→
   v3.2.2 方案一：预备拍道 = **与真实跑道同构的真行**（.bar-row + buildRowLayers：
   beat-zone 拍区 + .tab 弦线 + ruler-lab 座次尺拍号——拍号即计数数字 1..N），
   甲轨迹（左缘从播放杆出发逐拍左移，开播瞬间停在播放杆左侧紧贴处），
   挂 rowEls[0] 内（visibility 逐层覆盖：行 hidden、道 visible）。
   断言口径：display+visibility 双口径（v3.1.9 教训）；内容道**绝对位置**钉播放杆
   （v3.1.6 教训）；布局塌陷真机侧验证（v3.1.8 教训：桩不模拟文档流回流）。 */
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const txOf = r => { const m2 = /translate\(([-\d.]+)px/.exec(r.style.transform || ""); return m2 ? +m2[1] : null; };

section("T160 滚动预备拍（4 拍）· 同构预备拍道 + 内容道钉播放杆 + 交接复位");
{
  const app = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 4 },
    sel: { type: "builtin", idx: 1 },
  }));
  const { beat, els } = app;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const g0 = beat.Viz.internals().rowGeo[0];
  const C = g0.left + g0.width / 2;
  const perBeat = g0.width / 4;

  /* ① 预备拍道：可见、宽 = ciBeats×每拍像素、甲轨迹（左移穿过播放杆） */
  let laneFirst = null, laneLast = null, widthSeen = null, row0VisOK = true;
  drive(ac, beat, 1.0, () => {
    beat.Viz.paintFrame();
    const iv = beat.Viz.internals();
    const t = iv.countLaneEl;
    const shown = t.style.display === "block" && t.style.visibility !== "hidden";
    if (shown){
      const tx = txOf(t);
      if (laneFirst === null) laneFirst = tx;
      laneLast = tx;
      widthSeen = t.style.width;
    }
    if (iv.rowEls[0].style.visibility !== "hidden") row0VisOK = false;
  });
  ok(laneFirst !== null, "前提：预备拍道已显示（display+visibility 双口径）");
  near(parseFloat(widthSeen), perBeat * 4, 2, "★ 道长 = 预备拍拍数 × 每拍像素（4 拍 = 一个行宽）",
    "width=" + widthSeen);
  ok(laneFirst - laneLast > perBeat && laneFirst > laneLast,
    "★ 预备拍道随计数左移（1 秒内 ≥ 1 格，每声计数一格过播放杆）",
    laneFirst + " → " + laneLast);
  eq(row0VisOK, true, "★ 真实第一道全程 visibility:hidden（预备拍道挂在其中、逐层覆盖显示）");

  /* ② 同构断言：预备拍道内 = ciBeats 个拍区 + ciBeats 个拍号标签（首标签 = "1"） */
  const iv1 = beat.Viz.internals();
  /* 桩元素无 querySelectorAll——用 children 过滤（同构断言口径） */
  const kids = Array.from(iv1.countLaneEl.children);
  const zones = kids.filter(k => k.className === "beat-zone");
  const labs = kids.filter(k => k.className.indexOf("ruler-lab") >= 0);   // 每拍一个计数数字（down 样式）
  eq(zones.length, 4, "★ 预备拍道拍区数 = 4（同构 .beat-zone）");
  eq(labs.length, 4, "★ 预备拍道座次尺标签数 = 4");
  eq(labs[0].textContent, "1", "★ 首拍号 = 1（计数数字）");

  /* ③ 内容道：绝对位置 = 播放杆处（C − left），全程不动（v3.1.6 教训） */
  near(txOf(iv1.rowEls[1]), C - g0.left, 2, "★ 内容道 tx = C − left（贴播放杆右侧）");
  near(txOf(iv1.rowEls[2]), C - g0.left, 2, "★ 内容道（第 3 条）同位");

  /* ④ 交接：道隐藏 + row0 复位 + 内容道开始滚动 */
  let handoverSeen = false, laneAfterHandover = null, row0AfterHandover = null, contentDrift = 0, contentPrev = null;
  drive(ac, beat, 1.8, () => {
    beat.Viz.paintFrame();
    const iv3 = beat.Viz.internals();
    const counting = els["statusText"].textContent.indexOf("预备拍") >= 0;
    if (!counting && !handoverSeen){
      handoverSeen = true;
      laneAfterHandover = iv3.countLaneEl.style.display;
      row0AfterHandover = iv3.rowEls[0].style.visibility;
    }
    const t1 = txOf(iv3.rowEls[1]);
    if (handoverSeen && contentPrev !== null) contentDrift = Math.max(contentDrift, Math.abs(t1 - contentPrev));
    contentPrev = t1;
  });
  ok(handoverSeen, "前提：跨过预备拍进入播放");
  eq(laneAfterHandover, "none", "★ 开播后预备拍道撤除");
  eq(row0AfterHandover, "", "★ 开播后真实第一道 visibility 复位");
  ok(contentDrift > 0, "★ 开播后内容道开始正常滚动（接管预滚）");
}

section("T160b 分页预备拍球 · 幽灵步回归（scroll 改造不影响 paged）");
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
    const m = /translate\(([-\d.]+)px/.exec(b.style.transform || "");
    if (m) xs.push(+m[1]);
  });
  ok(xs.length >= 3, "前提：采样到球的多个位置", "样本 " + xs.length);
  ok(xs[xs.length - 1] > xs[0] + geo0.width / 4,
    "★ 分页预备拍：球沿行向右走幽灵步", "x " + xs[0] + " → " + xs[xs.length - 1]);
  ok(xs.every(x => x >= geo0.left - 20 && x <= geo0.left + geo0.width + 20),
    "★ 分页预备拍：球始终在行 0 的 x 范围内");
}

/* ================= T160c 预备拍拍数自适应 ================= */
section("T160c 预备拍拍数自适应 · 拍区/拍号/道长随拍数变，交接复位");
{
  for (const beats of [3, 2, 1, 8]){
    const app = loadApp(seedState({
      scrollMode: true, scrollRows: 3,
      countIn: { on: true, beats },
      sel: { type: "builtin", idx: 1 },
    }));
    const { beat, els } = app;
    const g0 = beat.Viz.internals().rowGeo[0];
    const perBeat = g0.width / 4;
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    let widthSeen = null, zonesSeen = null, row0Hidden = true, handoverRow0 = null;
    drive(ac, beat, beats * 0.625 + 0.4, () => {
      beat.Viz.paintFrame();
      const iv2 = beat.Viz.internals();
      const counting = els["statusText"].textContent.indexOf("预备拍") >= 0;
      if (counting){
        const t = iv2.countLaneEl;
        if (t.style.display === "block") widthSeen = t.style.width;
        const zn = Array.from(t.children).filter(k => k.className === "beat-zone").length;
        if (zn) zonesSeen = zn;
        if (iv2.rowEls[0].style.visibility !== "hidden") row0Hidden = false;
      } else if (handoverRow0 === null){
        handoverRow0 = iv2.rowEls[0].style.visibility;   // 开播第一帧
      }
    });
    ok(widthSeen !== null && Math.abs(parseFloat(widthSeen) - beats * perBeat) < 2,
      `★ ${beats} 拍：道长 = ${beats}×每拍像素（几拍就多长）`, "width=" + widthSeen);
    eq(zonesSeen, beats, `★ ${beats} 拍：预备拍道拍区数 = ${beats}（几拍就几格）`);
    eq(row0Hidden, true, `★ ${beats} 拍：预备拍期间真实第一道保持 visibility:hidden`);
    eq(handoverRow0, "", `★ ${beats} 拍：开播后真实第一道复位`);
  }
}
