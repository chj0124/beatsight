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
        （注：审计报告原文把 scheduler 也划进 R2，但同一份报告又称表里的 Audio→Trainer
         属于"合法的运行时调用"——而该调用就在 scheduler 体内，自相矛盾。
         这里按实际语义修正：scheduler 是**周期回调**（25ms 一次，跨模块调用只发生在小节边界，
         约每 1–2 秒一次），归入 R3；真正的每帧热路径只有上面三个渲染函数。）

     R3（弱约束，允许白名单）：运行时回调（事件处理器、setInterval 周期、停止流程等）
        可以调用后方模块——那时所有 const 早已初始化完毕。但必须在下方 WHITELIST 登记并写明
        理由；条目一旦不再被用到也会报错（防止白名单慢慢腐烂成"什么都放行"）。

   退出码 0 = 全部通过，1 = 有违规。CI 与本地自验都跑它。 */
"use strict";
const fs = require("fs");
const path = require("path");

const HTML = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error("未找到 <script> 块：" + HTML); process.exit(1); }
const SRC = m[1];
const lines = SRC.split("\n");

/* 模块的**声明顺序**：必须与这份约定一致——顺序本身就是架构约定，不是随便排的 */
const EXPECTED_ORDER = ["Store", "Modal", "Viz", "Audio", "Trainer", "Controls", "Presets", "Editor", "Stats", "KeepAlive"];

/* R3 白名单：运行时回调对后方模块的合法调用。
   每条都要写明「为什么这里调后方模块是安全的」——安全是因为调用发生在运行时，
   而不是因为"反正能跑"。 */
const WHITELIST = [
  { from: "Audio",    to: "Trainer",  reason: "scheduler() 在小节边界调 Trainer.onBarBoundary()——周期回调，非每帧热路径" },
  { from: "Audio",    to: "Presets",  reason: "scheduler() 在小节边界调 Presets.consumePending() 消费挂起的节奏型切换——同上，每小节一次" },
  { from: "Trainer",  to: "Controls", reason: "训练到目标时调 Controls.stop()/setBpm()/syncBpmUI()——由调度周期或事件触发" },
  { from: "Controls", to: "Presets",  reason: "stop() 调 Presets.flushPending() 落定挂起切换——停止流程中执行" },
  { from: "Controls", to: "Editor",   reason: "keydown 处理器调 Editor.tryClose()/undo()——用户按键时执行" },
  { from: "Controls", to: "Stats",    reason: "v1.4：keydown 处理器查 Stats.isOpen()/close()——统计 overlay 打开时键盘归它管，用户按键时执行" },
  { from: "Controls", to: "KeepAlive", reason: "v1.4：start()/stop() 末尾调 KeepAlive.sync() 同步保活——播放状态迁移时执行" },
];

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
const clean = stripComments(lines);

const lineOf = idx => { let n = 1; for (let i = 0; i < idx; i++) if (SRC[i] === "\n") n++; return n; };

/* 从 from 处起的第一个 `{` 做括号配对（跳过注释与字符串；热路径函数体内无正则字面量） */
function matchBrace(from){
  let i = SRC.indexOf("{", from);
  if (i < 0) return -1;
  let depth = 0;
  for (; i < SRC.length; i++){
    const c = SRC[i], c2 = SRC[i + 1];
    if (c === "/" && c2 === "/"){ while (i < SRC.length && SRC[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*"){ i = SRC.indexOf("*/", i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'" || c === "`"){
      const q = c; i++;
      while (i < SRC.length && SRC[i] !== q){ if (SRC[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}"){ depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* 收集模块块：`const Name = (() => {` … 配对的 `}` */
const modules = [];
{
  const re = /^const (\w+) = \(\(\) => \{/gm;
  let mm;
  while ((mm = re.exec(SRC))){
    const name = mm[1];
    if (!EXPECTED_ORDER.includes(name)) continue;      // 只认 8 个模块（VERSION 等常量不算）
    const end = matchBrace(mm.index);
    if (end < 0){ console.error("括号配对失败：" + name); process.exit(1); }
    modules.push({ name, start: mm.index, end, startLine: lineOf(mm.index), endLine: lineOf(end) });
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

/* 热路径函数体（R2） */
const HOT = ["paintFrame", "paintFrameBody", "paintBall"];
const hotRanges = [];
HOT.forEach(fn => {
  const idx = SRC.search(new RegExp("function\\s+" + fn + "\\s*\\("));
  if (idx < 0){ fail("未找到热路径函数 " + fn + "()——检查器可能已失效，需同步更新"); return; }
  const end = matchBrace(idx);
  if (end < 0){ fail("热路径函数 " + fn + "() 括号配对失败"); return; }
  hotRanges.push({ fn, start: idx, end });
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
    const indent = (text.match(/^ */) || [""])[0].length;
    modules.forEach((other, oi) => {
      if (oi <= mi) return;                                   // 只查"后方"
      const hit = new RegExp("\\b" + other.name + "\\s*\\.").exec(text);
      if (!hit) return;
      const rec = { from: mod.name, to: other.name, line: ln, code: (lines[ln - 1] || "").trim() };
      const charAt = lineStartOf[ln - 1] + hit.index;
      if (hotRanges.some(r => charAt >= r.start && charAt <= r.end)) r2Hits.push(rec);
      else if (indent === 2) r1Hits.push(rec);
      else r3Hits.push(rec);
    });
  }
});

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

console.log("──────────────────────────────────────────────────────────");
console.log(failed ? "  架构约束检查：失败" : "  架构约束检查：通过");
process.exit(failed ? 1 : 0);
