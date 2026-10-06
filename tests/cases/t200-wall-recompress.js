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
      /* v3.34.6（P2-5）：`seq` 让逐次调用返回不同结果——用来验证"某一档达标就停"。
         不给 seq 时维持原语义（恒定返回 out）。 */
      if (o.seq && o.seq.length) return o.seq.shift();
      return o.out != null ? o.out : "data:image/jpeg;base64,AAA";
    },
  };
  return cv;
}

const app0 = loadApp();
const MAX_EDGE = app0.beat.WALL_MAX_EDGE;
/* v3.34.6（审计 P2-5）：重压缩的**目标**是新图上限 WALL_ACCEPT_BYTES（比读档容忍度小）。
   读档容忍度 WALL_MAX_BYTES 另用于 wallCheck 的默认值（存量兼容），两者刻意分开。 */
const MAX_BYTES = app0.beat.WALL_ACCEPT_BYTES;

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

/* ================= T200f：压出来仍超限 ⇒ 逐级降质量（0.7 → 0.6） ================= */
section("T200f 0.82 压出来仍超 " + MAX_BYTES + " 字符 ⇒ 依次降到 0.7 / 0.6");
{
  const app = loadApp();
  /* ① 每次都压出超限结果 ⇒ 三档全用上（0.82 → 0.7 → 0.6），最终采用 0.6 那次 */
  const big = "data:image/jpeg;base64," + "A".repeat(MAX_BYTES + 100);
  const cv = fakeCanvas({ out: big });
  const r = app.beat.wallRecompress({ naturalWidth: 4000, naturalHeight: 3000 }, () => cv);
  eq(cv._rec.toDataURL.length, 3, "★★ 三档全跑（0.82 → 0.7 → 0.6；v3.34.6 补第三档）");
  eq(cv._rec.toDataURL[0][1], 0.82, "第一档质量 0.82");
  eq(cv._rec.toDataURL[1][1], 0.7, "第二档降到 0.7");
  eq(cv._rec.toDataURL[2][1], 0.6, "★ 第三档降到 0.6（本轮新增：两级有时压不进新图上限）");
  eq(r.ok, true, "仍算成功（最后一档的结果就是最终输出）");
  /* ② 0.7 就压进上限 ⇒ 不该再跑 0.6（省一次无谓编码） */
  const cv7 = fakeCanvas({ out: big, seq: [big, "data:image/jpeg;base64,AAA"] });
  app.beat.wallRecompress({ naturalWidth: 4000, naturalHeight: 3000 }, () => cv7);
  eq(cv7._rec.toDataURL.length, 2, "★ 0.7 已达标 ⇒ 停在第二档，不跑 0.6");
  /* ③ 对照：0.82 就够小 ⇒ 只压一次，不浪费一次编码 */
  const cv2 = fakeCanvas({ out: "data:image/jpeg;base64,AAA" });
  app.beat.wallRecompress({ naturalWidth: 4000, naturalHeight: 3000 }, () => cv2);
  eq(cv2._rec.toDataURL.length, 1, "★ 对照组：0.82 够小 ⇒ 只压一次（不无谓多压）");
}

/* ================= T200h：新图上限与存量容忍度分开（审计 P2-5/B-4） ================= */
section("T200h ★ 收紧新图不该把用户已有的背景判成脏值");
{
  const app = loadApp();
  const { wallCheck, WALL_MAX_BYTES: READ_CAP, WALL_ACCEPT_BYTES: NEW_CAP } = app.beat;
  ok(NEW_CAP < READ_CAP, "新图上限（" + NEW_CAP + "）必须小于存量容忍度（" + READ_CAP + "）");
  /* ★ data URL 必须带**真实 JPEG 魔数**：wallCheck 先按文件头过白名单，
     用任意填充（如 "AAAA"）会在格式那一步就被拒，测不到体积这条分支。
     故前缀用 t92 同源的合法 JPEG 头，再补填充到目标长度。 */
  const JPEG_HEAD = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
  const pad = n => JPEG_HEAD + "A".repeat(Math.max(0, n - JPEG_HEAD.length));
  /* 造一张「介于两者之间」的图：老存档合法，新图该被拒 */
  const mid = pad(Math.floor((NEW_CAP + READ_CAP) / 2));
  ok(wallCheck(mid).ok === true, "构造的中间图本身是合法格式（先排除格式因素）");
  eq(wallCheck(mid).ok, true, "★★ 不传 limit（读档路径）⇒ 仍按旧上限放行（老存档不受影响）");
  eq(wallCheck(mid, NEW_CAP).ok, false, "★ 传新图上限 ⇒ 同样一张图被拒（收紧的是新图这一侧）");
  /* 边界：正好等于上限放行（> 才是拒） */
  const exact = pad(NEW_CAP);
  eq(exact.length, NEW_CAP, "构造长度正好等于上限");
  eq(wallCheck(exact, NEW_CAP).ok, true, "恰好等于上限 ⇒ 放行（判据是 >）");
  /* 拒绝理由里带**具体数字**，用户才知道该缩多少（沿用既有口径） */
  const over = wallCheck(mid, NEW_CAP);
  ok(/超出本机可存的上限/.test(over.why || ""), "拒绝理由说明超上限");
  ok(over.why.indexOf(String(Math.round(NEW_CAP / 1024))) >= 0, "★ 理由里带上限的具体 KB 数");
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
  /* v3.34.6（P2-5）：判据从"那一行字面量还在"改成"**降级重压这个机制**还在"。
     原来钉 `cv.toDataURL("image/jpeg", 0.7)` 这个字面量，而本轮把两档 if 改成
     `for (const q of [0.7, 0.6])` 逐级降质量 ⇒ 字面量消失但机制更强了，
     钉字面量的写法会把"增强"误判成"删除"（旧版注释自己就记过同型教训）。
     改钉三件事：质量序列存在、目标常量为新图上限、循环里真的带两次降档。 */
  ok(/for \(const q of \[0\.7, 0\.6\]\)/.test(src),
    "★ 降级重压仍在且更强（0.82 → 0.7 → 0.6 逐级降质量）");
  ok(src.indexOf("out.length <= WALL_ACCEPT_BYTES") >= 0,
    "★ 重压目标 = 新图上限 WALL_ACCEPT_BYTES（不是读档容忍度）");
  /* onload 里不该再有 drawImage / toDataURL 的直接调用（那些是宿主能力，只留在纯函数里） */
  const onloadAt = src.indexOf("im.onload = () => {");
  ok(onloadAt >= 0, "onload 回调在位");
  if (onloadAt >= 0){
    const body = src.slice(onloadAt, onloadAt + 500);
    ok(body.indexOf("drawImage") < 0 && body.indexOf("toDataURL") < 0,
      "★ onload 里不再直接碰 canvas（只剩『拿能力 → 交给纯函数 → 按 why 分支』）");
  }
}
