/* BeatSight 自动化测试 · 弹层监听器生命周期（v2.0.4 审计 B2）
   T57 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   背景（spec.md 内存泄漏段）：Modal/Editor 动态生成节点时若绑定匿名监听器、却不在
   关闭时解绑，可能随开合次数累积。v2.0.4 把 5 个 overlay（编辑 / 统计 / 听辨 / 曲式 /
   说明）的开合收敛成 Modal.openOverlay / closeOverlay 一对原语，打开期间要绑的监听器
   统一走 Modal.bindOverlay / unbindOverlay（登记与解绑共用同一份记录）。

   测法说明（关键）：harness 的 removeEventListener 是**空操作**——真实浏览器里它才真的
   摘掉监听器。所以这里断言的是**应用级记账** Modal.overlayListenerCount(id)：它由协议
   自身维护（bind 记一条、unbind 清空并返回条数），与"真实 DOM 是否真摘掉"解耦。
   这样才拦得住"登记了却忘了解绑"的回归——这正是 checklist 要求的：
   反复开关弹层 N 次后无监听器累积（有自动化用例证明）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const CYCLES = 5;

/* 5 个 overlay 的账本 id / 入口按钮 / 所属模块（与 index.html 的 OVERLAY_IDS 对齐）。
   needSeed：曲式编排的列表/段行由数据渲染而来，空库时没有动态监听器，必须预置一条曲式。 */
/* closeMod：各模块的关闭入口名。编辑器对外只暴露 tryClose（草稿脏时先弹确认，
   未改动则直接关）——本组只开合、不改草稿，故 tryClose 走得通，且更贴近真实路径。 */
const OVERLAYS = [
  { id: "editor",         name: "编辑器",   btn: "editBtn", mod: "Editor",  closeMod: "tryClose", needSeed: false },
  { id: "settingsOverlay", name: "设置",    btn: "settingsBtn", mod: "Settings", closeMod: "close", needSeed: false },
  { id: "earOverlay",     name: "听辨训练", btn: "earBtn",  mod: "Ear",     closeMod: "close",    needSeed: false },
  { id: "arrangeOverlay", name: "曲式编排", btn: "argOpen", mod: "Arrange", closeMod: "close",    needSeed: true  },
  { id: "helpOverlay",    name: "使用方法", btn: "helpBtn", mod: "Help",    closeMod: "close",    needSeed: false },
];

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const ARRANGE_SEED = { "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "a1", name: "练习曲", sections: [
    { name: "主歌", blocks: [BL(0, 2)] },
    { name: "副歌", blocks: [BL(2, 1), BL(4, 1)] },
  ] },
]}) };

/* ================= T57：协议本身（登记 / 解绑 / 计数 / 幂等） ================= */
section("T57 弹层监听器协议 · 登记与解绑共用同一份记录");
{
  const app = loadApp();
  const M = app.beat.Modal;

  ok(typeof M.openOverlay === "function" && typeof M.closeOverlay === "function"
     && typeof M.bindOverlay === "function" && typeof M.unbindOverlay === "function"
     && typeof M.overlayListenerCount === "function",
     "★ Modal 暴露 openOverlay / closeOverlay / bindOverlay / unbindOverlay / overlayListenerCount");

  eq(M.overlayListenerCount("__不存在__"), 0, "未登记过的 id 计数为 0");
  eq(M.unbindOverlay("__不存在__"), 0, "解绑未登记的 id 返回 0（且不抛错）");

  const tgt = app.sandbox.document.createElement("button");
  const f0 = () => {}, f1 = () => {}, f2 = () => {};
  const ret = M.bindOverlay("__probe__", tgt, "click", f0);
  ok(ret === f0, "bindOverlay 原样返回 handler（调用方可留引用做 removeEventListener）");
  eq(tgt._h.click.length, 1, "确实挂到了目标元素上（addEventListener 被调用）");
  M.bindOverlay("__probe__", tgt, "keydown", f1);
  M.bindOverlay("__probe__", tgt, "click", f2);
  eq(M.overlayListenerCount("__probe__"), 3, "登记 3 条（同类型可多条）→ 计数 3");
  eq(M.unbindOverlay("__probe__"), 3, "★ unbindOverlay 一次解绑并返回解绑条数");
  eq(M.overlayListenerCount("__probe__"), 0, "解绑后计数归 0");
  eq(M.unbindOverlay("__probe__"), 0, "重复解绑返回 0（幂等，空账本不重复处理）");

  /* 未打开就关闭：安全、无副作用 */
  M.closeOverlay("editor");
  eq(M.overlayListenerCount("editor"), 0, "未打开就 closeOverlay 安全（计数仍 0）");
}

/* ================= T57b：五个 overlay · 反复开合 N 次不累积 ================= */
section("T57b 五个弹层 · 反复开合 " + CYCLES + " 次监听器不累积");
OVERLAYS.forEach(ov => {
  const app = loadApp(ov.needSeed ? ARRANGE_SEED : undefined);
  const { beat, els } = app;
  const M = beat.Modal;
  const closeFn = () => beat[ov.mod][ov.closeMod]();

  /* 元素缺失时给**具名失败**而不是崩溃：反向验证（BEATSIGHT_HTML=<旧版>）时，
     新 overlay 在旧版里不存在 —— 崩掉会中断整套件、让后面的用例都没机会跑（崩溃不算证据）。
     ★ 只查**入口按钮**：弹层容器（`#editor` / `#settingsOverlay` …）是**惰性创建**的 ——
       `Modal.openOverlay(id)` 打开时才 `$()`，因此开合之前 `els[ov.id]` 必然是 undefined，
       那不是"元素缺失"（实测定过：五个容器在 loadApp 后全是 undefined）。 */
  if (!els[ov.btn]){
    ok(false, `${ov.name}：元素不存在（入口 #${ov.btn} / 弹层 #${ov.id}）——旧版上属预期`);
    return;
  }

  /* 首次打开：静态标记里的入口按钮 → 模块 open() → 渲染出动态节点 */
  els[ov.btn].fire("click");
  ok(els[ov.id].classList.contains("open"), `${ov.name}：入口按钮可打开（挂 open 类）`);
  const n0 = M.overlayListenerCount(ov.id);
  if (ov.id === "settingsOverlay" || ov.id === "helpOverlay"){
    eq(n0, 0, `${ov.name}：该 overlay 无随内容重建的监听器（计数恒 0）`);
  } else {
    ok(n0 > 0, `★ ${ov.name}：打开即登记了动态监听器（计数 ${n0}，不是 0）`);
  }

  /* 反复关→开：每次关闭计数必须归 0，每次重开必须与首次**等量**（render 开头先 unbind）。 */
  let maxSeen = n0, closedClean = true, reopenStable = true;
  for (let k = 0; k < CYCLES; k++){
    closeFn();
    if (M.overlayListenerCount(ov.id) !== 0) closedClean = false;
    els[ov.btn].fire("click");
    const n = M.overlayListenerCount(ov.id);
    if (n > maxSeen) maxSeen = n;
    if (n !== n0) reopenStable = false;
  }
  ok(closedClean, `★ ${ov.name}：每次关闭后计数都归 0（${CYCLES} 次逐次校验）`);
  ok(reopenStable, `★ ${ov.name}：每次重开计数都等于首次的 ${n0}（不累积）`);
  ok(maxSeen === n0, `★ ${ov.name}：${CYCLES + 1} 次打开中的峰值仍是 ${n0}（未出现单调增长）`);
  closeFn();
});

/* ================= T57c：同一次打开内多次重渲染也不累积 ================= */
section("T57c 弹层内重渲染 · render 前先解绑（不只是关合时才清）");
{
  /* 编辑器：点音符格 → render() → 整棵 editorBars 重建。若 render 前不解绑，
     同一次打开里连点几次就会把计数越堆越高。 */
  const app = loadApp();
  const { beat, els } = app;
  beat.Editor.open();
  const base = beat.Modal.overlayListenerCount("editor");
  ok(base > 0, `编辑器打开后已登记监听器（计数 ${base}）`);
  const cell = els["editorBars"].children[0].children[1].children[0];   // 第 1 小节轨道里的第 1 个音符格
  cell.fire("click");
  cell.fire("click");
  cell.fire("click");
  eq(beat.Modal.overlayListenerCount("editor"), base,
     "★ 编辑器内连点音符格（每次 render 重建）计数不增长");
  beat.Editor.tryClose();                                 // 未改动草稿 → 直接关闭

  /* 曲式编排：点曲式列表项 → render() 重建列表与段行，同理 */
  const app2 = loadApp(ARRANGE_SEED);
  const b2 = app2.beat, e2 = app2.els;
  b2.Arrange.open();
  const base2 = b2.Modal.overlayListenerCount("arrangeOverlay");
  ok(base2 > 0, `曲式编排打开后已登记监听器（计数 ${base2}）`);
  e2["argList"].children[0].fire("click");
  e2["argList"].children[0].fire("click");
  eq(b2.Modal.overlayListenerCount("arrangeOverlay"), base2,
     "★ 曲式编排内反复点列表项（每次 render 重建）计数不增长");
  b2.Arrange.close();
}

/* ================= T57d：无动态监听器的两个 overlay 行为不回退 ================= */
section("T57d 统计 / 使用方法 · 开合行为与 inert 契约不变");
{
  const app = loadApp();
  const { beat, els } = app;
  const mainBg = app.sandbox.document.getElementById("mainBg");

  [["Settings", "settingsOverlay", "设置"], ["Help", "helpOverlay", "使用方法"]].forEach(([modKey, id, name]) => {
    const mod = beat[modKey];
    /* 反向验证（旧版）守卫：旧版没有 Settings 模块 —— 具名失败而不是崩溃 */
    if (!mod){ ok(false, `${name}：模块 ${modKey} 不存在（旧版上属预期）`); return; }
    mod.open();
    ok(els[id].classList.contains("open"), `${name}：openOverlay 挂上 open 类`);
    eq(mainBg.inert, true, `★ ${name} 打开 → 背景置 inert`);
    eq(beat.Modal.overlayListenerCount(id), 0, `${name}：确实没有动态监听器（计数 0）`);
    mod.close();
    ok(!els[id].classList.contains("open"), `${name}：closeOverlay 摘掉 open 类`);
    eq(mainBg.inert, false, `${name} 关闭 → 摘除 inert`);
  });
}

/* ================= T57e：open 幂等（重复打开不重复登记 untrap） ================= */
section("T57e 弹层 · 重复 open 幂等（不覆盖焦点归还闭包）");
{
  const app = loadApp(ARRANGE_SEED);
  const { beat, els } = app;
  beat.Arrange.open();
  const n0 = beat.Modal.overlayListenerCount("arrangeOverlay");
  beat.Arrange.open();                                  // 已开再开：openOverlay 走幂等分支
  eq(beat.Modal.overlayListenerCount("arrangeOverlay"), n0,
     "★ 已打开时再 open，计数不翻倍（openOverlay 幂等 + render 先解绑）");
  ok(els["arrangeOverlay"].classList.contains("open"), "重复 open 后仍是打开态");
  beat.Arrange.close();
  eq(beat.Modal.overlayListenerCount("arrangeOverlay"), 0, "关闭后归 0");

  /* 关闭后返回焦点：这一路径由协议统一负责，不能被幂等分支吃掉 */
  ok(!els["arrangeOverlay"].classList.contains("open"), "close 后 open 类已摘（焦点归还闭包执行过）");
}

/* ================= T57f：设置浮层小窗「点窗外即关」 ================= */
/* v2.10.13（用户反馈「不是我想象中的那种弹窗」）：设置从全屏页面式改为 Dialog 形态——
   不全屏、点窗外直接退出。backdrop 就是根元素本身（.dialog-panel 是它唯一的子块），
   所以判据与 Modal 自己那条 modalMask 完全同款：e.target === e.currentTarget 才关。
   桩的 fire 默认 target = currentTarget = 被触发的元素——正好就是「点了窗外」；
   传 { target: 面板内元素 } 则模拟「点了窗内」，不该关。 */
section("T57f 设置浮层小窗 · 点窗外即关、点窗内不关、Esc 仍关");
{
  const app = loadApp();
  const { beat, els } = app;
  /* 反向验证（旧版）守卫：v2.10.12 及更早没有这条行为路径，属预期失败 */
  if (!els["settingsBtn"] || !beat.Settings){
    ok(false, "设置：元素/模块不存在（旧版上属预期）");
  } else {
    beat.Settings.open();
    ok(els["settingsOverlay"].classList.contains("open"), "前提：设置已打开");
    /* 点窗外（backdrop = 根元素）→ 关 */
    els["settingsOverlay"].fire("click");
    ok(!els["settingsOverlay"].classList.contains("open"),
      "★ 点窗外（target === currentTarget）→ 直接关闭");
    /* 点窗内（面板里的按钮冒泡上来）→ 不关 */
    beat.Settings.open();
    els["settingsOverlay"].fire("click", { target: els["themeToggle"] });
    ok(els["settingsOverlay"].classList.contains("open"),
      "★ 点窗内（target ≠ currentTarget，如主题按钮）→ 不关闭");
    /* ✕ 关闭钮（id 不变）仍可关 */
    els["settingsClose"].fire("click");
    ok(!els["settingsOverlay"].classList.contains("open"), "右上角 ✕（#settingsClose）仍可关闭");
    /* Esc 路由不受形态变更影响：Controls 的 keydown 分支查 Settings.isOpen() 原样保留 */
    beat.Settings.open();
    app.fireWin("keydown", { key: "Escape" });
    ok(!els["settingsOverlay"].classList.contains("open"), "Esc 仍可关闭（键盘路由不受形态变更影响）");
  }
}
