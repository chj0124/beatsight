/* BeatSight 自动化测试 · 设置弹窗 tab 归属（v3.45.0，六组折叠 → 四 tab 重排）
   T151 系列。
   ---------------------------------------------------------------------------
   与 t90 同源：桩不解析 HTML，走「标记字符串」断言——抽设置浮层静态 HTML，
   按各页 <h2 class="card-title"> 标题切分，校验每个控件落在正确的 tab 页里。
   v3.45.0：六组 <details> 折叠退役 → 画面 / 声音 / 数据 / 关于 四页；
   原断言的六组归属按新映射整体重写（「环境」组解组：宽屏/壁纸 → 画面，
   后台保活 → 声音；「危险区」「诊断与自验」降为页内子节）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* 抽设置浮层静态 HTML（与 t90 同一对标记） */
const A = '<div class="dialog" id="settingsOverlay"', B = "<!-- ================= 应用内弹窗";
const a = html.indexOf(A), b = html.indexOf(B);
ok(a >= 0, "前提：设置浮层起标记存在");
ok(b > a, "前提：设置浮层止标记在起标记之后");
const st = html.slice(a, b);

/* 四个页标题（用 >标题</h2> 精确命中页头 h2，避开注释与 tab 按钮里的同名文本） */
const titles = ["画面", "声音", "数据", "关于"];
const pos = titles
  .map(t => ({ t, i: st.indexOf(">" + t + "</h2>") }))
  .filter(x => x.i >= 0)
  .sort((p, q) => p.i - q.i);
ok(pos.length === titles.length, "前提：四页标题都在设置浮层静态 HTML 中");

/* 给定控件 id，判断它落在哪一页（落在最后一个位置 ≤ 控件位置的页头之后） */
function paneOf(id){
  const p = st.indexOf('id="' + id + '"');
  if (p < 0) return null;
  let g = pos.length ? pos[0].t : null;
  for (const x of pos){ if (x.i <= p) g = x.t; else break; }
  return g;
}

section("T151a 画面页（原画面图层 + 宽屏/壁纸）应含全部视觉开关");
{
  for (const id of ["bounceToggle", "tabToggle", "rulerLabToggle", "durLabelToggle", "vizLegendToggle", "showLyricToggle"]){
    eq(paneOf(id), "画面", "★ #" + id + " 落在「画面」页");
  }
  /* 歌词位置三档与音高三档（v2.86.0 / v3.37.0）与「显示歌词」同页 */
  eq(paneOf("lyricPosGroup"), "画面", "★ #lyricPosGroup 落在「画面」页（显示位置三档）");
  eq(paneOf("pitchNotationGroup"), "画面", "★ #pitchNotationGroup 落在「画面」页（音高标注三档）");
  eq(paneOf("scrollModeToggle"), "画面", "★ #scrollModeToggle 落在「画面」页");
  eq(paneOf("vizRowsRow"), "画面", "★ #vizRowsRow 落在「画面」页");
  /* v3.45.0：「环境」组解组——宽屏铺满与壁纸归视觉项入「画面」页 */
  eq(paneOf("wideToggle"), "画面", "★ #wideToggle 落在「画面」页（环境组解组）");
  for (const id of ["wallPickBtn", "wallClearBtn", "wallDefaultBtn", "wallDimRow"]){
    eq(paneOf(id), "画面", "★ #" + id + " 落在「画面」页（壁纸控件随迁）");
  }
}

section("T151b 声音页（原发声 + 后台保活）");
{
  eq(paneOf("timbreRow"), "声音", "★ #timbreRow 落在「声音」页");
  eq(paneOf("swingRow"), "声音", "★ #swingRow 落在「声音」页");
  eq(paneOf("latGroup"), "声音", "★ #latGroup 落在「声音」页（延迟补偿，直达锚点所在页）");
  eq(paneOf("latMs"), "声音", "★ #latMs 落在「声音」页");
  eq(paneOf("keepAwakeToggle"), "声音", "★ #keepAwakeToggle 落在「声音」页（环境组解组，语义=声音在后台继续响）");
}

section("T151c 数据页（导入导出 + 恢复示例曲 + 危险区子节）");
{
  for (const id of ["exportBtn", "importBtn", "exportAllBtn", "importAllBtn", "demoRebuildBtn", "exportSelBtn"]){
    eq(paneOf(id), "数据", "★ #" + id + " 落在「数据」页");
  }
  /* v3.45.0：「危险区」自独立折叠组降为「数据」页的页内子节（与「先导出备份」形成先后关系） */
  eq(paneOf("factoryResetBtn"), "数据", "★ #factoryResetBtn 落在「数据」页（危险区并入数据页）");
}

section("T151d 关于页（使用方法/安装 + 诊断与自验子节）");
{
  eq(paneOf("helpBtn"), "关于", "★ #helpBtn 落在「关于」页");
  eq(paneOf("helpInstallBtn"), "关于", "★ #helpInstallBtn 落在「关于」页");
  eq(paneOf("diagCopyBtn"), "关于", "★ #diagCopyBtn 落在「关于」页（诊断与自验并入关于页）");
  eq(paneOf("helpDiagExport"), "关于", "★ #helpDiagExport 落在「关于」页");
}

section("T151e 页顺序：画面 → 声音 → 数据 → 关于");
{
  const idx = titles.map(t => { const x = pos.find(p => p.t === t); return x ? x.i : -1; });
  let mono = true;
  for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) mono = false;
  ok(mono, "★ 四页在静态 HTML 中按预期次序出现（无穿插、无错位）");
}
