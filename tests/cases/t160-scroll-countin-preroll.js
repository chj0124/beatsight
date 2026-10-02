/* T160 滚动模式预备拍 · v3.2.3 同构预备拍道 + 方案 A + 竖线 + 停止态球残留。
   演进：v3.1.2 整组预滚（列车串，否决）→ v3.1.3 scroll 无球 →
   v3.1.4~v3.1.9 合成条（虚线框/拍格盒，用户实拍"不是同一类东西"，否决）→
   v3.2.2/v3.2.3 方案一：预备拍道 = **与真实跑道同构的真行**（.bar-row +
   buildRowLayers：beat-zone 拍区 + .tab 弦线 + ruler-lab 座次尺拍号 1..N），
   甲轨迹（左缘从播放杆出发逐拍左移，开播瞬间停在播放杆左侧紧贴处），
   方案 A（播完不撤，随 row0 传送带停播放杆左侧，首次回卷让位），
   挂 rowEls[0] 内（visibility 逐层覆盖：行 hidden、道 visible）。
   ★ v3.12.0 修订：方案 A 的"不撤"收口为**仅首个可听小节**——道在该小节最后一拍
   随整组 dy 滑出裁剪区、与其他跑道同款退场（判据 = 相对锚点，行为断言归 t171）；
   本文件的交接断言不受影响（交接帧 = 首个可听小节，道本就该在）。
   断言口径：display+visibility 双口径（v3.1.9 教训）；内容道**绝对位置**钉播放杆
   （v3.1.6 教训）；布局塌陷真机侧验证（v3.1.8 教训：桩不模拟文档流回流）。 */
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const txOf = r => { const m2 = /translate\(([-\d.]+)px/.exec(r.style.transform || ""); return m2 ? +m2[1] : null; };

section("T160 滚动预备拍（4 拍）· 同构预备拍道 + 内容道钉播放杆 + 方案A 不撤");
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

  /* ② 同构断言：预备拍道内 = ciBeats 个拍区 + ciBeats 个拍号标签（首标签 = "1"）
     + 拍边界接缝层（v3.12.0 起 = .seams 同款强缝，与正常跑道逐位一致） */
  const iv1 = beat.Viz.internals();
  const kids = Array.from(iv1.countLaneEl.children);
  const zones = kids.filter(k => k.className === "beat-zone");
  const labs = kids.filter(k => k.className.indexOf("ruler-lab") >= 0);   // 每拍一个计数数字（down 样式）
  const seams = kids.filter(k => k.className === "seams");
  eq(zones.length, 4, "★ 预备拍道拍区数 = 4（同构 .beat-zone）");
  eq(labs.length, 4, "★ 预备拍道座次尺标签数 = 4");
  eq(labs[0].textContent, "1", "★ 首拍号 = 1（计数数字）");
  eq(seams.length, 1, "★ 预备拍道挂行级 .seams 覆盖层（与正常跑道同一类元素）");
  const smBg = seams[0].style.background;
  eq((smBg.match(/var\(--seam-strong\)/g) || []).length, 6,
    "★ 拍边界 = 拍数 − 1 条强缝（4 拍 → 3 条 × 每条 2 个色标 = 6 处 seam-strong）");
  ok(smBg.indexOf("25%") >= 0 && smBg.indexOf("50%") >= 0 && smBg.indexOf("75%") >= 0,
    "★ 强缝骑缝定位（25% / 50% / 75% 拍边界）", "background=" + smBg.slice(0, 80));
  eq(kids.filter(k => k.className === "grid-line").length, 0,
    "★ 旧 .grid-line 竖线已退役（短一截、细一档、色不同——用户实拍的「竖线有问题」根因）");

  /* ③ 内容道：绝对位置 = 播放杆处（C − left），全程不动（v3.1.6 教训） */
  near(txOf(iv1.rowEls[1]), C - g0.left, 2, "★ 内容道 tx = C − left（贴播放杆右侧）");
  near(txOf(iv1.rowEls[2]), C - g0.left, 2, "★ 内容道（第 3 条）同位");

  /* ④ 交接后首个可听小节内：预备拍道不撤（row0 保持 hidden 由道顶替）——
     v3.12.0 起道的退场推迟到第二个可听小节（随 dy 滑出，归 t171），交接帧本就该在 */
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
  eq(laneAfterHandover, "block", "★ 交接后首个可听小节内预备拍道不撤（以刚播完的道停播放杆左侧）");
  eq(row0AfterHandover, "hidden", "★ 交接后 row0 保持隐藏（预备拍道顶替显示；第二小节的退场归 t171）");
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
section("T160c 预备拍拍数自适应 · 拍区/拍号/道长随拍数变");
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
    eq(handoverRow0, "hidden", `★ ${beats} 拍：交接后首个可听小节内 row0 保持隐藏（预备拍道顶替显示）`);
  }
}

/* ================= T160d 预设 2 小节循环 · 首小节维持、第二小节退场 =================
   循环场景（loopRange 2 小节）：首个可听小节内跨网格重建道仍在（会话维持）；
   播到第二个可听小节（cur 1→2 推进）会话结束、道撤、row0 显形、跨回卷不复活。
   ★ 本组曾是"方案A 播完不撤"的断言——v3.12.0 用户拍板"退场与其他跑道一样"，
     方案 A 收口为"仅首个可听小节维持"：这不是回归，是语义按新口径重写（t171 同族）。 */
section("T160d 预设 2 小节循环 · 首小节维持、第二小节退场（v3.12.0 新口径）");
{
  const app = loadApp(seedState({
    scrollMode: true, scrollRows: 3,
    countIn: { on: true, beats: 1 },
    loopRange: { on: true, from: 1, to: 2 },   // 2 小节循环：cur 每小节变化 → 每小节重建
    sel: { type: "builtin", idx: 1 },
  }));
  const { beat, els } = app;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  // 预备拍 1 拍（0.625s）+ 首小节内 0.475s（96BPM 一小节 2.5s）——仍在首个可听小节
  drive(ac, beat, 1.1, () => beat.Viz.paintFrame());
  const iv1 = beat.Viz.internals();
  eq(iv1.countLaneEl.style.display, "block", "★ 首个可听小节内预备拍道在（会话维持，跨重建不误伤）");
  eq(iv1.rowEls[0].style.visibility, "hidden", "★ 首小节内 row0 由道顶替");
  eq(Array.from(iv1.countLaneEl.children).filter(k => k.className === "beat-zone").length, 1,
    "★ 首小节内预备拍道为 1 拍（长度 = 预备拍拍数）");
  // 越过首个可听小节（再 2s，累计可听 > 1 小节）+ 跨多轮回卷（共 6s）
  drive(ac, beat, 6.0, () => beat.Viz.paintFrame());
  const iv2 = beat.Viz.internals();
  eq(iv2.countLaneEl.style.display, "none", "★ 第二可听小节起道已退场（v3.12.0：随 dy 滑出、跨回卷不复活）");
  eq(iv2.rowEls[0].style.visibility, "", "★ row0 显形 = 真实上一小节内容就位（不再留空槽）");
  eq(iv2.countLane.session, false, "★ 会话已结束（不再维持）");
}

/* ================= T160e 滚动停止态无球（v3.2.3） =================
   路径 A：加载即滚动（球元素默认可见、无人隐藏）；路径 B：分页播放残留球
   → 切滚动（applyScrollRest 清理，internals 导出）。 */
section("T160e 滚动停止态无球 · 路径 A/B");
{
  // 路径 A：加载即滚动（停止态，从未播放）
  const a = loadApp(seedState({ scrollMode: true, scrollRows: 3, countIn: { on: false }, sel: { type: "builtin", idx: 1 } }));
  const ia = a.beat.Viz.internals();
  eq(ia.ballEl.style.display, "none", "★ 路径A：加载即滚动，球初始隐藏");
  // 路径 B：分页播放中（球可见）→ 切滚动
  const b = loadApp(seedState({ scrollMode: false, scrollRows: 3, sel: { type: "builtin", idx: 1 } }));
  const bb = b.beat;
  bb.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, bb, 0.5, () => bb.Viz.paintFrame());
  eq(b.beat.Viz.internals().ballEl.style.display, "", "前提B：分页播放中球可见（常态）");
  /* 切模式路径：S.scrollMode 翻转（开关 handler 同款）+ applyScrollRest——
     滚动停止态清理三球（球残留修复的目标路径） */
  bb.Store.S.scrollMode = true;
  bb.Viz.internals().applyScrollRest();
  const ivb = bb.Viz.internals();
  eq(ivb.ballEl.style.display, "none", "★ 路径B：切滚动后球隐藏");
  eq(ivb.shadowEl.style.display, "none", "★ 路径B：影子隐藏");
}
