/* BeatSight 自动化测试 · v3.39.0 主控区改造：删（重拍增强 / TAP / 快捷档）·
   移（BPM 并入音量组、数值步进跟随滑杆、训练读数跟随数值）· 合（窄屏折叠钮合一）·
   改名（预备拍→预备 / 静音拍→静音 / 变速训练→变速）
   T229 系列。
   ---------------------------------------------------------------------------
   由 tests/run.js 装配；沙箱、桩与断言工具见 tests/lib/harness.js。
   行为面（发声层级 / 步进 / 置灰）已由 t13/t18/t19/t23/t30/t37 承接；
   本文件钉**结构与文案**：合并后的折叠机制、胶囊实时值、开关新名。 */
"use strict";
const { loadApp, ok, eq, section, html } = require("../lib/harness");

/* 标记级断言用「剥掉 HTML 注释与 JS 注释」的净表面——本批退役词在注释里有大量
   历史记录（合法），只有净表面里出现才是真回潮（t90 注释里踩过的同款纪律）。 */
const SURFACE = html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

section("T229a 折叠钮合一：#ctlOpen 单开关 + 「BPM 96 ▾」读数钮（控制芯批 3 重写）");
{
  const { els } = loadApp();
  ok(html.indexOf('id="ctlOpen"') > 0, "★ 合并折叠开关 #ctlOpen 在标记里");
  ok(html.indexOf('id="volOpen"') < 0 && html.indexOf('id="bpmOpen"') < 0,
    "★★ 原「音量 / BPM」两枚折叠开关（volOpen/bpmOpen）已从标记除名");
  /* 控制芯批 3：折叠胶囊收窄为「BPM 96 ▾」读数钮（#volPillPctN 退役） */
  const pills = html.match(/class="ctl-pills">[\s\S]*?<\/div>/) || [""];
  eq((pills[0].match(/<label/g) || []).length, 1, "★★ 窄屏胶囊行只剩一枚（两枚合一）");
  ok(/class="ctl-pills">[\s\S]*?for="ctlOpen"[\s\S]*?id="bpmPillNumN"[\s\S]*?<\/div>/.test(html),
    "★★ 折叠读数钮携带当前 BPM（#bpmPillNumN）；音量 % 读数 #volPillPctN 随批 3 退役");
  ok(!/id="volPillPctN"/.test(SURFACE),
    "★★ #volPillPctN 从标记与接线除名（% 无信息量口径的延伸；收起态读 BPM 就够）");
  /* 实时值接线：BPM 写点仍在（setBpm / 启动收敛） */
  ok(typeof els["bpmPillNumN"] !== "undefined",
    "★ BPM 实时值 span 在桩上可取到（接线对象存在）");
}

section("T229b 折叠语义：收起 = 只藏滑杆塔（胶囊行常驻；控制芯批 3）");
{
  const { els } = loadApp();
  els["bpmPlus5"].fire("pointerdown");
  eq(els["bpmPillNumN"].textContent, "101", "★ setBpm 路径 → 读数钮 BPM 值实时跟随（±5 生效）");
  /* CSS 侧（v3.42.0 第六轮补③ · 用户拍板甲案）：收起 = 塔**只藏内容、留拒开原因行**（#trainerProg）；
     **浮层不再被 CSS 藏**——否则"开关能点、参数槽弹不出来"（用户实拍）。浮层显隐一律交 syncParamSlots 仲裁。
     胶囊行与读数钮仍常驻（收起态开关照样可点）。 */
  ok(/#ctlOpen:not\(:checked\) ~ \.card-head \.card-head-left \.tg-body\{display:block;flex:0 0 auto;padding-bottom:0\}/.test(html)
     && /#ctlOpen:not\(:checked\) ~ \.card-head \.card-head-left \.tg-body > \*:not\(\.tr-prog\)\{display:none\}/.test(html)
     && !/#ctlOpen:not\(:checked\) ~ \.card-head \.tg-flyout\{display:none\}/.test(html)
     && !/#ctlOpen:not\(:checked\) ~ \.card-head \.card-head-left\{display:none\}/.test(SURFACE)
     && !/#ctlOpen:not\(:checked\) ~ \.viz-toggles\{display:none\}/.test(SURFACE),
    "★★ v3.42.0 甲案：收起态塔只藏内容、**留拒开原因行**；浮层**不再被 CSS 藏**（开关可点 ⇒ 参数必须可达）");
  ok(/#ctlOpen:checked ~ \.ctl-pills \.ctl-hit\[for=ctlOpen\]::after\{content:"▾"\}/.test(html),
    "★ 展开态箭头 ▾ 随合并开关翻转（收起 ▸ / 展开 ▾）");
  ok(!/volOpen|bpmOpen/.test(SURFACE),
    "★★ 净表面（剥注释）不再有 volOpen/bpmOpen 残留——收起/箭头选择器无一漏改");
}

section("T229c 三开关改名：预备 / 静音 / 变速（净表面无旧名）");
{
  ok(/>预备<span class="switch">/.test(SURFACE), "★ 预备开关新文案「预备」");
  ok(/>静音<span class="switch">/.test(SURFACE), "★ 静音开关新文案「静音」");
  ok(/>变速<span class="switch">/.test(SURFACE), "★ 变速开关新文案「变速」");
  ok(!/>预备拍</.test(SURFACE) && !/>静音拍</.test(SURFACE) && !/>变速训练</.test(SURFACE),
    "★★ 净表面无旧开关名（「预备拍/静音拍/变速训练」只允许存在于注释的历史记录里）");
  ok(/aria-label="预备拍数"/.test(SURFACE), "★ 拍数输入的读屏名跟随新名（「预备拍数」）");
  /* 状态栏两条随改名同步（行为面在 t13/t70 钉，这里钉源码文案本身） */
  ok(/`预备 · \$\{idx \+ 1\} \/ \$\{ciBeats\}`/.test(html), "★ 预备期状态栏「预备 · N / M」");
  ok(/`静音 · 第 \$\{shownBar \+ 1\} 小节 · 心中默数`/.test(html), "★ 静音期状态栏「静音 · 第 N 小节 · 心中默数」");
}
