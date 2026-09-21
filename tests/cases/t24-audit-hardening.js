/* BeatSight 自动化测试 · 审计整改：冷热分离 / 版本单一真相源 / 后台调度 / 渲染性能 / 无障碍 / 音频生命周期
   T24–T29。对应 v1.3.0 的「第二 / 第三梯队」审计条目。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, pill, driveFrames, ok, eq, section, PROBE, resetProbe, html } = require("../lib/harness");

/* ================================================================================
   场景 T24–T29：v1.3.0「第二 / 第三梯队」改造
   对应审计条目：P1-5 持久化冷热分离 · P2-9/P2-10 版本号与重复逻辑 · P1-3 后台调度
                 P1-4 渲染性能 · P2-11 无障碍 · P2-13/P2-14 音频生命周期与跨 origin 提示
   ================================================================================ */

section("T24 持久化 · 冷热分离 / 防抖 / 失败可见（审计 P1-5）");
{
  /* 载荷量级是 P1-5 的原始动因：原实现把预设库塞进同一个 key，而 persist() 挂在
     几乎每个交互上（调速、每个开关、TAP、拍号、音色、音量）。实测 500 预设 = 715 KB，
     每次点击都要全量 JSON.stringify + 同步写盘 → 5–20ms 主线程阻塞 → 音频掉音。 */
  const { beat, storage, setHidden } = loadApp();
  ok(!storage.has("beatsight.state") && !storage.has("beatsight.customs"), "全新用户：加载时不预写任何键");

  beat.Store.persist();
  ok(!storage.has("beatsight.state"), "persist() 是防抖的——调用后不立即落盘");
  beat.Store.flush();
  ok(storage.has("beatsight.state"), "flush() 立即落盘热键");
  const hot = JSON.parse(storage.get("beatsight.state"));
  eq(hot.v, 3, "热键带 schema 版本");
  ok(!("customs" in hot), "热键里不含 customs（冷热分离生效）");
  ok(!storage.has("beatsight.customs"), "纯热变更不写冷键——预设库没变就不该重写它");

  /* 冷数据：预设增删改必须立即写，不能防抖（丢掉一个手写节奏型代价太大） */
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "冷热测试", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }]}));
  ok(storage.has("beatsight.customs"), "导入预设 → 冷键立即落盘（不经防抖）");
  eq(JSON.parse(storage.get("beatsight.customs")).customs.length, 1, "冷键内容正确");

  /* 页面隐藏时强制落盘：防抖窗口内的改动不能在切走时丢 */
  const b2 = loadApp();
  b2.beat.Store.persist();
  ok(!b2.storage.has("beatsight.state"), "切换前：仍在防抖窗口内，尚未落盘");
  b2.setHidden(true);
  ok(b2.storage.has("beatsight.state"), "页面隐藏 → 强制 flush 落盘");

  /* 载荷量级对照 */
  const b3 = loadApp();
  const mk = i => ({ name: "P" + i, meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) });
  b3.beat.Store.importPresets(JSON.stringify({ presets: Array.from({ length: 100 }, (_, i) => mk(i)) }));
  b3.beat.Store.flush();
  const coldLen = b3.storage.get("beatsight.customs").length;
  const hotLen = b3.storage.get("beatsight.state").length;
  ok(coldLen > 20 * hotLen,
    `100 个预设时冷键 ${coldLen} B / 热键 ${hotLen} B（${Math.round(coldLen / hotLen)}×）——调速开关只动热键`);

  /* 失败可见：原先 catch(e){} 完全静默，用户"预设存不进去"毫无察觉 */
  const b4 = loadApp({}, { throwOnWrite: true });
  b4.beat.Controls.setBpm(150);
  b4.beat.Store.flush();
  eq(b4.els["brandChip"].textContent, "v" + b4.beat.VERSION + " · 保存失败", "写失败 → 顶栏 chip 明示");
  ok(b4.els["persistDot"].classList.contains("bad"), "写失败 → 状态点变红");
  eq(b4.els["modalMask"].hidden, false, "写失败 → 一次性弹窗告知（不再静默降级）");
  ok(b4.els["modalMsg"].textContent.indexOf("本地保存失败") >= 0, "弹窗文案可读（含原因与「导出预设」备份建议）");

  /* 恢复回路（v2.0.2，审计 D5）：原先 persistFailNotified 一旦置 true 就**永不归位**——
     存储失败过之后即便恢复（用户清了空间 / 退出隐私模式），顶栏会永远停在"保存失败"，
     且后续再失败也不再告知。恢复必须同样可见，通知闸门必须真正复位。 */
  b4.els["modalOk"].fire("click");                                          // 关掉失败弹窗
  b4.sandbox.localStorage.setItem = (k, v) => b4.storage.set(k, String(v)); // 模拟配额/隐私模式恢复
  b4.beat.Store.flush();
  ok(!b4.els["persistDot"].classList.contains("bad"), "★ 写入恢复成功 → 状态点不再标红");
  eq(b4.els["brandChip"].textContent, "v" + b4.beat.VERSION + " · 稳定版", "★ 写入恢复成功 → 顶栏 chip 复位");
  eq(b4.els["srAnnounce"].textContent, "本地保存已恢复", "★ 写入恢复成功 → 读屏播报恢复（用户可感知）");
  /* 闸门复位的最强证据：恢复之后再坏一次，应当**重新**告知（不是从此永远沉默） */
  b4.sandbox.localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  b4.beat.Store.flush();
  eq(b4.els["brandChip"].textContent, "v" + b4.beat.VERSION + " · 保存失败", "★ 再次失败 → 仍能重新告知（通知闸门已复位）");
  eq(b4.els["modalMask"].hidden, false, "再次失败 → 弹窗重新出现");
}

section("T25 版本号单一真相源 + 重复逻辑抽取（审计 P2-9 / P2-10）");
{
  const { beat, els, sandbox } = loadApp();
  ok(/^\d+\.\d+\.\d+$/.test(beat.VERSION), `VERSION 形如 x.y.z（实际 ${beat.VERSION}）`);
  eq(sandbox.document.title, "BeatSight 时值节拍器 v" + beat.VERSION, "标题由 VERSION 派生");
  eq(els["brandVer"].textContent, "v" + beat.VERSION, "品牌区版本号由 VERSION 派生");
  eq(els["brandChip"].textContent, "v" + beat.VERSION + " · 稳定版", "顶栏 chip 由 VERSION 派生");
  /* 关键：标记段不得再出现**硬编码**版本号——那正是 P2-9 要根治的漂移源。
     要去掉注释再比（文件里到处是「v1.3.0：某某修复」这类历史注释，它们不是真相源） */
  const markup = html.slice(0, html.indexOf("<script>"))
    .replace(/<!--[\s\S]*?-->/g, "")      // HTML 注释
    .replace(/\/\*[\s\S]*?\*\//g, "");    // CSS 注释
  eq((markup.match(/v\d+\.\d+\.\d+/g) || []).length, 0, "标记段（去注释）零硬编码版本号");

  /* selectedPreset()：原先在 Presets 里写了两遍（updateFallbackNote 与 fallbackBtn） */
  const b = loadApp({ "beatsight.m2": JSON.stringify({ v: 3,
    customs: [{ id: "a", name: "自定义A", meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }],
    sel: { type: "custom", id: "a" } }) });
  eq(b.beat.selectedPreset().name, "自定义A", "selectedPreset：custom id 命中");
  b.beat.Store.S.sel = { type: "builtin", idx: 2 };
  eq(b.beat.selectedPreset().name, b.beat.BUILTINS[2].name, "selectedPreset：builtin idx 命中");
  b.beat.Store.S.sel = { type: "custom", id: "ghost" };
  eq(b.beat.selectedPreset(), undefined, "selectedPreset：不存在的 id → undefined（不抛）");

  /* resolveRef() / scheduleRef()：v2.0.0 为曲式编排泛化出的两件东西。
     它们本身是给"段里引用任意预设"用的，但**抽取重构必须证明这两条路真的通了**——
     否则下一步就是在一个没验证过的钩子上盖房子。 */
  const b3 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, sel: { type: "custom", id: "x" },
    customs: [{ id: "x", name: "自定义X", meter: 4, bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }) });
  eq(b3.beat.resolveRef({ type: "builtin", idx: 1 }).name, b3.beat.BUILTINS[1].name,
     "resolveRef：builtin 命中");
  eq(b3.beat.resolveRef({ type: "custom", id: "x" }).name, "自定义X", "resolveRef：custom 命中");
  eq(b3.beat.resolveRef({ type: "custom", id: "ghost" }), undefined, "resolveRef：引用不存在 → undefined（不抛）");
  eq(b3.beat.resolveRef({ type: "builtin", idx: 999 }), undefined, "resolveRef：idx 越界 → undefined");
  /* 「不抛」要写成显式捕获而不是直接 eq：变异掉 null 守卫后直接调用会抛异常，
     那会让**整套测试崩溃**、后面用例一条都跑不到（改成捕获 → 失败是具名的） */
  let nullThrew = false, nullVal;
  try { nullVal = b3.beat.resolveRef(null); } catch(e){ nullThrew = true; }
  eq(nullThrew, false, "resolveRef：空引用不抛异常");
  eq(nullVal, undefined, "resolveRef：空引用 → undefined");
  eq(b3.beat.selectedPreset().name, "自定义X", "selectedPreset 就是 resolveRef(S.sel)（抽取后行为不变）");

  b3.beat.Presets.refreshAfterPatternChange();                 // 未播放 → 走"立即生效"路径
  eq(b3.els["patternName"].textContent, "自定义X",
     "pendingRef 为空时应用的是当前选中预设（既有路径行为不变）");
  /* P2-6：scheduleRef 只登记挂起、不再顺手重建侧栏——重建交给紧随其后的 applyPatternChange。
     探针把这条钉死：排一个型不得产生任何 className 写入（旧实现会全量重建，探针 > 0）。 */
  resetProbe();
  b3.beat.Presets.scheduleRef({ type: "builtin", idx: 2 });     // 排一个"别的型"
  eq(PROBE.classWrites, 0, "★ scheduleRef 只排挂起、不重建列表（审计 P2-6；旧实现此处 > 0）");
  eq(b3.els["patternName"].textContent, "自定义X", "刚排上时尚未生效（要等小节边界）");
  const pend = b3.beat.Presets.consumePending(0);
  eq(pend.applied, true, "小节边界消费挂起成功");
  eq(pend.resetBar, 0, "同拍号且 schedBarNow=0 → resetBar = 0（拍号没变，不是 sigChg 那条路）");
  eq(b3.els["patternName"].textContent, b3.beat.BUILTINS[2].name,
     "★ 消费后生效的是 scheduleRef 排的那个型，**不是** S.sel 指的——泛化真的通了");
  eq(b3.beat.Presets.consumePending(0).applied, false, "挂起是一次性的（pendingPattern 已消费）");
  /* ★ pendingRef 也必须一次性消费。只测「pendingPattern 已消费」是不够的——
     变异验证时发现：不清 pendingRef 时上面那条照样通过，因为拦在 `!pendingPattern` 那关。
     真正的后果在**下一条预设路径**上暴露：用户切了预设走挂起，却会沿用上一次残留的 ref
     （切了预设却播放上一个曲式块）。所以这里显式走一次预设路径确认。 */
  b3.beat.Store.S.sel = { type: "custom", id: "x" };
  b3.beat.Presets.refreshAfterPatternChange();
  eq(b3.els["patternName"].textContent, "自定义X",
     "★ 消费后再走预设路径：应用的是 S.sel，不是上一次残留的 pendingRef");

  /* defaultAccents()：原先在 basicPattern 与 Editor 各写一条阶梯 */
  eq(JSON.stringify(b.beat.defaultAccents(4)), "[0]", "4/4 默认重拍分组 [0]");
  eq(JSON.stringify(b.beat.defaultAccents(5)), "[0,2]", "5/4 默认档 2+3 → [0,2]");
  eq(JSON.stringify(b.beat.defaultAccents(7)), "[0,3,5]", "7/4 默认档 3+2+2 → [0,3,5]");

  const b2 = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, sig: 5, accentGrp: { "5": 1 } }) });
  eq(JSON.stringify(b2.beat.defaultAccents(5)), "[0,3]", "5/4 切到 3+2 档 → [0,3]（accentGrp 被遵从）");
  b2.beat.Editor.open();
  eq(JSON.stringify(b2.beat.Editor.draft().accents), JSON.stringify(b2.beat.defaultAccents(5)),
    "编辑器草稿的默认重拍分组与 defaultAccents 同源（抽取前的重复点）");
}

section("T26 后台播放 · 自适应前瞻窗口 + 回前台补排 + 饥饿兜底（审计 P1-3）");
{
  /* sel idx 1（四分基础 → 普通轨）：v2.7.1 起默认型（民谣扫弦）在扫弦轨会让
     拍点节拍音与扫弦**同刻叠加**（设计如此），本场景的「时刻严格递增」断言
     需要一条纯节拍声部的单声道时间轴 */
  const app = loadApp({ "beatsight.state": JSON.stringify({ v: 3, sel: { type: "builtin", idx: 1 } }) });
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;

  ac.currentTime += 0.02; beat.AudioEngine.scheduler();
  /* 游标会**越过**窗口边界：while 的退出条件是「游标 ≥ now+窗口」，所以 nextNoteTime
     天然落在 [now+win, now+win+一个音符时长] 区间内。断言按这个口径写，否则会误报。 */
  const fg = beat.clock().nextNoteTime - ac.currentTime;
  ok(fg >= beat.CONFIG.schedWindow - 1e-6 && fg <= beat.CONFIG.schedWindow + 0.7,
    `前台窗口收在 ${beat.CONFIG.schedWindow}s 一档（实测游标超前 ${fg.toFixed(3)}s → 低延迟）`);

  /* 切后台：窗口必须拉到 > 1000ms（浏览器对后台标签页 setInterval 的节流下限），
     否则「每次唤醒只排 150ms 的音、然后静音 850ms」→ 必然断续 */
  app.setHidden(true);
  ac.currentTime += 0.02; beat.AudioEngine.scheduler();
  const bg = beat.clock().nextNoteTime - ac.currentTime;
  ok(bg > 1.0, `后台窗口拉到 ${beat.CONFIG.schedWindowBg}s（实测游标超前 ${bg.toFixed(3)}s > 1s 节流下限）`);
  ok(bg - fg > 0.3, `可见性切换确实改变了窗口（前台游标超前 ${fg.toFixed(3)}s → 后台 ${bg.toFixed(3)}s）`);

  /* 模拟后台被严重节流（Chrome intensive throttling 可到 1 次/分钟唤醒）：30 秒没调度 */
  const hitsBefore = ac.hits.length;
  ac.currentTime += 30;

  /* 回前台（visibilitychange）→ 立即补排，不必等下一个 25ms 周期 */
  app.setHidden(false);
  const after = beat.clock();
  ok(ac.hits.length > hitsBefore, `回前台立即补排（新增 ${ac.hits.length - hitsBefore} 次排程）`);

  /* 饥饿兜底：绝不允许把过去 30 秒的音符一次性排到"现在"——那听感是一坨同时爆响。
     MAX_SCHED_STEPS 只拦得住死循环，拦不住这个。 */
  const past = ac.hits.slice(hitsBefore).filter(h => h.t < ac.currentTime - 1e-6);
  eq(past.length, 0, "没有任何音符被排到过去（否则 30 秒的音会瞬间叠响）");
  ok(after.nextNoteTime >= ac.currentTime, "游标已重新锚定，不落后于当前时钟");
  ok(after.nextNoteTime <= ac.currentTime + 1.2, "游标也没被推得过远（仍落在一个窗口内）");
  ok(after.loopStart >= ac.currentTime && after.loopStart <= ac.currentTime + 0.2,
    "时间轴原点已重新锚定到当前时刻附近（不再是几十秒前的旧时间轴 → 不会「有游标但窗口外」空档）");
  eq(after.schedBar, 0, "小节游标归零（相位重新起算）");
  const times = ac.hits.slice(hitsBefore).map(h => h.t);
  ok(times.every((t, i) => i === 0 || t > times[i - 1]), "补排后的时刻严格递增（无重复/无倒退）");
}

section("T27 渲染性能 · 帧内零布局读取 + 增量重绘等价（审计 P1-4）");
{
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 1);                       // 进入稳定播放态

  /* 连跑约一个多小节（96BPM 4/4 四分基础一小节 2.5s），逐帧统计：
     布局读取 / className 写入。两者都是"性能承诺"，不数就断言不了。 */
  let frames = 0, reads = 0, idle = 0, incr = 0, full = 0, maxW = 0;
  for (let i = 0; i < 140; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    resetProbe();
    beat.Viz.paintFrame();
    frames++;
    reads += PROBE.layoutReads;
    if (PROBE.classWrites === 0){ idle++; continue; }
    maxW = Math.max(maxW, PROBE.classWrites);
    if (PROBE.classWrites <= 10) incr++; else full++;
  }
  eq(reads, 0, `连跑 ${frames} 帧、共 ${idle + incr + full} 次重绘，全程零 offset* 读取（不再帧中途强制重排）`);
  ok(idle > incr + full, `多数帧无事可做（${idle}/${frames} 帧零写入——"音符未变"提前返回生效）`);
  ok(incr >= 3, `增量重绘确实生效：${incr} 帧只改少数格子（≤10 次 className 写入，原实现每次换音符要 128 次）`);
  ok(full <= 2, `只有换小节那 ${full} 帧走全量重扫（增量未退化成"每帧全量"）`);
  ok(maxW <= 60, `单帧写入有上界（最大 ${maxW} 次）`);

  /* 增量重绘最危险的失效方式是"漏改某格"→ 画面与声音脱节。
     逐帧交叉检查渲染结果是否仍满足全量重绘会产出的那套不变量。 */
  const rows = () => app.els["viz"].children.filter(c => /(^| )bar-row( |$)/.test(c.className));
  const cellsOf = r => r.children.filter(c => /(^| )cell( |$)/.test(c.className));
  const checkGrid = () => {
    const rs = rows();
    if (rs.length !== 4) return `行数 ${rs.length} ≠ 4`;
    const cellRows = rs.map(cellsOf);
    const act = [], nxt = [];
    cellRows.forEach((cs, b) => cs.forEach((c, i) => {
      if (/(^| )active( |$)/.test(c.className)) act.push([b, i]);
      if (/(^| )next( |$)/.test(c.className)) nxt.push([b, i]);
    }));
    if (act.length !== 1) return `active 格数 ${act.length} ≠ 1`;
    if (nxt.length !== 1) return `next 格数 ${nxt.length} ≠ 1`;
    const curRow = rs.findIndex(r => r.classList.contains("current"));
    if (curRow !== act[0][0]) return `current 行 ${curRow} ≠ active 所在行 ${act[0][0]}`;
    const [ab, ai] = act[0];
    for (let b = 0; b < 4; b++) for (let i = 0; i < cellRows[b].length; i++){
      const cn = cellRows[b][i].className;
      const want = (b < ab) ? "played" : (b > ab) ? "upcoming" : (i < ai) ? "played" : (i === ai) ? "active" : "upcoming";
      if (!new RegExp("(^| )" + want + "( |$)").test(cn)) return `格[${b}][${i}] 应为 ${want}，实际「${cn}」`;
    }
    const [nb, ni] = nxt[0];
    const expB = ni === 0 ? (nb + 3) % 4 : nb;         // next 只能是 active 的下一格，或下一行第一格
    if (!(nb === ab && ni === ai + 1) && !(nb === (ab + 1) % 4 && ni === 0)) return `next 位置 [${nb}][${ni}] 不是 active 的后继`;
    if (nb !== expB && ni !== 0) return `next 行不合法`;
    return null;
  };
  let checked = 0; const problems = [];
  for (let k = 0; k < 300; k++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    beat.Viz.paintFrame();
    if (k % 6) continue;
    checked++;
    const p = checkGrid();
    if (p) problems.push(p);
  }
  ok(problems.length === 0, `增量重绘与全量重绘结果一致（抽查 ${checked} 帧，破例 ${problems.length} 例）`);
  problems.slice(0, 5).forEach(p => console.log("      · " + p));
}

section("T28 无障碍 · 开关语义 / 选中语义 / 分级播报 / 焦点陷阱（审计 P2-11）");
{
  const { beat, els, sandbox } = loadApp();

  /* 开关：role=switch + aria-checked，且与视觉同源（同一个助手写） */
  eq(els["muteToggle"].getAttribute("aria-checked"), "false", "静音拍开关初始 aria-checked=false");
  els["muteToggle"].fire("click");
  eq(els["muteToggle"].getAttribute("aria-checked"), "true", "点击后 aria-checked 跟随状态");
  ok(/(^| )on( |$)/.test(els["muteToggle"].className), "视觉（className=on）与语义（aria-checked=true）同步");
  els["bounceToggle"].fire("click");
  eq(els["bounceToggle"].getAttribute("aria-checked"), "false", "弹跳球开关关闭 → aria-checked=false");
  els["countInToggle"].fire("click");
  eq(els["countInToggle"].getAttribute("aria-checked"), "true", "预备拍开关 → aria-checked=true");

  /* 三选一 pill 组：aria-pressed 与 .active 同源 */
  const pills = sel => els[sel].children;
  eq(pills("sigRow")[2].getAttribute("aria-pressed"), "true", "4/4 初始 aria-pressed=true");
  beat.Controls.setSig(6);
  eq(pills("sigRow")[2].getAttribute("aria-pressed"), "false", "切到 6/8 后 4/4 的 aria-pressed 复位");
  eq(pills("sigRow")[4].getAttribute("aria-pressed"), "true", "6/8 的 aria-pressed 置位");
  ok(!/(^| )active( |$)/.test(pills("sigRow")[2].className) && /(^| )active( |$)/.test(pills("sigRow")[4].className),
    "视觉高亮与 aria-pressed 一致（原先只改 classList）");
  beat.Controls.setSwing(67);
  eq(pills("swingRow")[1].getAttribute("aria-pressed"), "true", "Swing 档位 aria-pressed 同步");
  beat.Controls.setTimbre("drum");
  eq(pills("timbreRow")[2].getAttribute("aria-pressed"), "true", "音色档位 aria-pressed 同步");

  /* 分级播报：粗粒度事件写 srAnnounce；高频读数 #statusText 绝不挂 aria-live。
     注意这两条要**查 index.html 原文**——它们是纯标记属性，用 stub 断言等于在断言 stub 自己 */
  ok(/id="srAnnounce"[^>]*aria-live="polite"/.test(html), "播报区在标记里挂了 aria-live=polite");
  ok(/id="srAnnounce"[^>]*role="status"/.test(html), "播报区在标记里声明 role=status");
  ok(!/id="statusText"[^>]*aria-live/.test(html), "高频状态栏没有 aria-live（否则读屏每换一个十六分音就刷屏）");
  /* v2.4.3：＋「循环本段」→ 8 个；其中带初始 aria-checked 的仍是 5 个，
     因为循环开关与六线开关一样在标记里就写了初值（off/false），故它落在下面那条的**正则之外**
     ——那条只认 mute/bounce/countIn/trainer/keepAwake 这五个 id，不是"所有开关" */
  eq((html.match(/role="switch"/g) || []).length, 9, "标记里 9 个 .toggle-pill 都声明了 role=switch（v1.4 +后台保活 +v2.0.0 曲式范围循环 +v2.4.2 六线底纹 +v2.4.3 练习循环 +v2.7.3 跳段行范围循环）");
  eq((html.match(/id="(mute|bounce|countIn|trainer|keepAwake)Toggle"[^>]*aria-checked=/g) || []).length, 5,
    "5 个开关在标记里都带初始 aria-checked");
  /* v2.4.2 新增的开关（六线底纹）单独点名守一遍：
     它是默认**开**的，故标记里必须是 class="toggle-pill on" + aria-checked="true"——
     若哪天有人把初值写反，"打开应用先看到纸 vs 先看到箭头"这个观感决定就悄悄丢了。
     ★ 从整个 <button ...> 标签里取，不写属性顺序：本文件里 tabToggle 的 class 在 id 之前，
       而 keepAwakeToggle 的 id 在 class 之前——按"id 跟着 class"写正则会对着其中一个永远为假
       （这里踩过一次：断言红了但标记其实是对的）。 */
  const tabTag = (html.match(/<button[^>]*id="tabToggle"[^>]*>/) || [""])[0];
  ok(/class="toggle-pill on"/.test(tabTag), "★ 六线底纹开关默认开（class 含 on）");
  ok(/aria-checked="true"/.test(tabTag), "★ 六线底纹开关 aria-checked=true（与 S.showTab 默认 true 同口径）");  beat.Controls.start();
  ok(/开始播放/.test(els["srAnnounce"].textContent), `开始播放被播报：「${els["srAnnounce"].textContent}」`);
  beat.Controls.stop();
  eq(els["srAnnounce"].textContent, "已停止", "停止被播报");

  /* 播放键标签随状态变（原先静态写「播放/停止」） */
  eq(els["playBtn"].getAttribute("aria-label"), "播放", "停机时 aria-label=播放");
  beat.Controls.start();
  eq(els["playBtn"].getAttribute("aria-label"), "停止", "播放中 aria-label=停止");
  beat.Controls.stop();

  /* 焦点陷阱：弹窗/编辑器打开时背景 inert（用重算而非置位，嵌套弹窗不会提前摘掉） */
  const bg = () => sandbox.document.querySelectorAll(".main, .topbar");
  ok(!bg().some(e => e.inert), "常态：背景可交互");
  beat.Modal.uiAlert("测试");
  ok(bg().every(e => e.inert), "弹窗打开 → 背景 inert（Tab 不再跑到背后）");
  els["modalOk"].fire("click");
  ok(!bg().some(e => e.inert), "弹窗关闭 → inert 摘除");
  beat.Editor.open();
  ok(bg().every(e => e.inert), "编辑器打开 → 背景 inert");
  /* 嵌套：编辑器里再弹确认框，关掉弹窗后编辑器还开着 → 背景必须保持 inert（重算而非置位） */
  beat.Modal.uiAlert("嵌套");
  els["modalOk"].fire("click");
  ok(bg().every(e => e.inert), "嵌套弹窗关闭后仍保持 inert（编辑器还开着）");
  beat.Editor.tryClose();
  ok(!bg().some(e => e.inert), "编辑器关闭 → inert 摘除");
}

section("T29 音频生命周期 + 跨 origin 迁移提示（审计 P2-13 / P2-14）");
{
  /* iOS 的两个关键状态：interrupted（通话/闹钟抢占音频会话，Safari 私有状态）
     与 closed（上下文被彻底关闭）。原实现只认 suspended → 通话结束后可能永久无声。 */
  const app = loadApp();
  const beat = app.beat;
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  ok(typeof ac.onstatechange === "function", "已安装 ctx.onstatechange（原先完全没监听）");

  const r0 = ac.resumeCount;
  ac.setState("interrupted");
  eq(ac.resumeCount, r0 + 1, "interrupted → 自动 resume（否则通话结束后永久无声）");

  /* closed → 重建上下文，否则旧时钟失效后表现为「在播放但一直不出声」 */
  ac.setState("closed");
  const ac2 = FakeAudioContext.last;
  ok(ac2 !== ac, "closed → 已重建 AudioContext");
  eq(ac2.state, "running", "新上下文为 running");
  ok(beat.Store.S.playing, "重建后仍在播放（不是被迫停机）");
  const c = beat.clock();
  ok(c.nextNoteTime >= ac2.currentTime - 0.2 && c.nextNoteTime <= ac2.currentTime + 1.0 + 0.2,
    "游标已按新时钟重新锚定（否则会领先新时钟几分钟 → 一直不出声）");
  const err = driveFrames(ac2, beat, 2);
  ok(!err, `重建后能继续正常排程与渲染（${err || "OK"}）`);

  /* T29c：closed 重建后噪声 buffer 必须随新上下文重建。
     原路径把 ctx/masterGain/时钟/onsetBuf 全重置了，唯独 noiseBuf 留着旧上下文的 buffer——
     木鱼/鼓组音色在重建后复用它，跨上下文复用 AudioBuffer 是否可用依赖浏览器实现
     （老 Safari 直接抛错），属「极端路径 + 实现侥幸」。这里用 wood 音色走滤波噪声路径，
     断言重建后送进 BufferSource 的 buffer 出生自新上下文。 */
  const appW = loadApp({ "beatsight.state": JSON.stringify({ v: 3, timbre: "wood" }) });
  appW.beat.Controls.start();
  const acW = FakeAudioContext.last;
  driveFrames(acW, appW.beat, 2);
  ok(acW.hits.some(h => h.kind === "noise"), "wood 音色下产生滤波噪声发声（断言前提）");
  acW.setState("closed");
  const acW2 = FakeAudioContext.last;
  ok(acW2 !== acW, "wood 播放中 closed → 上下文已重建");
  driveFrames(acW2, appW.beat, 2);
  const nh = acW2.hits.find(h => h.kind === "noise");
  ok(nh && nh.bufCtx === acW2, "重建后噪声 buffer 出生自新上下文（旧 buffer 不得跨上下文复用）");

  /* pagehide：页面离开必须停播（移动端否则「切走了还在响」） */
  const app2 = loadApp();
  app2.beat.Controls.start();
  ok(app2.beat.Store.S.playing, "pagehide 前在播放");
  app2.firePageHide();
  ok(!app2.beat.Store.S.playing, "pagehide → 自动停播");

  /* 跨 origin 提示：README 同时推荐「双击 index.html」与在线版，但两者 origin 不同、
     localStorage 不共享，用户看不到任何提示。预设库为空时露一次。 */
  const fresh = loadApp();
  eq(fresh.els["migHint"].hidden, false, "预设库为空 → 提示跨地址不共享预设");
  fresh.els["migHintBtn"].fire("click");
  eq(fresh.els["migHint"].hidden, true, "确认后关闭");
  ok(fresh.beat.Store.S.migHint, "确认状态记入内存");
  fresh.beat.Store.flush();
  eq(JSON.parse(fresh.storage.get("beatsight.state")).migHint, true, "确认状态已持久化（不再重复打扰）");
  const withPresets = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, customs: [{ id: "x", name: "已有", meter: 4,
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }] }) });
  eq(withPresets.els["migHint"].hidden, true, "已有预设的用户不显示该提示");
}

