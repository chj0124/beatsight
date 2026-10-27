#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（t267 · 内置预设小节完整性）
   用法：python3 tools/reverse-verify-t267-builtin-bar.py
   三个变异分别破坏「每小节严格 = meter×TPB」不变量的不同侧面，目标断言
   （tests/cases/t267-builtin-bar-integrity.js）须具名变红：
     M1 Take Five 回退为 192t 旧数据（本bug原样） → T267a/b/c/d 的具名断言
     M2 破坏另一条内置型（Money 7/4 掐掉末音）   → T267a「全目录零违规」（扫描不是 Take Five 专用）
     M3 末位补 24t 而非 48t（216t，半吊子修复）   → T267a 总和 / T267c 循环步长 / T267d 右缘
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸（本机实测）
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

# ★ 锚点必须带整条 bars 前缀：短锚 D(24),D(24),D(48)]] 会先命中更早的「切分节奏型」
#   （其小节末段同形）——首轮实测变异落错了对象（切分 144t 变红、Take Five 断言全绿）。
MUTANTS = [
    ("M1 Take Five 回退为旧数据 [48,48,48,24,24]（192t，本bug原样）",
     lambda s: s.replace("bars:[[D(48),D(48),D(48),D(24),D(24),D(48)]]}",
                         "bars:[[D(48),D(48),D(48),D(24),D(24)]]}", 1),
     ["Take Five 小节 = 240t", "6 音符", "onset 序列", "循环步长 = 5s", "行内 6 格", "末格右缘"]),
    ("M2 破坏另一条内置型：Money 7/4 掐掉末音（336t → 288t）",
     lambda s: s.replace("D(48),D(24),D(24),D(48),D(48),D(24),D(24),D(48)]]",
                         "D(48),D(24),D(24),D(48),D(48),D(24),D(24)]]", 1),
     ["全目录零违规"]),
    ("M3 Take Five 末位补 24t 而非 48t（216t，半吊子修复）",
     lambda s: s.replace("bars:[[D(48),D(48),D(48),D(24),D(24),D(48)]]}",
                         "bars:[[D(48),D(48),D(48),D(24),D(24),D(24)]]}", 1),
     ["全目录零违规", "小节总和 = 240t", "循环步长", "末格右缘"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-t267.html"
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
        for f in hit[:8]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条" % len(hit)); hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:4]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists("/tmp/mut-t267.html"):
    os.remove("/tmp/mut-t267.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
