#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.38.0 旋律细分）——用定向变异证明「量化原子降到三十二分格 + `_`/`__` 时值后缀
   + 无损往返 + 简谱正字法（八度点）显示」这批功能有具名断言守着。
   纪律（reverse-verify-tests-by-mutation skill）：
     1. 只改 /tmp 副本，仓库文件一个字节不动（BEATSIGHT_HTML 注入）；
     2. 变异后必须出现**具名 ✗**（退出码/崩溃不算证据）；
     3. 锚点必须唯一且断言命中，否则大声失败（防脚本自身腐烂）；
     4. 「崩溃型被拦」与「需真机」的变异单独标注，不计入 N/N。
   用法：python3 tools/reverse-verify-v3380.py

   判定点清单（一个判定点 = 一个变异；对照见 t224-melody-subdiv.js / t226-jianpu-glyph.js / t225-note-edit.js）：
     批 1（数据地基 + 文本语法 + 正字法）：
     N1 LYRIC_BASE 派生回 2 * LYRIC_GRID（八分跟着网格偏成 12t）→ T224d「解耦钉 / 写死为 T8」红
     N2 LYRIC_GRID 退回 T16（三十二分能力被关掉）            → T224d「量化原子 / 最短时值」红
     N3 `_`/`__` 后缀不再定档（step 恒为 LYRIC_BASE）        → T224a「十六分/三十二分 dur」红
     N4 三条下划线护栏删掉（`___` 也吃、静默出 3t）          → T224a「三条下划线」红
     N5 jianpuParts 丢八度点（C5/C3 与 C4 同形）             → T226a「高/低八度 1」红
     N6 mkJianpuGlyph 不画上点（高八度无点）                 → T226b「高八度：点 + body」+ T226f「上点」红
     N7 mkPitchMarkEl nm 档误走 glyph（音名被简谱点盖掉）    → T226d「nm 档 → 音名文本」+ T226f「音名 C5」红
     批 2（音符块交互）：
     M13 noteDropTarget 删邻音重叠预检（拖动直接落，靠 norm 吞 = 静默丢音）→ T225d「Store 零变化」+ T225c「blocked」红
     M14 键盘时值步长写死 12t（32 分改不动）                → T225b「Shift+→ dur 24 → 30」红
     M15 notechip 混进 chipEls（两轨隔离破裂）              → T225f「chipEls 长度 / noteEls 长度」红
     M16 拖拽提交绕过 lyricCommit（直写 Store，undo 栈空）   → T225e「拖拽撤销：音符回原位」红
     批 3（音符配色 + 字块左上角定位，用户口径①②③）：
     M17 glyph 不带八度色类（高/中/低同色，脱离字色的三色失效）→ T226b「oct-mid」+ T226g「oct-hi」红
     M18 音高标注退回字内上标（不落字块左上角）             → T226f「直接子节点 / 都挂上标注」红
     M19 八度点退回细中点（看不清）                         → T226b「实心点 / 聚合文本 = 上点」红
     M20 点与数码之间不留间距（点贴着数字）                 → T226g「点与数码之间有显式间距」红
     M21 独立音符块字号退回随字放大（带八度点装不进格）     → T226g「独立音符块字号固定 11px」红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("N1 v3.38.0 回退：LYRIC_BASE 派生回 2 * LYRIC_GRID（八分随网格偏成十二分）",
   "const LYRIC_BASE = T8;",
   "const LYRIC_BASE = 2 * LYRIC_GRID;",
   ["解耦钉", "写死为 T8"]),

  ("N2 v3.38.0 回退：LYRIC_GRID 退回 T16（三十二分格能力被关掉）",
   "const LYRIC_GRID = T32;",
   "const LYRIC_GRID = T16;",
   ["量化原子降到三十二分", "最短时值"]),

  ("N3 v3.38.0 回退：时值后缀不再定档（`_`/`__` 被吞、step 恒为基准八分）",
   "const step = LYRIC_BASE >> (us ? us[0].length : 0);",
   "const step = LYRIC_BASE;",
   ["十六分：dur=12", "三十二分：dur=6"]),

  ("N4 v3.38.0 回退：三条下划线护栏删掉（`___` 也吃、静默出 3t 坏值）",
   "if (us && us[0].length > 2) return { notes: null, bad: tk };",
   "if (false) return { notes: null, bad: tk };",
   ["三条下划线"]),

  ("N5 v3.38.0 回退：jianpuParts 丢八度点（C5/C3 与 C4 同形）",
   "  return { acc: m[1], deg: m[0], octUp: oct > 0 ? oct : 0, octDown: oct < 0 ? -oct : 0 };",
   "  return { acc: m[1], deg: m[0], octUp: 0, octDown: 0 };",
   ["高八度 1（上点 1 颗）", "低八度 1（下点 1 颗）"]),

  ("N6 v3.38.0 回退：mkJianpuGlyph 不画上点（高八度看不到点）",
   "  if (parts.octUp > 0){",
   "  if (false){",
   ["高八度：点 + body", "上标画**上点**"]),

  ("N7 v3.38.0 回退：mkPitchMarkEl nm 档误走 glyph（音名被简谱点盖掉）",
   "  const jp = mode !== \"nm\";",
   "  const jp = true;",
   ["nm 档 → 音名文本节点", "显示成音名 C5"]),

  ("M13 v3.38.0 批 2 回退：noteDropTarget 删邻音重叠预检（拖动直接落，靠 norm 吞靠后的 = 静默丢音）",
   "if (t < o.t + o.dur && t + dur > o.t) return { t: t, blocked: true, blockerIdx: i };",
   "if (false) return { t: t, blocked: true, blockerIdx: i };",
   ["指名 blocker", "Store 逐位零变化", "可见反馈"]),

  ("M14 v3.38.0 批 2 回退：键盘时值步长写死 12t（32 分改不动/改错）",
   "note.dur + dir * LYRIC_GRID",
   "note.dur + dir * 12",
   ["Shift+→：dur 24 → 30"]),

  ("M15 v3.38.0 批 2 回退：notechip 混进 chipEls（两轨隔离破裂）",
   "lctx.noteEls.push(nchip);",
   "lctx.chipEls.push(nchip);",
   ["chipEls 长度 = 字数", "noteEls 长度"]),

  ("M16 v3.38.0 批 2 回退：拖拽提交绕过 lyricCommit（直写 Store，undo 栈空）",
   "lyricCommit(d.lctx.arr, d.lctx.sec, d.chars, { notes: d.notes });",
   "Store.upsertLyric(d.lctx.arr, d.lctx.sec, d.chars, { notes: d.notes });",
   ["拖拽撤销：音符回原位"]),

  ("M17 v3.38.0 批 3 回退：glyph 不带八度色类（高/中/低同色，脱离字色的三色失效）",
   "  g.className = \"jp-g \" + (net > 0 ? \"oct-hi\" : (net < 0 ? \"oct-lo\" : \"oct-mid\"));",
   "  g.className = \"jp-g\";",
   ["oct-mid", "oct-hi"]),

  ("M18 v3.38.0 批 3 回退：音高标注退回字内上标（不落字块左上角）",
   "              if (pit) chip.appendChild(pit);\n            }\n            rowEl.appendChild(chip);",
   "              if (pit) label.appendChild(pit);\n            }\n            rowEl.appendChild(chip);",
   ["直接子节点", "都挂上标注"]),

  ("M19 v3.38.0 批 3 回退：八度点退回细中点（看不清）",
   "    up.textContent = \"●\".repeat(parts.octUp);",
   "    up.textContent = \"·\".repeat(parts.octUp);",
   ["实心点", "聚合文本 = 上点"]),

  ("M20 v3.38.0 批 3 回退：点与数码之间不留间距（点贴着数字）",
   ".jp-dots.top{margin-bottom:.5em}",
   ".jp-dots.top{margin-bottom:0}",
   ["点与数码之间有显式间距"]),

  ("M21 v3.38.0 批 3 回退：独立音符块字号退回随字放大（带八度点装不进格）",
   ".lyric-chip.notechip .lyric-char{font-style:italic;font-weight:800;color:var(--t3);font-size:11px}",
   ".lyric-chip.notechip .lyric-char{font-style:italic;font-weight:800;color:var(--t3);font-size:min(calc(16px * var(--cs, 1)), 24px)}",
   ["独立音符块字号固定 11px"]),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3380.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    if expect_names is None:
        if m and int(m.group(2)) == 0:
            print("  ⚠ 变异后仍全绿 —— 该修复没有测试守着！（需人工确认）")
            total_miss += 1
        else:
            print("  （崩溃型被拦：%s；按纪律人工确认堆栈指向该修复点）" % (m.group(0) if m else ("退出码 %s" % r.returncode)))
            crashed.append(name)
    else:
        hit = [f for f in failed if any(e in f for e in expect_names)]
        if hit:
            print("  " + (m.group(0) if m else "(未取到汇总)"))
            for f in hit[:8]:
                print("   ✗ " + f[:100])
            print("  ✓ 具名断言变红：" + str(len(hit)) + " 条（期望 " + str(len(expect_names)) + " 条关键词）")
            total_hit += 1
        else:
            print("  ⚠ 无具名断言变红（%s）——断言测错了对象或锚点失配，必须修" % (m.group(0) if m else "崩溃"))
            total_miss += 1
os.remove("/tmp/mut-v3380.html") if os.path.exists("/tmp/mut-v3380.html") else None
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
