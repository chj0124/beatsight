#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.23）——证明「拖动后不选中」这条修复有具名断言守着。
   用法：python3 tools/reverse-verify-v33323.py
   M30 撤掉 onDragEnd 位移提交路径的 selectChip → T119x 红
   M31 撤掉 no-op 路径的 selectChip → T119x 红（这条单独钉"两条路径都补"）
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

A = """    selectChip(selP, true);            // v3.33.23：拖完即选中（先写模块态，再重渲染回挂 .sel）
    arrangeRender();"""
A_MUT = """    arrangeRender();"""
B = """      selectChip(selP, true);          // 拖回原位：不动库、不重绘，但该块进入选中态
      return;"""
B_MUT = """      return;"""

MUTANTS = [
    ("M30 撤掉「位移提交」路径的 selectChip", lambda s: s.replace(A, A_MUT, 1),
     ["★★ 拖动结束后**恰好一个**块处于选中态"]),
    ("M31 撤掉「拖回原位(no-op)」路径的 selectChip", lambda s: s.replace(B, B_MUT, 1),
     # ★ 初版这里写的是 T119x 的文案，与 T119y 对不上 ⇒ 误报"未命中"
     ["★★ no-op 路径也要选中"]),
    # ── v3.33.25：`.collide` / `.t16-off` 两套机制已退役 ──
    #    原 M32/M33 是「把挂类/跳格加回去」，但那些代码已被删除 ⇒ 变异会因 needT16 未定义而**崩溃**，
    #    崩溃不算证据。故改为把**CSS 规则**加回去：源码钉（T201f 的 !/t16-off/ 与 !/.sub.collide{/）必须变红。
    ("M32 把 `.collide` 的 CSS 规则加回去", lambda s: s.replace(
        ".cell .usubs{",
        ".cell .subs .sub.collide{border-right:none}\n.cell .usubs{", 1),
     ["★★ v3.33.25：.t16-off 与 .collide 两套机制"]),
    ("M33 把 `.t16-off` 的 CSS 规则加回去", lambda s: s.replace(
        ".cell .usubs{",
        ".cell .subs.t16-off .sub{border-right:none}\n.cell .usubs{", 1),
     ["★★ v3.33.25：.t16-off 与 .collide 两套机制"]),
    # ── v3.33.25：刻度线「以最小单位为据」——退回十六分粒度，断言必须变红 ──
    ("M34 主视图刻度线退回十六分粒度（U→T16）", lambda s: s.replace(
        '        const nU = Math.floor((s.t - 1) / U);',
        '        const nU = Math.floor((s.t - 1) / T16);', 1).replace(
        '            it.style.left = (k * U / s.t * 100) + "%";',
        '            it.style.left = (k * T16 / s.t * 100) + "%";', 1),
     ["★★ 四分格内部**恰 1 条**"]),
    ("M35 编排页刻度线退回十六分粒度（U→T16）", lambda s: s.replace(
        '        for (let k = 1; k * U < s.t; k++){',
        '        for (let k = 1; k * T16 < s.t; k++){', 1).replace(
        '          sub.style.left = (k * U / s.t * 100) + "%";',
        '          sub.style.left = (k * T16 / s.t * 100) + "%";', 1),
     # ★ 初版关键词又写错（写成了 T201e 混排那条；本变异实际红的是 T201e 的**全八分**两条）
     ["★ 全型都是八分整数倍", "★ 全八分 ⇒ 编排页同样不画块内刻度"]),
]

hit_n, miss_n = 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配）：" + name); miss_n += 1; continue
    mp = "/tmp/mut-v33323.html"
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
if os.path.exists("/tmp/mut-v33323.html"):
    os.remove("/tmp/mut-v33323.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (hit_n, miss_n))
sys.exit(1 if miss_n else 0)
