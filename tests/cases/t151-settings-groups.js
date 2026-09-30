/* BeatSight 自动化测试 · 设置弹窗分组归位（v2.85.0，fix ② / ③）
   T151 系列。
   ---------------------------------------------------------------------------
   与 t90 同源：桩不解析 HTML，走「标记字符串」断言——抽设置浮层静态 HTML，
   按 <h2 class="card-title"> 标题切分，校验每个控件落在正确的组里。
   v2.85.0（②）：原「外观与辅助」拆为「画面图层」(5 开关) +「环境」(2：keepAwake/wide)。
   v2.85.0（③a/③b）：「数据与说明」新增恢复示例曲、「危险区」新增恢复出厂设置。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* 抽设置浮层静态 HTML（与 t90 同一对标记） */
const A = '<div class="dialog" id="settingsOverlay"', B = "<!-- ================= 应用内弹窗";
const a = html.indexOf(A), b = html.indexOf(B);
ok(a >= 0, "前提：设置浮层起标记存在");
ok(b > a, "前提：设置浮层止标记在起标记之后");
const st = html.slice(a, b);

/* 六个组标题（用 >标题</h2> 精确命中组头，避开图例 SVG 里的同名 <text>） */
const titles = ["画面图层", "环境", "发声", "数据与说明", "危险区", "诊断与自验"];
const pos = titles
  .map(t => ({ t, i: st.indexOf(">" + t + "</h2>") }))
  .filter(x => x.i >= 0)
  .sort((p, q) => p.i - q.i);
ok(pos.length === titles.length, "前提：六组标题都在设置浮层静态 HTML 中");

/* 给定控件 id，判断它落在哪个组（落在最后一个位置 ≤ 控件位置的组头之后） */
function groupOf(id){
  const p = st.indexOf('id="' + id + '"');
  if (p < 0) return null;
  let g = pos.length ? pos[0].t : null;
  for (const x of pos){ if (x.i <= p) g = x.t; else break; }
  return g;
}

section("T151a 画面图层组（②）应含 5 个可视化开关");
{
  for (const id of ["bounceToggle", "tabToggle", "rulerLabToggle", "durLabelToggle", "lyricFollowToggle"]){
    eq(groupOf(id), "画面图层", "★ #" + id + " 落在「画面图层」组（而非旧的「外观与辅助」）");
  }
}

section("T151b 环境组（②）应含 keepAwake / wide");
{
  for (const id of ["keepAwakeToggle", "wideToggle"]){
    eq(groupOf(id), "环境", "★ #" + id + " 落在「环境」组（从外观与辅助拆出）");
  }
}

section("T151c 恢复示例曲（③a）/ 恢复出厂设置（③b）落在正确的组");
{
  eq(groupOf("demoRebuildBtn"), "数据与说明", "★ 恢复示例曲按钮在「数据与说明」组");
  eq(groupOf("factoryResetBtn"), "危险区", "★ 恢复出厂设置按钮在「危险区」组");
}

section("T151d 组顺序：画面图层 → 环境 → 发声 → 数据与说明 → 危险区 → 诊断与自验");
{
  const order = ["画面图层", "环境", "发声", "数据与说明", "危险区", "诊断与自验"];
  const idx = order.map(t => { const x = pos.find(p => p.t === t); return x ? x.i : -1; });
  let mono = true;
  for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) mono = false;
  ok(mono, "★ 六组在静态 HTML 中按预期次序出现（无穿插、无错位）");
}
