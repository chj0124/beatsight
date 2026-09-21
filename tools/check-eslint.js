/* ESLint 静态检查（本地自验专用）
   ---------------------------------------------------------------------------
   为什么需要这层包装：ESLint 不认识 .html，而本项目的全部产品代码都写在
   index.html 的**内联 <script>** 里。这里把脚本抽出来、按 JS 喂给 ESLint，
   再把 ESLint 报的行列号**映射回 index.html 的真实行号**——否则报告里的行号
   对不上任何文件，等于没用。
   复用 tools/scan-util.js 的 extractScript（与 check-lint.js / check-module-order.js 同一份，
   保证"抽出来的脚本"三家完全一致）。

   为什么缺 eslint 要优雅跳过（exit 0）而不是报错：
     上站产物刻意"零构建文件"——只有 index.html / sw.js / manifest.webmanifest / icon.svg 等静态文件，
     node_modules 永远不进产物。Cloudflare 那条自动发布链路会跑 node tools/check-all.js，
     但**不保证**先跑过 npm install。若这条检查在没装依赖时判失败，就会把一个纯开发期的
     加强项变成部署的硬闸门，直接把上线堵死——那是拿最坏的结果换最小的收益。
     所以口径是：装了才查，没装就明确地说"跳过"，绝不假装通过。

   规则集在 eslint.config.js（与 check-lint.js 分工不重叠，理由写在那边）。
   退出码：0 = 通过或跳过，1 = 有 ESLint 报错，4 = 自身故障（找不到脚本块等）。
   自身故障用 4 而非 2（v2.8.14，审计 P1-6）：与 tools/check-all.js 的 TOOL_FAIL_CODE 统一，
   故障据此记成「工具故障 · 未被验证」而非「检查未通过」，也不中止后续步骤。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");

/* 优雅降级：没装 eslint 就直接跳过（理由见文件头），退出码 0 */
let ESLint;
try {
  ESLint = require("eslint").ESLint;
} catch (_){
  console.log("  ⊘ 未安装 eslint，跳过（需要时在仓库根执行 `npm install`）。");
  console.log("     这只是本地自验的加强项，不影响产物：上站仍只有 4 个文件。");
  process.exit(0);
}

const { extractScript, lineOffset } = require("./scan-util");

/* 行号映射口径（lineOffset 已从 scan-util 统一导出，v2.4.4 起不再各写一份）：
     抽取段第 1 行 = <script> 所在行的剩余部分（本项目 <script> 后直接换行 → 空行）
     抽取段第 N 行 = index.html 第 (N + baseLine) 行 */

const html = fs.readFileSync(HTML, "utf8");
const baseLine = lineOffset(html);
if (baseLine < 0){
  console.error("  ✗ 未找到 <script> 块：" + path.relative(ROOT, HTML));
  console.error("  这是**工具故障，不是 ESLint 报错**——本次未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
}

let code;
try {
  code = extractScript(HTML);
} catch (e){
  console.error("  ✗ " + e.message);
  console.error("  这是**工具故障，不是 ESLint 报错**——本次未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
}

/* 把报错位置渲染成"源码行 + 脱字符"，方便直接定位 */
function frame(htmlLines, line, column){
  const src = htmlLines[line - 1] || "";
  const caret = " ".repeat(Math.max(0, column - 1)) + "^";
  return "      " + src + "\n      " + caret;
}

(async () => {
  const htmlLines = html.split("\n");
  const eslint = new ESLint({ cwd: ROOT });
  /* filePath 只为让 ESLint 匹配配置与解析扩展名，文件本身不必存在 */
  const results = await eslint.lintText(code, { filePath: path.join(ROOT, "index.inline.js") });
  const messages = results[0].messages;

  const errors = messages.filter(m => m.severity === 2);
  const warns = messages.filter(m => m.severity !== 2);

  console.log("══════════════════════════════════════════════════════════");
  console.log("  静态检查 · ESLint（本地自验 · index.html 内联脚本）");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  已扫 " + code.split("\n").length + " 行内联脚本 · 规则见 eslint.config.js");

  if (warns.length){
    console.log("\n  ⚠ " + warns.length + " 条警告（不拦）：");
    warns.forEach(m => {
      const ln = m.line + baseLine;
      console.log("      index.html:" + ln + " [" + (m.ruleId || "?") + "] " + m.message);
    });
  }

  if (errors.length){
    console.log("\n  ✗ " + errors.length + " 条错误：");
    errors.forEach(m => {
      const ln = m.line + baseLine;
      console.log("      index.html:" + ln + ":" + m.column + " [" + m.ruleId + "] " + m.message);
      console.log(frame(htmlLines, ln, m.column));
    });
  }

  console.log("──────────────────────────────────────────────────────────");
  if (errors.length){
    console.log("  ESLint：失败");
    process.exit(1);
  }
  console.log("  ESLint：通过（0 错误" + (warns.length ? " · " + warns.length + " 警告" : "") + "）");
  process.exit(0);
})().catch(e => {
  console.error("  ✗ ESLint 执行失败：" + (e && e.message ? e.message : e));
  console.error("  这是**工具故障，不是 ESLint 报错**——本次未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
});
