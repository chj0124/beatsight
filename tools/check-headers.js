/* _headers 结构断言（v2.8.7，审计 §S1，零依赖）
   ---------------------------------------------------------------------------
   为什么需要它：`_headers` 是本仓库**唯一一个"写错了不报错、只会静默失效"**的配置文件。
   Cloudflare Workers 解析它时对未知/畸形行**不告警**，于是下面这些改动的后果都是"页面
   照常打开，只是安全头没了"——没有任何人会察觉：
     · 删掉 `/*` 那一行 → 6 条头**全部失去作用域**（静默失效）；
     · 在中间再插一行 `/*` → 作用域被截断，自新规则起的后半段头静默失效；
     · 写成 C 风格注释（斜杠星号 … 星号斜杠）→ 那个收尾标记会变成一条无意义的路径规则。
   前两条正是 §S1 点出的"生效是巧合，不是设计"：`/*` 在 `_headers` 里**不是注释开头**，
   而是"匹配所有路径"的路径 glob，它生效纯属巧合。所以这条闸门必须存在。

   边界（刻意保持窄）：只做**结构**断言，不校验任何一条头的**取值**。取值该收紧时应当
   改 `_headers` 本身并走 review，而不是让一个正则去猜意图——`eslint.config.js` 里那句
   "一个常年飘红的检查很快就会被所有人无视或直接关掉"在这里同样成立。

   ★ 读文件时必须逐行去掉行尾 `\r`（本仓库工作区是 CRLF，而 git 仓库内是 LF）：
     JS 正则的 `.` **不匹配** `\r`（它属于 LineTerminator），形如 `…(.*)$` 的写法在
     CRLF 行上会整条匹配失败，而 `…\s*$` 那种又碰巧能过——同一份代码里两种写法行为
     不一致，极难排查。tools/check-wiring.js 第一版正是在这里栽过（11 个已装配的钩子
     被全部报成"从未赋值"）。本文件从第一版就规避这个坑。
     ★ 本注释块里刻意不写出那个 C 风格收尾标记的字面量（它会把这段注释提前截断），
       需要判断时用下面的 CLOSER 常量拼出来。

   用法：node tools/check-headers.js
   退出码 0 = 结构正确；1 = 有断言失败。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "_headers");

/* C 风格注释的收尾标记，用拼接写出：直接写字面量会把本文件的注释块提前截断 */
const CLOSER = "*" + "/";
/* C 风格注释的开头标记，同上 */
const OPENER = "/" + "*";

/* 必须存在的 6 个安全头（顺序与文件里一致，仅为可读）。
   删掉任何一个都会被这里拦下——"安全头静默消失"是这类文件唯一的失效模式，
   而"少一个头"恰恰是这 6 个里最容易发生、也最难被发现的一种。 */
const REQUIRED = [
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Content-Security-Policy",
  "X-Frame-Options",
  "Permissions-Policy",
  "Strict-Transport-Security",
];

const problems = [];
let lineCount = 0;

console.log("══════════════════════════════════════════════════════════");
console.log("  _headers 结构断言");
console.log("══════════════════════════════════════════════════════════");

if (!fs.existsSync(FILE)){
  problems.push("_headers 不存在——它是 dist/ 的来源之一，缺了等于 6 条安全头全丢");
} else {
  const raw = fs.readFileSync(FILE, "utf8");

  /* 1) BOM：Cloudflare 不认带 BOM 的首行，首行的 `#` 注释与全路径 glob 都会解析失败 */
  if (raw.charCodeAt(0) === 0xFEFF) problems.push("文件带 UTF-8 BOM——首行会被解析失败（应存为无 BOM）");

  const lines = raw.replace(/^\uFEFF/, "").split("\n").map(l => l.replace(/\r$/, ""));
  /* 末尾换行会 split 出一个空元素，去掉它，好让下面报的"行数"与 wc -l 一致 */
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  lineCount = lines.length;
  const body = lines.join("\n");

  /* 2) 不得出现孤立的收尾标记：它在 `_headers` 里是**路径规则**而不是注释收尾 */
  lines.forEach((l, i) => {
    if (l.trim() === CLOSER) problems.push("L" + (i + 1) + " 是孤立的「" + CLOSER + "」——它会被当成一条无意义的路径规则，应删除");
  });

  /* 3) 全路径 glob 必须**恰好一行** */
  const globLines = [];
  lines.forEach((l, i) => { if (l.trim() === OPENER) globLines.push(i); });
  if (globLines.length === 0){
    problems.push("找不到「" + OPENER + "」（匹配所有路径的 glob）——6 条头会失去作用域，静默全部失效");
  } else if (globLines.length > 1){
    problems.push("「" + OPENER + "」出现了 " + globLines.length + " 次（L" + globLines.map(i => i + 1).join("、L")
      + "）——必须恰好 1 次：多写一行会把作用域截断，后半段头静默失效");
  } else {
    /* 4) 头必须**缩进**在 glob 之下；顶格的头不在任何作用域内，不会生效 */
    const gi = globLines[0];
    lines.forEach((l, i) => {
      if (i <= gi) return;
      const m = /^([A-Za-z][A-Za-z0-9-]*):/.exec(l);
      if (m) problems.push("L" + (i + 1) + " 顶格写头「" + m[1] + "」——它在 glob 作用域之外，不会生效（应缩进）");
    });
  }

  /* 5) 6 个安全头必须齐全。
        这里刻意用 `[ \t]*`（允许顶格）而非 `[ \t]+`：顶格的情形已由上面第 4 条报出更具体
        的原因（"在 glob 作用域之外"），若这里再报一次"缺少"，同一个问题会出现两条不同的
        解释——读的人会以为有两个毛病。判"有没有"时只看头名在不在，判"写对没写对"交给第 4 条。 */
  REQUIRED.forEach(h => {
    if (!new RegExp("^[ \\t]*" + h + "\\s*:", "m").test(body)){
      problems.push("缺少安全头 " + h + "（删掉它等于放弃该项防护，且不会有任何报错）");
    }
  });
}

if (problems.length){
  console.log("");
  problems.forEach(p => console.log("  ✗ " + p));
  console.log("──────────────────────────────────────────────────────────");
  console.log("  ✗ _headers 结构断言未通过：" + problems.length + " 项");
  console.log("  提示：「" + OPENER + "」是**路径 glob**（匹配所有路径），不是 C 注释开头；"
    + "`_headers` 只认 `#` 为注释。详见 _headers 内的作用域声明。");
  process.exit(1);
}

console.log("  ✓ _headers 结构正确（" + lineCount + " 行：安全头 " + REQUIRED.length
  + " 项齐全 · 全路径 glob 恰好 1 行 · 无 BOM · 无孤立收尾标记）");
process.exit(0);
