/* BeatSight 自动化测试 · 壁纸降采样决策 wallRecompress()（v3.33.14，审计 P1-4）
   T200
   ─────────────────────────────────────────────────────────────────────────────
   由来：覆盖率报告点名 `im.onload` / `im.onerror` 为**从未执行的函数**——
   "用户换自己照片当背景"这条唯一入口（FileReader → new Image() → canvas 降采样 → 落盘）
   因为依赖三样桩里都没有的宿主能力，整条链路**零覆盖**，其中 6 处回落任何一处写错都没人知道。

   修法是把"决策"从回调里抽出来：wallRecompress(im, makeCanvas) 只做判断与编排，
   宿主能力（读尺寸 / 建 canvas / 压 JPEG）全部由参数注入 ⇒ 桩里传假 im + 假 canvas 即可跑通全部四态。
   本文件覆盖这四态，并钉住"降级 vs 告知用户"的分支语义（why 的区别）。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* 假 canvas：记录调用，按需让它失败 */
function fakeCanvas(opt){
  const o = opt || {};
  const rec = { size: null, drawArgs: null, toDataURL: [] };
  const cv = {
    _rec: rec,
    get width(){ return rec.size ? rec.size[0] : 0; },
    set width(v){ rec.size = rec.size || [0, 0]; rec.size[0] = v; },
    get height(){ return rec.size ? rec.size[1] : 0; },
    set height(v){ rec.size = rec.size || [0, 0]; rec.size[1] = v; },
    getContext: () => ({
      drawImage: (...a) => {
        rec.drawArgs = a;
        if (o.drawThrows) throw new Error("draw failed");
      },
    }),
    toDataURL: (type, q) => {
      rec.toDataURL.push([type, q]);
      if (o.toDataURLThrows) throw new Error("encode failed");
      return o.out != null ? o.out : "data:image/jpeg;base64,AAA";
    },
  };
  return cv;
}

const app0 = loadApp();
const MAX_EDGE = app0.beat.WALL_MAX_EDGE;
const MAX_BYTES = app0.beat.WALL_MAX_BYTES;

/* ================= T200a：读不出尺寸 ⇒ why:"size"（该告知用户） ================= */
section("T200a 读不出尺寸 ⇒ why=size（调用方据此弹「换一张」）");
{
  const app = loadApp();
  const { wallRecompress } = app.beat;
  for (const im of [{ naturalWidth: 0, naturalHeight: 0 }, {}, null]){
    const r = wallRecompress(im, () => fakeCanvas());
    eq(r.ok, false, "尺寸缺失 ⇒ ok=false（" + JSON.stringify(im) + "）");
    eq(r.why, "size", "★ why=size（这是唯一需要**告知用户**的失败，不是降级）");
    eq(r.out, null, "且不给 out（调用方不该拿它去落盘）");
  }
}

/* ================= T200b：正常缩放 —— 长边收到 WALL_MAX_EDGE ================= */
section("T200b 大图缩到长边 " + MAX_EDGE + "，且画板尺寸与 drawImage 参数同源");
{
  const app = loadApp();
  const cv = fakeCanvas();
  const r = app.beat.wallRecompress({ naturalWidth: 4000, naturalHeight: 3000 }, () => cv);
  eq(r.ok, true, "★ 正常图 ⇒ ok=true");
  eq(r.why, "", "无 why");
  eq(cv._rec.size[0], MAX_EDGE, "★ 画板宽收到长边上限（4000 → " + cv._rec.size[0] + "）");
  eq(cv._rec.size[1], Math.round(3000 * (MAX_EDGE / 4000)), "高按同比例缩（保持长宽比）");
  ok(cv._rec.drawArgs && cv._rec.drawArgs.length === 5, "drawImage 带 5 个参数（img,0,0,w,h）");
  eq(cv._rec.drawArgs[3], cv._rec.size[0], "★ drawImage 的目标宽 = 画板宽（不是原图宽）");
  eq(cv._rec.drawArgs[4], cv._rec.size[1], "drawImage 的目标高 = 画板高");
  ok(!!r.out, "★ 有输出（data URL）");
}

/* ================= T200c：小图不放大 ================= */
section("T200c 小图保持原尺寸（k 上限为 1，不许放大）");
{
  const app = loadApp();
  const cv = fakeCanvas();
  const r = app.beat.wallRecompress({ naturalWidth: 800, naturalHeight: 600 }, () => cv);
  eq(r.ok, true, "小图 ⇒ ok=true");
  eq(cv._rec.size[0], 800, "★ 宽不放大（仍 800）");
  eq(cv._rec.size[1], 600, "高不放大（仍 600）");
}

/* ================= T200d：没有 canvas ⇒ 降级（不是错误） ================= */
section("T200d 宿主没有 canvas ⇒ why=nocanvas（调用方**降级用原图**，不弹窗）");
{
  const app = loadApp();
  const r1 = app.beat.wallRecompress({ naturalWidth: 2000, naturalHeight: 1000 }, null);
  eq(r1.ok, false, "没有 makeCanvas ⇒ ok=false");
  eq(r1.why, "nocanvas", "★ why=nocanvas");
  const r2 = app.beat.wallRecompress({ naturalWidth: 2000, naturalHeight: 1000 },
    () => ({ getContext: () => null }));                 // 有 canvas 但拿不到 2d 上下文
  eq(r2.why, "nocanvas", "★ 拿不到 2d 上下文同样算 nocanvas（同一条降级路径）");
  const r3 = app.beat.wallRecompress({ naturalWidth: 2000, naturalHeight: 1000 },
    () => { throw new Error("canvas 构造失败"); });
  eq(r3.why, "nocanvas", "★ 构造 canvas 抛异常也算 nocanvas（不许冒泡出去）");
}

/* ================= T200e：绘制失败 ⇒ 降级 ================= */
section("T200e drawImage 抛错 ⇒ why=draw（同样是降级，不是告知用户）");
{
  const app = loadApp();
  const cv = fakeCanvas({ drawThrows: true });
  const r = app.beat.wallRecompress({ naturalWidth: 2000, naturalHeight: 1000 }, () => cv);
  eq(r.ok, false, "绘制失败 ⇒ ok=false");
  eq(r.why, "draw", "★ why=draw（与 nocanvas 同属『直接用原图』那一侧）");
}

/* ================= T200f：压出来仍超限 ⇒ 降质量再压一次 ================= */
section("T200f 0.82 压出来仍超 " + MAX_BYTES + " 字符 ⇒ 降到 0.7 再压一次");
{
  const app = loadApp();
  const big = "data:image/jpeg;base64," + "A".repeat(MAX_BYTES + 100);
  const cv = fakeCanvas({ out: big });
  const r = app.beat.wallRecompress({ naturalWidth: 4000, naturalHeight: 3000 }, () => cv);
  eq(cv._rec.toDataURL.length, 2, "★ toDataURL 被调用两次（先 0.82、再 0.7）");
  eq(cv._rec.toDataURL[0][1], 0.82, "第一次质量 0.82");
  eq(cv._rec.toDataURL[1][1], 0.7, "★ 第二次降到 0.7");
  eq(r.ok, true, "仍算成功（第二次的结果就是最终输出）");
  /* 对照：0.82 就够小 ⇒ 只压一次，不浪费一次编码 */
  const cv2 = fakeCanvas({ out: "data:image/jpeg;base64,AAA" });
  app.beat.wallRecompress({ naturalWidth: 4000, naturalHeight: 3000 }, () => cv2);
  eq(cv2._rec.toDataURL.length, 1, "★ 对照组：0.82 够小 ⇒ 只压一次（不无谓多压）");
}

/* ================= T200g：两次都压不出 ⇒ out=null（调用方回落原图） ================= */
section("T200g 编码全失败 ⇒ ok=true 但 out=null（由调用方回落 src）");
{
  const app = loadApp();
  const cv = fakeCanvas({ toDataURLThrows: true });
  const r = app.beat.wallRecompress({ naturalWidth: 2000, naturalHeight: 1000 }, () => cv);
  eq(r.ok, true, "编码失败**不算**失败（图本身是好的，只是压不出来）");
  eq(r.out, null, "★ out=null ⇒ 调用方走 `done(r.out || src)` 回落原图");
}

/* ================= T200h：源码钉 —— 决策已抽出，回调只剩宿主能力 ================= */
section("T200h 源码钉：onload 里走 wallRecompress，不再内联那段逻辑");
{
  const src = html;
  ok(src.indexOf("function wallRecompress(") >= 0, "★ 纯决策函数在位");
  ok(src.indexOf("const r = wallRecompress(im, () => document.createElement(\"canvas\"));") >= 0
    || src.indexOf("wallRecompress(im, () => document.createElement(") >= 0,
    "★ onload 里调用它（宿主 canvas 现场注入）");
  /* ★ 判据是"全文件**恰好一处**缩放实现"，而不是"这行不存在"——
     抽出之后这行仍然在，只是搬进了纯函数里。第一版写成 `< 0`（断言它不存在）当场红，
     那是把"搬迁"误当成"删除"：真正要防的是**两处并存**（改一处漏一处）。 */
  const zoomImpl = src.split("WALL_MAX_EDGE / Math.max").length - 1;
  eq(zoomImpl, 1, "★ 缩放实现全文件恰好 1 处（>1 = 内联版本没删干净，改一处漏一处）");
  ok(src.indexOf('cv.toDataURL("image/jpeg", 0.7)') >= 0,
    "降级重压仍在（只是搬进了纯函数）");
  /* onload 里不该再有 drawImage / toDataURL 的直接调用（那些是宿主能力，只留在纯函数里） */
  const onloadAt = src.indexOf("im.onload = () => {");
  ok(onloadAt >= 0, "onload 回调在位");
  if (onloadAt >= 0){
    const body = src.slice(onloadAt, onloadAt + 500);
    ok(body.indexOf("drawImage") < 0 && body.indexOf("toDataURL") < 0,
      "★ onload 里不再直接碰 canvas（只剩『拿能力 → 交给纯函数 → 按 why 分支』）");
  }
}
