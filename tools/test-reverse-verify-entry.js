#!/usr/bin/env node
/* tools/reverse-verify.py 的入口级回归测试；使用临时夹具，不跑应用套件。 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bs-reverse-entry-"));
const TOOLS = path.join(TMP, "tools");
fs.mkdirSync(TOOLS);
fs.copyFileSync(path.join(ROOT, "tools", "reverse-verify.py"), path.join(TOOLS, "reverse-verify.py"));
fs.writeFileSync(path.join(TMP, "index.html"), "");
const scripts = {
  "reverse-verify-v3400.py": "print('命中 3 / 未命中 0')\n",
  "reverse-verify-v3400b.py": "print('命中 4 / 未命中 0')\n",
  "reverse-verify-rotten.py": "print('!! 变异未生效（锚点失配）')\nraise SystemExit(1)\n",
  "reverse-verify-naked.py": "print('无具名断言变红')\nraise SystemExit(1)\n",
};
for (const [name, body] of Object.entries(scripts)) fs.writeFileSync(path.join(TOOLS, name), body);

function run(args){
  const r = spawnSync("python3", [path.join(TOOLS, "reverse-verify.py"), ...args], {
    cwd: TMP, encoding: "utf8",
  });
  if (process.env.DEBUG) console.log({ args, status: r.status, stdout: r.stdout, stderr: r.stderr });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
let failures = 0;
function check(cond, name){
  if (cond){ console.log("  ✓ " + name); return; }
  failures++;
  console.error("  ✗ " + name);
}
try {
  const exact = run(["--only=v3400"]);
  check(exact.out.includes("复跑 1 个脚本"), "--only=v3400 只运行一个脚本");
  check(!exact.out.includes("reverse-verify-v3400b.py"), "--only=v3400 不吞并 v3400b");

  const rotten = run(["--only=rotten"]);
  check(rotten.status === 2, "锚点失配统一归为 rotten（退出码 2）");
  check(rotten.out.includes("0 个有「无具名断言变红」"), "纯腐烂不计入无具名红");
  check(rotten.out.includes("1 个自身腐烂"), "纯腐烂计数为 1");
  check(!rotten.out.includes("-1 个"), "任何汇总都不出现负数");

  const naked = run(["--only=naked"]);
  check(naked.status === 1, "无具名红保持退出码 1");
  check(naked.out.includes("1 个有「无具名断言变红」"), "无具名红计数为 1");
  check(naked.out.includes("0 个自身腐烂"), "无具名红不混入腐烂计数");
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
if (failures){ console.error(`结果：${failures} FAIL`); process.exit(1); }
console.log("结果：全部通过");
