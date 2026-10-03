/* BeatSight 自动化测试 · B1 视觉语义分色 + 选中态统一 + 文字三级提亮（v3.4.0）
   ---------------------------------------------------------------------------
   背景（画布评审 P2/P7/P8 定稿）：此前 --green 一色六用——单选选中态、正在发声、
   和弦名、开关轨道、播放键、聚焦环全用 #1ED760，用户分不清「我选中了它」与
   「它正在响」。本批把绿色收窄为**只表进行中**，选中态改中性高亮，和弦名改琥珀，
   并把 --t3 提亮解决小字贴 AA 下限的问题。

   契约（改动前先钉死，改码后必须全绿）：
     ① 单选选中态 = --sel-bg 底 + --sel-line 描边 + 白字，**不得再出现 --green**；
        描边必须是 inset box-shadow（.pill 基座无边框，走 border 会让全部 pill
        高 +2px、外几何位移，波及布局断言）。
     ② 经典与日间（obs）两主题的选中态必须同语义——只改一套主题等于没说。
     ③ 当前行 = 底纹 **.10**（v3.31.4 用户裁决：行首绿短标整条取消，底纹由 .07 提到 .10 补回面积对比；
        播放中真正的锚是 .cell.active 的绿描边——短标只是"整行级、固定位置"的补充）。
     ④ 和弦名 = --amber（乐谱语义），与播放头的绿区分开。
     ⑤ **收窄不等于滥砍**：播放头 / 播放键 / 歌词高亮等「进行中」元素必须仍是绿的，
        否则本批就把语义做反了（这一条是反向验证的重点）。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

/* 经典基座 :root 段（日间主题在 body[data-theme="obs"] 作用域里另有一套，不在此段） */
const ROOT = html.slice(html.indexOf(":root{"), html.indexOf("}", html.indexOf(":root{")) + 1);

/* ================= T149a：文字三级提亮（P8） ================= */
section("T149a --t3 提亮到 #9E9E9E，经典基座不再残留旧值");
{
  ok(/--t3:#9E9E9E/.test(ROOT), "★ 经典基座 --t3 = #9E9E9E（在 #121212 上约 6.9:1）");
  ok(!/--t3:#8C8C8C/.test(ROOT), "★ 旧值 #8C8C8C 已从经典基座移除（不是新增覆盖，是真替换）");
  ok(/--t1:#FFFFFF/.test(ROOT) && /--t2:#B3B3B3/.test(ROOT), "★ --t1/--t2 不动（只提最弱一级）");
}

/* ================= T149b：选中态专用色入册 ================= */
section("T149b 新增 --sel-bg / --sel-line 两枚语义色");
{
  ok(/--sel-bg:#2E2E2E/.test(ROOT) && /--sel-line:#6A6A6A/.test(ROOT),
    "★ 选中态底/描边两色已立变量（不再散落硬编码）");
}

/* ================= T149c：单选 pill 选中态改中性（P2/P7） ================= */
section("T149c .pill.active 不再用功能绿，且描边走 inset 不改外几何");
{
  const rule = (html.match(/^\.pill\.active\{[^}]*\}/m) || [""])[0];
  ok(rule.length > 0, "★ 经典 .pill.active 规则存在");
  ok(/background:var\(--sel-bg\)/.test(rule), "★ 选中底色走 --sel-bg");
  ok(!/var\(--green\)/.test(rule), "★★ 选中态里**不再有绿色**（语义分色的核心断言）");
  ok(/color:var\(--t1\)/.test(rule), "★ 选中文字为 --t1（白），不再是绿底黑字");
  ok(/box-shadow:inset 0 0 0 1px var\(--sel-line\)/.test(rule),
    "★ 描边用 inset box-shadow（.pill 无边框；走 border 会让 pill 高 +2px 破布局）");
  ok(!/border:/.test(rule), "★★ 不得引入 border——外几何必须零位移");
}

/* ================= T149d：两主题同语义 ================= */
section("T149d 日间主题（obs）的 pill.active 同步改中性");
{
  const rule = (html.match(/body\[data-theme="obs"\] \.pill\.active\{[^}]*\}/) || [""])[0];
  ok(rule.length > 0, "★ obs 主题 .pill.active 覆盖存在");
  ok(/background:var\(--sel-bg\)/.test(rule) && /var\(--sel-line\)/.test(rule),
    "★ obs 选中态同为中性高亮");
  ok(!/var\(--green\)/.test(rule), "★★ obs 主题选中态也不留绿（否则两主题语义分叉）");
}

/* ========== T149e：当前行高亮（v3.8.0 裁决；v3.31.4 取消短标、底纹提 .10） ========== */
section("T149e .bar-row.current 只留 .10 淡底，行首短标已整条取消");
{
  const rule = (html.match(/^\.bar-row\.current\{[^}]*\}/m) || [""])[0];
  ok(/rgba\(30,215,96,\.10\)/.test(rule),
    "★ 底纹 .10（v3.31.4 用户裁决）：短标那条 5.67:1 的线索取消后，靠底纹补回面积对比");
  ok(!/rgba\(30,215,96,\.07\)/.test(rule), "★ 旧值 .07 已退役（真回退，不是被覆盖）");
  ok(!/rgba\(30,215,96,\.12\)/.test(rule),
    "★★ 也不取 .12——v3.8.0 用户实拍已否决（.12 亮带压住未弹格子的扫弦箭头/六线底纹，读谱优先）");
  ok(!/\.bar-row\.current::before/.test(html),
    "★★ 行首短标不得复活（v3.31.4 用户裁决；通道与理由见 t166 T151c）");
  ok(!/box-shadow/.test(rule),
    "★★ 不用 inset box-shadow——它画的是「盒差集」，inset 3px 24px 0 0 实为 L 形通宽带"
    + "（B3 的几何 bug，v3.8.0 修复）");
}

/* ================= T149f：和弦名改琥珀（P2） ================= */
section("T149f .bar-chord 改 --amber，与播放头的绿区分");
{
  const rule = (html.match(/^\.bar-chord\{[^}]*\}/m) || [""])[0];
  ok(/color:var\(--amber\)/.test(rule), "★ 和弦名走琥珀（乐谱语义）");
  ok(!/color:var\(--green\)/.test(rule), "★★ 和弦名不再与播放头/当前行抢同一绿色语义");
  ok(/--amber:#E3B341/.test(ROOT), "★ 琥珀是既有 token（复用，未另立新色）");
}

/* ================= T149g：收窄不等于滥砍（反向验证重点） ================= */
section("T149g 进行中语义仍必须保留绿色——语义只收窄，不反转");
{
  const greenRules = (html.match(/^[^\n{]*\{[^\n}]*var\(--green\)[^\n}]*\}/gm) || []);
  const need = [
    [".playhead", "播放头"],
    [".play-btn", "播放键"],
    [".lyric-chip.on", "歌词高亮格"],
    [".bounce-ball", "弹跳球"],
    [".strumv.hit", "已弹扫弦"],
    [".lyric-head", "歌词跟随条"],
  ];
  need.forEach(([sel, label]) => {
    ok(greenRules.some(r => r.indexOf(sel) === 0),
      "★ 「" + label + "」(" + sel + ") 仍是绿色——它是'正在发声'，本批不许改");
  });
  ok(greenRules.length >= 6, "★ 进行中元素仍成规模地用绿（收窄的是选中态，不是发声态）");
}
