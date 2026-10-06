/* T207 后台被节流后的解释条 #bgHint（v3.34.5，审计 B-1）
   ---------------------------------------------------------------------------
   桌面浏览器把标签页切到后台超过 5 分钟会触发 intensive throttling（定时器降到约 1 次/分钟），
   而后台前瞻窗口是 1.2s（CONFIG.schedWindowBg）⇒ 每分钟只排得出约 1.2 秒的声音。
   这是浏览器节流，**页面侧无法根治**（代码注释已记为 M8 阻塞点）。

   能做的是「给解释 + 指出路」：被饿过（reanchor("starved") 是客观证据，不是猜的）
   且回到前台且保活没开 ⇒ 亮一条说明，指向唯一真正管用的开关「后台保活」。

   本用例钉三条：
     ① 没被饿过就绝不出现（不能变成常驻横幅打扰人）；
     ② 被饿过 + 回前台 + 保活未开 ⇒ 出现（这是它存在的唯一理由）；
     ③ 开了保活 / 停止播放 ⇒ 自动收起，且**停机清标志**（下一轮不背着上一轮的结论）。
   ★ 它刻意没有「知道了」关闭钮、不落盘：状态驱动的显隐不会"关掉后回不来"
     ——这正是 v3.34.5 同时修掉的 A-1（图例一次性关闭不可逆）要避免的形状。 */
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

section("T207 后台节流解释条 · 只在真被饿过且保活未开时出现");
{
  const app = loadApp();
  const elHidden = () => app.els["bgHint"].hidden;

  /* ① boot 与正常播放期间：常隐（不打扰） */
  eq(elHidden(), true, "★ boot：解释条隐藏");
  app.beat.Controls.start();
  eq(elHidden(), true, "★ 正常播放中也不出现（没被饿过就不该有存在感）");

  /* ② 制造一次真实的「后台被饿」：切后台 + 时钟跳 60 秒 + 跑一轮调度 ⇒ reanchor("starved") */
  const ac = FakeAudioContext.last;
  ok(!!ac, "已建立音频上下文（用于推进时钟）");
  app.setHidden(true);                      // 切后台：窗口切到 1.2s 档
  ac.currentTime += 60;                     // 模拟被节流 60 秒：游标远远落后实时时钟
  app.beat.AudioEngine.scheduler();
  eq(app.beat.diag.reanchorStarved, 1, "★ 一次饥饿重锚被记数（客观证据，非猜测）");

  /* 还在后台时不显示（放后台用户也看不见） */
  eq(elHidden(), true, "仍在后台：不显示（此刻显示没有意义）");

  /* ③ 回到前台 ⇒ 亮起（playing + 保活未开 + 确实被饿过，三条件齐） */
  app.setHidden(false);
  eq(elHidden(), false, "★★ 回前台 ⇒ 解释条出现（这是它存在的唯一理由）");

  /* ④ 打开后台保活 ⇒ 立刻收起（已给过出路，不该再劝第二次） */
  app.els["keepAwakeToggle"].fire("click");
  eq(app.beat.Store.S.keepAwake, true, "保活已开");
  eq(elHidden(), true, "★★ 开了保活 ⇒ 立刻收起");

  /* ⑤ 停止播放 ⇒ 收起 + 清标志：新一轮播放不该背着上一轮的结论 */
  app.beat.Controls.start();                // 先确保在播（上面只开了保活，仍在播）
  app.setHidden(true);
  ac.currentTime += 60;
  app.beat.AudioEngine.scheduler();
  app.setHidden(false);
  eq(elHidden(), true, "保活开着 ⇒ 再被饿也不重复提示");
  app.els["keepAwakeToggle"].fire("click");  // 关回保活
  eq(app.beat.Store.S.keepAwake, false, "保活关回");
  app.beat.Controls.stop();
  eq(elHidden(), true, "★ 停止播放 ⇒ 收起");
  /* 停机已清标志：重新开播即使不切后台也不会弹出上一轮的解释条 */
  app.beat.Controls.start();
  eq(elHidden(), true, "★★ 重新开播不背着上一轮的「被饿过」结论（停机即清）");
  app.beat.Controls.stop();
}
