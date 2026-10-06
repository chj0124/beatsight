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
  eq(demoLyricCount(beat), 9, "示例曲 9 行歌词齐备（重建前基线）");
  eq(beat.Store.customs.length, 0, "自定义库为空（示例型已内置，不在此占条目）");

  clickRebuild(a);                          // 用户点「恢复示例曲」并确认

  ok(!!demoArr(beat), "★ 重建后示例曲仍在库（id 固定，按规格覆盖）");
  eq(demoLyricCount(beat), 9, "★ 重建后仍 9 行歌词（出厂规格未被改坏）");
  eq(beat.Store.customs.length, 0, "★ 重建不向自定义库塞东西（无泄漏条目）");
  eq(beat.Store.arranges.length, 2, "曲式没被重建翻倍（两首示例曲）");
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
  eq(demoLyricCount(beat), 9, "★ 重建后 9 行歌词随曲式一并回来");
  eq(beat.Store.arranges.length, 2, "重建只补回 2 首，没叠加");
  eq(beat.Store.customs.length, 0, "重建仍不污染自定义库");

  /* 第二次点：已存在 → 仍幂等通过，不翻倍 */
  clickRebuild(a);
  eq(beat.Store.arranges.length, 2, "★ 第二次重建不翻倍（loadDemo 幂等）");
  eq(demoLyricCount(beat), 9, "第二次重建后歌词仍是 9 行");
}

/* ============ T152x：示例曲改名的一次性迁移（v3.33.31） ============ */
section("T152x 示例曲改名迁移 · 存量旧名一次性改成新名，且幂等");
{
  /* ★ 造"存量数据"：曲式库里有一条 id = demo-ztx、名字还是**旧名**的记录
     （改名前落盘的库就是长这样——预设库的「曲式分组」标题取的正是这个名字）。 */
  const seed = { "beatsight.arranges": JSON.stringify([
    { id: "demo-ztx", name: "在他乡（示例）", sections: [
      { uid: "s1", name: "段", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] }] },
  ]) };
  const { beat } = loadApp(seed, { seedDemo: false });
  const a = beat.Store.arranges.find(x => x.id === "demo-ztx");
  ok(!!a, "前提：存量示例曲在");
  eq(a.name, "《在他乡》（示例）",
     "★★ 启动迁移把存量旧名改成新名——不改的话，预设库分组标题照旧显示旧名，且 ensureDemo 按新名找不到会**重复建一份**");
  const { beat: beat2 } = loadApp({ "beatsight.arranges": JSON.stringify(beat.Store.arranges) },
    { seedDemo: false });
  eq(beat2.Store.arranges.find(x => x.id === "demo-ztx").name, "《在他乡》（示例）",
     "★ 幂等：二次启动名字不变（不再命中旧名）");
}
