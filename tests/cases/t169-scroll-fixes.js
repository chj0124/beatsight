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
  /* want 公式（v3.12.0）：拍区 n + 接缝层 1 + 拍号 n + 弦线 2（hasStr）= 2n+1+2·hasStr。
     教训同 v3.9.0：每加/换一层都要同步公式——漏改 = 判据永不成立、守卫每帧整拆重建。 */
  ok(/const want = nBeats \* 2 \+ 1 \+ \(hasStr \? 2 : 0\);/.test(html),
    "★★ rebuildCountLaneInto 的 want 公式 = 2n+1+2·hasStr（拍区 + 接缝层 + 拍号 + 弦线）");
  ok(!/const want = nBeats \* 3 - 1 \+ \(hasStr \? 2 : 0\);/.test(html),
    "★ 旧 want 公式（.grid-line 竖线时代）已退役");
}

section("T169b 预备拍道拍边界 = .seams 同款强缝（v3.12.0，用户拍板「与正常跑道完全同款」）");
{
  /* 演进：v3.2.3 .grid-line 竖线（1px、top:12/bottom:12、var(--line)）→ v3.9.0 补
     scroll 豁免放行 → **v3.12.0 改挂 .seams 覆盖层**：正常跑道的拍边界 = .seams 的
     2px 强缝（top:0、高 44/窄屏 34、骑缝 ±1px、var(--seam-strong)），由同一个
     seamGradient 生成——旧 .grid-line 短一截、细一档、色不同（用户实拍「竖线有问题」）。 */
  ok(/countLaneEl\.className = "bar-row count-lane"/.test(html),
    "★ 道挂 count-lane 专用类（道的标识，保留）");
  const fnSeg = html.slice(html.indexOf("function rebuildCountLaneInto"),
                           html.indexOf("function paintBall"));
  ok(/sm\.className = "seams"/.test(fnSeg) && /sm\.style\.background = seamGradient\(xs\)/.test(fnSeg),
    "★★ 道内拍边界 = .seams 层 + 同一个 seamGradient——与正常跑道逐位同款");
  ok(/xs\.push\(\{ x: k \/ nBeats \* 100, strong: true \}\)/.test(fnSeg),
    "★ 每条内部拍边界都是 strong 强缝（2px、var(--seam-strong)、骑缝 ±1px）");
  ok(!/gl\.className = "grid-line"/.test(fnSeg),
    "★ 道内不再建 .grid-line（旧竖线退役）");
  ok(!/\.viz\.scroll-mode \.count-lane \.grid-line\{display:block\}/.test(CSS_CODE),
    "★ scroll 豁免规则随 .grid-line 退役（道内没有 .grid-line 可豁免了）");
  ok(/\.viz\.scroll-mode \.grid-line\{display:none\}/.test(CSS_CODE),
    "★ 原规则原样在位（静止网格线对不上横移行槽的理由仍成立，不许动它）");
}

section("T169e 撤道机制演进史（v3.11.x 交叉淡出 → v3.12.0 自然退场，旧机制整体退役）");
{
  /* 演进：v3.2.3 方案 A（播完不撤、钉播放杆左侧）→ v3.11.0 交叉淡出 → v3.11.2 槽位留空
     → **v3.12.0（用户拍板）：道 = 传送带「第 −1 小节」，随整组 dy 滑出裁剪区自然退场，
     判据改相对锚点（cur > 首个可听小节 || 回卷）**。
     退役理由：三版旧机制都在"道该何时消失"上做文章——绝对判据对范围播放起点在中段
     开播即成立（预备拍播完道立刻消失），撤除/回填又制造"通宽 4 拍内容行突现"
     （"变成 4 拍长"）；用户要的是"道像其他跑道一样滚出去"，锚点口径一立，
     淡出/留空两套机制同时退役。行为断言归 t171（DOM 级，含范围起点在中段的回归）。 */
  ok(!/countLaneLastCur >= rowEls\.length/.test(html),
    "★★ 旧绝对判据 cur ≥ rowEls.length 已退役（范围播放开播即撤的根因，t171a 钉行为）");
  ok(!/countLaneFading/.test(html),
    "★ 交叉淡出机制整体退役（countLaneFading 旗 + opacity .18s 淡出 + dyingLane 闭包）");
  ok(!/dyingLane/.test(html),
    "★ dyingLane 局部引用闭包随淡出机制一并退役");
  ok(/countLaneLastCur > countLaneStartCur \|\| loopWrapped/.test(html),
    "★★ 新判据在位：相对锚点（首个可听小节）+ 回卷收尾（单小节循环 cur 恒不变只能靠它）");
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
  /* ★ v3.13.0（用户拍板丁）：三轨 max-content 口径退役（第 3 块 v3.12.0 已退、行 1 内容
     624px 居中出 336/368px 空白且随窗口变大）——改两列 1fr + 限宽 1000 居中，真几何由
     smoke 的 row1 断言（盒宽/等宽/对称）钉死。 */
  ok(/\.viz-head-grid\{display:grid;grid-template-columns:minmax\(280px,1fr\) minmax\(min-content,1fr\);justify-content:center/.test(CSS_CODE),
    "★★ 行 1 两列 1fr 拉满（丁方案：空白不再随窗口稀释内容，滑杆/按钮自然跟长）");
  ok(/max-width:1000px/.test(CSS_CODE),
    "★★ 控制区限宽 1000px 居中（两侧空白恒定 ≈(容器−1000)/2）");
  ok(/column-gap:32px/.test(CSS_CODE),
    "★ 列距 32px（v3.9.0 拍板的聚拢间距，口径不变）");
  /* ★ v3.19.0：同轴居中钉退役（三列均分后开关列 = col 3，钉移 t168）。 */
  ok(!/grid-column:1 \/ -1;grid-row:2;justify-self:center;width:fit-content/.test(CSS_CODE),
    "★★ v3.19.0：开关块同轴居中落位退役（三列均分）");
}
