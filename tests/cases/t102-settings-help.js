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
/* v2.36.0：宽屏铺满开关（用户反馈④）——设置弹窗 markup + body 类 + 主界面 CSS 三处契约（源码文本级） */
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  ok(src.includes('id="wideToggle"') && src.includes("宽屏铺满<span"), "设置弹窗有「宽屏铺满」开关");
  ok(src.includes("body.wide-full .main{max-width:none}"), "★ 开启后主界面去掉 1440px 上限（侧栏 360 不变）");
  /* 行为断言：点开关 → body.wide-full 切换 + 持久化（真开关不是摆设） */
  const app = loadApp();
  app.beat.Settings.open();
  app.els["wideToggle"].fire("click");
  ok(app.sandbox.document.body.classList.contains("wide-full"), "★ 点开 → body 加 wide-full（主列铺满）");
  app.els["wideToggle"].fire("click");
  ok(!app.sandbox.document.body.classList.contains("wide-full"), "再点 → 恢复 1440 居中");
  app.beat.Settings.close();
}
{
  /* 文本级断言（同 t90 的 html 切片手法）：说明是静态标记，不该由 JS 渲染 */
  ok(html.indexOf("「设置」里的每一项") >= 0, "★ 新增「设置」里的每一项章节");
  /* Swing：说清"前长后短"的直觉 + 三档含义 + "只改耳朵不改画面"的边界 */
  ok(/前长后短/.test(html) && /重 Swing/.test(html) && /只改耳朵听到的时机，不改画面/.test(html),
     "★ Swing：直觉（前长后短）+ 三档（直 / Swing / 重 Swing）+ 边界（不改画面）都说清");
  /* 延迟补偿：为什么（蓝牙 100–300ms）+ 怎么调（滑杆 + 三类设备参考起步值 + ±20ms 微调法）+ 多设备配置。
     ★ 两处文案（「使用方法」条目 + 设置页 hint）各自**切片独立断言**——harness 的 html 是整个
     index.html 原文，不切片的话一处漏改会被另一处掩盖（变异反向验证实测踩过：只删一处
     参考值，全文件级正则仍绿）。 */
  const helpLat = (() => {
    const a = html.indexOf("音频延迟补偿（蓝牙耳机 / 无线音箱）。</b>蓝牙传输天生慢");
    return a < 0 ? "" : html.slice(a, html.indexOf("</li>", a));
  })();
  const setLatHint = (() => {
    const a = html.indexOf("蓝牙耳机通常有 <b>100–300ms</b> 延迟");
    return a < 0 ? "" : html.slice(a, html.indexOf("</div>", a));
  })();
  ok(/100–300ms/.test(helpLat)
     && /真无线耳机（TWS）<b>约 200ms<\/b>/.test(helpLat)
     && /蓝牙耳机 \/ 音箱<b>约 150ms<\/b>/.test(helpLat)
     && /有线耳机 \/ 手机外放保持 <b>0<\/b>/.test(helpLat)
     && /每次 ±20ms/.test(helpLat)
     && /按设备存配置/.test(helpLat),
     "★ 延迟补偿（使用方法条目）：成因 / 滑杆手法 + 三类设备起步值 / ±20ms 微调法 / 多设备配置全覆盖");
  ok(/真无线耳机（TWS）<b>约 200ms<\/b>/.test(setLatHint)
     && /蓝牙耳机 \/ 音箱<b>约 150ms<\/b>/.test(setLatHint)
     && /有线耳机与外放保持 <b>0<\/b>/.test(setLatHint)
     && /每次 ±20ms 微调到声画重合/.test(setLatHint),
     "★ 延迟补偿（设置 hint）：三类设备起步值 + ±20ms 微调法全覆盖");
  /* 后台保活：症状（系统暂停网页声音）+ 两级手段（屏幕不熄灭 / iOS 静音音频）+ 代价（耗电）+ 默认关 */
  ok(/暂停网页的声音/.test(html) && /不自动熄灭/.test(html) && /静音音频/.test(html)
     && /代价是耗电/.test(html) && /默认关/.test(html),
     "★ 后台保活：症状 / 两级手段 / 耗电代价 / 默认关全都交代");
  /* 章节位置：在「训练模式」之后、「曲式编排」之前（阅读顺序：主界面 → 训练 → 设置） */
  /* 标题只留「曲式编排」（v2.30 起编排是独立页面，不再是"预设卡片里"的内容）
     ——断言按标题锚点定位，改标题必须同步改这里 */
  const iTrain = html.indexOf("训练模式</h2>"), iSet = html.indexOf("「设置」里的每一项"),
        iArr = html.indexOf("曲式编排</h2>");
  ok(iTrain >= 0 && iTrain < iSet && iSet < iArr, "★ 章节插在训练模式之后、曲式编排之前");
  /* v2.25.2 去重契约（用户实拍"内容重复"）：设置类词条只允许在「设置里的每一项」
     出现一次——旧「全部控制项」（已收窄为主界面控制项）里不得再有它们的 dt。
     「主界面控制项」里也只留主界面的三条（速度/拍号/音量） */
  eq(html.indexOf("全部控制项"), -1, "★ 旧「全部控制项」标题已更名（防两份说明并存）");
  for (const dt of ["<dt>Swing</dt>", "<dt>延迟补偿</dt>", "<dt>后台保活</dt>", "<dt>音色 / 音量</dt>"])
    eq(html.indexOf(dt), -1, `★ 旧一字型词条「${dt}」不再出现（详解只住在「设置里的每一项」）`);
  const iMain = html.indexOf("主界面控制项");
  ok(iMain >= 0 && iMain < iTrain, "★ 主界面控制项在前（速度/拍号/音量三条，指路提示指向设置章节）");
}
