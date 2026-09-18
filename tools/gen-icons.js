/* PWA 图标生成器（v2.4.4，零依赖）
   ---------------------------------------------------------------------------
   由来：192/512 PNG 回退图标（含 maskable）若以**二进制文件**入库，任何"只能推文本"
   的发布路径（如 GitHub Web/API）都带不动它们。而本项目的既定口味就是"能生成的
   不入库"（音色程序合成、零采样文件同 philosophy）——图标同理：
   **仓库里只存这份生成器，PNG 由 build-dist.js 在装配时现场生成**。

   实现：手写光栅化（圆角矩形底 + 梯形 + 圆头斜线 + 圆点，与 icon.svg 同一组坐标）
   + 手写 PNG 编码（zlib 是 Node 内置，不算依赖）。2× 超采样抗锯齿。

   用法：node tools/gen-icons.js [输出目录]   # 缺省输出到仓库根（本地开发/PWA 调试用）
   build-dist.js 调用时传入 dist。生成的 PNG **不入库**（.gitignore 已拦）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---- CRC32（PNG 块校验） ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---- PNG 编码：RGBA 像素数组 → PNG Buffer（filter 0 逐行 + zlib deflate） ---- */
function encodePng(size, px){
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                     // 8bit, RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++){
    raw[y * (size * 4 + 1)] = 0;                // filter: None
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ---- 光栅化：与 icon.svg 同坐标（512 视口）。2× 超采样 ---- */
function drawIcon(outSize, maskable){
  const SS = 2, W = outSize * SS;
  const px = Buffer.alloc(W * W * 4);           // 初始全透明
  const sc = (W / 512) * (maskable ? 0.8 : 1);
  const off = maskable ? (W - 512 * sc) / 2 : 0;
  const X = v => v * sc + off, Y = v => v * sc + off;

  const BG = [18, 18, 18], GREEN = [30, 215, 96], INK = [10, 10, 10];
  const setPx = (x, y, rgb, a) => {
    const i = (y * W + x) * 4;
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = a;
  };
  const inRoundedRect = (x, y, r) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return false;
    const cx = Math.max(r, Math.min(x, W - r)), cy = Math.max(r, Math.min(y, W - r));
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r || (x >= r && x < W - r) || (y >= r && y < W - r);
  };
  /* 点在多边形内（梯形 4 顶点，射线法） */
  const poly = [[196, 96], [316, 96], [364, 416], [148, 416]].map(([a, b]) => [X(a), Y(b)]);
  const inPoly = (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  /* 点到线段距离（圆头斜线：244,312 → 310,116，宽 26） */
  const ax = X(244), ay = Y(312), bx = X(310), by = Y(116), halfW = 13 * sc;
  const lx = bx - ax, ly = by - ay, ll = lx * lx + ly * ly;
  const nearLine = (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * lx + (y - ay) * ly) / ll));
    const dx = x - (ax + t * lx), dy = y - (ay + t * ly);
    return dx * dx + dy * dy <= halfW * halfW;
  };
  const cxr = X(292), cyr = Y(158), cr = 26 * sc;
  const inCircle = (x, y) => (x - cxr) * (x - cxr) + (y - cyr) * (y - cyr) <= cr * cr;

  const r = 96 * sc;
  for (let y = 0; y < W; y++){
    for (let x = 0; x < W; x++){
      const bg = maskable ? (x >= 0 && y >= 0) : inRoundedRect(x, y, r);
      if (!bg) continue;
      let rgb = BG;
      if (inPoly(x, y)) rgb = GREEN;
      if (nearLine(x, y) || inCircle(x, y)) rgb = INK;
      setPx(x, y, rgb, 255);
    }
  }
  /* 降采样 2× → outSize（盒式平均） */
  const out = Buffer.alloc(outSize * outSize * 4);
  for (let y = 0; y < outSize; y++){
    for (let x = 0; x < outSize; x++){
      for (let ch = 0; ch < 4; ch++){
        let s = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++)
          s += px[((y * SS + dy) * W + (x * SS + dx)) * 4 + ch];
        out[(y * outSize + x) * 4 + ch] = Math.round(s / (SS * SS));
      }
    }
  }
  return encodePng(outSize, out);
}

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..");
fs.mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]){
  for (const maskable of [false, true]){
    const name = `icon${maskable ? "-maskable" : ""}-${size}.png`;
    const buf = drawIcon(size, maskable);
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log("  ✓ " + name.padEnd(24) + (buf.length / 1024).toFixed(1) + " KB");
  }
}
