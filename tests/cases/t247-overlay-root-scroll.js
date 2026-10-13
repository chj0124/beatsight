/* BeatSight 自动化测试 · 全屏弹层打开期间隐藏根滚动条（PLAN-v11 追补）
   T247 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约（用户实拍「两条滚动条」追补）：
     · 根因：body 的 overflow-y:scroll + scrollbar-gutter:stable（主界面防横移的恒定预留）
       + position:fixed inset:0 的全屏弹层自身 overflow-y:auto —— 后者盖不住窗口边缘那条
       根滚动条 → 右侧并排两条；
     · 修法：开合协议（Modal.openOverlay/closeOverlay）对 .editor 家族四个全屏弹层
       （editor / arrangeOverlay / earOverlay / helpOverlay）计数，在 <html> 上挂
       bs-overlay-open 类；CSS 据此隐藏根滚动条；
     · settingsOverlay 是 .dialog 浮层小窗，**不在锁的范围**（锁了反而让弹窗四周的
       主界面横移）；uiConfirm 弹窗同理不锁；
     · 桩已补 documentElement（真实 DOM 恒有，缺了产品代码一开弹层就 TypeError）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section } = require("../lib/harness");

const HTML_PATH = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

/* ================= T247-1 行为：开挂类 / 关摘类 / 计数兜多层 ================= */
section("T247-1 根滚动条锁 · 开挂类 / 关摘类 / 多层计数 / 设置小窗不锁");
{
  const { beat, els, sandbox } = loadApp();
  const root = sandbox.document.documentElement;
  ok(root.classList && typeof root.classList.contains === "function", "前提：桩有 documentElement.classList");

  beat.Editor.open();
  ok(root.classList.contains("bs-overlay-open"), "★ 编辑器打开 → <html> 挂锁类（根滚动条隐藏）");
  beat.Editor.tryClose();
  ok(!root.classList.contains("bs-overlay-open"), "★ 编辑器关闭 → 摘类（主界面恢复恒定预留的滚动条）");

  beat.Arrange.open();
  ok(root.classList.contains("bs-overlay-open"), "★ 曲式编排（同 .editor 家族）→ 同样挂锁");
  beat.Arrange.close();
  ok(!root.classList.contains("bs-overlay-open"), "★ 编排关闭 → 摘类");

  /* 多层计数：编辑器之上再开帮助（理论路径），关一个仍锁，关到最后才解锁 */
  beat.Editor.open();
  beat.Help.open();
  ok(root.classList.contains("bs-overlay-open"), "两层全屏弹层：仍锁");
  beat.Help.close();
  ok(root.classList.contains("bs-overlay-open"), "★ 关掉一层（还有编辑器）→ 仍锁（计数兜底）");
  beat.Editor.tryClose();
  ok(!root.classList.contains("bs-overlay-open"), "★ 关掉最后一层 → 解锁");

  /* 设置浮层不在锁的范围：开它不挂类（锁了弹窗四周可见的主界面会横移） */
  const before = root.classList.contains("bs-overlay-open");
  beat.Settings ? beat.Settings.open && beat.Settings.open() : null;
  eq(root.classList.contains("bs-overlay-open"), before,
     "★ settingsOverlay 是 .dialog 小窗：开合不改变根滚动条锁（不在 SCROLL_LOCK_OVERLAYS）");
}

/* ================= T247-2 源码钉：CSS 规则 + 锁名单 ================= */
section("T247-2 源码钉 · CSS 规则存在、四个全屏弹层在名单、设置小窗排除");
{
  ok(/html\.bs-overlay-open, html\.bs-overlay-open body\{overflow:hidden\}/.test(html),
     "★ CSS：弹层打开期间根滚动条隐藏（html 与 body 双写，防 body 溢出传播）");
  const m = /const SCROLL_LOCK_OVERLAYS = \{([^}]*)\}/.exec(html);
  ok(!!m, "前提：锁名单存在");
  for (const id of ["editor", "arrangeOverlay", "earOverlay", "helpOverlay"]){
    ok(new RegExp(id + ":\\s*1").test(m[1]), "★ 名单含 " + id + "（.editor 家族全屏弹层）");
  }
  ok(!/settingsOverlay:\s*1/.test(m[1]), "★ settingsOverlay（.dialog 小窗）不在名单");
  ok(/function openOverlay[\s\S]{0,600}?rootScrollLock\(true\)/.test(html) &&
     /function closeOverlay[\s\S]{0,600}?rootScrollLock\(scrollLockCount > 0\)/.test(html),
     "★ 开/关两处都经计数收口（挂类/摘类只走 openOverlay/closeOverlay 一对原语）");
}
