#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.46.1 · 移动端歌词跑道缺口期滞留前片——进度源换绑歌曲时间）
   用法：python3 tools/reverse-verify-v3461.py
   M77 paintLyric 退回扫弦 onset 落地口径（tib, …, bar）
       → t239-lyric-gap-follow 的 T239b「缺口期歌词推进」具名钉红（6 条）
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸（本机实测）
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M77 paintLyric 退回扫弦 onset 落地口径（tib, …, bar）",
     lambda s: s.replace(
         "paintLyric(headTick, audK, arrCur, headBar);",
         "paintLyric(tib, audK, arrCur, bar);", 1),
     ["缺口期", "按时开唱", "走带线落在后片行", "在自己的 dur"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-v3461.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=900)   # 子进程输出是 UTF-8，GBK 控制台下 text=True 默认按 locale 解码会炸（本机实测）
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    hit = [f for f in failed if any(k in f for k in keys)]
    if hit:
        print("  " + (m.group(0) if m else "(未取到汇总)"))
        for f in hit[:6]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条" % len(hit)); hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:4]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists("/tmp/mut-v3461.html"):
    os.remove("/tmp/mut-v3461.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
