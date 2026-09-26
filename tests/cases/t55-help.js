/* BeatSight 自动化测试 · 使用方法（v2.0.1）
   T55 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   本页内容是**静态标记**（Help 不渲染文本），所以内容断言查 index.html 原文
   （harness 导出的 html）——与 T24 查标记的那一套同手法，不要改成查 stub 的 textContent
   （stub 不解析 HTML，读不到这些文字）。
   行为断言（开合 / 键盘 / inert / 展开收起）查 stub。 */
"use strict";
const { loadApp, html, ok, eq, section } = require("../lib/harness");

/* 先在**原文**上定位边界，再去掉注释——顺序搞反会出静默的大错：
   结束锚点本身就是一行 HTML 注释，先去注释的话 indexOf 返回 -1，
    slice(-1 之后) 会一路切到文件末尾，于是"含某某文字"的断言全都变成假通过。
   （实测踩过：切片长度 179225 字符 ≈ 整个文件后半段） */
const helpBlock = (() => {
  const i = html.indexOf('<div class="editor" id="helpOverlay"');
  const j = html.indexOf("<!-- ================= 应用内弹窗", i);
  const raw = i < 0 ? "" : html.slice(i, j < 0 ? undefined : j);
  return raw.replace(/<!--[\s\S]*?-->/g, "");
})();

/* ================= 场景 T55：入口、开合、键盘 ================= */
section("T55 使用方法 · 顶栏入口 / 开合 / Escape / 空格不误触");
{
  const app = loadApp();
  const { beat, els } = app;
  eq(beat.Help.isOpen(), false, "★ 加载后不自动弹窗（只在顶栏常驻，想看再看）");
  els["helpBtn"].fire("click");
  eq(beat.Help.isOpen(), true, "点顶栏「使用方法」打开");
  ok(els["helpOverlay"].classList.contains("open"), "overlay 加上 open 类");
  const mainBg = app.sandbox.document.getElementById("mainBg");
  eq(mainBg.inert, true, "★ 打开 → 背景置 inert（refreshInert 要把新 overlay 算进去）");

  /* 与曲式编排不同：帮助是**只读**的，刻意不停播——读的时候让它继续响着更有用 */
  beat.Controls.start();
  els["helpBtn"].fire("click");
  eq(beat.Store.S.playing, true, "★ 打开帮助不会打断正在进行的播放");
  app.fireWin("keydown", { code: "Space" });
  eq(beat.Store.S.playing, true, "★ 帮助打开时空格不误触停止（键盘归 overlay 管）");
  beat.Controls.stop();

  app.fireWin("keydown", { key: "Escape" });
  eq(beat.Help.isOpen(), false, "Escape 关闭");
  eq(mainBg.inert, false, "关闭后摘除 inert");
  els["helpBtn"].fire("click");
  els["helpClose"].fire("click");
  eq(beat.Help.isOpen(), false, "「返回练习」关闭");
}

/* ================= 场景 T55b：完整说明默认收起 ================= */
section("T55b 使用方法 · 完整说明默认收起 / 可展开 / 可收起");
{
  const { beat, els } = loadApp();
  beat.Help.open();
  eq(els["helpMore"].hidden, true, "★ 完整说明默认收起（先让人看到「三步上手」和「先试这几个开关」）");
  eq(els["helpMoreBtn"].textContent, "展开完整说明", "按钮文案是「展开」");
  eq(els["helpMoreBtn"].getAttribute("aria-expanded"), "false", "aria-expanded = false（读屏能读到折叠状态）");

  els["helpMoreBtn"].fire("click");
  eq(els["helpMore"].hidden, false, "点一下展开");
  eq(els["helpMoreBtn"].textContent, "收起完整说明", "★ 按钮文案跟着变成「收起」（不是一直写着「展开」）");
  eq(els["helpMoreBtn"].getAttribute("aria-expanded"), "true", "aria-expanded = true");
  eq(beat.Help.more(), true, "展开状态可被读出");

  els["helpMoreBtn"].fire("click");
  eq(els["helpMore"].hidden, true, "再点一下收起");
  eq(els["helpMoreBtn"].textContent, "展开完整说明", "文案回到「展开」");
}

/* ================= 场景 T55c：内容本身 ================= */
section("T55c 使用方法 · 内容覆盖（查标记原文）");
{
  /* 长度要有**上界**：只判 >500 的话，"切片一路切到文件末尾"这种静默错误完全过得了 */
  /* v2.37.0：图覆盖全部主要章节（3 → 7 幅），图文占比反转：图为主、文字为辅（用户反馈③）
     ★ 图改 <template> 惰性挂载——不占 smoke DOM 预算；断言按源码文本（切片含 template） */
  ok((helpBlock.match(/class="help-fig"/g) || []).length === 7,
     "★★ v2.37.0：帮助页 7 幅内联 SVG 示意图（主界面 / 训练 / 设置 / 布局 / 范围滑块 / 两循环对比 / 编辑器）");
  ok(helpBlock.includes('id="helpFigsTpl"') && helpBlock.includes('id="helpFigsMount"'),
     "★ 示意图走 <template> 惰性挂载（不占 DOM 预算，展开帮助才进 DOM）");
  ok(helpBlock.includes("「练这段」和「循环本行」差在哪"),
     "★ 「练这段 vs 循环本行」对比词条到位（用户反馈看不懂）");
  ok(helpBlock.length > 2000 && helpBlock.length < 26000,   /* v2.36.0 上限放宽：帮助页新增 3 幅内联 SVG 示意图（约 +4KB） */
     "★ 取到的确实只是帮助面板那一段（实际 " + helpBlock.length + " 字符；越界会接近整文件）");
  /* 简明版：三段都必须在，且顺序是"上手 → 看画面 → 试开关" */
  ["三步上手", "画面怎么看", "先试这几个开关"].forEach(t =>
    ok(helpBlock.includes(t), "简明版含「" + t + "」"));
  const order = ["三步上手", "画面怎么看", "先试这几个开关"].map(t => helpBlock.indexOf(t));
  ok(order[0] < order[1] && order[1] < order[2], "★ 三段顺序是 上手 → 看画面 → 试开关（不是堆在一起）");
  /* 简明版必须讲清这个应用最核心的东西：时值 = 宽度 */
  ok(helpBlock.includes("时值"), "讲到了「时值」（本应用的核心概念，不能只讲拍子）");
  ok(helpBlock.includes("弹跳球"), "讲到了弹跳球");
  /* 展开版（v2.25.2：「全部控制项」更名「主界面控制项」并收窄，新增「设置里的每一项」） */
  ["主界面控制项", "训练模式", "「设置」里的每一项", "曲式编排", "数据与隐私", "键盘"].forEach(t =>
    ok(helpBlock.includes(t), "展开版含「" + t + "」"));
  /* 隐私这句是对用户的承诺，别写含糊 */
  ok(/不上传任何服务器/.test(helpBlock), "★ 明确写了「不上传任何服务器」（不是含糊的「数据保存在本地」）");
  /* v2.0.0 刚做的曲式编排，说明里要能学到 */
  ok(helpBlock.includes("只反复练副歌"), "讲到了「只练副歌」这个用法");
  ok(helpBlock.includes("同一个拍号"), "讲到了整首同拍号这个约束");
  /* v2.25.3（用户点名）：两个编辑入口的分工 + 弦区三档释义（v2.29.0 三档化） */
  ok(helpBlock.includes("先分清两个编辑入口"), "★ 讲清「编辑节奏型」vs「编排曲式」的分工");
  ok(helpBlock.includes("零件") && helpBlock.includes("装配单"),
     "★ 一句话关系：节奏型是零件、曲式是装配单（引用不是拷贝）");
  ok(helpBlock.includes("音闷") && helpBlock.includes("音亮") && helpBlock.includes("全扫（默认）"),
     "★ 弦区三档（全扫（默认）/低/高）逐一解释（v2.29.0 三档化）");
  ok(helpBlock.includes("④⑤⑥") && helpBlock.includes("①②③") && helpBlock.includes("音色档位"),
     "★ 弦区说清了低/高各对应哪几根弦，且点明是音色档位而非逐弦开关");
  ok(helpBlock.includes("6 根弦都扫") && helpBlock.includes("互不约束"),
     "★ 全扫=6根弦（民谣扫弦常态、默认即是）+ 方向与弦区互不约束（v2.29.0 用户校准）");
  ok(helpBlock.includes("不改节奏与发声时刻"), "★ 弦区边界说清：只改音色明暗，不改节奏与时刻");

  /* v2.28.0（G1）：「整首连播」按钮已删——帮助页必须教**剩下的那个入口**（点曲式条目），
     并交代状态看读数行。旧"分组顶部那个按钮"的提法留着就是教用户找一个不存在的东西 */
  ok(helpBlock.includes("点一下那条曲式"), "★ 整首连播的入口 = 点曲式条目（按钮已删）");
  ok(helpBlock.includes("整首连播 · 播放中") && helpBlock.includes("整首连播 · 已就绪"),
    "★ 状态看读数行（播放中带前缀 / 停机显示已就绪，两态都说清）");
  ok(!helpBlock.includes("分组顶部那个按钮"), "★ 旧「按钮」提法不再出现（教一个不存在的控件比不教更糟）");
}

/* ================= 场景 T55d：与"版本真相源"那条纪律不冲突 ================= */
section("T55d 使用方法 · 正文不得写死版本号");
{
  /* P2-9：版本号唯一真相源是 VERSION 常量。正文里写"v1.9.0 新增…"这类话，
     版本一升级就成了错的——但用户其实完全不需要知道哪个版本加了什么 */
  const visible = helpBlock.replace(/<!--[\s\S]*?-->/g, "");
  eq((visible.match(/v\d+\.\d+\.\d+/g) || []).length, 0, "★ 帮助正文零硬编码版本号（会随版本漂移）");
}
