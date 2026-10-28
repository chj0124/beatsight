#!/usr/bin/env node
/* 反向验证 T271：回退两列网格与技巧下拉的收缩约束，必须命中具名断言。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-editor-popover.html");
const oldRule = ".ed-str .str-lines{display:grid;width:100%;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,auto);grid-auto-flow:column;gap:8px 12px}";
const mut = orig.replace(oldRule,
  ".ed-str .str-lines{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,auto);grid-auto-flow:column;gap:8px 12px}");
if (mut === orig){ console.error("锚点失配：网格规则未命中"); process.exit(2); }
fs.writeFileSync(TMP, mut);
const r = spawnSync(process.execPath, ["tests/cases/t271-editor-popover-layout.js"], {
  cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
});
const out = (r.stdout || "") + (r.stderr || "");
const failed = out.split("\n").filter(x => x.trim().startsWith("✗"));
try { fs.rmSync(TMP, { force: true }); } catch (e) {}
if (failed.some(x => x.includes("两列 minmax") || x.includes("网格作为 flex 子项"))){
  console.log(failed.join("\n"));
  console.log("✓ 回退后命中具名布局断言");
  process.exit(0);
}
console.error("未出现预期具名断言；exit=" + r.status);
process.exit(1);
