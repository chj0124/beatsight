#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.42.0 · 全站滑块圆头挂出 + 右侧参数槽 + 点空白收面板 + 折叠钮两态）
   用法：python3 tools/reverse-verify-v3420.py
   M60 滑杆条退回满宽（删两处 margin:0 calc(--thumb-w/2)） → 圆头挂出三条钉红
   M61 参数槽退回"只跟开关"（show 去掉 slotDismissed）   → 三态与"点槽收起"钉红
   M62 点空白的排除表缩窄（去掉胶囊行/读数钮/原因区）      → document 监听钉红
   M63 展开态小箭头不显示（删 display:flex 规则）          → 折叠钮两态钉红
   M64 收起态读数钮退回贴左（删 justify-content:center）   → 居中钉红
   M65 参数槽去掉 hidden 初值（一直显示）                  → 槽标记钉红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

MUTANTS = [
    ("M61 参数槽退回「只跟开关」（show 去掉 slotDismissed）",
     lambda s: s.replace(
         "const show = !!((on[k] && !slotDismissed[k]) || paramSlotForce === k);",
         "const show = !!((on[k]) || paramSlotForce === k);", 1),
     ["面板收起", "显隐 = 自己的开关"]),
    ("M62 点空白的排除表缩窄（去掉胶囊行/读数钮/原因区）",
     lambda s: s.replace(
         "#muteFlyout, #trainerFlyout, .core-pills, .ctl-pills, #trainerProg, .modal-mask",
         "#muteFlyout", 1),
     ["点面板外任何地方"]),
    ("M64 收起态读数钮退回贴左（删 justify-content:center）",
     lambda s: s.replace(
         ".ctl-pills{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px;margin-bottom:4px}",
         ".ctl-pills{display:flex;flex-wrap:wrap;align-items:center;gap:24px;padding-left:16px;margin-bottom:4px}", 1),
     ["读数钮**居中**"]),
    ("M65 参数槽去掉 hidden 初值（一直显示）",
     lambda s: s.replace(
         '<button class="core-slot" id="muteSlot" type="button" hidden ',
         '<button class="core-slot" id="muteSlot" type="button" ', 1),
     ["两个参数槽是 <button>"]),
    ("M67 拍数框恢复细线框",
     lambda s: s.replace(
         ".core-pills .tr-inp{width:20px;min-width:0;padding:1px 2px;font-size:12px;text-align:center;background:transparent;border:0;",
         ".core-pills .tr-inp{width:20px;min-width:0;padding:1px 2px;font-size:12px;text-align:center;background:transparent;border:1px solid var(--line);", 1),
     ["拍数框/目标框降级"]),
    ("M69 顶栏折叠钮去掉定宽（靠 padding 撑 → 椭圆）",
     lambda s: s.replace("#foldBtn{width:40px;padding:0}", "#foldBtn{padding:0 11px}", 1),
     ["展开态折叠钮"]),
    ("M71 歌词字退回 bottom:1px（行盒溢出格高、宽屏被裁）",
     lambda s: s.replace(
         "right:auto;top:0;bottom:0;display:flex;align-items:center;",
         "right:auto;top:auto;bottom:1px;", 1),
     ["基础 .lyric-char"]),
    ("M72 歌词左内缩退回「固定 px × 网格缩放」",
     lambda s: s.replace("left:clamp(4px,25%,28px)", "left:calc(26px * var(--cs,1))", 1),
     ["基础 .lyric-char"]),    ("M73 收起态重新无条件藏参数面板（开关可点但参数不可达）",
     lambda s: s.replace(
         "#ctlOpen:not(:checked) ~ .card-head .card-head-left .tg-body{display:block",
         "#ctlOpen:not(:checked) ~ .card-head .tg-flyout{display:none}" + chr(10) + "  #ctlOpen:not(:checked) ~ .card-head .card-head-left .tg-body{display:block", 1),
     ["甲案"]),    ("M74 窄档不再收另一块面板（两块叠住）",
     lambda s: s.replace("innerWidth < 1280", "innerWidth < 0", 1),
     ["窄档口径"]),    ("M75 顶栏折叠图标退回单雪佛龙（用户已选双箭头）",
     lambda s: s.replace('d="M7 13.5l5 5 5-5"', 'd="M7 13.5"', 1),
     ["展开态折叠钮"]),
    ("M76 音名不可用判定恒真（窄档不该触发却触发）",
     lambda s: s.replace("const triggered = (nmDrawnN === 0 && nmHiddenN > 0);", "const triggered = true;", 1),
     ["nm 胶囊置灰"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-v3420.html"
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
        print("  ✓ 具名断言变红：%d 条" % len(hit)); hit_n += 1
    else:
        print("  ⚠ 无具名断言变红（%s）" % (m.group(0) if m else "崩溃"))
        for f in failed[:4]:
            print("     (实际红的是) ✗ " + f[:110])
        miss_n += 1
if os.path.exists("/tmp/mut-v3420.html"):
    os.remove("/tmp/mut-v3420.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
