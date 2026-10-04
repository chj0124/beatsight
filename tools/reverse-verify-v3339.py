#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.9）——证明「日间弹窗头部挤压」与「两走道对齐」有具名断言守着。
   纪律同 tools/reverse-verify-v333x.py（只改 /tmp 副本 / 必须具名 ✗ / 锚点唯一 / 崩溃型单列）。
   用法：python3 tools/reverse-verify-v3339.py
   判定点（对照 tests/cases/t192-day-layout-rules.js）：
     M13 删掉弹窗头部的两条例外（角标恢复 width:100%、标题恢复可收缩）→ T192a 全红
     M14 右列内边距退回 44px（与左列角标占位同值）→ T192b 红（这条就是"预备拍对齐到标题行"的成因）
   ★ 另有行为面证据（不进本脚本、属一次性人工取证）：把这两处 CSS 回退进仓库副本跑冒烟，
     「日间·设置标题竖排（w=24 行数=2）」与「日间·预备拍 vs +5 差 −35px」两条断言变红、经典仍绿。"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

DGL = 'body[data-theme="obs"] .dialog-head .sec-tag{display:inline-flex;width:auto;margin:0;flex:none}'
DGT = 'body[data-theme="obs"] .dialog-title{white-space:nowrap;flex:none}'
ALIGN_L = 'body[data-theme="obs"] .viz-head-grid .viz-head > .group{padding-top:44px}'
ALIGN_R = 'body[data-theme="obs"] .viz-head-grid .viz-toggles{padding-top:79px}'
ALIGN_OLD = ALIGN_L + "\n" + ALIGN_R

MUTANTS = [
  ("M13 v3.33.9 回退：弹窗头部角标不再收 inline-flex（标题被挤成一字宽）",
   DGL + "\n" + DGT,
   "",
   ["弹窗头部角标 = inline-flex", "弹窗标题 nowrap"]),

  ("M14 v3.33.9 回退：右列内边距退回 44px（与左列角标占位同值）",
   ALIGN_OLD,
   'body[data-theme="obs"] .viz-head-grid .viz-head > .group,\nbody[data-theme="obs"] .viz-head-grid .viz-toggles{padding-top:44px}',
   ["右列（开关列）内边距 > 44px"]),
]

total_hit, total_miss = 0, 0
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3339.html"
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
if os.path.exists("/tmp/mut-v3339.html"):
    os.remove("/tmp/mut-v3339.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (total_hit, total_miss))
sys.exit(1 if total_miss else 0)
