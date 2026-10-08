/* BeatSight 自动化测试 · 旋律谱 A 期：歌词字块的音高标注（v3.37.0）
   T222 系列。
   ---------------------------------------------------------------------------
   由来（用户需求 + 三项拍板）：可视化区增加「与段落对应的旋律谱」——
     · 形态 = 方案 A：音高并入**歌词字块**（LyricChar 加可选 p = 整数半音，60=C4），
       纯记谱层（调度器一行不读，与扫弦 dir 同一纪律）；
     · 记谱 = 双渲染可切换（设置三态：off 关 / jp 简谱 / nm 音名；存储始终是半音整数）；
     · 第一期纯显示（不做旋律提示音）。
   契约锚点（与 index.html「旋律音高标注」头注释同源）：
     · 简谱首调：度数换算按调主（ArrangeData.key，缺省 C）；音名是绝对音高、不读调主；
     · 贴词后缀必须「紧跟字 + 止于空白/串尾」——否则数字歌词（999朵玫瑰）会被吃成音高；
     · p 全链路保真：拖动/换位/平移/时值/对齐/打轴/保位重建——所有重建 chars 的路径
       都必须把 p 原样带过去（本文件的 T222e 逐路径钉死）；
     · 显示开关只管练习画面：编排页编辑轨**恒显**（off 时按简谱），aria-label 恒带音高。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { loadApp, ok, eq, section } = require("../lib/harness");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");

const lyOf = (els, i) => els["argSections"].children[i].children
  .find(c => /(^| )arg-lyric( |$)/.test(c.className));
const byCls = (root, cls) => root.children.find(c => new RegExp("(^| )" + cls + "( |$)").test(c.className));
const chipsOf = lane => Array.prototype.concat.apply([], Array.prototype.map.call(lane.children,
  r => { const b = Array.prototype.find.call(r.children || [],
    c => /(^| )arg-lyric-barrow( |$)/.test(c.className));
    return (b || r).children.filter(c => /(^| )arg-lyric-chip( |$)/.test(c.className)); }));
const miniByAria = (ly, frag) => ly.children.find(c =>
  /(^| )arg-mini( |$)/.test(c.className) && c.getAttribute("aria-label") &&
  c.getAttribute("aria-label").indexOf(frag) >= 0);
const sumOf = ly => ly.children.find(c => /(^| )arg-lyric-sum( |$)/.test(c.className));

/* 夹具（t118 同款）：一个 4/4 段（span=192t）+ 打开编排页并展开歌词编辑区 */
function fixture(){
  const app = loadApp();
  const { beat, els } = app;
  ok(beat.Store.importPresets(JSON.stringify({ presets: [
    { name: "素材T", meter: 4, bars: [[{ t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }, { t: 24 }]] },
  ] })).ok, "素材型导入");
  const pid = beat.Store.customs[beat.Store.customs.length - 1].id;
  ok(beat.Store.upsertArrange({ name: "曲式T", sections: [
    { name: "段", blocks: [{ ref: { type: "custom", id: pid }, repeats: 1 }] },
  ] }), "曲式落库");
  const arr = beat.Store.arranges[beat.Store.arranges.length - 1];
  beat.Store.deleteArrange(beat.DEMO_ID);
  beat.Arrange.open();
  sumOf(lyOf(els, 0)).fire("click");                  // 展开歌词编辑区
  return Object.assign(app, { id: arr.id, uid: arr.sections[0].uid, arr: arr });
}
const paste = (els, text) => {
  const box = byCls(lyOf(els, 0), "arg-lyric-paste");
  box.value = text;
  box.fire("change");
};
const chars = (beat, id, uid) => {
  const l = beat.Store.findLyric(id, uid);
  return l ? l.chars : null;
};

/* ============ T222a：音高纯函数（度数折算 / 音名 / 调主） ============ */
section("T222a 纯函数 · midi↔简谱/音名折算（keySemiOf / jianpuOf / pitchNameOf）");
{
  const { beat } = loadApp();
  eq(beat.keySemiOf("C"), 60, "调主 C = C4 = 60");
  eq(beat.keySemiOf("F#"), 66, "调主 F# = 66");
  eq(beat.keySemiOf("Bb"), 70, "同音异名 Bb = A# = 70");
  eq(beat.keySemiOf("不是调"), 60, "★ 非法调名回落 C（不静默换调）");
  eq(beat.pitchNameOf(60), "C4", "音名：60 = C4");
  eq(beat.pitchNameOf(61), "C#4", "音名：61 = C#4");
  eq(beat.pitchNameOf(72), "C5", "音名：72 = C5");
  eq(beat.pitchNameOf(58), "A#3", "音名：58 = A#3（八度向下取整）");
  /* 简谱（C 调）：自然音级 + 八度点 + 升降号 */
  const C = beat.keySemiOf("C");
  eq(beat.jianpuOf(60, C), "1", "C 调 do = 1");
  eq(beat.jianpuOf(62, C), "2", "re = 2");
  eq(beat.jianpuOf(67, C), "5", "sol = 5");
  eq(beat.jianpuOf(69, C), "6", "la = 6（同八度，不带点）");
  eq(beat.jianpuOf(71, C), "7", "si = 7（半音差 11 单列，不得掉成 #6）");
  eq(beat.jianpuOf(72, C), "1'", "★ 高八度 = 1'");
  eq(beat.jianpuOf(57, C), "6,", "★ 低八度的 la = 6,（A3=57 落在 C3–B3 那一档：d=−3 → rel 9、oct −1）");
  eq(beat.jianpuOf(59, C), "7,", "低八度的 si = 7,（B3=59：d=−1 → rel 11、oct −1）");
  eq(beat.jianpuOf(61, C), "#1", "升半音 = #1（升号制）");
  eq(beat.jianpuOf(66, C), "#4", "66 = #4");
  eq(beat.jianpuOf(70, C), "#6", "70（b7 同音）统一显示 #6（确定性优先）");
  /* 简谱（G 调）：首调折算——G4=67 是 do */
  const G = beat.keySemiOf("G");
  eq(beat.jianpuOf(67, G), "1", "G 调 do = G4");
  eq(beat.jianpuOf(62, G), "5,", "★ G 调下方纯五度（D4=62）= 低八度 sol = 5,（首调，不是音名的 D）");
  eq(beat.jianpuOf(74, G), "5", "G 调 D5=74 = sol（同一八度内）");
  eq(beat.jianpuOf(81, G), "2'", "G 调 A5=81 = 高八度 re");
  /* 双渲染收口 */
  eq(beat.pitchTextOf(67, "jp", ""), "5", "pitchTextOf jp = 简谱");
  eq(beat.pitchTextOf(67, "nm", ""), "G4", "pitchTextOf nm = 音名（不读调主）");
  eq(beat.pitchTextOf(67, "off", ""), "5", "pitchTextOf 其余档按 jp（编辑轨 off 时的显示口径）");
}

/* ============ T222b：贴词后缀解析（终止规则 / 数字歌词保护 / 双写法） ============ */
section("T222b parseLyricTextPitch · 后缀紧跟字 + 止于空白/串尾");
{
  const { beat } = loadApp();
  const C = beat.keySemiOf("C");
  eq(JSON.stringify(beat.parseLyricTextPitch("我5 多6 想1'", C)),
    JSON.stringify([{ ch: "我", p: 67 }, { ch: "多", p: 69 }, { ch: "想", p: 72 }]),
    "★★ 空格分隔的「我5 多6 想1'」→ 三字各带 p（67/69/72）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我多", C)),
    JSON.stringify([{ ch: "我" }, { ch: "多" }]),
    "★ 纯文字与旧口径逐位一致：两字、无 p 字段");
  eq(JSON.stringify(beat.parseLyricTextPitch("想你的365天", C)),
    JSON.stringify([{ ch: "想" }, { ch: "你" }, { ch: "的" }, { ch: "3" }, { ch: "6" }, { ch: "5" }, { ch: "天" }]),
    "★★★ 数字歌词保护：「365」不被吃成音高（3 后面跟着 6、不是空白——终止规则的意义）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我5多6", C)),
    JSON.stringify([{ ch: "我" }, { ch: "5" }, { ch: "多" }, { ch: "6" }]),
    "★ 不带空格的「我5多6」不解析（5/6 成为独立字，所见即所得）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我#1' 啊", C)),
    JSON.stringify([{ ch: "我", p: 73 }, { ch: "啊" }]),
    "★ 记号前置写法 #1' 也认（= 1#' = 73）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我b7 你", C)),
    JSON.stringify([{ ch: "我", p: 70 }, { ch: "你" }]),
    "★ b7 = 降七级（C 调 70，与 #6 同音异名）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我9 你0", C)),
    JSON.stringify([{ ch: "我" }, { ch: "9" }, { ch: "你" }, { ch: "0" }]),
    "★ 8/9/0 不是度数 → 成为普通字（不炸、不静默吞）");
  eq(JSON.stringify(beat.matchPitchSuffix("我1'''", 1, C)),
    JSON.stringify({ len: 4, p: 96 }), "1''' = 96 恰好压在 PITCH_MAX 上，合法");
  eq(beat.matchPitchSuffix("我1''''", 1, C), null,
    "★ 越出 PITCH_MAX(96) 的后缀整体无效（1'''' = 108 → 该 token 退回普通字）");
  eq(JSON.stringify(beat.parseLyricTextPitch("我1''", C)),
    JSON.stringify([{ ch: "我", p: 84 }]),
    "1'' = +2 八度 = 84，仍在域内");
}

/* ============ T222c：normLyricLine 的 p 域校验（脏值静默降级） ============ */
section("T222c normLyricLine · p 域校验：合法保留 / 越界与非整数剥离 / 旧数据零变化");
{
  const app = fixture();
  const { beat, id, uid } = app;
  beat.Store.upsertLyric(id, uid, [
    { t: 0, dur: 24, ch: "一", p: 60 }, { t: 24, dur: 24, ch: "二", p: 999 },
    { t: 48, dur: 24, ch: "三", p: 60.5 }, { t: 72, dur: 24, ch: "四" }]);
  const cs = chars(beat, id, uid);
  eq(cs[0].p, 60, "★ 合法 p 保留");
  ok(cs[1].p === undefined, "★ 越界（999 > PITCH_MAX）静默剥离——字还在、谱没了（同 dir 口径）");
  ok(cs[2].p === undefined, "★ 非整数（60.5）剥离");
  ok(cs[3].p === undefined, "无 p 字段照旧（旧数据零迁移）");
  eq(JSON.stringify(cs[3]), '{"t":72,"dur":24,"ch":"四"}',
    "★★ 无 p 的字序列化形状与旧格式逐位一致（localStorage 存量零 churn）");
  beat.Arrange.close();
}

/* ============ T222d：贴词全链路（distribute → 落库 → 回填 round-trip） ============ */
section("T222d distribute 全链路 · 带后缀落库带 p / 纯文字零变化 / 回填一进一出");
{
  const app = fixture();
  const { beat, els, id, uid } = app;
  paste(els, "我5 多6 想1' 去");
  const cs = chars(beat, id, uid);
  eq(cs.length, 4, "四个字落库（后缀被吃、不是八颗）");
  eq(cs[0].ch + ":" + cs[0].p, "我:67", "★ 我5 → p=67");
  eq(cs[2].ch + ":" + cs[2].p, "想:72", "★ 想1' → p=72（高八度）");
  ok(cs[3].p === undefined, "「去」不带后缀 → 无 p（两法混用自由）");
  /* 回填 round-trip：prefill 用 jianpuOf 序列化、空格分隔（任一字带 p 即整句空格分隔） */
  eq(byCls(lyOf(els, 0), "arg-lyric-paste").value, "我5 多6 想1' 去",
    "★★ 回填 = 字 + 简谱后缀、空格分隔（与解析器一进一出同一套写法）");
  paste(els, byCls(lyOf(els, 0), "arg-lyric-paste").value);   // 回填原样再贴一遍
  eq(JSON.stringify(chars(beat, id, uid)), JSON.stringify(cs),
    "★★ round-trip 逐位幂等（回填文本再贴一遍 = 原数据）");
  /* 纯文字口径：无 p 时回填不空格分隔（与 v2 时代逐位一致） */
  paste(els, "我多想去");
  const cs2 = chars(beat, id, uid);
  eq(byCls(lyOf(els, 0), "arg-lyric-paste").value, "我多想去", "无音高的回填不加空格（旧行为不变）");
  ok(cs2.every(c => c.p === undefined), "纯文字重贴 → p 全部消失（新文本是内容权威）");
  /* 保位重建带音高：改一个字，位置保留、p 保留 */
  paste(els, "我5 多6 想1' 去");
  paste(els, "我5 多6 想1' 啊");
  const cs3 = chars(beat, id, uid);
  eq(cs3[3].ch, "啊", "末字替换成功");
  eq(cs3[0].t + "/" + cs3[0].p, "0/67", "★★ 保位重建：换字不动已排位置，前字 p 原样保留");
  beat.Arrange.close();
}

/* ============ T222e：p 全链路保真（换位/平移/对齐/打轴/拖动快照/编辑轨渲染） ============ */
section("T222e p 保真 · 重建 chars 的各条路径都把音高原样带过去");
{
  const app = fixture();
  const { beat, els, id, uid, arr } = app;
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一", p: 60 }, { t: 48, dur: 24, ch: "二", p: 64 }]);

  /* ⑦ 编辑轨渲染恒显 + aria 恒带音高（先于打轴做：startTap 会关浮层回主视图） */
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");   // 收起再展开：按新词重渲染
  const chip0 = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[0];
  ok(chip0.getAttribute("aria-label").indexOf("音高") > 0, "★★ 字块 aria-label 恒带「音高」（读屏不依赖视觉开关）");
  const txt0 = chip0.children.find(c => /arg-lyric-char/.test(c.className));
  ok(!!(txt0.children || []).find(c => /arg-lyric-pit/.test(c.className)),
    "★ 编辑轨音高上标恒显（默认 off 档也显示——编辑面看得到数据）");

  /* ① swapChars：时序互换（下标位各留原字、t/dur 互换），p 跟字不跟时序位 */
  const sw = beat.Arrange.swapChars(chars(beat, id, uid), 0);
  eq(sw[0].ch + "@" + sw[0].t + ":" + sw[0].p, "一@48:60", "★ 换位①：「一」留在下标 0、拿走后字时序");
  eq(sw[1].ch + "@" + sw[1].t + ":" + sw[1].p, "二@0:64", "★ 换位②：p 跟字走（一仍带 60、二仍带 64）");

  /* ② shiftLyricChars：平移只动 t */
  const sh = beat.Arrange.shiftLyricChars(chars(beat, id, uid), 0, 24, 192);
  eq(sh[0].t, 24, "平移 +1 格");
  eq(sh[0].p, 60, "★ 平移后 p 原样");

  /* ③ alignLyricToRhythm：对齐只重排位置 */
  const sec = arr.sections[0];
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 48, ch: "一", p: 60 }, { t: 96, dur: 48, ch: "二", p: 67 }]);
  beat.Arrange.alignLyricToRhythm(arr, sec, beat.Store.findLyric(id, uid));
  const al = chars(beat, id, uid);
  ok(al.every(c => c.p === 60 || c.p === 67), "★ 对齐后 p 全员保留（位置被重排、谱没丢）");

  /* ④ 打轴快照（startTap）：漏带 p = 打一遍轴丢一遍谱 */
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一", p: 60 }, { t: 48, dur: 24, ch: "二", p: 64 }]);
  beat.Arrange.tapStart(arr, sec, beat.Store.findLyric(id, uid));
  const t1 = beat.Arrange.tapState();
  ok(!!t1, "前提：进入打轴态");
  ok(t1.chars[0].p === 60 && t1.chars[1].p === 64, "★★ 打轴快照带 p");
  beat.Arrange.tapEnd();

  /* ⑤ 拖动快照（activateDrag 的工作集）：源码钉——真拖拽的松手提交就是这份 map */
  ok(/chars: list\.map\([^;]*typeof x\.p === "number"/.test(html),
    "★ 拖动快照（activateDrag chars.map）显式带 p——源码钉（真拖拽路径由 smoke/人工验收）");
  /* ⑥ 键盘微调的提交 map 同理 */
  ok(/i === k \? \{ t, dur: c\.dur, ch: x\.ch, \.\.\.\(typeof c\.p === "number" \? \{ p: c\.p \} : \{\}\)/.test(html),
    "★ 键盘微调提交 map 显式带 p（moveChipKey）");
  beat.Arrange.close();
}

/* ============ T222f：设置三态（默认关 / 切换 / 持久化 / 随歌词开关显隐） ============ */
section("T222f 设置三态 · 默认 off / 点按切换 / 进热键载荷 / 歌词关时整组收起");
{
  const app = fixture();
  const { beat, els } = app;
  eq(beat.Store.S.pitchNotation, "off", "★ 默认 off（不带音高的老用户画面逐位不变）");
  const grp = els["pitchNotationGroup"];
  eq(grp.hidden, false, "前提：歌词开着 ⇒ 音高组可见");
  const pill = name => (grp.children || []).find(b => b.dataset && b.dataset.pn === name);
  ok(!!pill("jp") && !!pill("nm"), "三枚胶囊齐备（off/jp/nm）");
  pill("jp").fire("click");
  eq(beat.Store.S.pitchNotation, "jp", "★ 点「简谱」→ S.pitchNotation = jp");
  ok(pill("jp").classList.contains("active"), "按压态同步（.active）");
  pill("nm").fire("click");
  eq(beat.Store.S.pitchNotation, "nm", "★ 点「音名」→ nm");
  /* 持久化：热键载荷（beatsight.state）带上 pitchNotation（persist 是防抖的，用 flush 立即落盘） */
  beat.Store.flush();
  eq(JSON.parse(app.storage.get("beatsight.state")).pitchNotation, "nm",
    "★★ 热键载荷带 pitchNotation（显示偏好跟热键走）");
  /* 歌词关 ⇒ 音高组随位置组一起收起（syncAuxVisibility ④） */
  els["showLyricToggle"].fire("click");
  eq(grp.hidden, true, "★★ 显示歌词关 ⇒ 音高三态组整组收起");
}

/* ============ T222g：精修「音高」组按钮（±半音 / Shift 八度 / 清除 / 守卫） ============ */
section("T222g 音高按钮 · 无 p 从调主起 / ±半音 / Shift=八度 / 清除 / 无选中守卫");
{
  const app = fixture();
  const { beat, els, fireWin, id, uid } = app;
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一" }, { t: 48, dur: 24, ch: "二", p: 60 }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");   // 收起再展开：按新词重渲染
  const upBtn = () => miniByAria(lyOf(els, 0), "音高升半音");
  const dnBtn = () => miniByAria(lyOf(els, 0), "音高降半音");
  const clrBtn = () => miniByAria(lyOf(els, 0), "清除选中字的音高标注");
  ok(!!upBtn() && !!dnBtn() && !!clrBtn(), "三颗音高按钮在（升/降/清除）");

  /* 无选中：announce 指路、不落库 */
  const before = JSON.stringify(chars(beat, id, uid));
  upBtn().fire("click");
  eq(JSON.stringify(chars(beat, id, uid)), before, "无选中：数据不动");
  ok((els["srAnnounce"].textContent || "").indexOf("先点按选中") === 0, "无选中：announce 指路");

  /* 选中第一颗（无 p）：+ 从调主起（C=60） */
  const sel0 = () => { const c = chipsOf(byCls(lyOf(els, 0), "arg-lyric-lane"))[0];
    c.fire("pointerdown", { clientX: 100 }); fireWin("pointerup", {}); };
  sel0();
  upBtn().fire("click");
  eq(chars(beat, id, uid)[0].p, 60, "★ 无音高的字 + 从调主起（C4=60）");
  eq(chars(beat, id, uid)[1].p, 60, "★ 邻字 p 不受影响（整行保真）");
  ok((els["srAnnounce"].textContent || "").indexOf("「一」音高 1") >= 0, "announce 报简谱结果");

  /* ± 半音；Shift = ±12 */
  upBtn().fire("click");
  eq(chars(beat, id, uid)[0].p, 61, "再 + 半音 → 61");
  upBtn().fire("click", { shiftKey: true });
  eq(chars(beat, id, uid)[0].p, 73, "★ Shift 点按 = +12（八度）");
  dnBtn().fire("click");
  eq(chars(beat, id, uid)[0].p, 72, "− 半音 → 72");

  /* 越界守卫：把音高顶到 PITCH_MAX 再 + ⇒ 不落库、announce 报到头 */
  beat.Store.upsertLyric(id, uid, [{ t: 0, dur: 24, ch: "一", p: 96 }, { t: 48, dur: 24, ch: "二", p: 60 }]);
  sumOf(lyOf(els, 0)).fire("click"); sumOf(lyOf(els, 0)).fire("click");
  sel0();
  const beforeEdge = JSON.stringify(chars(beat, id, uid));
  upBtn().fire("click", { shiftKey: true });
  eq(JSON.stringify(chars(beat, id, uid)), beforeEdge, "★ 越出 PITCH_MAX：不落库");
  ok((els["srAnnounce"].textContent || "").indexOf("到头") > 0, "越界：announce 报到头");

  /* 清除：回到纯词；再次清除 → announce 说明本来就没有 */
  clrBtn().fire("click");
  ok(chars(beat, id, uid)[0].p === undefined, "★ 清除 → p 摘除（序列化回到纯词形状）");
  eq(JSON.stringify(chars(beat, id, uid)[0]), '{"t":0,"dur":24,"ch":"一"}',
    "★ 清除后的序列化形状 = 旧格式（存量数据零 churn）");
  clrBtn().fire("click");
  ok((els["srAnnounce"].textContent || "").indexOf("本来就没有") > 0, "再清除：announce 说明无变化");
  beat.Arrange.close();
}

/* ============ T222h：练习视图三态渲染（off 不画 / jp 简谱 / nm 音名） ============ */
section("T222h 练习视图三态 · 字 span 内上标随开关换写法 / off 不画");
{
  /* t60 同款种子：BUILTINS[1]（四分基础 4/4）× 1 = 4 小节 = 768t；曲式模式 + 4 行档 */
  const BL = { ref: { type: "builtin", idx: 1 }, repeats: 1 };
  const app = loadApp({
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [
      { id: "t1", name: "旋律曲", sections: [{ uid: "s1", name: "主歌", blocks: [BL] }] }] }),
    "beatsight.state": JSON.stringify({ v: 3, bpm: 240, playMode: "arrange", vizRows: 4,
      arrangeSel: { id: "t1", from: 0, to: 0, loop: true } }),
  });
  const { beat, els } = app;
  beat.Store.upsertLyric("t1", "s1", [{ t: 0, dur: 96, ch: "一", p: 67 }]);
  const laneChips = () => {
    const rows = els["lyricLane"].children.filter(c => /(^| )lyric-row( |$)/.test(c.className));
    return Array.prototype.concat.apply([], rows.map(r =>
      (r.children || []).filter(c => /(^| )lyric-chip( |$)/.test(c.className))));
  };
  const pitOf = chip => {
    const label = (chip.children || []).find(c => /lyric-char/.test(c.className));
    return label ? (label.children || []).find(c => /lyric-pit/.test(c.className)) : null;
  };

  beat.Store.S.pitchNotation = "jp";
  beat.Viz.buildLyricLane();
  ok(laneChips().length > 0, "前提：主视图歌词字块在（曲式模式）");
  ok(laneChips().some(c => { const q = pitOf(c); return q && q.textContent === "5"; }),
    "★ jp 档：字 span 内上标 = 简谱「5」");

  beat.Store.S.pitchNotation = "nm";
  beat.Viz.buildLyricLane();
  ok(laneChips().some(c => { const q = pitOf(c); return q && q.textContent === "G4"; }),
    "★ nm 档：同一份 p=67 显示成音名 G4（存储始终是半音整数）");

  beat.Store.S.pitchNotation = "off";
  beat.Viz.buildLyricLane();
  ok(!laneChips().some(c => pitOf(c)), "★★ off 档：不画上标（默认态，老用户画面）");
  ok(beat.pitchTextOf(67, "jp", "") === "5", "前提自检：67 在 C 调 = 5（上面两条的换算依据）");
}
