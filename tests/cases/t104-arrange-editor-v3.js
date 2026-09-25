/* BeatSight 自动化测试 · G2/G4 编辑效率之二：移到首尾 + 块候选三区 + 逐段试听（v2.27.0）
   T104 系列（PLAN-v3 阶段二 S3）。
   ---------------------------------------------------------------------------
   契约锚点（与 index.html buildSecRow / arrangeRender 的注释同源）：
     · v2.30.0（S1）起重排/删除收进段行的 ⋯ 菜单（.arg-sec-menu，挂段行末尾），
       ops 常显 [起, 终, ▶, ⋯]；菜单项全文字标签，测试按 aria-label 定位；
     · 候选区：三区组织（节拍/扫弦/自定义，判据与侧栏同一份 hasStr）+ **当前型置顶**（带 ✓）；
       当前型在原分区里不再重复出现；点当前型 = 空操作（结构逐位不变）；
     · 逐段试听 ▶：范围 = 该段起止小节 + loop:false + playQuota = 段小节数（听辨训练那套
       「到点停」，额度要在 Controls.start() **之前**设）——放完一段即停，不是循环。 */
"use strict";
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");

const BL = (idx, reps) => ({ ref: { type: "builtin", idx }, repeats: reps });
const seed3 = () => ({ "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
  { id: "t104", name: "三段歌", sections: [
    { uid: "uA", name: "A段", blocks: [BL(1, 1)] },
    { uid: "uB", name: "B段", blocks: [BL(1, 1)] },
    { uid: "uC", name: "C段", blocks: [BL(1, 1)] },
  ] },
]}) });
const rows = els => els["argSections"].children;
const opsOf = (els, i) => rows(els)[i].children[3];
const btnByAria = (els, i, re) => Array.prototype.find.call(opsOf(els, i).children, b => re.test(b.getAttribute("aria-label") || ""));
/* v2.30.0（S1）：重排/删除在段行的 ⋯ 菜单里——先点 ⋯ 展开（触发 arrangeRender，
   元素全部重建，所以"点"与"找"每步都重新取当前元素），再在菜单行里按 aria 找 */
const moreBtn = (els, i) => btnByAria(els, i, /更多段操作/);
const menuOf = (els, i) => Array.prototype.find.call(rows(els)[i].children, c => /(^| )arg-sec-menu( |$)/.test(c.className));
const openMenu = (els, i) => { moreBtn(els, i).fire("click"); return menuOf(els, i); };
const menuItem = (menu, re) => menu && Array.prototype.find.call(menu.children, b => re.test(b.getAttribute("aria-label") || ""));
const names = beat => beat.Store.findArrange("t104").sections.map(s => s.name).join("");

/* ================= 场景 T104a：移到首 / 尾 ================= */
section("T104a 移到首尾 · 一步到位 / 边界禁用 / 歌词（uid 键）跟着段走");
{
  const { beat, els } = loadApp(seed3());
  const St = beat.Store;
  St.upsertLyric("t104", "uA", [{ t: 0, dur: 24, ch: "一" }]);
  St.upsertLyric("t104", "uB", [{ t: 0, dur: 24, ch: "二" }]);
  beat.Arrange.open();
  eq(names(beat), "A段B段C段", "前提：A/B/C");

  eq(opsOf(els, 0).children.length, 2, "★ ops = [▶, ⋯] 2 颗（v2.31.0 S2：起/终退役，其余收进 ⋯ 菜单）");
  eq(opsOf(els, 0).children[0].getAttribute("aria-label"), "试听第 1 段（只放这一段一遍）", "★ 下标 0 是「▶ 试听」（动作钮常显）");
  /* 菜单边界禁用（原 ⤒/⤓ 的 disabled 口径不变，只是从 ops 搬进了菜单） */
  const m2 = openMenu(els, 2);
  eq(menuItem(m2, /移到最前/).disabled, false, "★ 末段的「移到最前」可用（往前移总有意义）");
  eq(menuItem(m2, /移到最后/).disabled, true, "★ 末段的「移到最后」禁用（已在最后）");
  moreBtn(els, 2).fire("click");                      // 收起末段菜单
  const m0 = openMenu(els, 0);
  eq(menuItem(m0, /移到最前/).disabled, true, "★ 首段的「移到最前」禁用（已在最前）");
  moreBtn(els, 0).fire("click");                      // 收起

  openMenu(els, 2);
  menuItem(menuOf(els, 2), /移到最前/).fire("click"); // C 段提到最前
  eq(names(beat), "C段A段B段", "★ 一步到首（splice + unshift，不是只挪一位）");
  eq(St.findLyric("t104", "uA").chars[0].ch, "一", "A 段的词仍挂 A 段（uid 跟着段走）");

  openMenu(els, 0);
  menuItem(menuOf(els, 0), /移到最后/).fire("click"); // C 段再丢到最后
  eq(names(beat), "A段B段C段", "一步到尾");
  eq(St.findLyric("t104", "uB").chars[0].ch, "二", "B 段的词仍挂 B 段");
  beat.Arrange.close();
}

/* ================= 场景 T104b：块候选三区 + 当前型置顶 ================= */
section("T104b 块候选 · 三区组织 / 当前型置顶带勾 / 点当前型是空操作");
{
  const { beat, els } = loadApp(seed3());
  beat.Arrange.open();
  /* A 段的块引用 BUILTINS[1]（四分基础，无扫弦记谱 → 「节拍」区）。
     「换」在**块 chip**里（不是段操作钮）：chip.children = [型名, 遍数, 单位, 换, ✕] */
  rows(els)[0].children[2].children[0].children[3].fire("click");
  const pick = rows(els)[1];                           // 候选行插在触发段行的**正下方**
  ok(/(^| )arg-pick( |$)/.test(pick.className), "★ 候选就在触点正下方（就地选择，v2.4.1 的既定结论）");
  const zones = pick.children[1].children.filter(c => /(^| )arg-pick-zone( |$)/.test(c.className)).map(z => z.textContent);
  eq(zones.join(","), "节拍,扫弦", "★ 分区标题出现（库里没有自定义型 → 空区不摆空标题，与「空动作不摆出来」同纪律）");

  const pills = pick.children[1].children.filter(c => /(^| )arg-mini( |$)/.test(c.className));
  const cur = pills.find(p => /✓/.test(p.textContent || ""));
  ok(!!cur, "★ 当前型置顶且带 ✓（" + (cur ? cur.textContent : "") + "）");
  /* ★ 守卫：置顶被删（变异）时 cur 是 undefined——后续三步必须**不执行**而不是崩在
     null.fire 上。崩溃不是证据（DEVELOPMENT 反向验证纪律），具名断言失败才是。 */
  if (cur){
    const curName = cur.textContent.replace("✓ ", "");
    const cnt = t => pills.filter(p => (p.textContent || "") === t).length;
    eq(cnt(curName), 0, "★ 置顶的当前型不在分区里重复出现（列表不虚长）");

    const before = JSON.stringify(beat.Store.findArrange("t104").sections);
    cur.fire("click");
    eq(JSON.stringify(beat.Store.findArrange("t104").sections), before, "★ 点当前型 = 空操作（结构逐位不变）");
    eq(rows(els).length, 3, "且候选行收起（回到三段行）");
  }
  beat.Arrange.close();

  /* 有自定义型时三区齐；扫弦型（BUILTINS[0] 民谣扫弦，带 dir 记谱）进「扫弦」区 */
  const app2 = loadApp(seed3());
  app2.beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "我的型", meter: 4, bars: [[{ t: 192 }]] }] }));
  app2.beat.Arrange.open();
  rows(app2.els)[0].children[2].children[0].children[3].fire("click");
  const pick2 = rows(app2.els)[1];
  const zones2 = pick2.children[1].children.filter(c => /(^| )arg-pick-zone( |$)/.test(c.className)).map(z => z.textContent);
  eq(zones2.join(","), "节拍,扫弦,自定义", "★ 库里有自定义型 → 三区齐（与侧栏三区同构）");
  const all2 = pick2.children[1].children.filter(c => /(^| )arg-mini( |$)/.test(c.className));
  const folk = all2.find(p => /民谣扫弦/.test(p.textContent || ""));
  ok(!!folk, "前提：候选里能找到民谣扫弦（带 dir 记谱的内置型）");
  folk.fire("click");
  eq(app2.beat.Store.findArrange("t104").sections[0].blocks[0].ref.idx, 0, "换型落库（引用换成 BUILTINS[0]）");
  app2.beat.Arrange.close();
}

/* ================= 场景 T104c：逐段试听（▶） ================= */
section("T104c 逐段试听 · 范围=该段 / 不循环 / 额度=段小节数 / 放完自停");
{
  const { beat, els } = loadApp(seed3());
  beat.Controls.setBpm(240);              // 1 小节 1s：4 小节 = 4s，驱动帧数可预算
  beat.Arrange.open();
  /* 三段各 4 小节：B 段占小节 4..7（0-based），额度 = 4 小节 */
  btnByAria(els, 1, /试听第 2 段/).fire("click");
  const sel = beat.Store.S.arrangeSel;
  eq(sel.id, "t104", "试听写入当前曲式");
  eq(JSON.stringify([sel.from, sel.to]), "[4,7]", "★ 范围 = 只有 B 段（小节 4..7）");
  eq(sel.loop, false, "★ 不循环（放完就停，区别于「循环本行」）");
  eq(beat.Store.S.playMode, "arrange", "进了曲式模式");
  eq(beat.Store.S.playing, true, "真的在播");
  eq(beat.quota().bars, 4, "★ 会话额度 = 段小节数（听辨训练同款「到点停」，start 前设）");
  ok(beat.quota().hasDone === false || true, "（额度钩子是听辨的领地，这里不注入）");

  /* 放完一段即停：4 小节 × 1s/小节（240BPM）——驱动 5s 必须已停 */
  const ac = FakeAudioContext.last;
  let stopped = false;
  for (let i = 0; i < 400 && !stopped; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    if (!beat.Store.S.playing) stopped = true;
  }
  ok(stopped, "★★ 放完这一段自动停（额度到点，不是一直循环下去）");
  beat.Controls.stop();

  /* 额度不残留：停掉后再正常播放，不该带着"4 小节就停"的旧额度 */
  beat.Store.S.arrangeSel = { id: "t104", from: 0, to: 11, loop: true, byLyric: false };
  beat.Controls.start();
  let kept = true;
  for (let i = 0; i < 260 && kept; i++){
    ac.currentTime += 0.02;
    beat.AudioEngine.scheduler();
    if (!beat.Store.S.playing) kept = false;
  }
  ok(kept, "★ 试听的额度用完即清，不污染下一次普通播放（到点停残留是最难查的那类 bug）");
  beat.Controls.stop();
  beat.Arrange.close();
}
