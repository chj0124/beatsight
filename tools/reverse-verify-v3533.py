#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.53.3 节奏型编辑界面四项修正 · PLAN-v14）——证明本批四处改动各自有具名断言守着。
   用法：python3 tools/reverse-verify-v3533.py

   四个变异各自退掉一处，对应用例（t259）的具名断言必须变红：
     M1 撤销钮挪回顶栏（删 .ed-actions 那颗 + 塞进顶栏动作区）→ t259a「顶栏动作区不再出现撤销钮」红
     M2 恢复「模板」标签 span → t259b「模板外壳内不再有…标签」红
     M3 删 #edPop 的 pill 收紧规则 → t259c「弹层内 pill 收紧」红
     M4 .ed-guide 行高退回 1.8 → t259c「引导层行高收为 1.5」红
   三条铁律：变异只改临时副本、必须出现具名 ✗（崩溃不算证据）、锚点失配要大声失败。
"""
import io, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
TMP = os.path.join(tempfile.gettempdir(), "mut-v3533.html")

# ---- 逐字锚点（失配则大声失败，不静默产出错误变异）----
UNDO_LINE = ('        <button class="pill outline" id="undoBtn" disabled aria-label="撤销上一步草稿修改（Ctrl+Z）">'
             '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
             '<path d="M9 14 4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
             '<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
             '</svg>撤销</button>\n')
TOPBAR_MARK = '撤销钮已归位到网格下方'   # 编辑器顶栏 PLAN-v14 注释里的唯一短语（定位插回点）
TPL_WRAP = '<span class="ed-meter ed-tpl" id="edTplWrap">\n'
POP_PILL_RULE = '#edPop .pill{padding:5px 8px;font-size:11.5px}\n'
GUIDE_LH = '  font-size:12px;line-height:1.5;color:var(--t3);padding:0 12px}'


def _need(s, anchor, name):
    if s.count(anchor) != 1:
        raise AssertionError("锚点非唯一/缺失（%s）：%r 出现 %d 次" % (name, anchor[:40], s.count(anchor)))
    return s


def m1(s):
    _need(s, UNDO_LINE, "M1 撤销钮"); _need(s, TOPBAR_MARK, "M1 顶栏注释")
    s = s.replace(UNDO_LINE, "", 1)                      # 从 .ed-actions 摘掉
    idx = s.index(TOPBAR_MARK)
    line_start = s.rfind("\n", 0, idx) + 1               # 顶栏注释行行首（在 <div class="editor-actions"> 内）
    ins = '        <button class="pill outline" id="undoBtn" disabled>撤销</button>\n'
    return s[:line_start] + ins + s[line_start:]         # 插回顶栏动作区


def m2(s):
    _need(s, TPL_WRAP, "M2 模板外壳")
    return s.replace(TPL_WRAP, TPL_WRAP + '          <span class="lab">模板</span>\n', 1)


def m3(s):
    _need(s, POP_PILL_RULE, "M3 弹层 pill 规则")
    return s.replace(POP_PILL_RULE, "", 1)


def m4(s):
    _need(s, GUIDE_LH, "M4 引导行高")
    return s.replace(GUIDE_LH, GUIDE_LH.replace("line-height:1.5", "line-height:1.8"), 1)


MUTANTS = [
    ("M1 撤销钮挪回顶栏", m1,
     ["顶栏动作区不再出现撤销钮", "撤销钮位于网格下方"]),
    ("M2 恢复「模板」标签 span", m2,
     ["模板外壳内不再有", "标签"]),
    ("M3 删 #edPop 的 pill 收紧规则", m3,
     ["弹层内 pill 收紧"]),
    ("M4 .ed-guide 行高退回 1.8", m4,
     ["引导层行高收为 1.5"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    try:
        mut = fn(orig)
    except AssertionError as e:
        print("!! 脚本自身腐烂（锚点失配）：" + name + "：" + str(e)); rot_n += 1; continue
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
print("命中 %d / 未命中 %d / 自身腐烂 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
