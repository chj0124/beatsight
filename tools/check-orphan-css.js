/* CSS 孤儿扫描（v2.58.0，审计 T3 · 技术基建，零依赖）
   ---------------------------------------------------------------------------
   由来：审计 T3 指出主文件的历史样式可能「静默膨胀」——某次重构删了元素却忘了删对应的
   .class 规则，死样式就一直赖在 1.2MB 单文件里。本工具做**静态孤儿对账**：

     · 抽取 <style> 里所有「类选择器」（.foo），与「实际被用到的类名」做差集；
     · 「被用到」的来源 = HTML 的 class="..." 属性 + JS 里的 classList.add/remove/toggle、
       className = / +=、setAttribute("class", ...) 的参数；
     · 差集即「疑似孤儿」。

   ★ 口径铁律：**先警告不阻断（exit 0）**。原因：本项目大量 class 是 JS 运行时拼出来的
   （如 `"arg-pill-" + kind`、模板字符串里的条件 class），静态扫描必然漏判 → 直接判红会
   制造大量假红（见 check-node-budget.js 头注释对假红的零容忍态度）。所以默认只打 ⚠，
   --strict 才按失败处理（exit 1）——等扫描器成熟、确认无误报后再升严格。

   用法：node tools/check-orphan-css.js [html路径] [--strict]
   退出码 0 = 对账完成（或观察期内的 ⚠）；1 = --strict 下仍有孤儿；4 = 工具故障。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(ROOT, "index.html");
const STRICT = process.argv.includes("--strict");

if (!fs.existsSync(HTML)){ console.error("未找到主文件：" + HTML); process.exit(4); }
const src = fs.readFileSync(HTML, "utf8");

/* ---- 1) 抽取 CSS 里的类选择器 ---- */
const cssText = (src.match(/<style>([\s\S]*?)<\/style>/g) || []).map(b => b.replace(/<\/?style>/g, "")).join("\n");
const cssClasses = new Set();
const cssRe = /\.([a-zA-Z][\w-]*)/g;
let m;
while ((m = cssRe.exec(cssText))){ cssClasses.add(m[1]); }

/* ---- 2) 抽取「被用到的」类名 ---- */
const used = new Set();
// HTML class="..."
for (const mm of src.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)){
  mm[1].split(/\s+/).forEach(c => { if (c) used.add(c); });
}
// JS：classList.add/remove/toggle("x")、className = / += "x"、setAttribute("class", "x")
for (const mm of src.matchAll(/\bclassList\.(?:add|remove|toggle|contains)\(\s*["']([^"']+)["']/g)){ mm[1].split(/\s+/).forEach(c => used.add(c)); }
for (const mm of src.matchAll(/\bclassName\s*(\+=|\=)\s*["']([^"']*)["']/g)){ mm[2].split(/\s+/).forEach(c => used.add(c)); }
for (const mm of src.matchAll(/setAttribute\(\s*["']class["']\s*,\s*["']([^"']*)["']/g)){ mm[1].split(/\s+/).forEach(c => used.add(c)); }

/* ---- 3) 差集 = 疑似孤儿 ---- */
const orphans = [...cssClasses].filter(c => !used.has(c)).sort();
// 过滤掉「显然不是 class 选择器」的误抓：CSS 里 .5 这种已被 [a-zA-Z] 前缀挡掉；
// 剩下的若同时也出现在 used 的动态前缀里（如 arg-pill 是 arg-pill-play 的前缀）也算在用——
// 这里做前缀兜底：若某 used 类以 orphan+'-' 开头，则 orphan 视为「动态前缀基」，不算孤儿。
const usedArr = [...used];
const realOrphans = orphans.filter(o => !usedArr.some(u => u.startsWith(o + "-") || u === o));

console.log("══════════════════════════════════════════════");
console.log("  CSS 孤儿扫描（观察期 · 默认只警告不阻断）");
console.log("══════════════════════════════════════════════");
console.log("  · CSS 类选择器：" + cssClasses.size + " 个 · 被用到的类名：" + used.size + " 个");
if (!realOrphans.length){
  console.log("  ✓ 未发现孤儿 class（或均属动态前缀基，已在运行期拼出）");
  process.exit(0);
}
console.log("  ⚠ 疑似孤儿 class（" + realOrphans.length + " 个，确认删除前先核对动态拼法）：");
realOrphans.forEach(o => console.log("    - ." + o));
console.log("  处置：确属死样式 → 连同对应规则一起删；若运行期动态拼出 → 把它加进 used 或放宽本扫描。");
process.exit(STRICT ? 1 : 0);
