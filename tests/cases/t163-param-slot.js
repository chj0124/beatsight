/* BeatSight 自动化测试 · 开关参数槽（v3.3.1 定稿形状）
   T163 系列。
   ---------------------------------------------------------------------------
   用户第二轮实测反馈："卡片变形问题虽然解决了，但随着静音拍或者变速训练的打开或关闭，
   卡片内部的元素**依然会大幅度移动**。"

   根因是两层，v3.3.0 只解决了第一层：
     ① **容器总高**：靠 `.tg-body{min-height:244px}` 稳住 —— 高度确实不抖了；
     ② **行位置**：三个开关各占一行 + `justify-content:space-evenly`，而 space-evenly 会把
        **变化的自由空间摊到行距上** —— 内容一高，自由空间变小，三行整体上移
        （真机实测：全关 197px / 变速训练参数占一行 241px，两态行位置整体平移）。
   本轮的正面解（用户拍板）：
     · 三个开关**合并为一行**（`#tgSwitchRow`）——它们都是"这一遍怎么练"的开算子，原来各占一行；
     · 参数下沉到**恒定高度的公共参数槽**（`#tgSlot`）——块内内容高度天然恒定，
       行距不再有"可摊的自由空间"，故开关位置与四块宽度逐像素不动；
     · 三组参数（拍数 / 每N·静M+随机 / 目标+步长+等级+进度）共用槽，`syncParamSlots` 仲裁
       "最后激活的那一组显示"；**不做互斥**（与"试听/播放两态合法共存"同一条纪律，见 L5748）。
     · 空目标不再弹窗拒开（方案甲）：目标搬进槽后弹窗会**死锁**（点开关没反应、又看不到输入框），
       改成"把槽打开 + 焦点送进目标框 + 原因就地写在进度行"。

   ★ 本文件钉结构与源码级契约；"四态下开关位置逐像素相同"这条要真实几何，由 tools/smoke.js 复核。 */

const { section, ok, eq } = require("../lib/harness");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

section("T163a 结构 · 三开关一行 + 恒定高度参数槽");

const rowStart = src.indexOf('<div class="tg-row" id="tgSwitchRow">');
const rowEnd = src.indexOf("</div>", rowStart);
ok(rowStart > 0 && rowEnd > rowStart, "★★ 存在开关行容器 #tgSwitchRow");
const row = src.slice(rowStart, rowEnd);
["countInToggle", "muteToggle", "trainerToggle"].forEach(id => {
  ok(row.includes('id="' + id + '"'), "★ 三枚开关同在**一行**之内：" + id);
});
ok(/\.viz-toggles \.tg-slot\{height:\d+px;display:flex;align-items:center/.test(src),
  "★★ 参数槽 #tgSlot 用**固定 height**（不是 min-height）——块内高度天然恒定，"
  + "行距不再有可摊的自由空间（这正是 v3.3.0 用 min-height 没解决的那一半）");
ok(!/\.viz-head-grid \.viz-toggles \.tg-body\{min-height:/.test(src),
  "★ 容器上的 min-height 已撤（槽接手了这件事；两层机制并存既是双保险也是双借口）");

const slotStart = src.indexOf('<div class="tg-slot" id="tgSlot">');
const slot = slotStart > 0 ? src.slice(slotStart, slotStart + 4000) : "";
ok(slotStart > 0, "找到参数槽");
["countInPanel", "muteCfgPanel", "trainerPanel"].forEach(id => {
  ok(slot.includes('id="' + id + '"'), "★ 三组参数面板都在槽内：" + id);
});
["countInBeatsWrap", "muteRandomToggle", "trTargetWrap"].forEach(id => {
  ok(slot.includes('id="' + id + '"'),
    "★★ 小参数也搬进槽（" + id + "）——开关行只剩三枚开关，行宽不再随开合变化");
});
ok(slot.includes('id="trainerProg"'), "★ 训练进度行随整组参数搬进槽（就地读进度 / 读拒开原因）");

section("T163b 仲裁 · 三组共用一个槽（不互斥）");

ok(/function syncParamSlots\(/.test(src), "★ syncParamSlots 存在");
ok(/countIn: !!S\.countIn\.on, mute: !!S\.mute, trainer: !!S\.trainer\.on/.test(src),
  "★★ 三个开关都是判据的一部分（不是两两互斥，也不是只看两组）");
ok(/if \(paramSlotForce && !on\[paramSlotForce\]\)/.test(src),
  "★★ force 分支：某组开关**没开**也能把它的参数摆出来（空目标那条路径靠它）");
ok(/function openParamSlot\(/.test(src), "★ openParamSlot 存在（只读展示的入口）");
{
  const fnBody = src.slice(src.indexOf("function syncParamSlots"), src.indexOf("function openParamSlot"));
  ok(!/S\.(mute|trainer|countIn)\s*=/.test(fnBody),
    "★★ 仲裁**不改开关状态**——只决定显示哪组参数，三个功能照常生效");
}
["countIn", "mute", "trainer"].forEach(k => {
  ok(src.includes('syncParamSlots("' + k + '")'),
    "★ 点对应开关即把槽切给自己：" + k);
});
ok((src.match(/\.hidden = \(show !== k\)/g) || []).length > 0,
  "★★ 三组面板的 hidden 只由仲裁函数写（散在各处的直接赋值已全部收口）");

section("T163c 空目标 · 不再弹窗拒开（改为开槽 + 就地提示）");

ok(!src.includes('Modal.uiAlert("还没设目标'),
  "★★ 空目标的弹窗拒开已删除——目标搬进槽后弹窗会死锁（点开关没反应又找不到输入框）");
ok(src.includes("openSlotForTarget") && src.includes('openParamSlot("trainer")'),
  "★★ 改为把槽打开（openParamSlot）——目标框摆到用户眼前");
ok(/if \(t && typeof t\.focus === "function"\) t\.focus\(\);/.test(src),
  "★ 并把焦点送进目标框（少点一次、也不用猜该去哪儿填）");
ok(/prog\.textContent = why;/.test(src),
  "★★ 拒开原因**就地写在进度行**（不弹窗、也不静默——静默比弹窗更难查）");
ok(src.includes("if (S.trainer.target === null)") && src.includes("if (S.bpm >= S.trainer.target)"),
  "★ 两道闸都还在（空目标 / 当前速度已不低于目标）——只换了表达方式，判定不变");
ok(/if \(!S\.trainer\.on\)\{/.test(src),
  "★★ 拒开只作用于「开启方向」，关闭永远放行（否则会把用户锁在训练里）");
