#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.7）——证明「裁剪高度读实时行几何」有具名断言守着。
   纪律同 tools/reverse-verify-v333x.py（只改 /tmp 副本 / 必须具名 ✗ / 锚点唯一 / 崩溃型单列）。
   用法：python3 tools/reverse-verify-v3337.py
   判定点（对照 tests/cases/t191-clip-live-geometry.js）：
     M10 vizClipH 退回只用 cacheGeo 快照公式（不看实时行盒底）→ T191a 红
     M11 lyricClipH 退回不读实时歌词行（need 恒 0）→ T191a-2 红（chord-xl 档歌词住在行盒内）
     M12 覆盖层锚点退回快照 vizRowBoxH（不看实时行盒高）→ T191b 源码钉红
   ★ 三个方向分属三处不同断言：M10 断"网格剪刀"，M11 断"歌词剪刀"，M12 断"锚点"——缺一不可。"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("M10 v3.33.7 回退：vizClipH 不读实时行盒底（只用快照公式）",
   "    const last = rowEls[Math.min(scrollRows(), rowEls.length) - 1];\n    if (last && last.offsetHeight) return Math.round(last.offsetTop + last.offsetHeight);",
   "    const last = null;\n    if (last && last.offsetHeight) return Math.round(last.offsetTop + last.offsetHeight);",
   ["裁剪盒跟着实时行几何长高"]),

  ("M11 v3.33.7 回退：lyricClipH 不读实时歌词行（need 恒 0）",
   "    const lr = lyricRows[Math.min(scrollRows(), lyricRows.length) - 1];\n    const need = (lr && lr.el && lr.el.offsetHeight) ? Math.round(lr.y + lr.el.offsetHeight + 6) : 0;",
   "    const lr = null;\n    const need = 0;",
   ["盒高 = 歌词行底 + 6"]),

  ("M12 v3.33.7 回退：覆盖层锚点退回快照 vizRowBoxH",
   "        : (g.top + ((rowEls[i] && rowEls[i].offsetHeight) || vizRowBoxH) + 2)) : (i * 32);",
   "        : (g.top + vizRowBoxH + 2)) : (i * 32);",
   ["覆盖层锚点也用实时行盒高"]),
]

total_hit, total_miss = 0, 0
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3337.html"
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
        for f in hit[:6]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：" + str(len(hit)) + " 条（期望 " + str(len(expect_names)) + " 条关键词）")
        total_hit += 1
    else:
        print("  ⚠ 无具名断言变红（%s）——断言测错了对象或锚点失配，必须修" % (m.group(0) if m else "崩溃"))
        total_miss += 1
if os.path.exists("/tmp/mut-v3337.html"):
    os.remove("/tmp/mut-v3337.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (total_hit, total_miss))
sys.exit(1 if total_miss else 0)
