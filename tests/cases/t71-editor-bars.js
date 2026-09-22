/* BeatSight 自动化测试 · 编辑器增删小节（v2.6.1，第 Ⅲ 期）
   T71 系列。
   ---------------------------------------------------------------------------
   契约：型的小节数在 v2.5.1 就放开了（域 1–64），但**界面上一直没有改它的入口**——
   于是 1 小节的型在编辑器里永远只有一行、改不动。这一期把入口补上：
     · 「＋ 在其后加一小节」= 在**当前小节之后**插入一小节，内容是当前小节的副本
     · 「− 删当前小节」= 删掉当前小节，**下限 1**（0 小节的型没有合法解释）
   两条纪律与其它草稿变更一致：① 先 pushUndo；② 改完走 render()（单一渲染入口）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* n 小节的型：每小节 4 个四分（和 = 192 = 4×TPB） */
const mkBars = n => Array.from({ length: n }, () => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]);
const sumOf = bar => bar.reduce((a, s) => a + s.t, 0);
const rowsOf = els => els["editorBars"].children.length;

/* 打开编辑器：n = 4 时用内置（四分基础），否则导入一个 n 小节的型并选中 */
function openOn(n){
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }), { seedDemo: false });
  if (n !== 4){
    beat.Store.importPresets(JSON.stringify({ presets: [{ name: n + "小节型", meter: 4, bars: mkBars(n) }] }));
    beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
    beat.Presets.refreshAfterPatternChange();
  }
  beat.Editor.open();
  return { beat, els };
}
/* 把"当前小节"切到第 b 行（点行内的轨道 → 列 track 处于 click 目标即换行） */
const focusBar = (els, b) => els["editorBars"].children[b].children[1].fire("click");

/* ================= 场景 T71a：加一小节 ================= */
section("T71a 编辑器增删小节 · 「加一小节」复制当前小节并插在它后面（能力放开 ≠ 能用）");
{
  const { beat, els } = openOn(4);
  eq(rowsOf(els), 4, "前提：4 小节的型 → 编辑器 4 行");
  eq(els["addBarBtn"].disabled, false, "4 小节时加小节键可用");
  eq(els["delBarBtn"].disabled, false, "4 小节时删小节键可用");

  focusBar(els, 1);                              // 目标小节 = 第 2 小节
  els["addBarBtn"].fire("click");
  const d = beat.Editor.draft();
  eq(d.bars.length, 5, "★ 加完 5 小节");
  eq(rowsOf(els), 5, "★ 编辑器渲染出 5 行（渲染跟着小节数走）");
  eq(JSON.stringify(d.bars[2]), JSON.stringify(d.bars[1]),
     "★ 新小节的初值 = 当前小节的副本（不是空小节：空小节会让保存键立刻变灰）");
  eq(d.bars.filter(b => sumOf(b) === 192).length, 5, "每一小节都恰好占满 4 拍");
  eq(els["savePresetBtn"].disabled, false, "校验通过：保存键可用");
  ok(/校验通过/.test(els["editorStatus"].textContent), "状态栏报校验通过");
  ok(/5 小节/.test(els["editorCardTitle"].textContent),
     "★ 卡片标题跟着小节数走（实际「" + els["editorCardTitle"].textContent + "」）");
  ok(/5 小节/.test(els["editorTitle"].textContent), "编辑器标题同理");
}

/* ================= 场景 T71b：删一小节 ================= */
section("T71b 编辑器增删小节 · 「删当前小节」走确认框 / 删完游标不越界");
{
  const { beat, els } = openOn(4);
  focusBar(els, 3);                              // 目标小节 = 第 4 小节（末行）
  els["delBarBtn"].fire("click");
  els["modalOk"].fire("click");                  // 破坏性动作：应用内确认框
  const d = beat.Editor.draft();
  eq(d.bars.length, 3, "★ 删完 3 小节");
  eq(rowsOf(els), 3, "编辑器渲染出 3 行");
  /* 游标原本指向被删掉的末行（0 基 3），删后必须被收进范围——
     否则音符块库的追加路径 `d.bars[editBar].push(...)` 会直接抛 TypeError */
  els["palette"].children[0].fire("click");      // 往"当前小节"追加一个音符块
  ok(beat.Editor.draft().bars.length === 3, "★ 删后追加音符不越界（游标已收进范围）");
  eq(sumOf(beat.Editor.draft().bars[2]) >= 48, true, "追加落在末行上");
}

/* ================= 场景 T71c：删到只剩 1 小节就禁用 ================= */
section("T71c 编辑器增删小节 · 下限 1 小节（0 小节的型没有合法解释）");
{
  const { beat, els } = openOn(1);
  eq(rowsOf(els), 1, "★ 1 小节的型 → 编辑器就 1 行（这正是示例曲节奏型 1~5 的形态）");
  eq(els["delBarBtn"].disabled, true, "★ 只剩 1 小节时删小节键禁用");
  els["delBarBtn"].fire("click");                // 硬点也不该生效
  eq(beat.Editor.draft().bars.length, 1, "硬点删小节键：小节数不变（没有确认框弹出）");
  els["addBarBtn"].fire("click");
  eq(beat.Editor.draft().bars.length, 2, "加一小节照常可用");
  eq(els["delBarBtn"].disabled, false, "≥2 小节后删小节键恢复可用");
}

/* ================= 场景 T71d：撤销能回退小节数 ================= */
section("T71d 编辑器增删小节 · Ctrl+Z 能连小节数一起回退");
{
  const { beat, els } = openOn(1);
  els["addBarBtn"].fire("click");
  els["addBarBtn"].fire("click");
  eq(beat.Editor.draft().bars.length, 3, "前提：加到 3 小节");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars.length, 2, "★ 撤销一次回到 2 小节");
  beat.Editor.undo();
  eq(beat.Editor.draft().bars.length, 1, "★ 再撤销回到 1 小节");
  eq(rowsOf(els), 1, "渲染同步");
}

/* ================= 场景 T71e：改完能存成预设并立刻生效 ================= */
section("T71e 编辑器增删小节 · 存成预设后小节数真的落库（端到端）");
{
  const { beat, els } = openOn(1);
  els["addBarBtn"].fire("click");
  els["addBarBtn"].fire("click");                // 3 小节
  els["presetNameInput"].value = "我的三小节";
  els["savePresetBtn"].fire("click");
  eq(beat.patBars(beat.curPattern()), 3, "★ 保存后的型是 3 小节（validatePreset 的域 1~64 放它进来）");
  eq(beat.curPattern().name, "我的三小节", "名字取自输入框");
  /* 端到端：主视图网格的行数跟着这个新型走 */
  const vizRows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className)).length;
  eq(vizRows, 3, "★ 主视图随即渲染 3 行（小节数从编辑器一路传到渲染层）");
}

/* ================= 场景 T71f：上限 MAX_PAT_BARS ================= */
section("T71f 编辑器增删小节 · 加到上限就禁用（导入护栏同样守这条域）");
{
  const { beat, els } = openOn(4);
  for (let i = 0; i < beat.MAX_PAT_BARS - 4; i++) els["addBarBtn"].fire("click");
  eq(beat.Editor.draft().bars.length, beat.MAX_PAT_BARS, "★ 加到上限 " + beat.MAX_PAT_BARS + " 小节");
  eq(els["addBarBtn"].disabled, true, "★ 到上限后加小节键禁用");
  els["addBarBtn"].fire("click");                // 硬点也不该生效
  eq(beat.Editor.draft().bars.length, beat.MAX_PAT_BARS, "硬点加小节键：小节数不变");
  ok(/校验通过/.test(els["editorStatus"].textContent), "长型仍然每小节占满（校验通过）");
}
