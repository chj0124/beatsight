#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.15）——证明本批三处改动各有**具名断言**守着。
   纪律同 tools/reverse-verify-v333x.py / v3339.py：只改 /tmp 副本（走 BEATSIGHT_HTML）、
   必须出现具名 ✗（崩溃不算证据）、锚点必须唯一、变异尽量**忠实**（撤掉修复、保留写入）。

   用法：python3 tools/reverse-verify-v33315.py

   判定点（对照 tests/cases/t201-t16-ruler.js 与 tools/smoke.js）：
     M15 引用提示搬回顶栏内（v3.33.15 前的形状）→ T201f「已不在 .editor-topbar 内」红
     M16 .editor-actions 的 flex:none 退回"只在 ≤640px 生效" → T201f 那条 CSS 不变量红
     M17 撤掉 needsT16Ruler 判据（恒画，= 本批之前的行为）→ T201a/T201b 红、t145c 红
     M20 编排页刻度恒退回十六分网格 → T201e「全八分不画」红
     注：旧 M18/M19 的「撞箭头让位」机制已退役，不再对当前代码做无效变异。

   ★ 另有行为面证据（不进本脚本、需真机）：M15 忠实回退后再跑 `node tools/smoke.js`，
     「引用提示在 .editor-topbar 之外」与「长提示落在顶栏下方」两条真机断言变红。
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

REF_DIV = '    <div class="hint" id="editorRefNote"></div>\n'
# 锚点必须唯一：全文件有**两处** .editor-actions（编辑器与编排浮层），
# 故带上紧随其后的 auditionBtn（只有编辑器那一处有）才唯一。
ACTIONS_DIV = ('      <div class="editor-actions">\n'
               '        <!-- ★ PLAN-v14（用户实拍图二）：撤销钮已归位到网格下方 .ed-actions（「离编辑区太远」）——\n'
               '             顶栏只剩过程动作「试听」。 -->\n'
               '        <button class="pill outline" id="auditionBtn">试听</button>\n')


def mutate_note_back(s):
    """M15：忠实回退——把引用提示搬回 .editor-topbar 内部（它原先是第三个 flex 子项）。"""
    assert s.count(REF_DIV) == 1, "refNote 锚点非唯一"
    s2 = s.replace(REF_DIV, "", 1)
    assert s2.count(ACTIONS_DIV) == 1, "editor-actions 锚点非唯一"
    return s2.replace(ACTIONS_DIV, '      ' + REF_DIV.strip() + "\n" + ACTIONS_DIV, 1)


MUTANTS = [
    ("M15 v3.33.15 回退：引用提示搬回顶栏内（顶栏又变成三段挤压）",
     mutate_note_back,
     ["★ 引用提示已**不在** .editor-topbar 内", "★ 提示落在「顶栏收尾」与「下方卡片」之间"]),

    ("M16 v3.33.15 回退：.editor-actions 的 flex:none 退回只在 ≤640px 生效",
     lambda s: s.replace(".editor-actions{display:flex;gap:var(--sp-3);flex:none}",
                         ".editor-actions{display:flex;gap:var(--sp-3)}", 1),
     ["★ CSS 不变量：.editor-actions 的 flex:none"]),

    ("M17 v3.33.15 回退：撤掉 needsT16Ruler 判据（恒画刻度，= 本批之前的行为）",
     lambda s: s.replace("(s.t % T8 !== 0)", "true", 1),
     ["★ .subs 带 .t16-off", "★ 全八分 ⇒ 不画", "★ 全型都是八分整数倍"]),

    ("M20 v3.33.15 回退：编排页刻度恒退回十六分网格",
     lambda s: s.replace("const U = minUnitOf(pat);", "const U = T16;", 1),
     ["★ 全八分 ⇒ 编排页同样不画块内刻度"]),
]

total_hit, total_miss = 0, 0
for name, fn, expect_names in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变需同步本脚本）：" + name)
        total_miss += 1
        continue
    mp = "/tmp/mut-v33315.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    hit = [f for f in failed if any(e in f for e in expect_names)]
    if hit:
        print("  " + (m.group(0) if m else "(未取到汇总)"))
        for f in hit[:6]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：" + str(len(hit)) + " 条（命中 " + str(len(expect_names)) + " 个关键词）")
        total_hit += 1
    else:
        print("  ⚠ 无具名断言变红（%s）——断言测错了对象或锚点失配，必须修"
              % (m.group(0) if m else "崩溃"))
        if failed:
            for f in failed[:6]:
                print("     (实际红的是) ✗ " + f[:110])
        total_miss += 1
if os.path.exists("/tmp/mut-v33315.html"):
    os.remove("/tmp/mut-v33315.html")
print("=" * 72)
print("命中 %d / 未命中 %d" % (total_hit, total_miss))
sys.exit(1 if total_miss else 0)
