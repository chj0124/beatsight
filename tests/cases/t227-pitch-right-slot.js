/* BeatSight 自动化测试 · 音高标注几何（v3.38.1 现行口径，T227 系列）
   ---------------------------------------------------------------------------
   用户拍板（现行三条，逐条对应下面的分节）：
     ① 数码**整枚垂直居中**（数字坐中线 ⇒ 高/低音的数字在同一条线上）；
     ② 八度点贴在数字两侧：**高音 = 头部右侧**（.jp-dots.hi{left:100%;top:0}）、
        **低音 = 脚部左侧**（.jp-dots.lo{right:100%;bottom:0}）；点字号 .4em，不越出数码高度带；
     ③ 歌词字落**右下**（left 26px·--cs / right 6px·--cs / bottom 1px）；nm 档则反过来——
        字靠左、音名靠右，两者不相交（nmMarkHidden 在放不下时整枚不画音名）。
   ★ 已退役的旧口径（**不再有断言守着它们**，T227g 只钉现口径）：
     三档槽位（高贴顶/中居中/低贴底）、点在数码右侧一律、窄格三级降级（横排→竖排→只画数码）、
     字心 clamp(10px,25%,32px)。pitchFitClass / pitch-col / pitch-num-only 三档判据保留函数与
     类名（向后兼容），但一律返回空类 ⇒ 永不触发。
   ★ 桩没有布局：真实几何（点是否越出高度带、字/名是否相交、任何格宽下不裁字）由 smoke
     的音高探针守；本文件钉结构、纯函数与 CSS 规则本身。 */
"use strict";
const { loadApp, ok, eq, near, section, html } = require("../lib/harness");

const src = html;
const kids = n => (n && n.children) || [];
const dotsOf = g => kids(g).find(c => /(^| )jp-dots( |$)/.test(c.className || ""));
const dotsCls = g => { const d = dotsOf(g); return d ? d.className : "(无点)"; };
const glyphOf = (el) => (kids(el)[0] || null);
const hasPitchClass = g => /(^| )pitch-(col|num-only)( |$)/.test((g && g.className) || "");

/* ============ T227a：pitchMarkNeeds（三档各自需要的格宽） ============ */
section("T227a pitchMarkNeeds · 各档需求（v3.38.1 补3 后 row = col = num：点不再加宽）");
{
  const { beat } = loadApp();
  const n1 = beat.pitchMarkNeeds({ acc: "", dots: 1 });
  const n2 = beat.pitchMarkNeeds({ acc: "", dots: 2 });
  const n2s = beat.pitchMarkNeeds({ acc: "#", dots: 2 });
  near(n1.num, 14.4, 1e-9, "只画数码：左内缩 6 + 数码 8.4（14px 基准，无点、也**不需要**点距）");
  near(n1.col, 14.4, 1e-9, "★★ 点回纵向 ⇒ 宽度与点无关：竖排需求 = 内缩 6 + 数码 8.4");
  near(n1.row, 14.4, 1e-9, "★★ 横排 = 竖排 = 只画数码（三档同宽 ⇒ 旧降级档永不触发）");
  near(n2.col, 14.4, 1e-9, "★★ 2 颗点也不加宽（点只在纵向堆叠）");
  near(n2.row, 14.4, 1e-9, "★★ 2 颗点横排需求同样 14.4 —— 这是「点回纵向」带来的净简化");
  near(beat.pitchFitCellPx(24, 12), 28, 1e-9, "★★ 编排页折算：12px 记号的 24px 格 ≡ 主视图基准的 28px（14/12）");
  near(n2s.num, 17.2, 1e-9, "带记号且只画数码：左内缩 4（让过一档）+ 数码 8.4 + 记号 4.8");
  near(n2s.col, 17.2, 1e-9, "带记号：竖排与横排同需求 17.2");
  near(n2s.row, 17.2, 1e-9, "★★ 带记号横排需求 = 左内缩 4（让过一档）+ 数码 8.4 + 记号 4.8");
  near(beat.pitchMarkNeeds({ nmChars: 1 }).nm, 12.9, 1e-9, "★ nm 档需求 = 左内缩 6 + 1 个字符 6.9（音名按字符数估宽）");
  near(beat.pitchMarkNeeds({ nmChars: 3 }).nm, 26.7, 1e-9, "★ nm 档需求：C#4 这种三字符 = 6 + 3×6.9");
  ok(n2.row >= n2.col && n2.col >= n2.num, "★ 三档需求单调：row ≥ col ≥ num（否则降级档会自相矛盾）");
}

/* ============ T227b：pitchFitClass（纯函数，边界逐个钉） ============ */
section("T227b pitchFitClass · 由格宽定档（含「量不到宽就不降级」的纪律）");
{
  const { beat } = loadApp();
  const F = beat.pitchFitClass;
  const two = { acc: "", dots: 2 };
  const one = { acc: "", dots: 1 };
  const sharp2 = { acc: "#", dots: 2 };
  eq(F(0, two), "", "★★ 量不到宽（0）⇒ **不降级**：宁可维持默认宽档，也不凭零值误判成窄格");
  eq(F(-5, two), "", "★ 负值同样不降级（脏输入不得反转成降级）");
  eq(F(0, two), "", "★ 与 chooseRowBeats「量不到行宽就按整小节」同一条纪律");
  /* ★★ v3.38.1 补3（用户口径）：点回到数码正上/正下 ⇒ 点不再加宽，标记宽度恒定
     ⇒ 「窄格收点 / 只画数码」两档**永不触发**：任何格宽下都返回空类（不降级、不裁字）。 */
  [1, 5, 12, 14, 14.4, 20, 40].forEach(w0 => {
    eq(F(w0, two), "", "★★ 2 颗点 · 格宽 " + w0 + "px ⇒ 不降级（点在纵向，宽度与点无关）");
    eq(F(w0, one), "", "★ 1 颗点 · 格宽 " + w0 + "px ⇒ 不降级");
    eq(F(w0, sharp2), "", "★ 带记号 · 格宽 " + w0 + "px ⇒ 不降级（记号是必需信息，宁可轻微溢出也不丢）");
  });
  eq(F(0, two), "", "★ 量不到宽（0）⇒ 不降级（与既有纪律一致）");
  near(beat.pitchMarkNeeds({ acc: "", dots: 2 }).row, beat.pitchMarkNeeds({ acc: "", dots: 1 }).row, 1e-9,
    "★★ row = col = num 三值相等（旧档位的窗口宽度为 0）");
}

/* ============ T227c：glyph 结构（点挂右侧 + 每颗点一个元素 + 降级类） ============ */
section("T227c mkJianpuGlyph · body 在前、点按 hi/lo 挂两侧 / 每颗点一个 <i>");
{
  const { beat } = loadApp();
  const g1 = beat.mkJianpuGlyph(beat.jianpuParts(72, 60));
  eq(kids(g1).length, 2, "高八度：body + 点 两个子节点");
  eq((kids(g1)[0] || {}).className, "jp-body", "★ body 在**前**（点挂右侧，故点在其后）");
  eq(dotsCls(g1), "jp-dots hi", "★ 高音点 = .jp-dots.hi（贴数码上缘）");
  eq(g1.textContent, "1●", "★ 聚合文本 = 数码 + 点");

  const gb = beat.mkJianpuGlyph(beat.jianpuParts(36, 60));
  eq(dotsCls(gb), "jp-dots lo", "★ 低音点 = .jp-dots.lo（贴数码下缘）");
  eq(gb.textContent, "1●●", "★ 低两个八度：数码 + 2 点（文本序与 v3.38.0 逐位相同）");

  const d2 = dotsOf(gb);
  eq(kids(d2).length, 2, "★★ 2 颗点 = 2 个 <i> 子元素（竖排降级靠 flex-direction 排队，单个文本节点排不动）");
  eq((kids(d2)[0] || {}).textContent, "●", "★ 每颗点各自是一个实心点字形");
  eq(g1.className.indexOf("pitch-"), -1, "★ 不传 fit ⇒ 不挂降级类（向后兼容：老调用点 / 桩）");

  const gc = beat.mkJianpuGlyph(beat.jianpuParts(36, 60), "pitch-col");
  ok(/(^| )pitch-col( |$)/.test(gc.className), "★★ fit = pitch-col ⇒ 根节点带该类（CSS 让点改竖排）");
  ok(!!dotsOf(gc), "★★ 降级**不删点**（只靠 CSS 显隐）⇒ 变宽时无需重建节点、aria/文本读数不变");
  ok(gc.textContent === gb.textContent, "★★ 降级前后聚合文本逐位相同（显示层的变化不进数据/读屏面）");

  const gn = beat.mkJianpuGlyph(beat.jianpuParts(36, 60), "pitch-num-only");
  ok(/(^| )pitch-num-only( |$)/.test(gn.className), "★★ fit = pitch-num-only ⇒ 根节点带该类");
  ok(!!dotsOf(gn), "★★ 同样不删点（降到「只画数码」也不丢 DOM）");
}

/* ============ T227d：mkPitchMarkEl / mkPitchLabel 按 cellPx 分派 ============ */
section("T227d 标记构建器 · cellPx 透传到每颗谱字（串显按各自需求判）");
{
  const { beat } = loadApp();
  const q = p => ({ kind: "pitch", seq: [{ p: p }] });
  ok(!/pitch-/.test(beat.pitchFitClass(12, { acc: "", dots: 2 })),
    "★★ v3.38.1 补3：格再窄也不降级——点回纵向后宽度与点无关，旧降级档整体退役");
  const wide = beat.mkPitchMarkEl(q(36), "jp", "", "lyric-pit", 600);
  ok(!hasPitchClass(glyphOf(wide)), "★ cellPx=600 ⇒ 不降级");
  const noPx = beat.mkPitchMarkEl(q(36), "jp", "", "lyric-pit");
  ok(!hasPitchClass(glyphOf(noPx)), "★ 不传 cellPx（老调用点）⇒ 不降级");
  /* 串显（多单元）：本位音那颗不降级 */
  const multi = beat.mkPitchMarkEl({ kind: "pitch", seq: [{ p: 36 }, { p: 60 }] }, "jp", "", "lyric-pit", 600);
  ok(!hasPitchClass(kids(multi)[2]), "★★ 同一串里本位音那颗**不降级**（各按自己需求，不搞连坐）");
  ok(!hasPitchClass(beat.mkPitchLabel(36, "nm", "", 12)), "★ nm 档没有点：不套 jp 的降级类（它走另一条规则）");
  /* ★ v3.38.1（用户拍板）：nm 档窄到装不下音名整串 ⇒ **整枚不画**（返回空壳），
     aria / 编辑轨读数不受影响。判据按字符数（C4=2 字符、C#4=3 字符）。 */
  eq(beat.mkPitchLabel(60, "nm", "", 100).textContent, "C4", "★ 宽格：nm 正常出音名 C4");
  eq(beat.mkPitchLabel(60, "nm", "", 10).textContent, "", "★★ 窄格（10px < 需求 12.9px）：音名不画（空壳）");
  eq(beat.mkPitchLabel(61, "nm", "", 20).textContent, "", "★★ C#4 需求 26.7px ⇒ 20px 格同样隐藏");
  eq(beat.mkPitchLabel(61, "nm", "", 30).textContent, "C#4", "★ 30px 格放得下 C#4");
}

/* ============ T227e：端到端（主视图歌词轨 · 三档行宽真的走出三个档） ============ */
section("T227e 主视图集成 · 任何行宽都不降级（旧三档阶梯退役后的一致性）");
{
  /* 同一个 32 分音符（dur = T32 = 6t）唱 C2（低两个八度 ⇒ 2 颗点），只换行宽。
     4/4 一小节 = 192t、K=1 ⇒ 本格像素宽 = 行宽 × 6 / 192：1200→37.5 · 600→18.75 · 400→12.5 */
  function glyphClassAt(rowW){
    const BL = { ref: { type: "builtin", idx: 1 }, repeats: 1 };
    const app = loadApp({
      "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
        { id: "t1", name: "旋律曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL] }] }] }),
      "beatsight.state": JSON.stringify({ v: 3, bpm: 120, playMode: "arrange", vizRows: 4,
        arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }),
    }, { rowW: rowW });
    const { beat, els } = app;
    beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 6, ch: "一" }], { notes: [{ t: 0, dur: 6, p: 36 }] });
    beat.Store.S.pitchNotation = "jp";
    beat.Viz.buildLyricLane();
    const rows = els["lyricLane"].children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
    const chips = Array.prototype.concat.apply([], rows.map(r =>
      (r.children || []).filter(c => /(^| )lyric-chip( |$)/.test(c.className))));
    const pit = chips.length ? (chips[0].children || []).find(c => /lyric-pit/.test(c.className)) : null;
    const g = pit ? glyphOf(pit) : null;
    return (g && g.className) || "(无)";
  }
  const wide = glyphClassAt(1200);
  ok(wide !== "(无)" && wide.indexOf("pitch-") < 0, "★★ 行宽 1200（格 37.5px）⇒ 点横排，不降级（实际：" + wide + "）");
  /* ★★ v3.38.1 补3：点回纵向后宽度与点无关 ⇒ **任何行宽都不降级**（点始终在上/下画着）。 */
  ok(!/pitch-/.test(glyphClassAt(800)), "★★ 行宽 800（格 25px）⇒ 不降级（旧契约在这里会转竖排，已退役）");
  ok(!/pitch-/.test(glyphClassAt(400)), "★★ 行宽 400（格 12.5px）⇒ 也不降级（旧契约在这里只画数码，已退役）");
  const classes = [glyphClassAt(1200), glyphClassAt(800), glyphClassAt(400)];
  ok(classes.every(c => !/pitch-/.test(c)),
    "★★ 任何行宽下都不出现降级类——旧三档阶梯（横排→竖排→只画数码）整个退役");
}

/* ============ T227f：源码钉（CSS 契约，桩里测不到几何但能钉规则） ============ */
section("T227f 源码钉 · 数码居中 / 左内缩 / 降级两条 / --oct 不再参与定位");
{
  /* ★★★ v3.38.1 补8（用户口径变更）：**音符左上锚定**。低音点改挂"数码正下方"之后整枚向下生长
     （0.85f + 0.4f×低音点数），竖向居中会让 2 颗点顶破 26px 格底 ⇒ 锚定改到格顶。
     与补3 的"数码居中"互斥，以用户最新口径为准（smoke 里量"三个音区数码顶 2/2/1px ≤ 3"）。 */
  ok(/\.lyric-chip \.lyric-pit\{[^}]*top:0;transform:none/.test(src),
    "★★ 主视图：音符**左上锚定**（补8；补3 的「整枚垂直居中」随低音点下移退役）");
  ok(!/\.lyric-pit:has\(\.oct-lo\)/.test(src),
    "★★ 旧的 :has(.oct-lo) 贴底规则已删；点改为排在数码**正下方**（.jp-g 纵向 + order）");
  ok(!/\.arg-lyric-pit:has\(\.oct-(mid|lo)\)/.test(src),
    "★★ 编排页旧三档槽位已删（与主视图同一口径：数码居中 + 点在正上/正下）");
  ok(/\.lyric-chip \.lyric-pit\{[^}]*left:calc\(2px \* var\(--cs,1\)\)/.test(src),
    "★★ 词块左内缩 6px（随 --cs 缩放；字号 11→14 后按 0.43em 同步）——用户口径③「音符贴近左边缘」的修法");
  ok(/\.arg-lyric-chip \.arg-lyric-pit\{[^}]*left:3px/.test(src),
    "★★ 编排页左内缩 3px = 视觉 5px（2px 透明边框吃在包含块外）——两页逐位对齐");
  ok(!/\.jp-g\.pitch-col \.jp-dots/.test(src), "★★ 降级① 已退役：.jp-g.pitch-col 规则删掉——点回纵向后不再需要（v3.38.1 补3）");

  ok(!/\.jp-g\.pitch-num-only \.jp-dots/.test(src), "★★ 降级② 已退役：.jp-g.pitch-num-only 规则删掉（同批退役）");

  ok(!/\.jp-body\{[^}]*transform/.test(src),
    "★★ .jp-body 的 --oct 位移已删（点不再在上/下，那位移只会把数码推离槽位）");
  ok(/g\.style\.setProperty\("--oct"/.test(src),
    "★ 但 --oct 仍写入：它是 t226 钉住的读数口，删了会让那条断言变成假绿");
  ok(/function pitchFitClass\(cellPx, parts\)\{[^}]*if \(!\(cellPx > 0\) \|\| !parts\) return ""/.test(src),
    "★★ 降级判据仍是纯函数、显式放行「量不到宽 / 无部件」（v3.38.1 补3：旧两档退役，函数保留）");
  ok(/^\.lyric-char\{[^}]*left:calc\(26px \* var\(--cs,1\)\)[^}]*right:auto[^}]*bottom:1px[^}]*text-align:left/m.test(src),
    "★★ 基础 .lyric-char = 歌词字**靠左**（v3.38.1 补9：left 26px·--cs / right:auto / bottom 1px / text-align:left）——与音名档统一；字锚在音符区之后、右边整段留给时值。旧「字心 clamp」随补6 退役，t149/t154/t178 钉着。\n       行首锚定是必须的：notechip 的覆写选择器里也含 .lyric-char{，不锚会把覆写当成基础规则（假绿）");

/* ============ T227g：新几何源码钉（点位置 / 点字号 / 字右下 / nm 名右字左 / nm 隐藏判据） ============ */
section("T227g 新几何源码钉 · 点贴头右/脚左 · 点字号 .4em · 字右下 · nm 名右字左");
{
  /* ★ 为什么这几条必须是**具名断言**：反向验证（tools/reverse-verify-v3381.py 的 M22–M34）
     把每条口径逐个变异回退，靠的正是"有名字的断言变红"这一条证据。
     规则只写在 CSS 里而不落断言，变异就抓不住——上一轮就是这么放过「名压字」的。 */
  ok(/\.jp-dots\.hi\{left:100%;top:0\}/.test(src),
    "★★★ 高音点贴数码**头部右侧**（.jp-dots.hi{left:100%;top:0}）——「上=高」的方向语义由「头右 / 脚左」保留");
  /* ★★★ v3.38.1 补8（用户口径）：低音点 = **数码正下方偏左**（left:0 = 与数码左缘齐、top:100% = 从数码底往下长）。
     旧的 right:100% 会让点伸进左侧邻居、压住小节竖线（用户实拍点名）。 */
  ok(/\.jp-dots\.lo\{left:0;top:100%\}/.test(src),
    "★★★ 低音点挂**数码正下方偏左**（.jp-dots.lo{left:0;top:100%}）——不再向左伸出、不压小节竖线");
  /* 点向下生长 ⇒ 2 颗低音点时整枚缩一档（16→13px），否则点底越出 26px 格（真机实测 28.4） */
  ok(/\.lyric-chip \.lyric-pit:has\(\.jp-dots\.lo i \+ i\)\{font-size:min\(calc\(12px \* var\(--cs,1\)\),13px\)\}/.test(src),
    "★★ 2 颗及以上低音点 ⇒ 整枚缩一档（16→13px），点底才落在格内（真机：点底 22.5 ⊂ 格底 26）");
  ok(/\.jp-dots\{position:absolute;[^}]*font-size:\.4em/.test(src),
    "★★ 点字号 .4em（14px 基准 ⇒ 5.6px）：放大就越出 26px 格的高度带（smoke 真机闸钉着同一条）");
  ok(/\.jp-g\{display:inline-flex;align-items:center;line-height:1;vertical-align:baseline;position:relative\}/.test(src),
    "★★ 数字**居中**（align-items:center）——点用绝对定位脱离布局，所以 glyph 高 = 数字字身");
  ok(/\.lyric-chip:not\(\.notechip\):has\(\.pit-nm\) \.lyric-char\{right:auto;text-align:left\}/.test(src),
    "★★★ nm 档歌词字**靠左**（right:auto）——本轮的「字右下」把它推到右端后与右对齐的音名逐像素重叠，这条正是修法落点");
  ok(/\.lyric-chip:has\(\.pit-nm\) \.lyric-pit\{left:auto;right:calc\(6px \* var\(--cs,1\)\)\}/.test(src),
    "★★ nm 档音名**靠右**（与靠左的字各占一侧）");
  ok(/const NM_CHAR_RESERVE = 46;/.test(src),
    "★★ 歌词字占地常量 = 46（左内缩 26cs + 字身 14cs + 间隙；旧值 30 属「字心居中 25%」时代）");
  ok(/return cellPx < need \+ \(reserve \|\| 0\);/.test(src),
    "★★★ nm 不相交判据是**加法**（名字宽 + 字占地 ≤ 格宽）——不再用 0.75·W 那个字心模型");
  const { beat } = loadApp();
  eq(beat.nmMarkHidden(172, 2, "sharp", 46), false, "★★ 宽格 172px ⇒ 音名照画（不相交条件成立）");
  eq(beat.nmMarkHidden(43, 2, "sharp", 46), true,
    "★★★ 窄格 43px（< 6 + 2×6.9 + 46 = 65.8）⇒ 音名整枚不画——宁可少画一层，也不画到字上");
  eq(beat.nmMarkHidden(66, 2, "sharp", 46), false, "★ 恰好过线（66 > 65.8）⇒ 画");
  /* ★★ 上面几条是**纯函数直调**（reserve 由测试自己传）。常量 NM_CHAR_RESERVE 本身还要走
     一次**真实路径**才算被守住——mkPitchMarkEl 在 nm 档就是用这个常量当 reserve 的。
     没有这一条时：把常量改成 0，纯函数那几条照旧全绿（它们传的是字面量 46），
     反向验证的 M27 就抓不住（实测：只红了一条源码钉，属假证据）。 */
  const nmChip = beat.mkPitchMarkEl({ kind: "pitch", seq: [{ p: 60 }] }, "nm", "", "lyric-pit", 43);
  ok(nmChip === null,
    "★★★ 词块 43px 格（< 常量 46 + 需求 19.8 = 65.8）⇒ 音名**整枚不画**（走 NM_CHAR_RESERVE 那条真实路径）");
  const nmWide = beat.mkPitchMarkEl({ kind: "pitch", seq: [{ p: 60 }] }, "nm", "", "lyric-pit", 172);
  ok(nmWide !== null && nmWide.textContent === "C4", "★★ 172px 格 ⇒ 音名照画 C4（同一路径的另一侧）");
  eq(beat.nmMarkHidden(10, 2, "sharp", 0), true, "★ 独立音符块（无 reserve）：窄到装不下名字才隐藏（口径不变）");
  eq(beat.nmMarkHidden(30, 2, "sharp", 0), false, "★ 独立音符块：30px 放得下 C4（需求 19.8px）");
}
}
