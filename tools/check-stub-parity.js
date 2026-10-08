/* 测试桩能力对账（v2.42.2，代码审计第一批 · 步骤 3，零依赖）
   ---------------------------------------------------------------------------
   由来：本仓库同时存在**两份独立实现的 DOM/沙箱桩**——
     · tests/lib/harness.js（完整版：run.js 与全部用例共用）
     · tests/hang-case.js（极简复刻：hang-guard 以子进程跑看门狗用例，必须自带沙箱）
   v2.27.0 实测踩过的坑：格子填充层改用 CSS 变量后，给 harness 的 style 桩补了
   setProperty，**漏了 hang-case**——看门狗整组静默变红。hang-case.js 里的注释
   也白纸黑字记着同一类坑（v2.8.8 的 BEATSIGHT_TEST 标记、v2.4.3 的 options getter）：
   **"改一份漏一份"是这个双子结构的地狱面**，而没有任何闸门在盯它。

   本工具做静态对账：抽取两份文件里 makeEl 的 el 对象**键集合**，按两条规则判：
     ① hang-case 的每个能力（键）必须也在 harness 里 —— hang-case 是极简复刻，
        harness 是完整版；复刻版有的而完整版没有，只可能是"改了复刻版忘了母本"。
     ② harness 独有的能力必须在下方 WHITE_LIST 登记理由 —— 登记制与
        check-module-order.js 的 NON_MODULE_IIFE 同一约定：**多出者要么解释、要么报错**，
        "没见过的差异"一律不放行。白名单本身写清"为什么 hang-case 不需要"，
        日后 hang-case 真用到某项时，把它从白名单挪进 hang-case 就是了。

   另盯一个已文档化的坑：BEATSIGHT_TEST 沙箱标记必须在两份文件里**各自**落位
   （hang-case 是私有沙箱，harness 里的那份覆盖不到它——见 hang-case.js 注释）。

   ★ 行为分叉台账（v3.31.x，落地审计 E8）：键集合对账只能发现"键漏了"，管不住
     "键在、行为不同"——v3.31.4 审计 P0-1（children 是数组 vs 真机 HTMLCollection）
     正是这一族的产物（该坑现由 check-lint 的 no-children-array-method 把守）。
     已知的**刻意分叉**在下方 KNOWN_BEHAVIOR_GAPS 逐条登记：
       · presentIn 正则必须在对应文件命中——登记腐烂（源码变了）即报；
       · absentIn 正则必须**不**在对应文件命中——分叉被收敛时登记失效，同样报。
     与 R3 白名单同一条纪律：台账不是博物馆，两条正则任一失配都意味着"人该看一眼"。

   观察期口径（v2.42.2 落地时定）：发现差异**先打 ⚠ 不阻断**（exit 0），观察两周
   无噪音后再升级为失败（去掉 --warn-only 或加 --strict）。为什么要缓冲：键抽取是
   正则/扫描，第一版可能有误报；假红的代价见 eslint.config.js 文件头。
   ★ 观察期已结束（v3.31.x，落地审计 E2）：本工具现以 --strict 接入 check-all，
     差异按失败处理。

   用法：node tools/check-stub-parity.js [--strict]
     --strict：差异按失败处理（exit 1）。check-all 现恒传 --strict。
   退出码 0 = 对账通过；1 = 有差异（--strict 下）或登记失配；4 = 工具故障
   （文件读不到 / makeEl 或 el 对象定位失败——抽取器失明时宁可报故障，不猜）。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STRICT = process.argv.includes("--strict");
const FILES = [
  { rel: "tests/lib/harness.js", label: "harness（完整版）" },
  { rel: "tests/hang-case.js", label: "hang-case（极简复刻）" },
];

/* harness 独有、且**有意**不在 hang-case 复刻的能力（每项写清理由，挪动要过 review） */
const WHITE_LIST = {
  parentNode: "harness 需要它定位兄弟（insertAdjacentElement 的 afterend 语义）；hang-case 用例不触达兄弟插入",
  inert: "焦点管理字段；hang-case 的脏数据用例不触达",
  /* ★ v3.12.0：`removeChild` 项已删除——v3.9.0 给 hang-case 补了标准 removeChild
     （buildViz 建预备拍道要清空既有子元素），这一项早已不再"harness 独有"，
     留着会被本工具自己报"白名单已失效"。白名单不是历史博物馆。 */
  /* ★ v3.30.0：`insertBefore` / `firstChild` / `lastChild` 三项**同理由删除**——底栏范围
     读数行改挂 .pb-sub 首位（`pbSub.insertBefore(rNote, pbSub.firstChild)`），这三样真实
     DOM 的既有接口 hang-case 用例现在会触达，桩因此补齐（tests/hang-case.js 同批）。
     判据与上条一致：能力一旦被用例触达，就该进桩，而不是继续登记豁免。 */
  insertAdjacentElement: "同 insertBefore，兄弟插入家族（afterend 语义）；hang-case 用例不触达",
  click: "真实 DOM 的 click() 会触发 click 处理器（导出预设 <a download> 靠它）；hang-case 用例不触达",
  /* ★ v3.38.0（P12）：harness 的 textContent 由孤立字段改为**聚合 children**（真实 DOM 语义），
     `_text` 是它的 backing 字段（getter 拼 children、setter 只写这一份）。hang-case 不看
     派生上标的显示，无需复刻这层聚合——登记豁免而非复制语义。 */
  _text: "v3.38.0：harness textContent 聚合 children 的 backing 字段；hang-case 用例不触达显示派生",
};

/* ---- 抽取器：定位 makeEl 内 `const el = {` 的对象字面量，收集**顶层键** ----
   扫描器必须认识字符串 / 模板串 / 注释，否则注释里的 `}` 会切断字面量。 */
function extractKeys(src, rel){
  const mi = src.indexOf("function makeEl(");
  if (mi < 0) return { fault: "找不到 function makeEl(" };
  /* 从 makeEl 开始找 `const el = {`（两份文件都是这个形状；形状变了就报故障，不猜） */
  const ei = src.indexOf("const el = {", mi);
  if (ei < 0 || ei - mi > 8000) return { fault: "makeEl 内找不到 `const el = {`（形状变了？）" };
  let i = ei + "const el = {".length - 1;      // 指向 "{"
  const openLine = src.slice(0, ei).split("\n").length;

  /* 带字符串/注释感知的括号配对 */
  let depth = 0, j = i, q = null;
  for (; j < src.length; j++){
    const c = src[j], d = src[j + 1];
    if (q){
      if (c === "\\"){ j++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "\"" || c === "'" || c === "`"){ q = c; continue; }
    if (c === "/" && d === "/"){ j = src.indexOf("\n", j); if (j < 0) break; continue; }
    if (c === "/" && d === "*"){ j = src.indexOf("*/", j + 2); if (j < 0) break; j++; continue; }
    if (c === "{") depth++;
    else if (c === "}"){ depth--; if (depth === 0) break; }
  }
  if (j >= src.length) return { fault: "el 对象字面量括号不配对" };
  const lit = src.slice(i, j + 1);

  /* 收集顶层键：两段式——读一个键 token，然后跳过它的值（括号/字符串/注释感知），
     到顶层逗号再读下一个。键的形状：identifier / "str"、可选 get/set/async 前缀、
     后接 `:`（属性）或 `(`（方法速记）。 */
  const keys = [];
  let k = 1;
  const END = lit.length - 1;
  const skipWs = () => {
    for (;;){
      while (k < END && /\s/.test(lit[k])) k++;
      if (lit[k] === "/" && lit[k + 1] === "/"){ k = lit.indexOf("\n", k); if (k < 0) k = END; continue; }
      if (lit[k] === "/" && lit[k + 1] === "*"){ const e = lit.indexOf("*/", k + 2); k = e < 0 ? END : e + 2; continue; }
      return;
    }
  };
  const readWord = () => {
    skipWs();
    let w = "";
    if (lit[k] === "\"" || lit[k] === "'"){
      const q = lit[k++];
      while (k < END && lit[k] !== q){ if (lit[k] === "\\") k++; w += lit[k++]; }
      k++; return { w, quoted: true };
    }
    while (k < END && /[\w$]/.test(lit[k])) w += lit[k++];
    return { w, quoted: false };
  };
  /* 跳过一个值：从当前位置到顶层逗号 / 末尾 }（含嵌套与字符串） */
  const skipValue = () => {
    const st = [];
    let q = null;
    while (k < END){
      const c = lit[k], d = lit[k + 1];
      if (q){
        if (c === "\\"){ k += 2; continue; }
        if (c === q) q = null;
        k++; continue;
      }
      if (c === "\"" || c === "'" || c === "`"){ q = c; k++; continue; }
      if (c === "/" && d === "/"){ k = lit.indexOf("\n", k); if (k < 0) break; continue; }
      if (c === "/" && d === "*"){ const e = lit.indexOf("*/", k + 2); k = e < 0 ? END : e + 2; continue; }
      if (c === "(" || c === "[" || c === "{") st.push(c);
      else if (c === ")" || c === "]" || c === "}"){
        if (!st.length) return;                       // 回到顶层 } —— 字面量结束
        st.pop();
        if (!st.length){ k++;                         // 顶层闭合：值可能还有后缀（如 Proxy(...) 后无），继续
          skipWs();
          if (lit[k] === ",") { k++; return; }
          continue;
        }
      }
      else if (c === "," && !st.length){ k++; return; }
      k++;
    }
  };
  while (k < END){
    skipWs();
    if (k >= END || lit[k] === ","){ k++; continue; }
    if (lit[k] === "."){ skipValue(); continue; }     // 展开语法 …x：整段跳过
    const first = readWord();
    if (!first.w){ k++; continue; }
    let key = first.w;
    if (!first.quoted && (key === "get" || key === "set" || key === "async")){
      const second = readWord();
      if (!second.w){ break; }
      key = second.w;
    }
    keys.push(key);
    skipValue();
  }
  /* harness 的 className / innerHTML 走 Object.defineProperty(el, "x", ...)，补扫 makeEl 函数体 */
  const makeEnd = src.indexOf("\nfunction ", mi + 10);
  const body = src.slice(mi, makeEnd > 0 ? makeEnd : undefined);
  for (const m of body.matchAll(/Object\.defineProperty\(\s*el\s*,\s*["']([\w$]+)["']/g)) keys.push(m[1]);
  return { keys: [...new Set(keys)], openLine };
}

/* ---- 主流程 ---- */
console.log("  · 测试桩能力对账（" + FILES.map(f => f.rel).join(" ↔ ") + "）");
const extracted = [];
for (const f of FILES){
  const full = path.join(ROOT, f.rel);
  if (!fs.existsSync(full)){ console.error("  ✗ 读不到 " + f.rel + "（工具故障）"); process.exit(4); }
  const r = extractKeys(fs.readFileSync(full, "utf8"), f.rel);
  if (r.fault){ console.error("  ✗ " + f.label + "：" + r.fault + "（抽取器失明，报故障不猜）"); process.exit(4); }
  extracted.push({ ...f, keys: r.keys });
  console.log("    " + f.label + "：" + r.keys.length + " 个能力键");
}

const [harness, hang] = extracted;
const missingInHarness = hang.keys.filter(k => !harness.keys.includes(k));
const harnessOnly = harness.keys.filter(k => !hang.keys.includes(k));
const unknownOnly = harnessOnly.filter(k => !WHITE_LIST[k]);
const staleWhite = Object.keys(WHITE_LIST).filter(k => !harnessOnly.includes(k));

const issues = [];
missingInHarness.forEach(k => issues.push("hang-case 有「" + k + "」而 harness 没有 —— 复刻版有的完整版必有，这是\"改了复刻忘了母本\"的形状"));
unknownOnly.forEach(k => issues.push("harness 独有「" + k + "」未在 WHITE_LIST 登记 —— 要么 hang-case 补上，要么带着理由进白名单"));
staleWhite.forEach(k => issues.push("WHITE_LIST 里「" + k + "」已失效（harness 不再独有）—— 清掉，白名单不是历史博物馆"));

/* BEATSIGHT_TEST 双落位（已文档化的私有沙箱陷阱，见 hang-case.js v2.8.8 注释） */
for (const f of FILES){
  const body = fs.readFileSync(path.join(ROOT, f.rel), "utf8");
  if (!/\bBEATSIGHT_TEST\s*=\s*true/.test(body))
    issues.push(f.label + " 缺 BEATSIGHT_TEST=true 沙箱标记 —— window.__beat 会是 undefined，"
      + "该文件的全部用例将静默崩掉（v2.8.8 的坑，别重新踩）");
}

/* 行为分叉台账（v3.31.x，落地审计 E8）：
   「键在、行为不同」的已知分叉逐条登记——presentIn 必须命中（防登记腐烂），
   absentIn 必须不命中（分叉收敛时提醒删登记）。为什么登记而不合并：hang-case 是
   看门狗专用极简桩（几何模型、事件副作用都不需要），硬并进 harness 反而给
   死循环用例引入 harness 语义、让"会不会卡死"的判定掺进无关行为。 */
const KNOWN_BEHAVIOR_GAPS = [
  { label: "appendChild 不写 parentNode（hang-case 无链式摘除路径，不需要）",
    presentIn: ["tests/hang-case.js", /appendChild\(c\)/],
    absentIn: ["tests/hang-case.js", /parentNode\s*=/] },
  { label: "offsetWidth/offsetLeft/offsetTop 恒 0（hang-case 无几何模型，几何反解是 run.js 专用）",
    presentIn: ["tests/hang-case.js", /offsetWidth:0,offsetHeight:0,offsetLeft:0,offsetTop:0/],
    absentIn: ["tests/hang-case.js", /get offsetWidth/] },
  { label: "fire() 的 preventDefault/stopPropagation 是空函数（看门狗不验事件副作用）",
    presentIn: ["tests/hang-case.js", /preventDefault\(\)\{\},stopPropagation\(\)\{\}/],
    absentIn: ["tests/lib/harness.js", /preventDefault\(\)\{\},stopPropagation\(\)\{\}/] },
  { label: "classList 存储结构不同（hang `_s` Set vs harness `cls` Set，语义等价）",
    presentIn: ["tests/hang-case.js", /classList:\{_s:new Set/],
    absentIn: ["tests/hang-case.js", /classList:\{cls:/] },
];
{
  const bodies = {};
  for (const f of FILES) bodies[f.rel] = fs.readFileSync(path.join(ROOT, f.rel), "utf8");
  KNOWN_BEHAVIOR_GAPS.forEach(g => {
    const [pr, re] = g.presentIn;
    if (!re.test(bodies[pr]))
      issues.push("行为台账「" + g.label + "」presentIn 失配 —— 源码已变，登记腐烂，请更新或删除本条目");
    const [ar, are] = g.absentIn;
    if (are.test(bodies[ar]))
      issues.push("行为台账「" + g.label + "」absentIn 命中 —— 分叉已收敛，请删除本条目并确认两份桩语义对齐");
  });
}

if (!issues.length){
  console.log("  ✓ 对账通过：hang-case 的能力键全部在 harness 中；harness 独有 "
    + harnessOnly.length + " 项均在白名单（" + harnessOnly.join(" / ") + "）；BEATSIGHT_TEST 双落位");
  process.exit(0);
}
console.log("  ⚠ 桩对账差异 " + issues.length + " 处" + (STRICT ? "" : "（观察期口径：不阻断，两周无噪音后升级 --strict）") + "——");
issues.forEach(x => console.log("      · " + x));
process.exit(STRICT ? 1 : 0);
