/* T205 图例的**恢复入口**（v3.34.5 审计 A-1 → ★ 本版口径更换）
   ---------------------------------------------------------------------------
   沿革：v3.1.0 只留单向出口（「知道了」→ false → 落盘 → 永不再出）；v3.34.5 在设置里补了
   双向开关。★ 本版（用户拍板）：设置开关退役，恢复入口换成**版本更新**——
   「知道了」记下关闭时的版本号（vizLegendVsn），同版本内不再出，发版回归一次。
   本用例钉四件事：
     ① 「知道了」是唯一关闭入口（设置里已无开关可点）；
     ② 关闭记版本，同版本重载不复活；
     ③ 版本更新后回归一次，且回归后能再关（新一轮记账，不是永久复活）；
     ④ 帮助文案如实说明这套生命周期（不再有「开关」说法）。
   ★ 与 T157 的分工：T157 钉「关闭即隐 + 同版本记忆 + 老存档口径」，本用例钉「能再回来」。 */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

section("T205 图例恢复入口 · 版本更新回归（设置开关已退役）");
{
  /* ① 「知道了」是唯一关闭入口：标记与源码里都不再有 vizLegendToggle */
  ok(!/id="vizLegendToggle"/.test(html), "① ★ 标记里已无 vizLegendToggle（开关退役）");
  ok(!/bindToggle\("vizLegendToggle"/.test(html), "① ★ 接线已删（无悬挂的绑定）");

  /* ② 关一次记版本，同版本重载不复活 */
  const vsn = loadApp().beat.VERSION;
  const app = loadApp();
  app.els["vizLegendClose"].fire("click");
  eq(app.beat.Store.S.vizLegendVsn, vsn, "② 关闭记下当前版本号");
  const same = loadApp(seedState({ vizLegendVsn: vsn }));
  eq(same.els["vizLegend"].hidden, true, "② ★ 同版本重载不复活");

  /* ③ 版本更新 → 回归一次，且回归后能再关（新一轮记账） */
  const newer = loadApp(seedState({ vizLegendVsn: "0.0.0" }));
  eq(newer.els["vizLegend"].hidden, false, "③ ★ 发版后图例回归一次（恢复入口 = 版本更新）");
  newer.els["vizLegendClose"].fire("click");
  eq(newer.els["vizLegend"].hidden, true, "③ ★ 回归后能再关（不是永久复活）");
  eq(newer.beat.Store.S.vizLegendVsn, vsn, "③ 再关 ⇒ 记下**当前**版本（新一轮记账起点）");

  /* ④ 帮助文案如实：说「本版本内不再出现、版本更新后会再出现一次」，不再提开关 */
  ok(html.includes("点「知道了」收起后本版本内不再出现，版本更新后会再出现一次"),
     "④ ★ 帮助文案如实描述版本维度生命周期");
  /* ★ 剥 HTML 注释后比对（t157 口径）：退役说明的注释里保留着旧开关文案的历史引证，
     不算「用户可见的旧文案」——否则注释自己会拦自己 */
  ok(!/图例 · 格宽=时值读法/.test(html.replace(/<!--[\s\S]*?-->/g, "")), "④ 旧开关的文案已从用户可见标记清干净（注释里的历史引证除外）");
}
