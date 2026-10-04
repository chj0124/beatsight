/* BeatSight 自动化测试 · v3.31.0 跑道特效重构思（已弹＝压暗）+ 宽屏铺满歌词修复（T178 系列）
   ---------------------------------------------------------------------------
   来源（用户报障，两件）：
     ① "播放完一个格子就用高亮把格子覆盖住，容错太小了……用高亮把格子覆盖住，用户就看不了。
        另外这种高亮对用户看下一个格子也会造成干扰，所以需要重新构思跑道上的特效方案。"
     ② "切换宽屏模式时，歌词会错位，而且歌词大小会超出格子……点击播放后，歌词位置恢复正常，
        但大小还是有问题。"

   本组钉住的契约：

   ① **「已弹」＝压暗（不再是整格刷白）**
      · 根因：格子填充与扫弦记号**同吃 `--peak`**（经典＝白底白记号，实测像素 Δ=0 记号彻底不可见；
        观测台＝墨底墨记号，同样中招）——两处必须**分离**，这是本组最重要的护栏。
      · 填充改走既有「压暗叠加」token `--well`（自带主题翻转）：.38；休止格轻一档 .28/.32。
      · 已弹格的细分线由深转浅（深色线在暗底上会整条消失），两张主题就此收敛。

   ② **宽屏开关必须重排**
      · `applyWideFull` 只切类，而歌词轨的 inline 落位/宽度与缓存 `lyricW` 都不会自己更新
        （实测 1920 铺满后 #viz 1392→1857，歌词轨仍停在 1392）→ 必须调 `Viz.relayout()`
        （本仓既有纪律：主题切换 / rulerLab / durLabel / chord-xl 都调，唯独它漏了）。
      · 但**只能挂用户切换路径**：启动恢复时装配层还没注入 patLenOf，会踩 patLenNotInjected。

   ③ **歌词字号必须有上限**
      · `--cs` 随 #viz 宽无界增长，而歌词行/块高固定（28/26）→ 字被裁。
      · 非铺满档 #viz 被主列 max-width:1440 封顶（实测 1392 ⇒ --cs 封顶 1.45），
        所以平时看不见——这是**铺满档独有**的缺陷。
      · 上限硬约束：**必须 ≥ 正常档的 23.2px**，否则会把已认可的非铺满观感改小；
        又必须 ≤ 字块高 26px 才放得下。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const fs = require("fs");
const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");
const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");   // 剥块注释（防注释里的字面量骗过断言）

/* 取一条规则体（与 t125 的 ruleOf 同口径：按选择器前缀定位到 "}"） */
const ruleOf = (src, sel) => {
  const i = src.indexOf(sel);
  if (i < 0) return "";
  const j = src.indexOf("}", i);
  return j < 0 ? "" : src.slice(i, j + 1);
};

/* ================= T178a：根因护栏 —— 填充色与记号墨色必须分离 ================= */
section("T178a 已弹格填充与扫弦记号**不同源**（白底白记号的根因护栏）");
{
  const cellRule = ruleOf(CSS_CODE, ".cell.played::before");
  ok(/background:rgba\(var\(--well\),\.38\)/.test(cellRule),
    "★★★ 已弹格填充 = 压暗 .38（不再是 var(--peak)）——用户拍板「已弹＝暗下去」");
  ok(!/var\(--peak\)/.test(cellRule),
    "★★★ 已弹填充**不再**吃 --peak —— 这是根因本身：填充与记号同源时，任何主题都会「底与记号同色」"
    + "（经典＝白底白记号，观测台＝墨底墨记号），记号彻底不可见");
  /* 记号仍吃 --peak：分离是**单侧**的（只把填充挪走，不动记号），
     故记号在压暗底上的对比不降反升（实测 Δ 0 → 219）。 */
  const shaft = ruleOf(CSS_CODE, ".strumv{position:absolute;top:0;bottom:0;width:2px");
  const shaftBefore = ruleOf(CSS_CODE, ".strumv::before");
  const arrowDn = ruleOf(CSS_CODE, ".strumv.dn::after");
  ok(/background:var\(--peak\)/.test(shaft) || /background:var\(--peak\)/.test(shaftBefore),
    "★★ 扫弦箭杆仍吃 --peak（分离只做在填充侧——这样记号只需一种墨色，不必按格子状态翻转）");
  ok(/border-bottom:7px solid var\(--peak\)/.test(arrowDn),
    "★★ 箭头三角同样仍吃 --peak（杆与头一致，不能只改一头）");
}

/* ================= T178b：休止格压得更轻 ================= */
section("T178b 休止格：压得轻一档（它的身份主要靠虚线边框）");
{
  ok(/background:rgba\(var\(--well\),\.28\)/.test(ruleOf(CSS_CODE, ".cell.rest.played::before")),
    "★★ 休止格已弹 = .28（比发声格 .38 轻）——休止格底色本就透明（露壁纸），压太重会在深壁纸上糊成黑洞");
  ok(/background:rgba\(var\(--well\),\.32\)/.test(ruleOf(CSS_CODE, ".cell.rest.active::before")),
    "★★ 休止格正在弹 = .32（同样走 --well，与发声格同族）");
  ok(/\.cell\.rest\{background:var\(--rest-fill\);border:1px dashed var\(--rest-line\)\}/.test(CSS_CODE),
    "★★ 休止格的虚线边框不受影响（压暗只动 ::before 填充层；底色改走 --rest-fill 令牌——经典档取值 transparent 与旧值逐位同值，日间档给专用灰）");
}

/* ================= T178c：细分线由深转浅 ================= */
section("T178c 已弹格的细分线：深色线在暗底上会消失");
{
  const sub = ruleOf(CSS_CODE, ".cell.played .sub,.cell.active .sub");
  ok(/border-right-color:rgba\(var\(--veil\),\.20\)/.test(sub),
    "★★ 已弹/正在弹的细分线 = 亮纱 .20（v3.31.0 由 rgba(0,0,0,.18) 改来——"
    + "原值是为白填充配的，压暗后会整条消失）");
  ok(!/rgba\(0,0,0,\.18\)/.test(sub), "★★ 旧的深色硬编码已不存在（不是两处并存）");
  ok(/border-right:1px solid rgba\(var\(--veil\),\.10\)/.test(ruleOf(CSS_CODE, ".cell .sub{")),
    "★ 基座细分线仍是 .10（未弹格不变）——只翻转「已弹」那一档");
}

/* ================= T178d：宽屏开关的重排 ================= */
section("T178d 宽屏铺满必须触发重排（歌词轨的 inline 落位不会自己更新）");
{
  ok(/relayoutAfterWideFull/.test(html),
    "★★★ 新增 relayoutAfterWideFull（宽屏切换的重排入口）");
  ok(/bindToggle\("wideToggle", \(\) => \(S\.wideFull = !S\.wideFull\), \(\) => \{ applyWideFull\(\); relayoutAfterWideFull\(\); \}\)/.test(html),
    "★★★ 重排挂在**用户切换**回调上：applyWideFull 在启动恢复时也会跑，而那时装配层还没注入 "
    + "patLenOf（patLenNotInjected 会抛错，实测踩到），且启动路径随后本就会走完整 buildViz");
  const fn = ruleOf(html.slice(html.indexOf("function applyWideFull")), "function applyWideFull");
  ok(!/relayout/.test(fn),
    "★★ applyWideFull 自身保持「只切类」——启动恢复路径不得触发重排");
  ok(/typeof Viz !== "undefined" && Viz && typeof Viz\.relayout === "function"/.test(html),
    "★★ 重排入口带类型闸门（boot 早期 Viz 可能尚未装配）");
}

/* ================= T178e：歌词字号上限（含「不得改小正常档」的不变量） ================= */
section("T178e 歌词字号上限：放得下 + 不改动正常档观感");
{
  const charRule = ruleOf(CSS_CODE, ".lyric-char{position:absolute;left:clamp(10px,25%,32px)");
  const m = /font-size:min\(calc\(16px \* var\(--cs, 1\)\), (\d+)px\)/.exec(charRule);
  ok(!!m, "★★ 歌词字号 = min(calc(16px * var(--cs,1)), Npx)（原来无上限）");
  const cap = m ? Number(m[1]) : NaN;
  /* 不变量一：上限必须 ≥ 非铺满档的字号上限（#viz 封顶 1392 ⇒ --cs = 1.45 ⇒ 16×1.45 = 23.2px），
     否则铺满开关一开一关之间，正常档的字会莫名其妙变小（用户已认可的观感不许被改小）。 */
  ok(cap >= 16 * 1.45,
    "★★★ 上限 " + cap + "px ≥ 正常档字号上限 23.2px（16 × 1392/960）——"
    + "低于它会把**非铺满**的观感也改小（那正是用户已认可的样子）");
  /* 不变量二：上限必须 ≤ 字块高 26px，否则裁字问题没解决 */
  const chipH = Number(/\.lyric-chip\{position:absolute;top:1px;height:(\d+)px/.exec(CSS_CODE)[1]);
  ok(cap <= chipH,
    "★★★ 上限 " + cap + "px ≤ 字块高 " + chipH + "px —— 否则等于没修（字照样被裁）");
  /* 双关放大档同款：17px 基准 × 1.45 = 24.65 ⇒ 卡 25px（同样不得改小正常档） */
  const xlRule = ruleOf(CSS_CODE, "#viz.no-ruler.no-durlab .lyric-row .lyric-char");
  const mx = /font-size:min\(calc\(17px \* var\(--cs, 1\)\), (\d+)px\)/.exec(xlRule);
  ok(!!mx && Number(mx[1]) >= 17 * 1.45 && Number(mx[1]) <= 30,
    "★★ 双关放大档 17px 同款加限（卡 25px：≥ 正常档 24.65、≤ 该档字块高 30）");
}

/* ================= T178f：行为 —— 切换宽屏开关不抛错（t102 已钉类名/持久化，此处补新风险） ================= */
section("T178f 行为：切换宽屏开关不得抛错（v3.31.0 新增了 relayout 调用）");
{
  /* ★ 与 t102 的分工：t102 钉「点开→body 加类 / 再点→摘除」（纯类名契约）；
     本组补的是**新引入的风险**——切换时多了一次 Viz.relayout()，若挂错时机就会抛
     （实测踩过：挂在 applyWideFull 里 → 启动恢复撞 patLenNotInjected）。
     桩环境无布局引擎，故这里只验「不抛错 + 状态正确」，真机几何由冒烟验。 */
  const app = loadApp({}, {});
  const tog = app.els["wideToggle"];
  ok(!!tog, "★ 前提：宽屏开关元素在场");
  const body = app.sandbox.document.body;
  const before = !!app.beat.Store.S.wideFull;
  let threw = null;
  try { tog.click(); } catch (e){ threw = e; }
  ok(!threw, "★★★ 切到铺满不抛错（relayout 时机正确；实际 " + (threw ? "抛了：" + threw.message : "无异常") + "）");
  eq(app.beat.Store.S.wideFull, !before, "★★ S.wideFull 已翻转");
  eq(body.classList.contains("wide-full"), !before, "★★ body 类跟随（纯 CSS 重排的前提）");
  let threw2 = null;
  try { tog.click(); } catch (e){ threw2 = e; }
  ok(!threw2 && app.beat.Store.S.wideFull === before && !body.classList.contains("wide-full"),
    "★★ 切回原状：不抛错、状态复位、类名摘除（不残留）");
}

/* ================= T178g：滚动模式切模式后歌词必须落到静止态（v3.31.1） ================= */
section("T178g 切滚动模式：歌词轨的静止态落位（用户报障「切滚动后歌词错位、按播放才恢复」）");
{
  /* ★ 根因：`reloadScroll()` 原先在 buildViz() 之后**又**调了一次 buildLyricLane()。
     buildViz 内部是「① buildLyricLane ② cacheGeo + applyScrollRest(true)」的顺序，
     那次重复重建把①换成了**新元素**，静止态的横向位移（写在元素 style 上）随之丢失——
     实测 1440×1000 切到滚动（未播放）：网格行在 24 / 1416，歌词行停在视口正中 720（差 696px），
     按播放后帧循环补上才恢复。真机几何由冒烟验，这里钉源码契约（防回潮）。 */
  const rs = ruleOf(html.slice(html.indexOf("function reloadScroll")), "function reloadScroll");
  ok(rs.length > 0 && /buildViz\(\)/.test(rs),
    "★★ 前提：reloadScroll 仍调 buildViz（它内部负责重建歌词轨 + scroll 静止态落位）");
  ok(!/buildLyricLane\(\)/.test(rs),
    "★★★ reloadScroll **不得**再调 buildLyricLane()——buildViz 内部已重建（L8054），"
    + "重复重建会把刚落好的静止态位移洗掉（本次用户报障的根因）");

  ok(/function rebuildLyricLane\(\)\{/.test(html),
    "★★★ 新增 rebuildLyricLane()：外部重建歌词轨的唯一入口（带静止态重落）");
  const rb = ruleOf(html.slice(html.indexOf("function rebuildLyricLane")), "function rebuildLyricLane");
  ok(/buildLyricLane\(\);/.test(rb) && /if \(S\.scrollMode && !S\.playing\) applyScrollRest\(true\);/.test(rb),
    "★★★ rebuildLyricLane = buildLyricLane() + （scroll 且停机时）applyScrollRest(true)"
    + "——重建后必须重落一次，否则歌词丢横向位移");
  ok(!/applyScrollRest/.test(rb.replace(/if \(S\.scrollMode && !S\.playing\) applyScrollRest\(true\);/g, "")),
    "★★ 重落只在**停机态**做：播放中帧循环每帧按 scrollDx 摆位，重落只会多写一次 DOM");
  ok(/rebuildLyricLane,/.test(html),
    "★★ rebuildLyricLane 已进 Viz 出口面（Controls 声明在 Viz 之后，单向调用）");
  /* 两处外部调用（歌词总开关 / 歌词位置）必须走新入口——它们原先直接 buildLyricLane() */
  ok(!/Viz\.buildLyricLane\(\)/.test(html),
    "★★★ 外部不再有任何 `Viz.buildLyricLane()` 直调（那是丢位移的写法）");
  eq((html.match(/Viz\.rebuildLyricLane\(\)/g) || []).length, 2,
    "★★ 两处外部调用点（显示歌词开关 / 歌词位置组）都改用 rebuildLyricLane");
}

/* ================= T178h：拍点闪烁的亮度档不得再按类名猜（v3.31.1） ================= */
section("T178h 十六分闪烁配色：跟随填充的实际明暗，不按类名猜");
{
  /* ★ 用户报障「播放后当前小节第一个格子左边多出一块东西」的**真凶**：
     `paintBeatFlash` 原先用 `onWhite = cellNode.classList.contains("played")||("active")`
     （注释：「正在弹的块也是白填充」）来挑亮度档；v3.31.0 把填充从纯白改成压暗之后，
     这个判据语义**反转**——它给近黑底挑为白底调的 strong（绿 40%），
     加之动画 260ms > 96BPM 的十六分 156ms（首尾相接、几乎常亮），
     于是暗格里常驻一块明显的绿块。白底时代那只是"白上一层淡绿"，几乎看不出。 */
  /* ★ 不能用 ruleOf 取这个函数——它只在**第一个 `}`** 处截断，而 paintBeatFlash 里
     第一个 `}` 属于内层 if 块，够不到后面的 `fillFlash` 行（首版就这么写错、直接红）。
     改成从函数起点切固定窗口（函数总长 ~1.6KB）。 */
  const pf = html.slice(html.indexOf("function paintBeatFlash"), html.indexOf("function paintBeatFlash") + 2200);
  ok(pf.length > 200 && /fillFlash/.test(pf), "★ 前提：paintBeatFlash 可定位（窗口内含 fillFlash）");
  /* ★ 必须**先剥注释再断言**：上面那段根因说明里正当地提到了 onWhite / getComputedStyle，
     直接把注释算进来会让这两条假红（首版就这么踩的，本组的第二次假红）。 */
  const pfCode = pf.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok(!/onWhite/.test(pfCode),
    "★★★ 删掉「按类名猜底色明暗」的 onWhite 判据——填充改压暗后它的语义反转了");
  ok(/const fillFlash = fc\.soft;/.test(pfCode),
    "★★★ 闪烁填充档恒取 soft（28%）：填充自 v3.31.0 起恒为压暗"
    + "（--well 在 classic=黑 / obs=墨蓝），为白底调的 strong 落在近黑底上会炸成块");
  ok(!/getComputedStyle/.test(pfCode),
    "★★ 不得改成运行时读 getComputedStyle——那是渲染热路径里的布局读取（P1-4 性能纪律）");
  /* 与它配套的登记表已成死代码，一并退役 */
  ok(!/subCellEls/.test(html.replace(/★ v3\.31\.1[\s\S]{0,400}?登记表没人读就是纯负担[^]*?\*\//, "")),
    "★★ subCellEls（十六分→宿主 cell 的查表）整条退役——它唯一的消费者就是上面那个判据，"
    + "登记表没人读就是纯负担（建网格时每格多写一次对象属性）");
}

/* ================= T178i：空扫（虚线）不得被"正在弹"高亮染成实线（v3.31.2） ================= */
section("T178i 空扫＝蓝虚线，播放中不被染绿（用户报障「虚线被染得跟实线差不多」）");
{
  /* ★ 根因：**特异性打平、靠源序决胜负**的覆盖——
       `.strumv.ghost::before{background:none;border-left:2px dashed var(--blue)}`  (0,2,0)
       `.strumv.hit::before{background:var(--green)}`                              (0,2,0)
     两者同为 (0,2,0)，而 `.hit` 在样式表里更靠后 ⇒ 空扫的 `background:none` 被覆盖，
     虚线杆身底下铺满绿色实底（盒宽 0 + 2px 左虚线边框，背景默认按 border-box 铺到边框下），
     视觉上虚线消失、读成一根绿实线；三角也被 `.hit::after` 染绿。
     变异实证（摘掉下面四条规则后再读计算样式）：
       ghost+hit 的 `::before` = `rgb(30,215,96)`、`::after` = 7px `rgb(30,215,96)` —— 与实扫**完全同色**。 */
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/\.strumv\.hit\.ghost\{filter:none\}/.test(css),
    "★★★ 空扫在播放中**不加发声光晕**（filter:none）——绿在本仓的语义是「正在发声」(v3.4.0)，"
    + "而空扫只动手不出声；位置已由 .cell.active 的描边表达");
  ok(/\.strumv\.hit\.ghost::before\{background:none;border-left-color:var\(--blue\)\}/.test(css),
    "★★★ 空扫杆身保持 `background:none` + 蓝虚线（作用域 .strumv.hit.ghost 为 (0,3,0)，"
    + "胜过 .strumv.hit 的 (0,2,0)，**不依赖源序**）");
  ok(/\.strumv\.hit\.ghost::after\{border-bottom-color:var\(--blue\)\}/.test(css)
     && /\.strumv\.hit\.ghost\.up::after\{border-top-color:var\(--blue\);border-bottom-color:transparent\}/.test(css),
    "★★★ 空扫的三角头**两个方向都**保持蓝色（下扫染 border-bottom、上扫染 border-top，"
    + "与既有的 .ghost 两条规则一一对应，不能只改一头）");
  /* 反向护栏：实扫必须仍然染绿（别把 .hit 整体改掉） */
  ok(/\.strumv\.hit::before\{background:var\(--green\)\}/.test(css)
     && /\.strumv\.hit::after\{border-bottom-color:var\(--green\)\}/.test(css),
    "★★ 实扫（非 ghost）仍按 .hit 染绿——本条只给空扫开例外，不动实扫的「正在发声」提示");
  /* 源序纪律：四条例外必须排在 `.hit` 主规则**之后**（虽然特异性已足够，仍按本仓惯例靠后放便于阅读） */
  ok(css.indexOf(".strumv.hit.ghost") > css.indexOf(".strumv.hit::before"),
    "★★ 例外规则排在 .hit 主规则之后（本仓惯例：作用域收窄的例外放后面）");
}

/* ================= T178j：正在弹的实扫格 = 绿意洗底 + 保留纸面底（v3.31.3） ================= */
section("T178j 正在弹格与休止格必须可区分（用户报障「实扫格背景变得和空扫格一样」）");
{
  /* ★ 根因（实测六态亮度）：「正在弹·实扫格」原为 `background:transparent` + `--well .38`，
     而 `transparent` 把它**原有的纸面底**（`.cell` 的 rgba(--veil,.14)）一并去掉 ⇒ 亮度 15.0，
     与「空扫/休止格」的 16–24 几乎同亮，与休止的分离度仅 **−1.2**（＝无法区分）。 */
  const activeCell = ruleOf(CSS_CODE, ".cell.active{");
  ok(/background:rgba\(var\(--veil\),\.14\)/.test(activeCell),
    "★★★ 正在弹格**保留纸面底**（rgba(--veil,.14)）——修前是 `background:transparent`，"
    + "那正是它与休止格同亮的直接原因");
  ok(!/background:transparent/.test(activeCell),
    "★★★ 不再用 `background:transparent`（回归护栏：这一条回退就等于问题复发）");

  const activeFill = ruleOf(CSS_CODE, ".cell.active::before");
  ok(/background:color-mix\(in srgb, var\(--green\) 22%, transparent\)/.test(activeFill),
    "★★★ 正在弹格填充 = 绿意洗底 22%（实测亮度 71.8：与休止 +53.8、与已弹 +39.8、与未弹 +20.8，四档全拉开）");
  ok(!/var\(--well\)/.test(activeFill),
    "★★★ 正在弹格**不再**用 --well 压暗（否则又回到与休止格同亮）");
  /* 主题跟随：不能写死 rgba(30,215,96,…)——--green 在观测台主题下是 #2563EB（L1858） */
  ok(!/rgba\(30,\s*215,\s*96/.test(activeFill),
    "★★ 用 `color-mix(var(--green))` 而非写死绿色——观测台主题下 --green 翻成蓝色，写死会让「正在发声」变绿");
  ok(/color-mix/.test(ruleOf(CSS_CODE, ".arg-lyric-ghost{")),
    "★ 写法有本仓先例（.arg-lyric-ghost 同款 color-mix），不是新造轮子");

  /* ★ 空扫/休止格**不受影响**：靠特异性而非源序——`.cell.rest.active::before` 的类数更多 */
  const restFill = ruleOf(CSS_CODE, ".cell.rest.active::before");
  ok(/background:rgba\(var\(--well\),\.32\)/.test(restFill),
    "★★★ 空扫/休止格仍是中性压暗 .32（实测计算值 rgba(0,0,0,.32)，**没有变绿**）");
  const dotsOf = sel => (sel.match(/\./g) || []).length;
  const actSel = ".cell.active::before", restSel = ".cell.rest.active::before";
  ok(dotsOf(restSel) > dotsOf(actSel),
    "★★★ 休止格选择器的类数（" + dotsOf(restSel) + "）多于正在弹格（" + dotsOf(actSel) + "）"
    + "⇒ 特异性更高、**不依赖源序**就能压过绿意洗底（这是「空扫不会被染绿」的机制保证）");
  /* 反向护栏：绿意只给"正在弹"，不许波及"已弹" */
  ok(/background:rgba\(var\(--well\),\.38\)/.test(ruleOf(CSS_CODE, ".cell.played::before")),
    "★★ 已弹格仍是压暗 .38（绿意只给正在弹的那一格，不动已弹——用户此前明确要「已弹＝暗下去」）");
}
