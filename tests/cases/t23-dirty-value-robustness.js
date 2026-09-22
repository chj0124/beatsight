/* BeatSight 自动化测试 · 脏持久值健壮性：钳制 / 结构淘汰 / 渲染帧不得死亡
   T23 系列。JSON 合法但值非法的输入一律收敛，且渲染循环不得静默死亡。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   用例按场景组切分，新增用例请进对应文件，避免回到「一个文件塞下全部场景」。 */
"use strict";
const { loadApp, FakeAudioContext, driveFrames, ok, eq, section, drive } = require("../lib/harness");

/* ================= 场景 T23：持久值健壮性（v1.2.4） =================
   背景：v1.2.3 的 T1 只覆盖了「坏 JSON」，没覆盖「JSON 合法但值非法」这条更常见的损坏路径。
   实测后果按严重度递增：
     · {"sig":"abc"} / 空小节 customs → paintFrame 抛 TypeError。异常落在 rAF 回调内，
       下一帧的 requestAnimationFrame 从未注册 → 渲染循环永久死亡（画面冻结、声音照响、无报错）。
     · {"sig":-3} → scheduler 的「空小节」分支步长为负，nextNoteTime 只减不增，
       while 条件恒真 → **主线程死循环，标签页 100% CPU 卡死**。
     · {"vol":1e6} → 增益送到 +120 dBFS（削波爆音）。
   「试听中清空小节」这条**不需要任何损坏数据**即可触发第一条，属真实用户可达路径。
   本场景把上述复现用例全部固化为断言。 */

const VALID_SIGS = [2, 3, 4, 5, 6, 7];

section("T23 脏拍号 · 必须钳制到合法拍号，且不得让渲染帧抛异常");
{
  /* 覆盖：字符串 / 负零 / 负数 / 越界 / null / 布尔 —— 全部是"JSON 合法、值非法" */
  const cases = [["abc", "字符串"], [-3, "负数（v1.2.3 会让调度器死循环）"], [99, "越界"],
                 [0, "零"], [null, "null"], [true, "布尔"]];
  cases.forEach(([v, desc]) => {
    const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ sig: v }) });
    ok(VALID_SIGS.includes(beat.Store.S.sig), `sig=${JSON.stringify(v)}（${desc}）钳制到合法拍号（实际 ${JSON.stringify(beat.Store.S.sig)}）`);
    beat.Controls.start();
    ok(beat.Store.S.playing, `sig=${JSON.stringify(v)}：进入播放态`);
    const err = driveFrames(FakeAudioContext.last, beat, 0.4);
    ok(!err, `sig=${JSON.stringify(v)}：调度 + 渲染全程无异常（${err || "OK"}）`);
    ok(beat.Store.S.playing, `sig=${JSON.stringify(v)}：播放未被异常中断（死循环会在此处超时）`);
  });
}

section("T23b 空小节 customs · 结构校验淘汰 + 隔离备份 + 渲染不崩");
{
  const bad = { id: "z", name: "坏预设-空小节", meter: 4, bars: [[], [], [], []] };
  const { beat, storage } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, customs: [bad], sel: { type: "custom", id: "z" } }) });
  eq(beat.Store.customs.length, 0, "空小节预设被 load 路径的结构校验淘汰（原先原样信任）");
  ok(storage.has("beatsight.quarantine"), "淘汰项隔离到 beatsight.quarantine，可人工找回");
  eq(JSON.parse(storage.get("beatsight.quarantine")).length, 1, "隔离备份内容完整");
  beat.Controls.start();
  const err = driveFrames(FakeAudioContext.last, beat, 2);
  ok(!err, "空小节不再让渲染帧抛异常（v1.2.3 此处 TypeError）");

  /* 反向守卫：合法自定义预设不得被校验误杀 */
  const { beat: b2, storage: st2 } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3,
    sel: { type: "custom", id: "keep" },
    customs: [{ id: "keep", name: "合法预设", meter: 4, accents: [0, 2],
      bars: [0,1,2,3].map(() => [{ t: 48 }, { t: 24 }, { t: 24 }, { t: 48 }, { t: 48 }]) }] }) });
  eq(b2.Store.customs.length, 1, "合法自定义预设不被校验误杀");
  eq(b2.Store.customs[0].id, "keep", "合法预设的 id 被保留");
  eq(JSON.stringify(b2.Store.customs[0].accents), JSON.stringify([0, 2]), "合法预设的 accents 被保留");
  eq(b2.curPattern().name, "合法预设", "合法预设仍被选为当前节奏型");
  ok(!st2.has("beatsight.quarantine"), "无淘汰项时不产生 quarantine 备份");
}

section("T23c 音量越界 · 必须钳制到 [0,1]，增益不得超 0 dBFS");
{
  const cases = [[1e6, "1e6（v1.2.3 实测 +120 dBFS）"], [3, "3"], [-5, "负数"], ["x", "字符串"]];
  cases.forEach(([v, desc]) => {
    /* sel idx 1（四分基础，无扫弦记谱）：本场景守的是**节拍声部**的 0 dBFS 上限。
       v2.7.1 起带扫弦记谱的谱（如民谣扫弦）归扫弦声部——那条路径有 makeup 增益
       （峰值 ≤ makeup=8，安全性论证见 CONFIG.timbres 注释），混进来会误报 */
    const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, vol: v, accentVol: 1, bpm: 120, sel: { type: "builtin", idx: 1 } }) });
    const vol = beat.Store.S.vol;
    ok(vol >= 0 && vol <= 1, `vol=${JSON.stringify(v)}（${desc}）钳制到 [0,1]（实际 ${vol}）`);
    beat.Controls.start();
    const ac = FakeAudioContext.last;
    drive(ac, beat, 1.2);
    const peaks = ac.hits.filter(h => h.gain !== undefined).map(h => h.gain);
    ok(peaks.length > 0, `vol=${JSON.stringify(v)}：有发声包络可测`);
    ok(peaks.every(p => p <= 1), `vol=${JSON.stringify(v)}：送达增益峰值 ≤ 1.0（实测 ${Math.max(...peaks).toFixed(3)}）`);
  });
  /* accentVol 同样越界 */
  const { beat: bAcc } = loadApp({ "beatsight.m2": JSON.stringify({ v: 3, vol: 0.8, accentVol: 1e9 }) });
  ok(bAcc.Store.S.accentVol <= 1, `accentVol=1e9 钳制到 [0,1]（实际 ${bAcc.Store.S.accentVol}）`);
}

section("T23d 脏 BPM · 不得让位置换算变 NaN");
{
  const { beat } = loadApp({ "beatsight.m2": JSON.stringify({ bpm: "abc" }) });
  ok(isFinite(beat.Store.S.bpm), `脏 bpm 回退为有限值（实际 ${beat.Store.S.bpm}）`);
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const err = driveFrames(ac, beat, 1.5);
  ok(!err, "脏 BPM 下调度 + 渲染无异常（v1.2.3 此处 paintFrame TypeError）");
  ok(ac.hits.length > 0, `脏 BPM 下仍能正常发声（实测 ${ac.hits.length} 次）`);
  /* setBpm 是 BPM 唯一入口，脏输入在此收口 */
  beat.Controls.setBpm(NaN);
  ok(isFinite(beat.Store.S.bpm), "setBpm(NaN) 回退当前值而非污染 S.bpm");
  beat.Controls.setBpm("abc");
  ok(isFinite(beat.Store.S.bpm), "setBpm('abc') 回退当前值");
}

section("T23e 编辑器试听中清空小节 · 真实用户路径（无需任何损坏数据）");
{
  /* v1.2.3 实测：试听中点「清空当前小节」→ 草稿出现空小节 → curPattern() 返回草稿 →
     下一帧 steps[active].t 抛 TypeError → 渲染循环死亡。这条路径完全由正常操作触发 */
  const { beat, els } = loadApp();
  beat.Editor.open();
  els["auditionBtn"].fire("click");                       // 开始试听 → S.preview=true + start()
  const ac = FakeAudioContext.last;
  driveFrames(ac, beat, 0.3);
  els["clearBarBtn"].fire("click");                       // 清空当前小节（应用内确认框）
  els["modalOk"].fire("click");
  eq(beat.Editor.draft().bars[0].length, 0, "草稿第 1 小节已被清空");
  const err = driveFrames(ac, beat, 6);                   // 跨过整个循环，确保播放头经过空小节
  ok(!err, "试听中清空小节：调度 + 渲染全程无异常（v1.2.3 此处 TypeError）");
  ok(beat.Store.S.playing, "试听仍在继续，未被异常打断");
}

section("T23f 渲染帧异常 · 必须被外壳兜住并给出可见提示（不得静默死亡）");
{
  const { beat, els, sandbox } = loadApp();
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 0.5);
  /* 静音 sandbox 控制台，既保持测试输出干净，又能反过来断言"异常确实被记录了" */
  let errLogged = 0;
  sandbox.console = { log(){}, warn(){}, error(){ errLogged++; } };
  /* 人为注入故障：把状态栏换成"写入即抛"的替身，模拟帧内任意一点出异常。
     注意 els 是惰性缓存——只有被 getElementById 取过的 id 才有实体，
     所以这里必须先经 getElementById 拿到（并登记）statusText 元素，再改它的属性。 */
  const statusEl = sandbox.document.getElementById("statusText");
  let hit = 0;
  Object.defineProperty(statusEl, "textContent", {
    set(){ hit++; throw new Error("注入的渲染故障"); },
    get(){ return ""; }, configurable: true,
  });
  let escaped = null;
  try { beat.Viz.paintFrame(); } catch(e){ escaped = e; }
  ok(!escaped, `帧内异常不再冒泡出 paintFrame（rAF 回调不会静默死掉）${escaped ? "：" + escaped.message : ""}`);
  ok(hit > 0, "故障确实被触发（证明本用例有效）");
  eq(errLogged, 1, "异常已写入控制台，便于事后定位");
  eq(els["modalMask"].hidden, false, "用户看到可见的错误提示，而不是一片安静");
  eq(beat.Store.S.playing, false, "异常后自动停播（不会画面冻结还在响）");
}

section("T23g 正常路径 · 新守卫不得误伤");
{
  const { beat, els, sandbox } = loadApp();
  beat.Controls.start();
  const ac = FakeAudioContext.last;
  const err = driveFrames(ac, beat, 3);
  ok(!err, "正常节奏型：调度 + 渲染无异常");
  const status = sandbox.document.getElementById("statusText").textContent;
  ok(/^(播放中 · 第 [1-4] 小节 · \d|静音拍)/.test(status), "状态栏照常推进：" + status);
  ok(ac.hits.length > 0, `持续发声（实测 ${ac.hits.length} 次）`);
  ok(beat.Store.S.playing, "仍在播放");
  /* 6/8 与奇数拍同样要能跑通（这些走的是不同的刻度/分组分支） */
  [[6, "6/8"], [5, "5/4"], [7, "7/4"]].forEach(([sig, name]) => {
    const { beat: b } = loadApp({ "beatsight.m2": JSON.stringify({ sig }) });
    b.Controls.start();
    const e = driveFrames(FakeAudioContext.last, b, 3);
    ok(!e, `${name} 正常路径无异常（${e || "OK"}）`);
  });
}

section("T23h 调度器异常 · 与渲染帧同构的边界（v2.0.2 审计 D3）");
{
  /* scheduler 是 setInterval(25ms) 的周期回调。v2.0.2 之前它**没有任何异常边界**：
     一次意外（脏数据走到未设防分支 / AudioContext 被系统关闭 / DOM 引用失效）会让同一个
     错误每 25ms 重抛一次——控制台刷屏、音频时钟照走而状态停更，用户看到的是
     "在播放但没声音"，极难归因。这里注入一个**确定性的**调度期故障并断言收口行为：
     不冒泡 / 记日志 / 停播 / 可见提示（与 T23f 的 paintFrame 边界逐条对应）。 */
  const { beat, els, sandbox } = loadApp();
  beat.Controls.start();
  drive(FakeAudioContext.last, beat, 0.3);
  ok(beat.Store.S.playing, "前提：注入前正在播放");

  let errLogged = 0;
  sandbox.console = { log(){}, warn(){}, error(){ errLogged++; } };
  /* schedWindow() 是 schedulerBody() 的首句、读 document.hidden——把它换成"读即抛"，
     就得到一个每个 25ms 周期都会命中的调度期故障（比偶发脏数据更确定）。
     写侧吸收掉：setHidden 的赋值不该被这次注入牵连。 */
  let hits = 0;
  Object.defineProperty(sandbox.document, "hidden", {
    get(){ hits++; throw new Error("注入的调度故障"); },
    set(){}, configurable: true,
  });

  let escaped = null;
  try { beat.AudioEngine.scheduler(); } catch(e){ escaped = e; }
  ok(!escaped, `调度器异常不再冒泡出 scheduler()（周期回调不会反复重抛）${escaped ? "：" + escaped.message : ""}`);
  ok(hits > 0, "故障确实被触发（证明本用例有效）");
  eq(errLogged, 1, "异常已写入控制台，便于事后定位");
  eq(els["modalMask"].hidden, false, "用户看到可见提示，而不是「在播放但没声音」");
  ok(els["modalMsg"].textContent.indexOf("节拍调度出现异常") >= 0, "提示文案点明是调度异常：" + els["modalMsg"].textContent);
  eq(beat.Store.S.playing, false, "调度异常 → 经注入钩子自动停播");
}

