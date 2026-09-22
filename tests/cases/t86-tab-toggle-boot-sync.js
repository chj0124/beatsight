/* BeatSight 自动化测试 · 六线底纹开关的启动收敛（v2.10.1）
   T86 系列。
   ---------------------------------------------------------------------------
   用户实拍反馈：**每次更新后打开工具，六线 · 扫弦谱底纹的开关默认已开，
   却没有显示底纹**（截图里 ↑↓ 箭头、灰格、座次尺都在，就是没有六线谱）。

   机理（三处耦合，缺一就会说出"开关说谎"）：
     1. 标记里 tabToggle 的初值**写死**为 `class="toggle-pill on"` + `aria-checked="true"`，
        只是"默认值提示"；真实开合态存在 S.showTab（点击会改写并持久化）。
     2. 显隐由 syncTabLayer() 把 `!(S.showTab && hasStrum(vizPattern()))` 收成 .viz 上的
        no-tab 类（CSS 落地：`.viz.no-tab .tab{display:none}`），**不重建 DOM**。
     3. 装配层的启动初始化块原先只同步 mute/bounce/trainer/countIn 四个开关——
        tabToggle 的 setToggle 只出现在点击处理器里。于是"上次关掉 → 重载"这条路径上，
        pill 显示"开"、aria 是 true，而 .viz 已带 no-tab —— 开关与事实相反。

   本组的契约：
     · pill 的 className / aria-checked 必须**恒等于** S.showTab（偏好），默认与重载两条路径都验；
     · .viz 的 no-tab 是"**偏好 AND 内容**"两个条件的合取——偏好开但当前型不带扫弦记谱时
       仍要藏（v2.9.0 的刻意设计），故不能简化成"跟随开关"；
     · .tab 的**创建**只由内容（hasStrum）决定、**显隐**由 no-tab 类决定：藏起来时 DOM 仍在
       （t47 只断言 .tab 存在与六条线的 style.top，看不到可见性——这正是本缺陷的测试盲点）；
     · 同族的 keepAwakeToggle（L812 写死 `off`）一并纳入启动收敛，防同一处漏改第二个开关。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const isBarRow = el => /(^| )bar-row( |$)/.test(el.className);
const isTab = el => /(^| )tab( |$)/.test(el.className);
/* 每小节的 .tab 层（不带扫弦记谱的小节没有 ⇒ 该位是 undefined），顺序 = 行的顺序 */
const tabsOf = els => els["viz"].children.filter(isBarRow)
  .map(r => r.children.find(isTab));
const hasNoTab = els => els["viz"].classList.contains("no-tab");
const isOn = el => el.className === "toggle-pill on";
const isOff = el => el.className === "toggle-pill off";

/* ================= 场景 T86a：默认打开即为真（开关不说谎的基线） ================= */
section("T86a 六线底纹 · 默认打开时 pill 为开且底纹真的可见");
{
  const { beat, els } = loadApp();
  eq(beat.Store.S.showTab, true, "S.showTab 默认 true");
  ok(isOn(els["tabToggle"]),
     "★ 默认 pill 视觉为开（className 恰好 toggle-pill on——applyToggle 整串覆写，不叠类）");
  eq(els["tabToggle"].getAttribute("aria-checked"), "true", "默认 aria-checked=true（语义同源）");
  ok(!hasNoTab(els), "★ 默认 .viz 不带 no-tab（底纹没被藏）");

  const tabs = tabsOf(els);
  ok(tabs.length > 0 && tabs.every(Boolean),
     "★ 默认型（民谣扫弦）带扫弦记谱 ⇒ 每行都建了 .tab（下面看得到线是「真有东西」，不是空跑）");
  ok(tabs.every(t => t.children.length === 6),
     "每层 .tab 恰好六条弦线（与 t47 同口径，此处只为证明「看得见」不是没有客体）");
}

/* ================= 场景 T86b：记住"关"时，开关必须跟着关，而不是显示开却藏底纹 ================= */
section("T86b 六线底纹 · 上次关掉后重载：pill 与底纹一起关（本缺陷的核心回归）");
{
  const app = loadApp(seedState({ showTab: false }));
  eq(app.beat.Store.S.showTab, false, "种入 showTab:false ⇒ S.showTab=false");
  ok(isOff(app.els["tabToggle"]),
     "★ pill 视觉为关（修复前这里恒为 on —— 实拍反馈「开关默认已开」的根因）");
  eq(app.els["tabToggle"].getAttribute("aria-checked"), "false", "★ aria-checked=false（不再是写死的 true）");
  ok(hasNoTab(app.els), "★ .viz 带 no-tab（底纹确实被藏——这才是用户看到的现象）");

  const tabs = tabsOf(app.els);
  ok(tabs.length > 0 && tabs.every(Boolean),
     "★ .tab 仍在 DOM 里：藏起来的是**显隐**不是**创建**（t47 只看存在看不出这层，故必须在此钉死）");
}

/* ================= 场景 T86c：点击往返 + 持久化往返（偏好被记住，重载后仍收敛） ================= */
section("T86c 六线底纹 · 点击即时生效 / 偏好落热键 / 重载后仍收敛");
{
  const { beat, els, storage } = loadApp();
  els["tabToggle"].fire("click");
  eq(beat.Store.S.showTab, false, "点击 ⇒ S.showTab 翻转为 false");
  ok(isOff(els["tabToggle"]) && els["tabToggle"].getAttribute("aria-checked") === "false",
     "点击后视觉与语义同步为关（setToggle 一次写全，不漂移）");
  ok(hasNoTab(els), "★ 点击后底纹立即隐藏（syncTabLayer 被作为收尾动作调用，无需重建 DOM）");

  beat.Store.flush();                                  // 热键是防抖的，flush 立即落盘
  eq(JSON.parse(storage.get("beatsight.state")).showTab, false,
     "关掉后热键载荷 showTab=false（显示偏好跟热键走）");

  const r = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(r.beat.Store.S.showTab, false, "重载后 S.showTab 仍 false（偏好没丢）");
  ok(isOff(r.els["tabToggle"]), "★ 重载后 pill 仍为关（启动收敛——修复前这里会显示开，全是谎话）");
  ok(hasNoTab(r.els), "重载后 .viz 仍带 no-tab（视觉与偏好一致）");

  r.els["tabToggle"].fire("click");
  ok(isOn(r.els["tabToggle"]) && !hasNoTab(r.els),
     "再点击 ⇒ 恢复为开且底纹立刻现身（往返可逆）");
}

/* ================= 场景 T86d：显隐 = 偏好 AND 内容（不带扫弦记谱的型照样不铺底纹） ================= */
section("T86d 六线底纹 · 偏好开但不带扫弦记谱 ⇒ 仍不铺（合取语义不被启动收敛简化掉）");
{
  const { beat, els } = loadApp();
  beat.Store.S.sel = { type: "builtin", idx: 1 };      // 四分基础：无 dir / zone
  beat.Viz.buildViz();
  ok(isOn(els["tabToggle"]), "开关（偏好）仍是开——它不代表当前型有没有底纹");
  ok(!tabsOf(els).some(Boolean), "该型不带扫弦记谱 ⇒ 不创建任何 .tab");
  ok(hasNoTab(els),
     "★ 偏好为开也带 no-tab：显隐是 (S.showTab && hasStrum(vizPattern())) 的合取，不是单看开关");
}

/* ================= 场景 T86e：同族开关（后台保活）一并启动收敛，防同一处漏改第二个 ================= */
section("T86e 同族开关 · keepAwakeToggle 也在启动时收敛（L812 写死 off 同样会说谎）");
{
  const a = loadApp();
  eq(a.beat.Store.S.keepAwake, false, "后台保活默认关（与标记里的 off 同口径）");
  ok(isOff(a.els["keepAwakeToggle"]), "默认 pill 为关");

  const b = loadApp(seedState({ keepAwake: true }));
  eq(b.beat.Store.S.keepAwake, true, "种入 keepAwake:true ⇒ S.keepAwake=true");
  ok(isOn(b.els["keepAwakeToggle"]),
     "★ pill 视觉为开（修复前启动不收敛 ⇒ 显示 off，与已打开的保活相反）");
  eq(b.els["keepAwakeToggle"].getAttribute("aria-checked"), "true", "★ aria-checked=true（不再是写死的 false）");
}
