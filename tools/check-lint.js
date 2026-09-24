/* 代码卫生检查（审计 P1-7，零依赖，可本地验证）
   ---------------------------------------------------------------------------
   为什么这五条不交给 ESLint（注意：ESLint 现在**已经装了**，见 tools/check-eslint.js）：
   本仓库的硬约束是**运行时零依赖**（index.html 必须能 file:// 直开），而发布链路（Cloudflare 自动
   跑 tools/check-all.js）**不保证**先 npm install。所以"硬闸门"必须零依赖——本文件就是那道闸门，
   用「正则 + 逐行剥注释 + 花括号作用域」实现五条规则，装不装依赖都能跑。
   ESLint 是并排的**可选加强项**（AST/控制流能力），缺依赖就自动跳过；两者刻意**不重叠**：
   本文件负责的五条在 ESLint 侧全部关闭，ESLint 只补"需要真解析器才看得见"的那部分
   （死代码、重复键、switch 穿透、恒真条件、遮蔽……），分工理由见 eslint.config.js 文件头。
   保留本文件而不是全用 ESLint 的原因：ESLint 缺席时仍需有 lint，且这几条是按本项目口径手写的
   （例如 no-undef 的 GLOBALS 穷举白名单），比通用规则更贴合。

   规则（口径都写在这里，改口径请同步改注释）：
     no-var          （error）禁止 var —— 本项目全程 const/let
     eqeqeq          （error）禁止 == / !=（注释已剥离、字符串已**等长遮蔽**，不会误报。
                             审计 P2-3：早期版本误以为"字符串已剥离"而在未遮蔽文本上判定，
                             字面量 "a == b" 会被裸判成违规——现两条规则均改在 maskStrings 输出上跑）
     no-redeclare    （error）同一个**花括号块**里重复声明同名 const/let/function
                             · 作用域按真实花括号块划分（不是按缩进）——否则两个兄弟函数体
                               里各写一个 `const g` 会被误判
                             · `for (const x of …)` 的头部声明跳过（它的作用域是循环本身，
                               两个并列 for 各自声明 x 不是重复声明）
     no-unused-vars  （warn） 顶层声明后整个文件再未出现的标识符
     no-undef        （error）对**未声明**标识符赋值
                     （warn） 对**未声明**标识符发起裸调用
                             · 判定底座是「全文件扁平声明表」：const/let/var（含解构）、
                               function/class 名、函数与箭头形参、catch 形参全收进一个 Set，
                               **不做作用域分层**。取舍是明确的：只会漏报（某作用域内的名字
                               在别处被当成全局名，我们放过），不会误报（不依赖作用域模型，
                               所以不会出现「两个兄弟块各自 build() 被判重复」那类冤枉）。
                             · 字符串字面量已**等长掩码**，`"foo("` 不会被当成调用。
                             · 宿主/语言全局走白名单（GLOBALS）——白名单是**穷举**的，只在引入新的
                               宿主 API 时才追加，避免它退化成"什么都放行"的垃圾桶。
                             · 裸调用只认「名字紧跟 `(`」这一种形态，对象字面量方法简写（`{ foo(){} }`）
                               这类写法没覆盖，属**已知漏报**（本项目不用方法简写）。
     no-eval        （error）禁止 `eval(` / `new Function(`。
                             ★ 为什么必须硬拦：**线上 CSP 是 `script-src 'self' 'unsafe-inline'`**，
                               代码里出现 eval 在 file:// 下能跑、一上 Cloudflare 就被 CSP 静默掐死
                               ——"本地测得好好的、线上悄悄没反应"，且没有任何报错可查。
                               本规则让它在**提交前**就变红，而不是等到线上变哑。
     no-innerhtml   （error）`.innerHTML =` 只允许赋 `""`（清空容器）。
                             · 非空赋值 = 把字符串当 HTML 解析，两条危害：
                               ① 注入面：预设名 / 自定义型名 / 歌词行 / 导入的 JSON 都是用户可控串，
                                  一旦拼进 HTML 字符串，一个带尖括号的型名就能改页面结构；
                               ② 桩失真：测试桩与真实 DOM 对 innerHTML 的语义并不等价，
                                  用拼串造出来的节点在桩里查得到、在真机上未必（反之亦然）。
                             ★ 边界（刻意不为难既有代码）：**只管 innerHTML，不管 outerHTML**。
                               后者在本项目只有两处（`#playIcon` 播放/暂停图标切换），替换的是
                               **代码内常量** SVG 模板，无用户数据参与；要连它一起判需要 AST，
                               那是 ESLint（可选加强项）的活，不该堵在零依赖这道硬闸门上。 */

"use strict";

const path = require("path");
const {
  extractScript, stripComments, lineStarts, maskStrings, collectDeclarations, lineOf,
} = require("./scan-util");

const HTML = process.argv[2] || path.join(__dirname, "..", "index.html");
let SRC;
try {
  SRC = extractScript(HTML);
} catch (e){
  console.error("  ✗ " + e.message);
  console.error("  这是**工具故障，不是代码违规**——本次未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
}
const lines = SRC.split("\n");
const clean = stripComments(lines);
/* 偏移必须基于**剥离后**的行起点：剥注释会缩短行内长度，用原始行起点会算错位置，
   表现为 scopeAt() 落到错误的花括号块里（曾因此产生 10 条 no-redeclare 假阳性） */
const starts = lineStarts(clean);
const nLines = lines.length;
const flat = clean.join("\n");
/* 等长遮蔽字符串字面量（行号/偏移不变）。no-var / eqeqeq 必须在**遮蔽后**的文本上判定：
   stripComments 刻意保留字符串，字面量 "a == b" / "var x" 会被裸判成违规（审计 P2-3 实测复现）。
   遮蔽版同时供下方 no-undef 复用，避免重复计算。 */
const maskedFlat = maskStrings(flat);
const maskedLines = maskedFlat.split("\n");

/* ---- 自检：剥离后的源码花括号必须配平，否则作用域模型不成立（多行模板串会破坏它） ---- */
{
  let open = 0, close = 0;
  for (const ch of flat){ if (ch === "{") open++; else if (ch === "}") close++; }
  if (open !== close){
    console.error(`剥注释后花括号不配平（{ ${open} vs } ${close}）——`
      + `多半是出现了跨行模板字符串，请把 tools/check-lint.js 的剥注释逻辑升级为带状态的扫描`);
    console.error("  这是**工具故障，不是代码违规**——本次未被验证（退出码 4 = 未能执行）。");
    process.exit(4);
  }
}

/* ---- 花括号块表：每个 `{` 是一层作用域 ---- */
const blocks = [];
{
  const stack = [];
  for (let i = 0; i < flat.length; i++){
    const c = flat[i];
    if (c === "{"){ blocks.push({ start: i, end: -1 }); stack.push(blocks.length - 1); }
    else if (c === "}"){ const id = stack.pop(); if (id !== undefined) blocks[id].end = i; }
  }
}
/* 最内层包含该偏移的块 id（-1 = 文件顶层） */
function scopeAt(off){
  let best = -1, bestSpan = Infinity;
  for (let i = 0; i < blocks.length; i++){
    const b = blocks[i];
    if (b.end >= 0 && b.start < off && off < b.end){
      const span = b.end - b.start;
      if (span < bestSpan){ bestSpan = span; best = i; }
    }
  }
  return best;
}

const errors = [], warns = [];
const err = (ln, rule, msg) => errors.push({ ln, rule, msg });
const warn = (ln, rule, msg) => warns.push({ ln, rule, msg });

const decls = [];
const DECL_RE = /^(\s*)(?:const|let|var)\s+(.+)$/;

for (let i = 1; i <= nLines; i++){
  const raw = clean[i - 1] || "";
  if (!raw.trim()) continue;
  const mraw = maskedLines[i - 1] || "";          // 字符串已等长遮蔽：no-var / eqeqeq 看这一版

  if (/\bvar\s+[A-Za-z_$]/.test(mraw)) err(i, "no-var", "使用了 var：" + lines[i - 1].trim());

  {   /* eqeqeq：== / != 且不是 === / !== 的一部分 */
    const re = /[^=!<>]([=!])=(?!=)/g;
    let mm;
    while ((mm = re.exec(mraw))){
      const op = mm[1] + "=";
      err(i, "eqeqeq", `使用了 ${op}（应为 ${op}=）：` + lines[i - 1].trim());
    }
  }

  /* no-eval：在**遮蔽后**的行上判（字符串里的 "eval(" 不算）。
     两个形态都拦：`eval(…)` 与 `new Function(…)` —— 后者同样会被 CSP 掐死 */
  if (/(?<![A-Za-z0-9_$.])eval\s*\(/.test(mraw)){
    err(i, "no-eval", "禁止 eval(：线上 CSP 为 script-src 'self' 'unsafe-inline'，"
      + "eval 会被静默拦下且无任何报错：" + lines[i - 1].trim());
  }
  if (/\bnew\s+Function\s*\(/.test(mraw)){
    err(i, "no-eval", "禁止 new Function(：与 eval 同为 CSP 禁项，且把字符串当代码解析："
      + lines[i - 1].trim());
  }

  /* no-innerhtml：`.innerHTML =` 后面只允许 `""`（可带分号）。
     形如 `el.innerHTML = "";` 是清空，是本项目唯一允许的形态。
     ★ 用**遮蔽后**的行判：`el.innerHTML = ""` 的 `""` 遮蔽后仍是 `""`（长度 0 无内容可遮） */
  {
    /* ★ 这条必须判 **raw（未遮蔽）** 而不是 mraw：maskStrings 把字符串**连同引号一起**
       遮成空格，于是 `= "<b>"` 与 `= ""` 在遮蔽后长得一模一样 —— 用遮蔽版判会**放行拼串**
       （实测过：正是这条让第一版把 `el.innerHTML = ""` 误判成违规、而真拼串反而放过）。
       判 raw 的代价只是"字符串里写着 `.innerHTML = x` 会被误报"，本项目无此写法。
     ★ 判定单位是**语句**而不是"行尾"：`const clear = el => { el.innerHTML = ""; };`
       行尾还有 `};` —— 按行尾匹配会假阳性。取法：从 `=` 切到第一个 `;`（或行尾）再 trim，
       必须严格等于 `""`。 */
    const m = /\.innerHTML\s*=/.exec(raw);
    if (m){
      const rest = raw.slice(m.index + m[0].length).split(";")[0].trim();
      if (rest !== "\"\""){
        err(i, "no-innerhtml", "innerHTML 只允许赋 \"\"（清空）；拼串会引入注入面且让测试桩失真："
          + lines[i - 1].trim());
      }
    }
  }

  /* function 声明：全行扫描（一行可能有多个），但要求出现在**语句位置**
     （前面只有空白 / `}` / `;`），否则那是函数表达式（名字只属于它自己），不算声明 */
  {
    const re = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let mm;
    while ((mm = re.exec(raw))){
      if (!/^[\s};]*$/.test(raw.slice(0, mm.index))) continue;
      decls.push({ name: mm[1], line: i, at: starts[i - 1] + mm.index, top: raw.search(/\S/) <= 2 });
    }
  }

  /* const / let：先按 `;` 切成语句（一行可能有多条声明——按行只取第一条会漏掉重复声明），
     再从每个语句的 `=` 左边取声明符（支持 `const a = 1, b = 2;`） */
  for (const seg of raw.split(";")){
    const dm = DECL_RE.exec(seg);
    if (!dm) continue;
    const indent = dm[1].length;
    const names = [];
    for (const p of dm[2].split(",")){
      const nm = /^\s*([A-Za-z_$][\w$]*)\s*(=|$|\{)/.exec(p);
      if (nm) names.push(nm[1]);
      if (/=/.test(p)) break;                      // 之后是初始化表达式，不再是声明符
    }
    names.forEach(n => decls.push({ name: n, line: i, at: starts[i - 1] + indent, top: indent <= 2 }));
  }
}

/* for 头部声明：整行形如 `  for (const x of ys){` / `for (let i = 0; …)` —— 按行过滤 */
const declsFiltered = decls.filter(d => !/^\s*for\s*\(/.test(clean[d.line - 1] || ""));

/* no-redeclare：同一花括号块内同名 */
{
  const seen = new Map();
  for (const d of declsFiltered){
    const key = scopeAt(d.at) + "|" + d.name;
    if (seen.has(key)) err(d.line, "no-redeclare", `重复声明 ${d.name}（同一作用域内已在 L${seen.get(key)} 声明）`);
    else seen.set(key, d.line);
  }
}

/* no-unused-vars：顶层声明后全文再未出现（用前后界断言，$ 这类含 $ 的标识符尤其要注意） */
{
  const countOf = name => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?<![A-Za-z0-9_$])" + esc + "(?![A-Za-z0-9_$])", "g");
    return (flat.match(re) || []).length;
  };
  for (const d of declsFiltered){
    if (!d.top) continue;
    if (countOf(d.name) <= 1) warn(d.line, "no-unused-vars", `声明后全文未再使用：${d.name}`);
  }
}

/* no-undef：未声明标识符（窄规则）
   —— 只查两类"一定是标识符使用"的形态，正则不会误伤别的语法：
        a) 赋值目标 `name =`   → error：写的是隐式全局，本项目脚本头部 "use strict"，
                                 运行时直接 ReferenceError，板上钉钉是 bug
        b) 裸调用   `name(`     → warn ：可能是漏加白名单的宿主 API 或方法简写，
                                 留一条人工确认的口子，不拦 CI
   底座：全文件扁平声明表（collectDeclarations）+ 宿主全局白名单 + 字符串等长掩码。
   取舍见文件头：只漏报、不误报。 */
const GLOBALS = new Set([
  /* 语言内建 */
  "String", "Number", "Boolean", "Object", "Array", "Function", "Symbol", "BigInt",
  "Math", "JSON", "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  "EvalError", "ReferenceError", "URIError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Promise", "Proxy", "Reflect",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "Infinity", "NaN", "undefined", "globalThis", "arguments",
  /* 定时器 / 帧调度 / 微任务 */
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask", "requestIdleCallback",
  /* 浏览器宿主 */
  "window", "self", "document", "navigator", "location", "history",
  "localStorage", "sessionStorage", "indexedDB", "console", "performance",
  "URL", "URLSearchParams", "Blob", "File", "FileReader", "FormData", "Headers",
  "fetch", "atob", "btoa", "matchMedia", "AudioContext", "webkitAudioContext",
  "OffscreenCanvas", "Notification", "crypto", "customElements", "alert", "confirm",
  "Image",                          // v2.12.0：壁纸解码（`new Image()`）——解码失败即走"直接用原图"分支
]);

{
  const masked = maskedFlat;
  const declared = new Set(collectDeclarations(masked).map(d => d.name));
  const known = n => declared.has(n) || GLOBALS.has(n);
  const KW = new Set([
    "if", "for", "while", "switch", "catch", "return", "typeof", "void", "delete",
    "new", "in", "of", "do", "else", "case", "function", "with", "yield", "await",
    "throw", "instanceof", "import", "export", "default", "extends", "as", "from",
    "get", "set", "static", "async", "class", "super", "this", "true", "false", "null",
  ]);

  /* 赋值目标 `name =`（排除 `==` / `=>`） */
  const seenAsg = new Set();
  for (const m of masked.matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)){
    const n = m[1];
    if (KW.has(n) || known(n) || seenAsg.has(n)) continue;
    seenAsg.add(n);
    err(lineOf(masked, m.index), "no-undef", `对未声明标识符赋值（隐式全局）：${n}`);
  }

  /* 裸调用 `name(` */
  const seenCall = new Set();
  for (const m of masked.matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*\(/g)){
    const n = m[1];
    if (KW.has(n) || known(n) || seenCall.has(n)) continue;
    seenCall.add(n);
    warn(lineOf(masked, m.index), "no-undef", `未声明标识符被调用：${n}（宿主全局？请加入 GLOBALS 白名单）`);
  }
}

/* ---- 输出 ---- */
console.log("══════════════════════════════════════════════════════════");
console.log("  代码卫生检查 · 零依赖 lint（" + path.relative(process.cwd(), HTML) + "）");
console.log("══════════════════════════════════════════════════════════");
console.log("  已扫 " + nLines + " 行 · 声明 " + declsFiltered.length + " 个 · 作用域块 " + blocks.length + " 个");

if (warns.length){
  console.log("\n  ⚠ " + warns.length + " 条警告（不拦 CI）：");
  warns.forEach(w => console.log(`      L${w.ln} [${w.rule}] ${w.msg}`));
}
if (errors.length){
  console.log("\n  ✗ " + errors.length + " 条错误：");
  errors.forEach(e => console.log(`      L${e.ln} [${e.rule}] ${e.msg}`));
} else {
  console.log("\n  ✓ 七条规则全部通过（no-var / eqeqeq / no-redeclare / no-unused-vars / no-undef / no-eval / no-innerhtml）");
}
console.log("──────────────────────────────────────────────────────────");
console.log(errors.length ? "  代码卫生检查：失败" : "  代码卫生检查：通过");
process.exit(errors.length ? 1 : 0);
