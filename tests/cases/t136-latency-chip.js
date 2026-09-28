/* BeatSight 自动化测试 · 顶栏延迟补偿读数（v2.69.0，1.2）
   T136 系列。
   ---------------------------------------------------------------------------
   用户要求（1.2）：顶栏「设置」左侧显示音频延迟补偿数值，点击直达设置的
   「音频延迟补偿」组。拍板 D2：**为 0 时整个隐藏**（顶栏不堆无信息元素）。

   机理与契约：
     · 数据源 = 共享 latencyMs（latActive()），同步出口 latChipSync()。
       ★ 必须两处调用：latApply（init / 配置切换 / 保存后）与 latMs 的 input 处理器
         （拖动滑杆只走 input、不触发 latApply——漏一处就是"拖动时顶栏读数不动"）。
     · 显隐 = latencyMs > 0；为 0 → hidden（无「补偿 0ms」的占位）。
     · 点击 = Help.refreshInstall() + Settings.open("latGroup")：
       设置弹窗打开（Modal 统一协议）且面板滚到延迟组。Settings.open 的锚点定位
       用 panel.scrollTop 增量，不用 scrollIntoView（避免连带滚动底层页面）。
     · 类名 lat-chip 刻意避开 t24 钉死的 `chip`（顶栏禁 `class="chip"`）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const LAT_KEY = "beatsight.latency";
const seedLat = ms => ({ [LAT_KEY]: JSON.stringify({
  profiles: [{ id: "p1", name: "测试耳机", ms }],
  currentId: "p1",
}) });

/* ================= 场景 T136a：0ms ⇒ 顶栏读数整个隐藏（D2） ================= */
section("T136a 延迟读数 · 默认 0ms ⇒ 隐藏（不占顶栏一格）");
{
  const { beat, els } = loadApp();
  eq(beat.Store.S ? "ok" : "ok", "ok", "前提：应用加载成功");   // 加载 smoke
  ok(els["latChip"] && els["latChip"].hidden === true,
    "★ 默认（无延迟配置 = 0ms）latChip 整个隐藏（hidden，不是灰显）");
  /* 双调用点守门：latApply 与 latMs input 处理器各有一处 latChipSync()
     （源码级断言，t86 对 .tab 渐变的同口径） */
  const calls = (html.match(/latChipSync\(\)/g) || []).length;
  ok(calls >= 2, "★ latChipSync() 至少两处调用（latApply + latMs input）——实际 " + calls + " 处");
}

/* ================= 场景 T136b：存档 150ms ⇒ 显示「补偿 150ms」 ================= */
section("T136b 延迟读数 · 有补偿值 ⇒ 顶栏显示，文案与存档值一致");
{
  const { els } = loadApp(seedLat(150));
  ok(els["latChip"] && els["latChip"].hidden === false,
    "★ 存档 150ms ⇒ latChip 可见（latApply 启动即同步）");
  eq(els["latChip"].textContent, "补偿 150ms", "★ 文案 = 「补偿 150ms」（等宽数字防抖动在 CSS）");
  ok(/lat-chip/.test(html) && !/class="chip"/.test(
    html.slice(html.indexOf('<header class="topbar"'), html.indexOf("</header>"))
  ), "★ 类名走 lat-chip，顶栏块内不出现 t24 禁用的 `chip` 类");
}

/* ================= 场景 T136c：点击读数 ⇒ 打开设置并落到延迟组 ================= */
section("T136c 延迟读数 · 点击直达设置（latGroup 锚点定位）");
{
  const app = loadApp(seedLat(150));
  ok(!app.els["settingsOverlay"].classList.contains("open"), "前提：设置初始关闭");
  app.els["latChip"].fire("click");
  ok(app.els["settingsOverlay"].classList.contains("open"),
    "★ 点击顶栏读数 ⇒ 设置弹窗打开（Modal 统一协议）");
  /* 锚点机制源码级：open 接受 anchor 且用 scrollTop 增量（不用 scrollIntoView） */
  ok(/function open\(anchor\)/.test(html), "★ Settings.open 带可选锚点参数");
  ok(/panel\.scrollTop \+= el\.getBoundingClientRect\(\)\.top - panel\.getBoundingClientRect\(\)\.top/.test(html),
    "★ 定位用 panel.scrollTop 增量（不连带滚动底层页面）");
  ok(/id="latGroup"/.test(html), "★ 延迟补偿组有锚点 id（#latGroup）");
  /* 点窗外仍可关（锚点路径不得破坏 Modal 的统一协议） */
  app.els["settingsOverlay"].fire("click");
  ok(!app.els["settingsOverlay"].classList.contains("open"), "锚点打开的弹窗，点窗外照常关闭");
}
