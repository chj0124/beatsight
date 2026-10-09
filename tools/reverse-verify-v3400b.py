#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.40.0 批 2/4 · 控制芯）——证明芯形态三件套都有具名断言守着。
   用法：python3 tools/reverse-verify-v3400b.py
   M42 删芯容器 402 居中规则 → T231a 红（芯形态）
   M43 删芯顶胶囊行三枚开关 → T231b 红（胶囊行接线）
   M44 浮层壳显隐反转（sh.hidden = show）→ T231c 红（镜像契约）
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M42 删芯容器 max-width:402 居中规则",
     lambda s: s.replace(
         "  .viz-head-grid .card-head-left .group{max-width:402px;margin:0 auto}   /* position:relative 已在浮层 CSS 段全档给出 */",
         "  /* M42: 芯容器居中规则被删 */", 1),
     ["芯容器 402px 居中"]),
    ("M43 删芯顶胶囊行三枚开关",
     lambda s: s.replace(
         '''            <div class="core-pills">
              <span class="core-pill-grp">
                <button class="toggle-pill off" id="countInToggle" role="switch" aria-checked="false">预备<span class="switch"></span></button>
                <span class="inp-with-unit" id="countInBeatsWrap"><input class="tr-inp" id="countInBeats" type="number" min="1" max="8" value="4" aria-label="预备拍数"><span class="hint">拍</span></span>   <!-- 常显（v3.22.0 用户需求：关闭预备也显示上次设置的拍数） -->
              </span>
              <button class="toggle-pill off" id="muteToggle" role="switch" aria-checked="false">静音<span class="switch"></span></button>
              <button class="toggle-pill off" id="trainerToggle" role="switch" aria-checked="false">变速<span class="switch"></span></button>
            </div>''',
         "            <!-- M43: 胶囊行被删 -->", 1),
     ["芯顶胶囊行切片取到", "三件之一且带 role=switch"]),
    ("M44 浮层壳显隐反转（sh.hidden = show）",
     lambda s: s.replace(
         "    const sh = $(shellMap[k]);\n    if (sh) sh.hidden = !show;",
         "    const sh = $(shellMap[k]);\n    if (sh) sh.hidden = show;", 1),
     ["浮层壳镜像面板", "壳随之隐藏", "强制路径下浮层壳同步可见", "填目标即收浮层"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v3400b.html"
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
if os.path.exists("/tmp/mut-v3400b.html"):
    os.remove("/tmp/mut-v3400b.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
