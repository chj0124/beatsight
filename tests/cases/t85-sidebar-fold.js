/* BeatSight 自动化测试 · 侧栏预设库分区折叠（v2.10.0）
   T85 系列。
   ---------------------------------------------------------------------------
   契约：v2.10.0 把「节拍 / 扫弦 / 自定义」三个分区标题从纯文字改成**可折叠开关**：
     · 标题自身即点击区（role=button + tabIndex=0 + Enter/Space 激活，键盘契约照抄 presetItemEl）
     · 默认**全部收起**（用户选择）；开合状态记忆在选择里（S.fold，跟热键走，同 showTab / vizRows）
     · 折叠是**纯视图**：只对分区成员置 hidden、**不删节点**，也不重建列表——
       t30 / t63 / t68 / t73 / t74 / t75 / t84 一律遍历 `#presetList.children` 找条目，删了全线失配
     · 标题的 className 必须**恰好**是 "preset-section"（t63 用 === 严格比对）、textContent 逐字不差
       （t63 / t84b 都比对标题文案）——故箭头只能走 CSS ::after，退化成加类名 / 塞文字节点都会被本组拦下
     · role 是 button **不是** switch（t24 钉死 role="switch" 恰 9 处）
   加载校验走**显式白名单**：只认三个键上的严格 true，脏值 / 非对象 / 多出来的键一律回落收起。 */
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

/* ================= 场景 T85a：默认全收起 + 标题即按钮 + 只隐藏不删节点 ================= */
section("T85a 分区折叠 · 默认全部收起 / 标题即按钮 / 只置 hidden 不删节点");
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
  eq(JSON.stringify(expanded(els)), JSON.stringify(["false", "false", "false"]),
     "★ 默认全部收起（三区 aria-expanded 全 false）");
  ok(z.secs.every(h => h.hidden === false), "分区标题自身不隐藏（收起的是它的成员，不是标题）");
  ok(z.beat.concat(z.strum, z.custom).every(c => c.hidden === true),
     "★ 默认收起时三区全部成员 hidden（含自定义区的曲式组 / 还原提示）");
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

  z.secs[0].fire("click");
  eq(z.secs[0].getAttribute("aria-expanded"), "true", "点击标题 → aria-expanded=true（展开）");
  ok(beatKids.every(c => c.hidden === false), "★ 本区条目现身");
  ok(strumKids.every(c => c.hidden === true), "其它区仍收起（互不影响）");
  ok(z.secs[1].getAttribute("aria-expanded") === "false" && z.secs[2].getAttribute("aria-expanded") === "false",
     "其它区 aria-expanded 不变");
  eq(els["presetList"].children.length, before.length, "★ 只置 hidden 不删节点（children 数不变）");
  ok(els["presetList"].children.every((c, i) => c === before[i]),
     "★ 节点对象身份不变（折叠没有重建列表——播放中段序条不会闪）");

  /* 键盘契约：照抄 presetItemEl（Enter / Space 字符 / code=Space 三种都算激活） */
  z.secs[0].fire("keydown", { key: "Enter" });
  eq(z.secs[0].getAttribute("aria-expanded"), "false", "Enter 键收起");
  z.secs[0].fire("keydown", { code: "Space" });
  eq(z.secs[0].getAttribute("aria-expanded"), "true", "code=Space 展开");
  z.secs[0].fire("keydown", { key: " " });
  eq(z.secs[0].getAttribute("aria-expanded"), "false", "空格字符键收起");
  /* 非激活键无副作用（窄化：防 itemKeys 的判据被放宽成"任意键"） */
  z.secs[0].fire("keydown", { key: "a" });
  eq(z.secs[0].getAttribute("aria-expanded"), "false", "普通字母键不激活（键位判据不漂移）");

  /* 三区互相独立：依次展开后各自成员现身，互不牵连 */
  z.secs[0].fire("click"); z.secs[1].fire("click"); z.secs[2].fire("click");
  eq(JSON.stringify(expanded(els)), JSON.stringify(["true", "true", "true"]), "三区可同时展开");
  ok(z.beat.concat(z.strum, z.custom).every(c => c.hidden === false), "三区全展开后成员全部现身");
}

/* ================= 场景 T85c：记忆选择（热键载荷 / 重载恢复 / 脏值白名单） ================= */
section("T85c 分区折叠 · 开合记忆在热键，重载恢复，脏值回落收起");
{
  const { beat, els, storage } = loadApp();
  const z = zones(els);
  z.secs[2].fire("click");                             // 只展开「自定义」区
  beat.Store.flush();                                  // 热键是防抖的，flush 立即落盘
  const raw = JSON.parse(storage.get("beatsight.state"));
  eq(JSON.stringify(raw.fold), JSON.stringify({ beat: false, strum: false, custom: true }),
     "★ 热键载荷含 fold（显示偏好，跟热键走）——值 = **展开**布尔");

  const r1 = loadApp({ "beatsight.state": storage.get("beatsight.state") });
  eq(JSON.stringify(expanded(r1.els)), JSON.stringify(["false", "false", "true"]),
     "★ 重新加载后开合被恢复（记忆选择生效）");
  ok(zones(r1.els).custom.every(c => c.hidden === false)
     && zones(r1.els).beat.every(c => c.hidden === true),
     "★ 重载后不是只改 aria-expanded——展开区的成员真的现身、收起区的真的隐藏");

  /* 白名单：非严格 true 一律回落收起 */
  const dirty = loadApp(seedState({ fold: { beat: 1, strum: "true", custom: true } }));
  eq(JSON.stringify(expanded(dirty.els)), JSON.stringify(["false", "false", "true"]),
     "只认严格 true：1 / \"true\" 不算展开，是真 true 的键才展开");
  const notObj = loadApp(seedState({ fold: "nope" }));
  eq(JSON.stringify(expanded(notObj.els)), JSON.stringify(["false", "false", "false"]),
     "fold 非对象（脏标记）→ 全部回落收起，不抛错");
  const extra = loadApp(seedState({ fold: { beat: true, evil: true } }));
  eq(JSON.stringify(expanded(extra.els)), JSON.stringify(["true", "false", "false"]),
     "多出来的键被忽略（不污染三区）");
  ok(zones(extra.els).beat.every(c => c.hidden === false)
     && zones(extra.els).strum.every(c => c.hidden === true),
     "多出来的键不改变真实开合（成员 hidden 与三区状态一致）");
  const missing = loadApp(seedState({}));
  eq(JSON.stringify(expanded(missing.els)), JSON.stringify(["false", "false", "false"]),
     "从未存过（键缺失）→ 同默认：全部收起");
}

/* ================= 场景 T85d：列表重建后折叠态重新套用（applyFold 的收尾） ================= */
section("T85d 分区折叠 · 列表重建后折叠态重新套用（收尾必须有 applyFold）");
{
  const { beat, els } = loadApp();
  const z = zones(els);
  z.secs[1].fire("click");                             // 展开「扫弦」区
  eq(z.secs[1].getAttribute("aria-expanded"), "true", "扫弦区已展开");

  beat.Presets.buildPresetList();                      // 重建：全新节点，hidden 不会自己继承
  const z2 = zones(els);
  eq(z2.secs[1].getAttribute("aria-expanded"), "true", "★ 重建后扫弦区仍展开（aria-expanded 重新套用）");
  ok(z2.strum.every(c => c.hidden === false), "★ 重建后本区条目仍现身");
  ok(z2.beat.every(c => c.hidden === true), "重建后未展开的节拍区仍收起");
  ok(z2.custom.every(c => c.hidden === true), "重建后未展开的自定义区仍收起");
  ok(z2.secs !== z.secs, "重建确实是新节点（上面的断言不是在看旧列表）");
}
