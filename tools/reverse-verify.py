#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证 · 统一入口（v3.36.13，本轮审计 C-5；三视角体检 2026-10-15 扩 C5/E4）
   ---------------------------------------------------------------------------
   由来：审计数出「一批一次性反向验证脚本，无统一入口」——历史上想复跑一轮反向验证，
   得逐个想起文件名（没有任何地方列全），也没人知道总共守了多少个判定点。

   本文件补的正是这两件事：**统一入口 + 可清点的清单**。
   ★ 刻意**没有**把各脚本的变异表搬进本文件。理由：那些表的主体是**逐字源码片段**，
     是"锚点必须唯一命中"的判据（脚本自己会在失配时退出码 2 大声失败）。搬运中任何一处
     走样都会让历史反向验证静默失效——而静默失效正是反向验证最危险的腐烂方式。
     故本入口只做编排与清点，变异表留在原地、各自仍可单独运行。

   ★ 三视角体检（2026-10-15，C5/E4）新增：
     · **纳入 .js 脚本**：历史上本入口的正则只认 `reverse-verify-v*.py`，而本目录另有几个
       纯 JS 版（v3421/v3450/v3531/v3532 等）——它们同样守着判定点却**从不出现在清单里**
       （盘点时"少算了"，比不盘更误导）。现按扩展名路由运行器（.py → python3、.js → node）。
     · **锚点新鲜度巡检 + `--prune-list`**：脚本里的"逐字源码锚点"会随 index.html 重构漂移，
       漂移后脚本会以「锚点失配」退出码 2 报错。本入口在清单里给出每个脚本
       「锚点 N/M 仍逐字命中」的读数，并可用 `--prune-list` 列出**零命中**的退役候选。
       ★ 这只是**筛子不是判决**：零命中 = 该有人看一眼，不自动删（删错 = 丢掉历史证据）。

   用法：
     python3 tools/reverse-verify.py --list              只列出全部脚本与判定点数 + 锚点新鲜度
     python3 tools/reverse-verify.py --prune-list        只列锚点零命中的退役候选（人工复核用）
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

# 锚点"新鲜度"的比对语料（只读一次）。见 _haystack 的注释。
def _haystack():
    """index.html + tools/ 与 tests/ 下的源码（**排除** reverse-verify-* 自身与 peers——
    否则脚本自己的源码会把它的锚点全部命中、巡检退化成恒真）。
    ★ 刻意**不含** docs/：CHANGELOG 与归档大量逐字引用历史代码片段，会把已腐烂的锚点也
      "命中"，从而把这道巡检变成橡皮图章。同样不含 tests/cases 之外的历史快照。"""
    parts = [open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()]
    for base in ("tools", "tests"):
        for dirpath, _dirs, files in os.walk(os.path.join(ROOT, base)):
            for fn in files:
                if fn.startswith("reverse-verify-") or not fn.endswith((".js", ".py")):
                    continue
                try:
                    parts.append(open(os.path.join(dirpath, fn), encoding="utf-8", errors="ignore").read())
                except OSError:
                    pass
    return "\n".join(parts)


HAYSTACK = _haystack()


def scripts():
    """本入口认领的脚本：reverse-verify-<后缀>.(py|js)。
       刻意用 `reverse-verify-.+` 而不是老的 `reverse-verify-v.*`——后者漏掉了纯 JS 版，
       也让"按内容取名（非版本号）"的新脚本无处登记。`reverse-verify.py`（本文件）不匹配。"""
    names = [f for f in os.listdir(TOOLS)
             if re.match(r"^reverse-verify-.+\.(py|js)$", f)]
    return sorted(names, key=lambda f: [int(x) for x in re.findall(r"\d+", f)] or [0])


def runner(path):
    return [sys.executable] if path.endswith(".py") else ["node"]


def points(path):
    """从 MUTANTS 列表里数判定点（每个元组/数组一项）；数不到就返回 None（不谎报 0）。
       两种形状都要认：Python `MUTANTS = [ ("名", …), … ]` 与 JS `const MUTANTS = [ ["名", …], … ]`。"""
    src = open(path, encoding="utf-8").read()
    body = re.search(r"MUTANTS\s*=\s*\[(.*?)\n\]", src, re.S)
    if not body:
        return None
    return len(re.findall(r"""^\s*[\(\[]\s*["']""", body.group(1), re.M))


# 只在"看起来像源码"的字面量里找锚点：含 ; ( ) { } = 任一者。
# 并排除三类**不是逐字源码片段**的字面量，避免污染命中率：
#   · 含反斜杠 → 正则模式串（如 `^if \(!REUSE\)…`）；
#   · 含 `…`   → 人读标签（如 `if (!REUSE) fs.rmSync(covDir, …)`）；
#   · 含 %s/%d 等 printf 占位 → 脚本自己的输出模板。
_CODEISH = re.compile(r"[;(){}=]")
_NOT_ANCHOR = re.compile(r"\\|…|%[sdjf]")


def anchors(path):
    """提取脚本里的**逐字源码锚点**（长度 ≥ 24 且形似代码的引号字面量），
       返回 (锚点总数, 仍在当前仓库源码(HAYSTACK)中逐字命中的数)。数不到锚点 → (0, 0)。"""
    src = open(path, encoding="utf-8").read()
    lits = re.findall(r"""["'`]([^"'`\n]{24,})["'`]""", src)
    uniq = sorted({l for l in lits if _CODEISH.search(l) and not _NOT_ANCHOR.search(l)})
    if not uniq:
        return (0, 0)
    hit = sum(1 for l in uniq if l in HAYSTACK)
    return (len(uniq), hit)


def targets_index(path):
    """脚本是否经 BEATSIGHT_HTML 注入被变异的 index.html。只有这类脚本的"逐字源码锚点"
    才应以 index.html 为准做新鲜度巡检——目标换成 tools/ 下文件的脚本（如 v3401 改
    check-coverage.js）锚点本就是正则/工具源码，拿 index.html 比对只会产生误报。"""
    return "BEATSIGHT_HTML" in open(path, encoding="utf-8").read()


def prune_candidates(files):
    out = []
    for f in files:
        p = os.path.join(TOOLS, f)
        if not targets_index(p):
            continue
        tot, hit = anchors(p)
        if tot and hit == 0:
            out.append((f, tot))
    return out


def main():
    files = scripts()
    if not files:
        print("  ✗ 一个 reverse-verify-*.(py|js) 都没找到——本入口没有意义了"); return 4
    only = next((a.split("=", 1)[1] for a in argv if a.startswith("--only=")), None)
    if only:
        key = only.lstrip("v")
        files = [f for f in files if key in f]
        if not files:
            print("  ✗ --only=" + only + " 没有匹配到任何脚本"); return 4

    if "--prune-list" in argv:
        cands = prune_candidates(files)
        print("  退役候选（源码锚点在当前仓库源码中**零命中**——多半是锚点随重构漂移）：")
        if not cands:
            print("    （无：所有脚本都至少有一条源码锚点仍逐字命中）")
        else:
            for f, tot in cands:
                print("    · %-34s 锚点 0/%d 命中 → 先跑一次确认它以『锚点失配』退出，再决定是否退役"
                      % (f, tot))
        return 0

    if "--list" in argv or not ("--all" in argv or only):
        print("  反向验证脚本清单（共 %d 个 · 定义点数 / 锚点新鲜度）：" % len(files))
        total = 0
        stale = 0
        for f in files:
            p = os.path.join(TOOLS, f)
            n = points(p)
            total += n or 0
            if not targets_index(p):
                fresh = "非 index.html 目标（跳过锚点巡检）"
                flag = ""
            else:
                tot, hit = anchors(p)
                fresh = ("锚点 %d/%d 命中" % (hit, tot)) if tot else "无源码锚点"
                flag = ""
                if tot and hit == 0:
                    flag = "  ← ⚠ 锚点全失配（疑似腐烂，可 --prune-list 复核）"
                    stale += 1
            print("    · %-34s %s 个判定点   %s%s"
                  % (f, n if n is not None else "(数不到)", fresh, flag))
        print("  ─────────────────────────────────────────────")
        print("  合计 %d 个判定点；%d 个脚本锚点全失配（见上 ⚠）；单跑某个："
              "python3 tools/reverse-verify.py --only=%s"
              % (total, stale, files[0].replace("reverse-verify-", "").rsplit(".", 1)[0]))
        return 0

    print("  逐个复跑（每个 = 一整套定向变异）…")
    bad, rotten, table = [], [], []
    for f in files:
        path = os.path.join(TOOLS, f)
        p = subprocess.run(runner(path) + [path], cwd=ROOT, capture_output=True, text=True)
        out = p.stdout or ""
        m = re.search(r"(\d+)\s*/\s*(\d+)", out)
        naked = out.count("无具名断言变红") + out.count("无具名红")
        row = (f, p.returncode, m.group(0) if m else "?", naked)
        table.append(row)
        if p.returncode == 2:
            rotten.append(f)
        elif p.returncode != 0 or naked:
            bad.append(f)
        print("    %s %-34s 退出码=%s %s" % ("✗" if (p.returncode or naked) else "✓",
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
