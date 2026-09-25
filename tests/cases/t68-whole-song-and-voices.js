/* BeatSight 自动化测试 · 整首连播 + 扫弦/节拍双声部（v2.5.0）
   T68 系列。
   ---------------------------------------------------------------------------
   两条用户反馈各对应一半：

   ① 「扫弦示例曲只在有扫弦的音符位置发声，忽略了节拍器应在每一拍都发声的本质」
      → 契约：**带扫弦记谱的谱**下，节拍器作为独立声部**每一拍都出声**，
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
const { loadApp, FakeAudioContext, drive, driveFrames, ok, eq, near, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 本组统一从同一个内置型（四分基础）起跑：双声部判据只看**谱的内容**（hasStrum），
   与"当前在哪条轨"无关——两态轨模型已在 v2.9.0 删除 */
const loadStrum = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
/* ①～⑥ 不需要示例曲；⑦～⑩ 要——示例是**首次打开**才静默带出的，
   harness 默认把闩落上（"视作已带出"），所以这里显式 seedDemo:false 让它真的载入
   （与 t63 的 firstRun 同一口径） */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }),
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
/* 扫弦声 = 弦区三档带通噪声（与 t62 同一口径） */
const strumsOf = ac => ac.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass"
  && [700, 2800].includes(h.filterFreq));
/* 只在 [a,b) 时间里发声的次数（用于"某小节静音"这类断言，比累计计数稳） */
const inWindow = (ac, a, b) => ac.hits.filter(h => h.t >= a - 1e-6 && h.t < b - 1e-6).length;

/* 曲式分组（v2.9.0 起类名 = .preset-arrange-group；旧名 .preset-demo-group 已删）。
   **每次现取**：点击会触发列表重建，旧引用随即失效 */
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const playRowOf = els => boxOf(els).children.find(x => /(^| )demo-play-row( |$)/.test(x.className));
/* v2.28.0：「整首连播」按钮已删（条目点击 = 同一 playArrange 出口），本助手改为
   点示例曲条目——语义一位不差，交互路径换成产品里唯一剩下的那个入口 */
/* 曲式条目挂在**曲式分组容器**里（v2.25.0 起不是 presetList 的直接子节点），从 boxOf 里找 */
const playAllOf = els => boxOf(els).children.find(x =>
  /(^| )preset-item( |$)/.test(x.className) && x.children[0].children[0].textContent === "在他乡（示例）");
const noteOf = els => playRowOf(els).children[0];                  // 行内唯一子节点 = 状态说明
/* 「播放范围」双滑块（v2.10.4 取代原段序条那 10 颗段号胶囊）。
   结构：.demo-range > [.demo-range-note, .demo-range-track]，轨道里 = 填充条 + 起点 + 终点。
   测试桩不解析 HTML，只能按 children 序位取，所以这几个 helper 与 buildDemoSongRow 的
   挂法是一对——改挂法就要同步改这里。**每次现取**：点击会触发列表重建，旧引用随即失效 */
const rangeOf = els => boxOf(els).children.find(x => /(^| )demo-range( |$)/.test(x.className));
const rangeTrackOf = els => rangeOf(els).children[1];
const rangeFromOf = els => rangeTrackOf(els).children[1];
const rangeToOf = els => rangeTrackOf(els).children[2];
/* 拖一次滑块 = 走完 input（拖动中，只刷视觉）+ change（松手提交，跑重活并通知 Arrange）两级。
   真实浏览器就是这么发的顺序；**只发 input 不会应用范围**（见 Presets.makeRangeInput 注释） */
const dragRange = (els, from, to) => {
  const f = rangeFromOf(els), t = rangeToOf(els);
  f.value = String(from); t.value = String(to);
  f.fire("input"); t.fire("input");
  f.fire("change"); t.fire("change");
};
/* 全列表按**显示名**取条目（v2.9.0 示例型已并入扫弦区，不再挂在曲式分组里）。
   条目是 presetList 的直接子节点（夹在分区标题之间），显示名 = item.children[0].children[0] */
const itemByName = (els, name) => els["presetList"].children.find(x =>
  /(^| )preset-item( |$)/.test(x.className) && x.children[0].children[0].textContent === name);

/* ================= 场景 T68a：扫弦谱每一拍都出节拍音 ================= */
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
  eq(ac.hits.length, 12, "★ 一小节 12 声 = 4 扫弦 × 全扫双频段(8) + 4 拍点（v2.7.1 前是 4 声：扫弦格顶掉了拍点）");
  eq(clicksOf(ac).length, 4, "4 声拍点网格（每一拍都出节拍音）");
  eq(strumsOf(ac).length, 8, "8 声扫弦（dir-only → 全扫：低+高双频段成对，v2.29.0）");
  [0, 0.625, 1.25, 1.875].forEach((off, i) => {
    const at = ac.hits.filter(h => Math.abs(h.t - (0.08 + off)) < 1e-6);
    eq(at.length, 3, `第 ${i + 1} 拍：扫弦双频段与拍点**同刻叠加**（三声并列）`);
    ok(at.some(h => h.kind === "osc") && at.filter(h => h.kind === "noise").length === 2,
       `第 ${i + 1} 拍：一声节拍（osc）+ 两声扫弦（noise 低+高），不是同声部多响`);
  });

  /* 混合谱：不带扫弦记谱的普通音符仍顶掉自己那一拍（网格不补双声） */
  const { beat: b2 } = loadStrum();
  const ac2 = startWith(b2, "混合谱", [0,1,2,3].map(() => [
    { t: 48 }, { t: 48, dir: "D" }, { t: 48 }, { t: 48 },
  ]));
  drive(ac2, b2, 2.2);
  b2.Controls.stop();
  eq(ac2.hits.length, 6, "★ 混合谱 6 声 = 拍1/3/4 各 1 声（普通音符顶掉网格）+ 拍2 三声（全扫双频段 + 拍点叠加，v2.29.0）");
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
section("T68f 双声部 · strumVol 脏值钳制 / 热键持久化 / 扫弦条常显（标记）");
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

  /* v2.9.0：扫弦条改为**常显**（判据从"当前在哪条轨"变成"当前型是否带扫弦记谱"）。
     轨模型已删，生产代码不再按 id 读写 #volStrumRow，它的可见性已退化成**纯标记**——
     用 stub 断言等于在断言 stub 自己，只能查 index.html 原文（与 t24/t55 同一口径）。 */
  const volStrumTag = (html.match(/<[^>]*id="volStrumRow"[^>]*>/) || [""])[0];
  ok(volStrumTag && !/\bhidden\b/.test(volStrumTag),
     "★ 扫弦音量条在标记里常显（不带 hidden；轨模型删除后不再随轨收起）");
}

/* ================= 场景 T68g：整首连播入口 ================= */
section("T68g 整首连播 · 一键切曲式模式 + 范围=整首 + 开循环 + 起播");
{
  const { beat, els } = loadDemo();
  ok(!!boxOf(els), "前提：示例曲分组已渲染");
  /* ★ v2.13.0：首次打开**默认选中**示例曲，所以这里的起点不再是"预设模式、什么都没选"，
     而是"曲式模式 + 范围=整首 + **没在播**"。这一节原本的"前提：初始是预设模式"因此改写——
     顺便把它变成新默认值的钉子（比原来那条前提更有信息量）。 */
  eq(beat.Store.S.playMode, "arrange", "★ 前提（v2.13.0）：首次打开默认选中示例曲 = 已在曲式模式");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 0, to: 29, loop: false, byLyric: false }),
     "★ 且默认范围就是整首 30 小节，**不开循环**（「为你选好了」≠「开始整首连播」）");
  eq(beat.Store.S.playing, false, "★ 前提：初始未播放（**选中不等于起播**——这是首开默认的硬约束）");

  playAllOf(els).fire("click");
  eq(beat.Store.S.playMode, "arrange", "★ 点「整首连播」切到曲式模式");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 0, to: 29, loop: true, byLyric: false }),
     "★ 范围 = 整首 30 小节 + 开范围循环（放完自动从头再来，这才叫「练」；v2.10.7 小节口径）");
  eq(beat.Store.S.playing, true, "★ 一键即开播，不必先进编排面板");
  eq(beat.Arrange.isOpen(), false, "整首连播不需要打开编排 overlay（入口就在侧栏）");
  /* 元素重新取：起播会经 applyPatternChange → buildPresetList 重建整张列表 */
  ok(noteOf(els).textContent.indexOf("整首连播 · 播放中") === 0,
    "★ 读数行接棒状态指示（按钮删了，whole 的呈现面只剩它；实际「" + noteOf(els).textContent + "」）");
  /* v2.10.4：段序条已换成范围滑块——"整首连播"在滑块上的表现 = **两个 thumb 拉满**。
     滑块表达的是范围、不是当前位置，所以原来"第 1 段高亮 / 第 10 段不高亮"那两条
     已随段序条一并消失；"现在在第几小节"改由下面那条状态说明承担 */
  eq(rangeFromOf(els).value, "1", "滑块起点拉满到第 1 小节");
  eq(rangeToOf(els).value, "30", "滑块终点拉满到第 30 小节（v2.10.7：max = 总小节数）");
  ok(noteOf(els).textContent.includes("第 1/30 小节"),
     "状态说明给出「播放中 · 第 1/30 小节」（位置读数从段序条高亮挪到了这一行）（实际「" + noteOf(els).textContent + "」）");
  /* 播的确实是第 1 段引用的型（不是"只会放当前选中的那个"）。v2.9.0：段 1 = P1 = 十六分满扫（《在他乡》前奏） */
  ok(String(beat.activePattern().name).indexOf("十六分满扫（《在他乡》前奏）") >= 0,
     "★ 起播用第 1 段引用的型（实际「" + beat.activePattern().name + "」）");
  beat.Controls.stop();
}

/* ================= 场景 T68h：滑块把范围拖到重合 = 只循环那一段 ================= */
section("T68h 整首连播 · 拖范围滑块到重合 = 只循环那一段");
{
  const { beat, els } = loadDemo();
  /* v2.10.4：原来是点段序条第 5 颗胶囊，现在把两个 thumb 拖到重合。
     v2.10.7 小节口径：滑块值 5 = 0-based 小节 4 = 段 2（副歌，4 小节）的首小节——
     控件换过（v2.10.4）、单位换过（v2.10.7），「重合 = 只磨这一小节」的语义一位都不该动 */
  dragRange(els, 5, 5);
  eq(beat.Store.S.playMode, "arrange", "拖滑块即进入曲式模式（否则 setRange 读不到可跳的曲式）");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 4, to: 4, loop: true, byLyric: false }),
     "★ 范围收成 [第 5 小节, 第 5 小节] + 循环 = 只磨这一小节（v2.10.7：重合 = 单小节循环）");
  eq(beat.Store.S.playing, false, "定位不等于起播（用户按播放键才开始）");
  eq(rangeFromOf(els).value, "5", "起点 thumb 落在第 5 小节");
  eq(rangeToOf(els).value, "5", "终点 thumb 也落在第 5 小节（重合态）");
  /* v2.10.14：原 argNowMeta「第 5 小节」即时反馈断言随说明文字删除退役——
     可见反馈 = thumb 即时移动（上面两条）+ 生效型即时切换（下面一条） */
  /* 停止态定位必须把网格换成那一段的型（否则只有字变、画面原地不动）。
     小节 5 落在段 2（副歌）→ 生效型 = 段 2 引用的「下上扫 · 密（《在他乡》副歌）」（v2.19.1 旧名「副歌扫弦」） */
  ok(String(beat.activePattern().name).indexOf("下上扫 · 密（《在他乡》副歌）") >= 0,
     "★ 停止时定位：生效的型已换成第 5 小节所在段引用的那个（实际「" + beat.activePattern().name + "」）");
}

/* ================= 场景 T68i：点预设回到单型练习（曲式模式必须有主界面出口） ================= */
section("T68i 整首连播 · 点侧栏节奏型即退回单练它（曲式模式的主界面出口）");
{
  const { beat, els } = loadDemo();
  playAllOf(els).fire("click");
  eq(beat.Store.S.playMode, "arrange", "前提：已在整首连播中");

  const target = itemByName(els, "下上扫 · 密（《在他乡》副歌）");
  ok(!!target, "前提：扫弦区里有「下上扫 · 密（《在他乡》副歌）」条目（v2.9.0 示例 5 型并入扫弦区；v2.19.1 改特征名）");
  target.fire("click");
  eq(beat.Store.S.playMode, "preset", "★ 点节奏型 → 退回预设模式（单练它）");
  eq(beat.Store.S.sel.type, "builtin", "选中的是内置型（v2.20.0 起示例 5 型住 BUILTINS 尾部）");
  ok(String(beat.activePattern().name).indexOf("下上扫 · 密（《在他乡》副歌）") >= 0,
     "★ 生效的型跟着换成它（实际「" + beat.activePattern().name + "」）");
  eq(beat.Store.S.arrangeSel.loop, false, "退回单型后清掉曲式的范围循环（免得下次突然生效）");
  eq(els["loopPanel"].hidden, false, "练习循环面板重新露出（它在曲式模式下是收起的）");
  beat.Controls.stop();
}

/* ================= 场景 T68k / T68l：随「切换节奏型」胶囊条一并删除（v2.10.4） =================
   这两条测的是 v2.4.1 加、v2.8.26 修的那个侧栏「切换节奏型」胶囊条
   （buildDemoSegRow / applyDemoSeg）。v2.10.4 该控件**整体删除**，两条用例因此失去被测对象。
   ★ 为什么删控件（用户确认）：它的候选就是示例曲那 5 个型，而它们已按内容落在「扫弦」区
     （v2.9.0 起按 hasStrum 分区），等于同一份清单在同一张侧栏里出现两次；
     且 applyDemoSeg 收尾会把 S.arrangeSel 收窄成 from === to，与新增的范围滑块语义相冲
     （拖好的范围会被一次换型清掉）。
   ★ "换本段用哪个型"的出口仍然存在：进「编排曲式」→ 该段行 → 换型（那里本来就有内联候选行）。
   ★ 这里**不是**把断言改宽蒙过去，而是被测功能本身不存在了——所以整段移除，不留空壳。 */
section("T68j 整首连播 · 位置读数随播放推进（段序条已换成范围滑块）");
{
  const { beat, els } = loadDemo();
  /* 240BPM → 一小节 1s；**第 1 段 = 1 小节**（v2.6.0 起是逐小节谱，不再垫到 4 小节）= 1s。
     v2.7.1 起"现在播到第几小节"跟**可听位置**（demoCurBar → Viz.audibleArrangePos，由渲染帧驱动；v2.10.7 由段号口径改为线性小节号），
     所以这里必须用 driveFrames（scheduler + paintFrame 双时钟）而不是只跑调度。
     ★ v2.10.4：段序条的逐段高亮没有了（滑块表达的是**范围**，不是当前位置），
       位置信息只剩 .demo-play-note 这一行——它成了本条唯一可断言的载体。 */
  beat.Controls.setBpm(240);
  playAllOf(els).fire("click");
  const ac = FakeAudioContext.last;
  ok(noteOf(els).textContent.includes("第 1/30 小节"),
     "起播时指向第 1 小节（实际「" + noteOf(els).textContent + "」）");
  driveFrames(ac, beat, 1.4);
  ok(noteOf(els).textContent.includes("第 2/30 小节"),
     "★ 走完第 1 小节后读数移到第 2 小节（跟着节目单推进，不是钉在第 1 小节）（实际「" + noteOf(els).textContent + "」）");
  /* 滑块表达的是**范围**而不是位置：整首连播期间它必须稳定停在 1–30，不随播放跳动
     （"滑块自己会走"是这类控件最常见的实现错误，钉住它） */
  eq(rangeFromOf(els).value, "1", "整首连播期间起点停在 1（滑块不跟播放位置走）");
  eq(rangeToOf(els).value, "30", "整首连播期间终点停在 30");
  beat.Controls.stop();
  /* 停机后回到"范围起点"口径（停止时看的不是调度游标——它不表达"下次从哪开始"）：
     范围没变，仍是从头；但读数不再写「播放中」 */
  ok(!/播放中/.test(noteOf(els).textContent),
     "★ 停机后读数不再写「播放中」（实际「" + noteOf(els).textContent + "」）");
  eq(rangeFromOf(els).value, "1", "停机后起点仍在范围起点");
}
