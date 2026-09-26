/* DOM 节点账本（v2.42.2，代码审计第一批 · 步骤 2，零依赖）
   ---------------------------------------------------------------------------
   由来：冒烟步骤实测 DOM 节点 1289 / 预算 1300（余量 11 个），但「这 1289 个长在哪些分区」
   是黑盒——瘦身候选无法排序，UI 功能的预算消耗无法预估。本工具做**静态账本**：
   解析 index.html 的 <body> 标记，按顶层容器分区统计元素节点数，让每次 UI 迭代的
   DOM 消耗可见、可预算。它是 v2.26.1「先瘦身、而不是继续放宽」纪律的数据依据。

   口径声明（为什么静态数 ≠ 冒烟实测数，二者**不该相等**）：
     · 本工具数的是**标记里写死的节点**（<template> 内惰性内容单独列账，不计入"实时"）；
     · 冒烟实测数的是**运行时 document.querySelectorAll("*")**——含 JS 构建的
       网格行/格、预设列表项、动态菜单等，恒 ≥ 本静态实时数。两者互补，不互相校验。
     · 本工具给**趋势与分区排序**用：同一口径下，本次比上次多了多少、大头在哪，一眼可判。

   结构平衡校验（本工具唯一的"牙"）：body 内每个非 void 开标签必须有配对的闭标签
   （void 元素表 + `/>` 自闭除外；<script>/<style> 跳过内容、<!-- --> 跳过）。
   不平衡 → exit 1。这不是风格检查：v2.42.2 落地时实测抓到一个**游离的 `</template>`**
   （v2.37.0 帮助示意图改造残留）——浏览器静默忽略、测试桩不解析 HTML、
   3,496 条断言全绿，正是"静态标记漂移无闸门管辖"的活例证。

   刻意不做的事：**不设预算阈值**（避免假红）。预算纪律由冒烟步骤的 domNodes=1300
   独自把守；本工具只提供"钱花在哪了"的账单，不动判红权。

   用法：node tools/check-node-budget.js [html路径]     （缺省 index.html；
        可选路径参数与 check-version.js 同一约定，供反向验证喂改坏的副本）
   退出码 0 = 账单照常输出且结构平衡；1 = 结构不平衡（真缺陷，不是超预算）；
        4 = 输入/工具故障（文件读不到、找不到 body——与仓库"工具故障"约定一致）。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = process.argv[2] || path.join(ROOT, "index.html");

/* void 元素（HTML 规范）：永不带闭标签 */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);
/* 内部内容整体跳过的元素：里面的文本/标签不得当标记解析 */
const RAW = new Set(["script", "style"]);

/* ---- 令牌化：把标记切成 open/close/self 事件 ----
   手写小型状态机而不上正则：标签属性里合法地含有 `>`（如 title="a>b"）与引号，
   正则切分必然切错；而"账本数错一个"比"数不出来"更糟——账单错了没人会怀疑它。 */
function scan(src, baseLine){
  const events = [];
  let i = 0, line = baseLine;
  const nl = s => { let n = 0; for (const c of s) if (c === "\n") n++; return n; };
  while (i < src.length){
    if (src.startsWith("<!--", i)){
      const end = src.indexOf("-->", i + 4);
      const seg = end < 0 ? src.slice(i) : src.slice(i, end + 3);
      line += nl(seg); i += seg.length;
      continue;
    }
    if (src[i] !== "<"){
      if (src[i] === "\n") line++;                       // 文本节点里的换行也要计数，否则行号漂移
      i++;
      continue;
    }
    /* RAW 元素：整个内容区跳过 */
    const rawM = /^<(script|style)\b/i.exec(src.slice(i, i + 12));
    if (rawM){
      const m = new RegExp("</" + rawM[1] + "\\s*>", "i").exec(src.slice(i));
      const seg = m ? src.slice(i, i + m.index + m[0].length) : src.slice(i);
      line += nl(seg); i += seg.length;
      continue;
    }
    if (src.startsWith("</", i)){                       // 闭标签
      const gt = src.indexOf(">", i);
      if (gt < 0){ events.push({ type: "eof", line }); break; }
      const seg = src.slice(i, gt + 1);
      const nm = /^<\/\s*([a-zA-Z][\w:-]*)/.exec(seg);
      events.push({ type: "close", tag: nm ? nm[1].toLowerCase() : "?", line });
      line += nl(seg); i += seg.length;
      continue;
    }
    /* 开标签：逐字符找 `>`，引号内的 `>` 不算结束 */
    let j = i + 1, q = null;
    while (j < src.length){
      const c = src[j];
      if (q){ if (c === q) q = null; }
      else if (c === "\"" || c === "'") q = c;
      else if (c === ">") break;
      j++;
    }
    if (j >= src.length){ events.push({ type: "eof", line }); break; }
    const inner = src.slice(i + 1, j);
    const selfClose = inner.endsWith("/");
    const nm = /^([a-zA-Z][\w:-]*)/.exec(inner);
    const tag = nm ? nm[1].toLowerCase() : "?";
    const idM = /\bid\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/.exec(inner);
    const clsM = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/.exec(inner);
    events.push({
      type: selfClose ? "self" : "open", tag, line,
      id: idM ? (idM[2] || idM[3] || idM[4] || "") : "",
      cls: clsM ? (clsM[2] || clsM[3] || clsM[4] || "").split(/\s+/)[0] : "",
    });
    line += nl(src.slice(i, j + 1)); i = j + 1;
  }
  return events;
}

/* ---- 主解析：body 内容 → 分区树 + 平衡校验 ----
   计数模型：每个元素（open/self）让**栈上所有节点**各 +1——子树计数天然成立；
   close 只负责弹栈与配对校验。 */
function analyze(html){
  const bi = html.search(/<body[\s>]/i);
  const be = html.search(/<\/body\s*>/i);
  if (bi < 0 || be < 0) return { error: "index.html 里找不到 <body>…</body>（不是 BeatSight 产物？）" };
  const bodyStart = html.indexOf(">", bi) + 1;
  const baseLine = html.slice(0, bodyStart).split("\n").length;
  const events = scan(html.slice(bodyStart, be), baseLine);

  const root = { label: "<body>", count: 0, children: [] };
  const stack = [root];
  const unclosed = [];
  for (const ev of events){
    if (ev.type === "eof"){ unclosed.push({ label: "(文件在开标签内截断)", line: ev.line }); break; }
    if (ev.type === "close"){
      let k = stack.length - 1;
      while (k > 0 && stack[k].tag !== ev.tag) k--;
      if (k === 0){ unclosed.push({ label: "/" + ev.tag, line: ev.line }); continue; }
      stack.length = k;                                  // 配对弹出（计数不回退：open 时已分摊）
      continue;
    }
    const label = ev.tag + (ev.id ? "#" + ev.id : (ev.cls ? "." + ev.cls : ""));
    stack.forEach(n => n.count++);
    if (ev.type === "open"){
      const node = { tag: ev.tag, label, count: 0, children: [], line: ev.line,
        isTemplate: ev.tag === "template" };
      /* 全深度登记（707 个节点，内存可忽略）：下钻与 template 池都要完整的树 */
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
  }
  for (let d = 1; d < stack.length; d++) unclosed.push({ label: stack[d].label, line: stack[d].line });
  return { root, unclosed };
}

/* ---- 输出 ---- */
if (!fs.existsSync(HTML)){ console.error("  ✗ 读不到 " + HTML + "（输入/工具故障）"); process.exit(4); }
const html = fs.readFileSync(HTML, "utf8");
const r = analyze(html);
if (r.error){ console.error("  ✗ " + r.error); process.exit(4); }

const tops = r.root.children;
console.log("  · DOM 分区账单（静态标记口径 · 来源 " + path.basename(HTML) + " 的 <body>，按文档序）");
for (const top of tops){
  console.log("    " + String(top.count).padStart(5) + "  " + top.label + (top.isTemplate ? "  ←template 池（惰性）" : ""));
  /* 大区下钻一层：>120 的分区列出直接子容器 Top6（账单不是目录）；template 子树一并列出 */
  if (top.count > 120){
    [...top.children].sort((a, b) => b.count - a.count).slice(0, 6)
      .forEach(k => console.log("            ├ " + String(k.count).padStart(5) + "  " + k.label
        + (k.isTemplate ? "  ←template（惰性）" : "")));
  }
}
const tNodes = [];
(function walk(n){ n.children.forEach(c => { if (c.isTemplate) tNodes.push(c); walk(c); }); })(r.root);
const tSum = tNodes.reduce((s, t) => s + t.count, 0);
console.log("  ──────────────────────────────────────────");
console.log("  · 静态合计 " + r.root.count + "（含 template 池 " + tSum
  + "（" + tNodes.map(t => t.label).join(" / ") + "）——惰性内容未挂载，运行时不可见）");
console.log("  · 运行时口径见「浏览器冒烟」步骤的 DOM 节点实测（含 JS 构建节点）；"
  + "预算阈值由冒烟独自把守，本工具不设线。");

if (r.unclosed.length){
  console.log("  ✗ 结构不平衡：" + r.unclosed.length + " 处（真缺陷，不是超预算）——");
  r.unclosed.slice(0, 20).forEach(u =>
    console.log("      · L" + u.line + " 「" + u.label + "」无配对（游离闭标签 / 未闭合开标签）"));
  if (r.unclosed.length > 20) console.log("      · …其余 " + (r.unclosed.length - 20) + " 处省略");
  process.exit(1);
}
console.log("  ✓ 标记平衡：body 内全部开闭配对（void / 自闭 / script·style 跳过内容）");
process.exit(0);
