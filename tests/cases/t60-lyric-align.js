/* BeatSight 自动化测试 · F1 歌词对齐轨（v2.1.0）
   T60 系列。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html 内注释同源，改实现时两边一起动）：
     · 一行歌词 = { arrangeId, sec, chars:[{t, dur, ch}] }，身份 = (曲式id, 段下标)；
     · char.t 是**段内绝对 tick**（段首 = 0），dur 必为 LYRIC_GRID(12) 整数倍；
     · Store 只做结构校验（吸附/排序/重叠/上限），越界剔除在 lyricCharsAt 且**不写回**；
     · 锚点提示音 = wood 音色的带通噪声（bandpass / freqAccent / q / makeup），在小节起点
       一次排完，cueBarT 幂等护栏防 25ms 轮询重排；
     · 编排轨行内结构：.arg-sec → [段号, 段名, 块, 操作, 歌词]，
       歌词行内部 → [cue 开关, 粘贴框, 清除, 字块轨, 提示]。
   基准段落：BUILTINS[1]（四分基础，4/4）× 1 遍 = 4 小节 = 4×4×48 = 768 tick。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const SPAN = 4 * 4 * 48;                       // 768：1 块 1 遍的段长（tick）
const seedArr = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t1", name: "歌词曲", sections: [{ name: "主歌", blocks: [BL(1, 1)] }] },
]}) });
const seedState = extra => JSON.stringify(Object.assign(
  { v: 3, bpm: 240, playMode: "arrange", arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }, extra));

/* console.warn 暂捕：沙箱与宿主共用同一个 console 对象；测试同步执行，用完即还 */
const captureWarn = () => {
  const list = [], orig = console.warn;
  console.warn = (...a) => list.push(a.map(String).join(" "));
  return { list, restore(){ console.warn = orig; } };
};

/* ================= 场景 T60a：Store 歌词 CRUD 与归一化 ================= */
section("T60a 歌词数据层 · upsert/find/delete + 吸附/重叠/截断/上限");
{
  const { beat, storage } = loadApp();
  const St = beat.Store;
  eq(St.lyrics.length, 0, "初始无歌词行");

  /* 写入即归一化：t/dur 吸附到 12tick 格、ch trim */
  const v = St.upsertLyric("a1", 0, [{ t: 26, dur: 30, ch: " 你 " }]);
  eq(v.chars[0].t, 24, "t=26 吸附到十六分格 24");
  eq(v.chars[0].dur, 36, "dur=30 吸附到 36（12 的整数倍）");
  eq(v.chars[0].ch, "你", "ch 被 trim");
  ok(St.findLyric("a1", 0) === v, "findLyric 按 (曲式, 段) 命中且是同一行对象");
  eq(St.findLyric("a1", 1), null, "段下标不同不命中");
  eq(St.findLyric("zz", 0), null, "曲式 id 不同不命中");

  /* 落盘形状 {v:1, lines}，存的是归一化后的值 */
  const disk = JSON.parse(storage.get("beatsight.lyrics"));
  eq(disk.v, 1, "冷键带版本号");
  eq(disk.lines.length, 1, "落盘一行");
  eq(disk.lines[0].chars[0].t, 24, "落盘的是归一化后的值");

  /* 同键再写 = 替换（换行对象），不是追加 */
  const v2 = St.upsertLyric("a1", 0, [{ t: 0, dur: 24, ch: "好" }]);
  eq(St.lyrics.length, 1, "同 (arrangeId, sec) 再写不新增行");
  ok(St.findLyric("a1", 0) === v2 && v2 !== v, "★ 替换会换掉行对象（lyricFit 缓存失效机制依赖这一点）");

  St.upsertLyric("a1", 1, [{ t: 0, dur: 24, ch: "另段" }]);
  eq(St.lyrics.length, 2, "同一曲式的不同段各挂一行");
  eq(St.deleteLyric("a1", 1), true, "删除存在的行返回 true");
  eq(St.deleteLyric("a1", 1), false, "再删返回 false");
  eq(St.lyrics.length, 1, "删除只动目标行");

  /* 结构不合法 → null，且不落盘 */
  eq(St.upsertLyric("", 0, [{ t: 0, ch: "x" }]), null, "空 arrangeId 拒绝");
  eq(St.upsertLyric("a1", -1, [{ t: 0, ch: "x" }]), null, "负段下标拒绝");
  eq(St.upsertLyric("a1", 0, []), null, "空字表拒绝");
  eq(St.upsertLyric("a1", 0, [{ t: 0, ch: "   " }]), null, "全是空字 → 整行不存");
  eq(St.lyrics.length, 1, "非法写入不进内存");
  eq(JSON.parse(storage.get("beatsight.lyrics")).lines.length, 1, "非法写入不落盘");

  /* 乱序先排序；重叠丢靠后的字；空字丢弃；坏字计数进 warn（不整行丢） */
  const cap = captureWarn();
  const v3 = St.upsertLyric("a2", 0, [
    { t: 48, dur: 24, ch: "b" },
    { t: 0, dur: 48, ch: "a" },
    { t: 60, dur: 24, ch: "c" },        // 落在 b 的时值 [48,72) 里 → 丢
    { t: 96, dur: 24, ch: "" },         // 空字 → 丢
  ]);
  cap.restore();
  eq(v3.chars.map(c => c.ch).join(""), "ab", "★ 乱序输入先排序；重叠/空字被跳过");
  eq(v3.chars[1].t, 48, "b 保住自己的起点（a 占 [0,48)，t=48 不算重叠）");
  ok(cap.list.some(s => s.includes("跳过 2 个坏字")), "坏字计数写进 Console 警告");

  /* dur 缺省/下限/上限；ch 截断到 lyricMaxChLen */
  const v4 = St.upsertLyric("a3", 0, [
    { t: 0, ch: "x" },                            // 无 dur → 基准时值
    { t: 48, dur: 0, ch: "y" },                   // → 最短时值
    { t: 96, dur: 999999, ch: "z" },              // → 上限（时值占 [96, 96+6144)）
    { t: 96 + 6144, dur: 24, ch: "ABCDEFGHI" },   // 9 字 → 截 8
  ]);
  eq(v4.chars[0].dur, beat.LYRIC_BASE, "缺省 dur = 基准单位（八分）");
  eq(v4.chars[1].dur, beat.LYRIC_MIN_DUR, "dur 钳到下限（1 格）");
  eq(v4.chars[2].dur, beat.CONFIG.lyricMaxDur, "dur 钳到上限");
  eq(v4.chars[3].ch, "ABCDEFGH", "ch 截到 lyricMaxChLen = 8");

  /* 行级上限：chars 超 lyricMaxChars 整行拒绝 */
  const big = Array.from({ length: beat.CONFIG.lyricMaxChars + 1 }, (_, k) => ({ t: k * 24, dur: 24, ch: "x" }));
  eq(St.upsertLyric("a4", 0, big), null, "★ 单行超 " + beat.CONFIG.lyricMaxChars + " 字 → 整行拒绝");
}

/* ================= 场景 T60b：加载归一化（脏行丢弃 / 同键去重 / 行数上限） ================= */
section("T60b 歌词加载 · 坏行丢弃 + 同 (曲式,段) 去重 + 行数上限");
{
  const cap = captureWarn();
  const { beat } = loadApp({ "beatsight.lyrics": JSON.stringify({ v: 1, lines: [
    { arrangeId: "g", sec: 0, chars: [{ t: 13, dur: 25, ch: "x" }] },   // 好行（t/dur 会吸附）
    { arrangeId: "g", sec: 0, chars: [{ t: 0, dur: 24, ch: "dup" }] },  // 同键 → 丢
    { sec: 0, chars: [{ t: 0, dur: 24, ch: "noId" }] },                 // 缺 arrangeId → 丢
    { arrangeId: "b2", sec: 0, chars: "nope" },                         // chars 非数组 → 丢
    { arrangeId: "b3", sec: -1, chars: [{ t: 0, dur: 24, ch: "y" }] },  // 负段 → 丢
  ]}) });
  cap.restore();
  eq(beat.Store.lyrics.length, 1, "只留第一条同键行，坏行全丢");
  eq(beat.Store.lyrics[0].chars[0].t, 12, "加载路径同样吸附（13 → 12）");
  eq(beat.Store.lyrics[0].chars[0].dur, 24, "dur 25 → 24");
  ok(cap.list.some(s => s.includes("4 条歌词行未通过结构校验")), "★ 丢弃计数写进警告（含同键重复）");

  /* 行数上限 lyricMaxLines：超出的丢弃并记警告 */
  const cap2 = captureWarn();
  const many = { v: 1, lines: Array.from({ length: 260 }, (_, k) =>
    ({ arrangeId: "m" + k, sec: 0, chars: [{ t: 0, dur: 24, ch: "x" }] })) };
  const app2 = loadApp({ "beatsight.lyrics": JSON.stringify(many) });
  cap2.restore();
  eq(app2.beat.Store.lyrics.length, app2.beat.CONFIG.lyricMaxLines, "★ 行数钳到 lyricMaxLines");
  ok(cap2.list.some(s => s.includes("未通过结构校验，已丢弃")), "超出行数同样记警告");
}

/* ================= 场景 T60c：段内解析 lyricSpanTicks / lyricCharsAt ================= */
section("T60c 段内解析 · 段落 tick 长度 / 越界剔除不写回 / 行身份缓存");
{
  const { beat } = loadApp(seedArr());
  eq(beat.lyricSpanTicks("t1", 0), SPAN, "1 块 1 遍 ×4 小节 ×4 拍 ×48 = 768 tick");
  eq(beat.lyricSpanTicks("t1", 9), 0, "段下标越界 → 0");
  eq(beat.lyricSpanTicks("zz", 0), 0, "曲式不存在 → 0");
  eq(beat.lyricCharsAt("t1", 0).length, 0, "无歌词行 → 空表（LYRIC_NONE）");

  /* 越界字剔除（结构合法但超出段长），且**不写回** Store */
  beat.Store.upsertLyric("t1", 0, [
    { t: 0, dur: 24, ch: "在" },
    { t: SPAN, dur: 24, ch: "界" },          // t = 段长 → 越界（定义域 [0, span)）
    { t: SPAN + 240, dur: 24, ch: "外" },
  ]);
  const cap = captureWarn();
  const r1 = beat.lyricCharsAt("t1", 0);
  cap.restore();
  eq(r1.length, 1, "★ 越界字被剔除（界/外 对渲染与发声不可见）");
  ok(cap.list.some(s => s.includes("2 个字超出段落范围")), "剔除记 Console 警告");
  eq(beat.Store.findLyric("t1", 0).chars.length, 3, "★ 剔除不写回——段落日后加长，录入还在");

  ok(beat.lyricCharsAt("t1", 0) === r1, "同一行对象命中缓存（返回同一份结果）");
  beat.Store.upsertLyric("t1", 0, [{ t: 0, dur: 24, ch: "换" }, { t: 24, dur: 24, ch: "行" }]);
  const r3 = beat.lyricCharsAt("t1", 0);
  ok(r3 !== r1 && r3.length === 2, "★ upsert 换掉行对象 → 缓存自然失效（无需显式清理）");

  /* span 解析不出（块引用已死）→ 不过滤，原样返回（坏引用由 arrangeProblems 出口报告） */
  const app2 = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t9", name: "死引用", sections: [{ name: "s", blocks: [{ ref: { type: "custom", id: "ghost" }, repeats: 1 }] }] },
  ]}) });
  app2.beat.Store.upsertLyric("t9", 0, [{ t: 0, dur: 24, ch: "a" }, { t: 99996, dur: 24, ch: "b" }]);
  eq(app2.beat.lyricSpanTicks("t9", 0), 0, "块引用不存在 → span 0");
  eq(app2.beat.lyricCharsAt("t9", 0).length, 2, "★ span 不可知时不过滤（不把数据误判死）");
}

/* ================= 场景 T60d：渲染层 buildLyricLane / paintLyric ================= */
section("T60d 歌词轨渲染 · 建轨几何 / 走带线 / 字态切换 / 收起不变量");
{
  const { beat, els } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  beat.Store.upsertLyric("t1", 0, [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },       // 第 2 小节起点（192 = 4 拍 × 48）
    { t: 240, dur: 48, ch: "世" },       // 延音字：时值 2 倍基准
  ]);
  beat.Viz.buildLyricLane();
  const lane = els["lyricLane"];
  eq(lane.hidden, false, "曲式模式 + 有歌词行 → 轨道展开");
  const chips = lane.children.filter(c => /(^| )lyric-chip/.test(c.className));
  eq(chips.length, 3, "三个字块");
  eq(chips[0].style.left, "0%", "字块 0 左偏移 = 0/768");
  eq(chips[0].style.width, "3.125%", "字块宽 = dur/span（24/768）");
  eq(chips[1].style.left, "25%", "字块 1 左 = 192/768");
  eq(chips[2].style.width, "6.25%", "延音字宽 = 48/768");
  eq(chips[0].children[1].textContent, "你", "字走 textContent（边界规则 3）");
  const head = lane.children[lane.children.length - 1];
  eq(head.className, "lyric-head", "走带线挂在字块之后");

  /* 停机预览（arrBar = -1 → 钳在段首）：paintLyric 只写 transform 与 className */
  beat.Viz.paintLyric(96);
  eq(head.style.transform, "translateX(75.0px)", "走带线 = 段内进度 × 轨宽（96/768 × 600px）");
  ok(/(^| )played/.test(chips[0].className), "时值走完的字 = played（弹完定格）");
  ok(!/(^| )(on|played)( |$)/.test(chips[1].className), "未到的字不带态");
  eq(beat.Viz.internals().lyricFillEls[0].style.transform, "scaleX(1)", "唱完的字填充定格 1");

  beat.Viz.paintLyric(204);
  ok(/(^| )on/.test(chips[1].className), "落在 [t, t+dur) 内 = on（正在唱）");
  eq(beat.Viz.internals().lyricFillEls[1].style.transform, "scaleX(0.500)", "正在唱的字按进度填充");

  /* 延音字：整个时值内 act 不前进 —— 期间没有任何别的字被点亮 */
  beat.Viz.paintLyric(276);              // 「世」时值 [240,288) 内
  ok(/(^| )on/.test(chips[2].className), "延音字进场即 on");
  beat.Viz.paintLyric(282);
  eq(beat.Viz.internals().lyricFillEls[2].style.transform, "scaleX(0.875)", "延音期间填充持续推进");
  ok(/played/.test(chips[0].className) && /played/.test(chips[1].className)
     && /(^| )on/.test(chips[2].className),
     "★ 延音占位期间不点亮别的字（验收 5 的渲染侧）");

  /* 收起不变量：切回预设模式 → 整轨收起且清空（不占位、不留残影） */
  beat.Store.S.playMode = "preset";
  beat.Viz.buildLyricLane();
  eq(lane.hidden, true, "★ 预设模式 → 整轨收起");
  eq(lane.children.length, 0, "收起时清空字块");

  /* 无歌词行 / 段长不可知 → 同样收起 */
  const app2 = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  app2.beat.Viz.buildLyricLane();
  eq(app2.els["lyricLane"].hidden, true, "曲式在但无歌词行 → 收起");
  const app3 = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t9", name: "死引用", sections: [{ name: "s", blocks: [{ ref: { type: "custom", id: "ghost" }, repeats: 1 }] }] },
    ]}),
    "beatsight.state": JSON.stringify({ v: 3, playMode: "arrange",
      arrangeSel: { id: "t9", from: 0, to: 0, loop: false } }),
  });
  app3.beat.Store.upsertLyric("t9", 0, [{ t: 0, dur: 24, ch: "a" }]);
  app3.beat.Viz.buildLyricLane();
  eq(app3.els["lyricLane"].hidden, true, "★ 段长不可知（死引用）→ 收起而不是画错");
}

/* ================= 场景 T60e：音频锚点 lyricCueHit / emitLyricCues ================= */
section("T60e 锚点提示音 · 时刻 / 音色参数 / 延音静默 / 幂等 / 开关与音量门");
{
  const { beat } = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ lyricCue: true }) }));
  beat.Store.upsertLyric("t1", 0, [
    { t: 0, dur: 24, ch: "你" },
    { t: 192, dur: 24, ch: "好" },
    { t: 240, dur: 48, ch: "世" },       // 延音：时值覆盖 [240,288)，其间不得有第二声
  ]);
  beat.Controls.start();
  /* ★ FakeAudioContext.last 是跨实例保留的静态值，必须在 start() 之后取（同 T53） */
  const ac = FakeAudioContext.last;
  /* 240BPM：1 拍 0.25s、1 小节 1s；loop=true → 4.2s 越过整段末尾的回卷边界 */
  drive(ac, beat, 4.2);
  const noise = ac.hits.filter(h => h.kind === "noise");
  const times = noise.map(h => h.t);
  eq(noise.length, 4, "锚点总数：你(小节1) + 好/世(小节2) + 回卷后的你");
  near(times[0], 0.08, 1e-6, "「你」锚点 = 第 1 小节起点");
  near(times[1], 1.08, 1e-6, "「好」锚点 = 第 2 小节起点（不排在第 1 小节）");
  near(times[2], 1.33, 1e-6, "「世」锚点 = 第 2 小节 + 48tick × 0.25s/48");
  near(times[3], 4.08, 1e-6, "★ 循环回卷后锚点跟段落重算（tick 坐标系，不残留绝对时间）");
  eq(new Set(times).size, times.length, "★ 同一小节不重排（cueBarT 幂等护栏顶住 25ms 轮询）");
  ok(!noise.some(h => Math.abs(h.t - 1.58) < 1e-6),
     "★ 延音占位不触发：「世」时值中点 1.58s 没有第二声");

  /* 音色：复用 wood 带通噪声路径；音高固定，不参与重拍/正拍/弱拍分级 */
  const W = beat.CONFIG.timbres.wood;
  const wantGain = Math.min(W.makeup, beat.Store.S.vol * beat.CONFIG.levelBeat * W.makeup);
  noise.forEach((h, i) => {
    eq(h.filterType, "bandpass", "锚点 " + i + " 走带通噪声路径");
    eq(h.filterFreq, W.freqAccent, "锚点 " + i + " 音高固定（freqAccent）");
    near(h.gain, wantGain, 1e-6, "锚点 " + i + " 增益 = vol × levelBeat × makeup");
  });
  beat.Controls.stop();

  /* 开关关（默认）→ 一个锚点都不排 */
  const off = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState() }));
  off.beat.Store.upsertLyric("t1", 0, [{ t: 0, dur: 24, ch: "你" }]);
  off.beat.Controls.start();
  const offAc = FakeAudioContext.last;
  drive(offAc, off.beat, 1.2);
  eq(offAc.hits.filter(h => h.kind === "noise").length, 0, "★ 开关关（默认）→ 零锚点音");
  off.beat.Controls.stop();

  /* 音量为 0 → lyricCueHit 早退，不排空音（与 playClick 同口径） */
  const mute = loadApp(Object.assign(seedArr(), { "beatsight.state": seedState({ lyricCue: true, vol: 0 }) }));
  mute.beat.Store.upsertLyric("t1", 0, [{ t: 0, dur: 24, ch: "你" }]);
  mute.beat.Controls.start();
  const muteAc = FakeAudioContext.last;
  drive(muteAc, mute.beat, 1.2);
  eq(muteAc.hits.filter(h => h.kind === "noise").length, 0, "音量为 0 → 不排空音");
  mute.beat.Controls.stop();
}

/* ================= 场景 T60f：编排页歌词编辑轨 ================= */
section("T60f 歌词编辑轨 · 行结构 / 粘贴均分 / 拖拽边界 / 清除 / 锚点开关");
{
  const { beat, els, storage, fireWin, runTimers } = loadApp(seedArr());
  const St = beat.Store;
  beat.Arrange.open();
  const row0 = els["argSections"].children[0];
  const ly = row0.children[4];
  ok(/(^| )arg-lyric/.test(ly.className), "★ 歌词行在段行 children[4]（.arg-ops 之后，既有定位不挪位）");
  const [cue, box, clr, laneEl, tip] = ly.children;
  ok(cue.className.includes("toggle-pill") && cue.className.includes("arg-lyric-cue"), "锚点开关是 toggle-pill");
  eq(cue.getAttribute("aria-checked"), "false", "锚点提示音默认关");
  eq(clr.disabled, true, "无歌词行时「清除」禁用");
  eq(laneEl.children.length, 0, "无行时字块轨为空");
  ok(tip.textContent.includes("段内 4 小节 / 768 tick"), "提示给出段长（小节 / tick）");

  /* 粘贴 → 按字均分（空白符被吞），change 一次落库 */
  box.value = "你好 世界";
  box.fire("change");
  const line = St.findLyric("t1", 0);
  eq(line.chars.length, 4, "粘贴 4 个字（空白被吞）");
  eq(JSON.stringify(line.chars.map(c => c.t)), "[0,24,48,72]", "★ 默认每字一个八分（24tick）自段首顺排");
  ok(line.chars.every(c => c.dur === beat.LYRIC_BASE), "默认时值 = 基准单位");

  /* render 后重取（每次落库都整行重建） */
  const ly2 = els["argSections"].children[0].children[4];
  eq(ly2.children[3].children.length, 4, "均分后字块上轨");
  eq(ly2.children[1].value, "你好世界", "框内回显落库后的词");
  ok(ly2.children[4].textContent.includes("4 个字"), "提示同步字数");
  eq(ly2.children[3].children[0].getAttribute("aria-label"),
     "第 1 个字「你」起点 0 tick，时值 24 tick", "字块 aria 标签含位置");
  eq(ly2.children[3].children[0].children[1].className, "arg-lyric-grip", "字块右缘有时值抓手");

  /* 段落放不下的部分不录（768 / 24 = 32 字上限） */
  ly2.children[1].value = "字".repeat(40);
  ly2.children[1].fire("change");
  eq(St.findLyric("t1", 0).chars.length, 32, "★ 超出段长的字不录（「界面有、听不到」是最难查的错觉）");

  /* 换成两个字，开始拖拽（perTick = 轨宽 600px / 768tick = 0.78125） */
  const ly3 = els["argSections"].children[0].children[4];
  ly3.children[1].value = "你好";
  ly3.children[1].fire("change");

  /* 拖字块本体 = 改起点：+18.75px = +24tick */
  let chips = els["argSections"].children[0].children[4].children[3].children;
  const chip1 = chips[1];
  chip1.fire("pointerdown", { clientX: 100 });
  ok(chip1.className.includes("dragging"), "按下进入拖拽态");
  fireWin("pointermove", { clientX: 118.75 });
  eq(chip1.style.left, "6.25%", "拖动中实时更新位置（48/768）");
  eq(chip1.getAttribute("aria-label"), "第 2 个字「好」起点 48 tick，时值 24 tick", "拖动中 aria 同步");
  fireWin("pointerup", {});
  eq(St.findLyric("t1", 0).chars[1].t, 48, "★ 抬手落库（归一化由 Store 收口，UI 不做第二套校验）");
  ok(!chip1.className.includes("dragging"), "抬手摘掉拖拽态");

  /* 邻居边界：往左拖过前一个字的终点，吞不掉它 */
  chips = els["argSections"].children[0].children[4].children[3].children;
  const chip1b = chips[1];                          // 「好」@48
  chip1b.fire("pointerdown", { clientX: 200 });
  fireWin("pointermove", { clientX: 162.5 });       // −37.5px = −48tick → 0，但前一个字占 [0,24)
  fireWin("pointerup", {});
  eq(St.findLyric("t1", 0).chars[1].t, 24, "★ 拖过邻居终点被钳在 24，不会吃掉前一个字");

  /* 拖右缘改时值：被下一个字顶住 → 未变 → 不动库 */
  chips = els["argSections"].children[0].children[4].children[3].children;
  const lineBefore = St.findLyric("t1", 0);
  const grip0 = chips[0].children[1];
  grip0.fire("pointerdown", { clientX: 300 });
  fireWin("pointermove", { clientX: 318.75 });      // +24tick，但下一个字在 24
  fireWin("pointerup", {});
  ok(St.findLyric("t1", 0) === lineBefore, "时值被邻居顶住 → 未变 → 不动库（行对象不变）");

  /* 最后一个字没有右邻：时值真改 */
  const grip1 = chips[1].children[1];
  grip1.fire("pointerdown", { clientX: 400 });
  fireWin("pointermove", { clientX: 418.75 });      // +24tick → 48
  eq(chips[1].style.width, "6.25%", "时值拖动中宽度实时更新（48/768）");
  fireWin("pointerup", {});
  eq(St.findLyric("t1", 0).chars[1].dur, 48, "拖右缘改时值落库");

  /* 清除 */
  let ly4 = els["argSections"].children[0].children[4];
  ly4.children[2].fire("click");
  eq(St.findLyric("t1", 0), null, "「清除」删掉本段歌词行");
  ly4 = els["argSections"].children[0].children[4];
  eq(ly4.children[2].disabled, true, "清除后按钮回到禁用");
  eq(ly4.children[1].value, "", "框清空");

  /* 空文本 = 删行（与「清除」同一个出口） */
  ly4.children[1].value = "你好";
  ly4.children[1].fire("change");
  ok(!!St.findLyric("t1", 0), "先录两个字");
  const ly5 = els["argSections"].children[0].children[4];
  ly5.children[1].value = "   ";
  ly5.children[1].fire("change");
  eq(St.findLyric("t1", 0), null, "★ 粘贴空白 = 删行（不留空行脏数据）");

  /* 锚点提示音开关：全书一个 S.lyricCue，走热键落盘 */
  const ly6 = els["argSections"].children[0].children[4];
  ly6.children[0].fire("click");
  eq(St.S.lyricCue, true, "开关写入 S.lyricCue");
  runTimers();   // 热键走防抖落盘（persistDebounce），先冲刷定时器再读
  eq(JSON.parse(storage.get("beatsight.state")).lyricCue, true, "★ 开关状态持久化（热键）");
  const ly7 = els["argSections"].children[0].children[4];
  eq(ly7.children[0].getAttribute("aria-checked"), "true", "重渲染后开关态一致（读屏可读）");
  ly7.children[0].fire("click");
  eq(St.S.lyricCue, false, "再点关回");
  beat.Arrange.close();

  /* 段长不可知（块引用已死）：提示指路，不留空白谜面 */
  const dead = loadApp({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
    { id: "t9", name: "死引用", sections: [{ name: "s", blocks: [{ ref: { type: "custom", id: "ghost" }, repeats: 1 }] }] },
  ]}) });
  dead.beat.Arrange.open();
  const dly = dead.els["argSections"].children[0].children[4];
  eq(dly.children[3].children.length, 0, "span 不可知 → 不画字块");
  ok(dly.children[4].textContent.includes("先给块选一个节奏型"), "★ 提示告知先选节奏型");
}
