/* BeatSight 自动化测试 · 设计令牌闸门（PLAN-v16）
   T268 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★ 为什么要有这一组：tools/check-design-tokens.js 是 PLAN-v16 新增的闸门
     （R1 令牌契约 / R2 间距基线冻结 / R3 胶囊写法硬红线 / R4 主题纪律）。
     闸门本身不跑在浏览器里，本组直接以**合成 CSS 样本**驱动它的导出函数：
     判红路径（缺令牌 / 值漂移 / 基线外新增 / 999px / obs 定义布局令牌）与判绿路径
     （干净样本、真实 index.html 全量通过）都要有具名断言，防止闸门静默失效——
     「闸门坏了还亮绿灯」比没有闸门更危险。

   ★ 与 reverse-verify-t268 的分工：那边验证「回退变异会让 CLI 判红」（进程级、
     只改 /tmp 副本）；这边验证「导出函数对各类违规各自报出**正确名字**」（函数级）。
     两层合起来才是完整的反向护栏。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ok, section } = require("../lib/harness");
const gate = require("../../tools/check-design-tokens.js");

const HTML_PATH = process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

const wrap = css => "<!DOCTYPE html><html><head><style>" + css + "</style></head><body></body></html>";
const FULL_TOKENS = Object.entries(gate.TOKEN_CONTRACT).map(([n, v]) => n + ":" + v).join(";");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bs-t268-"));
let seq = 0;
const runOn = css => {
  const p = path.join(tmp, "s" + (++seq) + ".html");
  fs.writeFileSync(p, wrap(css));
  return gate.run({ file: p });
};

/* ---- R1：真实 index.html 的令牌全集 ---- */
section("T268 · R1 令牌契约 — 真实样式表名值对齐");
const realCss = gate.extractCss(HTML);
for (const [name, val] of Object.entries(gate.TOKEN_CONTRACT)){
  ok(realCss.includes(name + ":" + val), "★ " + name + " 定义为 " + val + "（契约值钉死）");
}

/* ---- 行为：判绿路径 ---- */
section("T268 · 判绿路径 — 干净样本与真实全量");
{
  const clean = ":root{" + FULL_TOKENS + "}"
    + ".a{margin:0;padding:var(--sp-2);gap:var(--sp-1);border-radius:var(--radius-full)}"
    + 'body[data-theme="obs"]{--bg:#F2F4F8;color:var(--t1)}';
  const r = runOn(clean);
  ok(r.ok, "★ 干净样本（令牌引用 + obs 纯颜色覆盖）判绿");
  ok(r.problems.length === 0, "★ 干净样本零具名违规");
}
{
  const r = gate.run({ file: HTML_PATH });
  ok(r.ok, "★ 真实 index.html 全量通过（闸门与现状一致，防\"闸门坏了亮绿灯\"）");
}

/* ---- 行为：判红路径（每种违规都有具名 ✗） ---- */
section("T268 · 判红路径 — R1 缺失/漂移");
{
  const r = runOn(":root{" + FULL_TOKENS.replace("--sp-2:8px;", "--sp-2x:8px;") + "}");
  ok(!r.ok && r.problems.some(p => p.includes("R1 令牌缺失") && p.includes("--sp-2")),
    "★ 令牌被改名 → 具名报「R1 令牌缺失 --sp-2」");
}
{
  const r = runOn(":root{" + FULL_TOKENS.replace("--sp-2:8px", "--sp-2:9px") + "}");
  ok(!r.ok && r.problems.some(p => p.includes("R1 令牌漂移") && p.includes("--sp-2")),
    "★ 令牌值漂移 8→9 → 具名报「R1 令牌漂移 --sp-2」");
}

section("T268 · 判红路径 — R2 基线外新增");
{
  const css = ":root{" + FULL_TOKENS + "}.a{gap:9px;padding:var(--sp-1)}";
  const r = runOn(css);
  ok(!r.ok && r.problems.some(p => p.includes("R2 基线外间距") && p.includes("gap:9px")),
    "★ 新增裸 gap:9px → 具名报「R2 基线外间距」");
}

section("T268 · 判红路径 — R3 胶囊写法硬红线");
{
  const r = runOn(":root{" + FULL_TOKENS + "}.a{border-radius:999px}.b{border-radius:99px}");
  ok(!r.ok && r.problems.filter(p => p.includes("R3 胶囊写法")).length >= 1,
    "★ 999px / 99px 各一处 → 具名报「R3 胶囊写法」（无观察期）");
}

section("T268 · 判红路径 — R4 主题纪律");
{
  const r = runOn(':root{' + FULL_TOKENS + '}body[data-theme="obs"]{--sp-2:6px}');
  ok(!r.ok && r.problems.some(p => p.includes("R4 主题纪律") && p.includes("--sp-2")),
    "★ obs 块定义布局令牌 → 具名报「R4 主题纪律」");
}
{
  /* obs 布局度量走 obs 桶（含 @media 嵌套内的 obs 规则），不落入普通间距桶 */
  const scan = gate.scanDecls(gate.extractCss(HTML));
  ok(scan.obs.length > 0, "★ 真实样式表的 obs 布局度量已入 obs 桶（" + scan.obs.length + " 条，D7 后应收敛）");
  ok(scan.obsTokenHits.length === 0, "★ 真实样式表 obs 块未定义任何布局令牌");
}

section("T268 · 基线台账 — 存在、有序、与现状自洽");
{
  const base = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "design-token-baseline.json"), "utf8"));
  const sorted = a => a.every((x, i) => i === 0 || a[i - 1] <= x);
  ok(Array.isArray(base.spacing) && sorted(base.spacing), "★ 间距台账存在且有序（" + base.spacing.length + " 条）");
  ok(Array.isArray(base.radius) && sorted(base.radius), "★ 圆角台账存在且有序（" + base.radius.length + " 条）");
  ok(Array.isArray(base.obs), "★ obs 台账存在（" + base.obs.length + " 条）");
  const scan = gate.scanDecls(realCss);
  ok(newSpacing(scan.spacing, base.spacing).length === 0
    && newSpacing(scan.radius, base.radius).length === 0
    && newSpacing(scan.obs, base.obs).length === 0,
    "★ 台账覆盖现状零缺口（基线外新增 = 0，与 CLI 判绿互证）");
}
function newSpacing(cur, base){
  return cur.filter(k => !base.includes(k));
}

/* 清理临时样本目录 */
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmpdir 清理失败不判红 */ }
