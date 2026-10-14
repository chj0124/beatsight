/* BeatSight 自动化测试 · 新建节奏型空态起步（节奏型页面改造）
   T255 系列。
   ---------------------------------------------------------------------------
   契约（新建节奏型页面改造实施方案 §1.2）：
     · #editBtn「新建节奏型」= 空白底稿起步：bars=[[]]（1 个空小节）、拍数取 S.sig、
       名称「我的节奏型」、模板下拉落回占位「选模板…」、dirty=false；
     · 空态三态灯：全部小节空 = 中性「还未开始」（引导问题、非校验错误）；
       保存仍禁用（allValid=false 口径不变），处理器兜底再拦一道；
     · 空态「试听」禁用（空型无声）；试听中不禁——auditionBtn 是 toggle，禁了没法停；
     · 空态红框（.guide-ring）挂两处填充入口：#edTplWrap（顶栏模板）+ #palZone（音符块库）；
     · 首个空小节 track 内动态插入 .ed-guide 引导层（两步起步文案）；
     · 「只教一次」：首次脱离空态（放块/载入模板）即永久摘除——undo/清空回到全空不复活；
       openWith 带源进入（曲式 ✎ / 预设编辑 / Editor.open()）= 非空底稿，从不引导。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const trackOf = (els, b) => els["editorBars"].children[b].children[1];
/* 缓存行有指纹复用，children 引用每次渲染后要重取（t245 同一口径） */
const hasGuide = els => trackOf(els, 0).children.some(c => /(^| )ed-guide( |$)/.test(c.className));
const ringed = els => els["edTplWrap"].classList.contains("guide-ring")
  && els["palZone"].classList.contains("guide-ring");

/* ================= 场景 T255a：空白底稿与空态口径 ================= */
section("T255a 新建节奏型 · 空白底稿 / 中性状态灯 / 试听禁用 / 红框与引导层");
{
  const { beat, els } = loadApp();
  els["editBtn"].fire("click");
  eq(JSON.stringify(beat.Editor.draft().bars), JSON.stringify([[]]), "★ bars = [[]]（1 个空小节起步）");
  eq(beat.Editor.draft().meter, beat.Store.S.sig, "★ 拍数取当前拍号 S.sig");
  eq(els["presetNameInput"].value, "我的节奏型", "★ 名称预填「我的节奏型」（无 -副本 后缀）");
  eq(els["editorTplSel"].value, "", "★ 模板下拉落占位「选模板…」（srcRef=null）");
  eq(els["editorStatus"].textContent, "还未开始", "★ 空态 = 中性「还未开始」（不是红色报错）");
  ok(!/(^| )(ok|bad)( |$)/.test(els["editorStatusWrap"].className), "状态灯无 ok/bad 档（中性）");
  eq(els["auditionBtn"].disabled, true, "★ 空型无声 → 试听禁用");
  eq(els["savePresetBtn"].disabled, true, "空稿 allValid=false → 保存禁用（口径不变）");
  ok(ringed(els), "★ 两处填充入口（模板 + 块库）都挂上 .guide-ring");
  ok(hasGuide(els), "★ 首个空小节 track 内有 .ed-guide 引导层");
  ok(String(trackOf(els, 0).children.find(c => /ed-guide/.test(c.className)).textContent).includes("音符块库"),
     "引导文案含两个入口名");
  beat.Editor.tryClose();
}

/* ================= 场景 T255b：放入首块 → 脱离空态 ================= */
section("T255b 放入首块 · 状态回落校验口径 / 试听恢复 / 红框与引导层摘除");
{
  const { beat, els } = loadApp();
  els["editBtn"].fire("click");
  els["palette"].children[3].fire("click");            // 四分音符 → 追加
  eq(beat.Editor.draft().bars[0].length, 1, "前提：块已放入");
  eq(els["editorStatus"].textContent, "存在时值不完整的小节", "★ 1 小节未满 → 回落常规校验口径");
  eq(els["auditionBtn"].disabled, false, "★ 有内容 → 试听恢复");
  ok(!ringed(els), "★ 红框两处摘除");
  ok(!hasGuide(els), "★ 引导层摘除");
  beat.Editor.tryClose();
}

/* ================= 场景 T255c：只教一次（undo 回空不复活） ================= */
section("T255c 只教一次 · undo 回到全空 → 红框与引导层不复活");
{
  const { beat, els } = loadApp();
  els["editBtn"].fire("click");
  els["palette"].children[3].fire("click");            // 放一块（edEverFilled 置位）
  beat.Editor.undo();                                  // 回到全空
  eq(JSON.stringify(beat.Editor.draft().bars), JSON.stringify([[]]), "前提：undo 后回到全空");
  eq(els["editorStatus"].textContent, "还未开始", "状态灯回中性（isEmpty 判据仍在）");
  ok(!ringed(els), "★ 红框不复活（edEverFilled 已置位，只教一次）");
  ok(!hasGuide(els), "★ 引导层不复活（|G 信号编进缓存键，不命中放块前的缓存行）");
  beat.Editor.tryClose();
}

/* ================= 场景 T255d：载入模板脱离空态（dirty=false 免确认） ================= */
section("T255d 载入模板 · 空稿免确认直接载入 / 红框摘除 / 撤销退回空稿");
{
  const { beat, els } = loadApp();
  els["editBtn"].fire("click");
  ok(ringed(els), "前提：空态红框在");
  els["editorTplSel"].value = "b0"; els["editorTplSel"].fire("change");
  eq(JSON.stringify(beat.Editor.draft().bars), JSON.stringify(beat.BUILTINS[0].bars), "★ 空稿 dirty=false → 免确认直接载入");
  ok(!ringed(els), "★ 载入即脱离空态 → 红框摘除");
  beat.Editor.undo();
  eq(JSON.stringify(beat.Editor.draft().bars), JSON.stringify([[]]), "★ 一步撤销退回空稿");
  ok(!ringed(els), "★ 撤销回空红框仍不复活（只教一次）");
  beat.Editor.tryClose();
}

/* ================= 场景 T255e：带源进入从不引导 + 重新新建重新引导 ================= */
section("T255e 带源进入 / 重新新建 · edEverFilled 口径");
{
  const { beat, els } = loadApp();
  beat.Editor.open();                                   // 带源（当前型）→ 非空底稿
  ok(!ringed(els) && !hasGuide(els), "★ Editor.open() 带源非空 → 无红框无引导层");
  beat.Editor.tryClose();
  els["editBtn"].fire("click");                         // 新建 → 空白，重新引导
  ok(ringed(els) && hasGuide(els), "★ 重新「新建节奏型」→ edEverFilled 复位，红框引导层回来");
  els["palette"].children[3].fire("click");             // 放块脱空态
  els["songNameInput"].value = "空稿保存兜底歌"; els["songNameInput"].fire("input");
  const n0 = beat.Store.customs.length;
  els["savePresetBtn"].fire("click");                   // 未满小节 → disabled 兜底拦截
  eq(beat.Store.customs.length, n0, "★ 空稿/未满稿保存被 disabled 兜底拦住（不写半截）");
  beat.Editor.tryClose();
}

/* ================= 场景 T255f：块库位置（批 2 提前）与文案 ================= */
section("T255f 块库上移 · palZone 在编辑区之前 / 卡片标题报「上方」");
{
  /* 桩的 $() 按 id 懒建、不编码父子序——位置断言走源码钉（标记里 palZone 在 editorBars 之前），
     与 t245-2 的 #edPop hidden 源码钉同一口径（桩不解析 HTML，结构契约只能钉源码） */
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  const noComment = src.replace(/<!--[\s\S]*?-->/g, "");
  const iPal = noComment.indexOf('id="palZone"');
  const iBars = noComment.indexOf('id="editorBars"');
  ok(iPal >= 0 && iBars >= 0 && iPal < iBars, "★ 标记里 #palZone（音符块库）在 #editorBars（编辑区）之前——两个填充入口集中上半屏");
  ok(noComment.indexOf('id="palZone"', iPal) === -1 || noComment.indexOf('id="palZone"') === iPal,
     "★ #palZone 恰好一处（旧位置的壳已删，不是两处同名）");
  ok(/从上方音符块库/.test(noComment) && !/从下方音符块库/.test(noComment), "★ 卡片标题与动态标题都报「上方」（静态 + editorRender 两处同改）");

  const { beat, els } = loadApp();
  els["editBtn"].fire("click");
  ok(String(els["editorCardTitle"].textContent).includes("从上方音符块库"), "★ 运行期标题同步为「上方」");
  ok(/点击追加到/.test(els["paletteTitle"].textContent), "块库标题动态文案照旧（追加/替换两态，t253 口径不破）");
  beat.Editor.tryClose();
}
