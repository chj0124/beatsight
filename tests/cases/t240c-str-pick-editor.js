/* BeatSight 自动化测试 · 逐弦拨弦（str）编辑器
   T240c 系列（v3.47.0）。
   ---------------------------------------------------------------------------
   契约（PLAN-v10-str-pick §4）：
     · 六行迷你面板：开关 = 切换 {s} 的存在（摘最后一根 → delete step.str 回 zone 口径）；
       品数框 change 校验（空串删 f / 0–24 写入 / 其余恢复原值 + hint 报错不落草稿）；
       技巧钮循环 无→H→P→S→O→无（未启用的弦直接启用；品数全程保留；循环回「无」
       品数保留、纯技巧条目整条摘掉）；
     · 同一套撤销纪律：pushUndo 先行、同态重按不推栈、undo 可回退；
     · zone 行覆盖态：格子带 str → 三钮灰 + hint「逐弦优先」；清空全部弦自动恢复；
     · 按序铺弦号（小节级）：parseStrFill 解析 → 颗数 ≠ 发声格数报错不写入（不写半截）；
       rest 格跳过。
   面板行在桩里按标记结构手工构造（stub 不解析 HTML）——与真实 DOM 的父子结构逐位一致。 */
"use strict";
const { loadApp, ok, eq, section, FakeAudioContext } = require("../lib/harness");

/* 8 颗八分的分解型骨架（53231323 的容器；弦号由铺弦号/面板写入） */
const PAT = () => ({ name: "五三二三", meter: 4,
  bars: [0,1,2,3].map(() => Array.from({ length: 8 }, () => ({ t: 24 }))) });

/* 按真实标记的父子结构构造面板（strRow > .str-lines > .str-line×6 > [tog, fret, tech]） */
function buildStrPanel(els, sandbox){
  const mk = (cls, tag) => { const e = sandbox.document.createElement(tag || "button"); if (cls) e.className = cls; return e; };
  const lines = mk("str-lines", "div");
  for (let s = 1; s <= 6; s++){
    const row = mk("str-line", "div");
    row.dataset.s = String(s);
    const tog = mk("pill str-tog"); tog.dataset.s = String(s);
    const fret = mk("str-fret", "input"); fret.dataset.s = String(s);
    const tech = mk("pill str-tech"); tech.dataset.s = String(s); tech.textContent = "·";
    [tog, fret, tech].forEach(c => row.appendChild(c));
    lines.appendChild(row);
  }
  els["strRow"].appendChild(lines);
  return lines;
}
const fireStr = (els, target, type) => els["strRow"].fire(type || "click", { target });
/* strFill 控件在桩里是懒创建的（app 首次 $() 才有）——经 getElementById 预创建并缓存 */
const $id = (app, id) => app.sandbox.document.getElementById(id);
const rowOf = (els, s) => els["strRow"].children.find(c => /str-lines/.test(c.className))
  .children.find(r => r.dataset.s === String(s));
const togOf = (els, s) => rowOf(els, s).children[0];
const fretOf = (els, s) => rowOf(els, s).children[1];
const techOf = (els, s) => rowOf(els, s).children[2];
const loadWithPanel = () => {
  const app = loadApp();
  buildStrPanel(app.els, app.sandbox);
  app.beat.Store.importPresets(JSON.stringify({ presets: [PAT()] }));
  app.beat.Store.S.sel = { type: "custom", id: app.beat.Store.customs[app.beat.Store.customs.length - 1].id };
  app.beat.Presets.refreshAfterPatternChange();
  app.beat.Editor.open();
  return app;
};

/* ================= 场景 T240c-1：开关 + 撤销 + 同态纪律 ================= */
section("T240c-1 逐弦 · 开关写 str / 摘空删字段 / 撤销 / 未选中禁用");
{
  const { beat, els } = loadWithPanel();
  const St = beat.Store, Ed = beat.Editor;
  /* 未选中：六行全禁 + hint 引导 */
  ok(togOf(els, 5).disabled, "未选中 → 开关禁用");
  eq(els["strHint"].textContent, "", "未选中 → hint 空串（PLAN-v11 B2：悬浮层未选中即隐藏，占位话术退役）");
  els["editorBars"].children[0].children[1].children[0].fire("click");   // 选中第 1 格
  ok(!togOf(els, 5).disabled, "选中后开关启用");
  eq(togOf(els, 5).getAttribute("aria-pressed"), "false", "未启用 → aria-pressed false");
  /* 点 ⑤ → 草稿写 str */
  fireStr(els, togOf(els, 5));
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5 }]), "点 ⑤ → str=[{s:5}]");
  eq(togOf(els, 5).getAttribute("aria-pressed"), "true", "aria-pressed 同步");
  /* 同格再加 ② → 两弦（升序） */
  fireStr(els, togOf(els, 2));
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 2 }, { s: 5 }]), "加 ② → 升序两弦");
  /* 撤销一次 = 摘掉 ②；再撤 = 回无 str */
  Ed.undo();
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5 }]), "撤销摘掉后加的弦");
  Ed.undo();
  eq(Ed.draft().bars[0][0].str, undefined, "再撤销 → str 字段删除（回 zone 口径）");
  /* 摘最后一根 → 字段删除；undo 可回退（★ undo 会清空选中，重选后再操作） */
  els["editorBars"].children[0].children[1].children[0].fire("click");
  fireStr(els, togOf(els, 5));
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5 }]), "重新选中后 ⑤ 写入");
  fireStr(els, togOf(els, 5));
  eq(Ed.draft().bars[0][0].str, undefined, "摘最后一根 → 字段删除");
  Ed.undo();
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5 }]), "撤销回到有 ⑤");
  eq(St.customs.length >= 1, true, "（对账）库内型仍在");
}

/* ================= 场景 T240c-2：品数框三路径 + 技巧循环 ================= */
section("T240c-2 逐弦 · 品数校验 / 技巧循环五态 / 品数保留");
{
  const { beat, els } = loadWithPanel();
  const Ed = beat.Editor;
  els["editorBars"].children[0].children[1].children[0].fire("click");
  fireStr(els, togOf(els, 5));
  /* 合法品数写入 */
  fretOf(els, 5).value = "3";
  fireStr(els, fretOf(els, 5), "change");
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 3 }]), "品数 3 写入");
  eq(fretOf(els, 5).value, "3", "输入框保留合法值");
  /* 非法品数：恢复原值 + 报错，不落草稿 */
  fretOf(els, 5).value = "25";
  fireStr(els, fretOf(els, 5), "change");
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 3 }]), "品数 25 → 不落草稿");
  eq(fretOf(els, 5).value, "3", "非法输入恢复原值");
  ok(String(els["strHint"].textContent).includes("品数"), "hint 报错可读");
  fretOf(els, 5).value = "x";
  fireStr(els, fretOf(els, 5), "change");
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 3 }]), "非数字 → 不落草稿");
  /* 清空 = 删 f（技巧/开关保留） */
  fretOf(els, 5).value = "";
  fireStr(els, fretOf(els, 5), "change");
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5 }]), "清空 → 删 f");
  /* 技巧循环五态：· → H → P → S → O → ·（无品条目回「无」整条摘掉） */
  const seq = [];
  for (let i = 0; i < 5; i++){
    fireStr(els, techOf(els, 5));
    seq.push(techOf(els, 5).textContent);
  }
  eq(JSON.stringify(seq), JSON.stringify(["H", "P", "S", "O", "·"]), "★ 技巧钮循环 无→H→P→S→O→无");
  eq(Ed.draft().bars[0][0].str, undefined, "循环回「无」→ 纯技巧条目整条摘掉");
  /* 带品条目：循环回「无」品数保留 */
  fretOf(els, 5).value = "7";
  fireStr(els, fretOf(els, 5), "change");
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 7 }]), "直接填品（无需先开弦）");
  fireStr(els, techOf(els, 5));            // → H
  fireStr(els, techOf(els, 5));            // → P
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 7, tech: "P" }]),
     "品数在技巧循环中保留");
  fireStr(els, techOf(els, 5));            // → S
  fireStr(els, techOf(els, 5));            // → O
  fireStr(els, techOf(els, 5));            // → 无
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 7 }]),
     "★ 循环回「无」→ 只摘技巧，品数保留");
  /* 旧数据 rest+str：v3.53.2 起 UI 不再制造这种组合，但归一化仍须兼容；直接置 rest 模拟旧档。 */
  Ed.draft().bars[0][0].rest = true;
  eq(Ed.draft().bars[0][0].rest, true, "旧数据前提：rest+str 格");
  fireStr(els, techOf(els, 5));            // → H（会被 normStr 抹）
  eq(JSON.stringify(Ed.draft().bars[0][0].str), JSON.stringify([{ s: 5, f: 7 }]),
     "旧 rest+str 格 tech 被抹除（normStr 唯一口径）");
}

/* ================= 场景 T240c-3：zone 行覆盖态与恢复 ================= */
section("T240c-3 逐弦 · zone 行被覆盖态 / 清空恢复");
{
  const { beat, els } = loadWithPanel();
  const Ed = beat.Editor;
  els["editorBars"].children[0].children[1].children[0].fire("click");
  ok(els["zoneRow"].children.every(b => !b.disabled), "无 str → zone 行可用");
  eq(els["zoneHint"].textContent, "", "无 str → 无覆盖提示");
  fireStr(els, togOf(els, 5));
  ok(els["zoneRow"].children.every(b => b.disabled), "★ 格子带 str → zone 三钮灰");
  ok(String(els["zoneHint"].textContent).includes("逐弦优先"), "★ hint「逐弦优先」");
  fireStr(els, togOf(els, 5));              // 清空全部弦
  ok(els["zoneRow"].children.every(b => !b.disabled), "清空全部弦 → zone 自动恢复可用");
  eq(els["zoneHint"].textContent, "", "覆盖提示随之消失");
}

/* ================= 场景 T240c-4：按序铺弦号 ================= */
section("T240c-4 逐弦 · 铺弦号写入 / 颗数不匹配不写入 / rest 跳过");
{
  const app = loadWithPanel();
  const beat = app.beat, els = app.els;
  const Ed = beat.Editor;
  /* 8 颗发声格 + 8 个弦号 → 逐格写入 */
  $id(app, "strFillIn").value = "5:3 3 2 3 1 3 2 3";
  $id(app, "strFillBtn").fire("click");
  eq(JSON.stringify(Ed.draft().bars[0].map(s => s.str)), JSON.stringify([
    [{ s: 5, f: 3 }], [{ s: 3 }], [{ s: 2 }], [{ s: 3 }],
    [{ s: 1 }], [{ s: 3 }], [{ s: 2 }], [{ s: 3 }]]), "★ 53231323 一次铺满");
  ok(String($id(app, "strFillHint").textContent).includes("8"), "成功 hint 报数");
  /* 颗数不匹配 → 报错不写入（不写半截） */
  $id(app, "strFillIn").value = "5 3";
  $id(app, "strFillBtn").fire("click");
  ok(String($id(app, "strFillHint").textContent).includes("8") && String($id(app, "strFillHint").textContent).includes("2"),
     "报错文案报出「8 颗 / 2 个」");
  eq(JSON.stringify(Ed.draft().bars[1].map(s => s.str || null)), JSON.stringify([null,null,null,null,null,null,null,null]),
     "第 2 小节未被写入（不写半截）");
  /* 非法词 → 报错不写入 */
  $id(app, "strFillIn").value = "5:3 9";
  $id(app, "strFillBtn").fire("click");
  ok(String($id(app, "strFillHint").textContent).includes("9"), "非法弦号报错");
  eq(Ed.draft().bars[1][0].str, undefined, "仍无写入");
  /* rest 格跳过：把第 1 格翻成休止 → 发声格 7 颗；给 7 个弦号 → rest 格无 str */
  Ed.undo(); Ed.undo(); Ed.undo();                     // 回到未铺状态（铺 1 次 + 无失败推栈）
  eq(JSON.stringify(Ed.draft().bars[0].map(s => s.str || null)), JSON.stringify([null,null,null,null,null,null,null,null]),
     "撤销后回到未铺状态");
  els["editorBars"].children[0].children[1].children[0].fire("click");
  els["restRow"].fire("click", { target: els["restRow"].children[1] });   // 第 1 格 → rest（v3.52.0 休止档）
  $id(app, "strFillIn").value = "5 3 2 3 1 3 2";
  $id(app, "strFillBtn").fire("click");
  eq(Ed.draft().bars[0][0].str, undefined, "★ rest 格跳过（无 str）");
  eq(JSON.stringify(Ed.draft().bars[0][1].str), JSON.stringify([{ s: 5 }]), "第 2 格拿第 1 个弦号");
  eq(JSON.stringify(Ed.draft().bars[0][7].str), JSON.stringify([{ s: 2 }]), "最后一颗发声格拿第 7 个弦号");
  /* 8 个弦号对 7 颗发声格 → 报错 */
  $id(app, "strFillIn").value = "5 3 2 3 1 3 2 3";
  $id(app, "strFillBtn").fire("click");
  ok(String($id(app, "strFillHint").textContent).includes("7"), "报错文案报出 7 颗");
}

/* ================= 场景 T240c-5：逐弦面板行序 ① → ⑥（不预建，让 App 自建） ================= */
section("T240c-5 逐弦 · 面板行序 ① 顶 ⑥ 底（DOM 序 = Tab 序 = 读屏序；真验产品代码）");
{
  /* ★ 坑（PLAN §3D/§6）：桩预建 `.str-lines` 后 ensureStrPanel 会跳过自建（幂等守卫）——
     故本用例**不预建**，开编辑器让 App 自己建面板，才是在验产品代码而非验桩。
     取行助手（rowOf/togOf…）按 dataset.s 查找、序无关 ⇒ 不翻现有断言也过；正因如此，
     行序必须**新增断言**钉死（翻转前是 6→1，这些断言会红）。 */
  const app = loadApp();
  app.beat.Store.importPresets(JSON.stringify({ presets: [PAT()] }));
  app.beat.Store.S.sel = { type: "custom", id: app.beat.Store.customs[app.beat.Store.customs.length - 1].id };
  app.beat.Presets.refreshAfterPatternChange();
  app.beat.Editor.open();                 // ★ 不预建面板：ensureStrPanel 走自建分支
  const linesHost = app.els["strRow"].children.find(c => /(^| )str-lines( |$)/.test(c.className));
  ok(!!linesHost, "编辑器打开后 App 自建了 .str-lines 面板（未预建）");
  if (linesHost){
    const rows = linesHost.children.filter(c => /(^| )str-line( |$)/.test(c.className));
    eq(rows.length, 6, "面板六行");
    eq(rows.map(r => r.dataset.s).join(","), "1,2,3,4,5,6",
       "★ 行序 ①→⑥（① 在顶，与谱面 / TAB 记法 / 全 App 其它弦序面同构）");
    eq(rows[0].dataset.s, "1", "★ 首行 = ① 弦（此前是 ⑥ 顶 ① 底——全 App 唯一倒置的弦序面）");
    eq(rows[5].dataset.s, "6", "★ 末行 = ⑥ 弦");
    eq(rows[0].children[0].textContent, "①", "首行开关显示 ①（与 dataset.s 同源）");
  }
}
