#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（PLAN-v11 批 · 编辑器悬浮层 / A1 死引用 / A2 写死红）
   ---------------------------------------------------------------------------
   用法：python3 tools/reverse-verify-v3500.py
   M80a 还原 A1：.arg-pill-play:hover 改回未定义的 var(--accent) → t245-3 具名红
   M80b 还原 A2：.arg-item-del:hover 改回写死 #f3727f          → t245-3 具名红
   M80c 拆除 B2：点块不再置 edPopShown（悬浮层永远不弹出）      → t245-1 具名红
   铁律：只改 /tmp 副本；必须出现**具名** ✗（崩溃不算证据）；锚点失配大声失败（退出码 2）。
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M80a 还原 A1：▶ hover 改回未定义的 var(--accent)（静默失效复发）",
     lambda s: s.replace(
         ".arg-pill-play:hover{color:var(--green);border-color:var(--green);background:rgba(var(--green-rgb),.12)}",
         ".arg-pill-play:hover{color:var(--accent);border-color:var(--accent);background:rgba(255,255,255,.1)}", 1),
     ["A1"]),
    ("M80b 还原 A2：✕ hover 改回写死 #f3727f（日间档不跟随、对比不达 AA）",
     lambda s: s.replace(
         ".arg-item-del:hover{color:var(--red);background:rgba(243,114,127,.12)}",
         ".arg-item-del:hover{color:#f3727f;background:rgba(243,114,127,.12)}", 1),
     ["A2"]),
    ("M80c 拆除 B2：点音符块不再弹出（edPopShown 恒 false）",
     lambda s: s.replace(
         "        edPopShown = !same;",
         "        edPopShown = false;", 1),
     ["弹出"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-v3500.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=900)
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
if os.path.exists("/tmp/mut-v3500.html"):
    os.remove("/tmp/mut-v3500.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
