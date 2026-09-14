/* 覆盖率检查（审计 P1-7 第 4 条，零依赖）
   ---------------------------------------------------------------------------
   审计的原话是：「无覆盖率统计——**无法回答"渲染层到底覆盖了多少"这个本次审计的核心问题**」。
   P0-1（渲染层异常导致 rAF 循环死亡）能从 CI 漏出去，就是因为没有人能量化"Viz 有没有被执行过"。

   为什么不用 c8 / nyc / istanbul：本仓库连 CI 工具都刻意保持零依赖（`index.html` 必须能
   `file://` 直开）。而且实测本沙箱 `npx` 拉包会被 SIGTERM，装了也验证不了。
   **改用 Node 内置的 V8 覆盖率**——`NODE_V8_COVERAGE=<dir>` 会让 V8 把每个脚本的分支计数
   写成 JSON，`vm.Script` 编译的沙箱脚本同样会被采集（实测命中 `index.inline.js`，224 个函数）。
   于是「覆盖率」变成一行环境变量，不需要任何依赖。

   原理：V8 给每个函数一组**嵌套**的 `{startOffset, endOffset, count}` 区间。
   某一行是否被执行 = 该行首个非空白字符的偏移落在哪个区间里——取**包含它的、start 最大**的
   那个区间（嵌套结构下即最内层），其 count > 0 即视为覆盖。

   用法：
     node tools/check-coverage.js                 # 跑抽样模式，总阈值 97%、分区阈值 90%
     node tools/check-coverage.js --min=95        # 自定义总阈值
     node tools/check-coverage.js --full          # 跑 FULL_SCAN=1 全量组合扫描
     node tools/check-coverage.js --list=40       # 额外列出 40 个未覆盖函数名
   退出码 0 = 达标，1 = 低于阈值（CI 用它兜住"某块代码悄悄失去覆盖"）。

   为什么要两个阈值：只看总数会掩盖"某个模块烂掉、另一个模块补偿"。
   分区阈值保证每个模块自己不低于底线。

   当前（v1.3.1）总覆盖率 99.8%，唯一未覆盖的 3 行是 scheduler 的 MAX_SCHED_STEPS
   硬上限分支（1688-1690）——单轮调度要处理超过 512 个音符才会触发，正常负载远低于此
   （240BPM 三十二分在 1.2s 后台窗口内约 38 个），属**刻意保留的防御性代码**，
   不为了覆盖率去造人工状态把它点亮。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { extractScript } = require("./scan-util");

const argv = process.argv.slice(2);
const argOf = (name, dft) => {
  const hit = argv.find(a => a.startsWith("--" + name + "="));
  return hit ? hit.split("=")[1] : dft;
};
const MIN = +argOf("min", 97);
const MIN_SECTION = +argOf("min-section", 90);
const FULL = argv.includes("--full");
const LIST = +argOf("list", 12);

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SRC = extractScript(path.join(ROOT, "index.html"));
const lines = SRC.split("\n");
/* V8 的偏移是相对**内联脚本**的，所以算出来的行号也是脚本内相对行号。
   报告里必须换算成 index.html 的绝对行号，否则人会去文件里找错地方（实测误导过一次）。
   SRC 从 `<script>` 之后开始，故 绝对行 = 脚本起始行 + 脚本内行 - 1 */
const scriptStartLine = html.slice(0, html.indexOf("<script>")).split("\n").length;
const fileLine = n => n + scriptStartLine - 1;

/* ---- 跑测试套件并采集覆盖率 ---- */
const covDir = fs.mkdtempSync(path.join(os.tmpdir(), "beatsight-cov-"));
const env = Object.assign({}, process.env, { NODE_V8_COVERAGE: covDir });
if (FULL) env.FULL_SCAN = "1";
const run = spawnSync(process.execPath, [path.join(ROOT, "tests", "run.js")], { cwd: ROOT, env, encoding: "utf8" });
if (run.status !== 0){
  console.error("测试套件未通过，覆盖率无意义。先修测试：");
  console.error((run.stdout || "").split("\n").filter(l => /^  ✗|结果/.test(l)).join("\n"));
  process.exit(1);
}

/* ---- 汇总所有 coverage-*.json 里 index.inline.js 的区间 ---- */
const ranges = [];
let fnTotal = 0, fnDead = 0;
const deadNames = [];
for (const f of fs.readdirSync(covDir).filter(x => x.endsWith(".json"))){
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(covDir, f), "utf8")); } catch(e){ continue; }
  for (const res of (j.result || [])){
    if (!/inline/.test(res.url || "")) continue;
    for (const fn of res.functions){
      fnTotal++;
      const outer = fn.ranges[0];
      if (outer && outer.count === 0){
        fnDead++;
        deadNames.push(fn.functionName || "(匿名)");
      }
      for (const r of fn.ranges) ranges.push(r);
    }
  }
}
fs.rmSync(covDir, { recursive: true, force: true });
if (!ranges.length){
  console.error("没有采集到 index.inline.js 的覆盖率——检查 tests/run.js 是否仍经 vm.Script 加载内联脚本");
  process.exit(2);
}
/* 按 startOffset 排序，便于用「start ≤ off < end 中 start 最大者」取最内层区间 */
ranges.sort((a, b) => a.startOffset - b.startOffset);

const coveredAt = off => {
  let best = null;
  for (const r of ranges){
    if (r.startOffset > off) break;
    if (off < r.endOffset) best = r;          // 排序后仍在推进 → 最后命中的就是 start 最大者
  }
  return best ? best.count > 0 : false;
};

/* ---- 逐行判定 ---- */
const lineStart = [];
{
  let acc = 0;
  for (let i = 0; i < lines.length; i++){ lineStart[i] = acc; acc += lines[i].length + 1; }
}
const covered = lines.map((ln, i) => {
  const t = ln.trim();
  if (!t || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("*/")) return null;   // 空行/纯注释不计
  const off = lineStart[i] + (ln.length - ln.trimStart().length);
  return coveredAt(off);
});

/* ---- 按小节标题注释（形如「斜杠星号 ===== 名字 ===== 星号斜杠」）分区统计 ----
   分区必须是**互不重叠的连续区间**：每个小节的结束行 = 下一条标题的前一行。
   第一版把每段的 to 都写成文件末尾，导致各段互相包含（总数各不相同，完全没法看）。 */
const marks = [];
lines.forEach((ln, i) => {
  const m = /^\/\* =+ (.+?) =+ \*\/\s*$/.exec(ln.trim());
  if (m) marks.push({ name: m[1], line: i });
});
const sections = [];
{
  let from = 0, name = "(脚本头部)";
  for (const mk of marks){
    sections.push({ name, from, to: mk.line - 1 });
    from = mk.line; name = mk.name;
  }
  sections.push({ name, from, to: lines.length - 1 });
}
const stat = list => {
  const idx = list.filter(i => covered[i] !== null);
  const hit = idx.filter(i => covered[i]).length;
  return { total: idx.length, hit, pct: idx.length ? hit / idx.length * 100 : 100 };
};
for (const s of sections){
  const idx = [];
  for (let i = s.from; i <= s.to; i++) idx.push(i);
  Object.assign(s, stat(idx));
}
const overall = stat(lines.map((_, i) => i));

/* ---- 输出 ---- */
let failed = false;
console.log("══════════════════════════════════════════════════════════");
console.log("  行覆盖率 · V8 内置采集（" + (FULL ? "FULL_SCAN=1 全量" : "抽样") + "）");
console.log("══════════════════════════════════════════════════════════");
const bar = p => {
  const n = Math.round(p / 5);
  return "█".repeat(n) + "·".repeat(20 - n);
};
sections.forEach(s => {
  const bad = s.pct < MIN_SECTION;
  if (bad) failed = true;
  console.log("  " + bar(s.pct) + " " + s.pct.toFixed(1).padStart(5) + "%  " +
    String(s.hit).padStart(4) + "/" + String(s.total).padEnd(4) + " " + s.name + (bad ? "  ← 低于分区阈值" : ""));
});
console.log("  " + "─".repeat(58));
console.log("  " + bar(overall.pct) + " " + overall.pct.toFixed(1).padStart(5) + "%  " +
  String(overall.hit).padStart(4) + "/" + String(overall.total).padEnd(4) + " 全部");
console.log();
console.log("  函数：" + (fnTotal - fnDead) + "/" + fnTotal + " 个至少执行过一次"
  + (fnDead ? "（" + fnDead + " 个从未执行）" : ""));

/* 未覆盖的行按分区归类，便于定位 */
const nakedBySection = sections
  .map(s => {
    const miss = [];
    for (let i = s.from; i <= s.to; i++) if (covered[i] === false) miss.push(fileLine(i + 1));
    return miss.length ? { name: s.name, n: miss.length, first: miss.slice(0, 6) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.n - a.n);
if (nakedBySection.length){
  console.log("\n  未覆盖行分布（行号 = index.html 绝对行号，按数量降序）：");
  nakedBySection.forEach(s => console.log("      " + String(s.n).padStart(4) + " 行  " + s.name + "（如 L" + s.first.join(" / L") + "）"));
}
if (LIST > 0 && deadNames.length){
  const uniq = [...new Set(deadNames)];
  console.log("\n  从未执行的函数：" + uniq.slice(0, LIST).join(" · ")
    + (uniq.length > LIST ? " …（共 " + uniq.length + " 个）" : ""));
}

console.log("──────────────────────────────────────────────────────────");
console.log("  行覆盖率 " + overall.pct.toFixed(1) + "%（总阈值 " + MIN + "% · 分区阈值 " + MIN_SECTION + "%）");
failed = failed || overall.pct < MIN;
if (failed){
  console.log("  覆盖率检查：失败");
  process.exit(1);
}
console.log("  覆盖率检查：通过");
