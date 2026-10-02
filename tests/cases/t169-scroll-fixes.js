/* BeatSight 自动化测试 · v3.9.0 三修（用户实拍批）
   T169 系列。
   ---------------------------------------------------------------------------
   ① 预备拍跑道"一瞬间变成 4 拍长"：buildViz 每次重建都用 buildRowLayers 按**拍号**
      建道（4/4 → 4 拍结构），而道的长度语义是**预备拍拍数**——重建与下一帧
      paintBall 守卫的重塑之间存在竞态窗口，窗口里道是 4 拍结构（用户实拍可见）。
      修法：建完立刻按 S.countIn.beats 重塑，让 4 拍结构从头不存在。
      连带修 want 公式：实际子元素 = 拍区 n + 竖线 n−1 + 拍号 n + 弦线 2
      = 3n−1+2·hasStr，旧式 2n+2·hasStr 少算竖线 → 判据永不成立、守卫每帧整拆重建。
   ② 预备拍道内竖线"实现了但看不见"：竖线代码 v3.2.3 就在（rebuildCountLaneInto 建
      拍数−1 条 .grid-line），被 `.viz.scroll-mode .grid-line{display:none}` 连坐隐藏。
      道内竖线是行内 DOM、随道移动，不受那条规则的理由约束 → 豁免放行。
   ③ 图例关闭后跑道错位：#vizLegendClose 处理器只藏元素不重采几何，跑道按 cacheGeo
      旧 top 定位 → 错位，开播（buildViz）才恢复。与 rulerLabToggle 同一条纪律：
      改了布局高度就 Viz.relayout()。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

section("T169a 预备拍道按预备拍拍数构建（4 拍闪变根除）");
{
  /* 建道后必须立刻重塑——buildRowLayers 与 rebuildCountLaneInto 相邻出现（中间只隔
     zoneEls.pop() 等注册表摘除），这是"建完即按拍数整形"的精确形状。 */
  const buildSeg = html.slice(html.indexOf("countLaneEl = document.createElement"),
                              html.indexOf("zoneEls.pop()"));
  ok(/buildRowLayers\(0, countLaneEl, vizHasStrum\(\), 0\)/.test(buildSeg),
    "★ 道仍由 buildRowLayers 构建（与真实跑道同款观感的来源，不动）");
  ok(/rebuildCountLaneInto\(countLaneEl, S\.countIn\.beats \|\| rowBeats\(\), vizHasStrum\(\)\)/.test(buildSeg),
    "★★ 建完立刻按预备拍拍数重塑——4/4 拍号的 4 拍结构在 DOM 里从头就不存在，"
    + "重建与帧守卫之间的竞态窗口无从发作（用户实拍的「一瞬间 4 拍」根除）");
  /* want 公式：拍区 n + 竖线 n−1 + 拍号 n + 弦线 2（hasStr）= 3n−1+2·hasStr。
     旧式 2n+2·hasStr 少算竖线 → 判据永不成立 → 守卫每帧整拆重建（白耗 + 结构常驻抖动）。 */
  ok(/const want = nBeats \* 3 - 1 \+ \(hasStr \? 2 : 0\);/.test(html),
    "★★ rebuildCountLaneInto 的 want 公式计入竖线（3n−1+2·hasStr）——"
    + "旧式 2n+2 少算竖线，判据永不成立、守卫每帧整拆重建整条道");
  ok(!/const want = nBeats \* 2 \+ \(hasStr \? 2 : 0\);/.test(html),
    "★ 旧 want 公式（少算竖线的写法）已退役");
}

section("T169b 预备拍道内竖线放行（scroll 豁免）");
{
  ok(/countLaneEl\.className = "bar-row count-lane"/.test(html),
    "★★ 道挂 count-lane 专用类——豁免规则的挂点（没有类名就没法只放行道内竖线）");
  ok(/\.viz\.scroll-mode \.grid-line\{display:none\}/.test(CSS_CODE),
    "★ 原规则原样在位（静止网格线对不上横移行槽的理由仍成立，不许动它）");
  ok(/\.viz\.scroll-mode \.count-lane \.grid-line\{display:block\}/.test(CSS_CODE),
    "★★ 道内竖线豁免放行——竖线是行内 DOM、随道移动，不受原规则理由约束；"
    + "v3.2.3 的竖线代码自此真正可见（用户实拍「Agent 说实现了但看不见」的根因）");
}

section("T169e 撤道交叉淡出（宽度突变硬切根除）");
{
  /* 用户实拍二连（预备拍=1/2 拍，两种触发：单小节循环每轮回卷 / 首轮窗口播完）：
     撤道瞬间道（N 拍短条）隐、row0（4 拍通宽内容行）显，同帧一隐一显 =
     "跑道一瞬间变成 4 拍长"。修法：row0 先复位显形，道 opacity 180ms 淡出后再
     display:none——硬切变交叉淡出；REDUCE_MOTION 跳过；淡出窗口内守卫不得抢隐藏。 */
  const at = html.indexOf("countLaneLastCur >= rowEls.length");
  const seg = html.slice(html.lastIndexOf("if (countLaneEl &&", at), at + 900);
  ok(/countLaneFading = true/.test(seg) && /transition = "opacity \.18s linear"/.test(seg)
     && /dyingLane\.style\.display = "none"/.test(seg),
    "★★ 撤道 = row0 先复位 + 道 opacity .18s 淡出后再 display:none（交叉淡出；"
    + "闭包锁局部引用 dyingLane，不锁会被 buildViz 重指向的模块级变量）");
  ok(/REDUCE_MOTION/.test(seg),
    "★ REDUCE_MOTION 用户跳过淡出（既有降级纪律）");
  ok(/!countLaneFading/.test(html.slice(html.indexOf('} else if (countLaneEl && countLaneEl.style.display !== "none"'),
    html.indexOf('} else if (countLaneEl && countLaneEl.style.display !== "none"') + 140)),
    "★★ 淡出窗口内 paintBall 守卫不得抢着 display:none（!countLaneFading 闸——"
    + "否则下一帧就把淡出中的道藏掉，交叉淡出退化回硬切）");
  ok(/let countLaneFading = false/.test(html),
    "★ countLaneFading 旗有声明（默认 false）");
  /* ★★ v3.11.2（用户三轮实拍裁决，推翻 v3.11.0/v3.11.1 的交叉淡出思路）：
     撤道后 **row0 不复位显形，槽位留空**——预备拍≠4 时道是 N 拍短条，撤道后顶上来的
     真实上一小节是 4 拍通宽，无论怎么过渡，"跑道一瞬间变成 4 拍长"的观感都在。
     内容由下一次网格重建（翻页/回卷/段变化）自然回填，不再是孤立的突现。 */
  ok(!/rowEls\[0\]\.style\.visibility = ""/.test(seg),
    "★★★ 撤道块内不得复位 row0（visibility 置空 = 通宽内容行瞬间显形 = "
    + "「变成 4 拍长」的观感本体；槽位留空、由下一次网格重建自然回填）");
}

section("T169c 图例关闭重采几何（错位根除）");
{
  const h = html.indexOf('vizLegendClose").addEventListener');
  const seg = html.slice(h, h + 600).replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/vizLegendClose"\)\.addEventListener/.test(seg) && /Store\.persist\(\)/.test(seg),
    "★ 关闭处理器在（置状态 + 藏元素 + 落盘，原样保留）");
  ok(/Viz\.relayout\(\)/.test(seg),
    "★★ 关闭后调 Viz.relayout()——图例条高度一消失，cacheGeo 的旧 top 就失效，"
    + "不重采则跑道集体按旧偏移画（用户实拍的错位）；与 rulerLabToggle 同一条纪律："
    + "改了布局高度就重采。★ 匹配前剥掉块注释——注释里的方法名字样会骗过断言（变异实测踩过）");
}

section("T169d 头部聚拢与参数区列对齐（源码级契约，真几何归 smoke）");
{
  ok(/\.viz-head-grid\{display:grid;grid-template-columns:minmax\(280px,312px\) minmax\(min-content,max-content\) minmax\(min-content,max-content\);justify-content:center/.test(CSS_CODE),
    "★★ 头部三块居中聚拢（推翻 v3.3.1 的 space-between：屏越宽缝越大，用户实拍判不可接受）；"
    + "后两轨保留 min-content 兜底（BPM 组内行最宽 ~610px，压到 312 会与邻组重叠）");
  ok(/column-gap:32px/.test(CSS_CODE),
    "★ 列距 32px（用户拍板的聚拢间距）");
  ok(/\.viz-head-grid \.viz-toggles\{grid-column:1 \/ -1;grid-row:2;justify-self:center;width:fit-content\}/.test(CSS_CODE),
    "★★ 开关参数块与行 1 同轴居中（fit-content + justify-self:center）");
}
