/* BeatSight 自动化测试 · 谱内歌词横向避让与内容级回退（PLAN-v15） */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const STRUM4 = Array.from({ length: 4 }, () => ({ t: 48, dir: "D" }));
function setupSong(beat, opts = {}){
  const steps = opts.steps || STRUM4;
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "密度测试型", meter: 4, bars: [steps] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t264", name: "密度测试曲", sections: [
    { uid: "s264", name: "主歌", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] });
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t264", from: 0, to: 0, loop: true };
  beat.Store.S.lyricPos = "tab";
  beat.Store.S.pitchNotation = opts.pitch || "off";
  beat.Store.upsertLyric("t264", "s264", opts.chars || [{ t: 0, dur: 24, ch: "你" }],
    { notes: opts.notes || [] });
  beat.Viz.buildViz();
}

section("T264a 纯横向决策：无冲突保锚点，冲突只右移必要距离");
{
  const app = loadApp(), plan = app.beat.Viz.internals().planLyricTabX;
  eq(JSON.stringify(plan([{ x: 10, w: 10 }, { x: 40, w: 10 }], [], 100)), "[10,40]", "无记号时 x 不变");
  eq(JSON.stringify(plan([{ x: 10, w: 10 }, { x: 40, w: 10 }], [{ left: 5, right: 25 }], 100)), "[25,40]",
    "与记号相交 → 落到区间右缘，不多移");
  eq(JSON.stringify(plan([{ x: 10, w: 20 }, { x: 32, w: 10 }], [], 100)), "[10,34]",
    "相邻歌词保留 4px 净距");
}

section("T264b 纯横向决策：超右移、越界与挤压均失败，不缩字删字");
{
  const app = loadApp(), plan = app.beat.Viz.internals().planLyricTabX;
  eq(plan([{ x: 10, w: 10 }], [{ left: 0, right: 43 }], 100), null,
    "右移 33px 超过 32px 上限 → 失败");
  eq(plan([{ x: 95, w: 10 }], [], 100), null, "越出行右缘 → 失败");
  eq(plan([{ x: 10, w: 20 }, { x: 30, w: 50 }], [], 70), null,
    "后字无法同时保间距与行宽 → 失败");
  eq(plan([{ x: 10, w: 10 }, { x: 25, w: 10 }], [{ left: 0, right: 60 }], 100), null,
    "记号推动整组超上限 → 失败而非逐字跳高");
}

section("T264c 无六线层回退，不改用户偏好");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat, { steps: Array.from({ length: 4 }, () => ({ t: 48 })) });
  const st = app.beat.Viz.lyricLayoutState();
  eq(st.actual, "follow", "纯节拍型无六线层 → follow");
  eq(st.reason, "no-tab", "回退原因 no-tab");
  eq(app.beat.Store.S.lyricPos, "tab", "保存偏好仍为 tab");
}

section("T264d 音高开启回退，音高数据不丢失");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat, { pitch: "jp", notes: [{ t: 0, dur: 24, p: 60 }] });
  const st = app.beat.Viz.lyricLayoutState();
  eq(st.actual, "follow", "音高标注开启 → follow");
  eq(st.reason, "pitch", "回退原因 pitch");
  const line = app.beat.Store.findLyric("t264", "s264");
  eq(line.notes[0].p, 60, "音高数据原样保留");
  app.beat.Store.S.pitchNotation = "off"; app.beat.Viz.buildViz();
  eq(app.beat.Viz.lyricLayoutState().actual, "tab", "关音高后下一结构重建恢复 tab");
}

section("T264e 独立旋律音符块回退，纯空字行不误判过密");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat, { chars: [{ t: 0, dur: 24, ch: "你" }], notes: [{ t: 96, dur: 24, p: 64 }] });
  const st = app.beat.Viz.lyricLayoutState();
  eq(st.actual, "follow", "窗口含独立旋律音符 → follow");
  eq(st.reason, "standalone", "回退原因 standalone");
  const line = app.beat.Store.findLyric("t264", "s264");
  eq(line.notes.length, 1, "独立旋律数据保留");
  const empty = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(empty.beat);
  empty.beat.Store.deleteLyric("t264", "s264"); empty.beat.Viz.buildViz();
  eq(empty.beat.Viz.lyricLayoutState().actual, "tab", "无字且无独立音符 → 仍 tab，不因空行回退");
  ok(empty.els["lyricLane"].children.every(r => r.classList.contains("lyr-empty")), "空行仍留位且不画词");
}

section("T264f 设置说明与回退原因对应");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat, { pitch: "nm", notes: [{ t: 0, dur: 24, p: 60 }] });
  app.els["settingsBtn"].fire("click");
  eq(app.els["lyricPosNote"].hidden, false, "设置打开时显示回退说明");
  ok(app.els["lyricPosNote"].textContent.includes("音高标注开启"), "说明不静默、不改位置选择");
  eq(app.beat.Store.S.lyricPos, "tab", "提示出现也不改写偏好");
  const tab = app.els.lyricPosGroup.children.find(p => p.dataset.pos === "tab");
  const follow = app.els.lyricPosGroup.children.find(p => p.dataset.pos === "follow");
  eq(tab.disabled, true, "音高开启时禁用谱内入口");
  eq(follow.classList.contains("active"), true, "实际 follow 而非请求 tab 显示选中");
}
