/* BeatSight 自动化测试 · 记谱体系：升号 / 降号（v3.38.1）
   T228 系列。
   ---------------------------------------------------------------------------
   用户口径：「我想让降号也能显示出来。但在规则层面做好限制：一个谱子里只能都是降号，
             或者都是升号。」⇒ 体系是**曲式级**的唯一来源（ArrangeData.accSys），音符仍只存
   半音整数 ⇒ 同一个音不可能出现两种写法混排（这正是"规则层面的限制"）。
   分节：
     a 两张表（调内七级两表相同，只有 5 个变化音分升/降）
     b 录入四种字形（井号 / ♯ / b / ♭，前后置都认）→ 同一半音
     c 回落规则（accSysOf：白名单 + 按调名推导 + 脏值兜底）
     d 回填与往返（melodySerialize 按体系写、parse∘serialize 同体系逐位还原）
     e 端到端（切体系 → 字形随之改：同一个 p 从 #4 变 b5）
     f 源码钉（UI 胶囊 / 两条左内缩 / normArrange 白名单 / 记号字号）
*/
"use strict";
const { loadApp, ok, eq, near, section, html } = require("../lib/harness");
const src = html;

/* ============ T228a：两张表 ============ */
section("T228a 两套体系 · 调内七级相同 / 五个变化音分升号与降号");
{
  const { beat } = loadApp();
  eq(beat.jianpuOf(61, 60, "sharp"), "#1", "C 调 #C4 → 升号制 #1");
  eq(beat.jianpuOf(61, 60, "flat"),  "b2", "同一个音 → 降号制 b2");
  eq(beat.jianpuOf(66, 60, "sharp"), "#4", "F#4 → #4");
  eq(beat.jianpuOf(66, 60, "flat"),  "b5", "同一个音 → b5");
  eq(beat.jianpuOf(70, 60, "sharp"), "#6", "A#4 → #6");
  eq(beat.jianpuOf(70, 60, "flat"),  "b7", "同一个音 → b7");
  /* 调内七级：两套体系必须给出**同一个**写法——这正是简谱的读法（调号已含的升降不再写记号） */
  const dia = [60, 62, 64, 65, 67, 69, 71];
  ok(dia.every(p => beat.jianpuOf(p, 60, "sharp") === beat.jianpuOf(p, 60, "flat")),
    "★★ 调内七级（1 2 3 4 5 6 7）两套体系写法**逐位相同**——只有变化音分升/降");
  eq(beat.jianpuParts(66, 60, "flat").acc, "b", "★ 正字法字段：降号制下 acc = b");
  eq(beat.jianpuParts(66, 60, "sharp").acc, "#", "★ 升号制下 acc = #");
  eq(beat.jianpuParts(66, 60, "flat").deg, 5, "★ 度数随体系变（#4 vs b5 是同一半音的两种写法）");
  eq(beat.jianpuOf(72, 60, "flat"), "1'", "★ 八度点不受体系影响（降号制下高八度仍是 1'）");
}

/* ============ T228b：录入四种字形 ============ */
section("T228b 录入 · 井号 / ♯ / b / ♭ 前后置都认，且回同一个半音（显示按体系）");
{
  const { beat } = loadApp();
  const p = s => { const m = beat.matchPitchSuffix(s, 0, 60); return m ? m.p : null; };
  eq(p("#4"), 66, "#4");
  eq(p("4#"), 66, "4#（后置）");
  eq(p("♯4"), 66, "♯4（Unicode 升号）");
  eq(p("b5"), 66, "b5（与 #4 同音）");
  eq(p("5b"), 66, "5b（后置）");
  eq(p("♭5"), 66, "♭5（Unicode 降号）");
  eq(p("b7"), 70, "b7");
  eq(p("b3"), 63, "b3");
  eq(p("1'"), 72, "1' 高八度（回归面：v3.37.0 写法不变）");
  eq(p("6,"), 57, "6, 低八度不变");
  eq(p("5"), 67, "裸度数不变");
  eq(beat.parseLyricTextPitch("我♭3 多6", 60).map(c => c.p).join(","), "63,69", "★ 贴词后缀也认 ♭");
}

/* ============ T228c：回落规则 ============ */
section("T228c accSysOf · 白名单 + 按调名推导 + 脏值兜底");
{
  const { beat } = loadApp();
  eq(beat.accSysOf({ accSys: "flat" }), "flat", "显式 flat 生效");
  eq(beat.accSysOf({ accSys: "sharp" }), "sharp", "显式 sharp 生效");
  eq(beat.accSysOf({ accSys: "blue" }), "sharp", "★ 脏值回落（白名单外一律升号制）");
  eq(beat.accSysOf({}), "sharp", "★ 缺省 = 升号制（今天没有调主 UI ⇒ 恒升号 ⇒ 老数据逐位不变）");
  eq(beat.accSysOf(null), "sharp", "空曲式也兜住");
  eq(beat.accSysOfKey("Bb"), "flat", "调名含 b ⇒ 降号制");
  eq(beat.accSysOfKey("F"), "flat", "F 调 ⇒ 降号制");
  eq(beat.accSysOfKey("G"), "sharp", "G 调 ⇒ 升号制");
  eq(beat.accSysOfKey(""), "sharp", "空调名 ⇒ 升号制");
  eq(beat.accSysOf({ key: "Eb" }), "flat", "★ 没显式选过体系时按调名推导（将来有调主 UI 就自动生效）");
  eq(beat.accSysOf({ key: "Eb", accSys: "sharp" }), "sharp", "★ 显式优先于推导");
}

/* ============ T228d：回填与往返 ============ */
section("T228d 回填 · melodySerialize 按体系写；同一体系 serialize∘parse 逐位还原");
{
  const { beat } = loadApp();
  const notes = [{ t: 0, dur: 24, p: 70 }, { t: 24, dur: 24, p: 66 }, { t: 48, dur: 24, p: 65 }];
  const sh = beat.melodySerialize(notes, "", "sharp");
  const fl = beat.melodySerialize(notes, "", "flat");
  eq(sh, "#6 #4 4", "升号制回填：#6 #4 4");
  eq(fl, "b7 b5 4", "★★ 降号制回填：b7 b5 4（同一个音的另一种写法；调内音 4 两套相同）");
  const back = t => JSON.stringify(beat.parseMelodyTokens(t, 60).notes.map(n => n.p));
  eq(back(sh), JSON.stringify([70, 66, 65]), "★ 升号制文本解析回同一组半音");
  eq(back(fl), JSON.stringify([70, 66, 65]), "★★ 降号制文本解析回**同一组**半音（写法不影响数据）");
}

/* ============ T228e：端到端（切体系 ⇒ 字形改、结构不变） ============ */
section("T228e 端到端 · 主视图字形随曲式体系改（#4 ↔ b5），chip 结构不变");
{
  const BL = { ref: { type: "builtin", idx: 1 }, repeats: 1 };
  const seed = accSys => ({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t1", name: "谱", accSys: accSys, sections: [{ uid: "s1", name: "主歌", blocks: [BL] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 120, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }),
  });
  const glyphAt = accSys => {
    const app = loadApp(seed(accSys));
    const { beat, els } = app;
    beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 24, ch: "音" }], { notes: [{ t: 0, dur: 24, p: 66 }] });
    beat.Store.S.pitchNotation = "jp";
    beat.Viz.buildLyricLane();
    const rows = els["lyricLane"].children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
    const chips = Array.prototype.concat.apply([], rows.map(r =>
      (r.children || []).filter(c => /(^| )lyric-chip( |$)/.test(c.className))));
    const pit = chips.length ? (chips[0].children || []).find(c => /lyric-pit/.test(c.className)) : null;
    const g = pit ? (pit.children || [])[0] : null;
    const flatKids = g ? Array.prototype.concat.apply([], (g.children || []).map(x => x.children || [])) : [];
    const acc = flatKids.find(x => /jp-acc/.test(x.className || ""));
    return { txt: g ? g.textContent : "(无)", acc: acc ? acc.textContent : null, hasChip: chips.length > 0 };
  };
  const sh = glyphAt("sharp");
  const fl = glyphAt("flat");
  eq(sh.acc, "#", "★★ 升号制：字形记号 = #");
  eq(sh.txt, "#4", "★★ 升号制：聚合文本 = #4");
  eq(fl.acc, "b", "★★ 降号制：同一份数据、同一个半音，记号变成 b");
  eq(fl.txt, "b5", "★★ 降号制：聚合文本 = b5");
  ok(sh.hasChip && fl.hasChip, "★ 两种体系下 chip 结构一致（只改写法，不改结构）");
}

/* ============ T228f：源码钉 ============ */
section("T228f 源码钉 · 曲式级胶囊 / 两条带记号左内缩 / 白名单 / 记号字号");
{
  ok(/id="argAccSys"[^>]*aria-pressed="false"[^>]*>记谱 升号</.test(src), "★★ UI：曲式库表头有「记谱 升号」胶囊（默认态）");
  ok(/accOk = raw\.accSys === "sharp" \|\| raw\.accSys === "flat"/.test(src), "★★ 加载白名单：只认 sharp / flat");
  ok(/\.lyric-pit:has\(\.jp-acc\)\{left:calc\(4px \* var\(--cs,1\)\)\}/.test(src), "★★ 主视图：带记号格整枚左让一档（6→4px）");
  ok(/\.arg-lyric-pit:has\(\.jp-acc\)\{left:1px\}/.test(src), "★★ 编排页同口径（1px + 2px 边框 = 视觉 3px）");
  ok(/\.jp-acc\{margin-right:\.5px;font-size:\.85em\}/.test(src), "★ 记号小一号（.85em）");
  ok(/const REL2DEG_FLAT/.test(src) && /const REL2DEG_SHARP/.test(src), "★ 两张表都在（升 / 降）");
  ok(/function accSysOf\(a\)\{/.test(src) && /function accSysOfKey\(keyName\)\{/.test(src), "★ 回落链两级都在：白名单 → 按调名推导");
  ok(/function nmMarkHidden\(cellPx, chars, sys, reserve\)\{/.test(src) && /NM_CHAR_RESERVE/.test(src), "★ nm 档窄格判据在（v3.38.1 补 4：词块把歌词字占地 reserve 也算进来）");
  ok(/nmChars: chars/.test(src), "★ nm 需求按字符数估（PITCH_MARK.nmChar）");
}
