/* BeatSight 自动化测试 · 设置弹窗「恢复示例曲」（v2.85.0，fix ③a）
   T152 系列。
   ---------------------------------------------------------------------------
   契约（与 index.html L9646-9651 注释同源）：
     · 设置弹窗「恢复示例曲（重建《在他乡》）」按钮 → Modal.uiConfirm 二次确认 →
       Arrange.loadDemo()（与侧栏「恢复示例曲」同一出口：ensureDemo 重建 + 选中 + 播报）。
     · 用途：用户改坏了示例曲的曲式/歌词后，一键按出厂规格重建，不影响其它曲式。
   基准：默认 seedDemo:true（视作已带出），boot 期 ensureDemo 已把《在他乡》落库。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const demoArr = beat => beat.Store.findArrange(beat.DEMO_ID);
const demoLyricCount = beat => beat.Store.lyrics.filter(l => l.arrangeId === beat.DEMO_ID).length;
/* 复刻点击路径：点按钮 → 点确认 → loadDemo 执行 */
function clickRebuild(a){
  a.els["demoRebuildBtn"].fire("click");   // 开 uiConfirm
  a.els["modalOk"].fire("click");          // 确认 → onOk → Arrange.loadDemo()
}

section("T152a 恢复示例曲 · 正向：按钮→确认→示例曲仍在库且 10 行歌词齐全");
{
  const a = loadApp(undefined, { seedDemo: false });
  const beat = a.beat;
  ok(!!demoArr(beat), "★ boot 期示例曲已落库（数据组读者能点）");
  eq(demoLyricCount(beat), 10, "示例曲 10 行歌词齐备（重建前基线）");
  eq(beat.Store.customs.length, 0, "自定义库为空（示例型已内置，不在此占条目）");

  clickRebuild(a);                          // 用户点「恢复示例曲」并确认

  ok(!!demoArr(beat), "★ 重建后示例曲仍在库（id 固定，按规格覆盖）");
  eq(demoLyricCount(beat), 10, "★ 重建后仍 10 行歌词（出厂规格未被改坏）");
  eq(beat.Store.customs.length, 0, "★ 重建不向自定义库塞东西（无泄漏条目）");
  eq(beat.Store.arranges.length, 1, "曲式没被重建翻倍");
}

section("T152b 恢复示例曲 · 幂等：用户删了示例曲 → 一键重建回来");
{
  const a = loadApp(undefined, { seedDemo: false });
  const beat = a.beat;
  /* 模拟用户误删示例曲 */
  beat.Store.deleteArrange(beat.DEMO_ID);
  ok(!demoArr(beat), "删前：示例曲已从库里消失");
  eq(demoLyricCount(beat), 0, "歌词随曲式一并消失");

  clickRebuild(a);                          // 一键重建

  ok(!!demoArr(beat), "★ 删除后点「恢复示例曲」→ 示例曲重建回来");
  eq(demoLyricCount(beat), 10, "★ 重建后 10 行歌词随曲式一并回来");
  eq(beat.Store.arranges.length, 1, "重建只补回 1 首，没叠加");
  eq(beat.Store.customs.length, 0, "重建仍不污染自定义库");

  /* 第二次点：已存在 → 仍幂等通过，不翻倍 */
  clickRebuild(a);
  eq(beat.Store.arranges.length, 1, "★ 第二次重建不翻倍（loadDemo 幂等）");
  eq(demoLyricCount(beat), 10, "第二次重建后歌词仍是 10 行");
}
