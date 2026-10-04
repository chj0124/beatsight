/* BeatSight 自动化测试 · v3.33.0「拍数 × 节奏类型」（基础节奏区 + 编辑器拍数档）
   ---------------------------------------------------------------------------
   本批给预设库加了「第 0 区」：实体节拍器式的两个**独立**选项——
     节奏类型（RHY，一拍之内的 9 种细分；TERENCE DM1 说明书截图 + KORG MA-2 规格定案）
     拍数（BEAT，2/4…7/4 与「0 · 均等（不分重拍）」）
   以及编辑器的拍数下拉（换拍数 = 按新拍数重建草稿骨架，可撤销）。

   钉六类性质：
     T185a 缺省即旧行为：basicPattern(m) / basicPattern(m,"quarter") 与 v3.33.0 之前**逐位相同**
           （这是整个改造的兼容性地基——所有老调用点一行未改）
     T185b 全组合合法：9 细分 × 6 拍号的每小节和恒 = meter×48、步形与 RHY_STEPS 逐格一致
     T185c 白名单与脏值：setRhy 挡非法值；存档里的脏 rhy / 脏 noAccent 一律收敛，不崩不脏
     T185d 持久化往返 + 旧存档零迁移（无 rhy 键 ⇒ quarter）
     T185e 解析链：sel={type:"basic"} 走 resolveRef→undefined→curPattern 回退，且
           alignSigToPattern **不**覆盖拍数（错配回退的前提是"没有手动拍号"）
     T185f 互斥与「均等」档；T185g 编辑器换拍数与撤销；T185i 曲式拍号残留还原

   ★ 反向验证锚点（变异清单，每刀必须出具名断言失败）：
     · RHY_STEPS.triplet8 改 [16,16,15]                → T185b 红（和 ≠ 48）
     · RHY_STEPS.quad16_r34 的休止标记去掉（[24,1]→[24]）→ T185b 红（rest 不一致）
     · S.rhy 默认值改 "duplet8"                        → T185a / T185d 红
     · 去掉 alignSigToPattern 的"basic 跳过"           → T185e 红
     · 去掉 enterBasic 的曲式拍数还原                  → T185i 红
     · pushUndo/undo 退回只存 bars                      → T185g 红
   ================================================================================ */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 存档种子助手：只写热键（旧存档形态 = 没有 rhy / noAccent 两个键） */
const hot = obj => ({ "beatsight.state": JSON.stringify(Object.assign({ v: 3 }, obj)) });

/* 基础节奏区的 9 枚图标 pill（真实 DOM 里由 buildPillRow 生成在 #rhyPillRow 内） */
const rhyBtns = els => els["rhyPillRow"].children;
/** @param {any} els @param {string} k */
const rhyIndex = (els, k) => els["rhyPillRow"].children.findIndex(b => b.dataset.rhy === k);
/** 点某节奏类型图标 @param {any} els @param {string} k */
function clickRhy(els, k){
  const i = rhyIndex(els, k);
  els["rhyPillRow"].children[i].fire("click");
}
/** 改拍数下拉 @param {any} els @param {any} v */
function pickSig(els, v){
  els["sigSel"].value = String(v);
  els["sigSel"].fire("change");
}

/* ================= T185a：缺省即旧行为（逐位相同） ================= */
section("T185a basicPattern 缺省 / quarter 与 v3.33.0 之前逐位相同（零迁移的地基）");
{
  const { beat } = loadApp();
  eq(beat.Store.S.rhy, "quarter", "★ 旧存档无 rhy 键 ⇒ 默认 quarter");
  eq(beat.Store.S.noAccent, false, "★ 旧存档无 noAccent 键 ⇒ 默认 false（照旧打重拍）");
  /* 期望**手写**成独立字面量，不调用被测代码去算期望值 */
  for (const m of [2, 3, 4, 5, 6, 7]){
    const one = beat.basicPattern(m);                 // 旧调用形态：单参
    const two = beat.basicPattern(m, "quarter");      // 新调用形态：显式 quarter
    const expBars = [Array.from({ length: m }, () => ({ t: 48, rest: false }))];
    eq(JSON.stringify(one.bars), JSON.stringify(expBars), `★ m=${m}：缺省参 ⇒ 每拍一个四分音符（bars 逐位）`);
    eq(JSON.stringify(two), JSON.stringify(one), `★ m=${m}：显式 quarter 与缺省参逐位相同`);
    eq(one.meter, m, `m=${m}：meter 就是传进来的拍数`);
    eq(one.name, "基础节奏 · 每拍一下", `★ m=${m}：名字保持旧文案（.patternName 的回归面）`);
    eq(one.desc, "当前拍号的默认节奏", `m=${m}：desc 保持旧文案`);
    eq(JSON.stringify(one.accents), JSON.stringify(beat.defaultAccents(m)), `m=${m}：重拍分组与旧口径同源`);
  }
}

/* ================= T185b：全组合合法（9 × 6） ================= */
section("T185b 9 种细分 × 6 个拍号：每小节和恒 = meter×48，步形与 RHY_STEPS 逐格一致");
{
  const { beat } = loadApp();
  const METERS = [2, 3, 4, 5, 6, 7];
  eq(beat.VALID_RHY.length, 9, "★ 9 种节奏类型（与说明书截图的 9 个符号一一对应）");
  for (const rhy of beat.VALID_RHY){
    const unit = beat.RHY_STEPS[rhy];
    ok(!!unit, "RHY_STEPS 有该键：" + rhy);
    eq(unit.reduce((a, st) => a + st[0], 0), 48, `★ ${rhy}：一拍之内时值和恒 = 48（TPB）`);
    for (const m of METERS){
      const p = beat.basicPattern(m, rhy);
      eq(p.bars.length, 1, "单小节型（v2.73.0 起的口径不变）");
      eq(p.bars[0].reduce((a, s) => a + s.t, 0), m * 48, `★ ${rhy}/${m}：小节和 = meter×TPB（过校验的前提）`);
      eq(p.bars[0].length, m * unit.length, `★ ${rhy}/${m}：步数 = 拍数 × 每拍步数`);
      let shapeOK = true, restOK = true;
      for (let i = 0; i < m; i++){
        for (let j = 0; j < unit.length; j++){
          const s = p.bars[0][i * unit.length + j];
          if (s.t !== unit[j][0]) shapeOK = false;
          if (s.rest !== (unit[j][1] === 1)) restOK = false;
        }
      }
      ok(shapeOK, `★ ${rhy}/${m}：时值序列与 RHY_STEPS 逐格一致`);
      ok(restOK, `★ ${rhy}/${m}：休止位与 RHY_STEPS 逐格一致（休止是 Step.rest，不是新字段）`);
    }
  }
  /* 带休止的三型：位置逐条点名（变异清单里的"去掉休止标记"这刀就砍在这里） */
  eq(JSON.stringify(beat.basicPattern(1, "triplet8_m").bars[0].map(s => !!s.rest)),
     JSON.stringify([false, true, false]), "★ 三连音·空二 = 响-休-响（KORG 的 inner beat omitted）");
  eq(JSON.stringify(beat.basicPattern(1, "quad16_m").bars[0].map(s => !!s.rest)),
     JSON.stringify([false, true, true, false]), "★ 四十六·空二三 = 响-休-休-响");
  eq(JSON.stringify(beat.basicPattern(1, "quad16_r34").bars[0].map(s => !!s.rest)),
     JSON.stringify([false, false, true]), "★ 四十六·后二休 = 响-响-休（1.5 拍休止）");
}

/* ================= T185c：白名单与脏值收敛 ================= */
section("T185c setRhy 挡非法值；存档脏 rhy / 脏 noAccent 一律收敛");
{
  const { beat, els, storage } = loadApp();
  beat.Controls.setRhy("quad16");
  eq(beat.Store.S.rhy, "quad16", "合法 id 被接受");
  beat.Controls.setRhy("不存在的型");
  eq(beat.Store.S.rhy, "quad16", "★ 非法 id 被挡（唯一写入点做白名单，脏值进不了状态）");
  beat.Controls.setRhy(undefined);
  eq(beat.Store.S.rhy, "quad16", "★ undefined 也被挡（不会把状态写成 undefined）");
  beat.Store.flush();
  eq(JSON.parse(storage.get("beatsight.state")).rhy, "quad16", "★ 白名单外的写没污染热键");

  const bad = loadApp(hot({ rhy: 99, noAccent: "yes" }));
  eq(bad.beat.Store.S.rhy, "quarter", "★ 脏 rhy（数字）⇒ 回 quarter，不崩");
  eq(bad.beat.Store.S.noAccent, false, "★ 脏 noAccent（非布尔真值）⇒ false（严格 === true 才认）");
  const bad2 = loadApp(hot({ rhy: { x: 1 }, noAccent: 1 }));
  eq(bad2.beat.Store.S.rhy, "quarter", "★ 脏 rhy（对象）⇒ 回 quarter");
  eq(bad2.beat.Store.S.noAccent, false, "★ noAccent=1 ⇒ false（不做真值转换）");
  ok(els["rhyPillRow"].children.length === 9, "基础节奏区 9 枚图标 pill 已生成");
}

/* ================= T185d：持久化往返 + 旧存档零迁移 ================= */
section("T185d 点图标 ⇒ 落热键 ⇒ 重载恢复；旧存档（无 rhy 键）行为照旧");
{
  const { beat, els, storage } = loadApp();
  clickRhy(els, "quad16");
  eq(beat.Store.S.sel.type, "basic", "★ 点图标即进入基础节奏模式（sel 第三形态）");
  eq(beat.Store.S.rhy, "quad16", "★ 点即生效（练习参数，不等小节边界）");
  eq(beat.curPattern().name, "基础节奏 · 四十六", "★ 当前型名字带上细分（画面标题可辨）");
  beat.Store.flush();
  const raw = JSON.parse(storage.get("beatsight.state"));
  eq(raw.rhy, "quad16", "★ rhy 随热键落盘");
  eq(JSON.stringify(raw.sel), JSON.stringify({ type: "basic" }), "★ sel 第三形态随热键落盘");

  const r = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(r.beat.Store.S.rhy, "quad16", "★ 重载后细分被恢复");
  eq(r.beat.Store.S.sel.type, "basic", "★ 重载后仍停在基础节奏模式");
  eq(r.beat.curPattern().name, "基础节奏 · 四十六", "★ 重载后当前型仍是它");

  const old = loadApp(hot({ sig: 4, sel: { type: "builtin", idx: 1 } }));
  eq(old.beat.Store.S.rhy, "quarter", "★ 旧存档（无 rhy 键）⇒ quarter = 与改造前逐位相同的行为");
  eq(old.beat.curPattern().name, "四分基础", "旧存档照旧选中内置型（解析链未受影响）");
}

/* ================= T185e：解析链与拍号归一 ================= */
section("T185e sel={type:\"basic\"} 经 resolveRef→undefined 落到 basicPattern；alignSigToPattern 不覆盖拍数");
{
  const { beat, els } = loadApp();
  clickRhy(els, "triplet8");
  eq(beat.resolveRef(beat.Store.S.sel), undefined,
     "★ resolveRef 对未知 type 返回 undefined（基础节奏模式不靠新分支，靠这条既有语义）");
  eq(beat.selectedPreset(), undefined, "selectedPreset 落空");
  eq(beat.curPattern().meter, beat.Store.S.sig, "★ 回退节奏的拍号 = 当前 S.sig");
  eq(beat.curPattern().bars[0].length, beat.Store.S.sig * 3, "★ 3 连音铺满整小节（每拍 3 步）");

  /* 拍数由用户在下拉里选，alignSigToPattern（启动/载入归一）**不得**把它改回某个型——
     基础节奏模式没有"选中型"，它若强行对齐就等于把用户刚选的拍数吃掉 */
  pickSig(els, 3);
  eq(beat.Store.S.sig, 3, "拍数已切到 3/4");
  beat.Presets.alignSigToPattern();
  eq(beat.Store.S.sig, 3, "★ basic 模式下 alignSigToPattern 不覆盖拍数（错配回退无从发生）");
  /* 对照组：选中一个内置型时，归一照旧把它对齐到型的拍号（既有行为不许被本次改动削弱） */
  beat.Controls.setSig(4);                              // 先人为掰到 4/4（模拟"非本模式"的拍号）
  beat.Store.S.sel = { type: "builtin", idx: 6 };       // 华尔兹分解 = 3/4
  beat.Store.S.rhy = "quarter";
  beat.Presets.alignSigToPattern();
  eq(beat.Store.S.sig, 3, "★ 普通选型路径仍按型的拍号归一（3/4 的华尔兹）——本次改动没削弱它");
}

/* ================= T185f：互斥 + 「均等」档 ================= */
section("T185f 基础节奏模式与选型互斥；「0 · 均等」= 每拍一样响、不动拍号");
{
  const { beat, els } = loadApp();
  clickRhy(els, "a8_216");
  eq(beat.Store.S.sel.type, "basic", "点图标 ⇒ basic");
  eq(rhyIndex(els, "a8_216") >= 0, true, "目标图标在列表里（下标有效，防索引写坏后静默通过）");
  eq(els["rhyPillRow"].children[rhyIndex(els, "a8_216")].getAttribute("aria-pressed"), "true",
     "★ 选中态落在 aria-pressed（同 setPressed 口径）");
  eq(els["rhyPillRow"].children[rhyIndex(els, "quarter")].getAttribute("aria-pressed"), "false",
     "★ 未选中的那枚是 false（高亮唯一）");

  /* 点库中任意型 ⇒ 离开 basic（既有路径，本次一行未改） */
  const list = els["presetList"].children.filter(c => c.className.indexOf("preset-item") === 0);
  ok(list.length >= 1, "预设库里有可点的内置型条目（" + list.length + " 条，防列表渲染变化后静默通过）");
  list[0].fire("click");
  eq(beat.Store.S.sel.type, "builtin", "★ 点预设型即离开基础节奏模式");
  eq(els["rhyPillRow"].children[rhyIndex(els, "a8_216")].getAttribute("aria-pressed"),
     "false", "★ 离开后图标高亮熄灭（两排都不再自称「在用」）");

  /* 「0 · 均等」：拍号不变、只是不打重拍 */
  clickRhy(els, "duplet8");
  const sigBefore = beat.Store.S.sig;
  pickSig(els, 0);
  eq(beat.Store.S.noAccent, true, "★ 选 0 档 ⇒ 均等（每拍一样响）");
  eq(beat.Store.S.sig, sigBefore, "★ 0 档**不动拍号**（小节长照旧；0 不是拍号）");
  eq(JSON.stringify(beat.curPattern().accents), JSON.stringify([]),
     "★ 均等 ⇒ accents=[]（发声层据此不加强重拍）");
  pickSig(els, 5);
  eq(beat.Store.S.noAccent, false, "★ 选非 0 档 ⇒ 均等被清掉");
  eq(beat.Store.S.sig, 5, "★ 拍号即该档（5/4）");
  eq(JSON.stringify(beat.curPattern().accents), JSON.stringify(beat.defaultAccents(5)),
     "★ 重拍分组回到该拍号的默认档（5/4 = 2+3）");
  eq(els["sigSel"].value, "5", "下拉值 = 当前拍数档");
}

/* ================= T185g：编辑器换拍数（重建骨架 + 撤销一步） ================= */
section("T185g 编辑器换拍数：重建为新拍数的骨架、可选撤销、dirty 先确认");
{
  const { beat, els } = loadApp();
  beat.Editor.open();                                   // 以当前型（内置第 0 个，4/4）为底稿
  eq(beat.Editor.draft().meter, 4, "底稿拍号 = 源型拍号（继承口径未变）");
  eq(els["editorMeterSel"].children.length, 6, "拍数下拉 6 档（VALID_METER 全档：2/4…7/4，含 6/8）");
  eq(els["editorMeterSel"].value, "4", "下拉初值 = 底稿拍号");

  els["editorMeterSel"].value = "3";
  els["editorMeterSel"].fire("change");                 // 未改动（dirty=false）⇒ 不弹确认
  eq(beat.Editor.draft().meter, 3, "★ 换拍数生效");
  eq(beat.Editor.draft().bars[0].length, 3, "★ 骨架 = 新拍数 × 每拍一下（3 枚）");
  eq(beat.Editor.draft().bars[0].reduce((a, s) => a + s.t, 0), 3 * 48, "★ 新小节和 = 新拍数×TPB（可保存）");
  eq(els["editorMeter"].textContent, 3, "★ 规则文案（「每小节须恰好占满 N 拍」）随渲染同步");
  eq(els["editorMeterSel"].value, "3", "下拉值随渲染同步");
  eq(beat.Editor.draft().accents.length > 0, true, "重建同时给了该拍号的默认重拍分组");

  beat.Editor.undo();
  eq(beat.Editor.draft().meter, 4, "★ Ctrl+Z 一步把**拍号**也退回（快照含 meter，不只是 bars）");
  eq(beat.Editor.draft().bars[0].reduce((a, s) => a + s.t, 0), 4 * 48, "退回后小节和回到 4/4 口径");

  /* dirty 路径：改过草稿（这里用名称输入置脏）⇒ 先确认再重建 */
  els["presetNameInput"].fire("input");
  els["editorMeterSel"].value = "6";
  els["editorMeterSel"].fire("change");
  eq(els["modalMask"].hidden, false, "★ 草稿已改动 ⇒ 弹确认（与 tryClose 的丢弃保护同口径）");
  eq(beat.Editor.draft().meter, 4, "★ 未确认前草稿不动");
  eq(els["editorMeterSel"].value, "4", "★ 下拉显示已拨回草稿真实拍号（不留「显示 6、实际 4」的假态）");
  els["modalOk"].fire("click");
  eq(beat.Editor.draft().meter, 6, "★ 确认后按 6/8 重建");
  eq(beat.Editor.draft().bars[0].reduce((a, s) => a + s.t, 0), 6 * 48, "6/8 口径：和 = 6×48");
}

/* ================= T185i：曲式拍号残留（离开曲式时把拍数还回来） ================= */
section("T185i 基础节奏模式下落过曲式后，拍数不被曲式的拍号顶掉");
{
  const { beat, els } = loadApp();
  clickRhy(els, "quad16");
  pickSig(els, 3);                                      // 基础节奏模式 = 3/4
  eq(beat.Store.S.sig, 3, "前提：基础节奏模式拍数 = 3/4");
  beat.setMode("playMode", "arrange", "测试：模拟进入曲式播放");
  beat.Controls.setSig(6);                              // 曲式整首同拍号 ⇒ 对齐会把 sig 改成它的（6/8）
  eq(beat.Store.S.sig, 6, "前提：曲式对齐把 sig 改成 6/8（既有逻辑）");
  clickRhy(els, "quad16");                              // 点节奏类型 = 回到单型练习
  eq(beat.Store.S.sig, 3, "★ 离开曲式进入基础节奏 ⇒ 拍数还原成 3/4（此前会被 6/8 顶掉、下拉还显示空白）");
  eq(beat.Store.S.playMode, "preset", "★ 顺带回单型练习（既有出口）");
  eq(els["sigSel"].value, "3", "下拉显示与真实拍数一致");
}
