#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.51.2）——证明「底栏胶囊名字槽空间显隐闸（胶囊内白点）」这条修复
   有具名断言守着。用法：python3 tools/reverse-verify-v3512.py

   背景（用户实拍 + 真机复现，2026-10-13）：窄屏底栏胶囊内右部残留灰白「白点」。
   胶囊里除「‹ 浏览节奏型」外并排两个名字槽（#argNowName 段名 / #patternName 型名）；
   ≤960 三列两行布局下胶囊只占 col1-2、再收 16px，~361 视口仅 ~103px，固定件吃掉 ~98px 后
   两槽被压到 1–4px。两槽虽早带全套 text-overflow:ellipsis，但槽宽 < 首字 + 省略号时
   ellipsis 放不下「…」，Chrome 退化**硬剪字形边缘** ⇒ 露出「引」字左缘竖条 +「节」字艹部残笔。
   修法：与字体无关的普适下限 **2em** —— 低于它整体隐藏（.cramped），判据 pbNameCramped。
   T175f 钉住：CSS 两条规则 + 纯判据 + RO 挂点 + refreshBar 尾调用。

   三个变异各自退掉一处，T175f 的对应断言必须变红：
     M81 删 CSS `.pb-ctx b.cramped{display:none}` → 「槽宽低于可读下限整体隐藏」源码钉红
     M82 判据下限 2em → 0.2em → 纯函数断言（4.25px 应判 cramped）红
     M83 删 refreshBar 尾的 syncPbCtxCramp() 调用 → 「refreshBar 尾部兜边角」源码钉红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M81 删 .pb-ctx b.cramped{display:none}（槽宽低于下限不再整体隐藏）", lambda s: s.replace(
        '.pb-ctx b.cramped{display:none}',
        '/* M81 mutated：隐藏规则删除 */', 1),
     ["槽宽低于可读下限整体隐藏"]),

    ("M82 判据下限 2em → 0.2em（阈值失守，4.25px 也应被隐藏却放行）", lambda s: s.replace(
        'function pbNameCramped(w, fontPx){ return !(w >= fontPx * 2); }',
        'function pbNameCramped(w, fontPx){ return !(w >= fontPx * 0.2); }   /* M82 mutated */', 1),
     ["纯判据", "4.25px", "21.9px"]),

    ("M83 删 refreshBar 尾的 syncPbCtxCramp()（模式切换不再兜空间闸）", lambda s: s.replace(
        '\n    syncPbCtxCramp();\n  }\n  /* 播放中每个小节边界回调',
        '\n  }\n  /* 播放中每个小节边界回调', 1),
     ["refreshBar 尾部兜"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v3512.html"
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
if os.path.exists("/tmp/mut-v3512.html"):
    os.remove("/tmp/mut-v3512.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
