#!/usr/bin/env node
/* BeatSight 推送工具（v3.36.0）：**本机 https 到 github.com 被拦时**走 GitHub 的 Git Data API 推送。
   ---------------------------------------------------------------------------
   为什么需要它：某些网络/隧道环境下 `git push` 会卡到超时（连不上 github.com:443），
   而 SSH 端口虽通却未必有可用密钥；但 `gh` 走 api.github.com 是通的。本工具用 REST 的
   blobs → trees → commits → 更新 ref 四步完成推送。

   ★ 本工具最要紧的不是"能推上去"，而是**证明推上去的东西与本地逐字节相同**：
     · 每个 blob 上传后回读 sha，必须等于 `git rev-parse HEAD:<path>`；
     · 建出的树 sha 必须等于 `git rev-parse HEAD^{tree}`（这是"内容完全一致"的硬证据）；
     · 只接受**快进**（远端 ref 必须正好等于本地 HEAD 的父提交），否则中止——绝不 force。
   ★ 已知差异（写在明处）：GitHub 会用自己的编码重建提交对象，因此**提交 sha 可能与本地不同**
     （树相同 ⇒ 内容相同）。工具会把这一点打印出来，并给出对齐命令。

   用法：
     node tools/push-api.js              # 干跑：只读 + 打印计划，一个字节都不写
     node tools/push-api.js --push       # 真正推送（npm run push:api）
     node tools/push-api.js --push --branch main
   前置：`gh auth login` 已登录（工具用 `gh auth token` 取令牌）。
   ============================================================================ */
"use strict";
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const has = f => args.includes(f);
const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DO_PUSH = has("--push");
const BRANCH = flag("--branch", execFileSync("git", ["branch", "--show-current"]).toString().trim() || "main");

const git = (a, opt) => execFileSync("git", a, Object.assign({ maxBuffer: 1 << 28 }, opt || {})).toString();
const gitTrim = a => git(a).trim();
const die = (msg) => { console.error("\n✗ " + msg); process.exit(1); };
const ok = (msg) => console.log("  ✓ " + msg);

/* 仓库标识：从 origin 的 URL 解析（支持 https 与 ssh 两种写法） */
const remoteUrl = gitTrim(["remote", "get-url", "origin"]);
const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!m) die("看不懂 origin 的 URL：" + remoteUrl);
const REPO = m[1] + "/" + m[2];
console.log("BeatSight 推送（Git Data API 通道）");
console.log("  仓库 " + REPO + " · 分支 " + BRANCH + " · 模式 " + (DO_PUSH ? "**真推**" : "干跑（只读）"));

const token = execFileSync("gh", ["auth", "token"]).toString().trim();
if (!token) die("取不到 gh 令牌——先 `gh auth login`");
const api = async (method, path, body) => {
  const res = await fetch("https://api.github.com" + path, {
    method,
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "beatsight-push-api" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try{ json = text ? JSON.parse(text) : null; }catch(e){}
  if (!res.ok) throw new Error(method + " " + path + " → HTTP " + res.status + " " + (json && json.message ? json.message : text.slice(0, 200)));
  return json;
};

(async () => {
  /* ---- ① 本地事实 ---- */
  const head = gitTrim(["rev-parse", "HEAD"]);
  const tree = gitTrim(["rev-parse", "HEAD^{tree}"]);
  const parentLine = git(["cat-file", "-p", "HEAD"]).split("\n").filter(l => l.startsWith("parent "));
  if (parentLine.length !== 1) die("HEAD 有 " + parentLine.length + " 个父提交（合并提交）——本工具只支持单父，请先线性化");
  const parent = parentLine[0].slice(7).trim();
  const parentTree = gitTrim(["rev-parse", parent + "^{tree}"]);
  const raw = git(["cat-file", "-p", "HEAD"]).split("\n");
  const ci = raw.findIndex(l => l.startsWith("committer "));
  const message = raw.slice(ci + 2).join("\n").replace(/\n+$/, "\n");
  const who = (kind) => {
    const l = raw.find(x => x.startsWith(kind + " "));
    const mm = l.match(/^(?:author|committer) (.*) <(.*)> (\d+) ([+-]\d{4})$/);
    const off = mm[4];
    const secs = Number(mm[3]) + (off.startsWith("-") ? -1 : 1) * (Number(off.slice(1, 3)) * 3600);
    return { name: mm[1], email: mm[2],
      date: new Date(secs * 1000).toISOString().replace(".000Z", off.slice(0, 3) + ":" + off.slice(3)) };
  };
  console.log("\n① 本地：HEAD " + head.slice(0, 8) + " · 树 " + tree.slice(0, 8) + " · 父 " + parent.slice(0, 8));
  ok("提交消息首行：" + message.split("\n")[0]);

  /* ---- ② 远端现状 + 只接受快进 ---- */
  const refRes = await api("GET", "/repos/" + REPO + "/git/ref/heads/" + BRANCH);
  const remote = refRes.object.sha;
  const remoteTree = (await api("GET", "/repos/" + REPO + "/git/commits/" + remote)).tree.sha;
  console.log("② 远端 refs/heads/" + BRANCH + " = " + remote.slice(0, 8) + " · 树 " + remoteTree.slice(0, 8));
  /* ★ 本机经 API 推过之后，本地与远端会是"内容相同、提交对象不同"的**兄弟提交**（树相同、图分叉）。
     这类环境里用"必须是父提交"来判快进会把正常场景也挡掉，故按**内容**判四档：
       A 远端 == HEAD                → 已推过（常规）
       B 远端树 == 本地 HEAD 树      → 内容双胞胎：远端内容已与本地一致，无需再推（只提示对齐）
       C 远端 == 父提交              → 常规快进
       D 远端树 == 父提交树          → **内容快进**（图分叉但内容连续）：允许推送，新提交以**远端**为父，
                                       让远端历史保持线性；本地图仍与远端不同（打印对齐命令）
     其余 → 中止（远端确实前进/分叉了，绝不 force）。 */
  /** @type {string} 本次新提交在**远端**的父提交 */
  let remoteParent = parent;
  let graphNote = "";
  if (remote === head){ ok("远端已经就是本次 HEAD —— 没有东西要推"); return; }
  if (remoteTree === tree){
    ok("远端内容已与本地一致（提交对象不同）—— 无需再推");
    console.log("\n★ 对齐本地（内容不变，请在有网环境执行）：");
    console.log("    git fetch origin && git reset --hard origin/" + BRANCH);
    return;
  }
  if (remote === parent){
    ok("远端 == 本地父提交 ⇒ 常规快进推送");
  } else if (remoteTree === parentTree){
    remoteParent = remote;
    graphNote = "远端与本地是**内容连续但图分叉**的状态（本机走 API 推送留下的）；\n" +
      "     本次新提交以远端为父，远端历史保持线性；本地图需在有网时对齐：\n" +
      "       git fetch origin && git reset --hard origin/" + BRANCH;
    ok("远端树 == 本地父提交树 ⇒ **内容快进**（图分叉、内容连续）");
  } else {
    die("远端既不是本地 HEAD/父提交，树也不相等 ⇒ 确实分叉或已前进。\n" +
        "     远端 " + remote + "（树 " + remoteTree + "）\n" +
        "     本地 " + head + "（父 " + parent + "，树 " + tree + "）\n" +
        "     处置：在有网环境 git fetch origin && git rebase origin/" + BRANCH + " 之后再来；本工具**不做 force**。");
  }

  /* ---- ③ 变更清单（相对父提交） ---- */
  const lines = git(["diff", "--name-status", parent, head]).split("\n").filter(Boolean);
  const changed = lines.map(l => { const p = l.split("\t"); return { status: p[0][0], path: p.slice(1).join("\t") }; });
  console.log("③ 相对父提交的变更：" + changed.length + " 个（" + [...new Set(changed.map(c => c.status))].join("/") + "）");
  if (!changed.length){ ok("没有内容变更（空提交）——仍会推这个提交对象"); }

  if (!DO_PUSH){
    console.log("\n干跑结束：以上计划未写任何东西。真推加 --push。");
    console.log("（干跑不做 blob 上传，故不消耗 API 配额；真推时才会逐个校验 sha。）");
    return;
  }

  /* ---- ④ blob：**逐个校验 sha**（这是"内容逐字节相同"的第一道证据） ---- */
  const entries = [];
  let n = 0;
  for (const c of changed){
    n++;
    process.stdout.write("\r④ 上传 blob " + n + "/" + changed.length + " …");
    if (c.status === "D"){                       /* 删除：树里写 sha:null */
      const mode = gitTrim(["ls-tree", parent, "--", c.path]).split(/\s+/)[0] || "100644";
      entries.push({ path: c.path, mode, type: "blob", sha: null });
      continue;
    }
    const mode = gitTrim(["ls-tree", "HEAD", "--", c.path]).split(/\s+/)[0];
    const localSha = gitTrim(["rev-parse", "HEAD:" + c.path]);
    const buf = require("fs").readFileSync(c.path);
    const res = await api("POST", "/repos/" + REPO + "/git/blobs",
      { content: buf.toString("base64"), encoding: "base64" });
    if (res.sha !== localSha) die("blob sha 不符：" + c.path + "\n     远端 " + res.sha + "\n     本地 " + localSha);
    entries.push({ path: c.path, mode, type: "blob", sha: res.sha });
  }
  process.stdout.write("\r");
  ok(entries.length + " 个 blob 全部与本地 sha 一致");

  /* ---- ⑤ 建树：**sha 必须等于本地树**（内容一致的硬证据） ---- */
  const t = await api("POST", "/repos/" + REPO + "/git/trees", { base_tree: parentTree, tree: entries });
  if (t.sha !== tree){
    die("树 sha 不符 ⇒ 推上去的内容与本地不同，已中止（ref 未动）：\n     远端 " + t.sha + "\n     本地 " + tree);
  }
  ok("新树 " + t.sha.slice(0, 8) + " == 本地树 ⇒ **内容逐字节一致**");

  /* ---- ⑥ 建提交 ---- */
  const c = await api("POST", "/repos/" + REPO + "/git/commits",
    { message, tree: t.sha, parents: [remoteParent], author: who("author"), committer: who("committer") });
  console.log("⑥ 远端提交 " + c.sha.slice(0, 8) + (c.sha === head ? "（与本地 sha 相同）" : "（与本地 sha 不同：GitHub 重算了提交对象，树相同）"));

  /* ---- ⑦ 更新 ref（非 force） ---- */
  const r = await api("PATCH", "/repos/" + REPO + "/git/refs/heads/" + BRANCH, { sha: c.sha, force: false });
  ok("已推送：refs/heads/" + BRANCH + " → " + r.object.sha);
  if (c.sha !== head){
    console.log("\n★ 本地对齐（内容不变，只是把本地分支指到远端那个提交）：");
    console.log("    git fetch origin && git reset --hard origin/" + BRANCH);
  }
})().catch(e => die(e.message));