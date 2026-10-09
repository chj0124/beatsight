#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.41.0 · 控制芯按《整体布局方案示意图》对账）——证明六条新契约都有具名断言守着。
   用法：python3 tools/reverse-verify-v3410.py
   M48 胶囊行退回左贴（删 justify-content:center）      → 居中三条钉红
   M49 胶囊退回旧「上下 8px」内边距（删显式 36px 规格） → 36px 胶囊三条钉红
   M50 读数行退回「空文本零高度隐身」（删 bpmReadoutBase）→ 常显读数两条钉红
   M51 指示器退回轨道开关（删 16px 圆点规格）           → 圆点钉红
   M52 窄屏 BPM 行盒退回基础 40px（删特异性修复那条）    → 移动端 36px 钉红
   M53 展开态重新露出「BPM 96 ▾」读数钮（删 display:none）→ 展开态钉红
   M54 移动端芯退回 294（删 padding 归零）              → 全宽芯钉红
   M55 步进群退回「参照滑杆轴」（重新加回 margin-left:62px）→ 芯轴居中钉红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M48 胶囊行退回左贴（删 justify-content:center）",
     lambda s: s.replace(
         ".core-pills{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}",
         ".core-pills{display:flex;align-items:center;gap:10px;flex-wrap:wrap}", 1),
     ["胶囊行居中", "胶囊行横排", "芯顶胶囊行"]),
    ("M49 胶囊退回旧「上下 8px」内边距（删显式 36px 规格）",
     lambda s: s.replace(
         ".core-pills .toggle-pill{height:36px;padding:0 14px;gap:7px;font-size:12.5px;\n  border:1.5px solid var(--line);background:var(--card)}",
         ".core-pills .toggle-pill{padding-top:8px;padding-bottom:8px}", 1),
     ["36px 胶囊", "胶囊行 36px 规格"]),
    ("M50 读数行改回「常显基线」（撤回 G4 的反向）",
     lambda s: s.replace(
         '    if (!S.trainer.on){ el.textContent = ""; }',
         '    if (!S.trainer.on){ el.textContent = "当前 " + S.bpm + " BPM"; }', 1),
     ["训练器未开"]),
    ("M56 删掉全局「控制卡去底」（PC 横屏又长出卡底）",
     lambda s: s.replace(
         "body .card:has(.card-head.viz-head){background:none;border:0;border-radius:0}",
         "/* M56: 全局去卡底被删 */", 1),
     ["全局单条"]),
    ("M57 拍数改回「常显」（去掉标记层的 hidden 初值）",
     lambda s: s.replace(
         '<span class="inp-with-unit" id="countInBeatsWrap" hidden>',
         '<span class="inp-with-unit" id="countInBeatsWrap">', 1),
     ["就地长出", "预备关着"]),
    ("M58 强开槽退回「只开不收」（删 openParamSlot 的 toggle 分支）",
     lambda s: s.replace(
         "  if (paramSlotForce === name){ clearSlotForce(); return; }\n", "", 1),
     ["再点即收"]),
    ("M59 面板退回「不与胶囊同源」（删 .core-pill-hold 的 position:relative）",
     lambda s: s.replace(
         ".core-pill-hold{position:relative;display:flex}",
         ".core-pill-hold{display:flex}", 1),
     ["胶囊下方的下拉"]),
    ("M51 指示器退回轨道开关（删 16px 圆点规格）",
     lambda s: s.replace(
         ".core-pills .toggle-pill .switch{order:-1;width:16px;height:16px;border-radius:50%;",
         ".core-pills .toggle-pill .switch{", 1),
     ["16px 圆点"]),
    ("M52 窄屏 BPM 行盒退回基础 40px（删特异性修复）",
     lambda s: s.replace(
         "  .viz-head-grid .card-head-left .bpm-slider-row{min-height:36px}",
         "  .bpm-slider-row{min-height:36px}", 1),
     ["移动端 BPM 行盒 36px"]),
    ("M53 展开态重新露出「BPM 96 ▾」读数钮",
     lambda s: s.replace(
         "\n    #ctlOpen:checked ~ .ctl-pills{display:none}", "", 1),
     ["展开态隐藏"]),
    ("M54 移动端芯退回 294（删 padding 归零）",
     lambda s: s.replace(
         "\n  .viz-head-grid .card-head-left{padding-left:0;padding-right:0}", "", 1),
     ["芯铺满卡内容宽"]),
    ("M55 步进群退回「参照滑杆轴」（加回 margin-left:62px）",
     lambda s: s.replace(
         ".viz-head .group .slider-row .bpm-row{flex:0 0 auto;flex-wrap:nowrap;justify-content:center}",
         ".viz-head .group .slider-row .bpm-row{flex:0 0 auto;flex-wrap:nowrap;justify-content:center;margin-left:62px}", 1),
     ["步进群以**芯轴**居中"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name)
        rot_n += 1
        continue
    mp = "/tmp/mut-v3410.html"
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
        for f in hit[:3]:
            print("   ✗ " + f[:110])
        print("  ✓ 具名断言变红：%d 条" % len(hit))
        hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:4]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists("/tmp/mut-v3410.html"):
    os.remove("/tmp/mut-v3410.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
