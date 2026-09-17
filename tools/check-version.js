/* 版本一致性闸门（v2.0.2，审计 D4，零依赖）
   ---------------------------------------------------------------------------
   背景：VERSION 是版本号的唯一真相源（v1.3.0 起 <title> / 品牌区 / chip 三处由它派生），
   但审计发现**它自己会漂移**——代码注释里已写满 `v2.0.2` 的改动说明，而 VERSION 仍停在 2.0.1。
   「注释说已修复、版本号说没有」这件事用户看不出来，开发者却会被它误导（以为改动已经发了）。
   发版规则（v1.6.4 起）要求「每次发版都 bump 这一行」，此前这条纪律只靠人记，
   这里把它固化成机器检查——和 check-dom-ids 同样的思路：人眼核对过一次的结论不该反复靠人眼。

   四项检查：
     1) index.html 里存在 `const VERSION = "x.y.z"` 且是合法 semver；
     2) CHANGELOG.md 的首条 `## vX.Y.Z` 必须**等于** VERSION（发了版就要有记录，且记录与代码一致）；
     3) index.html 全文出现的 `vX.Y.Z` 字面量**不得高于** VERSION
        （高于 = 代码已含该版改动却没 bump VERSION，正是 D4 要拦的那种漂移）。
     4) package.json 的 version 必须**等于** VERSION（v2.0.6，审计 P1-8）——它是同一事实的
        第二份手抄，此前无人核对。

   为什么第 3 项是「不高于」而不是「必须相等」：注释里引用历史版本（形如「v1.6.0 修」）
   是合理且有信息量的写法，不该被禁；真正有问题的是引用一个**还没发**的版本号。

   退出码 0 = 一致，1 = 有漂移。

   可选参数：`node tools/check-version.js <index.html 路径>`（与 check-dom-ids.js 同一约定）
   ——反向验证用：拿一份改坏 VERSION 的副本喂进来应当退出 1，证明确实拦得住。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = process.argv[2] || path.join(ROOT, "index.html");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

const semver = s => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s || "");
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

console.log("══════════════════════════════════════════════════════════");
console.log("  版本一致性（VERSION 唯一真相源）");
console.log("══════════════════════════════════════════════════════════");

const html = fs.readFileSync(HTML, "utf8");
const changelog = fs.readFileSync(CHANGELOG, "utf8");
const problems = [];

/* 1) VERSION 存在且为合法 semver */
const vm = /const\s+VERSION\s*=\s*"([^"]+)"/.exec(html);
const ver = vm ? semver(vm[1]) : null;
if (!ver){
  problems.push(vm
    ? `index.html 的 VERSION "${vm[1]}" 不是 x.y.z 形式的 semver`
    : 'index.html 里找不到 `const VERSION = "x.y.z"`');
} else {
  console.log(`  · VERSION = ${vm[1]}（index.html L${lineOf(html, vm.index)}）`);
}

/* 2) CHANGELOG 首条必须与 VERSION 同名 */
const cm = /^##\s+v(\d+\.\d+\.\d+)\b/m.exec(changelog);
if (!cm){
  problems.push("CHANGELOG.md 里找不到形如 `## vX.Y.Z` 的条目");
} else if (ver && cmp(semver(cm[1]), ver) !== 0){
  problems.push(`CHANGELOG 首条是 v${cm[1]}，而 VERSION 是 ${vm[1]}`
    + "——发版必须同时补 CHANGELOG 记录并 bump VERSION");
} else if (ver){
  console.log(`  · CHANGELOG 首条 = v${cm[1]}（与 VERSION 一致）`);
}

/* 3) 全文版本字面量不得高于 VERSION */
const seen = new Map();                                   // "x.y.z" → 首次出现的行号
{
  const re = /\bv(\d+\.\d+\.\d+)\b/g;
  let m;
  while ((m = re.exec(html))){
    if (!seen.has(m[1])) seen.set(m[1], lineOf(html, m.index));
  }
}
if (ver){
  const higher = [...seen.entries()].filter(([v]) => cmp(semver(v), ver) > 0);
  if (higher.length){
    higher.forEach(([v, ln]) => problems.push(
      `index.html L${ln} 引用了 v${v}，高于当前 VERSION ${vm[1]}——代码已含该版改动却没 bump？`));
  } else if (seen.size){
    const top = [...seen.keys()].sort((a, b) => cmp(semver(a), semver(b))).pop();
    console.log(`  · 全文版本字面量 ${seen.size} 个，最高 v${top}（未超过 VERSION）`);
  }
}

/* 4) package.json 的 version 必须与 VERSION 一致（v2.0.6，审计 P1-8）
   为什么补这项：package.json / package-lock.json 里各有一个 version，与 index.html 的 VERSION
   是**同一个事实的第二、第三份手抄**，而此前没有任何检查器在读它们（grep "package" 在旧版本里
   零命中）。它们的用途不同（npm 元信息 vs 运行时真相源），所以不能合并成一个，
   只能靠这条闸门保证三者同步——发版时忘了改 package.json，从此就会被拦下来。 */
{
  const pkgPath = path.join(ROOT, "package.json");
  try{
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const pv = semver(pkg.version);
    if (!pv){
      problems.push(`package.json 的 version "${pkg.version}" 不是 x.y.z 形式的 semver`);
    } else if (ver && cmp(pv, ver) !== 0){
      problems.push(`package.json 的 version 是 ${pkg.version}，而 index.html 的 VERSION 是 ${vm[1]}`
        + "——发版要同时改这两处（外加 CHANGELOG 首条）");
    } else if (ver){
      console.log(`  · package.json version = ${pkg.version}（与 VERSION 一致）`);
    }
  }catch(e){
    problems.push("package.json 读不到或不是合法 JSON：" + (e && e.message ? e.message : e));
  }
}

console.log("──────────────────────────────────────────────────────────");
if (problems.length){
  console.log("  ✗ " + problems.length + " 处版本漂移：");
  problems.forEach(p => console.log("      · " + p));
  console.log("  修法：把 index.html 的 VERSION bump 到本次版本号，并在 CHANGELOG.md 顶部补一条同名条目。");
  process.exit(1);
}
console.log("  ✓ 版本号一致（VERSION / CHANGELOG / 代码注释）");
process.exit(0);
