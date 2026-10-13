#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（本批 · 记号起点锚定 onset-anchor）
   ---------------------------------------------------------------------------
   用法：python3 tools/reverse-verify-v3490.py
   M79a 回退主视图公式到「格中心」           → t243① 具名红
   M79b 删编辑器 .edcell .strumv 起点锚定规则 → t243④ 具名红
   M79c 只改歌词侧 clamp 28→32（制造口径分叉）→ t243④ 具名红
   铁律：只改 /tmp 副本；必须出现**具名** ✗（崩溃不算证据）；锚点失配大声失败（退出码 2）。
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M79a 主视图逐弦点 left 回退到「格中心」（起点锚定公式删除）",
     lambda s: s.replace(
         '        sm.style.left = `calc(${startT / barTicks * 100}% + clamp(4px,${s.t / barTicks * 25}%,28px))`;\n'
         '        const sl = strumLayers[b];\n'
         '        if (sl) sl.appendChild(sm);\n'
         '        strums.push(sm);\n'
         '      } else if (s.dir && hasStr){',
         '        sm.style.left = ((startT / barTicks) + (s.t / barTicks) / 2) * 100 + "%";\n'
         '        const sl = strumLayers[b];\n'
         '        if (sl) sl.appendChild(sm);\n'
         '        strums.push(sm);\n'
         '      } else if (s.dir && hasStr){', 1),
     ["第 2 格", "起点", "格中心"]),
    ("M79b 删编辑器 .edcell .strumv 起点锚定规则",
     lambda s: s.replace(
         "\n.edcell .strumv{left:clamp(4px,25%,28px)}\n",
         "\n", 1),
     ["口径同源", ".edcell .strumv", "编辑器渲染点"]),
    ("M79c 只改歌词侧 clamp 28→32（制造口径分叉）",
     lambda s: s.replace(
         ".lyric-char{position:absolute;left:clamp(4px,25%,28px);",
         ".lyric-char{position:absolute;left:clamp(4px,25%,32px);", 1),
     ["口径同源", ".lyric-char", "逐字同源"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-v3490.html"
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
if os.path.exists("/tmp/mut-v3490.html"):
    os.remove("/tmp/mut-v3490.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
