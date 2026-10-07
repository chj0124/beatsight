/* 跨模块「注入槽」装配闸门（v2.8.6，审计 A1，零依赖）
   ---------------------------------------------------------------------------
   由来：v2.8.2 全维度审计 §1.3【A1】指出——本项目 14 个 IIFE 模块（见 tools/check-module-order.js 的 EXPECTED_ORDER）之间存在若干
   **模块级可变注入槽**：`let onXxx = null;`（钩子）与 `let patLenOf = ...`（型长查询）。
   它们由 index.html 末尾的「初始化（装配）」段后期赋值。这套机制本身是**对的**
   （模块之间不能反向引用，理由见 check-module-order.js），但它有一个天然逃过全部
   现有闸门的故障模式：**漏赋值 = 功能静默失效**——点了没反应、跳段行不刷新，
   既不报错，也没有任何读数可查。

   现有闸门为什么都拦不住：
     · check-module-order.js  只查「引用顺序」（谁在谁之前声明），不查「是否被赋值」；
     · check-dom-ids.js       只管 `$("x")` 有没有悬空，与模块级变量无关；
     · tsc                    `let onXxx = null` 的类型标注是 `null`，不赋值完全合法；
     · 测试                   能覆盖到（2412 条断言含 __beat 接口完整性检查），但它是
                              **改了测试才红**——而这条闸门要防的恰恰是「只动装配段、
                              忘了接钩子」这类改动，它通常根本不碰测试。
   而 §A1 的证据是硬的、可实测的：`patLenOf` 的默认实现 `() => DEF_BARS` 在 V8 覆盖率
   的「从未执行的函数」名单里——即它在生产中**恒被覆盖**，却**没有任何检查器保证这一点**。

   两条规则（只读源码文本，不执行任何代码）：

     1) 每个 `let onXxx = null;` 声明的钩子，全文必须至少有一处「赋值为非 null」。
        名字以 `on` + 大写字母开头是本仓库钩子的既定约定（`let onAudibleBar = null;`），
        所以**名单是自动收列的，不需要在这里硬编码一份会腐烂的清单**——新增钩子会被
        自动纳入管辖，这正是它比"维护一张名单"更强的理由。
        ★ 只报「零次赋值」这一种情况：漏赋就是漏赋；"多赋"或"赋得不好"不是本规则要管的
          （本项目宁可窄而准，不做"看起来更全面"的宽规则——宽规则会带来假红，而假红的
          代价本项目自己算过：`eslint.config.js` 里那句"一个常年飘红的检查很快就会被
          所有人无视或直接关掉，等于没写"。同一轮自验链的 §E2 修的正是假红）。

     2) `setPatLenOf(...)` 必须被以有效函数实际调用过。它是"一个型有几小节"的唯一注入点；
        忘了注入不会崩，只会让**段长安静地退回「4 的倍数」**——那正是 v2.5.1 修掉的老毛病
        （《在他乡》当初被从 30 小节垫成 44 小节就是这么来的）。

   ★ 本规则与 index.html 里 patLenOf 默认实现的改动是**一对**（同为 v2.8.6 / §A1）：
     默认值已从「恒 4 的静默谎言」改为「显式抛错」。于是静态这条管「装没装」，
     运行时那条管「没装就别想安静地拿到 4」。两者互为兜底，缺一不可：
     只改运行时 → 漏注入要等到真有人调 secBars 才炸；只加静态 → 静态被绕过（比如
     动态赋值）时仍然静默降级。

   用法：`node tools/check-wiring.js [index.html 路径]`
     ——反向验证：拿一份删掉某条装配赋值的副本喂进来应当退出 1，证明确实拦得住。
   退出码 0 = 装配完整，1 = 有注入槽未装配，4 = 自身故障（找不到 <script> 块；见审计 P1-6）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { extractScript, stripComments, maskStrings } = require("./scan-util");

const ROOT = path.join(__dirname, "..");
const HTML = process.argv[2] || path.join(ROOT, "index.html");

const html = fs.readFileSync(HTML, "utf8");
let script;
try {
  script = extractScript(HTML);
} catch (e){
  console.error("  ✗ " + e.message);
  console.error("  这是**工具故障，不是有未装配的注入槽**——本次未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
}
/* 注释必须先剥掉，否则会**假绿**：本文件里 `onLimitPulse = 到点处置钩子。**为什么用钩子**…`
   这类注释说明文字长得和赋值一模一样，不剥就会把一个从没被赋过值的钩子判成"已装配"。
   这是所有源码正则检查的共同陷阱，与 check-module-order.js 剥注释的理由同源
   （那边是为了不把注释里的 `Controls.stop 调用` 判成反向引用）。 */
/* ★ 行尾必须统一去掉 `\r`（本仓库文件是 CRLF）：JS 正则里 `.` **不匹配** `\r`
   （它是 LineTerminator），所以形如 `…(.*)$` 的写法在 CRLF 行上会整条匹配失败，
   而 `…\s*$` 那种又碰巧能过——同一份代码里两种写法行为不一致，极难排查。
   本文件第一版就踩了这个坑：11 个明明已装配的钩子被全部报成"从未赋值"。 */
const lines = stripComments(script.split("\n")).map(l => l.replace(/\r$/, ""));
/* 字符串字面量再等长遮蔽一层（行号/偏移不变）：否则字面量里的 `onX = fn` 会被当成"已装配"（假绿），
   或字面量里的 `let onX = null;` 会被误收成一个注入槽（假红）。审计 P2-4：原版两个洞都真实存在。 */
const maskedLines = maskStrings(lines.join("\n")).split("\n");
const scriptStartLine = html.slice(0, html.indexOf("<script>")).split("\n").length;
const fileLine = n => n + scriptStartLine - 1;      // 脚本内 1-based 行号 → index.html 绝对行号

console.log("══════════════════════════════════════════════════════════");
console.log("  跨模块注入槽装配（钩子与注入点是否真的被接上）");
console.log("══════════════════════════════════════════════════════════");

const problems = [];
const wiring = [];

/* ---- 自动收列注入槽：`let onXxx = null;`（名字大写开头 = 钩子约定） ----
   ★ 支持一行多声明符（`let onA = null, onB = null;`）：按逗号切分后逐个匹配 `name = null`。
   审计 P2-4：旧版正则锚定整行、只认单个声明符，`let onA = null, onB = null;` 这种写法会
   **两个槽都不收**，从此不受本闸门管辖（静默逃逸）。 */
const DECL_RE = /^\s*let\s+(.+?);?\s*$/;
const DECL_ONE = /^\s*([A-Za-z_$][\w$]*)\s*=\s*null\s*$/;
const slots = [];
maskedLines.forEach((ln, i) => {
  const m = DECL_RE.exec(ln);
  if (!m) return;
  for (const part of m[1].split(",")){
    const dm = DECL_ONE.exec(part);
    if (dm && /^on[A-Z]/.test(dm[1])) slots.push({ name: dm[1], declLine: i + 1 });
  }
});

/* ★ v3.36.7（本轮审计 P1-2）：**重复注入**此前完全在闸门管辖外——旧实现找到第一处赋值就
   `break`，后面的赋值连看都不看。重复注入的典型症状与"漏装配"同类：后一处把前一处**覆盖**，
   先接的那个功能静默失效（而且比漏装配更难查——盘上明明有赋值）。
   静态只看得见"被赋过几次"，看不见"是不是同时"，所以允许登记的槽放行（理由必填，同 R3 白名单纪律）。 */
const REINJECT_OK = {
  onQuotaDone: "听辨额度与候选试听**按场景二选一**注入（前者作答到点、后者试听结束），同一时刻只有一个生效；"
    + "index.html:12930 触发时先摘再调，不留悬挂",
};
/** 收集某个槽的**全部**非 null 赋值行号（脚本内 1-based）。
    ★ RHS 读**原文**（等长遮蔽只用于找位置）：`onX = "字符串"` 这种右值不能被误判成空/复位。 */
function assignLines(name, declIdx){
  const assignRe = new RegExp("(?:^|[^.\\w$])" + name + "\\s*=\\s*(?!=)(.*)$");
  const out = [];
  for (let i = 0; i < lines.length; i++){
    if (i === declIdx) continue;
    const m = assignRe.exec(maskedLines[i]);
    if (!m) continue;
    const base = m.index + m[0].length - m[1].length;
    const rhs = lines[i].slice(base).trim();
    /* 复位成 null = 摘钩子，不算装配。
       ★ 判据必须是 `^null` **词边界**而不是整串相等：本仓有
       `if (onQuotaDone){ const done = onQuotaDone; onQuotaDone = null; done(); }` 这种
       **同一行还有后续语句**的复位（index.html:12930）——整串相等的旧写法会把它当成一次
       "重复注入"，在收集全部赋值之后立刻变成**假红**（旧版找到第一处就 break，所以从没暴露）。 */
    if (!rhs || /^null(?![\w$])/.test(rhs)) continue;
    out.push(i + 1);
  }
  return out;
}

/* v3.31.6（审计 P1-C）：命名约定收列的补充——onXxx 之外还有两个**同构注入槽**，
   名字刻意不叫 on*（见 index.html 各自注释），此前完全在闸门管辖外。
   登记表与 R3 白名单同一条纪律：条目必须真实存在（声明 + 装配齐全），腐烂即报。 */
const EXTRA_SLOTS = ["arrPersistGuard", "customsRef"];
EXTRA_SLOTS.forEach(name => {
  const declRe = new RegExp("^\\s*let\\s+" + name + "\\s*=\\s*(?:/\\*\\* @type \\{[^}]*\\} \\*/\\s*)?\\(?null\\)?;?\\s*$");
  const declIdx = maskedLines.findIndex(ln => declRe.test(ln));
  if (declIdx < 0){
    problems.push("EXTRA_SLOTS 登记「" + name + "」在 index.html 里找不到 `let " + name
      + " = null` 声明——源码已变，请更新或删除本条目");
    return;
  }
  const at = assignLines(name, declIdx);
  if (at.length) wiring.push(name + " 注入于 L" + fileLine(declIdx + 1) + "（EXTRA_SLOTS 登记槽）");
  else problems.push("EXTRA_SLOTS 登记槽「" + name + "」只有声明、从未被赋值——与 on* 钩子同一故障模式（漏装配 = 静默失效）");
});

/* ---- 规则 1：每个钩子必须被赋过非 null 值；被赋多次必须登记理由 ---- */
slots.forEach(slot => {
  /* 左侧不能是标识符/属性的一部分（防 `xonAudibleBar` / `obj.onAudibleBar` 误命中）；
     `(?!=)` 防把 `onXxx == y` / `onXxx === y` 当成赋值。
     ★ v3.36.7：定位逻辑抽到 assignLines()，且**不再 break** —— 取全部赋值行，
       重复注入才有判据（旧实现只认第一处，第 2 处起完全没人看）。 */
  const at = assignLines(slot.name, slot.declLine - 1);
  if (!at.length){
    problems.push("钩子 " + slot.name + "（声明于 L" + fileLine(slot.declLine) + "）全文从未被赋过非 null 值"
      + "——装配层漏了它，对应功能会静默失效（点了没反应 / 不刷新），且不报任何错");
  } else {
    wiring.push(slot.name + " L" + fileLine(slot.declLine) + " → 接于 L" + fileLine(at[0]));
    if (at.length > 1){
      const why = REINJECT_OK[slot.name];
      if (why) wiring.push("    ↳ 被注入 " + at.length + " 次（已登记：" + why + "）");
      else problems.push("钩子 " + slot.name + " 被**重复注入** " + at.length + " 次（L"
        + at.map(n => fileLine(n)).join(" / L") + "）——后一次会覆盖前一次，先接的那个功能静默失效。"
        + "若确为按场景二选一注入，请登记进本文件顶部的 REINJECT_OK 并写明理由");
    }
  }
});

/* ---- 规则 2：patLenOf 注入点必须被实际调用 ---- */
{
  const CALL_RE = /setPatLenOf\s*\(\s*([^)\n]*)\s*\)/;
  let callLine = 0;
  for (let i = 0; i < lines.length; i++){
    const idx = maskedLines[i].indexOf("setPatLenOf");   // 遮蔽后：字符串里的同名调用不算
    if (idx < 0) continue;
    /* 跳过声明行 `function setPatLenOf(fn){ … }`：它有参数，会被上面那条正则当成"调用" */
    if (/\bfunction\s*$/.test(maskedLines[i].slice(0, idx))) continue;
    const m = CALL_RE.exec(maskedLines[i]);
    if (!m) continue;
    const arg = (m[1] || "").trim();
    if (!arg || arg === "null" || arg === "undefined") continue;
    callLine = i + 1;
    break;
  }
  if (!callLine){
    problems.push("setPatLenOf(...) 从未被以有效函数调用——型长查询没有注入点，"
      + "段长会退回「4 的倍数」这个 v2.5.1 之前的错误口径（v2.8.6 起它会显式抛错，不再是静默的假值）");
  } else {
    wiring.push("patLenOf 注入于 L" + fileLine(callLine));
  }
}

console.log("  · 自动收列 " + slots.length + " 个钩子注入槽（约定：`let onXxx = null;`，新增钩子自动纳入）· 登记槽 " + EXTRA_SLOTS.join(" / "));
wiring.forEach(w => console.log("      ✓ " + w));
console.log("──────────────────────────────────────────────────────────");
if (problems.length){
  console.log("  ✗ " + problems.length + " 个注入槽有问题：");
  problems.forEach(p => console.log("      · " + p));
  /* 两类问题的修法完全不同，混成一条会把人引向错误的动作（重复注入去"再补一次赋值"只会更糟） */
  const dup = problems.filter(p => p.indexOf("重复注入") >= 0);
  if (dup.length) console.log("  修法（重复注入）：删掉多余的那次赋值；**只有**「同一槽按场景二选一注入」"
    + "才登记进 REINJECT_OK，并写明为什么不是并发覆盖。");
  if (dup.length < problems.length) console.log("  修法（未装配）：在 index.html 末尾「初始化（装配）」段给该槽补一次赋值"
    + "（例：`onAudibleBar = Arrange.refreshNow;` / `setPatLenOf(ref => patBars(resolveRef(ref)));`）。");
  process.exit(1);
}
console.log("  ✓ 装配完整（" + slots.length + " 个钩子注入槽 + " + EXTRA_SLOTS.length + " 个登记槽 + patLenOf 注入点全部接上）");
process.exit(0);
