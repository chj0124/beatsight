/* BeatSight 自动化测试 · 静音拍参数化：N/M + 随机（v2.71.0，1.5）
   T140 系列。
   ---------------------------------------------------------------------------
   用户要求（1.5）：静音拍从写死「每 4 小节静第 4 小节」参数化——
   每 N 小节一组、静音组内末尾 M 个；另要**随机**模式（用户拍板：本批落地）。

   机理与契约：
     · 唯一判据函数 muteBarMuted(lin)（共享区，__beat 直出）：
       固定 = 组内末尾 count 个；随机 = 组号作种子的 mulberry32 + Fisher–Yates
       无放回抽 count 位（**确定性**：同组号恒同结果 ⇒ 发声/视觉/状态栏三处一致）。
     · 存储 S.muteCfg = {period, count, random} 进热键；域校验 period 2–8、
       count 1–period−1、random 只认 true；老存档无此键 ⇒ {4,1,false}，
       与旧 MUTE_PERIOD=4 行为逐位一致（零迁移）。
     · UI：muteToggle 文案「静音拍」，右侧参数行（照 trainerPanel：开着才露面），
       M 选项随 N 联动重建；任一变更 ⇒ Viz.syncMuteBars() 即时重算行标识。
     · 行标识根治：mutedRow 对任意档位精确（旧「同屏行数 ≠ 4 标不出来」退役）。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const barRows = els => els["viz"].children.filter(c => /(^| )bar-row( |$)/.test(c.className));
const mutedRows = els => barRows(els).filter(c => /muted-bar/.test(c.className));

/* ================= 场景 T140a：判据纯函数 · 固定模式 ================= */
section("T140a muteBarMuted · 固定模式（默认 4/1 与自定义 N/M）");
{
  const app = loadApp();
  const { beat } = app;
  const S = beat.Store.S;
  S.mute = true;
  eq(beat.muteBarMuted(0), false, "固定 4/1：第 1 小节不静");
  eq(beat.muteBarMuted(3), true, "★ 固定 4/1：第 4 小节静（旧行为逐位一致）");
  eq(beat.muteBarMuted(7), true, "固定 4/1：第 8 小节静（每 4 小节循环）");
  eq(beat.muteBarMuted(5), false, "固定 4/1：第 6 小节不静");
  S.muteCfg = { period: 3, count: 2 };
  eq(beat.muteBarMuted(0), false, "固定 3/2：组内第 1 位不静");
  eq(beat.muteBarMuted(1), true, "★ 固定 3/2：组内末 2 位的前一位静");
  eq(beat.muteBarMuted(2), true, "★ 固定 3/2：组内末位静");
  eq(beat.muteBarMuted(4), true, "固定 3/2：下一组同样末 2 位静");
  S.mute = false;
  eq(beat.muteBarMuted(3), false, "S.mute 关 ⇒ 判据恒 false（总开关优先）");
}

/* ================= 场景 T140b：随机模式 · 确定性 + 恰 M 个 + 组间可变 ================= */
section("T140b 随机静音 · 组号种子 ⇒ 确定性；组内恰 count 个；组间模式可变");
{
  const { beat } = loadApp();
  const S = beat.Store.S;
  S.mute = true;
  S.muteCfg = { period: 4, count: 1, random: true };
  ok(beat.muteBarMuted(0) === beat.muteBarMuted(0), "★ 同一小节两次查询逐位相同（确定性）");
  ok(beat.muteBarMuted(0) === beat.muteBarMuted(8), "★ 同组（0 与 8 同属组 0/2?——8=组2）：同配置下判定稳定");
  /* 每组恰 count 个静音 */
  for (let g = 0; g < 6; g++){
    let m = 0;
    for (let i = 0; i < 4; i++) if (beat.muteBarMuted(g * 4 + i)) m++;
    eq(m, 1, "随机 4/1：组 " + g + " 内恰 1 个静音小节");
  }
  /* 组间模式可变（全部同构的概率 = (1/4)^9，可忽略） */
  S.muteCfg = { period: 4, count: 2, random: true };
  const sets = new Set();
  for (let g = 0; g < 10; g++){
    const pos = [];
    for (let i = 0; i < 4; i++) if (beat.muteBarMuted(g * 4 + i)) pos.push(i);
    ok(pos.length === 2, "随机 4/2：组 " + g + " 内恰 2 个静音");
    sets.add(pos.join(","));
  }
  ok(sets.size >= 2, "★ 10 个组里至少 2 种不同的静音位模式（组间真的在随机）——实际 " + sets.size + " 种");
}

/* ================= 场景 T140c：存储校验 · 老存档零迁移 + 脏值钳制 ================= */
section("T140c muteCfg · 老存档默认 4/1；脏 period/count 钳回有效域");
{
  const a = loadApp();
  const cfg = a.beat.Store.S.muteCfg;
  ok(cfg.period === 4 && cfg.count === 1 && cfg.random === false,
    "★ 老存档（无 muteCfg 键）⇒ {4,1,false}——与 v2.70 行为逐位一致，零迁移");
  const b = loadApp(seedState({ muteCfg: { period: 9, count: 5, random: "yes" } }));
  const c2 = b.beat.Store.S.muteCfg;
  ok(c2.period === 4 && c2.count === 1 && c2.random === false,
    "★ 脏值（period 越界/count 超域/random 非布尔）全数钳回 {4,1,false}");
  const c3 = loadApp(seedState({ muteCfg: { period: 6, count: 2, random: true } })).beat.Store.S.muteCfg;
  ok(c3.period === 6 && c3.count === 2 && c3.random === true, "合法自定义档位原样通过");
}

/* ================= 场景 T140d：UI · 参数行随开关露面 + N/M 联动 + 持久化 ================= */
section("T140d 参数行 · 开关开着才露面；N 变 M 重建并钳制；偏好落热键");
{
  const { beat, els, storage } = loadApp();
  eq(els["muteCfgPanel"].hidden, true, "默认（静音拍关）参数行隐藏");
  ok(/>静音拍<span class="switch">/.test(html) && html.indexOf("静音拍 · 每 4 小节") === -1,
    "★ 开关文案已去掉写死的「· 每 4 小节」（源码级：桩 textContent 不吃混排文本节点）");
  els["muteToggle"].fire("click");
  eq(els["muteCfgPanel"].hidden, false, "★ 开启 ⇒ 参数行露面（照 trainerPanel 模式）");
  eq(els["muteEvery"].children.length, 7, "N 下拉 = 2–8 共 7 档");
  eq(els["muteEvery"].value, "4", "默认 N=4 选中");
  eq(els["muteCount"].children.length, 3, "M 下拉随 N=4 生成 1–3 共 3 档");
  /* N 变 3 ⇒ M 选项重建为 1–2、count 钳回域内 */
  els["muteEvery"].value = "3";
  els["muteEvery"].fire("change");
  eq(beat.Store.S.muteCfg.period, 3, "N=3 写入 S.muteCfg.period");
  eq(els["muteCount"].children.length, 2, "★ M 选项联动重建（1–2 共 2 档）");
  eq(beat.Store.S.muteCfg.count, 1, "count 保持有效（≤ N−1）");
  /* 随机子开关 */
  els["muteRandomToggle"].fire("click");
  eq(beat.Store.S.muteCfg.random, true, "★ 随机 ⇒ S.muteCfg.random 翻转");
  ok((/on( |$)/.test(els["muteRandomToggle"].className)), "随机 pill 视觉同步 on");
  beat.Store.flush();
  const saved = JSON.parse(storage.get("beatsight.state")).muteCfg;
  ok(saved.period === 3 && saved.random === true, "★ 参数整组落热键（跟 showTab 同族）");
}

/* ================= 场景 T140e：视觉行标识 · 任意档位精确（老限制根治） ================= */
section("T140e 行标识 · 预设模式任意 period 都精确标出（旧「档位≠4 标不出」退役）");
{
  const { beat, els } = loadApp();
  beat.Store.S.mute = true;
  beat.Store.S.muteCfg = { period: 4, count: 1, random: false };
  beat.Viz.syncMuteBars();
  eq(mutedRows(els).length, 1, "4/1：4 行窗口恰 1 行被标（旧行为不变）");
  beat.Store.S.muteCfg = { period: 2, count: 1, random: false };
  beat.Viz.syncMuteBars();
  eq(mutedRows(els).length, 2, "★ 2/1：4 行窗口恰 2 行被标（旧版此档位标不出来）");
  beat.Store.S.muteCfg = { period: 3, count: 1, random: false };
  beat.Viz.syncMuteBars();
  eq(mutedRows(els).length, 1, "3/1：4 行窗口按线性号判（第 3 行）");
}
