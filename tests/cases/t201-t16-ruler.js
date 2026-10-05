/* BeatSight 自动化测试 · 十六分刻度尺的型级显隐（v3.33.15）
   T201 系列。
   ---------------------------------------------------------------------------
   用户拍板口径：「以当前节奏型的最小单位为准——最小单位是八分就不画十六分线；
   八分与十六分混排就画，用来统一参考。」

   落成**一条**可执行判据（数据区 needsT16Ruler，与 hasStrum 同处、__beat 直出）：
     该型每个时值都是八分（T8 = 24t）的整数倍 ⇒ 十六分网格描述不了它 ⇒ 不画；否则画。

   ★ 为什么不是「最小单位 < 八分」（T201a 最后几条专门钉这个反例）：
     附点八分 = 36t = 1.5 个八分，最小单位比八分**大**，可它的边界落在奇数十六分位上
     （36 = 3×T16），八分网格根本描述不了它。「最小单位」口径在「附点八分 + 八分」混排上
     会把最小单位读成八分 ⇒ 误判成"不画"，恰好在最需要参考尺的时候把它丢掉。

   ★ 不画时**元素必须保留**（T201b）：.sub 同时是「每跑完一个十六分闪一次」的动画目标
     （paintBeatFlash 读 subEls[fb][fk]，动画改的是 boxShadow / backgroundColor，与边框无关），
     删节点 = 砍掉十六分级播放反馈——那是功能面收缩，不是纯视觉。显隐只落在 border 那一条线上。

   ★ v3.33.24「撞箭头让位」已整体退役（T201d/T201e 由"钉让位"改为"钉照画"）：刻度线只按
     型的最小单位显隐，与有没有箭头无关。原让位说明留档：扫弦箭头按定义钉在**格中心**，而 nSub 为偶数时刻度边界也在格中心，
     两者逐像素同位——正是用户报的「八分音符中间多出一条小竖线，与扫弦箭头部分重合」。
     ★ 主视图与编排页的**下标口径差 1**（主视图线是 .sub 的 border-right ⇒ 中心属第 nSub/2−1 个；
       编排页把节点直接摆在边界位置上且含左缘 ⇒ 中心是 u = nSub/2），T201d/T201e 各钉一侧。

   ★ 编排页 .arg-pat-sub 与主视图共用**同一份**判据（T201e），不产生第二处口径。
   ★ 编辑器头部结构（T201f，源码钉）：引用提示已从顶栏第三个 flex 子项移到栏下独立一行。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const src = html;
const walk = (el, out) => { out.push(el); (el.children || []).forEach(c => walk(c, out)); return out; };
const cls = (el, c) => !!(el && el.className) && new RegExp("(^| )" + c + "( |$)").test(el.className);
const allOf = (root, c) => walk(root, []).filter(e => cls(e, c));
const rep = (n, s) => Array.from({ length: n }, () => ({ ...s }));

/** 导入一个自定义型并选中它（停机态重建网格），返回 { beat, els } */
function selectPattern(bars, name){
  const app = loadApp();
  const { beat, els } = app;
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name, meter: 4, bars }] })), name + "：素材型导入成功");
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();     // 停机态：applyPatternChange → buildViz
  return { beat, els };
}

/* ============ 场景 T201a：判据纯函数（__beat 直出，不依赖 DOM） ============ */
section("T201a needsT16Ruler · 「是否为八分的整数倍」矩阵（含最小单位口径的反例）");
{
  const { beat } = loadApp();
  const P = bar => ({ meter: 4, bars: [bar] });

  eq(beat.needsT16Ruler(P(rep(8, { t: 24 }))), false,
     "★ 全八分 ⇒ 不画（用户口径的正面场景：最小单位就是八分）");
  eq(beat.needsT16Ruler(P(rep(4, { t: 48 }))), false, "全四分 ⇒ 不画（48 = 2×24）");
  eq(beat.needsT16Ruler(P(rep(2, { t: 96 }))), false, "全二分 ⇒ 不画（96 = 4×24）");
  eq(beat.needsT16Ruler(P(rep(2, { t: 72 }))), false, "全附点四分 ⇒ 不画（72 = 3×24）");
  eq(beat.needsT16Ruler(P([{ t: 24 }, { t: 24 }, { t: 48 }, { t: 96 }])), false,
     "八分 / 四分 / 二分混排 ⇒ 仍不画（全是 24 的整数倍，八分网格足够）");

  eq(beat.needsT16Ruler(P(rep(16, { t: 12 }))), true, "★ 全十六分 ⇒ 画");
  eq(beat.needsT16Ruler(P([{ t: 24 }, { t: 12 }, { t: 12 }, { t: 24 }, { t: 12 }, { t: 12 },
    { t: 24 }, { t: 12 }, { t: 12 }, { t: 24 }, { t: 12 }, { t: 12 }])), true,
     "★ 八分与十六分混排 ⇒ 画（用户口径的正面场景）");

  eq(beat.needsT16Ruler(P(rep(4, { t: 36 }))), true,
     "★ 全附点八分 ⇒ 画（36t = 1.5 个八分，边界落在奇数十六分位上）");
  eq(beat.needsT16Ruler(P([{ t: 36 }, { t: 24 }, { t: 36 }, { t: 24 }, { t: 36 }, { t: 24 }])), true,
     "★★ 附点八分 + 八分混排 ⇒ 画——这条正是「最小单位 ≥ 八分就不画」口径会漏判的反例：" +
     "该型最小单位读出来就是八分，但附点八分的边界八分网格描述不了");
  eq(beat.needsT16Ruler(P(rep(6, { t: 16 }))), true, "八分三连（16t，不是 24 的整数倍）⇒ 画");
  eq(beat.needsT16Ruler(P(rep(4, { t: 6 }))), true, "三十二分 ⇒ 画");
  eq(beat.needsT16Ruler(P([{ t: 24 }, { t: 36, rest: true }, { t: 24 }, { t: 24 }])), true,
     "★ 休止同样计入：休止也是网格的一部分（36t 的休止照样要十六分尺）");

  eq(beat.needsT16Ruler(null), true,
     "★ 结构坏了拿不准 ⇒ 保守返回 true（宁可多画一条参考线，也不静默少画）");
  eq(beat.needsT16Ruler({ meter: 4 }), true, "缺 bars ⇒ 同上（保守 true）");
}

/* ============ 场景 T201b：主视图 · 不画线，但元素一个不少 ============ */
section("T201b 主视图 · 全八分：不画刻度线，.sub 元素恒在（闪烁目标不丢）");
{
  const { els } = selectPattern([rep(8, { t: 24 })], "T201 全八分");
  const cells = allOf(els["viz"], "cell");
  ok(cells.length > 0, "前提：网格已建出格子（没有格子时下面的取值无意义）");
  const c0 = cells[0];
  const subsBox = allOf(c0, "subs");
  eq(subsBox.length, 1, "该格恰一个 .subs 容器");
  ok(cls(subsBox[0], "t16-off"), "★ .subs 带 .t16-off ⇒ 该型不需要十六分尺（不画线）");
  eq(allOf(c0, "sub").length, 2,
     "★ 八分格仍有 2 个 .sub 元素——元素恒建，闪烁目标一个不少（显隐只落在 border 上）");
  eq(allOf(c0, "collide").length, 0, "纯节拍型没有箭头 ⇒ 无 .collide");
  eq(cells.filter(c => !cls(allOf(c, "subs")[0], "t16-off")).length, 0,
     "★ 整条网格一致（判据是型级的，不会一行画一行不画）");
}

/* ============ 场景 T201c：主视图 · 混排 ⇒ 画线 ============ */
section("T201c 主视图 · 八分与十六分混排：照画（无箭头的对照组）");
{
  const bars = [[{ t: 24 }, { t: 12 }, { t: 12 }, { t: 24 }, { t: 12 }, { t: 12 },
    { t: 24 }, { t: 12 }, { t: 12 }, { t: 24 }, { t: 12 }, { t: 12 }]];
  const { els } = selectPattern(bars, "T201 混排");
  const subsBox = allOf(els["viz"], "subs");
  ok(subsBox.length > 0, "前提：.subs 容器在");
  eq(subsBox.filter(s => cls(s, "t16-off")).length, 0, "★ 含十六分 ⇒ 需要尺 ⇒ 一个 .t16-off 都没有");
  const cells = allOf(els["viz"], "cell");
  const eighthCells = cells.filter(c => allOf(c, "sub").length === 2);
  ok(eighthCells.length > 0, "前提：有 nSub=2 的八分格");
  eq(allOf(els["viz"], "collide").length, 0,
     "★ 不带方向 ⇒ hasStr 假 ⇒ 无箭头可撞 ⇒ 中心那条刻度照画");
}

/* ============ 场景 T201d：带方向的格也必须画中心刻度（v3.33.24 归因更正） ============ */
section("T201d 主视图 · 带方向的八分格：中心那条刻度**照画**（不因扫弦箭头让位）");
{
  /* ★★ 归因更正（用户澄清）：需求从头到尾只有一条——「十六分刻度线不要出现在**最小单位为八分**
     的节奏型里」。`collide`（撞箭头让位）是我自己加的"兜底"，用户从未要求，且它的代价是
     **删掉八分格里的那条分界线**（那正是八分格内部两个十六分的分界，用户要看的就是它）。
     故本场景由"钉让位"改为"钉照画"。 */
  const bars = [[{ t: 24, dir: "D" }, { t: 12 }, { t: 12 }, { t: 24, dir: "U" }, { t: 12 }, { t: 12 },
    { t: 24, dir: "D" }, { t: 12 }, { t: 12 }, { t: 24, dir: "U" }, { t: 12 }, { t: 12 }]];
  const { beat, els } = selectPattern(bars, "T201 混排带方向");
  eq(beat.needsT16Ruler(beat.curPattern()), true, "前提：该型需要十六分尺（含十六分 ⇒ 不 t16-off）");
  const cells = allOf(els["viz"], "cell");
  const eighthCells = cells.filter(c => allOf(c, "sub").length === 2);
  ok(eighthCells.length > 0, "前提：有 nSub=2 的八分格");
  eq(allOf(els["viz"], "collide").length, 0,
     "★★ 全行零 .collide：带方向的八分格，中心那条刻度**必须照画**（改前为 8 个让位 ⇒ 红线）");
  eq(eighthCells.every(c => allOf(c, "sub").length === 2), true,
     "★ 八分格的 .sub 元素一个不少（只谈线的显隐，绝不删元素——闪烁目标不能丢）");
}

/* ============ 场景 T201e：编排页 · 与主视图共用同一份判据 ============ */
section("T201e 编排页块内刻度 · 同一判据（不画 / 画 / 让位，下标口径 = nSub/2）");
{
  /** 建「一个块的曲式 + 贴词 + 展开」夹具，返回该块的 .arg-pat-bar */
  function arrangePatBar(bars, name){
    const app = loadApp();
    const { beat, els } = app;
    ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name, meter: 4, bars }] })), name + "：导入");
    const id = beat.Store.customs[beat.Store.customs.length - 1].id;
    ok(beat.Store.upsertArrange({ name: "刻度曲式 · " + name, sections: [
      { name: "段", blocks: [{ ref: { type: "custom", id }, repeats: 1 }] },
    ] }), name + "：曲式落库");
    const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
    beat.Store.upsertLyric(arr.id, arr.sections[0].uid, [{ t: 0, dur: 48, ch: "一" }]);
    beat.Store.deleteArrange(beat.DEMO_ID);
    beat.Arrange.open();
    const ly = els["argSections"].children[0].children
      .find(c => /(^| )arg-lyric( |$)/.test(c.className));
    ok(!!ly, name + "：段行在");
    const sum = ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));
    ok(!!sum, name + "：摘要行在");
    sum.fire("click");                                   // 展开 → arrangeRender 会**整树重建**
    /* ★ 展开后必须**重新取**：arrangeRender() 重建段 DOM，点击前拿到的 ly 已成冻结值
       （读旧引用＝读展开前的树，恒找不到 lane——初版就栽在这，报"歌词轨不在"）。 */
    const ly2 = els["argSections"].children[0].children
      .find(c => /(^| )arg-lyric( |$)/.test(c.className));
    ok(!!ly2, name + "：展开后段元素重取到");
    const lane = ly2.children.find(c => /(^| )arg-lyric-lane( |$)/.test(c.className));
    ok(!!lane, name + "：歌词轨在（展开态才有）");
    const patRow = lane.children.find(c => /(^| )arg-pat-row( |$)/.test(c.className));
    ok(!!patRow, name + "：块头行在");
    return patRow.children[1];                           // 右列 = .arg-pat-bar
  }

  const bar8 = arrangePatBar([rep(8, { t: 24 })], "T201e 全八分");
  ok(allOf(bar8, "arg-pat-cell").length > 0, "前提：时值块在");
  eq(allOf(bar8, "arg-pat-sub").length, 0,
     "★ 全八分 ⇒ 编排页同样不画块内刻度（与主视图同一判据，不是第二处口径）");

  const mix = arrangePatBar([[{ t: 24, dir: "D" }, { t: 12 }, { t: 12 }, { t: 24, dir: "U" }, { t: 12 }, { t: 12 },
    { t: 24, dir: "D" }, { t: 12 }, { t: 12 }, { t: 24, dir: "U" }, { t: 12 }, { t: 12 }]], "T201e 混排带方向");
  ok(allOf(mix, "arg-pat-sub").length > 0, "★ 含十六分 ⇒ 编排页画块内刻度");
  /* 本处节点**摆在边界位置上且含块左缘**（u = 0 起），故每格节点数 = nSub。
     ★ v3.33.24：撞箭头让位已退役 ⇒ 八分格保留 **2 条**（u=0 左缘 + u=1 中心）。
       八分格中心那条正是它内部两个十六分的分界——用户要看的就是它。 */
  const cells = allOf(mix, "arg-pat-cell");
  const perCell = cells.map(c => allOf(c, "arg-pat-sub").length);
  eq(perCell.join(","), "2,1,1,2,1,1,2,1,1,2,1,1",
     "★★ 带方向也照画：4 个八分格各 2 条（左缘 + 中心），8 个十六分格各 1 条（改前八分格被让位只剩 1 条）");
  eq(perCell.filter(n => n === 2).length, 4,
     "★ 恰好 4 个八分格保留 2 条 ⇒ 与主视图同一事实（不是第二处口径）");
  const eighthCells = cells.filter(c => c.style.width === "12.5%");      // 24/192
  const sixCells = cells.filter(c => c.style.width === "6.25%");         // 12/192
  eq(eighthCells.length, 4, "前提：4 个八分格");
  eq(sixCells.length, 8, "前提：8 个十六分格");
  eq(eighthCells.map(c => allOf(c, "arg-pat-sub")[0].style.left).join(","), "0%,0%,0%,0%",
     "★ 被让位的是**格中心**那条（50%），左缘那条（u=0）保留——让位不是把整格刻度删掉");

  const barNoStr = arrangePatBar([[{ t: 24 }, { t: 12 }, { t: 12 }, { t: 24 }, { t: 12 }, { t: 12 },
    { t: 24 }, { t: 12 }, { t: 12 }, { t: 24 }, { t: 12 }, { t: 12 }]], "T201e 混排无方向");
  const cellsNS = allOf(barNoStr, "arg-pat-cell");
  eq(cellsNS.map(c => allOf(c, "arg-pat-sub").length).join(","), "2,1,1,2,1,1,2,1,1,2,1,1",
     "★ 对照组：同构成但不带方向 ⇒ 无箭头可撞 ⇒ 八分格 2 条全在（让位确由箭头触发，不是无差别砍线）");
}

/* ============ 场景 T201f：编辑器头部结构（源码钉） ============ */
section("T201f 编辑器头部 · 引用提示移出顶栏（源码钉）+ 两条 CSS 不变量");
{
  /* 按 div 嵌套求某个 `<div` 的配对 `</div>` 之后的位置——比"找下一个 <div class="card">"
     稳：提示元素正落在"顶栏收尾"与"下方卡片"**之间**，用后者当边界会把它一起圈进来。 */
  function endOfDiv(s, start){
    let depth = 0, i = start;
    while (i < s.length){
      const open = s.indexOf("<div", i), close = s.indexOf("</div>", i);
      if (close < 0) return -1;
      if (open >= 0 && open < close){ depth++; i = open + 4; }
      else { depth--; if (depth === 0) return close + 6; i = close + 6; }
    }
    return -1;
  }
  const iTop = src.indexOf('<div class="editor-topbar">');
  const iRef = src.indexOf('id="editorRefNote"');
  const iActions = src.indexOf('<div class="editor-actions">', iTop);
  const iCard = src.indexOf('<div class="card">', iTop);
  ok(iTop >= 0 && iRef >= 0 && iActions > iTop && iCard > iTop,
     "前提：顶栏 / 操作区 / 提示 / 下方卡片四处锚点都能定位");
  const topEnd = endOfDiv(src, iTop);
  ok(topEnd > iTop, "前提：顶栏的配对 </div> 能算出来");
  const topbar = src.slice(iTop, topEnd);
  ok(!/id="editorRefNote"/.test(topbar),
     "★ 引用提示已**不在** .editor-topbar 内（不再是那个把顶栏挤爆的第三个 flex 子项）");
  ok(iRef > topEnd && iRef < iCard,
     "★ 提示落在「顶栏收尾」与「下方卡片」之间 ⇒ 确实搬到栏下独立成行，且没有掉出编辑器");
  ok(iRef > iActions, "★ 顺序：提示排在 .editor-actions（试听 / 保存为预设）之后");

  ok(/\.editor-actions\{display:flex;gap:10px;flex:none\}/.test(src),
     "★ CSS 不变量：.editor-actions 的 flex:none **提为全局**（原先只在 ≤640px 媒体查询里，中宽失效）");
  ok(/#editorRefNote:empty\{display:none\}/.test(src),
     "★ CSS：提示为空时不占位（默认状态就是空——不该因此多吃掉一段高度）");
  ok(/\.cell \.subs\.t16-off \.sub\{border-right:none\}/.test(src),
     "★ CSS：只按「型的最小单位」显隐（只去 border-right，元素保留 ⇒ 闪烁目标不丢）");
  ok(!/\.sub\.collide\{/.test(src) && !/" collide"/.test(src) && !/u === nSub \/ 2\) continue/.test(src),
     "★★ v3.33.24：collide 三处落点全清（CSS 规则 / 主视图挂类 / 编排页跳格）——非用户需求，且会删掉八分格内的十六分分界线");
}
