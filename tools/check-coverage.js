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
     node tools/check-coverage.js --reuse=<dir>   # 复用别处已落盘的 V8 覆盖率，**不再重跑套件**（见下）
     node tools/check-coverage.js --list=40       # 额外列出 40 个未覆盖函数名
   退出码 0 = 达标，1 = 低于阈值（CI 用它兜住"某块代码悄悄失去覆盖"），4 = 自身故障（未能执行）。
   自身故障用 4 而非 2（v2.8.14，审计 P1-6）：见下方 spawn 失败处的说明，与 check-all 的 TOOL_FAIL_CODE 统一。

   `--reuse` 是 v2.8.16（审计 P2-1）加的去重入口：本脚本默认会**自己 spawn 一遍测试套件**来
   采集覆盖率，而 check-all 的第 12 步（tests/run.js，FULL_SCAN=1）已经在跑同一套件了——全量
   模式下最贵的那一遍因此白跑两次。改成 check-all 在第 12 步带上 NODE_V8_COVERAGE 跑（同一遍
   既出结论又落盘区间），第 14 步再用本脚本的 `--reuse=<那个目录>` 直接分析落盘、跳过 spawn。
   单独运行（不带 --reuse）时行为完全不变。

   为什么要两个阈值：只看总数会掩盖"某个模块烂掉、另一个模块补偿"。
   分区阈值保证每个模块自己不低于底线。

   覆盖率口径：**本文件刻意不写死百分比，也不写死"未覆盖集中在哪几个分区"**——两者都会随版本
   演进漂移（本行原写「现在跑到 99.8%」且只提 Audio / Ear，而 v2.8.3 实测为 99.4%，
   Arrange / 初始化装配 / Presets 等后加模块也各有未覆盖行）。要看当前真值，直接读本脚本自己的输出。
   未覆盖行始终是这两类：一类是**防御性上限**（如单轮调度音符数超过 MAX_SCHED_STEPS 才会触发的
   硬兜底、ctx 被系统关闭后重建的路径），另一类是**不可达兜底**（逻辑上到不了的分支）。
   两类都属**刻意保留的防御性代码**，不为了覆盖率去造人工状态把它点亮。

   这里**刻意不硬编码行号与未覆盖条数**：它们随每次版本演进就会漂移，写死即过期
   （本注释原写「v1.3.1…未覆盖 3 行在 scheduler 1688-1690」，早已与实测的 7 行 /
   Audio+Ear 分布不符）。要看当前真实明细，直接跑本脚本或加 --list=N。 */
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
const REUSE = argOf("reuse", "");        // v2.8.16（审计 P2-1）：非空 = 复用该目录的落盘，不重跑套件
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

/* ---- 采集覆盖率：`--reuse=<dir>` 分析上游落盘，否则自己跑一遍套件（v2.8.16，审计 P2-1）---- */
let covDir;
if (REUSE){
  /* 复用模式：上游（check-all 第 12 步）已经带着 NODE_V8_COVERAGE 跑过同一套件并把区间落盘，
     这里直接分析那份落盘即可，**绝不重跑套件**——这正是 P2-1 要去掉的那一遍。 */
  covDir = REUSE;
  if (!fs.existsSync(covDir)){
    console.error("⊘ --reuse 指定的覆盖率目录不存在：" + covDir);
    console.error("  这是**工具故障，不是覆盖率不达标**——本次未被验证（退出码 4 = 未能执行）。");
    process.exit(4);
  }
} else {
  covDir = fs.mkdtempSync(path.join(os.tmpdir(), "beatsight-cov-"));
  const env = Object.assign({}, process.env, { NODE_V8_COVERAGE: covDir });
  if (FULL) env.FULL_SCAN = "1";
  /* 覆盖率插桩要为**每一次 vm.Script 编译**的内联脚本留存区间：FULL_SCAN 下 loadApp() 被调用
     数百次，区间累积到约 2GB，正好顶穿 Node 默认 old-space 上限（本沙箱实测 2240MB），于是进程在
     全部用例跑完、收尾 flush 覆盖率的瞬间 FATAL（exit 134，cov 目录为空 → 报"测试套件未通过"）。
     注意这是**覆盖率插桩自身的内存开销**，与用例成败无关：同一套件不加覆盖率时 2345/2345 全绿。
     故只给这个带插桩的子进程抬高上限（V8 按需增长，不预占），别动普通测试步骤。 */
  const run = spawnSync(process.execPath, ["--max-old-space-size=4096", path.join(ROOT, "tests", "run.js")], { cwd: ROOT, env, encoding: "utf8" });
  /* ★ 先分「子进程压根没起来」与「测试真的没过」（v2.8.6，审计 §E2）：spawnSync 失败时
     `status` 为 null、`error` 有值，而此前这里直接按 `status !== 0` 处理，于是会打印
     「测试套件未通过，覆盖率无意义。先修测试：」+ 一张**空的**失败清单——因为 stdout 是空的，
     那条过滤正则一条也匹配不到。结果是：把"测试没跑成"说成"测试没过"，还附一份空清单，
     把人送去找一个不存在的失败用例。本机沙箱实测正是这个形状（管道式 spawnSync 报 EBUSY，
     而当时测试套件本身 2412 PASS / 0 FAIL 完全健康）。
     退出码 4 = 本步骤未能执行，由 tools/check-all.js 按「工具故障」记账（既不算 ✓ 也不算 ✗）。 */
  if (run.error){
    console.error("⊘ 无法启动测试子进程（" + (run.error.code || run.error.errno || "?") + "）：" + run.error.message);
    console.error("  这是**工具故障，不是测试失败**——覆盖率本次未被验证（退出码 4 = 未能执行）。");
    console.error("  先查环境（权限 / 沙箱 / 资源），别去查测试。");
    process.exit(4);
  }
  if (run.status !== 0){
    /* ★ v3.36.13：把「插桩把进程压垮」与「测试真的没过」分开（本轮实测踩到）。
       插桩内存：本脚本单独跑给 4096MB，check-all 第 12 步给 6144MB 再让本脚本 --reuse——
       故本机单独跑 node tools/check-coverage.js 会 134（Abort trap）。此前一律报「先修测试」，
       还把过滤正则 /^  ✗|结果/ 命中的**通过**断言（「…重绘结果一致」）印成失败清单，
       把人送去查一个不存在的失败用例。 */
    const oom = run.status === 134 || /heap out of memory|Abort trap/i.test(run.stderr || "");
    if (oom){
      console.error("⊘ 测试子进程被插桩压垮（exit " + run.status + "）：**不是测试失败**，是覆盖率插桩自身的内存开销。");
      console.error("  工具故障，本次未被验证（退出码 4）。两条可行路径：");
      console.error("    · node tools/check-all.js（第 12 步给 6144MB，再用 --reuse 喂给本脚本）；");
      console.error("    · 或抬高上限：NODE_OPTIONS=--max-old-space-size=6144 node tools/check-coverage.js");
      process.exit(4);
    }
    console.error("测试套件未通过，覆盖率无意义。先修测试：");
    console.error((run.stdout || "").split("\n").filter(l => /^\s*✗/.test(l)).join("\n"));
    process.exit(1);
  }
}

/* ---- 汇总所有 coverage-*.json 里 index.inline.js 的区间 ---- */
const ranges = [];
let fnTotal = 0, fnDead = 0;
/* v3.36.11（审计 C-9）：存 {名字, 定义偏移} 而不是只存名字——行号要等 lineStart 建好才能算，
   而采集发生在那之前，故先记偏移、到打印时再映射。 */
const deadFns = [];
/* ★ v3.39.0（分块采集适配）：tests/run.js 在插桩模式下分块跑后，同一脚本会有**多条**
   覆盖条目（每块一条，编译缓存把块内多次 loadApp 累计进同一条）。此后两处口径要变：
   ① 函数「从未执行」= **所有块都为 0**（任一块执行过就算覆盖）——按 名字+偏移 记最大
     外层 count，否则块 5 实测过的 jianpuOf 会被块 1~4 的 0 条目冒名顶替进「从未执行」清单；
   ② 行覆盖 = **按条目隔离判定、跨条目取或**——见下面 coveredAt 前的条目隔离段。
   单进程时代每脚本只有一条条目，这两处都是恒等变换——老口径零变化。
   （这里的 ranges 只剩一个职责：作为「有没有采集到 inline 覆盖」的判据喂给下面的工具故障分支。） */
const fnSeen = new Map();   // key: name + ":" + startOffset → 最大外层 count
for (const f of fs.readdirSync(covDir).filter(x => x.endsWith(".json"))){
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(covDir, f), "utf8")); } catch(e){ continue; }
  for (const res of (j.result || [])){
    if (!/inline/.test(res.url || "")) continue;
    for (const fn of res.functions){
      const outer = fn.ranges[0];
      const key = (fn.functionName || "(匿名)") + ":" + (outer ? outer.startOffset : -1);
      if (!fnSeen.has(key) || (outer ? outer.count : 0) > fnSeen.get(key)) fnSeen.set(key, outer ? outer.count : 0);
      for (const r of fn.ranges) ranges.push(r);
    }
  }
}
for (const [key, count] of fnSeen){
  fnTotal++;
  if (count === 0){
    fnDead++;
    const i = key.lastIndexOf(":");
    deadFns.push({ name: key.slice(0, i), off: +key.slice(i + 1) });
  }
}
if (!REUSE) fs.rmSync(covDir, { recursive: true, force: true });
if (!ranges.length){
  console.error("没有采集到 index.inline.js 的覆盖率——检查 tests/run.js 是否仍经 vm.Script 加载内联脚本");
  console.error("  这是**工具故障，不是覆盖率不达标**——本次未被验证（退出码 4 = 未能执行）。");
  process.exit(4);
}
/* ★ v3.39.0（分块采集适配）：同一脚本的区间现在来自多个块进程。第一版修法把所有区间
   倒进一个数组按 (start,end) 去重再「排序后最后命中者胜」——实测**仍然丢覆盖**：
   V8 对同一逻辑区间在不同进程里给出的端点有细微漂移（实测 diagPaint 的语句区间在
   块 1 是 [825170,825961]、块 4/5 是 [825170,825982]），"精确同键"合并不了它们，
   平局时 count=0 的近重复若排在后面照样把块 1 实测 count=11 的行判死。
   正确口径：**按条目隔离判定、跨条目取或**——每个（文件 × inline 条目）独立做
   「start ≤ off < end 中 start 最大者」的最内层判定（条目内部区间自洽、无混排），
   行覆盖 = 任一条目判真。单条目时代 = 只有一个条目，与老口径逐位等价。 */
const entryVerdicts = [];   // 每个条目一个 off => bool
{
  const byEntry = new Map();   // 文件名 + 条目序 → 该条目的区间数组
  for (const f of fs.readdirSync(covDir).filter(x => x.endsWith(".json"))){
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(covDir, f), "utf8")); } catch(e){ continue; }
    (j.result || []).forEach((res, ri) => {
      if (!/inline/.test(res.url || "")) return;
      const rs = [];
      for (const fn of res.functions) for (const r of fn.ranges) rs.push(r);
      rs.sort((a, b) => a.startOffset - b.startOffset);
      byEntry.set(f + "#" + ri, rs);
    });
  }
  for (const rs of byEntry.values()){
    entryVerdicts.push(off => {
      let best = null;
      for (const r of rs){
        if (r.startOffset > off) break;
        if (off < r.endOffset) best = r;      // 排序后仍在推进 → 最后命中的就是 start 最大者
      }
      return best ? best.count > 0 : false;
    });
  }
}
const coveredAt = off => entryVerdicts.some(v => v(off));

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
console.log("  行覆盖率 · V8 内置采集（" + (FULL ? "FULL_SCAN=1 全量" : "抽样")
  + (REUSE ? " · 复用第 12 步落盘" : "") + "）");
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

/* ★ v3.36.12（本轮审计 C-8）：**增量覆盖率读数**（观察期，不判红）。
   由来：审计建议在「总体 97%」之外再加一条「新增代码行覆盖 ≥ 90%」——理由是存量已经干净，
   真正会掉的是新增代码。但直接判红有风险：防御性分支常常**刻意不覆盖**（本文件头部已论证过
   那两类不可达兜底），一刀切会把好代码拦住。故先**只读不判**，与冷键写入那条
   「先量化再决定要不要动」同一路径；到期日登记在 tools/check-all.js 的 STEPS 里（C-6）。
   ★ 基线怎么取：优先**工作区 vs HEAD**（未提交时最有用）；工作区干净则退到 HEAD~1 → HEAD
     （刚提交完也能看到自己那一版）。两条都拿不到（非 git / 浅克隆无父提交）⇒ 打印 ⊘ 不猜。
   ★ 行号换算：git diff 给的是 **index.html 绝对行号**，而覆盖率数组是**脚本行**，
     两者只差一个平移量 scriptStartLine（已有），故 i = 绝对行 − scriptStartLine。 */
{
  const diffAdded = base => {
    const r = spawnSync("git", ["diff", "--unified=0", base, "--", "index.html"], { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return null;
    const out = [];
    for (const m of r.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)){
      const start = +m[1], cnt = m[2] === undefined ? 1 : +m[2];
      for (let k = 0; k < cnt; k++) out.push(start + k);
    }
    return out.length ? { base: base, lines: out } : null;
  };
  const inc = diffAdded("HEAD") || diffAdded("HEAD~1");
  if (!inc){
    console.log("  ⊘ 增量覆盖率：取不到 diff 基线（无改动 / 浅克隆 / 非 git）——本条未验证");
  } else {
    const idxs = inc.lines.map(al => al - scriptStartLine).filter(i => i >= 0 && i < covered.length);
    const known = idxs.filter(i => covered[i] !== null);
    const hit = known.filter(i => covered[i]).length;
    const pct = known.length ? (hit / known.length * 100) : null;
    console.log("  ⚠ 增量覆盖率（基线 " + inc.base + "）：" + hit + "/" + known.length + " 行"
      + (pct === null ? "（无可判定行）" : " = " + pct.toFixed(1) + "%")
      + "  ← 观察期：只读不判（若将来定 90% 门槛，低于它才值得处置）");
  }
}

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
if (LIST > 0 && deadFns.length){
  /* ★ v3.36.11（审计 C-9）：补上**定义行号**。此前只印函数名，而"哪个该补断言、哪个是桩不可达的
     死路"全靠人猜（审计原话：「列表没有行号，无法定位」）。行号 = index.html **绝对**行号，
     与上面「未覆盖行分布」同一口径，可以直接跳过去。 */
  const lineAtOffset = off => {
    let lo = 0, hi = lineStart.length - 1, ans = 0;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      if (lineStart[mid] <= off){ ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  };
  /* 按**名字**归组（不是按 名字@偏移）：匿名函数有几十个，各占一条会把有名字的挤出前 N 条——
     实测退化成了 12 条清一色「(匿名)」，比不补行号还难读。归组后每个名字给前几个行号。
     ★ 排序：**有名字的在前**（那才是"该补断言还是该删"能一眼判断的），匿名的收尾。 */
  const byName = new Map();
  deadFns.forEach(d => {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d.off);
  });
  const uniq = [...byName.entries()]
    .sort((a, b) => (a[0] === "(匿名)" ? 1 : 0) - (b[0] === "(匿名)" ? 1 : 0))
    .map(([name, offs]) => {
      const ls = offs.map(o => "L" + fileLine(lineAtOffset(o) + 1));
      return name + "（" + ls.slice(0, 3).join(" / ") + (ls.length > 3 ? " …共 " + ls.length + " 处" : "") + "）";
    });
  console.log("\n  ⚠ 从未执行的函数：" + uniq.slice(0, LIST).join(" · ")
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
