/* BeatSight 自动化测试 · 打开「随机」应自动打开「静音拍」（v3.33.10 用户口径）
   T198
   ─────────────────────────────────────────────────────────────────────────────
   【问题】随机是静音拍的**子参数**（muteBarMuted 用它决定"静的区域落在组内哪几拍"），
     静音拍不开时它一点效果都没有；而开关本身既不自动开静音拍也不灰化 ⇒ 用户"开了随机却没反应"。
   【口径】打开随机而静音拍未开 ⇒ 复用静音拍自己的 handler（真实 click）把它一并打开；
     关闭方向一律不动（关静音拍不清掉随机的选择，与本仓"不偷偷改用户参数"的既有裁决一致）。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

section("T198a 打开随机 ⇒ 静音拍一并打开");
{
  const app = loadApp();
  eq(app.beat.Store.S.mute, false, "前提：静音拍默认关");
  app.els["muteRandomToggle"].fire("click");
  eq(app.beat.Store.S.muteCfg.random, true, "随机已开");
  eq(app.beat.Store.S.mute, true, "★★ 静音拍被一并打开（否则就是「开了随机却没反应」）");
}

section("T198b 反向不变量：关闭方向不动（关静音拍不清随机的选择）");
{
  const app = loadApp();
  app.els["muteToggle"].fire("click");
  app.els["muteRandomToggle"].fire("click");
  app.els["muteToggle"].fire("click");
  eq(app.beat.Store.S.mute, false, "静音拍关了");
  eq(app.beat.Store.S.muteCfg.random, true, "★★ 随机的选择被保留（不偷偷替用户清参数）");
}

section("T198c 源码钉：走真实 click 复用静音拍自己的 handler（不直接置位）");
{
  ok(/if \(S\.muteCfg\.random && !S\.mute\)\{ const mt = \$\("muteToggle"\); if \(mt\) mt\.click\(\); \}/.test(html),
    "★★ 判据在随机 handler 内、且通过 muteToggle.click() 复用其全部副作用（重算静音行/通知调度器/刷状态栏）");
}
