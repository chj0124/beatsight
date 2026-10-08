/* BeatSight 自动化测试 · 歌词字块的**时间序**邻居判据（v3.33.16）
   T202 系列。
   ---------------------------------------------------------------------------
   用户实报：「这几块不能移动的字符，都是从前面移动到后面的；但移动到后面之后，就移不回去了。」

   根因：`chars` 的顺序是**粘贴顺序**，不是时间序。把某个字拖/微调到别的字之后，下标序与
   时间序就分道扬镳；此时「按下标取邻居」会算出 **min > cap 的反转区间**，钳制
   `Math.max(min, Math.min(max, …))` 塌缩成恒等于 min —— 若该字恰好落在 min 上，
   `if (t === c.t) return` 直接返回，字块**被钉死**（左右都推不动）。

   本批把五个入口收成一份判据 `lyricNeighbors`（键盘微调 / 拖动钳制 / 拖动时值上限 /
   落点与换位判定 / ⇄ 显性换位 / 整段平移），T202 逐个钉住。
   ★ 只测「能不能动」是不够的：还要钉「动的对象对不对」——换位必须换**时间上**的后邻，
     而不是下标 +1 那个（字被移动过之后它可能在左边）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const src = html;
const C = (t, ch, dur) => ({ t, dur: dur === undefined ? 24 : dur, ch });

/* 用户那一态的等价夹具：把「能」「不」从前面搬到后面后的数组（**粘贴顺序不变**）。
   [我(0) 能(120) 不(144) 分(72)] —— 「不」的下标是 2，下标后邻 chars[3] 是「分」(t=72)，
   时间上却在它**左边**：这正是反转区间的来源。 */
const USER = [C(0, "我"), C(120, "能"), C(144, "不"), C(72, "分")];
const SPAN = 192;

/* ============ 场景 T202a：时间序邻居 ============ */
section("T202a lyricNeighbors · 时间序前后邻居与合法区间");
{
  const { beat } = loadApp();
  const nb = beat.Arrange.lyricNeighbors(USER, 2, 24, SPAN);   // 「不」
  eq(nb.min, 144, "左界 = 时间上在它左边、末点最靠右那个字（「能」144）的末点");
  eq(nb.max, 168, "★ 右界 = 段末 − 时值（时间上右边没人）——不是被下标后邻「分」压成 144");
  ok(nb.max > nb.min,
     "★★ 区间非退化（max > min）：这就是「字块能动了」的判据——反转区间会塌缩成 max === min");
  eq(nb.prevK, 1, "★ 前邻下标 = 「能」(1)：按时间取，不是按下标 k−1");
  eq(nb.nextK, -1, "★ 后邻 = 无（时间上右边没人）——按下标取会错认成「分」(3)");

  /* 下标口径的旧算法在这个夹具上必然塌缩：min=144、cap=min(168, 72−24)=48 ⇒ max=max(144,48)=144
     —— 与 c.t 相等 ⇒ `if (t === c.t) return` 钉死。这里把「旧算法会给出什么」显式算一遍，
     让断言读起来就是那条 bug 的形状。 */
  const oldMin = USER[1].t + USER[1].dur;                       // 144
  const oldCap = Math.min(SPAN - 24, USER[3].t - 24);           // 48
  const oldMax = Math.max(oldMin, oldCap);                      // 144
  ok(oldMax === USER[2].t && oldMax === oldMin,
     "★ 前提：旧算法（按下标）确实算出 max === c.t === " + oldMax + " ⇒ 用户报的「钉死」可复现");
  ok(nb.max !== oldMax,
     "★★ 新判据的 max（" + nb.max + "）不等于旧算法的 max（" + oldMax + "）⇒ 钉死已解除");
}

/* ============ 场景 T202b：不变量 · 任意布局下区间不反转 ============ */
section("T202b 不变量 · 打乱时间序后每个字的区间都不反转");
{
  const { beat } = loadApp();
  const layouts = [
    [C(0, "a"), C(24, "b"), C(48, "c")],                 // 原始顺序
    [C(96, "a"), C(0, "b"), C(48, "c")],                 // a 跑到最后
    [C(96, "a"), C(0, "b"), C(168, "c")],                // 散开
    [C(168, "c"), C(120, "b"), C(0, "a")],               // 完全倒序（下标序与时间序相反）
    [C(0, "a"), C(48, "b"), C(24, "c"), C(72, "d")],     // b/c 交叉
  ];
  let bad = 0, pinned = 0;
  for (const chars of layouts){
    for (let k = 0; k < chars.length; k++){
      const nb = beat.Arrange.lyricNeighbors(chars, k, chars[k].dur, SPAN);
      if (!(nb.max >= nb.min)) bad++;
      /* 塌缩（max === min）且字不在区间内 = 左右都推不动，正是用户症状 */
      if (nb.max === nb.min && nb.min !== chars[k].t) pinned++;
    }
  }
  eq(bad, 0, "★★ 任何布局下 max >= min（区间永不反转）");
  eq(pinned, 0, "★★ 没有「塌缩且把字钉在区间外」的形态（旧算法在这一组里会大量产生）");
}

/* ============ 场景 T202c：⇄ 与后字换位 = 换**时间上**的后邻 ============ */
section("T202c swapChars · 换的对象是时间上的后邻，不是下标 +1");
{
  const { beat } = loadApp();
  /* 「分」(下标 3，t=72)：时间上的后邻是「能」(下标 1，t=120) —— 下标 4 越界 */
  const out = beat.Arrange.swapChars(USER, 3);
  ok(out !== null, "★ 换位成功（旧实现按 k+1=4 越界返回 null ⇒ 这一格根本换不动）");
  if (out){
    eq(out[3].t, 120, "★ 「分」拿到了时间后邻「能」的 t");
    eq(out[1].t, 72, "★ 「能」拿到了「分」的 t");
    eq(out[3].ch, "分", "字随索引位不动（只换时序）");
    eq(out[1].ch, "能", "同上");
  }
  /* 时间序最后一个字（「不」t=144）右边没人 ⇒ 无可换 */
  eq(beat.Arrange.swapChars(USER, 2), null, "★ 时间序最后一个字：右边无人可换 ⇒ null（不是静默换错人）");
  eq(beat.Arrange.swapChars(USER, 99), null, "越界 ⇒ null");
}

/* ============ 场景 T202d：拖拽落点 · 向左推过半程 = 与前邻换位 ============ */
section("T202d getDropTarget · 向左推过时间前邻的半程 ⇒ 与前邻换位（重排回得去）");
{
  const { beat } = loadApp();
  /* 「分」(下标 3, t=72) 向左推：时间前邻是「我」(下标 0, t=0)，overL 30 ≥ 24/2 */
  const d = { mode: "move", k: 3, t0: 72, d0: 24, t: 72, d: 24,
    overR: 0, overL: 30, magnet: -1, chars: USER, lctx: { span: SPAN } };
  const r = beat.Arrange.getDropTarget(d);
  eq(r.swap, -1, "★ 判定为「与前邻换位」（旧实现按下标取前邻=「不」，换错对象）");
  eq(r.t, 0, "落点 = 时间前邻「我」的 t");
}

/* ============ 场景 T202e：源码钉 · 五个入口共用同一份判据 ============ */
section("T202e 源码钉 · 五个入口都走 lyricNeighbors，不再有下标式邻居查找");
{
  ok((src.match(/lyricNeighbors\(/g) || []).length >= 5,
     "★ lyricNeighbors 至少被 5 处调用（键盘微调 / 拖动钳制 / 拖动时值上限 / 落点与换位 / 定义处）");
  const idxLookups = (src.match(/chars\[(d\.)?k - 1\]|chars\[(d\.)?k \+ 1\]/g) || []).length;
  eq(idxLookups, 0,
     "★★ 全文件再无「按下标取邻居」的写法（chars[k−1] / chars[k+1] / chars[d.k±1]）——" +
     "留一处就是同一 bug 换入口复发");
  ok(/function lyricNeighbors\(chars, k, dur, span\)\{/.test(src), "★ 判据函数在（单一来源）");
}

/* ============ 场景 T202f：整段平移「从选中字起」= 时间序，不是下标序 ============ */
section("T202f shiftLyricChars · 「从选中字起」的范围按时间序（同一病根的第二处）");
{
  const { beat } = loadApp();
  /* 同一夹具：下标 3 是「分」(t=72)。按下标 = 只动「分」一个；
     按时间 = 应动 t ≥ 72 的全部三个（能 120 / 不 144 / 分 72），「我」(t=0) 不动。 */
  const out = beat.Arrange.shiftLyricChars(USER, 3, 24, SPAN);
  ok(out !== null, "前提：位移不为 0");
  if (out){
    eq(out[3].t, 96, "「分」自己动了（两种口径一致）");
    eq(out[1].t, 144, "★ 「能」也跟着动了 —— 按下标口径它**不在范围里**（旧值 120）");
    eq(out[2].t, 168, "★ 「不」也跟着动了（旧值 144）");
    eq(out[0].t, 0, "「我」(t=0 < 72) 不在范围内，纹丝不动");
    eq(out.map(c => c.ch).join(""), "我能不分", "★ 输出保持**数组原序**（只改时序，不动下标位）");
  }
  /* 未被移动过的行：两种口径必须逐位等价（正常路径零行为变化） */
  const ordered = [C(0, "a"), C(24, "b"), C(48, "c")];
  const o2 = beat.Arrange.shiftLyricChars(ordered, 1, 12, SPAN);
  eq(o2 && o2.map(c => c.t).join(","), "0,36,60", "★ 下标序 = 时间序时，与旧口径逐位一致（0,36,60）");
}

/* ============ 场景 T202g：换位**落库**必须选对那一对（v3.33.17 的真实病根） ============ */
section("T202g 换位落库 · 向左换要传「时间前邻下标」，不是下标的左邻");
{
  const { beat } = loadApp();
  /* 下标序 ≠ 时间序：B 被挪到了 C 后面（数组仍保持粘贴顺序 A,B,C,D） */
  const chars = [C(0, "A"), C(48, "B"), C(24, "C"), C(72, "D")];
  const nb = beat.Arrange.lyricNeighbors(chars, 1, 24, SPAN);      // B
  eq(nb.prevK, 2, "★ B 的时间前邻是「C」(下标 2)——不是下标的左邻「A」(下标 0)");
  const right = beat.Arrange.swapChars(chars, nb.prevK);
  ok(right !== null, "前提：可换");
  eq(right[1].t, 24, "★ 正确的一对：B 拿到 24（走到 C 原来的位置）");
  eq(right[2].t, 48, "★ 正确的一对：C 拿到 48");
  /* 旧写法 d.k-1 = 下标 0 ⇒ swapChars(A)：换的是 A 与 A 的**时间后邻**(C) —— 与用户意图无关 */
  const wrong = beat.Arrange.swapChars(chars, 0);
  eq(wrong[0].t, 24, "★ 对照：旧写法换的是「A」与「C」——换错了一对");
  eq(wrong[1].t, 48, "★★ 对照：B 纹丝不动 —— 这正是用户报的「移不回去」的形态");
  ok(/swapChars\(chars, prevIx\)/.test(src),
     "★★ 源码钉：落库改用 prevIx（时间前邻的下标）");
  ok(!/r\.swap === 1 \? d\.k : d\.k - 1/.test(src),
     "★★ 源码钉：`d.k - 1` 那种下标式写法已不存在");
  ok(/delta < 0 \? swapChars\(chars, j\) : swapChars\(chars, k\)/.test(src),
     "★ 源码钉：键盘微调挪不动时退化为时间邻字换位（满铺行里 ←/→ 不再恒为 no-op）");
}

/* ============ 场景 T202h：时值 ±1 格——绝不许把时值改坏 ============ */
section("T202h lyricDurStep · 时值±1格按时间后邻钳制（旧实现会缩到最短）");
{
  const { beat } = loadApp();
  /* 「不」(下标 2, t=144)：下标后邻 cs[3] 是「分」(t=72)，时间上在它**左边** */
  const plus = beat.Arrange.lyricDurStep(USER, 2, 1, SPAN);
  eq(plus, 30, "★ 时值+1格：八分(24) → 30（= 24 + 一格 6），**变长**");
  /* 旧实现：lim = cs[k+1].t = 72 ⇒ lim - c.t = 72 − 144 = −72 ⇒ 钳制链塌成 LYRIC_MIN_DUR */
  const oldLim = USER[3].t;                       // 72
  const oldDur = Math.max(12, Math.min(Math.min(128 * 48, oldLim - USER[2].t), 24 + 12));
  eq(oldDur, 12, "★★ 前提：旧实现算出 12 —— 即「时值+1格」反把时值**缩到最短的十六分**（改坏数据）");
  ok(plus !== oldDur, "★★ 新实现（" + plus + "）≠ 旧实现（" + oldDur + "）⇒ 改坏数据已消除");
  eq(beat.Arrange.lyricDurStep(USER, 2, -1, SPAN), 18, "时值−1格：24 → 18（正常缩短，下限 LYRIC_MIN_DUR）");
  /* 未被移动过的行：与旧口径逐位一致（正常路径零行为变化） */
  const tiled = [C(0, "a"), C(24, "b"), C(48, "c")];
  eq(beat.Arrange.lyricDurStep(tiled, 1, 1, SPAN), 24,
     "★ 满铺行里 +1格 仍为 24（紧贴后邻、无处可长）——与旧口径逐位一致，正常路径零行为变化");
  eq(beat.Arrange.lyricDurStep([C(0, "a"), C(96, "b")], 0, 1, SPAN), 30,
     "★ 有间隙的行：首字 24 → 30（后邻在 96，上限 96）");
  eq(beat.Arrange.lyricDurStep(USER, 99, 1, SPAN), null, "越界 ⇒ null");
}

/* ============ 场景 T202i：源码钉 —— 同类病根不许再藏在变量名后面 ============ */
section("T202i 源码钉 · 任何 X[k±1] 式下标邻居查找都不许存在");
{
  /* ★ v3.33.19：上一版的钉只匹配变量名 `chars`，于是 `cs[k + 1]` 从闸下漏了过去。
     现改为**不认变量名**：只要求「某标识符 [k ± 1]」这个形状不出现。 */
  /* ★ 先剥注释：上一版把**注释里举例的** `cs[k + 1].t` 也算成命中（假红）。
     再限定数组名集合 = 歌词字块实际用过的那些（chars / cs / list）——不认"当时那一个名字"，
     但也不把 `pos[k+1]` 这类无关数组网进来。 */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const anyIdx = code.match(/\b(chars|cs|list)\[\s*k\s*[-+]\s*1\s*\]/g) || [];
  eq(anyIdx.length, 0,
     "★★ 全文件再无 X[k±1] / X[d.k±1] 的**下标式邻居查找**（不认变量名——上一版正是栽在这）" +
     (anyIdx.length ? "，实际命中：" + anyIdx.join(" / ") : ""));
  ok(/function lyricDurStep\(chars, k, sign, span\)\{/.test(src),
     "★ 时值±1格 收进纯函数（内联就不可测——它藏了三个版本正是因为这个）");
  ok(/const dur = lyricDurStep\(cs, k, sign, span\);/.test(src), "★ 按钮回调确实走它");
  /* v3.33.18 行归属：真实矩形命中，而非「÷固定行高」 */
  ok(/row = rowOfY\(drag\.geo, ev\.clientY\);/.test(src), "★ 行归属走真实矩形命中");
  ok(!/Math\.floor\(\(ev\.clientY - drag\.geo\.top\) \/ drag\.geo\.rowH\)/.test(src),
     "★ 旧的「指针 Y ÷ 固定行高」写法已不存在");
  ok(/geo = \{ rects: rects \}/.test(src), "★ geo 存的是每行真实 top/bottom");
}

/* ============ 场景 T202j：手动拖动的磁吸目标集**含空扫**（v3.33.22，用户拍板） ============ */
section("T202j secOnsetTicks · 自动对齐仍排除空扫；手动拖动的锚点集含空扫");
{
  const { beat } = loadApp();
  /* 16 个十六分，其中下标 1/5/9/13 是「休止 + 方向」= 空扫 */
  const bar = [];
  for (let i = 0; i < 16; i++) bar.push(i % 4 === 1 ? { t: 12, rest: true, dir: "U" } : { t: 12, dir: "D" });
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "空扫夹具", meter: 4, bars: [bar] }] })), "素材型导入");
  const id = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "空扫曲式", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id }, repeats: 1 }] },
  ] }), "曲式落库");
  const sec = beat.Store.arranges[beat.Store.arranges.length - 1].sections[0];
  const auto = beat.Arrange.secOnsetTicks(sec);
  /* 夹具里仅下标 1/5/9/13 是空扫 ⇒ 其余 12 格发声；排除空扫后正好这 12 个 tick */
  eq(auto.join(","), "0,24,36,48,72,84,96,120,132,144,168,180",
     "★ 不传参（= 按节奏对齐用的原口径）仍**排除**空扫 ⇒ 16 格里只剩 12 个发声音");
  const manual = beat.Arrange.secOnsetTicks(sec, true);
  eq(manual.join(","), Array.from({ length: 16 }, (_, i) => i * 12).join(","),
     "★★ 传 true（= 手动拖动的磁吸集）**含空扫** ⇒ 16 格全在，字能停到空扫格上");
  ok(manual.length > auto.length, "★ 两者确实不同（否则等于没改）");
  ok(/drag\.anchors = secOnsetTicks\(secObj, true\);/.test(src),
     "★★ 源码钉：拖动的磁吸锚点集走 includeGhost 版本");
  ok(/if \(\(!s\.rest \|\| \(includeGhost && !!s\.dir\)\) && cum % LYRIC_GRID === 0\)/.test(src),
     "★ 源码钉：空扫（rest + dir）在 includeGhost 下计入落点");
}
