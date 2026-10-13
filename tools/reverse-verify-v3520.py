#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.52.0）——证明「编辑器记谱交互改造：air 无方向空扫 · 块库休止符退役 ·
   内联小箭头清理」这批改动各自有具名断言守着。用法：python3 tools/reverse-verify-v3520.py

   背景（PLAN-v12 定稿）：悬浮窗「发声」行拆成两组开关（restRow 发声/休止 + airRow 实扫/空扫）；
   新增可选字段 air:true（仅在 rest===true 有意义），空扫判据统一为 rest && (dir || air)；
   块库四分休止符退役；编辑器内联 .ed-strum ↑↓ 字形退役。本脚本五个变异各自退掉一处，
   对应用例的具名断言必须变红：
     M1  回退三处渲染的空扫分支（air 不再渲染无头杆）→ t250 红
     M2  回退软选中（palette 不再写 edSel.auto）→ t253 红
     M3  恢复 .ed-strum 内联字形渲染 → t254 红
     M4  stepHasStrumLike 去掉 air（纯 air 型不再归扫弦）→ t250 分类断言红
     M5  导入白名单去掉 air 保留 → t252（及 t250 导入路径）红
   三条铁律：变异只改 /tmp 副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M1 回退三处渲染的空扫分支（(s.dir||(s.rest&&s.air)) → (s.dir)）", lambda s: s.replace(
        "(s.dir || (s.rest && s.air))", "(s.dir)"),
     ["air", "空扫", "无头"]),

    ("M2 回退软选中（palette 只认 edSel，连点变替换）", lambda s: s.replace(
        "if (edSel && !edSel.auto){ d.bars[edSel.bar].splice(edSel.idx, 1, ...steps); }",
        "if (edSel){ d.bars[edSel.bar].splice(edSel.idx, 1, ...steps); }", 1),
     ["软选中", "自动选中", "连点"]),

    ("M3 恢复 .ed-strum 内联 ↑↓ 字形渲染（编辑器格子重新产出该节点）", lambda s: s.replace(
        'sv.setAttribute("aria-hidden", "true");',
        'if (!s.rest && s.dir && s.dir !== "A"){ const ds = document.createElement("span"); '
        'ds.className = "ed-strum"; ds.textContent = s.dir === "D" ? "↑" : "↓"; c.appendChild(ds); }\n'
        '          sv.setAttribute("aria-hidden", "true");', 1),
     ["ed-strum"]),

    ("M4 stepHasStrumLike 去掉 air（纯 air 型不再归「扫弦」）", lambda s: s.replace(
        "|| !!(s.str && s.str.length) || s.air === true);",
        "|| !!(s.str && s.str.length));", 1),
     ["air", "扫弦"]),

    ("M5 导入白名单去掉 air 保留（air 一律省略）", lambda s: s.replace(
        "const air = (s.rest === true && s.air === true) ? true : undefined;",
        "const air = undefined;", 1),
     ["air"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v3520.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=1200)
    out = r.stdout
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
if os.path.exists("/tmp/mut-v3520.html"):
    os.remove("/tmp/mut-v3520.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
