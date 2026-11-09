/* T275：控制芯模块边界与既有交互契约。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section, html } = require("../lib/harness");

section("T275a CoreUI 纳入权威模块顺序，共享区不再绕过后方模块");
{
  ok(/const CoreUI = \(\(\) => \{/.test(html), "★ CoreUI 以独立 IIFE 存在");
  const orderSource = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "check-module-order.js"), "utf8");
  ok(orderSource.includes('"Store", "CoreUI", "Modal"'), "★ EXPECTED_ORDER = Store → CoreUI → Modal");
  const sharedStart = html.indexOf("/* ================= 共享状态");
  const coreStart = html.indexOf("/* ================= CoreUI");
  const modalStart = html.indexOf("/* ================= Modal");
  ok(sharedStart >= 0 && coreStart > sharedStart && modalStart > coreStart,
    "共享状态、CoreUI、Modal 三段边界可定位");
  if (sharedStart >= 0 && coreStart > sharedStart){
    const shared = html.slice(sharedStart, coreStart);
    ok(!/Diagnostics\.|Arrange\.|Help\./.test(shared), "★ 共享状态区不再直接引用 Diagnostics / Arrange / Help");
  }
}

section("T275b 控制芯面板与 Escape 行为不变");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  const $ = id => sandbox.document.getElementById(id);
  ok(!!beat.CoreUI && typeof beat.CoreUI.syncParamSlots === "function",
    "★ CoreUI 暴露控制芯同步入口");
  if (beat.CoreUI){
    beat.Store.S.mute = true;
    beat.CoreUI.syncParamSlots();
    eq($("muteFlyout").hidden, false, "开关打开时静音面板显示");
    app.fireWin("keydown", { key: "Escape" });
    eq($("muteFlyout").hidden, true, "Escape 收起静音面板且不关静音开关");
    eq(beat.Store.S.mute, true, "Escape 只收面板，不改变开关状态");
  }
}
