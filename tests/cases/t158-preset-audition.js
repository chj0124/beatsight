/* T158 条目级 ▶ 试听（v3.1.0，4.3/A11）——复用编辑器/听辨的预览通道（同一条 previewRef）。
   钉五条：进/出预览态 / 再点同条即停 / 换条切换对象 / 主播放互斥 / 拍号临时对齐并恢复。
   ★ 试听 ≠ 选中：全程 S.sel 不变。★ 条目序 ≠ BUILTINS 序（按内容分区），一律按名字断言。 */
const { loadApp, FakeAudioContext, ok, eq, section } = require("../lib/harness");
const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });

const presetItems = els => els["presetList"].children.filter(c => /(^| )preset-item( |$)/.test(c.className));
/* 条目子序：[box, ▶(aud), ✎(ren), 📁(grp)]（▶ 在 v3.1.0 插到 ✎ 之前） */
const audBtnOf = item => item.children.find(c => c.className === "aud");
const nameOf = item => item.children[0].children[0].textContent;

section("T158 试听 · 进/出/换/互斥/拍号恢复");
{
  const { beat, els } = loadApp(seedState({ sel: { type: "builtin", idx: 1 } }));
  let items = presetItems(els);
  ok(items.length > 2, "前提：预设列表已渲染（内置型 ≥ 3 条）");
  const aud0 = audBtnOf(items[0]), aud1 = audBtnOf(items[1]);
  ok(!!aud0 && !!aud1, "前提：条目带 ▶ 试听钮");
  const name0 = nameOf(items[0]), name1 = nameOf(items[1]);

  /* ① 点 ▶ → 进预览态：S.preview=true、试听对象 = 该条目的型、正在播 */
  aud0.fire("click");
  eq(beat.Store.S.preview, true, "★ 点 ▶ → S.preview = true");
  eq(beat.curPattern().name, name0, "★ 试听对象 = 该条目的型");
  eq(beat.Store.S.playing, true, "试听在发声（Controls.start 已走）");
  eq(beat.Store.S.sel.type + "/" + beat.Store.S.sel.idx, "builtin/1", "★ S.sel 纹丝不动（试听 ≠ 选中）");
  eq(aud0.textContent, "■", "按钮态翻转为 ■");

  /* ② 再点同一条 → 停止试听 */
  aud0.fire("click");
  eq(beat.Store.S.preview, false, "★ 再点同一条 → 预览退出");
  eq(beat.Store.S.playing, false, "播放停止");
  eq(aud0.textContent, "▶", "按钮态翻回 ▶");

  /* ③ 换条试听：试听对象跟着走（前一条按钮态同步翻回） */
  aud0.fire("click");
  aud1.fire("click");
  eq(beat.curPattern().name, name1, "★ 点别条 → 试听对象切换");
  eq(aud0.textContent, "▶", "前一条按钮态同步翻回 ▶");
  eq(aud1.textContent, "■", "当前条按钮态 ■");
  aud1.fire("click");
  eq(beat.Store.S.preview, false, "收尾：退出试听");

  /* ④ 与主播放互斥：主播放开着时点 ▶ → 主播放让位给试听 */
  beat.Controls.start();                      // 主播放（预设模式，选中的 idx 1）
  eq(beat.Store.S.playing && !beat.Store.S.preview, true, "前提：主播放中");
  aud0.fire("click");
  eq(beat.Store.S.preview, true, "★ 主播放中点 ▶ → 进入试听");
  eq(beat.curPattern().name, name0, "试听对象正确");
  aud0.fire("click");                         // 收尾退出

  /* ⑤ 拍号临时对齐并恢复：3/4 的型在 4/4 下试听 → 停止后拍号回到 4/4 */
  beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "三拍试听载体", meter: 3, bars: [[{ t: 48 }, { t: 48 }, { t: 48 }]] },   // 3×48 = 144 = meter×TPB
  ] }));
  beat.Presets.refreshAfterPatternChange();   /* 导入后刷新列表（新自定义条目入列） */
  eq(beat.Store.S.sig, 4, "前提：当前拍号 4/4");
  items = presetItems(els);
  const item34 = items.find(it => nameOf(it) === "三拍试听载体");
  ok(!!item34, "前提：3/4 条目已渲染");
  const aud34 = audBtnOf(item34);
  aud34.fire("click");
  eq(beat.Store.S.sig, 3, "★ 试听 3/4 型 → 拍号临时对齐");
  aud34.fire("click");
  eq(beat.Store.S.sig, 4, "★ 停止 → 拍号恢复 4/4（试听不改用户偏好）");
  eq(beat.Store.S.preview, false, "收尾：预览态已退出");
}
