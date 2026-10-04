#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""反向变异验证（v3.31.x 落地审计）——用定向变异证明每个修复都有具名断言守着。
   纪律（reverse-verify-tests-by-mutation skill）：
     1. 只改 /tmp 副本，仓库文件一个字节不动（BEATSIGHT_HTML 注入）；
     2. 变异后必须出现**具名 ✗**（退出码/崩溃不算证据）；
     3. 锚点必须唯一且断言命中，否则大声失败（防脚本自身腐烂）；
     4. 「崩溃型被拦」与「需真机」的变异单独标注，不计入 N/N。
   用法：python3 tools/reverse-verify-v331x.py   （依赖：BEATSIGHT_HTML 已被 harness 支持）"""
import io, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
orig = io.open(SRC, encoding="utf-8").read()

MUTANTS = [
  ("M21 v3.31.6 P0-A 回退：旧键不判对象类型", "  const legacyRaw = readJSON(KEY_LEGACY);\n  const legacy = (legacyRaw && typeof legacyRaw === \"object\") ? legacyRaw : {};",
   "  const legacy = readJSON(KEY_LEGACY) || {};", ["m2=5 不崩", "m2=\"abc\" 不崩", "m2=true 不崩"]),
  ("M22 v3.31.6 P0-B 回退：组员不重映射", "          const nid = (refMap && refMap.get(r.id)) || r.id;   // v3.31.6（审计 P0-B）：随包内映射重写",
   "          const nid = r.id;", ["组员指向本机新 id", "resolveRef 解析成功"]),
  ("M23 v3.31.6 P1-A 回退：重进不取消旧链", "    pvGen++;                                            // v3.31.6（审计 P1-A）：旧链世代作废\n    if (pvRaf){ if (typeof cancelAnimationFrame === \"function\") cancelAnimationFrame(pvRaf); pvRaf = 0; }\n",
   "", ["三次重进后挂起 3 条", "冲刷后仍恒 3"]),
  ("M24 v3.31.6 P1-B 回退：空小节不补训练计数", "      if (S.trainer.on && Trainer.onBarBoundary()) return true;\n      const pendE = Presets.consumePending(schedBar);\n      if (pendE.applied){\n        schedBar = pendE.resetBar;\n        loopStart = nextNoteTime - schedBar * S.sig * spb();\n        Viz.resetTracking();\n        return true;\n      }\n",
   "", ["空小节后爬坡进度仍推进"]),
  ("M25 v3.31.6 P3-D 回退：groupMove 用 groups.length", '      g = { id: "g" + Date.now() + "-" + (grpSeq++), name: nm, zone, members: [], open: true };   // v3.31.6（审计 P3-D）：与 groupCreate 同口径单调',
   '      g = { id: "g" + Date.now() + "-" + groups.length, name: nm, zone, members: [], open: true };', ["同毫秒建→删→移入新建 id 互异"]),
  ("M26 v3.31.6 S-1 回退：合成失败写回 -1", "      /* v3.31.6（审计 S-1）：合成失败**保留页锚**而非写回 -1——winAnchorSeg 恒 ≥0，-1 会让\n         帧循环 ws(≥0)≠-1 恒真 → 每帧 buildViz（注释 L6944 自述过该风险）。保留锚点后帧循环\n         稳定、anchored() 为真，引用修复后下次翻页/UI 重建自然恢复（同预设分支 winStart=0 降级）。",
   "      if (!winPat) winStart = -1;", ["页锚保留"]),
  ("M27 v3.31.6 P2-A 回退：lyricFit 不封顶", "  if (lyricFit.size > 512) lyricFit.clear();\n",
   "", ["缓存被 512 封顶"]),
  ("M28 v3.31.6 P2-B 回退：隔离区不封顶", "    if (rejectedCustoms.length > 100) rejectedCustoms.length = 100;\n",
   "", ["隔离区封顶 100 条"]),
  ("M29 v3.31.6 P2-C 回退：批量带出不 defer", "    if (!(opt && opt.deferPersist)) persistLyrics();",
   "    persistLyrics();", ["歌词冷键只写 1 次"]),
  ("M1 P0-2 回退：importAll 不再重映射包内引用", "const v = normArrange(remapRefs(r));",
   "const v = normArrange(r);", ["引用指向本机新 id", "resolveRef 解析成功", "该曲式无问题"]),
  ("M2 P0-4 回退：换对象不再还原旧拍号", "    if (S.preview) stopAudition();                  // v3.31.x（审计 P0-4）：换对象先经唯一出口还原\n",
   "", ["停止后 S.sig == 选中型拍号", "curPattern() 返回选中型"]),
  ("M3 P0-3 回退：撤掉曲式冷键前置守卫注入", "  Store.setArrPersistGuard(() => { if (candPreview) stopCandPreview(true); });",
   "", ["候选试听态被收口", "主角曲式的 ref 仍是原值", "冷键里也是原值"]),
  ("M4 P1-1 回退：Enter 恒确认", "closeModal(document.activeElement !== $(\"modalCancel\"));",
   "closeModal(true);", ["取消焦点上按 Enter 不执行确认"]),
  ("M5 P1-2 回退：完成态不复位开关", "      S.trainer.on = false;\n",
   "", ["完成后开关复位", "开关 UI 复位", "重播持续播放", "复位进热键"]),
  ("M6 P1-4 回退：按显示名取候选", "const cands = EAR_GROUP_IDXS[gIdx].idxs.map(i => (i >= 0 ? BUILTINS[i] : null)).filter(Boolean);",
   "const cands = g.keys.map(k => BUILTINS.find(p => p.name === k)).filter(Boolean);", ["候选恒 3 个"]),
  ("M7 P1-5 回退：srcRefs 按 type/idx 判身份",
   "      const bi = (b.ref && b.ref.type === \"builtin\") ? b.ref.idx : null;\n      const hit = (b.ref && b.ref.type === \"custom\" && typeof src.id === \"string\" && b.ref.id === src.id)\n        || (bi !== null && (src.idx !== undefined ? bi === src.idx : BUILTINS.indexOf(src) === bi));",
   "      const hit = src.type === \"custom\"\n        ? (b.ref && b.ref.type === \"custom\" && b.ref.id === src.id)\n        : (b.ref && b.ref.type === \"builtin\" && b.ref.idx === src.idx);",
   ["提示显示引用数"]),
  ("M8 P1-6 回退：键盘移字不搬行", "    const host = (lctx.barrowEls && lctx.barrowEls[row]) || lctx.lane;\n    if (host && chip.parentNode !== host) host.appendChild(chip);\n",
   "", ["跨行后字块已搬进新行容器"]),
  ("M9 P2-1 回退：随机静音缓存不封顶", "  if (MUTE_RND_CACHE.size > 2048) MUTE_RND_CACHE.clear();\n",
   "", ["缓存被 2048 封顶"]),
  ("M10 P1-8 回退：ear 导入不归一化",
   "          let nv = Math.max(0, Math.floor(inc));\n          if (k === \"right\") nv = Math.min(ear.total, nv);\n          (/** @type {any} */ (ear))[k] = nv;\n",
   "          (/** @type {any} */ (ear))[k] = inc;\n", ["right 被夹到", "冷键里已是夹制后的值"]),
  ("M11 P1-9 回退：patLenOf 只查加载快照",
   "    else if (ref && ref.type === \"custom\") p = (customsRef && customsRef.find(c => c && c.id === ref.id))\n      || savedCustoms.find(c => c && c.id === ref.id);",
   "    else if (ref && ref.type === \"custom\") p = savedCustoms.find(c => c && c.id === ref.id);",
   ["超长曲式被拒", "跳过计数 1"]),
  ("M12 P1-3 回退：serializeAll 不再带 label",
   "      ...(c.label ? {label:c.label} : {}),    // v3.31.x（审计 P1-3）：label 随全量包往返——此前只有预设包带、全量包静默丢失\n",
   "", ["serializeAll 带 label"]),
  ("M13 S-4 回退：预备拍改速不重排", "      if (ciLeft > 0){\n        ciNext = loopStart - ciLeft * spb();\n        ciStart = ciNext - (ciBeats - ciLeft) * spb();\n      }\n",
   "", ["ciNext = loopStart"]),
  ("M14 S-2 回退：suspended 无恢复分支",
   "      if (ctx.state === \"suspended\" && S.playing) resumeCtx();\n",
   "", ["播放中 suspended → resume 被调"]),
  ("M15 S-3 回退：训练中不锁滑杆", "    $(\"bpmSlider\").disabled = locked;\n",
   "", ["训练中滑杆锁定"]),
  ("M16 P3-3 回退：空库不清底栏",
   "      const pb = $(\"pbProgress\"), ps = $(\"pbSub\");\n      if (pb) pb.innerHTML = \"\";\n      if (ps) ps.innerHTML = \"\";\n",
   "", ["空库 → pbProgress 清空", "空库 → pbSub 清空"]),
  ("M17 P3-8 回退：组 id 用 groups.length",
   "    groups.push({ id: \"g\" + Date.now() + \"-\" + (grpSeq++), name: nm, zone, members: [], open: true });",
   "    groups.push({ id: \"g\" + Date.now() + \"-\" + groups.length, name: nm, zone, members: [], open: true });",
   ["同毫秒建→删→建 id 互异"]),
  ("M18 P3-7 回退：zone 不折叠 null",
   "    [s.t, s.rest ? 1 : 0, s.dir || \"\", (s.zone === undefined || s.zone === null) ? \"\" : s.zone])));",
   "    [s.t, s.rest ? 1 : 0, s.dir || \"\", s.zone === undefined ? \"\" : s.zone])));",
   ["zone null 与缺省折叠判等"]),
  ("M19 P3-5 回退：setBpm 硬编码 240/30",
   "    const bpmSlider = $(\"bpmSlider\");\n    const lo = (bpmSlider && isFinite(+bpmSlider.min)) ? +bpmSlider.min : 30;\n    const hi = (bpmSlider && isFinite(+bpmSlider.max)) ? +bpmSlider.max : 240;\n    v = Math.min(hi, Math.max(lo, v));",
   "    v = Math.min(240, Math.max(30, v));", ["调域后钳制跟随"]),
  ("M20 P1-7 回退：迁移循环不设条目防御",
   "      if (!c || typeof c !== \"object\" || !Array.isArray(c.bars)) return;\n      c.bars.forEach((/** @type {any} */ bar) => bar.forEach((/** @type {any} */ s) => {",
   "      (c.bars || []).forEach((/** @type {any} */ bar) => bar.forEach((/** @type {any} */ s) => {", None),
]

total_hit, total_miss, crashed = 0, 0, []
for name, old, new, expect_names in MUTANTS:
    mut = orig
    n = mut.count(old)
    if n != 1:
        print("!! 变异点未找到或非唯一（源码已变，需同步更新本脚本）[%d 处]：" % n + name)
        sys.exit(2)
    mut = mut.replace(old, new, 1)
    mp = "/tmp/mut-v331x.html"
    io.open(mp, "w", encoding="utf-8").write(mut)
    env = dict(os.environ, BEATSIGHT_HTML=mp)
    r = subprocess.run([os.environ.get("NODE", "node"), "tests/run.js"], cwd=ROOT,
                       env=env, capture_output=True, text=True, timeout=600)
    out = r.stdout
    failed = [l.strip()[2:] for l in out.splitlines() if l.strip().startswith("✗")]
    m = re.search(r"(\d+) PASS / (\d+) FAIL", out)
    print("=" * 72)
    print("变异：" + name)
    if expect_names is None:
        # 崩溃型被拦：只需证明整套测试没有以 0 FAIL 通过即可（纪律 1 注明）
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
            for f in hit[:4]:
                print("   ✗ " + f[:100])
            print("  ✓ 具名断言变红：" + str(len(hit)) + " 条（期望 " + str(len(expect_names)) + " 条关键词）")
            total_hit += 1
        else:
            print("  ⚠ 无具名断言变红（%s）——断言测错了对象或锚点失配，必须修" % (m.group(0) if m else "崩溃"))
            total_miss += 1
os.remove("/tmp/mut-v331x.html") if os.path.exists("/tmp/mut-v331x.html") else None
print("=" * 72)
print("命中 %d / 未命中 %d / 崩溃型（人工确认）%d" % (total_hit, total_miss, len(crashed)))
sys.exit(1 if total_miss else 0)
