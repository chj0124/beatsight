/* 文档一致性闸门（v2.0.5，审计 P0-6，零依赖）
   ---------------------------------------------------------------------------
   由来：v2.0.4 全维度代码审计的主要结论之一是——**闸门能把代码盘干净，但没有任何检查器
   会核对注释与文档里的数字**。实测三处系统性漂移（都不是笔误，是"没人核对"）：

     1) index.html 头部的模块索引 16 条行号**全部**偏移（最大 59 行）→ 转给 tools/gen-index.js
     2) 自验耗时的「约 N 秒」全是手写的，实测与真值差 20%～3 倍。这一处尤其说明问题：
        D1/D9 已经"修"过一次（把约 6 秒改成约 17 秒），这次实测是 20.8 秒——**又歪了**。
        手写数字注定要烂，因为耗时会随机器、Node 版本、跑不跑 FULL_SCAN 而变。
     3) README 文档表声明某份文档"已归档 / 已落地"，而文档正文里没有任何状态横幅
        （PLAN-v1.9 / PLAN-v2-arrangement / PLAN-v2-impl 三份都缺）——读者按表点进去，
        看到的是还在写"确认后开工"的方案，无从判断该不该信。

   七项都改成机器可判的规则，而不是再手写一遍数值：

     1) 模块索引行号 = index.html 实际 banner 行号（复用 gen-index.js 的解析，口径唯一）
     2) 不许手写耗时：这四个文件的正文里不得出现「约 N 秒」。
        为什么是"禁止"而不是"自动回写实测值"：自动回写要把耗时写进文档正文，于是每次跑自验
        都会改动文档（脏工作区 + diff 噪音 + 提交时才发现）；而耗时本来就不该是文档的职责
        ——命令自己会在末尾打印「全部通过 · 实跑 N/M 项 · 用时 Xs」。文档只描述"怎么用、为什么"。
     3) 归档状态一致：README 文档表里标了「已归档 / 已落地」的 Markdown 文档，
        正文开头必须有同一状态词（写清"已归档/已落地 + 以什么为准"）。
     4) 审计快照横幅：spec.md / tasks.md / checklist.md 是 2026-09-17 那次审计（基线 v2.0.2）的
        产物，里面的数字必然随代码演进漂移。它们因此被排除在"手写耗时"规则之外（见 TIMING_FILES），
        但正文开头必须各自带一行统一横幅「历史快照 · 已归档」——否则读者会拿旧数字当现状。
     5) README 的版本声明必须等于 VERSION（v2.8.6，审计 §Q1）。README 正文那句
        「当前 `vX.Y.Z`」是**对外第一入口的现状描述**，也是最容易被引用传播的一处；
        它此前**恰好落在两个闸门之间**——check-version.js 只校验
        VERSION ↔ CHANGELOG ↔ package.json ↔ package-lock.json，本文件又只查
        索引/耗时/归档/快照，于是这句声明自 v2.8.0 起漏更新了两版（一直写着 v2.7.0）
        而闸门一路绿灯。这不是笔误，是制度性盲区：**没人核对 ≠ 没问题**。
        另附一条与 check-version.js 第 3 项同口径的前瞻规则：README 也不得引用高于 VERSION 的版本号。
     6) 自验步数一致（v2.8.6，审计 §F12）：README 与 docs/DEVELOPMENT.md 里的步数声明必须与
        tools/check-all.js 的 STEPS 实际结构一致。漂移通道很具体："加了第 13 步、忘了改文档"
        ——改的时候人在看代码，不在看这两份文档。**但检查范围刻意收得很窄**（只认两处形状：
        命令注释 `# 共 N 步…`，以及 ⊘ 说明句「N 步里有 M 步可能标 ⊘」），因为两份文档
        大量引用**历史步数**（技术债清单里写着"第 4 步（现共 8 步）"，那是 v1.6.5 当时的原话，
        属于应当保留的历史记录）。宽正则分不清现状声明与历史引文——本规则第一版就这么
        误判了两处，故改为窄口径。详见规则 6 代码里的注释。
     7) 不许手写"当前覆盖率"（v2.8.6，审计 §F12）：与第 2 项同源同处置。
        实测证据：tests/README.md 写「当前 **99.7%**…只剩三组共 **11 行**」，
        而 v2.8.3 自验实测是 **99.4% / 36 行**——又是一个"抄一遍就等着烂"的数字。

   刻意不做的事：不去校验正文里引用的**代码行号**（如"未覆盖的 L2964"）——它更适合由产出方
   （check-coverage）直接打印，让文档指过去而不是抄一遍；也不去比对"实测值"本身
   （那要求本文件跑一遍完整测试套件，与"极便宜的纯读文件比对"这个定位冲突）。
   ★ v2.8.6 订正：本条此前写的是"不去校验 README 里'实跑 8/10 项'这类**步数**，收益低"。
     那个判断现在改了——收益低的是"实跑数"（它随环境变，本就该由命令自己打印），
     而**声明的总步数**是仓库自己的结构事实，机器一读即知，属于该管的那一类。
     新判断见第 6 项：管的不是"实跑了几项"，是"仓库总共有几项"。

   退出码 0 = 一致，1 = 有漂移。 */
"use strict";
const fs = require("fs");
const path = require("path");
const genIndex = require("./gen-index.js");

const ROOT = path.join(__dirname, "..");

/* 手写耗时的禁区（相对路径）。刻意排除：CHANGELOG（历史记录，改了反而失真）、
   docs/PLAN-*.md（归档方案，是当年的快照）、spec.md / checklist.md / tasks.md（审计产物，
   由下面的第 4 项快照横幅规则单独管） */
const TIMING_FILES = [
  "README.md",
  "docs/DEVELOPMENT.md",
  "tests/README.md",
  "tools/check-all.js",
];
const TIMING_RE = /约\s*\d+(?:\.\d+)?\s*秒/g;

/* 审计产物必须带统一快照横幅：这三份是 2026-09-17 审计（基线 v2.0.2）的产物，数字会随代码演进
   漂移。它们不适用"手写耗时"规则，但正文开头必须有「历史快照 · 已归档」这行，读者才不会被旧数字误导。 */
const SNAPSHOT_FILES = ["spec.md", "tasks.md", "checklist.md"];
const SNAPSHOT_MARKER = "历史快照 · 已归档";
const SNAPSHOT_HEAD_LINES = 20;

const problems = [];
const report = [];

console.log("══════════════════════════════════════════════════════════");
console.log("  文档一致性（索引行号 · 耗时 · 归档 · 快照 · 版本/步数 · 覆盖率现状）");
console.log("══════════════════════════════════════════════════════════");

/* ---- 1) 模块索引行号 ---- */
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const a = genIndex.analyze(html);
  const d = genIndex.diff(a);
  if (d.length){
    report.push(`✗ 模块索引：${d.length} 处与实际 banner 不符（index.html）`);
    d.forEach(x => problems.push("模块索引 —— " + x));
  } else {
    report.push(`✓ 模块索引：${a.banners.length} 个模块逐条对齐（index.html）`);
  }
}

/* ---- 2) 不许手写耗时 ---- */
{
  const hits = [];
  TIMING_FILES.forEach(rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    fs.readFileSync(full, "utf8").split("\n").forEach((ln, i) => {
      TIMING_RE.lastIndex = 0;
      const m = TIMING_RE.exec(ln);
      if (m) hits.push(`${rel}:${i + 1} 「${m[0]}」`);
    });
  });
  if (hits.length){
    report.push(`✗ 手写耗时：${hits.length} 处（耗时随机器/Node 版本/FULL_SCAN 而变，写死在文档里必烂）`);
    hits.forEach(h => problems.push("手写耗时 —— " + h));
  } else {
    report.push("✓ 手写耗时：4 个文件均无「约 N 秒」（耗时由 check-all 在末尾自己输出）");
  }
}

/* ---- 3) 归档状态一致 ---- */
{
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const tableRe = /\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|([^|]*)\|/g;
  const missing = [];
  let checked = 0;
  let m;
  while ((m = tableRe.exec(readme))){
    const label = m[1].trim();
    const desc = m[3];
    if (!/\.md$/.test(label)) continue;                 // 只看 Markdown（prd.html 这类不查，见文件头）
    const status = /已归档/.test(desc) ? "已归档" : (/已落地/.test(desc) ? "已落地" : null);
    if (!status) continue;
    checked++;
    const full = path.join(ROOT, label);
    if (!fs.existsSync(full)){
      missing.push(`${label} 在 README 里被标为「${status}」，但文件不存在`);
      continue;
    }
    const head = fs.readFileSync(full, "utf8").split("\n").slice(0, 20).join("\n");
    if (!head.includes(status)){
      missing.push(`${label}：README 标为「${status}」，但正文前 20 行没有「${status}」字样`
        + "——点进去的人无从判断这份文档还算不算数");
    }
  }
  if (missing.length){
    report.push(`✗ 归档状态：${missing.length} 处不一致（README 文档表 ↔ 文档正文）`);
    missing.forEach(x => problems.push("归档状态 —— " + x));
  } else {
    report.push(`✓ 归档状态：README 文档表中 ${checked} 份带状态的文档，正文均有同名横幅`);
  }
}

/* ---- 4) 审计快照横幅 ---- */
{
  const missing = [];
  SNAPSHOT_FILES.forEach(rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)){
      missing.push(`${rel} 不存在`);
      return;
    }
    const head = fs.readFileSync(full, "utf8").split("\n").slice(0, SNAPSHOT_HEAD_LINES).join("\n");
    if (!head.includes(SNAPSHOT_MARKER)){
      missing.push(`${rel}：正文前 ${SNAPSHOT_HEAD_LINES} 行缺少「${SNAPSHOT_MARKER}」横幅`
        + "——这是审计产物，数字会漂移，读者需要一行显式的「历史快照」声明");
    }
  });
  if (missing.length){
    report.push(`✗ 审计快照：${missing.length} 处缺失（spec.md / tasks.md / checklist.md）`);
    missing.forEach(x => problems.push("审计快照 —— " + x));
  } else {
    report.push(`✓ 审计快照：${SNAPSHOT_FILES.length} 份审计产物均带「${SNAPSHOT_MARKER}」横幅`);
  }
}

/* ---- 5) README 的版本声明必须等于 VERSION（v2.8.6，审计 §Q1）---- */
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const vm = /const\s+VERSION\s*=\s*"([^"]+)"/.exec(html);
  const ver = vm ? vm[1] : null;
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  /* 声明形状刻意收得很窄——「当前 + 反引号包着的 vX.Y.Z」。
     宽正则（比如"全文任何 vX.Y.Z 都要等于 VERSION"）会把历史引用一并误伤，
     而历史引用正是这份 README 大量存在且**应当**存在的东西（"v2.0.5 起""v2.7.0 起"）。 */
  const claim = /当前\s*`v(\d+\.\d+\.\d+)`/.exec(readme);
  if (!ver){
    report.push("⊘ README 版本号：index.html 里读不到 VERSION，本条跳过（check-version.js 会拦）");
  } else if (!claim){
    problems.push("README.md 里找不到形如「当前 `vX.Y.Z`」的版本声明"
      + "——这是对外第一入口的现状描述，必须显式声明：找不到就**没有可核对的对象**，"
      + "漂移会再次无声发生（v2.8.0→v2.8.2 期间本就是这种状态）");
  } else if (claim[1] !== ver){
    problems.push("README.md 声明「当前 v" + claim[1] + "」，而 index.html 的 VERSION 是 " + ver
      + "（README L" + (readme.slice(0, claim.index).split("\n").length) + "）"
      + "——发版必须同时改这一处");
  } else {
    report.push("✓ README 版本号：当前 `v" + ver + "`（与 VERSION 对齐）");
  }
  /* 同口径的前瞻规则（与 check-version.js 第 3 项一致）：README 也不许引用还没发的版本号 */
  if (ver){
    const sv = s => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s || ""); return m ? [+m[1], +m[2], +m[3]] : null; };
    const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
    const seen = new Map();
    for (const mm of readme.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)){
      if (!seen.has(mm[1])) seen.set(mm[1], readme.slice(0, mm.index).split("\n").length);
    }
    const base = sv(ver);
    [...seen.entries()].filter(([v]) => sv(v) && cmp(sv(v), base) > 0).forEach(([v, ln]) => {
      problems.push("README.md L" + ln + " 引用了 v" + v + "，高于当前 VERSION " + ver
        + "——文档提前引用了一个还没发布的版本？");
    });
  }
}

/* ---- 6) 自验步数：文档里的步数声明必须与 check-all.js 的 STEPS 实际结构一致 ---- */
const STEP_COUNT_FILES = ["README.md", "docs/DEVELOPMENT.md"];
{
  const all = fs.readFileSync(path.join(ROOT, "tools/check-all.js"), "utf8");
  const block = /const STEPS = \[([\s\S]*?)\n\];/.exec(all);
  /* 数 `{ name:` 而不是数行：STEPS 里带注释块，数行会把注释算进去。
     若将来有人换了写法导致这里数不出来，**直接报错而不是猜**——与 gen-index.js
     "条目数不一致时只报错、不猜"同一条约定：工具替人编一个数字，等于把噪音固化进文件。 */
  const actual = block ? (block[1].match(/\{\s*name\s*:/g) || []).length : 0;
  /* 第三步可推导的数：能被 ⊘ 记账的步数 = 带 `optional:`（缺开发依赖）+ 带 `skipCode:`（缺环境能力） */
  const optionalSteps = block ? (block[1].match(/\boptional\s*:/g) || []).length : 0;
  const skipCodeSteps = block ? (block[1].match(/\bskipCode\s*:/g) || []).length : 0;
  if (!actual){
    problems.push("tools/check-docs.js：在 tools/check-all.js 里数不出 STEPS 条目数"
      + "——要么 STEPS 的写法变了，要么正则该改；本条不能「猜一个数」继续");
  } else {
    const hits = [];
    STEP_COUNT_FILES.forEach(rel => {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) return;
      fs.readFileSync(full, "utf8").split("\n").forEach((ln, i) => {
        const at = rel + ":" + (i + 1);
        /* (a) 命令注释里的步数声明，形如 `# 共 N 步：…`——**读者就是按它数步数的**。
           ★ 为什么刻意只认「行首（允许缩进）是 #」这一种形状，而不是全文扫「共 N 步」：
             本仓库文档大量**引用历史步数**（docs/DEVELOPMENT.md 的技术债清单里写着
             "作为第 4 步（现共 8 步）""第 5 步，现共 9 步"，那是 v1.6.5 / v1.9.1 当时的原话，
             属于**应当保留**的历史记录）。宽正则分不清"现状声明"与"历史引文"，
             把它一并判红就是假红——而假红的代价本项目自己算过（eslint.config.js：
             "一个常年飘红的检查很快就会被所有人无视或直接关掉，等于没写"）。
             本条宁可窄而准：只守"读者会照着数的地方"。
             首次编写时就因为用了宽正则，把 L798 两处历史引文误判成漂移（当时的实测输出为证）。 */
        if (/^\s*#/.test(ln)){
          for (const m of ln.matchAll(/共\s*(\d+)\s*步/g)){
            if (+m[1] !== actual) hits.push(at + " 写「共 " + m[1] + " 步」，实际 " + actual + " 步（命令注释）");
          }
        }
        /* (b) ⊘ 说明句，形如「N 步里有 M 步可能标 ⊘」——两个数都能从 STEPS 直接推出来，
           所以它和 (a) 是同一类"仓库自己的结构事实"，该管；(a) 那种形状无法覆盖散文，
           这一条正好补上读者最容易读到的那句。 */
        for (const m of ln.matchAll(/(\d+)\s*步里有\s*(\d+)\s*步可能标/g)){
          if (+m[1] !== actual){
            hits.push(at + " 写「" + m[1] + " 步里有…」，实际 " + actual + " 步");
          }
          if (+m[2] !== optionalSteps + skipCodeSteps){
            hits.push(at + " 写「…里有 " + m[2] + " 步可能标 ⊘」，实际 " + (optionalSteps + skipCodeSteps)
              + " 步（" + optionalSteps + " 个 optional + " + skipCodeSteps + " 个 skipCode）");
          }
        }
      });
    });
    if (hits.length){
      report.push("✗ 自验步数：" + hits.length + " 处与 tools/check-all.js 的 STEPS 不符（实际 " + actual + " 步）");
      hits.forEach(h => problems.push("自验步数 —— " + h));
    } else {
      report.push("✓ 自验步数：" + STEP_COUNT_FILES.length + " 份文档的步数声明与 STEPS 一致（"
        + actual + " 步，其中 " + (optionalSteps + skipCodeSteps) + " 步可 ⊘）");
    }
  }
}

/* ---- 7) 不许手写"当前覆盖率"（v2.8.6，审计 §F12）----
   与第 2 项（不许手写耗时）同源同处置。实测证据：tests/README.md 写「当前 **99.7%**…
   17 个分区里 **15 个是 100%**…共 **11 行**」，而 v2.8.3 自验实测是 99.4% / 36 行。
   ★ 为什么只禁「当前…N%」这一种写法，而不是禁掉文档里所有百分比：
     历史叙述（「v2.0.5 时是 99.8%」「原写 99.7%，v2.8.3 实测已是 99.4%」）是有信息量的，
     而且**明确标注了过去时**。真正有害的是以**现状口吻**断言一个会变的数字。 */
const COVERAGE_FILES = ["tests/README.md", "docs/DEVELOPMENT.md"];
const COVERAGE_CLAIM_RE = /当前[^\n]{0,40}?\d+(?:\.\d+)?\s*%/g;
/* ★ 本规则的口径**刻意很窄**，而且它拦不住的东西要说清楚（免得下一个人以为它是万能的）：
     · 只认「当前…N%」这一种形状。换成别的措辞（「覆盖率是 X%」）就绕得过去。
     · 为什么不做宽：宽口径（如「覆盖率…N%」）会把**历史叙述**一并误伤——
       tests/README.md 自己就写着「覆盖率从 89.7% 升到 99.8%」，docs/DEVELOPMENT.md
       整段都在引用旧数字来讲"手写数字注定要烂"这个教训。那些是**该留**的内容。
     · 取舍理由与规则 6 同源：宁可窄而准，不接受假红（假红的代价见 eslint.config.js）。
     · 本轮实测还暴露了窄口径的一个副作用：**引用旧句子时若把「当前」一起引进来，会被自己拦下**
       （tests/README.md 的第一版改写就是这样）。这不完全是坏事——它逼引用者把"旧文说的是什么"
       与"现在是什么"在措辞上分开，正是本规则想要的效果。 */
{
  const hits = [];
  COVERAGE_FILES.forEach(rel => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    fs.readFileSync(full, "utf8").split("\n").forEach((ln, i) => {
      for (const m of ln.matchAll(COVERAGE_CLAIM_RE)) hits.push(rel + ":" + (i + 1) + " 「" + m[0] + "」");
    });
  });
  if (hits.length){
    report.push("✗ 手写覆盖率现状：" + hits.length + " 处（覆盖率随用例增减而变，写死在文档里必烂）");
    hits.forEach(h => problems.push("手写覆盖率现状 —— " + h));
  } else {
    report.push("✓ 手写覆盖率现状：2 份覆盖率叙述文件均无「当前 N%」（数字由 check-coverage 自己输出）");
  }
}

report.forEach(l => console.log("  · " + l));
console.log("──────────────────────────────────────────────────────────");
if (problems.length){
  console.log("  ✗ " + problems.length + " 处文档漂移：");
  problems.forEach(p => console.log("      · " + p));
  console.log("  修法：索引行号 → `node tools/gen-index.js --write`；"
    + "耗时 / 覆盖率现状 → 删掉数字，改指命令输出（`check-all` 与 `check-coverage` 自己会打印）；"
    + "归档状态 → 给文档正文补一行状态横幅；"
    + "审计快照 → 给 spec.md / tasks.md / checklist.md 补「" + SNAPSHOT_MARKER + "」一行；"
    + "README 版本号 → 与 index.html 的 VERSION 对齐；"
    + "自验步数 → 与 tools/check-all.js 的 STEPS 条目数对齐。");
  process.exit(1);
}
console.log("  ✓ 文档一致（索引行号 / 无手写耗时 / 归档状态 / 审计快照 /"
  + " README 版本号 / 自验步数 / 无手写覆盖率现状）");
process.exit(0);
