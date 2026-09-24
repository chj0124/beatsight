/* BeatSight 自动化测试 · 隐藏诊断面板（v2.0.4，审计 P1-1）
   T56 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   面板本身是「给维护者看的」，但**计数器是给测试看的**：它们把四类静默劣化
   （掉帧 / 调度饥饿 / 持久化失败 / 限流脉冲）从"没有任何数字可核对"变成可断言的量。
   本组要钉住的正是「这些数字在没有 UI 的情况下也必须准确」——因为 file:// 直开
   与多数老用例的沙箱都没有 location，面板根本不会挂；不能因此让计数也跟着哑掉。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive, html } = require("../lib/harness");

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

/* ================= 场景 T56g：最近错误原文的环形缓冲（v2.11.3） ================= */
section("T56g 诊断 · 最近错误原文（只留内存、有上限、进报告）");
{
  const { beat, fireWin, storage } = loadApp();
  ok(Array.isArray(beat.diagLast), "diagLast 已暴露且是数组");
  eq(beat.diagLast.length, 0, "初值为空（没出错就不该有一行'最近错误'）");

  /* window error：既计数，也留一条原文 */
  fireWin("error", { message: "Cannot read properties of undefined (reading 't')" });
  eq(beat.diag.winErr, 1, "window error → winErr +1（计数仍在）");
  eq(beat.diagLast.length, 1, "★ 同时留下一条原文（计数说不出出了什么，原文能）");
  eq(beat.diagLast[0].kind, "脚本错", "标注来源为「脚本错」");
  ok(/Cannot read properties/.test(beat.diagLast[0].msg), "原文原样保留：" + beat.diagLast[0].msg);

  /* 资源加载失败形态：没有 message，只有 target —— 不得抛、不得记成 undefined */
  fireWin("error", { target: { tagName: "IMG" } });
  eq(beat.diag.winErr, 2, "资源加载失败同样计入 winErr");
  ok(/资源加载失败/.test(beat.diagLast[1].msg), "拿不到 message 时给出可读占位：" + beat.diagLast[1].msg);

  /* 完全无信息：极端形态下也不能让诊断自己抛异常（诊断抛异常 = 掩盖真正的故障） */
  fireWin("error");
  eq(beat.diag.winErr, 3, "空事件对象 → 仍计数");
  eq(beat.diagLast[2].msg, "(无文案)", "无信息时写占位文案");

  /* unhandledrejection：reason 可以是任意值 */
  fireWin("unhandledrejection", { reason: new TypeError("boom") });
  eq(beat.diag.rejection, 1, "unhandledrejection → rejection +1");
  ok(/TypeError: boom/.test(beat.diagLast[3].msg), "reason 转字符串后留下：" + beat.diagLast[3].msg);
  fireWin("unhandledrejection", {});
  eq(beat.diagLast[4].msg, "(无 reason)", "reason 缺失时写占位文案");

  /* ★ 上限 20 条、丢最旧：unbounded 数组在一轮报错风暴里会自己吃干内存，
     而报错风暴恰恰是最需要诊断还活着的时刻 */
  for (let i = 0; i < 40; i++) beat.diagNote("脚本错", "err-" + i);
  eq(beat.diagLast.length, beat.DIAG_LAST_MAX, "超出上限后长度恒为 " + beat.DIAG_LAST_MAX
    + "（不是无限增长，实际 " + beat.diagLast.length + "）");
  ok(/err-39/.test(beat.diagLast[beat.diagLast.length - 1].msg), "留下的是最新的那条");
  ok(!beat.diagLast.some(r => /err-19$/.test(r.msg)), "最旧的已被丢掉（环形，不是数组无限堆）");

  /* 单条截断 200 字符：DOM 异常里常带整段 outerHTML */
  beat.diagNote("脚本错", "X".repeat(500));
  eq(beat.diagLast[beat.diagLast.length - 1].msg.length, 200, "单条截断到 200 字符");

  /* ★ 绝不落盘：错误原文可能含用户数据（预设名 / 歌词 / 导入的文件名）。
     判定口径：主动 flush 一次（把所有该写的都写下去），再逐键查一遍。 */
  beat.Controls.setBpm(96);
  beat.Store.flush();
  const dumped = [...storage.keys()].map(k => String(storage.get(k))).join("\n");
  ok(!/Cannot read properties/.test(dumped), "★ flush 后所有落盘键里都搜不到错误原文（只留内存）");
  ok([...storage.keys()].length > 0, "前提：确实写过盘（否则上面那条是空跑）");

  /* 报告里带着它，且空时显式写「（无）」 */
  const withErr = loadApp();
  withErr.beat.diagNote("脚本错", "报告用的一条");
  ok(/最近错误/.test(withErr.beat.diagReport()), "报告含「最近错误」一节");
  ok(/报告用的一条/.test(withErr.beat.diagReport()), "★ 原文进报告（报障时这才是硬证据）");
  const empty = loadApp();
  ok(/（无）/.test(empty.beat.diagReport()), "空缓冲时报告写「（无）」（不让人以为功能坏了）");
}

/* ================= 场景 T56h：设置里的「复制诊断信息」按钮（v2.11.3） ================= */
section("T56h 诊断 · 设置弹窗里的复制入口（不再只有 ?debug=1 够得着）");
{
  const { beat, els } = loadApp();
  ok(/id="diagCopyBtn"/.test(html), "设置弹窗里有 #diagCopyBtn（静态标记，非运行时生成）");
  /* 反向验证锚点：把按钮的 id 改掉，DOM 引用完整性检查会当场变红 */
  const before = beat.diag.winErr;
  els["diagCopyBtn"].fire("click");
  eq(beat.diag.winErr, before, "点它不会产生错误（它只读，不改状态）");
  /* 复制：剪贴板在沙箱里不存在 → 走兜底弹窗，文案必须含版本与各条计数 */
  const msg = els["modalMsg"] ? els["modalMsg"].textContent : "";
  ok(/BeatSight v/.test(msg), "剪贴板不可用时兜底为弹窗，内容以版本行开头："
    + String(msg).slice(0, 40));
  ok(/计数:/.test(msg), "兜底内容含计数（否则报障拿不到读数）");
  ok(/最近错误/.test(msg), "兜底内容含最近错误一节");
  eq(els["diagCopyBtn"].textContent === "已复制" || els["diagCopyBtn"].textContent === "复制诊断信息",
    true, "按钮文案只有这两种取值（实际：" + els["diagCopyBtn"].textContent + "）");
  /* 再次打开设置 → 文案复位（否则第二次点开看到的是上一句反馈，像是卡住了） */
  els["settingsBtn"].fire("click");
  eq(els["diagCopyBtn"].textContent, "复制诊断信息", "★ 再次打开设置 → 文案复位");
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
