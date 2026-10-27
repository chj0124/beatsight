#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（t266 · 歌曲行高亮与曲式状态读数的模式判据）
   用法：python3 tools/reverse-verify-t266-song-row-active.py
   四个变异分别回退本轮四条修法，目标断言（tests/cases/t266-song-row-active-state.js）须具名变红：
     M1 构造期 isActive 去掉 playMode 判据            → T266a「歌曲行不再挂 .active」/ T266c「退回预设模式后高亮摘掉」
     M2 syncSongPlayBtns 摘掉歌曲行 .active 运行期翻转 → T266d「高亮当场亮起（运行期翻转）」
     M3 demoCurBar 撤掉「播放中非曲式返回 -1」         → T266a「状态行不谎报」「播放头隐藏」
     M4 start() 撤掉起播期 syncDemoRange              → T266a「播放头隐藏」（停机态残留）
"""
import io, os, re, subprocess, sys

try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # GBK 控制台不炸（本机实测）
except Exception: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orig = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

M1_OLD = "const isActive = S.arrangeSel.id === a.id && S.playMode === \"arrange\";"
M3_OLD = "    if (S.playing) return -1;\n    return S.arrangeSel.from;"
M4_OLD = ("    /* ★ 本修：起播也刷一次范围读数/播放头（与 stop() 尾部那次对称）。此前只在停机/小节边界\n"
          "       （onAudibleBar，且仅曲式模式）刷——preset 模式起播后侧栏永远停在停机态：播放头钉在\n"
          "       范围起点、状态行留着旧文案，\"现在到底播没播\"在侧栏读不出来。 */\n"
          "    Presets.syncDemoRange();\n")

MUTANTS = [
    # ★ M1 必须把**两处判据一并**回退：构造期 isActive 与 syncSongPlayBtns 的运行期翻转互为
    #   冗余兜底（列表重建尾部的 syncDemoRange 会立刻用运行期判据覆写构造期初值）——只回退
    #   构造期会被运行期兜住（实测 8922 全绿）。整体回退才能证明「模式判据」本身的必要性。
    ("M1 歌曲行 .active 两处判据一并回退为只比 id（不看 playMode）",
     lambda s: s.replace(M1_OLD, "const isActive = S.arrangeSel.id === a.id;", 1)
                .replace("      rec.row.classList.toggle(\"active\", S.playMode === \"arrange\" && S.arrangeSel.id === rec.id);\n", "", 1),
     ["歌曲行不再挂 .active", "退回预设模式后高亮摘掉"]),
    ("M2 syncSongPlayBtns 摘掉歌曲行 .active 运行期翻转（构造期判据保留）",
     lambda s: s.replace("      rec.row.classList.toggle(\"active\", S.playMode === \"arrange\" && S.arrangeSel.id === rec.id);\n", "", 1),
     ["高亮当场亮起（syncSongPlayBtns 运行期翻转"]),
    ("M3 demoCurBar 回退为播放中非曲式仍落到 from",
     lambda s: s.replace(M3_OLD, "    return S.arrangeSel.from;", 1),
     ["不再谎报", "播放头隐藏"]),
    ("M4 start() 撤掉起播期 syncDemoRange（停机态残留）",
     lambda s: s.replace(M4_OLD, "", 1),
     ["播放头隐藏"]),
]

hit_n, miss_n, rot_n = 0, 0, 0
for name, fn, keys in MUTANTS:
    mut = fn(orig)
    if mut == orig:
        print("!! 变异未生效（锚点失配，源码已变）：" + name); rot_n += 1; continue
    mp = "/tmp/mut-t266.html"
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
if os.path.exists("/tmp/mut-t266.html"):
    os.remove("/tmp/mut-t266.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 锚点失配 %d" % (hit_n, miss_n, rot_n))
sys.exit(2 if rot_n else (1 if miss_n else 0))
