/* 设计令牌闸门（PLAN-v16，零依赖）
   ---------------------------------------------------------------------------
   由来：2026-10-27 全面设计审计（docs/archive/PLAN-v16-design-tokens.md）的结论——
   间距 30 种字面值、字号 ≤16px 11 档、圆角 14 种并存，「层级间距关系混乱」的根因是
   刻度没有单一来源。本工具把方案 §3 的四条规则机器化：

     R1 令牌存在性   :root 必须定义方案 §2 的 --sp-* / --fs-* / --radius-* 全集，
                      且值与契约一致（令牌的值本身就是约定，漂移即红）。
     R2 间距增量禁令  注释剥离后的样式表里，所有含 px 字面值的 margin/padding/gap 声明
                      以「属性:值」归一化后与 baseline 比对——**新增判红，消失可收缩**。
                      收缩不是错误：跑 --update-baseline 把基线收紧（迁移进度的度量方式）。
     R3 圆角硬红线    border-radius 的 999px / 99px 两种历史胶囊写法一律判红（无观察期，
                      全仓唯一写法是 --radius-full=9999px；D4 拍板）。其余圆角字面值走
                      与 R2 同款 baseline 制。
     R4 主题纪律      body[data-theme="obs"] 块内不得定义 --sp-/--fs-/--radius- 令牌
                      （主题只许换颜色，不许换布局度量，D7 拍板）；obs 块内的布局类
                      px 字面值（padding/margin/font-size/border-radius/height）走
                      baseline，D7 甲案执行后应收敛为空。

   为什么是「baseline 收缩式」而不是全量判红（D5 甲案）：存量 200+ 条声明一次性清完
   才能合入第一行代码，工期不可行；基线只减不增把收敛变成**单调过程**——任何新代码
   想再写裸 px 间距都会被当场拦住，存量则按 PLAN-v16 §8 的分区批次逐步消化。

   基线文件 tools/design-token-baseline.json 由 --update-baseline 生成/收紧；
   它是「白名单例外」的唯一台账（PLAN-v16 §2.5），不存在第二份要同步的文档。

   用法：
     node tools/check-design-tokens.js                    # 检查（退出码 0 通过 / 1 违规 / 4 自身故障）
     node tools/check-design-tokens.js --update-baseline  # 从现状重建基线（迁移批收尾时跑）
     node tools/check-design-tokens.js --file=<path>      # 检查指定 HTML（反向验证/测试用）
   退出码约定与 check-coverage 一致：1 = 违规（真失败），4 = 自身故障（未能执行）。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, "design-token-baseline.json");

/* ---- R1：令牌契约（名字 → 契约值）。改值必须连同 PLAN-v16 §2 一起改（方案级决策） ---- */
const TOKEN_CONTRACT = {
  "--sp-1": "4px", "--sp-2": "8px", "--sp-3": "12px", "--sp-4": "16px", "--sp-6": "24px", "--sp-8": "32px",
  "--fs-glyph": "9px", "--fs-micro": "10px", "--fs-cap": "11px",
  "--fs-body": "12px", "--fs-lead": "13px", "--fs-title": "14px", "--fs-head": "16px",
  "--radius-cell": "3px", "--radius-ctrl": "6px", "--radius-item": "8px",
  "--radius-card": "12px", "--radius-full": "9999px"
};

/* 扫描目标属性：
   · 间距族（R2 计量）：margin/padding 全方向 + gap/row-gap/column-gap
   · 布局族（仅 R4 的 obs 桶计量）：font-size / height（^ 锚定天然排除 min-/max- 前缀）
   · border-radius 单列（R3 硬红线 + 桶计量） */
const SPACE_RE = /^(?:margin|padding)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?|(?:row-|column-)?gap$/;
const LAYOUT_RE = /^(?:font-size|height)$/;

const norm = s => s.replace(/\s+/g, " ").trim();
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, "");

function extractCss(html){
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("样式表不存在（<style> 未找到）");
  return stripComments(m[1]);
}

/* 花括号行走器：把每条「属性:值」交给回调，@media/选择器前缀累积进链路供 obs 归属判定。
   注释在 extractCss 已剥离；引号内分号（url("data:...;utf8,...")）会提前断条，
   但断出的碎片不匹配任何目标属性、静默跳过，无副作用（v1 实测）。 */
function walkDecls(css, cb){
  let buf = "", depth = 0, prelude = "";
  const flushDecl = text => {
    /* 属性名须容忍数字与连字符（--sp-2 / --fs-1 这类带序号的令牌是首要看漏对象） */
    const m = norm(text).match(/^([a-zA-Z-][a-zA-Z0-9-]*)\s*:\s*(.+)$/);
    if (m) cb({ prop: m[1], value: norm(m[2]), inObs: prelude.includes('data-theme="obs"') });
  };
  for (let i = 0; i < css.length; i++){
    const ch = css[i];
    if (ch === "{"){
      prelude += "⟦" + norm(buf) + "⟧";
      buf = ""; depth++;
    } else if (ch === "}"){
      if (buf.includes(":")) flushDecl(buf);
      buf = "";
      depth--;
      const open = prelude.lastIndexOf("⟦");
      if (open >= 0) prelude = prelude.slice(0, open);
    } else if (ch === ";" && depth > 0){
      if (buf.includes(":")) flushDecl(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
}

function scanDecls(css){
  const spacing = new Set(), radius = new Set(), obs = new Set();
  const obsTokenHits = [];
  walkDecls(css, d => {
    if (d.prop.startsWith("--")){
      if (d.inObs && /^(--sp-|--fs-|--radius-)/.test(d.prop)) obsTokenHits.push(d.prop);
      return;
    }
    if (d.prop === "border-radius"){
      (d.inObs ? obs : radius).add(d.prop + ":" + d.value);
      return;
    }
    if (SPACE_RE.test(d.prop)){
      if (/\dpx/.test(d.value)) (d.inObs ? obs : spacing).add(d.prop + ":" + d.value);
      return;
    }
    if (LAYOUT_RE.test(d.prop) && d.inObs && /\dpx/.test(d.value)){
      obs.add(d.prop + ":" + d.value);
    }
  });
  return { spacing: [...spacing].sort(), radius: [...radius].sort(), obs: [...obs].sort(), obsTokenHits };
}

function checkTokens(css){
  const missing = [], drifted = [];
  for (const [name, val] of Object.entries(TOKEN_CONTRACT)){
    const re = new RegExp(name.replace(/-/g, "\\-") + "\\s*:\\s*([^;\\n}]+)");
    const m = css.match(re);
    if (!m) missing.push(name);
    else if (norm(m[1]) !== val) drifted.push(name + " 期望 " + val + " 实为 " + norm(m[1]));
  }
  return { missing, drifted };
}

function loadBaseline(){
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); }
  catch (e){ return { spacing: [], radius: [], obs: [] }; }
}

function run(opts){
  const htmlPath = (opts && opts.file) || path.join(ROOT, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const css = extractCss(html);
  const problems = [], report = [];
  const tokens = checkTokens(css);
  if (tokens.missing.length || tokens.drifted.length){
    report.push("✗ R1 令牌契约：" + tokens.missing.length + " 缺失 / " + tokens.drifted.length + " 漂移");
    tokens.missing.forEach(x => problems.push("R1 令牌缺失 —— " + x));
    tokens.drifted.forEach(x => problems.push("R1 令牌漂移 —— " + x));
  } else {
    report.push("✓ R1 令牌契约：" + Object.keys(TOKEN_CONTRACT).length + " 枚令牌名值全部对齐");
  }
  const scan = scanDecls(css);
  const hardRadius = (css.match(/border-radius\s*:\s*[^;}\n]+/g) || [])
    .filter(v => /\b(?:999|99)px\b/.test(v)).map(norm);
  if (hardRadius.length){
    report.push("✗ R3 胶囊写法：" + hardRadius.length + " 处 999px/99px（唯一写法 var(--radius-full)）");
    hardRadius.slice(0, 8).forEach(x => problems.push("R3 胶囊写法 —— " + x));
  } else {
    report.push("✓ R3 胶囊写法：999px/99px 零残留");
  }
  if (scan.obsTokenHits.length){
    const names = [...new Set(scan.obsTokenHits)].join(",");
    report.push("✗ R4 主题纪律：obs 块定义了布局令牌 " + names);
    problems.push("R4 主题纪律 —— obs 块定义布局令牌：" + names);
  }
  if (opts && opts.updateBaseline){
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({
      _comment: "PLAN-v16 §2.5 白名单台账（唯一真相源）。生成：node tools/check-design-tokens.js --update-baseline。只许收缩不许扩张：check 模式下出现基线外的新声明即判红。",
      spacing: scan.spacing, radius: scan.radius, obs: scan.obs
    }, null, 2) + "\n");
    report.push("✓ 基线已重建：间距 " + scan.spacing.length + " / 圆角 " + scan.radius.length + " / obs " + scan.obs.length);
  } else {
    const base = loadBaseline();
    const newSpacing = scan.spacing.filter(k => !base.spacing.includes(k));
    const newRadius = scan.radius.filter(k => !base.radius.includes(k));
    const newObs = scan.obs.filter(k => !base.obs.includes(k));
    const newCount = newSpacing.length + newRadius.length + newObs.length;
    if (newCount){
      report.push("✗ R2/R4 基线外新增：" + newCount + " 处（间距 " + newSpacing.length + " / 圆角 " + newRadius.length + " / obs " + newObs.length + "）");
      newSpacing.slice(0, 12).forEach(x => problems.push("R2 基线外间距 —— " + x));
      newRadius.slice(0, 8).forEach(x => problems.push("R2 基线外圆角 —— " + x));
      newObs.slice(0, 8).forEach(x => problems.push("R4 基线外 obs 布局 —— " + x));
    } else {
      report.push("✓ R2/R4 基线冻结：零新增（台账 间距 " + base.spacing.length + " / 圆角 " + base.radius.length + " / obs " + base.obs.length + "）");
    }
    const shrunk = base.spacing.filter(k => !scan.spacing.includes(k)).length
      + base.radius.filter(k => !scan.radius.includes(k)).length
      + base.obs.filter(k => !scan.obs.includes(k)).length;
    if (shrunk) report.push("  ⚠ 台账可收缩 " + shrunk + " 项（迁移已生效，跑 --update-baseline 收紧）");
  }
  return { ok: problems.length === 0, problems, report };
}

function main(){
  const argv = process.argv.slice(2);
  const file = (argv.find(a => a.startsWith("--file=")) || "").split("=")[1] || undefined;
  const update = argv.includes("--update-baseline");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  设计令牌（PLAN-v16：间距/字号/圆角契约 · 基线冻结 · 主题纪律）");
  console.log("══════════════════════════════════════════════════════════");
  let res;
  try { res = run({ file, updateBaseline: update }); }
  catch (e){
    console.error("✗ 工具自身故障：" + e.message);
    process.exit(4);
  }
  res.report.forEach(l => console.log("  " + l));
  if (!res.ok){
    console.error("\n  ✗ 违规 " + res.problems.length + " 处：");
    res.problems.forEach(p => console.error("    ✗ " + p));
    process.exit(1);
  }
  process.exit(0);
}
if (require.main === module) main();

module.exports = { extractCss, scanDecls, checkTokens, run, TOKEN_CONTRACT };
