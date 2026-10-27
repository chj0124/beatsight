#!/usr/bin/env node
/* 反向变异验证（T268 · 设计令牌闸门）。用法：node tools/reverse-verify-t268-gate.js

   四个变异各自攻破一条规则，对 tools/check-design-tokens.js 的具名 ✗ 必须出现：
     M1 令牌改名（--sp-2 → --sp-2x）→「R1 令牌缺失 —— --sp-2」；
     M2 新增裸间距（gap:9px）→「R2 基线外间距 —— gap:9px」；
     M3 胶囊写法回潮（999px）→「R3 胶囊写法」；
     M4 obs 块定义布局令牌（--sp-3）→「R4 主题纪律」。
   外加一道对照：未变异副本必须判绿（exit 0）——否则说明闸门连基线自身都不认，红灯无意义。
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
const TMP = path.join(os.tmpdir(), "mut-t268-gate.html");
const GATE = ["tools/check-design-tokens.js", "--file=" + TMP];

/* 每条变异 = [名称, 变异函数, 必须出现在 stderr/stdout 的具名 ✗ 片段] */
const MUTANTS = [
  ["M1 令牌改名 → R1 缺失", s => s.replace("--sp-2:8px;", "--sp-2x:8px;"),
    ["R1 令牌缺失", "--sp-2"]],
  ["M2 新增裸间距 → R2 基线外", s => s.replace(
    ".card{background:var(--card);border-radius:12px;padding:24px}",
    ".card{background:var(--card);border-radius:12px;padding:24px;gap:9px}"),
    ["R2 基线外间距", "gap:9px"]],
  ["M3 胶囊 999px 回潮 → R3 硬红线", s => s.replace(
    ".set-tab{flex:none;padding:6px 18px;border-radius:var(--radius-full);",
    ".set-tab{flex:none;padding:6px 18px;border-radius:999px;"),
    ["R3 胶囊写法", "999px"]],
  ["M4 obs 定义布局令牌 → R4 主题纪律", s => s.replace(
    'body[data-theme="obs"]{\n  --bg:#F2F4F8;',
    'body[data-theme="obs"]{\n  --sp-2:6px;\n  --bg:#F2F4F8;'),
    ["R4 主题纪律", "--sp-2"]],
];

let hitN = 0, missN = 0;

/* 对照组：未变异副本判绿（锚点自洽性） */
fs.writeFileSync(TMP, orig);
const ctrl = spawnSync(process.execPath, GATE, { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
console.log("=".repeat(72));
console.log("对照：未变异副本 exit=" + ctrl.status + "（期望 0）");
if (ctrl.status === 0) { console.log("  ✓ 闸门对基线自身判绿"); hitN++; }
else { console.log("  ✗ 未变异副本被误判（stderr 前 5 行）"); (ctrl.stderr || "").split("\n").slice(0, 5).forEach(l => console.log("    " + l)); missN++; }

for (const [name, fn, keys] of MUTANTS) {
  const mut = fn(orig);
  if (mut === orig) {
    console.log("=".repeat(72));
    console.log("!! 变异未生效（锚点失配）：" + name);
    missN++;
    continue;
  }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, GATE, { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
  const out = (r.stdout || "") + (r.stderr || "");
  console.log("=".repeat(72));
  console.log("变异：" + name + "  exit=" + r.status + "（期望 1）");
  const named = keys.every(k => out.includes(k));
  if (r.status === 1 && named) {
    const line = out.split("\n").find(l => l.includes("✗") && keys[0] && l.includes(keys[0])) || "";
    console.log("  ✗ " + line.trim().slice(0, 110));
    console.log("  ✓ 具名违规出现：" + keys.join(" ∧ "));
    hitN++;
  } else {
    console.log("  ⚠ 未出现具名违规（exit=" + r.status + "，输出前 8 行）：");
    out.split("\n").slice(0, 8).forEach(l => console.log("    " + l));
    missN++;
  }
}

try { fs.rmSync(TMP, { force: true }); } catch (e) { /* 临时文件清理失败不判红 */ }
console.log("=".repeat(72));
console.log("汇总：" + hitN + " 命中 / " + missN + " 失配（命中 = 闸门对该变异报出正确名字的 ✗）");
process.exit(missN ? 1 : 0);
