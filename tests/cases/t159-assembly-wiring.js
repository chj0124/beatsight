/* T159 装配区接线 · 抽屉搜索过滤 / Esc 键盘层 / 主钮开合（v3.1.0 批 1/2 的装配段）。
   这三条接线都住在**装配区**（非模块内），桩测此前无覆盖 → 行覆盖率分区掉到 90% 以下被闸门拦下。
   逐条点亮：搜索命中/未命中/自动展开折叠区/清空恢复、Esc 关抽屉、主钮 toggle 两个方向。 */
const { loadApp, ok, eq, section } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

const itemsOf = els => els["presetList"].children.filter(c => /(^| )preset-item( |$)/.test(c.className));
function fireKey(app, key, code){ app.fireWin("keydown", { key, code: code || key, ctrlKey: false, metaKey: false }); }

section("T159 装配接线 · 搜索过滤 / Esc / 主钮 toggle");
{
  const app = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  const { beat, els } = app;
  const S = beat.Store.S;

  /* ① 主钮 toggle：收起 → 点开；再点 → 收起（toggle 方向两个分支都要走） */
  els["presetLibBtn"].fire("click");
  eq(els["presetDrawer"].hidden, false, "★ 收起态点主钮 → 抽屉打开");
  els["presetLibBtn"].fire("click");
  eq(els["presetDrawer"].hidden, true, "★ 展开态再点主钮 → 收起（toggle 方向正确）");

  /* ② Esc 键盘层：开着时 Esc → 关 */
  els["presetLibBtn"].fire("click");
  eq(els["presetDrawer"].hidden, false, "前提：抽屉已开");
  fireKey(app, "Escape");
  eq(els["presetDrawer"].hidden, true, "★ Esc 关闭抽屉");
  fireKey(app, "Escape");
  eq(els["presetDrawer"].hidden, true, "关着时 Esc 不误触（幂等）");

  /* ③ 搜索过滤：命中者显、未命中隐、区头按区内命中显隐 */
  els["presetLibBtn"].fire("click");
  const inp = els["presetSearch"];
  inp.value = "华尔兹";
  inp.fire("input");
  const visAfter = itemsOf(els).filter(k => !k.hidden);
  ok(visAfter.length >= 1, "命中条目可见（华尔兹在节拍区）");
  ok(visAfter.every(k => k.children[0].children[0].textContent.toLowerCase().indexOf("华尔兹") >= 0),
    "★ 可见条目全部命中关键字");
  /* 命中区若折叠自动展开：扫弦区默认收起（foldInit），其条目全不含关键字 → 仍隐 */
  const secOf = els["presetList"].children.filter(c => c.className === "preset-section");
  eq(secOf[0].hidden, false, "命中区（节拍）区头展开");
  eq(secOf[1].hidden, true, "无命中区（扫弦）区头隐藏（不套折叠真值表，按命中口径）");
  /* 折叠着的命中区自动展开：把节拍区折叠 → 再搜 → 区头被顶开 */
  els["presetSearch"].value = "";
  els["presetSearch"].fire("input");
  S.fold.beat = false;                       // 收起节拍区
  beat.Presets.applyFold();
  els["presetSearch"].value = "四分基础";
  els["presetSearch"].fire("input");
  eq(secOf[0].hidden, false, "★ 折叠着的命中区被搜索自动顶开");
  els["presetSearch"].value = "";
  els["presetSearch"].fire("input");
  /* ④ 清空 → 折叠语义交还：折叠记忆（beat=false）重新生效 */
  eq(secOf[0].hidden, false, "★ 清空后 applyFold 交还：节拍区按折叠记忆展开");
  eq(secOf[1].hidden, false, "清空后扫弦区头恢复可见（成员按折叠记忆收起）");
}
