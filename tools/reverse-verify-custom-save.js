#!/usr/bin/env node
/* 反向验证 T272：覆盖保存若丢原 ID，曲式引用必须出现具名失败。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const orig = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const TMP = path.join(os.tmpdir(), "mut-custom-save.html");
const anchor = 'const id = (src && typeof src.id === "string") ? src.id : "c" + Date.now();';
const mut = orig.replace(anchor, 'const id = "c" + Date.now();');
if (mut === orig){ console.error("锚点失配：保存 ID 规则未命中"); process.exit(2); }
fs.writeFileSync(TMP, mut);
const r = spawnSync(process.execPath, ["tests/cases/t272-custom-overwrite-save.js"], {
  cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
});
const out = (r.stdout || "") + (r.stderr || "");
const failed = out.split("\n").filter(x => x.trim().startsWith("✗"));
try { fs.rmSync(TMP, { force: true }); } catch (e) {}
if (failed.some(x => x.includes("原 ID 保留"))){
  console.log(failed.join("\n"));
  console.log("✓ 丢失原 ID 后命中覆盖保存与曲式引用断言");
  process.exit(0);
}
console.error("未出现预期断言；exit=" + r.status + "\n" + failed.join("\n"));
process.exit(1);
