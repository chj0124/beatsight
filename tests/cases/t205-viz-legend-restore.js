/* T205 图例的**恢复入口**（v3.34.5，2026-10-06 审计 A-1）
   ---------------------------------------------------------------------------
   v3.1.0 加图例时只留了一个**单向**出口：点「知道了」→ S.vizLegend=false → 落盘 →
   全文件再无任何一处能把它置回 true。按钮文案是低承诺的「知道了」（暗示"收起这条提示"），
   后果却是永久移除唯一的首屏读法锚点，且用户事后想再看只能去「使用方法」里翻文字。

   修复：设置 → 画面图层 增设一枚同款开关 `vizLegendToggle`，与 S.vizLegend **双向**绑定。
   本用例钉四件事：
     ① 出厂：图例可见 + 开关在"开"位（视觉 className 与语义 aria-checked 同源）；
     ② 点「知道了」→ 图例隐藏 **且开关同步翻到"关"**（否则开关说谎：图例没了它却说开着）；
     ③ 点开关 → 图例**重新出现**并落盘（这才是本修复的核心：老用户能自己找回来）；
     ④ 存过 false 的老用户重载 → 开关如实显示"关"，点一下即可恢复。
   ★ 与 T157 的分工：T157 钉「关闭即隐 + 记忆 + 不复活」，本用例钉「能再打开」。 */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 开关的"视觉"与"语义"必须同源（applyToggle 一处写全）——两条都断言，防只改一半 */
const clsOf = app => app.els["vizLegendToggle"].className;
const ariaOf = app => app.els["vizLegendToggle"]["aria-checked"];

section("T205 图例恢复入口 · 设置开关与「知道了」双向同步");
{
  /* ① 出厂：图例显示，开关在"开"位 */
  const fresh = loadApp();
  eq(fresh.beat.Store.S.vizLegend, true, "出厂默认 = 图例显示");
  eq(fresh.els["vizLegend"].hidden, false, "图例可见");
  ok(/\bon\b/.test(clsOf(fresh)), "★ 开关视觉在「开」位（className 含 on）");
  eq(ariaOf(fresh), "true", "★ 开关语义 aria-checked=true（与视觉同源）");

  /* ② 点「知道了」：图例隐藏，且开关**同步翻到关**（不许留在"开"位说谎） */
  fresh.els["vizLegendClose"].fire("click");
  eq(fresh.els["vizLegend"].hidden, true, "点「知道了」→ 图例隐藏");
  eq(fresh.beat.Store.S.vizLegend, false, "S.vizLegend = false");
  ok(/\boff\b/.test(clsOf(fresh)), "★★ 点「知道了」后开关同步翻到「关」（修复前恒为 on ⇒ 开关说谎）");
  eq(ariaOf(fresh), "false", "★★ 语义同步 aria-checked=false");

  /* ③ 点开关把它**打开**：图例重新出现（本修复的核心能力） */
  fresh.els["vizLegendToggle"].fire("click");
  eq(fresh.beat.Store.S.vizLegend, true, "★ 点开关 → S.vizLegend 翻回 true");
  eq(fresh.els["vizLegend"].hidden, false, "★★ 图例重新出现（修复前无任何入口能做到）");
  ok(/\bon\b/.test(clsOf(fresh)), "开关视觉回到「开」");
  eq(ariaOf(fresh), "true", "语义回到 aria-checked=true");

  /* 落盘：热键 250ms 防抖，断言前先冲 */
  fresh.beat.Store.flush();
  const saved = JSON.parse(fresh.storage.get("beatsight.state"));
  eq(saved.vizLegend, true, "确认「重新打开」已持久化（热键载荷）");

  /* ④ 存过 false 的老用户：重载后开关如实显示"关"，点一下即可恢复 */
  const old = loadApp(seedState({ vizLegend: false }));
  eq(old.els["vizLegend"].hidden, true, "老用户：图例不出现");
  ok(/\boff\b/.test(clsOf(old)), "★★ 重载后开关如实显示「关」（标记里写死的 on 不是真相）");
  eq(ariaOf(old), "false", "语义也是 false");
  old.els["vizLegendToggle"].fire("click");
  eq(old.els["vizLegend"].hidden, false, "★★ 老用户点一下就能把图例找回来");

  /* ⑤ 反向：开着也能关掉（双向，不是只能开） */
  old.els["vizLegendToggle"].fire("click");
  eq(old.beat.Store.S.vizLegend, false, "再点一次 → 关回去");
  eq(old.els["vizLegend"].hidden, true, "图例随之隐藏");

  /* ⑥ 源码钉：开关确实落在「设置 → 画面」页里（防搬块时把它挪丢）。
     ★ 用**位置区间**而不是"往前截 N 字符"：开关上方有一段长注释（说明为什么加它），
       截固定长度会被注释吃掉 ⇒ 断言假阴性（我第一版就踩了）。区间判据与注释长短无关。
     v3.45.0：边界从「画面图层组头 ↔ 环境组头」换成「画面页 ↔ 声音页」——
       六组折叠退役后组头没了，页面 section 边界是同强度的新锚。 */
  ok(html.includes('id="vizLegendToggle"'), "标记含 vizLegendToggle");
  const iTog = html.indexOf('id="vizLegendToggle"');
  const iPaneV = html.indexOf('id="setPaneVisual"');
  const iPaneA = html.indexOf('id="setPaneAudio"');
  ok(iPaneV >= 0 && iPaneA > iPaneV, "设置页的「画面」与「声音」两页边界都在");
  ok(iTog > iPaneV && iTog < iPaneA, "★ 它位于「画面」页内（与其余图层开关同页）");
}
