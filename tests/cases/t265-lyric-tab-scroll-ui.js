/* BeatSight 自动化测试 · 谱内歌词连续滚动与实际生效态（T265） */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, near, section } = require("../lib/harness");

const STRUM4 = Array.from({ length: 4 }, () => ({ t: 48, dir: "D" }));
function setupSong(beat){
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "滚动谱内测试型", meter: 4, bars: [STRUM4] }] }));
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  beat.Store.upsertArrange({ id: "t265", name: "滚动谱内测试曲", sections: [
    { uid: "s265", name: "主歌", blocks: [{ ref: { type: "custom", id: pid }, repeats: 4 }] },
  ] });
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel = { id: "t265", from: 0, to: 3, loop: true };
  beat.Store.S.bpm = 240;
  beat.Store.S.lyricPos = "tab";
  beat.Store.S.pitchNotation = "off";
  beat.Store.upsertLyric("t265", "s265", [
    { t: 0, dur: 24, ch: "你" }, { t: 48, dur: 24, ch: "好" },
    { t: 192, dur: 24, ch: "滚" }, { t: 240, dur: 24, ch: "动" },
  ]);
  beat.Viz.buildViz();
}
const posPill = (app, pos) => app.els.lyricPosGroup.children.find(p => p.dataset.pos === pos);
const pitchPill = (app, pn) => app.els.pitchNotationGroup.children.find(p => p.dataset.pn === pn);
const dxOf = s => { const m = /translate\((-?[\d.]+)px,/.exec(s || ""); return m ? +m[1] : NaN; };
const dyOf = s => { const m = /,\s*(-?[\d.]+)px\)/.exec(s || ""); return m ? +m[1] : NaN; };
function assertSlotsAligned(app, label){
  const int = app.beat.Viz.internals();
  eq(int.lyricRows.length, int.rowEls.length, label + "：歌词与网格槽数一致");
  for (let i = 0; i < int.rowEls.length; i++){
    eq(dxOf(int.lyricRows[i].el.style.transform), dxOf(int.rowEls[i].style.transform),
      label + "：第 " + i + " 槽歌词与网格横移一致");
    near(dyOf(int.lyricRows[i].el.style.transform), dyOf(int.rowEls[i].style.transform) + int.lyricRows[i].y, 0.001,
      label + "：第 " + i + " 槽谱内 y 与滚动 dy 叠加一致");
  }
}

section("T265a 音高冲突：tab 禁用、follow 显示实际生效，关音高恢复");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat);
  pitchPill(app, "jp").fire("click");
  eq(app.beat.Viz.lyricLayoutState().actual, "follow", "音高开启实际回退 follow");
  eq(posPill(app, "tab").disabled, true, "音高开启时谱内按钮禁用");
  eq(posPill(app, "tab").classList.contains("active"), false, "请求 tab 不再伪装成生效");
  eq(posPill(app, "follow").classList.contains("active"), true, "follow 显示实际生效态");
  eq(posPill(app, "follow").getAttribute("aria-pressed"), "true", "aria-pressed 与视觉生效态同源");
  ok(app.els.lyricPosNote.textContent.includes("关闭音高后自动恢复"), "说明给出明确恢复路径");
  posPill(app, "follow").fire("click");
  posPill(app, "tab").fire("click");
  eq(app.beat.Store.S.lyricPos, "follow", "禁用按钮即使被合成事件触发也不改偏好");
  pitchPill(app, "off").fire("click");
  eq(posPill(app, "tab").disabled, false, "关音高后谱内按钮恢复可用");
  posPill(app, "tab").fire("click");
  eq(app.beat.Viz.lyricLayoutState().actual, "tab", "重新选择后实际进入谱内");
  eq(posPill(app, "tab").classList.contains("active"), true, "实际 tab 时谱内按钮高亮");
}

section("T265b 连续滚动只禁集中底部，auto/follow/tab 保持可选");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  app.els.scrollModeToggle.fire("click");
  eq(posPill(app, "bottom").disabled, true, "连续滚动禁用 bottom");
  ok(["auto", "follow", "tab"].every(pos => !posPill(app, pos).disabled),
    "auto/follow/tab 在连续滚动中均可选");
  eq(app.els.lyricPosNote.hidden, true, "未请求 bottom 时不显示多余限制说明");
}

for (const rows of [1, 3]){
  section("T265c 连续滚动 " + rows + " 行：谱内静止与播放逐槽对齐");
  {
    const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
    setupSong(app.beat);
    app.beat.Store.S.scrollMode = true;
    app.beat.Store.S.scrollRows = rows;
    app.beat.Viz.reloadScroll();
    eq(app.beat.Viz.lyricLayoutState().actual, "tab", "rows=" + rows + "：连续滚动实际进入 tab");
    eq(app.beat.Viz.lyricLayoutState().reason, "", "rows=" + rows + "：不再产生 scroll 回退原因");
    ok(app.els.lyricLane.classList.contains("in-tab"), "rows=" + rows + "：歌词轨保留谱内作用域");
    const int = app.beat.Viz.internals();
    for (let i = 0; i < int.lyricRows.length; i++)
      eq(int.lyricRows[i].y, int.rowGeo[i].top + 8, "rows=" + rows + "：第 " + i + " 槽居中于 44px 格子带");
    assertSlotsAligned(app, "rows=" + rows + " 静止");
    app.beat.Controls.start();
    const ac = FakeAudioContext.last;
    for (let i = 0; i < 100; i++){
      ac.currentTime += 0.02;
      app.beat.AudioEngine.scheduler();
      app.beat.Viz.paintFrame();
    }
    assertSlotsAligned(app, "rows=" + rows + " 播放");
    eq(app.beat.Viz.lyricLayoutState().actual, "tab", "rows=" + rows + "：播放换窗后仍为 tab");
    app.beat.Controls.stop();
  }
}

section("T265d 连续滚动请求 bottom：实际 follow 可见且原因可读");
{
  const app = loadApp({}, { rowW: 1200, viewportW: 1200 });
  setupSong(app.beat);
  app.beat.Store.S.lyricPos = "bottom";
  app.beat.Store.S.scrollMode = true;
  app.beat.Viz.reloadScroll();
  app.els.settingsBtn.fire("click");
  eq(app.beat.Viz.lyricLayoutState().actual, "follow", "scroll 下 bottom 实际 follow");
  eq(app.beat.Viz.lyricLayoutState().reason, "scroll", "bottom 回退原因归为 scroll");
  eq(posPill(app, "follow").classList.contains("active"), true, "bottom 回退同样高亮实际 follow");
  eq(posPill(app, "bottom").classList.contains("active"), false, "bottom 不再伪装成已生效");
  ok(app.els.lyricPosNote.textContent.includes("不支持集中底部"), "说明明确连续滚动限制");
}
