/* BeatSight 自动化测试 · v3.39.1 BPM 行上下两行塔式（用户澄清的三点口径）
   T230
   ---------------------------------------------------------------------------
   【由来】v3.39.0 把 BPM 滑杆与步进群放进同一行，滑杆被挤短。用户澄清改回塔式：
     ① BPM 条与音量条**严格等长**——上行复刻 .vol-row 三段槽位（52px 标签 | 弹性滑杆 |
        38px pct），左侧标签显示「BPM」（与「节拍」同 12px、同定宽槽，不挤滑杆），
        右侧 pct 槽**保留槽位、文案空置**；
     ② 步进群（-5/-1/数值/+1/+5）移到滑杆**正下方**，居中轴**参照滑杆**（不是整行：
        左右槽 52≠38 ⇒ 滑杆轴比整行轴偏右 7px）；
     ③ 「当前 X BPM」读数行（#trainerProg）与数值行**同轴**居中。
   【本用例钉什么（源码级）】行为面由冒烟闸门把守（volBpmDelta 两端对齐 / 步进群
     轴心偏差 ≤2px，量真 DOM）；这里钉结构与口径，防回潮到 v3.39.0 的同行形状。
   ================================================================================ */
"use strict";
const { ok, section, html } = require("../lib/harness");

/* 剥注释后的净表面：旧形状的存活判据只认结构，不认注释里的历史记录 */
const SURFACE = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

section("T230a 上行 .bpm-slider-row：复刻音量行三段槽位（等长的结构前提）");
{
  const seg = html.slice(html.indexOf('class="slider-row"'), html.indexOf('class="bpm-row"'));
  ok(/<div class="bpm-slider-row">/.test(html), "★ 上行容器 .bpm-slider-row 存在（滑杆行独立成行）");
  ok(/<span>BPM<\/span>/.test(seg), "★★ 左槽显示「BPM」文案（用户口径：与「节拍」大小相近、不挤滑杆）");
  ok(seg.indexOf("<span>BPM</span>") < seg.indexOf('id="bpmSlider"') && seg.indexOf('id="bpmSlider"') < seg.indexOf('class="pct"'),
    "★★ 源码序即读序：标签 → 滑杆 → 空 pct 槽（三段与 .vol-row 同构）");
  ok(/<span class="pct" aria-hidden="true"><\/span>/.test(seg),
    "★★ 右侧 pct 槽保留槽位、文案空置（BPM 没有 80% 那样的读数；空槽只为右端对齐）");
  /* 槽位宽必须与 .vol-row 同源（52/38），这是「严格等长」的数字面 */
  ok(/\.vol-row>span:first-child\{min-width:52px\}/.test(html) && /\.bpm-slider-row>span:first-child\{min-width:52px\}/.test(html),
    "★★★ 左槽定宽 52px 与 .vol-row 同值（改一处不改另一处 ⇒ 等长断裂，本条变红）");
  ok(/\.vol-row \.pct\{font-family:var\(--mono\);min-width:38px/.test(html) && /\.bpm-slider-row \.pct\{min-width:38px\}/.test(html),
    "★★★ 右槽定宽 38px 与 .vol-row 同值（同上，等长的右端前提）");
  ok(/\.bpm-slider-row\{display:flex;align-items:center;gap:10px;font-size:12px;color:var\(--t2\)\}/.test(html),
    "★ 行距 10px / 字号 12px 与 .vol-row 同款（「BPM」与「节拍」大小相近的口径）");
}

section("T230b 下一步进群：居中轴参照滑杆（62/48 = 52+10 / 38+10）");
{
  ok(/\.viz-head \.group \.slider-row \.bpm-row\{flex:0 0 auto;flex-wrap:nowrap;justify-content:center;margin:0 48px 0 62px\}/.test(html),
    "★★★ 步进群居中且 margin 62/48 与滑杆左右余量同源（居中轴=滑杆轴；改槽位宽不同步 ⇒ 本条变红）");
  ok(/\.slider-row\{display:flex;flex-direction:column;align-items:stretch;gap:6px\}/.test(html),
    "★★ .slider-row 基础规则为列向塔式（v3.39.0 同行形状退役）");
  ok(!/\.viz-head \.group \.slider-row\{flex-wrap:nowrap\}/.test(SURFACE)
    && !/\.slider-row \.bpm-row\{flex:1 1 100%\}/.test(SURFACE),
    "★★ v3.39.0 同行/折行旧规则已除名（净表面无残留——同行形状的回潮会连带旧规则复活）");
  ok(/@media \(max-width:640px\)\{[^}]*\.viz-head \.group \.slider-row \.bpm-row \.step-btn\{min-width:0;padding:6px 2px\}/.test(html),
    "★ 窄屏只放宽步进钮收缩（结构天生两行，不再需要折行规则）");
}

section("T230c 读数行 #trainerProg 与数值行同轴居中");
{
  ok(/\.viz-head \.group \.tr-prog\{width:auto;margin:0 48px 0 62px;text-align:center\}/.test(html),
    "★★★ 读数行同 62/48 内缩 + 文本居中（与步进群同轴；width:auto 盖掉基础规则 100%，防 margin 叠加溢出）");
  const seg = html.slice(html.indexOf('id="trainerProg"') - 40, html.indexOf('id="trainerProg"') + 40);
  ok(/class="tr-prog"/.test(seg), "★ #trainerProg 仍是 .tr-prog（搬块不换 id，接线不动）");
  ok(html.indexOf('class="slider-row"') < html.indexOf('id="trainerProg"'),
    "★ 源码序：读数行在 BPM 块之后（纵排塔式的第三行）");
}
