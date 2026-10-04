#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.33.4）——用定向变异证明「预备拍 × 歌词轨结构层重锚」这批修复有具名断言守着。
   纪律（reverse-verify-tests-by-mutation skill）：
     1. 只改 /tmp 副本，仓库文件一个字节不动（BEATSIGHT_HTML 注入）；
     2. 变异后必须出现**具名 ✗**（退出码/崩溃不算证据）；
     3. 锚点必须唯一且断言命中，否则大声失败（防脚本自身腐烂）；
     4. 「崩溃型被拦」与「需真机」的变异单独标注，不计入 N/N。
   用法：python3 tools/reverse-verify-v3334.py   （依赖：harness 支持 BEATSIGHT_HTML 注入）

   判定点清单（一个判定点 = 一个变异；对照见 tests/cases/t188-countin-lyric-rest-x.js）：
     M1 结构层重锚只写 translateY（退回缺陷）  → T188a/T188c「横移严格相同」整组红
     M2 静止态落位自写一份 x（单一来源分叉）    → T188e「两条写入路径都走 lyricRestX」红
     M3 侧栏开合重新调 relayout（根因① 入口复活）→ T188e setPresetDrawer 源码钉红
     M4 分页也落槽横移（scroll 判据守卫被删）    → T188d「分页：歌词行仍 translateY」红
   ★ 说明：M3 在本批之后**只有源码钉会在意**——因为治本已让那次 relayout 无害（这正是
     "治本 + 摘掉失效调用"两件事要分开记的原因，别把它并进 M1 的计数里自欺）。"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("M1 v3.33.4 回退：结构层重锚只写 translateY（缺陷原样）",
   """      const rx = S.scrollMode ? lyricRestX(i) : null;
      lyricRows[i].el.style.transform = (rx === null)
        ? ("translateY(" + y + "px)")
        : ("translate(" + rx.toFixed(1) + "px, " + y + "px)");""",
   """      lyricRows[i].el.style.transform = "translateY(" + y + "px)";""",
   ["预备拍中 relayout 后：歌词行", "预备拍结束后：歌词行"]),

  ("M2 v3.33.4 回退：静止态落位自写一份 x（单一来源分叉）",
   """        /* ★ v3.33.4：x 走 lyricRestX（单一来源）——与 placeLaneOverlay 的重锚逐位同式，
           免得"结构层写的 x"与"静止态写的 x"各算一份、日后再分叉（同 scrollWrapRange 的纪律）。 */
        const x = lyricRestX(i);
        if (x === null) continue;
        const dy = (lyricRows[i].y || 0) + (belt ? (beltDy0 - g.top) : 0);
        lyricRows[i].el.style.transform = `translate(${x.toFixed(1)}px, ${dy.toFixed(1)}px)`;""",
   """        const off = i - scrollCenter;
        const ph = belt ? (0 - off) : Math.min(1, Math.max(0, 0 - off));
        put(lyricRows[i].el, g, ph, (lyricRows[i].y || 0) + (belt ? (beltDy0 - g.top) : 0));""",
   ["两条写入路径都走 lyricRestX"]),

  ("M3 v3.33.4 回退：侧栏开合重新调 relayout（根因① 入口复活）",
   """     ★ 治本落在 placeLaneOverlay（结构层重锚时同落 x，见 lyricRestX）；这里把失效的调用
       摘掉，免得下一个人照着它再写第二处"抽屉要 relayout"的凭据。 */
}""",
   """     ★ 治本落在 placeLaneOverlay（结构层重锚时同落 x，见 lyricRestX）；这里把失效的调用
       摘掉，免得下一个人照着它再写第二处"抽屉要 relayout"的凭据。 */
  Viz.relayout();
}""",
   ["setPresetDrawer 不得再调 Viz.relayout()"]),

  ("M4 v3.33.4 回退：分页也落槽横移（scroll 判据守卫被删）",
   "      const rx = S.scrollMode ? lyricRestX(i) : null;",
   "      const rx = lyricRestX(i);",
   ["分页：歌词行"]),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3334.html"
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
os.remove("/tmp/mut-v3334.html") if os.path.exists("/tmp/mut-v3334.html") else None
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
