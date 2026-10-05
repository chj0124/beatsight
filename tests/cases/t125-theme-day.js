/* BeatSight 自动化测试 · 日间主题（v2.54.0）
   T125 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   契约锚点（与 index.html 主题区的注释同源）：
     · T1 内部标识 data-theme="obs" 与冷键 beatsight.theme **原样保留**，只换配色值——
       老存档无缝继承新外观，切换流程 / 布局尺度一行不动。
     · T2 界面名称改「日间」（内部标识不变，名字要说真话）。
     · §2.1 浅色板：--bg #F2F4F8 / --card #FFFFFF / 主强调 #2563EB，文字三级按白底核 AA。
     · §2.2 语义变量收口：新增 --veil / --well（存 **RGB 三元组**），经典基座里散落的
       叠加色改写成 rgba(var(--veil),a) / rgba(var(--well),a)——展开后与改写前**逐位相同**，
       这是本次对经典基座唯一的触碰，属"换写法不换值"。
     · P-a .arg-lyric-ghost 的背景由硬编码经典绿改 color-mix（两主题同对）。
     · P-b color-scheme：obs 块加 light（CSS 侧），meta 那份由 applyTheme 同步（JS 侧）。
     · P-c --blue 补 obs 覆盖（浅底上原值 ≈2.5:1 不达标）。
     · P-d --peak / --peak-rest 补 obs 覆盖（浅底上白填充 = 隐形）。
   断言口径：CSS 走**文本级**（与 t119 / t47 同口径——桩不解析样式表）；
   切换行为走 loadApp + 点击（与 t30 的 T38 同口径）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* ---- CSS 文本切片（桩没有样式表，只能按文本查契约） ---- */
const blockFrom = (startPat, endPat) => {
  const i = html.indexOf(startPat);
  return i < 0 ? "" : html.slice(i, html.indexOf(endPat, i));
};
const ROOT = blockFrom(":root{", "\n}");
const OBSVARS = blockFrom('body[data-theme="obs"]{', "\n}");
const OBS = blockFrom('body[data-theme="obs"]{\n', "\n/* ---------- 诊断面板");   // 整个观测台覆盖块（含组件级）
const FLASH = blockFrom("const FLASH_THEME = {", "\n};");
/* 取一条以 selector 起头的规则文本（到本行的 } 为止） */
const ruleOf = (where, sel) => {
  const i = where.indexOf(sel);
  return i < 0 ? "" : where.slice(i, where.indexOf("}", i) + 1);
};
/* ★ 两个 meta 一定要**显式 getElementById** 取，不要走 app.els["…"]：
   桩的 els 是"被访问过的元素缓存"——万一有人把 applyTheme 里的同步摘了，els 里压根
   没有这两个键，`els["themeColorMeta"].content` 会抛 TypeError 而**不是**给出一条
   具名的断言失败。走 getElementById 则恒返回一个桩元素，缺同步时读到 undefined，
   断言规规矩矩变红（反向验证 M4 就是这么要求的：崩溃不算证据）。 */
const metaOf = (app, id) => app.sandbox.document.getElementById(id);

/* ================= T125a：浅色板落位（obs 变量块） ================= */
section("T125a 日间主题 · 浅色板落位（§2.1 换色表）");
{
  ok(/--bg:#F2F4F8;/.test(OBSVARS), "★ 底色 --bg 改浅灰 #F2F4F8");
  ok(/--card:#FFFFFF;/.test(OBSVARS) && /--card2:#EDF0F5;/.test(OBSVARS) && /--cell:#E3E8F0;/.test(OBSVARS),
     "★ 面板三级 --card/#FFFFFF、--card2/#EDF0F5、--cell/#E3E8F0 拉开级差");
  ok(/--green:#2563EB;/.test(OBSVARS), "★ 主强调保留蓝色基因并深档化 #2563EB（白底 4.9:1，AA 达标）");
  ok(/--accent-hi:#1D4ED8;/.test(OBSVARS) && /--teal:#0D9488;/.test(OBSVARS) && /--red:#DC2626;/.test(OBSVARS),
     "★ 高光 / 青绿 / 红同步换浅底达标值");
  ok(/--t1:#0F172A;/.test(OBSVARS) && /--t2:#475569;/.test(OBSVARS) && /--t3:#556577;/.test(OBSVARS),
     "★ 文字三级按白底重核（16.1 / 7.5 / 5.98:1，守住 AA 线）");
  /* ★★ v3.33.8：只钉字面值不够——旧钉法认的是 #64748B（白底 4.8:1 达标），却漏掉
     "落到浅色分层底（--card2 / --cell）上只剩 4.17 / 3.87:1"这一层：日间大量 11–14px 小字
     （座次尺刻度、抽屉动作说明、分组按钮、底栏「当前」）正是坐在那些分层底上。
     故这里改成**算式断言**：三级文字在两处分层底上都必须 ≥ 4.5:1。 */
  {
    const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    const lum = h => hex(h).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); })
      .reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0);
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const pick = nm => (new RegExp("--" + nm + ":(#[0-9A-Fa-f]{6})").exec(OBSVARS) || [])[1];
    const surf = { card2: pick("card2"), cell: pick("cell") };
    ["t1", "t2", "t3"].forEach(nm => {
      const v = pick(nm);
      const worst = Math.min(ratio(v, surf.card2), ratio(v, surf.cell));
      ok(!!v && worst >= 4.5,
        "★★ 日间 --" + nm + " 在 --card2/--cell 上均 ≥ 4.5:1（实测最差 " + (v ? worst.toFixed(2) : "取不到") + ":1）");
    });
  }
  ok(/--line:rgba\(15,23,42,\.09\);/.test(OBSVARS) && /--border:rgba\(15,23,42,\.18\);/.test(OBSVARS)
     && /--rest-line:rgba\(15,23,42,\.25\);/.test(OBSVARS),
     "★ 描边由「半透明白」翻成「墨蓝」");
  ok(/rgba\(37,99,235,\.05\)/.test(OBSVARS), "★ 背景径向晕同构浅色化（37,99,235 系）");
}

/* ================= T125b：语义变量收口 + 经典逐位不变（§2.2 / 风险表第 1 条） ================= */
section("T125b 语义变量 · --veil / --well 收口，经典视觉逐位不变");
{
  ok(/--veil:255,255,255;/.test(ROOT), "★ :root 的 --veil 是经典现值（白）——亮纱");
  ok(/--well:0,0,0;/.test(ROOT), "★ :root 的 --well 是经典现值（黑）——暗槽");
  ok(/--veil:15,23,42;/.test(OBSVARS) && /--well:15,23,42;/.test(OBSVARS),
     "★ obs 块把两个三元组一并翻成墨蓝（一处改写，十余处叠加色跟随）");
  /* 等值改写抽查：值必须是 rgba(var(--veil),原alpha) / rgba(var(--well),原alpha)。
     v2.79.0：.beat-zone 的 .10 自画 ring 退役（拍分组改由 .seams 2px 强缝表达），
     只剩 .06 跑道垫色 */
  const bz = ruleOf(html, ".beat-zone{");
  ok(/background:rgba\(var\(--veil\),\.06\)/.test(bz) && !/box-shadow/.test(bz),
     "★ .beat-zone 的白纱等值改写（.06 垫色保留；v2.79.0 ring 退役，无 box-shadow）");
  const cell = ruleOf(html, ".cell{position:absolute;top:0;height:44px");
  ok(/background:rgba\(var\(--veil\),\.14\)/.test(cell), "★ .cell 的底色等值改写（.14）");
  ok(/--well\),\.28\)/.test(ruleOf(html, ".arg-block{")), "★ .arg-block 暗槽等值改写（.28）");
  ok(/--well\),\.28\)/.test(ruleOf(html, ".arg-map-seg{")), "★ .arg-map-seg 暗槽等值改写（.28）");
  ok(/--well\),\.28\)/.test(ruleOf(html, ".arg-lyric-paste{")), "★ .arg-lyric-paste 暗槽等值改写（.28）");
  /* ★★ v3.33.26：`.cell.played/.active .sub` 的**两处**（经典档亮纱 .20、观测台白 .35）已随
     `.sub` 退役一并删除——v3.33.25 起 .sub 只作闪烁目标、不再画线，两条规则都打在不再画线的
     元素上，是死规则。参考线（.usub）改为**恒定最淡、不参与播放态**（用户拍板：弹奏时不抢视线）。 */
  ok(!/\.cell\.played \.sub|\.cell\.active \.sub/.test(html)
     && !/\.cell\.played \.sub|\.cell\.active \.sub/.test(OBS),
     "★★ 两处「提亮细分线」规则均已删除（经典档 .20 / 观测台 .35）——死规则不留");
  /* 主题无关的硬编码必须**留在原地**（遮罩与阴影本来就该是暗的） */
  ok(/rgba\(0,0,0,\.55\)/.test(ruleOf(html, ".dialog{")), "★ 全屏遮罩仍是暗的（.dialog 未被误改成变量）");
  ok(/rgba\(0,0,0,\.6\)/.test(ruleOf(html, ".modal-mask{")), "★ 弹窗遮罩仍是暗的（未被误改成变量）");
}

/* ================= T125c：obs 组件级覆盖刷新（§2.3 + P-a/P-b/P-c/P-d） ================= */
section("T125c 组件覆盖 · 光晕降档 / 白rgba翻墨 / 新增四条覆盖");
{
  ok(/--blue:#1D4ED8;/.test(OBSVARS), "★ P-c：--blue 补覆盖（浅底 ≈6.2:1；字块选中框与游标都吃它）");
  ok(/--peak:#0F172A;/.test(OBSVARS) && /--peak-rest:#94A3B8;/.test(OBSVARS),
     "★ P-d：--peak / --peak-rest 翻墨色（浅底上白填充等于隐形；填充仍保持中性）");
  ok(/color-scheme:light;/.test(OBSVARS), "★ P-b：obs 块声明 color-scheme:light（原生控件不再按深色渲染）");
  ok(/color-mix\(in srgb, var\(--green\) 18%, transparent\)/.test(ruleOf(html, ".arg-lyric-ghost{")),
     "★ P-a：ghost 背景改 color-mix（修 v2.50 遗留的「蓝框绿底」，两主题同对）");
  /* 光晕降档：浅底上同 alpha 会过曝 */
  ok(/rgba\(37,99,235,\.9\), 0 0 10px rgba\(37,99,235,\.22\)/.test(OBS),
     "★ .cell.active 外光晕由 .28 降到 .22（浅底光晕更显眼）");
  ok(/rgba\(37,99,235,\.32\);animation:nextGlowObs/.test(OBS), "★ .cell.next 预告描边降档到 .32");
  ok(/rgba\(37,99,235,\.40\)\)/.test(OBS), "★ 尾迹渐变末档由 .55 降到 .40");
  /* 白 rgba 必须从覆盖块里退场（否则会盖住变量化后的墨色） */
  ok(/rgba\(var\(--veil\),\.05\)/.test(ruleOf(OBS, 'body[data-theme="obs"] .beat-zone{')),
     "★ obs 的 .beat-zone 走变量（不再是硬编码白）");
  ok(/rgba\(var\(--veil\),\.07\)/.test(ruleOf(OBS, 'body[data-theme="obs"] .grid-line{')),
     "★ obs 的 .grid-line 走变量");
  ok(/rgba\(var\(--well\),\.18\)/.test(ruleOf(OBS, 'body[data-theme="obs"] input\[type=range\]{')),
     "★ obs 的滑杆轨道走变量（墨色轨道才托得住白圆点）");
  ok(/rgba\(var\(--well\),\.22\)/.test(ruleOf(OBS, 'body[data-theme="obs"] .switch{')),
     "★ obs 的开关底走变量");
  /* 三条新增覆盖：返回箭头 / 歌词字块 / 帮助页示意图 */
  ok(/\.back-btn svg path\{stroke:var\(--t2\)\}/.test(OBS),
     "★ 四枚返回箭头的 #B3B3B3 由 CSS 覆盖成 --t2（标记一行未动）");
  ok(/\.arg-lyric-chip\{color:var\(--on-green\)\}/.test(OBS),
     "★ 歌词字块字色在 obs 下翻成 --on-green（深蓝底上的 #0B0B0B 糊成一片）");
  ok(/\.help-fig rect\{stroke:var\(--border\)\}/.test(OBS) && /\.help-fig text\{fill:var\(--t2\)\}/.test(OBS),
     "★ T7：帮助页三张示意图由 CSS 覆盖 fill/stroke（SVG 表现属性，不动标记）");
}

/* ================= T125d：JS 三处（§2.4） ================= */
section("T125d JS 契约 · 闪烁查表 / 遮罩 tint / meta 同步");
{
  ok(/edge:"#2563EB"/.test(FLASH), "★ FLASH_THEME.obs 的 edge 换 #2563EB（与 --green 同源）");
  ok(/zoneOff:"inset 0 0 0 1px rgba\(15,23,42,\.10\)/.test(FLASH),
     "★ FLASH_THEME.obs 的 zoneOff 由白描边翻成墨描边");
  ok(/edge:"#1ED760"/.test(FLASH), "经典那套闪烁配色一个字没动");
  ok(/const WALL_TINT = \{ classic:"18,18,18", obs:"244,246,250" \};/.test(html),
     "★ T5：壁纸遮罩色改查表 WALL_TINT（日间压浅色 #F2F4F8 系）");
  ok(/const tint = WALL_TINT\[themeNow\] \|\| WALL_TINT\.classic;/.test(html),
     "★ wallApply 走查表而不再是写死的三元表达式");
  ok(/const syncThemeMeta = t =>/.test(html) && /syncThemeMeta\(t\);/.test(html),
     "★ applyTheme 里挂上 meta 同步（顺手修掉 obs 下 theme-color 一直是 #121212 的老 bug）");
}

/* ================= T125e：切换行为 · 老存档无缝继承 + meta 随主题 ================= */
section("T125e 行为 · 切换 / 文案 / 两个 meta 随主题（含老存档继承）");
{
  const app = loadApp();
  const body = app.sandbox.document.body;
  eq(body.getAttribute("data-theme"), "classic", "默认仍是经典（无偏好落 classic）");
  /* v2.69.0（1.1）：按钮上顶栏改图标态，文案断言换 aria-label */
  eq(app.els["themeToggle"].classList.contains("day"), false, "初始图标态：月亮可见（经典，按钮无 .day 类）");
  eq(app.els["themeToggle"].getAttribute("aria-label"), "切换到日间主题", "初始读屏文案：切换到日间主题");
  eq(metaOf(app, "themeColorMeta").content, "#121212", "★ 经典下 meta theme-color = #121212（首屏即同步）");
  eq(metaOf(app, "colorSchemeMeta").content, "dark", "★ 经典下 meta color-scheme = dark（v2.42.8 防 Force Dark 的原值）");

  app.els["themeToggle"].fire("click", {});
  eq(body.getAttribute("data-theme"), "obs", "点击后切到日间（内部标识仍是 obs）");
  eq(app.els["themeToggle"].classList.contains("day"), true, "★ 切日间后太阳可见（.day 类）");
  eq(app.els["themeToggle"].getAttribute("aria-label"), "切换到经典主题", "★ 读屏文案跟随（切换到经典主题）");
  eq(app.els["themeToggle"]["aria-pressed"], "true", "读屏开关态同步（v2.0.2 的那条没被带坏）");
  eq(app.beat.flashTheme().edge, "#2563EB", "★ 闪烁配色随主题查表");
  eq(metaOf(app, "themeColorMeta").content, "#F2F4F8", "★ 日间下 meta theme-color 同步成 #F2F4F8");
  eq(metaOf(app, "colorSchemeMeta").content, "light", "★ P-b：日间下 meta color-scheme 翻成 light");
  eq(app.storage.get("beatsight.theme"), "obs", "冷键键名与取值原样（T1：老存档无缝继承）");

  app.els["themeToggle"].fire("click", {});
  eq(metaOf(app, "themeColorMeta").content, "#121212", "切回经典 → theme-color 回 #121212");
  eq(metaOf(app, "colorSchemeMeta").content, "dark", "切回经典 → color-scheme 回 dark");
  eq(app.els["themeToggle"].classList.contains("day"), false, "切回经典 → 月亮可见（.day 类移除）");

  /* 老用户：存档里存的是 obs（深蓝暗色时代的偏好），升级后应无缝拿到新外观而不是报错/回退 */
  const old = loadApp({ "beatsight.theme": "obs" });
  eq(old.sandbox.document.body.getAttribute("data-theme"), "obs", "★ 老存档 obs 直接继承日间外观");
  eq(old.els["themeToggle"].classList.contains("day"), true, "★ 老存档重载后图标态正确（.day 类，太阳可见）");
  eq(metaOf(old, "colorSchemeMeta").content, "light", "★ 老存档重载后 meta 也是 light（不走点击也同步）");
}
