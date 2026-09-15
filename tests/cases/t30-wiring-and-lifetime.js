/* BeatSight 自动化测试 · 接线与生命周期：弹跳球物理 / 事件处理器体 / 旧键清理 / 播放中改 BPM
   T30–T36。覆盖率工具指出的接线空白层与 v1.3.4 的播放头一致性。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, pill, driveFrames, ok, eq, near, section, PROBE, resetProbe, html } = require("../lib/harness");

/* ================================================================================
   场景 T30–T32：v1.3.1「遗留问题」
   T30 弹跳球物理的逐帧数值断言（此前 399 行 Viz 里最容易悄悄改坏的一块完全无断言）
   T31 交互接线覆盖（事件处理器体——覆盖率工具显示这一层是大片空白）
   T32 旧键清理（冷热迁移完成后删除 beatsight.m2）
   ================================================================================ */

section("T30 弹跳球物理 · 逐帧数值断言（v1.3.1）");
{
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv = beat.Viz.internals();
  const CB = beat.CONFIG.bounce;
  ok(!!iv.ballEl && !!iv.shadowEl && !!iv.waitEl, "弹跳球三件套已渲染（球 / 影子 / 接力待命球）");

  const nums = s => (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const state = () => {
    const b = nums(iv.ballEl.style.transform);
    const sh = nums(iv.shadowEl.style.transform);
    return {
      x: b[0], y: b[1],
      sx: b.length > 2 ? b[2] : 1, sy: b.length > 2 ? b[3] : 1,
      shx: sh[0], shy: sh[1], shs: sh.length > 2 ? sh[2] : 1,
      op: iv.shadowEl.style.opacity === "" ? NaN : +iv.shadowEl.style.opacity,
      wait: iv.waitEl.style.display !== "none",
    };
  };

  /* 采样整条时间线（细步长 → 采样点距发声时刻 ≤ 1.25ms，落点对齐可严格断言） */
  const TPB = 48;                                    // 沙箱内的 PPQN，测试侧复刻一份
  const loopStart = beat.clock().loopStart;
  const barDur = beat.Store.S.sig * (60 / beat.Store.S.bpm);   // 一小节秒数 = 拍数 × 秒/拍
  const samples = [];
  const onsets = new Map();
  const DT = 0.0025;
  for (let i = 0; i < Math.round(barDur * 2 / DT); i++){          // 跑满两个小节
    ac.currentTime += DT;
    beat.Audio.scheduler();
    beat.Viz.paintFrame();
    beat.onsetBuf().forEach(e => onsets.set(e.bar + ":" + e.t.toFixed(4), e));
    samples.push(Object.assign({ now: ac.currentTime }, state()));
  }
  const os = [...onsets.values()].filter(e => e.bar === 0).sort((a, b) => a.t - b.t);
  ok(os.length >= 5, `采集到第 1 小节的 ${os.length} 个发声点`);

  /* 几何：落点 = 音符块左缘（原实现读 offset，v1.3 起读缓存，两者都必须等于这个式子） */
  const g = iv.rowGeo[0];
  const barTicks = beat.Store.S.sig * TPB;
  const expectX = cumT => g.left + (cumT / barTicks) * g.width - 8;

  /* ① 落点 = 真实发声时刻：每个发声点的最近采样应落在该音符块左缘 */
  let worstX = 0, worstAt = null;
  for (const e of os){
    let best = null;
    for (const s of samples) if (!best || Math.abs(s.now - e.t) < Math.abs(best.now - e.t)) best = s;
    if (!best) continue;
    const d = Math.abs(best.x - expectX(e.cumT));
    if (d > worstX){ worstX = d; worstAt = "cumT=" + e.cumT; }
  }
  ok(worstX < 2, `每个发声点的落点都贴着该音符块左缘（最大偏差 ${worstX.toFixed(2)}px @ ${worstAt}）`);

  /* ② 抛物线：取第一条完整弧（os[0] → os[1]）逐点验证 y = yBase − H·4p(1−p) */
  {
    const A = os[0], B = os[1], T = B.t - A.t;
    const yBase = g.top - 20;
    const H = Math.min(Math.max(CB.min, Math.min(CB.max, CB.k * T * T)), yBase + 6);
    const inArc = samples.filter(s => s.now > A.t + 0.05 && s.now < B.t - 0.05);   // 去掉两端挤压窗口
    let worstY = 0, peak = 0, peakAt = 0;
    for (const s of inArc){
      const p = (s.now - A.t) / T;
      const yExp = yBase - H * 4 * p * (1 - p);
      worstY = Math.max(worstY, Math.abs(s.y - yExp));
      const h = yBase - s.y;
      if (h > peak){ peak = h; peakAt = p; }
    }
    ok(worstY < 1.5, `弧内每帧 y 都符合重力抛物线 y=yBase−H·4p(1−p)（最大偏差 ${worstY.toFixed(2)}px，H=${H.toFixed(1)}）`);
    ok(Math.abs(peak - H) < 1 && Math.abs(peakAt - 0.5) < 0.12,
      `实测跳高 ${peak.toFixed(1)}px ≈ 公式值 ${H.toFixed(1)}px，且最高点在中点附近（p=${peakAt.toFixed(2)}）`);
    ok(H <= CB.max, `跳高不超过 CONFIG.bounce.max（${H.toFixed(1)} ≤ ${CB.max}）`);
  }

  /* ③ 触地挤压 → 空中拉伸（体积近似守恒） */
  {
    const A = os[0], T = os[1].t - A.t;
    /* 只取挤压窗口的前 50%：窗口末端 sy/sx 已回落到 1（回弹收尾），那是设计而非缺陷，
       卡在边界上断言只会得到浮点噪声（实测 f=0.68 时 sy 已回到 0.967） */
    const touch = samples.filter(s => s.now >= A.t && s.now < A.t + CB.squash * 0.5);
    const mid = samples.find(s => Math.abs((s.now - A.t) / T - 0.5) < 0.03) || samples[0];
    ok(touch.length > 0 && touch.every(s => s.sy < 0.95 && s.sx > 1.05),
      `触地挤压明显（${touch.length} 帧：sy<0.95 且 sx>1.05，首帧 sy=${touch[0].sy.toFixed(3)}/sx=${touch[0].sx.toFixed(3)}）`);
    ok(mid.sy > 1 && mid.sx < 1, `弧中点拉伸（sy=${mid.sy.toFixed(3)}>1、sx=${mid.sx.toFixed(3)}<1，体积近似守恒）`);
  }

  /* ④ 地面投影：球越高 → 影子越小越淡 */
  {
    const A = os[0], B = os[1];
    const inArc = samples.filter(s => s.now > A.t + CB.squash && s.now < B.t - CB.squash);
    const top = inArc.reduce((a, b) => (b.y < a.y ? b : a));
    /* 「落地采样」直接取全场最接近 B.t 的那一帧（inArc 排掉了两端，取不到真正的落地点） */
    const land = samples.reduce((a, b) => (Math.abs(b.now - B.t) < Math.abs(a.now - B.t) ? b : a));
    ok(top.op < land.op && top.shs < land.shs,
      `影子随高度变小变淡（最高处 opacity=${top.op.toFixed(3)}/scale=${top.shs.toFixed(3)}，落地 opacity=${land.op.toFixed(3)}/scale=${land.shs.toFixed(3)}）`);
    ok(land.shs > 0.9, `落地时影子几乎未被压缩（scale=${land.shs.toFixed(3)}）`);
    ok(Math.abs(top.shx - top.x) <= 1.5, `影子水平跟随球体（偏差 ${Math.abs(top.shx - top.x).toFixed(1)}px，即球-影固定偏移）`);
  }

  /* ⑤ 接力待命球：只在「终端弧」（本小节最后一颗 → 行右缘）飞行期间出现 */
  {
    const firstWindow = samples.filter(s => s.now > loopStart && s.now < loopStart + barDur * 0.25);
    const lastWindow = samples.filter(s => s.now > loopStart + barDur * 0.8 && s.now < loopStart + barDur);
    ok(firstWindow.length && firstWindow.every(s => !s.wait), "小节开头（非终端弧）不显示待命球");
    ok(lastWindow.some(s => s.wait), "小节末尾（终端弧）显示待命球——下一小节的第一颗已在待命");
  }

  /* ⑥ 关掉开关：球与影子一起隐藏，且不再写 transform */
  {
    beat.Store.S.bounce = false;
    ac.currentTime += DT;
    beat.Viz.paintFrame();
    eq(iv.ballEl.style.display, "none", "S.bounce=false → 球隐藏（只控显隐，onset 表照常维护）");
    eq(iv.shadowEl.style.display, "none", "影子同步隐藏");
    eq(iv.waitEl.style.display, "none", "待命球同步隐藏");
    beat.Store.S.bounce = true;
  }

  /* ⑦ prefers-reduced-motion：保位置、去形变（前庭敏感用户不该被挤压/拉伸打扰） */
  {
    const rm = loadApp({}, { reduceMotion: true });
    rm.beat.Controls.start();
    const rac = FakeAudioContext.last;
    const riv = rm.beat.Viz.internals();
    let deform = 0, moved = 0, prevX = null;
    for (let i = 0; i < 400; i++){
      rac.currentTime += DT;
      rm.beat.Audio.scheduler();
      rm.beat.Viz.paintFrame();
      const b = nums(riv.ballEl.style.transform);
      if (b.length > 2 && (Math.abs(b[2] - 1) > 1e-6 || Math.abs(b[3] - 1) > 1e-6)) deform++;
      if (prevX !== null && Math.abs(b[0] - prevX) > 1e-6) moved++;
      prevX = b[0];
    }
    eq(deform, 0, "reduced-motion：全程无形变（scale 恒为 1,1）");
    ok(moved > 50, `reduced-motion：位置照常推进 ${moved} 帧（球何时落拍是核心功能提示，不能去掉）`);
  }

  /* ⑧ 触顶钳制：「顶点不出容器空域」H = min(H, A.y + 6)。单独构造场景的理由：
     ② 里的 H 是照着同一条公式复算出来的，只有「弧足够长、钳制真的成为约束」时删掉它才会变红。
     默认 96 BPM 下原始跳高 46.9px 仅比上界 44px 高 2.9px，余量太薄（默认速度一改就悄悄失效）。
     这里降到 60 BPM（每弧 1.0s）：原始 120px 先被 max 截到 48px，仍明显高于上界 44px →
     钳制成为唯一约束，实测跳高必须等于上界（而非 48px）；删掉钳制必然变红。 */
  {
    const slow = loadApp();
    slow.beat.Controls.setBpm(60);                          // 慢速 → 长弧 → 原始跳高触顶
    slow.beat.Controls.start();
    const sac = FakeAudioContext.last;
    const siv = slow.beat.Viz.internals();
    const yBase2 = siv.rowGeo[0].top - 20;                  // 第 1 行基线（即 A.y）
    const cap = yBase2 + 6;                                 // 钳制上界：顶点最多再往上 6px
    ok(cap < CB.max, `构造前提成立：钳制上界 ${cap}px < max ${CB.max}px，钳制确实有生效空间`);

    let minY = Infinity;
    const sOnsets = new Map();
    for (let i = 0; i < Math.round(3 / DT); i++){           // 跑满 3s：60 BPM 下第 1 小节约 4s，弧足够长
      sac.currentTime += DT;
      slow.beat.Audio.scheduler();
      slow.beat.Viz.paintFrame();
      slow.beat.onsetBuf().forEach(e => sOnsets.set(e.bar + ":" + e.t.toFixed(4), e));
      const yy = nums(siv.ballEl.style.transform)[1];
      if (isFinite(yy) && yy < minY) minY = yy;             // 记录整段时间里的最高点（y 越小越高）
    }
    const sos = [...sOnsets.values()].filter(e => e.bar === 0).sort((a, b) => a.t - b.t);
    ok(sos.length >= 5, `慢速下仍采集到第 1 小节的 ${sos.length} 个发声点`);
    const T2 = sos[1].t - sos[0].t;
    const rawH = Math.min(CB.max, Math.max(CB.min, CB.k * T2 * T2));
    ok(rawH > cap + 1, `弧够长：未钳制跳高 ${rawH.toFixed(1)}px 高于上界 ${cap}px（T=${T2.toFixed(2)}s）`);
    const peak2 = yBase2 - minY;                            // 实测跳高 = 基线 − 最高点
    near(peak2, cap, 1.5, `实测跳高 ${peak2.toFixed(1)}px = 钳制值 ${cap}px（未钳制会是 ${rawH.toFixed(1)}px）`);
    ok(Math.abs(peak2 - rawH) > 2,
      `实测明显低于未钳制值（${peak2.toFixed(1)} vs ${rawH.toFixed(1)}px）——钳制真的在起作用`);
    ok(minY >= yBase2 - cap - 1.5,
      `顶点始终未越过空域上界（最高点 y=${minY.toFixed(1)} ≥ ${(yBase2 - cap).toFixed(1)}px）`);
    slow.beat.Controls.stop();
  }
}

section("T31 交互接线 · 事件处理器体（v1.3.1，覆盖率工具指出的空白层）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;

  /* 三组 pill 的真实点击路径（handler 里读 btn.dataset；桩里 pill() 提供 closest） */
  els["sigRow"].fire("click", { target: pill({ sig: "6" }) });
  eq(S.sig, 6, "点 6/8 → 拍号生效");
  eq(els["sigRow"].children[4].getAttribute("aria-pressed"), "true", "同一路径上 aria-pressed 也同步");
  els["sigRow"].fire("click", { target: pill({}) });
  eq(S.sig, 6, "点到行空白处（closest 返回 null）→ 提前返回，不改拍号");
  els["swingRow"].fire("click", { target: pill({ swing: "67" }) });
  eq(S.swing, 67, "点 Swing 档 → 生效");
  els["timbreRow"].fire("click", { target: pill({ timbre: "wood" }) });
  eq(S.timbre, "wood", "点音色档 → 生效");

  /* 奇数拍重拍分组行（按钮是动态生成的，直接触发它的 click） */
  beat.Controls.setSig(5);
  const accBtns = els["accRow"].children;
  eq(accBtns.length, 2, "5/4 → 生成 2 个重拍分组档");
  accBtns[1].fire("click");
  eq(S.accentGrp[5], 1, "点第二个分组档 → accentGrp 更新为 3+2");

  /* 音量滑杆：input 只改状态与文案（拖动过程不落盘），change 才落盘 */
  els["volMaster"].value = "45"; els["volMaster"].fire("input");
  eq(S.vol, 0.45, "总音量 input → 状态更新");
  eq(els["volMasterPct"].textContent, "45%", "百分比文案同步");
  els["volAccent"].value = "20"; els["volAccent"].fire("input");
  eq(S.accentVol, 0.2, "重拍增强量 input → 状态更新");

  /* 快捷速度档（按钮在 Controls 初始化时生成） */
  const presetBtn = els["bpmPresetRow"].children.find(b => b.textContent === "120");
  presetBtn.fire("click");
  eq(S.bpm, 120, "点快捷档 120 → BPM 生效");

  /* 播放键与空格键 */
  els["playBtn"].fire("click");
  ok(S.playing, "点播放键 → 开始播放");
  app.fireWin("keydown", { code: "Space" });
  ok(!S.playing, "空格键 → 停止（键盘与按钮同一入口）");
  app.fireWin("keydown", { code: "Space" });
  ok(S.playing, "再按空格 → 继续播放");
  els["playBtn"].fire("click");
  ok(!S.playing, "再点播放键 → 停止");

  /* ±1 / ±5 步进（pointerdown 走 bindStep；长按分支靠 setTimeout，桩里不真延迟） */
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 125, "点 +5 → 125");
  els["bpmMinus5"].fire("pointerdown");
  els["bpmMinus5"].fire("pointerup");
  eq(S.bpm, 120, "点 -5 再抬指 → 回到 120");

  /* BPM 数字 → 弹窗输入 */
  els["bpmNum"].fire("click");
  eq(els["modalMask"].hidden, false, "点 BPM 数字 → 弹出输入框");
  els["modalInput"].value = "88";
  els["modalOk"].fire("click");
  eq(S.bpm, 88, "确认后 BPM 应用");

  /* TAP 测速：两次点击间隔 600ms → 100 BPM */
  let clock = 1000; app.setNow(clock);
  els["tapBtn"].fire("click");
  eq(els["tapBtn"].textContent, "TAP · 再点一次", "第一次点击提示再点");
  clock += 600; app.setNow(clock);
  els["tapBtn"].fire("click");
  eq(S.bpm, 100, "两次点击间隔 600ms → 100 BPM");
  ok(/TAP · 100 BPM/.test(els["tapBtn"].textContent), "按钮回显测得的 BPM");

  /* 预备拍拍数输入：脏值回退原值，越界钳制 */
  els["countInBeats"].value = "99"; els["countInBeats"].fire("change");
  eq(S.countIn.beats, 8, "预备拍数超上限 → 钳到 8");
  els["countInBeats"].value = "abc"; els["countInBeats"].fire("change");
  eq(S.countIn.beats, 8, "预备拍数脏值 → 回退原值（不清零）");

  /* 拍数输入必须**紧跟**「预备拍」开关（v1.3.3 修的）：
     原先它排在 .config 行最末（弹跳球之后），打开预备拍时行尾凭空冒出一个孤零零的「4」，
     视觉上像是弹跳球的参数（用户实拍反馈）。用标记层 + 运行时两层断言锁住位置。 */
  const seg = html.slice(html.indexOf('id="countInToggle"'), html.indexOf('id="bounceToggle"'));
  ok(/id="countInBeatsWrap"/.test(seg),
    "拍数输入在标记里夹在「预备拍」与「弹跳球」之间（不再隔着弹跳球）");
  ok(/<span class="hint">拍<\/span>/.test(html), "拍数带可见单位「拍」（原先只有 aria-label，肉眼无从判断）");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, false, "打开预备拍 → 拍数输入出现");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, true, "关闭预备拍 → 拍数输入隐藏");

  /* 预设列表：点内置项 / 点自定义项的删除按钮 / 调色板的回退提示 */
  const listItems = () => els["presetList"].children.filter(c => c._h && c._h.click);
  ok(listItems().length >= beat.BUILTINS.length, `预设列表渲染出 ${listItems().length} 个可点项`);
  listItems()[3].fire("click");
  eq(S.sel.idx, 3, "点内置预设项 → 选中它");
  eq(els["patternName"].textContent, beat.BUILTINS[3].name, "标题同步为该预设名");

  /* 导入：走 FileReader 接线（桩的 FileReader 会把 FILE_TEXT 交给 onload） */
  app.setFileText(JSON.stringify({ presets: [{ name: "接线导入", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }));
  els["importFile"].fire("change", { target: { files: [{}], value: "" } });
  eq(beat.Store.customs.length, 1, "导入接线跑通 → 预设 +1");
  eq(beat.Store.customs[0].name, "接线导入", "导入内容正确");
  eq(els["modalMask"].hidden, false, "导入成功给出提示");

  /* 导出：Blob + <a download> 接线不应抛错 */
  ok(beat.Store.exportPresets(), "导出预设接线跑通（有预设时返回 true）");

  /* 自定义预设项的删除按钮（stopPropagation 后走 uiConfirm） */
  const customItem = listItems().find(c => c.children.some(x => /(^| )del( |$)/.test(x.className)));
  const delBtn = customItem.children.find(x => /(^| )del( |$)/.test(x.className));
  delBtn.fire("click");
  eq(els["modalMask"].hidden, false, "点删除 → 弹确认框");
  els["modalOk"].fire("click");
  eq(beat.Store.customs.length, 0, "确认后预设被删除");
  ok(app.storage.has("beatsight.customs"), "删除后冷键已落盘");

  /* 编辑器：动态调色板项、删除/复制/清空、撤销、返回 */
  beat.Editor.open();
  eq(els["editor"].classList.contains("open"), true, "点「编辑节奏型」→ 编辑器打开");
  const palette = els["palette"].children;
  ok(palette.length === 11, "音符块库 11 项");
  /* 用相对数而不是写死 4：草稿来自当前选中的预设，不同预设每小节音符数不同
     （写死期望值是典型的测试脆弱性来源） */
  const n0 = beat.Editor.draft().bars[0].length;
  ok(n0 > 0, `草稿第 1 小节有 ${n0} 个音符（来自当前预设）`);
  palette[6].fire("click");                              // 三连音组块（一次插入 3 枚）
  eq(beat.Editor.draft().bars[0].length, n0 + 3, "点三连音组块 → 一次追加 3 枚");
  els["undoBtn"].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0, "撤销 → 回到点击前的音符数");
  els["copyBarBtn"].fire("click"); els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[3].length, n0, "复制到全部 → 第 4 小节与第 1 小节一致");
  els["clearBarBtn"].fire("click"); els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 0, "清空当前小节 → 空小节");
  eq(els["savePresetBtn"].disabled, true, "空小节 → 保存禁用（真实点击路径下的校验）");
  els["undoBtn"].fire("click");
  eq(els["savePresetBtn"].disabled, false, "撤销后保存恢复可用");
  app.fireWin("keydown", { code: "Space" });             // 编辑器打开时空格不该触发播放
  ok(!S.playing, "编辑器打开时空格被键盘处理器吃掉（不误触播放）");
  /* Ctrl+Z 撤销（键盘路径，与撤销按钮同一入口）：先制造一次**明确改变音符数**的改动，
     否则可能撤到与当前等长的状态，断言看不出区别（第一版就踩了这个） */
  palette[6].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0 + 3, "再追加 3 枚（为 Ctrl+Z 准备可观察的变化）");
  app.fireWin("keydown", { key: "z", ctrlKey: true });
  eq(beat.Editor.draft().bars[0].length, n0, "Ctrl+Z → 撤回刚才的追加");
  /* 草稿有未保存改动 → Esc 先弹确认框，不静默丢弃用户改动 */
  app.fireWin("keydown", { key: "Escape" });
  eq(els["modalMask"].hidden, false, "Esc（有改动）→ 先弹确认框（不静默丢弃改动）");
  els["modalOk"].fire("click");
  eq(els["editor"].classList.contains("open"), false, "确认放弃后返回练习");
  /* 无改动时 Esc 直接返回，不打扰 */
  beat.Editor.open();
  app.fireWin("keydown", { key: "Escape" });
  eq(els["editor"].classList.contains("open"), false, "Esc（无改动）→ 直接返回");

  /* 试听开关：开 → 关（stopAudition 路径） */
  beat.Editor.open();
  els["auditionBtn"].fire("click");
  eq(S.preview, true, "点试听 → 进入试听态");
  els["auditionBtn"].fire("click");
  eq(S.preview, false, "再点 → 退出试听（stopAudition 恢复主界面拍号）");
  beat.Editor.tryClose();

  /* 弹窗的两种取消路径 */
  beat.Modal.uiConfirm("随便问问", () => { throw new Error("取消时不该执行 onOk"); });
  els["modalCancel"].fire("click");
  eq(els["modalMask"].hidden, true, "点取消 → 关闭");
  beat.Modal.uiConfirm("再问一次", () => { throw new Error("点遮罩不该执行 onOk"); });
  els["modalMask"].fire("click");
  eq(els["modalMask"].hidden, true, "点遮罩 → 也算取消");
}

section("T32 旧键清理 · 冷热拆分后删除 beatsight.m2（v1.3.1）");
{
  const mkPat = (id, name) => ({ id, name, meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) });
  const legacy = { v: 3, bpm: 111, sig: 5, customs: [mkPat("L1", "老预设")] };

  const app = loadApp({ "beatsight.m2": JSON.stringify(legacy) });
  ok(!app.storage.has("beatsight.m2"), "拆分迁移成功后删除旧键（否则老用户永远留着一个最大可达 715 KB 的废弃键）");
  ok(app.storage.has("beatsight.m2.bak"), "删除前已确保 .bak 备份存在");
  eq(JSON.parse(app.storage.get("beatsight.m2.bak")).bpm, 111, ".bak 是旧键原文（可人工回退）");
  eq(JSON.parse(app.storage.get("beatsight.state")).bpm, 111, "热键已接管 bpm");
  eq(JSON.parse(app.storage.get("beatsight.customs")).customs.length, 1, "冷键已接管预设");
  eq(JSON.parse(app.storage.get("beatsight.customs")).customs[0].name, "老预设", "冷键内容正确");
  eq(app.beat.Store.S.bpm, 111, "本次会话状态正常（迁移不影响读）");
  eq(app.beat.Store.customs.length, 1, "本次会话预设可用");

  /* .bak 已存在则不覆盖：保留最早那份最原始的数据（可能是 v1 浮点格式） */
  const app2 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, bpm: 222 }), "beatsight.m2.bak": "{\"orig\":1}" });
  eq(app2.storage.get("beatsight.m2.bak"), "{\"orig\":1}", ".bak 已存在则不覆盖");
  ok(!app2.storage.has("beatsight.m2"), "旧键仍被清理");

  /* 写后校验未过（写盘抛错）→ 必须保留旧键，不能把用户数据弄丢 */
  const app3 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, bpm: 190 }) }, { throwOnWrite: true });
  ok(app3.storage.has("beatsight.m2"), "写后校验未过 → 保留旧键以备下次启动重试");
  ok(!app3.storage.has("beatsight.state"), "此时新键确实没写成功（所以才不能删）");
  eq(app3.beat.Store.S.bpm, 190, "本会话仍从旧键正常读到状态");

  /* 半迁移状态（热键在、冷键缺）：不动旧键，避免把用户已删掉的预设从陈旧数据里复活 */
  const app4 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, bpm: 200 }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 210 }) });
  eq(app4.beat.Store.S.bpm, 210, "热键优先于旧键");
  ok(app4.storage.has("beatsight.m2"), "半迁移状态下不动旧键（不猜、不删）");

  /* 已迁移过的用户再次加载：旧键已不存在，冷热键照常工作 */
  const app5 = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 220 }),
    "beatsight.customs": JSON.stringify({ v: 1, customs: [mkPat("C1", "现有")] }) });
  eq(app5.beat.Store.S.bpm, 220, "老用户第二次启动：直接读热键");
  eq(app5.beat.Store.customs[0].name, "现有", "直接读冷键");
  ok(!app5.storage.has("beatsight.m2.bak"), "不需要迁移时不产生多余备份");
}


section("T33 Presets 接线补完 · 自定义项 / 一键切回 / 导入失败（v1.3.1）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  const items = () => els["presetList"].children.filter(c => c._h && c._h.click);
  const textOf = el => (el.textContent || "") + (el.children || []).map(textOf).join("|");
  const byName = nm => items().find(c => textOf(c).includes(nm));

  /* 导入一个 5/4 自定义预设：走**真实文件输入路径**（列表重建发生在该处理器里，
     直接调 Store.importPresets 不会刷新列表——这一点本身也值得记住） */
  app.setFileText(JSON.stringify({ presets: [
    { name: "五拍自定义", meter: 5, accents: [0, 3],
      bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }
  ]}));
  els["importFile"].fire("change", { target: { files: [{}], value: "" } });
  els["modalOk"].fire("click");
  eq(beat.Store.customs.length, 1, "5/4 自定义预设导入成功（小节和 = 5×48 = 240）");
  beat.Controls.setSig(4);                                   // 先切到 4/4，制造"预设拍号 ≠ 当前拍号"
  const customItem = byName("五拍自定义");
  ok(!!customItem, "自定义预设项已渲染（按名称定位）");
  customItem.fire("click");
  eq(S.sel.id, beat.Store.customs[0].id, "点自定义项 → 选中它");
  eq(S.sig, 5, "预设拍号与当前不符时自动切到 5/4");

  /* 一键切回（fallbackBtn）：拍号不匹配时把拍号切回去。
     注意：回退提示条只在 refreshAfterPatternChange 里刷新，而真实 UI 是 pill 点击处理器
     把 setSig 与 refreshAfterPatternChange 成对调用的——所以这里必须走真实点击，
     直接调 setSig(4) 不会让提示条出现（这也解释了为什么该处理器里必须成对写） */
  els["sigRow"].fire("click", { target: pill({ sig: "4" }) });   // 切回 4/4 → 选中项与拍号不匹配
  eq(S.sig, 4, "真实点击切到 4/4");
  eq(els["fallbackNote"].hidden, false, "拍号不匹配 → 显示回退提示条");
  ok(/五拍自定义/.test(els["fallbackText"].textContent), "提示文案点名被回退的预设");
  els["fallbackBtn"].fire("click");
  eq(S.sig, 5, "点「切回」→ 拍号切回预设自身的 5/4");
  eq(els["fallbackNote"].hidden, true, "切回后提示条收起");

  /* 导入失败要给出原因（不是静默失败） */
  app.setFileText('{"presets":[{"name":"坏预设","meter":4,"bars":[[{"t":48}]]}]}');
  els["importFile"].fire("change", { target: { files: [{}], value: "" } });
  eq(els["modalMask"].hidden, false, "导入失败 → 弹窗告知");
  ok(/导入失败/.test(els["modalMsg"].textContent), `失败原因可读：「${els["modalMsg"].textContent.slice(0, 40)}」`);
  els["modalOk"].fire("click");

  /* 导出 / 导入按钮自身的接线（真按钮 → <a download> / file input） */
  els["exportBtn"].fire("click");
  ok(beat.Store.customs.length > 0, "点导出按钮 → 走 exportPresets（不抛错）");
  els["importBtn"].fire("click");
  ok(true, "点导入按钮 → 走 importFile.click()（不抛错）");
}

section("T34 挂起兜底路径 · 就地接续失败时的降级（v1.3.1）");
{
  /* 「就地接续」失败才会落到挂起路径，而它只在**当前小节为空**时失败——
     正常自定义预设不可能有空小节（校验要求每小节恰好占满 meter×48），
     所以唯一入口是**试听中的草稿**。这条路径此前零覆盖。
     两个关键细节（第一版都写错了）：
       ① 不能先驱动帧：空小节会被调度器迅速跳过，游标离开空小节后接续就成功了；
       ② 判据不能用标题：预览态下 activePattern() 返回草稿，标题两侧都指向草稿名。
          改用可视化标题里的拍号——它只在 applyPatternChange → buildViz 时才更新。 */
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  beat.Editor.open();
  els["clearBarBtn"].fire("click"); els["modalOk"].fire("click");     // 清空第 1 小节（editBar 默认 0）
  eq(beat.Editor.draft().bars[0].length, 0, "草稿第 1 小节已清空");
  els["auditionBtn"].fire("click");                                   // 试听：开始播放但**不驱动**
  ok(S.playing && S.preview, "试听中（播放 + 预览态）");
  eq(beat.clock().schedBar, 0, "未驱动 → 调度游标仍停在第 1 小节（正是那个空小节）");
  const vizBefore = els["vizTitle"].textContent;
  eq(/4\/4/.test(vizBefore), true, `可视化当前按 4/4 渲染：「${vizBefore}」`);

  /* 播放中切到不同拍号的节奏型 → 接续失败 → 挂起 */
  const target = beat.BUILTINS.findIndex(p => p.meter === 3);
  els["presetList"].children.filter(c => c._h && c._h.click)[target].fire("click");
  eq(els["vizTitle"].textContent, vizBefore,
    "挂起生效：可视化**没有**立刻重建（「就地接续」路径会立刻 rebuildViz——这条区分两条路径）");
  eq(S.sig, 3, "新拍号已记录（等小节边界生效）");

  /* 驱动越过若干小节边界：挂起被消费，节奏型真正生效 */
  const err = driveFrames(FakeAudioContext.last, beat, 16);
  ok(!err, `挂起窗口内调度 + 渲染无异常（${err || "OK"}）`);
  ok(/3\/4/.test(els["vizTitle"].textContent),
    `越过循环起点后按新拍号重建可视化：「${els["vizTitle"].textContent}」`);
  ok(S.playing, "整个过程播放未中断（挂起不会打断播放）");
  beat.Controls.stop();
  beat.Editor.tryClose(); els["modalOk"].fire("click");
}

section("T35 剩余边角接线 · resize / 弹窗键盘 / 老数据引用迁移 / 编辑器选中与删除（v1.3.1）");
{
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;

  /* 窗口 resize：防抖 200ms 后重建（未播放）或只重采几何缓存（播放中，不打断动画） */
  const vizBefore = els["vizTitle"].textContent;
  const readsBefore = PROBE.layoutReads;
  app.fireWin("resize");
  app.runTimers();
  ok(PROBE.layoutReads > readsBefore, "resize（未播放）→ 重建可视化（读了一次布局）");
  eq(els["vizTitle"].textContent, vizBefore, "重建后标题不变（同一拍号）");

  beat.Controls.start();
  resetProbe();
  app.fireWin("resize");
  app.runTimers();
  ok(PROBE.layoutReads > 0, "resize（播放中）→ 只重采几何缓存");
  ok(S.playing, "播放中 resize 不打断播放（不重建 DOM）");
  const iv = beat.Viz.internals();
  ok(iv.rowGeo.length === 4 && iv.rowGeo.every(g => g.width > 0),
    `几何缓存已刷新（4 行，行宽 ${iv.rowGeo[0].width}）——否则球会按旧尺寸画到行外`);
  beat.Controls.stop();

  /* 弹窗键盘：Esc 取消；Enter 确认分两条路——无输入框时走 window，
     有输入框时由输入框自身的 keydown 处理（两处都得覆盖，否则用户会遇到"回车没反应"） */
  beat.Modal.uiConfirm("键盘测试", () => { throw new Error("Esc 取消不该触发 onOk"); });
  app.fireWin("keydown", { key: "Escape" });
  eq(els["modalMask"].hidden, true, "弹窗中按 Esc → 取消并关闭");
  let confirmOk = false;
  beat.Modal.uiConfirm("回车确认", () => { confirmOk = true; });
  app.fireWin("keydown", { key: "Enter" });
  ok(confirmOk, "无输入框的弹窗：window 上按 Enter → 确认");
  eq(els["modalMask"].hidden, true, "确认后关闭");
  let inputOk = false;
  beat.Modal.uiPrompt("输入点什么", "初值", v => { inputOk = v === "改过的值"; });
  eq(els["modalInput"].hidden, false, "uiPrompt 显示输入框");
  els["modalInput"].value = "改过的值";
  els["modalInput"].fire("keydown", { key: "Enter" });
  ok(inputOk, "有输入框的弹窗：在输入框里按 Enter → 确认并把输入值交给回调");
  eq(els["modalMask"].hidden, true, "确认后关闭");

  /* 编辑器：选中音符块 → 库标题变成「点击替换」→ 删除选中 */
  beat.Editor.open();
  const rowTrack = () => els["editorBars"].children[0].children[1];
  const cells = () => rowTrack().children;
  ok(cells().length > 0, `编辑区第 1 小节渲染出 ${cells().length} 个音符块`);
  const n0 = beat.Editor.draft().bars[0].length;
  cells()[0].fire("click");
  ok(/点击替换选中的/.test(els["paletteTitle"].textContent),
    `选中音符块后库标题改为替换语义：「${els["paletteTitle"].textContent.slice(0, 30)}」`);
  els["delStepBtn"].fire("click");
  eq(beat.Editor.draft().bars[0].length, n0 - 1, "删除选中音符 → 草稿少一个");
  ok(els["undoBtn"].disabled === false, "删除后撤销可用");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0].length, n0, "撤销恢复");
  /* 点轨道空白处 = 取消选中，回到「追加」语义 */
  rowTrack().fire("click", { target: rowTrack() });
  ok(/点击追加到/.test(els["paletteTitle"].textContent), "取消选中后库标题回到追加语义");
  beat.Editor.tryClose(); els["modalOk"].fire("click");

  /* v0.4.0 老数据：sel 用数组下标引用自定义预设，加载时应升级为 id 引用 */
  const legacySel = { v: 3, sel: { type: "custom", idx: 0 },
    customs: [{ name: "下标引用", meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] };
  const old = loadApp({ "beatsight.m2": JSON.stringify(legacySel) });
  eq(old.beat.Store.S.sel.type, "custom", "老数据的 sel.type 保留");
  eq(old.beat.Store.S.sel.idx, undefined, "数值下标已移除（升级为 id 引用）");
  eq(old.beat.Store.S.sel.id, old.beat.Store.customs[0].id, "sel.id 指向第 0 个自定义预设");
  eq(old.beat.curPattern().name, "下标引用", "升级后仍命中原预设");

  /* 老数据里下标越界 → 回退内置第 0 个 */
  const bad = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, sel: { type: "custom", idx: 9 }, customs: [] }) });
  eq(bad.beat.Store.S.sel.type, "builtin", "下标越界 → 回退到内置预设");
  eq(bad.beat.Store.S.sel.idx, 0, "回退到第 0 个内置");

  /* 组标签（短音符合并标注）高亮：默认预设没有连续短音符，必须换成三连音才走得到。
     这条同时守 P1-4 的一个真实风险——增量重绘可能漏掉组标签这类"非格子"元素 */
  {
    const b2 = loadApp();
    b2.beat.Store.S.sel = { type: "builtin", idx: 8 };        // 三连音基础：12 个连续 16t 短音符 → 生成组标签
    b2.beat.Presets.refreshAfterPatternChange();
    b2.beat.Controls.start();
    const ac2 = FakeAudioContext.last;
    let groupCells = 0, litFrames = 0;
    for (let i = 0; i < 400; i++){
      ac2.currentTime += 0.02;
      b2.beat.Audio.scheduler();
      b2.beat.Viz.paintFrame();
      let anyLit = false, anyGroup = false;
      b2.els["viz"].children.forEach(r => r.children.forEach(c => {
        if (/(^| )cell-label( |$)/.test(c.className) && /(^| )group( |$)/.test(c.className)){
          anyGroup = true;
          if (/(^| )on( |$)/.test(c.className)) anyLit = true;
        }
      }));
      if (anyGroup) groupCells = Math.max(groupCells, 1);
      if (anyLit) litFrames++;
    }
    eq(groupCells, 1, "三连音基础渲染出组标签（短音符合并标注）");
    ok(litFrames > 0, `组标签随播放高亮（${litFrames} 帧亮起）——增量重绘没有漏掉它`);
    b2.beat.Controls.stop();
  }

  /* 时值非法（既无 t 也无 d）的预设必须被拒，且给出可读原因 */
  {
    const b3 = loadApp();
    const r = b3.beat.Store.importPresets(JSON.stringify({ presets: [
      { name: "缺时值", meter: 4, bars: [0,1,2,3].map(() => [{ rest: true }]) }
    ]}));
    ok(!r.ok, `既无 t 也无 d 的音符 → 导入被拒（${r.error || ""}）`);
    eq(b3.beat.Store.customs.length, 0, "被拒的预设不进入预设库");
  }

  /* predictNext 的"扫完全部小节都没有发声点"回退：
     试听中让第 1 小节只剩下休止符、后 3 小节全空。
     为什么不用"清空第 1 小节"：那样会先命中"当前小节为空"的早退分支，
     走不到末尾的 return null（两条回退路径要分别覆盖） */
  {
    const app2 = loadApp();
    const b4 = app2.beat;
    const trackOf = b => app2.els["editorBars"].children[b].children[1];
    b4.Editor.open();
    for (const b of [1, 2, 3]){
      trackOf(b).fire("click", { target: trackOf(b) });       // 把 editBar 切到第 b 小节
      app2.els["clearBarBtn"].fire("click"); app2.els["modalOk"].fire("click");
      eq(b4.Editor.draft().bars[b].length, 0, `清空第 ${b + 1} 小节`);
    }
    trackOf(0).fire("click", { target: trackOf(0) });
    app2.els["clearBarBtn"].fire("click"); app2.els["modalOk"].fire("click");
    for (let k = 0; k < 4; k++) app2.els["palette"].children[10].fire("click");   // 休止符（占时 48t）
    eq(b4.Editor.draft().bars[0].length, 4, "第 1 小节 = 4 个休止符（占满一小节但不发声）");

    app2.els["auditionBtn"].fire("click");
    const err = driveFrames(FakeAudioContext.last, b4, 4);
    ok(!err, `全休止 / 后续小节全空：调度 + 渲染无异常（${err || "OK"}）`);
    eq(b4.onsetNext(), null, "扫完所有小节都没有发声点 → 预测返回 null（球停住，不会飘向空行）");
    b4.Controls.stop();
    b4.Editor.tryClose(); app2.els["modalOk"].fire("click");
  }

  /* resyncToNow 的「本小节已无接续点 → 顺延到下一小节」分支。
     怎么才能构造出来：`nextNoteTime` 只会落在**音符起点**上，所以"站在最后一颗音符内部"
     这个说法本身不成立；真正触发 j<0 的是**两套起点集合错位**——
     旧节奏型的某个起点，晚于新节奏型在本小节的最后一颗起点。
     取旧 = 民谣扫弦（起点 …, 132, 144），新 = 两颗二分（起点 0, 96）：
     游标停在 132/144t 时去切，新节奏型本小节已无 ≥132t 的起点 → 顺延到下一小节。 */
  {
    const app3 = loadApp();
    const b5 = app3.beat;
    const spb = 60 / b5.Store.S.bpm, TPB = 48;
    b5.Store.importPresets(JSON.stringify({ presets: [{ name: "两颗二分", meter: 4,
      bars: [0,1,2,3].map(() => [{ t: 96 }, { t: 96 }]) }] }));
    eq(b5.Store.customs.length, 1, "新预设（每小节两颗二分，起点 0/96）导入成功");
    b5.Presets.buildPresetList();            // importPresets 不重建列表（真实路径由文件输入处理器负责）
    b5.Controls.start();                                     // 播放默认的民谣扫弦
    const ac3 = FakeAudioContext.last;
    const ls = b5.clock().loopStart;
    const cursorTick = () => (b5.clock().nextNoteTime - ls) / spb * TPB;
    let guard = 0;
    while (guard++ < 3000 && cursorTick() < 130){             // 推到超过新节奏型末颗起点 96t
      ac3.currentTime += 0.01;
      b5.Audio.scheduler();
      b5.Viz.paintFrame();
    }
    const t0 = cursorTick();
    ok(Math.abs(t0 - 132) < 0.5 || Math.abs(t0 - 144) < 0.5,
      `游标停在 ${t0.toFixed(0)}t（旧节奏型起点，且晚于新节奏型的末颗起点 96t）`);
    /* 切到新预设：本小节无接续点 → 顺延到下一小节 */
    const textOf = el => (el.textContent || "") + (el.children || []).map(textOf).join("|");
    const custom = app3.els["presetList"].children.filter(c => c._h && c._h.click)
      .find(c => textOf(c).includes("两颗二分"));
    ok(!!custom, "自定义预设项已在列表中");
    custom.fire("click");
    eq(b5.Store.S.sel.id, b5.Store.customs[0].id, "已切到新预设");
    const c = b5.clock();
    eq(c.schedBar, 1, "接续点顺延到下一小节（本小节已无音符起点可接）");
    eq(c.schedStep, 0, "从下一小节的第 0 颗记起");
    ok(Math.abs(c.nextNoteTime - (ls + b5.Store.S.sig * spb)) < 1e-9,
      "nextNoteTime = 下一小节起点（时间轴不动，只把位置顺延）");
    ok(b5.Store.S.playing, "顺延后仍在播放");
    b5.Controls.stop();
  }
}

section("T36 播放中改 BPM · 播放头与弹跳球不得分叉（v1.3.4）");
{
  /* 用户实拍反馈：播放中拖 BPM 滑杆后，球与播放头对不上，只有暂停再开才恢复。
     根因（诊断脚本实测）：setBpm 重映射 loopStart 让"时钟推出来的位置"在那一瞬连续，
     但**已经排进音频时钟的 onset 绝对时刻无法回改**——它们按旧 spb 算。
     于是「前瞻窗口 + 最多一颗音符时长」这段里两边以不同速率前进，累积出错位；
     此后两边同速前进 → **错位永久保留**：
       96→200 BPM 实测固定偏 −49.82 tick（≈1.04 拍，球在播放头后方），
       连续 20 次改速后偏 −37.26 tick。改速前是 0.00 tick。
     修法：播放头位置改由 onset 表插值（与球同源），分叉从结构上消失（见 audioPosAt）。 */
  const app = loadApp();
  const beat = app.beat, els = app.els, S = beat.Store.S;
  const TPBv = 48;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv = beat.Viz.internals();
  const barT = () => S.sig * TPBv;
  const headT = () => {
    const el = els["viz"].children.find(c => /(^| )playhead( |$)/.test(c.className));
    return el ? parseFloat(el.style.left) / 100 * barT() : NaN;
  };
  const ballT = () => {
    const m = /(-?[0-9.]+)px, (-?[0-9.]+)px/.exec(iv.ballEl.style.transform);
    if (!m) return NaN;
    const g = iv.rowGeo[Math.floor(headT() / barT())] || iv.rowGeo[0];
    return g ? (+m[1] + 8 - g.left) / g.width * barT() : NaN;
  };
  /* 每帧采样的最大偏差。容差 1.5 tick 的来由：终端弧上球停在行右缘 −10px、播放头在 100%，
     两者差 2px ≈ 0.64 tick（既有设计，不是本次问题），所以不能卡到 0 */
  const TOL = 1.5;
  const pump = (sec, step) => {
    step = step || 0.01;
    let worst = 0;
    for (let i = 0; i < Math.round(sec / step); i++){
      ac.currentTime += step;
      beat.Audio.scheduler();
      beat.Viz.paintFrame();
      const d = Math.abs(ballT() - headT());
      if (isFinite(d) && d > worst) worst = d;
    }
    return worst;
  };

  ok(pump(1.2) <= TOL, "静止播放（96 BPM）：播放头与球每帧对齐——基线");

  beat.Controls.setBpm(200);
  const w1 = pump(3);
  ok(w1 <= TOL, `播放中 96→200 BPM：全程最大偏差 ${w1.toFixed(2)} tick（修复前会永久偏 49.82 tick ≈ 1.04 拍）`);

  /* 模拟拖滑杆：逐格连续改速。旧实现每次改速都会再累积一份错位 */
  let w2 = 0;
  for (let i = 0; i < 20; i++){ beat.Controls.setBpm(200 - i * 3); w2 = Math.max(w2, pump(0.06)); }
  w2 = Math.max(w2, pump(2));
  ok(w2 <= TOL, `连续 20 次改速后最大偏差 ${w2.toFixed(2)} tick（修复前实测 37.26 tick）`);

  /* 反向改速与极端值（同一路径，训练器自动爬坡走的也是它） */
  beat.Controls.setBpm(30);
  const w3 = pump(2);
  ok(w3 <= TOL, `200→30 BPM 大幅降速：最大偏差 ${w3.toFixed(2)} tick`);
  beat.Controls.setBpm(240);
  const w4 = pump(2);
  ok(w4 <= TOL, `30→240 BPM：最大偏差 ${w4.toFixed(2)} tick`);
  ok(S.playing, "全程播放未中断");

  /* setBpm 的锚点：改速后不变量 `nextNoteTime == loopStart + tick×spb/TPB` 必须继续成立。
     为什么单独立一条：播放头已改走 onset 表，所以**播放头断言抓不到锚点错误**（反向验证已证实
     退回锚点后 T36 的前面几条仍全绿）。而不变量本身是 load-bearing 的——resyncToNow 靠它
     算「就地接续」点，破坏它会导致「改速后马上切节奏型 → 接到错误位置」。
     真实游标 tick 由 onsetNext（predictNext 的预测终点，其 t 即游标时刻）给出。 */
  {
    beat.Controls.setBpm(150);
    const c = beat.clock(), nn = beat.onsetNext();
    ok(!!nn, "改速后仍有预测终点（onsetNext）");
    if (nn){
      ok(Math.abs(nn.t - c.nextNoteTime) < 1e-9, "预测终点的时刻 == 排程游标");
      const loopTicks = barT() * 4, spbNow = 60 / S.bpm;
      const mod = v => ((v % loopTicks) + loopTicks) % loopTicks;
      const fromBase = mod((c.nextNoteTime - c.loopStart) / spbNow * TPBv);
      const trueTick = mod(nn.bar * barT() + nn.cumT);
      ok(Math.abs(fromBase - trueTick) < 1e-6,
        `改速后不变量成立：时间基推出 ${fromBase.toFixed(3)} == 真实游标 ${trueTick.toFixed(3)}`);
    }
  }
  beat.Controls.stop();
}


/* ================================================================================
   场景 T38：主题切换 · 观测台主题（v1.7.0）
   经典 ↔ 观测台：body[data-theme] 落位、切换钮文案、独立冷键 beatsight.theme 持久化、
   重载恢复、闪烁配色查表随主题。纪律断言：切换主题不得顺手写任何现有持久键。
   ================================================================================ */
section("T38 主题切换 · 观测台主题（v1.7.0）");
{
  const app = loadApp();
  const body = app.sandbox.document.body;
  eq(body.getAttribute("data-theme"), "classic", "默认经典主题（无偏好时落 classic）");
  eq(app.els["themeToggle"].textContent, "主题 · 经典", "切换钮初始文案");
  eq(app.beat.flashTheme().edge, "#1ED760", "经典主题下闪烁配色为功能绿");

  const before = new Set([...app.storage.keys()]);
  app.els["themeToggle"].fire("click", {});
  eq(body.getAttribute("data-theme"), "obs", "点击后切到观测台");
  eq(app.els["themeToggle"].textContent, "主题 · 观测台", "切换钮文案同步");
  eq(app.storage.get("beatsight.theme"), "obs", "偏好写入独立冷键 beatsight.theme");
  eq(app.beat.flashTheme().edge, "#3B82F6", "观测台下闪烁配色为电光蓝");
  const added = [...app.storage.keys()].filter(k => !before.has(k));
  eq(added.join(","), "beatsight.theme", "切换主题只新增独立冷键——现有 5 个持久键一个不碰");

  app.els["themeToggle"].fire("click", {});
  eq(body.getAttribute("data-theme"), "classic", "再点切回经典");
  eq(app.storage.get("beatsight.theme"), "classic", "冷键同步回写");

  /* 重载恢复：种子冷键 obs → 加载即观测台 */
  const app2 = loadApp({ "beatsight.theme": "obs" });
  eq(app2.sandbox.document.body.getAttribute("data-theme"), "obs", "冷键 obs 重载后恢复观测台");
  eq(app2.els["themeToggle"].textContent, "主题 · 观测台", "重载后切换钮文案跟随");
  eq(app2.beat.flashTheme().edge, "#3B82F6", "重载后闪烁配色跟随主题");

  /* 反向验证锚点：flashTheme 查的是 body 属性而不是别处的缓存——
     直接改属性而不走切换钮，配色也必须立刻跟上 */
  body.setAttribute("data-theme", "obs");
  eq(app.beat.flashTheme().edge, "#3B82F6", "flashTheme 直读 body[data-theme]，无缓存分叉");
}

/* ================================================================================
   场景 T41：待命球起跑预备 · 下落半弧复制（v1.8.0）
   终端弧过 apex 后，待命球在新行首 onset 正上方沿同一条抛物线的下落段同步下落，
   与上一小节的球在小节边界同时触地。核心不变量：**交接时刻分毫不动**——
   过界第一帧正式球必须已在新行首 onset、待命球隐藏；下落只允许出现在终端弧后半。
   ================================================================================ */
section("T41 待命球起跑预备 · 下落半弧复制（v1.8.0）");
{
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const iv = beat.Viz.internals();
  const spbV = 60 / beat.Store.S.bpm;
  const barDur = beat.Store.S.sig * spbV;
  /* 民谣扫弦：末 onset 在 144t（第 4 拍），终端弧 = 1 拍 = 0.625s；下落段 = 其前半 = 0.3125s。
     跳高 H 与实现同式：clamp(120·T², 10, 48) 再受「顶点不出容器空域」钳制（首行 A.y+6） */
  const T = 1 * spbV, halfT = T / 2;
  const H = Math.min(Math.max(10, Math.min(48, 120 * T * T)), (iv.rowGeo[0].top - 20) + 6);
  const barEnd = beat.clock().loopStart + barDur;            // 第 1 小节右缘 = 交接时刻
  const gY = iv.rowGeo[1].top - 20;                          // 待命球停泊位 y（新行首 onset 基线）
  const states = [];
  const DT = 0.005;
  for (let i = 0; i < Math.round(barDur * 1.2 / DT); i++){
    ac.currentTime += DT;
    beat.Audio.scheduler();
    beat.Viz.paintFrame();
    const bm = /(-?[\d.]+)px/.exec(iv.ballEl.style.transform);
    const wm = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)(?: scale\(([\d.]+),([\d.]+)\))?/.exec(iv.waitEl.style.transform);
    states.push({ now: ac.currentTime, bx: bm ? +bm[1] : NaN,
      wy: wm ? +wm[2] : NaN, wsy: wm && wm[4] ? +wm[4] : 1,
      disp: iv.waitEl.style.display });
  }

  /* ① 终端弧前半（apex 之前）：保持停泊位——贴地、无形变，下落不提前抢戏 */
  const early = states.filter(s => s.disp !== "none" && s.now < barEnd - halfT - 0.02);
  ok(early.length > 5, `终端弧前半采到 ${early.length} 帧待命球（民谣扫弦终端弧 = 1 拍）`);
  ok(early.every(s => Math.abs(s.wy - gY) < 0.2), "apex 前待命球贴地停驻（y = 停泊位，无下落）");

  /* ② 下落段（终端弧后半）：从 ≈H 同步下落、单调趋地、边界前贴地；空中拉伸 sy>1 */
  const fall = states.filter(s => s.now >= barEnd - halfT && s.now < barEnd - 0.004);
  ok(fall.length > 5, `下落段采到 ${fall.length} 帧（halfT=${(halfT * 1000).toFixed(0)}ms）`);
  const offs = fall.map(s => gY - s.wy);                     // 离地高度序列（应单调递减 → 0）
  ok(Math.max(...offs) > H * 0.8, `下落起点 ≈ 终端弧同高 H=${H.toFixed(1)}px（实测峰值 ${Math.max(...offs).toFixed(1)}）`);
  ok(offs[offs.length - 1] < H * 0.15, `触地前高度收敛到 ${offs[offs.length - 1].toFixed(1)}px（→ 0，与老球同时落地）`);
  ok(offs.every((v, i) => i === 0 || v <= offs[i - 1] + 0.6), "下落单调不回弹（抛物线下落段，无上下抖动）");
  ok(fall.some(s => s.wsy > 1.01), "下落途中带空中拉伸（sy>1，与主体球同式）");

  /* ③ 交接不变量：过界第一帧，待命球隐藏、正式球已落在新行首 onset（x = 新行 left − 8）——
     下落动画对交接时刻零影响（删掉这性质此断言即红，反向验证已跑） */
  const after = states.find(s => s.now >= barEnd);
  ok(!!after, "采到跨过小节边界的帧");
  if (after){
    eq(after.disp, "none", "过界后待命球立即隐藏（交接完成）");
    near(after.bx, iv.rowGeo[1].left - 8, 2.5, `过界第一帧正式球 x=${after.bx.toFixed(1)} ≈ 新行首 onset（交接时刻未被动画推迟）`);
  }
  beat.Controls.stop();
}
