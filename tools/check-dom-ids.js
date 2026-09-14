/* DOM 引用完整性检查（审计 P1-7，零依赖）
   ---------------------------------------------------------------------------
   `$("someId")` 是单文件应用里最容易写错、也最难发现的一类 bug：写错一个字母，
   拿到的是 null，报错点在几百行之外（而且往往只在某条分支上才触发）。
   审计时人工核对过一次（67 个引用 vs 69 个 id，零悬空），这里把它固化成机器检查，
   以后不必再靠人眼。

   检查两件事：
     1) 每个 `$("x")` / `getElementById("x")` 引用的 id 在 HTML 里必须存在；
     2) 报告 HTML 里声明了但代码从不引用的 id（只提示，不算错——纯样式钩子是合法的）。

   退出码 0 = 无悬空引用，1 = 有。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { extractScript, stripComments } = require("./scan-util");

const HTML = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML, "utf8");
const script = extractScript(HTML);
const code = stripComments(script.split("\n")).join("\n");

/* HTML 里声明的 id（只看标记段，避免把脚本里拼出来的 id 当成声明） */
const markup = html.slice(0, html.indexOf("<script>"));
const declared = new Set();
{
  const re = /\sid="([^"]+)"/g;
  let mm;
  while ((mm = re.exec(markup))) declared.add(mm[1]);
}

/* 代码里引用的 id */
const referenced = new Map();     // id → 首次出现的行号
{
  const re = /(?:\$|getElementById)\(\s*"([^"]+)"\s*\)/g;
  let mm;
  while ((mm = re.exec(code))){
    const id = mm[1];
    if (!referenced.has(id)) referenced.set(id, code.slice(0, mm.index).split("\n").length);
  }
}

const dangling = [...referenced.entries()].filter(([id]) => !declared.has(id));
const unused = [...declared].filter(id => !referenced.has(id));

console.log("══════════════════════════════════════════════════════════");
console.log("  DOM 引用完整性（" + path.relative(process.cwd(), HTML) + "）");
console.log("══════════════════════════════════════════════════════════");
console.log("  HTML 声明 " + declared.size + " 个 id · 代码引用 " + referenced.size + " 个");

if (dangling.length){
  console.log("\n  ✗ " + dangling.length + " 个悬空引用（$() 会返回 null，报错点在下游）：");
  dangling.forEach(([id, ln]) => console.log(`      L${ln}  $("${id}") —— HTML 里没有这个 id`));
} else {
  console.log("\n  ✓ 零悬空引用");
}
if (unused.length){
  console.log("\n  · 声明但未被 $() 引用（可能是纯样式钩子，仅供人工确认）：" + unused.join(" / "));
}
console.log("──────────────────────────────────────────────────────────");
console.log(dangling.length ? "  DOM 引用检查：失败" : "  DOM 引用检查：通过");
process.exit(dangling.length ? 1 : 0);
