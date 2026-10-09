#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.40.0 批 1 · 间距修正）——证明两条间距修正都有具名断言守着。
   用法：python3 tools/reverse-verify-v3400.py
   M40 撤掉 .bpm-slider-row 的 min-height:40px → T230 红（行盒同律 40px）
   M41 撤掉 .slider-row 的 gap 13px（退回 6px）→ T230 红（塔内间距 13px）
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M40 撤掉 .bpm-slider-row 行盒 min-height:40px",
     lambda s: s.replace(
         ".bpm-slider-row{display:flex;align-items:center;gap:10px;min-height:40px;font-size:12px;color:var(--t2)}",
         ".bpm-slider-row{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--t2)}", 1),
     ["行盒 40px"]),
    ("M41 .slider-row 塔内间距退回 6px",
     lambda s: s.replace(
         ".slider-row{display:flex;flex-direction:column;align-items:stretch;gap:13px}",
         ".slider-row{display:flex;flex-direction:column;align-items:stretch;gap:6px}", 1),
     ["13px"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v3400.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    hit = [f for f in failed if any(k in f for k in keys)]
    if hit:
        print("  " + (m.group(0) if m else "(未取到汇总)"))
        for f in hit[:4]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条" % len(hit))
        hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:4]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists("/tmp/mut-v3400.html"):
    os.remove("/tmp/mut-v3400.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
