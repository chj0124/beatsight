/* CSS 孤儿扫描（v2.58.0，审计 T3 · 技术基建，零依赖）
   ---------------------------------------------------------------------------
   由来：审计 T3 指出主文件的历史样式可能「静默膨胀」——某次重构删了元素却忘了删对应的
   .class 规则，死样式就一直赖在 1.2MB 单文件里。本工具做**静态孤儿对账**：

     · 抽取 <style> 里所有「类选择器」（.foo），与「实际被用到的类名」做差集；
     · 「被用到」的来源 = HTML 的 class="..." 属性 + JS 里的 classList.add/remove/toggle、
       className = / +=、setAttribute("class", ...) 的参数；
     · 差集即「疑似孤儿」。

   ★ 口径铁律（v2.58.0 立）：先警告不阻断（exit 0）。原因：本项目大量 class 是 JS 运行时
     拼出来的（如 `"arg-pill-" + kind`、模板字符串里的条件 class），静态扫描必然漏判 →
     直接判红会制造大量假红（见 check-node-budget.js 头注释对假红的零容忍态度）。

   ★★ **观察期已结束（v3.33.14，审计 P3-4）**：`check-all.js` 现以 `--strict` 接入。
     结束的依据是实测而非感觉：v3.33.14 把"被用到"的来源扩到**动态拼接的字符串字面量**
     （详见第 2 步那段注释）后，孤儿数由 **26 → 0**；而这 26 条在扩口径前已逐个核实过，
     **全部**是 `.rest` / `.ghost` / `.kB` / `.rh-b` 这类拼接产物的假阳性。
     含义要说清：这条闸门自 v2.58.0 落地起一直是**零有效信号**——26 条噪音里没有一条真死样式，
     于是 T3 审计想解决的"样式静默膨胀"实际无人把守。现在它才第一次真正长牙。
     ★ 残余的假阴（真死样式但名字恰好出现在某段字符串里）**仍会漏**，这是静态扫描的固有上限；
       漏判只会让死样式继续躺着，不会制造假红——与设计取舍一致。

   用法：node tools/check-orphan-css.js [html路径] [--strict]
   退出码 0 = 对账完成（无孤儿，或观察期内的 ⚠）；1 = --strict 下仍有孤儿；4 = 工具故障。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(ROOT, "index.html");
const STRICT = process.argv.includes("--strict");

if (!fs.existsSync(HTML)){ console.error("未找到主文件：" + HTML); process.exit(4); }
const src = fs.readFileSync(HTML, "utf8");

/* ---- 1) 抽取 CSS 里的类选择器 ----
   ★ v3.31.8：抽取前先剥掉 CSS 注释——旧口径对整段 <style> 抽 token，注释里的
   `el.style.transform` / `cell.style.setProperty("--f")` / 版本号 `v3.8.x` /
   `tools/smoke.js` / `y1..y1+7` 都会被抓成"疑似孤儿"（实测 68 个里 46 个纯注释
   假阳性、零字节）。剥注释后剩下的才是真选择器（其中动态拼接的仍会进差集，
   这是本工具观察期的既定口径）。 */
const cssText = (src.match(/<style>([\s\S]*?)<\/style>/g) || []).map(b => b.replace(/<\/?style>/g, "")).join("\n");
const cssNoComment = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
const cssClasses = new Set();
const cssRe = /\.([a-zA-Z][\w-]*)/g;
let m;
while ((m = cssRe.exec(cssNoComment))){ cssClasses.add(m[1]); }

/* ---- 2) 抽取「被用到的」类名 ---- */
const used = new Set();
// HTML class="..."
for (const mm of src.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)){
  mm[1].split(/\s+/).forEach(c => { if (c) used.add(c); });
}
// JS：classList.add/remove/toggle("x")、className = / += "x"、setAttribute("class", "x")
for (const mm of src.matchAll(/\bclassList\.(?:add|remove|toggle|contains)\(\s*["']([^"']+)["']/g)){ mm[1].split(/\s+/).forEach(c => used.add(c)); }
for (const mm of src.matchAll(/\bclassName\s*(\+=|\=)\s*["']([^"']*)["']/g)){ mm[2].split(/\s+/).forEach(c => used.add(c)); }
for (const mm of src.matchAll(/setAttribute\(\s*["']class["']\s*,\s*["']([^"']*)["']/g)){ mm[1].split(/\s+/).forEach(c => used.add(c)); }
/* ★ v3.33.14（审计 P3-4）：补「动态拼出来的类名」这个主要来源。
   上面三条只认**字面量直接给**的写法，而本项目 class 大量走拼接 / 三元 / helper 传参：
     · `cls += " rest"`                        （L6823 休止格）
     · `+ (s.rest ? " ghost" : "")`            （L4838 空扫虚影）
     · `const kz = z === 0 ? "kB" : …`         （L8306 弦区箭头，随后拼进 className）
     · `put("rh-b", …)`                        （L12937 记谱符号，helper 内部再拼进类名）
   结果是：26 条"疑似孤儿"**逐条核实后全是假阳性**，真死样式混在里面没人清——
   这条闸门自 v2.58.0 落地起就**零有效信号**（T3 审计想解决的"样式静默膨胀"实际无人把守）。
   做法：把内联脚本**剥注释后**扫所有字符串字面量，切成 token，**只收下本来就在 CSS 类集合里
   的那些**——即"疑似命中的才记账"，不把无关词灌进 used（否则这个集合本身也没意义了）。
   ★ 先剥注释（stripComments）：注释里写着的 `.cell.rest` 之类若被算作"在用"，
     死样式就永远查不出来了——与 check-module-order 的 R1 判据踩过的是同一个坑。 */
{
  const { stripComments } = require("./scan-util");
  const sm = src.match(/<script>([\s\S]*?)<\/script>/);
  const jsSrc = sm ? stripComments(sm[1].split("\n")).join("\n") : "";
  /* 只取同行、不含引号的短片段：类名不会跨行，也不会含引号；80 上限防止误吞长文本。
     ★ 内容长度必须允许 **0**：这个扫描靠"两两配对"切字面量，而代码里到处是 `""` 空串
       （`(ok ? "" : " bad")`）。第一版写了 {1,80}，于是遇到 `""` 时配对**整体错位一格**，
       后面真正的类名反而取不到——实测 .sq-r / .editing 就是这样漏下来的（26 → 2 → 0）。
       允许 0 长度即可让空串自己吃掉一次配对，对齐保持正确。 */
  for (const mm of jsSrc.matchAll(/["'`]([^"'`\n]{0,80})["'`]/g)){
    for (const tok of mm[1].split(/\s+/)){
      const c = tok.replace(/[^A-Za-z0-9_-]/g, "");
      if (c && cssClasses.has(c)) used.add(c);
    }
  }
}

/* ---- 3) 差集 = 疑似孤儿 ---- */
const orphans = [...cssClasses].filter(c => !used.has(c)).sort();
// 过滤掉「显然不是 class 选择器」的误抓：CSS 里 .5 这种已被 [a-zA-Z] 前缀挡掉；
// 剩下的若同时也出现在 used 的动态前缀里（如 arg-pill 是 arg-pill-play 的前缀）也算在用——
// 这里做前缀兜底：若某 used 类以 orphan+'-' 开头，则 orphan 视为「动态前缀基」，不算孤儿。
const usedArr = [...used];
const realOrphans = orphans.filter(o => !usedArr.some(u => u.startsWith(o + "-") || u === o));

console.log("══════════════════════════════════════════════");
console.log("  CSS 孤儿扫描（观察期 · 默认只警告不阻断）");
console.log("══════════════════════════════════════════════");
console.log("  · CSS 类选择器：" + cssClasses.size + " 个 · 被用到的类名：" + used.size + " 个");
if (!realOrphans.length){
  console.log("  ✓ 未发现孤儿 class（或均属动态前缀基，已在运行期拼出）");
  process.exit(0);
}
console.log("  ⚠ 疑似孤儿 class（" + realOrphans.length + " 个，确认删除前先核对动态拼法）：");
realOrphans.forEach(o => console.log("    - ." + o));
console.log("  处置：确属死样式 → 连同对应规则一起删；若运行期动态拼出 → 把它加进 used 或放宽本扫描。");
process.exit(STRICT ? 1 : 0);
