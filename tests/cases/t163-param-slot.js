/* BeatSight 自动化测试 · 开关参数区（v3.9.0 固定槽位；v3.12.0 收成两列）
   T163 系列。
   ---------------------------------------------------------------------------
   ★ v3.9.0 形状变更（用户裁决）：v3.3.1 的「三组参数共用一行槽 + 谁最后激活谁显示」
     退役——用户实测"想同时看两组参数做不到、切开关时参数跳来跳去，不好用"，
     且控制区空间足够，不再需要靠共槽省地。
   新形状：
     · tg-body = 一张网格（auto auto…，列宽 = 列内 max-content），
       上行开关、下行对应参数（tg-row / tg-slot 两层壳 display:contents 溶解进来）；
       每组参数永远落在自己开关正下方那列，显隐各管各（syncParamSlots 只看本组开关）。
     · 显式 grid-area 钉位：display:none 的面板不占格，不钉位的话剩下的面板会被
       auto-placement 挪进第 1 列、列对齐就散了。
     · 零跳动契约原样保留，落点换成网格第二轨（参数行）恒 76px——
       开关任一开合，块内高度一字不变（真机几何由 tools/smoke.js 复核）。
   ★ v3.12.0（用户拍板）：**列数 3 → 2**——预备拍整组（开关 + 拍数输入）搬进底部播放条右区，
     其空出来的 #countInPanel 面板删除；本行与参数槽自此各剩两件。
     拍数输入 #countInBeatsWrap 的显隐仍随 #countInToggle，但**不再归 syncParamSlots 管**
     （它不在参数槽里了），由 countInToggle 处理器直接写。
   ★ 本文件钉结构与源码级契约。 */

const { section, ok } = require("../lib/harness");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

section("T163a 结构 · 开关 = 芯顶胶囊行；参数面板进浮层壳（PLAN-v9 批 2 重写）");

/* 控制芯重排：#tgSwitchRow / .viz-toggles 退役——三枚开关住芯顶 .core-pills，
   参数面板整块搬进浮层壳（#muteFlyout / #trainerFlyout），id 与接线不换。 */
const pillsStart = src.indexOf('<div class="core-pills">');
const pillsEnd = src.indexOf("<!-- v2.5.0：原来只有「总音量");
ok(pillsStart > 0 && pillsEnd > pillsStart, "★★ 存在芯顶胶囊行 .core-pills");
const pills = src.slice(pillsStart, pillsEnd);
["muteToggle", "trainerToggle", "countInToggle"].forEach(id => {
  ok(pills.includes('id="' + id + '"'), "★ 三枚开关都在胶囊行（.core-pills）内：" + id);
});
ok(/\.viz-head-grid \.card-head-left \.group \.tg-body\{flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:10px\}/.test(src)
   && /\.viz-head-grid \.card-head-left \.group \.tg-body\{max-width:402px\}/.test(src),
  "★★ v3.19.0 纵排流内骨架延续（gap 10）+ 控制芯内容上限 402（PLAN-v9 批 2）");
/* 显式 grid-area 钉位随同轴网格整体退役：面板是浮层壳的流内子节点。 */
ok(!/grid-area:\d\/\d/.test(src),
  "★★ v3.19.0：全文件不再有 grid-area 钉位（DOM 顺序即布局）");
ok(/<div class="tg-flyout" id="muteFlyout" hidden>[\s\S]*?<div class="tr-panel" id="muteCfgPanel" hidden>/.test(src)
   && /<div class="tg-flyout" id="trainerFlyout" hidden>[\s\S]*?<div class="tr-panel" id="trainerPanel" hidden>/.test(src),
  "★★ 参数面板整块住浮层壳（#muteFlyout > #muteCfgPanel / #trainerFlyout > #trainerPanel，默认 hidden）");

section("T163b 显隐 · 各管各（共槽仲裁退役，不互斥纪律保留）");

ok(/function syncParamSlots\(\)/.test(src), "★ syncParamSlots 存在（无参收敛形态）");
ok(!/let paramSlotActive|paramSlotActive\s*=/.test(src),
  "★★ 「最后激活占槽」的记账变量（paramSlotActive）已随仲裁一并退役——留着没人写它就是死状态"
  + "（断言钉变量声明与赋值，注释里的历史名不判红）");
ok(/const show = !!\(\(on\[k\] && !slotDismissed\[k\]\) \|\| paramSlotForce === k\)/.test(src)
   && /el\.hidden = !show/.test(src)
   && /sh\.hidden = !show/.test(src),
  "★★ 每组参数的显隐 = 自己的开关（+force 例外）——组与组零干扰；浮层壳镜像面板 hidden（PLAN-v9 批 2）");
ok(/const on = \{ mute: !!S\.mute, trainer: !!S\.trainer\.on \}/.test(src),
  "★★ on 逐项来自真实开关状态（!!S.mute / !!S.trainer.on）——"
  + "出现任何常量 true/false 都是互斥退化；countIn 项已随参数搬移退役");
ok(!/show !== k/.test(src),
  "★★ 旧的“show 仲裁”写法已退役（el.hidden = (show !== k) 不应再出现）");
ok(/function openParamSlot\(/.test(src), "★ openParamSlot 存在（只读展示的入口）");
{
  const fnBody = src.slice(src.indexOf("function syncParamSlots"), src.indexOf("function openParamSlot"));
  ok(!/S\.(mute|trainer|countIn)\s*=/.test(fnBody),
    "★★ 显隐函数**不改开关状态**——只决定参数跟不跟随开关显示，功能照常生效");
}
ok((src.match(/syncParamSlots\("/g) || []).length === 0,
  "★★ 全部调用点已改为无参收敛（旧的 syncParamSlots(\"countIn\") 切槽语义不存在了）");
/* 两面板的 hidden 只由 syncParamSlots 写（散在各处的直接赋值会与统一显隐打架） */
const PANELS = ["muteCfgPanel", "trainerPanel"];
const directWrites = [];
for (const p of PANELS) {
  const re = new RegExp("\\$\\(\\s*[\"']" + p + "[\"']\\s*\\)\\s*\\.hidden\\s*=\\s*(?!=)[^;\\n]+", "g");
  const hits = src.match(re) || [];
  for (const h of hits) directWrites.push(p + ": " + h.trim());
}
ok(directWrites.length === 0,
  "★★ 参数面板不得在 syncParamSlots 之外被直接写 .hidden（实测 " + directWrites.length + " 处）"
  + (directWrites.length ? "：" + directWrites.join(" | ").slice(0, 140) : ""));
/* 面板映射仍须逐个正确（面板 id ↔ 开关组） */
const PAIRS = [["mute", "muteCfgPanel"], ["trainer", "trainerPanel"]];
const mapSeg = src.slice(src.indexOf("function syncParamSlots"), src.indexOf("function openParamSlot"));
const wrongPairs = PAIRS.filter(([k, v]) => {
  const re = new RegExp(k + ':\\s*"(\\w+)"');
  const m = re.exec(mapSeg);
  return !m || m[1] !== v;
});
ok(wrongPairs.length === 0,
  "★★ 两组配对必须逐个正确：mute→muteCfgPanel、trainer→trainerPanel"
  + (wrongPairs.length ? "（错配：" + wrongPairs.map(([k]) => k).join(",") + "）" : ""));

section("T163c 空目标 · 不再弹窗拒开（改为开槽 + 就地提示）");

ok(!src.includes('Modal.uiAlert("还没设目标'),
  "★★ 空目标的弹窗拒开已删除——目标搬进参数区后弹窗会死锁（点开关没反应又找不到输入框）");
ok(src.includes("openSlotForTarget") && src.includes('openParamSlot("trainer")'),
  "★★ 改为把参数区打开（openParamSlot）——目标框摆到用户眼前");
ok(/if \(t && typeof t\.focus === "function"\) t\.focus\(\);/.test(src),
  "★ 并把焦点送进目标框（少点一次、也不用猜该去哪儿填）");
ok(/prog\.textContent = why;/.test(src),
  "★★ 拒开原因**就地写在进度行**（不弹窗、也不静默——静默比弹窗更难查）");
ok(src.includes("if (S.trainer.target === null)") && src.includes("if (S.bpm >= S.trainer.target)"),
  "★ 两道闸都还在（空目标 / 当前速度已不低于目标）——只换了表达方式，判定不变");
ok(/if \(!S\.trainer\.on\)\{/.test(src),
  "★★ 拒开只作用于「开启方向」，关闭永远放行（否则会把用户锁在训练里）");
