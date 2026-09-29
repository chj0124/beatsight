#!/bin/sh
# BeatSight：安装本地 git 钩子（零依赖，不进产物）。
# 机器检查以 tools/check-all.js 为主入口；v2.8.8 起仓库内另有 .github/workflows/ci.yml 作补位
# （推 main / PR 时跑 npm run ci + 真实浏览器冒烟），但它不覆盖本地提交前的这一遍。
# 这个脚本把「自觉」变成「默认」：pre-commit 自动跑快速自验，
# 提交被拦下时请先修问题再提交；全量检查仍在发布前手动跑（node tools/check-all.js）。
# 用法：sh tools/install-hooks.sh（clone 后跑一次即可，core.hooksPath 是本机配置不随仓库走）
set -eu
cd "$(dirname "$0")/.."

# v2.60.0（审计 Q4）：钩子内容只有**一份事实来源**——tools/install-hooks.js 生成并写入
# hooks/pre-commit。本 POSIX 脚本直接转调它，避免两份钩子文本再次分叉（需 node，本项目本就依赖）。
exec node "$(dirname "$0")/install-hooks.js"
