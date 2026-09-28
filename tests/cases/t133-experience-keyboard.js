/* BeatSight 自动化测试 · 练习键盘快捷键体系（v2.64.0，X2）
   T133 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。

   ★★ 为什么要有这一组：审计「第 2 批·业务功能」的 X2 长期没人接——主界面只有空格一个
       全局键，BPM / 跳段 / 开面板全靠鼠标点，练习时手在键盘上却要去找按钮，断节奏。
       本组守四件事：
        ① ↑↓ 调 BPM（Shift 加速 ±5）；
        ② ←→ 曲式模式跳段（经共享助手 practiceSeek → Arrange.jumpTo）；
        ③ E/H/? 经共享助手打开编排 / 帮助 / 键盘小节（不引入 Controls → Arrange/Help 反向边）；
        ④ 文本输入中不抢键（与空格同守卫）。 */
"use strict";
const { loadApp, ok, section } = require("../lib/harness");

/* 派发一个 keydown（复用 harness 的 fireWin，事件基对象已带 preventDefault 等） */
function key(app, ev){ app.fireWin("keydown", ev); }

section("T133 · X2 BPM 快捷键（↑↓ / Shift 加速）");
{
  const app = loadApp();
  const { beat } = app;
  const S = beat.Store.S;
  const b0 = S.bpm;
  key(app, { key: "ArrowUp" });
  ok(S.bpm === b0 + 1, "★ X2：ArrowUp → BPM +1（" + b0 + " → " + S.bpm + "）");
  key(app, { key: "ArrowDown" });
  ok(S.bpm === b0, "★ X2：ArrowDown → BPM 回到原值（" + S.bpm + "）");
  key(app, { key: "ArrowUp", shiftKey: true });
  ok(S.bpm === b0 + 5, "★ X2：Shift+ArrowUp → BPM +5（" + S.bpm + "）");
}

section("T133 · X2 跳段快捷键（←→ 经 practiceSeek → Arrange.jumpTo）");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  let lastArg = null, called = 0;
  const realJump = beat.Arrange.jumpTo;
  beat.Arrange.jumpTo = (i) => { called++; lastArg = i; };
  /* 进曲式模式并指向示例曲（demo 已带出），arrSec 默认 0 */
  beat.Store.S.playMode = "arrange";
  beat.Store.S.arrangeSel.id = beat.DEMO_ID;
  key(app, { key: "ArrowLeft" });
  ok(called === 1 && lastArg === -1, "★ X2：ArrowLeft → practiceSeek(-1) → Arrange.jumpTo(-1)（实参 " + lastArg + "）");
  key(app, { key: "ArrowRight" });
  ok(called === 2 && lastArg === 1, "★ X2：ArrowRight → practiceSeek(1) → Arrange.jumpTo(1)（实参 " + lastArg + "）");
  beat.Arrange.jumpTo = realJump;
  void sandbox;
}

section("T133 · X2 开面板快捷键（E / H / ? 经共享助手）");
{
  const aE = loadApp();
  key(aE, { key: "e" });
  ok(aE.beat.Arrange.isOpen() === true, "★ X2：E → 经 openArrange 打开曲式编排（Arrange.isOpen）");

  const aH = loadApp();
  key(aH, { key: "h" });
  ok(aH.beat.Help.isOpen() === true, "★ X2：H → 经 openHelp 打开使用方法（Help.isOpen）");

  const aQ = loadApp();
  key(aQ, { key: "?" });
  ok(aQ.beat.Help.isOpen() === true, "★ X2：? → 经 openKeymap 打开键盘小节（Help.isOpen）");
  ok(aQ.beat.Help.more() === true, "★ X2：? → 完整说明展开（more = true，键盘清单可见）");
}

section("T133 · X2 文本输入中不抢键");
{
  const app = loadApp();
  const { beat, sandbox } = app;
  const S = beat.Store.S;
  const b0 = S.bpm;
  /* 模拟焦点在文本输入框（BPM 框等）：这些键归输入框，不触发快捷键 */
  sandbox.document.activeElement = { tagName: "INPUT", type: "text" };
  key(app, { key: "ArrowUp" });
  ok(S.bpm === b0, "★ X2：文本输入中 ArrowUp 不改 BPM（不抢输入框）");
  key(app, { key: "e" });
  ok(beat.Arrange.isOpen() === false, "★ X2：文本输入中 E 不开编排（不抢输入框）");
}
