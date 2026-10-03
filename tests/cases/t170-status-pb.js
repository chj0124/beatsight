/* BeatSight 自动化测试 · v3.10.0 二修批（状态灯搬底栏 + 播放头游标粗竖线）
   T170 系列。
   ---------------------------------------------------------------------------
   ① 状态灯（● + 播放文案）从顶栏搬到底栏右区，与「第 N–M 小节」范围读数同区（用户要求）。
      v2.76.3 把状态行搬进顶栏是「型名 · 状态 · 补偿」三读数带时代的设计；型名随 P3 搬进
      底栏胶囊后，顶栏这份状态行成了孤儿。搬家不换 id（#statusDot/#statusText 的十几个
      写点零改动，仓库惯例）。
      ★ 结构红线：状态灯必须是 #pbProgress 的**兄弟**（同在 .pb-right 内）而不是子节点——
        buildDemoSongRow 挂载前会清空 #pbProgress（曲式列表重建即再挂一次），
        静态子节点会被连坐销毁（该函数自身的注释就写着这条）。
   ② 播放头游标「细竖线 + 顶部小三角」→「粗竖线（4px 圆角）」（用户要求）——三角在 22px
      高的轨道里读起来像"快进"图标，表意不清（用户实拍看不懂那个符号是什么）。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const PLAYBAR_AT = html.indexOf('<div class="play-bar" id="playBar"');
const PLAYBAR = html.slice(PLAYBAR_AT, html.indexOf("<!-- ================= 自定义节奏型编辑器"));

section("T170a 状态灯落户底栏右区（.pb-right）");
{
  ok(!/id="statusDot"/.test(html.slice(html.indexOf('<header class="topbar"'),
     html.indexOf("</header>"))) ,
    "★★ 顶栏不再有状态灯（v2.76.3 的顶栏 .status 容器整体退役）");
  ok(/<div class="pb-right">/.test(PLAYBAR)
     && PLAYBAR.indexOf('id="pbProgress"') < PLAYBAR.indexOf('id="statusDot"'),
    "★★ v3.13.0 两行化：进度条（行 1）在上、状态灯（行 2 .pb-sub）在下——"
    + "进度条宽度与预备拍/状态文案彻底解耦（真机实测旧单行下 −64px / −134px 的两处横跳根因）");
  /* 结构红线：#pbProgress 挂载前会被 buildDemoSongRow 清空——状态灯若是它的子节点，
     曲式列表一重建就被连坐销毁（症状：状态灯偶尔消失，极难复现）。 */
  const pbOpen = PLAYBAR.indexOf('id="pbProgress"');
  const pbClose = PLAYBAR.indexOf("</div>", pbOpen);
  ok(PLAYBAR.indexOf('id="statusDot"') < pbOpen || PLAYBAR.indexOf('id="statusDot"') > pbClose + 6,
    "★★★ 状态灯不是 #pbProgress 的子节点——buildDemoSongRow 挂载前清空该容器，"
    + "静态子节点会被连坐销毁（曲式列表一重建状态灯就消失）");
  ok(/\.pb-right\{justify-self:end;display:flex;flex-direction:column;gap:5px;width:100%;max-width:640px;min-width:0\}/.test(CSS_CODE),
    "★★ .pb-right 承接落位与宽度契约（网格第 3 列右对齐 / max-width 640），v3.13.0 起**两行纵排**"
    + "（行 1 进度条独占、行 2 = .pb-sub 状态灯；v3.15.0 预备拍搬回卡片后高度更矮）；");
  ok(/\.pb-sub\{display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0\}/.test(CSS_CODE)
     && !/\.pb-countin/.test(CSS_CODE),
    "★★ v3.30.0：.pb-sub 两端对齐——左端接范围读数、右端状态灯（读数从行 1 挪来，"
    + "不再与进度条抢宽；预备拍早已搬回控制卡片开关行，.pb-countin 规则族退役）");
  ok(/\.pb-right \.status\{flex:none;white-space:nowrap\}/.test(CSS_CODE),
    "★ 状态灯不被挤压、文案不折行");
}

section("T170b 播放头游标改粗竖线");
{
  ok(/\.demo-range-head\{position:absolute;top:1px;bottom:1px;width:4px;border-radius:2px;background:var\(--t1\);pointer-events:none;z-index:4\}/.test(CSS_CODE),
    "★★ 游标 = 4px 圆角粗竖线（细竖线+小三角的「快进」误读根除；与两个圆形 thumb 仍有形状区分）");
  ok(!/\.demo-range-head::before/.test(CSS_CODE),
    "★★ 三角的 ::before 规则整块退役（不留死样式）");
  ok(/pointer-events:none/.test((CSS_CODE.match(/\.demo-range-head\{[^}]*\}/) || [""])[0]),
    "★ 游标仍不可交互（不吃任何拖动，与两个可拖 thumb 的性质分界不变）");
}

section("T170c 窄屏右区（v3.13.0：与桌面同一套两行 DOM，.pb-sub 换行右对齐）");
{
  /* ★ v3.13.0：桌面档先两行化（进度条独占行 1、.pb-sub = 预备拍+状态），窄屏沿用同一
     DOM 结构只换排布——390px 下预备拍与状态文案放不进一行，.pb-sub 换行、各自贴右。
     实测右列 ≈ 22+2+33+2+16 ≈ 75px，仍低于底栏内容区 82px。
     ★ 旧「预备拍 flex-basis:100% 独占一行」的特化随结构统一退役；旧「不得纵排」红线
     （三件纵排顶穿 110px、真机 9px 贴底）的继任闸门 = smoke 的 pbRightH ≤ barContentH
     （v3.12.0 立，本轮继续生效）。 */
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-sub\{flex-wrap:wrap;justify-content:space-between;row-gap:2px\}/.test(CSS_CODE),
    "★★ ≤640：.pb-sub 换行 + 两端对齐（v3.30.0 读数行挪入本行后口径统一；"
    + "窄屏读数 display:none，本条只兜底）");
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-progress\{min-width:96px\}/.test(CSS_CODE),
    "★ ≤640：进度条保底 96px（行 1 宽度 = 容器宽，min-width 是防挤压的兜底）");
  /* v3.15.0：预备拍搬回卡片开关行——原预备拍两条底栏钉（nowrap / flex:none）随组退役 */
  ok(!/\.pb-countin/.test(CSS_CODE) && !/id="countInBeatsWrap"/.test(PLAYBAR),
    "★ 底栏右区无预备拍残留（搬回是全档行为，不分断点）");
}