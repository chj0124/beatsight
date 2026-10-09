/* BeatSight 自动化测试 · 导入确认文案如实化 + 迁移未完成上诊断面板
   （v3.42.1 审计 P1-1 / P2-2）
   ---------------------------------------------------------------------------
   P1-1：全量导入确认框旧文案承诺「按合并语义写回，不会删除本机已有内容」，而
   settings.groups 的实现是清空后整包替换（t83x-e 钉的行为）——文案与行为直接矛盾。
   P2-2：migAttention 此前只有 console.warn，任何 UI 都不消费。
   ★ 审计 P2-5（S.sel 白名单）已撤回：核实后「脏 sel 原样透传」是三条测试钉住的刻意设计
   （T01/T6 回退口径 · T30 迁移透传 · T185 basic 形态），见 index.html Store 内备注。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 面板 DOM 探针（与 t56 同款：body 直接子节点里 class 含 `diag` 的那个） */
const panels = app => app.sandbox.document.body.children.filter(c => /(^| )diag( |$)/.test(c.className || ""));
const lineOf = app => { const p = panels(app)[0]; return p ? p.children[1].textContent : "(未挂载)"; };

/* ================= 场景 T233a：导入确认框文案 = 语义以清单为准（替换项点名后果） ================= */
section("T233a 全量导入确认框：不再承诺一刀切「合并、不会删除」，替换项整包覆盖有明示");
{
  const app = loadApp();
  /* 带分组的整包：parts 必含「分组：替换 N 项」（t134 已钉预览行为，此处钉确认文案） */
  app.setFileText(JSON.stringify({
    presets: [{ name: "文案载体", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }],
    settings: { groups: [{ id: "g-imp-1", zone: "custom", name: "导入组",
      members: [{ type: "builtin", idx: 0 }] }] }
  }));
  app.els["importAllFile"].fire("change", { target: { files: [{}], value: "" } });
  const msg = app.els["modalMsg"].textContent;
  ok(msg.indexOf("整包覆盖") >= 0, "★ 文案明确「替换 = 整包覆盖」（旧文案只说合并，与分组替换行为矛盾）");
  ok(msg.indexOf("不可恢复") >= 0, "★ 点名后果：本机分组将被取代且不可恢复");
  ok(msg.indexOf("以清单为准") >= 0, "总述让位于逐项清单语义");
  /* 清单里「分组：替换」一行仍在（预览行为不变） */
  const listText = [].map.call(app.els["importPreviewList"].children, c => c.textContent).join("|");
  ok(listText.indexOf("分组：替换") >= 0, "清单仍逐项标注「分组：替换」（预览行为不变）");
  /* 点确认走完流程：分组确实替换（行为面回归，防文案改动牵连逻辑） */
  app.els["modalOk"].fire("click");
  eq(app.beat.Store.groups.length, 1, "确认后分组整包替换生效（行为未随文案改动）");
}

/* ================= 场景 T233b：迁移「需关注」计数上诊断面板与报告（不再只有 console.warn） ================= */
section("T233b 垃圾迁移戳记 → migAttention 计数可见于 ?debug=1 面板与诊断报告");
{
  const clean = loadApp();
  eq(clean.beat.Store.migAttention(), 0, "干净存档：迁移计数为 0（getter 可读）");

  /* 垃圾戳（非 ""/"1"/"?"）→ migState 按「需关注」处理：不重放、只上报（L6012 口径） */
  const stuck = loadApp({ "beatsight.mig.bnmig35": "x" });
  eq(stuck.beat.Store.migAttention(), 1, "★ 垃圾戳记 → 记一次「需关注」（旧实现只 console.warn，UI 不可见）");

  const on = loadApp({ "beatsight.mig.bnmig35": "x" }, { location: { search: "?debug=1", protocol: "https:" } });
  eq(panels(on).length, 1, "前提：?debug=1 已挂面板");
  ok(lineOf(on).indexOf("迁移未完成 ×1") >= 0, "★ 诊断面板出现「⚠迁移未完成 ×1」");
  const cleanOn = loadApp({}, { location: { search: "?debug=1", protocol: "https:" } });
  ok(lineOf(cleanOn).indexOf("迁移未完成") < 0, "计数为 0 → 面板不占地方（与戳记/保活同一口径）");
  ok(on.beat.Diagnostics.diagReport().indexOf("未走完") >= 0, "★ 诊断报告含迁移行（随「复制诊断信息」带走）");
  ok(cleanOn.beat.Diagnostics.diagReport().indexOf("迁移: 全部完成") >= 0, "干净态报告如实写「全部完成」");
}

/* 场景 T233c（S.sel 白名单）已随 P2-5 撤回而移除——「脏 sel 原样透传」是三条既有测试
   钉住的刻意设计（T01/T6 · T30 · T185），见 index.html Store 内 v3.42.1 审计备注。 */
