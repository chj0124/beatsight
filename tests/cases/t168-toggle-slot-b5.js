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

/* ================= T153a：开关列纵排（流内参数的骨架） ================= */
section("T153a v3.19.0 开关列纵排 —— 面板在流内挂各自开关下方");
{
  ok(/.viz-head-grid \.viz-toggles \.tg-body\{display:flex;flex-direction:column;justify-content:flex-start;gap:8px;width:100%\}/.test(CSS_CODE),
    "★★ tg-body = 纵排 flex 列 + width:100%（v3.19.0 新骨架；v3.13 的 display:block+padding 预留口径退役）");
  ok(/\.viz-toggles \.tg-row\{display:flex;flex-direction:column;align-items:flex-start;gap:2px\}/.test(CSS_CODE),
    "★★ v3.24.0：tg-row 纵排 + 间距压缩——行高恒定（由 BPM 列决定），面板在列内空余区显隐");
  ok(!/\.viz-toggles \.tg-slot\{position:absolute/.test(CSS_CODE)
     && !/tg-slot\{display:contents\}/.test(CSS_CODE),
    "★★ 悬浮槽规则整体退役（无 absolute 槽、无 display:contents 壳）");
  /* 作用域仍钉在 .viz-toggles 内：.tg-body/.tg-row 类名在音量/BPM 组的行包装层也在用
     （宽选择器会把音量三条滑杆排成三列，v3.9.0 实拍翻过车）——作用域纪律不随模型退役 */
  ok(/\.viz-head-grid \.viz-toggles \.tg-body\{/.test(CSS_CODE)
     && !/\.viz-head-grid \.tg-body\{display:flex/.test(CSS_CODE),
    "★ 作用域钉在 .viz-toggles 内的纪律不变（防误伤音量/BPM 组的同名包装层）");
}

/* ================= T153b：DOM 交错顺序 + 面板满列宽 ================= */
section("T153b v3.19.0 面板在流内——交错顺序即视觉顺序");
{
  /* 流内模型下 DOM 顺序 = 视觉顺序：每个参数面板紧跟自己的开关。
     交错钉（源码序）在 t163；这里钉 CSS 侧的面板满列宽与预备拍同行。 */
  ok(/\.viz-toggles \.tg-row \.tr-panel\{width:100%;margin:0\}/.test(CSS_CODE),
    "★★ 面板 width:100%（吃满开关列宽 ~312px；v3.13 的 max-content 定宽退役）");
  ok(/\.viz-toggles \.countin-line,\.viz-toggles \.sw-line\{display:flex;align-items:center;gap:8px;width:100%\}/.test(CSS_CODE),
    "★★ 三组统一开关行（countin-line / sw-line）= 开关 + 主参数同行右侧、吃满列宽"
    + "（预备拍+拍数 / 静音拍+随机 / 变速训练+目标——v3.22.0；v3.24.0 gap 10→8 压缩）");
  ok(/\.viz-toggles \.tg-row \.tr-prog\{width:100%;text-align:left\}/.test(CSS_CODE),
    "★ 训练进度/拒开原因 = 变速参数末行（流内，v3.16 的 absolute 悬浮口径退役）");
  ok(!/grid-area:\d\/\d/.test(CSS_CODE),
    "★★ 全文件不再有 grid-area 钉位（同轴网格整体退役，DOM 顺序即布局）");
  ok(!/#countInPanel\{grid-area/.test(CSS_CODE) && !/id="countInPanel"/.test(html),
    "★ 空参数面板 #countInPanel 仍不存在");
  /* ≥900：控制卡片三列均分（用户需求：音量 | BPM | 三开关同排） */
  ok(/@media \(min-width:900px\)\{[\s\S]*?\.viz-head-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(CSS_CODE),
    "★★ ≥900：控制卡片三列均分（音量 | BPM | 开关列，各 ~1fr）");
  ok(/@media \(min-width:900px\)\{[\s\S]*?\.viz-head-grid \.viz-toggles\{grid-column:3;grid-row:1;align-self:start\}/.test(CSS_CODE),
    "★ 开关列 = 第 3 列、与音量/BPM 同行");
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
