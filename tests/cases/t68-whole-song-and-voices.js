/* BeatSight 自动化测试 · 整首连播 + 扫弦/节拍双声部（v2.5.0）
   T68 系列。
   ---------------------------------------------------------------------------
   两条用户反馈各对应一半：

   ① 「扫弦示例曲只在有扫弦的音符位置发声，忽略了节拍器应在每一拍都发声的本质」
      → 契约：**扫弦轨 × 带扫弦记谱的谱**下，节拍器作为独立声部**每一拍都出声**，
        扫弦声叠在扫弦记谱的位置上；两者音量各由一条滑条独立控制（节拍 S.vol / 扫弦 S.strumVol）。
      四条边界一起钉住，缺一条都会退化：
        · 空扫（rest+dir）与纯休止所处的**拍**也要有节拍音（这正是"每拍都响"的判据）；
        · 静音拍下节拍网格一起静音（不留一条只响一半的声部）；
        · 自身就落在拍上的普通音符**不得被补成双声**；
        · **不带**扫弦记谱的谱不补网格（那种谱本身就是节拍器，补了会把长音多敲出几下）。

   ② 「练习示例曲时应按原曲实际顺序依次弹奏各节奏型，而当前工具只能重复练习单一节奏型」
      → 契约：曲式模式此前**没有任何主界面出口**（只有"曲式校验失败"与"删除曲式"会退回预设），
        于是"点某个节奏型 + 按播放"播的仍是节目单，用户以为自己被困在单型循环里。
        v2.5.0 把两个入口做成对等的：点节奏型 = 单练它；点「整首连播」= 按原曲顺序练整首。
        本组断言这四条路（整首连播 / 段序条跳段 / 点预设退出 / 播放中高亮跟随）。

   ★ 元素定位：沙箱 stub 不解析 HTML，动态生成的节点只能按类名遍历取；
     且**每次点击后都要重新取**——曲式播放换型会经 applyPatternChange → buildPresetList
     重建整张列表（连带段序条），旧引用指向的是已脱离文档的节点。 */
"use strict";
const { loadApp, FakeAudioContext, drive, driveFrames, ok, eq, near, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 本组统一在扫弦轨上跑：示例曲的 7 个型全带 dir，普通轨下整组不渲染 */
const loadStrum = () => loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }));
/* ①～⑥ 不需要示例曲；⑦～⑩ 要——示例是**首次打开**才静默带出的，
   harness 默认把闩落上（"视作已带出"），所以这里显式 seedDemo:false 让它真的载入
   （与 t63 的 firstRun 同一口径） */
const loadDemo = () => loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }),
  { seedDemo: false });

/* 稀疏扫弦谱：16 格十六分里只有两记实扫（第 1、3 拍）+ 一记空扫（第 2 拍），其余**纯休止**。
   这是"扫弦谱吞掉节拍器"最极端的形状——不补节拍网格的话一小节只有 2 声，
   且有整整两拍（第 2、4 拍）一点声音都没有。
   ★ 其余格必须是 rest（不是留空字段的音符）：留空字段 = "这一格有音但不标注方向"，
     它自己就会发一声，那样测的是"每格都有音"而不是"每拍都有节拍音"。
   小节和 = 16 × 12 = 192 = 4 × TPB（不满足会被 validatePreset 静默淘汰进隔离区） */
const mkSparseStrum = () => [0,1,2,3].map(() => Array.from({ length: 16 }, (_, i) =>
  i === 0 ? { t: 12, dir: "D", zone: 0 }                        // 第 1 拍：实扫（低弦区）
  : i === 4 ? { t: 12, rest: true, dir: "D" }                    // 第 2 拍：空扫（动手不出声）
  : i === 8 ? { t: 12, dir: "U", zone: 2 }                        // 第 3 拍：实扫（高弦区）
  : { t: 12, rest: true }));                                     // 其余：纯休止
/* 对照：带 dir 但不带 zone（= 内置「民谣扫弦」的形状）——每颗音都落在拍上 */
const mkDirNoZone = () => [0,1,2,3].map(() => [
  { t: 48, dir: "D" }, { t: 48, dir: "D" }, { t: 48, dir: "U" }, { t: 48, dir: "U" },
]);
/* 对照：整小节一个全音符、无 dir 无 zone（hasStrum 为假） */
const mkWholeNote = () => [0,1,2,3].map(() => [{ t: 192 }]);

/* 把一个新的扫弦谱装进应用并起播（返回音频桩）。
   opts 里的参数在 start() **之前**写入——起播后再改 BPM 会走时钟重映射，
   首音时刻会被改写，本组的时刻断言就没法对齐了。
   注：importPresets 只落数据、不重画列表，故必须显式 refresh 一次让 appliedPat 落在新型上 */
function startWith(beat, name, bars, opts){
  const o = opts || {};
  beat.Store.importPresets(JSON.stringify({ presets: [{ name, meter: 4, bars }] }));
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  if (typeof o.bpm === "number") beat.Controls.setBpm(o.bpm);
  if (typeof o.vol === "number") beat.Store.S.vol = o.vol;
  if (typeof o.strumVol === "number") beat.Store.S.strumVol = o.strumVol;
  if (o.mute) beat.Store.S.mute = true;
  beat.Controls.start();
  return FakeAudioContext.last;
}
const clicksOf = ac => ac.hits.filter(h => h.kind === "osc");
/* 扫弦声 = 弦区三档带通噪声（与 t62/t64 同一口径） */
const strumsOf = ac => ac.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass"
  && [700, 1400, 2800].includes(h.filterFreq));
/* 只在 [a,b) 时间里发声的次数（用于"某小节静音"这类断言，比累计计数稳） */
const inWindow = (ac, a, b) => ac.hits.filter(h => h.t >= a - 1e-6 && h.t < b - 1e-6).length;

/* 示例曲分组里的三样东西。**每次现取**：点击会触发列表重建，旧引用随即失效 */
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-demo-group( |$)/.test(x.className));
const playRowOf = els => boxOf(els).children.find(x => /(^| )demo-play-row( |$)/.test(x.className));
const playAllOf = els => playRowOf(els).children[0];               // 行内第 1 个 = 按钮
const noteOf = els => playRowOf(els).children[1];                  // 行内第 2 个 = 状态说明
const secRowOf = els => boxOf(els).children.find(x => /(^| )demo-sec-row( |$)/.test(x.className));
/* 「切换节奏型」胶囊条（v2.4.1）：它挂在**一层 wrapper 里**（note + row），
   不是分组的直接子节点——所以要下一层找。段序条也是 .demo-seg-row，
   但它是直接子节点，两者靠"在谁的孩子里"区分 */
const segRowOf = els => {
  for (const ch of boxOf(els).children){
    const hit = (ch.children || []).find(c => /(^| )demo-seg-row( |$)/.test(c.className));
    if (hit) return hit;
  }
  return null;
};
const demoItemsOf = els => boxOf(els).children.filter(x => /(^| )preset-item( |$)/.test(x.className));

/* ================= 场景 T68a：扫弦轨每一拍都出节拍音 ================= */
section("T68a 双声部 · 扫弦谱下每一拍都出节拍音（含空扫与纯休止所在的拍）");
{
  const { beat } = loadStrum();
  const ac = startWith(beat, "稀疏扫弦", mkSparseStrum());
  /* 默认 96BPM → 一拍 0.625s，一小节 2.5s，首音 0.08s。
     驱动 2.2s：前瞻窗口 0.3s 只够到 2.5s 之前，所以第 2 小节的首音（2.58s）不会被排进来 */
  drive(ac, beat, 2.2);
  beat.Controls.stop();

  const clicks = clicksOf(ac);
  const strums = strumsOf(ac);
  eq(clicks.length, 4, "★ 一小节四拍各一声节拍音（此前这里只有 2 声扫弦、另两拍全静）");
  [0, 0.625, 1.25, 1.875].forEach((off, i) =>
    near(clicks[i].t, 0.08 + off, 1e-6, `第 ${i + 1} 拍节拍音落在该拍的正拍位置`));
  near(clicks[1].t, 0.08 + 0.625, 1e-6, "★ 空扫所在那一拍**有**节拍音（本次修复的核心）");
  near(clicks[3].t, 0.08 + 1.875, 1e-6, "★ 纯休止所在那一拍也有节拍音");
  /* 扫弦声照旧：只有两记实扫，且叠在对应拍的**同一时刻**上 */
  eq(strums.length, 2, "扫弦声仍是 2 声（只发在带弦区标注的实扫上）");
  eq(strums[0].filterFreq, 700, "低弦区 = 700Hz（闷）");
  eq(strums[1].filterFreq, 2800, "高弦区 = 2800Hz（亮）");
  eq(strums[0].t.toFixed(4), clicks[0].t.toFixed(4), "第 1 拍：扫弦与节拍**同时**（叠加，不是把节拍推后）");
  eq(strums[1].t.toFixed(4), clicks[2].t.toFixed(4), "第 3 拍：同上");
}

/* ================= 场景 T68b：不带扫弦记谱的谱不补网格 ================= */
section("T68b 双声部 · 无扫弦记谱的谱不补网格（长音中间的拍点不敲）");
{
  const { beat } = loadStrum();
  const ac = startWith(beat, "整小节全音符", mkWholeNote());
  drive(ac, beat, 2.2);
  beat.Controls.stop();
  eq(ac.hits.length, 1, "★ 一小节只响 1 声（若补网格会变成 4 声——那种谱本身就是节拍器）");
}

/* ================= 场景 T68c：落在拍上的音符与网格的叠/顶规则 =================
   v2.7.1 起 dir-only 的格也归扫弦声部（民谣扫弦形状）——扫弦声**不顶掉**拍点，
   拍点叠在它上面（双声部并列的设计语义）；只有**不带扫弦记谱**的普通音符
   仍顶掉自己那一拍（它自己就是这一拍的节拍音）。 */
section("T68c 双声部 · 扫弦格叠拍点 / 普通音符仍顶掉自己那一拍");
{
  /* dir-only 谱：4 颗实扫各自落在 4 个拍上 → 每拍 = 扫弦 + 拍点两声 */
  const { beat } = loadStrum();
  const ac = startWith(beat, "带方向无弦区", mkDirNoZone());
  drive(ac, beat, 2.2);
  beat.Controls.stop();
  eq(ac.hits.length, 8, "★ 一小节 8 声 = 4 扫弦 + 4 拍点（v2.7.1 前是 4 声：扫弦格顶掉了拍点）");
  eq(clicksOf(ac).length, 4, "4 声拍点网格（每一拍都出节拍音）");
  eq(strumsOf(ac).length, 4, "4 声扫弦（dir-only → 中弦区噪声）");
  [0, 0.625, 1.25, 1.875].forEach((off, i) => {
    const at = ac.hits.filter(h => Math.abs(h.t - (0.08 + off)) < 1e-6);
    eq(at.length, 2, `第 ${i + 1} 拍：扫弦与拍点**同刻叠加**（双声部并列）`);
    ok(at.some(h => h.kind === "osc") && at.some(h => h.kind === "noise"),
       `第 ${i + 1} 拍：一声节拍（osc）+ 一声扫弦（noise），不是同声部双响`);
  });

  /* 混合谱：不带扫弦记谱的普通音符仍顶掉自己那一拍（网格不补双声） */
  const { beat: b2 } = loadStrum();
  const ac2 = startWith(b2, "混合谱", [0,1,2,3].map(() => [
    { t: 48 }, { t: 48, dir: "D" }, { t: 48 }, { t: 48 },
  ]));
  drive(ac2, b2, 2.2);
  b2.Controls.stop();
  eq(ac2.hits.length, 5, "★ 混合谱 5 声 = 拍1/3/4 各 1 声（普通音符顶掉网格）+ 拍2 两声（扫弦+拍点叠加）");
  const atBeat0 = ac2.hits.filter(h => Math.abs(h.t - 0.08) < 1e-6);
  eq(atBeat0.length, 1, "★ 拍 1 只有 1 声——普通音符顶掉网格拍点（不双声）");
  eq(atBeat0[0].kind, "osc", "顶掉后留下的是节拍声部那一下");
}

/* ================= 场景 T68d：静音拍下节拍网格一起静音 ================= */
section("T68d 双声部 · 静音拍（第 4 小节）连节拍网格也不出声");
{
  const { beat } = loadStrum();
  /* 240BPM → 一小节 1s，四小节只需 4 秒 */
  const ac = startWith(beat, "稀疏扫弦", mkSparseStrum(), { bpm: 240, mute: true });
  drive(ac, beat, 4.2);
  beat.Controls.stop();
  eq(inWindow(ac, 0.08, 1.08), 6, "第 1 小节 6 声（4 节拍 + 2 扫弦）");
  eq(inWindow(ac, 1.08, 2.08), 6, "第 2 小节 6 声");
  eq(inWindow(ac, 2.08, 3.08), 6, "第 3 小节 6 声");
  eq(inWindow(ac, 3.08, 4.08), 0, "★ 第 4 小节（静音拍）零发声——节拍网格同样受静音拍门控");
}

/* ================= 场景 T68e：两条声部的音量互相独立 ================= */
section("T68e 双声部 · 节拍音量与扫弦音量互不缩放（并列，不是串联的总闸）");
{
  /* 三种配置各跑一小节，读实际送到增益节点的包络峰值。
     首音落在重拍（accents 默认 [0]）→ tier = accentGain = accentMin + (accentMax−accentMin)×accentVol = 1.0 */
  const run = (vol, strumVol) => {
    const { beat } = loadStrum();
    const ac = startWith(beat, "稀疏扫弦", mkSparseStrum(), { vol, strumVol });
    drive(ac, beat, 2.2);
    beat.Controls.stop();
    return {
      click: clicksOf(ac)[0].gain,                  // 节拍声部：振荡器增益的包络峰值
      strum: strumsOf(ac)[0].gain,                  // 扫弦声部：噪声链第二级增益的包络峰值
    };
  };
  const A = run(0.8, 1);      // 默认
  const B = run(0.8, 0.4);    // 只压扫弦
  const C = run(0.3, 1);      // 只压节拍

  near(A.click, 0.8, 1e-6, "默认：节拍峰值 = S.vol(0.8) × tier(1)");
  near(A.strum, 8, 1e-6, "默认：扫弦峰值 = S.strumVol(1) × tier(1) × makeup(8)");
  near(B.strum, 3.2, 1e-6, "★ 扫弦条拉到 40%：扫弦峰值随之 = 0.4 × 8");
  eq(B.click.toFixed(6), A.click.toFixed(6), "★ 动「扫弦」条**不影响**节拍音量");
  near(C.click, 0.3, 1e-6, "★ 节拍条拉到 30%：节拍峰值随之 = 0.3");
  eq(C.strum.toFixed(6), A.strum.toFixed(6), "★ 动「节拍」条**不影响**扫弦音量");
  /* "并列"的定义就是任一条归零只静音自己那条声部 */
  const Z = run(0, 1);
  near(Z.click, 0.0001, 1e-6, "节拍归零：节拍声部静音（走包络的静音兜底值）");
  near(Z.strum, 8, 1e-6, "★ 节拍归零时扫弦照响（若是串联的总闸，这里会是 0.0001）");
}

/* ================= 场景 T68f：S.strumVol 加载校验 / 持久化 / UI 同步 ================= */
section("T68f 双声部 · strumVol 脏值钳制 / 热键持久化 / 扫弦条随轨显隐");
{
  const val = v => loadApp(seedState({ strumVol: v })).beat.Store.S.strumVol;
  eq(val(5), 1, "脏值 5 → 钳到 1");
  eq(val(-3), 0, "脏值 -3 → 钳到 0");
  eq(val("abc"), 1, "非数值 → 回默认 1");
  eq(val(0.35), 0.35, "合法值原样保留");
  eq(loadStrum().beat.Store.S.strumVol, 1, "不写该键 → 默认 1（升级后扫弦响度逐位不变）");

  const { beat, els, storage } = loadStrum();
  els["volStrum"].value = "40";
  els["volStrum"].fire("input");
  eq(beat.Store.S.strumVol, 0.4, "拖动即生效（input 事件写入 S）");
  eq(els["volStrumPct"].textContent, "40%", "百分比读数同步");
  els["volStrum"].fire("change");
  beat.Store.flush();                 // 热键写入是 250ms 防抖的，断言落盘内容前必须显式冲刷
  ok(String(storage.get("beatsight.state")).indexOf('"strumVol":0.4') >= 0,
     "★ 松手落盘到热键 beatsight.state（下次打开接着用）");

  /* 扫弦条只在扫弦轨出现：普通轨没有任何扫弦声可调 */
  eq(els["volStrumRow"].hidden, false, "扫弦轨：扫弦条可见");
  beat.Tracks.set("plain");
  eq(els["volStrumRow"].hidden, true, "★ 普通轨：扫弦条收起");
  beat.Tracks.set("strum");
  eq(els["volStrumRow"].hidden, false, "切回扫弦轨又出现");
}

/* ================= 场景 T68g：整首连播入口 ================= */
section("T68g 整首连播 · 一键切曲式模式 + 范围=整首 + 开循环 + 起播");
{
  const { beat, els } = loadDemo();
  ok(!!boxOf(els), "前提：示例曲分组已渲染");
  eq(beat.Store.S.playMode, "preset", "前提：初始是预设模式（单型循环）");
  eq(beat.Store.S.playing, false, "前提：初始未播放");

  playAllOf(els).fire("click");
  eq(beat.Store.S.playMode, "arrange", "★ 点「整首连播」切到曲式模式");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 0, to: 9, loop: true, byLyric: false }),
     "★ 范围 = 整首 10 段 + 开范围循环（放完自动从头再来，这才叫「练」）");
  eq(beat.Store.S.playing, true, "★ 一键即开播，不必先进编排面板");
  eq(beat.Arrange.isOpen(), false, "整首连播不需要打开编排 overlay（入口就在侧栏）");
  /* 元素重新取：起播会经 applyPatternChange → buildPresetList 重建整张列表 */
  eq(playAllOf(els).getAttribute("aria-pressed"), "true", "按钮进入高亮态");
  eq(secRowOf(els).children[0].getAttribute("aria-pressed"), "true", "段序条高亮第 1 段");
  eq(secRowOf(els).children[9].getAttribute("aria-pressed"), "false", "第 10 段未高亮");
  ok(noteOf(els).textContent.includes("第 1/10 段"),
     "状态说明给出「整首连播中 · 第 1/10 段」（实际「" + noteOf(els).textContent + "」）");
  /* 播的确实是第 1 段引用的型（不是"只会放当前选中的那个"） */
  ok(String(beat.activePattern().name).indexOf("节奏型1") >= 0,
     "★ 起播用第 1 段引用的型（实际「" + beat.activePattern().name + "」）");
  beat.Controls.stop();
}

/* ================= 场景 T68h：段序条跳段 ================= */
section("T68h 整首连播 · 点段序条第 N 段 = 只循环那一段");
{
  const { beat, els } = loadDemo();
  secRowOf(els).children[4].fire("click");
  eq(beat.Store.S.playMode, "arrange", "点段号即进入曲式模式（否则 jumpTo 读不到可跳的曲式）");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 4, to: 4, loop: true, byLyric: false }),
     "★ 范围收成 [第 5 段, 第 5 段] + 循环 = 只磨这一段");
  eq(beat.Store.S.playing, false, "定位不等于起播（用户按播放键才开始）");
  const row = secRowOf(els);
  eq(row.children[4].getAttribute("aria-pressed"), "true", "第 5 段高亮");
  eq(row.children[0].getAttribute("aria-pressed"), "false", "第 1 段取消高亮");
  /* 停止态定位必须把网格换成那一段的型（否则只有字变、画面原地不动） */
  ok(String(beat.activePattern().name).indexOf("节奏型3") >= 0,
     "★ 停止时定位：生效的型已换成第 5 段引用的那个（实际「" + beat.activePattern().name + "」）");
}

/* ================= 场景 T68i：点预设回到单型练习（曲式模式必须有主界面出口） ================= */
section("T68i 整首连播 · 点侧栏节奏型即退回单练它（曲式模式的主界面出口）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  eq(beat.Store.S.playMode, "arrange", "前提：已在整首连播中");

  const target = demoItemsOf(els).find(it => it.children[0].children[0].textContent === "节奏型 2");
  ok(!!target, "前提：示例组里有「节奏型 2」条目");
  target.fire("click");
  eq(beat.Store.S.playMode, "preset", "★ 点节奏型 → 退回预设模式（单练它）");
  eq(beat.Store.S.sel.type, "custom", "选中的就是这个自定义型");
  ok(String(beat.activePattern().name).indexOf("节奏型2") >= 0,
     "★ 生效的型跟着换成它（实际「" + beat.activePattern().name + "」）");
  eq(beat.Store.S.arrangeSel.loop, false, "退回单型后清掉曲式的范围循环（免得下次突然生效）");
  eq(els["loopPanel"].hidden, false, "练习循环面板重新露出（它在曲式模式下是收起的）");
  beat.Controls.stop();
}

/* ================= 场景 T68k：侧栏「切换节奏型」胶囊条（v2.4.1 的真实点击路径） ================= */
section("T68k 整首连播 · 侧栏把当前段换成另一个型（applyDemoSeg 真实点击路径）");
{
  const { beat, els } = loadDemo();
  /* 先跳段 → S.arrangeSel.id 指向示例曲，切换胶囊条才会渲染出来。
     挑第 5 段（主歌一 · 那年你踏上，当前用「节奏型 3」）——它本来就不是节奏型 2，
     点「节奏型 2」才验得出"真的换过去了"（若本来就用它，点完看不出任何变化） */
  secRowOf(els).children[4].fire("click");
  const segRow = segRowOf(els);
  ok(!!segRow, "前提：切换节奏型胶囊条已渲染（只在编排示例曲时出现）");
  eq(segRow.children.length, 5, "5 个示例型各一颗胶囊");

  const secIdx = 4;
  const ar0 = beat.Store.findArrange(beat.DEMO_ID);
  const before = ar0.sections[secIdx].blocks[0].ref.id;
  const beforeName = beat.Store.customs.find(c => c.id === before).name;
  ok(!String(beforeName).includes("节奏型2"), "前提：第 5 段本来用的不是节奏型 2（实际「" + beforeName + "」）");
  segRow.children[1].fire("click");

  const ar1 = beat.Store.findArrange(beat.DEMO_ID);
  const after = ar1.sections[secIdx].blocks[0].ref.id;
  ok(after !== before, "★ 该段的块引用真的换掉了（不是只改了 UI）");
  ok(String(beat.Store.customs.find(c => c.id === after).name).includes("节奏型2"),
     "★ 换成的正是被点的那一颗（实际「" + beat.Store.customs.find(c => c.id === after).name + "」）");
  eq(ar1.sections[secIdx].blocks[0].repeats, ar0.sections[secIdx].blocks[0].repeats,
     "只换型、不动遍数");
  eq(ar1.sections[0].blocks[0].ref.id, ar0.sections[0].blocks[0].ref.id, "别的段不受影响");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: secIdx, to: secIdx, loop: false, byLyric: false }),
     "范围收窄到该段（免得改了这一段、播放却走到别的段）");
}
section("T68j 整首连播 · 段序条高亮随播放推进（不是钉在第 1 段）");
{
  const { beat, els } = loadDemo();
  /* 240BPM → 一小节 1s；**第 1 段 = 1 小节**（v2.6.0 起是逐小节谱，不再垫到 4 小节）= 1s。
     v2.7.1 起段序条高亮跟**可听位置**（onAudibleBar 由渲染帧驱动），
     所以这里必须用 driveFrames（scheduler + paintFrame 双时钟）而不是只跑调度 */
  beat.Controls.setBpm(240);
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  ok(noteOf(els).textContent.includes("第 1/10"),
     "起播时指向第 1 段（实际「" + noteOf(els).textContent + "」）");
  driveFrames(ac, beat, 1.4);
  const row = secRowOf(els);
  eq(row.children[1].getAttribute("aria-pressed"), "true",
     "★ 走完第 1 段后高亮移到第 2 段（跟着节目单推进，不是钉在第 1 段）");
  eq(row.children[0].getAttribute("aria-pressed"), "false", "第 1 段取消高亮");
  ok(noteOf(els).textContent.includes("第 2/10 段"),
     "★ 状态说明同步推进（实际「" + noteOf(els).textContent + "」）");
  beat.Controls.stop();
  /* 停机后回到"范围起点"口径（停止时看的不是调度游标——它不表达"下次从哪开始"） */
  eq(secRowOf(els).children[0].getAttribute("aria-pressed"), "true",
     "★ 停机后高亮回到播放范围起点（第 1 段），不是停在刚播完那一段");
}
