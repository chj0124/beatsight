/* BeatSight 自动化测试 · 座次尺/时值标注两开关 + 双关胶囊放大（v2.70.0，1.4 + 2.1）
   T138 系列。
   ---------------------------------------------------------------------------
   用户要求（1.4）：可视化区域的「1 e & a」座次尺与「四分/八分/十六×N」时值标注
   各配一个显隐开关（设置·外观与辅助）。
   用户拍板（2.1）：两开关都关 ⇒ 行首和弦标记（.bar-chord）自动放大一倍——
   远处只看和弦时它就是唯一信息，理应占满 freed 的视觉带宽。

   机理与契约（t86 家族同口径：开关不说谎、启动收敛、偏好跟热键走）：
     · 显隐走 **CSS 类**（#viz 上的 .no-ruler / .no-durlab），DOM 照建——
       文本级断言与读屏（aria-label 用 stepLabel 函数算，不经 DOM）全不受影响。
     · ★ 隐藏规则必须带 !important：fitCellAnnotations 会给标签写**内联 display**
       （窄格隐藏），内联压过类规则——"整类不显示"压掉窄格态正是所需（源码级钉死）。
     · 两开关都关 ⇒ #viz 加 .chord-xl（.bar-chord 字号/内边距 ×2，不用 transform:scale）；
       只关其一 ⇒ 不放大（放大只在"文字全让位"时发生）。
     · 启动收敛（t86e 教训）：syncVizLabelToggles 在装配层 init 即跑一次，
       重载后类与开关必须与 S 偏好一致，不许出现"开关开着、座次尺没了"的说谎态。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const vizOf = els => els["viz"];
const has = (els, cls) => vizOf(els).classList.contains(cls);
const pillOn = el => el.className === "toggle-pill on";
const pillOff = el => el.className === "toggle-pill off";

/* ================= 场景 T138a：默认双开 ⇒ 三个类都不在、开关不说谎 ================= */
section("T138a 默认双开 ⇒ 无 no-ruler / no-durlab / chord-xl，两 pill 为开");
{
  const { beat, els } = loadApp();
  eq(beat.Store.S.showRuler, true, "S.showRuler 默认 true");
  eq(beat.Store.S.showDurLabel, true, "S.showDurLabel 默认 true");
  ok(pillOn(els["rulerLabToggle"]) && pillOn(els["durLabelToggle"]),
    "★ 默认两 pill 视觉为开（className 整串覆写，不叠类）");
  eq(els["rulerLabToggle"].getAttribute("aria-checked"), "true", "座次尺 aria 同源");
  ok(!has(els, "no-ruler") && !has(els, "no-durlab") && !has(els, "chord-xl"),
    "★ 默认 #viz 上三个类都不在（标注全显示）");
}

/* ================= 场景 T138b：关座次尺 ⇒ no-ruler 落类 + 偏好持久化 ================= */
section("T138b 座次尺关 ⇒ .no-ruler 落 #viz、热键载荷带 showRuler:false、重载收敛");
{
  const { beat, els, storage } = loadApp();
  els["rulerLabToggle"].fire("click");
  eq(beat.Store.S.showRuler, false, "点击 ⇒ S.showRuler 翻转为 false");
  ok(has(els, "no-ruler") && !has(els, "chord-xl"),
    "★ .no-ruler 落 #viz；只关其一 ⇒ 不放大（chord-xl 需双关）");
  ok(pillOff(els["rulerLabToggle"]) && els["rulerLabToggle"].getAttribute("aria-checked") === "false",
    "pill 视觉与语义同步为关（setToggle 一次写全）");
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).showRuler, false, "关座次尺进热键载荷");
  const r = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(r.beat.Store.S.showRuler, false, "重载后偏好仍在");
  ok(has(r.els, "no-ruler") && pillOff(r.els["rulerLabToggle"]),
    "★ 重载后启动收敛：类与 pill 都为关（t86e 同族教训的防回归位）");
}

/* ================= 场景 T138c：双关 ⇒ chord-xl 落类；开回任一 ⇒ 类撤 ================= */
section("T138c 双关 ⇒ .chord-xl（2.1 胶囊放大）；开回任一开关 ⇒ 类撤");
{
  const { els } = loadApp();
  els["rulerLabToggle"].fire("click");
  ok(!has(els, "chord-xl"), "只关座次尺 ⇒ 不放大");
  els["durLabelToggle"].fire("click");
  ok(has(els, "chord-xl"), "★ 双关 ⇒ .chord-xl 落 #viz（放大条件 = 两偏好同为 false）");
  els["rulerLabToggle"].fire("click");
  ok(!has(els, "chord-xl") && has(els, "no-durlab"), "开回座次尺 ⇒ chord-xl 撤、no-durlab 仍在");
}

/* ================= 场景 T138d：隐藏规则 !important + 放大规则源码级钉死 ================= */
section("T138d 源码级 · 隐藏带 !important（压 fitCellAnnotations 的内联 display）；放大不用 transform");
{
  ok(/\.viz\.no-ruler \.ruler-lab\{display:none!important\}/.test(html),
    "★ 座次尺隐藏带 !important（内联 display 的唯一压法）");
  ok(/\.viz\.no-durlab \.cell-label\{display:none!important\}/.test(html),
    "★ 时值标注隐藏带 !important（组标签同为 .cell-label，一并覆盖）");
  ok(/\.viz\.chord-xl \.bar-chord\{font-size:22px;line-height:1;padding:0 16px;top:-36px\}/.test(html),
    "★ 放大 = 字号/内边距 ×2 + top 抬高（不用 transform:scale，防边框发虚）");
}

/* ============ T138x 层级：球与播放杆都要在**和弦胶囊之上** ============
   用户实报：播放杆和小球都在和弦标记**下面**（被行首胶囊挡住）。
   实测契约（改前）：.bar-chord z=8 / .bounce-ball z=7 / .playhead z=6。
   用户拍板（简化版）：**两者都抬到和弦之上**，不做"只当前行"的分段。 */
section("T138x 层级 · 弹跳球与播放杆都在和弦胶囊之上");
{
  /** 从源码里取某选择器的 z-index（只取该规则第一条） @param {string} sel */
  const zi = (sel) => {
    const re = new RegExp("\\" + sel.replace(/[.*+?^${}()|[\]\\]/g, m => m === "." ? "." : "\\" + m)
      + "\\{[^}]*z-index:(\\d+)");
    const m = re.exec(html);
    return m ? Number(m[1]) : null;
  };
  const chord = zi(".bar-chord"), ball = zi(".bounce-ball"), head = zi(".playhead");
  eq(chord, 8, "前提：和弦胶囊 z-index = 8（层叠基准）");
  ok(ball !== null && ball > chord,
     "★★ 弹跳球在**和弦之上**（改前 7 < 8 ⇒ 被行首胶囊挡住）",
     "ball=" + ball + " / chord=" + chord);
  ok(head !== null && head > chord,
     "★★ 播放杆在**和弦之上**（改前 6 < 8 ⇒ 被行首胶囊挡住）",
     "playhead=" + head + " / chord=" + chord);
  ok(/z-index:9/.test(html) || (ball > chord && head > chord),
     "★ 两处都确实抬过和弦（允许将来同步上调，只要仍压在它上面）");
}

/* ============ T138y 歌词轨播放头：无词行不上、位置按行内归一（v3.34.4） ============
   用户实报：播放自定义曲式《我们能不能不分手》，**播到中间没有歌词的段落时**行尾突然出现一条绿线。
   根因：播放头位置式 `min(1, tib / barTicks)` —— 无词的行没有"按词归一"那一步，`tib`（**段内** tick）
   大于 `barTicks`（**一小节**长）⇒ 被钉死在行尾（那条绿线）。
   修法（双保险）：① 无词行**不显示**播放头（与 v3.33.8「空歌词行不画底纹」同一口径）；
                 ② 位置先**归一**到行内（`tib % barTicks`），有词行同余为无操作（回归安全）。 */
section("T138y 歌词轨播放头 · 无词行不上 / 位置按行内归一");
{
  const { beat } = loadApp();
  const F = beat.Viz.lyricHeadAt;
  ok(typeof F === "function", "前提：lyricHeadAt 已导出（供测试与排查）");
  /** 造一行：n = chip 数（0 = 无词行） @param {number} n */
  const row = (n) => ({ barTicks: 192, chipEls: new Array(n).fill({}) });
  eq(F(row(0), 96, 400).show, false,
     "★★ 无词行 ⇒ **不上播放头**（改前：tib 一大就被 min(1,…) 钉在行尾 = 那条绿线）");
  const h = F(row(2), 96, 400);
  eq(h.show, true, "★ 有词行 ⇒ 正常上播放头");
  eq(h.x, 200, "★ 行内半小节 ⇒ 50%（400 × 0.5）");
  eq(F(row(2), 384, 400).x, 0,
     "★★ 段内 tick 384（第 3 小节起点）归一到**行内 0**（改前会被钉到 400 = 行尾）");
  eq(F(row(2), 480, 400).x, 200, "★ 段内 tick 480 ⇒ 行内 96 ⇒ 50%");
  eq(F({ barTicks: 0, chipEls: [{}] }, 96, 400).show, false, "★ 行长为 0 也不上（防除零）");
  eq(F(null, 96, 400).show, false, "★ 行不存在也不炸");
}
