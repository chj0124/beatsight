/* T274：浏览器异步能力的异常路径。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

section("T274 PWA 安装请求拒绝后按钮状态收口");
{
  const app = loadApp();
  const { sandbox } = app;
  const $ = id => sandbox.document.getElementById(id);
  let rejectChoice;
  const fakeEv = {
    preventDefault(){},
    prompt(){},
    userChoice: {
      then(){
        return { catch(fn){ rejectChoice = fn; } };
      },
    },
  };
  app.fireWin("beforeinstallprompt", fakeEv);
  $("settingsBtn").click();
  const btn = $("helpInstallBtn");
  eq(btn.disabled, false, "捕获安装事件后按钮可用");
  btn.click();
  eq(typeof rejectChoice, "function", "安装流程已注册 userChoice 拒绝处理");
  rejectChoice(new Error("dismissed"));
  eq(btn.disabled, true, "★ userChoice 拒绝后清空事件并立即禁用安装按钮");
  ok(/不可安装/.test(btn.title || ""), "拒绝后 title 同步解释当前不可安装");
}
