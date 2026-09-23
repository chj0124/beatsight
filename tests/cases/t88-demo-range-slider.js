/* BeatSight 自动化测试 · 侧栏「播放范围」双滑块（v2.10.4）
   T88 系列。
   ---------------------------------------------------------------------------
   来源（用户提案）：「自定义」区里那 10 颗段号胶囊换成**滑块**，
   「用户自由拉动滑块选取想要的范围」。

   为什么这是一次**能力升级**而不是单纯的样式整理（本组的立论）：
     `Arrange.jumpTo` 里写着 `S.arrangeSel.from = k; S.arrangeSel.to = k;` ——
     两个字段被写死成同一个值，所以 10 颗胶囊只能表达 10 种状态（"只循环某一段"）；
     而 `S.arrangeSel = {id, from, to, loop, byLyric}` 本来就支持任意区间
     （10 段 = 55 种）。滑块用 **1 个控件**把这 55 种全部解锁，且不随段数增长。

   本组钉住的契约（v2.10.7 起滑块按**小节**调节，原为按段）：
     · 数值域用 **1-based 小节号**（min=1 / max=总小节数），与内部 0-based from/to 差 1，
       换算只发生在 onRangeInput 与 syncDemoRange 两处；
     · **起点不得越过终点**（反之亦然）：越过时把对方一起顶走 ——
       "两个 thumb 拖到重合"因此自然表达"只循环这一段"；
     · **input / change 两级**：input（拖动中）只刷视觉与 S，change（松手提交）才调
       Arrange.setRange 跑重活（refreshBar + 停播时重建网格）。只发 input **不得**改模式；
     · **滑块表达范围，不表达播放位置**：播放期间两个 thumb 必须纹丝不动；
     · 重合时两个 thumb 的叠层顺序按"哪边还有移动余地"翻转，否则有一侧永远拖不动。

   ★ 拖动一律按**单拇指**模拟（一次只动一个），因为真实拖动就是这样：
     写成一个"同时设两个值"的辅助会把方向性弄混——先设谁，谁就会把对方顶走。
   ★ 元素定位：沙箱 stub 不解析 HTML，动态生成的节点只能按类名 + children 序位取；
     且**每次操作后都要重新取**——setRange 在停播时会经 applyPatternChange →
     buildPresetList 重建整张列表（连带滑块），旧引用指向已脱离文档的节点。 */
"use strict";
const { loadApp, FakeAudioContext, driveFrames, ok, eq, near, section } = require("../lib/harness");

const seedState = obj => ({ "beatsight.state": JSON.stringify(obj) });
/* 与 t68 的 loadDemo 同一口径：harness 默认把"示例已出"的闩落上，
   要真的载入示例曲必须显式 seedDemo:false */
const loadDemo = () => loadApp(seedState({ sel: { type: "builtin", idx: 1 } }), { seedDemo: false });

/* 曲式容器 → 范围控件 → 轨道（每次现取，见文件头） */
const boxOf = els => els["presetList"].children.find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const wrapOf = els => boxOf(els).children.find(x => /(^| )demo-range( |$)/.test(x.className));
const noteOf = els => wrapOf(els).children[0];
const trackOf = els => wrapOf(els).children[1];
const fillOf = els => trackOf(els).children[0];
const fromOf = els => trackOf(els).children[1];
const toOf = els => trackOf(els).children[2];
/* 整首连播那一行的状态说明（它兼着"现在播到第几小节"的职责，见 syncDemoRange） */
const playNoteOf = els => boxOf(els).children[0].children[1];
const playAllOf = els => boxOf(els).children[0].children[0];

/* 单拇指拖动：走完 input（拖动中，只刷视觉）+ change（松手提交，跑重活并通知 Arrange）两级。
   真实浏览器就是这个顺序。commit=false 可只发 input，用于钉住"只拖不提交不生效" */
const setFrom = (els, v, commit) => {
  const e = fromOf(els); e.value = String(v); e.fire("input");
  if (commit !== false) e.fire("change");
};
const setTo = (els, v, commit) => {
  const e = toOf(els); e.value = String(v); e.fire("input");
  if (commit !== false) e.fire("change");
};
/* 便捷双拇指：**先定终点再定起点**——起点往右走会把终点顶走，反过来不动 */
const dragRange = (els, f, t, commit) => { setTo(els, t, commit); setFrom(els, f, commit); };

/* ================= 场景 T88a：控件形状与取值域 ================= */
section("T88a 范围滑块 · 控件形状（两个原生 range 叠层 + 填充条 + 读数）与 1-based 取值域");
{
  const { beat, els } = loadDemo();
  const wrap = wrapOf(els);
  ok(!!wrap, "★ 自定义区里有 .demo-range 容器");
  eq(wrap.children.length, 2, "容器里恰好两个孩子：读数 + 轨道");
  eq(noteOf(els).className, "demo-range-note", "第 1 个 = 读数行");
  eq(trackOf(els).className, "demo-range-track", "第 2 个 = 轨道");
  eq(trackOf(els).children.length, 3 + 9,
     "轨道 = 填充条 + 起点 + 终点 + 9 条段边界刻度线（v2.10.7：每段起点一条，最左的段 0 不画）");
  const ticks = trackOf(els).children.slice(3);
  ok(ticks.length === 9 && ticks.every(t => t.className === "demo-range-tick"
     && t.getAttribute("aria-hidden") === "true"),
     "★ 刻度线 = .demo-range-tick × 9（纯装饰 aria-hidden，段名在读数/valuetext 里）");
  near(parseFloat(ticks[0].style.left), 1 / 29 * 100, 1e-6,
     "★ 第 1 条刻度线 = 段 1 起点（0-based 小节 1 → 1/29）");
  eq(fillOf(els).className, "demo-range-fill", "第 1 个 = 区间填充条");
  ok(/(^| )demo-range-from( |$)/.test(fromOf(els).className), "第 2 个 = 起点滑块");
  ok(/(^| )demo-range-to( |$)/.test(toOf(els).className), "第 3 个 = 终点滑块");
  /* 原生 range：自带键盘（方向键）与读屏语义，不必自绘一整套 role=slider */
  eq(fromOf(els).type, "range", "起点是原生 input[type=range]");
  eq(toOf(els).type, "range", "终点是原生 input[type=range]");
  eq([fromOf(els).min, fromOf(els).max, fromOf(els).step].join(","), "1,30,1",
     "★ 取值域 = 1-based 小节号（《在他乡》30 小节 → 1..30，步长 1）");
  eq([toOf(els).min, toOf(els).max].join(","), "1,30", "终点同域");
  /* 一类名同时承担"提高特异性"的职责：全局 input[type=range] 与观测台主题都会命中这两个
     input，少了这一级会把 height 压回 4px（见 CSS 注释） */
  ok(/(^| )demo-range-input( |$)/.test(fromOf(els).className),
     "两个滑块都带 .demo-range-input（CSS 靠它压过全局与主题规则）");
  eq(beat.Store.S.arrangeSel.from, 0, "初始 from 仍是 0-based 的 0");
  eq(fromOf(els).value, "1", "滑块上显示为 1（1-based）");
  eq(trackOf(els).getAttribute("role"), "group", "轨道是控件组（与其余控件组同契约）");
}

/* ================= 场景 T88b：拖出区间 = 任意 from/to ================= */
section("T88b 拖动 → S.arrangeSel 拿到任意区间（不再是原来的 from === to）");
{
  const { beat, els } = loadDemo();
  dragRange(els, 3, 7);
  eq(beat.Store.S.arrangeSel.from, 2, "★ from = 3 - 1 = 2（1-based → 0-based 换算）");
  eq(beat.Store.S.arrangeSel.to, 6, "★ to = 7 - 1 = 6");
  eq(beat.Store.S.arrangeSel.id, beat.DEMO_ID, "范围归属这条曲式");
  eq(beat.Store.S.arrangeSel.loop, true, "拖出范围恒开循环（同 jumpTo / playArrange 的口径）");
  eq(beat.Store.S.arrangeSel.byLyric, false, "手动拖范围 = 普通区间语义，不是歌词行循环");
  eq(beat.Store.S.playMode, "arrange", "★ 拖滑块即进入曲式模式（与旧的'点段号'同语义）");
  /* 这是本方案相对旧胶囊的**能力增量**：旧实现永远拿不到 from ≠ to */
  ok(beat.Store.S.arrangeSel.from !== beat.Store.S.arrangeSel.to,
     "★★ 拿到了一个真正的区间（旧段序条只能 from === to，10 段只有 10 种状态）");
  eq([fromOf(els).value, toOf(els).value].join(","), "3,7", "两个 thumb 停在拖到的位置");
}

/* ================= 场景 T88c：双向钳制 ================= */
section("T88c 钳制 · 起点不得越过终点，反之亦然（越过时把对方一起顶走）");
{
  const { beat, els } = loadDemo();
  /* 起点往右拖过头 → 终点被顶到起点处，退化成"只循环这一段"而不是 from > to 的空区间 */
  dragRange(els, 3, 7);
  setFrom(els, 8);
  eq([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to].join(","), "7,7",
     "★ 起点越过终点 → 终点被顶到起点（from === to，不是反向的空区间）");
  eq([fromOf(els).value, toOf(els).value].join(","), "8,8", "两个 thumb 都停在 8（重合）");
  /* 反方向：终点往左拖过头 → 起点被拉到终点处 */
  dragRange(els, 6, 8);
  setTo(els, 2);
  eq([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to].join(","), "1,1",
     "★ 终点越过起点 → 起点被拉到终点");
  eq([fromOf(els).value, toOf(els).value].join(","), "2,2", "两个 thumb 都停在 2（重合）");
  /* 脏值（非数字）不得把区间带进 NaN —— 那会让调度器算出 NaN 时刻 */
  const fe = fromOf(els);
  fe.value = "abc"; fe.fire("input"); fe.fire("change");
  ok(Number.isFinite(beat.Store.S.arrangeSel.from) && Number.isFinite(beat.Store.S.arrangeSel.to),
     "★ 脏值（非数字）回退到合法小节号，不进 NaN",
     "from=" + beat.Store.S.arrangeSel.from + " / to=" + beat.Store.S.arrangeSel.to);
  ok(beat.Store.S.arrangeSel.from >= 0 && beat.Store.S.arrangeSel.to <= 9,
     "★ 脏值回退后仍落在 [0, 总小节数-1] 内");
}

/* ================= 场景 T88d：input / change 两级 ================= */
section("T88d 两级契约 · 只发 input（拖动中）不得提交：不改模式、不跑重活");
{
  const { beat, els } = loadDemo();
  eq(beat.Store.S.playMode, "preset", "前提：初始是预设模式");
  /* 只走"拖动中"那一级：S 会被就地更新（视觉要跟手），但**模式不能切**、
     Arrange.setRange（重活）也不能跑 —— 一次拖动有几十个 input，
     每个都跑 applyPatternChange 就是"重活拖长主线程"，会吃掉音频排程窗口 */
  dragRange(els, 4, 6, false);
  eq(beat.Store.S.playMode, "preset", "★ 只发 input 不切模式（提交那一步才切）");
  eq([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to].join(","), "3,5",
     "拖动中 S 已就地更新（松手前视觉就要跟手）");
  eq(els["argNowMeta"].textContent, "", "拖动中不写主界面即时反馈（那是提交那一步的事）");
  /* 松手提交 → 模式切换 + 重活一起发生 */
  dragRange(els, 4, 6, true);
  eq(beat.Store.S.playMode, "arrange", "★ 松手提交后才切到曲式模式");
  ok(/第 4–6 小节/.test(els["argNowMeta"].textContent),
     "★ 提交后主界面那一行给出即时反馈（实际「" + els["argNowMeta"].textContent + "」）");
}

/* ================= 场景 T88e：重合 = 单段 ================= */
section("T88e 两个 thumb 重合 = 只循环这一段（旧段号胶囊那档语义没丢）");
{
  const { beat, els } = loadDemo();
  dragRange(els, 5, 5);
  eq([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to].join(","), "4,4",
     "★ 重合 → from === to，语义与旧「点段号只循环这一段」逐位等价");
  ok(/第 5 小节/.test(noteOf(els).textContent) && !/–/.test(noteOf(els).textContent),
     "★ 读数用单小节说法（单小节循环），不写「第 5–5 小节」（实际「" + noteOf(els).textContent + "」）");
  eq(beat.Store.S.playing, false, "定位不等于起播（用户按播放键才开始）");
  /* 停止态定位必须把网格换成那一段的型，否则只有字变、画面原地不动（v2.0.2 的结论）。
     v2.10.7 小节口径：滑块值 5 = 0-based 小节 4 = 段 2（副歌）→ 生效型 = 副歌扫弦 */
  ok(String(beat.activePattern().name).indexOf("副歌扫弦") >= 0,
     "★ 停止时定位：生效的型已换成第 5 小节所在段引用的那个（实际「" + beat.activePattern().name + "」）");
}

/* ================= 场景 T88f：读数与读屏文案 ================= */
section("T88f 段名翻译 · 轨道放不下段名，靠读数行与 aria-valuetext 承担");
{
  const { els } = loadDemo();
  /* v2.10.7 小节口径：0-based 小节 4..19 = 段 2（副歌）→ 段 6（桥段），
     即 1-based 滑块值 5..20——两端落在两个**不同**段名上，段名翻译断言才有区分度 */
  dragRange(els, 5, 20);
  ok(/第 5–20 小节/.test(noteOf(els).textContent),
     "读数给出区间（实际「" + noteOf(els).textContent + "」）");
  ok(/副歌/.test(noteOf(els).textContent) && /桥段/.test(noteOf(els).textContent),
     "★ 区间两端翻译成段名（副歌 → 桥段），轨道上放不下段名（实际「" + noteOf(els).textContent + "」）");
  ok(/\d+ 小节/.test(noteOf(els).textContent),
     "读数给出该区间的总小节数（与编排面板 argRangeRow 同一口径，实际「" + noteOf(els).textContent + "」）");
  ok(/第 5 小节/.test(String(fromOf(els).getAttribute("aria-valuetext"))), "★ 起点滑块报小节号");
  ok(/副歌/.test(String(fromOf(els).getAttribute("aria-valuetext"))),
     "★ 并且带上段名（aria-valuenow 只能报数字，段名要靠 valuetext）");
  ok(/第 20 小节/.test(String(toOf(els).getAttribute("aria-valuetext"))), "终点滑块同样报小节号");
  ok(/起点/.test(String(fromOf(els).getAttribute("aria-label")))
     && /终点/.test(String(toOf(els).getAttribute("aria-label"))),
     "两个滑块的 aria-label 区分「起点 / 终点」（读屏才能分清两个 thumb）");
}

/* ================= 场景 T88g：填充条几何与叠层顺序 ================= */
section("T88g 填充条几何（百分比）+ 重合时 thumb 叠层顺序翻转");
{
  const { els } = loadDemo();
  /* 30 小节 → 29 个间隔，第 i 小节的百分比位置 = i/29×100。
     ★ 用 near 而不是 eq：填充宽度算的是 `pct(t) - pct(f)`（两个百分比相减），
       与 `(t-f)/29*100` 在浮点末位上必然不同。这类"算法等价、末位不同"的断言写 eq
       就是在给自己制造假红 */
  const pctOf = el => parseFloat(el.style.width) || 0;
  const leftOf = el => parseFloat(el.style.left) || 0;
  dragRange(els, 3, 7);
  near(leftOf(fillOf(els)), 2 / 29 * 100, 1e-6, "★ 填充条左端 = 第 3 小节的位置（2/29）");
  near(pctOf(fillOf(els)), 4 / 29 * 100, 1e-6, "★ 填充条宽度 = 第 3–7 小节（覆盖 2..6，宽 4/29）");
  dragRange(els, 1, 30);
  eq([fillOf(els).style.left, fillOf(els).style.width].join("|"), "0%|100%", "★ 整首 → 填充条拉满");
  /* 单段 + 就在最左：起点已无法再左移，必须让**终点**在上层，否则这一侧永远拖不动 */
  dragRange(els, 1, 1);
  eq(fromOf(els).style.zIndex, "2", "★ 重合在最左时起点在下层（它已无移动余地）");
  eq(toOf(els).style.zIndex, "3", "★ 终点在上层（还能往右扩）");
  /* 其余重合情形（含最右）：起点在上层，还能往左扩 */
  dragRange(els, 30, 30);
  eq(fromOf(els).style.zIndex, "3", "★ 重合在最右时起点在上层（还能往左扩）");
  eq(toOf(els).style.zIndex, "2", "★ 终点在下层（它已无移动余地）");
}

/* ================= 场景 T88h：滑块不跟播放位置走 ================= */
section("T88h 滑块表达范围而非位置 · 播放期间两个 thumb 纹丝不动");
{
  const { beat, els } = loadDemo();
  dragRange(els, 2, 9);
  const before = [fromOf(els).value, toOf(els).value].join(",");
  beat.Controls.setBpm(240);
  beat.Controls.start();
  driveFrames(FakeAudioContext.last, beat, 2.2);          // 240BPM：2.2s ≈ 2 小节
  eq([fromOf(els).value, toOf(els).value].join(","), before,
     "★★ 播放推进后滑块位置一位不变（滑块自己会走是这类控件最常见的实现错误）");
  eq([beat.Store.S.arrangeSel.from, beat.Store.S.arrangeSel.to].join(","), "1,8",
     "范围字段也没被播放游标改写");
  /* 位置信息改由"整首连播"那一行的状态说明承担（段序条高亮没了，只剩它） */
  ok(/播放中 · 第 \d+\/30 小节/.test(playNoteOf(els).textContent),
     "★ 位置读数落在状态说明上（实际「" + playNoteOf(els).textContent + "」）");
  beat.Controls.stop();
}

/* ================= 场景 T88i：越界范围按当前曲式收窄 ================= */
section("T88i 越界范围 · 呈现时按当前段数收窄（使用期钳制）");
{
  const { beat, els } = loadDemo();
  /* 持久数据里的 to 指向不存在的段（脏数据 / 换了更短的曲式）：
     Store 加载期只做绝对域钳制，真正按总小节数收窄是使用期（syncDemoRange）的事 */
  beat.Store.S.arrangeSel.from = 0;
  beat.Store.S.arrangeSel.to = 99;
  beat.Presets.syncDemoRange();
  eq(toOf(els).value, "30", "★ 越界的 to 在呈现时收窄到末小节（第 30 小节，不写出一个不存在的小节号）");
  eq(fromOf(els).value, "1", "起点照常");
  /* 反向的脏区间（from > to）同样要在呈现时归一 —— 否则填充条宽度会是负数 */
  beat.Store.S.arrangeSel.from = 8;
  beat.Store.S.arrangeSel.to = 2;
  beat.Presets.syncDemoRange();
  eq([fromOf(els).value, toOf(els).value].join(","), "9,9", "★ 反向区间归一后呈现（to 被抬到 from）");
  eq(fillOf(els).style.width, "0%", "填充条宽度不为负");
}

/* ================= 场景 T88j：与「整首连播」的一致性 ================= */
section("T88j 「整首连播」按钮的高亮与滑块范围同源（同一份 arrangeSel 推出来的两个视图）");
{
  const { beat, els } = loadDemo();
  eq(playAllOf(els).getAttribute("aria-pressed"), "false", "前提：初始未高亮");
  playAllOf(els).fire("click");
  eq(playAllOf(els).getAttribute("aria-pressed"), "true", "点整首连播 → 按钮高亮");
  eq([fromOf(els).value, toOf(els).value].join(","), "1,30", "★ 滑块同步拉满（范围 = 整首）");
  beat.Controls.stop();
  /* 拖成局部区间 → 按钮必须退出高亮（"整首"这一态的定义就是范围恰是整首） */
  dragRange(els, 2, 5);
  eq(playAllOf(els).getAttribute("aria-pressed"), "false",
     "★ 范围缩成局部后按钮退出高亮（两个视图同源，不会自相矛盾）");
  dragRange(els, 1, 30);
  eq(playAllOf(els).getAttribute("aria-pressed"), "true", "★ 拖回整首 → 按钮重新高亮");
}

/* ================= 场景 T88k：曲式消失后的悬空引用 ================= */
section("T88k 曲式被删 · 滑块与 sync 的守卫路径（不崩、不往已脱离文档的节点上写）");
{
  const { beat, els } = loadDemo();
  dragRange(els, 3, 7);
  ok(!!boxOf(els).children.find(x => /(^| )demo-range( |$)/.test(x.className)), "前提：滑块已渲染");
  /* 先测「元素引用还在、曲式已不在库里」——这条守卫（onRangeInput 里的 !a）只有
     不重建列表才走得到；若在这一步之前重建，第一道守卫就把它挡掉了 */
  beat.Store.deleteArrange(beat.DEMO_ID);
  const before = JSON.stringify(beat.Store.S.arrangeSel);
  const t0 = (() => { try{ setFrom(els, 4); return null; }catch(e){ return e.message; } })();
  eq(t0, null, "★ 曲式已不在库里时拖滑块静默返回（不抛）");
  eq(JSON.stringify(beat.Store.S.arrangeSel), before, "★ 也不写脏值（范围字段一位未动）");
  /* 再重建列表：滑块应当整体消失，且 sync 再被调用时静默跳过 */
  beat.Presets.buildPresetList();
  ok(!boxOf(els).children.some(x => /(^| )demo-range( |$)/.test(x.className)),
     "★ 曲式删掉后滑块不再渲染（不再有可点的悬空控件）");
  const t1 = (() => { try{ beat.Presets.syncDemoRange(); return null; }catch(e){ return e.message; } })();
  eq(t1, null, "★ 未渲染时 syncDemoRange 静默返回（列表重建先清空元素引用，见 buildPresetList 头部）");
}
