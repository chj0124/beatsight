/* BeatSight 自动化测试 · 小屏收敛创作入口（PLAN-v11 D 批）
   T246 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约（拍板记录见 docs/archive/PLAN-v11-editor-popover.md §0）：
     · 断点 = 复合媒体查询 `(max-width:640px), (orientation: portrait), (max-height: 700px)`，
       与控制芯收窄那条**逐字符同源**；CSS 隐藏 #argOpen/#editBtn 两枚入口，
       JS 用同串 matchMedia 守卫快捷键 E（openArrange 唯一调用点）——入口藏了键也藏；
     · 只拦入口不驱逐已进入者；H / ? 不是创作入口，不拦；
     · 编排与节奏型的数据、播放不受影响（本组不涉播放，数据层回归由既有用例兜底）。
   桩口径：loadApp 的 viewportW / innerHeight 已解耦（harness PLAN-v11 D 批）——
   桌面 = 1000×900，矮窗 = 1000×660，桩缺省 600×338 恒命中第一段（小屏）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section } = require("../lib/harness");

const HTML_PATH = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

/* ================= 场景 T246-1：源码钉 —— CSS 规则与 JS 判据同串 ================= */
section("T246-1 复合断点 · CSS 规则存在、覆盖两个入口、与 JS 判据逐字符同串");
{
  const jsQ = /const COMPACT_QUERY = "([^"]+)"/.exec(html);
  ok(!!jsQ, "前提：Controls 侧 COMPACT_QUERY 存在");
  const q = jsQ[1];
  eq(q, "(max-width:640px), (orientation: portrait), (max-height: 700px)",
     "★ 判据串 = 三段合取（640 窄 / 竖屏 / 700 矮窗）");
  ok(html.includes("@media " + q + "{"), "★ CSS @media 与 JS 判据**逐字符同串**（改一处必须同步改另一处）");
  ok(/@media \(max-width:640px\), \(orientation: portrait\), \(max-height: 700px\)\{\s*#argOpen,#editBtn\{display:none\}\s*\}/.test(html),
     "★ CSS 规则覆盖 #argOpen,#editBtn{display:none}（两枚创作入口）");
}

/* ================= 场景 T246-2：E 键守卫 —— 三段各自命中都要拦，桌面放行，H 不拦 ================= */
section("T246-2 E 键守卫 · 小屏三段命中拦截 / 桌面放行 / H 不受守卫");
{
  /* 第一段：缺省 600×338 → max-width:640 命中 */
  const narrow = loadApp();
  narrow.fireWin("keydown", { key: "e" });
  eq(narrow.beat.Arrange.isOpen(), false, "★ 小屏（600 ≤640）：E 被入口收敛守卫拦截");
  narrow.fireWin("keydown", { key: "h" });
  eq(narrow.beat.Help.isOpen(), true, "★ 对照：H 不是创作入口，小屏照常开帮助");

  /* 第二段：900×1000（宽 800 >640 且不矮）→ portrait 段命中（高≥宽） */
  const portrait = loadApp(undefined, { viewportW: 800, innerHeight: 1000 });
  portrait.fireWin("keydown", { key: "e" });
  eq(portrait.beat.Arrange.isOpen(), false, "★ 竖屏（800×1000，高≥宽）：E 被拦（复合断点第二段）");

  /* 第三段：1000×660 → 宽与高比都不窄，但 max-height:700 命中（矮窗也算小屏的拍板口径） */
  const shortWin = loadApp(undefined, { viewportW: 1000, innerHeight: 660 });
  shortWin.fireWin("keydown", { key: "e" });
  eq(shortWin.beat.Arrange.isOpen(), false, "★ 矮窗（1000×660 ≤700 高）：E 被拦（复合断点第三段）");

  /* 桌面：三段全不命中 → E 照常 */
  const desktop = loadApp(undefined, { viewportW: 1000, innerHeight: 900 });
  desktop.fireWin("keydown", { key: "e" });
  eq(desktop.beat.Arrange.isOpen(), true, "★ 桌面（1000×900）：E 照常经 openArrange 打开编排");
}

/* ================= 场景 T246-3：帮助页归因提示 ================= */
section("T246-3 帮助提示 · 入口隐藏的归因 + 快捷键表注记");
{
  ok(html.includes("小屏（窗口过窄 / 竖屏 / 矮窗）下自动隐藏"),
     "★ 「先分清两个编辑入口」节给归因（隐藏 ≠ 功能丢失）");
  ok(html.includes("编排与节奏型的<b>数据与播放、练习完全不受影响</b>"),
     "★ 提示明说数据与播放不受影响（手机练、桌面编）");
  ok(html.includes("<b>E</b>：打开曲式编排（小屏下编辑入口隐藏，此键无效）"),
     "★ 键盘快捷键表同步注记 E 的小屏语义");
}
