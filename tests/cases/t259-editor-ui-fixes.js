/* BeatSight 自动化测试 · 节奏型编辑界面四项修正（PLAN-v14）
   T259 系列。
   ---------------------------------------------------------------------------
   核心契约（2026-10-14 用户实拍四项拍板）：
     · 空态引导层三行收进 64px 轨道（行高 1.5，不贴上下缘）；
     · 撤销钮随网格走——住 .ed-actions 行首位、图标 +「撤销」（推翻 v3.53.2「住顶栏」）；
     · 模板触发框收窄（max-width + 省略号）、「模板」标签删除、引导文案改指「选模板」；
     · 弹层 #edPop 作用域收紧 pill（弦区三档单行），全局 .pill 与按钮文案不动；
     · 分段说明「 | 」留空，编辑标签列 88px，保住文字与轨道之间的 12px 间隙。
   本组钉源码结构与 CSS 不变量两端，与 T258（作用域分区行为）互补。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* ================= 场景 T259a：结构与图标 · 撤销随网格 ================= */
section("T259a 结构钉 · 撤销在 .ed-actions 首位、顶栏不再有、形态含图标");
{
  const edActionsAt = html.indexOf('<div class="ed-actions">');
  const topbarAt = html.indexOf('<div class="editor-actions">');
  const undoAt = html.indexOf('id="undoBtn"');
  const popAt = html.indexOf('id="edPop"');
  const delAt = html.indexOf('id="delStepBtn"');
  const fillAt = html.indexOf('id="strFillIn"');
  ok(edActionsAt > 0 && undoAt > edActionsAt && undoAt < popAt,
     "★ 撤销钮位于网格下方 .ed-actions 内、#edPop 之前（高频恢复动作随网格走）");
  const topbarSeg = html.slice(topbarAt, html.indexOf("</div>", topbarAt));
  ok(topbarAt > 0 && topbarSeg.indexOf('id="undoBtn"') < 0,
     "★ 顶栏动作区不再出现撤销钮（只留过程动作「试听」）");
  const undoBtnHtml = html.slice(undoAt, html.indexOf("</button>", undoAt));
  ok(/<svg/.test(undoBtnHtml), "★ 撤销钮含图标（<svg>）");
  ok(/撤销/.test(undoBtnHtml) && /aria-label="撤销/.test(undoBtnHtml),
     "★ 撤销钮保留文字「撤销」且 aria-label 指明快捷键（图标不是唯一线索）");
  ok(popAt > 0 && popAt < delAt && delAt < fillAt,
     "★ 删除选中音符仍在 #edPop 内、铺弦号行之前（本次未动音符级归位）");
}

/* ================= 场景 T259b：模板区 · 收窄 + 删标签 + 文案 ================= */
section("T259b 模板区 · 触发框收窄规则、外壳无「模板」标签、引导改指占位");
{
  const tplAt = html.indexOf('id="edTplWrap"');
  const tplSeg = html.slice(tplAt, html.indexOf("</span>", tplAt));
  ok(tplAt > 0 && tplSeg.indexOf('id="editorTplSel"') >= 0, "模板下拉本体仍在（#editorTplSel）");
  ok(tplSeg.indexOf('class="lab"') < 0,
     "★ 模板外壳内不再有「模板」标签 span（下拉自带「选模板…」占位，自描述成立）");
  ok(html.includes("① 顶栏「选模板」下拉"),
     "★ 空态引导文案①改指占位「选模板」（标签删除后不再指名不存在的「模板」）");
}

/* ================= 场景 T259c：CSS 不变量 ================= */
section("T259c CSS 钉 · 引导行高 / 模板收窄 / 弹层 pill 收紧");
{
  ok(/\.ed-tpl \.loop-sel\{max-width:200px;text-overflow:ellipsis\}/.test(html),
     "★ 模板触发框收窄：max-width:200px + 省略号（只作用 .ed-tpl）");
  ok(/#edPop \.pill\{padding:5px 8px;font-size:12px\}/.test(html),
     "★ 弹层内 pill 收紧（弦区三档单行）——作用域限定 #edPop");
  ok(/#edPop \.ed-dir\{gap:8px\}/.test(html), "★ 弹层行间距收紧（#edPop .ed-dir）");
  ok(/#edPop \.hint:empty\{display:none\}/.test(html),
     "★ 弹层空 hint 隐藏（不占 gap，为弦区行腾宽）");
  const guideAt = html.indexOf(".ed-guide{");
  const guideSeg = html.slice(guideAt, html.indexOf("}", guideAt));
  ok(guideAt > 0 && /line-height:1\.5/.test(guideSeg),
     "★ 引导层行高收为 1.5（三行 ≈59px ≤ 64px 轨道，不再贴上下缘）");
  ok(/\.pill\{border-radius:var\(--radius-full\);padding:9px 16px;font-size:13px/.test(html),
     "★ 全局 .pill 未被波及（弦区/其它按钮内边距与字号一字未动；PLAN-v16 起圆角写 var(--radius-full)=9999px）");
  ok(/\.edbar\{display:flex;gap:12px/.test(html) && /\.edbar-label\{width:88px;flex:none\}/.test(html),
     "★ 编辑标签列 = 88px：容纳 88px 文字行，完整保留与轨道之间的 12px 间隙");
  ok(html.includes("用「 | 」分段会按片段均分"),
     "★ 分段竖线在引号内留空（「 | 」），不再与两侧引号粘连");
}

/* ================= 场景 T259d：行为回归 · 换宿主后撤销仍生效 ================= */
section("T259d 行为回归 · 撤销随网格仍走原 handler、禁用态随栈同步");
{
  const { beat, els } = loadApp();
  beat.Editor.openBlank();
  ok(els["undoBtn"].disabled, "空白起步：未改动草稿 → 撤销禁用");
  els["editorTplSel"].value = "b0";
  els["editorTplSel"].fire("change");
  ok(!els["undoBtn"].disabled, "载入模板（一步可撤销）→ 撤销可用");
  els["undoBtn"].fire("click");
  ok(els["undoBtn"].disabled, "撤销回退后栈空 → 撤销禁用（禁用态同步照旧）");
  eq(beat.Editor.draft().bars[0].length, 0, "撤销一步回到空白草稿（click→undo 接线不变）");
}
