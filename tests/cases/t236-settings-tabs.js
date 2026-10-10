/* BeatSight 自动化测试 · 设置页 tab 化（v3.45.0，六组折叠 → 画面/声音/数据/关于 四页）
   T236 系列。
   ---------------------------------------------------------------------------
   行为断言（桩内真实执行 Settings 模块的 activate / 监听器，非字符串比对）：
   · 点击 tab ⇄ 面板 hidden / aria-selected / tabindex 三件套同步
   · 键盘 ←→↑↓ 循环、Home/End 跳首尾（ARIA tab 模式），preventDefault 掐掉面板滚动
   · open() 无锚点恒回「画面」；带锚点（latGroup）先激活所在页再滚动
   · 每页保留 <h2 class="card-title">（t30 契约）与 tablist/tab/tabpanel 角色齐套
   配套反向验证：tools/reverse-verify-v3xxx.py（两变异各须命中具名 ✗）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const TABS = ["setTabVisual", "setTabAudio", "setTabData", "setTabAbout"];
const PANES = ["setPaneVisual", "setPaneAudio", "setPaneData", "setPaneAbout"];

const { beat, els, sandbox } = loadApp();
/* 桩按需建元素（elFor）：activate 在 open() 前不会碰面板，先经 document.getElementById
   把四个面板桩化，T236a 才能读到 HTML_ATTRS 复刻的初始 hidden */
PANES.forEach(id => sandbox.document.getElementById(id));

section("T236a 标记结构：tablist / tab / tabpanel 角色齐套，每页有 h2");
{
  ok(/role="tablist"/.test(html), "★ tab 栏 role=tablist");
  for (const id of TABS) ok(html.includes('role="tab" id="' + id + '"'), "★ #" + id + ' role=tab"');
  for (const id of PANES) ok(html.includes('role="tabpanel" id="' + id + '"'), "★ #" + id + ' role=tabpanel"');
  /* aria-controls ↔ aria-labelledby 双向引用成对（桩不解析，走字符串） */
  for (let i = 0; i < TABS.length; i++){
    ok(html.includes('aria-controls="' + PANES[i] + '"'), "★ " + TABS[i] + " aria-controls → " + PANES[i]);
    ok(html.includes('id="' + PANES[i] + '" aria-labelledby="' + TABS[i] + '"'), "★ " + PANES[i] + " aria-labelledby → " + TABS[i]);
  }
  for (const name of ["画面", "声音", "数据", "关于"]){
    ok(html.includes("<h2 class=\"card-title\">" + name + "</h2>"), "★ 「" + name + "」页头进 h2（t30 契约不破）");
  }
  /* 三件套初始态走标记字符串（桩不解析属性；面板 hidden 例外——harness HTML_ATTRS 已复刻，可读回）：
     首页 selected + 可聚焦，其余 tabindex=-1 */
  ok(/id="setTabVisual"[^>]*aria-selected="true"/.test(html), "★ 初始：首页 aria-selected=true（标记写死）");
  ok(/id="setTabAbout"[^>]*aria-selected="false"/.test(html), "★ 初始：非首页 aria-selected=false");
  ok(/id="setTabAbout"[^>]*tabindex="-1"/.test(html), "★ 初始：非首页 tabindex=-1（tabindex 漫游）");
  eq(els["setPaneVisual"].hidden, false, "★ 初始：画面面板可见");
  eq(els["setPaneAbout"].hidden, true, "★ 初始：关于面板 hidden（harness HTML_ATTRS 复刻标记初值）");
}

section("T236b 点击切页：hidden / aria-selected / tabindex 三件套同步");
{
  els["setTabAudio"].fire("click");
  eq(els["setPaneAudio"].hidden, false, "★ 点击声音 tab ⇒ 声音面板可见");
  eq(els["setPaneVisual"].hidden, true, "★ 点击声音 tab ⇒ 画面面板收起");
  eq(els["setPaneData"].hidden, true, "★ 数据面板仍隐藏");
  eq(els["setTabAudio"].getAttribute("aria-selected"), "true", "★ 声音 tab aria-selected=true");
  eq(els["setTabVisual"].getAttribute("aria-selected"), "false", "★ 画面 tab aria-selected=false");
  eq(els["setTabAudio"].tabIndex, 0, "★ 声音 tab tabindex=0（可 Tab 到）");
  eq(els["setTabVisual"].tabIndex, -1, "★ 画面 tab tabindex=-1");
  ok(els["setTabAudio"].classList.contains("active"), "★ 声音 tab 视觉高亮（.active）");
  ok(!els["setTabVisual"].classList.contains("active"), "★ 画面 tab 高亮已摘");
  /* 再切一次：数据页 */
  els["setTabData"].fire("click");
  eq(els["setPaneData"].hidden, false, "★ 再点数据 tab ⇒ 数据面板可见");
  eq(els["setPaneAudio"].hidden, true, "★ 声音面板随之收起（单页制）");
}

section("T236c 键盘：←→↑↓ 循环、Home/End 跳首尾");
{
  /* 当前在数据页；从数据页按 → 应到关于 */
  const ev1 = els["setTabData"].fire("keydown", { key: "ArrowRight" });
  eq(els["setTabAbout"].getAttribute("aria-selected"), "true", "★ 数据页 → 键 ⇒ 激活关于页");
  ok(ev1.defaultPrevented === true, "★ 方向键 preventDefault（防面板滚动）");
  /* 关于页 → 循环回首页 */
  els["setTabAbout"].fire("keydown", { key: "ArrowRight" });
  eq(els["setPaneVisual"].hidden, false, "★ 关于页 → 键循环 ⇒ 回画面页");
  /* ← 从首页回到关于（反向循环） */
  els["setTabVisual"].fire("keydown", { key: "ArrowLeft" });
  eq(els["setPaneAbout"].hidden, false, "★ 画面页 ← 键 ⇒ 反向循环到关于页");
  /* ↑↓ 与 ←→ 等价 */
  els["setTabAbout"].fire("keydown", { key: "ArrowUp" });
  eq(els["setPaneData"].hidden, false, "★ ↑ 键同 ←（移到上一页）");
  /* Home / End */
  els["setTabData"].fire("keydown", { key: "End" });
  eq(els["setPaneAbout"].hidden, false, "★ End ⇒ 跳到末页（关于）");
  els["setTabAbout"].fire("keydown", { key: "Home" });
  eq(els["setPaneVisual"].hidden, false, "★ Home ⇒ 跳回首页（画面）");
  /* 非导航键放行 */
  const evX = els["setTabVisual"].fire("keydown", { key: "Enter" });
  ok(evX.defaultPrevented !== true, "★ 回车不拦（按钮原生激活放行）");
}

section("T236d 打开设置恒回首页（状态不持久）；直达锚点先激活所在页");
{
  /* 当前停在画面页（上节 Home 后）——先切走，再开设置应回首页 */
  els["setTabData"].fire("click");
  beat.Settings.open();
  eq(els["setPaneVisual"].hidden, false, "★ open() 无锚点 ⇒ 恒回「画面」页（tab 状态不持久）");
  eq(els["setTabVisual"].getAttribute("aria-selected"), "true", "★ 首页 aria-selected 归位");
  eq(els["setPaneData"].hidden, true, "★ 上次停留的数据页已收起");
  /* 直达入口：顶栏延迟读数 → Settings.open("latGroup") 应落在声音页 */
  beat.Settings.open("latGroup");
  eq(els["setPaneAudio"].hidden, false, "★ open(\"latGroup\") ⇒ 先激活声音页（锚点所在页）");
  eq(els["setTabAudio"].getAttribute("aria-selected"), "true", "★ 声音 tab 选中态同步");
  eq(els["setPaneVisual"].hidden, true, "★ 画面页随之收起");
  beat.Settings.close();
}

section("T236e 控件接线零感知：搬页不换 id，既有开关在桩内仍可点");
{
  /* t151 已钉静态归属；这里补一条行为级兜底：声音页开关点击仍走原 handler */
  beat.Settings.open();
  els["setTabAudio"].fire("click");
  const before = els["keepAwakeToggle"].getAttribute("aria-checked");
  els["keepAwakeToggle"].fire("click");
  eq(els["keepAwakeToggle"].getAttribute("aria-checked"), before === "true" ? "false" : "true",
    "★ 后台保活开关搬家后点击仍翻转 aria-checked（接线按 id，与所在页无关）");
  beat.Settings.close();
}
