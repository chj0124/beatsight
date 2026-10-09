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
  /* ★★★ v3.41.0（乙案重设计 · 用户拍板）：面板改为**挂在各自胶囊正下方**的下拉面板——
     ≥1280 两块向外扇开（静音右对齐到自己胶囊、变速左对齐）⇒ 同时开着也不重叠；
     <1280 退化为锚芯、占满芯宽。旧的「出芯两侧 + width:max-content」两条契约随之退役。 */
  ok(/@media \(min-width:1280px\)\{\s*#muteFlyout\{left:auto;right:0\}/.test(CSS_CODE)
     && /@media \(max-width:1279\.9px\)\{\s*\.core-pill-hold\{position:static\}/.test(CSS_CODE),
    "★★★ v3.41.0：≥1280 面板向外扇开（双开不重叠）/ <1280 锚芯占满芯宽（下拉面板全档统一）");
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
  /* v3.41.0：面板锚在自己那枚胶囊下方（.core-pill-hold 提供包含块）+ 顶部小箭头指向它 */
  ok(/\.core-pill-hold\{position:relative;display:flex\}/.test(CSS_CODE)
     && /\.tg-flyout\{position:absolute;top:calc\(100% \+ 10px\);left:0;/.test(CSS_CODE)
     && /\.tg-flyout::before\{content:"";position:absolute;top:-5px;left:16px/.test(CSS_CODE),
    "★ v3.41.0：面板 = 胶囊下方的下拉（top = 胶囊下沿 + 10px）+ 指向上方胶囊的小箭头");
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
  ok(html.indexOf('id="countInBeatsWrap"') < html.indexOf('id="muteFlyout"')
     && html.indexOf('id="muteFlyout"') < html.indexOf('id="trainerProg"'),
    "★ 源码序（v3.41.0 乙案）：拍数 → 静音面板 → 变速面板 全在胶囊行内，芯底 #trainerProg 在其后");
  /* 当前速度 ≥ 目标：第二道闸同走芯底（文案带数值）。
     目标输入处理器拒收 ≤ 当前 BPM 的值（v2.73.0），故先填合法目标、再经 setBpm 升速。 */
  els["trTarget"].value = "120";
  els["trTarget"].fire("change");
  ok((els["trainerProg"].textContent || "") === "",
    "前提：填目标即撤原因、读数行回到**空**（撤回 G4：读数行随变速训练生死）");
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

/* ================= 场景 T231e：v3.41.0 按《整体布局方案示意图》对账的新契约 ================= */
section("T231e 方案对账（v3.41.0）· 胶囊行单行/居中 · 圆点指示器 · 读数行常显 · 移动端同构");
{
  /* ① 胶囊行居中（方案 .pillrow{justify-content:center}）——容器仍满芯宽，居中靠 justify */
  ok(/\.core-pills\{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap\}/.test(CSS_CODE),
    "★★ 胶囊行居中（justify-content:center，方案图口径；原先 flex-start 左贴）");
  /* ② 指示器 = 方案的 16px 圆点（order:-1 提到文字左侧；关闭=空心环 / 打开=实心绿） */
  ok(/\.core-pills \.toggle-pill \.switch\{order:-1;width:16px;height:16px;border-radius:50%/.test(CSS_CODE)
     && /\.core-pills \.toggle-pill \.switch::after\{display:none\}/.test(CSS_CODE)
     && /\.core-pills \.toggle-pill\.on \.switch\{background:var\(--green\);border-color:var\(--green\)\}/.test(CSS_CODE),
    "★★ 指示器 = 16px 圆点（文字左侧；关闭空心环 / 打开实心绿——形状+颜色双通道，不只靠颜色）");
  /* ③ 预备 = 一个胶囊壳（拍数并入壳内；方案把「4拍」画在胶囊里） */
  ok(/\.core-pill-grp\{display:flex;align-items:center;gap:7px;height:36px;padding:0 12px 0 14px;/.test(CSS_CODE)
     && /\.core-pill-grp:has\(\.toggle-pill\.on\)\{border-color:var\(--green\)\}/.test(CSS_CODE),
    "★★ 预备 = 一个胶囊壳（[圆点 预备 4 拍] 同框；开关态由 :has 镜像到壳描边）");
  /* ④ 移动端同构：芯铺满卡内容宽（326）+ 滑杆塔两侧内缩 16 ⇒ 滑杆仍 232；BPM 行盒回到 36 */
  ok(/\.viz-head-grid \.card-head-left\{padding-left:0;padding-right:0\}/.test(CSS_CODE)
     && /\.viz-head-grid \.card-head-left \.tg-body\{padding-left:16px;padding-right:16px\}/.test(CSS_CODE),
    "★★ 移动端芯铺满卡内容宽（326）且滑杆塔两侧内缩 16px（滑杆保持 232 不变）");
  ok(/\.viz-head-grid \.card-head-left \.bpm-slider-row\{min-height:36px\}/.test(CSS_CODE),
    "★★ 移动端 BPM 行盒 36px（修特异性：原选择器 (0,1,0) 且更靠前，被基础 40px 盖掉 ⇒ 实测恒 40）");
  /* ⑤ 展开态只剩胶囊行 + 滑杆塔（方案移动图展开态里没有「BPM 96 ▾」读数钮） */
  ok(/#ctlOpen:checked ~ \.ctl-pills\{display:none\}/.test(CSS_CODE),
    "★★ 展开态隐藏「BPM 96 ▾」读数钮（读数钮只服务收起态的替代读数）");
  /* ⑥ 读数行随**变速训练**生死（v3.41.0 用户纠正：它不是常显基线，方案图那行是训练开着时的状态） */
  const { els } = loadApp({}, { seedDemo: false });
  ok((els["trainerProg"].textContent || "") === "",
    "★★ 训练器未开 → 芯底读数行为空（撤回 G4：读数行属于变速训练，不开不显示）");
  /* ⑦ v3.41.0：控制卡**全档无卡底**（全局单条；窄屏档不再重复声明——用户第三轮拍板） */
  ok(/body \.card:has\(\.card-head\.viz-head\)\{background:none;border:0;border-radius:0\}/.test(CSS_CODE)
     && (CSS_CODE.match(/background:none;border:0;border-radius:0/g) || []).length === 1,
    "★★★ 控制卡去底 = **全局单条**（PC 横屏也去；窄屏档不再重复声明）");
}

/* ================= 场景 T231f：强开槽「再点即收」（v3.41.0 用户报障修复） ================= */
section("T231f 强开槽 toggle —— BPM ≥ 目标时点变速，面板必须能被第二次点击收起");
{
  const { els } = loadApp({
    "beatsight.state": JSON.stringify({ trainer: { on: false, target: 60, step: 5, everyN: 4 } }),
  }, { seedDemo: false });
  /* 当前 BPM 96 ≥ 目标 60 ⇒ 闸门拒开，但槽要强开给出原因（v3.3.1 方案甲） */
  els["trainerToggle"].fire("click");
  ok(els["trainerPanel"].hidden === false, "前提：BPM ≥ 目标 ⇒ 拒开但面板强开（就地给原因）");
  ok(/已不低于目标/.test(els["trainerProg"].textContent || ""), "前提：原因写在芯底");
  /* ★★★ 第二次点击 = 收起（修复前：仍是"拒绝 + 强开"，槽纹丝不动 ⇒ 用户报「参数槽无反应」） */
  els["trainerToggle"].fire("click");
  ok(els["trainerPanel"].hidden === true, "★★★ 强开槽**再点即收**（v3.41.0：openParamSlot 改 toggle）");
  ok((els["trainerProg"].textContent || "") === "",
    "★★ 收起时原因一并撤（不留「面板关了、红条还挂着」的矛盾态）");
  ok(!/\bwarn\b/.test(els["trainerProg"].className), "★★ 注意态同时摘除");
}

/* ================= 场景 T231g：v3.42.0 全站滑块圆头挂出 · 参数槽 · 点空白收面板 · 折叠钮两态 ================= */
section("T231g v3.42.0：滑块条内缩半个钮径 · 右侧参数槽 · 点空白收面板 · 折叠钮（居中 / 右端小箭头）");
{
  const { els } = loadApp({}, { seedDemo: false });
  const src = html;   /* 源码面用 harness 顶层导出的文件原文（loadApp 不返回 html） */
  /* ② 参数槽：标记（两个槽按钮 + aria）+ CSS + 行为（随开关生死 / 点它开合 / 摘要） */
  ok(/<button class="core-slot" id="muteSlot" type="button" hidden aria-expanded="false" aria-controls="muteFlyout"/.test(src)
     && /<button class="core-slot" id="trainerSlot" type="button" hidden aria-expanded="false" aria-controls="trainerFlyout"/.test(src),
    "★★ 两个参数槽是 <button>（可聚焦/可键盘触发）且带 aria-expanded + aria-controls、初值 hidden");
  ok(/\.core-slot\{display:flex/.test(CSS_CODE) && /\.core-slot\[hidden\]\{display:none\}/.test(CSS_CODE)
     && /\.core-slot\{display:flex;align-items:center;gap:3px;height:24px;padding:0 4px;\n  border:0;/.test(CSS_CODE),
    "★★ 槽的样式 + [hidden] 显式兜底 + **无描边**（v3.42.0 补：去掉细线框、内边距 8→4 省面积）");
  els["muteToggle"].fire("click");
  ok(els["muteSlot"].hidden === false, "★★★ 静音开 → 胶囊右侧**长出参数槽**（关着时不占位）");
  ok(/^每\d+·静\d+/.test(els["muteSlotTxt"].textContent || ""), "★★ 槽内是只读摘要「每N·静M」");
  ok(els["muteSlot"].getAttribute("aria-expanded") === "true" && els["muteFlyout"].hidden === false,
    "前提：开关打开 → 面板展开、槽 aria-expanded=true");
  els["muteSlot"].fire("click");
  ok(els["muteFlyout"].hidden === true && els["muteSlot"].hidden === false,
    "★★★ 点参数槽 → **面板收起**（开关不动、槽仍在）——这就是「收回后怎么再展开」的答案");
  els["muteSlot"].fire("click");
  ok(els["muteFlyout"].hidden === false, "★★ 再点 → 面板重新展开");
  /* ③ 点空白 = document 级监听收起（源码头把守；桩里没有可派发的 document 事件） */
  ok(/document\.addEventListener\("click",/.test(src)
     && /#muteFlyout, #trainerFlyout, \.core-pills, \.ctl-pills, #trainerProg/.test(src),
    "★★★ 点面板外任何地方都收起开关驱动的面板（排除面板/胶囊行/读数钮/原因区/叠加层）");
  ok(/function dismissSlots\(\)/.test(src) && /if \(anySlotOpen\(\)\)\{ dismissSlots\(\); return true; \}/.test(src),
    "★★ Esc = 点空白的键盘等价物（走既有 KEY_LAYERS 注册表，仍只认 Escape）");
  /* ④ 折叠钮：收起态居中 + 展开态芯右缘小箭头 */
  ok(/\.ctl-pills\{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px/.test(CSS_CODE),
    "★★ 收起态读数钮**居中**（原先贴左，与下面居中的胶囊行不齐）");
  /* ★★★ v3.42.0 补（用户拍板）：展开态的折叠入口**整体搬去顶栏**——与设置/主题同规格的 40px 圆钮、
     圆内 18px 的 ▾（用户点名"不能太小"）；收起态它 hidden、入口回到卡内居中的读数钮。
     退役理由链：绝对定位会压到开关/参数槽（误点）→ 行内 flex 项又会在"两槽都开"时把整行挤折 → 顶栏两难全消。 */
  ok(/<button class="pill outline icon-btn" id="foldBtn"[^>]*hidden>/.test(src)
     && /#foldBtn\[hidden\]\{display:none\}/.test(CSS_CODE)
     && /#foldBtn\{width:40px;padding:0\}/.test(CSS_CODE)   /* ★ 定宽：▾ 推进宽 ~12px，靠 padding 撑会成 34×40 椭圆（用户实拍） */
     && /#foldBtn \.fold-ico\{display:block\}/.test(CSS_CODE) && /d="M7 5.5l5 5 5-5"/.test(src) && /d="M7 13.5l5 5 5-5"/.test(src)
     && /\(function wireFoldBtn\(\)/.test(src)
     && !/ctl-mini/.test(src),
    "★★★ 展开态折叠钮在**顶栏**（#foldBtn｜40px 圆钮 + 18px ▾ + [hidden] 兜底 + wireFoldBtn 同步）；胶囊行内那枚已退役");
  /* 行为：展开 → 顶栏钮出现；点它 → checkbox 归位（控制区折叠）且它自己隐藏 */
  const fc = els["ctlOpen"], fb = els["foldBtn"];
  fc.checked = true; fc.fire("change");
  ok(fb.hidden === false, "★★ 展开态 → 顶栏折叠钮出现（收起态 hidden）");
  fb.fire("click");
  ok(fc.checked === false && fb.hidden === true, "★★★ 点顶栏钮 → 收回控制区（checkbox 归位）且钮自己隐藏");
  /* ★★★ v3.42.0 第十一轮（用户口径）：音名档下"一个音名都画不出来" ⇒ 设置里 nm 胶囊**置灰不可选**
     + 与图例条同族的说明条；点掉后本次不再弹，情形消失再出现时**再次弹出**（上升沿语义）。 */
  ok(/const triggered = \(nmDrawnN === 0 && nmHiddenN > 0\)/.test(src)
     && /nmPill.disabled = triggered;/.test(src)
     && /if \(!triggered\) pitchNoticeArmed = true;/.test(src)
     && /<div class="pitch-notice" id="pitchNotice" role="status" hidden>/.test(src)
     && /id="pitchNoticeOk"/.test(src)
     && /if \(triggered && S.pitchNotation === "nm"\)/.test(src),
    "★★★ 音名不可用 ⇒ nm 胶囊置灰 + 回退简谱 + 静态说明条（上升沿重弹）");
  /* （已随 v3.42.0 第六轮回退删除）「圆钮垂直居中」那条：条回到元素自身背景后，Chrome 默认即居中，
     margin-top 校正项不再需要；--trk-h 令牌一并退役。 */
}
