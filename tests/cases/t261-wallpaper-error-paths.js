/* BeatSight 自动化测试 · 壁纸换图链路的宿主回调（三视角体检 2026-10-15 · C4）
   T261 系列。
   ─────────────────────────────────────────────────────────────────────────────
   由来：覆盖率报告长期把 `im.onload` / `im.onerror` 列为「从未执行的函数」——
   "换自己照片当背景"这条唯一入口的宿主能力段（FileReader → new Image() → 回调）在桩里
   走不到：桩环境没有 Image，产品 `try{ new Image() }catch{ im=null }` 一律降级，
   两个回调函数体**零执行**。t200 已覆盖纯决策函数 wallRecompress 的四态，t92 已覆盖
   读档三态与落盘/配额/格式提示，但 **im 回调本体**（含 size 提示与 onerror 提示）没人守。

   本用例借 harness 新增的可注入 Image 桩（opts.image）把这两个回调真正驱动起来，
   补齐三条此前零覆盖的分支：解码失败提示、读不出尺寸提示、以及 onload 里"拿不到 canvas
   ⇒ 降级用原图"的落盘主路径。另钉一条**对照**：不传 opts.image 时行为逐位不变（老路径）。 */
"use strict";
const { loadApp, ok, section, html } = require("../lib/harness");

/* JPEG 魔数 data URL（wallCheck 按文件头过白名单，与 t92/t200 同源） */
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
const smallJpeg = () => JPEG + "A".repeat(64);

/* 触发 wallFile 的 change：镜像 t92 的调用形状（handler 读 evTarget(e).files[0] 与 .value） */
const fireWall = (app, size) =>
  app.els["wallFile"].fire("change", { target: { files: [{ size: size || 1024 }], value: "" } });
const alertOpen = app => app.els["modalMask"] && app.els["modalMask"].hidden === false;
const alertText = app => String((app.els["modalMsg"] && app.els["modalMsg"].textContent) || "");

/* ================= T261a：解码失败 ⇒ im.onerror ================= */
section("T261a 图片解码失败 ⇒ 走 im.onerror，提示「这张图读不出来」（此前零覆盖）");
{
  const app = loadApp({}, { image: "error" });
  app.setFileText(smallJpeg());
  fireWall(app);
  ok(alertOpen(app), "★ 弹窗真的打开了（解码失败要告知，不是静默）");
  ok(/读不出来/.test(alertText(app)), "★★ im.onerror 提示可读：" + alertText(app));
}

/* ================= T261b：读不出尺寸 ⇒ im.onload 的 why=size 分支 ================= */
section("T261b 图能解码但读不出尺寸 ⇒ im.onload 走 why=size 提示（此前零覆盖）");
{
  const app = loadApp({}, { image: "size" });
  const before = app.beat.wallState();          // 启动即含出厂默认图（wallRead），不是 null
  app.setFileText(smallJpeg());
  fireWall(app);
  ok(alertOpen(app), "★ 弹窗打开");
  ok(/尺寸/.test(alertText(app)),
    "★★ im.onload 的 why=size 分支提示「读不出尺寸」（与 nocanvas 的静默降级区分开）：" + alertText(app));
  ok(app.beat.wallState() === before, "★ 失败无副作用：壁纸状态引用未变（没被改坏）");
}

/* ================= T261c：正常解码 + 拿不到 canvas ⇒ 降级用原图落盘 ================= */
section("T261c 正常解码、桩无 canvas ⇒ im.onload 降级用原图落盘（主路径真跑通）");
{
  const app = loadApp({}, { image: "load" });
  const src = smallJpeg();
  app.setFileText(src);
  fireWall(app);
  ok(!alertOpen(app), "★ 降级路径不弹窗（nocanvas 是降级不是错误）");
  const ws = app.beat.wallState();
  ok(ws && ws.img === src, "★★ 原图被落盘为当前壁纸（im.onload → wallRecompress(nocanvas) → done(src)）");
  ok(app.storage.get("beatsight.wallpaper") != null, "★ 冷键已写入（wallWrite 生效）");
}

/* ================= T261d：对照 —— 不传 opts.image 时老路径逐位不变 ================= */
section("T261d 对照：缺省不装 Image ⇒ 老降级路径不变（保护 t92 依赖的行为）");
{
  const app = loadApp();                     // 不传 opts.image
  const src = smallJpeg();
  app.setFileText(src);
  fireWall(app);
  ok(!alertOpen(app), "★ 无弹窗");
  const ws = app.beat.wallState();
  ok(ws && ws.img === src, "★ 缺省路径同样落盘成功（new Image() 抛错 → im=null → done(src)，与 t92 一致）");
}

/* ================= T261e：源码钉 —— 两个回调都在且分工不变 ================= */
section("T261e 源码钉：im.onload / im.onerror 仍在，且 onload 只编排、不直接碰 canvas");
{
  ok(html.indexOf("im.onload = () => {") >= 0, "★ im.onload 回调在位");
  ok(html.indexOf("im.onerror = () => {") >= 0, "★ im.onerror 回调在位");
  ok(html.indexOf('Modal.uiAlert("这张图读不出来') >= 0
    || /im\.onerror\s*=\s*\(\)\s*=>\s*\{\s*Modal\.uiAlert\("这张图读不出来/.test(html),
    "★ onerror 的提示文案与 t261a 的断言同源（文案若改，两条一起更新）");
  ok(html.indexOf("wallRecompress(im, () => document.createElement(\"canvas\"))") >= 0
    || html.indexOf("wallRecompress(im, () => document.createElement(") >= 0,
    "★ onload 仍把宿主 canvas 现场注入纯决策函数（与 t200h 同款钉法）");
}
