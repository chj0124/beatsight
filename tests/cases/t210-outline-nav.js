/* T210 侧栏大纲导航（v3.34.8）
   ---------------------------------------------------------------------------
   需求：在曲式编排页左侧加一个大纲，每段一行显示「缩小版节奏型 + 歌词」，
   用来**迅速找到想要的那一段**——此前只能靠展开段卡片逐段翻。

   钉六件事：
     ① 每段一行，行内三样：序号 / 段名 / 节奏型缩略带；行数 = 段数
     ② 缩略带**取该段的特征小节**（首块首小节），且**发声/空扫/休止三态可辨**
        —— 这是"密度即签名"的载体，糊成一个色块就失去意义
     ③ 歌词**只对唯一的当前段展开**（整首范围下不展开）——否则大纲退化成"每条两行的长河"
     ④ 点行 = 设范围到该段（与歌曲地图同一套 setRange）
     ⑤ 窄屏抽屉：靠**搬迁同一份节点**实现（不另渲染一份），且开关态用显式变量
     ⑥ 行与段一一对应（不是按块/按小节展开）
   ============================================================================ */
const { loadApp, ok, eq, section } = require("../lib/harness");

const openArrange = () => {
  const app = loadApp(undefined, { seedDemo: false });
  app.beat.Arrange.open();
  return app;
};
/* ★ v3.35.0：曲式库并入左栏后，段树是**曲式条的兄弟节点**（class .arg-ol-secs）
   挂在 #argList 里；原先那个常驻的 #argOutline 容器已退役（改由 mkOutlineTree 现建）。 */
const secTreeOf = els => els["argList"].children.find(c => /(^| )arg-ol-secs( |$)/.test(c.className));
const rowsOf = els => (secTreeOf(els) ? secTreeOf(els).children.filter(c => /(^| )arg-ol-row( |$)/.test(c.className)) : []);
const lyrOf = els => (secTreeOf(els) ? secTreeOf(els).children.filter(c => /(^| )arg-ol-lyr( |$)/.test(c.className)) : []);
/** 缩略带的三态签名：● 发声 / ○ 空扫 / □ 休止 */
const sigOf = row => {
  const strip = row.children.filter(c => /(^| )arg-ol-strip( |$)/.test(c.className))[0];
  if (!strip) return "";
  return strip.children.map(c => {
    const cl = String(c.className);
    if (/rest/.test(cl)) return "□";
    if (/sub/.test(cl)) return "○";
    return "●";
  }).join("");
};

section("T210a 大纲 · 一段一行，行内三样");
{
  const { beat, els } = openArrange();
  const src = require("../lib/harness").html;
  const a = beat.Store.findArrange(beat.DEMO_ID);
  const rows = rowsOf(els);
  eq(rows.length, a.sections.length, "★ 行数 = 段数（9 段 9 行）");
  ok(rows.length > 0, "大纲已渲染");
  const r0 = rows[0];
  eq(r0.children.length, 3, "每行恰好三样：序号 / 段名 / 缩略带");
  eq(r0.children[0].className, "arg-ol-no", "第 1 样 = 序号");
  eq(r0.children[1].className, "arg-ol-nm", "第 2 样 = 段名");
  ok(/arg-ol-strip/.test(r0.children[2].className), "第 3 样 = 缩略带");
  eq(rows.map(r => r.children[1].textContent).join("|"),
     a.sections.map(s => s.name).join("|"),
     "★ 行序与段序逐一对应（不是按块或按小节展开）");
  eq(rows[0].children[0].textContent, "1", "序号从 1 起（与歌曲地图同口径）");
  /* 桩的 textContent 是元素自己的字符串字段、**不聚合子节点** ⇒ 必须逐个子节点断言 */
  /* 表头两层：顶层 = 左栏「曲式」区（曲式库），段树自带一行读数。
     ★ 桩不解析静态标记的子节点（els 是懒创建的），故表头这种**标记里写死**的结构
       走源码断言；运行期写入的读数（#argLibCount）才从 els 读。 */
  ok(/class="arg-lib-h"[\s\S]{0,120}<b>曲式<\/b>/.test(src), "★ 左栏顶部是「曲式」区表头（曲式库已并入）");
  ok(/id="argLibCount"/.test(src), "表头有首数读数位");
  eq(els["argLibCount"].textContent, "2 首", "表头报曲式首数（运行期写入）");
  const head = secTreeOf(els).children[0];
  eq(head.className, "arg-outline-h", "段树首节点 = 读数行");
  ok(/9 段/.test(head.children[0].textContent) && /64 小节/.test(head.children[0].textContent),
     "段树报段数与全曲小节数（实际「" + head.children[0].textContent + "」）");
}

section("T210b 缩略带 · 取特征小节，且三态可辨（密度即签名）");
{
  const { beat, els } = openArrange();
  const rows = rowsOf(els);
  const sigs = rows.map(sigOf);
  ok(sigs.every(s => s.length > 0), "每行都画出了缩略带");
  /* ① 三态都出现过：说明 rest/sub/solid 三种格子都被真的用上了（不是一律同色） */
  const all = sigs.join("");
  ok(all.indexOf("●") >= 0, "有发声格");
  ok(all.indexOf("○") >= 0, "有空扫格（响度更低的扫弦）");
  ok(all.indexOf("□") >= 0, "有休止格");
  /* ② 不同节奏型必须给出**不同**签名（否则「一眼分不出段落」= 功能失效） */
  ok(sigs[1] !== sigs[3], "★ 副歌（下上扫·密）与主歌二（前密后疏）签名不同");
  ok(sigs[1] !== sigs[8], "★ 副歌与桥段签名不同");
  /* ③ 相同节奏型的段必须给出**相同**签名（这是同一份数据的自洽性） */
  eq(sigs[1], sigs[4], "★ 副歌第一遍与第二遍签名相同（同一节奏型）");
  eq(sigs[1], sigs[7], "★ 副歌第一遍与第三遍签名相同");
  eq(sigs[3], sigs[6], "★ 主歌二两遍签名相同");
}

section("T210c 歌词 · 每段都显示（v3.34.9 改；初版只在「恰好一段」时展开，而首开范围是整首 ⇒ 一条都不显示）");
{
  const { beat, els } = openArrange();
  /* ★★ v3.34.9：**每段都显示歌词**（初版只在"恰好一段"时展开，而首开范围是整首
     ⇒ 一条歌词都不显示，与"看得到缩小版歌词"的需求正相反——用户实拍反馈）。 */
  const allLyr = lyrOf(els);
  eq(allLyr.length, beat.Store.findArrange(beat.DEMO_ID).sections.length,
     "★★ 每段都有歌词行（9 段 9 行）");
  ok(allLyr.every(l => String(l.textContent).length > 0), "每行都有内容（无词段写「（无歌词）」）");
  ok(String(allLyr[1].textContent).indexOf("回到家乡") === 0, "副歌的歌词从「回到家乡」起");
  ok(String(allLyr[2].textContent).indexOf("那年你踏上暮色") === 0, "主歌一的歌词逐字正确");
  /* 两遍主歌的歌词**不同** —— 这正是"靠歌词认出是哪一遍"的依据 */
  ok(String(allLyr[2].textContent) !== String(allLyr[5].textContent),
     "★ 两遍主歌一的歌词不同（这是大纲里唯一能分辨遍次的线索）");
  /* ★ v3.35.1：整首范围**不**逐段高亮 —— 「全都在范围内」染绿没有信息量，
     与侧栏那条既有原则同源（整首范围在默认态不显示读数）。
     绿底只在"范围收窄成局部"时出现，那才是"我练的是这几段"的有效读数。 */
  eq(rowsOf(els).filter(r => /(^| )sel( |$)/.test(r.className)).length, 0,
     "★★ 整首范围下**零**高亮（逐段染绿没有信息量）");

  /* 收窄到**单独一段** ⇒ 该段高亮 + 它的歌词展开，且只有一行。
     ★ 走**点击**而不是直接调 jumpTo：jumpTo 只写 S.arrangeSel，重渲染由调用方负责，
       直接调它测不到"点一下会发生什么"——而点行正是用户动作。 */
  rowsOf(els)[0].fire("click");   // 段 0 = 引子（1 小节）
  /* 单段范围：歌词总行数不变（每段都有），但**该段的词行被标记为当前**（字色提亮） */
  eq(lyrOf(els).length,
     beat.Store.findArrange(beat.DEMO_ID).sections.length, "歌词行数不随范围变（每段恒定一行）");
  const cur = lyrOf(els).filter(c => /(^| )cur( |$)/.test(c.className));
  eq(cur.length, 1, "★ 恰有一行被标为「当前段」");
  eq(cur[0].textContent, "我多想", "★ 标为当前的正是引子段的词");
  const selRows = rowsOf(els).filter(r => /(^| )sel( |$)/.test(r.className));
  eq(selRows.length, 1, "只有那一段高亮");
  eq(selRows[0].children[1].textContent, "引子 · 我多想", "高亮的正是引子段");
}

section("T210d 点行 → 设范围到该段（与歌曲地图同一套 setRange）");
{
  const { beat, els } = openArrange();
  const a = beat.Store.findArrange(beat.DEMO_ID);
  /* 点第 3 行（主歌一·第一遍）——它的起止小节要按段长现算，不写死 */
  const rows = rowsOf(els);
  rows[2].fire("click");
  const want = a.sections.slice(0, 2).reduce((n, s) => n + beat.secBars(s), 0);
  eq(beat.Store.S.arrangeSel.from, want, "★ 起点 = 该段首小节（0 基）");
  eq(beat.Store.S.arrangeSel.to, want + beat.secBars(a.sections[2]) - 1, "★ 终点 = 该段末小节");
  eq(beat.Store.S.arrangeSel.id, beat.DEMO_ID, "范围仍指向这首曲式");
  /* 点完之后该段应变成唯一高亮段 */
  const selRows = rowsOf(els).filter(r => /(^| )sel( |$)/.test(r.className));
  eq(selRows.length, 1, "点选后只有一段高亮");
  eq(selRows[0].children[1].textContent, a.sections[2].name, "高亮的就是被点的那段");
}

section("T210e 窄屏抽屉 · 搬迁同一份节点（不另渲染一份）");
{
  const app = openArrange();
  const { els } = app;
  /* ★ 桩的 els[id] 是**懒创建**的：只有应用调用过 $("id") 之后该元素才存在
     （elFor 首次访问时才 makeEl 并缓存）。抽屉在宽屏不可见、应用没碰过它，
     直接读 els["argTocDrawer"] 会得到 undefined ⇒ 先经 getElementById 造出来再读。 */
  const D = id => app.sandbox.document.getElementById(id);
  /* v3.35.0：抽屉搬的是**侧栏外壳 #argSide**（它同时装着曲式库与段树），
     段树本身不搬 ⇒ 断言对象与"搬回去的落点"都改指 #argSide。 */
  const drawer = D("argTocDrawer"), mask = D("argTocMask"), ol = D("argSide");   // 懒创建 ⇒ 一律经 D()
  /* 开关态走**显式变量**，不读 el.hidden（桩不解析静态属性，初值与真机相反——
     读它会让键盘层以为抽屉常开，吞掉 Esc/空格；实测打翻 35 条其余 overlay 断言） */
  eq(drawer.hidden, true, "初始：抽屉关（hidden 由 JS 显式写，不看标记初值）");
  eq(mask.hidden, true, "初始：遮罩关");
  /* 家 = #argShell（应用里显式指向它，见 openToc 注释：桩里静态元素是孤儿，
     现取 parentNode 会得到 null ⇒ 搬回变 no-op）。 */
  const homeParent = D("argShell");
  els["argTocBtn"].fire("click");
  eq(drawer.hidden, false, "★ 点「目录」→ 抽屉开");
  eq(mask.hidden, false, "遮罩同步开");
  /* ★ 比节点身份必须用 ok(a===b)：eq 的消息里 JSON.stringify 会因 parentNode↔children
     互相引用而抛「Converting circular structure to JSON」（实测崩在断言处）。 */
  ok(ol.parentNode === drawer, "★★ 侧栏节点被**搬进**抽屉（同一份节点，不是又渲染一份）");
  ok(!!homeParent, "侧栏容器 #argShell 存在（搬迁的固定落点）");
  /* 关：点遮罩（与其余抽屉的关闭手势一致） */
  mask.fire("click");
  eq(drawer.hidden, true, "★ 点遮罩 → 关闭");
  ok(ol.parentNode === homeParent, "★★ 节点被搬回原位（DOM 序不变）");
  /* 再点一次「目录」应能重开（不是一次性） */
  els["argTocBtn"].fire("click");
  eq(drawer.hidden, false, "★ 可反复开关");
  els["argTocBtn"].fire("click");
  eq(drawer.hidden, true, "再点按钮即关（同一入口 toggle）");
  ok(ol.parentNode === homeParent, "两次开关后仍回到原位");
}

section("T210g 布局 · 侧栏宽度与容器放宽（v3.34.9 用户反馈「太小」）");
{
  const { html } = require("../lib/harness");
  /* 用户实拍：「大纲区域太小」。初版侧栏 196px、缩略带 44px、字号 12px。
     修法：侧栏 288px、带 64px、字号 13px；并把编排页容器上限放宽到 1360px
     （1080 上限是为**编辑器页**工具栏立的，编排页顶栏只有返回+标题，没这个约束）。 */
  const m = /grid-template-columns:288px minmax\(0,1fr\)/.exec(html);
  ok(!!m, "★★ 侧栏 288px（原 196px）");
  ok(/#arrangeOverlay \.editor-inner\{max-width:1360px\}/.test(html),
     "★ 编排页容器放宽到 1360px（否则 288 侧栏会把正文挤扁）");
  ok(/\.arg-ol-strip\{flex:none;width:64px/.test(html), "★ 缩略带加宽到 64px（原 44px）");
  ok(/\.arg-ol-row\{[^}]*font-size:13px/.test(html), "★ 段名字号 13px（原 12px）");
  /* 放宽不能影响编辑器/帮助页：两者的 .editor-inner 上限必须仍是 1080 */
  ok(/\.editor-inner\{max-width:1080px/.test(html), "★ 通用 .editor-inner 仍是 1080px（只放宽编排页）");
}

section("T210f 源码钉 · 缩略带不克隆卡片节点（两处 DOM 不共用）");
{
  const { html } = require("../lib/harness");
  /* 设计决定：大纲的缩略带**重新生成轻量小块**，不克隆卡片里的 .arg-pat-bar
     （克隆会让两处共用同一节点，以后任一处改样式/加类都会互相影响）。
     ★ 断言必须**限定在大纲那两个函数体内**：全文件是有 cloneNode 的（帮助页 <template>
       惰性挂载，v2.37.0 的既有用法），"全文件没有"会假红——第一版就是这么写的。 */
  /* v3.35.0：renderOutline 已改名为 mkOutlineTree（且曲式条的段树也由它产） */
  const seg = html.slice(html.indexOf("function mkOutlineTree"), html.indexOf("function renderPanel"));
  ok(seg.length > 200, "取到大纲渲染代码段（锚点有效）");
  ok(!/cloneNode/.test(seg), "★★ 大纲渲染里不用 cloneNode（与卡片各自生成，不共用节点）");
  ok(!/mkPatBar\(/.test(seg), "★ 也不直接调 mkPatBar（只复用它的**数据口径**，不复用它的重节点）");
  ok(/arg-ol-row/.test(html) && /arg-ol-strip/.test(html), "大纲的类名在标记/样式里都在位");
  ok(/id="argOutline"/.test(html), "段树容器 #argOutline 在标记里");
  ok(/id="argSide"/.test(html), "★ 侧栏外壳 #argSide 在标记里（抽屉搬它）");
  ok(/id="argLibCount"/.test(html), "★ 曲式首数读数位（表头）在标记里");
  ok(/id="argTocDrawer"/.test(html) && /id="argTocBtn"/.test(html), "窄屏抽屉与「目录」钮在标记里");
}

section("T210h 曲式并入左栏 · 两级树（v3.35.0）");
{
  const { beat, els } = openArrange();
  const html = require("../lib/harness").html;   // ★ 源码文本来自 harness 模块，不在 loadApp() 返回里
  const list = els["argList"];
  const songs = list.children.filter(c => /(^| )arg-item( |$)/.test(c.className));
  const trees = list.children.filter(c => /(^| )arg-ol-secs( |$)/.test(c.className));
  const seps = list.children.filter(c => /(^| )arg-ol-sep( |$)/.test(c.className));

  eq(songs.length, 2, "★ 顶层 = 曲式条（2 首示例曲）");
  eq(trees.length, 1, "★★ 手风琴：只展开**当前这一首**（1 份段树）");
  eq(seps.length, 1, "★ 两首之间恰 1 条分隔线（末首之后不画）");
  /* 手风琴的判据 = curId ⇒ 展开的那首就是 sel 的那条，且段树紧跟其后 */
  const at = list.children.indexOf(songs.filter(c => /(^| )sel( |$)/.test(c.className))[0]);
  ok(at >= 0, "有且仅有一条 sel 曲式");
  ok(/(^| )arg-ol-secs( |$)/.test(String(list.children[at + 1].className)),
     "★★ 段树**紧跟在当前曲式之后**（兄弟节点，不是它的子节点——曲式条是 button，套 button 非法）");
  eq(songs.length, list.children.filter(c => /(^| )arg-item( |$)/.test(c.className)).length,
     "曲式条数不受段树/分隔线影响（按类名过滤）");

  /* 图标用 ::before（装饰性），不加真实子节点 —— 否则按位置取 children[2]=删除 的断言全体错位 */
  ok(/\.arg-item::before\{content:""/.test(html), "★ 曲式条图标走 ::before（不加 DOM 子节点）");
  ok(/--ico-arrange:url\("data:image\/svg\+xml/.test(html), "★ 图标是内联 SVG 变量（随 currentColor 变色）");

  /* 换一首 ⇒ 段树跟着搬过去（只展开当前） */
  const other = songs.filter(c => !/(^| )sel( |$)/.test(c.className))[0];
  other.fire("click");
  const trees2 = els["argList"].children.filter(c => /(^| )arg-ol-secs( |$)/.test(c.className));
  eq(trees2.length, 1, "★ 切换后仍只有 1 份段树（旧的收起）");
  const rows2 = rowsOf(els);
  eq(rows2.length, beat.Store.findArrange(beat.Store.arranges.filter(x => x.id !== beat.DEMO_ID)[0].id).sections.length,
     "★ 段树换成新那首的段（10 段）");
}

section("T210i 规格 · 主列不再有曲式库（v3.35.0）");
{
  const { html } = require("../lib/harness");
  ok(/id="argLibRow"[\s\S]*?id="argSide"|<div class="arg-lib-wrap" id="argLibRow">/.test(html),
     "曲式库住在左栏（#argLibRow 在 #argSide 内）");
  /* 主卡片标题：曲式库已搬走 ⇒ 只剩段落结构 */
  ok(/<h2 class="card-title"[^>]*>段落结构<\/h2>/.test(html), "★ 主卡片标题改为「段落结构」");
  ok(!/<h2 class="card-title"[^>]*>曲式库<\/h2>/.test(html), "★ 主卡片不再叫「曲式库」");
  /* #argList 仍被渲染代码清空重建（不许因为搬了位置就漏掉 clear ⇒ 节点堆积） */
  ok(/clear\(list\)/.test(html), "★ arrangeRender 仍 clear #argList（防重渲染堆积）");
}

section("T210j 切歌不许串范围（v3.35.1 用户实报「点第二首时自动选中三个段落」）");
{
  const { beat, els } = openArrange();
  const items = () => els["argList"].children.filter(c => /(^| )arg-item( |$)/.test(c.className));
  const hl = () => rowsOf(els).filter(r => /(^| )sel( |$)/.test(r.className)).length;
  const song2 = beat.Store.arranges.filter(x => x.id !== beat.DEMO_ID)[0];

  /* 复现路径：先在第一首里收窄成局部范围（= "我要练这一段"），再切到第二首。
     旧行为：小节号原样留着 ⇒ 落进第二首的前几段 ⇒ 那几段被高亮（用户看到 3 段）。 */
  const rows1 = rowsOf(els);
  rows1[1].fire("click");                     // 第一首的副歌（多小节）
  ok(beat.Store.S.arrangeSel.id === beat.DEMO_ID, "前提：范围指向第一首");
  ok(hl() >= 1, "前提：局部范围下第一首有高亮");

  items()[1].fire("click");                   // 切到第二首
  eq(beat.Store.S.arrangeSel.id, song2.id,
     "★★ 切歌后范围**重指到新曲式**（范围是曲式作用域的，带 id）");
  eq(beat.Store.S.arrangeSel.from, 0, "★ 起点重置为 0");
  eq(beat.Store.S.arrangeSel.to, beat.songBars(song2) - 1,
     "★ 终点重置为新曲式的末小节（取整首，与首次打开同语义）");
  eq(hl(), 0, "★★ 切歌后**零**高亮 —— 不再把旧曲式的小节范围套到新曲式上");

  /* 切回去：同样重指（不回退成第一首的旧局部范围） */
  items()[0].fire("click");
  eq(beat.Store.S.arrangeSel.id, beat.DEMO_ID, "切回第一首，范围跟着回来");
  eq(beat.Store.S.arrangeSel.from, 0, "★ 也是整首（不残留第二首的范围）");
  eq(hl(), 0, "同样零高亮");
}

section("T210k 高亮前置条件 · 范围属于本首 且 不是整首");
{
  const { beat, els } = openArrange();
  const hl = () => rowsOf(els).filter(r => /(^| )sel( |$)/.test(r.className)).length;
  /* 整首 ⇒ 0 高亮（"全都在范围内"没有信息量） */
  eq(hl(), 0, "整首范围：零高亮");
  /* 局部范围 ⇒ 恰好覆盖到的那几段高亮。走**编排面板自己的滑块**（用户跨多段的真实手势）：
     ★ 不能用 beat.Arrange.setRange() —— 它只写状态、重渲染由调用方负责，
       直接调它看到的还是旧 DOM（第一版就这么写，断言恒 0）。 */
  const a = beat.Store.findArrange(beat.DEMO_ID);
  const b0 = beat.secBars(a.sections[0]);
  const b1 = beat.secBars(a.sections[1]);
  const b2 = beat.secBars(a.sections[2]);
  const toBar = String(b0 + b1 + b2);            // 1-based 末小节：覆盖 0/1/2 三段
  els["argRangeTo"].value = toBar;
  els["argRangeTo"].fire("change");
  eq(beat.Store.S.arrangeSel.to, b0 + b1 + b2 - 1, "前提：范围终点已落到第 3 段末");
  eq(hl(), 3, "★ 跨 3 段的局部范围 ⇒ 恰好 3 段高亮（不再多也不再少）");
  /* 范围不属于本首 ⇒ 零高亮（防御别的曲式的残留） */
  beat.Store.S.arrangeSel.id = "some-other-song";
  const app2 = loadApp(undefined, { seedDemo: false });
  app2.beat.Arrange.open();
  app2.beat.Store.S.arrangeSel = { id: "some-other-song", from: 0, to: 5, loop: false, byLyric: false };
  app2.beat.Arrange.open();
  const hl2 = app2.els["argList"].children
    .find(c => /(^| )arg-ol-secs( |$)/.test(c.className)).children
    .filter(c => /(^| )arg-ol-row( |$)/.test(c.className))
    .filter(c => /(^| )sel( |$)/.test(c.className)).length;
  eq(hl2, 0, "★★ 范围属于**别的**曲式时零高亮（不许把别处的小节号套上来）");
}

section("T210l 样式 · 绿底与歌词之间留出间隔（用户实报「靠得太近」）");
{
  const { html } = require("../lib/harness");
  /* 原先 .arg-ol-lyr 写 margin-top:-3px（负边距**往回收**，方向刚好相反）⇒ 贴住绿底。
     现在必须是正向间隔。 */
  const m = /\.arg-ol-lyr\{[^}]*margin-top:5px/.exec(html);
  ok(!!m, "★★ 歌词行改为正向 margin-top:5px（原为 -3px 的负边距）");
  ok(!/\.arg-ol-lyr\{[^}]*margin-top:-/.test(html), "★ 不再有负边距（负边距是把歌词往上贴，方向相反）");
  ok(/\.arg-ol-row\{[^}]*padding:6px 8px/.test(html), "★ 段行下内边距收到 6px（绿底不向下多占）");
}
