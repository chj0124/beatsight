#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.34.5）——证明「图例恢复入口」这条修复有具名断言守着。
   用法：python3 tools/reverse-verify-v3345.py

   背景（2026-10-06 审计 A-1）：v3.1.0 的图例只有单向出口「知道了」——
   点一次就永久隐藏，全文件无任何入口能置回 true。v3.34.5 补了设置 → 画面图层
   的 `vizLegendToggle` 开关，让"关掉"变成可逆动作。

   四个变异各自退掉一处修复，T205 的对应断言必须变红：
     M40 开关点击不再翻转状态        → 「点开关 → S.vizLegend 翻回 true」红
     M41 「知道了」不再同步开关      → 「点「知道了」后开关同步翻到「关」」红（开关说谎）
     M42 boot 不再按存档收敛开关     → 「重载后开关如实显示「关」」红（标记里写死的 on 说谎）
     M43 开关翻转了但不改 DOM        → 「图例重新出现」红（状态对了画面不动）
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M40 开关点击不再翻转状态（去掉 !）", lambda s: s.replace(
        'bindToggle("vizLegendToggle", () => (S.vizLegend = !S.vizLegend), () => {',
        'bindToggle("vizLegendToggle", () => (S.vizLegend), () => {', 1),
     ["★ 点开关 → S.vizLegend 翻回 true", "★★ 图例重新出现"]),

    ("M41 「知道了」不再同步开关（开关留在「开」位说谎）", lambda s: s.replace(
        '  setToggle("vizLegendToggle", false);',
        '  /* M41 mutated */', 1),
     ["★★ 点「知道了」后开关同步翻到「关」"]),

    ("M42 boot 不再按存档收敛开关初值", lambda s: s.replace(
        'setToggle("vizLegendToggle", S.vizLegend);',
        '/* M42 mutated */', 1),
     ["★★ 重载后开关如实显示「关」"]),

    ("M43 开关翻转状态但不改 DOM 显隐", lambda s: s.replace(
        '    $("vizLegend").hidden = !S.vizLegend;\n    Viz.relayout();',
        '    Viz.relayout();', 1),
     ["★★ 图例重新出现"]),
    # ── v3.34.5 审计 B-1：后台节流解释条 ──
    # ★ 关键设计：它只在「真的被饿过（reanchor starved）」时出现，不是猜的。
    #   撤掉 starved 置位 ⇒ 条件永不成立 ⇒ 解释条永远不出现（用户又只剩"好像卡了一下"）。
    ("M44 撤掉 starved 置位（解释条永不出现）", lambda s: s.replace(
        '  if (why === "starved") bgStarved = true;',
        '  /* M44 mutated */', 1),
     ["★★ 回前台 ⇒ 解释条出现"]),
    # 撤掉 stop() 里的收起 ⇒ 停机后横幅挂着不走，且下一轮背着上一轮的结论
    ("M45 撤掉 stop() 里的收起与清标志", lambda s: s.replace(
        '    syncBgHint();   // v3.34.5（B-1）：停机即收起「后台被节流」解释条并清掉本轮标志',
        '    /* M45 mutated */', 1),
     ["★★ 重新开播不背着上一轮的「被饿过」结论"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v3345.html"
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
if os.path.exists("/tmp/mut-v3345.html"):
    os.remove("/tmp/mut-v3345.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
