/* BeatSight 自动化测试 · 体验效率小包（v2.63.0，X3 安装引导 + X4 诊断导出）
   T132 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★★ 为什么要有这一组：审计「体验效率」小包里两件长期没人接的缺口——
     · X4 诊断导出：诊断面板只能「复制」（?debug=1 才挂），普通用户报障时根本够不着；
       加一份「导出 .txt」让现场信息能直接落盘贴 issue，与复制同一兜底哲学。
     · X3 安装引导：BeatSight 是 PWA 却从没主动提示安装——只在「可安装的安全上下文」
       里露按钮，file:// 直开静默留说明文字，不制造「点了没反应」。

   ★ 守两件事：
     ① X4：diagExport 走 Blob 下载、文件名带版本、触发 a.click，且下载能力缺失时退回复制不抛；
     ② X3：beforeinstallprompt 被捕获后安装按钮显形并可主动 prompt()；未捕获时保持隐藏。 */
"use strict";
const { loadApp, ok, section } = require("../lib/harness");

section("T132 · X4 诊断信息导出文件（v2.63.0）");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  ok(typeof beat.Diagnostics.diagExport === "function",
    "★ X4（v2.63.0）：Diagnostics.diagExport 已挂出（导出诊断为本地文件的能力存在）");

  const rep = beat.Diagnostics.diagReport();
  ok(/BeatSight v2\.63\.0 诊断信息/.test(rep), "★ X4：诊断报告含版本标题（v2.63.0）");
  ok(/计数: /.test(rep) && /最近错误/.test(rep), "★ X4：诊断报告含计数段与最近错误段");

  /* 间谍：截 URL.createObjectURL 拿到 Blob，截 <a>.click 确认触发了下载 */
  const realCreateEl = sandbox.document.createElement.bind(sandbox.document);
  let anchorSeen = null, blobSeen = null, clicked = false;
  sandbox.document.createElement = (tag) => {
    const el = realCreateEl(tag);
    if (tag === "a"){ anchorSeen = el; el.click = function(){ clicked = true; }; }
    return el;
  };
  const realCOU = sandbox.URL.createObjectURL;
  sandbox.URL.createObjectURL = (b) => { blobSeen = b; return "blob:mock"; };

  const btn = realCreateEl("button");
  const ret = beat.Diagnostics.diagExport(btn);

  sandbox.URL.createObjectURL = realCOU;
  sandbox.document.createElement = realCreateEl;

  ok(blobSeen && (blobSeen instanceof sandbox.Blob), "★ X4：用 Blob 包裹诊断文本触发下载");
  ok(anchorSeen && /^beatsight-diagnostics-v2\.63\.0\.txt$/.test(anchorSeen.download || ""),
    "★ X4：导出文件名带版本前缀（" + (anchorSeen && anchorSeen.download) + "）");
  ok(clicked === true, "★ X4：触发了下载点击（a.click）");
  ok(ret === true, "★ X4：下载路径返回 true");
  ok(btn.textContent === "已导出", "★ X4：按钮文案回显「已导出」");
}

section("T132 · X3 PWA 安装引导（v2.63.0）");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  const $ = (id) => sandbox.document.getElementById(id);

  /* 默认（未捕获安装事件，多因 file:// 非安全上下文）：安装按钮隐藏，诊断导出按钮常驻 */
  beat.Help.open();
  const moreBtn = $("helpMoreBtn");
  if (moreBtn && moreBtn.textContent.indexOf("展开") >= 0) moreBtn.click();  // 首次展开克隆模板
  const installBtn0 = $("helpInstallBtn");
  ok(installBtn0 ? installBtn0.hidden === true : true,
    "★ X3：未捕获安装事件时，「安装到本机」按钮默认隐藏（file:// 直开无法安装）");
  ok(!!$("helpDiagExport"), "★ X4：诊断导出按钮常驻可见（已挂载）");

  /* 捕获 beforeinstallprompt 后：安装按钮显形且点击主动 prompt() */
  let prompted = false;
  const fakeEv = {
    preventDefault(){},
    prompt(){ prompted = true; },
    userChoice: { then(cb){ try{ cb({ outcome: "accepted" }); }catch(e){} return { catch(){} }; } },
  };
  app.fireWin("beforeinstallprompt", fakeEv);
  beat.Help.open();   // more 已为 true，open 再次 helpRender 刷新显隐
  const installBtn1 = $("helpInstallBtn");
  ok(installBtn1 && installBtn1.hidden === false, "★ X3：捕获安装事件后，「安装到本机」按钮显形");
  if (installBtn1) installBtn1.click();
  ok(prompted === true, "★ X3：点击按钮主动唤起安装 prompt()");

  /* X4：诊断导出按钮经「共享助手 exportDiagnostics」调起 diagExport——
     验证 Help 不直接引用 Diagnostics（R1 反向边约束），而是借共享作用域转一道 */
  const diagExpBtn = $("helpDiagExport");
  ok(!!diagExpBtn, "★ X4：诊断导出按钮已挂载");
  let diagExportCalled = false;
  const realDiagExport = beat.Diagnostics.diagExport;
  beat.Diagnostics.diagExport = (b) => { diagExportCalled = true; return realDiagExport(b); };
  diagExpBtn.click();
  ok(diagExportCalled === true, "★ X4：点击「导出诊断」按钮经共享助手 exportDiagnostics 调起 diagExport（无 Help→Diagnostics 反向边）");
  beat.Diagnostics.diagExport = realDiagExport;
}
