/* BeatSight 自动化测试 · v3.39.1 BPM 行上下两行塔式 + 音量 % 退役（用户澄清口径）
   T230
   ---------------------------------------------------------------------------
   【由来】v3.39.0 把 BPM 滑杆与步进群放进同一行，滑杆被挤短。用户澄清改回塔式：
     ① BPM 条与音量条**严格等长**——上行复刻 .vol-row 槽位（52px 标签 | 滑杆到行尾），
        左侧标签显示「BPM」（与「节拍」同 12px、同定宽槽，不挤滑杆）；
     ② 步进群（-5/-1/数值/+1/+5）移到滑杆**正下方**，居中轴**参照滑杆**（不是整行：
        左槽 52px ⇒ 滑杆轴比整行轴偏右 31px）；
     ③ 「当前 X BPM」读数行（#trainerProg）与数值行**同轴**居中。
   【同批追加 · 音量 % 退役】行内 % 文案（#volMasterPct/#volStrumPct）随右侧 38px
     定宽槽整体退役——音量是耳朵调的参数，% 无信息量；读数只剩收起态胶囊
     （#volPillPctN，收起时滑杆不可见、胶囊是唯一读数）。三行统一两段式后，
     BPM 行原为镜像而设的空白右槽同步除名，滑杆右端同抵列右缘。
   【本用例钉什么（源码级）】行为面由冒烟闸门把守（volBpmDelta 两端对齐 / 步进群
     轴心偏差 ≤2px，量真 DOM）；这里钉结构与口径，防回潮。
   ================================================================================ */
"use strict";
const { ok, section, html } = require("../lib/harness");

/* 剥注释后的净表面：旧形状的存活判据只认结构，不认注释里的历史记录 */
const SURFACE = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

section("T230a 上行 .bpm-slider-row：与音量行同构的两段槽位（等长的结构前提）");
{
  const seg = html.slice(html.indexOf('class="slider-row"'), html.indexOf('class="bpm-row"'));
  ok(/<div class="bpm-slider-row">/.test(html), "★ 上行容器 .bpm-slider-row 存在（滑杆行独立成行）");
  ok(/<span>BPM<\/span>/.test(seg), "★★ 左槽显示「BPM」文案（用户口径：与「节拍」大小相近、不挤滑杆）");
  ok(seg.indexOf("<span>BPM</span>") < seg.indexOf('id="bpmSlider"'),
    "★★ 源码序即读序：标签 → 滑杆（两段式与 .vol-row 同构）");
  ok(!/class="pct"/.test(seg),
    "★★★ BPM 行无 pct 槽（v3.39.1 同批：音量 % 退役后，为镜像而设的空白右槽同步除名）");
  /* 左槽宽必须与 .vol-row 同源（52），这是「严格等长」的数字面——右端两侧都抵行尾，等号只剩左槽 */
  ok(/\.vol-row>span:first-child\{min-width:52px\}/.test(html) && /\.bpm-slider-row>span:first-child\{min-width:52px\}/.test(html),
    "★★★ 左槽定宽 52px 与 .vol-row 同值（改一处不改另一处 ⇒ 等长断裂，本条变红）");
  ok(/\.bpm-slider-row\{display:flex;align-items:center;gap:10px;min-height:40px;font-size:12px;color:var\(--t2\)\}/.test(html),
    "★ 行距 10px / 行盒 40px / 字号 12px 与 .vol-row 同款（v3.40.0 间距修正①：行盒同律 40px）");
  ok(/\.slider-row\{display:flex;flex-direction:column;align-items:stretch;gap:13px\}/.test(html),
    "★★ .slider-row 基础规则为列向塔式 + 塔内间距 13px（v3.40.0 间距修正②：6→13，BPM↔步进群可见 30px）；v3.39.0 同行形状退役");
}

section("T230b 下一步进群：居中轴 = 芯轴（v3.41.0 G9 按方案图；v3.39.1 曾参照滑杆）");
{
  /* ★★★ v3.41.0（方案对账 G9）：居中轴 从「滑杆轴」改为「芯轴 = 跑道轴」——
     方案图 .steps{justify-content:center} 直接住在 402 芯里，v3.39.1 的 margin-left:62px 已除名。 */
  ok(/\.viz-head \.group \.slider-row \.bpm-row\{flex:0 0 auto;flex-wrap:nowrap;justify-content:center\}/.test(html)
     && !/slider-row \.bpm-row\{[^}]*margin-left/.test(SURFACE),
    "★★★ 步进群以**芯轴**居中（margin-left:62px 已除名；96 不再偏右 31px，按方案图）");
  ok(!/\.viz-head \.group \.slider-row\{flex-wrap:nowrap\}/.test(SURFACE)
    && !/\.slider-row \.bpm-row\{flex:1 1 100%\}/.test(SURFACE),
    "★★ v3.39.0 同行/折行旧规则已除名（净表面无残留——同行形状的回潮会连带旧规则复活）");
  /* ★ v3.41.0（方案移动档）：窄屏步进群 = 群高 40 + 钮 30×30 + 数值框 54×36（实测原 30×40 / 64×40） */
  const narrow640 = /@media \(max-width:640px\)\{([\s\S]*?)\n\}/.exec(html);
  ok(!!narrow640
     && /\.slider-row \.bpm-row\{min-height:40px\}/.test(narrow640[1])
     && /\.step-btn\{min-width:0;padding:6px 2px;width:30px;height:30px\}/.test(narrow640[1])
     && /\.bpm-num\{min-width:72px;height:40px;font-size:28px\}/.test(narrow640[1]),   /* v3.42.0：14→20→28（字形高 ≈20px，与 30px 圆钮视觉相当） */
    "★★ 窄屏步进群按方案移动档：群高 40 / 钮 30×30 / 数值框 54×36（v3.41.0）");
}

section("T230c 读数行 #trainerProg 与数值行同轴居中（同一根芯轴）");
{
  ok(/\.viz-head \.group \.tr-prog\{width:auto;text-align:center\}/.test(html),
    "★★★ 读数行与步进群**同一根芯轴**居中（v3.41.0 G9：62px 左缩除名；width:auto 盖掉基础规则 100%）");
  const seg = html.slice(html.indexOf('id="trainerProg"') - 40, html.indexOf('id="trainerProg"') + 40);
  ok(/class="tr-prog"/.test(seg), "★ #trainerProg 仍是 .tr-prog（搬块不换 id，接线不动）");
  ok(html.indexOf('class="slider-row"') < html.indexOf('id="trainerProg"'),
    "★ 源码序：读数行在 BPM 块之后（纵排塔式的第三行）");
}

section("T230d 音量 % 退役：行内文案与接线除名，收起态胶囊是唯一读数");
{
  ok(!/id="volMasterPct"/.test(SURFACE) && !/id="volStrumPct"/.test(SURFACE),
    "★★★ 行内 % 文案 #volMasterPct/#volStrumPct 已从标记除名（v3.39.1 用户拍板：% 无信息量，滑杆绿色填充 + 圆钮足够）");
  ok(!/\$\("volMasterPct"\)/.test(SURFACE) && !/\$\("volStrumPct"\)/.test(SURFACE),
    "★★★ 接线除名：净表面不再向已删元素写 textContent（残留引用会在启动即抛 null 崩）");
  /* 控制芯批 3（PLAN-v9）：折叠态胶囊收窄为「BPM 96 ▾」——#volPillPctN 退役，
     BPM 读数 #bpmPillNumN 保留（setBpm 写点不动） */
  ok(!/id="volPillPctN"/.test(SURFACE)
     && /id="bpmPillNumN"/.test(SURFACE) && /\$\("bpmPillNumN"\)/.test(SURFACE),
    "★★ 收起态读数钮只带 BPM（#bpmPillNumN 实时跟随）；音量 % 读数 #volPillPctN 退役"
    + "（% 无信息量口径的延伸——收起时看 BPM，音量回展开档看滑杆填充）");
  /* 基础规则 .vol-row .pct 保留给设置弹窗的两条活值行（遮罩深浅 / 延迟补偿）——退役不越界 */
  ok(/\.vol-row \.pct\{font-family:var\(--mono\);min-width:38px;text-align:right\}/.test(html)
    && /id="wallDimPct"/.test(html) && /id="latMsPct"/.test(html),
    "★ .vol-row .pct 基础规则保留（设置弹窗 #wallDimPct/#latMsPct 仍是 .vol-row 活值行，不吃本次退役）");
}
