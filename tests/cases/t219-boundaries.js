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
     · 把 MAX_PAT_BARS 提到 65 → T219c 的「65 小节被拒」红；
     · 把窗口化拆掉（arrWinBars() 返回整型长）→ T219d 的「节点数相等」与「耗时比」两条都红
       （v3.36.15 线上红复盘时补测：原「中位 < 5ms」版本对这条变异**全绿**——见该用例注释）。
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
section("T219d ★★ 64 小节型：建网格的代价不随型长增长（结构性节点数 + 同进程比值，均不含绝对墙钟）");
{
  /* v3.36.15（线上构建红复盘）：本用例原为「中位 < 5ms」的**绝对墙钟**断言。2026-10-07 的
     Cloudflare 构建死在它上面——而同一次构建里 check-all 实际跑了**两遍**（`npm run ci`
     的构建命令一遍；`npx wrangler deploy` 又读 wrangler.jsonc 的 build.command 跑一遍）：
       第二遍之前 中位 2.81 ms（绿）→ 第二遍 中位 171.74 ms（红）
     同一台机器、同一份代码、相隔两分钟，差 61 倍。本机把噪声底量了出来：空载中位 0.30 ms，
     把 8 核按 4 倍超售后**单次**采样可达 116 ms（中位仅 1.48 ms）。
     ⇒ 0.3 ms 的信号配 5 ms 的闸门，噪声比信号高两个数量级：这条断言测的是宿主调度。
       **能随宿主负载变色的闸门等于没有闸门**——它拦下的只有运气。

     ★ 同轮还发现一个更隐蔽的缺陷：本用例此前**跑在曲式模式**下。`loadApp(undefined,
       { seedDemo: false })` 会把示例曲带出来、自动落到 arrange（缺省的 `loadApp()` 才是
       preset），而 `St.S.sel = {...}` 只改「选中的预设」、不改模式——于是那个 64 小节型
       **根本没进渲染层**（实测原用例 playMode = arrange；导入 1 与 64 小节型建出的节点数
       都是 202，与型长无关）。把窗口化整个拆掉（`arrWinBars()` 返回整型长）复跑**原断言**：
       仍然全绿——中位 0.53 ms，甚至比基准的 0.73 ms 更快（变异把曲式那条窗口改小了）。
       即它对「代价随型长增长」这个真实回归是**橡皮图章**。故第一件事就是把模式钉住，并把
       它断言成**前提**：模式不是 preset，后面两条都没有意义。

     判据换成两条都不含绝对墙钟的：
       ① 结构性（主判据·确定性）：1 小节型与 64 小节型建出的 DOM 节点数必须**相等**。
          窗口化若失效，节点数随型长线性涨——与宿主负载无关，永远可复现。
       ② 相对（副判据·抗争抢）：同一进程内**交替**采样两种型长，耗时比值须有界。
          争抢对两侧同等生效，故比值不变；绝对阈值会变、比值不会。

     ★ 反向验证（已实测，变异只改 /tmp 副本、且出现的是**具名 ✗** 而非崩溃）：
       · 拆掉窗口化（`arrWinBars()` → 整型长）⇒ ① 节点数 3219 ≠ 219 红、② 比值 21.8× > 5 红；
       · 未变异基准 ⇒ ① 119 == 119 通过、② 比值 1.2× 通过。 */
  const countNodes = el => 1 + (el.children || []).reduce((s, k) => s + countNodes(k), 0);

  /* —— 前提：必须在预设模式，否则下面的型长到不了渲染层（本轮踩到的就是这个）—— */
  const app = loadApp();
  const St = app.beat.Store;
  eq(St.S.playMode, "preset", "前提：缺省 loadApp 落在预设模式（seedDemo:false 会带出示例曲 → arrange）");

  St.importPresets(JSON.stringify({ presets: [mkPreset("短型", 4), mkPreset("长型", 64)] }));
  const short = St.customs.find(c => c.name === "短型");
  const long = St.customs.find(c => c.name === "长型");
  ok(!!(short && long), "前提：两个对比型都进了库");

  const at = c => { St.S.sel = { type: "custom", id: c.id }; };

  /* ① 结构性：窗口化 ⇒ 节点数与型长无关（确定性判据，宿主多吵都复现） */
  at(short); app.beat.Viz.buildViz();
  const nShort = countNodes(app.els["viz"]);
  at(long); app.beat.Viz.buildViz();
  const nLong = countNodes(app.els["viz"]);
  eq(nLong, nShort, "★★ 64 小节型与 4 小节型建出的 DOM 节点数相等（窗口化：代价不随型长增长）");

  /* ② 相对：交替采样，宿主争抢对两侧同等生效（绝对墙钟会变色，比值不会） */
  const timeOf = c => {
    at(c);
    const s = process.hrtime.bigint();
    app.beat.Viz.buildViz();
    return Number(process.hrtime.bigint() - s) / 1e6;
  };
  for (let i = 0; i < 5; i++){ timeOf(short); timeOf(long); }        // 预热
  const ts = [], tl = [];
  for (let i = 0; i < 15; i++){ ts.push(timeOf(short)); tl.push(timeOf(long)); }   // 交替，不分组
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const ratio = med(tl) / Math.max(med(ts), 0.05);
  ok(ratio < 5, "★ 64 小节型 / 4 小节型 建网格耗时比 " + ratio.toFixed(2)
    + "×（< 5×；交替采样让宿主负载对两侧同等生效）");
}
