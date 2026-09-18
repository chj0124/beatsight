/* BeatSight 自动化测试 · 2026-09-17 全维度审计「P1 批次」的回归用例（T59–T59f）
   ---------------------------------------------------------------------------
   这一批的共同点是"**症状安静**"或"**症状只在特定环境出现**"，所以每条都要把
   "修之前会怎样"钉成断言，否则日后把防线改回去时闸门照样是绿的：

     T59  · P1-3 起停重入与句柄不泄漏——start() 调两次会留下孤儿 setInterval（音符排两遍）
     T59b · P1-4 停机期间被系统关闭的 AudioContext，下次取用时必须丢弃重建
     T59c · P1-5 导入的总量闸门（原先只管单份文件）
     T59d · P1-5 隔离区的读/清出口（原先只写不读，数据拿不回也清不掉）
     T59e · P1-6 `__proto__` 注入不得污染落盘合并结果
     T59f · P1-1 调度饥饿必须被记进诊断计数（原先是静默吞拍）

   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

/* ================= 场景 T59：起停重入与句柄不泄漏 ================= */
section("T59 P1-3 · 起停重入：不产生孤儿 interval，句柄必被清空");
{
  const { beat, intervalCount } = loadApp();
  const S = beat.Store.S;
  eq(intervalCount(), 0, "初始没有活跃 interval");
  beat.Controls.start();
  eq(S.playing, true, "start() 后进入播放态");
  eq(intervalCount(), 1, "start() 恰好开了一个 25ms 调度 interval");
  /* 重入：修之前 start() 会再开一个 interval 并**覆盖 timer 句柄**（旧句柄再也清不掉），
     结果是两个循环同时排程（每个音符排两遍）＋ 一个永远跑着的孤儿定时器 */
  beat.Controls.start();
  eq(intervalCount(), 1, "★ 重复 start() 不会开出第二个 interval（重入保护）");
  beat.Controls.stop();
  eq(intervalCount(), 0, "stop() 清掉了 interval");
  eq(S.playing, false, "stop() 后回到停止态");
  /* 反复起停 N 次：句柄要么被清、要么泄漏——用计数把这条钉死 */
  for (let i = 0; i < 5; i++){ beat.Controls.start(); beat.Controls.stop(); }
  eq(intervalCount(), 0, "★ 反复起停 5 次后仍无残留 interval");
}

/* ================= 场景 T59b：停机期间被关闭的上下文必须重建 ================= */
section("T59b P1-4 · ctx 被系统关闭后，下次取用必须换成新上下文");
{
  const { beat } = loadApp();
  beat.AudioEngine.ensureCtx();
  const first = FakeAudioContext.last;
  ok(!!first, "ensureCtx 建立了上下文");
  first.setState("closed");                     // 停机期间被系统关闭（watchCtx 只在播放中才重建）
  eq(FakeAudioContext.last, first, "停机期间不会自动重建（这正是缺陷的入口）");
  const second = beat.AudioEngine.ensureCtx();
  ok(second !== first, "★ 下次 ensureCtx 丢弃已 closed 的上下文并重建（否则表现为「在播放、永不出声」）");
  eq(second.state, "running", "新上下文可用");
}

/* ================= 场景 T59c：导入的总量闸门 ================= */
section("T59c P1-5 · 导入总量闸门（不只是单份文件的条数）");
{
  const { beat } = loadApp();
  const proto = JSON.parse(JSON.stringify(beat.BUILTINS[0]));
  eq(proto.bars.length, 4, "内置预设可作为导入模板（4 小节）");
  const list = [];
  for (let i = 0; i < 500; i++) list.push(Object.assign({}, proto, { name: "导入" + i }));
  const r1 = beat.Store.importPresets(JSON.stringify({ presets: list }));
  eq(r1.ok, true, "一次导入 500 条（正好等于单份上限）通过");
  eq(beat.Store.customs.length, 500, "库里现有 500 条");
  const r2 = beat.Store.importPresets(JSON.stringify({ presets: [Object.assign({}, proto, { name: "再一条" })] }));
  eq(r2.ok, false, "★ 库里已满时再导入被总量闸门拦下（原先会无上限增长）");
  ok(/上限/.test(r2.error), "拒绝原因说清了是上限问题：" + r2.error);
}

/* ================= 场景 T59d：隔离区的读 / 清出口 ================= */
section("T59d P1-5 · 隔离区可读可清（原先只写不读）");
{
  const { beat, els } = loadApp({ "beatsight.customs": JSON.stringify({ v:1, customs: [
    { name: "坏预设", meter: 99, bars: [] },
  ] }) });
  eq(beat.Store.quarantine().length, 1, "★ 被隔离的脏预设可读回（此前只能靠 console.warn 猜）");
  eq(beat.Store.customs.length, 0, "脏预设没有进正式库");
  eq(els["helpClearQuar"].hidden, false, "「使用方法 → 数据与隐私」露出清理入口");
  ok(/1 条/.test(els["helpClearQuar"].textContent), "按钮文案带条数：" + els["helpClearQuar"].textContent);
  eq(beat.Store.clearQuarantine(), 1, "清理返回清掉的条数");
  eq(beat.Store.quarantine().length, 0, "清理后隔离区为空");
  const clean = loadApp();
  eq(clean.beat.Store.quarantine().length, 0, "没有脏数据时隔离区为空");
  eq(clean.els["helpClearQuar"].hidden, true, "没有脏数据时不显示清理入口（不给用户造成「我丢了什么」的错觉）");
}

/* ================= 场景 T59e：__proto__ 注入不得污染 ================= */
section("T59e P1-6 · 热键里的 __proto__ 注入不污染落盘合并结果");
{
  /* JSON.parse 产出的是**自有** __proto__ 键；而 Object.assign 走 [[Set]]，
     目标是普通对象时会调用 __proto__ 的 setter 改写原型 → 缺失字段从被污染的原型读到注入值。
     修之前：S.vol 会被注入成 0.1；修之后（Object.create(null) 作目标）它仍是默认 0.8。 */
  const { beat } = loadApp({ "beatsight.state": '{"v":3,"bpm":100,"__proto__":{"vol":0.1}}' });
  eq(beat.Store.S.vol, 0.8, "★ 原型污染不再生效（vol 保持默认 0.8）");
  eq(beat.Store.S.bpm, 100, "同一份数据里的正常字段照常生效（bpm=100）");
}

/* ================= 场景 T59g：诊断信息的复制路径 ================= */
section("T59g P1-9 · 诊断面板「复制诊断信息」（剪贴板可用 / 不可用两条路）");
{
  /* 面板 DOM 是动态创建的（不进 els），按 t56 同一套探针从 body 的直接子节点里找 */
  const panels = app => app.sandbox.document.body.children.filter(c => /(^| )diag( |$)/.test(c.className || ""));
  /* 种一个键进去，否则本地存储是空的、报告里只会写「(空)」——那测不到枚举路径 */
  const on = loadApp({ "beatsight.state": JSON.stringify({ v:3 }) },
    { location: { search: "?debug=1", protocol: "https:" } });
  const box = panels(on)[0];
  ok(!!box, "?debug=1 时面板已挂载");
  const copyBtn = box.children[2];
  eq(copyBtn.textContent, "复制诊断信息", "面板第三个子节点是复制按钮（此前面板只能看不能带走）");

  /* 无剪贴板（file:// 非安全上下文就是这种）→ 退回弹窗，至少让人能手动复制 */
  copyBtn.fire("click");
  eq(on.beat.Modal.isOpen(), true, "剪贴板不可用时退回弹窗");
  const msg = on.els["modalMsg"].textContent;
  ok(/BeatSight v/.test(msg), "弹窗含版本号");
  ok(/计数: /.test(msg) && /reanchor/.test(msg), "弹窗含全部计数（含新增的重锚两档）");
  ok(/本地存储: /.test(msg) && /beatsight/.test(msg), "★ 弹窗含各存储键的占用字符数（诊断「存不下」的第一手数据）");
  on.els["modalOk"].fire("click");

  /* 剪贴板可用 → 真的把文本写进去（成功分支） */
  let copied = null;
  const clip = loadApp({}, { location: { search: "?debug=1", protocol: "https:" },
    navigator: { clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } } });
  const clipBtn = panels(clip)[0].children[2];
  clipBtn.fire("click");
  ok(!!copied && /BeatSight v/.test(copied), "剪贴板可用时把诊断信息写进剪贴板");
  eq(clip.beat.Modal.isOpen(), false, "走剪贴板时不弹窗");
}

/* ================= 场景 T59h：清理隔离数据的完整交互 ================= */
section("T59h P1-5 · 清理隔离数据的交互闭环（二次确认 → 清空 → 状态提示）");
{
  const { beat, els } = loadApp({ "beatsight.customs": JSON.stringify({ v:1, customs: [
    { name: "坏预设", meter: 99, bars: [] },
  ] }) });
  els["helpClearQuar"].fire("click");
  eq(beat.Modal.isOpen(), true, "点击清理入口先弹二次确认（不可撤销的操作都要拦一下）");
  els["modalCancel"].fire("click");                      // 取消 → 不清
  eq(beat.Store.quarantine().length, 1, "取消后隔离数据还在");
  els["helpClearQuar"].fire("click");
  els["modalOk"].fire("click");                          // 确认 → 清
  eq(beat.Store.quarantine().length, 0, "确认后隔离数据被清空");
  eq(els["helpClearQuar"].hidden, true, "清理后入口自动隐藏（条数归零）");
  eq(els["statusText"].textContent, "已清理隔离数据", "状态栏给出反馈（不是「点完什么都没发生」）");
}

/* ================= 场景 T59f：调度饥饿必须可见 ================= */
section("T59f P1-1 · 调度饥饿（重锚）被记进诊断计数，不再静默吞拍");
{
  const { beat } = loadApp();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  ok(!!ac, "播放中已建立音频上下文");
  eq(beat.diag.reanchorStarved, 0, "初始重锚计数为 0");
  ac.currentTime += 60;                          // 模拟后台被节流 60 秒：游标远远落后实时时钟
  beat.AudioEngine.scheduler();
  eq(beat.diag.reanchorStarved, 1, "★ 一次饥饿重锚被计数（此前完全静默，用户只能说「好像卡了一下」）");
  eq(beat.Store.S.playing, true, "重锚不影响播放状态（只是把时间轴对齐到当下）");
}
