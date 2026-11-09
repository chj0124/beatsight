#!/usr/bin/env node
/* check-deploy-parity 双渠道本地 HTTP 回归测试。 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function serve(body, delay){
  const server = http.createServer((req, res) => {
    const reply = () => { res.writeHead(200, { "content-type": "text/html" }); res.end(body); };
    if (delay) setTimeout(reply, delay); else reply();
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
  }));
}
function run(cf, wb, extra){
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["tools/check-deploy-parity.js", ...(extra || [])], {
      cwd: ROOT, env: { ...process.env, BEATSIGHT_PARITY_URL: cf, BEATSIGHT_WORKBUDDY_URL: wb },
    });
    let out = "";
    child.stdout.on("data", c => { out += c; });
    child.stderr.on("data", c => { out += c; });
    child.on("close", status => {
      if (process.env.DEBUG) console.log({ status, out });
      resolve({ status, out });
    });
  });
}
function check(cond, name){
  if (cond) console.log("  ✓ " + name);
  else { console.error("  ✗ " + name); process.exitCode = 1; }
}
(async () => {
  const good = await serve(html);
  const old = await serve(html.replace(/const VERSION = "[^"]+"/, 'const VERSION = "0.0.1"'));
  try {
    const okRun = await run(good.url, good.url, ["--require-online"]);
    check(okRun.status === 0, "两渠道同版且可访问时严格验收通过");
    check(okRun.out.includes("Cloudflare") && okRun.out.includes("WorkBuddy"), "报告分别列出 Cloudflare 与 WorkBuddy");

    const mismatch = await run(good.url, old.url, ["--require-online"]);
    check(mismatch.status === 1, "WorkBuddy 版本不一致时严格验收失败");
    check(mismatch.out.includes("WorkBuddy") && mismatch.out.includes("0.0.1"), "失败报告指明 WorkBuddy 与实际版本");

    old.server.close();
    const offline = await run(good.url, old.url, []);
    check(offline.status === 0, "默认模式下线上不可访问只提示不判红");
    check(offline.out.includes("WorkBuddy") && offline.out.includes("跳过"), "不可访问渠道被明确标注");
    check(!offline.out.includes("对账通过 · 双渠道版本一致"), "线上不可访问时不得声称双渠道版本一致");

    const strictOffline = await run(good.url, old.url, ["--require-online"]);
    check(strictOffline.status === 1, "严格模式下线上不可访问判红");
  } finally {
    good.server.close();
    old.server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
