/* BeatSight 自动化测试 · 基础数据层：Store 容错 / trainer 钳制 / 预设导入导出 / 模块装配
   T1–T7。冷热持久化与预设校验的地基用例。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

/* ================= 场景 T1：localStorage 坏 JSON 容错 ================= */
section("T1 Store · 坏 JSON 回退默认，不白屏");
{
  const { beat } = loadApp({ "beatsight.m2": "{bad json,," });
  const S = beat.Store.S;
  eq(S.bpm, 96, "坏数据时 BPM 回退默认 96");
  eq(S.sig, 4, "坏数据时拍号回退 4");
  eq(S.trainer.start, 70, "坏数据时 trainer.start 默认 70");
  eq(S.trainer.everyN, 4, "坏数据时 trainer.everyN 默认 4");
}

/* ================= 场景 T2：trainer 脏项回退 ================= */
section("T2 Store · trainer 缺项/脏项回退默认值");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ trainer: { start: 80, step: "x", everyN: null } }) });
  const t = beat.Store.S.trainer;
  eq(t.start, 80, "合法 start 保留");
  eq(t.step, 4, "非数字 step 回退默认 4");
  eq(t.everyN, 4, "null everyN 回退默认 4");
  eq(t.target, 120, "缺失 target 回退默认 120");
  eq(t.on, false, "缺失 on 回退 false");
}

/* ================= 场景 T3：变速训练爬坡序列（v0.5.0 核心回归） ================= */
section("T3 Trainer · 爬坡序列 70→80→90→95 + 完成自动停止");
{
  const { beat, els } = loadApp({ "beatsight.m2": JSON.stringify({
    trainer: { on: true, start: 70, target: 95, step: 10, everyN: 2 },
  })});
  const S = beat.Store.S;
  beat.Controls.start();
  ok(S.playing, "训练开启时点播放：从起始速度起步");
  eq(S.bpm, 70, "起步 BPM = 起始 70");
  const ac = FakeAudioContext.last;   // start() 内 ensureCtx 创建的实例
  ok(!!ac, "AudioContext 已被创建");
  const seq = [S.bpm];
  const stopped = drive(ac, beat, 40, () => { if (S.bpm !== seq[seq.length - 1]) seq.push(S.bpm); });
  ok(stopped, "练到目标后自动停止");
  eq(JSON.stringify(seq), JSON.stringify([70, 80, 90, 95]), "爬坡序列 70→80→90→95");
  eq(els["statusText"].textContent, "训练完成 · 达到 95 BPM", "完成提示文案");
  eq(S.playing, false, "完成后 playing=false");
}

/* ================= 场景 T4：训练参数钳制 ================= */
section("T4 Trainer · 参数钳制与目标>起始约束");
{
  const { beat, els } = loadApp();
  const S = beat.Store.S;
  els["trStart"].value = "999";
  els["trStart"].fire("change");
  eq(S.trainer.start, 236, "起始超上限钳到 236");
  eq(S.trainer.target, 237, "目标被抬回 起始+1（237）");
  eq(els["trTarget"].value, 237, "目标输入框同步 237");
  els["trTarget"].value = "150";
  els["trTarget"].fire("change");
  eq(S.trainer.target, 237, "目标改到低于起始再次被抬回 237");
  els["trStart"].value = "abc";
  els["trStart"].fire("change");
  eq(S.trainer.start, 236, "非数字输入回退原值 236");
  els["trEvery"].value = "0";
  els["trEvery"].fire("change");
  eq(S.trainer.everyN, 1, "每级小节数下限钳到 1");
}

/* ================= 场景 T5：预设导入导出（v0.7.0：tick 制 + v1 旧格式兼容） ================= */
section("T5 Store · 预设导入导出校验（tick 制）");
{
  const { beat } = loadApp();
  const Store = beat.Store;
  ok(Store.importPresets("not json").ok === false, "非 JSON 拒绝");
  ok(Store.importPresets('{"foo":1}').ok === false, "无 presets 字段拒绝");
  ok(Store.importPresets('{"presets":[]}').ok === false, "空数组拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars: [[{ t: 14 }], [], [], []] }] })).ok === false,
     "非法时值 t=14（不在合法 tick 集合）拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }], [], [], []] }] })).ok === false,
     "小节时值不足 4 拍拒绝");
  ok(Store.importPresets(JSON.stringify({ presets: [{ name: "x", meter: 8, bars: [[{ t: 48 }], [], [], []] }] })).ok === false,
     "拍号 8（未开放）拒绝");

  const good = { app: "beatsight", kind: "presets", v: 2, presets: [
    { name: "测试 · 摇滚", meter: 4, bars: [0,1,2,3].map(() => Array.from({ length: 8 }, () => ({ t: 24, rest: false }))) },
    { name: "测试 · 6/8", meter: 6, bars: [0,1,2,3].map(() => Array.from({ length: 4 }, () => ({ t: 72, rest: false }))) },
  ]};
  const r1 = Store.importPresets(JSON.stringify(good));
  ok(r1.ok && r1.count === 2, "合法 v2（tick）文件导入 2 个预设");
  eq(Store.customs.length, 2, "customs 增至 2");
  ok(Store.customs.every(c => typeof c.id === "string" && c.id.startsWith("c")), "导入后 id 重新生成");

  /* v0.7.0：拍号 5/7 开放 */
  const odd = { presets: [{ name: "测试 · 5/4", meter: 5, accents: [0, 2],
    bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) }]};
  const r2 = Store.importPresets(JSON.stringify(odd));
  ok(r2.ok && r2.count === 1, "拍号 5（v0.7 开放）接受");
  eq(JSON.stringify(Store.customs[2].accents), JSON.stringify([0, 2]), "重拍分组随导入保留");

  /* v1 旧格式（浮点拍数 d）向后兼容：自动 ×48 转 tick */
  const legacy = { presets: [{ name: "旧格式 · 附点", meter: 4,
    bars: [0,1,2,3].map(() => [{ d: 0.75 }, { d: 0.25 }, { d: 1 }, { d: 1 }, { d: 1 }]) }]};
  const r3 = Store.importPresets(JSON.stringify(legacy));
  ok(r3.ok && r3.count === 1, "v1 旧格式（d 浮点）导入成功");
  eq(Store.customs[3].bars[0][0].t, 36, "d=0.75 → t=36");
  eq(Store.customs[3].bars[0][0].d, undefined, "旧字段 d 已清除");

  const ser = Store.serializePresets();
  ok(JSON.parse(ser).v === 2, "导出格式 v:2（tick 制）");
  const round = Store.importPresets(ser);
  ok(round.ok && round.count === 4, "导出→再导入 往返成功");
  const ids = Store.customs.map(c => c.id);
  ok(new Set(ids).size === ids.length, "往返后全部 id 仍唯一");

  /* 体量护栏：超大文件 / 超多条目在解析与逐条校验前直接拒绝（不阻塞主线程） */
  const big = Store.importPresets(" ".repeat(beat.CONFIG.importMaxBytes + 1));
  ok(big.ok === false && /过大/.test(big.error), "超过 2MB 的文本拒绝（进 JSON.parse 之前）");
  const many = Store.importPresets(JSON.stringify({ presets:
    Array.from({ length: beat.CONFIG.importMaxCount + 1 }, () => ({ name: "x", meter: 4,
      bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]) })) }));
  ok(many.ok === false && /过多/.test(many.error), "超过 500 条预设拒绝（进逐条校验之前）");
  eq(Store.customs.length, 8, "护栏拒绝后 customs 不受影响");
}

section("T5b 导入护栏 · 文件入口接线（change 事件快速失败）");
{
  const app = loadApp();
  const els = app.els;
  els["importFile"].fire("change", { target: { files: [{ size: app.beat.CONFIG.importMaxBytes + 1 }], value: "" } });
  eq(els["modalMask"].hidden, false, "超大文件 → 弹窗告知");
  ok(/文件过大/.test(els["modalMsg"].textContent), `文案可读：「${els["modalMsg"].textContent.slice(0, 30)}」`);
  eq(app.beat.Store.customs.length, 0, "超大文件未进入解析（customs 不变）");
  els["modalOk"].fire("click");
}

/* ================= 场景 T6：节奏型回退 ================= */
section("T6 curPattern · 选择失效时回退基础节奏");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "custom", id: "ghost" } }) });
  eq(beat.curPattern().name, "基础节奏 · 每拍一下", "custom id 不存在 → 回退基础节奏");
  const { beat: b2 } = loadApp({ "beatsight.m2": JSON.stringify({ sel: { type: "builtin", idx: 99 } }) });
  eq(b2.curPattern().name, "基础节奏 · 每拍一下", "builtin idx 越界 → 回退基础节奏");
}

/* ================= 场景 T7：模块接口完整性 ================= */
section("T7 模块化 · 接口与装配完整性");
{
  const { beat } = loadApp();
  /* v2.10.12：模块清单把 `Stats` 换成 `Settings`（练习统计删除、设置弹窗新增），总数仍 13 */
  ["Store", "Modal", "Viz", "AudioEngine", "Trainer", "Controls", "Presets", "Editor", "Settings", "KeepAlive"].forEach(k =>
    ok(!!beat[k], `__beat.${k} 已暴露`));
  ["start", "stop", "setBpm", "setSig"].forEach(k => ok(typeof beat.Controls[k] === "function", `Controls.${k}()`));
  ["serializePresets", "exportPresets", "importPresets", "persist"].forEach(k => ok(typeof beat.Store[k] === "function", `Store.${k}()`));
  ok(typeof beat.Modal.uiAlert === "function", "Modal.uiAlert()");
  ok(typeof beat.Presets.consumePending === "function", "Presets.consumePending()");
  ok(typeof beat.Editor.draft === "function", "Editor.draft() 访问器");
  ok(typeof beat.Controls.setSwing === "function", "Controls.setSwing()（v0.7.0 新增）");
  /* v2.10.12：原 `beat.Stats.summarize` 与 `Store.appendSession/clearLog` 两条随练习统计 /
     练习记录一起删除 */
  ok(typeof beat.KeepAlive.sync === "function", "KeepAlive.sync()（v1.4 新增）");
  ok(typeof beat.Settings === "object" && typeof beat.Settings.open === "function",
     "★ Settings.open/close（v2.10.12 新增的设置弹窗模块，取代 Stats 的架构槽位）");
}

