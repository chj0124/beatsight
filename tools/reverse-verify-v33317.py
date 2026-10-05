#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.17）——证明本批两处修复各有**具名断言**守着。
   纪律同 v3339/v33315：只改 /tmp 副本（走 BEATSIGHT_HTML）、必须出现具名 ✗、锚点唯一、变异忠实。

   用法：python3 tools/reverse-verify-v33317.py

   判定点：
     M21 把 lyricNeighbors 的「按时间取邻居」退回「按下标取」→ T202a 红（这正是用户报的钉死）
     M22 把 swapChars 退回「换下标 k+1」→ T202c 红（换错对象）
     M23 把 shiftLyricChars 的范围退回 chars.slice(fromK)（下标序）→ T202f 红
     M24 分组标题字号退回 11px（层级倒挂复原）→ T203a 红
     M25 分组头缩进与竖线复原（容器比内容深 18px）→ T203c 红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

SIDES_OLD = """      if (o.t <= c.t){
        const e = o.t + o.dur;
        if (e > min){ min = e; prevK = i; }
      } else if (o.t < nextT){ nextT = o.t; nextK = i; }"""
SIDES_INDEX = """      if (i === k - 1){
        const e = o.t + o.dur;
        if (e > min){ min = e; prevK = i; }
      } else if (i === k + 1){ nextT = Math.min(nextT, o.t); nextK = i; }"""

SWAP_NEW = """    let j = -1;
    for (let i = 0; i < chars.length; i++){
      if (i === k) continue;
      const o = chars[i];
      if (o && o.t > a.t && (j < 0 || o.t < chars[j].t)) j = i;
    }
    if (j < 0) return null;                       // 时间序最后一个字：右边没人可换"""
SWAP_OLD = """    const j = k + 1;
    if (j >= chars.length) return null;"""

SHIFT_RANGE_NEW = "    const tail = chars.filter((/** @type {any} */ c) => c.t >= base.t);"
SHIFT_RANGE_OLD = "    const tail = chars.slice(Math.max(0, Math.min(fromK, chars.length - 1)));"
SHIFT_MAP_NEW = "    return chars.map((/** @type {any} */ c) => (c.t >= base.t"
SHIFT_MAP_OLD = ("    const fromIx = Math.max(0, Math.min(fromK, chars.length - 1));\n"
                 "    return chars.map((/** @type {any} */ c, ix) => (ix >= fromIx")

GRP_NEW = ".preset-group{font-size:13px;color:var(--t1);font-weight:600;margin:10px 0 6px;"
GRP_OLD = ".preset-group{font-size:11px;color:var(--t3);font-weight:600;margin:10px 0 6px;"

GRP_INDENT_NEW = ("margin:10px 0 6px;\n"
                  "  display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}")
GRP_INDENT_OLD = ("margin:10px 0 6px 10px;padding-left:8px;\n"
                  "  border-left:2px solid var(--line);display:flex;align-items:center;gap:6px;\n"
                  "  cursor:pointer;user-select:none}")


def rep(s, old, new):
    assert s.count(old) == 1, "锚点 %d 处：%s" % (s.count(old), old[:50])
    return s.replace(old, new, 1)


MUTANTS = [
    ("M21 回退：lyricNeighbors 退回「按下标取邻居」（= 用户报的钉死）",
     lambda s: rep(s, SIDES_OLD, SIDES_INDEX),
     ["★★ 区间非退化", "★★ 新判据的 max"]),

    ("M22 回退：swapChars 退回「换下标 k+1」",
     lambda s: rep(s, SWAP_NEW, SWAP_OLD),
     ["★ 换位成功", "★ 「分」拿到了时间后邻"]),

    ("M23 回退：shiftLyricChars 范围退回 chars.slice(fromK)（下标序）",
     lambda s: rep(rep(s, SHIFT_RANGE_NEW, SHIFT_RANGE_OLD), SHIFT_MAP_NEW, SHIFT_MAP_OLD),
     ["★ 「能」也跟着动了", "★ 「不」也跟着动了"]),

    ("M24 回退：分组标题字号退回 11px（层级倒挂复原）",
     lambda s: rep(s, GRP_NEW, GRP_OLD),
     ["★★ 分组标题字号 ≥ 它管着的条目名字号"]),

    ("M25 回退：分组头缩进 + 竖线复原（容器比内容深 18px）",
     lambda s: rep(s, GRP_INDENT_NEW, GRP_INDENT_OLD),
     ["★ 去掉 border-left 竖线", "★ 去掉 padding-left:8px", "★ 去掉 margin-left:10px"]),
]

total_hit, total_miss = 0, 0
for name, fn, expect_names in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); total_miss += 1; continue
    mp = "/tmp/mut-v33317.html"
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
if os.path.exists("/tmp/mut-v33317.html"):
    os.remove("/tmp/mut-v33317.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (total_hit, total_miss))
sys.exit(1 if total_miss else 0)
