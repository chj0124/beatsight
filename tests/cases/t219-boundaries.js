/* BeatSight 自动化测试 · 边界值（v3.36.7，本轮审计 C-9）
   T219
   ──────────────────────────────────────────────────────────────────────────────────────
   由来（2026-10-07 第二轮取证）：审计把 C-9 归进「需真人验证清单（C 类）」，但它是**纯边界值
   测试**——BPM 30/240、型长 1/64 全都能在现有桩里跑，不需要真机。本轮实测逐条都过，
   却**没有任何一条被钉住**：BPM 域的钳制、型长护栏、极值下的调度器、超长型的渲染代价，
   此前全靠「应该没问题」。

   ★ 这类边界值得钉的理由是它们的失效形态**静默**：钳制没了只是数字越界；护栏没了是脏数据
     落进冷键；渲染代价失控是播放中掉帧——三个都不报错。

   反向验证（改坏后必须变红，已实测）：
     · 把 BPM 域的滑杆 min/max 放宽（如 10/300）→ T219a 钳制断言红；
     · 把 MAX_PAT_BARS 提到 65 → T219c 的「65 小节被拒」红。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");
const fs = require("fs");
const path = require("path");
/* 真标记（不是桩）：下面 T219e 要拿**标记里的值**去驱动行为，才能抓住"桩与标记漂移" */
const html = fs.readFileSync(
  process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html"), "utf8");
const tagOf = id => {
  const m = new RegExp('<input[^>]*id="' + id + '"[^>]*>').exec(html);
  return m ? m[0] : "";
};
const attrOf = (tag, name) => {
  const m = new RegExp(name + '="([^"]*)"').exec(tag);
  return m ? m[1] : "";
};

const bar4 = () => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }];
const mkPreset = (name, bars) => ({ name, meter: 4, song: "边界测试", bars: Array.from({ length: bars }, bar4) });

/* ================= T219a：BPM 域 ================= */
section("T219a ★★ BPM 域 [30,240]：越界钳到边界，脏输入不落库成 NaN");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  beat.Controls.setBpm(30);  eq(S.bpm, 30, "下界 30 合法");
  beat.Controls.setBpm(240); eq(S.bpm, 240, "上界 240 合法");
  beat.Controls.setBpm(10);  eq(S.bpm, 30, "★ 低于下界 ⇒ 钳到 30");
  beat.Controls.setBpm(999); eq(S.bpm, 240, "★ 高于上界 ⇒ 钳到 240");
  /* v3.31.x：BPM 域与滑杆属性**同源**（刻度生成本就读属性），所以这条也顺带钉了域本身 */
  beat.Controls.setBpm(120);
  beat.Controls.setBpm(NaN);
  ok(Number.isFinite(S.bpm) && S.bpm === 120,
    "★★ 脏输入（NaN）回退当前值、不落库成 NaN（历史缺陷：S.bpm=NaN ⇒ 位置换算全 NaN、调度器彻底不发声）");
}

/* ================= T219e：桩的手写属性副本 vs 真标记（漂移闸门） ================= */
section("T219e ★★ 手写属性副本不得与真标记漂移（桩里没有闸门盯这件事）");
{
  /* 桩的 HTML_ATTRS（tests/lib/harness.js）把 bpmSlider / wallDim / latMs 的 min/max/value
     **手抄**了一份；check-stub-parity 只对账"两份桩之间"，管不到"桩与标记"。
     于是标记改了域而桩没跟 ⇒ 上面那些钳制断言会继续对着旧域通过（桩比真机宽松的老毛病）。
     这里用**标记里的值**去驱动行为：真同源才过得去。 */
  const bpm = tagOf("bpmSlider");
  const lo = +attrOf(bpm, "min"), hi = +attrOf(bpm, "max");
  ok(lo > 0 && hi > lo, "前提：从标记里读到 bpmSlider 的 min=" + lo + " / max=" + hi);

  const { beat } = loadApp();
  const S = beat.Store.S;
  beat.Controls.setBpm(lo - 1);
  eq(S.bpm, lo, "★ 标记里的 min 就是**生效的**下界（桩若漂移，这里立刻红）");
  beat.Controls.setBpm(hi + 1);
  eq(S.bpm, hi, "★ 标记里的 max 就是生效的上界");

  /* 另两份手抄副本：钉住"标记 = 契约"，改了标记就得同时改桩与本用例 */
  const wall = tagOf("wallDim");
  eq(attrOf(wall, "min") + "-" + attrOf(wall, "max"), "0-80", "壁纸遮罩域的标记值");
  const lat = tagOf("latMs");
  eq(attrOf(lat, "min") + "-" + attrOf(lat, "max") + "/" + attrOf(lat, "step"), "0-500/5",
    "延迟补偿域的标记值（审计 C-3 问过「步进多细」，这里是它的机器答案：5ms）");
}

/* ================= T219b：极值真起播 ================= */
section("T219b ★★ 极值 BPM 真起播：5 秒 / 250 帧调度器零异常");
{
  for (const b of [30, 240]){
    const { beat } = loadApp();
    beat.Controls.setBpm(b);
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    let err = null;
    try { for (let i = 0; i < 250; i++){ ac.currentTime += 0.02; beat.AudioEngine.scheduler(); } }
    catch(e){ err = e.message; }
    eq(err, null, "★ BPM " + b + "：250 帧调度零异常");
    eq(beat.Store.S.playing, true, "BPM " + b + "：仍在播放（极值不会把播放搞停）");
  }
}

/* ================= T219c：型长边界 ================= */
section("T219c ★★ 型长边界：1 与 64 通过，0 与 65 被护栏拒");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  const St = beat.Store;
  const imp = n => St.importPresets(JSON.stringify({ presets: [mkPreset("型" + n, n)] }));
  eq(imp(1).ok, true, "1 小节型（下界）通过");
  eq(imp(64).ok, true, "64 小节型（MAX_PAT_BARS 上界）通过");
  eq(imp(0).ok, false, "★ 0 小节型被拒——0 小节没有合法解释（渲染 / 发声 / 段长都要除以它）");
  eq(imp(65).ok, false, "★★ 65 小节型被拒（越界必须挡在落库之前，否则脏数据进冷键）");
  eq(St.customs.length, 2, "★ 只有合法的那两条进库");
}

/* ================= T219d：超长型的渲染代价 ================= */
section("T219d ★ 64 小节型 buildViz 中位 < 5ms（只画同屏几行，代价不随型长线性增长）");
{
  const { beat } = loadApp(undefined, { seedDemo: false });
  const St = beat.Store;
  St.importPresets(JSON.stringify({ presets: [mkPreset("长型", 64)] }));
  const c = St.customs[St.customs.length - 1];
  St.S.sel = { type: "custom", id: c.id };
  for (let i = 0; i < 5; i++) beat.Viz.buildViz();               // 预热
  const t = [];
  for (let i = 0; i < 15; i++){
    const s = process.hrtime.bigint();
    beat.Viz.buildViz();
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  t.sort((a, b) => a - b);
  const med = t[Math.floor(t.length / 2)];
  ok(med < 5, "★ 64 小节型 buildViz 中位 " + med.toFixed(2) + " ms（< 5ms；本机实测约 0.7ms）");
}
