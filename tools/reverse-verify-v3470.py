#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.47.0 · 分解和弦伴奏型——逐弦拨弦 str）
   用法：python3 tools/reverse-verify-v3470.py
   M78a schedOneStep 三分支回落 playClick（str 分支删除）→ t240d 发声层具名红
   M78b 主视图 buildRowCells 的 str 渲染分支短路     → t240b 渲染层具名红
   M78c normStr 收掉校验（raw 原样透传）             → t240a 数据层具名红
   M78d 编辑器 strRow 点击监听断开（改挂无害元素）   → t240c 编辑器具名红
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸（本机实测）
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M78a schedOneStep 三分支回落 playClick（str 发声分支删除）",
     lambda s: s.replace(
         '        if (sv.kind === "pick1") pluckHit(t0, strumPeak(isAcc, isBeatPos(cumT / TPB)));\n'
         '        else if (sv.kind === "pickN") strumZoneHit(t0 - latOff(), strumPeak(isAcc, isBeatPos(cumT / TPB)), 1);\n'
         '        else playClick(t0, cumT / TPB, isAcc, stepZone);',
         '        playClick(t0, cumT / TPB, isAcc, stepZone);', 1),
     ["pluckHit", "单弦格", "全扫双频段", "onsetBuf 条数", "strumVol"]),
    ("M78b 主视图 buildRowCells 的 str 渲染分支短路",
     lambda s: s.replace(
         '      if (s.str && hasStr){\n'
         '        const sm = document.createElement("div");\n'
         '        sm.className = "strumv pick" + (s.rest ? " ghost" : "");\n'
         '        pickGlyph(sm, s.str);\n'
         '        sm.dataset.i = String(i);',
         '      if (false && s.str && hasStr){\n'
         '        const sm = document.createElement("div");\n'
         '        sm.className = "strumv pick" + (s.rest ? " ghost" : "");\n'
         '        pickGlyph(sm, s.str);\n'
         '        sm.dataset.i = String(i);', 1),
     ["逐弦点宿主", "逐弦点", "纯 str 型", "SVG"]),
    ("M78c normStr 收掉校验（raw 原样透传，升序/去重/白名单全失效）",
     lambda s: s.replace(
         '  out.sort((a, b) => a.s - b.s);\n'
         '  return out.length ? out : undefined;',
         '  return (Array.isArray(raw) && raw.length) ? raw : undefined;', 1),
     ["按 s 升序", "保留首个", "越界被丢", "只丢品号", "tech", "rest 格"]),
    ("M78d 编辑器 strRow 点击监听断开（改挂 strFillHint）",
     lambda s: s.replace(
         '  $("strRow").addEventListener("click", (/** @type {MouseEvent} */ e) => {',
         '  $("strFillHint").addEventListener("click", (/** @type {MouseEvent} */ e) => {', 1),
     ["点 ⑤", "加 ②", "技巧钮循环", "品数在技巧循环", "重新选中后"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-v3470.html"
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
if os.path.exists("/tmp/mut-v3470.html"):
    os.remove("/tmp/mut-v3470.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
