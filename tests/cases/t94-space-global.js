/* BeatSight 自动化测试 · 空格键全局 = 播放/暂停（v2.13.1）
   T94 系列。
   ---------------------------------------------------------------------------
   用户实报："点击过页面其他位置或功能后，空格键就不能起到暂停或播放的作用了。"
   根因：Controls 的全局 keydown 旧规则按焦点元素**排除**
   （INPUT / BUTTON / SELECT / TEXTAREA 与 role=button）——而**滑杆**（BPM / 音量 /
   播放范围）与**侧栏预设项**点完焦点留在原地（按钮们各自 blur() 自救，它们没有），
   空格于是要么被排除、要么被项自己的 itemKeys 抢去当"重新选中"。
   本文件钉新契约：
     · 主界面任何焦点下空格都切播放——唯一例外是「该焦点自己要用键盘」（ownsKeyboard，
       v3.33.14 前叫 isTextEntry）；
     · 主界面 role=button 项改 Enter-only（空格不再被消费）；
     · 面板（overlay）打开时维持"空格不误触播放"（各自用例已有，这里留一条设置面板的）；
     · 顺带收口：修饰键（Ctrl/Cmd/Alt+Space）与长按 repeat 不抢。
   ★★★ v3.33.14（审计 P1-1，T94h–T94k）：**例外名单补 `<select>`**。
     原判据只认"输入文字"，下拉框被当成"可以抢键"的普通焦点，实测三条后果：
       · 空格 → 切播放，下拉打不开；
       · ↑↓  → 走 setBpm，**速度被静默改写**，选项不切（最严重：用户没要求改速）；
       · e/h/? → 弹出曲式编排 / 使用方法 / 键位表。
     键盘用户因此无法用键盘操作 9 个下拉框（#sigSel / #loopFrom / #loopTo /
     #muteEvery / #muteCount / #editorMeterSel / #latProfileSel …）——**阻断级**。
     根因形状记在这里：v2.13.1 为修"点过滑杆后空格哑了"把排除名单收窄成"仅文本输入"，
     **顺手把 SELECT 从旧名单里一起删了**——修一个契约时删掉了另一个契约的例外。
   ★ 结构要点：三条规则（空格 / 方向键 / 单键）共用**同一个守卫**，故改一处即全覆盖；
     T94k 钉住"三条都走同一个函数"，防止日后有人给某条规则单独写一份判据。
   桩没有真实焦点模型：activeElement 是个普通对象（harness 默认 {tagName:"DIV"}），
   本文件把焦点摆成**真实形状**（input[type=range] / button / role=button 的 div /
   **SELECT**）——与 t86 同一条教训的反面用法：形状必须显式摆出来，
   否则"排除名单里都有谁"根本测不到（SELECT 就是这样漏掉的：151 个用例文件里
   只有本文件提到它，而且还只是描述旧规则的注释）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* 发一次空格键。返回 preventDefault 是否被调用（真实浏览器里它决定
   "按钮的原生空格激活会不会同时发生"——不拦就是双动作）。 */
function fireSpace(app, ev){
  let prevented = false;
  app.fireWin("keydown", Object.assign({
    code: "Space",
    preventDefault(){ prevented = true; },
  }, ev || {}));
  return prevented;
}

/* ================= 场景 T94a：基线 —— 焦点在页面空白处 ================= */
section("T94a 空格基线 · 焦点在页面（DIV）→ 切播放，两个方向都通");
{
  const app = loadApp();
  const S = app.beat.Store.S;
  ok(!S.playing, "初始未播放");
  fireSpace(app);
  ok(S.playing, "空格 → 开始播放");
  fireSpace(app);
  ok(!S.playing, "再按空格 → 停止");
}

/* ================= 场景 T94b：滑杆 —— 本次修复的主角 ================= */
section("T94b ★ 滑杆（input[type=range]）上按空格：仍然切播放（旧规则下这里是哑的）");
{
  const app = loadApp();
  const S = app.beat.Store.S;
  /* 真实路径：点/拖过 BPM、音量、播放范围任意一条滑杆后，焦点留在 input[type=range] 上 */
  app.sandbox.document.activeElement = { tagName: "INPUT", type: "range" };
  const prevented = fireSpace(app);
  ok(S.playing, "★ 焦点在滑杆上，空格依然切播放（修复「点过滑杆之后空格哑了」）");
  ok(prevented, "并 preventDefault（滑杆没有默认的空格行为，拦下来只为让规则唯一）");
  fireSpace(app);
  ok(!S.playing, "再按一次 → 停止（两个方向都通）");
  app.sandbox.document.activeElement = { tagName: "DIV" };   // 复位，不留给后续断言
}

/* ================= 场景 T94c：真按钮 —— 切播放，且不让原生空格激活叠一手 ================= */
section("T94c ★ 真按钮（button）上按空格：切播放，不再「激活按钮」");
{
  const app = loadApp();
  const S = app.beat.Store.S;
  app.sandbox.document.activeElement = { tagName: "BUTTON" };
  const prevented = fireSpace(app);
  ok(S.playing, "★ 焦点在按钮上，空格切播放（按 Enter 才是「激活这个按钮」）");
  ok(prevented, "★ preventDefault 拦下按钮的原生空格激活（不拦的话 keyup 的 click 会再叠一次）");
}

/* ================= 场景 T94d：侧栏预设项 —— 不再消费空格，焦点在项上仍切播放 ================= */
section("T94d ★ 侧栏预设项：itemKeys 改 Enter-only，焦点在项上空格照常切播放");
{
  const app = loadApp();
  const { beat, els, sandbox } = app;
  const S = beat.Store.S;
  const listItems = () => els["presetList"].children.filter(c => c._h && c._h.click);
  const deepText = el => String(el.textContent || "") + (el.children || []).map(deepText).join("");
  const itemByName = nm => listItems().find(c => deepText(c).includes(nm));

  /* 模拟"点过节奏型"：点选后焦点留在该项上（.preset-item 不像按钮那样自行 blur） */
  itemByName(beat.BUILTINS[3].name).fire("click");
  eq(S.sel.idx, 3, "点选内置预设 3（选中项随点击走）");
  const it3 = itemByName(beat.BUILTINS[3].name);
  /* ① 向**另一项**发空格：选中必须纹丝不动（旧契约下空格会把选中抢到它身上——
     对同一项重复选中的写法测不出这条，第一版就是这么写弱的） */
  itemByName(beat.BUILTINS[5].name).fire("keydown", { key: " ", code: "Space" });
  eq(S.sel.idx, 3, "★ 项自身不再消费空格（Enter-only：选中不变）");
  sandbox.document.activeElement = it3;
  const prevented = fireSpace(app);
  ok(S.playing, "★ 焦点在预设项上，空格切播放（用户实报路径的修复点）");
  ok(prevented, "全局分支照常 preventDefault（规则唯一：空格只做播放/暂停）");
  /* Enter 仍是激活键（回归钉子：enterOnly 不许误伤 Enter） */
  itemByName(beat.BUILTINS[5].name).fire("keydown", { key: "Enter" });
  eq(S.sel.idx, 5, "Enter 仍激活预设项");
  eq(itemByName(beat.BUILTINS[5].name).getAttribute("aria-current"), "true", "当前项带 aria-current");
}

/* ================= 场景 T94e：唯一例外 —— 正在输入文字 ================= */
section("T94e 正在输入文字是唯一例外：文本输入不吃空格；range 是反例对照");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  const S = beat.Store.S;
  for (const ae of [
    { tagName: "INPUT", type: "text" },
    { tagName: "INPUT", type: "number" },     // 主界面的「预备拍拍数」就是它
    { tagName: "TEXTAREA" },
    { tagName: "DIV", isContentEditable: true },
  ]){
    sandbox.document.activeElement = ae;
    const prevented = fireSpace(app);
    ok(!S.playing, "焦点=" + ae.tagName + (ae.type ? "[" + ae.type + "]" : "") + " 时空格不切播放（让位给输入）");
    ok(!prevented, "且不拦截（输入框里的空格照常打得出来）");
  }
  /* 反例对照：同样显式给了 type，但 range 必须切——防"看到 INPUT 就一刀切放走"的回归 */
  sandbox.document.activeElement = { tagName: "INPUT", type: "range" };
  fireSpace(app);
  ok(S.playing, "★ 对照组：type=range 仍然切播放（例外只给文本类输入）");
}

/* ================= 场景 T94f：修饰键与长按 ================= */
section("T94f 组合键与长按：Ctrl/Cmd/Alt+Space 不抢，repeat 不连发");
{
  const app = loadApp();
  const S = app.beat.Store.S;
  fireSpace(app, { ctrlKey: true });
  ok(!S.playing, "Ctrl+Space 不切播放（输入法 / 系统语义）");
  fireSpace(app, { metaKey: true });
  fireSpace(app, { altKey: true });
  ok(!S.playing, "Meta/Alt+Space 同样不切");
  fireSpace(app, { repeat: true });
  ok(!S.playing, "★ 长按产生的 repeat 事件不切播放（旧规则下按住空格会来回切）");
  fireSpace(app);
  ok(S.playing, "普通单击仍然切（对照组，防「收紧到什么都不响应」）");
  /* 对照：带 repeat 的普通字符键本来就无关——这里再验一次"只有 Space 走这条路" */
  app.fireWin("keydown", { code: "Enter" });
  ok(S.playing, "Enter 不影响播放开关（键盘规则只挂在 Space 上）");
}

/* ================= 场景 T94g：面板内维持现状（回归钉子） ================= */
section("T94g 设置面板打开时空格不误触播放（键盘归面板管，全局分支早退）");
{
  const app = loadApp();
  const { beat } = app;
  beat.Controls.start();
  beat.Settings.open();
  eq(beat.Settings.isOpen(), true, "设置面板已打开");
  const prevented = fireSpace(app);
  eq(beat.Store.S.playing, true, "★ 面板打开时空格不误触停止（各 overlay 的既有契约不变）");
  ok(!prevented, "全局分支早退、不拦截（面板内键盘语义不受影响）");
  beat.Settings.close();
  fireSpace(app);
  ok(!beat.Store.S.playing, "关闭面板后空格恢复可用（切回停止）");
}

/* ================= 场景 T94h：下拉框让位（v3.33.14，审计 P1-1） ================= */
section("T94h ★★★ 下拉框 <select> 独占键盘：空格归下拉（展开/收起），不切播放");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  const S = beat.Store.S;
  sandbox.document.activeElement = { tagName: "SELECT" };
  const prevented = fireSpace(app);
  ok(!S.playing, "★★ 焦点在下拉框时空格不切播放（空格归下拉自己用）");
  ok(!prevented, "且不拦截（原生展开动作照常发生）");
  /* 反例对照：焦点挪回页面后空格必须恢复——防「收紧到什么都不响应」的反向回归 */
  sandbox.document.activeElement = { tagName: "DIV" };
  fireSpace(app);
  ok(S.playing, "★ 对照组：焦点离开下拉后空格恢复切播放（只让位给下拉，不是废掉空格）");
}

/* ================= 场景 T94i：下拉框聚焦时 ↑↓ 切选项而不是改 BPM（主症） ================= */
section("T94i ★★★ 下拉框聚焦时 ↑↓ 改的是选项，不是 BPM（审计 P1-1 的主症）");
{
  /* ★ 每个方向各起**一份新 app**：反向验证时踩过坑——若在同一份 app 上先按 ↑ 再按 ↓，
     变异副本里 ↑ 已把 BPM 推到 97，↓ 又把它拉回 96，恰好等于起始值 ⇒ **↓ 那条断言假绿**
     （实测变异结果：8 条红里没有它）。断言之间互相抵消是比"没写断言"更隐蔽的失效，
     故两条方向各自独立取样。 */
  const withSelect = key => {
    const app = loadApp();
    const { beat, sandbox } = app;
    const bpm0 = beat.Store.S.bpm;
    sandbox.document.activeElement = { tagName: "SELECT" };
    app.fireWin("keydown", key);
    return { app, bpm0, after: beat.Store.S.bpm };
  };
  {
    const r = withSelect({ key: "ArrowUp" });
    ok(r.bpm0 > 0, "前提：拿到一个有效起始 BPM（" + r.bpm0 + "）");
    eq(r.after, r.bpm0, "★★ ↑ 不改 BPM（修复前：静默 +1）");
  }
  {
    const r = withSelect({ key: "ArrowDown" });
    eq(r.after, r.bpm0, "★★ ↓ 不改 BPM（修复前：静默 −1）");
  }
  {
    const r = withSelect({ key: "ArrowUp", shiftKey: true });
    eq(r.after, r.bpm0, "Shift+↑ 同样不改 BPM（防只堵了不带修饰键那条）");
  }
  /* 对照组：焦点不在下拉时 ↑↓ 必须照常改 BPM——防「把方向键整体废掉」 */
  {
    const app = loadApp();
    const { beat, sandbox } = app;
    const bpm0 = beat.Store.S.bpm;
    sandbox.document.activeElement = { tagName: "DIV" };
    app.fireWin("keydown", { key: "ArrowUp" });
    eq(beat.Store.S.bpm, bpm0 + 1, "★ 对照组：焦点在页面时 ↑ 照常 +1 BPM（v2.64.0 契约未受影响）");
    const b1 = beat.Store.S.bpm;
    app.fireWin("keydown", { key: "ArrowDown" });
    eq(beat.Store.S.bpm, b1 - 1, "★ 对照组：焦点在页面时 ↓ 照常 −1 BPM");
  }
}

/* ================= 场景 T94j：下拉框聚焦时单键快捷键不开面板 ================= */
section("T94j ★ 下拉框聚焦时 e / h / ? 不开面板（同一守卫覆盖第三条规则）");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  sandbox.document.activeElement = { tagName: "SELECT" };
  app.fireWin("keydown", { key: "e" });
  eq(beat.Arrange.isOpen(), false, "★ e 不开曲式编排");
  app.fireWin("keydown", { key: "h" });
  eq(beat.Help.isOpen(), false, "★ h 不开使用方法");
  const more0 = beat.Help.more();
  app.fireWin("keydown", { key: "?" });
  eq(beat.Help.isOpen(), false, "★ ? 不开使用方法（键位表）");
  eq(beat.Help.more(), more0, "? 也不改「完整说明」展开态");
  /* 对照组：焦点回到页面后 e 照常开编排 */
  sandbox.document.activeElement = { tagName: "DIV" };
  app.fireWin("keydown", { key: "e" });
  eq(beat.Arrange.isOpen(), true, "★ 对照组：焦点在页面时 e 照常开曲式编排");
}

/* ================= 场景 T94k：源码钉 —— 判据在位 + 三条规则同一守卫 ================= */
section("T94k 源码钉：ownsKeyboard 含 SELECT，三条规则共用同一守卫");
{
  const src = html;
  const fn = /const ownsKeyboard = el => \{([\s\S]{0,600}?)\n  \};/.exec(src);
  ok(!!fn, "★ 判定函数在位（v3.33.14 由 isTextEntry 改名而来）");
  if (fn){
    ok(fn[1].indexOf('el.tagName === "SELECT"') >= 0,
      "★★ 判据含 SELECT（撤掉这一行 = 下拉框键盘重新被抢，T94h/T94i/T94j 全红）");
    ok(fn[1].indexOf('el.tagName === "TEXTAREA"') >= 0, "文本域判据仍在（改名不许顺手删判据）");
    ok(fn[1].indexOf("isContentEditable === true") >= 0, "可编辑区判据仍在");
  }
  /* 三条规则（空格 / 方向键+单键）必须走**同一个**守卫——本次修复的结构性保证 */
  ok(src.indexOf("&& !ownsKeyboard(ae))") >= 0, "★ 空格分支用 ownsKeyboard 守卫");
  ok(src.indexOf("if (!ownsKeyboard(ae) && !e.ctrlKey") >= 0, "★ 方向键 / 单键分支用同一守卫");
  /* 旧名只许出现在"改名说明"的注释里，不许还有调用点 */
  ok(src.indexOf("isTextEntry(") < 0, "★ 旧名 isTextEntry 已无调用点残留（改名要改干净）");
}
