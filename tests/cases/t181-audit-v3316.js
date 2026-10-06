/* BeatSight 自动化测试 · v3.31.6 落地批次（P0-A / P0-B / P3-D / S-1 / B3 / B1 / P1-B / P2-A / P2-B / P2-C）
   ---------------------------------------------------------------------------
   逐条对应 v3.31.6 修复（P1-A 与 B4 在 t182，走 opt-in rAF 队列）。
   ★ 反向验证锚点（变异清单）见各节注释：回退修复 → 具名断言变红。
   ================================================================================ */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section, drive } = require("../lib/harness");

/* ================= T181a：P0-A 旧键为原始值不白屏 ================= */
section("T181a 迁移 · 旧键为数字/字符串/布尔照常启动（此前整页白屏）");
{
  for (const v of ["5", '"abc"', "true"]){
    let ok0 = false;
    try { ok0 = !!loadApp({ "beatsight.m2": v }).beat.Store.S; } catch(e){ ok0 = false; }
    ok(ok0, "★ m2=" + v + " 不崩且 Store 正常初始化（此前 saved.v=3 对原始值赋值抛 TypeError）");
  }
  /* 对照：合法对象旧键迁移照旧 */
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ v: 2, customs: [
    { name: "老四四", meter: 4, bars: [[{ d: 1 }, { d: 1 }, { d: 1 }, { d: 1 }]] }] }) });
  eq(beat.Store.customs.length, 1, "合法旧键照常迁移（类型守卫不误伤）");
  eq(beat.Store.customs[0].bars[0][0].t, 48, "d→t 换算不受影响");
  /* 反向验证锚点：把 legacy 守卫退回 `readJSON(KEY_LEGACY) || {}` → 上面三个 ok 变红（loadApp 抛错）。 */
}

/* ================= T181b：P0-B 分组 custom 成员跨设备重映射 ================= */
section("T181b 全量导入 · 分组 custom 成员随包内映射重写（此前静默消失）");
{
  const app1 = loadApp();
  app1.beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "载体四四", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] },
  ] }));
  const c = app1.beat.Store.customs[app1.beat.Store.customs.length - 1];
  app1.beat.Store.groupCreate("beat", "我的组");
  app1.beat.Store.groups[0].members.push({ type: "custom", id: c.id });
  app1.beat.Store.persistGroups();
  const pack = app1.beat.Store.serializeAll();
  const app2 = loadApp();
  const r = app2.beat.Store.importAll(pack);
  ok(r.ok, "全量导入 ok");
  const g2 = app2.beat.Store.groups.find(x => x.name === "我的组");
  ok(!!g2 && g2.members.length === 1, "★ 组与成员随包导入");
  const mem = g2.members[0];
  ok(app2.beat.Store.customs.some(x => x.id === mem.id), "★ 组员指向本机新 id（此前指向旧 id、resolveRef 落空静默消失）");
  ok(!!app2.beat.resolveRef(mem), "★ resolveRef 解析成功");
  /* 预览计数口径一致 */
  const app3 = loadApp();
  const pv = app3.beat.Store.previewImport(pack);
  const pvGrp = (pv.parts.find(x => x.kind === "分组") || {}).count || 0;
  const real = app3.beat.Store.importAll(pack);
  eq(pvGrp, real.settings.groups, "★ 预览分组计数 == 实际落盘（同映射口径）");
  /* 反向验证锚点：normImportGroups 的 nid 退回 r.id → 「组员指向本机新 id」变红。 */
}

/* ================= T181c：P3-D groupMove 建组同口径单调 ================= */
section("T181c 分组 · 移入新组与建组同一单调计数器（此前 groupMove 漏改）");
{
  const { beat } = loadApp();
  beat.Store.groupCreate("beat", "组甲");
  const g1 = beat.Store.groups[0].id;
  beat.Store.groupDelete(g1);
  ok(beat.Store.groupMove({ type: "builtin", idx: 0 }, "beat", "组乙"), "移入新组（建组入口 2）");
  const g2 = beat.Store.groups[0].id;
  ok(g1 !== g2, "★ 同毫秒建→删→移入新建 id 互异（此前 groupMove 用 groups.length 撞号）");
  beat.Store.groupDelete(g2);
  ok(beat.Store.groupMove({ type: "builtin", idx: 1 }, "beat", "组丙"), "再建");
  const g3 = beat.Store.groups[0].id;
  ok(g2 !== g3, "★ 连续建→删→建（move 入口）id 依旧互异");
  /* 反向验证锚点：groupMove 的 id 退回 groups.length → 上面两条 ok 变红。 */
}

/* ================= T181d：S-1 合成失败保留页锚 ================= */
section("T181d 窗口合成 · 引用失效时保留页锚（此前写回 -1 → 帧循环每帧重建）");
{
  const app = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t1", name: "S1", sections: [{ name: "A", blocks: [{ ref: { type: "custom", id: "s1c" }, repeats: 8 }] }] }] }),
    "beatsight.customs": JSON.stringify({ v: 1, customs: [
      { id: "s1c", name: "S1载体", meter: 4, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }),
    "beatsight.arrmig73": "1", "beatsight.demoSeeded": "1",
    "beatsight.arrmig73": "1",
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "t1", from: 0, to: 7, loop: false } }),
  });
  const { beat } = app;
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 0.5);
  /* 播放中删除被引用的自定义型（UI 删除链：splice → 组剪枝 → 刷新重合成 → 落盘） */
  const at = beat.Store.customs.findIndex(x => x.id === "s1c");
  beat.Store.customs.splice(at, 1);
  beat.Store.groupPruneCustom("s1c");
  beat.Presets.refreshAfterPatternChange();
  beat.Store.persistCold();
  const ws = beat.Viz.winStartState();
  eq(ws.pat, false, "★ 合成失败（引用已断）——winPat 为 null，视觉按「画当前型」降级");
  ok(ws.start >= 0, "★ 页锚保留（≥0）——此前写回 -1，帧循环 ws(≥0) ≠ -1 恒真 → 每帧 buildViz");
  beat.Controls.stop();
  /* 反向验证锚点：把 buildViz 回退成 `winStart = -1` → 「页锚保留」变红（start === -1）。 */
}

/* ================= T181e：B3 歌词位置三档点击接线 ================= */
section("T181e 歌词位置 · 三档 pill 点击生效（此前桩里三 pill 不存在、接线零覆盖）");
{
  const app = loadApp({ "beatsight.state": JSON.stringify({ v: 3, showLyric: true, lyricPos: "auto" }) });
  const { beat, els } = app;
  const grp = els["lyricPosGroup"];
  ok(grp && grp.children.length === 3, "★ 桩里三 pill 已登记（此前 children 空、querySelectorAll 命中 0）");
  const pill = pos => grp.children.find(c => c.dataset.pos === pos);
  ok(!!pill("auto") && !!pill("follow") && !!pill("bottom"), "三档按钮都在");
  pill("follow").fire("click");
  eq(beat.Store.S.lyricPos, "follow", "★ 点「贴在每行小节下」→ S.lyricPos = follow");
  pill("bottom").fire("click");
  eq(beat.Store.S.lyricPos, "bottom", "★ 点「集中在底部」→ S.lyricPos = bottom");
  beat.Store.flush();
  eq(JSON.parse(app.storage.get("beatsight.state")).lyricPos, "bottom", "★ 选择落热键");
  /* 关闭总开关后点击无效（禁用态守卫） */
  beat.Store.S.showLyric = false;
  pill("auto").fire("click");
  eq(beat.Store.S.lyricPos, "bottom", "★ showLyric=false 时点击无效（守卫生效）");
  /* 反向验证锚点：删掉 HTML_CHILDREN 的 lyricPosGroup 登记 → 「三 pill 已登记」变红。 */
}

/* ================= T181f：B1 scrollWidth 可注入 → 隐藏分支可测 ================= */
section("T181f 时值标注 · 标注比格子宽就隐藏（此前 scrollWidth 恒 0、分支零执行）");
{
  const app = loadApp({}, { scrollW: 1200, rowW: 600 });
  const { beat, els } = app;
  beat.Presets.buildPresetList && beat.Presets.buildPresetList();
  beat.Viz.buildViz();
  const labels = [];
  els["viz"].children.forEach(row => Array.prototype.forEach.call(row.children || [], c => {
    if (/(^| )cell-label( |$)/.test(c.className)) labels.push(c);
  }));
  ok(labels.length > 0, "前提：有时值标注（cell-label）");
  ok(labels.some(lb => lb.style.display === "none"), "★ 宽标注被隐藏（offsetWidth 600 < scrollWidth 1200+10 分支真执行）");
  /* 对照：缺省 scrollWidth=0 → 分支恒 false（旧行为） */
  const app2 = loadApp({}, { rowW: 600 });
  app2.beat.Viz.buildViz();
  let hidden2 = 0;
  app2.els["viz"].children.forEach(row => Array.prototype.forEach.call(row.children || [], c => {
    if (/(^| )cell-label( |$)/.test(c.className) && c.style.display === "none") hidden2++;
  }));
  eq(hidden2, 0, "缺省 scrollWidth=0 → 标注不隐藏（对照，证明注入生效）");
  /* 反向验证锚点：把桩的 scrollWidth 注入删掉 → 「宽标注被隐藏」变红。 */
}

/* ================= T181g：P1-B 空小节补训练爬坡计数 ================= */
section("T181g 变速训练 · 试听含空小节草稿时爬坡照常计数（此前漏计）");
{
  const { beat, els } = loadApp({ "beatsight.state": JSON.stringify({ v: 3, bpm: 120,
    trainer: { on: true, target: 200, step: 10, everyN: 1 } }) });
  beat.Editor.open();
  els["auditionBtn"].fire("click");                    // 试听草稿（4 小节四分基础）
  const ac = FakeAudioContext.last;
  drive(ac, beat, 0.2);
  els["clearBarBtn"].fire("click");                    // 清空第 1 小节（草稿出现空小节）
  els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 0, "前提：草稿第 1 小节已清空");
  /* 120BPM：1 小节 = 2s。播放跨过空小节：空小节分支必须补 onBarBoundary → 第 2 步起爬 */
  drive(ac, beat, 5);
  const txt = els["trainerProg"].textContent;
  ok(txt.indexOf("第 2") >= 0 || txt.indexOf("第 3") >= 0 || txt.indexOf("第 4") >= 0,
     "★ 空小节后爬坡进度仍推进（此前空小节不计数、进度停留在第 1 步）——实际「" + txt + "」");
  beat.Controls.stop();
  /* 反向验证锚点：删掉空小节分支的 Trainer.onBarBoundary() → 上面 ok 变红（文案恒「第 1」）。 */
}

/* ================= T181h：P2-A lyricFit 缓存封顶 ================= */
section("T181h 歌词缓存 · 封顶 512（此前删建曲式留死条目、无界增长）");
{
  const { beat } = loadApp();
  /* 600 条曲式 + 歌词行，逐条查询填充缓存——upsertArrange 会逐次落盘，这里用小型化数据 */
  const mk = i => ({ id: "a-fit" + i, name: "缓存" + i, sections: [
    { name: "A", blocks: [{ ref: { type: "builtin", idx: 1 }, repeats: 1 }] }] });
  const mkLy = (i, uid) => [{ t: 0, dur: 24, ch: "啊" }];
  for (let i = 0; i < 600; i++){
    beat.Store.upsertArrange(mk(i));
    const a = beat.Store.arranges[beat.Store.arranges.length - 1];
    beat.Store.upsertLyric(a.id, a.sections[0].uid, mkLy(i), { deferPersist: true });
  }
  beat.Store.persistLyrics();
  beat.Store.arranges.forEach(a => beat.lyricCharsAt(a.id, a.sections[0].uid));
  ok(beat.lyricFitSize() <= 512, "★ 缓存被 512 封顶（实际 " + beat.lyricFitSize() + "；此前 600 条且删建只增不清）");
  /* 反向验证锚点：删掉 lyricCharsAt 的封顶 → 上面 ok 变红（size 600）。 */
}

/* ================= T181i：P2-B 隔离区体积封顶 ================= */
section("T181i 隔离区 · 脏预设超 100 条只保留前 100（此前无上限）");
{
  /* 120 条坏预设（拍号非法）进冷键 → 加载全部被隔离 → 写入封顶 100 条 */
  const bad = [];
  for (let i = 0; i < 120; i++) bad.push({ name: "脏" + i, meter: 9, bars: [] });
  const app = loadApp({ "beatsight.customs": JSON.stringify({ v: 1, customs: bad }) });
  const q = JSON.parse(app.storage.get("beatsight.quarantine"));
  ok(Array.isArray(q) && q.length === 100, "★ 隔离区封顶 100 条（实际 " + (q ? q.length : "无") + "）");
  /* 反向验证锚点：删掉 rejectedCustoms 的 100 条截断 → 上面 ok 变红（120）。 */
}

/* ================= T181j：P2-C 示例曲带出批量落盘 ================= */
section("T181j 示例曲带出 · 歌词一次性落盘（此前逐行 N 次整键写）");
{
  const app = loadApp();
  const { beat } = app;
  beat.Store.deleteArrange(beat.DEMO_ID);              // 删掉出厂示例（连同歌词）
  const store = app.storage;
  let n = 0;
  const origSet = store.set.bind(store);
  store.set = (k, v) => { if (k === "beatsight.lyrics") n++; return origSet(k, v); };
  beat.Arrange.loadDemo();                             // 重新带出（走 ensureDemo 的歌词循环）
  eq(n, 1, "★ 歌词冷键只写 1 次（此前 spec.lyrics 逐行 upsertLyric、每行一次全量 stringify）");
  ok(beat.Store.lyrics.length > 0, "歌词已带出");
  /* 反向验证锚点：upsertLyric 忽略 deferPersist → 上面 eq 变红（n = 歌词行数）。 */
}
