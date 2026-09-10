#!/bin/bash
# BeatSight 无头截图自验（macOS）：tests/screenshot.sh [宽] [高] [输出.png]
# 坑（v0.6.0 踩过）：沙箱内需 --no-sandbox；--virtual-time-budget 对含 rAF/AudioContext 的页面会挂起，
# 所以后台跑 + 到时 pkill 兜底；--user-data-dir 必须每次换新目录。
set -u
W="${1:-1440}"; H="${2:-1150}"; OUT="${3:-/tmp/beatsight-check.png}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
T="$(mktemp -d)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
("$CHROME" --headless=new --no-sandbox --disable-gpu --user-data-dir="$T/prof" \
  --window-size="$W,$H" --screenshot="$T/shot.png" --timeout=6000 \
  --enable-logging=stderr --v=0 "file://$ROOT/index.html" >"$T/log" 2>&1 &)
sleep 18
pkill -f "user-data-dir=$T/prof" 2>/dev/null
if [ -f "$T/shot.png" ]; then
  cp "$T/shot.png" "$OUT"
  echo "截图: $OUT"
else
  echo "截图失败"; tail -5 "$T/log"; exit 1
fi
N=$(grep -c 'CONSOLE' "$T/log" || true)
echo "控制台消息: $N 条（应为 0）"
grep -iE 'CONSOLE.*(error|uncaught)' "$T/log" && exit 1
exit 0
