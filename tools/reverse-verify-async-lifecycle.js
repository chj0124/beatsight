#!/usr/bin/env node
/* 反向验证：SW 写缓存生命周期与 PWA 拒绝后按钮收口必须在临时副本上命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const TMP_SW = path.join(os.tmpdir(), "mut-async-lifecycle-sw.js");
const TMP_HTML = path.join(os.tmpdir(), "mut-async-lifecycle.html");

function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
function failures(file, env){
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter(line => line.trim().startsWith("✗"));
  return { crashed: r.status !== 0, failed };
}
const MUTANTS = [
  ["M1 SW 导航与静态写缓存脱离事件生命周期", () => {
    const src = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    let out = once(src, "if (r.ok) e.waitUntil(putCache(e.request, r.clone()));",
      "if (r.ok) putCache(e.request, r.clone());", "M1 导航");
    out = once(out, "e.waitUntil(swr.write.catch(() => {}));",
      "swr.write.catch(() => {});", "M1 静态");
    fs.writeFileSync(TMP_SW, out);
  }, "tests/cases/t67-service-worker.js", { BEATSIGHT_SW: TMP_SW }, ["已注册 waitUntil"]],
  ["M2 PWA userChoice 拒绝后不刷新按钮", () => {
    const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const out = once(src, "p.userChoice.then(settle).catch(settle);",
      "p.userChoice.then(settle).catch(() => { deferredPrompt = null; });", "M2");
    fs.writeFileSync(TMP_HTML, out);
  }, "tests/cases/t274-async-lifecycle.js", { BEATSIGHT_HTML: TMP_HTML }, ["userChoice 拒绝后清空事件并立即禁用安装按钮"]],
];
let hits = 0, misses = 0;
for (const [name, mutate, file, env, keys] of MUTANTS){
  try { mutate(); } catch (e){ console.log("!! " + e.message); misses++; continue; }
  const result = failures(file, env);
  const matched = keys.filter(key => result.failed.some(line => line.includes(key)));
  console.log("=".repeat(72) + "\n变异：" + name);
  if (!result.crashed && matched.length === keys.length){
    for (const line of result.failed) console.log("  " + line.slice(0, 160));
    console.log("  ✓ 具名断言变红：" + result.failed.length + " 条"); hits++;
  } else {
    console.log("  ⚠ 未完整命中目标断言" + (result.crashed ? "（测试崩溃，不算证据）" : ""));
    for (const line of result.failed.slice(0, 8)) console.log("  " + line.slice(0, 160));
    misses++;
  }
}
for (const file of [TMP_SW, TMP_HTML]){ try { fs.unlinkSync(file); } catch (_) {} }
console.log("=".repeat(72) + "\n命中 " + hits + " / 未命中 " + misses);
process.exit(misses ? 1 : 0);
