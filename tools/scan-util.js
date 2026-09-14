/* 扫描工具（零依赖）：从 index.html 提取内联脚本 + 剥离注释 + 括号配对
   ---------------------------------------------------------------------------
   被 tools/check-module-order.js 与 tools/check-lint.js 共用。
   为什么不用 ESLint / AST：本仓库的硬约束是**运行时零依赖**（index.html 必须能 file:// 直开），
   连 CI 里的工具也刻意保持零依赖——沙箱/离线环境下 npx 拉包不可靠（实测 SIGTERM）。
   这里的实现用"正则 + 括号配对 + 逐行剥注释"，覆盖面小于真 ESLint，但**可验证、不飘**。
   规则口径都写在各自检查器的注释里。 */
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

module.exports = { extractScript, stripComments, matchBrace, lineStarts, lineOf };
