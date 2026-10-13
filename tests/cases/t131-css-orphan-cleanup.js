/* BeatSight 自动化测试 · CSS 孤儿清理（v2.62.0，审计 Q5）
   T131 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★★ 为什么要有这一组：审计 Q5（T3 的「CSS 孤儿扫描」延伸）指出主文件里残留一批
      历史死样式——重构删了元素却忘了删对应 .class 规则，静默赖在 1.2MB 单文件里。
      v2.62.0 用 tools/check-orphan-css.js 的静态对账 + 逐条「零代码引用」核验，
      清掉 19 个确死 class 的全部规则（含观测台覆盖与 @media 内副本，共 34 条）。

      check-orphan-css 本身是「观察期、只警告不阻断」（动态拼 class 会误报，升严格会造假红），
      所以它**不会**拦住死样式回潮。本组补一道硬闸门：把这 19 个确死 class 钉成
      「样式表里绝不允许再出现」，任何回潮都会立刻红——这就是 Q5 的"去除保护性断言"之后
      留下的反向护栏（旧 t90 曾有一条断言 .tr-dock 规则"存在"，等于保护死样式；现已翻转）。

   ★ 守一件事：注释剥离后的 <style> 里，19 个确死 class 不再作为任何规则选择器出现；
      同时用几个在用的 class 做正向 sanity（避免"样式表被清空"也能假绿）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, section } = require("../lib/harness");

const HTML_PATH = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

/* 抽 <style> 内容并剥离 CSS 注释（注释里的 .foo 不算真实规则） */
const styleMatch = HTML.match(/<style>([\s\S]*?)<\/style>/);
const styleText = styleMatch ? styleMatch[1] : "";
const nostyle = styleText.replace(/\/\*[\s\S]*?\*\//g, "");

/* 注释剥离后样式表里出现过的"真实规则 class" */
const realRuleClasses = new Set(
  [...nostyle.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1])
);

/* v2.62.0 清掉的 19 个确死 class（零代码引用：无 class= / classList / className / setAttribute /
   innerHTML 拼出，亦无元素挂此类；含已删 Stats 模块 .st-* 与 .stats-bars/.spark/.today、
   已删 pattern-head 的 .pat-*、训练组壳 .tr-dock/.tr-plan、走带/配置残余 .vdivider、
   文案区 .caption、歌词锚点 .arg-lyric-cue、检查行 .check-*、空态 .empty） */
const DEAD = [
  "arg-lyric-cue", "caption", "check-dot", "check-row", "empty", "pat-meta",
  "pat-name", "pat-row", "spark", "st-bar", "st-barwrap", "st-col", "st-day",
  "st-val", "stats-bars", "today", "tr-dock", "tr-plan", "vdivider"
];

/* 在用的 class（必须仍在样式表里，作为 sanity 反向证据） */
const LIVE = ["pill", "viz", "bpm-num", "cell", "sec-tag", "arg-jump", "loop-btn", "tr-panel"];

section("T131 · CSS 孤儿清理（审计 Q5）— 确死 class 不再作为规则出现");
let deadLeft = 0;
for (const c of DEAD){
  const gone = !realRuleClasses.has(c);
  if (!gone) deadLeft++;
  ok(gone, "★ `. " + c + "` 死样式已清理（样式表无此规则）");
}
ok(deadLeft === 0, "★ 19 个确死 class 全部清理（残留 " + deadLeft + " 个）");

section("T131 · 正向 sanity — 在用 class 仍存活（防假绿）");
for (const c of LIVE){
  ok(realRuleClasses.has(c), "★ `. " + c + "` 仍在样式表（在用，未被误删）");
}

/* ------------------------------------------------------------------
   PLAN-v11 A6 扩展：var(--x) 引用必须有定义。实锤：.arg-pill-play:hover 引用了
   全仓未定义的 var(--accent)——「静默失效」类缺陷的典型：计算值非法时浏览器静默回落，
   页面不报错、测试不崩、闸门全绿，只有人眼能发现。本组把「引用 ⊆ 定义」钉成硬闸门：
     定义集合 = 全文 `--x:` 声明（:root 两档主题 / 标记内联 style / JS 模板串）
              + setProperty("--x") 动态写入（--f / --y1 这类逐格推进量没有声明式定义）；
     引用集合 = 注释剥离后样式表里的 var(--x[,fallback])（**fallback 不豁免**——
              var(--accent, blue) 这类手滑同样静默失效，一并拦）。 */
section("T131 · PLAN-v11 A6 — var() 引用必须有定义（未定义即静默失效，硬闸门）");
{
  const defined = new Set(
    [...HTML.matchAll(/--([a-zA-Z][\w-]*)\s*:/g)].map(m => m[1])
      .concat([...HTML.matchAll(/setProperty\(\s*["'`]--([a-zA-Z][\w-]*)/g)].map(m => m[1]))
  );
  const used = [...new Set([...nostyle.matchAll(/var\(\s*--([a-zA-Z][\w-]*)/g)].map(m => m[1]))];
  const missing = used.filter(n => !defined.has(n));
  ok(missing.length === 0,
     "★ 样式表内 " + used.length + " 个 var() 引用全部有定义（未定义 " + missing.length + " 个"
     + (missing.length ? "：" + missing.slice(0, 8).join(", ") : "") + "）");
  ok(defined.has("green-rgb") && used.includes("green-rgb"),
     "★ 正向 sanity：--green-rgb 已定义且被引用（veil 单源，PLAN-v11 A6）");
}
