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

section("T175a 参数槽两行化：文字行移出控件行（用户需求）");
{
  ok(SLOT.indexOf('id="countInBeatsWrap"') >= 0
     && SLOT.indexOf('id="trainerProg"') >= 0
     && SLOT.indexOf('id="trainerProg"') > SLOT.indexOf('id="countInBeatsWrap"'),
    "★★ #trainerProg 是槽级末项（在 #countInBeatsWrap 之后）——文字行移出控件行");
  ok(SLOT.indexOf('id="trainerPanel"') >= 0
     && SLOT.slice(SLOT.indexOf('id="trainerPanel"'), SLOT.indexOf('id="countInBeatsWrap"')).indexOf('id="trainerProg"') === -1,
    "★★ 控件行内不再有进度文字（trainerPanel 与 trainerProg 之间隔着拍数输入 = 已移出）");
  ok(/\.viz-toggles \.tg-slot \.tr-prog\{position:absolute;top:100%;left:50%;transform:translateX\(-50%\)/.test(CSS_CODE),
    "★★ 桌面档文字行 absolute 居中悬在槽下（不参与槽宽/槽高计算——零位移不变）");
  ok(/\.viz-toggles \.tg-slot \.tr-panel\{[^}]*gap:8px 12px\}/.test(CSS_CODE),
    "★ 组内间距收紧到 8/12（原 10/14）");
  ok(/\.viz-toggles \.tg-slot\{[^}]*align-items:center;gap:8px 32px/.test(CSS_CODE),
    "★★ 组间距 32px（用户反馈等距排开'一段长蛇'不分组；组间拉开 = 三组边界一眼可辨）");
  /* 显隐跟随面板：syncParamSlots 末尾同步 trainerProg.hidden = trainerPanel.hidden */
  const fn = html.slice(html.indexOf("function syncParamSlots"), html.indexOf("function openParamSlot"));
  ok(/trainerProg/.test(fn) && /tpl\.hidden/.test(fn),
    "★ syncParamSlots 末尾同步文字行显隐（含空目标拒开路径——面板强制可见时原因文字随行）");
}

section("T175b [hidden] 配套修复（v3.15.0 搬块漏项，用户反馈'预备拍关闭参数槽仍显示'）");
{
  ok(/\.viz-toggles \.tg-slot \.inp-with-unit\{[^}]*display:flex/.test(CSS_CODE)
     && /\.viz-toggles \.tg-slot \.inp-with-unit\[hidden\]\{display:none\}/.test(CSS_CODE),
    "★★★ 槽内拍数输入的 display:flex 有同链 [hidden] 配套——hidden 恢复生效"
    + "（v3.15.0 漏配：三类的 display:flex 特异性压过两选择器的全局隐藏规则）");
  /* 行为：预备拍关 → 拍数输入 hidden；开 → 显形（既有接线，搬块后 id 不变） */
  const app = loadApp({ "beatsight.state": JSON.stringify({ countIn: { on: false, beats: 2 } }) });
  const { els } = app;
  eq(els["countInBeatsWrap"].hidden, true, "★ 前提：预备拍关 → 拍数输入 hidden（标记级）");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, false, "★ 打开预备拍 → 拍数输入显形");
  els["countInToggle"].fire("click");
  eq(els["countInBeatsWrap"].hidden, true, "★ 关闭 → 复归 hidden（CSS 配套让它真正从视觉上消失）");
}

section("T175c boot 后布局就绪重采样（用户反馈'刚打开歌词错位、播放后恢复'）");
{
  /* 源码钉：fonts.ready 与首帧 rAF 两条重采样路径都在装配区（幂等 relayout）。
     桩里 rAF 不执行、document.fonts 不存在——真机生效，桩钉实现存在性。 */
  const bootSeg = html.slice(html.indexOf("syncParamSlots();   // v3.3.0"),
                             html.indexOf("syncParamSlots();   // v3.3.0") + 1400);
  ok(/requestAnimationFrame\(\(\) => Viz\.relayout\(\)\)/.test(bootSeg)
     && /document\.fonts\.ready\.then\(\(\) => Viz\.relayout\(\)\)/.test(bootSeg),
    "★★ boot 后两条布局就绪重采样路径在位（首帧 rAF + fonts.ready → 幂等 Viz.relayout）");
  ok(/typeof document !== "undefined" && document\.fonts/.test(bootSeg),
    "★ typeof 守卫（桩环境无 fonts——真机生效，桩不炸）");
}

section("T175d ≤640 移动端修正（用户截图两例）");
{
  /* 底栏两行化：pb-right 跨三列第二行——390 实测旧三列网格把右列压到 6px、
     进度条 min-width 96 溢出视口 66px 被裁（真机探针抓到，冒烟 barOverflow 钉死）。 */
  ok(/@media \(max-width:640px\)[\s\S]*?\.play-bar\{grid-template-rows:auto auto;row-gap:4px\}/.test(CSS_CODE),
    "★★ ≤640：底栏改两行（行 1 = 胶囊｜播放键｜循环；行 2 = 右区跨三列）");
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-right\{grid-column:1 \/ -1;grid-row:2;flex-direction:row/.test(CSS_CODE),
    "★★ ≤640：pb-right 跨全宽行内排布（进度条 flex:1 + 状态灯右侧）");
  /* 显示位置三档两列网格（390 实测旧 flex-wrap 换行参差 2+1；组缺省按 max-content
     收缩到 202.8px——flex:1 1 100% 占满整行后两列各 ~151 放得下 nowrap 文案） */
  ok(/@media \(max-width:640px\)[\s\S]*?\.lyric-pos-group\{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1 1 100%\}/.test(CSS_CODE)
     && /@media \(max-width:640px\)[\s\S]*?\.lyric-pos-group \.pill\{justify-content:center;text-align:center/.test(CSS_CODE),
    "★★ ≤640：显示位置三档改两列等宽网格（flex:1 1 100% 占满整行——max-content 收缩坑实测堵上）");
}
