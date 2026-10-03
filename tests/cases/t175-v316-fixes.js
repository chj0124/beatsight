/* T175 v3.16.0 三项修正批
   ---------------------------------------------------------------------------
   ① boot 后布局就绪重采样（用户反馈"刚打开歌词错位、播放后恢复"）：歌词坐标只在
      结构层算一次（buildViz 采样几何），boot 时的采样早于最终布局稳定——补 fonts.ready
      与首帧后各一次幂等 Viz.relayout()（几何重算的统一入口，播放中调用亦安全）。
   ② 参数槽两行化 + 分组（用户需求"文字部分放在参数槽的下面；预备拍往中间靠拢"）：
      训练进度/拒开原因一行移出控件行 → 槽级末项（桌面档 absolute 居中悬在槽下，
      控件行缩短 312px 整体重居中）；组间 32px、组内 8/12；**预留 50px 不动**
      （用户纠正：预留是记账线不是裁剪线，两行内容落在卡片内边距的空白里——
      smoke 的面板收容断言已同步放宽到卡片底缘）。
   ③ [hidden] 配套修复（用户反馈"预备拍关闭时参数槽仍显示"）：v3.15.0 给拍数输入
      加的槽内样式（display:flex，三个类）特异性高于 .inp-with-unit[hidden] 全局隐藏
      （两个选择器）——hidden 被压掉。补同链 [hidden] 配套（L1062 注释记过同款坑，
      静音/变速面板都有配套，唯独 v3.15.0 新加的这条漏了）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const slotAt = html.indexOf('<div class="tg-slot" id="tgSlot">');
const SLOT = slotAt > 0 ? html.slice(slotAt, html.indexOf("<!-- v3.0.0：预设库从 360px")) : "";

section("T175a v3.19.0 参数面板流内（悬浮槽退役，面板挂各自开关下）");
{
  /* ★ v3.19.0：悬浮槽退役、面板流内挂各自开关下（DOM 交错）——
     本段按新结构重钉：七件套交错顺序 + countin-line 同行 + tr-prog 变速参数末行。 */
  const ORDER = ["countInToggle", "countInBeatsWrap", "muteToggle", "muteRandomToggle",
                 "muteCfgPanel", "trainerToggle", "trTargetWrap", "trainerPanel", "trainerProg"]
    .map(id => html.indexOf('id="' + id + '"'));
  ok(ORDER.every(i => i > 0) && ORDER.every((v, i) => i === 0 || v > ORDER[i - 1]),
    "★★ v3.22.0：九件套交错排列（预备拍提前到最上；每组开关+主参数同行、"
    + "剩余参数紧跟其下——训练进度紧跟变速参数、不再落到预备拍下面）");
  ok(!/tg-slot" id="tgSlot"/.test(html) && !/\.tg-slot/.test(CSS_CODE),
    "★★ #tgSlot 壳与槽链样式全部退役（v3.13 悬浮槽时代结束）");
  ok(/<div class="countin-line">/.test(html)
     && /\.viz-toggles \.countin-line,\.viz-toggles \.sw-line\{display:flex/.test(CSS_CODE),
    "★★ v3.22.0：三组统一开关行（countin-line / sw-line）= 开关 + 主参数同行右侧（不换行）");
  ok(/\.viz-toggles \.tg-row \.tr-prog\{width:100%;text-align:left\}/.test(CSS_CODE),
    "★ 训练进度/拒开原因 = 变速参数末行（流内，v3.16 的 absolute 悬浮口径退役）");
  /* 显隐跟随面板：syncParamSlots 末尾同步 trainerProg.hidden = trainerPanel.hidden */
  const fn = html.slice(html.indexOf("function syncParamSlots"), html.indexOf("function openParamSlot"));
  ok(/trainerProg/.test(fn) && /tpl\.hidden/.test(fn),
    "★ syncParamSlots 末尾同步文字行显隐（含空目标拒开路径——面板强制可见时原因文字随行）");
}

section("T175b [hidden] 配套修复（v3.15.0 搬块漏项，用户反馈'预备拍关闭参数槽仍显示'）");
{
  ok(/\.inp-with-unit\[hidden\]\{display:none\}/.test(CSS_CODE) && !/\.tg-slot/.test(CSS_CODE),
    "★ .inp-with-unit[hidden] 全局配套保留（通用显隐兜底；v3.22.0 起拍数输入常显，"
    + "不再依赖该链做开关联动）");
  /* ★ v3.22.0：拍数输入**常显**——预备拍关也显示上次设置的拍数（用户需求），
     处理器不再翻显隐；标记层亦无 hidden（变异抓手：恢复 hidden 翻转会破坏常显） */
  ok(!/countInBeatsWrap"\)\.hidden/.test(html)
     && !/<span class="inp-with-unit" id="countInBeatsWrap" hidden/.test(html),
    "★★ 拍数输入常显：标记层无 hidden、处理器无显隐翻转");
}

section("T175c boot 后布局就绪重采样（用户反馈'刚打开歌词错位、播放后恢复'）");
{
  /* 源码钉：fonts.ready 与首帧 rAF 两条重采样路径都在装配区（幂等 relayout）。
     桩里 rAF 不执行、document.fonts 不存在——真机生效，桩钉实现存在性。 */
  const bootSeg = html.slice(html.indexOf("syncParamSlots();   // v3.3.0"),
                             html.indexOf("syncParamSlots();   // v3.3.0") + 2200);
  ok(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{/.test(bootSeg)
     && /Viz\.relayout\(\);/.test(bootSeg) && /Viz\.paintFrame/.test(bootSeg)
     && /document\.fonts\.ready\.then\(\(\) => \{/.test(bootSeg),
    "★★★ v3.19.0：boot 重采样升级——双 rAF 后 relayout + **paintFrame**（滚动行 translate"
    + "由 paintFrame 重算，修'刚打开预备拍道/第三条跑道显示不正确'）+ fonts.ready 同款");
  ok(/typeof document !== "undefined" && document\.fonts/.test(bootSeg),
    "★ typeof 守卫（桩环境无 fonts——真机生效，桩不炸）");
}

section("T175d ≤640 移动端修正（用户截图两例）");
{
  /* 底栏两行化：pb-right 跨三列第二行——390 实测旧三列网格把右列压到 6px、
     进度条 min-width 96 溢出视口 66px 被裁（真机探针抓到，冒烟 barOverflow 钉死）。 */
  ok(/@media \(max-width:640px\)[\s\S]*?\.play-bar\{grid-template-rows:auto auto;row-gap:4px/.test(CSS_CODE),
    "★★ ≤640：底栏改两行（v3.18.0：行 1 = 播放键组跨三列居中；行 2 = 胶囊 + 右区）");
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-right\{grid-column:2 \/ -1;grid-row:2;flex-direction:row/.test(CSS_CODE)
     && /@media \(max-width:640px\)[\s\S]*?#argJump\{grid-column:1 \/ -1;grid-row:1;justify-self:center\}/.test(CSS_CODE)
     && /@media \(max-width:640px\)[\s\S]*?\.pb-right \.status\{width:96px;flex:none;overflow:hidden\}/.test(CSS_CODE)
     && /@media \(max-width:640px\)[\s\S]*?\.pb-ctx\{grid-row:2;grid-column:1/.test(CSS_CODE),
    "★★ v3.18.0：行 1 = 播放键组跨三列居中；行 2 = 型名胶囊（col 1 省略号，"
    + "不再溢出被 ⏮ 压住）+ 右区（col 2-3）；状态灯**定宽 96px** 省略号——"
    + "进度条长度不随文案变化（用户需求）；按钮缩小（play 48 / jump 40）");
  /* 显示位置三档两列网格（390 实测旧 flex-wrap 换行参差 2+1；组缺省按 max-content
     收缩到 202.8px——flex:1 1 100% 占满整行后两列各 ~151 放得下 nowrap 文案） */
  ok(/@media \(max-width:640px\)[\s\S]*?\.lyric-pos-group\{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1 1 100%\}/.test(CSS_CODE)
     && /@media \(max-width:640px\)[\s\S]*?\.lyric-pos-group \.pill\{justify-content:center;text-align:center/.test(CSS_CODE),
    "★★ ≤640：显示位置三档改两列等宽网格（flex:1 1 100% 占满整行——max-content 收缩坑实测堵上）");
}
