#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.23）——证明「拖动后不选中」这条修复有具名断言守着。
   用法：python3 tools/reverse-verify-v33323.py
   M30 撤掉 onDragEnd 位移提交路径的 selectChip → T119x 红
   M31 撤掉 no-op 路径的 selectChip → T119x 红（这条单独钉"两条路径都补"）
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

A = """    selectChip(selP, true);            // v3.33.23：拖完即选中（先写模块态，再重渲染回挂 .sel）
    arrangeRender();"""
A_MUT = """    arrangeRender();"""
B = """      selectChip(selP, true);          // 拖回原位：不动库、不重绘，但该块进入选中态
      return;"""
B_MUT = """      return;"""

MUTANTS = [
    ("M30 撤掉「位移提交」路径的 selectChip", lambda s: s.replace(A, A_MUT, 1),
     ["★★ 拖动结束后**恰好一个**块处于选中态"]),
    ("M31 撤掉「拖回原位(no-op)」路径的 selectChip", lambda s: s.replace(B, B_MUT, 1),
     # ★ 初版这里写的是 T119x 的文案，与 T119y 对不上 ⇒ 误报"未命中"
     ["★★ no-op 路径也要选中"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v33323.html"
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
if os.path.exists("/tmp/mut-v33323.html"):
    os.remove("/tmp/mut-v33323.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
