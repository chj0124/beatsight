/* T160 滚动模式预备拍 · v3.1.7 专用预备拍条。
   演进：v3.1.2 整组预滚（列车串，用户否决）→ v3.1.3 scroll 无球 →
   v3.1.4/5 复用整宽填充行滑距自适应（道长恒 RBc 格，长度对不上，用户指出）→
   v3.1.7 专用预备拍条：条长 = ciBeats×每拍像素（几拍就多长），内嵌每拍一格的
   格线，从播放杆处随计数逐拍左移；真实第一道整行隐藏，交接撤条复位；
   内容道全程钉在播放杆处（绝对位置断言——v3.1.6 教训：只验"不动"不验"在哪"
   会漏掉甩出布局的回归）。 */
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const txOf = r => { const m2 = /translate\(([-\d.]+)px/.exec(r.style.transform || ""); return m2 ? +m2[1] : null; };

section("T160 滚动预备拍（4 拍）· 专用预备拍条 + 内容道钉播放杆 + 交接复位");
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

  /* ① 预备拍条：显示、条长 = ciBeats×每拍像素（几拍就多长）、随计数左移 */
  let trackFirst = null, trackLast = null, widthSeen = null, row0SeenVisible = false;
  drive(ac, beat, 1.0, () => {
    beat.Viz.paintFrame();
    const iv = beat.Viz.internals();
    const t = iv.countTrackEl;
    /* ★ 双口径：display=block 且 visibility≠hidden 才算"看得见"
       （v3.1.9 教训：条挂在 visibility:hidden 的行内时，只查 display 会假绿） */
    if (t.style.display !== "none" && t.style.visibility !== "hidden"){
      const tx = txOf(t);
      if (trackFirst === null) trackFirst = tx;
      trackLast = tx;
      widthSeen = t.style.width;
    }
    if (iv.rowEls[0].style.visibility !== "hidden") row0SeenVisible = true;
  });
  ok(trackFirst !== null, "前提：预备拍条已显示");
  near(parseFloat(widthSeen), perBeat * 4, 2,
    "★ 条长 = 预备拍拍数 × 每拍像素（4 拍 = 一个行宽）", "width=" + widthSeen);
  ok(trackFirst - trackLast > perBeat && trackFirst > trackLast,
    "★ 预备拍条随计数左移（1 秒内 ≥ 1 格，每声计数一格过播放杆）",
    trackFirst + " → " + trackLast);
  eq(row0SeenVisible, false, "★ 真实第一道整行隐藏（由预备拍条接管）");
  /* ★ v3.1.8 布局塌陷守卫（真机侧验证）：第一道必须 visibility（占位保留）而不是
     display——display 会让行脱离文档流、整列上移一槽（预备拍条压在内容上，用户实拍）。
     ★ 桩测不了塌陷：桩的 offsetTop 按创建序固定、不模拟文档流回流（display:none
       不改变其他元素 offsetTop）——这里断言会假绿。塌陷由真机 CDP 探针验证
       （预备拍期间内容道 rect.top 不得上移）。 */

  /* ② 内容道：绝对位置 = 播放杆处（C − left），全程不动
     ★ v3.1.6 教训：只验"不动"不验"在哪"，恒定在错误位置照样绿 */
  const iv1 = beat.Viz.internals();
  near(txOf(iv1.rowEls[1]), C - g0.left, 2, "★ 内容道 tx = C − left（贴播放杆右侧）");
  near(txOf(iv1.rowEls[2]), C - g0.left, 2, "★ 内容道（第 3 条）同位");

  /* ③ 交接：撤条 + 复位第一道 + 内容道开始滚动 */
  let handoverSeen = false, trackAfterHandover = null, row0Restored = null, contentDrift = 0, contentPrev = null;
  drive(ac, beat, 1.8, () => {
    beat.Viz.paintFrame();
    const iv3 = beat.Viz.internals();
    const counting = els["statusText"].textContent.indexOf("预备拍") >= 0;
    if (!counting && !handoverSeen){
      handoverSeen = true;
      trackAfterHandover = iv3.countTrackEl.style.display;
      row0Restored = iv3.rowEls[0].style.display;
    }
    const t1 = txOf(iv3.rowEls[1]);
    if (handoverSeen && contentPrev !== null) contentDrift = Math.max(contentDrift, Math.abs(t1 - contentPrev));
    contentPrev = t1;
  });
  ok(handoverSeen, "前提：跨过预备拍进入播放");
  eq(trackAfterHandover, "none", "★ 开播后预备拍条撤除");
  eq(row0Restored, "", "★ 开播后真实第一道复位（display 恢复）");
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

/* ================= T160c 预备拍拍数自适应（v3.1.7 的核心诉求） =================
   条长 = ciBeats×每拍像素：预备拍 3/2/1 拍时条就只有 3/2/1 格长（v3.1.4/5 的
   道长恒 RBc 格问题就此根治）；交接后条撤、真实行复位。 */
section("T160c 预备拍拍数自适应 · 条长随拍数变，交接复位");
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
    const C = g0.left + g0.width / 2;
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    let widthSeen = null, row0Hidden = true, handoverRow0 = null, contentRef = null, contentSteady = true;
    let prevContent = null, maxContentJump = 0;
    drive(ac, beat, beats * 0.625 + 0.4, () => {
      beat.Viz.paintFrame();
      const iv2 = beat.Viz.internals();
      const counting = els["statusText"].textContent.indexOf("预备拍") >= 0;
      const t1 = txOf(iv2.rowEls[1]);
      if (counting){
        const t = iv2.countTrackEl;
        if (t.style.display !== "none") widthSeen = t.style.width;
        if (iv2.rowEls[0].style.visibility !== "hidden") row0Hidden = false;
        if (contentRef === null) contentRef = t1;
        if (t1 !== contentRef) contentSteady = false;
      } else if (handoverRow0 === null){
        handoverRow0 = iv2.rowEls[0].style.visibility;   // 开播第一帧
      }
      if (prevContent !== null) maxContentJump = Math.max(maxContentJump, Math.abs(t1 - prevContent));
      prevContent = t1;
    });
    ok(widthSeen !== null && Math.abs(parseFloat(widthSeen) - beats * perBeat) < 2,
      `★ ${beats} 拍：条长 = ${beats}×每拍像素（几拍就多长）`, "width=" + widthSeen);
    eq(row0Hidden, true, `★ ${beats} 拍：预备拍期间真实第一道保持隐藏`);
    near(contentRef, C - g0.left, 2, `★ ${beats} 拍：内容道绝对位置 = 播放杆处`);
    ok(contentSteady, `★ ${beats} 拍：内容道全程钉在播放杆处`);
    ok(maxContentJump < 40, `★ ${beats} 拍：预备拍→播放衔接零跳变（内容道逐帧连续）`,
      "最大帧间差 " + maxContentJump + "px");
    eq(handoverRow0, "", `★ ${beats} 拍：开播后真实第一道复位（visibility 恢复）`);
  }
}
