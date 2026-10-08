/* BeatSight 自动化测试 · 简谱正字法显示（P12，v3.38.0）
   T226 系列。
   ---------------------------------------------------------------------------
   用户口径：「展现出来的高低音要跟现实中的简谱样式相同」。故显示层拆成**两形态**：
     · 文本形态（jianpuOf 的 `1'` / `6,` / `#4`）——继续服务 serialize 回填 / aria / announce；
     · 正字法形态（mkJianpuGlyph 的上下八度点）——只在**可视**处渲染。
   时值**不画下划线**：块宽已与 dur 严格成正比、延音/休止块已表达，再画是第三遍冗余且小字号必糊
   （t226c 的源码钉锁死「jp 类不设 text-decoration」）。
   nm 档无点号传统——直接用音名文本（音名体系的八度就是数字，如 C5）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const src = html;
const byCls = (node, cls) => (node.children || []).find(c =>
  new RegExp("(^| )" + cls + "( |$)").test(c.className || ""));
const clsOf = node => {
  let out = [node.className || ""];
  for (const c of (node.children || [])) out = out.concat(clsOf(c));
  return out;
};
/* 崩溃免疫访问器：变异实验里节点可能缺席，此时应出一条具名红而不是抛栈（崩溃不算证据） */
const kids = n => (n && n.children) || [];
const child = (n, i) => kids(n)[i] || {};
const dotsOf = g => kids(g).find(c => /(^| )jp-dots( |$)/.test(c.className || ""));
const dotsCls = g => { const d = dotsOf(g); return d ? d.className : "(无点)"; };
const dotsTxt = g => { const d = dotsOf(g); return d ? d.textContent : "(无点)"; };

/* ============ T226a：jianpuParts（度数/升号/八度点拆成可建字段，与 jianpuOf 同口径） ============ */
section("T226a jianpuParts · midi → {acc, deg, octUp, octDown}（C 调与移调）");
{
  const { beat } = loadApp();
  const J = x => JSON.stringify(x);
  eq(J(beat.jianpuParts(60, 60)), J({ acc: "", deg: 1, octUp: 0, octDown: 0 }), "C4 = 本位 1");
  eq(J(beat.jianpuParts(72, 60)), J({ acc: "", deg: 1, octUp: 1, octDown: 0 }), "★ C5 = 高八度 1（上点 1 颗）");
  eq(J(beat.jianpuParts(48, 60)), J({ acc: "", deg: 1, octUp: 0, octDown: 1 }), "★ C3 = 低八度 1（下点 1 颗）");
  eq(J(beat.jianpuParts(84, 60)), J({ acc: "", deg: 1, octUp: 2, octDown: 0 }), "★ C6 = 高两个八度（上点 2 颗）");
  eq(J(beat.jianpuParts(36, 60)), J({ acc: "", deg: 1, octUp: 0, octDown: 2 }), "★ C2 = 低两个八度（下点 2 颗）");
  eq(J(beat.jianpuParts(61, 60)), J({ acc: "#", deg: 1, octUp: 0, octDown: 0 }), "★ #C4 = 升一号 + 度数 1");
  eq(J(beat.jianpuParts(67, 67)), J({ acc: "", deg: 1, octUp: 0, octDown: 0 }), "★ 移调：G 调里 p=67 是 1");
  /* 与文本形态同口径（同一 d → 同一 rel/oct，只是拆成字段） */
  eq(beat.jianpuOf(72, 60), "1'", "前提：文本形态 C5 = 1'");
  eq(beat.jianpuOf(36, 60), "1,,", "前提：文本形态 C2 = 1,,");
  eq(beat.jianpuOf(61, 60), "#1", "前提：文本形态 #C4 = #1");
}

/* ============ T226b：mkJianpuGlyph（只建点号与数码，竖排堆叠） ============ */
section("T226b mkJianpuGlyph · 八度点上下堆叠 / 升号在数前（结构断言）");
{
  const { beat } = loadApp();
  const g0 = beat.mkJianpuGlyph(beat.jianpuParts(60, 60));
  eq(g0.className, "jp-g oct-mid", "根节点 = .jp-g（本位音配 oct-mid）");
  eq(g0.style["--oct"], "0", "★ 本位音 --oct = 0（数码不升降）");
  eq(kids(g0).length, 1, "本位音只有 1 个子节点（无点）");
  const b0 = byCls(g0, "jp-body");
  eq(kids(b0).length, 1, "body 里只有数码");
  eq(child(b0, 0).className, "jp-deg", "数码节点 = .jp-deg（body 的子节点）");
  eq(child(b0, 0).textContent, "1", "数码 = 1");
  eq(g0.textContent, "1", "★ 聚合文本 = 1");

  const g1 = beat.mkJianpuGlyph(beat.jianpuParts(72, 60));
  eq(kids(g1).length, 2, "★ 高八度：点 + body 两个子节点");
  eq(dotsCls(g1), "jp-dots top", "★ 点在 body **之前**（上方）、带 top 标记");
  eq(dotsTxt(g1), "●", "高八度 1 颗点（实心点，v3.38.0 加大）");
  eq(g1.textContent, "●1", "★ 聚合文本 = 上点 + 数码");
  eq(g1.className, "jp-g oct-hi", "★★ 高八度配 oct-hi（用户口径③：高音暖色）");
  eq(g1.style["--oct"], "1", "★★ 高八度 --oct = 1（数码上移）");

  const g2 = beat.mkJianpuGlyph(beat.jianpuParts(84, 60));
  eq(dotsTxt(g2), "●●", "高两个八度 = 2 颗点");
  eq(g2.textContent, "●●1", "★ 聚合文本 = 2 点 + 数码");
  eq(g2.style["--oct"], "2", "★ 高两个八度 --oct = 2");

  const gb = beat.mkJianpuGlyph(beat.jianpuParts(36, 60));
  eq(kids(gb).length, 2, "★ 低八度：body + 点两个子节点");
  eq(dotsCls(gb), "jp-dots bot", "★ 点在 body **之后**（下方）、带 bot 标记");
  eq(dotsTxt(gb), "●●", "低两个八度 = 2 颗点");
  eq(gb.textContent, "1●●", "★ 聚合文本 = 数码 + 下点");
  eq(gb.className, "jp-g oct-lo", "★★ 低八度配 oct-lo（用户口径③：低音冷色）");
  eq(gb.style["--oct"], "-2", "★ 低两个八度 --oct = -2（数码下移）");

  const ga = beat.mkJianpuGlyph(beat.jianpuParts(61, 60));
  const body = byCls(ga, "jp-body");
  eq(kids(body).length, 2, "★ 升号音：body = 升号 + 数码两个子节点");
  eq(child(body, 0).className, "jp-acc", "★ 升号在**前**（数前记号，同 jianpuOf 写法）");
  eq(child(body, 0).textContent, "#", "升号字形 = #");
  eq(child(body, 1).textContent, "1", "数码仍是 1");
  eq(ga.textContent, "#1", "★ 聚合文本 = #1（与文本形态一致）");

  const gboth = beat.mkJianpuGlyph(beat.jianpuParts(49, 60));   /* C#3：上？下？→ 下八度 #1 */
  eq(gboth.textContent, "#1●", "★ 升号 + 下点并存：聚合文本 = #1●（点序在数码后）");
}

/* ============ T226c：时值不进 glyph —— 无下划线（源码钉 + 结构钉） ============ */
section("T226c 时值不画下划线 · jianpuParts 不吃时值 / jp 类不设 text-decoration");
{
  const { beat } = loadApp();
  ok(/function jianpuParts\(p, keySemi\)\{/.test(src),
    "★★ 源码钉：jianpuParts 只吃 (p, keySemi) 两个参数——时值根本不进 glyph");
  const all = clsOf(beat.mkJianpuGlyph(beat.jianpuParts(72, 60))).join(" ");
  ok(!/under|line|dash/.test(all),
    "★★ 结构钉：glyph 节点里没有下划线/横线类（时值靠块宽表达，不走下划线）");
  ok(!/\.jp-[a-z-]+\{[^}]*text-decoration/.test(src),
    "★★ 源码钉：jp 类 CSS 一律不设 text-decoration（下划线方案已被用户否掉）");
  ok(/\.jp-dots\{/.test(src), "前提：简谱点号的 CSS 在（上面那条不是空判据）");
}

/* ============ T226d：mkPitchMarkEl（tie / pitch / multi 三形态 + 档位分派） ============ */
section("T226d mkPitchMarkEl · jp 走 glyph、nm 走音名、tie 走「-」、multi 用「·」串");
{
  const { beat } = loadApp();
  const q = p => ({ kind: "pitch", seq: [{ p: p }] });
  const je = beat.mkPitchMarkEl(q(67), "jp", "");
  eq(je.className, "pit-seq", "默认类名 = .pit-seq");
  eq(je.children.length, 1, "单颗音符 = 1 个子节点");
  eq(je.children[0].className, "jp-g oct-mid", "★ jp 档 → glyph 节点（本位音 oct-mid）");
  eq(je.textContent, "5", "★ 聚合文本 = 简谱 5");
  eq(beat.mkPitchMarkEl(q(67), "jp", "", "lyric-pit").className, "lyric-pit", "类名可覆盖（主视图 lyric-pit）");

  const ne = beat.mkPitchMarkEl(q(67), "nm", "");
  eq(ne.children[0].className, "pit-nm oct-mid", "★ nm 档 → 音名文本节点（不建 glyph），同样带八度色类");
  eq(ne.textContent, "G4", "★ nm 聚合文本 = G4");

  const te = beat.mkPitchMarkEl({ seq: [{ tie: true }] }, "jp", "");
  eq(te.children[0].className, "pit-tie", "★ 延音单元 → .pit-tie");
  eq(te.textContent, "-", "★ 延音显示为「-」");

  const me = beat.mkPitchMarkEl({ seq: [{ p: 60 }, { p: 62 }] }, "jp", "");
  eq(me.children.length, 3, "★ 串显：glyph · glyph 三个子节点");
  eq(me.children[1].className, "pit-sep", "★ 分隔符 = .pit-sep");
  eq(me.children[1].textContent, "·", "分隔符字形 = ·");
  eq(me.textContent, "1·2", "★ 聚合文本 = 1·2");

  eq(beat.mkPitchMarkEl({ seq: [{ tie: true }, { p: 62 }] }, "jp", "").textContent, "-·2",
    "★ 延音 + 字内起音 = 「-·2」（pitchMarkText 同款）");
  eq(beat.mkPitchMarkEl(null, "jp", ""), null, "无标注 ⇒ null（不建空壳）");
}

/* ============ T226e：mkPitchLabel（单颗音符标签：jp glyph / nm 音名） ============ */
section("T226e mkPitchLabel · 独立音符块标签按档位建节点");
{
  const { beat } = loadApp();
  const nm = beat.mkPitchLabel(67, "nm", "");
  eq(nm.children.length, 0, "nm：纯文本节点（无子节点）");
  eq(nm.textContent, "G4", "★ nm 标签 = G4");
  const jp = beat.mkPitchLabel(67, "jp", "");
  eq(jp.className, "jp-g oct-mid", "★ jp 标签 = glyph 根（本位音 oct-mid）");
  eq(jp.textContent, "5", "★ jp 标签文本 = 5");
  eq(beat.mkPitchLabel(67, "jp", "G").textContent, "1", "★ 移调：G 调里 p=67 标签 = 1");
}

/* ============ T226f：主视图端到端（字上标真的画成上下点） ============ */
section("T226f 主视图集成 · jp 档字上标 = 正字法点 / nm 档 = 音名");
{
  /* t222h 同款种子：曲式模式 + 4 行档 */
  const BL = { ref: { type: "builtin", idx: 1 }, repeats: 1 };
  const app = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t1", name: "旋律曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }),
  });
  const { beat, els } = app;
  /* 「一」唱 C5（高八度）、「二」唱 C3（低八度）：同调两个方向的点各一颗 */
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 48, ch: "一" }, { t: 48, dur: 48, ch: "二" }],
    { notes: [{ t: 0, dur: 48, p: 72 }, { t: 48, dur: 48, p: 48 }] });
  const laneChips = () => {
    const rows = els["lyricLane"].children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
    return Array.prototype.concat.apply([], rows.map(r =>
      (r.children || []).filter(c => /(^| )lyric-chip( |$)/.test(c.className))));
  };
  /* v3.38.0：音高标注是 chip 的**直接子节点**（字块左上角，不再嵌在字里） */
  const pitOf = chip => (chip.children || []).find(c => /lyric-pit/.test(c.className)) || null;

  beat.Store.S.pitchNotation = "jp";
  beat.Viz.buildLyricLane();
  const chips = laneChips();
  ok(chips.length >= 2, "前提：主视图字块在（「一」「二」）");
  const p0 = pitOf(chips[0]), p1 = pitOf(chips[1]);
  ok(!!p0 && !!p1, "前提：两字都挂上标注");
  ok(chips.some(c => (c.children || []).some(x => /lyric-pit/.test(x.className))),
    "★★ 音高标注 = 字块（chip）的直接子节点（落字块左上角，用户口径①）");
  eq(dotsCls(child(p0, 0)), "jp-dots top",
    "★★ 「一」= C5 ⇒ 标注画**上点**（.jp-dots.top）");
  eq(p0 ? p0.textContent : "(无)", "●1", "★★ 「一」标注聚合文本 = ●1");
  eq(child(p0, 0).className, "jp-g oct-hi", "★★ 「一」高八度 ⇒ 色类 oct-hi（用户口径③）");
  eq(dotsCls(child(p1, 0)), "jp-dots bot",
    "★★ 「二」= C3 ⇒ 标注画**下点**（.jp-dots.bot）");
  eq(p1 ? p1.textContent : "(无)", "1●", "★★ 「二」标注聚合文本 = 1●");
  eq(child(p1, 0).className, "jp-g oct-lo", "★★ 「二」低八度 ⇒ 色类 oct-lo（用户口径③）");

  beat.Store.S.pitchNotation = "nm";
  beat.Viz.buildLyricLane();
  const q0 = pitOf(laneChips()[0]);
  eq(q0 ? q0.textContent : "(无)", "C5", "★★ nm 档：同一份数据（p=72）显示成音名 C5（无点号）");
}

/* ============ T226g：音符配色（脱离字色 + 八度三色）与「字块左上角」定位（v3.38.0 用户口径①②③） ============ */
section("T226g 音符配色 · 八度三色类 + --oct + 字块左上角定位（需求①②③）");
{
  const { beat } = loadApp();
  /* 三档各得一类（与 mkJianpuGlyph 的 net 号一致） */
  eq(/ oct-hi$/.test(beat.mkJianpuGlyph(beat.jianpuParts(72, 60)).className), true, "高八度 → oct-hi");
  eq(/ oct-mid$/.test(beat.mkJianpuGlyph(beat.jianpuParts(60, 60)).className), true, "本位 → oct-mid");
  eq(/ oct-lo$/.test(beat.mkJianpuGlyph(beat.jianpuParts(48, 60)).className), true, "低八度 → oct-lo");
  /* nm 档同样带八度色类（音名文本八度在名字里，但配色仍随八度走） */
  eq(beat.mkPitchLabel(72, "nm", "").className, "pit-nm oct-hi", "nm 高八度 → oct-hi");
  eq(beat.mkPitchLabel(48, "nm", "").className, "pit-nm oct-lo", "nm 低八度 → oct-lo");
  /* 源码钉：三色走 --pitch-* 主题变量；且音符**脱离字色**（不再有 .lyric-char .lyric-pit 继承规则） */
  ok(/\.jp-g\.oct-hi[^}]*color:var\(--pitch-hi\)/.test(src), "★★ 源码钉：oct-hi → var(--pitch-hi)");
  ok(/\.jp-g\.oct-mid[^}]*color:var\(--pitch-mid\)/.test(src), "★★ 源码钉：oct-mid → var(--pitch-mid)");
  ok(/\.jp-g\.oct-lo[^}]*color:var\(--pitch-lo\)/.test(src), "★★ 源码钉：oct-lo → var(--pitch-lo)");
  ok(/--pitch-hi:#E85C7A/.test(src) && /--pitch-hi:#B0183E/.test(src),
    "★★ 源码钉：--pitch-hi 有经典(#E85C7A) / 日间(#B0183E) 两档");
  ok(!/\.lyric-char \.lyric-pit\{/.test(src),
    "★★ 源码钉：音符不再嵌在字里（旧 .lyric-char .lyric-pit 规则已撤——颜色不再随字）");
  ok(/\.lyric-chip \.lyric-pit\{[^}]*position:absolute/.test(src),
    "★★ 源码钉：主视图音高标注绝对定位（落字块左上角，需求①）");
  ok(/\.arg-lyric-chip \.arg-lyric-pit\{[^}]*position:absolute/.test(src),
    "★★ 源码钉：编排页音高标注绝对定位（落字块左上角，需求①）");
  /* 用户反馈「点太贴近数字」：点与数码之间必须有非零显式间距（.top 下边距 / .bot 上边距）。
     ★ 用 ^ + m 锚到**行首**——否则会误匹配 notechip 的覆写规则 `.lyric-chip.notechip .jp-dots.top{...}`，
     令 M20（把全局间距改 0）测不出（本脚本自身的一次失配教训）。 */
  ok(/^\.jp-dots\.top\{margin-bottom:(?!0)/m.test(src) && /^\.jp-dots\.bot\{margin-top:(?!0)/m.test(src),
    "★★ 源码钉：点与数码之间有显式间距（用户反馈「点太贴近数字」——拉开的实现）");
  /* 用户报障「带高/低音标记的音符装不进格子」：独立音符块字号**固定收紧** + 点距压紧 */
  ok(/\.lyric-chip\.notechip \.lyric-char\{[^}]*font-size:11px/.test(src),
    "★★ 源码钉：主视图独立音符块字号固定 11px（不随 --cs 涨，装得进 26px 格）");
  ok(/\.arg-lyric-chip\.notechip \.arg-lyric-char\{font-size:10px\}/.test(src),
    "★★ 源码钉：编排页独立音符块字号固定 10px（装得进约 20px 格）");
  ok(/\.lyric-chip\.notechip \.jp-dots\{[^}]*line-height:\.7/.test(src) &&
     /\.arg-lyric-chip\.notechip \.jp-dots\{[^}]*line-height:\.7/.test(src),
    "★★ 源码钉：独立音符块点距压紧（行高 .7，正文档是 .85）");
}
