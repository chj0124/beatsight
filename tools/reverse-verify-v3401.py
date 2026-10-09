#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.40.1 · 覆盖率闸门独立入口）——证明「临时目录清理必须排在所有读取之后」有具名看守。
   用法：python3 tools/reverse-verify-v3401.py

   ★ 本仓第一个**针对闸门脚本自身**（tools/check-coverage.js）而不是 index.html 的反向验证。
     被守的缺陷：清理语句 `if (!REUSE) fs.rmSync(covDir, …)` 原排在**第二次 readdirSync 之前**，
     于是不带 --reuse 的独立运行必然先删掉自己下一秒要读的临时覆盖率目录 ⇒
     `ENOENT … scandir …/beatsight-cov-XXXX`、退出码 1，且发生在一整套插桩用例跑完之后
     （表现为「白等几分钟后被判覆盖率失败」）。check-all 第 21 步恒传 --reuse=<第 12 步落盘>，
     走不到 !REUSE 分支，所以这条路径长期没有机器走。

   判据（沿用 index.html 那批的三条铁律，只换观测面）：
     ① 变异只改 /tmp 副本（本脚本连**目录结构**一起镜像，见下）；
     ② 必须出现**具名**失败：`ENOENT` + 栈里的行号 == 变异副本里那次 readdirSync 的行号
        （"崩溃不算证据"在这里要反过来读：本缺陷的观测面就是这次具名崩溃，故必须精确到行号，
         不接受"任意非零退出"充数）；
     ③ 锚点失配大声失败（退出码 2 —— 与老脚本同口径，reverse-verify.py 据此记「自身腐烂」）。

   ★ 对照组（未变异的当前源码）也在场：必须**跑到报告**（出现「行覆盖率 · V8 内置采集」）且不含
     ENOENT。没有对照组的话，"变异组崩了"这件事本身也可能只是环境坏了。

   ★ 成本控制：插桩跑一整套要数分钟，而本缺陷与用例数量无关 ⇒ 两组都用 tests/run.js 自带的
     BS_TEST_CHUNK=0 把插桩套件缩到第一块（≤40 例，秒级）。变量只有一个（清理语句的位置），
     被测路径（spawn → 落盘 → 两次 readdirSync → 报告）完全真实。
     ⚠ 若该环境变量语义变了，run.js 会退回整跑（慢但结论不变）或直接报错——不会静默失真。
"""
import io, os, re, subprocess, sys, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "tools", "check-coverage.js")
orig = io.open(TOOL, encoding="utf-8").read()

CLEANUP = "if (!REUSE) fs.rmSync(covDir, { recursive: true, force: true });\n"
CLEANUP_RE = re.compile(r"^if \(!REUSE\) fs\.rmSync\(covDir, \{ recursive: true, force: true \}\);\n", re.M)
BYENTRY = "  const byEntry = new Map();   // 文件名 + 条目序 → 该条目的区间数组\n"
REPORT = "行覆盖率 · V8 内置采集"      # 对照组必须走到这里 = 报告期


def mutate_cleanup_early(s):
    """把已挪到「所有读取之后」的清理语句搬回第二次 readdirSync 之前 = 复现 v3.40.1 之前的缺陷。"""
    if not CLEANUP_RE.search(s) or BYENTRY not in s:
        return None
    return CLEANUP_RE.sub("", s, count=1).replace(BYENTRY, CLEANUP + BYENTRY, 1)


MUTANTS = [
    ("M47 清理语句挪回第二次 readdirSync 之前（复现独立入口 ENOENT）",
     lambda s: mutate_cleanup_early(s),
     ["ENOENT"]),
]


def readdir_line(text):
    """变异副本里**最后**一次 readdirSync(covDir) 的行号——即 ENOENT 栈该指向的那一行。"""
    hits = [i + 1 for i, ln in enumerate(text.splitlines()) if "readdirSync(covDir)" in ln]
    return hits[-1] if hits else None


def run_tool(script_path, cwd):
    env = dict(os.environ)
    env.pop("NODE_V8_COVERAGE", None)      # 由被测工具自己给子进程设，别从外面串味
    env["BS_TEST_CHUNK"] = "0"             # 只跑第一块（成本控制，见文件头）
    p = subprocess.run([os.environ.get("NODE", "node"), script_path], cwd=cwd, env=env,
                       capture_output=True, text=True, timeout=1800)
    return p


# ── 对照组：未变异的当前源码 ────────────────────────────────────────────────
print("=" * 72)
print("对照组：未变异源码（tools/check-coverage.js）")
ctl = run_tool(TOOL, ROOT)
ctl_all = (ctl.stdout or "") + (ctl.stderr or "")
ctl_ok = (REPORT in (ctl.stdout or "")) and ("ENOENT" not in ctl_all)
if ctl_ok:
    print("  ✓ 跑到报告期（出现「%s」）、且无 ENOENT —— 退出码 %d（低于阈值属预期：只跑了第一块）"
          % (REPORT, ctl.returncode))
else:
    print("  ✗ 对照组不成立：退出码 %d；ENOENT=%s；报告期=%s"
          % (ctl.returncode, "ENOENT" in ctl_all, REPORT in (ctl.stdout or "")))
    for ln in ctl_all.splitlines()[:8]:
        print("     | " + ln[:110])

# ── 变异组：清理挪回读取之前 ────────────────────────────────────────────────
hit_n, miss_n, rot_n = 0, 0, 0
workdir = tempfile.mkdtemp(prefix="bs-rv3401-")
try:
    os.symlink(os.path.join(ROOT, "index.html"), os.path.join(workdir, "index.html"))
    os.symlink(os.path.join(ROOT, "tests"), os.path.join(workdir, "tests"))
    os.makedirs(os.path.join(workdir, "tools"))
    os.symlink(os.path.join(ROOT, "tools", "scan-util.js"),
               os.path.join(workdir, "tools", "scan-util.js"))
    for name, fn, keys in MUTANTS:
        mut = fn(orig)
        if mut is None:                      # 锚点失配：大声失败（退出码 2）
            print("!! 变异未生效（锚点失配，源码已变）：" + name)
            rot_n += 1
            continue
        mpath = os.path.join(workdir, "tools", "check-coverage.js")
        io.open(mpath, "w", encoding="utf-8").write(mut)
        want_line = readdir_line(mut)
        r = run_tool(mpath, workdir)
        err = (r.stderr or "") + (r.stdout or "")
        m = re.search(r"check-coverage\.js:(\d+):", r.stderr or "")
        got_line = int(m.group(1)) if m else None
        print("=" * 72)
        print("变异：" + name)
        named = ("ENOENT" in err) and (got_line is not None) and (got_line == want_line) and r.returncode != 0
        if named:
            print("  ✓ 具名失败：ENOENT + 栈指向 check-coverage.js:%d（= 变异副本里那次 readdirSync）"
                  "、退出码 %d" % (got_line, r.returncode))
            for ln in (r.stderr or "").splitlines():
                if "check-coverage.js:" in ln or "ENOENT" in ln:
                    print("     ✗ " + ln.strip()[:110])
            hit_n += 1
        else:
            print("  ⚠ 未命中具名判据：期望 ENOENT@check-coverage.js:%s，实得 %s、退出码 %d"
                  % (want_line, got_line if got_line is not None else "(无栈行)", r.returncode))
            if r.returncode == 4:
                print("     （退出码 4 = 工具故障：插桩子进程没起来 / 被压垮——本次未被验证，不是断言命中）")
            for ln in err.splitlines()[:6]:
                print("     | " + ln[:110])
            miss_n += 1
finally:
    shutil.rmtree(workdir, ignore_errors=True)

print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
if not ctl_ok:
    print("对照组不成立 ⇒ 本轮结论不成立（先查环境/源码，别把它当成「变异被守住」）")
    sys.exit(1)
sys.exit(2 if rot_n else (1 if miss_n else 0))
