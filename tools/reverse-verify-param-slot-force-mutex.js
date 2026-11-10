#!/usr/bin/env node
/* 反向验证：普通与强制参数面板的正反向互斥必须命中具名断言。 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const TMP = path.join(os.tmpdir(), "mut-param-slot-force-mutex.html");
function once(src, oldText, newText, name){
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(name + "：锚点出现 " + count + " 次");
  return src.replace(oldText, newText);
}
const MUTANTS = [
  ["M1 强制打开重新绕过互斥", s => once(s,
    "  dismissOtherSlot(name);\n  paramSlotForce = name; syncParamSlots();",
    "  paramSlotForce = name; syncParamSlots();", "M1"),
    "tests/cases/t231-control-core.js", "强制打开互斥"],
  ["M2 反向切换不再清理另一块强制面板", s => once(s,
    "  if (paramSlotForce === other) resetSlotForce();\n", "", "M2"),
    "tests/cases/t231-control-core.js", "反向切换清理"],
  ["M3 真机几何重新出现双面板重叠", s => once(s,
    "  dismissOtherSlot(name);\n  paramSlotForce = name; syncParamSlots();",
    "  paramSlotForce = name; syncParamSlots();", "M3"),
    "tools/smoke.js", "强制打开互斥：静音后强制开变速只剩一块", ["--file-only"]],
];
let hits = 0, misses = 0;
for (const [name, mutate, file, key, args] of MUTANTS){
  let mut;
  try { mut = mutate(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")); }
  catch (e){ console.log("!! " + e.message); misses++; continue; }
  fs.writeFileSync(TMP, mut);
  const r = spawnSync(process.execPath, [file, ...(args || [])], {
    cwd: ROOT, env: { ...process.env, BEATSIGHT_HTML: TMP }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter(line => line.trim().startsWith("✗"));
  const matched = failed.filter(line => line.includes(key));
  console.log("=".repeat(72) + "\n变异：" + name);
  if (matched.length){
    for (const line of matched) console.log("  " + line.trim());
    console.log("  ✓ 具名断言变红：" + matched.length + " 条"); hits++;
  } else {
    console.log("  ⚠ 未命中目标断言" + (r.status !== 0 ? "（测试崩溃，不算证据）" : ""));
    for (const line of failed.slice(0, 6)) console.log("  " + line.trim());
    misses++;
  }
}
try { fs.unlinkSync(TMP); } catch (_) {}
console.log("=".repeat(72) + "\n命中 " + hits + " / 未命中 " + misses);
process.exit(misses ? 1 : 0);
