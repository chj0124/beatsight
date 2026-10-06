/* BeatSight 自动化测试 · 热键「写前判重」与冷键写入可观测（v3.36.5，审计 P2-1 / P2-2）
   T216
   ──────────────────────────────────────────────────────────────────────────────────────
   由来（2026-10-07 只读审计）：

   P2-2 —— `persistCold` 早在 v3.33.14 就有了"写前判重"（序列化后与"上次**成功**写入"的串
     比对，相同则整段跳过），而 `persistHotNow` **没有**：每个 250ms 防抖窗口都无条件
     `setItem`。热载荷只有 <1KB，单次代价不大，但 `persist()` 挂在几乎每次交互上
     （调速 / 每个开关 / TAP / 拖滑杆的 change），绝大多数窗口里载荷一个字节都没变 ——
     那是纯粹的同步写盘浪费（判重只多一次 stringify，而 stringify 比 setItem 便宜一个量级）。

   P2-1 —— 冷键那次**真的大写入**此前完全不可观测。Store 头部注释自己记着
     "500 预设 715 KB、主线程阻塞 5–20ms、正好会触发音频掉音"，而"掉音"这件事没有任何
     数字可核对：用户说"保存时卡了一下"，我方只能猜。
     ⇒ 本批**先只做可观测**（耗时 + 载荷两个标量），数字出来之前不动数据模型。

   ★★ 判重最关键的一条不变量：**只在写成功后才记 `lastHot`**。写失败时若也记，下次内容
     相同时会被跳过 ⇒ "存不下"会变成**永久**存不下，比改之前更糟。T216b 用
     `throwOnWrite`（隐私模式 / 配额超限）专门钉这一条。

   ★ 判重的判据用**哨兵**而不是"数调用次数"：`localStorage.setItem` 在桩里没有可插的钩子，
     但"盘上那个值有没有被换掉"是能读的——把盘上的值换成一个哨兵，再触发一次 flush：
     判重生效 ⇒ 哨兵留着；判重没生效 ⇒ 哨兵被真实载荷覆盖。这比数次数更硬，它连
     "写了但写的是旧内容"也能区分出来。

   反向验证（改坏后必须变红，已实测）：
     · 去掉 persistHotNow 的判重 → 「内容未变 ⇒ 盘上仍是哨兵」红；
     · 把"写成功后才记"改成"写前就记" → 「写失败后恢复写入」红；
     · 去掉 persistCold 的 diagColdWrite → 「冷键写入读数已记」红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* ================= T216a：内容未变 ⇒ 不重写 ================= */
section("T216a ★★ 热键写前判重：内容未变 ⇒ 不再写盘");
{
  const app = loadApp();
  const { beat } = app;

  /* 第 1 次：内容变了（出厂 96 → 100）⇒ 必须写。
     ★ 直调 persistHotNow：`persist()` 隔着 250ms 防抖窗口（桩里没有可推进的定时器），
       而判重是**同步**发生的——要看它生效没有，就得走这条不隔窗口的路径。 */
  beat.Controls.setBpm(100);
  beat.Store.persistHotNow();
  const p1 = app.storage.get("beatsight.state") || "";
  ok(p1.length > 0 && p1 !== "SENTINEL", "前提：第 1 次写入已落盘（内容变了就必须写）");

  /* 第 2 次：一个字节都没变 ⇒ 判重必须整段跳过 ⇒ 哨兵留在盘上 */
  app.storage.set("beatsight.state", "SENTINEL");
  beat.Store.persistHotNow();
  eq(app.storage.get("beatsight.state"), "SENTINEL",
    "★★ 内容未变 ⇒ 判重跳过，盘上仍是哨兵（若这条红 = 每次交互都在无条件重写）");

  /* 判重不得误伤"内容真变了"那一次：改 BPM 后必须写回去（哨兵被覆盖） */
  beat.Controls.setBpm(104);
  beat.Store.persistHotNow();
  ok(app.storage.get("beatsight.state") !== "SENTINEL",
    "★★ 内容变了 ⇒ 照常写（判重不能退化成永不写）");

  /* ★ flush() 是"现在就给我落盘"的语义，**不**参与判重：调用方要的是"盘上一定是当前状态"
     这个保证（visibilitychange / pagehide / 停机收尾都靠它），不是"省一次写"。 */
  app.storage.set("beatsight.state", "SENTINEL2");
  beat.Store.flush();
  ok(app.storage.get("beatsight.state") !== "SENTINEL2",
    "★★ flush() 无条件写（不参与判重）——它是生命周期收尾的保证，不是省写入的入口");
}

/* ================= T216b：写失败不污染判重记忆 ================= */
section("T216b ★★★ 写失败不得被判重吞掉（判重记忆只记成功的那次）");
{
  /* ★★ 关键不变量（同一会话内）：失败 → 恢复 → 同样的内容**还能**写出去。
     若失败时也记 lastHot，恢复那次会被判重吞掉 ⇒ "存不下"变成**永久**存不下，比改之前更糟。
     ★ 必须在**同一份 app** 里做：`lastHot` 是模块级状态，换一个 loadApp 就是另一份记忆。
     ★ 失败用"换掉 sandbox 的 setItem"注入（而不是 throwOnWrite）：后者一旦装上就整会话
       都是坏的，没法在同一份 app 里演示"恢复了"。 */
  const app = loadApp();
  const realSet = app.sandbox.localStorage.setItem;
  const f0 = app.beat.diag.persistFail;
  app.beat.Controls.setBpm(110);
  app.sandbox.localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  app.beat.Store.persistHotNow();      // 失败被 onPersistFail 接住（不向外抛）
  ok(app.beat.diag.persistFail > f0, "前提：写盘失败被计数接住（模拟隐私模式 / 配额超限）");

  app.sandbox.localStorage.setItem = realSet;         // 恢复可写
  app.beat.Store.persistHotNow();                    // 内容一个字节都没变
  const raw = app.storage.get("beatsight.state") || "";
  ok(raw.indexOf("110") >= 0,
    "★★★ 写失败过的同一份内容，恢复可写后仍然落盘（判重记忆不得被失败污染）");
}

/* ================= T216c：冷键写入有实测读数 ================= */
section("T216c ★ 冷键写入的可观测读数（耗时 / 载荷）");
{
  const app = loadApp();
  const { beat } = app;

  eq(beat.coldWrite().ms, -1, "前提：本次会话还没有冷键写入 ⇒ 读数是 -1（不是假 0）");

  const pat = { name: "T216型", meter: 4, accents: [0],
    bars: [[{ t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }]] };
  const r = beat.Store.importPresets(JSON.stringify([pat]));
  eq(r.ok, true, "前提：导入成功（它会走一次冷键写入）");

  const cw = beat.coldWrite();
  ok(cw.ms >= 0, "★★ 冷键写入记下了耗时（ms=" + cw.ms + "）——「掉了多少音」从此有数字可核对");
  ok(cw.chars > 0, "★★ 同时记下载荷字符数（chars=" + cw.chars + "）");

  /* 读数出现在诊断报告里（报障时复制的就是这一份） */
  const rep = beat.Diagnostics.diagReport();
  ok(rep.indexOf("冷键写入") >= 0, "★ 诊断报告含「冷键写入」一行（用户报障能直接贴出来）");
  ok(rep.indexOf("ms") >= 0, "★ 报告里带单位（ms），读的人不必猜");
}
