/* TypeScript 类型检查（本地自验专用 · 可选加强项）
   ---------------------------------------------------------------------------
   为什么需要这层包装：tsc 不认识 .html，而本项目的全部产品代码都写在 index.html 的
   **内联 <script>** 里。这里把脚本抽出来、按 JS 喂给 tsc，再把 tsc 报的行号
   **映射回 index.html 的真实行号**——否则报告里的行号对不上任何文件，等于没用。
   复用 tools/scan-util.js 的 extractScript（与 check-lint.js / check-module-order.js /
   check-eslint.js 同一份，保证"抽出来的脚本"四家完全一致）。

   ── 为什么要在抽取文件末尾补一行 `export {};` ──
   补上之后 tsc 把它当**模块**而不是全局脚本。这不是为了消错而变换代码，而是更贴近真实作用域：
   浏览器里 `<script>` 的顶层 `const Audio` 就是只在脚本内遮蔽全局，并不会与 lib.dom 的
   `declare var Audio` 冲突。当全局脚本检查时，tsc 会报「Cannot redeclare block-scoped
   variable 'Audio'」，并把后面 4 处 `Audio.scheduler` 解析成 **HTMLAudioElement 的属性**——
   那是 5 条与真实代码无关的假报错。补 `export {}` 后这 5 条自然消失，其余检查一条不松。
   追加在**文件末尾**，所以前面所有行的行号分毫不动（映射表因此仍然成立）。

   ── 为什么缺 typescript 要优雅跳过（exit 0）而不是报错 ──
   与 check-eslint.js 完全同理：上站产物刻意"零构建文件"，node_modules 永远不进产物；
   Cloudflare 那条自动发布链路会跑 node tools/check-all.js，但**不保证**先跑过 npm install。
   若这条检查在没装依赖时判失败，就会把一个纯开发期的加强项变成部署的硬闸门，
   直接把上线堵死——拿最坏的结果换最小的收益。口径：装了才查，没装就明确说"跳过"，绝不假装通过。
   （注：check-all.js 只认退出码，它自己也知道这步是可选依赖，会在汇总里标 ⊘ 而不是 ✓。）

   规则集（含"为什么不开 noImplicitAny"）在 tools/tsconfig.typecheck.json 的文件头。
   退出码：0 = 通过或跳过，1 = 有类型错误，2 = 自身故障（找不到 script 块 / tsc 跑了但输出无法解析）。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");
const CONFIG = path.join(__dirname, "tsconfig.typecheck.json");

/* 优雅降级：没装 typescript 就直接跳过（理由见文件头），退出码 0 */
let tscBin;
try {
  tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  if (!fs.existsSync(tscBin)) throw new Error("找不到 " + tscBin);
} catch (_){
  console.log("  ⊘ 未安装 typescript，跳过（需要时在仓库根执行 `npm install`）。");
  console.log("     这只是本地自验的加强项，不影响产物：上站仍只有 4 个文件。");
  process.exit(0);
}

const { extractScript, lineOffset } = require("./scan-util");

/* 行号映射口径：lineOffset 已从 scan-util 统一导出（v2.4.4 起不再各写一份）。
     抽取段第 N 行 = index.html 第 (N + baseLine) 行 */

const html = fs.readFileSync(HTML, "utf8");
const baseLine = lineOffset(html);
if (baseLine < 0){
  console.error("  ✗ 未找到 <script> 块：" + path.relative(ROOT, HTML));
  process.exit(2);
}

let code;
try {
  code = extractScript(HTML);
} catch (e){
  console.error("  ✗ " + e.message);
  process.exit(2);
}

const htmlLines = html.split("\n");
/* 把报错位置渲染成"源码行 + 脱字符"，与 check-eslint.js 的输出形态保持一致 */
function frame(line, column){
  const src = htmlLines[line - 1] || "";
  const caret = " ".repeat(Math.max(0, column - 1)) + "^";
  return "      " + src + "\n      " + caret;
}

/* 临时目录：放抽取出的 inline.js + 一份 tsconfig 副本，跑完即删 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beatsight-tsc-"));
let out = "", status = 0;
try {
  fs.writeFileSync(path.join(dir, "inline.js"), code + "\nexport {};\n");
  fs.copyFileSync(CONFIG, path.join(dir, "tsconfig.json"));

  const r = spawnSync(process.execPath, [tscBin, "-p", path.join(dir, "tsconfig.json")], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  out = (r.stdout || "") + (r.stderr || "");
  status = r.status === null ? 2 : r.status;
} finally {
  try{ fs.rmSync(dir, { recursive: true, force: true }); }catch(e){}
}

console.log("══════════════════════════════════════════════════════════");
console.log("  类型检查 · tsc（本地自验 · index.html 内联脚本）");
console.log("══════════════════════════════════════════════════════════");
console.log("  已扫 " + code.split("\n").length + " 行内联脚本 · 配置见 tools/tsconfig.typecheck.json");

/* tsc 的诊断行形如：<file>(<line>,<col>): error TS1234: <message>
   同一处可能跟一行缩进的补充说明（"Type 'x' is not assignable..."），一并收集。 */
const diags = [];
for (const line of out.split("\n")){
  const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line.trim());
  if (m){
    diags.push({ file: m[1], line: +m[2], col: +m[3], sev: m[4], code: m[5], msg: m[6] });
  } else if (diags.length && /^\s{2,}\S/.test(line)){
    diags[diags.length - 1].msg += " " + line.trim();
  }
}

/* 配置错误（tsconfig 写坏了之类）没有 (行,列) 形态，会整段落在 out 里且退出码非 0 —— 单独兜住，
   否则会以"0 条诊断但退出码 1"的形式静默判失败，看不出原因 */
if (!diags.length && status !== 0){
  console.log("\n  ✗ tsc 以退出码 " + status + " 结束，但没有解析到任何诊断 —— 多半是配置或环境问题：");
  console.log(out.split("\n").slice(0, 20).map(l => "      " + l).join("\n"));
  process.exit(2);
}

const errors = diags.filter(d => d.sev === "error");

if (errors.length){
  console.log("\n  ✗ " + errors.length + " 条类型错误：");
  errors.forEach(d => {
    const ln = d.line + baseLine;
    console.log("      index.html:" + ln + ":" + d.col + " [" + d.code + "] " + d.msg);
    console.log(frame(ln, d.col));
  });
  console.log("──────────────────────────────────────────────────────────");
  console.log("  类型检查：失败");
  process.exit(1);
}

console.log("──────────────────────────────────────────────────────────");
console.log("  类型检查：通过（0 错误）");
process.exit(0);
