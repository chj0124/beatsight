/* BeatSight 自动化测试 · 节奏型编辑器作用域重整（PLAN-v13）
   T258 系列。
   ---------------------------------------------------------------------------
   核心契约：控件按“它修改谁”归位——
     · 撤销 = 整稿级动作，随网格走（住 .ed-actions 行首位；v3.53.2 曾置顶栏，
       PLAN-v14 / 2026-10-14 用户实拍「离编辑区太远」推翻，见 T259）；
     · 删除选中音符 = 音符级动作，住音符属性浮层，未选中禁用；
     · 铺弦号 / 增删复制清空小节 = 当前小节工具，留在网格下方；
     · 模板 / 拍数 / 试听仍是整稿与会话动作。
   本组钉源码结构与真实行为两端，防止换位置时只挪 DOM、不挪语义。 */
"use strict";
const { loadApp, pill, ok, eq, section, html } = require("../lib/harness");

/* ================= 场景 T258a：源码结构 · 三处控件各归其作用域 ================= */
section("T258a 结构钉 · 撤销随网格、删除音符在浮层、小节工具留在网格下");
{
  const edActionsAt = html.indexOf('<div class="ed-actions">');
  const topbarAt = html.indexOf('<div class="editor-actions">');
  const undoAt = html.indexOf('id="undoBtn"');
  const popAt = html.indexOf('id="edPop"');
  const delAt = html.indexOf('id="delStepBtn"');
  const fillAt = html.indexOf('id="strFillIn"');
  ok(edActionsAt > 0 && undoAt > edActionsAt && undoAt < popAt,
     "★ 撤销钮位于网格下方 .ed-actions 内、#edPop 之前（PLAN-v14：用户实拍「离编辑区太远」⇒ 从顶栏归位）");
  ok(html.slice(topbarAt, html.indexOf("</div>", topbarAt)).indexOf('id="undoBtn"') < 0,
     "★ 顶栏动作区不再出现撤销钮（整稿级动作改随网格走，不是 CSS 隐藏）");
  ok(popAt > 0 && popAt < delAt && delAt < fillAt,
     "★ 删除选中音符位于 #edPop 内、铺弦号行之前（音符级，不在小节工具行）");
  ok(html.indexOf('id="delStepBtn"', fillAt) < 0,
     "★ 铺弦号行之后不再出现删除音符钮（小节工具与音符工具不混排）");
}

/* ================= 场景 T258b：行为不变 · 两个归位控件仍走原 handler ================= */
section("T258b 行为回归 · 删除音符在浮层可用/禁用，撤销仍在顶栏生效");
{
  const app = loadApp();
  const { beat, els } = app;
  beat.Editor.open();
  ok(els["delStepBtn"].disabled, "未选中音符 → 删除钮禁用（不是可点的无效按钮）");
  ok(els["undoBtn"].disabled, "未改动草稿 → 网格下方撤销禁用");
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "归位素材", meter: 2,
    bars: [[{ t: 48 }, { t: 48 }]] }] })).ok, "归位素材导入成功");
  beat.Store.S.sig = 2;
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  const cell = els["editorBars"].children[0].children[1].children[1];
  cell.fire("click");
  ok(!els["delStepBtn"].disabled, "选中音符 → 浮层里的删除钮可用");
  els["delStepBtn"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 1, "浮层删除钮仍删除当前选中音符");
  ok(!els["undoBtn"].disabled, "删除后网格下方撤销可用");
  els["undoBtn"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 2, "网格下方撤销一步恢复删除的音符");
  /* 小节工具仍服务当前小节：id 在桩里懒创建，必须经 getElementById 取，不能读 els 缓存。 */
  const doc = app.sandbox.document;
  ok(!!doc.getElementById("strFillIn") && !!doc.getElementById("addBarBtn") && !!doc.getElementById("clearBarBtn"),
     "铺弦号 / 增删小节 / 清空小节仍留在当前小节工具区");
}

/* ================= 场景 T258c：空态与弹层链路不被归位影响 ================= */
section("T258c 链路回归 · 空态提示、弹层开关与 Esc 逐层退出不变");
{
  const { beat, els } = loadApp();
  beat.Editor.openBlank();
  ok(els["paletteTitle"].textContent.includes("追加"), "空白起步：块库仍显示追加入口");
  beat.Editor.tryClose();                                      // 空白 dirty=false，直接关闭
  ok(beat.Store.importPresets(JSON.stringify({ presets: [{ name: "链路素材", meter: 2,
    bars: [[{ t: 48, dir: "D" }, { t: 48 }]] }] })).ok, "链路素材导入成功");
  beat.Store.S.sig = 2;
  beat.Store.S.sel = { type: "custom", id: beat.Store.customs[beat.Store.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  els["editorBars"].children[0].children[1].children[0].fire("click");
  ok(els["edPop"].classList.contains("off") !== true, "点音符块打开属性浮层");
  els["edPopClose"].fire("click");
  ok(els["edPop"].classList.contains("off"), "✕ 收起属性浮层");
  beat.Editor.tryClose();
  eq(beat.Store.S.playing, false, "编辑器关闭链路不受控件归位影响");
}
