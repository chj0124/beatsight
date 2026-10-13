/* BeatSight 自动化测试 · 编辑页「保存为预设」移到底部（本版）
   T244。
   ---------------------------------------------------------------------------
   契约（用户需求）：**保存为预设**从 `.editor-topbar` 移到卡片底部——「归属」输入行下方、
   单独一行、右对齐；顶栏 `.editor-actions` 只留「试听」（本次未删试听）。
   为什么用**源码级**断言：这是标记位置改动，而 harness 的 DOM 桩不解析 HTML（按 id 懒建元素），
   DOM 层面查不到父子/顺序；位置只能对着 `index.html` 的标记源串钉。
   反向验证：把按钮挪回顶栏 → 本用例具名红。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const src = html;
/* 与 t201 同款：从某个 `<div` 起，配平 div 找它对应的 `</div>` 之后的位置 */
function endOfDiv(s, start){
  let depth = 0, i = start;
  while (i < s.length){
    const open = s.indexOf("<div", i), close = s.indexOf("</div>", i);
    if (close < 0) return -1;
    if (open >= 0 && open < close){ depth++; i = open + 4; }
    else { depth--; if (depth === 0) return close + 6; i = close + 6; }
  }
  return -1;
}

/* ================= 场景 T244：保存键落位 ================= */
section("T244 编辑页 · 「保存为预设」移到底部（归属行下方、右对齐；顶栏仅剩「试听」）");
{
  const iTop = src.indexOf('<div class="editor-topbar">');
  const iSave = src.indexOf('id="savePresetBtn"');
  const iSong = src.indexOf('id="songNameInput"');
  const iAud = src.indexOf('id="auditionBtn"');
  ok(iTop >= 0 && iSave >= 0 && iSong >= 0 && iAud >= 0, "前提：四处锚点都能定位");
  const topEnd = endOfDiv(src, iTop);
  ok(topEnd > iTop, "前提：顶栏的配对 </div> 能算出来");
  const topbar = src.slice(iTop, topEnd);

  ok(!/id="savePresetBtn"/.test(topbar), "★ 「保存为预设」已**不在** .editor-topbar 内（搬离顶栏）");
  ok(/id="auditionBtn"/.test(topbar), "★ 「试听」仍在顶栏（本次未删试听）");
  ok(iSave > iSong, "★ 「保存为预设」排在「归属」输入行之后（卡片底部）");

  const wrapStart = src.lastIndexOf("<div", iSave);
  ok(/justify-content:\s*flex-end/.test(src.slice(wrapStart, iSave)),
     "★ 保存键所在行右对齐（justify-content:flex-end）");

  const iCard = src.indexOf('<div class="card">', iTop);
  ok(iCard > iTop && iSave > iCard, "★ 保存键落在编辑器卡片内（顶栏之后、未掉出编辑器）");
}

/* ================= 场景 T244b：搬到底部后，保存/禁用逻辑仍按 id 生效 ================= */
section("T244b 编辑页 · 移动后保存仍可用（id 不变 ⇒ 逻辑零改动）");
{
  const { beat, els } = loadApp();
  const St = beat.Store;
  St.importPresets(JSON.stringify({ presets: [{ name: "四拍", meter: 4, bars: [[
    { t: 48 }, { t: 48 }, { t: 48 }, { t: 48 }]] }] }));
  St.S.sel = { type: "custom", id: St.customs[St.customs.length - 1].id };
  beat.Presets.refreshAfterPatternChange();
  beat.Editor.open();
  eq(els["savePresetBtn"].disabled, true, "归属为空 → 保存键禁用（搬到底部不改判据）");
  els["songNameInput"].value = "新歌";
  els["songNameInput"].fire("input");
  eq(els["savePresetBtn"].disabled, false, "填了归属 → 保存键可用");
  els["savePresetBtn"].fire("click");
  ok(St.customs.some(c => c.song === "新歌"), "★ 点底部保存键照常落库（id 通道未变）");
}
