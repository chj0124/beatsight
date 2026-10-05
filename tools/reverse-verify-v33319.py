#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.19）——补齐 v3.33.16/17/18/19 四处修复的具名断言证明。
   纪律同 v3339/v33315/v33317：只改 /tmp 副本（走 BEATSIGHT_HTML）、必须出现具名 ✗、
   锚点唯一、变异忠实（撤掉修复本身，不额外改写）。

   用法：python3 tools/reverse-verify-v33319.py

   判定点：
     M26 onDragEnd 向左换位退回「下标左邻 d.k-1」→ T202g 红（换错一对，用户「移不回去」的直接原因）
     M27 键盘微调撤掉「挪不动则换位」的退化分支 → T202g 源码钉红（满铺行里 ←/→ 又变 no-op）
     M28 行归属退回「指针 Y ÷ 固定行高」→ T202i 红
         ★ 注意：rowOfY 在桩环境**从不执行**（无 getBoundingClientRect），覆盖率闸把它列进
           「从未执行的函数」——所以这一条**只能靠源码钉**，不是靠行为断言。这是如实记录。
     M29 时值±1格 退回按下标取后邻 → T202h 红（两条独立命中：行为 + 源码钉）
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

SWAP_APPLY_NEW = "      const out = r.swap === 1 ? swapChars(chars, d.k) : swapChars(chars, prevIx);"
SWAP_APPLY_OLD = "      const out = r.swap === 1 ? swapChars(chars, d.k) : swapChars(chars, d.k - 1);"

FALLBACK_NEW = "      const swapped = j < 0 ? null : (delta < 0 ? swapChars(chars, j) : swapChars(chars, k));"
FALLBACK_OLD = "      const swapped = null;"

ROW_NEW = "        row = rowOfY(drag.geo, ev.clientY);"
ROW_OLD = ("        row = Math.max(0, Math.min((lctx.rows || 1) - 1,\n"
           "          Math.floor((ev.clientY - drag.geo.rects[0].top) /\n"
           "            Math.max(1, drag.geo.rects[0].bottom - drag.geo.rects[0].top))));")

LIM_NEW = ("    const nb = lyricNeighbors(chars, k, c.dur, span);\n"
           "    const lim = Math.min(span, nb.nextK >= 0 ? chars[nb.nextK].t : span);")
LIM_OLD = "    const lim = Math.min(span, k + 1 < chars.length ? chars[k + 1].t : span);"


def rep(s, old, new):
    assert s.count(old) == 1, "锚点 %d 处：%s" % (s.count(old), old[:60])
    return s.replace(old, new, 1)


MUTANTS = [
    ("M26 回退：向左换位改回「下标左邻 d.k-1」（换错一对）",
     lambda s: rep(s, SWAP_APPLY_NEW, SWAP_APPLY_OLD),
     ["★★ 源码钉：落库改用 prevIx", "★★ 源码钉：`d.k - 1`"]),

    ("M27 回退：键盘微调撤掉「挪不动则换位」的退化分支",
     lambda s: rep(s, FALLBACK_NEW, FALLBACK_OLD),
     ["★ 源码钉：键盘微调挪不动时退化为时间邻字换位"]),

    ("M28 回退：行归属改回「指针 Y ÷ 固定行高」",
     lambda s: rep(s, ROW_NEW, ROW_OLD),
     ["★ 行归属走真实矩形命中"]),

    ("M29 回退：时值±1格 改回按下标取后邻",
     lambda s: rep(s, LIM_NEW, LIM_OLD),
     ["★ 时值+1格：八分(24) → 36", "★ 时值±1格 收进纯函数"]),
]

total_hit, total_miss = 0, 0
for name, fn, expect_names in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); total_miss += 1; continue
    mp = "/tmp/mut-v33319.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    hit = [f for f in failed if any(e in f for e in expect_names)]
    if hit:
        print("  " + (m.group(0) if m else "(未取到汇总)"))
        for f in hit[:5]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条（命中 %d 个关键词）" % (len(hit), len(expect_names)))
        total_hit += 1
    else:
        print("  ⚠ 无具名断言变红（%s）——断言测错对象或锚点失配" % (m.group(0) if m else "崩溃"))
        for f in failed[:5]:
            print("     (实际红的是) ✗ " + f[:110])
        total_miss += 1
if os.path.exists("/tmp/mut-v33319.html"):
    os.remove("/tmp/mut-v33319.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (total_hit, total_miss))
sys.exit(1 if total_miss else 0)
