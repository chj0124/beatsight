/* BeatSight 自动化测试 · 后台保活兜底失败可见化（v2.8.8，本轮审计「高」级项）
   T81 系列。
   ---------------------------------------------------------------------------
   要钉住的不是"兜底音频能不能响"，而是**它响不起来时会不会留下痕迹**。

   背景（本轮审计实测发现的两处静默失效，都在这条路径上）：
     ① `_headers` 的 CSP 此前没有 `media-src`，回落到 `default-src 'self'`，而 KeepAlive 的
        兜底是 `data:audio/wav` —— `data:` 不在 `'self'` 内，于是线上（Cloudflare 通道）
        这段音频被 CSP 拦掉，后台保活静默失效。已随 v2.8.8 补 `media-src 'self' data:`。
     ② 即便不被拦，`useAudioFallback()` 的三个出口（无 play / 抛错 / play 被拒）**全是空
        catch**，诊断面板上一个数字都没有 —— 用户只看到"切到后台声音停了"，无从归因。

   本组把 ② 关掉：三种失败都必须让 `diag.keepAliveFail` +1，而成功路径**必须保持 0**
   （否则"恒 0 = 正常"这个判据就没了，计数器会以假阳性把自己淹没）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 让 KeepAlive 走一次 acquire()：sync() 的判据是「开了保活 **且** 正在播放」，
   两个条件缺一都不会碰兜底路径（release() 那边不该有任何计数） */
/** @param {any} beat */
function arm(beat){
  beat.Store.S.keepAwake = true;
  beat.Store.S.playing = true;
  beat.KeepAlive.sync();
}

/* ================= 场景 T81：成功路径不计数（对照组） ================= */
section("T81 保活兜底 · 成功时 keepAliveFail 恒为 0（计数器的判据不能自己把自己淹没）");
{
  const { beat } = loadApp();
  arm(beat);
  eq(beat.KeepAlive.state().audio, true, "无 wakeLock 时降级为静音循环音频（既有行为未变）");
  eq(beat.diag.keepAliveFail, 0, "兜底成功 → 保活失败计数为 0");

  /* 反向验证：把"没走兜底"也算成失败的话，Chrome 上 wakeLock 成功时也会 +1，
     计数器就永远说谎了。故这里再确认一次 release() 侧同样不计数 */
  beat.Store.S.playing = false;
  beat.KeepAlive.sync();
  eq(beat.diag.keepAliveFail, 0, "release()（停止/关保活）不产生任何失败计数");
}

/* ================= 场景 T81b：play() 被拒 → 必须留痕 ================= */
section("T81b 保活兜底 · play() 被拒（自动播放策略 / CSP media-src）要留下计数");
{
  const { beat } = loadApp({}, { audioFail: "reject" });
  arm(beat);
  eq(beat.diag.keepAliveFail, 1, "play 被拒 → keepAliveFail +1（此前被空 catch 吞掉）");
  ok(JSON.stringify(beat.diag).indexOf("keepAliveFail") >= 0,
    "该计数进诊断报告（「复制诊断信息」里能看到，用户不必隔空描述症状）");
}

/* ================= 场景 T81c：环境无 play → 必须留痕 ================= */
section("T81c 保活兜底 · 环境根本没有 play() 也要留下计数");
{
  const { beat } = loadApp({}, { audioFail: "noplay" });
  arm(beat);
  eq(beat.diag.keepAliveFail, 1, "无播放能力 → keepAliveFail +1（不是静默放弃）");
  eq(beat.KeepAlive.state().audio, false, "失败时不谎报「兜底已起」");
}

/* ================= 场景 T81d：计数只在出事时占地方 ================= */
section("T81d 保活兜底 · 诊断面板只在非 0 时显示（恒 0 是正常态，不该占一行读数）");
{
  const good = loadApp({}, { location: { search: "?debug=1", protocol: "https:" } });
  arm(good.beat);
  const line0 = good.sandbox.document.body.children
    .filter(c => /(^| )diag( |$)/.test(c.className || ""))[0].children[1].textContent;
  ok(line0.indexOf("保活兜底失败") < 0, "成功路径的读数行里不出现「保活兜底失败」：" + line0);

  const bad = loadApp({}, { audioFail: "reject", location: { search: "?debug=1", protocol: "https:" } });
  arm(bad.beat);
  const line1 = bad.sandbox.document.body.children
    .filter(c => /(^| )diag( |$)/.test(c.className || ""))[0].children[1].textContent;
  ok(/⚠保活兜底失败 ×1/.test(line1), "失败时读数行带「⚠保活兜底失败 ×1」：" + line1);
}
