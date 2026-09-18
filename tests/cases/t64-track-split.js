/* BeatSight 自动化测试 · 双入口拆分（v2.4.0）
   T64 系列。
   ---------------------------------------------------------------------------
   契约（用户拍板的三个选择，逐条对应到断言）：
     ① 参数隔离 = 「全部共享，仅入口区分」：切轨**不动** bpm/sig/vol/swing/timbre；
        两个入口共用同一个 S 与同一套定时（spb 全局纯函数），不复制任何参数。
     ② 入口位置 = 「侧栏预设库顶部加切换条」：#trackRow 在 #presetList 之前。
     ③ 扫弦预设处理 = 「从普通入口过滤掉」：普通轨列表无带扫弦记谱的型，
        且**切轨后自动回退**（不静默留一个列表外的选中项）。
   另守三条既有不变量不受影响：
     · 老用户零迁移：beatsight.state 里没有 track 键 → 落到 "plain"，行为与升级前一致；
     · 时刻不动：扫弦轨与普通轨下同一音符的发声时刻逐位相同（门控只碰音色不碰时间轴）；
     · 既有调用方不受影响：__beat 的导出面只增不减，Ear/Arrange 仍能拿到全部内置型。 */
"use strict";
const { loadApp, FakeAudioContext, pill, drive, ok, eq, near, section } = require("../lib/harness");

/* 主视图格与方向箭头（与 t47 / t62 同一定位手法）。
   v2.4.2：类名由 .cell-strum / .cell-air 统一为 .strumv（空扫是它的 .ghost 变体），
   两者合并成一个元素后**定位器也随之合并**——旧的双分支在这个版本里永远只命中一支。
   ★ v2.4.3：箭头改挂独立图层 .strums（格子的**兄弟**，不是子节点）——格子有
   overflow:hidden + 44px 高，挂进去必然裁掉尖端与低音区尾巴。定位口径随图层走。 */
function cellsOf(els, b){
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b].children.filter(el => /(^| )cell( |$)/.test(el.className));
}
const strumLayerOf = (els, b) => {
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b] ? rows[b].children.find(ch => /(^| )strums( |$)/.test(ch.className)) || null : null;
};
/* ★ 返回形状刻意保持"格数长、逐位对应格"——调用方全在按格序号取值。
   层不创建（普通轨）时用 null 填充，与旧版"格子里找不到箭头"的空位语义一致。
   ★ v2.4.3：层里的孩子是**紧凑**的（无方向的格不产生节点），故**不能**用 l.children[i]
      当"第 i 格"——只有全格都有方向时才偶然相等。一律按 data-i（生产代码写的格子下标）找，
      这才是层与格之间稳的对应关系 */
const strumsIn = (els, b) => {
  const n = cellsOf(els, b).length;
  const l = strumLayerOf(els, b);
  const out = [];
  for (let i = 0; i < n; i++){
    out.push(l ? (l.children.find(c => c.dataset && c.dataset.i === String(i)) || null) : null);
  }
  return out;
};
/* 六线底纹（v2.4.2）：只应出现在扫弦轨 */
const tabsIn = (els, b) => {
  const rows = els["viz"].children.filter(el => /(^| )bar-row( |$)/.test(el.className));
  return rows[b] ? rows[b].children.filter(ch => /(^| )tab( |$)/.test(ch.className)) : [];
};

/* 一个"纯 direction"谱（只有 dir，无 zone）：验证 hasStrum 只认 dir 也成立 */
const mkDirOnly = () => [0,1,2,3].map(() => [
  { t: 48, dir: "D" }, { t: 48, dir: "U" }, { t: 48 }, { t: 48 },
]);
/* 一个"纯 zone"谱（只有 zone，无 dir）：验证 hasStrum 只认 zone 也成立 */
const mkZoneOnly = () => [0,1,2,3].map(() => [
  { t: 48, zone: 0 }, { t: 48, zone: 2 }, { t: 48 }, { t: 48 },
]);
/* 与 mkZoneOnly 同骨架、但无 zone：作对照，验证"时刻一致" */
const mkPlain = () => [0,1,2,3].map(() => [
  { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 },
]);

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

function notEqNull(v, name){ ok(v !== null && v !== undefined, name); }

/* ================= 场景 T64a：S.track 状态与脏值回退（含零迁移） ================= */
section("T64a 双入口 · track 状态 / 脏值回退 / 由 sel 反推 / 持久化往返");
{
  /* 无种子：默认 sel = idx 0（民谣扫弦，带 dir）→ 反推 strum。
     这条与 T64e 的零迁移断言互补：这里只确认"缺键时不是硬编码常量" */
  const { beat } = loadApp();
  eq(beat.Store.S.track, "strum", "缺省由 sel 反推（默认型带扫弦 → strum）");
  ok(beat.Tracks.isStrum() === true, "isStrum() 与 track 同源");

  /* 合法值保留（显式 track 优先于反推） */
  eq(loadApp(seedState({ track: "strum" })).beat.Store.S.track, "strum", "track=strum 保留");
  eq(loadApp(seedState({ track: "plain" })).beat.Store.S.track, "plain", "track=plain 保留");
  eq(loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 0 } })).beat.Store.S.track,
     "plain", "显式 plain 压过 sel 反推");

  /* 脏值一律回退**由 sel 决定的值**（白名单纪律，不静默透传） */
  ["STRUM", "bass", "", null, 3, {}, []].forEach((dirty, i) => {
    const got = loadApp(seedState({ track: dirty, sel: { type: "builtin", idx: 0 } })).beat.Store.S.track;
    eq(got, "strum", `脏值 #${i} ${JSON.stringify(dirty)} 走反推（sel 带扫弦 → strum）`);
    const got2 = loadApp(seedState({ track: dirty, sel: { type: "builtin", idx: 1 } })).beat.Store.S.track;
    eq(got2, "plain", `脏值 #${i} 反推的另一侧（sel 无扫弦 → plain）`);
  });

  /* ★ 第三条分支：saved.sel 解析不出来（越界的废引用）→ 落到**默认轨 strum**。
     这条与 T35 的"越界 → 内置第 0 个"是同一个决定的两种观测面：
     既然最终 sel 会被改成内置第 0 个（民谣扫弦），轨就必须是 strum，
     否则加载期会立刻产出一个"普通轨 + 扫弦型"的非法组合、还要再纠正一次 */
  const badSel = loadApp(seedState({ sel: { type: "custom", idx: 9 } }));
  eq(badSel.beat.Store.S.track, "strum", "★ 废 sel（越界自定义引用）→ 落到默认轨 strum");
  eq(badSel.beat.Store.S.sel.idx, 0, "★ 且回退到内置第 0 个（与轨道一致，无需二次纠正）");
  ok(!badSel.beat.Presets.ensureValidForTrack(), "★ 加载后已是合法态：ensureValidForTrack 无事可做");

  /* 热键持久化往返：track 必须进 hotPayload，否则刷新后回到反推值 */
  const { beat: b2, storage } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  eq(b2.Store.S.track, "plain", "前提：起始为普通轨");
  b2.Tracks.set("strum");
  b2.Store.flush();                    // 热键写入是防抖的：断言落盘内容前必须先打出去（同 T13/T24 纪律）
  const written = JSON.parse(storage.get("beatsight.state"));
  eq(written.track, "strum", "切轨写入 beatsight.state.track");
  eq(b2.Store.S.track, "strum", "内存态同步更新");
  ok(b2.Tracks.set("strum") === false, "同轨重按返回 false（无操作）");
  ok(b2.Tracks.set("nope") === false, "非法轨名返回 false（不写脏值）");
}

/* ================= 场景 T64b：hasStrum 判据（dir 或 zone 任一） ================= */
section("T64b 双入口 · hasStrum 判据：dir 或 zone 任一存在即为扫弦型");
{
  const { beat } = loadApp();
  const H = beat.hasStrum;
  ok(H(mkDirOnly()[0] ? { bars: mkDirOnly() } : null) === true, "只有 dir（无 zone）→ 算扫弦");
  ok(H({ bars: mkZoneOnly() }) === true, "★ 只有 zone（无 dir）→ 也算扫弦（听感确实带扫弦）");
  ok(H({ bars: mkPlain() }) === false, "无 dir 无 zone → 普通型");
  /* dir:"" 是**存在**的空串（编辑器"不标注"档写的是 delete，不会留空串；
     但导入的脏数据可能带 dir:""）——按 !== undefined 判据它算"有 dir"。
     这里显式钉住这个边界：改判据时必须是有意识的选择，不能顺手漂移 */
  ok(H({ bars: [0,1,2,3].map(() => [{ t: 48, dir: "" }, { t: 48 }, { t: 48 }, { t: 48 }]) }) === true,
     "dir:\"\" 按「存在」判（判据是 !== undefined，与 VALID_DIR 的降级口径一致）");
  /* 防炸：坏输入不抛 */
  ok(H(null) === false && H(undefined) === false && H({}) === false
     && H({ bars: null }) === false && H({ bars: [null] }) === false
     && H({ bars: [[null]] }) === false,
     "空/坏结构一律 false（不抛——它跑在列表渲染路径上）");
  /* ★ 分界线只有一处：内置 12 个型里恰有 1 个带 dir（民谣扫弦） */
  eq(beat.BUILTINS.filter(H).length, 1, "内置型中 1 个带扫弦记谱（民谣扫弦）——分界线只此一处");
}

/* ================= 场景 T64c：切换条挂载位置与生成 ================= */
section("T64c 双入口 · 切换条挂载在预设库顶部 / pill 生成 / 高亮与 aria");
{
  /* 显式从普通轨起步，便于断言"初始高亮 = 普通轨" */
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  /* 生成：两条轨，文案与 data-track 齐备 */
  eq(els["trackRow"].children.length, 2, "切换条两条轨（普通节拍 / 带扫弦）");
  const keys = els["trackRow"].children.map(b => b.dataset.track);
  eq(keys.join(","), "plain,strum", "顺序确定：普通在前");
  eq(els["trackRow"].children[0].textContent, "普通节拍", "第一条文案");
  eq(els["trackRow"].children[1].textContent, "带扫弦", "第二条文案");
  ok(els["trackRow"].children.every(b => !!b.getAttribute("aria-label")),
     "两条轨都有 aria-label（读屏可达）");
  /* 初始高亮 = 当前轨，且 aria-pressed 与视觉同源 */
  eq(els["trackRow"].children[0].getAttribute("aria-pressed"), "true", "普通轨初始高亮");
  eq(els["trackRow"].children[1].getAttribute("aria-pressed"), "false", "扫弦轨初始不高亮");

  /* 点第二条轨 → 切换生效 + 高亮跟着走。
     ★ 切换条是**动态生成**的（buildPillRow 把 onPick 用闭包绑在按钮自身），
       与静态标记里的 sigRow/timbreRow 不同——后者靠 e.target.closest 分派，才需要 pill() 造目标。
       故这里直接 fire 在**真按钮**上（同 T13/T30 驱动 bpmPresetRow / accRow 的做法） */
  els["trackRow"].children[1].fire("click");
  eq(beat.Store.S.track, "strum", "点击「带扫弦」→ S.track 切到 strum");
  eq(els["trackRow"].children[1].getAttribute("aria-pressed"), "true", "高亮跟到扫弦轨");
  eq(els["trackRow"].children[0].getAttribute("aria-pressed"), "false", "普通轨取消高亮");
  /* 说明文字随轨变化 */
  ok(/扫弦/.test(els["trackNote"].textContent), "扫弦轨给出正向说明");
  els["trackRow"].children[0].fire("click");
  eq(beat.Store.S.track, "plain", "点回普通轨");
  ok(/隐藏/.test(els["trackNote"].textContent), "★ 普通轨提示「已隐藏 N 个扫弦节奏型」（少一项不像 bug）");
}

/* ================= 场景 T64d：预设列表过滤（内置 + 自定义） ================= */
section("T64d 双入口 · 普通轨过滤扫弦型 / 扫弦轨全列 / 索引仍指回原数组");
{
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  const names = () => els["presetList"].children
    .filter(el => /(^| )preset-item( |$)/.test(el.className))
    .map(el => el.children[0].children[0].textContent);
  const totalBuiltin = beat.BUILTINS.length;
  const FOLK = "民谣扫弦 · 下-下上-上下上";

  /* 普通轨：民谣扫弦（唯一带 dir 的内置型）不在列表里 */
  ok(names().indexOf(FOLK) < 0, "★ 普通轨列表里没有「民谣扫弦」");
  eq(names().length, totalBuiltin - 1, `普通轨列出 ${totalBuiltin - 1} 个内置型（过滤掉 1 个）`);

  /* 扫弦轨：全列 */
  beat.Tracks.set("strum");
  ok(names().indexOf(FOLK) >= 0, "★ 扫弦轨列表里有「民谣扫弦」");
  eq(names().length, totalBuiltin, `扫弦轨列出全部 ${totalBuiltin} 个内置型`);

  /* ★ 索引正确性：普通轨下点「非首项」，S.sel.idx 必须指向 BUILTINS 里的真实下标。
     （过滤后若用过滤序位当 idx，"民谣扫弦"被移除会让所有项的 idx 整体前移一位——
      这条断言就是那条偏移的防线） */
  beat.Tracks.set("plain");
  const items = els["presetList"].children.filter(el => /(^| )preset-item( |$)/.test(el.className));
  /* 普通轨第 k 项 = 内置第 k 项（被滤掉的索引是 0，故其后各项整体前移一位） */
  [1, 3, 5].forEach(k => {
    items[k].fire("click");
    eq(beat.BUILTINS[beat.Store.S.sel.idx].name, beat.curPattern().name,
      `★ 第 ${k} 项选中后 S.sel.idx 解析回被点的那一项（无整体偏移）`);
  });

  /* 自定义型：带 dir 的自定义在普通轨被滤掉、在扫弦轨出现。
     ★ 导入只落数据、不重画列表（Store 不该知道列表怎么画）——要看到新项必须刷一次，
       与 T64j 同一条纪律：列表渲染的唯一触发点是 refreshAfterPatternChange */
  beat.Tracks.set("strum");
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "自定义扫弦", meter: 4, bars: mkDirOnly() }] }));
  beat.Presets.refreshAfterPatternChange();
  const withCustom = () => els["presetList"].children
    .filter(el => /(^| )preset-item( |$)/.test(el.className))
    .map(el => el.children[0].children[0].textContent);
  ok(withCustom().indexOf("自定义扫弦") >= 0, "扫弦轨列出带 dir 的自定义型");
  beat.Tracks.set("plain");
  ok(withCustom().indexOf("自定义扫弦") < 0, "★ 普通轨过滤掉带 dir 的自定义型");
}

/* ================= 场景 T64e：零迁移（升级前后听到的一样）+ 运行期不变量 ================= */
section("T64e 双入口 · 零迁移：无 track 键时由 sel 反推轨 / 显式 track 优先");
{
  /* ★ 本组是全套最关键的零迁移断言。v2.4.0 之前应用默认开着「民谣扫弦」（idx 0，带 dir），
     所以「state 里没有 track 键 + sel 指向民谣扫弦」这条**老用户真实路径**必须落到
     扫弦轨——否则升级后用户的箭头消失、弦区音色消失，而他什么都没点 */
  const { beat } = loadApp(seedState({ sel: { type: "builtin", idx: 0 }, sig: 4 }));
  eq(beat.Store.S.track, "strum", "★ 老用户（sel=民谣扫弦，无 track 键）→ 落到扫弦轨");
  eq(beat.Store.S.sel.idx, 0, "★ 选中型一字未动（仍是他原来那个）");
  eq(beat.curPattern().name, "民谣扫弦 · 下-下上-上下上", "★ 升级前后播放的型完全相同");
  eq(beat.Presets.ensureValidForTrack(), false, "无需回退（扫弦轨下扫弦型合法）");

  /* 无种子（全新用户）沿用同一条反推：默认 sel = idx 0 = 民谣扫弦 → strum。
     这与 v2.4.0 之前的初始体验逐位一致（同样开着民谣扫弦、同样画箭头） */
  const { beat: fresh } = loadApp();
  eq(fresh.Store.S.track, "strum", "★ 全新用户初始轨与升级前体验一致（默认型带扫弦）");
  eq(fresh.curPattern().name, "民谣扫弦 · 下-下上-上下上", "初始型不变");

  /* sel 指向非扫弦型 + 无 track 键 → plain */
  const { beat: b2 } = loadApp(seedState({ sel: { type: "builtin", idx: 1 }, sig: 4 }));
  eq(b2.Store.S.track, "plain", "sel=四分基础（无扫弦）→ 落到普通轨");
  eq(b2.Store.S.sel.idx, 1, "选中型不动（无需回退）");

  /* ★ 显式 track 优先于反推：用户选过轨就尊重它。
     这是"用户意图 > 数据推断"的次序，也是为什么反推只在缺键时执行 */
  const { beat: b3 } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 0 }, sig: 4 }));
  eq(b3.Store.S.track, "plain", "显式 track=plain 优先（即使 sel 是扫弦型）");
  eq(b3.Store.S.sel.idx, 1, "★ 此时才轮到回退：普通轨容不下扫弦型，已回退到首个普通型");
  eq(b3.curPattern().name, "四分基础", "★ 回退目标是真预设「四分基础」，不是基础节奏");
  ok(b3.curPattern().name.indexOf("基础节奏") < 0, "确认不是 basicPattern 兜底（列表里有高亮）");
  /* 回退必须**可见**：该项在列表里是有高亮的（不是"选中了看不见的东西"） */
  const { beat: b3b, els: e3 } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 0 }, sig: 4 }));
  const active = e3["presetList"].children.filter(el => /(^| )preset-item active( |$)/.test(el.className));
  eq(active.length, 1, "回退后有且仅有一项高亮（用户看得见选中在哪）");
  eq(active[0].children[0].children[0].textContent, "四分基础", "高亮项 = 回退目标");
  eq(b3b.Store.S.sel.idx, 1, "与 S.sel 一致");

  /* 拍号也跟着切：回退目标拍号与当前拍号不符时同步切拍号（与 pick() 同一规则） */
  const { beat: b4 } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 0 }, sig: 3 }));
  eq(b4.Store.S.sig, 4, "★ 回退到 4/4 的型时拍号同步切到 4（否则会落进「已回退为基础节奏」）");

  /* 幂等：反复刷新不回退第二次（普通型不会被当成扫弦型） */
  const { beat: b5 } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 0 } }));
  eq(b5.Presets.ensureValidForTrack(), false, "已合规时 ensureValidForTrack 返回 false（无操作）");
  eq(b5.Store.S.sel.idx, 1, "且不改变选择");

  /* 试听中不回退（与 updateFallbackNote 同口径：试听不该被后台改掉选择） */
  const { beat: b6 } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 0 } }));
  b6.Store.S.preview = true;
  eq(b6.Presets.ensureValidForTrack(), false, "试听中不动用户的选择");
  b6.Store.S.preview = false;
}

/* ================= 场景 T64f：参数全部共享（切轨不换参数） ================= */
section("T64f 双入口 · 参数全共享：切轨不动 bpm/拍号/音量/Swing/音色");
{
  const { beat } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  beat.Store.S.bpm = 132; beat.Store.S.vol = 0.42; beat.Store.S.accentVol = 0.7;
  beat.Store.S.swing = 67; beat.Store.S.timbre = "wood";
  beat.Controls.setSig(3);
  const snap = () => JSON.stringify({ bpm: beat.Store.S.bpm, vol: beat.Store.S.vol,
    accentVol: beat.Store.S.accentVol, swing: beat.Store.S.swing, timbre: beat.Store.S.timbre,
    sig: beat.Store.S.sig });
  const before = snap();
  beat.Tracks.set("strum");
  eq(snap(), before, "★ 切到扫弦轨：bpm/vol/accentVol/swing/timbre/sig 逐位不变");
  eq(beat.Store.S.bpm, 132, "BPM 保持（切轨接着按原速度练）");
  eq(beat.Store.S.sig, 3, "拍号保持");
  beat.Tracks.set("plain");
  eq(snap(), before, "★ 切回普通轨：参数仍逐位不变");
  /* 参数单例性质：改一处两个入口同时可见（不存在副本） */
  beat.Store.S.bpm = 77;
  eq(beat.Store.S.bpm, 77, "S.bpm 仍由 Store 单独持有（两个入口共享同一份，无副本）");
  ok(beat.Tracks.isStrum() === false, "切轨后 isStrum() 跟随");
  ok(beat.curPattern() !== null, "切换后节奏型仍可解析");
}

/* ================= 场景 T64g：Audio 门控（zone 不发声）+ 时刻不动 ================= */
section("T64g 双入口 · 普通轨不传 zone（退回全局音色）/ 时刻逐位不变");
{
  /* 扫弦轨：zone 生效（三弦区频段） */
  const { beat: bs } = loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }));
  bs.Store.importPresets(JSON.stringify({ presets: [{ name: "纯zone", meter: 4, bars: mkZoneOnly() }] }));
  bs.Store.S.sel = { type: "custom", id: bs.Store.customs[bs.Store.customs.length - 1].id };
  bs.Store.S.track = "strum";
  bs.Presets.refreshAfterPatternChange();
  bs.Controls.start();
  const acs = FakeAudioContext.last;
  drive(acs, bs, 1.2);
  bs.Controls.stop();
  const bandS = acs.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass"
    && [700, 1400, 2800].includes(h.filterFreq));
  eq(bandS.length, 2, "扫弦轨：带 zone 的两颗音走弦区音色");

  /* 普通轨：同一个谱 → zone 不生效，退回全局音色（click 默认 → 振荡器）
     ★ 怎样让这条断言**真的**测到门控（而非被回退挡在前面而"恰好通过"）：
       若先 refresh 再起播，refresh 里的 ensureValidForTrack 会把这个带 zone 的型换成
       普通型，appliedPat 里根本没有 zone，门控有没有都通过——那是假绿。
       所以要造出「**已生效的 appliedPat 是带 zone 的型**」这个状态：
       ① 先在扫弦轨把它选中并 refresh（此时合法，appliedPat 落在这个带上）；
       ② 再把 track 直接改成 plain（不经 set()，故不触发 refresh/回退），
          于是 S.track=plain 而 appliedPat 仍是带 zone 的那个型——
          这正是门控要处理的现实场景（切轨瞬间 / 曲式引用 / 删除后残留）。
       ③ 起播。此时唯一能挡住 zone 的就是 scheduler 里的轨门控。 */
  const { beat: bp } = loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }));
  bp.Store.importPresets(JSON.stringify({ presets: [{ name: "纯zone", meter: 4, bars: mkZoneOnly() }] }));
  const zid = bp.Store.customs[bp.Store.customs.length - 1].id;
  bp.Store.S.sel = { type: "custom", id: zid };
  bp.Presets.refreshAfterPatternChange();
  eq(bp.curPattern().name, "纯zone", "前提①：扫弦轨下带 zone 的型已生效（appliedPat 有 zone）");
  bp.Store.S.track = "plain";                        // 直接改轨：不触发 refresh，故意绕开回退
  eq(bp.curPattern().name, "纯zone", "前提②：轨道已切 plain，但生效的型仍是带 zone 的那个");
  bp.Controls.start();
  const acp = FakeAudioContext.last;
  drive(acp, bp, 1.2);
  bp.Controls.stop();
  const bandP = acp.hits.filter(h => h.kind === "noise" && h.filterType === "bandpass"
    && [700, 1400, 2800].includes(h.filterFreq));
  eq(bandP.length, 0, "★ 普通轨：同样两颗音**不**走弦区音色（zone 被门控掉）");
  ok(acp.hits.filter(h => h.kind === "osc").length > 0, "普通轨改用全局音色（click 振荡器）");

  /* ★ 时刻逐位不变：两条轨下同一谱的发声时刻完全相同 */
  const allS = acs.hits.map(h => +h.t.toFixed(4)).sort((a, b) => a - b);
  const allP = acp.hits.map(h => +h.t.toFixed(4)).sort((a, b) => a - b);
  eq(allS.length, allP.length, "两条轨的发声**点数**相同（门控不吞音）");
  eq(allS.join(","), allP.join(","), "★ 两条轨的发声时刻逐位相同（zone 不碰时间轴）");
}

/* ================= 场景 T64h：记谱层门控（箭头 / 六线底纹不画） ================= */
section("T64h 双入口 · 普通轨不画方向箭头与六线底纹 / strums 数组仍逐位同构");
{
  const { beat, els } = loadApp(seedState({ track: "strum", sel: { type: "builtin", idx: 1 } }));
  beat.Store.importPresets(JSON.stringify({ presets: [{ name: "全标注", meter: 4,
    bars: [0,1,2,3].map(() => [
      { t: 48, dir: "D", zone: 0 }, { t: 48, dir: "U", zone: 2 }, { t: 48 }, { t: 48, rest: true, dir: "D" },
    ]) }] }));
  const cid = beat.Store.customs[beat.Store.customs.length - 1].id;

  /* 扫弦轨：3 支箭头（含 1 支空扫虚线）+ 每行一层六线底纹。
     v2.4.2 起 zone 不再单独画色带——它已成为箭头自身的跨距（.kB/.kF/.kT），
     所以"色带计数"这条断言被"箭头弦区类"取代（见 T47b 的弦区跨距用例） */
  beat.Store.S.track = "strum"; beat.Store.S.sel = { type: "custom", id: cid };
  beat.Presets.refreshAfterPatternChange();
  const s = strumsIn(els, 0);
  eq(s.filter(Boolean).length, 3, "扫弦轨：3 支方向箭头（含 1 支空扫虚线）");
  eq(tabsIn(els, 0).length, 1, "扫弦轨：本行铺了一层六线底纹");
  const zoned = (s[0] || {}).className || "";
  ok(/ kB /.test(zoned), "zone=0 的那支箭头带 .kB（弦区已内化为箭头跨距）");
  /* strums 数组与格子逐位同构（这条不变量是 fitCellAnnotations 的前提） */
  eq(s.length, cellsOf(els, 0).length, "strums 与格子数**逐位同构**（不因门控少推占位）");

  /* 普通轨：全图零箭头零底纹 */
  beat.Store.S.track = "plain";
  beat.Presets.refreshAfterPatternChange();
  const p = strumsIn(els, 0);
  eq(p.filter(Boolean).length, 0, "★ 普通轨：零方向箭头");
  eq(tabsIn(els, 0).length, 0, "★ 普通轨：零六线底纹（留一层无解释的横线是噪音）");
  eq(p.length, cellsOf(els, 0).length, "★ 普通轨下 strums 仍与格子逐位同构（推的是占位 null）");
  /* 记谱本身没被改：数据层一字不动（门控只在渲染层） */
  const pat = beat.Store.customs.find(c => c.id === cid);
  eq(pat.bars[0][0].dir, "D", "数据层 dir 仍在（门控只在渲染，不改数据）");
  eq(pat.bars[0][0].zone, 0, "数据层 zone 仍在");
}

/* ================= 场景 T64i：既有调用方不受影响 ================= */
section("T64i 双入口 · 既有调用方回归：导出面/曲式/Ear/列表项键盘");
{
  /* 用**普通轨**（T64i 想在"最能出问题的轨"上验证既有调用方） */
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  /* __beat 导出面只增不减 */
  ok(typeof beat.Tracks === "object", "__beat.Tracks 已导出");
  ok(typeof beat.hasStrum === "function", "__beat.hasStrum 已导出");
  ok(typeof beat.Presets.ensureValidForTrack === "function", "Presets.ensureValidForTrack 已导出");
  eq(beat.Store.S.track, "plain", "__beat 仍能读 S.track");
  /* 既有导出面一项不少（抽查关键几个） */
  ["Store","Modal","Viz","Audio","Trainer","Controls","Presets","Editor","Stats","Ear","Arrange","Help","KeepAlive"]
    .forEach(k => ok(!!beat[k], `模块 ${k} 仍导出`));
  /* 曲式编排不受轨过滤影响：全部内置型仍可作为块引用（含带扫弦的） */
  eq(beat.resolveRef({ type: "builtin", idx: 0 }).name, "民谣扫弦 · 下-下上-上下上",
     "★ 曲式仍能解析被普通轨隐藏的型（切轨不破坏既有曲式）");
  notEqNull(beat.arrangeProblems, "arrangeProblems 仍在（曲式检查入口）");
  /* Ear 仍能查到全部内置型（它按名字从 BUILTINS 找，不经列表） */
  ok(beat.BUILTINS.some(p => p.name === "民谣扫弦 · 下-下上-上下上"),
     "Ear 题库仍能取到被普通轨隐藏的型（BUILTINS 未被动过）");
  eq(beat.BUILTINS[0].name, "民谣扫弦 · 下-下上-上下上", "BUILTINS[0] 仍是民谣扫弦（索引未重排）");

  /* 预设项键盘可达性未破：Enter 激活仍生效 */
  const items = els["presetList"].children.filter(el => /(^| )preset-item( |$)/.test(el.className));
  items[2].fire("keydown", { key: "Enter" });
  eq(beat.Store.S.sel.type, "builtin", "键盘 Enter 仍能选中项");
  eq(beat.BUILTINS[beat.Store.S.sel.idx].name, beat.curPattern().name, "选中的型与解析一致");
}

/* ================= 场景 T64j：删除自定义型的下标安全（过滤后不许错删） ================= */
section("T64j 双入口 · 普通轨过滤下删除自定义型按对象身份定位（不按过滤序位）");
{
  const { beat, els } = loadApp(seedState({ track: "plain", sel: { type: "builtin", idx: 1 } }));
  /* 三个自定义型：第 1 个带 zone（普通轨被滤掉），后两个普通 */
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "甲-扫弦", meter: 4, bars: mkZoneOnly() },
    { name: "乙", meter: 4, bars: mkPlain() },
    { name: "丙", meter: 4, bars: mkPlain() },
  ] }));
  eq(beat.Store.customs.length, 3, "三个自定义型就位");
  /* 导入只落数据（Store 不该知道列表怎么画），要看到过滤后的列表必须走一次刷新——
     这正是"列表渲染只有一个触发点"的分工：导入/删除/切轨都经 refreshAfterPatternChange */
  beat.Presets.refreshAfterPatternChange();
  const shown = els["presetList"].children
    .filter(el => /(^| )preset-item( |$)/.test(el.className))
    .map(el => el.children[0].children[0].textContent);
  ok(shown.indexOf("甲-扫弦") < 0, "普通轨列表里没有「甲-扫弦」");
  ok(shown.indexOf("乙") >= 0 && shown.indexOf("丙") >= 0, "「乙」「丙」在列");

  /* 删「乙」：它在列表里是自定义第 1 项，但在 customs 里下标是 1。
     若按过滤序位删，会删掉 customs[0]（甲-扫弦）——这条断言就是防线。
     删除走 Modal.uiConfirm，需先确认弹窗再执行回调 */
  const target = els["presetList"].children
    .filter(el => /(^| )preset-item( |$)/.test(el.className))
    .find(el => el.children[0].children[0].textContent === "乙");
  const delBtn = target.children.find(c => /(^| )del( |$)/.test(c.className));
  ok(!!delBtn, "「乙」项有删除按钮");
  delBtn.fire("click", { stopPropagation(){} });
  /* 确认弹窗：modalOk 触发回调（Modal.uiConfirm 的确定按钮 id 是 modalOk） */
  els["modalOk"].fire("click");
  /* 核心断言：customs 里被删的是「乙」而不是「甲-扫弦」 */
  const left = beat.Store.customs.map(c => c.name);
  ok(left.indexOf("甲-扫弦") >= 0, "★ 「甲-扫弦」仍在（没有被错删）");
  ok(left.indexOf("乙") < 0, "「乙」已被删除（删的确实是点的那一项）");
  eq(left.length, 2, "恰好删掉一个");
  ok(left.indexOf("丙") >= 0, "「丙」未受影响");
}
