/* BeatSight 自动化测试 · 空扫语义收口（PLAN-v13）
   T257 系列。
   ---------------------------------------------------------------------------
   核心契约：`air=true` 只表达空扫记谱，必须与 `rest=true` 同时成立；
   调度器只看 `rest`，因此空扫格不触发 onset。实扫则是 `air=false + rest=false`。
   本组钉：
     · 内置示例的空扫数据分类与 10 个无方向位置；
     · 空扫 / 纯休止都不产生扫弦 onset，实扫产生 onset；
     · 旧示例副本经既有内置化迁移收编后拿到带 `air` 的内置规范形；
     · air 的显式写入只改变 onset，不改变其他音符的时刻。 */
"use strict";
const { loadApp, FakeAudioContext, drive, ok, eq, near, section } = require("../lib/harness");

const flatSteps = pats => pats.flatMap(p => (p.bars || []).flatMap(bar => bar));
const restSteps = pats => flatSteps(pats).filter(s => s.rest === true);
const airSteps = pats => restSteps(pats).filter(s => s.air === true);
const noDirAirSteps = pats => airSteps(pats).filter(s => s.dir === undefined && s.zone === undefined && s.str === undefined);
const patByName = (beat, name) => beat.BUILTINS.find(p => p.name === name);
const strumNoise = ac => ac.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass" && h.filterFreq === 700);

/* ================= 场景 T257a：内置示例的空扫数据分类 ================= */
section("T257a 空扫数据 · 52 个 rest 中 43 个空扫、10 个无方向位置精确补 air");
{
  const { beat } = loadApp();
  const rests = restSteps(beat.BUILTINS);
  const airs = airSteps(beat.BUILTINS);
  const noDir = noDirAirSteps(beat.BUILTINS);
  eq(rests.length, 52, "★ 全部内置型的 rest 总数仍为 52（本批不改 rest）");
  eq(airs.length, 43, "★ 其中 43 格是空扫：33 个有方向 + 10 个无方向");
  eq(rests.length - airs.length, 9, "★ 其余 9 格是真休止/延音（P6、Q1、Funk），不补 onset");
  eq(noDir.length, 10, "★ 无方向空扫共 10 格");
  const expected = {
    "节奏型2（《在他乡》）": [2, 3],
    "节奏型3（《在他乡》）": [2, 3],
    "节奏型4（《在他乡》）": [8, 9, 10, 11, 12, 13],
  };
  for (const [name, pos] of Object.entries(expected)){
    const p = patByName(beat, name);
    ok(!!p, `前提：内置库有「${name}」`);
    const got = p.bars[0].map((s, i) => (s.rest === true && s.air === true && s.dir === undefined) ? i : -1)
      .filter(i => i >= 0);
    eq(JSON.stringify(got), JSON.stringify(pos), `★「${name}」无方向空扫位置 = ${pos.join(",")}（0 基）`);
  }
  const p1 = patByName(beat, "节奏型1（《在他乡》）");
  eq(p1.bars[0].filter(s => s.rest === true && s.air === true && s.dir !== undefined).length, 7,
     "P1 的 7 个有方向空扫保持 rest+dir+air，不被误改");
}

/* ================= 场景 T257b：空扫与纯休止都不产生扫弦 onset ================= */
section("T257b 空扫静默 · rest=true+air=true 不出扫弦声，实扫出且时刻不动");
{
  const { beat } = loadApp();
  const bar = Array.from({ length: 16 }, (_, i) => ({ t: 12 }));
  bar[0] = { t: 12, dir: "D", zone: 0 };                       // 实扫：0.08s
  bar[1] = { t: 12, rest: true, air: true, dir: "D", zone: 0 }; // 有方向空扫：无 onset
  bar[2] = { t: 12, rest: true };                               // 纯休止：无 onset
  bar[3] = { t: 12, dir: "U", zone: 0 };                       // 实扫：0.54875s
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "空扫静默", meter: 4, bars: [bar] }] })).ok,
     "空扫静默素材导入成功");
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  drive(ac, beat, 1.0);
  beat.Controls.stop();
  const hits = strumNoise(ac);
  eq(hits.length, 2, "★ 扫弦声只来自两颗实扫，空扫与纯休止都静默");
  near(hits[0].t, 0.08, 1e-6, "第 1 颗实扫仍在格 0 起点");
  near(hits[1].t, 0.08 + 36 * 0.625 / 48, 1e-6, "第 2 颗实扫仍在格 3 起点（中间两格静默不占 onset）");
}

/* ================= 场景 T257c：air 开关只增减自己的 onset，不拖动其他时刻 ================= */
section("T257c air 联动 · 实扫满格 vs 一格空扫：只少该格一声，其余时刻逐项一致");
{
  const mk = withAir => Array.from({ length: 16 }, (_, i) => i === 1 && withAir
    ? { t: 12, rest: true, air: true, dir: "D", zone: 0 }
    : { t: 12, dir: "D", zone: 0 });
  const play = withAir => {
    const { beat } = loadApp();
    ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: withAir ? "一格空扫" : "满格实扫", meter: 4, bars: [mk(withAir)] }] })).ok,
       `素材导入成功（${withAir ? "一格空扫" : "满格实扫"}）`);
    beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
    beat.Presets.refreshAfterPatternChange();
    beat.Controls.setBpm(240);                     // 一小节 1s；窗口内 16 格全在当前小节
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 1.2);
    beat.Controls.stop();
    return strumNoise(ac).filter(h => h.t < 1.05).map(h => h.t);
  };
  const all = play(false), oneAir = play(true);
  eq(all.length, 16, "满格实扫 = 16 声");
  eq(oneAir.length, 15, "一格空扫 = 15 声（空扫自身静默）");
  const skipped = 0.08 + 12 * 0.25 / 48;
  eq(JSON.stringify(oneAir), JSON.stringify(all.filter(t => Math.abs(t - skipped) > 1e-6)),
     "★ 空扫版时刻 = 满格版去掉该格，其余 onset 逐位一致");
}

/* ================= 场景 T257d：旧示例副本走既有内置化迁移，收编到带 air 的规范形 ================= */
section("T257d 存量示例副本 · 内置化迁移把无 air 旧 P2 收编为带 air 的内置型");
{
  const src = loadApp();
  const p2 = patByName(src.beat, "节奏型2（《在他乡》）");
  const oldBars = JSON.parse(JSON.stringify(p2.bars));
  oldBars[0].forEach(s => { delete s.air; });   // 模拟上一版落盘的无方向空扫（缺 air）
  const app = loadApp({ "beatsight.customs": JSON.stringify({ v: 1, customs: [{
    id: "old-demo-p2", name: p2.name, meter: p2.meter, bars: oldBars,
  }] }) });
  eq(app.beat.Store.customs.length, 0, "★ 旧示例副本由既有内置化迁移收走，customs 不留示例型");
  const next = patByName(app.beat, p2.name);
  const got = next.bars[0].map((s, i) => (s.rest === true && s.air === true && s.dir === undefined) ? i : -1)
    .filter(i => i >= 0);
  eq(JSON.stringify(got), JSON.stringify([2, 3]), "★ 收编后的内置 P2 已带无方向空扫 air=true（位置 2,3）");
}
