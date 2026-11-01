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
  eq(wp.beat.wallState(), null,
    "★★ 存档里藏着这种值 → 回出厂无图状态，且整页照常加载");
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

/* ================= 场景 T92d：默认无图 / 旧记号兼容 / 脏值不惊动用户 ================= */
section("T92d 壁纸 · 键缺失、旧 default 记号与 null 都按无图处理");
{
  const seed = s => ({ "beatsight.wallpaper": s });
  eq(beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: 30 }))).wallState().dim, 30,
    "正常自定义存档：图与遮罩都读回");
  eq(beatOf({}).wallState(), null, "★ 键不存在 → 出厂无背景图");
  eq(beatOf(seed(JSON.stringify({ v:1, img: "default", dim: 72 }))).wallState(), null,
    "★★ 旧版 default 记号 → 无背景图，已删除的内置图不复活");
  eq(beatOf(seed(JSON.stringify({ v:1, img: null, dim: 60 }))).wallState(), null,
    "★★ img:null → 无背景图");
  const v2pack = beatOf(seed(JSON.stringify({ v:2, img: mk("png"), dim: 10, byLyric: true, 未来字段: 1 })));
  ok(v2pack.wallState() && v2pack.wallState().dim === 10,
    "自定义图片带多余字段/更高 v 的包照常读（不因多字段判脏）");

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
    eq(b.wallState(), null, "★ " + why + " → 回出厂无图状态");
    eq(b.diag.winErr, 0, "  且不产生脚本错误（脏数据不该把页面带崩）");
  });

  const hi = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: 9999 })));
  eq(hi.wallState().dim, hi.WALL_DIM_MAX, "遮罩 9999 → 钳到上限 " + hi.WALL_DIM_MAX);
  const lo = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: -50 })));
  eq(lo.wallState().dim, 0, "遮罩 -50 → 钳到 0");
  const nan = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: "x" })));
  eq(nan.wallState().dim, nan.WALL_DIM_DEF, "遮罩非数字 → 回默认 " + nan.WALL_DIM_DEF);
  eq(nan.wallState().img, mk("png"), "★ 只有遮罩脏时，自定义图片仍然保留");
  eq(beatOf(seed(JSON.stringify({ v:1, img: "default", dim: null }))).wallState(), null,
    "★ 旧记号配脏遮罩也不会让默认图复活");
  [["null", null], ["空串", ""], ["字符串数字", "70"], ["布尔", true]].forEach(([why, v]) => {
    const b = beatOf(seed(JSON.stringify({ v:1, img: mk("png"), dim: v })));
    eq(b.wallState().dim, b.WALL_DIM_DEF, "★★ 遮罩是 " + why + " → 回默认 " + b.WALL_DIM_DEF + "（不当成 0）");
  });

  function beatOf(st){ return loadApp(st).beat; }
}

/* ================= 场景 T92e：出厂无图 / 自定义落盘 / 移除 / 恢复默认 ================= */
section("T92e 壁纸 · 出厂无图 · 自定义图可移除 · 恢复默认回到无图");
{
  const { beat, els, storage } = loadApp();
  eq(beat.wallState(), null, "★ 首次打开没有默认壁纸");
  eq(els["wallLayer"].hidden, true, "无壁纸 → 背景层隐藏");
  eq(els["wallClearBtn"].hidden, true, "无壁纸 →「移除」隐藏");
  eq(els["wallDimRow"].hidden, true, "无壁纸 → 遮罩滑杆隐藏");
  eq(els["wallDefaultBtn"].hidden, true, "无壁纸 →「恢复默认」隐藏");
  eq(storage.get(beat.WALL_KEY), undefined, "★ 无图默认态不落盘");
  eq(els["wallLayer"].style.backgroundImage, "", "★ 首屏没有背景图或遮罩残留");

  const img = mk("jpeg");
  eq(beat.wallWrite(img, 55), true, "自定义图落盘成功返回 true");
  const raw = storage.get(beat.WALL_KEY);
  ok(!!raw, "确实写进了独立冷键 " + beat.WALL_KEY);
  const parsed = JSON.parse(String(raw));
  eq(parsed.v, 1, "版本号 v:1");
  eq(parsed.img, img, "图片原样");
  eq(parsed.dim, 55, "★ 遮罩与图片同键同写");

  beat.Store.flush();
  const hot = String(storage.get("beatsight.state") || "");
  ok(!/base64/.test(hot), "★ 壁纸不进热键 beatsight.state");
  ok(!/wallpaper/.test(beat.Store.serializeAll()), "★ 壁纸不进「导出全部数据」");

  const app2 = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img, dim: 55 }) });
  eq(app2.els["wallLayer"].hidden, false, "自定义壁纸出现时背景层现身");
  eq(app2.els["wallDefaultBtn"].hidden, false, "★ 自定义壁纸出现时「恢复默认」现身");
  const bg = String(app2.els["wallLayer"].style.backgroundImage);
  ok(/^linear-gradient\(rgba\(18,18,18,0?\.55\)/.test(bg), "★ 经典主题：遮罩是 #121212 @55%");
  ok(bg.indexOf('url("' + img + '")') > 0, "自定义图片以 url(\"…\") 形式跟在遮罩后面");

  app2.els["wallClearBtn"].fire("click");
  eq(app2.beat.wallState(), null, "点「移除」→ 内存状态清空");
  const rawSentinel = app2.storage.get(beat.WALL_KEY);
  ok(!!rawSentinel, "★★ 冷键仍在，移除选择被记住");
  const sentinel = rawSentinel ? JSON.parse(String(rawSentinel)) : {};
  eq(sentinel.img, null, "★★ 里面写的是 {img:null} 哨兵");
  eq(sentinel.dim, 55, "  遮罩值按既有存档结构保留");
  eq(app2.els["wallLayer"].hidden, true, "背景层重新收起");
  eq(app2.els["wallLayer"].style.backgroundImage, "", "background-image 一并清空");
  eq(app2.els["wallDefaultBtn"].hidden, true, "无图后「恢复默认」收起");

  const ap3 = loadApp({ "beatsight.wallpaper": app2.storage.get(beat.WALL_KEY) });
  eq(ap3.beat.wallState(), null, "★★ 刷新后仍是没有壁纸");

  const restore = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img, dim: 55 }) });
  restore.els["wallDefaultBtn"].fire("click");
  eq(restore.beat.wallState(), null, "自定义图状态点「恢复默认」→ 回到无图");
  eq(restore.storage.get(beat.WALL_KEY), undefined, "★ 恢复默认删除自定义壁纸存档");
  eq(restore.els["wallDefaultBtn"].hidden, true, "恢复默认后按钮收起");
  eq(restore.els["wallLayer"].hidden, true, "恢复默认后背景层隐藏");
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
  const persisted = JSON.parse(String(storage.get(beat.WALL_KEY)));
  eq(persisted.img, mk("png"), "★ 自定义图遮罩落盘仍写图片本体，不使用旧 default 记号");

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
  eq(b.beat.wallState(), null, "★ 选图失败时仍保持出厂无图状态，失败无副作用");
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
  eq(d.beat.wallState(), null, "★ 没存成就保持无图状态，不假装装上自定义图");

  /* ⑥ 同一个文件连选两次要能再触发（value 必须清空） */
  const e = loadApp();
  e.setFileText(mk("png"));
  e.els["wallFile"].fire("change", { target: { files: [{ size: 1024 }], value: "x.jpg" } });
  eq(e.els["wallFile"].value, "", "★ 选完把 input.value 清空（否则第二次选同一个文件不派发 change）");
}

/* ================= 场景 T92h：换主题时遮罩颜色跟着换 =================
   v2.54.0 迁移：日间主题是**浅色**，遮罩方向随之翻成浅色（#F2F4F8 系）——
   滑杆语义仍是「数值越大压得越净」，变的是压上去的那层颜色（见 WALL_TINT）。 */
section("T92h 壁纸 · 遮罩颜色随主题（经典 #121212 / 日间 #F2F4F8）");
{
  const { beat, els } = loadApp({ "beatsight.wallpaper": JSON.stringify({ v:1, img: mk("png"), dim: 55 }) });
  ok(/rgba\(18,18,18,/.test(String(els["wallLayer"].style.backgroundImage)), "经典主题 → 遮罩 #121212");
  els["themeToggle"].fire("click");
  ok(/rgba\(244,246,250,/.test(String(els["wallLayer"].style.backgroundImage)),
    "★ 切到日间 → 遮罩换成 #F2F4F8（浅色主题下压暗要用浅色遮罩，否则壁纸会发灰）");
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
