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

/* ============ T226b：mkJianpuGlyph（只建点号与数码，点挂**右侧**） ============ */
section("T226b mkJianpuGlyph · 八度点挂数码右侧 / 升号在数前（结构断言）");
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
  eq(kids(g1).length, 2, "★ 高八度：body + 点两个子节点（点挂右侧，故 body 在前）");
  eq(dotsCls(g1), "jp-dots hi", "★ 点在 body **之后**（右侧）、带 hi 标记（v3.38.1：点从数码上/下改到右侧）");
  eq(dotsTxt(g1), "●", "高八度 1 颗点（实心点）");
  eq(g1.textContent, "1●", "★ 聚合文本 = 数码 + 点（点序在数码后）");
  eq(g1.className, "jp-g oct-hi", "★★ 高八度配 oct-hi（用户口径③：高音暖色）");
  eq(g1.style["--oct"], "1", "★★ 高八度 --oct = 1（数码上移）");

  const g2 = beat.mkJianpuGlyph(beat.jianpuParts(84, 60));
  eq(dotsTxt(g2), "●●", "高两个八度 = 2 颗点");
  eq(g2.textContent, "1●●", "★ 聚合文本 = 数码 + 2 点");
  eq(g2.style["--oct"], "2", "★ 高两个八度 --oct = 2");

  const gb = beat.mkJianpuGlyph(beat.jianpuParts(36, 60));
  eq(kids(gb).length, 2, "★ 低八度：body + 点两个子节点");
  eq(dotsCls(gb), "jp-dots lo", "★ 低音点带 lo 标记（贴数码右下角）；低音本就「数码 + 点」，文本序不变");
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
  /* 用户报障「带高/低音标记的音符装不进格子」：独立音符块字号**固定收紧**（v3.38.1 起
     点不再占竖向，那两条"点距压紧"覆写已退役；字号固定仍是本块的口径） */
  ok(/\.lyric-chip\.notechip \.lyric-char\{[^}]*font-size:min\(calc\(14px/.test(src),
    "★★ 源码钉：主视图独立音符块字号 = 14px 档（v3.38.1 补：与词块记号同号，用户口径「只比歌词小一号」）");
  ok(/\.arg-lyric-chip\.notechip \.arg-lyric-char\{font-size:12px;line-height:\.85\}/.test(src),
    "★★ 源码钉：编排页独立音符块字号 12px（比主视图 14 小一档：本格只有约 20px 高）");
  ok(/\.lyric-chip\.notechip \.lyric-char\{[^}]*left:calc\(6px/.test(src),
    "★★ 源码钉：主视图独立音符块的谱字与词块**同一左内缩口径**（v3.38.1 用户口径③；字号抬到 14 后内缩同步 5→6）");
}
