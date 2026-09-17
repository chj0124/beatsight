/* 模块索引生成 / 校验器（v2.0.5，审计 P0-6，零依赖）
   ---------------------------------------------------------------------------
   背景：index.html 头部有一份「模块索引」（短名 + 绝对行号 + 一句话职责），它自己的注释写着
   「行号为 index.html 绝对行号，仅作文件内导航；在其之前增删代码后需整体重算」。
   靠人记 = 一定会烂。v2.0.4 全维度审计实测：**16 条行号全部偏移，最大 59 行**
   （索引写 L2223 Viz，实际 L2282；写 L5277 初始化，实际 L5309），而没有任何检查器会去核对
   注释里的数字——闸门能把代码盘干净，唯独盘不了文档与注释。索引一旦不可信，它就从导航
   退化成噪音（按它跳转会落到别的模块中间）。

   做法与 check-dom-ids / check-version 同一思路：人眼核对过一次的结论，不该反复靠人眼。
   把索引变成**生成物**——行号不再手写，而是从实际 banner 反算：

     node tools/gen-index.js          # 只校验：漂移就列出差异并退出 1（check-all 里的那一步）
     node tools/gen-index.js --write   # 回写行号（短名与描述原样保留，只重算 L 后面那个数）

   匹配规则：短名与 banner 文本按**同一个 key**对齐，key = 文本里首个「·」或「（」之前的部分。
   于是索引的「Store」对上 banner 的「Store · 持久化 / 状态 / 导入导出」，
   「共享状态」对上「共享状态（跨模块可变状态集中声明于此）」，「初始化（装配）」对上「初始化（装配）」。
   这样短名可以继续由人微调措辞，而不会被生成器覆盖掉。

   条目数不一致时**只报错、不猜**（新增模块 → 让人补一条索引；删掉模块 → 让人删那条）。
   理由同 LIMIT_PRESETS 那套"表写错是开发期错误"：生成器替人编一条描述，等于把噪音固化进文件。

   退出码 0 = 一致，1 = 有漂移。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* 模块 banner 的单行形式：注释起止符夹着「= 若干 = 短名 = 若干 =」，例如
   「 /* ================= 数据 ================= * / 」（此处为了不在注释里写出闭合符，
   把两侧符号加了空格；文件里它们是紧挨着的，见 BANNER_RE）。
   注意必须要求"单行闭合"，否则会把 L428 / L1057 那种纯分隔线（只有左半边、内容在下一行）
   一起收进来——那两处不是模块，是分区装饰 */
const BANNER_RE = /^\/\* ={3,} (.+?) ={3,} \*\/$/;
/* 索引条目：缩进 + L<数字> + 空白 + 其余（短名与描述连在一起，原样保留） */
const ENTRY_RE = /^(\s*)L(\d+)(\s+)(.*)$/;

/** 取对齐用 key：首个「 · 」或「（」之前的部分。@param {string} text @returns {string} */
function keyOf(text){
  return String(text).split(" · ")[0].split("（")[0].split("(")[0].trim();
}

/** 索引条目里「短名」的取法：整行第一个空白段（格式为 `L行号  短名<空白>描述`）。
 *  再用 keyOf 归一，好与 banner 对齐——例如条目写「初始化（装配）」、banner 写「初始化（装配）」，
 *  两边都归一到「初始化」。@param {string} rest @returns {string} */
function labelOf(rest){
  return String(rest).trim().split(/\s+/)[0] || "";
}

/**
 * 解析一份 index.html：模块 banner 清单 + 索引条目清单。
 * @param {string} src @returns {{ lines: string[], banners: {line:number,text:string,key:string}[],
 *   entries: {idx:number,line:number,label:string,key:string,raw:string}[], blockStart: number, blockEnd: number }}
 */
function analyze(src){
  const lines = src.split("\n");
  /* ⚠ 本仓库的 index.html 是 **CRLF** 行尾，而正则里的 `.` 不匹配 `\r`——
     直接把原始行喂给 /(.*)$/ 会永远匹配失败（条数一直是 0，且静默）。
     所以匹配一律走 noCR（去掉行尾 \r），而 entries 里存的是**原始行**（含 \r），
     回写时只替换 L 后面那个数，行尾不动。 */
  const noCR = lines.map(l => l.replace(/\r$/, ""));
  const banners = [];
  noCR.forEach((ln, i) => {
    const m = BANNER_RE.exec(ln.trim());
    if (m) banners.push({ line: i + 1, text: m[1], key: keyOf(m[1]) });
  });

  /* 索引块只在「模块索引」与「边界规则」之间找。不加这个窗口，全文件任何以
     `L数字 ` 开头的行（例如注释里给同行加的行号旁注）都会被抓成索引条目 */
  const blockStart = noCR.findIndex(l => /模块索引/.test(l));
  const blockEnd = blockStart < 0 ? -1 : noCR.findIndex((l, i) => i > blockStart && /边界规则/.test(l));
  const entries = [];
  if (blockStart >= 0 && blockEnd > blockStart){
    for (let i = blockStart + 1; i < blockEnd; i++){
      const m = ENTRY_RE.exec(noCR[i]);
      if (m){
        const label = labelOf(m[4]);
        entries.push({ idx: i, line: +m[2], label, key: keyOf(label), raw: lines[i] });
      }
    }
  }
  return { lines, banners, entries, blockStart, blockEnd };
}

/**
 * 比对，返回问题清单（空 = 一致）。
 * @param {ReturnType<typeof analyze>} a @returns {string[]}
 */
function diff(a){
  const problems = [];
  if (a.blockStart < 0 || a.blockEnd <= a.blockStart){
    problems.push("找不到模块索引块（应位于「模块索引」与「边界规则」两行之间）");
    return problems;
  }
  if (a.entries.length !== a.banners.length){
    problems.push(`条目数不符：索引 ${a.entries.length} 条，实际模块 banner ${a.banners.length} 个`
      + "——新增/删除模块时同改索引（生成器不替人编描述）");
    return problems;
  }
  a.banners.forEach((b, i) => {
    const e = a.entries[i];
    if (e.key !== b.key){
      problems.push(`第 ${i + 1} 条对不上：索引写的短名是「${e.label}」，而第 ${i + 1} 个 banner 是「${b.key}」`
        + `（banner 在第 ${b.line} 行）——多半是模块被移动/改名/插队后索引没跟着改`);
      return;
    }
    if (e.line !== b.line){
      problems.push(`${b.key}：索引写 L${e.line}，实际 banner 在 L${b.line}（偏 ${b.line - e.line} 行）`);
    }
  });
  return problems;
}

/**
 * 回写行号（只动 L 后面那个数，其余字节原样保留）。
 * 位数变化时补偿其后空白，保证短名列仍然对齐。
 * @param {string} src @returns {string}
 */
function rewrite(src){
  const a = analyze(src);
  const out = a.lines.slice();
  a.banners.forEach((b, i) => {
    const e = a.entries[i];
    const oldTok = "L" + e.line;
    const newTok = "L" + b.line;
    const delta = newTok.length - oldTok.length;            // 位数变化 → 吃掉/补上等量空格
    const gap = /^L\d+(\s+)/.exec(e.raw);
    const spaces = gap ? gap[1] : "  ";
    const fixed = delta > 0
      ? (spaces.length > delta ? spaces.slice(delta) : "")
      : spaces + " ".repeat(-delta);
    out[e.idx] = e.raw.replace(oldTok + spaces, newTok + fixed);
  });
  return out.join("\n");
}

module.exports = { analyze, diff, rewrite, keyOf };

/* ---- CLI ---- */
if (require.main === module){
  const args = process.argv.slice(2);
  const WRITE = args.includes("--write");
  const htmlArg = args.find(x => !x.startsWith("--"));
  const HTML = htmlArg ? path.resolve(htmlArg) : path.join(ROOT, "index.html");
  const src = fs.readFileSync(HTML, "utf8");
  const a = analyze(src);
  const problems = diff(a);

  console.log("══════════════════════════════════════════════════════════");
  console.log("  模块索引一致性（index.html 头部索引 ↔ 实际 banner 行号）");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  · 模块 banner ${a.banners.length} 个 · 索引条目 ${a.entries.length} 条`
    + ` · 索引块 L${a.blockStart + 1}–L${a.blockEnd + 1}`);

  if (!problems.length){
    console.log("  ✓ 一致（行号与 banner 逐条对齐）");
    process.exit(0);
  }
  if (WRITE && a.entries.length === a.banners.length && problems.every(p => /偏 \d+ 行/.test(p))){
    fs.writeFileSync(HTML, rewrite(src));
    console.log("  ✓ 已回写 " + problems.length + " 条行号（短名与描述未动）");
    console.log("    改动前：" + problems.slice(0, 3).join("；"));
    process.exit(0);
  }
  console.log("  ✗ " + problems.length + " 处不一致：");
  problems.forEach(p => console.log("      · " + p));
  console.log(a.entries.length === a.banners.length
    ? "  修法：node tools/gen-index.js --write（只重算行号）"
    : "  修法：先按同样格式补/删索引条目，再跑 node tools/gen-index.js --write");
  process.exit(1);
}
