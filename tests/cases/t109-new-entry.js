/* BeatSight 自动化测试 · v2.33.0：新建入口搬家 + 菜单点窗外即关 + 段卡片范围联动 + 候选标题
   T109 系列（设计稿遗漏补齐批次）。
   ---------------------------------------------------------------------------
   契约锚点：
     · 「＋ 新建」从顶栏搬进曲式库行（argLibRow 内、行尾；id=argNew 不变，样式改虚线胶囊）；
       顶栏 argActions 只剩曲式级 ⋯（静态标记源码级断言，同 t107d 口径）；
     · 模板菜单宿主 = argLibRow；**点窗外即关**（overlay 根上的 pointerdown，沿 parentNode
       上溯：命中触发钮 argNew 或菜单本体 arg-new-menu 则不关）——替代 v2.27.0 的
       "再点一次按钮 = 收起"toggle（用户实测"点了像没点、再点反而收起"的困惑）；
     · 展开时触发钮切 .open 高亮 + aria-expanded=true（"已展开"必须可见）；
     · 段卡片 ↔ 播放范围联动：范围覆盖段 .play-in-range（绿左条）、未覆盖段 .play-dim
       （降透明）；初挂在 buildSecRow、拖动中由 syncPanelRead 实时切（同一判据两处）；
     · 换型候选标题写明上下文：「换型：第 N 段 · 块 M」（原 P2-10 的另一半）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");
const fs = require("fs");
const path = require("path");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seed3 = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t109", name: "三段歌", sections: [
    { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
    { uid: "uB", name: "B段", blocks: [BL(1, 1)] },
    { uid: "uC", name: "C段", blocks: [BL(1, 1)] },
  ] },
]}) });
const rows = els => els["argSections"].children;
const moreBtn = (els, i) => Array.prototype.find.call(rows(els)[i].children[3].children,
  b => /更多段操作/.test(b.getAttribute("aria-label") || ""));
const menuOf = (els, i) => Array.prototype.find.call(rows(els)[i].children,
  c => /(^| )arg-sec-menu( |$)/.test(c.className));
const menuItem = (menu, re) => menu && Array.prototype.find.call(menu.children,
  b => re.test(b.getAttribute("aria-label") || ""));
const newMenuOf = els => els["argLibRow"].children.find(c => /(^| )arg-new-menu( |$)/.test(c.className));

/* ================= 场景 T109a：入口位置（静态标记源码级，同 t107d 口径） ================= */
section("T109a 入口搬家 · ＋ 在曲式库行内 / 顶栏不再有新建 / 触发态样式存在");
{
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const libRow = /<div class="arg-lib-row" id="argLibRow">[\s\S]*?<\/div>\s*<div class="stats-head">/.exec(src);
  ok(!!libRow && libRow[0].includes('id="argNew"'), "★ argNew 在 argLibRow 行内（chips 行尾）");
  ok(!src.includes('id="argLibMore"'), "★ 顶栏 ⋯ 已退役（v2.35.0：复制收敛 + 删除就近化）");
  ok(src.includes(".arg-add{"), "＋ 的虚线胶囊样式存在");
  ok(src.includes(".arg-add.open{"), "★ 展开高亮样式存在（触发态可见）");

  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  /* （桩的静态元素 className 恒为空，arg-add 样式族由上面的源码文本断言覆盖） */
  ok(!!els["argLibRow"], "★ argLibRow 宿主容器存在（桩可定位）");
  ok(!!els["argLibRow"], "★ argLibRow 宿主容器存在（桩可定位）");
  beat.Arrange.close();
}

/* ================= 场景 T109b：展开高亮 + 点窗外即关 ================= */
section("T109b 菜单 · 展开=高亮 / 点窗外即关 / 触发钮内部与选项不误关");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  els["argNew"].fire("click");
  ok(!!newMenuOf(els), "点 ＋ 展开模板菜单（宿主 = 曲式库行）");
  ok(els["argNew"].classList.contains("open"), "★ 展开时触发钮切 .open 高亮（「点了像没点」修复）");
  eq(els["argNew"].getAttribute("aria-expanded"), "true", "aria-expanded = true");

  /* 点窗外（overlay 根上 pointerdown，target=根 → 上溯不命中菜单/触发钮）→ 关 + 高亮摘除 */
  els["arrangeOverlay"].fire("pointerdown", {});
  ok(!newMenuOf(els), "★ 点窗外即关（不需要再点一次按钮来收起）");
  ok(!els["argNew"].classList.contains("open"), "高亮随收起摘除");
  eq(els["argNew"].getAttribute("aria-expanded"), "false", "aria-expanded 复位");

  /* 触发钮自身不误关：展开态下点 ＋（target=argNew → 上溯命中）→ 走 toggle 收起 */
  els["argNew"].fire("click");
  ok(!!newMenuOf(els), "前提：再点 ＋ 展开菜单");
  els["argNew"].fire("click");
  ok(!newMenuOf(els), "点触发钮 = toggle 收起（防御路径保留）");

  /* 菜单内部不误关：桩没有冒泡，直接在根上模拟"target=菜单选项"的 pointerdown */
  els["argNew"].fire("click");
  const opt = newMenuOf(els).children[0];
  els["arrangeOverlay"].fire("pointerdown", { target: opt });
  ok(!!newMenuOf(els), "★ pointerdown 落在菜单内部（target=选项）→ 不关（选项自己的 click 接管）");
  beat.Arrange.close();

  /* v2.35.0：曲式级 ⋯ 退役——模板菜单成为唯一菜单，互斥对象不复存在（原断言随 ⋯ 一并删除） */
}

/* ================= 场景 T109c：段卡片 ↔ 范围联动 ================= */
section("T109c 联动 · 范围覆盖段绿左条 / 未覆盖段 dim / 拖滑块实时跟随");
{
  const { beat, els } = loadApp(seed3());
  const S = beat.Store.S;
  beat.Arrange.open();
  /* 初始 arrangeSel=[0,0]（第 1 小节）→ 段1 in-range、段2/3 dim */
  eq(rows(els)[0].className.includes("play-in-range"), true, "段1 覆盖 → 绿左条");
  eq(rows(els)[1].className.includes("play-dim"), true, "★ 段2 未覆盖 → 降透明");
  eq(rows(els)[2].className.includes("play-dim"), true, "段3 未覆盖 → 降透明");

  /* ⋯「练这段」（第 2 段）→ 联动翻转 */
  moreBtn(els, 1).fire("click");
  menuItem(menuOf(els, 1), /只练第 2 段/).fire("click");
  eq(rows(els)[0].className.includes("play-dim"), true, "段1 退出范围 → dim");
  eq(rows(els)[1].className.includes("play-in-range"), true, "★ 段2 进入范围 → 绿左条");

  /* 拖滑块（不落库重渲染路径）→ syncPanelRead 实时切类：范围改成小节 1..4（0 基 0..3）→ 段1 独占 */
  const fe = els["argRangeFrom"], te = els["argRangeTo"];
  fe.value = "1"; fe.fire("input");
  te.value = "4"; te.fire("input");
  eq(rows(els)[0].className.includes("play-in-range"), true, "★ 拖动中卡片类实时跟随（不点提交）");
  eq(rows(els)[1].className.includes("play-dim"), true, "段2 回到 dim");
  beat.Controls.stop();
  beat.Arrange.close();
}

/* ================= 场景 T109d：换型候选标题写明上下文 ================= */
section("T109d 候选标题 · 「换型：第 N 段 · 块 M」（P2-10 的另一半）");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  rows(els)[1].children[2].children[0].children[3].fire("click");   // 第 2 段第 1 块的「换」
  const pick = rows(els)[2];             // 候选行插在触发段行（第 2 段）之后 → 下标 2
  ok(/(^| )arg-pick( |$)/.test(pick.className), "前提：候选行就地展开（在触发段行正下方）");
  const lab = pick.children[0];
  eq(lab.textContent, "换型：第 2 段 · 块 1", "★ 标题写明给哪个段哪个块换型");
  beat.Arrange.close();
}
