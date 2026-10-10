/* BeatSight 自动化测试 · 品牌资产一致性（v3.43.0，换标）
   T235 系列。
   ---------------------------------------------------------------------------
   由来：v3.43.0 换标（摆锤节拍器 → 绿底三时值块，定稿 docs/archive/beatsight-vi-manual.html）。
   标志同时活在四处，任何一处单独漂移都会让"线上一个牌、仓库一个牌"：
     ① icon.svg —— PWA/在线版矢量源（构建期再由 tools/gen-icons.js 光栅化成 4 个 PNG 回退）
     ② index.html 头部 favicon —— data URI，file:// 直开时浏览器标签页显示的那个
     ③ tools/gen-icons.js —— 手写光栅化，其注释声称"与 icon.svg 同一组坐标"，这条要机器盯
     ④ docs/archive/ 两份品牌文档 —— VI 手册 + 展板（归档横幅与 docs/README 登记表）
   钉住的契约：四处均为「绿底 #1ED760 + 窄-宽-窄三块（9x:18x:9x）」的同一组几何
   （VI 64 网格制图：外框 rx 14 / 块 y 24 h 14 rx 4 / 左右内边距 10 / 块间距 4）。
   icon.svg 与 gen-icons 用 512 视口（×8），favicon 用 64 视口——换算关系也一并钉死，
   改任何一处坐标而不同步其余两处，本用例当场红。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { ok, eq, section, html } = require("../lib/harness");

const ROOT = path.join(__dirname, "..", "..");
const iconSvg = fs.readFileSync(path.join(ROOT, "icon.svg"), "utf8");
const genIcons = fs.readFileSync(path.join(ROOT, "tools", "gen-icons.js"), "utf8");
const docsIdx = fs.readFileSync(path.join(ROOT, "docs", "README.md"), "utf8");

/* 解析 <rect>（属性序无关） */
function rectsOf(src){
  return [...src.matchAll(/<rect([^>]*)\/>/g)].map(m => {
    const attr = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attr[a[1]] = a[2];
    return attr;
  });
}
const num = s => +s;

section("T235 品牌标志 · icon.svg 几何（制图唯一真相源）");
{
  const rs = rectsOf(iconSvg);
  eq(rs.length, 4, "恰好 4 个 rect（1 底 + 3 块）");
  const bg = rs.filter(r => (r.fill || "").toUpperCase() === "#1ED760");
  const blocks = rs.filter(r => (r.fill || "").toUpperCase() === "#0A0A0A");
  eq(bg.length, 1, "品牌绿底恰 1 块");
  eq(blocks.length, 3, "品牌墨时值块恰 3 块");
  if (bg.length === 1){
    eq(num(bg[0].width), 512, "底满幅宽 512");
    eq(num(bg[0].height), 512, "底满幅高 512");
    eq(num(bg[0].rx), 112, "底圆角 112（= 64 网格 14x × 8）");
  }
  if (blocks.length === 3){
    const xs = blocks.map(b => num(b.x));
    const ws = blocks.map(b => num(b.width));
    eq(ws[1], ws[0] * 2, "中块宽 = 窄块 × 2（9x:18x:9x 切分律动，中心为重拍）");
    eq(ws[2], ws[0], "两窄块等宽");
    const gap1 = xs[1] - (xs[0] + ws[0]);
    const gap2 = xs[2] - (xs[1] + ws[1]);
    eq(gap1, 32, "块间距 32（= 4x × 8）");
    eq(gap2, gap1, "两处块间距相等");
    eq(xs[0], 512 - (xs[2] + ws[2]), "左右内边距对称（各 80 = 10x × 8）");
    const ys = blocks.map(b => num(b.y));
    const hs = blocks.map(b => num(b.height));
    ok(ys.every(y => y === ys[0]), "三块同 y");
    ok(hs.every(h => h === hs[0]), "三块同高");
    eq(ys[0], 192, "块带 y 192（= 24x × 8，VI 制图规格）");
    eq(hs[0], 112, "块高 112（= 14x × 8）");
    ok(blocks.every(b => num(b.rx) === 32), "块圆角 32（= 4x × 8）");
  }
}

section("T235b favicon 同源坐标（icon.svg ÷ 8 = 64 网格）");
{
  const m = /<link rel="icon" href="data:image\/svg\+xml,([^"]+)">/.exec(html);
  ok(!!m, "index.html 头部存在 favicon data URI");
  const fav = m ? m[1] : "";
  ok(fav.includes("%231ED760"), "favicon 底为品牌绿 #1ED760");
  ok(fav.includes("%230A0A0A"), "favicon 块为品牌墨 #0A0A0A");
  const blocks = rectsOf(iconSvg).filter(r => (r.fill || "").toUpperCase() === "#0A0A0A");
  blocks.forEach(b => {
    ["x", "y", "width", "height", "rx"].forEach(k => {
      const expect = num(b[k]) / 8;
      ok(fav.includes(k + "='" + expect + "'"),
        "favicon 含 " + k + "='" + expect + "'（icon.svg " + k + "=" + b[k] + " ÷ 8）");
    });
  });
  ok(fav.includes("rx='14'"), "favicon 底圆角 14（64 网格）");
  /* 顶栏 .brand 的内联标志是应用内最显眼的品牌触点，与 favicon 同一组 64 网格坐标
     （v3.43.0 换标时它也曾是唯一漏网的内联旧标——t235 首跑当场抓出，故单独钉住） */
  ok(/<svg width="26" height="26" viewBox="0 0 64 64"[^>]*><rect width="64" height="64" rx="14" fill="#1ED760"/.test(html),
    "顶栏 .brand 内联标志同为 64 网格新标（in-app 触点不落单）");
  ok(!html.includes("M9 3h10"), "旧摆锤标志 path 已从 index.html 清除");
}

section("T235e 顶栏锁定字标（v3.43.0 第二批：字标 + i 字点节拍球）");
{
  const mWm = /<svg class="wm" viewBox="1 114 461 112" aria-hidden="true"><path d="([^"]+)" fill="currentColor"\/><circle cx="288\.69" cy="128\.91" r="10\.5" fill="var\(--green\)"\/><\/svg>/.exec(html);
  ok(!!mWm, "顶栏锁定字标在位（viewBox 461:112 + currentColor + 节拍球 var(--green)）");
  if (mWm){
    const man = fs.readFileSync(path.join(ROOT, "docs", "archive", "beatsight-vi-manual.html"), "utf8");
    const mMan = /<path d="(M38\.09 200[^"]+)" fill="currentColor"/.exec(man);
    ok(!!mMan, "VI 手册登记的锁定字标可读取");
    if (mMan) ok(mWm[1] === mMan[1],
      "字标 path 与 VI 手册登记版逐字节一致（" + mWm[1].length + " 字符）——描摹 path 压缩小数位即失配");
  }
  ok(/<span class="sr-only">BeatSight 时值节拍器<\/span>/.test(html),
    "h1 可访问名保住：sr-only「BeatSight 时值节拍器」（v3.44.0 起顶栏纯锁版，可见文案移除）");
  ok(!/\.brand svg (?:path|line|circle)\{/.test(html),
    "旧摆锤的三条日间重着色规则已退役（留着会把字标整体染蓝、把球抹成背景色）");
}

section("T235c gen-icons.js 光栅化同源（PNG 回退不能是另一个牌）");
{
  ok(genIcons.includes("[[80, 72], [184, 144], [360, 72]]"), "三块 512 坐标与 icon.svg 一致");
  ok(genIcons.includes("Y(192)"), "块带 y 用 Y(192)（与 icon.svg 同坐标）");
  ok(genIcons.includes("112 * sc"), "底圆角按 112× 缩放同源");
  ok(genIcons.includes("32 * sc"), "块圆角按 32× 缩放同源");
  ok(genIcons.includes("[30, 215, 96]"), "光栅化绿 = #1ED760");
  ok(genIcons.includes("[10, 10, 10]"), "光栅化墨 = #0A0A0A");
  ok(!genIcons.includes("[196, 96]"), "旧摆锤梯形坐标已从光栅化清除");
}

section("T235d 品牌文档在册（docs/archive + docs/README 快照表）");
{
  const board = path.join(ROOT, "docs", "archive", "beatsight-brand-board.html");
  const manual = path.join(ROOT, "docs", "archive", "beatsight-vi-manual.html");
  ok(fs.existsSync(board), "视觉展板已落盘 docs/archive/");
  ok(fs.existsSync(manual), "VI 手册已落盘 docs/archive/");
  for (const f of [board, manual]){
    if (!fs.existsSync(f)) continue;
    /* 归档横幅插在 <body> 起始处（两份文件均在 CSS 之后、约 L185-230），取前 260 行足够 */
    const head = fs.readFileSync(f, "utf8").split("\n").slice(0, 260).join("\n");
    ok(head.includes("历史快照") && head.includes("已落地"),
      path.basename(f) + " 开头带「历史快照 · 已落地」归档横幅");
  }
  ok(docsIdx.includes("(archive/beatsight-brand-board.html)"), "展板登记于 docs/README 快照表");
  ok(docsIdx.includes("(archive/beatsight-vi-manual.html)"), "VI 手册登记于 docs/README 快照表");
  /* banner 双主题图：换标后必须仍在位且为合法 PNG（内容级换标由构建期产物与人眼验收把守，
     本用例只守"文件没被删/没坏"这层底线） */
  for (const f of ["banner-dark.png", "banner-light.png"]){
    const p = path.join(ROOT, "docs", "assets", f);
    if (!fs.existsSync(p)){ ok(false, f + " 存在"); continue; }
    const b = fs.readFileSync(p);
    ok(b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71, f + " 为合法 PNG（魔数）");
  }
}
