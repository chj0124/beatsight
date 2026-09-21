/* 架构约束检查：模块不得反向引用（审计 P1-7，零依赖，正则 + 括号配对，不上 AST）
   ---------------------------------------------------------------------------
   背景：`index.html` 头部注释里写着「模块间只通过对方暴露的接口通信……任何模块不得反向引用
   后方模块」，但这条规则**只存在于注释里**，没有任何机器检查。而实测已有若干例外且都能正常
   工作——说明规则的字面表述与实现不符，需要先精确化，再机器校验。

   精确化后的三条不变量（本文件逐条检查）：

     R1（强约束，零例外）：IIFE **顶层执行期**不得引用后方模块。
        这才是真会产生初始化顺序错误（TDZ）的场景，也是 v1.0.0 消除 Viz→Presets 的真实动机。
        实现：模块体内**恰好 2 空格缩进**的语句就是 IIFE 顶层语句。

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
        它是"某模块会不会膨胀成上帝对象"的最直接指标。Controls 是 UI 中枢、当前已顶到上限
        （指向它全部的 7 个下游），再想加一条就必须显式抬高下方 MAX_FANOUT 常量——让"中枢又
        胖了一圈"成为一次看得见、需要理由的改动，而不是悄悄发生。

   ✅ 已修（v2.8.8，本轮审计「高」级项）：R1/R2 的"在哪一层"判定已由**缩进**换成**括号深度**
   （先 blankNonCode 抹掉注释与字符串内容，再逐字符数 `{`/`}`），与缩进、换行、是否格式化
   完全无关。**`index.html` 自此可以用 prettier / 格式化器了**——DEVELOPMENT.md §5 的禁令已解除。
   旧实现把架构闸门押在"永不格式化"这条约定上，是典型的形式依赖结构；现在依赖的是结构本身。
   保留一条不变的自检：整段脚本跑完深度必须回到 0，否则报错退出（宁可报错，不可给假结论）。

   退出码 0 = 全部通过，1 = 有违规。CI 与本地自验都跑它。 */
"use strict";
const fs = require("fs");
const path = require("path");
/* 剥注释 / 括号配对 / 行号换算统一复用 scan-util（v2.4.4 起不再各写一份；
   此前本文件内嵌的三份私有实现与 scan-util 语义逐字相同，属复制粘贴债）。 */
const { stripComments, matchBrace, lineOf, blankNonCode, braceDepths } = require("./scan-util");

const HTML = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error("未找到 <script> 块：" + HTML); process.exit(1); }
const SRC = m[1];
const lines = SRC.split("\n");

const clean = stripComments(lines);

/* 模块的**声明顺序**：必须与这份约定一致——顺序本身就是架构约定，不是随便排的 */
const EXPECTED_ORDER = ["Store", "Modal", "Viz", "AudioEngine", "Trainer", "Controls", "Tracks", "Presets", "Editor", "Stats", "Ear", "Arrange", "Help", "KeepAlive"];

/* R3 白名单：运行时回调对后方模块的合法调用。
   每条都要写明「为什么这里调后方模块是安全的」——安全是因为调用发生在运行时，
   而不是因为"反正能跑"。 */
const WHITELIST = [
  { from: "AudioEngine",    to: "Trainer",  reason: "scheduler() 在小节边界调 Trainer.onBarBoundary()——周期回调，非每帧热路径" },
  { from: "AudioEngine",    to: "Presets",  reason: "scheduler() 在小节边界调 Presets.consumePending() 消费挂起的节奏型切换——同上，每小节一次" },
  { from: "Trainer",  to: "Controls", reason: "训练到目标时调 Controls.stop()/setBpm()/syncBpmUI()——由调度周期或事件触发" },
  { from: "Controls", to: "Presets",  reason: "stop() 调 Presets.flushPending() 落定挂起切换——停止流程中执行" },
  { from: "Controls", to: "Editor",   reason: "keydown 处理器调 Editor.tryClose()/undo()——用户按键时执行" },
  { from: "Controls", to: "Stats",    reason: "v1.4：keydown 处理器查 Stats.isOpen()/close()——统计 overlay 打开时键盘归它管，用户按键时执行" },
  { from: "Controls", to: "Ear",      reason: "v1.10.0：keydown 处理器查 Ear.isOpen()/close()——同 Stats 那一套，听辨训练 overlay 打开时键盘归它管" },
  { from: "Controls", to: "Arrange",  reason: "v2.0.0：keydown 处理器查 Arrange.isOpen()/close()——同 Ear/Stats 那一套，曲式编排 overlay 打开时键盘归它管" },
  { from: "Controls", to: "Help",     reason: "v2.0.1：keydown 处理器查 Help.isOpen()/close()——同上一批那一套，使用方法 overlay 打开时键盘归它管" },
  { from: "Controls", to: "KeepAlive", reason: "v1.4：start()/stop() 末尾调 KeepAlive.sync() 同步保活——播放状态迁移时执行" },
  { from: "Tracks",   to: "Presets",  reason: "v2.4.0：set() 切轨后调 Presets.refreshAfterPatternChange() 重建列表 + 就地接续换型——用户点击切换条时执行，非初始化期、非每帧热路径" },
];

/* R4 扇出上限：一个模块**直接引用的下游模块个数**上限。Controls 是 UI 中枢、当前已顶到 7
   （它指向全部下游），再想加一条就必须显式抬高这个常量——让"中枢又胖一圈"成为一次看得见、
   需要理由的改动，而不是悄悄发生。新功能的 UI 装配请内聚到各自模块内部。 */
const MAX_FANOUT = 7;

/* ---- 嵌套深度（v2.8.8 前这里用的是缩进，见下面的说明）----
   R1 与 R2 都要回答"这条语句在哪个嵌套层"，历史上两种答案来源：
     · 缩进（旧）：「IIFE 顶层 = 恰好 2 空格缩进」——**格式约定**，不是结构事实。
       代价是 index.html 被禁止过任何格式化器（prettier 一次全文件重排就会让判定面静默失效）。
     · 括号深度（现在）：先 blankNonCode 抹掉注释与字符串内容，再逐字符数 `{` / `}`。
       **结构事实**，与缩进、换行、是否格式化完全无关。
   换用深度后那条禁令解除：docs/DEVELOPMENT.md §5 已同步改为"可以格式化了"。
   ⚠ 自检：整段脚本跑完深度必须回到 0。回不去说明 blankNonCode 漏掉了某种写法
     （例如正则字面量里写了不配对的花括号），此时深度全部不可信 —— 宁可报错退出，
     也不能让一个错位的深度表继续产出结论（这与 check-lint.js 的"括号必须配平"自检同源）。 */
const bare = blankNonCode(SRC);
const depths = braceDepths(bare);
if (depths[depths.length - 1] !== 0){
  console.error("嵌套深度自检失败：整段脚本跑完深度为 " + depths[depths.length - 1] + "（应为 0）——"
    + "多半是出现了 blankNonCode 未处理的写法，请先看 tools/scan-util.js 的 blankNonCode。\n"
    + "拒绝带着错位的深度表继续判定（宁可报错，不可给出假结论）。");
  process.exit(2);
}

/* 收集模块块：`const Name = (() => {` … 配对的 `}` */
const modules = [];
{
  const re = /^const (\w+) = \(\(\) => \{/gm;
  let mm;
  while ((mm = re.exec(SRC))){
    const name = mm[1];
    if (!EXPECTED_ORDER.includes(name)) continue;      // 只认 EXPECTED_ORDER 里那几个模块（VERSION 等常量不算）
    const end = matchBrace(SRC, mm.index);
    if (end < 0){ console.error("括号配对失败：" + name); process.exit(1); }
    /* 模块体的嵌套深度：`const Name = (() => {` 那个 `{` 之后的一层。
       本层里的语句 = IIFE 求值期就会执行的语句（R1 的判据）；再深一层就是在某个
       function / if / 对象字面量里，属运行时才走到的分支（R3）。 */
    const open = SRC.indexOf("{", mm.index);
    const bodyDepth = depths[open] + 1;
    modules.push({ name, start: mm.index, end, startLine: lineOf(SRC, mm.index), endLine: lineOf(SRC, end), bodyDepth });
  }
}
modules.sort((a, b) => a.start - b.start);

let failed = false;
const fail = msg => { failed = true; console.log("  ✗ " + msg); };
const pass = msg => console.log("  ✓ " + msg);

console.log("══════════════════════════════════════════════════════════");
console.log("  架构约束 · 模块不得反向引用（" + path.relative(process.cwd(), HTML) + "）");
console.log("══════════════════════════════════════════════════════════");

/* 0) 声明顺序必须与约定一致 */
{
  const got = modules.map(x => x.name);
  if (got.join(",") !== EXPECTED_ORDER.join(",")){
    fail("模块声明顺序与约定不符\n      约定：" + EXPECTED_ORDER.join(" → ") + "\n      实际：" + got.join(" → "));
  } else {
    pass("声明顺序符合约定：" + got.join(" → "));
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
      /* R1 判据（v2.8.8）：这一行的第一个代码字符处的**括号深度**是否正好等于模块体深度。
         等于 → 语句在 IIFE 体内、且不在任何嵌套块/函数里 = 求值期就会执行 = TDZ 风险区；
         深于它 → 在某个 function/if/回调体内 = 运行时才走到 = R3 范畴。 */
      else if (depthOfLine(ln) === mod.bodyDepth) r1Hits.push(rec);
      else r3Hits.push(rec);
    });
  }
});

/* 一行代码所在的嵌套深度 = 该行**第一个非空白字符**处的深度。
   取第一个非空字符而不是行首：行首的缩进空白本身不带深度信息，而形如
   `  } catch (e){ Modal.x() }` 这种一行里既有收尾又有起始的写法，判"这段语句在哪一层"
   应当以第一个代码字符为准。 */
function depthOfLine(ln){
  const raw = bare.slice(lineStartOf[ln - 1], lineStartOf[ln - 1] + (lines[ln - 1] || "").length);
  let i = 0;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  return depths[lineStartOf[ln - 1] + i];
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
