/* BeatSight 自动化测试 · 六线谱技巧连接、哑音与 P.M.（T269） */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const PRESET = () => ({ name: "技巧连接", meter: 4, bars: [[
  { t: 48, str: [{ s: 1, f: 12, tech: "O" }, { s: 2, f: 3 }], pm: true },
  { t: 48, str: [{ s: 2, f: 5, tech: "S" }], pm: true },
  { t: 48, str: [{ s: 2, f: 0, tech: "P" }, { s: 3, dead: true }], pm: true },
  { t: 48, str: [{ s: 2, f: 4, tech: "H" }, { s: 5, f: 7, tech: "S" }] },
]] });
const rowsOf = els => els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
const layerOf = (els, b = 0) => rowsOf(els)[b].children.find(c => /(^| )strums( |$)/.test(c.className));
const cls = (el, name) => !!(el && (" " + el.className + " ").includes(" " + name + " "));
const textsOf = svg => {
  const out = [];
  (function walk(n){ n.children.forEach(c => { if (c.tagName === "TEXT") out.push(c); walk(c); }); })(svg);
  return out;
};
const load = () => {
  const app = loadApp();
  app.beat.Store.importPresets(JSON.stringify({ presets: [PRESET()] }));
  app.beat.Store.S.sel = { type: "custom", id: app.beat.Store.customs[app.beat.Store.customs.length - 1].id };
  app.beat.Presets.refreshAfterPatternChange();
  return app;
};

section("T269-1 主视图 · H/P/S 行级连接 / O 单音 / × / P.M.");
{
  const { beat, els } = load();
  const layer = layerOf(els);
  const links = layer.children.filter(c => cls(c, "tech-link"));
  eq(links.length, 3, "三条有效同弦连接；孤立 S 不画");
  eq(links.map(x => x.dataset.tech).join(""), "SPH", "连接类型与目标音顺序一致");
  eq(links[0].dataset.from, "0", "S 从前一格起");
  eq(links[0].dataset.to, "1", "S 到当前目标音");
  ok(links.every(x => x.children[0].tagName === "SVG"), "每条连接由行级 SVG 绘制");
  const paths = links.map(x => x.children[0].children[0]);
  ok(paths[0].getAttribute("d").startsWith("M 8 15 L 92 7"), "上滑 3→5 使用上升斜线");
  ok(paths[1].getAttribute("d").includes("Q"), "勾弦使用弧线");
  ok(paths[2].getAttribute("d").includes("Q"), "击弦使用弧线");
  eq(links.map(x => textsOf(x.children[0])[0].textContent).join(""), "SPH", "技巧字母位于连接层而非品数后缀");
  const firstPick = layer.children.find(c => c.dataset && c.dataset.i === "0");
  const firstTexts = textsOf(firstPick.children[0]);
  eq(firstTexts.map(t => t.textContent).join(","), "12,O,3", "O 保留为单音上标，品数不带技巧后缀");
  const deadPick = layer.children.find(c => c.dataset && c.dataset.i === "2");
  ok(textsOf(deadPick.children[0]).some(t => t.textContent === "×" && t.getAttribute("class").includes("pick-dead")), "哑音以 × 代替品数");
  const pm = layer.children.filter(c => cls(c, "pm-range"));
  eq(pm.length, 1, "连续三个 pm 步合并为一个 P.M. 区间");
  eq(pm[0].dataset.from + ":" + pm[0].dataset.to, "0:2", "P.M. 区间端点正确");
  eq(beat.techLinksFor(beat.Store.customs[beat.Store.customs.length - 1].bars[0]).length, 3, "渲染与共享解析同源");
}

section("T269-2 编辑器同源 / 编排页总览降级 / 窄屏规则");
{
  const { beat, els } = load();
  beat.Editor.open();
  const track = els["editorBars"].children[0].children[1];
  eq(track.children.filter(c => cls(c, "tech-link")).length, 3, "编辑器复用同一连接层");
  eq(track.children.filter(c => cls(c, "pm-range")).length, 1, "编辑器显示同一 P.M. 区间");
  const mini = beat.Arrange.mkPatBar(PRESET(), true);
  eq(mini.children.filter(c => cls(c, "tech-link") || cls(c, "pm-range")).length, 0,
     "编排页不引入复杂连接和 P.M.");
  ok(/@media \(max-width:960px\)\{[\s\S]*?\.tech-link,\.pm-range\{display:none\}/.test(html),
     "≤960px 整档隐藏复杂技巧，保留既有圆点降级");
}

section("T269-3 窄格 · 端点过窄时连接整体隐藏");
{
  const { beat, els } = loadApp({}, { rowW: 120, viewportW: 1280 });
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "窄连接", meter: 4,
    bars: [[
      { t: 6, str: [{ s: 2, f: 3 }] },
      { t: 6, str: [{ s: 2, f: 5, tech: "S" }] },
      { t: 12 }, { t: 24 }, { t: 48 }, { t: 96 },
    ]] }] }));
  beat.Store.S.scrollMode = true;
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  const link = layerOf(els).children.find(c => cls(c, "tech-link"));
  ok(!!link, "窄格样本存在一条连接");
  eq(link.style.display, "none", "任一端点格过窄时连接线隐藏，不画不可读残线");
}
