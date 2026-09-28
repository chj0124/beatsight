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
const { loadApp, ok, section, html } = require("../lib/harness");

section("T132 · X4 诊断信息导出文件（v2.63.0）");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  ok(typeof beat.Diagnostics.diagExport === "function",
    "★ X4（v2.63.0）：Diagnostics.diagExport 已挂出（导出诊断为本地文件的能力存在）");

  const rep = beat.Diagnostics.diagReport();
  ok(new RegExp("BeatSight v" + beat.VERSION + " 诊断信息").test(rep), "★ X4：诊断报告含版本标题（v" + beat.VERSION + "）");
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
  ok(anchorSeen && new RegExp("^beatsight-diagnostics-v" + beat.VERSION + "\\.txt$").test(anchorSeen.download || ""),
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

  /* v2.69.0（2.2）：安装/导出两按钮迁入设置弹窗（静态元素、常驻 DOM），使用方法页只留指路。
     默认（未捕获安装事件，多因 file:// 非安全上下文）：安装按钮隐藏；
     打开设置（经 settingsBtn 接线链）触发 Help.refreshInstall() 刷显隐。 */
  beat.Help.open();
  const moreBtn = $("helpMoreBtn");
  if (moreBtn && moreBtn.textContent.indexOf("展开") >= 0) moreBtn.click();  // 首次展开克隆模板
  /* 桩 DOM 是平的（getElementById 无视位置），「按钮不在使用方法页」只能走源码级断言：
     helpMoreTpl 模板块内不得再出现两枚按钮的 id */
  const tplAt = html.indexOf('<template id="helpMoreTpl"');
  const tplEnd = html.indexOf("</template>", tplAt);
  const tpl = html.slice(tplAt, tplEnd);
  ok(tpl.indexOf('id="helpInstallBtn"') === -1 && tpl.indexOf('id="helpDiagExport"') === -1,
    "★ v2.69.0：使用方法页不再有安装/导出按钮（已迁设置，防双入口漂移）");

  $("settingsBtn").click();   // 打开设置：接线链 = 开 overlay + 复位诊断文案 + refreshInstall
  /* v2.69.0 返工（用户拍板「常显」）：不可安装环境按钮置灰而非隐藏——
     原方案在 file:// 下永远不可见，用户实报"找不到按钮" */
  const installBtn0 = $("helpInstallBtn");
  ok(installBtn0 && installBtn0.hidden === false && installBtn0.disabled === true,
    "★ X3：未捕获安装事件时，设置里的「安装到本机」常显但置灰（file:// 直开无法安装）");
  ok(!!$("helpDiagExport"), "★ X4：导出诊断按钮常驻（设置 · 诊断与自验组）");

  /* 捕获 beforeinstallprompt 后：重新打开设置（refreshInstall 刷置灰态）→ 安装钮解禁且点击主动 prompt() */
  let prompted = false;
  const fakeEv = {
    preventDefault(){},
    prompt(){ prompted = true; },
    userChoice: { then(cb){ try{ cb({ outcome: "accepted" }); }catch(e){} return { catch(){} }; } },
  };
  app.fireWin("beforeinstallprompt", fakeEv);
  $("settingsBtn").click();   // v2.69.0：置灰态在 Settings.open 路径上刷新（原为 helpRender）
  const installBtn1 = $("helpInstallBtn");
  ok(installBtn1 && installBtn1.disabled === false, "★ X3：捕获安装事件后，设置里的「安装到本机」解禁");
  if (installBtn1) installBtn1.click();
  ok(prompted === true, "★ X3：点击按钮主动唤起安装 prompt()");

  /* X4：导出按钮经共享助手 exportDiagnostics 调起 diagExport（装配层接线，与 diagCopyBtn 同列） */
  let diagExportCalled = false;
  const realDiagExport = beat.Diagnostics.diagExport;
  beat.Diagnostics.diagExport = (b) => { diagExportCalled = true; return realDiagExport(b); };
  $("helpDiagExport").click();
  ok(diagExportCalled === true, "★ X4：点击设置里的「导出诊断」经 exportDiagnostics 调起 diagExport（无直呼边）");
  beat.Diagnostics.diagExport = realDiagExport;
}
