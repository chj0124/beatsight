/* BeatSight 自动化测试 · v3.30.0 控制卡片三列横向对齐 + 底栏贴跑道缘（T177 系列）
   ---------------------------------------------------------------------------
   来源（用户逐轮拍板 + 截图红线确认）：顶部控制卡片"视觉效果不佳、排版混乱"，
   底部三组"对齐跑道的边缘"。本轮把两件事一次做齐：

   ① **控制卡片三列横向对齐体系**——三列的内容行落在同三条水平线上：
        L1 = 音量「节拍」｜ BPM 步进行（-5 -1 96 +1 +5）｜ 开关「预备拍」
        L2 = 音量「扫弦」｜ BPM 滑杆 + TAP        ｜ 开关「静音拍」
        L3 = 音量「重拍增强」｜ BPM 快捷档 60..120   ｜ 开关「变速训练」
      真机实测中线（1440×900）：173.8 / 224.8 / 272.8。

   ② **底栏贴跑道缘**——底栏左块（型名胶囊）左缘 = 跑道/歌词行左缘（`.main` 内容缘），
      右块（进度条+状态灯）右缘 = 跑道右缘；两块等宽（--pb-side-w）。

   本组钉住的契约：
     · 音量行盒 40px 高、行距 10px（滑杆**粗细不变**：轨道 4 / 圆钮 16——用户明确要求）；
     · 音量列 tg-body 顶锚定距（flex-start + gap:10），开关列开合时音量行零位移；
     · 开关列 ≥900 档 padding-top 44px（对齐 BPM 步进行）、行距 7px；
     · 从属参数统一降级（.tr-inp 与「随机」开关）——作用域钉 .viz-toggles，设置弹窗不受影响；
     · 目标框占位文案「如 120」+ number 框 spin 按钮隐藏（否则占位被箭头挤掉一个字）；
     · ≤900 堆叠档 BPM 内容限宽 520px；
     · 卡片盒收窄 1048 且**控制网格逐像素不动**；
     · 底栏 padding 跟随主列（≥961 居中公式 / ≤960 16px / wide-full 24）、syncPbInset 退役；
     · 底栏范围读数：整首时 visibility:hidden、局部范围显示（D 案）。

   ★ 教训（本轮用户纪律）：UI 对齐类改动必须先量**参照物**（哪个元素的哪条边）。
     上一轮的"对齐"三易其稿，根因就是参照物从未被量化确认。 */
"use strict";
/* ★ v3.42.0 补（反向验证抓出的一处橡皮图章）：原先本文件**自己 fs.readFileSync(index.html)**，
   绕过了 harness 顶层的 `process.env.BEATSIGHT_HTML` ⇒ 本研究里所有 CSS 断言**天然免疫变异**
   （M67「拍数框恢复细线框」跑完 7730 PASS/0 FAIL，一条都不红）。改用 harness 导出的 html（同源同内容，
   只在对照/变异场景下指向别的构建）。 */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

const CSS = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");   // 剥块注释（防注释里的字面量骗过断言）

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }), { seedDemo: false });

/* ================= T177a：三列行心对齐的源码钉（几何在冒烟里量） ================= */
section("T177a 三列横向对齐体系（音量行盒 / 开关列偏移 / 行距）");
{
  ok(/\.viz-head-grid \.card-head-left \.vol-row\{min-height:40px\}/.test(CSS_CODE),
    "★★ 音量行盒 40px（行距由 space-between 的 43px 收到 10px；滑杆自身粗细不变）");
  ok(/\.viz-head-grid \.card-head-left \.group \.tg-body\{flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:10px\}/.test(CSS_CODE),
    "★★ 音量列顶锚定距（flex-start + gap:10px）——行心 172.8/222.8/272.8，"
    + "且开关列开合时顶锚不动（v3.22 单开零变形的承重墙从 .group 的 space-between 迁到这里）");
  ok(/\.viz-toggles \.tg-row\{display:flex;flex-direction:column;align-items:flex-start;gap:7px\}|\.core-pills\{display:flex;align-items:center;justify-content:center;gap:10px/.test(CSS_CODE),
    "★★ 控制芯（PLAN-v9 批 2）：开关 = 芯顶胶囊行（.core-pills 横排 gap 10）；v3.30.0 的纵排行距 7px 契约随开关列退役");
  /* ★ 控制芯重排：--tg-align-top/--tg-align-shift 补偿体系随开关列整列退役——
     胶囊行住芯顶、与滑杆塔同芯同轴，不再需要跨列对齐补偿。 */
  ok(!/--tg-align-top/.test(CSS_CODE) && !/--tg-align-shift/.test(CSS_CODE) && !/@container \(min-width:496px\)/.test(CSS_CODE),
    "★★ 控制芯：--tg-align-top/--tg-align-shift 补偿体系与 496 容器查询整列退役（胶囊行与滑杆塔同芯同轴，无跨列可补偿）");
  ok(!/@media \(min-width:900px\)\{[\s\S]{0,400}\.viz-head-grid \.viz-toggles\{padding-top:44px[^}]*\}[\s\S]{0,200}@media \(max-width:899/.test(CSS_CODE)
     || /@media \(max-width:899\.9px\)\{[\s\S]*?\.viz-head-grid \.viz-head > \.group \.tg-body\{max-width:520px\}/.test(CSS_CODE),
    "★★ ≤900 堆叠档：BPM 卡内容限宽 520px（否则步进钮/快捷档被拉成 ~150px/颗，平板实拍）");
  /* 堆叠档不得吃 44px 偏移（没有 BPM 列可对；且它是三列档的产物） */
  const stackBlock = /@media \(max-width:899\.9px\)\{([\s\S]*?)\n\}/.exec(CSS_CODE);
  ok(!stackBlock || !/padding-top:44px/.test(stackBlock[1]),
    "★★ 44px 偏移只属 ≥900 三列档——堆叠档若也吃，预备拍会凭空下坠半个块高");
}

/* ================= T177b：从属参数统一降级（层级：主开关 > 参数） ================= */
section("T177b 从属参数统一降级（拍数框 / 随机开关 / 目标框）");
{
  /* ★ v3.42.0 补（用户拍板）：拍数框**去掉细线框**（改由 hover/聚焦浅底提示可编辑）+ 内边距收紧省面积 */
  ok(/\.core-pills \.tr-inp\{width:20px;min-width:0;padding:1px 2px;font-size:12px;text-align:center;background:transparent;border:0/.test(CSS_CODE)   /* ★ min-width:0 必须跟着——基类 min-width:44px 不压就白改 */
     && /\.core-pills \.tr-inp:hover,\.core-pills \.tr-inp:focus\{background:rgba\(var\(--veil\),\.07\)\}/.test(CSS_CODE)
     && /\.tg-flyout \.tr-inp\{width:46px;padding:3px 6px;font-size:12px;text-align:center\}/.test(CSS_CODE),
    "★★ 拍数框/目标框降级（字号 13→12、拍数框内缩到胶囊内一格）且**拍数框无描边**（可编辑性由 hover/聚焦浅底承担）；"
    + "作用域从 .viz-toggles 换到 .core-pills / .tg-flyout（PLAN-v9 批 2，v3.42.0 去框）");
  ok(/\.tg-flyout #muteRandomToggle\{padding:4px 10px;font-size:12px\}/.test(CSS_CODE),
    "★★「随机」作为从属子开关同步降一级（与拍数框/目标框同一套规格，不是只降它一个）");
  /* 作用域纪律：设置弹窗里的同款 .tr-inp（壁纸遮罩 / 延迟补偿）不得被牵连 */
  ok(!/^\.tr-inp\{padding:4px/.test(CSS_CODE.replace(/\n/g, "")) && !/\}\.tr-inp\{padding:4px/.test(CSS_CODE.replace(/\n/g, "")),
    "★★ 降级作用域钉在芯内（.core-pills / .tg-flyout）——设置弹窗的同名控件（壁纸遮罩/延迟补偿）保持原规格");
  ok(/\.core-pills \.tr-inp::-webkit-inner-spin-button\{-webkit-appearance:none;margin:0\}/.test(CSS_CODE)
     && /\.tg-flyout \.tr-inp::-webkit-inner-spin-button\{-webkit-appearance:none;margin:0\}/.test(CSS_CODE),
    "★★ number 框 spin 按钮在芯内隐藏——桌面 Chrome 为它预留 ~14px，"
    + "占位「如 120」会被挤成「如 12」（实拍实证；方向键步进不受影响）");
}

/* ================= T177c：目标框占位文案（唯一一处标记改动） ================= */
section("T177c 目标 BPM 占位文案缩短（64px 框不再裁切）");
{
  ok(/id="trTarget"[^>]*placeholder="如 120"/.test(html),
    "★★ 占位「需大于当前 BPM」→「如 120」（原文案在 64px 框里三档视口全被裁成「需大…」）");
  ok(!/placeholder="需大于当前 BPM"/.test(html),
    "★ 旧占位文案已不存在（不是两处并存）");
  ok(/id="trTarget"[^>]*aria-label="目标 BPM，可留空表示不设目标"/.test(html),
    "★★ 读屏语义不变——缩短的只是占位，完整说明仍在 aria-label 里");
}

/* ================= T177d：卡片盒收窄（抱控制区、网格不动） ================= */
section("T177d 控制卡片盒收窄 1048（盒内两侧死空间消除）");
{
  ok(/section\.card\{width:1048px;max-width:100%;margin-inline:auto\}/.test(CSS_CODE),
    "★★ 卡片盒 1048 定宽 + margin 居中——1920 下盒内两侧死空间（实测 ~172px/侧）消除");
  /* 两个实现坑都得钉住：用 max-width/fit-content 收缩会把网格连带压窄（实测塌成 904 / 列 280）；
     justify-self 对块容器父级下的 section 无效。 */
  ok(!/section\.card\{[^}]*fit-content/.test(CSS_CODE) && !/section\.card\{[^}]*justify-self/.test(CSS_CODE),
    "★★ 收窄只允许 width 定宽 + margin-inline:auto——fit-content 会压塌网格、justify-self 对 section 无效");
  ok(/max-width:1000px/.test(CSS_CODE),
    "★★ 控制网格限宽 1000 不变（卡片收窄只动外壳，三列 312 与网格左右缘逐像素不动）");
}

/* ================= T177e：底栏贴跑道缘（一）CSS 公式 ================= */
section("T177e 底栏内容缘 = 跑道/歌词行盒缘（= .main 内容缘）");
{
  ok(/@media \(min-width:961px\)\{[\s\S]*?\.play-bar\{padding-left:max\(calc\(24px \+ env\(safe-area-inset-left, 0px\)\), calc\(\(100% - 1440px\) \/ 2 \+ 24px\)\)/.test(CSS_CODE),
    "★★★ ≥961：跟随主列居中（1440→24；1920→256.5=#viz 左缘，实测差 0）——"
    + "写死 24 会在宽屏上与跑道错开（用户实拍正是如此）");
  ok(/@media \(max-width:960px\)\{[\s\S]*?\.play-bar\{padding-left:calc\(16px \+ env\(safe-area-inset-left, 0px\)\);padding-right:calc\(16px \+ env\(safe-area-inset-right, 0px\)\)\}/.test(CSS_CODE),
    "★★ ≤960：16px，与同档 `.main{padding:16px}` 同源（此前底栏 24 vs 跑道 16，差 8px）");
  ok(/body\.wide-full \.play-bar\{padding-left:calc\(24px \+ env\(safe-area-inset-left, 0px\)\);padding-right:calc\(24px \+ env\(safe-area-inset-right, 0px\)\)\}/.test(CSS_CODE),
    "★★ 宽屏铺满档主列不限宽 → 跑道缘恒 24，整档覆盖（居中公式在该档会算成 264）");
  ok(!/--pb-inset-/.test(CSS_CODE) && !/(^|\W)var\(--pb-inset/.test(CSS_CODE),
    "★★★ syncPbInset 机制的 CSS var 消费已清（量测把参照物当成卡片网格缘，与跑道缘差 188.5px）");
}

/* ================= T177f：底栏贴跑道缘（二）机制退役 ================= */
section("T177f syncPbInset 量测机制整体退役（纯 CSS 公式替代）");
{
  const code = html.replace(/\/\*[\s\S]*?\*\//g, "");   // 剥注释：退役说明里保留了名字，不算残留
  ok(!/syncPbInset/.test(code),
    "★★★ 函数本体 / Viz API 导出 / boot 与 fonts.ready 调用 / resize 防抖调用全部清空");
  ok(/resizeTimer = setTimeout\(\(\) => \{ relayout\(\); \}, 200\)/.test(code),
    "★★ resize 防抖仍在（只摘掉 syncPbInset 那半——relayout 是几何重采的正体，不得连带删）");
  ok(!/Viz\.syncPbInset/.test(code),
    "★★ boot 双 rAF 与 fonts.ready 两处调用点已摘（否则 typeof 守卫虽不崩，但成了死代码）");
}

/* ================= T177g：底栏左右等宽 + 读数 D 案 ================= */
section("T177g 底栏左右块等宽 + 范围读数挪位/整首隐藏（D 案）");
{
  ok(/:root\{--pb-side-w:320px\}/.test(CSS_CODE),
    "★★ 共享宽度变量 --pb-side-w（左胶囊与右组同源，杜绝各自为政的宽度上限）");
  ok(/@media \(min-width:641px\)\{[\s\S]*?\.pb-ctx\{width:var\(--pb-side-w\)\}[\s\S]*?\.pb-right\{max-width:var\(--pb-side-w\)/.test(CSS_CODE),
    "★★ ≥641：左块宽度 = 右组上限 = 320（原 .pb-right 的 640 上限形同虚设，实测右组 ~523px）；"
    + "★ 措辞口径：钉的是**声明的目标宽度**，不是任意视口下的实测相等——641~1279 段右块"
    + "受三列栅格（1fr auto 1fr）约束会自然更短（实测 641→124 / 960→284 / 1280→320），"
    + "且**从不超过**左块，正是用户投诉的反方向；贴边与等宽在 ≥1280 逐像素成立（冒烟桌面档钉住）");
  ok(/\.pb-sub \.demo-range-note\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/.test(CSS_CODE),
    "★★ 读数行在 .pb-sub 内（行 1 让给轨道独占）——超长走省略号，不推挤状态灯");
  ok(/@media \(max-width:640px\)[\s\S]*?\.pb-sub \.demo-range-note\{display:none\}/.test(CSS_CODE),
    "★★ ≤640 读数隐藏规则同步改作用域（旧规则锚在 .pb-progress 下，挪位后已失对象）；"
    + "否则手机上它会跑出来跟状态灯挤同一行");
}

/* ================= T177h：读数整首隐藏的行为契约（运行时） ================= */
section("T177h 范围读数：整首隐藏 / 局部范围显示（占位隐藏，布局零跳动）");
{
  const { beat, els } = loadDemo();
  /* ★ 每次操作后必须**重新取**节点：拖动的 change 提交会走 applyPatternChange →
     buildPresetList 重建整张列表（连带滑块与读数行），旧引用指向已脱离文档的节点——
     对旧节点断言会读到"上一次的文案"而静默通过，正是 t88 文件头记过的坑。 */
  const noteNow = () => els["pbSub"].children.find(c => /(^| )demo-range-note( |$)/.test(c.className));
  const thumbsNow = () => {
    const wrap = els["pbProgress"].children.find(x => /(^| )demo-range( |$)/.test(x.className));
    const track = wrap.children[0];                    // v3.30.0：wrap 只剩轨道（读数已挪走）
    return [track.children[1], track.children[2]];
  };
  const drag = (f, t) => {
    const [fromEl, toEl] = thumbsNow();
    toEl.value = String(t); toEl.fire("input");        // 先终点后起点（起点右移会顶走终点）
    fromEl.value = String(f); fromEl.fire("input");
    toEl.fire("change"); fromEl.fire("change");
  };
  const sel = () => [beat.Store.S.arrangeSel.from + 1, beat.Store.S.arrangeSel.to + 1].join("–");

  const sub = els["pbSub"];
  ok(!!sub, "★★ 前提：.pb-sub 带 id（桩按 id 懒创建元素、无 querySelector——syncPbInset 当年踩过同一个坑）");
  eq(noteNow().className, "demo-range-note",
    "★★ 读数行是行 2 的运行时段（静态标记里没有它，由 buildDemoSongRow 挂入）");
  /* 默认态 = 整首范围（sel 默认整首），读数应当已隐藏 */
  eq(noteNow().style.visibility, "hidden",
    "★★★ 整首范围 → visibility:hidden（默认停机态 playMode 并非 arrange，"
    + "故判据只看 f===0 ∧ t===n-1，不看 playMode——否则默认态藏不掉）");
  eq(noteNow().style.display, "",
    "★★ 用 visibility 而非 display——占位隐藏则行 2 布局零跳动（状态灯位置恒定）");

  /* 拖成局部范围 → 读数出现 */
  drag(5, 20);
  eq(sel(), "5–20", "★ 前提复核：拖动确实生效（否则后面的读数断言是橡皮图章）");
  eq(noteNow().style.visibility, "",
    "★★★ 局部范围（第 5–20 小节）→ 读数显示（正是最需要它的时刻）");
  ok(/第 5–20 小节/.test(noteNow().textContent) && /共 16 小节/.test(noteNow().textContent),
    "★★ 读数文案自带区间与总数（与编排面板同一口径；实际「" + noteNow().textContent + "」）");

  /* 单小节循环也算"局部"——必须显示（重合是小节级精练最常用的一档） */
  drag(7, 7);
  eq(sel(), "7–7", "★ 前提复核：已拖到单小节");
  eq(noteNow().style.visibility, "",
    "★★ 单小节循环也显示——「f===0 ∧ t===n-1」才是隐藏的唯一条件");
  ok(/单小节循环/.test(noteNow().textContent),
    "★ 单小节说法保留（实际「" + noteNow().textContent + "」）");

  /* 拖回整首 → 再次隐藏（幂等，不是一次性初始化） */
  drag(1, 64);
  eq(sel(), "1–64", "★ 前提复核：已拖回整首");
  eq(noteNow().style.visibility, "hidden",
    "★★ 拖回整首 → 再次隐藏（每次 syncDemoRange 都重算，不是只在初始化时判一次）");
}

/* ================= T177i：读数行防累积（曲式列表重建不叠加） ================= */
section("T177i 读数行重建防累积（挂点换到 .pb-sub 后仍不叠加）");
{
  const { beat, els } = loadDemo();
  const sub = els["pbSub"];
  const notesOf = () => sub.children.filter(c => /(^| )demo-range-note( |$)/.test(c.className));
  eq(notesOf().length, 1,
    "★★★ 首次渲染后读数行只有一个——旧实现靠「清空 #pbProgress」顺带清掉读数，"
    + "挪到 .pb-sub（不参与该清空）后必须显式摘除（否则首屏就叠出两个）");
  /* 桩只把**带 id 的**静态节点收进 children（.status 壳无 id，故此处只计运行时挂入的），
     真机里 .pb-sub 同时住着读数与 .status 两个子节点——本断言钉的是"摘读数不误伤别人"。 */
  eq(sub.children.length, 1,
    "★★ 行 2 的运行时子节点只有读数行（摘旧读数不得误伤其他子节点）");
  const noteBefore = notesOf()[0];
  /* 触发一次真实的重建（换型 → applyPatternChange → buildPresetList → buildDemoSongRow） */
  beat.Presets.applyPatternChange(beat.activePattern() ? beat.Store.S.sel : beat.Store.S.sel);
  eq(notesOf().length, 1,
    "★★★ 重建后读数行仍只有一个（防累积靠「按类名扫描子节点」，不能靠 demoRangeNoteEl——"
    + "buildPresetList 在重建前就把它置 null 了，靠它摘除会静默失效）");
  ok(notesOf()[0] !== noteBefore,
    "★ 且确实是**新**节点（旧节点已被摘除；若相同说明新旧并存、按序位取到旧的那个）");
  eq(sub.children.length, 1,
    "★★ 重建后行 2 仍只有一个子节点（读数行），无残留");
}

/* ================= T177j：底栏三者的中线对齐（v3.30.1） ================= */
section("T177j 进度条轨道中线 = 胶囊中线 = 播放键中心（右块下移 11.5px）");
{
  const A = /@media \(min-width:641px\)\{([\s\S]*?)\n\}/.exec(CSS_CODE);
  ok(!!A, "★ 前提：≥641 档的规则块可定位（对齐只在该档生效）");
  const blk = A ? A[1] : "";
  ok(/\.pb-right\{max-width:var\(--pb-side-w\);position:relative;top:11\.5px\}/.test(blk),
    "★★★ 右块整体下移 11.5px —— (45−22)/2 = 11.5：右块两行纵排（轨道 22 + gap 5 + 状态 18 = 45），"
    + "整块居中时首行轨道天然高出 11.5px；下移后**轨道**（而非整块）成为居中基准");
  /* 为什么必须是相对偏移而非 margin/align-self：保留 grid 居中参与 ⇒ 与底栏高度无关，
     C 变化时块心 = 内容区心 恒成立（代数：轨道心 = 内容区心 − 11.5 + 11.5）。 */
  ok(!/align-self:start/.test(blk) && !/margin-top/.test(blk),
    "★★ 用 position:relative;top 而非 align-self:start + margin —— 前者保留 grid 居中参与，"
    + "对底栏任意高度恒成立；后者锚在栏顶，栏高一变就失准（v3.17/3.18 改过两次栏高）");
  /* ≤640 必须不吃这条：手机档右区改 flex-direction:row（轨道与状态并排），
     轨道中心天然 = 行中心，实测胶囊 972.3 = 轨道 972.3 已对齐；
     硬加 11.5px 会把已经齐的轨道推歪。 */
  /* ★ 抓取起点必须钉在 ≤640 底栏块**内部**的唯一标记上（`.play-bar{column-gap:10px}`）——
     全局有多个 `@media (max-width:640px){`（可视化渐隐遮罩等），从媒体查询头部起抓会把
     更早的 ≥641 块一起吞进捕获组，于是"≤640 不得含 top:11.5px"这条会**假红**（首跑即踩）。 */
  const mob = /\n  \.play-bar\{column-gap:10px\}([\s\S]*?)\n  \.play-btn/.exec(CSS_CODE);
  ok(!!mob, "★ 前提：≤640 底栏块可定位（抓取起点 = 该块内的唯一标记）");
  ok(!mob || !/top:11\.5px/.test(mob[1]),
    "★★★ ≤640 不吃该偏移 —— 手机档右区是 flex-direction:row（轨道与状态并排一行），"
    + "轨道中心天然 = 行中心（实测胶囊 972.3 = 轨道 972.3，本就没有 11.5px 错位）；"
    + "硬加会把已对齐的轨道推歪");
  /* 手机端三者同线在结构上不可行（实测取证）：播放键独占第一行（v3.18 定），
     压回单行会让右列塌到 45px、7 个元素溢出视口——正是 v3.17 修掉的旧 bug。 */
  ok(/@media \(max-width:640px\)\{[\s\S]*?#argJump\{grid-column:1 \/ -1;grid-row:1/.test(CSS_CODE),
    "★★ 手机档保持两行布局（播放键独占行 1）——这是 v3.17/v3.18 修掉「右列 6px、进度条溢出 66px 被裁」"
    + "后的既定结构；三者同线须压回单行 ⇒ 必然复现该 bug（实测 390 单行：右列 45px、7 元素溢出）");
}
