#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.5）——证明「歌词轨裁剪盒高」这批修复有具名断言守着。
   纪律同 tools/reverse-verify-v331x.py（只改 /tmp 副本 / 必须具名 ✗ / 锚点唯一 / 崩溃型单列）。
   用法：python3 tools/reverse-verify-v3335.py
   判定点（对照 tests/cases/t189-lyric-clip-last-row.js 与 t155 T155d）：
     M5 盒高退回「与 #viz 同高」（缺陷原样，歌词行锚在行盒底 +2 ⇒ 末槽/传送带整行被裁）
        → T155d 新口径 + T189a + T189b 整组红
     M6 盒高开成「一个整槽 + 行盒」（**过修**：把再下一槽的进场行歌词也放出来）
        → T189a 的「进场行仍在盒外」红（防假修复）
   ★ 这两条互为反向：M5 是"治不住"，M6 是"治过头"——两个方向都要有断言守着。"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

RET = "    return vizH + 2 + rowH + 6;"

MUTANTS = [
  ("M5 v3.33.5 回退：裁剪盒高退回「与 #viz 同高」（缺陷原样）",
   RET, "    return vizH;",
   ["歌词轨裁剪高度", "歌词轨裁剪高度**大于**", "第 3 槽歌词", "第 0 槽歌词"]),

  ("M6 v3.33.5 过修：盒高开成一个整槽 + 行盒（把进场行歌词也放出来）",
   RET, "    return vizH + scrollSlotH + vizRowBoxH;",
   ["进场行（第 4 槽）歌词顶仍在盒外"]),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3335.html"
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
os.remove("/tmp/mut-v3335.html") if os.path.exists("/tmp/mut-v3335.html") else None
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
