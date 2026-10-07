#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证 · 统一入口（v3.36.13，本轮审计 C-5）
   ---------------------------------------------------------------------------
   由来：审计数出「13 个一次性反向验证脚本，无统一入口」——实测本目录下有 11 个
   reverse-verify-v*.py（v331x / v3334 / v3335 / v3336 / v3337 / v3339 / v33315 /
   v33317 / v33319 / v33323 / v3345）。每个都自带完整驱动（读原文 → 逐个变异 → 写 /tmp
   副本 → BEATSIGHT_HTML 注入跑用例 → 提取具名 ✗），于是：
     · 想复跑一轮历史反向验证，得逐个想起文件名（没有任何地方列全）；
     · 没人知道总共守了多少个判定点（审计只能给个约数）。
   本文件补的正是这两件事：**统一入口 + 可清点的清单**。

   ★ 刻意**没有**把 11 份变异表搬进本文件。理由：那些表的主体是**逐字源码片段**，
     是"锚点必须唯一命中"的判据（脚本自己会在失配时退出码 2 大声失败）。把 1400 行
     逐字片段搬一次，收益是"少 11 个文件"，代价是"搬运中任何一处走样都会让历史反向验证
     静默失效"——而静默失效正是反向验证最危险的腐烂方式。故本入口只做编排与清点，
     变异表留在原地、各自仍可单独运行。

   用法：
     python3 tools/reverse-verify.py --list              只列出全部脚本与判定点数
     python3 tools/reverse-verify.py --all               逐个跑一遍，末尾给汇总表
     python3 tools/reverse-verify.py --only=v3334        只跑一个（v 前缀可省）
     python3 tools/reverse-verify.py --all --stop-on-fail  第一个失败就停

   退出码：0 = 全部跑过且都有具名变红；1 = 有脚本报「无具名断言变红」；
           2 = 有脚本自身腐烂（锚点失配，源脚本以 2 退出）；4 = 一个脚本都没找到。
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
argv = sys.argv[1:]


def scripts():
    names = [f for f in os.listdir(TOOLS)
             if re.match(r"^reverse-verify-v.*\.py$", f)]
    return sorted(names, key=lambda f: [int(x) for x in re.findall(r"\d+", f)] or [0])


def points(path):
    """从 MUTANTS 列表里数判定点（每个元组一项）；数不到就返回 None（不谎报 0）。"""
    src = open(path, encoding="utf-8").read()
    body = re.search(r"MUTANTS\s*=\s*\[(.*?)\n\]", src, re.S)
    if not body:
        return None
    return len(re.findall(r"""^\s*\(\s*["']""", body.group(1), re.M))


def main():
    files = scripts()
    if not files:
        print("  ✗ 一个 reverse-verify-v*.py 都没找到——本入口没有意义了"); return 4
    only = next((a.split("=", 1)[1] for a in argv if a.startswith("--only=")), None)
    if only:
        key = only.lstrip("v")
        files = [f for f in files if key in f]
        if not files:
            print("  ✗ --only=" + only + " 没有匹配到任何脚本"); return 4

    if "--list" in argv or not ("--all" in argv or only):
        print("  反向验证脚本清单（共 %d 个）：" % len(files))
        total = 0
        for f in files:
            n = points(os.path.join(TOOLS, f))
            total += n or 0
            print("    · %-30s %s 个判定点" % (f, n if n is not None else "(数不到，需人工看)"))
        print("  ─────────────────────────────────────────────")
        print("  合计 %d 个判定点；单跑某个：python3 tools/reverse-verify.py --only=%s"
              % (total, files[0].replace("reverse-verify-", "").replace(".py", "")))
        return 0

    print("  逐个复跑（每个 = 一整套定向变异）…")
    bad, rotten, table = [], [], []
    for f in files:
        p = subprocess.run([sys.executable, os.path.join(TOOLS, f)],
                           cwd=ROOT, capture_output=True, text=True)
        out = p.stdout or ""
        m = re.search(r"(\d+)\s*/\s*(\d+)", out)
        naked = out.count("无具名断言变红") + out.count("无具名红")
        row = (f, p.returncode, m.group(0) if m else "?", naked)
        table.append(row)
        if p.returncode == 2:
            rotten.append(f)
        elif p.returncode != 0 or naked:
            bad.append(f)
        print("    %s %-30s 退出码=%s %s" % ("✗" if (p.returncode or naked) else "✓",
              f, p.returncode, ("命中 " + m.group(0)) if m else "（未取到汇总）"))
        if "--stop-on-fail" in argv and (p.returncode or naked):
            break

    print("  ─────────────────────────────────────────────")
    print("  复跑 %d 个脚本：%d 个干净 · %d 个有「无具名断言变红」· %d 个自身腐烂（锚点失配）"
          % (len(table), len(table) - len(bad) - len(rotten), len(bad) - len(rotten), len(rotten)))
    if rotten:
        print("  ✗ 自身腐烂（源码已变，需同步更新脚本里的逐字锚点）：" + " / ".join(rotten))
    if bad:
        print("  ✗ 有变异没被任何断言守住：" + " / ".join(bad))
    return 2 if rotten else (1 if bad else 0)


sys.exit(main())
