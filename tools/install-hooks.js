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

   与 tools/install-hooks.sh 的关系（v2.60.0 审计 Q4 更新）：脚本保留（有人更习惯显式 sh 调用），
   但**不再内嵌钩子文本**——它直接 `exec node install-hooks.js` 转调本文件，
   钩子内容只有**这一份事实来源**（本文件生成），不再有两份需同步。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
/* v3.33.14：钩子由一份改成**两张**，内容仍只有这一处事实来源（本文件生成）。
   ★ pre-push 的由来（审计 §2.5，E18 的延伸）：本仓推 main **即触发 Cloudflare 自动部署**，
     而 WorkBuddy 那条手动发布通道是零拦截的——两条路合计下来，"发布前跑一次自验"
     只存在于 AGENTS.md 的文字里，没有任何机器强制。pre-push 把这一环补上：
     任何一次 push（不管走哪条渠道）都至少过一遍 `npm run publish:check`。
     ★ 为什么复用 `npm run publish:check` 而不是把命令抄一遍：与 CI 复用 `npm run ci`
       同一条纪律——命令内容留在 package.json，钩子只留"调哪个入口"，
       否则改脚本名/挪路径时两边会静默漂移（wrangler.jsonc 头部反复强调的那条）。
     ★ `npm run publish:check` = check-all --quick → build → 部署对账；
       对账里的"线上实际版本"一项**离线会自动跳过且不判红**（见 check-deploy-parity.js ③），
       故断网环境不会因为钩子本身而推不出去。 */
const HOOKS = {
  "pre-commit": `#!/bin/sh
# BeatSight 提交前门禁：快速自验。跳过 T21 全组合扫描（那是发布前全量检查的事）。
# 想绕过（不该是常态）：git commit --no-verify
exec node tools/check-all.js --quick
`,
  "pre-push": `#!/bin/sh
# BeatSight 推送前门禁（v3.33.14）：推 main 即触发线上部署，故推送前必须过一遍发布自验。
# 想绕过（不该是常态）：git push --no-verify
# ★ 命令内容在 package.json 的 publish:check，本文件不抄第二份。
if ! command -v npm >/dev/null 2>&1; then
  echo "[BeatSight] ⚠ 找不到 npm，跳过 pre-push 自验——请手动跑：npm run publish:check"
  exit 0
fi
exec npm run publish:check
`,
};

/* 不在 git 仓库里（例如把源码打成 tarball 后 npm install）就安静退出：
   装钩子是便利，不是安装的前置条件，不该让 npm install 失败 */
const inRepo = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, stdio: "ignore" });
if (inRepo.status !== 0){
  console.log("[BeatSight] 不在 git 仓库中，跳过钩子安装");
  process.exit(0);
}

const dir = path.join(ROOT, "hooks");
fs.mkdirSync(dir, { recursive: true });
for (const [name, body] of Object.entries(HOOKS)){
  const file = path.join(dir, name);
  /* v2.8.8：内容一致就**不重写**。理由不只是"省一次 IO"——Windows 上 git 的
     core.autocrlf 会把检出的文件写成 CRLF，而本脚本写出去的是 LF；每次都无脑重写，
     就会让一个**逐字相同的文件**在 `git status` 里常年显示为已修改（噪声），
     而"什么被改了"恰恰是这个项目最看重的一件事。比较时剥掉行尾差异。 */
  const same = (() => {
    try{ return fs.readFileSync(file, "utf8").split("\r\n").join("\n") === body; }
    catch(e){ return false; }
  })();
  if (same) console.log(`[BeatSight] hooks/${name} 内容已是最新，跳过重写`);
  else fs.writeFileSync(file, body, "utf8");
  /* ★ v3.33.14：chmod **不能**只在"重写了才做"——旧写法让一份内容正确但权限是 644 的
     钩子长期留在原地，git 每次提交只给一行轻描淡写的提示：
       hint: The 'hooks/pre-commit' hook was ignored because it's not set as executable.
     也就是说：**钩子装了、内容对、但一次都没跑过**，而没有任何人会发现——
     这正是"门禁形同虚设"最安静的一种形态（本仓实测就是这个状态）。
     故无论是否重写，都确保 +x。Windows 无执行位，chmod 失败属预期（git 直接调 sh 执行）。 */
  try{ fs.chmodSync(file, 0o755); }catch(e){ /* Windows：同上，无碍 */ }
}

const set = spawnSync("git", ["config", "core.hooksPath", "hooks"], { cwd: ROOT, stdio: "ignore" });
if (set.status !== 0){
  /* 同样是便利项：配置写不进（只读仓库 / 权限）不该让 npm install 挂掉 */
  console.log("[BeatSight] ⚠ 已生成 hooks/pre-commit，但写入 core.hooksPath 失败——"
    + "请手动执行：git config core.hooksPath hooks");
  process.exit(0);
}
console.log("[BeatSight] 已安装钩子（core.hooksPath=hooks）："
  + "pre-commit → node tools/check-all.js --quick；pre-push → npm run publish:check");
