/* BeatSight 自动化测试 · 训练计划 / 保活 / PWA / 音色响度 / 下载通道
   T40–T46b（v2.10.12：原 T37/T38/T39/T46「练习统计与练习记录」各组随功能删除，
   文件名由 t37-stats-and-training 改为 t37-training-and-keepalive，只剩训练计划与保活）。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, pill, ok, eq, near, section, drive } = require("../lib/harness");

/* ================= 场景 T40：训练完成 / 中途停（v2.11.2：接续记录 last 已删） ================= */
section("T40 训练 · 完成自动停止 / 中途手动停（v2.11.2：不再产出 last）");
{
  /* 完成路径：从 70 爬到 90，步长 10，每级 1 小节 */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, target: 90, step: 10, everyN: 1 } }) });
  beat.Controls.setBpm(70, false);          // v2.11.2：起点 = 开播时的当前 BPM
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 30);
  ok(!beat.Store.S.playing, "练到目标自动停止");
  eq(els["statusText"].textContent, "训练完成 · 达到 90 BPM", "完成提示文案");
  /* v2.11.2：last 已删——按钮没了它就是一份没人读的存档（v2.10.12 删练习记录的同一口径） */
  ok(!("last" in beat.Store.S.trainer), "v2.11.2：不再产出 last 接续记录");

  /* 中途手动停：练 ~8s 后 stop，不停在目标 */
  const app2 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, target: 200, step: 10, everyN: 4 } }) });
  app2.beat.Controls.setBpm(70, false);
  app2.beat.Controls.start();
  drive(FakeAudioContext.last, app2.beat, 8);
  app2.beat.Controls.stop();
  ok(!app2.beat.Store.S.playing, "中途停 → playing=false");
  ok(!("last" in app2.beat.Store.S.trainer), "中途停也不记 last");
  app2.beat.Store.flush();
  const savedHot = JSON.parse(app2.storage.get("beatsight.state"));
  ok(!savedHot.trainer.last, "热键里不再有 last 字段");
}

/* ================= 场景 T41：起点 = 开播时的当前 BPM（v2.11.2） ================= */
section("T41 训练 · 起点 = 当前 BPM + 速度已达标不给开");
{
  /* 起点语义：把速度调到 100 再开播 → 从 100 开始爬（此前是 start() 拽到存档起始值） */
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: true, target: 120, step: 10, everyN: 1 } }) });
  const S = beat.Store.S;
  beat.Controls.setBpm(100, false);
  beat.Controls.start();
  eq(S.bpm, 100, "起播速度 = 开播时的当前 BPM 100");
  const seq = [S.bpm];
  const stopped = drive(FakeAudioContext.last, beat, 40, () => {
    if (S.bpm !== seq[seq.length - 1]) seq.push(S.bpm);
  });
  ok(stopped, "练到目标自动停止");
  eq(JSON.stringify(seq), JSON.stringify([100, 110, 120]), "爬坡序列 100→110→120（起点即当前速度）");
  beat.Controls.stop();

  /* 边界（用户选 A）：当前速度已 ≥ 目标 → 点开关不给开 + 提示，参数行也保持隐藏 */
  const app2 = loadApp({ "beatsight.state": JSON.stringify({ v: 3,
    trainer: { on: false, target: 90, step: 10, everyN: 1 } }) });
  app2.beat.Controls.setBpm(96, false);     // 默认 96 已高于目标 90
  app2.els["trainerToggle"].fire("click");
  eq(app2.beat.Store.S.trainer.on, false, "当前速度 ≥ 目标 → 开关没被打开（选 A：不给开）");
  eq(app2.els["trainerPanel"].hidden, true, "参数行保持隐藏");
  /* 把目标调到高于当前速度后即可正常开启，参数行露出 */
  app2.els["trTarget"].value = "150";
  app2.els["trTarget"].fire("change");
  app2.els["trainerToggle"].fire("click");
  eq(app2.beat.Store.S.trainer.on, true, "目标调高后开关可正常开启");
  eq(app2.els["trainerPanel"].hidden, false, "参数行露出（在开关右侧）");
}

/* ================= 场景 T42：后台保活（v1.4） ================= */
section("T42 KeepAlive · wakeLock 优先 / 静音音频兜底 / 开关持久化");
{
  /* 默认关；扳动后 persist 落盘 */
  const { beat, els, storage } = loadApp();
  const S = beat.Store.S;
  eq(S.keepAwake, false, "后台保活默认关");
  els["keepAwakeToggle"].fire("click");
  eq(S.keepAwake, true, "扳动后 keepAwake=true");
  ok(els["keepAwakeToggle"].classList.contains("on"), "开关视觉同步 on");
  eq(els["keepAwakeToggle"].getAttribute("aria-checked"), "true", "aria-checked 同源");
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).keepAwake, true, "开关状态持久化到热键");
  const app2 = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(app2.beat.Store.S.keepAwake, true, "重载后开关仍是开");

  /* wakeLock 路径：start 申请、stop 释放（同步 thenable 避免异步编排） */
  const calls = [];
  const lockObj = { released: false, release(){ this.released = true; }, addEventListener(){} };
  const nav = { wakeLock: { request(t){ calls.push(t); return { then(fn){ fn(lockObj); return { catch(){} }; } }; } } };
  const app3 = loadApp({}, { navigator: nav });
  app3.beat.Store.S.keepAwake = true;
  app3.beat.Controls.start();
  eq(JSON.stringify(calls), JSON.stringify(["screen"]), "播放中+开关开 → 申请 wakeLock('screen')");
  ok(app3.beat.KeepAlive.state().locked, "锁已持有");
  app3.beat.Controls.stop();
  ok(lockObj.released, "停止 → 释放 wakeLock");

  /* 无 wakeLock（iOS 老版本）→ 静音循环 audio 兜底；stop 释放 */
  const app4 = loadApp({}, { navigator: {} });
  app4.beat.Store.S.keepAwake = true;
  app4.beat.Controls.start();
  ok(app4.beat.KeepAlive.state().audio, "无 wakeLock → 静音音频兜底已起");
  app4.beat.Controls.stop();
  ok(!app4.beat.KeepAlive.state().audio, "停止 → 静音音频已停");

  /* 开关关着 → 播放也不申请任何保活 */
  const app5 = loadApp({}, { navigator: nav });
  app5.beat.Controls.start();
  eq(calls.length, 1, "开关关 → 播放不申请 wakeLock");
  app5.beat.Controls.stop();
}

/* ================= 场景 T42b：保活竞态 · 唤醒锁授予晚于释放（P1-1） ================= */
section("T42b KeepAlive · 请求落定晚于释放时不得补持唤醒锁");
{
  /* 反向验证锚点：request 异步落定晚于 release——落定前用户已停止播放/关掉开关，
     唤醒锁不能"补持"。旧实现 .then 里无条件 lock = l，锁会永久持有（state().locked 恒 true），
     直到页面隐藏被系统回收：开关关了但没关，静默耗电。 */
  const late = [];
  const lateLock = { released: false, release(){ this.released = true; }, addEventListener(){} };
  /* 手动可控 thenable：回调先攒起来，测试里显式"落定" */
  const navLate = { wakeLock: { request(){ return { then(fn){ late.push(fn); return { catch(){} }; } }; } } };
  const app = loadApp({}, { navigator: navLate });
  app.beat.Store.S.keepAwake = true;
  app.beat.Controls.start();               // 播放中 → acquire() 发起申请，回调入队（尚未落定）
  eq(late.length, 1, "申请已发起但尚未落定");
  app.beat.Controls.stop();                // 落定前停止播放 → release() 此时 lock 仍为 null
  ok(!app.beat.KeepAlive.state().locked, "释放时锁尚未持有（竞态窗口已出现）");
  late[0](lateLock);                       // 现在才落定：旧实现会在此无条件补持
  ok(!app.beat.KeepAlive.state().locked, "★ 落定晚于释放：唤醒锁不得被补持（P1-1 反向验证锚点）");
  ok(lateLock.released, "★ 过期的锁就地释放，不留给系统回收");

  /* 对称路径：申请被拒后的降级落定同样可能已过期，不得再起静音音频兜底 */
  const rejections = [];
  const navRej = { wakeLock: { request(){ return { then(){ return { catch(fn){ rejections.push(fn); } }; } }; } } };
  const app2 = loadApp({}, { navigator: navRej });
  app2.beat.Store.S.keepAwake = true;
  app2.beat.Controls.start();              // 需要保活 → acquire 发起申请，拒绝回调入队
  eq(rejections.length, 1, "拒绝回调已入队（尚未落定）");
  app2.beat.Controls.stop();               // 落定前停止播放
  rejections[0]();                         // 现在才落定拒绝：旧实现会在此起音频兜底
  ok(!app2.beat.KeepAlive.state().audio, "★ 落定晚于释放：被拒的降级不得再起音频兜底（对称锚点）");
}

/* ================= 场景 T43：PWA 注册按协议收口（v1.4） ================= */
section("T43 PWA · 仅 http(s) 注册 manifest + sw.js，file:// 完全跳过");
{
  /* file://：serviceWorker 在场也不许注册 */
  const regCalls = [];
  const navSW = { serviceWorker: { register(u){ regCalls.push(u); return { catch(){} }; } } };
  loadApp({}, { location: { protocol: "file:" }, navigator: navSW });
  eq(regCalls.length, 0, "file:// 协议 → 不注册 SW（单文件双击场景零副作用）");

  /* 无 location（极老/测试环境）→ 整段跳过不抛错（前面全部用例已在跑这条路径） */
  ok(true, "无 location 环境已在全部既有用例中验证不抛错");

  /* https：注册 sw.js + 注入 manifest link */
  const app = loadApp({}, { location: { protocol: "https:" }, navigator: navSW });
  eq(JSON.stringify(regCalls), JSON.stringify(["sw.js"]), "https → 注册 sw.js");
  const link = app.sandbox.document.head.children.find(c => c.rel === "manifest");
  ok(!!link && link.href === "manifest.webmanifest", "https → <link rel=manifest> 指向 manifest.webmanifest");

  /* 无 serviceWorker 能力（老浏览器）→ 只注入 manifest，不抛错 */
  const app2 = loadApp({}, { location: { protocol: "https:" }, navigator: {} });
  ok(!!app2.sandbox.document.head.children.find(c => c.rel === "manifest"), "无 SW 能力 → manifest 仍注入");
}

/* ================= 场景 T44：音色响度 · 噪声路径 makeup 增益补偿（v1.4.1） ================= */
section("T44 音色响度 · 木鱼/军鼓/踩镲 makeup 补偿，振荡器路径不受影响");
{
  /* 用户实拍：木鱼调到最大仍听不清。根因：滤波噪声路径缺 makeup gain——
     带通 Q=8 后噪声幅度只剩 ~1/14（≈−23dB），包络峰值却与振荡器路径同值。
     修复：noiseHit 按 min(makeup, peak × makeup) 送增益；上限=makeup 本身
     （= 满音量重拍应达到的增益，天然天花板；削波看信号幅度不看增益值，滤波噪声安全）。
     参照（vol=0.8, accentVol=1）：accent peak=0.8 / beat=0.64 / sub=0.4 */
  const noiseGain = (timbre, filterFreq, extra) => {
    /* sel idx 2（八分摇滚，无扫弦记谱）：v2.7.1 起带扫弦记谱的谱（如民谣扫弦）归扫弦声部，
       测全局音色的层级增益必须用无扫弦记谱的型 */
    const { beat } = loadApp({ "beatsight.state": JSON.stringify(Object.assign(
      { v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre, sel: { type: "builtin", idx: 2 } }, extra || {})) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const h = ac.hits.find(x => x.kind === "noise" && x.filterFreq === filterFreq);
    return h ? h.gain : undefined;
  };
  const MK = 14;                    // wood.makeup 的规格值：硬编码，不读 CONFIG——
  const DM = { snare: 5, hat: 2.5 };// 读 CONFIG 算期望值会让「改错 CONFIG」两边一起变（自指，反向验证会漏）

  near(noiseGain("wood", 2000), 0.8 * MK, 1e-6, "木鱼重拍 = 0.8 × makeup（补偿后）");
  near(noiseGain("wood", 1500), 0.64 * MK, 1e-6, "木鱼正拍 = 0.64 × makeup");
  near(noiseGain("wood", 1100), 0.4 * MK, 1e-6, "木鱼细分 = 0.4 × makeup");
  ok(noiseGain("wood", 2000) > noiseGain("wood", 1500)
     && noiseGain("wood", 1500) > noiseGain("wood", 1100), "木鱼层级保持：重拍 > 正拍 > 细分");

  near(noiseGain("drum", 1800), 0.64 * DM.snare, 1e-6, "军鼓 = 0.64 × snareMakeup");
  near(noiseGain("drum", 8000), 0.28 * DM.hat, 1e-6, "踩镲 = 0.28（含 hatGain 0.7）× hatMakeup");
  /* 底鼓是振荡器（sine 扫频，sweepTo=50），不得被 makeup 波及 */
  {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre: "drum", sel: { type: "builtin", idx: 2 } }) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const kick = ac.hits.find(x => x.kind === "osc" && x.sweepTo === 50);
    ok(kick && Math.abs(kick.gain - 0.8) < 1e-6, "底鼓（振荡器路径）增益不变 = 0.8");
  }
  /* click 路径完全不受影响（T18 已全量程覆盖，此处补一条噪声开关存在时的对照） */
  {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre: "click" }) });
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const h = ac.hits.find(x => x.kind === "osc" && x.freq === 1568);
    ok(h && Math.abs(h.gain - 0.8) < 1e-6, "click 重拍增益不变 = 0.8");
  }
  /* 上限 = makeup 本身：满音量重拍恰好顶到天花板，不会越界 */
  near(noiseGain("wood", 2000, { vol: 1 }), MK, 1e-6, "满音量时木鱼重拍 = makeup（天花板），不越界");
  /* 脏 makeup 回退 1（不补偿也不炸） */
  {
    const { beat } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1, bpm: 120, timbre: "wood" }) });
    beat.CONFIG.timbres.wood.makeup = "x";          // 直接污染配置（模拟未来改坏）
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 3);
    beat.Controls.stop();
    const h = ac.hits.find(x => x.kind === "noise" && x.filterFreq === 2000);
    ok(h && Math.abs(h.gain - 0.8) < 1e-6, "脏 makeup → 回退不补偿（0.8），不产 NaN");
  }
}

/* ================= T45：v2.11.2 —— 7 天计划整条功能下线，本组随之下线 =================
   v1.5 的「7 天计划」本质是「把起始/目标切成 7 段」的二次封装；v2.11.2 删掉「起始」参数
   （起点改为当前 BPM）之后它没有了立足点，故整条删除——含 `S.plan` 字段、今日卡 UI
   与 `planStartBtn / planEndBtn / planGenBtn` 三个入口。
   本组原 6 个场景（生成 / 今日参数 / 完成推进 / 顺延 / 收官 / 脏数据回退）**全部删除**，
   不留"占位断言"：断言一个已不存在的元素只会让套件虚胖。
   ★ 与 v2.10.12 删「练习统计」时的处理保持一致：功能删了，它的用例也一并删。 */

/* ================= 场景 T46b：下载通道去重（v2.0.2 审计 · 去重下载） ================= */
section("T46b 下载通道 · 「导出预设」与「导出全部数据」共用同一个 downloadJSON（v2.0.2 审计 · 去重下载）");
{
  /* 原先两条出口各写一份「Blob → createObjectURL → 造 <a download> → 追加/click/移除 → 延时 revoke」
     （连 1s 延时都一样）。重复实现的典型故障是"改一处漏一处"——例如给文件名加前缀时只改了一边。
     统一成 Store.downloadJSON(kind, text) 后，两条出口必须共用同一模板
     beatsight-<kind>-YYYYMMDD.json。用 spy 把"共用"钉死：createObjectURL 各一次、<a download>
     各命中模板、两条都排程了 revoke（漏掉清理正是重复代码最易漏的一处）。
     ★ v2.10.12：原第二条出口是「导出记录」（练习统计的 `#statsExport`），统计删除后改用
     「导出全部数据」（`#exportAllBtn`，现在在设置弹窗里）——它走的是同一份 `downloadJSON` */
  const mk = i => ({ name: "P" + i, meter: 4, bars: [0, 1, 2, 3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) });
  const app = loadApp({
    "beatsight.customs": JSON.stringify({ v: 1, customs: [mk(1)] }),
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "a1", name: "曲式",
      sections: [{ name: "s", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1 }] }] }] }),
  });
  const urls = [], anchors = [], revoked = [];
  app.sandbox.URL.createObjectURL = blob => { urls.push(blob); return "blob:spy" + urls.length; };
  app.sandbox.URL.revokeObjectURL = u => { revoked.push(u); };
  const realCreate = app.sandbox.document.createElement;
  app.sandbox.document.createElement = tag => {
    const el = realCreate(tag);
    if (el.tagName === "A") anchors.push(el);        // downloadJSON 只造 <a>，不会误捕别的元素
    return el;
  };
  const d = new Date(), p2 = n => String(n).padStart(2, "0");
  const dateTag = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;

  ok(app.beat.Store.exportPresets(), "「导出预设」返回 true（有预设）");
  ok(app.beat.Store.exportAll(), "「导出全部数据」返回 true");

  eq(urls.length, 2, "★ 两条出口都经由同一个 downloadJSON（createObjectURL 各一次，没有第三份副本）");
  eq(JSON.stringify(anchors.map(a => a.download)),
     JSON.stringify(["beatsight-presets-" + dateTag + ".json", "beatsight-all-" + dateTag + ".json"]),
     "★ 两条出口共用同一文件名模板 beatsight-<kind>-YYYYMMDD.json");
  ok(anchors.every(a => a.href.indexOf("blob:") === 0), "两条出口都指向 createObjectURL 建的 blob 地址");
  app.runTimers();
  eq(revoked.length, 2, "★ 两条出口都排程了 revokeObjectURL（漏掉清理正是这次去重要消灭的重复代码故障）");
}
