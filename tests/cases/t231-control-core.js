/* BeatSight 自动化测试 · 控制芯（PLAN-v9 批 4 新用例）
   T231
   ---------------------------------------------------------------------------
   【钉什么】控制芯重排（批 2/3）的承重契约：
     ① 芯形态：≥1280 单列 + 芯容器 402px **全档居中**（52 标签槽 + 10 间距 + 340 滑杆），
        三根滑杆等长的**结构前提**与音量/BPM 互比口径同源；
     ② 胶囊行：三枚开关（预备/静音/变速）住 .core-pills，id 与 role="switch" 接线不变；
     ③ 浮层壳：显隐镜像面板（syncParamSlots），openParamSlot 强制路径 + 收回路径；
     ④ 拒开原因仍落在芯底 #trainerProg（t142 口径的浮层版延伸）。
   【几何口径】真几何（左右缘差 ≤2 / 浮层锚定 / 收起塔高）归 tools/smoke.js 的
     layoutProbe（桩无布局引擎）；本文件钉**源码结构 + 桩内行为**，
     与 t90 头部声明的"标记字符串断言"同一分工。
   【v3.40.0 居中补正】用户实测发现芯只在 1280–1439.9 居中：窄/堆叠档（<1280）落在
     「全宽块 + 内容左贴」、≥1440 回退 312 左贴（基础 .card-head-left 的旧 2×2 列宽未覆盖）。
     修法 = 居中规则上移基础层 + ≥1280 放开 .card-head-left 宽度；T231a 新增两条钉死这两点。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");   // 剥块注释（防历史字面量骗过断言）

section("T231a 芯形态 · ≥1280 单列 + 402 居中 + 三滑杆等长的结构前提");
{
  /* 单列居中芯（批 2）：块布局 + 芯容器 402 居中（两处都在 ≥1280 媒体块内） */
  ok(/html body \.card \.viz-head-grid\{display:block;max-width:none;margin:0 auto\}/.test(CSS_CODE),
    "★★ ≥1280：两列网格退役 → display:block（单列）");
  /* ★★★ v3.40.0 居中补正：居中规则必须在**基础层**（早于 ≥1280 媒体块）——
     原先只在 ≥1280 块内 ⇒ 窄/堆叠档与 ≥1440 都不居中（用户实测复现）。 */
  const iGroupCenter = CSS_CODE.indexOf(".viz-head-grid .card-head-left .group{max-width:402px;margin:0 auto}");
  const iBlock1280 = CSS_CODE.indexOf("@media (min-width:1280px)");
  ok(iGroupCenter >= 0 && iBlock1280 >= 0 && iGroupCenter < iBlock1280,
    "★★ 芯容器 402px 居中在**基础层**（全档生效；退回 ≥1280 块内 ⇒ 窄档与 ≥1440 不居中）");
  ok(/@media \(min-width:1280px\)\{[\s\S]*?\.viz-head-grid \.card-head-left\{width:100%\}/.test(CSS_CODE),
    "★★ ≥1280 放开 .card-head-left 宽度（覆盖基础 width:min(312px,100%)，防 ≥1440 回退 312 左贴）");
  /* ★★★ 控制芯批 6（用户实测 · 冒烟闸抓到）：≥1280 两侧浮层必须 width:max-content——
     浮层定位在包含块（.group）之外 ⇒ shrink-to-fit 可用宽为负 ⇒ 宽度塌到 min-content、
     参数被 flex-wrap 竖排 3~5 行；white-space:nowrap 治不了 flex 子项换行。 */
  ok(/#muteFlyout\{[^}]*width:max-content/.test(CSS_CODE)
     && /#trainerFlyout\{[^}]*width:max-content/.test(CSS_CODE),
    "★★★ ≥1280 两侧浮层 width:max-content（防 shrink-to-fit 塌成 min-content、参数竖排）");
  /* 402 的算术：标签槽 52 + 行内间距 10 + 滑杆 340。滑杆长度不是写死的数字——
     它 = tg-body 上限 402 − 槽位 52 − 间距 10，故钉这三个来源而非 340 本身。 */
  ok(/\.viz-head-grid \.card-head-left \.group \.tg-body\{max-width:402px\}/.test(CSS_CODE),
    "★★★ 合并组内容上限 = 芯口径 402（滑杆 340 的来源；改芯宽必须同改这里）");
  ok(/\.vol-row>span:first-child\{min-width:52px\}/.test(CSS_CODE)
     && /\.bpm-slider-row>span:first-child\{min-width:52px\}/.test(CSS_CODE),
    "★★★ 三滑杆等长前提①：音量/BPM 两行标签槽同 52px（互比口径的数字面）");
  ok(/\.vol-row\{display:flex;align-items:center;gap:10px/.test(CSS_CODE)
     && /\.bpm-slider-row\{display:flex;align-items:center;gap:10px;min-height:40px/.test(CSS_CODE),
    "★★★ 三滑杆等长前提②：两行同 gap 10px（滑杆右端都抵行尾，等号只剩左槽）");
  ok(/\.card-head-left \.vol-row input\[type=range\]\.vol\{flex:1;width:auto\}/.test(CSS_CODE)
     && /\.slider-wrap>input\[type=range\]\{width:100%;flex:1\}/.test(CSS_CODE),
    "★★★ 三滑杆等长前提③：两类输入都吃满行内剩余宽（volBpm 互比的结构版）");
  /* ≥1280 浮层出芯两侧（批 2）：静音左 / 变速右 */
  ok(/#muteFlyout\{left:auto;right:calc\(100% \+ 14px\)/.test(CSS_CODE)
     && /#trainerFlyout\{left:calc\(100% \+ 14px\)/.test(CSS_CODE),
    "★ ≥1280：静音浮层出芯左、变速浮层出芯右（不盖滑杆塔）");
}

section("T231b 胶囊行 · 三枚 id + role=switch 接线（批 2 搬块不换 id 的验收面）");
{
  const seg = html.slice(html.indexOf('<div class="core-pills">'), html.indexOf("<!-- v2.5.0：原来只有「总音量"));
  ok(seg.length > 0 && seg.includes('class="core-pills"'), "前提：芯顶胶囊行切片取到");
  for (const id of ["countInToggle", "muteToggle", "trainerToggle"]){
    ok(new RegExp('<button class="toggle-pill off" id="' + id + '" role="switch"').test(seg),
      "★ 胶囊行三件之一且带 role=switch：#" + id);
  }
  /* 行为面：点击翻转 aria-checked 与状态（bindToggle 接线随搬家照常生效） */
  const { beat, els } = loadApp({}, { seedDemo: false });
  ok(els["countInToggle"] && els["muteToggle"] && els["trainerToggle"],
    "★ 三枚开关在桩上可取到（id 未换）");
  els["muteToggle"].fire("click");
  eq(els["muteToggle"].getAttribute("aria-checked"), "true", "★ 点静音胶囊 → aria-checked 翻真");
  eq(beat.Store.S.mute, true, "★ 且状态开（bindToggle 一行未动）");
  els["muteToggle"].fire("click");
  eq(beat.Store.S.mute, false, "★ 再点回关（胶囊就是旧开关，语义不变）");
}

section("T231c 浮层开合 · 镜像面板 + openParamSlot 强制路径 + 收回");
{
  const { beat, els } = loadApp({}, { seedDemo: false });
  /* ① 壳镜像面板：开静音 → 面板与壳同显 */
  els["muteToggle"].fire("click");
  eq(els["muteCfgPanel"].hidden, false, "前提：静音开 → 面板显形（t173c 原契精）");
  eq(els["muteFlyout"].hidden, false, "★★ 浮层壳镜像面板（syncParamSlots 同步翻壳）");
  els["muteToggle"].fire("click");
  eq(els["muteFlyout"].hidden, true, "★ 关静音 → 壳随之隐藏（无残留）");
  /* ② 强制路径（openParamSlot）：空目标点变速 → 面板不开、壳与面板强制可见 */
  els["trainerToggle"].fire("click");
  eq(beat.Store.S.trainer.on, false, "前提：空目标 → 开关不开（拒开语义，t163c）");
  eq(els["trainerPanel"].hidden, false, "★★ openParamSlot 强制面板可见（拒开待填）");
  eq(els["trainerFlyout"].hidden, false, "★★ 强制路径下浮层壳同步可见");
  /* ③ 收回路径：填了目标（change）→ force 解除 → 壳与面板一起收 */
  els["trTarget"].value = "180";
  els["trTarget"].fire("change");
  eq(els["trainerFlyout"].hidden, true, "★★ 填目标即收浮层（clearSlotForce 的壳侧效果）");
  /* ④ 真开：目标有效 → 开关开、面板与壳常驻（跟随开关状态） */
  els["trainerToggle"].fire("click");
  eq(beat.Store.S.trainer.on, true, "前提：目标已填 → 开关开");
  eq(els["trainerFlyout"].hidden, false, "★ 开关开 → 浮层常驻（参数可见）");
  els["trainerToggle"].fire("click");
  eq(els["trainerFlyout"].hidden, true, "★ 关开关 → 浮层收（壳严格跟随面板）");
}

section("T231d 拒开原因留芯底 · #trainerProg 就地反馈（t142 口径的浮层版延伸）");
{
  const { beat, els } = loadApp({}, { seedDemo: false });
  /* 空目标拒开：原因写芯底进度行（DOM 位置在胶囊行之后、浮层壳之前——批 2 重钉） */
  els["trainerToggle"].fire("click");
  ok((els["trainerProg"].textContent || "").indexOf("先填一个大于当前速度的目标 BPM") >= 0,
    "★★ 空目标拒开 → 原因落在芯底 #trainerProg（浮层化了但不弹窗、不静默）");
  ok(html.indexOf('id="trainerProg"') < html.indexOf('id="muteFlyout"'),
    "★ 源码序：进度行在浮层壳之前（留芯底的批 2 钉）");
  /* 当前速度 ≥ 目标：第二道闸同走芯底（文案带数值）。
     目标输入处理器拒收 ≤ 当前 BPM 的值（v2.73.0），故先填合法目标、再经 setBpm 升速。 */
  els["trTarget"].value = "120";
  els["trTarget"].fire("change");
  ok((els["trainerProg"].textContent || "") === "",
    "前提：填目标即撤原因（clearSlotForce 的一次性提示口径）");
  beat.Controls.setBpm(150);
  els["trainerToggle"].fire("click");
  ok((els["trainerProg"].textContent || "").indexOf("已不低于目标") >= 0,
    "★★ 速度 ≥ 目标拒开 → 原因同样落在芯底（两道闸一个通道）");
  eq(beat.Store.S.trainer.on, false, "★ 两道闸都只拦开启方向（开关未开）");
  /* 训练真开时进度行跟随爬坡（updateProg 写点不动） */
  els["trTarget"].value = "180";
  els["trTarget"].fire("change");
  els["trainerToggle"].fire("click");
  ok(/当前 \d+ BPM · 第 1\//.test(els["trainerProg"].textContent || ""),
    "★ 训练开 → 芯底显示「当前 N BPM · 第 1/M 步」（留芯底的拍板项）");
}
