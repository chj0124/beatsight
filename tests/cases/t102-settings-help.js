/* BeatSight 自动化测试 · 设置→使用方法的层叠修复 + 设置项详解（v2.25.1）
   T102 系列。
   ---------------------------------------------------------------------------
   来源（用户实报三连，2026-09-26）：
   ① 「点击 设置-使用说明，弹出使用说明后，设置窗口并没有自动消失」——Help 是
      全屏 overlay、设置是浮层小窗，两者各自 .open 叠着；Help.open() 只开自己。
      修法：Help.open() 先关设置（Settings 声明在前，前向引用合法）。
   ② 使用说明缺「后台保活」的像样说明（原文只有一行"耗电换连续，按需开"）；
   ③ 使用说明缺设置里各选项的逐项详解（Swing / 延迟补偿等最容易被问"这是啥"）。
      修法：helpMore 里新增「设置里的每一项」dl 章节（训练模式之后）。
   本文件钉：① 的层叠契约（真 DOM 事件驱动）+ ②③ 的内容契约（CSS/标记文本级）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const overlayOpen = (els, id) => {
  const el = els[id];
  return el && el.classList.contains("open");
};

/* ================= 场景 T102a：★ 设置→使用方法，设置自动关闭（用户实报 ①） ================= */
section("T102a 层叠修复 · ★ 设置小窗里点「使用方法」⇒ 使用方法打开、设置自动关；返回练习后一切复位");
{
  const { beat, els } = loadApp();
  eq(overlayOpen(els, "settingsOverlay"), false, "前提：设置初始关闭");
  els["settingsBtn"].fire("click");
  eq(overlayOpen(els, "settingsOverlay"), true, "前提：点「设置」后小窗打开");
  /* 设置里的「使用方法」按钮（Help.open 的真实入口） */
  els["helpBtn"].fire("click");
  eq(overlayOpen(els, "helpOverlay"), true, "★ 使用方法全屏打开");
  eq(overlayOpen(els, "settingsOverlay"), false,
     "★★ 设置小窗自动关闭——不再叠在说明底下（用户实报：弹出使用说明后设置窗口没有消失）");
  /* 关闭说明后一切复位：两个 overlay 都关，可再次打开（开合协议幂等） */
  els["helpClose"].fire("click");
  eq(overlayOpen(els, "helpOverlay"), false, "「返回练习」关闭说明");
  eq(overlayOpen(els, "settingsOverlay"), false, "设置保持关闭（不会幽灵回归）");
  els["settingsBtn"].fire("click");
  eq(overlayOpen(els, "settingsOverlay"), true, "设置可正常再次打开（开合协议未被破坏）");
  beat.Controls.stop();
}

/* ================= 场景 T102b：使用方法的「设置里的每一项」内容契约（用户实报 ②③） ================= */
section("T102b 内容契约 · ★ 新增「设置里的每一项」章节：Swing / 延迟补偿 / 后台保活都说人话");
{
  /* 文本级断言（同 t90 的 html 切片手法）：说明是静态标记，不该由 JS 渲染 */
  ok(html.indexOf("「设置」里的每一项") >= 0, "★ 新增「设置」里的每一项章节");
  /* Swing：说清"前长后短"的直觉 + 三档含义 + "只改耳朵不改画面"的边界 */
  ok(/前长后短/.test(html) && /重 Swing/.test(html) && /只改耳朵听到的时机，不改画面/.test(html),
     "★ Swing：直觉（前长后短）+ 三档（直 / Swing / 重 Swing）+ 边界（不改画面）都说清");
  /* 延迟补偿：为什么（蓝牙 100–300ms）+ 怎么调（校准向导敲八下）+ 多设备配置 + 有线不用调 */
  ok(/100–300ms/.test(html) && /校准向导/.test(html) && /敲八下/.test(html)
     && /按设备存配置/.test(html)
     && html.includes("有线耳机 / 手机外放延迟接近零，保持 0"),
     "★ 延迟补偿：成因 / 校准手法 / 多设备配置 / 何时该保持 0 全覆盖");
  /* 后台保活：症状（系统暂停网页声音）+ 两级手段（屏幕不熄灭 / iOS 静音音频）+ 代价（耗电）+ 默认关 */
  ok(/暂停网页的声音/.test(html) && /不自动熄灭/.test(html) && /静音音频/.test(html)
     && /代价是耗电/.test(html) && /默认关/.test(html),
     "★ 后台保活：症状 / 两级手段 / 耗电代价 / 默认关全都交代");
  /* 章节位置：在「训练模式」之后、「曲式编排」之前（阅读顺序：主界面 → 训练 → 设置） */
  const iTrain = html.indexOf("训练模式</h2>"), iSet = html.indexOf("「设置」里的每一项"),
        iArr = html.indexOf("曲式编排（预设卡片里）");
  ok(iTrain >= 0 && iTrain < iSet && iSet < iArr, "★ 章节插在训练模式之后、曲式编排之前");
}
