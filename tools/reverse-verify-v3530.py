#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.39.0 节奏型页面改造）——证明「新建节奏型空态起步 + 音符块库上移 +
   悬浮窗弹法四档重组」这批改动各自有具名断言守着。用法：python3 tools/reverse-verify-v3530.py

   五个变异各自退掉一处，对应用例的具名断言必须变红：
     M1 openBlank 空底稿退化为预填四分（文案与行为再次背离）→ t255a「bars = [[]]」红
     M2 删 #palZone 的 guide-ring 同步（块库入口失去空态红框）→ t255a「两处填充入口」红
     M3 关掉空轨道引导层渲染 → t255a「.ed-guide 引导层」红
     M4 techRow 点档落库分派空转（只推栈不写字段）→ t256b 四档落库断言红
     M5 行显隐矩阵恒全显 → t256d「节拍档四行全收」红
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。
   （历史脚本用 /tmp 直写；Windows 沙箱无 /tmp，改 tempfile.gettempdir()——铁律不变。）"""
import io, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
TMP = os.path.join(tempfile.gettempdir(), "mut-v3530.html")

MUTANTS = [
    ("M1 openBlank 空底稿退化为预填四分", lambda s: s.replace(
        "bars: [[]] };",
        "bars: [[{ t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }]] };"),
     ["bars = [[]]", "1 个空小节", "空白底稿"]),

    ("M2 删 #palZone 的 guide-ring 同步", lambda s: s.replace(
        'if (palZone) palZone.classList.toggle("guide-ring", showGuide);\n', ""),
     ["两处填充入口", "guide-ring", "红框"]),

    ("M3 关掉空轨道引导层渲染", lambda s: s.replace(
        "if (showGuide && b === 0){", "if (false){", 1),
     [".ed-guide 引导层", "引导层", "ed-guide"]),

    ("M4 techRow 点档落库分派空转（只推栈不写字段）", lambda s: s.replace(
        'pushUndo();\n    if (want === "beat"){',
        'pushUndo();\n    if (false && want === "beat"){', 1),
     ["点「节拍」", "点「扫弦」", "点「琶音」", "点「分解」", "落库"]),

    ("M5 行显隐矩阵恒全显（hidden 恒 false）", lambda s: s.replace(
        '["dirRow", "zoneRow", "airRow", "strRow"].forEach(id => { ($(id)).hidden = !rowVisible[id]; });',
        '["dirRow", "zoneRow", "airRow", "strRow"].forEach(id => { ($(id)).hidden = false; });', 1),
     ["全收", "显隐", "hidden", "节拍档"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    io.open(TMP, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=TMP)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=1800)
    out = r.stdout or ""
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    hit = [f for f in failed if any(k in f for k in keys)]
    if hit:
        print("  " + (m.group(0) if m else "(未取到汇总)"))
        for f in hit[:5]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条" % len(hit))
        hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:5]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists(TMP):
    os.remove(TMP)
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
