/* BeatSight 自动化测试 · 隐藏诊断面板（v2.0.4，审计 P1-1）
   T56 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   面板本身是「给维护者看的」，但**计数器是给测试看的**：它们把四类静默劣化
   （掉帧 / 调度饥饿 / 持久化失败 / 限流脉冲）从"没有任何数字可核对"变成可断言的量。
   本组要钉住的正是「这些数字在没有 UI 的情况下也必须准确」——因为 file:// 直开
   与多数老用例的沙箱都没有 location，面板根本不会挂；不能因此让计数也跟着哑掉。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

/* 面板 DOM 的探针：body 的直接子节点里 class 含 `diag` 的那个（`diag-line` 不会被误判——
   判据要求 `diag` 后紧跟空格或结尾） */
const panels = app => app.sandbox.document.body.children.filter(c => /(^| )diag( |$)/.test(c.className || ""));
const lineOf = app => { const p = panels(app)[0]; return p ? p.children[1].textContent : "(未挂载)"; };

/* ================= 场景 T56：计数器恒存在 ================= */
section("T56 诊断面板 · 计数器恒存在（无 location 也照样记账）");
{
  const { beat, sandbox } = loadApp();
  ok(beat.diag && typeof beat.diag === "object", "window.__beat.diag 已暴露");
  eq(JSON.stringify(beat.diag),
    JSON.stringify({ frameErr: 0, schedErr: 0, persistFail: 0, persistRecover: 0, limitPulse: 0,
      reanchorStarved: 0, reanchorOverflow: 0, winErr: 0, rejection: 0, noStamp: 0, stampMismatch: 0,
      keepAliveFail: 0 }),
    "全部计数器初值全为 0（v2.0.6 起重锚两档 + 脚本错/未捕获；v2.4.4 起戳记缺失/版本不符两档；"
    + "v2.8.8 起保活兜底失败——新增计数器必须同步改本断言，否则会静默少算一类静默失效）");
  eq(panels({ sandbox }).length, 0, "没有 ?debug=1 → 不挂面板 DOM（零视觉、零布局开销）");
  ok(beat.VERSION && lineOf({ sandbox }) === "(未挂载)", "未挂面板时读取探针也不抛");
}

/* ================= 场景 T56b：开关判定 ================= */
section("T56b 诊断面板 · 开关只认 ?debug=1（含参数解析边界）");
{
  const on = loadApp({}, { location: { search: "?debug=1", protocol: "https:" } });
  eq(panels(on).length, 1, "?debug=1 → 挂一行面板");
  const box = panels(on)[0];
  eq(box.getAttribute("role"), "status", "面板 role=status（计数变化不只对眼睛可见）");
  ok(/^诊断 · v/.test(box.children[0].textContent), "标题带版本：" + box.children[0].textContent);
  ok(lineOf(on).indexOf("渲染异常 0") === 0, "初始计数行从 0 起："
    + lineOf(on) + "（v2.0.6 起首项叫「渲染异常」——原名「掉帧」名不副实：它数的是帧内抛异常次数）");

  const mid = loadApp({}, { location: { search: "?x=1&debug=1", protocol: "https:" } });
  eq(panels(mid).length, 1, "debug=1 不在首位也认（按参数解析，不是前缀匹配）");
  const no12 = loadApp({}, { location: { search: "?debug=12", protocol: "https:" } });
  eq(panels(no12).length, 0, "debug=12 ≠ debug=1（不误判成开启）");
  const off = loadApp({}, { location: { search: "?debug=0", protocol: "https:" } });
  eq(panels(off).length, 0, "debug=0 → 关闭");

  /* 防御性守卫：location.search 读取即抛时，加载期不得被带崩（整体静默关闭） */
  const hostile = loadApp({}, { location: { get search(){ throw new Error("hostile location"); }, protocol: "https:" } });
  eq(panels(hostile).length, 0, "location.search 读取即抛 → 面板静默关闭，应用照常加载");
  eq(hostile.beat.diag.persistFail, 0, "静默关闭不影响计数器本体");
}

/* ================= 场景 T56c：持久化失败/恢复计数 ================= */
section("T56c 诊断面板 · 持久化失败/恢复计数（D5 的出口也要被数到）");
{
  const app = loadApp({}, { throwOnWrite: true });
  app.beat.Controls.setBpm(150);
  app.beat.Store.flush();
  eq(app.beat.diag.persistFail, 1, "写失败 → persistFail 计一次");
  eq(app.beat.diag.persistRecover, 0, "此时尚未恢复");

  app.els["modalOk"].fire("click");                                          // 关掉失败弹窗
  app.sandbox.localStorage.setItem = (k, v) => app.storage.set(k, String(v)); // 模拟配额/隐私模式恢复
  app.beat.Store.flush();
  eq(app.beat.diag.persistRecover, 1, "写恢复 → persistRecover 计一次（与失败配对）");
  eq(app.beat.diag.persistFail, 1, "恢复不增加失败计数");

  app.sandbox.localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  app.beat.Store.flush();
  eq(app.beat.diag.persistFail, 2, "再次失败 → 继续累加（计数不因一次性通知闸门而停摆）");
}

/* ================= 场景 T56d：掉帧 / 调度异常计数 ================= */
section("T56d 诊断面板 · 掉帧 / 调度异常计数（复用 onFrameError / onSchedError 钩子）");
{
  const f = loadApp();
  f.beat.Controls.start();
  drive(FakeAudioContext.last, f.beat, 0.5);
  const statusEl = f.sandbox.document.getElementById("statusText");
  Object.defineProperty(statusEl, "textContent", {
    set(){ throw new Error("注入的渲染故障"); }, get(){ return ""; }, configurable: true,
  });
  f.beat.Viz.paintFrame();
  eq(f.beat.diag.frameErr, 1, "帧内异常 → frameErr 计一次（与 T23f 同一条收口路径）");
  eq(f.beat.diag.schedErr, 0, "互不串台：渲染异常不污染调度计数");

  const s = loadApp();
  s.beat.Controls.start();
  drive(FakeAudioContext.last, s.beat, 0.3);
  let hits = 0;
  Object.defineProperty(s.sandbox.document, "hidden", {
    get(){ hits++; throw new Error("注入的调度故障"); }, set(){}, configurable: true,
  });
  s.beat.AudioEngine.scheduler();
  ok(hits > 0, "调度故障确实被触发（证明本用例有效）");
  eq(s.beat.diag.schedErr, 1, "调度期异常 → schedErr 计一次（与 T23h 同构）");
  eq(s.beat.diag.frameErr, 0, "互不串台：调度异常不污染掉帧计数");
}

/* ================= 场景 T56e：限流脉冲只计「真的到点停播」 ================= */
section("T56e 诊断面板 · 限流脉冲只计真停播（不被 40/s 轮询淹没）——驱动源现为听辨训练的会话额度");
{
  /* v2.10.12：练习量删除后，驱动 `limitPulse` 的只剩**听辨训练的会话额度**
     （进入听辨 → `playQuota = EAR_BARS` 2 小节 → 放满自动停）。计数语义不变：
     未到点不计、到点恰计一次。 */
  const { beat, els } = loadApp();
  els["earBtn"].fire("click");                      // 进入听辨训练：自动放 2 小节
  const ac = FakeAudioContext.last;
  /* 未到点前，钩子每 25ms 被问一次却必须**不计**——否则计数器以 40/s 空转，
     把"到点触发了几次"这个唯一有意义的读数彻底淹没 */
  eq(drive(ac, beat, 1), false, "前提：1 秒时仍在播放（2 小节 @240BPM = 2s）");
  eq(beat.diag.limitPulse, 0, "播放中反复轮询 → 不计数");
  eq(drive(ac, beat, 40), true, "额度到点 → 自动停止");
  eq(beat.Store.S.playing, false, "已停止");
  eq(beat.diag.limitPulse, 1, "到点停播 → limitPulse 恰计一次（不是每次轮询都计）");
  ok(!/已练满/.test(els["statusText"].textContent), "练习量的到点文案已随练习量删除");
}

/* ================= 场景 T56f：面板文本随计数刷新 ================= */
section("T56f 诊断面板 · 计数变化即时反映到面板文本");
{
  const app = loadApp({}, { throwOnWrite: true, location: { search: "?debug=1", protocol: "https:" } });
  eq(panels(app).length, 1, "前提：?debug=1 已挂面板");
  app.beat.Controls.setBpm(150);
  app.beat.Store.flush();
  ok(lineOf(app).indexOf("存失败 1") >= 0, "写失败后计数行同步更新：" + lineOf(app));
  ok(lineOf(app).indexOf("渲染异常 0") >= 0, "未触发的维度保持 0（读数可对照）");
}
