/* T157 首用图例条（v3.1.0，A1）——「首屏无锚点」的轻案：
   一行可关闭的图例（格宽 = 时值 · ↑↓ = 扫弦方向 · 灰格 = 休止），S.vizLegend 走热键全链路。
   钉四条：fresh 显示 / 关闭即隐 + 落盘 / 存过 false 重载不复活 / 默认 true 不主动落盘。
   ★ 默认值纪律（§4.14）：「没存过」= 显示（出厂值）；「存过 false」= 尊重用户——两者分开判。 */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

section("T157 图例条 · 显示 / 关闭 / 记忆 / 老用户不复活");
{
  /* ① fresh：默认显示（新用户第一分钟有锚点） */
  const fresh = loadApp();
  eq(fresh.beat.Store.S.vizLegend, true, "出厂默认 = 显示");
  eq(fresh.els["vizLegend"].hidden, false, "★ fresh boot 后图例可见");
  /* 桩不解析静态 DOM（children 为空、textContent 不聚合）→ 文案断言走源码（t107d/t141 口径） */
  ok(html.includes("格宽 = 时值"), "标记含「格宽 = 时值」");
  ok(html.includes("灰格 = 休止"), "标记含「灰格 = 休止」");
  ok(html.includes('id="vizLegendClose"'), "关闭钮在标记里");

  /* ② 关一次：立即隐藏 + 落盘（显式 persist：用户可能关完直接走） */
  fresh.els["vizLegendClose"].fire("click");
  eq(fresh.els["vizLegend"].hidden, true, "★ 点「知道了」→ 立即隐藏");
  eq(fresh.beat.Store.S.vizLegend, false, "S.vizLegend = false");
  fresh.beat.Store.flush();                       // 热键写入是 250ms 防抖，断言落盘前先冲
  const saved = JSON.parse(fresh.storage.get("beatsight.state"));
  eq(saved.vizLegend, false, "确认状态已持久化（热键载荷）");

  /* ③ 存过 false 的老用户：重载不复活（显式 false 尊重用户） */
  const old = loadApp(seedState({ vizLegend: false }));
  eq(old.beat.Store.S.vizLegend, false, "存过 false → 照读");
  eq(old.els["vizLegend"].hidden, true, "★ 重载后图例不出现");

  /* ④ 显式 true 与脏值口径：非 false 一律当显示（布尔开关只认 false 为关） */
  eq(loadApp(seedState({ vizLegend: true })).els["vizLegend"].hidden, false, "显式 true → 显示");
  eq(loadApp(seedState({ vizLegend: "x" })).els["vizLegend"].hidden, false, "脏值非 false → 显示（!== false 判据）");
}
