/* 无障碍静态闸门（v3.34.6，审计 第二部分①）
   ---------------------------------------------------------------------------
   为什么要有这一步：本仓的无障碍断言**分散在十几个用例文件里**（t24 的 role=switch 计数、
   t157 的图例 aria、t90 的控件可达性 …），它们各自钉住**已知的**那几个元素——
   但**没有任何一步会拦住"新加了一个没名字的图标按钮"**。这正是覆盖率盲区的典型形状：
   已覆盖的部分很扎实，未覆盖的是"还没出现的东西"。

   本步只做**静态标记**能判的事，且刻意把判据收紧到"高置信、不误报"——
   宁可少查几条，也不要变成天天喊狼来了然后被加进忽略清单的橡皮图章。
   ★ 误报的代价在本仓有过先例：本步的初稿曾把 `#themeToggle` 报成"图标按钮无名字"，
     而实际上 `applyTheme()` 会在启动时 `setAttribute("aria-label", …)`（index.html 内）。
     静态标记看不见运行期赋值 ⇒ 判据必须把"JS 会补名字"也认作有名字（见规则 D 的 RUNTIME_LABELS）。

   规则（每条都取自 WCAG / ARIA 作者实践里最没有争议的部分）：
     A. 不得出现**正的** tabindex（打乱自然 Tab 序，公认反模式；0 与 -1 放行）
     B. `role="switch"` 必须带 `aria-checked`（否则读屏读不出开关态）
     C. `<img>` 必须有 `alt`（本仓目前无 img，属"将来加图时才有用"的前置闸）
     D. 可交互元素（button / [role=button] / [tabindex]）必须有可访问名：
        可见文本、aria-label、aria-labelledby、外层 <label>、或**运行期赋名**，五者之一即可
     E. `aria-hidden="true"` 的子树里不得含可聚焦元素（会把键盘用户困在"看不见但能 Tab 到"的地方）

   退出码：0 = 通过，1 = 有违规，4 = 自身故障（找不到 <script> / 解析失败）。
   4 与 check-all 的 TOOL_FAIL_CODE 同口径——故障记「工具故障 · 未被验证」，不算失败。
   =========================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const HTML = process.argv[2] || path.join(__dirname, "..", "index.html");
let html;
try{ html = fs.readFileSync(HTML, "utf8"); }
catch(e){ console.error("读不到文件：" + HTML); process.exit(4); }

const bodyAt = html.indexOf("<body");
if (bodyAt < 0){ console.error("找不到 <body>：结构不符"); process.exit(4); }
const BODY = html.slice(bodyAt);
/* 注释先剥掉：本仓注释里大量出现裸标签片段（如"不得加 switch 语义角色"那段），
   不剥会把注释里的示例当成真标记 —— 这类假阳性最容易被误当成真问题 */
const MARKUP = BODY.replace(/<!--[\s\S]*?-->/g, "");
const SCRIPT = (() => {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  return m ? m[1] : "";
})();

/* ---- 运行期赋名：`X.setAttribute("aria-label", …)` / `$("X").setAttribute("aria-label"…)`
   静态标记里看不到它们，但真机上元素确实有名字。把 id 收进来，规则 D 据此放行。 */
const RUNTIME_LABELS = (() => {
  const ids = new Set();
  const re = /(?:getElementById\(\s*"([^"]+)"\s*\)|\$\(\s*"([^"]+)"\s*\)|(\w+))\.setAttribute\(\s*"aria-label"/g;
  let m;
  while ((m = re.exec(SCRIPT))) ids.add(m[1] || m[2] || "");
  /* 变量名形式（如 `tt.setAttribute("aria-label"…)`）要反查它绑的是哪个 id：
     找 `const tt = $("themeToggle")` 这类赋值 */
  const re2 = /(\w+)\s*=\s*(?:\$|getElementById)\(\s*"([^"]+)"\s*\)/g;
  const varToId = {};
  while ((m = re2.exec(SCRIPT))) varToId[m[1]] = m[2];
  const re3 = /(\w+)\.setAttribute\(\s*"aria-label"/g;
  while ((m = re3.exec(SCRIPT))){
    const id = varToId[m[1]];
    if (id) ids.add(id);
  }
  return ids;
})();

const problems = [];
const okLines = [];

/* ---- 元素抽取（够用即可：本仓标记规整，属性一律双引号） ---- */
/** 把某标签的开标签全部抓出来，带其在 MARKUP 中的位置（用于 E 的包含判断） */
function openTags(name){
  const re = new RegExp("<" + name + "\\b[^>]*>", "g");
  const out = [];
  let m;
  while ((m = re.exec(MARKUP))) out.push({ tag: m[0], at: m.index });
  return out;
}
/** 元素的可访问名来源（静态四选一） */
function staticName(tagText, innerText){
  if (/aria-label\s*=\s*"[^"]+"/.test(tagText)) return "aria-label";
  if (/aria-labelledby\s*=\s*"[^"]+"/.test(tagText)) return "aria-labelledby";
  if (innerText && innerText.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim()) return "文本";
  if (/title\s*=\s*"[^"]+"/.test(tagText)) return "title";
  return null;
}
function idOf(tagText){
  const m = /id\s*=\s*"([^"]+)"/.exec(tagText);
  return m ? m[1] : null;
}

/* ---- A. 正 tabindex ---- */
{
  const bad = (MARKUP.match(/tabindex\s*=\s*"(\d+)"/g) || []).filter(t => +/(\d+)/.exec(t)[1] > 0);
  if (bad.length) problems.push("A 出现正的 tabindex（打乱自然 Tab 序）：" + bad.join(", "));
  else okLines.push("  ✓ A 无正 tabindex（0 / -1 放行）");
}

/* ---- B. role=switch 必须带 aria-checked ---- */
{
  const sw = MARKUP.match(/role\s*=\s*"switch"[^>]*/g) || [];
  const bad = sw.filter(s => !/aria-checked\s*=/.test(s));
  if (bad.length) problems.push("B " + bad.length + " 处 role=switch 缺 aria-checked（读屏读不出开关态）");
  else okLines.push("  ✓ B " + sw.length + " 处 role=switch 全带 aria-checked");
}

/* ---- C. img 必须有 alt ---- */
{
  const imgs = openTags("img");
  const bad = imgs.filter(i => !/\balt\s*=/.test(i.tag));
  if (bad.length) problems.push("C " + bad.length + " 个 <img> 缺 alt");
  else okLines.push("  ✓ C " + imgs.length + " 个 <img> 全带 alt" + (imgs.length ? "" : "（当前无 img）"));
}

/* ---- D. 可交互元素必须有可访问名 ---- */
{
  /* button：内文（去 SVG/标签）非空 或 aria-label 等 或 运行期赋名 */
  const btns = [];
  const re = /<button\b[^>]*>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(MARKUP))){
    const open = /^<button\b[^>]*>/.exec(m[0])[0];
    btns.push({ open, inner: m[1] });
  }
  const anon = [];
  for (const b of btns){
    if (staticName(b.open, b.inner)) continue;
    const id = idOf(b.open);
    if (id && RUNTIME_LABELS.has(id)) continue;          // JS 会补名字
    anon.push(id ? "#" + id : b.open.slice(0, 60));
  }
  /* role=button / 带 tabindex 的非 button 元素同样要名字。
     ★ 这里必须把**开标签之后的正文**也读进来：`<div role="button" tabindex="0">基础节奏 · …</div>`
       这类元素的名字就是它的可见文本，只看开标签会把它们全判成匿名
       （本步初版正是在 `#basicSecHead` 上误报——它明明有整句可见文案）。 */
  const others = [];
  {
    const re2 = /<(?!button\b)(\w+)\b[^>]*role\s*=\s*"button"[^>]*>/g;
    let m2;
    while ((m2 = re2.exec(MARKUP))){
      const open = m2[0];
      const after = MARKUP.slice(m2.index + open.length);
      /* 取到第一个 `<`（下一个标签）为止的纯文本 */
      const inner = after.slice(0, (() => { const i = after.indexOf("<"); return i < 0 ? after.length : i; })());
      others.push({ open, inner });
    }
  }
  for (const o of others){
    if (staticName(o.open, o.inner)) continue;
    const id = idOf(o.open);
    if (id && RUNTIME_LABELS.has(id)) continue;
    anon.push(id ? "#" + id : o.open.slice(0, 60) + "（role=button）");
  }
  if (anon.length) problems.push("D " + anon.length + " 个可交互元素没有可访问名："
    + anon.slice(0, 6).join(" / ") + (anon.length > 6 ? " …" : ""));
  else okLines.push("  ✓ D " + btns.length + " 个 button + " + others.length
    + " 个 role=button 全有可访问名（含 " + RUNTIME_LABELS.size + " 个由 JS 运行期赋名）");
}

/* ---- E. aria-hidden 子树里不得有可聚焦元素 ---- */
{
  /* 简化判据：aria-hidden="true" 的元素若**本身**是 button / 带 tabindex>=0 / 是 a[href]，即违规。
     不做整棵子树遍历——本仓的 aria-hidden 多用于网格与图标（都是 div/svg），子树扫描收益低、
     误报高（形如"图标按钮里包了个 aria-hidden 的 svg"这类正确写法会被误伤）。 */
  const hiddenEls = MARKUP.match(/<(button|a|input|select|textarea)\b[^>]*aria-hidden\s*=\s*"true"[^>]*>/g) || [];
  const tabHidden = (MARKUP.match(/<[^>]*tabindex\s*=\s*"0"[^>]*aria-hidden\s*=\s*"true"[^>]*>/g) || []);
  const bad = hiddenEls.concat(tabHidden);
  if (bad.length) problems.push("E " + bad.length + " 个可聚焦元素被标成 aria-hidden（键盘能 Tab 到却看不见）");
  else okLines.push("  ✓ E 无以 aria-hidden 隐藏的可聚焦元素");
}

/* ---- 汇总 ---- */
console.log("  无障碍静态闸门（标记级 · 高置信规则 A–E）");
console.log(okLines.join("\n"));
if (problems.length){
  console.log("  ✗ " + problems.length + " 项无障碍问题：");
  problems.forEach(p => console.log("    - " + p));
  console.log("  修法：补 aria-label / alt，或把 tabindex 改为 0 / -1；");
  console.log("        若名字由 JS 运行期写入，把 `el.setAttribute(\"aria-label\", …)` 写进脚本即可（本步认它）。");
  process.exit(1);
}
console.log("  无障碍检查：通过");
process.exit(0);
