#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.37.0 旋律谱 A 期）——用定向变异证明「歌词字块带音高 + 简谱/音名双渲染」
   这批功能有具名断言守着。
   纪律（reverse-verify-tests-by-mutation skill）：
     1. 只改 /tmp 副本，仓库文件一个字节不动（BEATSIGHT_HTML 注入）；
     2. 变异后必须出现**具名 ✗**（退出码/崩溃不算证据）；
     3. 锚点必须唯一且断言命中，否则大声失败（防脚本自身腐烂）；
     4. 「崩溃型被拦」与「需真机」的变异单独标注，不计入 N/N。
   用法：python3 tools/reverse-verify-v3370.py

   判定点清单（一个判定点 = 一个变异；对照见 tests/cases/t222-melody-pitch.js）：
     M1 jianpuOf 八度点丢弃（1' 退化为 1）        → T222a「高八度/低八度」两条红
     M2 keySemiOf 非法调回落 0（换调基准漂移）     → T222a「非法调名回落 C」红
     M3 token 完整匹配护栏删掉（部分后缀也吃）     → T222b「数字歌词保护 / 我5多6」红
     M4 pitchNotation 默认档翻成 jp（老用户画面被动）→ T222g「默认 off」红
     M5 组内平移丢 p（谱随位置变动而丢）           → T222f「平移后 p 原样」红
     M6 off 档守卫删掉（off 也画上标）             → T222h「off 档：不画上标」红"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("M1 v3.37.0 回退：jianpuOf 丢八度点（高/低八度与 1 同形）",
   """  const m = REL2DEG[rel];
  return m[1] + m[0] + (oct > 0 ? "'".repeat(oct) : oct < 0 ? ",".repeat(-oct) : "");""",
   """  const m = REL2DEG[rel];
  return m[1] + m[0];""",
   ["高八度", "低八度"]),

  ("M2 v3.37.0 回退：keySemiOf 非法调回落 0（而不是 C4=60）",
   "  return typeof k === \"number\" ? 60 + k : 60;",
   "  return typeof k === \"number\" ? 60 + k : 0;",
   ["非法调名回落 C"]),

  ("M3 v3.37.0 回退：token 余段不要求完整匹配（护栏删掉，数字歌词会被吃）",
   """      const m = matchPitchSuffix(s, i + 1, keySemi);
      if (m && i + 1 + m.len === j){                            // 后缀完整占满 token 余段""",
   """      const m = matchPitchSuffix(s, i + 1, keySemi);
      if (m){""",
   ["数字歌词保护", "我5多6"]),

  ("M4 v3.37.0 回退：pitchNotation 默认档 jp（老用户画面被动）",
   "    pitchNotation: [\"off\", \"jp\", \"nm\"].indexOf(saved.pitchNotation) >= 0 ? saved.pitchNotation : \"off\",",
   "    pitchNotation: [\"off\", \"jp\", \"nm\"].indexOf(saved.pitchNotation) >= 0 ? saved.pitchNotation : \"jp\",",
   ["默认 off"]),

  ("M5 v3.37.0 回退：组内平移丢 p（位置一动画高就没）",
   """      ? { t: c.t + d, dur: c.dur, ch: c.ch, ...(typeof c.p === "number" ? { p: c.p } : {}) }
      : { t: c.t, dur: c.dur, ch: c.ch, ...(typeof c.p === "number" ? { p: c.p } : {}) }));""",
   """      ? { t: c.t + d, dur: c.dur, ch: c.ch }
      : { t: c.t, dur: c.dur, ch: c.ch }));""",
   ["平移后 p 原样"]),

  ("M6 v3.37.0 回退：off 档守卫删掉（off 也画上标）",
   "            if (typeof c.p === \"number\" && S.pitchNotation !== \"off\"){",
   "            if (typeof c.p === \"number\"){",
   ["off 档：不画上标"]),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v3370.html"
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
os.remove("/tmp/mut-v3370.html") if os.path.exists("/tmp/mut-v3370.html") else None
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
