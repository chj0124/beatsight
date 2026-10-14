/* BeatSight 自动化测试 · 渲染热路径的布局读取纪律（三视角体检 2026-10-15 · C2）
   T260 系列。
   ─────────────────────────────────────────────────────────────────────────────
   由来：三视角体检发现「帧内零 offset* 读取」这条 v1.3.0（审计 P1-4）的性能硬约束
   **只活在 DEVELOPMENT.md 与源码注释里，没有任何机器闸门**——下一轮改帧路径的人往
   paintFrame / paintFrameBody / paintBall 里加一次 `row.offsetWidth` 就能悄悄把
   layout thrashing（rAF 里最典型的性能反模式）请回来，中低端机上直接掉帧，而全套自验照旧全绿。
   （旁证：paintBall 自己的头注释一度就写着「几次 offsetLeft/offsetTop 读取」，与实现脱钩——
   已在本轮 C1 一并订正。）

   本用例把这条纪律变成可执行的静态断言：抽取三个帧函数的**函数体**（走 tools/scan-util 的
   括号配对），先遮蔽字符串/注释，再断言体内不出现任何会触发同步重排的布局属性读取。
   与 T27 互补——T27 用运行期探针**实测**一帧内零 offset* 读取，本用例从**源码**静态盯；
   两头夹住：改写帧路径后被运行期探针绕过（例如读到一个非 offset* 的布局 API），静态这头仍会红。

   为什么必须先遮蔽字符串与注释：paintBall 体内就有一条注释写着「原先每帧 2 次 offset* 读取」，
   不遮蔽会被误判成真读取——「注释里提到 API 名」造成的假阳性本仓踩过多次（见 tests/README）。 */
"use strict";
const { ok, section, html } = require("../lib/harness");
const { matchBrace, blankNonCode } = require("../../tools/scan-util");

/* 会触发同步重排/回流的布局属性读取。刻意**不含** style.*（写样式本身不读布局），
   也不含 getComputedStyle（它不强制重排）。 */
const LAYOUT_READ =
  /\b(offsetWidth|offsetHeight|offsetLeft|offsetTop|clientWidth|clientHeight|scrollWidth|scrollHeight|getBoundingClientRect)\b/;

/* 抽取以 header 起始的函数体（含首尾花括号）。定位/配对失败返回 null —— 用例据此报红，绝不静默放行
   （"抽取失败 ⇒ 空片段 ⇒ 零读取断言假绿"是这类源码扫描测试最危险的失效方式）。 */
function bodyOf(src, header){
  const at = src.indexOf(header);
  if (at < 0) return null;
  const end = matchBrace(src, at);
  if (end < 0) return null;
  return src.slice(at, end + 1);
}

/* must = 该函数体内**必然出现**的记号：防空抽取守卫（抽取到空/错位片段时，正控先红）。 */
const FRAMES = [
  { name: "paintFrame", header: "function paintFrame(){", must: "paintFrameBody(" },
  { name: "paintFrameBody", header: "function paintFrameBody(){", must: "cumBump(" },
  { name: "paintBall", header: "function paintBall(now, bar, tib, a){", must: "geoOf(" },
];

/* ================= 场景 T260a：三个帧函数体内零布局读取 ================= */
section("T260a 帧函数体内零布局读取（静态钉住 v1.3.0 性能硬约束）");
for (const f of FRAMES){
  const body = bodyOf(html, f.header);
  ok(body !== null, "★ " + f.name + " 函数体可定位（括号配对，含字符串/注释遮蔽）");
  if (body === null) continue;
  ok(body.indexOf(f.must) >= 0,
    "★ " + f.name + " 体内含预期记号「" + f.must + "」（防空抽取守卫：抽取对了才谈得上没读布局）");
  const code = blankNonCode(body);
  const m = code.match(LAYOUT_READ);
  ok(m === null, "★★ " + f.name + " 体内零布局读取（帧内读 offset*/getBoundingClientRect 会触发同步重排）"
    + (m ? "——实际发现：" + m[0] : ""));
}

/* ================= 场景 T260b：几何缓存机制仍在位（读取走缓存，采集另有入口） ================= */
section("T260b 几何缓存机制仍在位（帧内只读缓存，不自行量测）");
{
  ok(html.indexOf("function cacheGeo(){") >= 0, "★ cacheGeo() 采集函数在位");
  ok(html.indexOf("const geoOf = ") >= 0, "★ geoOf() 缓存读取入口在位（帧内几何一律经它）");
  ok(/rowGeo\s*=\s*rowEls\.map/.test(html), "★ cacheGeo 由 rowEls 一次性采集 rowGeo（帧内只读不采）");
  /* 反向锚点提示：T260c 的变异脚本会把一次布局读取注回 paintBall 体内，本组必须随之转红。 */
  ok(html.indexOf("function paintBall(now, bar, tib, a){") >= 0,
    "★ paintBall 签名未变（变异脚本的锚点；签名一改，反向验证脚本会以『锚点失配』大声失败）");
}
