#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.38.1 音高标注 · **现行几何**：数码居中 + 高点贴头右 / 低点贴脚左
           + 歌词字右下 + nm 档名右字左不相交）
   ——用定向变异证明每条口径都有一条**具名断言**守着。
   纪律（reverse-verify-tests-by-mutation skill）：
     1. 只改 /tmp 副本，仓库文件一个字节不动（BEATSIGHT_HTML 注入）；
     2. 变异后必须出现**具名 ✗**（退出码/崩溃不算证据）；
     3. 锚点必须唯一且断言命中，否则大声失败（防脚本自身腐烂）；
     4. 「崩溃型被拦」与「需真机」的变异单独标注，不计入 N/N。
   用法：python3 tools/reverse-verify-v3381.py

   ★ 2026-10-09 按新几何**一次性重指**：上一版的 M22–M34 锚在「点挂数码右侧 / 三档槽位 /
     窄格三级降级 / 字心 clamp」——那些口径本轮整体退役，脚本因此报「变异点未找到」退出码 2。
     重指时同步补了 T227g（新几何源码钉）：**当规则只写在 CSS 里、没有任何具名断言时，
     变异抓不住它**——上一轮「音名压在歌词字上」就是这么漏过去的。

   判定点清单（一个判定点 = 一个变异；对照 t227-pitch-right-slot.js / t228-accidental-system.js）：
     M22 高音点不再是「数码头部右侧」                  → T227g「头部右侧」红
     M23 低音点不再是「数码脚部左侧」                  → T227g「脚部左侧」红
     M24 点字号 .4em 放大（越出 26px 高度带）          → T227g「点字号 .4em」红
     M25 .jp-g 不再居中（数字被点顶离中线）            → T227g「align-items:center」红
     M26 nm 档歌词字不再靠左（名压字回归）             → T227g「nm 档歌词字」红
     M27 歌词字占地常量归零（窄格不再隐藏音名）        → T227g「窄格 43px」红
     M28 nm 不相交判据退回 0.75·W 旧模型               → T227g「加法」红
     M29 jianpuParts 忽略体系参数（降号谱仍写升号）    → T228a「降号制下 acc = b」红
     M30 .jp-body 的 --oct 位移复活（数码被推离中线）  → T227f「--oct 位移已删」红
     M31 FLAT_KEYS 清空（F/Bb/Eb 全判升号制）          → T228c「F 调 ⇒ 降号制」红
     M32 带记号格左内缩退回 6px（数码被记号挤到右边）  → T228f「带记号格整枚左让一档」红
     M33 nm 档窄格不再隐藏（音名溢出被裁）             → T227d「音名不画（空壳）」红
     M34 歌词字退回「字心 clamp」（右下口径回退）      → T227f「右下」红
"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("M22 v3.38.1 回退：高音点不再贴数码**头部右侧**（方向语义丢失）",
   ".jp-dots.hi{left:100%;top:0}",
   ".jp-dots.hi{left:100%;top:-50%}",
   ["头部右侧"]),

  ("M23 v3.38.1 补8 回退：低音点从「数码正下方偏左」退回**数码左侧**（用户实拍：蓝点压住小节竖线）",
   ".jp-dots.lo{left:0;top:100%}",
   ".jp-dots.lo{right:100%;bottom:0}",
   ["正下方偏左"]),

  ("M24 v3.38.1 回退：点字号 .4em 放大到 .9em（越出 26px 格的高度带）",
   ".jp-dots{position:absolute;display:inline-flex;flex-direction:column;align-items:center;font-size:.4em;line-height:1;font-weight:400;letter-spacing:0}",
   ".jp-dots{position:absolute;display:inline-flex;flex-direction:column;align-items:center;font-size:.9em;line-height:1;font-weight:400;letter-spacing:0}",
   ["点字号 .4em"]),

  ("M25 v3.38.1 回退：.jp-g 不居中（点重新顶动数字，高低音数字不在同一中线）",
   ".jp-g{display:inline-flex;align-items:center;line-height:1;vertical-align:baseline;position:relative}",
   ".jp-g{display:inline-flex;align-items:flex-start;line-height:1;vertical-align:baseline;position:relative}",
   ["align-items:center"]),

  ("M26 v3.38.1 回退：nm 档歌词字不再靠左（音名重新压到字上——上一轮实报的回归）",
   ".lyric-chip:not(.notechip):has(.pit-nm) .lyric-char{right:auto;text-align:left}",
   ".lyric-chip:not(.notechip):has(.pit-nm) .lyric-char{right:calc(6px * var(--cs,1))}",
   ["nm 档歌词字"]),

  ("M27 v3.38.1 回退：歌词字占地常量归零（窄格不再隐藏音名 ⇒ 名字压到字上）",
   "const NM_CHAR_RESERVE = 46;",
   "const NM_CHAR_RESERVE = 0;",
   ["43px 格"]),

  ("M28 v3.38.1 回退：nm 不相交判据退回 0.75·W 旧模型（字已靠左，系数不再成立）",
   "  return cellPx < need + (reserve || 0);",
   "  return (reserve || 0) > 0 ? cellPx * 0.75 < need + 12 : cellPx < need;",
   ["加法"]),

  ("M29 v3.38.1 回退：jianpuParts 忽略体系参数（降号谱里仍写升号）",
   """  const m = relTable(sys)[rel];
  return { acc: m[1], deg: m[0], octUp: oct > 0 ? oct : 0, octDown: oct < 0 ? -oct : 0 };""",
   """  const m = relTable("sharp")[rel];
  return { acc: m[1], deg: m[0], octUp: oct > 0 ? oct : 0, octDown: oct < 0 ? -oct : 0 };""",
   ["降号制下 acc = b"]),

  ("M30 v3.38.1 回退：.jp-body 的 --oct 位移复活（数码被推离中线）",
   ".jp-body{display:inline-flex;align-items:baseline;line-height:.85}",
   ".jp-body{display:inline-flex;align-items:baseline;line-height:.85;transform:translateY(calc(var(--oct,0) * -0.08em))}",
   ["--oct 位移已删"]),

  ("M31 v3.38.1 回退：FLAT_KEYS 清空（F/Bb/Eb… 全判升号制 ⇒ 降号体系永远选不上）",
   'const FLAT_KEYS = ["F", "Bb", "Eb", "Ab", "Db", "Gb"];',
   'const FLAT_KEYS = [];',
   ["F 调 ⇒ 降号制"]),

  ("M32 v3.38.1 回退：带记号格的左内缩规则退回 6px（数码被记号挤到右边）",
   ".lyric-pit:has(.jp-acc){left:calc(4px * var(--cs,1))}",
   ".lyric-pit:has(.jp-acc){left:calc(6px * var(--cs,1))}",
   ["带记号格整枚左让一档"]),

  ("M33 v3.38.1 回退：nm 档窄格不再隐藏（音名溢出被裁）",
   "    if (nmMarkHidden(/** @type {number} */ (cellPx), nm.length)) return s;   // 空壳：不画名",
   "    if (false) return s;   // 空壳：不画名",
   ["音名不画（空壳）"]),

  ("M34 v3.38.1 补9 回退：歌词字从「靠左」退回**贴右缘**（两档不一致；字离开音符起点侧、落到时值末尾）",
   "right:auto;top:auto;bottom:1px;transform:none;text-align:left;font-size:min(calc(14px * var(--cs,1)),21px);font-weight:700;color:var(--t3)}",
   "right:calc(6px * var(--cs,1));top:auto;bottom:1px;transform:none;text-align:right;font-size:min(calc(14px * var(--cs,1)),21px);font-weight:700;color:var(--t3)}",
   ["靠左"]),

  ("M35 v3.38.1 补8 回退：删掉「2 颗及以上低音点整枚缩一档」⇒ 点底越出 26px 格底（真机实测 28.4）",
   ".lyric-chip .lyric-pit:has(.jp-dots.lo i + i){font-size:min(calc(12px * var(--cs,1)),13px)}",
   "",
   ["缩一档"]),

  ("M36 v3.38.1 补10 回退：.seams 退回写死 44px（窄屏格子 34px ⇒ 缝线越出格下缘 10px，v2.79.0 修过的同型）",
   ".seams{position:absolute;left:0;right:0;top:0;height:var(--cell-h);pointer-events:none;z-index:2}",
   ".seams{position:absolute;left:0;right:0;top:0;height:44px;pointer-events:none;z-index:2}",
   ["四层"]),

  ("M37 v3.38.1 补10 回退：当前小节底纹高度退回写死 44px（**本次修的 bug 原形**：多出的 10px 落进歌词带）",
   ".bar-row.current::before{content:\"\";position:absolute;left:0;right:0;top:0;height:var(--cell-h);border-radius:8px;",
   ".bar-row.current::before{content:\"\";position:absolute;left:0;right:0;top:0;height:44px;border-radius:8px;",
   ["整条格子带"]),

  ("M38 v3.38.1 补10 回退：窄屏档不再压格子带（--cell-h 单一来源名存实亡，窄屏又回 44px）",
   "  :root{--cell-h:34px}",
   "",
   ["窄屏档"]),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3381.html"
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
if os.path.exists("/tmp/mut-v3381.html"):
    os.remove("/tmp/mut-v3381.html")
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
