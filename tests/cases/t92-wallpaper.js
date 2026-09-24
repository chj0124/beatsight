/* BeatSight 自动化测试 · 背景壁纸（v2.12.0）
   T92 系列。
   ---------------------------------------------------------------------------
   这一组要钉住的不是"看起来好看不好看"，而是四条**会静默伤到用户**的性质：

     ① **格式只认三种位图，且按魔数（文件头）判，不按扩展名判**
        ——扩展名可以随便改，文件头改不了。SVG 被排除在外（它是 XML，能内嵌脚本与外部引用）。
     ② **进 CSS 的值必须是"干净的" base64**
        ——img 要被拼进 `url("…")`，只要允许出现一个双引号，localStorage 里的一个字符串
          就能逃逸出 url() 去改别的样式。所以校验用**正则白名单**而不是"看着像图片"。
     ③ **有体积上限**，且存不下时**必须给用户明确提示**（不能"点了没反应"）
        ——localStorage 约 5 MB，与预设共用；实测超限时抛 QuotaExceededError。
     ④ **遮罩深浅与图片同键同写**：分两个键就会出现"换了图、遮罩还是上一个值"的错位。

   降采样（canvas）在桩里拿不到 2d 上下文，整条链设计成"拿不到就直接用原图"——
   于是这里能把**校验与落盘**完整跑完，真正的绘制交给浏览器冒烟。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* ---- 构造几张"图"：真实文件头的 base64（前几个字节）+ 一段填充 ---- */
const B64 = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";   // "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
/* JPEG：FF D8 FF E0 … ；PNG：89 50 4E 47 0D 0A 1A 0A ；WebP：RIFF….WEBP ；SVG：文本 */
const HEADS = {
  jpeg: "/9j/4AAQSkZJRgABAQ",                 // FF D8 FF E0 00 10 4A 46 49 46 00 01
  png:  "iVBORw0KGgoAAAANSUh",                // 89 50 4E 47 0D 0A 1A 0A …
  webp: "UklGRiAAAABXRUJQV",                  // "RIFF" + 4 字节长度 + "WEBP"
  svg:  "PHN2ZyB4bWxucz0i",                   // "<svg xmlns=\""
  gif:  "R0lGODlhAQABAIAA",                   // "GIF89a"（应当被拒）
};
const mk = (kind, pad) => "data:image/" + kind + ";base64," + (HEADS[kind] || "") + (pad || B64);

/* ================= 场景 T92：格式白名单（按魔数，不按扩展名） ================= */
section("T92 壁纸 · 只认 JPG / PNG / WebP（★ 按文件头判，扩展名不算数）");
{
  const { beat } = loadApp();
  eq(beat.wallCheck(mk("jpeg")).ok, true, "JPEG 通过");
  eq(beat.wallCheck(mk("png")).ok, true, "PNG 通过");
  eq(beat.wallCheck(mk("webp")).ok, true, "WebP 通过（RIFF 头 + 第 8 字节起的 WEBP 都对上）");

  /* ★ 扩展名写着 png，实际是 JPEG 的头 → 照样放行（以内容为准，这是刻意的选择：
     用户把 .jpg 改名成 .png 这种事很常见，按扩展名拒了才是为难人） */
  eq(beat.wallCheck("data:image/png;base64," + HEADS.jpeg + B64).ok, true,
    "扩展名与内容不符时**以内容为准**（改名过的图不该被拒）");

  const g = beat.wallCheck(mk("gif"));
  eq(g.ok, false, "★ GIF 被拒（不在三种格式内）");
  ok(/三[三种]?格式|JPG \/ PNG \/ WebP/.test(g.why) || /对不上/.test(g.why), "拒绝理由说得清：" + g.why);

  const s = beat.wallCheck(mk("svg"));
  eq(s.ok, false, "★★ SVG 被拒（它是 XML：能内嵌脚本与外部引用，不该开这条口子）");

  /* 两道关的分工，这里要说清楚（否则日后有人"顺手"把魔数那道删掉）：
       · MIME 白名单（正则）挡的是**非图片**与 SVG —— 便宜、挡住绝大多数；
       · 魔数挡的是**拿图片 MIME 伪装的非图片**：下面这条 MIME 写着 png、
         内容其实是一段文本（"<svg xmlns=\""），只有文件头能认出来。
     ★ 反过来「MIME 写着 jpeg、内容是 PNG」是**放行**的：那仍是一张真图，只是标错了名，
       按扩展名/声明拒掉才是为难用户（改名过的图很常见）。 */
  const spoof = beat.wallCheck("data:image/png;base64," + HEADS.svg + B64);
  eq(spoof.ok, false, "★★ MIME 写着 png、内容却是文本 → 拒（只改声明骗不过魔数这一关）");
  const relabel = beat.wallCheck("data:image/jpeg;base64," + HEADS.png + B64);
  eq(relabel.ok, true, "MIME 写着 jpeg、内容真是 PNG → 放行（以内容为准，不为难改过名的图）");

  eq(beat.wallCheck("").ok, false, "空串被拒");
  eq(beat.wallCheck(null).ok, false, "null 被拒");
  eq(beat.wallCheck(42).ok, false, "非字符串被拒");
  eq(beat.wallCheck("/9j/4AAQ").ok, false, "不是 data: URL 被拒（裸 base64 不行）");
}

/* ================= 场景 T92b：拼进 CSS 的值必须是干净的 base64 ================= */
section("T92b 壁纸 · 进 CSS 前的值不含引号（防 url() 逃逸）");
{
  const { beat } = loadApp();
  /* 反向验证锚点：若把正则放宽成 `/^data:image\/(jpeg|png|webp);base64,/`，
     下面这条就会放行，而 `")` 会提前闭合 url( ) 让后面的样式生效 —— 一条 CSS 注入 */
  const evil = 'data:image/png;base64,") ; background:red ; url("';
  eq(beat.wallCheck(evil).ok, false, "★ 含双引号的值被拒（否则能逃逸出 url() 改别的样式）");
  const evil2 = "data:image/png;base64," + B64 + "\nbody{display:none}";
  eq(beat.wallCheck(evil2).ok, false, "★ 含换行的值被拒（同理）");
  /* ★★ 这条才真正钉住正则那一层：**文件头是真的 PNG 头**，魔数关会放行，
     只有"base64 部分必须只含 base64 字符集"这条正则能挡住后面的 `")` 逃逸。
     反向验证锚点：把正则放宽成 `/^data:image\/(jpeg|png|webp);base64,/`（去掉尾部 `$`
     与字符集收紧），下面这一条立刻变红。 */
  const evil3 = "data:image/png;base64," + HEADS.png + B64 + '") ; background:red ; url("';
  eq(beat.wallCheck(evil3).ok, false,
    "★★ 真 PNG 头 + 引号负载 → 拒（只有正则这一层挡得住，魔数关会放行）");

  /* ★ atob 的坑：非法 base64 **长度**也抛（atob(\"A\") 就抛），而长度是正则管不了的。
     wallCheck 在**加载期**被 wallRead 调用，一抛就是整页白屏 —— 这里钉住它不抛。 */
  let threw = false, r2 = null;
  try{ r2 = beat.wallCheck("data:image/jpeg;base64,A"); }catch(e){ threw = true; }
  eq(threw, false, "★★ 长度非法的 base64（\"A\"）→ wallCheck 不抛（否则加载期白屏）");
  eq(r2 && r2.ok, false, "  且仍判为不合法");
  const wp = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img: "data:image/jpeg;base64,A", dim: 20 }) });
  ok(wp.beat.wallState() && wp.beat.wallState().img === wp.beat.WALL_DEFAULT,
    "★★ 存档里藏着这种值 → 回**出厂默认图**（v2.13.0：读不懂的偏好落回出厂态），且整页照常加载");
  ok(!!wp.beat.Store && !!wp.beat.Controls, "  后续模块全部装配成功（没有白屏）");
  /* 非 data: 的其它协议一律不认 */
  eq(beat.wallCheck("javascript:alert(1)").ok, false, "javascript: 协议被拒");
  eq(beat.wallCheck('data:text/html;base64,' + B64).ok, false, "data:text/html 被拒");
}

/* ================= 场景 T92c：体积上限 ================= */
section("T92c 壁纸 · 超出落盘上限要被拒，且理由里带数字");
{
  const { beat } = loadApp();
  const big = "data:image/jpeg;base64," + HEADS.jpeg + "A".repeat(beat.WALL_MAX_BYTES + 100);
  const r = beat.wallCheck(big);
  eq(r.ok, false, "★ 超过 WALL_MAX_BYTES → 拒");
  ok(/KB/.test(r.why), "理由里带具体体积（用户才知道该缩多少）：" + r.why);
  const fit = "data:image/jpeg;base64," + HEADS.jpeg + "A".repeat(1024);
  eq(beat.wallCheck(fit).ok, true, "上限之内 → 放行");
}

/* ================= 场景 T92d：读档的三态（v2.13.0）/ 脏值不惊动用户 ================= */
section("T92d 壁纸 · 读档三态：键缺失=默认图、default 记号=默认图+自定义遮罩、null=真没有");
{
  const seed = s => ({ "beatsight.wallpaper": s });
  eq(beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: 30 }))).wallState().dim, 30,
    "正常存档：图与遮罩都读回");

  /* ★★ 三态是这一节的主角：三种"空"看着像，语义完全不同。
     取态一律走 `|| {}` 兜底：**变异测试要求"逻辑坏了"表现为具名断言失败，而不是整组崩掉**
     （若直接写 `noKey.wallState().dim`，一个"键不存在就返回 null"的模型改动会让那一行
     抛 TypeError 中断整个套件——崩溃不是证据）。 */
  const nk = beatOf({});
  const nkState = nk.wallState() || {};
  ok(nkState.img === nk.WALL_DEFAULT, "★ 键**不存在** → 出厂默认图（用户从没做过选择）");
  eq(nkState.dim, nk.WALL_DIM_DEF, "  遮罩用默认 " + nk.WALL_DIM_DEF);
  const tk = beatOf(seed(JSON.stringify({ v:1, img: "default", dim: 72 })));
  const tkState = tk.wallState() || {};
  ok(tkState.img === tk.WALL_DEFAULT, "★★ img:\"default\" 记号 → 默认图（存档里是记号，不是那张图的副本）");
  eq(tkState.dim, 72, "  且遮罩读回用户自己调的那一档");
  const removed = beatOf(seed(JSON.stringify({ v:1, img: null, dim: 60 })));
  eq(removed.wallState(), null,
    "★★ img:null → 真正「没有壁纸」（这是「移除」的存档形态：默认图**不复活**）");
  /* ★ 顺序敏感的反向验证锚点：若在 wallRead 里先跑 wallCheck/正则再判 null，
     上面那条就会走进"格式不对"一路 → 回落默认图 → 用户的「移除」刷新即失效。
     v:2 那份（带 byLyric 等额外字段的包）也该照常读——多的字段不影响这三态 */
  const v2pack = beatOf(seed(JSON.stringify({ v:2, img: "default", dim: 10, byLyric: true, 未来字段: 1 })));
  ok(v2pack.wallState() && v2pack.wallState().dim === 10, "带多余字段/更高 v 的包照常读（不因多字段判脏）");

  /* 脏值：一律回**出厂默认图**（不是"什么都没有"——那只有用户点过移除才该有） */
  const junk = [
    ["非 JSON", "not json"],
    ["是 JSON 但不是对象", "42"],
    ["img 不是字符串", JSON.stringify({ v:1, img: 123, dim: 20 })],
    ["img 是 SVG", JSON.stringify({ v:1, img: mk("svg"), dim: 20 })],
    ["img 带引号", JSON.stringify({ v:1, img: 'data:image/png;base64,"', dim: 20 })],
    ["整个包是 null", "null"],
  ];
  junk.forEach(([why, raw]) => {
    const b = beatOf(seed(raw));
    const w = b.wallState();
    ok(w && w.img === b.WALL_DEFAULT, "★ " + why + " → 回出厂默认图（丢弃脏值）");
    eq(b.diag.winErr, 0, "  且不产生脚本错误（脏数据不该把页面带崩）");
  });

  /* 遮罩值越界：钳到 [0, WALL_DIM_MAX]，不是丢弃整份 */
  const hi = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: 9999 })));
  eq(hi.wallState().dim, hi.WALL_DIM_MAX, "遮罩 9999 → 钳到上限 " + hi.WALL_DIM_MAX);
  const lo = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: -50 })));
  eq(lo.wallState().dim, 0, "遮罩 -50 → 钳到 0");
  const nan = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: "x" })));
  eq(nan.wallState().dim, nan.WALL_DIM_DEF, "遮罩非数字 → 回默认 " + nan.WALL_DIM_DEF);
  /* 遮罩坏了不该连图一起丢——图是用户挑了半天的 */
  eq(nan.wallState().img, mk("png"), "★ 只有遮罩脏时，图片仍然保留");
  /* 默认图那一路同理：记号配脏遮罩 → 仍是默认图 + 默认遮罩 */
  const tokBad = beatOf(seed(JSON.stringify({ v:1, img: "default", dim: null })));
  ok(tokBad.wallState() && tokBad.wallState().img === tokBad.WALL_DEFAULT
    && tokBad.wallState().dim === tokBad.WALL_DIM_DEF,
    "★ 记号 + 脏遮罩 → 默认图配默认遮罩（不整份丢弃、也不把 null 当成 0）");
  /* ★★ 遮罩只认**数值类型**：null / "" / "70" 都不是我们写出去的形态，
     而 Number(null) 与 Number("") 都是 0 —— 照单全收就会把壁纸读成"完全不压暗"（刺眼）。
     反向验证锚点：把判据退回 `isFinite(Number(o.dim))`，下面三条立刻变红 */
  [["null", null], ["空串", ""], ["字符串数字", "70"], ["布尔", true]].forEach(([why, v]) => {
    const b = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: v })));
    eq(b.wallState().dim, b.WALL_DIM_DEF, "★★ 遮罩是 " + why + " → 回默认 " + b.WALL_DIM_DEF + "（不当成 0）");
  });

  function beatOf(st){ return loadApp(st).beat; }
}

/* ================= 场景 T92e：出厂默认 / 落盘 / 移除 / 恢复默认 / 应用到那一层 ================= */
section("T92e 壁纸 · 出厂默认不落盘 · 移除写哨兵 · 恢复默认回「没有键」那一态");
{
  const { beat, els, storage } = loadApp();
  /* ★ v2.13.0：全新用户（没有那个键）打开就有一张出厂默认图 */
  ok(beat.wallState() && beat.wallState().img === beat.WALL_DEFAULT,
    "★ 首次打开就有出厂默认壁纸");
  eq(els["wallLayer"].hidden, false, "有壁纸 → 那一层现身");
  eq(els["wallClearBtn"].hidden, false, "「移除」现身（有壁纸才给这个入口）");
  eq(els["wallDimRow"].hidden, false, "遮罩滑杆现身");
  eq(els["wallDefaultBtn"].hidden, true, "★「恢复默认」不现身——当前**就是**默认图，这个入口此刻无意义");
  eq(storage.get(beat.WALL_KEY), undefined,
    "★★ 默认图**不落盘**：用户什么都没做，不该为此占几百 KB（也不该让「没做过选择」变成一个存档）");
  const bg0 = String(els["wallLayer"].style.backgroundImage);
  ok(/^linear-gradient\(rgba\(18,18,18,0?\.55\)/.test(bg0), "经典主题：默认遮罩 #121212 @55%");
  ok(bg0.indexOf('url("' + beat.WALL_DEFAULT + '")') > 0, "默认图以 url(\"…\") 排在遮罩之后");
  ok(bg0.length > 1000, "贴在那一层上的确实是内联位图（不是外链文件）");

  /* 换成自己的图 → 落盘（沿用 v2.12.0 的路径） */
  const img = mk("jpeg");
  eq(beat.wallWrite(img, 55), true, "落盘成功返回 true");
  const raw = storage.get(beat.WALL_KEY);
  ok(!!raw, "确实写进了独立冷键 " + beat.WALL_KEY);
  const parsed = JSON.parse(String(raw));
  eq(parsed.v, 1, "版本号 v:1");
  eq(parsed.img, img, "图片原样");
  eq(parsed.dim, 55, "★ 遮罩与图片**同键同写**（分键就会出现换图后遮罩错位）");

  /* ★ 不进热键、不进导出包 */
  beat.Store.flush();
  const hot = String(storage.get("beatsight.state") || "");
  ok(!/base64/.test(hot), "★ 壁纸不进热键 beatsight.state（否则每次交互都要 stringify 几百 KB）");
  ok(!/wallpaper/.test(beat.Store.serializeAll()), "★ 壁纸不进「导出全部数据」（用户拍板：不进）");

  /* 应用到 DOM：遮罩渐变在前、图片在后（只压暗图片，不动内容） */
  const app2 = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img, dim: 55 }) });
  eq(app2.els["wallLayer"].hidden, false, "有壁纸时那一层现身");
  eq(app2.els["wallDefaultBtn"].hidden, false, "★ 用了自定义图 → 「恢复默认」现身（默认图有了出口）");
  const bg = String(app2.els["wallLayer"].style.backgroundImage);
  ok(/^linear-gradient\(rgba\(18,18,18,0?\.55\)/.test(bg), "★ 经典主题：遮罩是 #121212 @55%，且**排在图片前面**：" + bg.slice(0, 60));
  ok(bg.indexOf('url("' + img + '")') > 0, "图片以 url(\"…\") 形式跟在遮罩后面");

  /* 移除 → 写 {img:null} 哨兵（**不是**删键：删键 = 回到默认态 = 刷新后默认图又冒出来） */
  app2.els["wallClearBtn"].fire("click");
  eq(app2.beat.wallState(), null, "点「移除」→ 内存状态清空");
  /* 先判"键还在不在"，再解析：否则"改回删键"这个模型改动会让 JSON.parse("undefined") 抛错，
     整个套件崩在半路 —— 崩溃不是证据，要的是下面那条具名断言变红 */
  const rawSentinel = app2.storage.get(beat.WALL_KEY);
  ok(!!rawSentinel, "★★ 冷键仍在（用户「我不要壁纸」是一个**要被记住**的选择，不能靠删键表达）");
  const sentinel = rawSentinel ? JSON.parse(String(rawSentinel)) : {};
  eq(sentinel.img, null, "★★ 里面写的是 {img:null} 哨兵");
  eq(sentinel.dim, 55, "  遮罩值一并留着（下次恢复默认时不用重新调）");
  eq(app2.els["wallLayer"].hidden, true, "那一层重新收起");
  eq(app2.els["wallLayer"].style.backgroundImage, "", "background-image 一并清空（不留残影）");
  eq(app2.els["wallDefaultBtn"].hidden, false, "★「恢复默认」此时在（默认图被移掉了，得有路找回来）");

  const ap3 = loadApp({ "beatsight.wallpaper": app2.storage.get(beat.WALL_KEY) });
  eq(ap3.beat.wallState(), null, "★★ 刷新后仍是「没有壁纸」——哨兵生效，默认图**不复活**");

  /* 恢复默认 = 删键（回到"键不存在"那一态） */
  ap3.els["wallDefaultBtn"].fire("click");
  ok(ap3.beat.wallState() && ap3.beat.wallState().img === beat.WALL_DEFAULT, "点「恢复默认」→ 默认图回来");
  eq(ap3.storage.get(beat.WALL_KEY), undefined,
    "★★ 且**回到「没有键」那一态**（不把 186 KB 的内联常量抄一份进存储）");
  eq(ap3.els["wallDefaultBtn"].hidden, true, "「恢复默认」随之收起（已经不缺默认图了）");
  eq(ap3.els["wallLayer"].hidden, false, "画面回到默认壁纸");
}

/* ================= 场景 T92f：遮罩滑杆的两级口径 ================= */
section("T92f 壁纸 · 遮罩滑杆：拖动手感即时、松手才落盘");
{
  const { beat, els, storage } = loadApp({
    "beatsight.wallpaper": JSON.stringify({ v:1, img: mk("png"), dim: 55 }) });
  eq(els["wallDim"].value, "55", "滑杆初值回读存档");
  eq(els["wallDimPct"].textContent, "55%", "百分比文案同步");

  /* input：只改观感，不落盘 —— 每帧写几百 KB 会卡 */
  els["wallDim"].fire("input", { target: { value: "20" } });
  eq(beat.wallState().dim, 20, "拖动 → 状态跟着变");
  ok(/rgba\(18,18,18,0?\.2\)/.test(String(els["wallLayer"].style.backgroundImage)),
    "拖动 → 画面立刻跟着变（这才是滑杆的意义）");
  eq(JSON.parse(String(storage.get(beat.WALL_KEY))).dim, 55, "★ input 阶段**不落盘**");

  /* change：松手才写 */
  els["wallDim"].fire("change", { target: { value: "20" } });
  eq(JSON.parse(String(storage.get(beat.WALL_KEY))).dim, 20, "★ change 才写盘");

  /* 越界：滑杆被拖出域（或将来有人改 max）时仍要钳住 */
  els["wallDim"].fire("input", { target: { value: "9999" } });
  eq(beat.wallState().dim, beat.WALL_DIM_MAX, "拖到 9999 → 钳到上限 " + beat.WALL_DIM_MAX);
  els["wallDim"].fire("input", { target: { value: "-1" } });
  eq(beat.wallState().dim, 0, "拖到 -1 → 钳到 0");
  /* ★ v2.13.0：默认图上调遮罩——落盘写的是**记号** "default"，不是那 186 KB 的内联常量。
     反例（若直接写 wallNow.img）：用户只是把遮罩从 55 拖到 70，本地存储里就多一份
     与文件内容逐位相同的图副本，占掉 5 MB 配额里的 380 KB ——纯浪费。 */
  const d = loadApp();
  ok(d.beat.wallState() && d.beat.wallState().img === d.beat.WALL_DEFAULT, "前提：默认图在");
  eq(d.els["wallDim"].value, "55", "默认图下遮罩初值也是 55");
  d.els["wallDim"].fire("input", { target: { value: "70" } });
  eq(d.storage.get(beat.WALL_KEY), undefined, "★ 默认图上拖动仍**不落盘**（与自定义图同一套两级口径）");
  d.els["wallDim"].fire("change", { target: { value: "70" } });
  const rawD = d.storage.get(beat.WALL_KEY);
  ok(!!rawD, "★★ 默认图上调完遮罩要落盘（否则这个选择刷新即丢）");
  const dw = rawD ? JSON.parse(String(rawD)) : {};
  eq(dw.img, d.beat.WALL_TOKEN_DEFAULT, "★★ 松手落盘写的是记号 default");
  eq(dw.dim, 70, "  遮罩值照写");
  ok(String(rawD || "").length < 200,
    "★★ 且存档极小（几十字节，不是把默认图抄一份进 localStorage）");
  const d2 = loadApp({ "beatsight.wallpaper": d.storage.get(beat.WALL_KEY) });
  ok(d2.beat.wallState() && d2.beat.wallState().img === d2.beat.WALL_DEFAULT && d2.beat.wallState().dim === 70,
    "★ 刷新后：默认图 + 用户自己调的 70%（记号被正确展开回那张图）");

  /* 用户已移除（img:null）时动滑杆：不产孤儿存档、也不能把「移除」这个选择改写掉 */
  const bare = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img: null, dim: 55 }) });
  eq(bare.beat.wallState(), null, "前提：这是「已移除」态");
  bare.els["wallDim"].fire("input", { target: { value: "30" } });
  bare.els["wallDim"].fire("change", { target: { value: "30" } });
  eq(bare.storage.get(beat.WALL_KEY), JSON.stringify({ v:1, img: null, dim: 55 }),
    "★ 没有壁纸时动滑杆 → 存档一位不变（既不产孤儿存档，也不把「移除」改成别的形态）");
}

/* ================= 场景 T92g：选图接线（文件太大 / 读不出 / 存不下） ================= */
section("T92g 壁纸 · 选图的几种失败都要有话说（不能点了没反应）");
{
  const { beat, els, setFileText, setFileFail } = loadApp();

  /* ① 解码前就挡掉超大文件（解码一张 50MB 的图会把主线程卡住） */
  els["wallFile"].fire("change", { target: { files: [{ size: beat.WALL_SRC_MAX_BYTES + 1 }], value: "" } });
  ok(/太大/.test(String(els["modalMsg"].textContent)), "★ 超大文件 → 提示太大：" + els["modalMsg"].textContent);

  /* ② 文件读不出来 */
  const a = loadApp();
  a.setFileFail(true);
  a.els["wallFile"].fire("change", { target: { files: [{ size: 1024 }], value: "" } });
  ok(/读不到|读不出来/.test(String(a.els["modalMsg"].textContent)),
    "★ FileReader onerror → 有提示：" + a.els["modalMsg"].textContent);
  a.setFileFail(false);

  /* ③ 读出来的东西不是这三格式（桩里拿不到 Image/canvas → 走"直接用原图"分支，
        于是校验会把它挡在这里） */
  const b = loadApp();
  b.setFileText(mk("gif"));
  b.els["wallFile"].fire("change", { target: { files: [{ size: 1024 }], value: "" } });
  ok(/用不上|三种/.test(String(b.els["modalMsg"].textContent)),
    "★ 格式不对 → 有提示：" + b.els["modalMsg"].textContent);
  ok(b.beat.wallState() && b.beat.wallState().img === b.beat.WALL_DEFAULT,
    "★ 选图失败时壁纸仍是默认图（不是把画面弄成空的——失败不该有副作用）");
  eq(b.storage.get(beat.WALL_KEY), undefined, "  且没有落盘");

  /* ④ 正常路径（桩里 canvas 拿不到 → 原图直接过校验落盘） */
  const c = loadApp();
  c.setFileText(mk("jpeg"));
  c.els["wallFile"].fire("change", { target: { files: [{ size: 1024 }], value: "" } });
  ok(!!c.beat.wallState(), "★ 正常图片 → 装上壁纸");
  eq(c.beat.wallState().img, mk("jpeg"), "装的就是那张图");
  eq(c.els["wallLayer"].hidden, false, "壁纸层现身");
  eq(c.els["wallClearBtn"].hidden, false, "「移除」按钮现身");

  /* ⑤ 存不下：写盘抛 QuotaExceededError → 必须明确提示（这是用户能自己解决的） */
  const d = loadApp();
  d.setFileText(mk("jpeg"));
  d.sandbox.localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  d.els["wallFile"].fire("change", { target: { files: [{ size: 1024 }], value: "" } });
  ok(/存不下/.test(String(d.els["modalMsg"].textContent)),
    "★ 配额不足 → 提示存不下并给出出路：" + d.els["modalMsg"].textContent);
  ok(d.beat.wallState() && d.beat.wallState().img === d.beat.WALL_DEFAULT,
    "★ 没存成就不该假装装上了：画面停在默认图，而不是那张没存下去的自定义图");

  /* ⑥ 同一个文件连选两次要能再触发（value 必须清空） */
  const e = loadApp();
  e.setFileText(mk("png"));
  e.els["wallFile"].fire("change", { target: { files: [{ size: 1024 }], value: "x.jpg" } });
  eq(e.els["wallFile"].value, "", "★ 选完把 input.value 清空（否则第二次选同一个文件不派发 change）");
}

/* ================= 场景 T92h：换主题时遮罩颜色跟着换 ================= */
section("T92h 壁纸 · 遮罩颜色随主题（经典 #121212 / 观测台 #0A0C12）");
{
  const { beat, els } = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img: mk("png"), dim: 55 }) });
  ok(/rgba\(18,18,18,/.test(String(els["wallLayer"].style.backgroundImage)), "经典主题 → 遮罩 #121212");
  els["themeToggle"].fire("click");
  ok(/rgba\(10,12,18,/.test(String(els["wallLayer"].style.backgroundImage)),
    "★ 切到观测台 → 遮罩换成 #0A0C12（否则深色主题下压暗用的是浅色，壁纸会发灰）");
  els["themeToggle"].fire("click");
  ok(/rgba\(18,18,18,/.test(String(els["wallLayer"].style.backgroundImage)), "切回来 → 换回 #121212");
}

/* ================= 场景 T92m：选图按钮的转发（v2.18.0 补） ================= */
/* 补装配区那 38 行未覆盖里**真正该测**的两处之二：`#wallPickBtn` 是一颗普通按钮，
   真正的选图是隐藏的 `<input type=file>`；按钮点击必须**转发**过去，否则这个入口形同虚设。 */
section("T92m 选背景图 · 按钮点击必须转发到隐藏的 file input");
{
  const { els } = loadApp();
  let hit = false;
  els["wallFile"].click = () => { hit = true; };      // 探针：替掉真实 click，只记有没有被调到
  els["wallPickBtn"].fire("click");
  eq(hit, true, "★「选背景图」把点击转发给了 <input type=file>（漏了这行 = 选图按钮点了没反应）");
}
