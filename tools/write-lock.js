/* 单文件写锁（v3.36.12，本轮审计 C-11）
   ---------------------------------------------------------------------------
   由来：AGENTS.md §5.1 写着「同一时刻只允许一个 Agent 落笔 index.html」，理由是
   **git 无法合并单文件**——两个 Agent 同时改，后写的静默覆盖先写的：不报错、不冲突、
   git status 也看不出。这是本仓最危险的一种失败，而那条纪律此前**纯是文字**：
   没有锁、没有持锁人、没有失效判定，谁都可以在"以为没人"的时候开写。

   用法：
     node tools/write-lock.js --acquire "会话名"   拿锁（已有他人未过期的锁 ⇒ 拒绝）
     node tools/write-lock.js --release            放锁
     node tools/write-lock.js --status             看锁（check-all 汇总也打这一行）
     node tools/write-lock.js --force              抢锁：明知另有会话时的**显式**覆盖
     node tools/write-lock.js --ttl=2              覆盖默认保鲜期（小时）

   锁文件 = 仓库根的 .write-lock.json（已进 .gitignore——它是本机运行态，不是仓库内容）。
   过期：默认 8 小时。过期锁**不阻止** acquire，但会被标出来——人不在时锁不该永远挡着。

   ★ 如实说明这条的价值边界（审计原文即注明「属约定非强制」）：工具只能做两件事——
     把「现在有没有人在写」摆到台面上，以及让「抢锁」变成一个必须显式输入 --force 的动作。
     它拦不住一个不查锁就开写的会话。故 check-all 每次都会打印锁状态，让「没查」这件事变难。

   退出码：0 = 正常（含"未持有锁"）；1 = acquire 被拒绝 / 锁状态异常；4 = 工具故障。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOCK = path.join(ROOT, ".write-lock.json");
const argv = process.argv.slice(2);
const argOf = (n, d) => { const h = argv.find(a => a.startsWith("--" + n + "=")); return h ? h.split("=")[1] : d; };
const TTL_H = +argOf("ttl", 8);

function readLock(){
  try { return JSON.parse(fs.readFileSync(LOCK, "utf8")); }catch(e){ return null; }
}
function hoursAgo(iso){
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
}
function describe(l){
  const h = hoursAgo(l.at);
  const stale = h > TTL_H;
  return (l.by || "(未署名)") + " · 自 " + l.at + "（" + h.toFixed(1) + " 小时前）"
    + (stale ? " · 已过期未释放" : "");
}

if (argv.includes("--acquire")){
  const by = argOf("by", "") || argv[argv.indexOf("--acquire") + 1] || process.env.DSH_SESSION || "(未署名)";
  const cur = readLock();
  if (cur && cur.by && hoursAgo(cur.at) <= TTL_H && !argv.includes("--force")){
    console.error("  ✗ 已有未过期的写锁：" + describe(cur));
    console.error("    单文件（index.html）git 无法合并——不要两个会话同时改。");
    console.error("    确认对方已收工后，用 --force 抢锁：node tools/write-lock.js --force --acquire \"" + by + "\"");
    process.exit(1);
  }
  fs.writeFileSync(LOCK, JSON.stringify({ by: by, at: new Date().toISOString(), pid: process.pid }, null, 2), "utf8");
  console.log("  ✓ 已拿写锁：" + by + "（保鲜 " + TTL_H + " 小时）");
  process.exit(0);
}
if (argv.includes("--release")){
  const cur = readLock();
  try { fs.rmSync(LOCK, { force: true }); }catch(e){}
  console.log(cur ? "  ✓ 已释放写锁（原持有：" + (cur.by || "(未署名)") + "）" : "  · 本来就没有锁");
  process.exit(0);
}
/* 默认 = --status（check-all 汇总也调这个） */
const cur = readLock();
if (!cur) console.log("  写锁：未持有（可以开工；开工前请 --acquire）");
else {
  const stale = hoursAgo(cur.at) > TTL_H;
  console.log("  写锁：" + describe(cur) + (stale ? " ⇒ 如确认对方已收工，用 --force 抢锁" : " ⇒ 另一个会话可能正在写 index.html"));
  if (stale) process.exitCode = 1;
}
