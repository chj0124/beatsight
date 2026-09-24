/* 架构约束检查：模块不得反向引用（审计 P1-7，零依赖，正则 + 括号配对，不上 AST）
   ---------------------------------------------------------------------------
   背景：`index.html` 头部注释里写着「模块间只通过对方暴露的接口通信……任何模块不得反向引用
   后方模块」，但这条规则**只存在于注释里**，没有任何机器检查。而实测已有若干例外且都能正常
   工作——说明规则的字面表述与实现不符，需要先精确化，再机器校验。

   精确化后的三条不变量（本文件逐条检查）：

     R1（强约束，零例外）：IIFE **求值期**不得引用后方模块。
        这才是真会产生初始化顺序错误（TDZ）的场景，也是 v1.0.0 消除 Viz→Presets 的真实动机。
        实现（v2.8.17，审计 P1-5）：该引用**不在任何函数体内**。旧判据是「括号深度 == 模块体
        深度」——它把「IIFE 顶层 if/catch 块内」的语句（深度 bodyDepth+1）误归 R3，而 R3 是
        可以登记白名单放行的；但这类语句同样在 IIFE 求值期执行、有真实 TDZ 风险，R1「零例外」
        被一层块缩进绕过。新判据只认「函数体」才算运行时：块（if/for/while/switch/catch/
        对象字面量/class 体）不是函数，其内语句仍算 R1。

     R2（强约束，零例外）：**每帧渲染热路径**（paintFrame / paintFrameBody / paintBall）
        体内不得出现「后方模块名 + .」——它们每秒执行约 60 次，只能读共享状态区与前方模块。
        （注：审计报告原文把 scheduler 也划进 R2，但同一份报告又称表里的 AudioEngine→Trainer
         属于"合法的运行时调用"——而该调用就在 scheduler 体内，自相矛盾。
         这里按实际语义修正：scheduler 是**周期回调**（25ms 一次，跨模块调用只发生在小节边界，
         约每 1–2 秒一次），归入 R3；真正的每帧热路径只有上面三个渲染函数。）

     R3（弱约束，允许白名单）：运行时回调（事件处理器、setInterval 周期、停止流程等）
        可以调用后方模块——那时所有 const 早已初始化完毕。但必须在下方 WHITELIST 登记并写明
        理由；条目一旦不再被用到也会报错（防止白名单慢慢腐烂成"什么都放行"）。

     R4（扇出上限，告警）：一个模块直接引用的**下游模块个数**（扇出）不得超过 MAX_FANOUT。
        它是"某模块会不会膨胀成上帝对象"的最直接指标。曾经 Controls（UI 中枢）顶到上限 7；
        v2.18.0 把那四条同形的"叠加层键盘路由"收敛成注册表后降到 2，余量回到 5。
        真顶格时的第一反应应当是"**这几条引用是不是同一件事被抄了多遍**"，而不是抬高常量。

   ✅ 已修（v2.8.8，本轮审计「高」级项）：R1/R2 的"在哪一层"判定已由**缩进**换成**括号深度**
   （先 blankNonCode 抹掉注释与字符串内容，再逐字符数 `{`/`}`），与缩进、换行、是否格式化
   完全无关。**`index.html` 自此可以用 prettier / 格式化器了**——DEVELOPMENT.md §5 的禁令已解除。
   旧实现把架构闸门押在"永不格式化"这条约定上，是典型的形式依赖结构；现在依赖的是结构本身。
   保留一条不变的自检：整段脚本跑完深度必须回到 0，否则报错退出（宁可报错，不可给假结论）。

   退出码 0 = 全部通过，1 = 有违规，4 = 自身故障（找不到 <script> 块 / 括号配对失败 / 深度自检失败）。
   自身故障用 4 而非 1/2（v2.8.14，审计 P1-6）：与 tools/check-all.js 的 TOOL_FAIL_CODE 统一，
   故障据此记成「工具故障 · 未被验证」而非「检查未通过」，也不中止后续步骤。CI 与本地自验都跑它。 */
"use strict";
const fs = require("fs");
const path = require("path");
/* 剥注释 / 括号配对 / 行号换算统一复用 scan-util（v2.4.4 起不再各写一份；
   此前本文件内嵌的三份私有实现与 scan-util 语义逐字相同，属复制粘贴债）。 */
const { stripComments, matchBrace, lineOf, blankNonCode, braceDepths } = require("./scan-util");

const HTML = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error("未找到 <script> 块：" + HTML); process.exit(4); }
const SRC = m[1];
const lines = SRC.split("\n");

const clean = stripComments(lines);

/* 模块的**声明顺序**：必须与这份约定一致——顺序本身就是架构约定，不是随便排的 */
const EXPECTED_ORDER = ["Store", "Modal", "Viz", "AudioEngine", "Trainer", "Controls", "Presets", "Editor", "Settings", "Ear", "Arrange", "Help", "KeepAlive"];

/* 正则 `^const X = (() => {` 还会命中的**非架构模块** IIFE（目前仅初始化段的 diagOn：
   调试开关求值，不参与模块间通信，故不进 EXPECTED_ORDER）。第 0 步的「双向 diff」要求：
   正则命中的每个名字要么属于 EXPECTED_ORDER、要么在此显式登记并写明理由；二者之外
   的**多出者一律报错**——这正是 P0-2 要堵的口子：旧实现把不认识的模块直接 continue 掉，
   检查器对"没见过的新模块"完全失明，它带 TDZ 风险也能全绿通过。 */
const NON_MODULE_IIFE = ["diagOn"];

/* R3 白名单：运行时回调对后方模块的合法调用。
   每条都要写明「为什么这里调后方模块是安全的」——安全是因为调用发生在运行时，
   而不是因为"反正能跑"。 */
const WHITELIST = [
  { from: "AudioEngine",    to: "Trainer",  reason: "scheduler() 在小节边界调 Trainer.onBarBoundary()——周期回调，非每帧热路径" },
  { from: "AudioEngine",    to: "Presets",  reason: "scheduler() 在小节边界调 Presets.consumePending() 消费挂起的节奏型切换——同上，每小节一次" },
  { from: "Trainer",  to: "Controls", reason: "训练到目标时调 Controls.stop()/setBpm()/syncBpmUI()——由调度周期或事件触发" },
  { from: "Controls", to: "Presets",  reason: "stop() 调 Presets.flushPending() 落定挂起切换——停止流程中执行" },
  /* ★ v2.18.0：原 `Controls → Editor / Settings / Ear / Arrange / Help` 五条**已删除**。
     它们是"某个叠加层开着就吞键、Escape 关掉它"这套同形逻辑的重复展开，曾把 Controls 的
     扇出顶到上限（7）。现改由共享状态区的 `KEY_LAYERS` 注册表承载：**各叠加层模块在自己体内
     登记**，Controls 只 `for (const layer of KEY_LAYERS) if (layer.handles(e)) return;` 一次 ——
     它读的是共享状态、不再引用后方模块，故这五条白名单随之失效（闸门会自己报"应删除"，已删）。 */
  { from: "Controls", to: "KeepAlive", reason: "v1.4：start()/stop() 末尾调 KeepAlive.sync() 同步保活——播放状态迁移时执行" },
  /* ★ v2.10.12：**没有** `Settings → Help` 这一条——设置弹窗里的「使用方法」按钮，
     其点击 handler 仍在 `Help` 模块里（按 id `#helpBtn` 绑定，元素搬进设置弹窗后照旧生效）。
     搬家式改动**只搬元素、不搬接线**，就不会产生新的反向引用（教训见 T90 的注释） */
];

/* R4 扇出上限：一个模块**直接引用的下游模块个数**上限。留 7 不动 —— 它是"中枢又胖一圈"
   的可见化闸门，不是"当前用量的记录"。
   ★ v2.18.0 复核：**Controls 已从 7 降到 2**（只剩 Presets + KeepAlive）——
     原来顶到 7 的五条里有四条（Settings/Ear/Arrange/Help）是同一套"叠加层键盘路由"的重复展开，
     已改由共享状态区的 `KEY_LAYERS` 注册表承载（各模块自己登记）。余量回到 5。
   ★ 教训：顶格不该靠"抬高常量"解决，该先看**那几条引用是不是同一件事被抄了多遍** ——
     本例抄了四遍，收敛成一个注册表之后，新增叠加层连 Controls 都不用碰。 */
const MAX_FANOUT = 7;

/* ---- 嵌套深度（v2.8.8 起由缩进改为括号深度）----
   历史上 R1/R2 都要回答"这条语句在哪个嵌套层"，两种答案来源：
     · 缩进（更旧）：「IIFE 顶层 = 恰好 2 空格缩进」——**格式约定**，不是结构事实。
       代价是 index.html 被禁止过任何格式化器（prettier 一次全文件重排就会让判定面静默失效）。
     · 括号深度（v2.8.8）：先 blankNonCode 抹掉注释与字符串内容，再逐字符数 `{` / `}`。
       **结构事实**，与缩进、换行、是否格式化完全无关。
   换用深度后那条禁令解除：docs/DEVELOPMENT.md §5 已同步改为"可以格式化了"。
   分工现状：R1 自 v2.8.17 起改按**函数体深度**判定（见下），R2 按热路径**行区间**判定；
   这里保留的括号深度 depths 仍供下面那条**深度自检**用——它保证 blankNonCode 没漏写法。
   ⚠ 自检：整段脚本跑完深度必须回到 0。回不去说明 blankNonCode 漏掉了某种写法
     （例如正则字面量里写了不配对的花括号），此时深度全部不可信 —— 宁可报错退出，
     也不能让一个错位的深度表继续产出结论（这与 check-lint.js 的"括号必须配平"自检同源）。 */
const bare = blankNonCode(SRC);
const depths = braceDepths(bare);
if (depths[depths.length - 1] !== 0){
  console.error("嵌套深度自检失败：整段脚本跑完深度为 " + depths[depths.length - 1] + "（应为 0）——"
    + "多半是出现了 blankNonCode 未处理的写法，请先看 tools/scan-util.js 的 blankNonCode。\n"
    + "拒绝带着错位的深度表继续判定（宁可报错，不可给出假结论）。");
  process.exit(4);
}

/* ---- 函数体深度（v2.8.17，审计 P1-5）----
   R1 的判据是「该引用**不在任何函数体内**」——块（if/for/while/switch/catch/对象字面量/
   class 体）不是函数体，其内语句仍在 IIFE 求值期执行、有真实 TDZ 风险，必须按 R1 零例外。
   做法：先给每个 `{` 打「是不是函数体」的标记，再逐字符累计 funcDepth[i] = 位置 i 之前
   已打开的**函数体**括号个数。判定时把「引用所在行的 funcDepth」与「模块体基线 funcBase」
   比较：相等 = 不在任何函数内（含顶层 if/for 块内）→ R1；更深 = 在函数/回调内 → R3。
   为什么用「整行第一个代码字符」而不用 hits 的行内 index 定位：那是**剥注释后的行**下标，
   与 SRC 绝对偏移不同源（R2 行区间判定里踩过同一个坑，见下），故沿用与 bodyDepth 时代
   一致的整行口径。 */
const parenMatch = new Int32Array(bare.length).fill(-1);
{
  const st = [];
  for (let i = 0; i < bare.length; i++){
    if (bare[i] === "(") st.push(i);
    else if (bare[i] === ")"){ const o = st.pop(); if (o !== undefined){ parenMatch[i] = o; parenMatch[o] = i; } }
  }
}
const CTRL_KW = ["if", "for", "while", "switch", "catch", "with"];
/* `{` 是否为**函数体**（prevSig = 它前面最近的非空白字符下标）：
     · 前面是 `>` 且再前是 `=`（箭头 `=>`）→ 是；
     · 前面是 `)` 时，回看配对 `(` 之前的标识符：控制流关键字（if/for/…）→ 否，
       其余（`function` / 函数名 / 方法名 / `catch` 之外的调用形）→ 是；
     · 其余（`try {` / `else {` / `do {` / 对象或 class 体 / 静态块）→ 否（按块算，属求值期）。 */
function isFuncBrace(prevSig){
  if (prevSig < 0) return false;
  if (bare[prevSig] === ">"){
    let e = prevSig - 1;
    while (e >= 0 && /\s/.test(bare[e])) e--;
    return bare[e] === "=";
  }
  if (bare[prevSig] === ")"){
    const o = parenMatch[prevSig];
    if (o < 0) return false;
    let r = o - 1;
    while (r >= 0 && /\s/.test(bare[r])) r--;
    if (r < 0) return false;
    let s = r;
    while (s >= 0 && /[A-Za-z0-9_$]/.test(bare[s])) s--;
    return !CTRL_KW.includes(bare.slice(s + 1, r + 1));
  }
  return false;
}
const funcDepth = new Int32Array(bare.length + 1);
{
  const st = [];
  let fd = 0, prevSig = -1;
  for (let i = 0; i < bare.length; i++){
    const c = bare[i];
    if (/\s/.test(c)){ funcDepth[i] = fd; continue; }
    if (c === "{"){
      funcDepth[i] = fd;
      const isF = isFuncBrace(prevSig);
      st.push(isF);
      if (isF) fd++;
    } else if (c === "}"){
      if (st.pop()) fd--;
      funcDepth[i] = fd;
    } else {
      funcDepth[i] = fd;
    }
    prevSig = i;
  }
  funcDepth[bare.length] = fd;
}

/* 收集模块块：`const Name = (() => {` … 配对的 `}`。
   v2.8.12（P0-2）：正则命中的**全部**名字都记进 matchedNames，供第 0 步做双向 diff；
   只有 EXPECTED_ORDER 里的才是架构模块、进入 modules 参与 R1–R4 判定。 */
const modules = [];
const matchedNames = [];
{
  const re = /^const (\w+) = \(\(\) => \{/gm;
  let mm;
  while ((mm = re.exec(SRC))){
    const name = mm[1];
    matchedNames.push({ name, line: lineOf(SRC, mm.index) });
    if (!EXPECTED_ORDER.includes(name)) continue;      // 非模块：留给第 0 步的双向 diff 报错/登记
    const end = matchBrace(SRC, mm.index);
    if (end < 0){ console.error("括号配对失败：" + name); process.exit(4); }
    /* 模块体基线：`const Name = (() => {` 那个 `{` 之后一层的**函数体深度**。
       模块体本身也是箭头函数体，故求值期基线为 funcBase；引用处 funcDepth == funcBase
       = 不在任何函数体内（含顶层 if/for/catch 块内、对象/class 字面量内）= IIFE 求值期
       就会执行（R1 的判据）；更深 = 在某个 function / 回调体内 = 运行时才走到（R3）。 */
    const open = SRC.indexOf("{", mm.index);
    const funcBase = funcDepth[open + 1];
    modules.push({ name, start: mm.index, end, startLine: lineOf(SRC, mm.index), endLine: lineOf(SRC, end), funcBase });
  }
}
modules.sort((a, b) => a.start - b.start);

let failed = false;
const fail = msg => { failed = true; console.log("  ✗ " + msg); };
const pass = msg => console.log("  ✓ " + msg);

console.log("══════════════════════════════════════════════════════════");
console.log("  架构约束 · 模块不得反向引用（" + path.relative(process.cwd(), HTML) + "）");
console.log("══════════════════════════════════════════════════════════");

/* 0) 声明顺序必须与约定一致；且正则命中的模块名集合与 EXPECTED_ORDER **双向 diff**：
      · 命中但既不在 EXPECTED_ORDER、也不在 NON_MODULE_IIFE 的 → 新模块逃逸，报错；
      · NON_MODULE_IIFE 里登记了、代码里却没命中 → 登记腐烂，报错。
   P0-2：旧实现在收集循环里 `continue` 掉不认识的名字，检查器对「没见过的新模块」完全失明——
   新模块即便带 TDZ 风险也能全绿通过。此处的双向 diff 正是要堵这个口子
   （与 gen-index「只报错不猜」同约定）。 */
{
  const got = modules.map(x => x.name);
  if (got.join(",") !== EXPECTED_ORDER.join(",")){
    fail("模块声明顺序与约定不符\n      约定：" + EXPECTED_ORDER.join(" → ") + "\n      实际：" + got.join(" → "));
  } else {
    pass("声明顺序符合约定：" + got.join(" → "));
  }

  const stray = matchedNames.filter(x => !EXPECTED_ORDER.includes(x.name) && !NON_MODULE_IIFE.includes(x.name));
  if (stray.length){
    stray.forEach(x => fail(`新模块逃逸：${x.name}(L${x.line}) 命中「const X = (() => {」但既不在 EXPECTED_ORDER、也不在 NON_MODULE_IIFE\n        若它是架构模块，请加入 EXPECTED_ORDER 并调整声明顺序；若是非模块 IIFE，请登记进 NON_MODULE_IIFE 并写明理由`));
  } else {
    pass("正则命中的模块名集合与 EXPECTED_ORDER 双向一致（无非模块逃逸）");
  }

  const staleNonModule = NON_MODULE_IIFE.filter(n => !matchedNames.some(x => x.name === n));
  if (staleNonModule.length){
    fail(`NON_MODULE_IIFE 登记已失效（代码里不再出现，应删除）：${staleNonModule.join(" / ")}`);
  }
}

const order = {};
modules.forEach((mod, i) => { order[mod.name] = i; });

/* 热路径函数体（R2）。
   v2.4.4：paintFrameBody 拆出的两个子工序（paintBeatFlash / repaintCells）同样逐帧执行，
   必须一并登记——否则拆分会**静默缩小 R2 的覆盖面**（检查器只认这个名单里的函数体）。
   教训写在这里：往帧路径上抽 helper 时，helper 的名字必须进这份名单。 */
const HOT = ["paintFrame", "paintFrameBody", "paintBall", "paintBeatFlash", "repaintCells"];
const hotRanges = [];
HOT.forEach(fn => {
  const idx = SRC.search(new RegExp("function\\s+" + fn + "\\s*\\("));
  if (idx < 0){ fail("未找到热路径函数 " + fn + "()——检查器可能已失效，需同步更新"); return; }
  const end = matchBrace(SRC, idx);
  if (end < 0){ fail("热路径函数 " + fn + "() 括号配对失败"); return; }
  /* v2.8.8：热路径归属改按**行区间**判定，不再按字符偏移。
     旧写法是 `lineStartOf[行] + hit.index`，而 hit.index 是**剥过注释的行**里的下标、
     lineStartOf 却是**原始行**的起点——两者不同源，算出来的偏移会系统性偏小
     （剥掉的注释越长、偏得越多），于是 R2 可能把真命中判成"不在热路径里"（假阴性）。
     按行区间判定与"是否需要偏移"彻底解耦：区间是闭的、只会更保守，不会漏报。 */
  hotRanges.push({ fn, from: lineOf(SRC, idx), to: lineOf(SRC, end) });
});
pass("已定位 " + hotRanges.length + "/" + HOT.length + " 个热路径函数体：" + HOT.join(" / "));

/* 逐行扫描所有「后方模块名 + .」引用，按归属分类 */
const r1Hits = [], r2Hits = [], r3Hits = [];
let lineStart = 0;
const lineStartOf = [];
for (let i = 0; i < lines.length; i++){ lineStartOf[i] = lineStart; lineStart += lines[i].length + 1; }

modules.forEach((mod, mi) => {
  for (let ln = mod.startLine; ln <= mod.endLine; ln++){
    const text = clean[ln - 1] || "";
    const inHot = hotRanges.some(r => ln >= r.from && ln <= r.to);
    modules.forEach((other, oi) => {
      if (oi <= mi) return;                                   // 只查"后方"
      const hit = new RegExp("\\b" + other.name + "\\s*\\.").exec(text);
      if (!hit) return;
      const rec = { from: mod.name, to: other.name, line: ln, code: (lines[ln - 1] || "").trim() };
      if (inHot) r2Hits.push(rec);
      /* R1 判据（v2.8.17，审计 P1-5）：这一行的第一个代码字符处**不在任何函数体内**。
         函数体深度 == 模块体基线 → 语句在 IIFE 求值期执行（顶层语句、顶层 if/for/catch
         块内、对象/class 字面量内都算）→ TDZ 风险区，按 R1 零例外处理；
         更深 → 在某个 function / 回调体内 → 运行时才走到 → R3 范畴。
         （旧判据只看「括号深度 == 模块体深度」，把 IIFE 顶层块内语句误归 R3、可白名单放行。） */
      else if (funcDepthOfLine(ln) === mod.funcBase) r1Hits.push(rec);
      else r3Hits.push(rec);
    });
  }
});

/* 一行代码所在的**函数体深度** = 该行**第一个非空白字符**处的 funcDepth。
   取第一个非空字符而不是行首：行首的缩进空白本身不带信息，而形如
   `  } catch (e){ Modal.x() }` 这种一行里既有收尾又有起始的写法，判"这段语句在哪一层"
   应当以第一个代码字符为准。 */
function funcDepthOfLine(ln){
  const raw = bare.slice(lineStartOf[ln - 1], lineStartOf[ln - 1] + (lines[ln - 1] || "").length);
  let i = 0;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  return funcDepth[lineStartOf[ln - 1] + i];
}

if (r1Hits.length){
  r1Hits.forEach(h => fail(`R1 初始化期反向引用：${h.from}(L${h.line}) → ${h.to}  「${h.code}」`));
} else pass("R1 IIFE 顶层执行期零反向引用（TDZ 风险为零）");

if (r2Hits.length){
  r2Hits.forEach(h => fail(`R2 每帧热路径反向引用：${h.from}(L${h.line}) → ${h.to}  「${h.code}」`));
} else pass("R2 每帧热路径（" + HOT.join("/") + "）体内零反向引用");

{
  const used = new Map();
  const unexpected = [];
  r3Hits.forEach(h => {
    const key = h.from + "→" + h.to;
    if (!WHITELIST.some(w => w.from === h.from && w.to === h.to)) unexpected.push(h);
    used.set(key, (used.get(key) || 0) + 1);
  });
  if (unexpected.length){
    unexpected.forEach(h => fail(`R3 未登记的反向引用：${h.from}(L${h.line}) → ${h.to}  「${h.code}」\n        若确认是运行时回调（非初始化期、非每帧热路径），请加进 tools/check-module-order.js 的 WHITELIST 并写明理由`));
  } else {
    pass("R3 运行时回调反向引用全部在白名单内：" +
      WHITELIST.map(w => `${w.from}→${w.to} ×${used.get(w.from + "→" + w.to) || 0}`).join("  ·  "));
    WHITELIST.forEach(w => {
      if (!used.get(w.from + "→" + w.to)){
        failed = true;
        console.log(`  ✗ R3 白名单条目已失效（代码里不再出现，应删除）：${w.from}→${w.to}`);
      }
    });
    WHITELIST.forEach(w => console.log(`      · ${w.from} → ${w.to}：${w.reason}`));
  }
}

/* R4 扇出上限（告警）：统计每个模块**直接引用**的下游模块个数（distinct to），超限即告警 */
{
  const fanout = new Map();
  [...r1Hits, ...r2Hits, ...r3Hits].forEach(h => {
    if (!fanout.has(h.from)) fanout.set(h.from, new Set());
    fanout.get(h.from).add(h.to);
  });
  const over = [];
  modules.forEach(mod => {
    const outs = fanout.get(mod.name) || new Set();
    if (outs.size > MAX_FANOUT) over.push({ name: mod.name, outs: [...outs] });
  });
  const summary = [...fanout.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([name, set]) => `${name}×${set.size}`)
    .join("  ·  ");
  if (over.length){
    over.forEach(o => fail(`R4 扇出超限：${o.name} 直接引用 ${o.outs.length} 个下游模块（上限 ${MAX_FANOUT}）：${o.outs.join(" / ")}\n        新功能的 UI 装配请内聚到各自模块内部，Controls 只做事件转发；确需抬高时显式改大 MAX_FANOUT 并写明理由`));
  } else {
    pass(`R4 模块扇出均在上限内（MAX_FANOUT=${MAX_FANOUT}）：${summary}`);
  }
}

console.log("──────────────────────────────────────────────────────────");
console.log(failed ? "  架构约束检查：失败" : "  架构约束检查：通过");
process.exit(failed ? 1 : 0);
