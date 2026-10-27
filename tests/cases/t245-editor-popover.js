/* BeatSight 自动化测试 · 编辑器「音符属性」悬浮层 + 品牌合规修复钉（PLAN-v11 A/B 批）
   T245 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约（拍板记录见 docs/archive/PLAN-v11-editor-popover.md §0）：
     · 音符级四组（扫弦标注 / 弦区 / 发声 / 逐弦）收进 #edPop 悬浮层：未选中不占版面（.off）；
       点音符块 = 选中 + 弹出；点其他块跟随；**再点当前块 = toggle 收起**（选中保留）；
       ✕ / ESC 收起；edSel 被任何路径清掉（撤销/清空/删格…）→ editorRender 尾部 syncEdPop 中央收层；
     · 小节级「按序铺弦号」行留在页面，输入框定宽（--ed-fill-w），「作用于当前小节」常显 hint；
     · A1–A8 品牌合规修复逐条源码钉（CSS 文本级）；
     · 几何（锚定 / 视口夹取 / 上下翻转）只在真机 DOM 有意义——桩无 getBoundingClientRect，
       syncEdPop 在桩里跳过定位，这条由浏览器冒烟 + 人眼验收覆盖。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section } = require("../lib/harness");

const HTML_PATH = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");
/* 抽 <style> 并剥离注释（t131 同款口径：注释里的规则不算真实规则） */
const styleText = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
const nostyle = styleText.replace(/\/\*[\s\S]*?\*\//g, "");
/* 取某条选择器的规则原文（首个命中；@media 内副本不含选择器前缀差异即可） */
const ruleOf = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(esc + "\\s*\\{[^}]*\\}").exec(nostyle);
  return m ? m[0] : "";
};

/* 编辑器第 b 小节的格子（edbar 的 children = [label, track]）。选中会换行缓存键（ck 含 edSel.idx）
   ⇒ 每次点击后行会重建，必须重新取格子引用（t47 同一口径） */
function edCellsOf(els, b){
  return els["editorBars"].children[b].children[1].children;
}

/* ================= 场景 T245-1：悬浮层行为闭环 ================= */
section("T245-1 音符属性悬浮层 · 初始隐藏 / 弹出 / meta / toggle / ✕ / ESC / 选中被清收层");
{
  /* 句柄：loadApp 返回值自带 fireWin（窗口级事件注入）；beat/els 是属性不是键 */
  const { beat, els, fireWin } = loadApp();
  const Ed = beat.Editor;
  Ed.open();
  const pop = els["edPop"];
  ok(!!pop, "前提：#edPop 经 $() 懒建可达（check-dom-ids 的 id 通道不变）");
  ok(pop.classList.contains("off"), "★ 初始（未选中）：悬浮层收起（.off），不占版面");
  ok(pop.hidden === false, "首次渲染后 hidden 摘除（显隐交由 .off 接管，hidden 只管初始）");

  /* 点第 1 格 → 弹出 + meta + 选中环 */
  edCellsOf(els, 0)[0].fire("click");
  ok(!pop.classList.contains("off"), "★ 点音符块 → 悬浮层弹出");
  ok(/小节 1 · 第 1 格 · /.test(String(els["edPopMeta"].textContent)),
     "★ meta = 小节 / 格序 / 时值名（" + String(els["edPopMeta"].textContent) + "）");
  ok(edCellsOf(els, 0)[0].classList.contains("sel"), "选中块带 .sel 环");
  /* 弹出即已选中 → 四组可用（禁用态由 editorRender 同源同步） */
  ok(els["dirRow"].children.every(b => !b.disabled), "弹出态：扫弦标注各档启用（桩复刻三档）");

  /* 点当前块 = 相对当前显隐翻转：开→收；**关（✕/ESC/空白收起后）→重开**（用户实报追补） */
  edCellsOf(els, 0)[0].fire("click");
  ok(pop.classList.contains("off"), "★ 再点当前块 → 收起（toggle）");
  ok(edCellsOf(els, 0)[0].classList.contains("sel"), "toggle 收起后选中保留（.sel 不掉）");
  edCellsOf(els, 0)[0].fire("click");
  ok(!pop.classList.contains("off"), "★ 关态再点当前块 → 重新展开（相对显隐翻转，无需先点别块）");
  edCellsOf(els, 0)[0].fire("click");
  ok(pop.classList.contains("off"), "★ 展开态再点当前块 → 仍可收起");

  /* 点其他块 → 跟随重锚定 + meta 换格 */
  edCellsOf(els, 0)[1].fire("click");
  ok(!pop.classList.contains("off"), "★ 点其他块 → 跟随弹出");
  ok(/第 2 格 /.test(String(els["edPopMeta"].textContent)), "★ meta 换到第 2 格");

  /* ✕ → 收起，选中保留 */
  els["edPopClose"].fire("click");
  ok(pop.classList.contains("off"), "★ ✕ → 收起");
  ok(edCellsOf(els, 0)[1].classList.contains("sel"), "✕ 收起后选中保留");

  /* ESC → 逐层退出：先收悬浮层（不关编辑器）。
     重开要点另一块——✕ 后再点同块是 toggle 语义（仍收起），这是拍板口径本身 */
  edCellsOf(els, 0)[0].fire("click");
  ok(!pop.classList.contains("off"), "前提：点另一块重新弹出");
  fireWin("keydown", { key: "Escape" });
  ok(pop.classList.contains("off"), "★ ESC → 悬浮层先收");
  ok(els["editor"].classList.contains("open"), "★ ESC 第一层只收悬浮层，编辑器仍开着");

  /* 选中被清（点轨道空白 = edSel=null）→ 渲染尾部中央收层 */
  edCellsOf(els, 0)[1].fire("click");
  ok(!pop.classList.contains("off"), "前提：再次弹出");
  const track = els["editorBars"].children[0].children[1];
  track.fire("click", { target: track });
  ok(pop.classList.contains("off"), "★ edSel 被清（点轨道空白）→ syncEdPop 中央收层");
  Ed.tryClose();
}

/* ================= 场景 T245-2：B1 铺弦号行 + A1–A8 源码钉 ================= */
section("T245-2 B1 铺弦号行 + 悬浮层标记（留在页面、占位精简、报错槽独立）");
{
  ok(/<div class="ed-pop" id="edPop"[^>]*hidden>/.test(html), "★ #edPop 标记初始 hidden（流式期不可见）");
  ok(!/style="width:auto;flex:1;min-width:200px"/.test(html), "★ #strFillIn 的 inline flex:1 已移除");
  ok(nostyle.includes(".ed-strfill{--ed-fill-w:320px}") &&
     nostyle.includes(".ed-strfill .name-input{width:var(--ed-fill-w);max-width:100%;flex:0 1 auto}"),
     "★ 铺弦号定宽进 CSS 变量（--ed-fill-w，展板 Do「新增尺寸先进 CSS 变量」）");
  ok(html.includes('placeholder="按序铺弦号：5:3 3 2 3 1 3 2 3"'), "★ 占位精简（「作用于当前小节」移出）");
  ok(ruleOf(".ed-str .str-lines").includes("grid-template-columns:1fr 1fr") &&
     ruleOf(".ed-str .str-lines").includes("grid-auto-flow:column"),
     "★ 逐弦面板两列网格（左 ①②③ / 右 ④⑤⑥，高度约减半；用户实拍追补）");
  ok(ruleOf(".ed-pop .ed-dir").includes("margin:10px 0 12px"),
     "★ 悬浮层组间距补 margin-top（修扫弦标注按钮贴 head 分隔线；用户实拍追补）");
  ok((html.match(/<span class="hint">作用于当前小节<\/span>/g) || []).length === 1,
     "★ 「作用于当前小节」常显 hint 恰一条（#strFillHint 仍专用于报错）");
  /* 去注释后检查：源码钉看的是**活代码**，修复说明注释里提到旧话术不算数 */
  const noComment = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!noComment.includes("先在上方选中一个音符"), "★ 四条「先在上方选中一个音符」占位话术退役（注释里的修复记录不算）");
}

section("T245-3 品牌合规钉 · A1 var(--accent) 死引用 / A2 写死红 / A3 段标中性");
{
  const playRule = ruleOf(".arg-pill-play:hover");
  ok(/color:var\(--green\);border-color:var\(--green\);background:rgba\(var\(--green-rgb\),\.12\)/.test(playRule),
     "★ A1：▶ 试听 hover = --green + --green-rgb veil");
  ok(!nostyle.includes("var(--accent)"), "★ A1：样式表不再引用未定义的 var(--accent)（--accent-hi 不受影响）");
  const delRule = ruleOf(".arg-item-del:hover");
  ok(delRule.includes("color:var(--danger-fg)") && !delRule.includes("#f3727f"),
     "★ A2：✕ hover 警示文字走 --danger-fg（日间深红 #B91C1C，AA 达标；描边仍随 --red）");
  ok(!nostyle.includes("#f3727f"), "★ A2：小写 #f3727f 全表清零（:root 的 #F3727F 大写定义不受影响）");
  const labelRule = ruleOf(".arg-sec>.arg-sec-label");
  ok(labelRule.includes("var(--border)") && labelRule.includes("var(--t3)") && !labelRule.includes("var(--green)"),
     "★ A3：「段 N」静态标签中性化（描边 --border + 字 --t3）");
}

section("T245-4 品牌合规钉 · A4 热区 / A5 圆角归并 / A6 veil 单源 / A7 焦点蓝 / A8 工作面豁免");
{
  for (const sel of [".arg-item-del{", ".arg-item-ren{", ".arg-pill-edit{", ".arg-pill-play{"]){
    const r = ruleOf(sel.replace(/\{$/, ""));
    ok(/\b(width:24px|height:24px|min-width:24px|min-height:24px)/.test(r),
       "★ A4：" + sel + " 热区 ≥24px（WCAG 2.5.8 AA）");
  }
  for (const sel of [".arg-reps{", ".arg-chd-cell{", ".arg-pill-tag{", ".arg-pill-edit{", ".arg-pill-play{"]){
    const r = ruleOf(sel.replace(/\{$/, ""));
    ok(r.includes("border-radius:var(--radius-cell)") && !r.includes("border-radius:4px"),
       "★ A5：" + sel + " 圆角归并 3px（时值格族，PLAN-v16 起写 var(--radius-cell)=3px）");
  }
  ok(html.includes("--green-rgb:30,215,96") && html.includes("--green-rgb:37,99,235"),
     "★ A6：--green-rgb 双主题定义在（深 30,215,96 / 日 37,99,235）");
  ok(ruleOf(".edcell.sel").includes("rgba(var(--green-rgb),.15)") &&
     /body\[data-theme="obs"\] \.edcell\.sel\{[^}]*rgba\(var\(--green-rgb\),\.12\)/.test(nostyle) &&
     ruleOf(".arg-pill-edit:hover").includes("rgba(var(--green-rgb),.1)"),
     "★ A6：三处原硬编码 veil（edcell.sel / obs 覆盖 / ✎ hover）全部改 token（主视图光晕类 "
     + "rgba(30,215,96,…) 是既有花火特效、不在 A6 收编范围）");
  ok(ruleOf(".arg-mini.cur").includes("var(--blue)") &&
     ruleOf(".edbar-label.editing .n").includes("var(--blue)"),
     "★ A7：编辑焦点统一蓝（arg-mini.cur / 编辑中；cur-sec 与歌词 chip 现状即蓝）");
  const inner = ruleOf(".editor-inner");
  ok(inner.includes("max-width:1080px") && inner.includes("position:relative"),
     "★ A8：编辑器 1080px 工作面保留 + 注释登记豁免（规则带 position:relative 供 #edPop 定位）");
}
