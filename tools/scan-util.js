/* 扫描工具（零依赖）：从 index.html 提取内联脚本 + 剥离注释 + 括号配对
   ---------------------------------------------------------------------------
   被 tools/check-module-order.js / tools/check-lint.js / tools/check-eslint.js 共用。
   为什么这里仍用"正则 + 括号配对 + 逐行剥注释"而不是全靠 AST：本仓库的硬约束是**运行时零依赖**
   （index.html 必须能 file:// 直开），发布链路（Cloudflare 自动跑 tools/check-all.js）**不保证**
   先 npm install，所以作为**硬闸门**的那几个检查器必须零依赖、不装任何东西也能跑。
   ESLint 现在装了（devDependency），但它只作为 check-all.js 里的**可选加强项**：
   缺 node_modules 就自动跳过，绝不会因为"没装开发依赖"把上线堵死。详见 tools/check-eslint.js 文件头。 */
"use strict";
const fs = require("fs");

/* 抽出 index.html 里的内联 <script>（第一个即可——本项目只有一个） */
function extractScript(htmlPath){
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("未找到 <script> 块：" + htmlPath);
  return m[1];
}

/* 逐行剥掉注释（含跨行块注释；跳过字符串，避免把字符串里的 // 当注释）。
   不做这一步会大量误报：形如「停止时的视觉复位（Controls.stop 调用）」的**行内块注释**
   会被判成「Viz 在初始化期反向引用 Controls」。 */
function stripComments(srcLines){
  let inBlock = false;
  return srcLines.map(line => {
    let out = "", i = 0;
    while (i < line.length){
      const c = line[i], c2 = line[i + 1];
      if (inBlock){
        if (c === "*" && c2 === "/"){ inBlock = false; i += 2; continue; }
        i++; continue;
      }
      if (c === "/" && c2 === "*"){ inBlock = true; i += 2; continue; }
      if (c === "/" && c2 === "/" && (i === 0 || /\s/.test(line[i - 1]))) break;
      if (c === '"' || c === "'" || c === "`"){
        const q = c; out += c; i++;
        while (i < line.length && line[i] !== q){
          if (line[i] === "\\"){ out += line[i]; i++; }
          out += line[i]; i++;
        }
        if (i < line.length){ out += line[i]; i++; }
        continue;
      }
      out += c; i++;
    }
    return out;
  });
}

/* 从 from 处起的第一个 `{` 做括号配对（跳过注释与字符串） */
function matchBrace(src, from){
  let i = src.indexOf("{", from);
  if (i < 0) return -1;
  let depth = 0;
  for (; i < src.length; i++){
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/"){ while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*"){ i = src.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === "`"){
      const q = c; i++;
      while (i < src.length && src[i] !== q){ if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}"){ depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* 每行在整段源码里的字符起点（用于把行内偏移换算成绝对偏移） */
function lineStarts(lines){
  const out = []; let acc = 0;
  for (let i = 0; i < lines.length; i++){ out[i] = acc; acc += lines[i].length + 1; }
  return out;
}

const lineOf = (src, idx) => { let n = 1; for (let i = 0; i < idx; i++) if (src[i] === "\n") n++; return n; };

/* 行号映射（check-eslint / check-tsc / check-dom-ids 共用这一份，别各写一份）：
     抽取段紧跟在 <script> 之后，所以
     抽取段第 1 行 = <script> 所在行的剩余部分（本项目 <script> 后直接换行 → 空行）
     抽取段第 N 行 = index.html 第 (N + baseLine) 行
   baseLine 取 <script> 之前的换行数（稳一点：不写死具体行号）。
   返回 -1 = 没找到 <script> 块，调用方据此 exit 4（自身故障，见 tools/check-all.js 的 TOOL_FAIL_CODE）。 */
function lineOffset(html){
  const at = html.indexOf("<script>");
  if (at < 0) return -1;
  return (html.slice(0, at).match(/\n/g) || []).length;
}

/* 把字符串 / 模板字面量的**内容**替换成空格（长度不变，偏移与行号仍可与原文对齐；
   换行原样保留，行结构不被破坏）。
   为什么需要：stripComments 只剥注释、刻意保留字符串（它要避免把字面量里的 // 当注释），
   于是 "foo(" 这种字面量内容会被 no-undef 当成一次调用——必须再遮一层。 */
function maskStrings(src){
  const buf = src.split("");
  for (let i = 0; i < src.length; i++){
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== "`") continue;
    buf[i] = " ";
    let j = i + 1;
    while (j < src.length && src[j] !== q){
      if (src[j] === "\\"){                       // 转义对：两个字符都遮掉
        buf[j] = " "; j++;
        if (j < src.length && src[j] !== "\n") buf[j] = " ";
        j++; continue;
      }
      if (src[j] === "\n"){
        if (q !== "`") break;                     // 单/双引号里不出现裸换行：视作未闭合，就近收手
        j++; continue;                            // 跨行模板串：换行保留，行号结构不变
      }
      buf[j] = " "; j++;
    }
    if (j < src.length && src[j] === q){ buf[j] = " "; j++; }
    i = j - 1;
  }
  return buf.join("");
}

/* 把注释**与**字符串/模板字面量的内容一起替换成空格（长度与换行原样保留，偏移可与原文对齐）。
   用途：只看**代码结构**的扫描（典型是花括号深度计数）——字符串里的 `{`、注释里随手写的一对
   `{}` 都会让朴素计数彻底错位。
   与 maskStrings 的差别：那个只遮字符串（它要保留注释以便别的规则读注释），本函数连注释一起遮。
   ★ 顺序必须是**先遮字符串再遮注释**：否则 `"/*"` 这类字面量内容会被当成注释起点，
     后面整段代码都会被"注释掉"。 */
function blankNonCode(src){
  const buf = src.split("");
  /* 遮掉 [from, to) 区间内的字符，但**保留换行**（行号与偏移必须与原文逐字对齐） */
  const put = (from, to) => { for (let j = from; j < to; j++) if (src[j] !== "\n") buf[j] = " "; };
  let i = 0;
  while (i < src.length){
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/"){ let j = i; while (j < src.length && src[j] !== "\n") j++; put(i, j); i = j; continue; }
    if (c === "/" && c2 === "*"){
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      put(i, stop); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === "`"){
      const q = c;
      put(i, i + 1); i++;
      while (i < src.length && src[i] !== q){
        if (src[i] === "\\"){ put(i, i + 2); i += 2; continue; }   // 转义对：两个字符一起吃掉
        if (src[i] === "\n" && q !== "`") break;                   // 单/双引号不跨行：视作未闭合，就近收手
        put(i, i + 1); i++;
      }
      if (i < src.length && src[i] === q){ put(i, i + 1); i++; }
      continue;
    }
    i++;
  }
  return buf.join("");
}

/* 逐字符的花括号深度：返回 depth[i] = 处理第 i 个字符**之前**的深度，长度 src.length + 1。
   输入必须是 blankNonCode 处理过的源码（否则字符串/注释里的花括号会把它带偏）。
   用途：判定"这条语句在哪个嵌套层"——比看缩进可靠得多（缩进会被格式化器改写，括号不会）。 */
function braceDepths(src){
  const out = new Int32Array(src.length + 1);
  let d = 0;
  for (let i = 0; i < src.length; i++){
    out[i] = d;
    const c = src[i];
    if (c === "{") d++; else if (c === "}") d--;
  }
  out[src.length] = d;
  return out;
}

/* 声明表：从（已剥注释 + 已遮蔽字符串的）源码里收集**所有声明名**，返回 [{ name, off }]。
   覆盖 const/let/var（含解构模式、`const a = 1, b = 2` 多声明符）、function/class 名、
   函数与箭头函数的形参、catch 形参、`for (const x of …)` 的头部声明，以及
   对象字面量的**方法简写**（`{ foo(){} }` / `{ get x(){} }` / `{ async foo(){} }`）。
   口径：**只求多收，不求精确**——多收只会让 no-undef 少报（假阴性），不会误报（假阳性）；
   因此刻意不做作用域划分，也不区分初始化表达式里的标识符该不该算声明符。
   三条实现纪律（都踩过坑）：
     · 主循环只跳到关键字之后，**绝不吞掉初始化表达式**——模块体形如
       `const Store = (() => { … })()`，一旦"跳过初始化式"，模块体内所有声明就全丢了
       （曾因此少收 200+ 个名字，no-undef 全线误报）；
     · 声明列表的边界靠括号深度找同层的 `;`，而不是猜初始化式有多长；
     · **方法简写必须单独一遍扫**（v2.4.1 补）：它长得和裸调用一模一样（`name(`），
       主循环认不出它是声明，于是模块返回面写成
       `return { …, setLoopPerSec(v){ … } };` 时，`setLoopPerSec` 会被 no-undef 当成
       "未声明的宿主 API"报假阳性。判定用**前置字符**：`{` 或 `,` 紧跟其后，
       且名字不是关键字——这与"调用"（前面是 `=`、`(`、`return` 等）可区分。
       白名单式的 GLOBALS 修法不可取：那是把**自己的方法**塞进"宿主全局"名单，语义完全错。 */
function collectDeclarations(src){
  const out = [], seen = new Set();
  const add = (name, off) => { if (name && !seen.has(name)){ seen.add(name); out.push({ name, off }); } };
  const isStart = c => c !== undefined && /[A-Za-z_$]/.test(c);
  const isPart  = c => c !== undefined && /[A-Za-z0-9_$]/.test(c);
  const isWs    = c => c !== undefined && /\s/.test(c);
  const skipWs  = i => { while (isWs(src[i])) i++; return i; };
  const readId  = i => { const s = i; while (isPart(src[i])) i++; return { name: src.slice(s, i), end: i }; };
  /* i 指向 open，返回配对字符的下标（-1 = 不配对） */
  const closeOf = (i, open, close) => {
    let d = 0;
    for (; i < src.length; i++){
      if (src[i] === open) d++;
      else if (src[i] === close){ d--; if (d === 0) return i; }
    }
    return -1;
  };
  /* 区间内标识符全部记入声明表（解构模式 / 形参表——兜底式多收） */
  const addAllIn = (from, to) => {
    for (let i = from; i < to; i++){
      if (!isStart(src[i]) || isPart(src[i - 1])) continue;
      const r = readId(i); add(r.name, i); i = r.end - 1;
    }
  };
  /* 从 from 起找本条声明列表的边界（带括号深度）：
       同层 `,` → 还有下一个声明符；同层 `;` → 声明结束；
       同层出现收尾括号 → 声明嵌在 for/catch 头里，也就此结束；
       同层换行、且下一行以声明关键字开头（ASI 分号）→ 结束。
     这里**不求精确**：早停在只写一半的初始化式里最多少收一个声明符，晚停最多多收几个名字，
     两者都不会造成误报（no-undef 只会少报）。 */
  const declBounds = from => {
    let d = 0;
    for (let i = from; i < src.length; i++){
      const c = src[i];
      if (c === "(" || c === "[" || c === "{"){ d++; continue; }
      if (c === ")" || c === "]" || c === "}"){ if (d === 0) return { i, sep: false }; d--; continue; }
      if (d === 0 && c === ",") return { i, sep: true };
      if (d === 0 && c === ";") return { i, sep: false };
      if (d === 0 && c === "\n" && /^(?:const|let|var|function|class)\b/.test(src.slice(skipWs(i), skipWs(i) + 9)))
        return { i, sep: false };
    }
    return { i: src.length, sep: false };
  };

  let i = 0;
  while (i < src.length){
    if (!isStart(src[i]) || isPart(src[i - 1]) || src[i - 1] === "."){ i++; continue; }
    const kw = readId(i);
    if (kw.name === "const" || kw.name === "let" || kw.name === "var"){
      let j = skipWs(kw.end);
      for (;;){
        if (src[j] === "{" || src[j] === "["){                 // 解构模式（嵌套 / 别名 / 默认值一律多收）
          const close = closeOf(j, src[j], src[j] === "{" ? "}" : "]");
          if (close < 0) break;
          addAllIn(j + 1, close);
          j = skipWs(close + 1);
        } else {
          const d = readId(j);
          if (!d.name) break;
          add(d.name, j);
          j = d.end;
        }
        const b = declBounds(skipWs(j));
        if (!b.sep) break;                                     // `for (const x of …)` 也在此收手
        j = skipWs(b.i + 1);
      }
      i = kw.end; continue;                                    // 只跳到关键字之后，初始化式照常往下扫
    }
    if (kw.name === "function" || kw.name === "class"){
      let j = skipWs(kw.end);
      if (isStart(src[j])){ const d = readId(j); add(d.name, j); j = skipWs(d.end); }
      if (src[j] === "("){
        const close = closeOf(j, "(", ")");
        if (close > j) addAllIn(j + 1, close);
      }
      i = kw.end; continue;
    }
    i = kw.end;
  }

  /* 箭头函数形参：`(a, b) =>` / `x =>`（声明循环认不出它，单独扫一遍） */
  for (const m of src.matchAll(/=>/g)){
    let k = m.index - 1;
    while (k >= 0 && isWs(src[k])) k--;
    if (k < 0) continue;
    if (src[k] === ")"){
      let d = 0, s = -1;
      for (let p = k; p >= 0; p--){
        if (src[p] === ")") d++;
        else if (src[p] === "("){ d--; if (d === 0){ s = p; break; } }
      }
      if (s >= 0) addAllIn(s + 1, k);
    } else if (isPart(src[k])){
      let s = k;
      while (s > 0 && isPart(src[s - 1])) s--;
      const nm = src.slice(s, k + 1);
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) add(nm, s);
    }
  }

  /* catch (e) 形参 */
  for (const m of src.matchAll(/catch\s*\(/g)){
    const open = m.index + m[0].length - 1;
    const close = closeOf(open, "(", ")");
    if (close > open) addAllIn(open + 1, close);
  }

  /* 对象字面量方法简写：`{ foo(){} }` / `{ get x(){} }` / `{ async foo(){} }` / `{ *gen(){} }`
     （主循环认不出它，单独扫一遍。触发条件：`(` 前的名字，且名字前一个非空字符是 `{` 或 `,`。
       这样 `foo(` 的调用不会命中（调用前面是 `=`/`(`/`return`/行首等），不会误收。
       `get`/`set`/`async`/`static` 是修饰位，真正的名字在它们之后，故一并作为关键字跳过。） */
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*\(/g)){
    const n = m[1];
    let k = m.index - 1;
    while (k >= 0 && isWs(src[k])) k--;              // 跳过名字与前置标点之间的空白
    if (k < 0) continue;
    const prev = src[k];
    if (prev !== "{" && prev !== ",") continue;      // 只在对象字面量位置命中
    if (n === "get" || n === "set" || n === "async" || n === "static" || n === "yield") continue;
    add(n, m.index);
  }

  return out;
}

module.exports = { extractScript, stripComments, matchBrace, lineStarts, lineOf, lineOffset,
  maskStrings, blankNonCode, braceDepths, collectDeclarations };
