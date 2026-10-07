/* BeatSight 自动化测试 · B2 信息架构去重（P3）+ 字体层级（P4）（v3.4.1）
   ---------------------------------------------------------------------------
   背景（画布评审 P3/P4 定稿）：
     P3「信息架构与视觉焦点」：**当前型名在同一帧里被写进两处**——顶栏 .status 的
        #patternName 与底栏胶囊的 #plbCurName，值都是 p.name（refresh 里紧挨着两行）。
        两处一模一样的文字把「我正在练哪个型」这个最高频读数劈成两处，扫视时无从
        判断哪处权威，视觉焦点也被平分成两份。
        修法：型名只留**底栏常驻胶囊**（fixed 不随页面滚走，且它本身就是预设库入口、
        名字是按钮的内容），顶栏状态行退化为「● 状态」两枚。
     P4「字体层级与排版」：.group-label（音量/BPM/行数等组标签）11px，与顶栏
        .brand .ver、.ruler-lab 那类**装饰性微标**同号，层级被抹平。

   契约（改动前先钉死，改码后必须全绿）：
     ① #patternName 元素在底栏 #presetLibBtn 内，全页面**只此一处**型名展示位；
     ② 顶栏状态行不再有型名；#plbCurName 与它的 JS 写点一并消失（不留死代码）；
     ③ CSS 宿主换到 .pb-ctx .pat-now，旧规则 .status .pat-now 不留死样式；
        截断上限 18em→22em 且 nowrap 必须仍在（fixed 底栏折行会撑破栏高）；
     ④ JS 只剩**一个**型名写点（去重的真正判据：不是"两处显示一样"，而是"只写一次"）；
     ⑤ #patternName 这个 id 不得被删改——8 个测试文件约 20 条断言拿它当锚点，
        搬元素不换 id 是本批零断裂的前提（这一条是反向验证的重点）；
     ⑥ .group-label 12.5px/500 属既定字号阶梯的一档，装饰性微标（.brand .ver 等）
        一律不动——波及其他布局就是过度改动。 */
"use strict";
const { ok, section, html } = require("../lib/harness");

/* 切片：两端标记都必须在，否则 indexOf 给 -1 会切出"到文件末尾"，
   让"不该包含 X"的断言侥幸通过（比失败更危险）。 */
function slice(a, b){ return html.slice(html.indexOf(a), html.indexOf(b)); }
const TOPBAR = slice('<header class="topbar">', "<!-- 分级播报");
const PLAYBAR = slice('<div class="play-bar" id="playBar"', "<!-- ================= 自定义节奏型编辑器");
const CSS = slice("<style>", "</style>");
const ROOT = html.slice(html.indexOf(":root{"), html.indexOf("}", html.indexOf(":root{")) + 1);

/* ================= T150a：型名唯一展示位在底栏胶囊（P3 核心） ================= */
section("T150a #patternName 在底栏胶囊内，页面别处无第二处型名");
{
  ok(TOPBAR.length > 0 && !/id="patternName"/.test(TOPBAR),
    "★ P3：顶栏状态行**不再**含型名（原先与胶囊同帧同值的重复面已消除）");
  ok(/<button class="pb-ctx" id="presetLibBtn"/.test(PLAYBAR)
     && /<b class="pat-now" id="patternName">/.test(PLAYBAR),
    "★★ P3：型名在底栏胶囊 .pb-ctx > b.pat-now 内——全页面唯一展示位，且随 fixed 底栏常驻");
  ok(!/id="statusDot"/.test(TOPBAR) && !/id="statusText"/.test(TOPBAR),
    "★ v3.10.0：状态灯两枚已随用户要求搬去底栏（v2.76.3 搬进顶栏是三读数带时代的设计，"
    + "型名 P3 走后这份状态行成了孤儿；顶栏不再有 statusDot/statusText）");
  ok(/id="statusDot"/.test(PLAYBAR) && /id="statusText"/.test(PLAYBAR),
    "★★ v3.10.0：状态灯在底栏右区 .pb-right 内，与「第 N–M 小节」范围读数同区");
  /* 全页只允许一个 id="patternName"（重复 id 会让 $() 命中首个，语义反而更坏） */
  ok((html.match(/id="patternName"/g) || []).length === 1,
    "★★ P3：id=\"patternName\" 全页面恰好出现 1 次（无重复 id）");
}

/* ================= T150b：第二写点与死代码清除 ================= */
section("T150b #plbCurName 与其 JS 写点整体退役");
{
  ok(!/id="plbCurName"/.test(html), "★ #plbCurName 的元素已删（v3.3.0 从预设库卡片搬来的重复面）");
  /* 判据只管**可执行代码**里的残留：注释里保留名字作纪念是本仓库既有惯例
     （t90「清理注释里保留名字作纪念不算违规」），拿字面量去搜会把注释一起判死。 */
  ok(!/\$\("plbCurName"\)/.test(html) && !/const plbCur =/.test(html),
    "★★ 可执行代码里再无 plbCurName 引用（元素、JS 写点、局部变量三处全清）");
}

/* ================= T150c：写点数收敛到 1（去重的真正判据） ================= */
section("T150c 型名 JS 写点恰好一处");
{
  const writes = (html.match(/\$\("patternName"\)\.textContent/g) || []).length;
  ok(writes === 1, `★★ 型名写点恰好 1 处（实测 ${writes}）——去重不是"两处显示一样"，是"只写一次"`);
  /* ★ v3.36.18：写点仍是那一处，取的数据源仍是**本型自己的名字**（不是新引的数据源），
     只是显示形态按模式分岔：曲式模式下剥掉尾部出处标注（stripSongTag），预设模式原样。 */
  ok(/\$\("patternName"\)\.textContent = S\.playMode === "arrange" \? stripSongTag\(nm\) : nm;/.test(html),
    "★ 唯一写点仍取本型名（曲式模式剥出处后缀 / 预设模式原样）——同源，不新引数据来源");
}

/* ================= T150d：CSS 宿主换到胶囊，旧规则不留死样式 ================= */
section("T150d .pb-ctx .pat-now 在位，.status .pat-now 已退役");
{
  ok(/^\.pb-ctx \.pat-now\{/m.test(CSS), "★ 新宿主规则在位（底栏胶囊内）");
  ok(!/^\.status \.pat-now\{/m.test(CSS), "★ 旧宿主规则 .status .pat-now 不留死样式");
  const r = /\.pb-ctx \.pat-now\{([^}]*)\}/.exec(CSS);
  ok(!!r, "★ 能取出规则体做细项断言");
  if (r) {
    ok(/max-width:22em/.test(r[1]),
      "★★ 截断上限 18em→22em（胶囊独占一列、可用宽比顶栏充裕，不必再按顶栏的紧窄取值）");
    ok(/white-space:nowrap/.test(r[1]),
      "★★ nowrap 仍在——少了它省略号失效、长型名折两行撑破 fixed 底栏栏高");
    ok(/text-overflow:ellipsis/.test(r[1]) && /overflow:hidden/.test(r[1]),
      "★ 省略号三件套齐全（hidden + ellipsis + nowrap 缺一不可）");
    ok(/font-size:13px/.test(r[1]),
      "★ 字号 12px→13px 与胶囊其余文字对齐（同一枚钮内不出现两级字号）");
  }
}

/* ================= T150e：锚点不得被删改（零断裂前提） ================= */
section("T150e #patternName id 保留，测试锚点不迁移");
{
  ok(/id="patternName"/.test(html) && !/id="plb-name"/.test(html),
    "★★ id 名一字未改——8 个测试文件约 20 条断言拿它当「当前型名」锚点，"
    + "搬元素不换 id 是本批零断裂的前提");
  ok(/id="presetLibBtn"/.test(html) && /aria-expanded="false"/.test(PLAYBAR),
    "★ 胶囊本体的 id 与 aria-expanded 初值不变（开合接线不动）");
}

/* ================= T150f：组标签升档（P4） ================= */
section("T150f .group-label 12.5px/500，字号取自既定阶梯");
{
  const g = /^\.group-label\{([^}]*)\}/m.exec(CSS);
  ok(!!g, "★ .group-label 规则在位");
  if (g) {
    ok(/font-size:12\.5px/.test(g[1]),
      "★★ 组标签 11px→12.5px：与 .brand .ver 等装饰性微标拉开一档，不再同号");
    ok(/font-weight:500/.test(g[1]), "★ 字重补 500（小字低对比，靠字重回可读性）");
    ok(/letter-spacing:\.04em/.test(g[1]), "★ 微字距 .04em（小字号下字形挤连，疏一点更易扫读）");
    ok(/color:var\(--t3\)/.test(g[1]), "★ 颜色仍走 --t3（只调字号字重，不动色语义）");
    ok(!/font-size:11px/.test(g[1]), "★ 旧 11px 值已从本规则移除（真替换，不是叠加覆盖）");
  }
  /* 反向：装饰性微标不得被顺手改大（过度改动同样是回归） */
  ok(/\.brand \.ver\{[^}]*font-size:11px/.test(CSS),
    "★★ 装饰性微标 .brand .ver 保持 11px——P4 只提组标签这一档，不外溢");
  /* v3.36.8（用户拍板）：胶囊左端换成了双图标（面板 ◧ / 往左展开 ‹），「当前」前缀退役。
     ★ 反向守卫挪到**仍在胶囊里的那枚 11px 微标**（动作提示「浏览节奏型」）——口径不变：
       胶囊内的装饰性微标不得被顺手改大。 */
  ok(/\.pb-ctx \.pb-ctx-cta\{[^}]*font-size:11px/.test(CSS),
    "★★ 胶囊内「浏览节奏型」微标保持 11px（P4 只提组标签那一档，不外溢）");
  /* ★ 左端双图标是**刻意 14px**：11px 下 ◧ 只有 8.4px 宽，读不出是图标（本轮真机实测）；
     14 是字号阶梯里的既有档位，不新增档位。 */
  ok(/\.pb-ctx \.pb-ctx-dir\{[^}]*font-size:14px/.test(CSS),
    "★ 左端 ‹ 固定 14px（11px 太小读不出是图标；14 是阶梯内既有档，未新增档位）");
}
