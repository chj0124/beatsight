/* T157 首用图例条（v3.1.0，A1）——「首屏无锚点」的轻案：
   一行可关闭的图例（格宽 = 时值 · ↑↓ = 扫弦方向 · 蓝虚线箭头 = 空扫）。
   ★ 本版（用户拍板）：关闭改**版本号维度**——「知道了」记下关闭时的版本号（vizLegendVsn），
   同版本内不再出现、版本更新则回归一次；设置页的双向开关已退役，「知道了」是唯一关闭入口。
   钉四条：fresh 显示 / 关闭即隐 + 记版本落盘 / 同版本重载不复活 / 换版本重载回归一次。
   存量口径：老存档的布尔 vizLegacy:false（无 vsn 可比）视同"旧版本关闭的"→ 回归一次（T157 ③'）。 */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const VERSION = () => loadApp().beat.VERSION;

section("T157 图例条 · 显示 / 关闭（版本号记账）/ 同版本记忆 / 发版回归");
{
  /* ① fresh：默认显示（新用户第一分钟有锚点） */
  const fresh = loadApp();
  eq(fresh.beat.Store.S.vizLegend, true, "出厂默认 = 显示（无 vizLegendVsn ⇒ 视同旧版本关闭 ⇒ 回归）");
  eq(fresh.els["vizLegend"].hidden, false, "★ fresh boot 后图例可见");
  /* 桩不解析静态 DOM（children 为空、textContent 不聚合）→ 文案断言走源码（t107d/t141 口径） */
  ok(html.includes("格宽 = 时值"), "标记含「格宽 = 时值」");
  /* ★ 本轮（用户拍板）：图例里「灰格」那一项整条撤出，改说明**空扫图标**——蓝虚线箭头
     （.strumv.ghost）是全页唯一没有文字解释、又最容易被误读成实扫的记号。
     ★ 反向断言剥 HTML 注释后比对：标记注释里保留着 v3.44.0「灰格 = 休止 → 空拍（不拨弦）」
       的考证原文（历史引证），不算「用户可见的旧文案」——否则注释自己会拦自己（首跑实证） */
  ok(html.includes('<i class="vl-swatch vl-air" aria-hidden="true"></i>蓝虚线箭头 = 空扫（假装在扫弦，但不触弦）'),
     "★ 空扫项 = 小示意块 + 说明文案（示意块与文案同项，缺一即红）");
  ok(!html.replace(/<!--[\s\S]*?-->/g, "").includes("灰格 = 空拍（不拨弦）"), "旧文案「灰格 = 空拍（不拨弦）」已从用户可见标记清干净");
  ok(!html.replace(/<!--[\s\S]*?-->/g, "").includes("灰格 = 休止"), "更早的「灰格 = 休止」也仍不在用户可见标记里");
  ok(html.includes('id="vizLegendClose"'), "关闭钮在标记里（本版它是唯一关闭入口）");
  ok(!/id="vizLegendToggle"/.test(html), "★ 设置开关已退役（恢复入口换成「版本更新」）");

  /* ② 关一次：立即隐藏 + 记下**当前版本号**落盘（显式 persist：用户可能关完直接走） */
  const vsn = VERSION();
  fresh.els["vizLegendClose"].fire("click");
  eq(fresh.els["vizLegend"].hidden, true, "★ 点「知道了」→ 立即隐藏");
  eq(fresh.beat.Store.S.vizLegend, false, "S.vizLegend = false");
  eq(fresh.beat.Store.S.vizLegendVsn, vsn, "★ S.vizLegendVsn = 当前版本号（版本维度记账）");
  fresh.beat.Store.flush();                       // 热键写入是 250ms 防抖，断言落盘前先冲
  const saved = JSON.parse(fresh.storage.get("beatsight.state"));
  eq(saved.vizLegendVsn, vsn, "确认版本号已持久化（热键载荷）");
  ok(!("vizLegend" in saved), "旧布尔键 vizLegend 不再写入热键载荷（持久键已换成 vizLegendVsn）");

  /* ③ 同版本重载：不复活（记下的版本号 = 当前版本 ⇒ 不显示） */
  const same = loadApp(seedState({ vizLegendVsn: vsn }));
  eq(same.beat.Store.S.vizLegend, false, "同版本重载 → S.vizLegend=false（不复活）");
  eq(same.els["vizLegend"].hidden, true, "★ 同版本内关一次永不再出");

  /* ③' 版本更新重载：回归一次（vsn ≠ 当前版本 ⇒ 显示）——本版的「恢复入口」 */
  const newer = loadApp(seedState({ vizLegendVsn: "0.0.0" }));
  eq(newer.beat.Store.S.vizLegend, true, "存过旧版本的 vsn → 版本已更新 ⇒ S.vizLegend=true");
  eq(newer.els["vizLegend"].hidden, false, "★ 发版后图例回归一次（新版可能有新读法要交代）");

  /* ④ 存量口径：老存档只有布尔 vizLegend:false（v3.1.0~v3.45.x 的旧键），无 vsn 可比
     ⇒ 视同"旧版本关闭的"——本次发版后再看到一次（「版本更新即回归」的自然推论） */
  const legacy = loadApp(seedState({ vizLegend: false }));
  eq(legacy.beat.Store.S.vizLegend, true, "★ 老存档 vizLegend:false 无 vsn ⇒ 回归一次（本版行为变更的钉子）");
  eq(legacy.els["vizLegend"].hidden, false, "★ 老用户升级后图例再出现一次，再点「知道了」按新记账");

  /* ⑤ 脏值口径：vizLegendVsn 只认字符串（防脏值把比较搞出意外） */
  const dirty = loadApp(seedState({ vizLegendVsn: 123 }));
  eq(dirty.els["vizLegend"].hidden, false, "非字符串脏值 → 当「没存过」 ⇒ 显示");
}
