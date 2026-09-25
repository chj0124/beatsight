/* BeatSight 自动化测试 · 首次打开的默认状态（v2.13.0）
   T93 系列。
   ---------------------------------------------------------------------------
   用户提的四件事，在同一个地方钉死（分散在 T85 / T92 的是各自的机制，
   这一组是"新用户第一次双击打开，看到的就是这样"的**验收面**）：

     ① 预设库三分区：节拍**展开** / 扫弦收起 / 自定义**展开**
     ② 默认选中示例曲《在他乡》，**但绝不自动播放**（★ 本组最重的一条）
     ③ 同屏行数 4 行、拍号 4/4
     ④ 一张出厂默认背景壁纸（出厂就有，但不占用户的存储）

   ★ 为什么"不自动播放"要单独钉、还要配一条正控：
     首开自动选中动的是 `S.playMode` 与 `S.arrangeSel`，而这两者与"起播"在代码里
     挨得很近（playArrange 就是在写完它们之后立刻 Controls.start）。
     只断言 `S.playing === false` 有个漏洞：如果整个音频栈都没装配起来，
     它**照样**是 false —— 那是"假绿"。所以下面除了"没播"，还要在同一个桩里
     真的播一次并看到调度器起来（intervalCount 从 0 变成 > 0），
     证明"false"是"没去播"，不是"播不了"。
   ★ 首次打开的桩：`loadApp(undefined, { seedDemo: false })` —— 无任何存档、
     且"示例曲已带出过"的闩也没落上（harness 默认会落上它，见其 opts.seedDemo 注释）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

const firstOpen = () => loadApp(undefined, { seedDemo: false });
/* 曲式分组是 #presetList 里的第二个孩子（第一个是「节拍/扫弦」两个分区标题所在的块），
   取法与 t88 同一套：动态生成的节点只能按类名 + children 序位取。
   整首连播那一行 = 分组[0]，它的第二个孩子是状态读数 */
const boxOf = els => els["presetList"].children
  .find(x => /(^| )preset-arrange-group( |$)/.test(x.className));
const playNoteOf = els => boxOf(els).children[0].children[0];   // v2.28.0：按钮已删，读数是行内唯一子节点

/* ================= 场景 T93a：首次打开 = 选中示例曲但不播 ================= */
section("T93a 首开默认 ② · 默认选中示例曲《在他乡》——但**绝不自动播放**");
{
  const { beat, els, intervalCount } = firstOpen();
  const demo = beat.Store.findArrange(beat.DEMO_ID);
  ok(!!demo, "前提：首次打开已静默带出示例曲（v2.4.1 的既有行为）");

  eq(beat.Store.S.playMode, "arrange", "★ 一打开就是曲式模式（曲式已被选中，不是「什么都没选」）");
  eq(JSON.stringify(beat.Store.S.arrangeSel),
     JSON.stringify({ id: beat.DEMO_ID, from: 0, to: beat.songBars(demo) - 1, loop: false, byLyric: false }),
     "★ 选中的就是示例曲的**整首**（from 0 到末小节），且 loop=false（「选好」而不是「开始连播」）");

  /* ★★ 核心：不自动播放。三条彼此独立的证据 */
  eq(beat.Store.S.playing, false, "★★ S.playing 仍是 false（选中 ≠ 起播）");
  eq(intervalCount(), 0, "★★ 调度器一个 interval 都没起（没有声音在跑）");
  eq(beat.clock().schedBar, 0, "★★ 调度游标停在 0 小节（没有排过任何一拍）");

  /* 正控（防"假绿"）：同一个桩里真的播一次，上面那三条必须立刻反过来 */
  beat.Controls.start();
  eq(beat.Store.S.playing, true, "正控：按播放 → 真的在播（否则上面那条 false 只是「音频栈没起来」）");
  ok(intervalCount() > 0, "正控：调度器起来了（实际 interval 数 " + intervalCount() + "）");
  beat.Controls.stop();
  eq(beat.Store.S.playing, false, "停止后回到未播（首开不是「播了又停」，是压根没播）");

  /* UI 面：侧栏那一行读数必须已经是"整首连播 · 已就绪"，不是"拖滑块改范围" */
  const note = String(playNoteOf(els).textContent);
  ok(/整首连播 · 已就绪/.test(note),
    "★ 侧栏读数首屏就是「整首连播 · 已就绪 · 共 N 小节」（实际「" + note + "」）——"
    + "内部状态对了但界面没说，等于用户看不到「选好了」");
}

/* ================= 场景 T93b：这份"选中"要跨刷新存活 ================= */
section("T93b 首开默认 ② · 选中状态立刻落盘：开着没动就关掉，下次打开仍是选中的");
{
  const first = firstOpen();
  /* ★ 首开那条选中是在装配层写的，写的是**热键**（防抖 250ms）→ flush 立即落盘。
     若这里不落盘：闩已经落上了，用户什么都没点就关掉 → 下次打开再也不会选中，
     这个"默认"就凭空消失一次且再也回不来（而 UI 上看起来像没实现过）。 */
  first.beat.Store.flush();
  /* 先判键在不在再解析：**变异测试要求"忘了落盘"表现为具名断言失败，而不是整套崩掉**
     （直接 JSON.parse(String(undefined)) 会抛错中断——崩溃不是证据） */
  const rawHot = first.storage.get("beatsight.state");
  ok(!!rawHot, "★★ 首开无交互也写了热键（否则「开着没动就关掉」会把这个默认弄丢一次）");
  const hot = rawHot ? JSON.parse(String(rawHot)) : {};
  eq(hot.arrangeSel && hot.arrangeSel.id, first.beat.DEMO_ID,
    "★★ 热键里已含 arrangeSel.id = 示例曲");
  eq(hot.playMode, "arrange", "  模式一并落盘");
  eq(first.storage.get("beatsight.demoSeeded"), "1", "带出闩同时落上（冷键，独立于热键）");

  /* 第二次打开：同一份存档 + 闩 → 选中被恢复（这是"记忆"，不是"又自动选了一次"） */
  const second = loadApp({
    "beatsight.state": first.storage.get("beatsight.state"),
    "beatsight.demoSeeded": "1",
    "beatsight.arranges": first.storage.get("beatsight.arranges"),
    "beatsight.customs": first.storage.get("beatsight.customs"),
    "beatsight.lyrics": first.storage.get("beatsight.lyrics"),
  });
  eq(second.beat.Store.S.playMode, "arrange", "第二次打开：仍是曲式模式（用户的选择被记住）");
  eq(second.beat.Store.S.arrangeSel.id, first.beat.DEMO_ID, "选中的还是那首示例曲");
  eq(second.beat.Store.S.playing, false, "★ 而且照样**不自动播放**（「记住选中」不等于「自动起播」）");
}

/* ================= 场景 T93c：闩已落 → 不再替老用户做选择 ================= */
section("T93c 首开默认 ② · 闩已落（老用户）→ 不自动选中，维持他自己的状态");
{
  /* 老用户 = 闩已落 + 冷键里已有示例数据，但**热键里没有 arrangeSel**（他从没选过曲式）。
     ★ 不能用光秃秃的 `loadApp()`：harness 只把闩落上，冷键是空的 —— 那是"闩落上了但库里没有"
       这个**异常**组合（真实老用户不会是它：带出成功才落闩，见 ensureDemo 的注释）。
       所以这里先首开一次拿到真实的示例数据，再换成"没有 arrangeSel"的热键。 */
  const seed = firstOpen();
  const old = loadApp({
    "beatsight.state": JSON.stringify({ v: 3, bpm: 96, sel: { type: "builtin", idx: 0 } }),
    "beatsight.demoSeeded": "1",
    "beatsight.arranges": seed.storage.get("beatsight.arranges"),
    "beatsight.customs": seed.storage.get("beatsight.customs"),
    "beatsight.lyrics": seed.storage.get("beatsight.lyrics"),
  });
  eq(old.beat.Store.S.playMode, "preset", "★★ 老用户打开仍是预设模式（首开默认不该越过闩去改别人的状态）");
  eq(old.beat.Store.S.arrangeSel.id, "", "★ 且没有被塞进任何曲式 id");
  ok(!!old.beat.Store.findArrange(old.beat.DEMO_ID),
    "示例曲**还在库里**（不选中 ≠ 删掉——它仍可由用户自己点选）");

  /* 老用户显式选了"单练某个节奏型"，更不该被首开逻辑碰 */
  const picked = loadApp({ "beatsight.state": JSON.stringify({ sel: { type: "builtin", idx: 1 } }) });
  eq(picked.beat.Store.S.playMode, "preset", "老用户点过预设 → 仍是预设模式");
  eq(JSON.stringify(picked.beat.Store.S.sel), JSON.stringify({ type: "builtin", idx: 1 }),
    "★ 他自己的选择一位不动");
}

/* ================= 场景 T93d：同屏行数 4 / 拍号 4/4 ================= */
section("T93d 首开默认 ③ · 同屏行数 4 行、拍号 4/4（状态与控件两边都钉）");
{
  const { beat, els } = firstOpen();
  eq(beat.Store.S.vizRows, 4, "★ 同屏行数默认 4");
  eq(beat.Store.S.sig, 4, "★ 拍号默认 4（= 4/4）");

  /* 控件面：档位 pill 的选中态必须与默认值一致（状态对了但按钮高亮在别处 = 用户不知道该信谁） */
  const rowPills = els["vizRowsRow"].children.filter(c => c.dataset.rows !== undefined);
  const activeRows = rowPills.filter(c => c.classList.contains("active")).map(c => c.dataset.rows);
  eq(JSON.stringify(activeRows), JSON.stringify(["4"]), "★ 「同屏行数」4 那一档高亮（且只有它）");
  const sigPills = els["sigRow"].children.filter(c => c.dataset.sig !== undefined);
  const activeSig = sigPills.filter(c => c.classList.contains("active")).map(c => c.dataset.sig);
  eq(JSON.stringify(activeSig), JSON.stringify(["4"]), "★ 「拍号」4 那一档高亮");

  /* 脏值口径顺带复钉一次：这两项都是"用户视图偏好"，脏值必须回落到同一个默认 */
  const dirty = loadApp({ "beatsight.state": JSON.stringify({ vizRows: 999, sig: 5 }) });
  eq(dirty.beat.Store.S.vizRows, 4, "vizRows 脏值（999）→ 回落 4");
  eq(dirty.beat.Store.S.sig, 5, "★ 而 sig=5 是**合法档位**，照读（白名单是 6 档，不是只有 4）");
}

/* ================= 场景 T93e：首开四件套一起看（验收面） ================= */
section("T93e 首开默认 ①③④ · 分区展开态 / 行数拍号 / 默认壁纸 一屏之内同时成立");
{
  const { beat, els, storage } = firstOpen();
  /* ① 折叠：节拍展开、扫弦收起、自定义展开（机制与脏值口径在 T85） */
  const secs = els["presetList"].children.filter(el => /(^| )preset-section( |$)/.test(el.className));
  eq(JSON.stringify(secs.map(h => h.getAttribute("aria-expanded"))), JSON.stringify(["true", "false", "true"]),
    "★ ① 分区：节拍+自定义展开、扫弦收起");
  /* ③ 行数 / 拍号（机制在 T79 / T13） */
  eq(beat.Store.S.vizRows + "/" + beat.Store.S.sig, "4/4", "★ ③ 同屏行数 4 / 拍号 4/4");
  /* ④ 默认壁纸（机制与三态在 T92）：出厂就有，但**不占** localStorage */
  ok(beat.wallState() && beat.wallState().img === beat.WALL_DEFAULT, "★ ④ 出厂默认壁纸已应用");
  eq(storage.get(beat.WALL_KEY), undefined, "★ ④ 且「什么都没做」时它不落盘（用户不该为此付几百 KB）");
  eq(els["wallLayer"].hidden, false, "④ 壁纸层已现身");
  /* ★★ 内联常量本身必须是**一张真图**：前缀只许一份、base64 要能解、头 3 字节要是 JPEG 魔数。
     这条是 v2.13.0 输血时**真机解码断言抓到的真 bug** 的回归钉子——
     当时把完整 data URL 填进一个已经带了 `data:image/jpeg;base64,` 前缀的占位符里，
     于是前缀写重、base64 多出 15 个字节，**浏览器根本解不开这张图**（背景一片空白）。
     桩里之所以当时全绿：从前的断言只看"style 里有没有 data: 前缀"，前缀重了照样有。
     下面三条在桩里就能拦住它（沙箱补了 atob，见 harness 的说明）。 */
  const dm = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(beat.WALL_DEFAULT);
  ok(!!dm, "★★ 默认图是**单份前缀 + 纯 base64** 的 data URL（前缀重了这条就红）");
  eq(dm && dm[1], "image/jpeg", "  声明类型是 JPEG");
  /* 用 Node 自己的 Buffer 解，而不是页面里的 atob：两条**不同**的解码路径对同一串 base64
     得出同一个文件头，才能说明"这串东西本身"是对的（同源解码器有可能一起错）。
     ★ 取值一律带长度守卫：前缀重了 / 拿到空串时，这里必须产出**具名失败**而不是让套件崩掉 */
  const bin = Buffer.from(dm ? dm[2] : "", "base64");
  const head3 = [0, 1, 2].map(i => typeof bin[i] === "number" ? "0x" + bin[i].toString(16) : "—").join(" ");
  eq(head3, "0xff 0xd8 0xff",
     "★★ 解出来的头 3 字节就是 JPEG 魔数（不是把 data: 前缀当二进制解出来的垃圾）");
  const tail2 = bin.length >= 2 ? ((bin[bin.length - 2] << 8) | bin[bin.length - 1]) : -1;
  eq(tail2, 0xFFD9, "  结尾是 JPEG 的 EOI 标记（ffd9）——说明这串没有被截断");
  ok(beat.WALL_DEFAULT.length > 1000 && beat.WALL_DEFAULT.length < beat.WALL_MAX_BYTES,
    "  体积落在（0, 落盘上限）之间：" + beat.WALL_DEFAULT.length + " 字符");
  /* ② 示例曲（细节在 T93a–c） */
  eq(beat.Store.S.arrangeSel.id, beat.DEMO_ID, "★ ② 示例曲已选中");
  eq(beat.Store.S.playing, false, "★ ② 且没有在播");
}
