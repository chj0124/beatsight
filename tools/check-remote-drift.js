/* 远端漂移核对：本机 HEAD 是否仍是远端 main（v3.36.5，审计 第二部分①）
   ---------------------------------------------------------------------------
   由来：自验 20 步（现 21 步）**全部只读本地**，而本仓的真实风险恰恰来自本地之外——
     · 另一台电脑也在开发 BeatSight 并直提 main；
     · 本机是**浅克隆**（`git rev-parse --is-shallow-repository` = true），`git fetch`
       在网络受限的环境里时通时不通，于是"我这份是不是当前那份"此前只能靠人记着核对
       （AGENTS.md §5.1 写着"开工前先对齐"，但没有任何机器盯它）。
   后果是安静且严重的：在旧基线上开工 → 全量自验照样 20/20 全绿 → 而**整轮结论都不成立**
   （本仓真实发生过：工作区里一份副本落后 30+ 个版本被当成基线）。

   本工具把"这份代码是不是远端当前那份"变成一步可执行的检查：
     0  = HEAD == 远端 main（一致）
     1  = 不一致（远端已前进 / 本地领先 / 分叉）——**判红**：此时任何"基于当前的结论"都不可信
     3  = 本机没有 `gh`（环境能力缺失）→ 按 ⊘ 记账（与浏览器冒烟同一口径，不阻断构建）
     4  = 工具故障（网络不可达 / git 不可用 / 输出不是 sha）→ 按 ⚠ 记账（未被验证）
   ★ 3 与 4 必须分开：3 是"这台机器没有这个能力"，4 是"想查但没查成"——
     前者在 CI 镜像里是常态（构建镜像没有 gh），后者才是该被看见的故障。

   ★ 只用 `gh api`（走 api.github.com），不用 `git ls-remote`：后者走 github.com:443，
     在本机环境实测会被隧道拦下（超时），而 `gh api` 一直可用。
   ★ 只读：不写任何文件、不 fetch、不动 ref、不 push。
   ================================================================================ */
"use strict";
const { spawnSync } = require("child_process");

const REPO = "chj0124/beatsight";
const TIMEOUT_MS = 8000;
const TOOL_FAIL_CODE = 4;
const ENV_MISSING_CODE = 3;

function run(cmd, args){
  return spawnSync(cmd, args, { encoding: "utf8", timeout: TIMEOUT_MS });
}

/* `gh` 在不在 PATH 里（不依赖 shell，逐个候选目录试——与仓库里其它工具的取法同口径） */
function hasGh(){
  const r = run("gh", ["--version"]);
  return !(r.error || r.status !== 0);
}

console.log("远端漂移核对（只读 · 本机 HEAD ↔ GitHub main）");

if (!hasGh()){
  console.log("  ⊘ 本机没有 gh（无法核对远端）——这是环境能力缺失，不是失败");
  process.exit(ENV_MISSING_CODE);
}

const local = run("git", ["rev-parse", "HEAD"]);
if (local.error || local.status !== 0){
  console.log("  ⚠ 读不到本机 HEAD（" + ((local.error && local.error.code) || "git 退出码 " + local.status) + "）——未被验证");
  process.exit(TOOL_FAIL_CODE);
}
const head = String(local.stdout || "").trim();
if (!/^[0-9a-f]{40}$/.test(head)){
  console.log("  ⚠ 本机 HEAD 不是一个 40 位 sha（实际：" + head.slice(0, 20) + "）——未被验证");
  process.exit(TOOL_FAIL_CODE);
}

const remote = run("gh", ["api", "repos/" + REPO + "/commits/main", "--jq", ".sha"]);
if (remote.error){
  console.log("  ⚠ 读不到远端 main（" + (remote.error.code || remote.error.errno || "?")
    + "：" + remote.error.message + "）——网络不可达，未被验证");
  process.exit(TOOL_FAIL_CODE);
}
if (remote.status !== 0){
  console.log("  ⚠ `gh api` 失败（退出码 " + remote.status + "）——未被验证");
  process.exit(TOOL_FAIL_CODE);
}
const sha = String(remote.stdout || "").trim();
if (!/^[0-9a-f]{40}$/.test(sha)){
  console.log("  ⚠ 远端返回的内容不是一个 40 位 sha（实际：" + sha.slice(0, 40) + "）——未被验证");
  process.exit(TOOL_FAIL_CODE);
}

if (sha === head){
  console.log("  ✓ 本机 HEAD 与远端 main 一致（" + head.slice(0, 7) + "）——可以拿这份当基线");
  process.exit(0);
}

/* 不一致：**判红**。它不只是"提示"——在旧基线上跑出来的任何结论都不成立，
   而自验其余 20 步会照样全绿，这是唯一会说话的那一步。 */
console.log("  ✗ 本机 HEAD 与远端 main 不一致");
console.log("     本机：" + head);
console.log("     远端：" + sha);
console.log("     → 先整合（fetch / rebase 或按 AGENTS.md §5.1 对齐）再动笔；");
console.log("       此刻跑出来的自验结果不能当作「当前代码是健康的」的证据。");
process.exit(1);
