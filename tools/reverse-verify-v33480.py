#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.48.0 · 待命球 2 拍上限 / 逐弦记号几何重排 / 编辑器模板下拉）
   用法：python3 tools/reverse-verify-v33480.py
   M79a 待命球 2 拍上限摘除（门恒 false）          → t241 具名红
   M79b pick svg 几何退回 100%/钉宽（拉伸双根因） → t240b 的 CSS 钉子具名红
   M79c 编辑器模板下拉 change 监听断开             → t242 具名红
   M79d pickGlyph 弦距退回 8.6（与 56px 跑道脱钩） → t240b 几何断言具名红
   M79e 编排页恒 notxt 摘除（总览行复活底衬胶囊）  → t240b-4 具名红
   M79f has-pick 升档摘除（恒 false）              → t240b-1/1b 具名红
   M79g 带品弦不画点（窄屏整格全空复发）           → t240b 兜底断言具名红
   M79h haslab 藏点规则摘除（圆点边缘复发）        → t240b 的 CSS 钉子具名红
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸（本机实测）
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M79a 待命球 2 拍上限摘除（门恒 false，回到全程干等）",
     lambda s: s.replace(
         '          if (b2.t - now > 2 * spb()) show = false;',
         '          if (false) show = false;', 1),
     ["最多提前 2 拍", "空档前段", "待命球不现身"]),
    ("M79b pick svg 几何退回（height:100% 整行拉伸 + 宽钉死 26px 只缩纵向 ⇒「圆点太大/不圆」双根因复活）",
     lambda s: s.replace(
         'width:calc(26px * var(--pick-sy, 1));height:var(--pick-h)',
         'width:26px;height:100%', 1),
     ["--pick-h", "--pick-sy", "点恒圆"]),
    ("M79c 编辑器模板下拉 change 监听断开（改挂 editorTitle）",
     lambda s: s.replace(
         '  $("editorTplSel").addEventListener("change", (/** @type {Event} */ e) => {',
         '  $("editorTitle").addEventListener("change", (/** @type {Event} */ e) => {', 1),
     ["载入模板", "选完回占位", "标题改挂"]),
    ("M79d pickGlyph 弦距退回 (s−1)×8.6（与 56px 跑道的六线落点脱钩）",
     lambda s: s.replace(
         '    const cy = (e.s - 1) * 11;',
         '    const cy = (e.s - 1) * 8.6;', 1),
     ["cy", "⑤弦点", "②弦点"]),
    ("M79e 编排页恒 notxt 摘除（30px 总览行复活底衬胶囊）",
     lambda s: s.replace(
         '        sm.className = "strumv pick notxt" + (s.rest ? " ghost" : "");',
         '        sm.className = "strumv pick" + (s.rest ? " ghost" : "");', 1),
     ["恒 notxt", "编排页"]),
    ("M79f has-pick 升档摘除（恒 false，含 str 的型跑道不再升 56px）",
     lambda s: s.replace(
         '    $("viz").classList.toggle("has-pick", hasPick);',
         '    $("viz").classList.toggle("has-pick", false);', 1),
     ["has-pick", "升档"]),
    ("M79g 带品弦不画点（回到三轮「数字即标记」⇒ 窄屏藏品后整格全空复发）",
     lambda s: s.replace(
         '    svg.appendChild(c);\n    if (label){',
         '    if (!label) svg.appendChild(c);\n    if (label){', 1),
     ["带品格也有 1 颗点", "兜底"]),
    ("M79h haslab 藏点规则摘除（数字两侧露出圆点边缘复发——五轮用户实拍）",
     lambda s: s.replace(
         '.strumv.pick .pick-dot.haslab{display:none}',
         '.strumv.pick .pick-dot.haslab{display:block}', 1),
     ["haslab", "藏点"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-v33480.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=900)   # 子进程输出是 UTF-8，GBK 控制台下 text=True 默认按 locale 解码会炸（本机实测）
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    hit = [f for f in failed if any(k in f for k in keys)]
    if hit:
        print("  " + (m.group(0) if m else "(未取到汇总)"))
        for f in hit[:6]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条" % len(hit)); hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:4]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists("/tmp/mut-v33480.html"):
    os.remove("/tmp/mut-v33480.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
