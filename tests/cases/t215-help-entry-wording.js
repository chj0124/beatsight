/* BeatSight 自动化测试 · 帮助正文的指路不得过期 + BPM 控件锁定口径一致（v3.36.5，审计 A-1 / A-2 / A-3 / P3-1 / P3-2 / P3-5）
   T215
   ──────────────────────────────────────────────────────────────────────────────────────
   由来（2026-10-07 只读审计，三视角走查的 A 类确定性问题）：

   A-1 / P3-1 —— 帮助页「三步上手」第 1 步原写「**右侧**「节奏型预设库」里选一个（或点
     「**编辑节奏型**」自己画一个）」。而右侧竖栏在 v3.0.0 就已取消（CSS 注释原文：
     「右侧竖栏（aside 360px）取消——预设库缩小成控制行第 4 块 + 全宽抽屉」），预设库入口
     今天是**底栏胶囊 + 左侧覆盖面板**；「编辑节奏型」这个**入口名**也在 v3.3.0 改成了
     「新建节奏型」（改名证据在 Controls 段注释里）。
     ⇒ 新用户按第一条指路，两个名词都找不到 —— 这是"必然触发"的：不依赖任何异常环境，
       只要用户读帮助文字去找控件就会撞上。

   A-3 —— `#presetLibBtn` 的可见文字只有「当前 <型名> ▾」，它读作**状态读数**而不是
     "在这里换型"的入口；而 README 描述的是「浏览节奏型 ▾」主钮。本机无法验观感，
     故这里只钉**机器可判**的那半：胶囊必须带动作语义（可见的 CTA 与 title）。

   A-2 / P3-5 —— 变速训练开启时 `syncBpmUI` 锁 `bpmSlider` / 快捷档 / ±5，
     **唯独没锁 `bpmMinus` / `bpmPlus`（±1）**。而 ±1 与 ±5 的后果逐字相同
     （点完数字会变、下一小节边界被 Trainer 的阶梯值覆盖 = "点了等于白点"）。
     同一条理由只覆盖一半控件，是最容易被当成"应用坏了"的那种不一致。

   P3-2 —— 壁纸拒图文案把「1600」写死在字符串里，而同一策略的常量是 `WALL_MAX_EDGE`。
     ★ 本条**不写用例**：那条文案在 `Modal.uiAlert` 里现拼，桩上要把它拦下来得盯弹窗内容，
       成本高于收益；改成引常量后"漂移"这件事本身已不可能发生（同一个标识符），
       故只在 CHANGELOG 记一行，不占一个用例编号。

   反向验证（改坏后必须变红，已实测）：
     · 把帮助第 1 步改回「右侧」→ 「帮助正文不含『右侧』」红；
     · 把 CTA 那枚 span 删掉 → 「胶囊带动作语义」红；
     · 把 syncBpmUI 里新增的两行删掉 → 「±1 与 ±5 同锁」红。
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");
const fs = require("fs");
const path = require("path");
/* 直接读 index.html（与 harness 同源；显式读一次是为了让"帮助正文区间"这把切片刀的边界
   在本文件里看得见——区间取错会让下面所有断言变成空集上的恒真） */
const html = fs.readFileSync(
  process.env.BEATSIGHT_HTML || path.join(__dirname, "..", "..", "index.html"), "utf8");

/* 帮助浮层的标记区间：#helpOverlay → #settingsOverlay（文档序里设置浮层紧跟其后）。
   ★ 两个坑都是真踩过的：
     · 按"起止 id"取 earOverlay 会拿到**空串**（听辨浮层在帮助**之前**，文档序 ≠ 编号序）
       ——空串上每条断言都恒真，是典型的假绿；
     · 切片必须止于下一个浮层之前，否则会把 helpOverlay 与 settingsOverlay 之间那段
       "为什么要有设置弹窗"的**注释**（里面合法地提到了已取消的侧栏）扫进来。
   切片后再剥注释：注释里的历史引文允许提及老名字，用户看不到，**不算 UI 文案**。 */
const HELP_START = html.indexOf('id="helpOverlay"');
const HELP_END = html.indexOf('id="settingsOverlay"');
const HELP_RAW = (HELP_START >= 0 && HELP_END > HELP_START) ? html.slice(HELP_START, HELP_END) : "";
const HELP = HELP_RAW.replace(/<!--[\s\S]*?-->/g, "");   // 剥注释：只留用户看得见的正文

/* ================= T215a：帮助正文不得指向已取消的入口 ================= */
section("T215a ★★ 帮助正文的指路不得过期（新用户的第一条指路文字）");
{
  ok(HELP_START >= 0 && HELP_END > HELP_START && HELP.length > 1000,
    "前提：定位到帮助浮层标记区间（非空切片 · 止于下一个浮层之前）");

  /* ★ 只钉"侧栏"：侧栏 v3.0.0 已整体取消，帮助正文里任何一处指路到它都是错的。
     （"右侧"不钉：正文里"参数在开关右侧""播放条右侧"都是**现存**的正确方位描述。） */
  ok(HELP.indexOf("侧栏") < 0,
    "★★ 帮助正文不含『侧栏』——侧栏已取消，指路到它会让人去找一个不存在的区域");

  /* 指路必须指到**现存的入口名**：今天打开预设库的那枚胶囊叫「浏览节奏型」，
     库里画新型的动作叫「新建节奏型」（v3.3.0 从「编辑节奏型」改的名） */
  ok(HELP.indexOf("浏览节奏型") >= 0, "★★ 帮助正文指到现存入口名『浏览节奏型』");
  ok(HELP.indexOf("新建节奏型") >= 0, "★★ 帮助正文指到现存动作名『新建节奏型』");
  ok(HELP.indexOf("节奏型预设库") < 0,
    "★★ 帮助正文不再用已退役区名『节奏型预设库』（现为「预设库」+ 胶囊入口）");
}

/* ================= T215b：预设库胶囊必须带动作语义 ================= */
section("T215b ★ 预设库胶囊带动作语义（不只是一句状态读数）");
{
  const m = html.match(/<button[^>]*id="presetLibBtn"[^>]*>[\s\S]*?<\/button>/);
  ok(!!m, "前提：能从标记里取出 #presetLibBtn 整枚按钮");
  const btn = m ? m[0] : "";
  /* 可见文字（去标签、去注释、去属性）——断言的是**用户眼睛看到的**，不是属性里的字 */
  const visible = btn.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "");
  ok(visible.indexOf("浏览节奏型") >= 0,
    "★★ 胶囊可见文字含动作词『浏览节奏型』（否则整枚钮看起来只是『当前 X』的读数）"
    + (visible ? "（实际可见文字：" + visible.replace(/\s+/g, "") + "）" : ""));
  ok(/aria-expanded="false"/.test(btn),
    "前提不变：胶囊仍带 aria-expanded（开合语义没被这次改动带走）");
  ok(btn.indexOf('id="patternName"') >= 0,
    "前提不变：型名仍住在胶囊里（t165 钉的「全页面只此一处」不得被破坏）");
}

/* ================= T215c：变速训练开启 ⇒ BPM 控件同口径全锁 ================= */
section("T215c ★★ 变速训练开启时 ±1 与 ±5 同锁（口径一致，不留半套）");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;

  /* 前提：给一个高于当前速度的目标（开开关那一刻的守卫要求 target > 当前 BPM） */
  beat.Controls.setBpm(90);
  S.trainer.target = 200;
  eq(S.trainer.on, false, "前提：训练未开启");

  const t = els["trTarget"];
  t.value = "200";
  t.fire("change");
  eq(S.trainer.target, 200, "前提：目标 BPM 已设为 200（高于当前 90）");

  els["trainerToggle"].fire("click");
  eq(S.trainer.on, true, "前提：训练已开启（守卫放行）");

  eq(els["bpmSlider"].disabled, true, "滑杆锁定（既有口径）");
  eq(els["bpmMinus5"].disabled, true, "★ -5 锁定（既有口径）");
  eq(els["bpmPlus5"].disabled, true, "★ +5 锁定（既有口径）");
  eq(els["bpmMinus"].disabled, true,
    "★★ -1 同样锁定（与 ±5 同口径：点了也会被阶梯覆盖，不该是唯一能点的那个）");
  eq(els["bpmPlus"].disabled, true,
    "★★ +1 同样锁定（同上）");

  /* 关闭必须全部解锁（"只锁不开"会把用户锁在训练里，v2.11.2 定的口径） */
  els["trainerToggle"].fire("click");
  eq(S.trainer.on, false, "前提：训练已关闭");
  eq(els["bpmMinus"].disabled, false, "★ 关闭后 -1 解锁");
  eq(els["bpmPlus"].disabled, false, "★ 关闭后 +1 解锁");
  eq(els["bpmMinus5"].disabled, false, "★ 关闭后 -5 解锁（既有口径不回归）");
  eq(els["bpmSlider"].disabled, false, "★ 关闭后滑杆解锁");
}
