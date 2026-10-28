/* BeatSight 自动化测试 · 技巧连接与 P.M. 编辑器（T270） */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const PAT = () => ({ name: "技巧编辑", meter: 4, bars: [0, 1].map(() => [
  { t: 48, str: [{ s: 2, f: 3 }] },
  { t: 48, str: [{ s: 2, f: 5 }] },
  { t: 48, str: [{ s: 2, f: 0 }] },
  { t: 48, str: [{ s: 2, f: 4 }] },
]) });
const cell = (els, b, i) => els["editorBars"].children[b].children[1].children[i];
const tech = (els, s = 2) => {
  const lines = els["strRow"].children.find(c => /str-lines/.test(c.className));
  const row = lines.children.find(r => r.dataset.s === String(s));
  return row.children[2];
};
const pmBtn = (els, action) => els["pmRow"].children.find(b => b.dataset.pm === action);
const load = () => {
  const app = loadApp();
  app.beat.Store.importPresets(JSON.stringify({ presets: [PAT()] }));
  app.beat.Store.S.sel = { type: "custom", id: app.beat.Store.customs[app.beat.Store.customs.length - 1].id };
  app.beat.Presets.refreshAfterPatternChange();
  app.beat.Editor.open();
  return app;
};

section("T270-1 目标音技巧写入 / 前音校验 / 撤销");
{
  const { beat, els } = load();
  cell(els, 0, 1).fire("click");
  tech(els).value = "S";
  els["strRow"].fire("change", { target: tech(els) });
  eq(JSON.stringify(beat.Editor.draft().bars[0][1].str), JSON.stringify([{ s: 2, f: 5, tech: "S" }]),
     "目标音写入 S，原品数保留");
  const links = els["editorBars"].children[0].children[1].children.filter(c => /tech-link/.test(c.className));
  eq(links.length, 1, "编辑器行缓存随 tech 更新并画出连接");
  beat.Editor.undo();
  eq(JSON.stringify(beat.Editor.draft().bars[0][1].str), JSON.stringify([{ s: 2, f: 5 }]),
     "撤销移除技巧但保留音符与品数");
}

section("T270-2 P.M. 起终点 / 区间清除 / 撤销与缓存");
{
  const { beat, els } = load();
  cell(els, 0, 0).fire("click");
  ok(!pmBtn(els, "start").disabled, "逐弦发声格可设 P.M. 起点");
  ok(pmBtn(els, "end").disabled, "未设起点时终点不可用");
  els["pmRow"].fire("click", { target: pmBtn(els, "start") });
  ok(String(els["pmHint"].textContent).includes("起点"), "起点状态有明确提示");
  cell(els, 0, 1).fire("click");
  ok(!pmBtn(els, "end").disabled, "设起点后终点可用");
  els["pmRow"].fire("click", { target: pmBtn(els, "end") });
  eq(beat.Editor.draft().bars[0].slice(0, 2).every(s => s.pm === true), true, "起终点 inclusive 写入");
  eq(beat.Editor.draft().bars[0][2].pm, undefined, "区间外不写 pm");
  eq(els["editorBars"].children[0].children[1].children.filter(c => /pm-range/.test(c.className)).length, 1,
     "barFinger 含 pm，行缓存不会吞掉新区间");
  els["pmRow"].fire("click", { target: pmBtn(els, "clear") });
  eq(beat.Editor.draft().bars[0].slice(0, 2).every(s => s.pm === undefined), true, "清除覆盖整个连续区间");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0].slice(0, 2).every(s => s.pm === true), true, "撤销恢复被清除区间");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars[0].slice(0, 2).every(s => s.pm === undefined), true, "再撤销回到未设 P.M.");
}

section("T270-3 P.M. 跨小节 / 非逐弦区间拒绝");
{
  const { beat, els } = load();
  cell(els, 0, 3).fire("click");
  els["pmRow"].fire("click", { target: pmBtn(els, "start") });
  cell(els, 1, 1).fire("click");
  els["pmRow"].fire("click", { target: pmBtn(els, "end") });
  const flat = beat.Editor.draft().bars.flat();
  eq(flat.slice(3, 6).every(s => s.pm === true), true, "P.M. 可跨小节连续设置");
  eq(flat.slice(0, 3).every(s => s.pm === undefined) && flat.slice(6).every(s => s.pm === undefined), true,
     "跨小节区间边界准确");
  beat.Editor.draft().bars[0][0].str = undefined;
  cell(els, 0, 0).fire("click");
  ok(pmBtn(els, "start").disabled, "无逐弦内容的格子不能设起点");
}
