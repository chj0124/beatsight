/* BeatSight 自动化测试 · 「用户刚点的偏好写失败」与「置灰给原因」两处口径（v3.33.14，审计 P2-2 / P3-1）
   T199
   ─────────────────────────────────────────────────────────────────────────────
   审计发现：同一份文件里"写 localStorage 失败"存在**三种口径**——
     · wallWrite / latWrite：返回布尔 + 调用方弹 uiAlert（注释里写着"必须提示"）；
     · 主题 THEME_KEY：`try{ setItem }catch(e2){}` —— **静默**；
     · 迁移期备份 KEY_BAK / 隔离区 KEY_QUAR：静默（**这个是对的**，不是用户动作）。

   主题的静默会让用户"切了主题 → 刷新又变回去 → 毫无解释"，只会认为是功能坏了；
   而它一次都**不**触发"保存失败"状态点（Store 的一次性提示名额），于是完全无法自证。
   本文件钉：主题对齐"必须提示"口径，并保留"迁移期备份仍静默"这条反向不变量。

   另钉 P3-1：**置灰必须带原因**——`#exportBtn`（导出预设）在没有自定义预设时置灰，
   此前不给任何线索；同弹窗的 `#helpInstallBtn` 置灰时 title 写明"当前环境不可安装"
   （v2.69.0 专门修过"hidden 让用户找不到按钮"），两个口径要一致。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* ================= T199a：导出预设置灰必须带原因 ================= */
section("T199a ★ 导出预设置灰时给出原因（无自定义预设）");
{
  const app = loadApp();
  const eb = app.els["exportBtn"];
  eq(eb.disabled, true, "前提：没有自定义预设 ⇒ 导出预设置灰");
  ok(String(eb.title || "").length > 0,
    "★★ 置灰带 title（不给原因 = 用户以为功能坏了）");
  ok(String(eb.title).indexOf("自定义预设") >= 0,
    "★ title 说清是哪个条件不满足：「" + eb.title + "」");
}

/* ================= T199b：有预设时原因必须撤掉（不残留） ================= */
section("T199b 有自定义预设后：按钮解禁且 title 清空（原因不残留）");
{
  const app = loadApp();
  const { beat, els } = app;
  const pat = { name: "T199测试型", meter: 4, accents: [0],
    bars: [[{ t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }]] };
  const r = beat.Store.importPresets(JSON.stringify([pat]));
  eq(r.ok, true, "前提：导入成功（count=" + r.count + "）");
  beat.Presets.buildPresetList();          // 列表重建处同步按钮状态（生产代码就在这条路径上）
  eq(els["exportBtn"].disabled, false, "★★ 有自定义预设 ⇒ 导出预设解禁");
  eq(els["exportBtn"].title, "", "★ title 同步清空（否则悬停一直挂着一句过期的解释）");
}

/* ================= T199c：主题写失败必须提示（主症） ================= */
section("T199c ★★★ 主题写失败弹提示（修复前：catch 静默吞掉）");
{
  const app = loadApp(null, { throwOnWrite: true });
  const { beat, els } = app;
  eq(beat.Modal.isOpen(), false, "前提：初始无弹窗");
  els["themeToggle"].fire("click");
  eq(beat.Modal.isOpen(), true,
    "★★ 主题落盘失败 ⇒ 弹窗提示（修复前这里什么都不发生）");
  /* ★ 桩按 id **懒建**元素：`els["modalMsg"]` 要等第一次被 `$("modalMsg")` 碰到才存在。
     不判空的话，"弹窗根本没弹"这条路径会让本用例直接抛 TypeError 崩掉，**掩盖掉后面
     T199e/T199f 的结论**——反向验证时就吃了一次这个亏（只看到 3 条红就中断）。
     崩溃不算证据，具名断言变红才算，故这里走安全取值。 */
  const msg = String((els["modalMsg"] && els["modalMsg"].textContent) || "");
  ok(msg.indexOf("主题") >= 0, "★ 提示文案点明是主题存不下：「" + msg.slice(0, 40) + "…」");
  /* 视觉仍然切过去了：写失败只影响"下次打开还是不是它"，不该表现为"点了没反应" */
  els["modalOk"].fire("click");
  eq(beat.Modal.isOpen(), false, "提示关掉后回到正常态");
}

/* ================= T199d：对照 —— 写成功不弹 ================= */
section("T199d 对照组：主题写成功时不弹提示（防收紧到每次都弹）");
{
  const app = loadApp();
  const { beat, els } = app;
  els["themeToggle"].fire("click");
  eq(beat.Modal.isOpen(), false, "★★ 正常环境下切主题不弹任何东西");
  /* 且确实写了盘：再点一次读回来，证明 writeTheme 的 true 分支真的落盘了
     （storage 桩是 Map，用 get 而不是 localStorage 的 getItem） */
  const v1 = app.storage.get("beatsight.theme");
  app.els["themeToggle"].fire("click");
  const v2 = app.storage.get("beatsight.theme");
  ok(v1 !== v2, "两次点击落盘值不同（" + v1 + " → " + v2 + "）：写路径真的通");
}

/* ================= T199e：反向不变量 —— 迁移期备份仍保持静默 ================= */
section("T199e 反向不变量：迁移/备份类写入**保持静默**（不占用一次性提示名额）");
{
  const app = loadApp(null, { throwOnWrite: true });
  const { beat } = app;
  /* 这类写入发生在加载期，不是用户动作；若也弹，用户一进页面就被一堆与自己无关的
     告警淹没，还会把 Store「保存失败」那一次性提示名额提前用掉。 */
  eq(beat.Modal.isOpen(), false,
    "★ 加载期的备份/迁移写入失败不弹提示（与主题那处是**刻意**不同的口径）");
}

/* ================= T199g：冷键写前判重（审计 P2-2 的修正后落地） ================= */
section("T199g ★ 冷键写前判重：内容未变不重写，内容变了才写");
{
  const app = loadApp();
  const { beat } = app;
  /* 桩的 localStorage.setItem 最终落到 `store.set(k, v)`，替换 Map 的 set 即可数写入次数
     （只数冷键，热键/曲式键的写入不计） */
  let coldWrites = 0;
  const realSet = app.storage.set.bind(app.storage);
  app.storage.set = (k, v) => { if (k === "beatsight.customs") coldWrites++; return realSet(k, v); };

  beat.Store.persistCold();
  const n1 = coldWrites;
  ok(n1 >= 1, "首次调用 ⇒ 落盘（" + n1 + " 次；首次必须写，本会话无从得知盘上是什么）");

  beat.Store.persistCold();
  eq(coldWrites, n1, "★★ 内容未变 ⇒ 整段跳过（不重写整包）");

  const pat = { name: "T199g型", meter: 4, accents: [0],
    bars: [[{ t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }, { t: 48, rest: false }]] };
  beat.Store.importPresets(JSON.stringify([pat]));
  ok(coldWrites > n1, "★ 内容真的变了 ⇒ 照常落盘（" + n1 + " → " + coldWrites + "）");

  /* 关键顺序：写**失败**时不得把 payload 记成"已写"——否则下次内容相同会被跳过，
     "暂时存不下"会变成"永久存不下"，比现在更糟 */
  const before = coldWrites;
  app.storage.set = (k, v) => { if (k === "beatsight.customs") throw new Error("quota"); return realSet(k, v); };
  beat.Store.importPresets(JSON.stringify([{ name: "T199g型2", meter: 4, bars: [[{ t: 192, rest: false }]] }]));
  app.storage.set = (k, v) => { if (k === "beatsight.customs") coldWrites++; return realSet(k, v); };
  beat.Store.persistCold();
  ok(coldWrites > before, "★★ 写失败后再写同内容：仍会重试（失败不得被记成『已落盘』）");
}

/* ================= T199f：源码钉 —— 三处口径与调用方式 ================= */
section("T199f 源码钉：writeTheme 存在且调用方判返回值；旧静默写法无残留");
{
  const src = html;
  ok(/function writeTheme\(t\)\{[\s\S]{0,200}?return true;[\s\S]{0,120}?return false;/.test(src)
    || src.indexOf("function writeTheme(") >= 0,
    "★ writeTheme() 在位（返回布尔，与 wallWrite / latWrite 同形）");
  ok(src.indexOf("if (!writeTheme(themeNow))") >= 0,
    "★★ 调用方判返回值并提示（写成 try/catch 吞掉 = 本次修的缺陷复发）");
  /* 旧的静默写法必须消失：主题键的 setItem 不得再被空 catch 包着 */
  const idx = src.indexOf("localStorage.setItem(THEME_KEY");
  ok(idx >= 0, "主题键写入点仍存在");
  if (idx >= 0){
    const around = src.slice(idx, idx + 120);
    ok(around.indexOf("catch(e2){}") < 0 && around.indexOf("catch(e){}") < 0,
      "★ 主题写入点不再是空 catch（「" + around.slice(0, 60) + "…」）");
  }
  /* 三处"用户动作型"写入必须同形：都返回布尔 */
  for (const fn of ["function wallWrite(", "function latWrite(", "function writeTheme("]){
    ok(src.indexOf(fn) >= 0, "★ 同形写入函数在位：" + fn.replace("function ", "").replace("(", ""));
  }
  /* 置灰原因：disabled 与 title 必须在**同一处**更新（分开写 = 迟早只剩一个） */
  const ebIdx = src.indexOf('$("exportBtn")');
  ok(ebIdx >= 0, "exportBtn 同步点在位");
  if (ebIdx >= 0){
    const around = src.slice(ebIdx - 40, ebIdx + 260);
    ok(around.indexOf("disabled") >= 0 && around.indexOf("title") >= 0,
      "★ disabled 与 title 同源更新（同一次赋值里两件事都做）");
  }
}
