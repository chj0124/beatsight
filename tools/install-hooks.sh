#!/bin/sh
# BeatSight：安装本地 git 钩子（零依赖，不进产物）。
# 机器检查以 tools/check-all.js 为主入口；v2.8.8 起仓库内另有 .github/workflows/ci.yml 作补位
# （推 main / PR 时跑 npm run ci + 真实浏览器冒烟），但它不覆盖本地提交前的这一遍。
# 这个脚本把「自觉」变成「默认」：pre-commit 自动跑快速自验（约 2 秒），
# 提交被拦下时请先修问题再提交；全量检查仍在发布前手动跑（node tools/check-all.js）。
# 用法：sh tools/install-hooks.sh（clone 后跑一次即可，core.hooksPath 是本机配置不随仓库走）
set -eu
cd "$(dirname "$0")/.."

mkdir -p hooks
cat > hooks/pre-commit <<'EOF'
#!/bin/sh
# BeatSight 提交前门禁：快速自验。跳过 T21 全组合扫描（那是发布前全量检查的事）。
# 想绕过（不该是常态）：git commit --no-verify
exec node tools/check-all.js --quick
EOF
chmod +x hooks/pre-commit

git config core.hooksPath hooks
echo "已安装 pre-commit 钩子（core.hooksPath=hooks）：提交时将自动跑 node tools/check-all.js --quick"
