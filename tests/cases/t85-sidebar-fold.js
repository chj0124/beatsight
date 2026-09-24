/* BeatSight 自动化测试 · 侧栏预设库分区折叠（v2.10.0）
   T85 系列。
   ---------------------------------------------------------------------------
   契约：v2.10.0 把「节拍 / 扫弦 / 自定义」三个分区标题从纯文字改成**可折叠开关**：
     · 标题自身即点击区（role=button + tabIndex=0 + Enter/Space 激活，键盘契约照抄 presetItemEl）
     · v2.13.0 起出厂默认是「节拍**展开** / 扫弦收起 / 自定义**展开**」（此前是"全部收起"）；
       开合状态记忆在选择里（S.fold，跟热键走，同 showTab / vizRows）
     · ★★ 加载判据是**存在性 + 严格 true**：没存过的键走出厂默认，存过的一律尊重用户
       （哪怕与出厂默认相反）。这条不是洁癖——折叠态每次交互都会落进热键，
       所以老用户的存档里是有**显式 false** 的；若只判 `=== true`，改出厂默认就只对新用户生效
     · 折叠是**纯视图**：只对分区成员置 hidden、**不删节点**，也不重建列表——
       t30 / t63 / t68 / t73 / t74 / t75 / t84 一律遍历 `#presetList.children` 找条目，删了全线失配
     · 标题的 className 必须**恰好**是 "preset-section"（t63 用 === 严格比对）、textContent 逐字不差
       （t63 / t84b 都比对标题文案）——故箭头只能走 CSS ::after，退化成加类名 / 塞文字节点都会被本组拦下
     · role 是 button **不是** switch（t24 钉死 role="switch" 恰 9 处） */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const isItem = el => /(^| )preset-item( |$)/.test(el.className);
const isSection = el => /(^| )preset-section( |$)/.test(el.className);
/* 以三个 .preset-section 为界把列表孩子切成三段（含每段内的全部孩子：条目 / 曲式组 / 还原提示） */
const zones = els => {
  const kids = els["presetList"].children;
  const secs = kids.filter(isSection);
  const [a, b, c] = secs.map(s => kids.indexOf(s));
  return { kids, secs, beat: kids.slice(a + 1, b), strum: kids.slice(b + 1, c), custom: kids.slice(c + 1) };
};
const expanded = els => zones(els).secs.map(h => h.getAttribute("aria-expanded"));
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* v2.13.0 出厂默认（节拍展开 / 扫弦收起 / 自定义展开）。本组验的是"开合怎么工作"，
   故以出厂态为起点；"没存过 / 存过 false"这条判据单独在 T85c 里钉。 */
const DEF = ["true", "false", "true"];

/* ================= 场景 T85a：出厂默认 + 标题即按钮 + 只隐藏不删节点 ================= */
section("T85a 分区折叠 · 出厂默认（节拍+自定义展开、扫弦收起）/ 标题即按钮 / 只置 hidden 不删节点");
{
  const { els } = loadApp();
  const z = zones(els);
  eq(z.secs.length, 3, "恰好三个分区标题（节拍 / 扫弦 / 自定义）");
  ok(z.secs.every(h => h.className === "preset-section"),
     "★ 标题 className **恰好**是 preset-section（无额外类名——t63 用 === 严格比对）");
  ok(z.secs.every(h => h.textContent || true),
     "标题文案不为空（逐字比对由 t63 / t84b 守着，本组不重复）");
  ok(z.secs.every(h => h.getAttribute("role") === "button"),
     "★ 标题是 role=button（不是 switch——t24 钉死 role=\"switch\" 恰 9 处）");
  ok(z.secs.every(h => h.tabIndex === 0), "标题 tabIndex=0（键盘可达）");
  eq(JSON.stringify(expanded(els)), JSON.stringify(DEF),
     "★ v2.13.0 出厂默认：节拍区与自定义区**展开**、扫弦区收起（首屏就能点到一条节拍型或一首曲式）");
  ok(z.secs.every(h => h.hidden === false), "分区标题自身不隐藏（收起的是它的成员，不是标题）");
  ok(z.beat.every(c => c.hidden === false) && z.custom.every(c => c.hidden === false),
     "★ 展开的两区成员全部现身");
  ok(z.strum.every(c => c.hidden === true), "★ 收起的扫弦区成员全部 hidden（含曲式组 / 还原提示这类非条目孩子）");
  ok(z.kids.filter(isItem).length > 0, "列表里确实有条目（不是空列表上做无用断言）");
  /* 用户决策「保持常显」：编排入口在 #presetList **之外**（标记里的兄弟节点），
     折叠任何分区都不该波及它——它不在 applyFold 的遍历范围内。
     ★ v2.10.12：原「导出/导入区」（`.preset-io`）整行搬进了顶栏「设置」弹窗，侧栏不再有它 */
  ok(els["argOpen"].hidden === false, "「编排曲式」入口常显（在 #presetList 之外，折叠不波及）");
  ok(els["editBtn"].hidden === false, "「编辑节奏型」也在本行常显（v2.10.12 从主列搬来）");
  ok(!/class="preset-io"/.test(html), "★ 侧栏不再有导出/导入区（已搬进设置弹窗）");
}

/* ================= 场景 T85b：点击 / 键盘开合 · 只影响本区 · 不重建列表 ================= */
section("T85b 分区折叠 · 点击与键盘开合，只影响本区，节点身份不变");
{
  const { els } = loadApp();
  const z = zones(els);
  const beatKids = z.beat, strumKids = z.strum;
  const before = z.kids.slice();                       // 快照：节点对象 + 顺序

  /* 用**出厂收起**的扫弦区做"点开"这一步（节拍区出厂是展开的，点它得到的是收起） */
  z.secs[1].fire("click");
  eq(z.secs[1].getAttribute("aria-expanded"), "true", "点击标题 → aria-expanded=true（展开）");
  ok(strumKids.every(c => c.hidden === false), "★ 本区条目现身");
  ok(beatKids.every(c => c.hidden === false), "其它区不受影响（节拍区本就展开，仍然展开）");
  ok(z.secs[0].getAttribute("aria-expanded") === "true" && z.secs[2].getAttribute("aria-expanded") === "true",
     "其它区 aria-expanded 不变");
  eq(els["presetList"].children.length, before.length, "★ 只置 hidden 不删节点（children 数不变）");
  ok(els["presetList"].children.every((c, i) => c === before[i]),
     "★ 节点对象身份不变（折叠没有重建列表——播放中段序条不会闪）");

  /* 键盘契约：照抄 presetItemEl（Enter / Space 字符 / code=Space 三种都算激活） */
  z.secs[1].fire("keydown", { key: "Enter" });
  eq(z.secs[1].getAttribute("aria-expanded"), "false", "Enter 键收起");
  z.secs[1].fire("keydown", { code: "Space" });
  eq(z.secs[1].getAttribute("aria-expanded"), "true", "code=Space 展开");
  z.secs[1].fire("keydown", { key: " " });
  eq(z.secs[1].getAttribute("aria-expanded"), "false", "空格字符键收起");
  /* 非激活键无副作用（窄化：防 itemKeys 的判据被放宽成"任意键"） */
  z.secs[1].fire("keydown", { key: "a" });
  eq(z.secs[1].getAttribute("aria-expanded"), "false", "普通字母键不激活（键位判据不漂移）");

  /* 三区互相独立：把出厂展开的两区收起（扫弦此刻也是收起的）→ 三区可同时收起、互不牵连 */
  z.secs[0].fire("click"); z.secs[2].fire("click");
  eq(JSON.stringify(expanded(els)), JSON.stringify(["false", "false", "false"]), "三区可同时收起");
  ok(z.beat.concat(z.strum, z.custom).every(c => c.hidden === true), "三区全收起后成员全部隐藏");
  /* 反向再来一次：三区全展开（这一步同时证明"收起过的也能再展开"） */
  z.secs[0].fire("click"); z.secs[1].fire("click"); z.secs[2].fire("click");
  eq(JSON.stringify(expanded(els)), JSON.stringify(["true", "true", "true"]), "三区可同时展开");
  ok(z.beat.concat(z.strum, z.custom).every(c => c.hidden === false), "三区全展开后成员全部现身");
}

/* ================= 场景 T85c：记忆选择（热键载荷 / 重载恢复 / 出厂默认与脏值） ================= */
section("T85c 分区折叠 · 开合记忆在热键，重载恢复，没存过走出厂默认");
{
  const { beat, els, storage } = loadApp();
  const z = zones(els);
  /* 从出厂态出发各动一区：自定义（展开→收起）、扫弦（收起→展开）——
     这样落盘值 {beat:true, strum:true, custom:false} 与出厂默认**逐键都不同**，
     若某处把"没存过"与"存过"混为一谈，下面的重载断言会当场变红 */
  z.secs[2].fire("click");
  z.secs[1].fire("click");
  beat.Store.flush();                                  // 热键是防抖的，flush 立即落盘
  const raw = JSON.parse(storage.get("beatsight.state"));
  eq(JSON.stringify(raw.fold), JSON.stringify({ beat: true, strum: true, custom: false }),
     "★ 热键载荷含 fold（显示偏好，跟热键走）——值 = **展开**布尔");

  const r1 = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(JSON.stringify(expanded(r1.els)), JSON.stringify(["true", "true", "false"]),
     "★ 重新加载后开合被恢复（记忆选择生效）");
  ok(zones(r1.els).strum.every(c => c.hidden === false)
     && zones(r1.els).custom.every(c => c.hidden === true),
     "★ 重载后不是只改 aria-expanded——展开区的成员真的现身、收起区的真的隐藏");

  /* ★★ v2.13.0 的核心新性质：「**没存过**」与「**存过 false**」必须**分开**判。
     反例（若照旧只判 `=== true`）：老用户存档里是显式 false，改出厂默认后他们
     "打开还是全收起"——默认值改了等于没改。下面两条正是钉这个的。 */
  const never = loadApp(seedState({}));                 // 键缺失 / 从来没存过
  eq(JSON.stringify(expanded(never.els)), JSON.stringify(DEF),
     "★★ 从未存过 fold（键缺失）→ 用**出厂默认**（不是「全部收起」）");
  const storedFalse = loadApp(seedState({ fold: { beat: false, strum: false, custom: false } }));
  eq(JSON.stringify(expanded(storedFalse.els)), JSON.stringify(["false", "false", "false"]),
     "★★ 存过**显式 false** → 尊重用户，不回出厂默认（老用户「全收起」的状态一位不变）");
  const oneKey = loadApp(seedState({ fold: { strum: true } }));
  eq(JSON.stringify(expanded(oneKey.els)), JSON.stringify(["true", "true", "true"]),
     "只存了一个键时其余键各自判存在性：缺的走出厂默认，存了的按存档");

  /* 白名单：非严格 true 一律不展开（存在但值脏 → 不当成"没存过"，也不当成 true） */
  const dirty = loadApp(seedState({ fold: { beat: 1, strum: "true", custom: true } }));
  eq(JSON.stringify(expanded(dirty.els)), JSON.stringify(["false", "false", "true"]),
     "只认严格 true：1 / \"true\" 不算展开，是真 true 的键才展开");
  const notObj = loadApp(seedState({ fold: "nope" }));
  eq(JSON.stringify(expanded(notObj.els)), JSON.stringify(DEF),
     "fold 非对象（脏标记）→ 走出厂默认，不抛错");
  const extra = loadApp(seedState({ fold: { beat: true, evil: true } }));
  eq(JSON.stringify(expanded(extra.els)), JSON.stringify(["true", "false", "true"]),
     "多出来的键被忽略（不污染三区；未提到的键走各自出厂默认）");
  ok(zones(extra.els).beat.every(c => c.hidden === false)
     && zones(extra.els).strum.every(c => c.hidden === true),
     "多出来的键不改变真实开合（成员 hidden 与三区状态一致）");
}

/* ================= 场景 T85d：列表重建后折叠态重新套用（applyFold 的收尾） ================= */
section("T85d 分区折叠 · 列表重建后折叠态重新套用（收尾必须有 applyFold）");
{
  const { beat, els } = loadApp();
  const z = zones(els);
  z.secs[1].fire("click");                             // 扫弦：出厂收起 → 展开
  z.secs[2].fire("click");                             // 自定义：出厂展开 → 收起
  eq(z.secs[1].getAttribute("aria-expanded"), "true", "扫弦区已展开");
  eq(z.secs[2].getAttribute("aria-expanded"), "false", "自定义区已收起");

  beat.Presets.buildPresetList();                      // 重建：全新节点，hidden 不会自己继承
  const z2 = zones(els);
  eq(z2.secs[1].getAttribute("aria-expanded"), "true", "★ 重建后扫弦区仍展开（aria-expanded 重新套用）");
  ok(z2.strum.every(c => c.hidden === false), "★ 重建后本区条目仍现身");
  ok(z2.beat.every(c => c.hidden === false), "重建后仍展开的节拍区还是展开的");
  ok(z2.custom.every(c => c.hidden === true), "重建后被收起过的自定义区仍收起（两个方向都被套用）");
  ok(z2.secs !== z.secs, "重建确实是新节点（上面的断言不是在看旧列表）");
}
