/* BeatSight 自动化测试 · 音色与控制器：三套音色 / 预备拍 / Editor 流程 / 层级增益 / 速度档
   T13–T19。发声链路与控件接线的正确性。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, near, section, drive } = require("../lib/harness");

/* ================= 场景 T13：音色扩展（v0.8.0） ================= */
section("T13 音色 · 三套合成音色与持久化");
{
  /* 默认与脏值 */
  const { beat } = loadApp();
  eq(beat.Store.S.timbre, "click", "默认音色 click（电子）");
  const { beat: bBad } = loadApp({ "beatsight.m2": JSON.stringify({ timbre: "dubstep" }) });
  eq(bBad.Store.S.timbre, "click", "非法音色值回退 click");
  const { beat: bWood, storage: stWood } = loadApp({ "beatsight.m2": JSON.stringify({ timbre: "wood" }) });
  eq(bWood.Store.S.timbre, "wood", "持久化音色 wood 正确恢复");
  bWood.Store.flush();                 // v1.3.0：热键写入改为防抖，断言落盘内容前须 flush
  eq(JSON.parse(stWood.get("beatsight.state")).timbre, "wood", "flush 后热键写入 timbre 字段");

  /* 木鱼：全部层级走带通滤波噪声 */
  bWood.Controls.start();
  drive(FakeAudioContext.last, bWood, 1.5);
  const hw = FakeAudioContext.last.hits;
  ok(hw.length > 0 && hw.every(h => h.kind === "noise" && h.filterType === "bandpass"), "wood：全部发声为带通噪声");
  eq(hw[0].filterFreq, 2000, "wood：小节首拍（重拍）中心 2000Hz");

  /* 鼓组：重拍=底鼓扫频 150→50；正拍=军鼓带通 1800；细分=踩镲高通 8000 */
  const { beat: bDrum } = loadApp({ "beatsight.m2": JSON.stringify({ timbre: "drum", sel: { type: "builtin", idx: 2 } }) });
  bDrum.Controls.start();
  drive(FakeAudioContext.last, bDrum, 2);
  const hd = FakeAudioContext.last.hits.slice(0, 4);   // 八分摇滚：重拍,细分,正拍,细分
  ok(hd[0].kind === "osc" && hd[0].sweepTo === 50, "drum：重拍=底鼓扫频终点 50Hz");
  ok(hd[1].kind === "noise" && hd[1].filterType === "highpass" && hd[1].filterFreq === 8000, "drum：细分=踩镲高通 8000Hz");
  ok(hd[2].kind === "noise" && hd[2].filterType === "bandpass" && hd[2].filterFreq === 1800, "drum：正拍=军鼓带通 1800Hz");

  /* 播放中切换音色即时生效（下一发音符即新音色） */
  bDrum.Controls.setTimbre("click");
  drive(FakeAudioContext.last, bDrum, 1);
  const lastHit = FakeAudioContext.last.hits[FakeAudioContext.last.hits.length - 1];
  ok(lastHit.kind === "osc" && lastHit.sweepTo === undefined, "播放中切 click：下一颗即振荡器发声，不打断播放");
  ok(bDrum.Store.S.playing, "切音色后播放未中断");
}

/* ================= 场景 T14：预备拍（v0.9.0） ================= */
section("T14 预备拍 · 计数发声 + 训练器不受污染");
{
  /* bpm 96 → spb 0.625s；countIn 3 拍：预备拍落在 0.08 / 0.705 / 1.33，1.955 起进正式第 1 小节 */
  const { beat, els } = loadApp({ "beatsight.m2": JSON.stringify({ countIn: { on: true, beats: 3 } }) });
  const S = beat.Store.S;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 0.5);
  beat.Viz.paintFrame();   // rAF 置空，手动补一帧
  eq(els["statusText"].textContent, "预备拍 · 1 / 3", "预备拍期间状态栏显示计数");
  drive(ac, beat, 3);
  const hits = ac.hits;
  near(hits[0].t, 0.08, 1e-6, "预备拍第 1 声 t=0.08");
  eq(hits[0].freq, 1568, "预备拍第 1 声为重拍音");
  near(hits[1].t, 0.08 + 0.625, 1e-6, "预备拍第 2 声间隔 1 拍");
  eq(hits[1].freq, 1046.5, "预备拍第 2 声为正拍音");
  eq(hits[2].freq, 1046.5, "预备拍第 3 声为正拍音");
  near(hits[3].t, 0.08 + 3 * 0.625, 1e-6, "预备拍结束后立即进正式第 1 小节");
  eq(hits[3].freq, 1568, "正式第 1 小节首音仍为重拍");
  beat.Controls.stop();
  const hitsBefore = ac.hits.length;
  beat.Controls.start();   // 每次播放重新数预备拍
  drive(ac, beat, 1);
  ok(ac.hits.length > hitsBefore && ac.hits[hitsBefore].freq === 1568, "重新播放再次触发预备拍（首声重拍）");

  /* 预备拍 + 变速训练：爬坡计数不含预备拍（everyN=1 时完成 2 级即停） */
  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({
    countIn: { on: true, beats: 2 },
    trainer: { on: true, start: 70, target: 80, step: 10, everyN: 1 },
  })});
  b2.Controls.start();
  const ac2 = FakeAudioContext.last;
  const stopped = drive(ac2, b2, 30);
  ok(stopped, "预备拍+训练：练到目标自动停止");
  const S2 = b2.Store.S;
  eq(S2.bpm, 80, "训练完成停在 80 BPM");
  /* 关闭时零变化回归 */
  const { beat: b3 } = loadApp();
  b3.Controls.start();
  const ac3 = FakeAudioContext.last;
  drive(ac3, b3, 1);
  near(ac3.hits[0].t, 0.08, 1e-6, "预备拍关闭：第 1 声即正式节奏型");
}

/* ================= 场景 T15：播放中切拍号立即生效 + 渲染不脱轨（v1.1.1 改契约） ================= */
section("T15 播放中切拍号 · 立即生效，且 viz 按新拍号渲染不脱轨");
{
  /* 历史契约（v0.9.0）：「挂起窗口内 viz 按旧拍号渲染」——那是当时「等循环起点」设计的产物。
     v1.1.1 改为「点下即生效」后，常规路径已无挂起窗口（仅极罕见的小节末无音符起点才挂起），
     故本场景改为守住真正的不变量：切拍后立即按新拍号发声与渲染，且状态栏读数始终落在
     新拍号的合法小节/拍位内（不提前回卷、不越界、不脱轨）。 */
  const { beat, els, sandbox } = loadApp();
  const statusEl = sandbox.document.getElementById("statusText");
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1);
  beat.Store.S.sel = { type: "builtin", idx: 6 };   // 华尔兹 3/4
  beat.Controls.setSig(3);
  beat.Presets.refreshAfterPatternChange();
  eq(beat.activePattern().meter, 3, "切拍后立即发声的就是 3/4（不再等循环起点）");
  eq(beat.Presets.consumePending(1).applied, false, "立即生效路径不留挂起（consumePending 无事可做）");
  drive(ac, beat, 6.6);                              // 越过原来 4/4 循环的边界
  beat.Viz.paintFrame();
  const txt = statusEl.textContent;
  const m = txt.match(/第 (\d+) 小节 · (\d)/);
  ok(!!m, "状态栏可解析出小节/拍位：" + txt);
  if (m){
    const barNo = +m[1], beatNo = +m[2];
    ok(barNo >= 1 && barNo <= 4, "小节号落在 4 小节循环内（实测 " + barNo + "）");
    ok(beatNo >= 1 && beatNo <= 3, "拍位按 3/4 渲染（实测第 " + beatNo + " 拍，≤3 才说明没用旧 4/4）");
  }
  ok(beat.Store.S.playing, "全程播放未中断");
  drive(ac, beat, 4);                                // 再越过若干新循环边界
  beat.Viz.paintFrame();
  ok(beat.Store.S.playing, "越过新循环起点后仍正常播放");
  ok(/第 [1-4] 小节/.test(statusEl.textContent), "读数持续合法：" + statusEl.textContent);
}

/* ================= 场景 T16：v0.9.1 防御性补丁 ================= */
section("T16 防御 · persist 写失败不炸 + accents 归一");
{
  /* H1：localStorage 写路径抛错（隐私模式/配额超限）时交互链不能断。
     注意：setSig 必须与 refreshAfterPatternChange 成对调用（真实 UI 的绑定路径如此），
     单独调 setSig 会让 viz 与 curPattern 脱节——那是测试误用，不是 app bug。
     v1.3.0：persist() 改为防抖后，必须显式 flush() 才会真正触发那次抛异常的 setItem，
     否则这条用例会变成空跑（写没发生，自然不抛）——那是假绿 */
  const { beat } = loadApp({}, { throwOnWrite: true });
  let threw = false;
  try {
    beat.Controls.setBpm(120);
    beat.Controls.setSig(3);
    beat.Presets.refreshAfterPatternChange();
    beat.Controls.start();
    drive(FakeAudioContext.last, beat, 1);
    beat.Controls.stop();
    beat.Store.flush();              // 真正把写盘打出去（会抛 QuotaExceededError → 被内部兜住）
    beat.Store.persistCold();        // 冷键路径同样要兜住
  } catch(e){ threw = true; }
  ok(!threw, "persist 写失败时 播放/调速/切拍号 全程不抛异常");
  eq(beat.Store.S.bpm, 120, "写失败时状态仍在内存生效");

  /* M6：导入的 accents 去重 + 升序归一 */
  const { beat: b2 } = loadApp();
  const r = b2.Store.importPresets(JSON.stringify({ presets: [{ name: "乱序重拍", meter: 4, accents: [3, 0, 3, 1],
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }]}));
  ok(r.ok, "乱序/重复 accents 的预设可导入");
  eq(JSON.stringify(b2.Store.customs[0].accents), JSON.stringify([0, 1, 3]), "accents 归一为 [0,1,3]");
}

/* ================= 场景 T17：Editor 全流程（v1.0.0，M1 补覆盖） ================= */
section("T17 Editor · 打开-编辑-校验-撤销-保存全流程");
{
  const { beat, els, storage } = loadApp();
  beat.Editor.open();
  const d = beat.Editor.draft();
  ok(d && d.name.endsWith("-副本"), "打开编辑器：基于当前节奏型生成副本草稿");
  ok(els["editor"].classList.contains("open"), "编辑器 overlay 打开");

  const palette = els["palette"].children;
  eq(palette.length, 11, "音符块库 11 项（含两个三连音组块）");
  palette[10].fire("click");                       // 追加休止符（48t）→ 小节 1 超限
  eq(els["savePresetBtn"].disabled, true, "小节时值超限 → 保存禁用");
  ok(els["editorStatus"].textContent.includes("不完整"), "校验状态提示时值不完整");
  beat.Editor.undo();
  eq(els["savePresetBtn"].disabled, false, "撤销后校验恢复通过");

  els["presetNameInput"].value = "测试预设T17";
  els["savePresetBtn"].fire("click");
  eq(beat.Store.customs.length, 1, "保存后 customs +1");
  eq(beat.Store.customs[0].name, "测试预设T17", "预设名正确");
  eq(beat.Store.S.sel.id, beat.Store.customs[0].id, "S.sel 指向新预设 id");
  ok(!els["editor"].classList.contains("open"), "保存后编辑器关闭");
  /* v1.3.0 契约更新：预设库落在冷键 beatsight.customs（立即写，不防抖）。
     热键 beatsight.state 里不再含 customs —— 这正是 P1-5 要的效果：
     500 个预设时冷键 715 KB，但它只在增删改预设时写；每次调速/开关只写 <1 KB 的热键 */
  eq(JSON.parse(storage.get("beatsight.customs")).customs.length, 1, "新预设已写入冷键 beatsight.customs");
  ok(!/customs/.test(JSON.stringify(JSON.parse(storage.get("beatsight.state") || "{}"))),
     "热键不再携带 preset 库（冷热分离生效）");
  eq(beat.curPattern().name, "测试预设T17", "保存后当前节奏型即新预设");
}

/* ================= 场景 T18：层级增益不变量（v1.0.1） ================= */
/* v1.0.0 缺陷：重拍直接以 S.accentVol 作倍率，而正拍固定 ×0.8，
   于是「重拍增强量」低于 80% 时重拍反而轻于正拍，听觉强调层级倒挂。 */
section("T18 音量 · 重拍恒 ≥ 正拍（修复增强量倒挂）");
{
  const { beat: probe } = loadApp();
  const C = probe.CONFIG;

  /* click 音色三档频率互异，按频率区分层级，返回各层级的包络峰值 */
  const levels = (accentVol) => {
    const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, vol: 0.8, accentVol, bpm: 120 }) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    const pick = f => { const h = ac.hits.find(x => x.kind === "osc" && x.freq === f); return h ? h.gain : undefined; };
    return { accent: pick(C.freqAccent), beat: pick(C.freqBeat), sub: pick(C.freqSub) };
  };

  const L = levels(0.56);
  near(L.accent, 0.8 * (C.accentMin + (C.accentMax - C.accentMin) * 0.56), 1e-6, "重拍增益 = 总音量 ×（accentMin + 增量 × 增强量）");
  near(L.beat, 0.8 * C.levelBeat, 1e-6, "正拍增益 = 总音量 × levelBeat");
  ok(L.accent > L.beat, "增强量 56% 时重拍高于正拍（v1.0.0 此处倒挂）");
  ok(L.beat > L.sub, "正拍高于细分");

  /* 全量程：任何增强量都必须保持 重拍 ≥ 正拍 > 细分 */
  const broken = [0, 0.1, 0.25, 0.5, 0.56, 0.79, 0.8, 0.99, 1]
    .filter(v => { const l = levels(v); return !(l.accent >= l.beat && l.beat > l.sub); });
  eq(broken.length, 0, "增强量 0–100% 全程维持 重拍 ≥ 正拍 > 细分");

  /* 边界语义 + 向后兼容：默认 100% 的听感必须与 v1.0.0 完全一致 */
  near(levels(0).accent, 0.8 * C.levelBeat, 1e-6, "增强量 0% → 重拍与正拍齐平");
  near(levels(1).accent, 0.8 * 1, 1e-6, "增强量 100% → 重拍 1.0，与 v1.0.0 默认听感一致");
}

/* ================= 场景 T19：常用速度快捷档 + ±5 步进（v1.1） ================= */
section("T19 速度 · 常用速度快捷档 / ±5 步进 / 训练模式置灰");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  eq(JSON.stringify(beat.CONFIG.speedPresets), JSON.stringify([60, 72, 84, 96, 120]), "快捷档值 = 60/72/84/96/120");

  /* 快捷档与滑杆刻度同源生成（单一数据源 CONFIG.speedPresets） */
  const pills = els["bpmPresetRow"].children;
  eq(pills.length, 5, "生成 5 个快捷档按钮");
  eq(pills.map(b => +b.dataset.bpm).join(","), "60,72,84,96,120", "dataset.bpm 与常量一致");
  eq(pills.map(b => +b.textContent).join(","), "60,72,84,96,120", "按钮文案与常量一致");
  /* 滑杆刻度：与档位同源，且必须是手绘 <i> —— 回归守卫。
     Chrome 不渲染 range 的 datalist 刻度（已实测），若有人改回 <option>，tagName 断言会立刻红。 */
  const ticks = els["bpmTicks"].children;
  eq(ticks.length, 5, "滑杆刻度同源生成 5 项");
  ok(ticks.every(t => t.tagName === "I"), "刻度是 <i> 元素而非 <option>（Chrome 不渲染 datalist 刻度）");
  const lefts = ticks.map(t => parseFloat(t.style.left));
  ok(Math.abs(lefts[1] - 20) < 1e-9, "72 BPM 刻度落在 20%（(72−30)/(240−30)）");
  ok(lefts.every((p, i) => i === 0 || p > lefts[i - 1]), "刻度从左到右严格递增");
  ok(lefts.every(p => p > 0 && p < 100), "刻度均落在滑杆行程内部");
  eq(pills[0].getAttribute("aria-label"), "跳到 60 BPM", "快捷档带无障碍标签");

  /* 点击档位 → 直达该 BPM，并同步数字 / 滑杆 / 高亮 */
  pills[4].fire("click");
  eq(S.bpm, 120, "点击 120 档 → S.bpm = 120");
  eq(+els["bpmNum"].textContent, 120, "大数字同步");
  eq(+els["bpmSlider"].value, 120, "滑杆位置同步");
  ok(pills[4].classList.contains("active"), "命中档位高亮");
  ok(!pills[0].classList.contains("active"), "未命中档位不高亮");

  /* 非档位值（滑杆 / ±1 调出来的）→ 全部不高亮 */
  beat.Controls.setBpm(97);
  ok(pills.every(b => !b.classList.contains("active")), "BPM 不等于任何档位时全部不高亮");

  /* ±5 粗调：单击一步（长按连发依赖 setTimeout，测试环境不真跑） */
  beat.Controls.setBpm(100);
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 105, "+5 → 105");
  els["bpmMinus5"].fire("pointerdown");
  eq(S.bpm, 100, "−5 → 100");
  for (let i = 0; i < 4; i++) els["bpmMinus5"].fire("pointerdown");
  eq(S.bpm, 80, "连续 −5 累计正确（100 → 80）");

  /* 越界钳制沿用 setBpm 的 30–240 */
  beat.Controls.setBpm(238);
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 240, "+5 触顶钳制到 240");
  beat.Controls.setBpm(32);
  els["bpmMinus5"].fire("pointerdown");
  eq(S.bpm, 30, "−5 触底钳制到 30");

  /* click 兜底（v2.0.2）：键盘 Enter/Space 与读屏激活只发 click、不发 pointerdown，
     且这类「无指针」click 的 detail 恒为 0——没有这层这四个按钮对他们是「哑键」。
     指针路径（pointerdown→click，detail ≥ 1）不得二次步进 */
  beat.Controls.setBpm(100);
  els["bpmPlus"].fire("click", { detail: 0 });
  eq(S.bpm, 101, "★ 键盘/读屏路径（click detail=0）→ +1 生效");
  els["bpmMinus5"].fire("click", { detail: 0 });
  eq(S.bpm, 96, "键盘/读屏路径 → −5 生效");
  els["bpmPlus5"].fire("pointerdown");
  els["bpmPlus5"].fire("pointerup");
  els["bpmPlus5"].fire("click", { detail: 1 });
  eq(S.bpm, 101, "★ 指针路径 pointerdown 步进一次，随后的兼容 click 被抑制（96 → 101，不是 106）");

  /* 播放中点击档位：不打断播放（setBpm 内部做 loopStart 重映射） */
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 1);
  ok(S.playing, "已进入播放态");
  pills[0].fire("click");
  eq(S.bpm, 60, "播放中点 60 档生效");
  ok(S.playing, "播放未被打断");

  /* 训练模式：BPM 归训练器阶梯管，快捷档与 ±5 置灰；关闭后恢复 */
  els["trainerToggle"].fire("click");
  ok(S.trainer.on, "训练已开启");
  ok(pills.every(b => b.disabled), "训练开启 → 快捷档全部置灰");
  ok(els["bpmPlus5"].disabled && els["bpmMinus5"].disabled, "训练开启 → ±5 置灰");
  els["trainerToggle"].fire("click");
  ok(!S.trainer.on, "训练已关闭");
  ok(pills.every(b => !b.disabled) && !els["bpmPlus5"].disabled, "训练关闭 → 快捷档与 ±5 恢复可用");
}

/* ================= 场景 T19b：控件接线补漏（长按连发 / 滑杆 input / TAP 复位定时器） =================
   T19 只覆盖了「单击一步」；三个埋进 setTimeout 的处理器体（长按连发、TAP 文案复位、闪光移除）
   与滑杆 input 的 save=false 语义此前无断言。 */
section("T19b 速度控件 · 长按连发启动 / 滑杆 input 不落盘 / TAP 两个复位定时器");
{
  const app = loadApp();
  const { beat, els } = app;
  const S = beat.Store.S;

  /* 沙箱的 setInterval 只记录不执行、且不可观测；换成可捕获的桩，
     既能证明「400ms 后连发体确实被排期」，又能手动触发它验证步进方向。 */
  let burst = null, burstMs = 0;
  app.sandbox.setInterval = (fn, ms) => { burst = fn; burstMs = ms; return 999; };

  /* ① 400ms 内松手 → 定时器被 clearTimeout 清掉，连发不启动 */
  beat.Controls.setBpm(100);
  els["bpmPlus5"].fire("pointerdown");
  els["bpmPlus5"].fire("pointerup");
  app.runTimers();                                     // 若定时器没被清，这一步会启动连发
  eq(burst, null, "★ 长按未满 400ms 松手 → 连发定时器已被清（不会漏发）");
  eq(S.bpm, 105, "只走了 pointerdown 的单击步进");

  /* ② 长按满 400ms → 启动 90ms/步 的连发（L3652） */
  els["bpmPlus5"].fire("pointerdown");
  eq(S.bpm, 110, "再次 pointerdown 立即 +5");
  app.runTimers();                                     // 冲刷 400ms 定时器
  ok(typeof burst === "function", "★ 400ms 到点 → 连发体被排期（L3652）");
  eq(burstMs, 90, "连发间隔 90ms");
  burst();                                             // 手动连发一步
  eq(S.bpm, 115, "连发体按 delta 步进");
  els["bpmPlus5"].fire("pointerup");                   // 收尾：interval 已存在，走 clearInterval 分支

  /* ③ 滑杆 input（L3672）：拖动高频触发、save=false 不落盘；change 才持久化 */
  els["bpmSlider"].value = "108"; els["bpmSlider"].fire("input"); els["bpmSlider"].fire("change");
  beat.Store.flush();
  eq(JSON.parse(app.storage.get("beatsight.state")).bpm, 108, "先落盘 108（准备负向对照）");
  els["bpmSlider"].value = "132";
  els["bpmSlider"].fire("input");
  eq(S.bpm, 132, "★ 滑杆 input 把值灌入 S.bpm（L3672）");
  eq(+els["bpmNum"].textContent, 132, "大数字随滑杆同步");
  app.runTimers();                                     // 只冲刷「已排期」的 debounce 写；input 没排期过，故不应有任何写入
  eq(JSON.parse(app.storage.get("beatsight.state")).bpm, 108, "★ input 阶段不落盘（save=false，避免拖动时高频写）");
  els["bpmSlider"].fire("change");
  app.runTimers();                                     // change 才排期了 debounce 写
  eq(JSON.parse(app.storage.get("beatsight.state")).bpm, 132, "change → 落盘 132");

  /* ④ TAP 测速：两下间隔算 BPM；文案复位 2600ms、闪光移除 120ms 都埋在 setTimeout 里 */
  const t0 = 500000;
  app.setNow(t0);
  els["tapBtn"].fire("click");
  eq(els["tapBtn"].textContent, "TAP · 再点一次", "第一下提示再点一次");
  ok(els["tapBtn"].classList.contains("flash"), "点击即挂上 flash 类");
  app.setNow(t0 + 500);
  els["tapBtn"].fire("click");
  eq(S.bpm, 120, "两下间隔 500ms → 120 BPM");
  eq(els["tapBtn"].textContent, "TAP · 120 BPM", "命中后显示测得的 BPM");
  app.runTimers();                                     // 冲刷 2600ms 文案复位 + 120ms 闪光移除
  eq(els["tapBtn"].textContent, "TAP 测速", "★ 2600ms 到点 → 文案复位（L3690）");
  ok(!els["tapBtn"].classList.contains("flash"), "★ 120ms 到点 → 闪光类移除（L3691）");
}

