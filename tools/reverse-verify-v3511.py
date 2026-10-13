#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.51.1）——证明「底部歌词档播放/翻页页面回弹」这条修复有具名断言守着。
   用法：python3 tools/reverse-verify-v3511.py

   背景（用户实报，2026-10-13）：歌词位置选「集中在底部」时，页面向下滚动后按播放、
   或播放到当前页最后一行，页面被自动滚回上方（歌词滑出视野）；「贴在每行小节下」档不会。
   根因：#lyricLane 在底部档是**流内块**（follow 档是脱流覆盖层）；buildViz / buildLyricLane
   都是「先 clear → 再重建」，而原实现在"已清空、行未重建"的空窗里读了一次布局
   （buildViz 取 wpx、buildLyricLane 取 laneW）⇒ 浏览器按"缩矮的文档"强制排版、滚动位置被钳回。
   修法：两次量测都提到 clear 之前。T248 用桩的布局读数计数器在空窗期内计数，要求恒为 0。

   两个变异各自退掉一处修复，T248 的对应断言必须变红：
     M46 buildViz 的取宽挪回 clear 之后 → 「★★ #viz 在空窗期内零布局读取」红
     M47 buildLyricLane 的取宽挪回 clear 之后 → 「★★ #lyricLane 在空窗期内零布局读取」红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M46 buildViz 取宽挪回 clear(viz) 之后（复现原缺陷）", lambda s: s.replace(
        '      vizRowBeats = chooseRowBeats(vizW, vizSig, minStepOf(ap));',
        '      vizRowBeats = chooseRowBeats(viz.offsetWidth, vizSig, minStepOf(ap));   /* M46 mutated */', 1),
     ["★★ #viz 在空窗期内零布局读取"]),

    ("M47 buildLyricLane 取宽挪回 clear(lane) 之后（复现原缺陷）", lambda s: s.replace(
        '    lyricEl = lane; lyricChipEls = []; lyricFillEls = []; lyricRows = [];\n'
        '    lyricRunSig = ""; lyricW = 0; lastLyricStates = "";\n'
        '    clear(lane);',
        '    lyricEl = lane; lyricChipEls = []; lyricFillEls = []; lyricRows = [];\n'
        '    lyricRunSig = ""; lyricW = 0; lastLyricStates = "";\n'
        '    clear(lane);\n'
        '    /* M47 mutated：取宽挪回 clear 之后 */\n'
        '    const _m47viz = $("viz");\n'
        '    const _m47w = (_m47viz && _m47viz.offsetWidth) || lane.offsetWidth || 0;', 1),
     ["★★ #lyricLane 在空窗期内零布局读取"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v3511.html"
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
if os.path.exists("/tmp/mut-v3511.html"):
    os.remove("/tmp/mut-v3511.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
