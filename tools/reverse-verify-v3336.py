#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.6）——证明「#viz 裁剪高度单一来源 + 变更后重落」有具名断言守着。
   纪律同 tools/reverse-verify-v331x.py（只改 /tmp 副本 / 必须具名 ✗ / 锚点唯一 / 崩溃型单列）。
   用法：python3 tools/reverse-verify-v3336.py
   判定点（对照 tests/cases/t190-viz-clip-single-source.js）：
     M7 去掉 setLyricInlineOn 里的重落（行距翻转后高度停在旧值）→ T190a 红
     M8 去掉 relayout 播放分支里的重落（播放中主题/resize/标注开关后高度陈旧）→ T190b 红
     M9 让 lyricClipH 自己重写一份公式（单一来源分叉）→ T190e 的"旧内联公式已消失/复用"红
   ★ M7/M8 是"该重落却没落"，M9 是"来源分叉"——三个方向分属不同断言，缺一不可。"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("M7 v3.33.6 回退：setLyricInlineOn 不再重落裁剪高度",
   "    applyVizClip();\n  }\n  function layoutLyricLane(){",
   "  }\n  function layoutLyricLane(){",
   ["行距翻转后 #viz 高度被重落"]),

  ("M8 v3.33.6 回退：relayout 播放分支不再重落裁剪高度",
   "      applyVizClip();\n      fitCellAnnotations(); remeasureLyric(); layoutLyricLane();",
   "      fitCellAnnotations(); remeasureLyric(); layoutLyricLane();",
   ["relayout 播放分支把高度重落"]),

  ("M9 v3.33.6 回退：lyricClipH 自写一份公式（单一来源分叉）",
   "    const vizH = vizClipH();\n    if (!vizH) return 0;",
   "    const r0 = rowGeo[0];\n    if (!r0) return 0;\n    const vizH = Math.round(r0.top + (scrollRows() - 1) * scrollSlotH + vizRowBoxH);\n    if (!vizH) return 0;",
   ["旧的内联公式"]),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3336.html"
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
        for f in hit[:8]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：" + str(len(hit)) + " 条（期望 " + str(len(expect_names)) + " 条关键词）")
        total_hit += 1
    else:
        print("  ⚠ 无具名断言变红（%s）——断言测错了对象或锚点失配，必须修" % (m.group(0) if m else "崩溃"))
        total_miss += 1
os.remove("/tmp/mut-v3336.html") if os.path.exists("/tmp/mut-v3336.html") else None
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
