/* BeatSight 自动化测试 · 参数区契约固化（v3.9.0 固定槽位 → v3.12 两列 → v3.13 悬浮槽 → v3.19.0 开关列纵排流内）
 * ---------------------------------------------------------------------------
 * ★ 沿革：v3.7.0 共槽仲裁 → v3.9.0 固定槽位 → v3.12.0 两列 → v3.13.0 悬浮槽
 *   （absolute 通栏 + 50px 预留 + 开合高度零位移）→ **v3.19.0（用户拍板）：
 *   开关列纵排 + 参数面板在流内挂各自开关下方**——面板打开允许开关列纵向生长
 *   （用户明确接受下移），音量/BPM 两列与开关列顶部对齐、内容不动，卡片向下扩展。
 *   v3.13 的 absolute 通栏槽 / 50px 预留 / 零高度位移契约整体退役；
 *   #tgSlot 壳拆除，面板直接成为 #tgSwitchRow 的流内子节点（DOM 交错排列，搬块不换 id）。
 * ★ 重写而非删除：仍然成立的部分（不互斥、force 开槽待填、显隐收口、启动收敛）
 *   原样保留；不再成立的部分（76px 轨道、grid-area 钉位、display:contents 壳、
 *   手风琴特化）在注释里写明为什么退役。删掉回归测试等于把这块地重新变成雷区。
 * ★ 真实几何由 tools/smoke.js 复核，本文件钉源码级契约。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/* ================= T153a：控制芯骨架（流内参数的骨架，PLAN-v9 批 2 重写） ================= */
section("T153a 控制芯 —— 开关住胶囊行、面板住浮层壳（开关列退役）");
{
  ok(/\.core-pills\{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap\}/.test(CSS_CODE)
     && /\.viz-head-grid \.card-head-left \.group \.tg-body\{flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:10px\}/.test(CSS_CODE),
    "★★ 控制芯骨架：胶囊行横排**且居中**（.core-pills gap 10 + justify-content:center，v3.41.0 按方案图）"
    + " + 滑杆塔纵列（tg-body flex-start gap 10，"
    + "v3.19.0 纵排流内骨架在芯上延续）");
  ok(/\.tg-flyout\{position:absolute/.test(CSS_CODE) && /\.tg-flyout\[hidden\]\{display:none\}/.test(CSS_CODE),
    "★★ v3.30.0 纵排行距 7px 契约随开关列退役 → 面板住浮层壳（absolute + [hidden] 配套）");
  ok(!/\.viz-toggles \.tg-slot\{position:absolute/.test(CSS_CODE)
     && !/tg-slot\{display:contents\}/.test(CSS_CODE),
    "★★ 悬浮槽规则整体退役（无 absolute 槽、无 display:contents 壳）");
  /* 作用域钉在芯内：.tg-body 类名在别处（设置弹窗同名包装层）也在用——作用域纪律不随模型退役 */
  ok(/\.viz-head-grid \.card-head-left \.group \.tg-body\{/.test(CSS_CODE)
     && !/\.viz-head-grid \.tg-body\{display:flex/.test(CSS_CODE),
    "★ 作用域钉在芯内（.group .tg-body 全链）的纪律不变（防误伤同名包装层）");
}

/* ================= T153b：胶囊行/浮层的 CSS 契约 ================= */
section("T153b 控制芯 —— 浮层壳样式与芯的排布口径");
{
  ok(/\.tg-flyout \.tr-panel\{display:block;margin-top:0\}/.test(CSS_CODE)
     && /\.tg-flyout \.f-title\{[^}]*color:var\(--green\)/.test(CSS_CODE)
     && /\.tg-flyout \.f-row\{display:flex;align-items:center;gap:6px;white-space:nowrap;min-height:28px\}/.test(CSS_CODE),
    "★★ v3.41.0（乙案）：面板内 = 绿色小标题 + 若干参数行（.f-row 等高 28px），不再是可折行的 flex 条");
  ok(/\.core-pills \.toggle-pill\{height:36px;padding:0 14px;gap:7px;font-size:12\.5px;/.test(CSS_CODE),
    "★★ 三枚开关 = 胶囊行 36px 规格（v3.22.0 开关行 = 开关+主参数同行的 countin-line/sw-line 退役；"
    + "拍数输入贴预备胶囊、随机/目标进浮层）");
  ok(!/\.viz-toggles \.tg-row \.tr-prog/.test(CSS_CODE) && /#trainerProg\{display:flex/.test(CSS_CODE),
    "★★ v3.33.10：进度/闸门原因行整行搬进 BPM 卡片——v3.22.0 那条「变速参数末行」规则随位退役，改由 #trainerProg 在卡内占自然高度（不预留 min-height，避免撑高两张控制卡）");
  ok(!/grid-area:\d\/\d/.test(CSS_CODE),
    "★★ 全文件不再有 grid-area 钉位（同轴网格整体退役，DOM 顺序即布局）");
  ok(!/#countInPanel\{grid-area/.test(CSS_CODE) && !/id="countInPanel"/.test(html),
    "★ 空参数面板 #countInPanel 仍不存在");
  /* 控制芯（PLAN-v9 批 2）：≥1280 单列居中芯；两块并排的 flex 装箱与 496 容器查询补偿
     随开关列退役——堆叠档只剩合并组一块参与排布。 */
  ok(CSS_CODE.indexOf(".viz-head-grid .card-head-left .group{max-width:402px;margin:0 auto}") >= 0
     && !CSS_CODE.includes("var(--min-w-sw)")
     && !/@container \(min-width:496px\)/.test(CSS_CODE),
    "★★ 控制芯：≥1280 芯 402 居中；开关列的下限（216）与对齐补偿（496 容器查询）整列退役");
  ok(!/@media \(max-width:759\.9px\)\{[^}]*tg-body\{grid-template/.test(CSS_CODE.replace(/\n/g, "")),
    "★ ≤759.9 手风琴网格特化退役（全宽度统一纵排流内，无网格可特化）");
}

/* ================= T153c：不互斥 + force 开槽 + 显隐收口（行为契约不变） ================= */
section("T153c 开关不互斥 —— 各管各不改开关语义");
{
  ok(!/countInToggle[\s\S]{0,200}?muteToggle[\s\S]{0,200}?\.click\(\)/.test(html),
    "★★ 不得让开预备拍顺带点击静音拍（v3.3.1 明确反对臆造互斥：功能照常生效）");
  ok(/不做互斥|反对臆造互斥/.test(html),
    "★ 这条纪律在代码里有注释记录（后人想加互斥时能看见为什么不行）");
  ok(/const on = \{ mute: !!S\.mute, trainer: !!S\.trainer\.on \}/.test(html),
    "★★ on 映射必须逐项来自真实开关状态——出现任何常量 true/false 都是互斥退化"
    + "（countIn 项已随其参数面板搬离本族）");
  ok(/paramSlotForce/.test(html),
    "★ paramSlotForce 机制在：某开关没开也要把它的参数摆出来（点变速训练但目标为空时"
    + "就地填，v3.3.1 把「空目标由弹窗拒开」改成了「开槽待填」）");
  ok(/if \(on\[k\] && paramSlotForce === k\) paramSlotForce = "";/.test(html),
    "★ force 随对应开关真正打开而解除（不解除的话关掉开关参数还赖着不走）");
  ok(/启动时统一收敛/.test(html) || /syncParamSlots\(\);\s*\/\/ v3\.3\.0：启动时统一收敛/.test(html),
    "★★ 启动时调一次 syncParamSlots 统一收敛（全关 → 参数区全隐即由此保证）");
  for (const p of ["muteCfgPanel", "trainerPanel"]) {
    ok(new RegExp('id="' + p + '"[^>]*hidden|id="' + p + '"').test(html),
      "★ 面板 " + p + " 存在（且默认 hidden，由 syncParamSlots 统一显隐）");
  }
  ok(!/id="countInPanel"/.test(html),
    "★★ 预备拍参数面板已删除——留在开关列里是个空壳（且会让 syncParamSlots 的配对表留着死项）");
}
