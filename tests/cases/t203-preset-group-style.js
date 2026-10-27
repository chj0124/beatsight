/* BeatSight 自动化测试 · 预设库三级层次（区 / 分组 / 条目）（v3.33.17）
   T203 系列。
   ---------------------------------------------------------------------------
   用户实拍：「节奏型预设库中，分组的样式有问题，组标题竟然比组内各项内容的标题字体还小，
   而且排版也有问题。」

   两条独立缺陷：
     ① **层级倒挂**：`.preset-section`（区）与 `.preset-group`（分组）都是 11px，而它管着的
        `.preset-item .name`（条目名）是 **13px** —— 容器比内容还小。
     ② **缩进方向反了**：分组头带 `margin-left:10px` + `padding-left:8px` + `border-left:2px`
        = 比它管着的**条目多缩进 18px**，容器比内容还深，读起来像"标题属于更下一层"。

   本文件用**源码钉**（CSS 是纯声明，桩里没有布局，断言只能钉在声明上）。
   视觉最终效果按仓库纪律**需人眼验收**。 */
"use strict";
const { ok, eq, section, html } = require("../lib/harness");

const src = html;
/** 取某条 CSS 规则的规则体（第一个 `{` 到配对 `}`），找不到返回 "" */
function ruleBody(selector){
  const i = src.indexOf(selector + "{");
  if (i < 0) return "";
  const j = src.indexOf("}", i);
  return j < 0 ? "" : src.slice(i + selector.length + 1, j);
}
const px = (sel, prop) => {
  const m = new RegExp(prop + ":\\s*(-?[\\d.]+)px").exec(ruleBody(sel));
  return m ? Number(m[1]) : null;
};

section("T203a 四级层次单调 · 区 14 / 分组与条目 13 / 说明 11");
{
  const secFs = px(".preset-section", "font-size");
  const grpFs = px(".preset-group", "font-size");
  const nameFs = px(".preset-item .name", "font-size");
  const metaFs = px(".preset-item .meta", "font-size");
  eq(secFs, 14, "区标题 14px，不再小于条目名");
  eq(grpFs, 13, "★ 分组标题 13px");
  eq(nameFs, 13, "条目名仍是 13px");
  eq(metaFs, 11, "说明仍为 11px 辅助信息");
  ok(secFs > grpFs && grpFs >= nameFs && nameFs > metaFs,
    "★★ 四级字号关系清楚：区 > 分组 ≥ 条目 > 说明");
  ok(/color:var\(--t1\)/.test(ruleBody(".preset-section")), "区标题使用主文字色，不再弱成尾注");
}

section("T203b 分组标题的视觉权重 ≥ 条目名（字重 / 颜色）");
{
  const grp = ruleBody(".preset-group");
  ok(/font-weight:600/.test(grp), "★ 分组标题 font-weight:600（一眼是容器头）");
  ok(/color:var\(--t1\)/.test(grp), "★ 分组标题 color:--t1（亮于条目名所在层）");
  ok(!/color:var\(--t3\)/.test(grp), "且不再是 --t3 那种「最暗的辅助文字」档");
}

section("T203c 缩进方向 · 分组头不再比它的条目更深");
{
  const grp = ruleBody(".preset-group");
  ok(!/border-left/.test(grp),
     "★ 去掉 border-left 竖线（它把分组画成「又深一层」的括号）");
  ok(!/padding-left/.test(grp),
     "★ 去掉 padding-left:8px（18px 缩进的一半）");
  ok(!/margin:10px 0 6px 10px/.test(grp),
     "★ 去掉 margin-left:10px（另一半）——分组头现在与区头同左缘，层次靠字号/字重/颜色表达");
  ok(/margin:var\(--sp-3\) 0 0;/.test(grp), "分组头不额外留下边距，首条目间距由紧凑内边距承担");
}

section("T203d 源码钉 · 折叠箭头仍在（改样式不许碰行为契约）");
{
  ok(/\.preset-group::before\{content:"▾"/.test(src), "★ 折叠箭头 ::before 仍在（组头可折叠）");
  ok(/\.preset-group\[aria-expanded="false"\]::before\{transform:rotate\(-90deg\)\}/.test(src),
     "★ 折叠态仍由 aria-expanded 单一真相驱动（未引入第二份状态）");
}

section("T203e 名称说明基线同行，窄空间省略或自然换行");
{
  const box = ruleBody(".preset-item>div:first-child");
  ok(/display:flex/.test(box) && /align-items:baseline/.test(box) && /flex-wrap:wrap/.test(box),
    "★ 名称与说明使用可换行的基线 flex 行");
  const name = ruleBody(".preset-item .name"), meta = ruleBody(".preset-item .meta");
  for (const body of [name, meta]){
    ok(/min-width:0/.test(body) && /overflow:hidden/.test(body)
      && /text-overflow:ellipsis/.test(body) && /white-space:nowrap/.test(body),
    "★ 长名称/说明不会挤爆条目，超出时省略");
  }
  ok(/flex:1 1 120px/.test(meta) && /margin-top:0/.test(meta) && /text-align:right/.test(meta),
    "★ 说明铺满剩余空间并右对齐，过窄时落到第二行，不额外缩字");
  ok(/nm\.title = name/.test(src) && /mt\.title = metaText/.test(src),
    "★ 省略后仍保留完整名称与说明的悬停提示");
  ok(/margin:var\(--sp-4\) 0 0;/.test(ruleBody(".preset-section")), "区头与首条目间距收紧到 10px");
  ok(/flex:1 1 100%/.test(box), "名称与说明独占整行，不被操作区切割");
  const actions = ruleBody(".preset-item .preset-actions");
  ok(/position:absolute/.test(actions) && /opacity:0/.test(actions)
    && /visibility:hidden/.test(actions) && /pointer-events:none/.test(actions),
    "★★ 操作按钮默认不占位、不进 Tab 顺序且不响应点击");
  ok(/\.preset-item\.active \.preset-actions\{\s*opacity:1;visibility:visible;pointer-events:auto\}/.test(src),
    "★★ 操作状态原位显示图标，不增加行高");
  ok(/display:flex;align-items:center;gap:4px/.test(actions),
    "★★ 操作组按实际按钮数量排列，不预留固定槽位");
  ok(/\.preset-item\.active \.meta\{opacity:0\}/.test(src)
    && !/\.preset-item\.active(?:>div:first-child| \.name)\{opacity:0\}/.test(src),
    "★★ 名称始终显示，只有说明透明让位且仍在无障碍树中");
  ok(/right:6px/.test(actions) && /padding:2px var\(--sp-2\)/.test(ruleBody(".preset-item .preset-actions>button")),
    "★★ 最右图标与说明共用 12px 内容右缘（6px 操作组偏移 + 6px 内边距）");
}

section("T203f 层级间距、播放绿点居中与歌曲不换行");
{
  ok(/\.preset-item\{position:relative;padding:4px 12px;/.test(src), "条目上下内边距为 4px");
  ok(/\.preset-section\+\.preset-arrange-group>\.preset-item:first-child\{padding-top:8px\}/.test(src),
    "分区首条目上内边距 8px + 网格 4px = 区间距 12px");
  ok(/\.preset-arrange-group>\.preset-item\.song\+\.preset-item\.in-song\{padding-top:8px\}/.test(src),
    "歌曲父级到首子条目使用专用间距，不把区间距一起放大");
  ok(/margin-top:-3px;border-radius:50%/.test(src), "6px 播放绿点向上回退自身一半，真正垂直居中");
  ok(/\.preset-item\.song>div:first-child\{flex-wrap:nowrap\}/.test(src)
    && /\.preset-item\.song \.meta\{flex:1 1 0\}/.test(src),
    "长歌名与说明不再被 120px 基准宽度挤成两行");
  ok(/\.preset-item\.in-song>div:first-child\{flex-wrap:nowrap\}/.test(src)
    && /\.preset-item\.in-song \.meta\{flex:1 1 0\}/.test(src),
    "★★ 歌曲子条目也禁止名称与 4/4 换行，说明只占剩余空间");
  ok(/\.preset-item\.in-song\{margin-left:18px;padding:6px 12px\}/.test(src),
    "★★ 子条目上下内边距为 6px，嵌套文字间距统一为 12px（PLAN-v16 阶段 3 曾误收敛 6→8 致底块高出节拍区 6.5px，用户实报后回退白名单）");
  ok(!/\.preset-item\.song\{background:/.test(src)
    && /\.preset-item\.song \.name\{font-weight:600\}/.test(src),
    "★★ 歌曲行作为分组标题：字重 600 保留；常驻底色已退役（2026-10-27 用户拍板——底块+分组线让未选中行读作选中，防回潮）");
  ok(/\.preset-item\.in-song \.name\{font-size:12px;font-weight:500;color:var\(--t2\)\}/.test(src),
    "★★ 子节奏型名称比父级小一级、弱一级");
  ok(!/\.preset-arrange-group::before/.test(src),
    "★★ 左侧分组竖线已退役（2026-10-27 用户拍板：每首歌一条线读作选中条；分组身份靠书名号+字重，防回潮）");
  ok(/\.preset-item\.song \.name::before\{content:"▸";display:inline-flex;align-items:center;justify-content:center;/.test(src)
    && /width:12px;height:1em;vertical-align:middle/.test(src),
    "★★ 折叠箭头有独立居中盒，不再只依赖文字基线");
  ok(/actions\.className = "preset-actions"/.test(src)
    && /presetActionHost\(item\)\.appendChild\(play\)/.test(src),
    "★★ 操作按钮统一进入动态操作组，而非固定槽位");
}
