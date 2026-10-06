/* T208 内嵌出厂壁纸必须守自家策略（v3.34.6，审计 P2-1）
   ---------------------------------------------------------------------------
   由来：出厂壁纸是**内联在 index.html 里的 base64**，它是单文件里最大的一块常量。
   实测（改前）：**2516×1667 / 267.6 KB 原图 / 356.8 KB base64**——
   而本应用对**用户自己挑的图**有一条明确策略：长边压到 `WALL_MAX_EDGE`(1600) 再编码
   （`wallRecompress` + `wallCheck`）。也就是说：**应用要求用户守的尺寸，自带的那张没守**
   ——自带图比策略上限宽了 57%，白占近 140 KB。

   修法：按**应用自己的策略**（1600px 长边、JPEG 质量 0.82 —— 与 `wallRecompress` 首档一致）
   重新生成出厂图。体积 1802.5 → 1665.4 KB（余量 17.5 → 154.6 KB）。
   ★ 这是一次**视觉资产变更**，像素级观感需人眼验收（见 CHANGELOG 的「待用户验收」）。

   本用例把"出厂图也必须守策略"变成机器判据——否则下次有人再塞一张 4000px 的照片，
   体积会被无声吃掉几十 KB，而那时余量未必还有。
   判据全部从**常量本身**现算（不写死 2516/267 这些数字），换图后自动适配：
     ① 能解码出真实尺寸（结构合法）；
     ② 长边 ≤ WALL_MAX_EDGE（与用户图同一把尺子）；
     ③ base64 体积 ≤ 预算（防止"尺寸合规但质量拉到 1.0"绕过 ②）。
   ★ 纯 JS 解析 JPEG 的 SOF 段拿宽高——测试环境没有图像解码库，也不需要：
     SOF0/SOF2 里第 5、7 字节起就是高、宽（大端 16 位）。 */
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 从 JPEG 字节流里读出宽高（扫段直到 SOF；跳过 SOI/EOI/RST 这些无长度段的标记） */
function jpegSize(buf){
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < buf.length){
    if (buf[i] !== 0xFF){ i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)){ i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSOF = marker >= 0xC0 && marker <= 0xCF
      && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;   // 排除 DHT/JPG/DAC
    if (isSOF) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

section("T208 出厂壁纸 · 必须守应用自己的尺寸与体积策略");
{
  const { beat } = loadApp();
  const url = beat.WALL_DEFAULT;
  eq(typeof url, "string", "WALL_DEFAULT 是字符串常量");
  ok(/^data:image\/jpeg;base64,/.test(url), "★ 出厂图是 JPEG（策略里唯一无需回退的格式）");

  const b64 = url.slice("data:image/jpeg;base64,".length);
  eq(beat.wallCheck(url).ok, true, "★ 出厂图通过 wallCheck（结构合法，能与用户图走同一条渲染路径）");

  /* ① 能解出真实尺寸 */
  const buf = Buffer.from(b64, "base64");
  const sz = jpegSize(buf);
  ok(!!sz, "能从字节流解出尺寸（SOF 段结构合法）");

  /* ② 长边 ≤ WALL_MAX_EDGE —— 与用户图同一把尺子 */
  if (sz){
    const long = Math.max(sz.w, sz.h);
    ok(long <= beat.WALL_MAX_EDGE,
      "★★ 长边 " + long + " ≤ WALL_MAX_EDGE(" + beat.WALL_MAX_EDGE + ")——出厂图不得比策略上限还大"
      + "（改前是 2516，超了 57%）");
    ok(sz.w > 0 && sz.h > 0, "宽高为正（" + sz.w + "×" + sz.h + "）");
  }

  /* ③ 体积预算：防止"尺寸合规但质量拉满"绕过 ② */
  const kb = b64.length / 1024;
  ok(b64.length <= 300 * 1024,
    "★ base64 " + kb.toFixed(1) + " KB ≤ 300 KB 预算（出厂图不该是单文件里最大的一块）");

  /* ④ 可被解析回同一张图（往返一致，防止替换脚本写坏 base64） */
  const back = Buffer.from(b64, "base64").toString("base64");
  eq(back.slice(0, 64), b64.slice(0, 64), "base64 往返一致（头 64 字符）");
}
