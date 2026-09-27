/* BeatSight 自动化测试 · ✎ 改名按钮在桌面 hover 设备上的可点性（v2.44.2）
   T113 系列。
   ---------------------------------------------------------------------------
   来源（用户实测报障）：「点击节奏型预设库里节奏型旁边的编辑图标，没有反应」。
   真浏览器逐帧取证（CDP），根因不是 handler 丢了，而是 **click 事件压根没派发**：

     mousedown → BUTTON.ren        （✎ 按下，命中自己）
     按下瞬间 ✎ 获得焦点 → .preset-item 进入 :focus-within
                          → CSS `.preset-item:focus-within .grp{display:inline-block}`
                            把旁边的 📁 从 display:none 拉出来，条目整行变宽
                          → ✎ 被向左挤走（实测 x 由 1197.8 → 1112.1，位移 85.7px）
     mouseup   → BUTTON.grp        （鼠标坐标底下已经换成 📁）

   两者不是同一元素 ⇒ 浏览器**不派发 click**，改名框永远弹不出来。
   更糟的是兜底派发到共同祖先的那个 click 会冒到条目本体，顺手把该节奏型选中播了。
   只伤桌面 hover 设备（`@media (hover:hover) and (pointer:fine)` 命中），
   触屏 📁 常显、布局不跳，所以手机上一直正常——这正是它长期没被发现的原因。

   修法：✎ 的 mousedown 默认行为掐掉（<button> 的「按下即聚焦」），聚焦不发生、
   布局不抖；Tab 聚焦与 :focus-within 那条键盘可达性分支不受影响（Tab 不经过 mousedown）。

   ★ 本用例为什么必须存在：测试桩**没有布局引擎**，`.grp` 的 display 切换不会挪动
     ✎ 的位置，于是「点了没反应」在桩上**根本复现不出来**——T113a 钉的
     「mousedown 被 preventDefault」是这条链在桩上唯一的可观测投影。
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。 */
"use strict";
const { loadApp, ok, section } = require("../lib/harness");

const cls = s => String((s && s.className) || "");
const renOf = item => Array.from(item.children).find(c => /(^| )ren( |$)/.test(cls(c)));
const grpOf = item => Array.from(item.children).find(c => /(^| )grp( |$)/.test(cls(c)));
const itemsOf = els => Array.from(els["presetList"].children).filter(c => /(^| )preset-item( |$)/.test(cls(c)));
const dlgText = els => (els["modalMsg"] && els["modalMsg"].hidden === false) ? String(els["modalMsg"].textContent || "") : "";

function run(){
  const els = loadApp().els;
  const items = itemsOf(els);
  ok(items.length > 0, "T113 前提：预设条目已渲染（实际 " + items.length + " 条）");

  /* ---------- T113a ★ 核心回归：✎ 按下必须掐掉默认聚焦 ---------- */
  section("T113a ✎ 的 mousedown 必须 preventDefault（否则按下即聚焦 → 布局抖动 → click 不派发）");
  const first = items[0];
  const pen = first ? renOf(first) : null;
  ok(!!pen, "T113a 前提：首条挂了 ✎ 改名按钮");
  if (pen){
    const ev = pen.fire("mousedown", {});
    ok(ev.defaultPrevented === true,
      "★★ ✎ 的 mousedown 被 preventDefault（不拦的话按下即聚焦，📁 冒出把 ✎ 挤走，click 永不派发）");
    /* 反向对照：拦截要精准，不能连 📁 / ✎ 以外的一律掐死，否则同类手势会一起哑掉 */
    const grp = grpOf(first);
    if (grp){
      const ev2 = grp.fire("mousedown", {});
      ok(ev2.defaultPrevented !== true,
        "★★ 对照：📁 的 mousedown **不**被 preventDefault（拦截只该加在 ✎ 上，拦多了会误伤其它手势）");
    } else {
      ok(false, "T113a 前提缺失：首条没找到 📁 按钮");
    }
  }

  /* ---------- T113b 既有契约不许被这一改破坏 ---------- */
  section("T113b ✎ 的 click 仍是「停冒泡 + 弹改名框」");
  const item = items[0];
  const pen2 = item ? renOf(item) : null;
  ok(!!pen2, "T113b 前提：重新取到 ✎ 按钮");
  if (pen2 && item){
    const cev = pen2.fire("click", {});
    ok(cev.stopped === true, "★★ ✎ 的 click 仍 stopPropagation（不会顺带选中该节奏型、把练习状态改掉）");
    const before = dlgText(els);
    /* 弹框发生在 stopPropagation 之后、由 onRename() 触发：这里断言它确实出来了 */
    ok(dlgText(els) !== before || before !== "", "★★ ✎ 的 click 触发改名对话框（文案：" + JSON.stringify(dlgText(els).slice(0, 30)) + "）");
    ok(/重命名/.test(dlgText(els)), "★★ 对话框文案是重命名类（实际：" + JSON.stringify(dlgText(els).slice(0, 24)) + "）");
  }

  /* ---------- T113c 每一条 ✎ 都挂了这层保险，不止首条 ---------- */
  section("T113c 全部预设条目的 ✎ 一致挂载（漏一条就是 users 只在某些型号上点不动）");
  const pens = items.map(it => renOf(it)).filter(Boolean);
  ok(pens.length === items.length, "每条预设条目都有 ✎（条目 " + items.length + " / 按钮 " + pens.length + "）");
  const notGuarded = pens.filter(p => { const e = p.fire("mousedown", {}); return e.defaultPrevented !== true; });
  ok(notGuarded.length === 0, "★★ 没有任何一条 ✎ 漏挂 mousedown 拦截（漏 " + notGuarded.length + " 条）");
}

/* 与其余用例同款：require 即执行（run.js 只是 require，不调导出） */
run();
