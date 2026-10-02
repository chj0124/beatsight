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
     && PLAYBAR.indexOf('id="statusDot"') < PLAYBAR.indexOf('id="pbProgress"'),
    "★★ 状态灯在 .pb-right 内、位于进度条之前（右区两读数从左到右：状态 → 进度）");
  /* 结构红线：#pbProgress 挂载前会被 buildDemoSongRow 清空——状态灯若是它的子节点，
     曲式列表一重建就被连坐销毁（症状：状态灯偶尔消失，极难复现）。 */
  const pbOpen = PLAYBAR.indexOf('id="pbProgress"');
  const pbClose = PLAYBAR.indexOf("</div>", pbOpen);
  ok(PLAYBAR.indexOf('id="statusDot"') < pbOpen || PLAYBAR.indexOf('id="statusDot"') > pbClose + 6,
    "★★★ 状态灯不是 #pbProgress 的子节点——buildDemoSongRow 挂载前清空该容器，"
    + "静态子节点会被连坐销毁（曲式列表一重建状态灯就消失）");
  ok(/\.pb-right\{justify-self:end;display:flex;align-items:center;gap:12px;width:100%;max-width:640px;min-width:0\}/.test(CSS_CODE),
    "★★ .pb-right 承接原 .pb-progress 的落位与宽度契约（网格第 3 列右对齐 / max-width 640）");
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

section("T170c 窄屏右区两行（状态灯在上、进度条在下）");
{
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-right\{flex-direction:column;align-items:flex-end;gap:2px\}/.test(CSS_CODE),
    "★ ≤640：右区改上下两行都右对齐——一行硬塞状态灯+轨道会把轨道压穿 min-width");
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-progress\{width:100%;max-width:none;min-width:96px\}/.test(CSS_CODE),
    "★ ≤640：进度条保底 96px（旧 64px 口径 + 状态灯占位的补偿）");
}
