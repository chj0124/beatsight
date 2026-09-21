/* 安装本地 git 钩子（零依赖、跨平台，不进产物）
   ---------------------------------------------------------------------------
   为什么要有它：本项目**仓库内没有 CI**（v2.8.8 前），机器检查全靠"记得跑
   tools/check-all.js"。hooks/pre-commit 能把「自觉」变成「默认」，但安装方式原本是
   `sh tools/install-hooks.sh`——两个问题：
     ① `core.hooksPath` 是**本机配置，不随仓库走**，每个 clone 都要手动跑一次；
     ② 那个脚本是 POSIX shell，Windows 的 cmd/PowerShell 下跑不了
        （与 wrangler.jsonc 里 build.command 当初踩的是同一个坑，v2.0.6 已用
        tools/build-dist.js 把那半段收进 Node）。
   挂在 npm 的 `prepare` 生命周期上就同时解决两条：clone 后**任何** `npm install`
   都会自动装好钩子，且 Node 脚本在三个平台上行为一致。

   与 tools/install-hooks.sh 的关系：脚本保留（有人更习惯显式 sh 调用），
   两者产出完全相同的 hooks/pre-commit 与 core.hooksPath 配置——
   **钩子内容只有一份事实来源**：这里生成，脚本里那份与之逐字相同（改动请同步两边）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HOOK = `#!/bin/sh
# BeatSight 提交前门禁：快速自验。跳过 T21 全组合扫描（那是发布前全量检查的事）。
# 想绕过（不该是常态）：git commit --no-verify
exec node tools/check-all.js --quick
`;

/* 不在 git 仓库里（例如把源码打成 tarball 后 npm install）就安静退出：
   装钩子是便利，不是安装的前置条件，不该让 npm install 失败 */
const inRepo = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, stdio: "ignore" });
if (inRepo.status !== 0){
  console.log("[BeatSight] 不在 git 仓库中，跳过钩子安装");
  process.exit(0);
}

const dir = path.join(ROOT, "hooks");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "pre-commit");
/* v2.8.8：内容一致就**不重写**。理由不只是"省一次 IO"——Windows 上 git 的
   core.autocrlf 会把检出的文件写成 CRLF，而本脚本写出去的是 LF；每次都无脑重写，
   就会让一个**逐字相同的文件**在 `git status` 里常年显示为已修改（噪声），
   而"什么被改了"恰恰是这个项目最看重的一件事。比较时剥掉行尾差异。 */
const same = (() => {
  try{ return fs.readFileSync(file, "utf8").split("\r\n").join("\n") === HOOK; }
  catch(e){ return false; }
})();
if (same) console.log("[BeatSight] hooks/pre-commit 内容已是最新，跳过重写");
else fs.writeFileSync(file, HOOK, "utf8");
try{ fs.chmodSync(file, 0o755); }catch(e){ /* Windows 无执行位：git 直接调 sh 执行，无碍 */ }

const set = spawnSync("git", ["config", "core.hooksPath", "hooks"], { cwd: ROOT, stdio: "ignore" });
if (set.status !== 0){
  /* 同样是便利项：配置写不进（只读仓库 / 权限）不该让 npm install 挂掉 */
  console.log("[BeatSight] ⚠ 已生成 hooks/pre-commit，但写入 core.hooksPath 失败——"
    + "请手动执行：git config core.hooksPath hooks");
  process.exit(0);
}
console.log("[BeatSight] 已安装 pre-commit 钩子（core.hooksPath=hooks）：提交时自动跑 node tools/check-all.js --quick");
