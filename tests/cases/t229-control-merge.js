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

section("T229a 折叠钮合一：#ctlOpen 单开关 + 一枚胶囊双实时值");
{
  const { els } = loadApp();
  ok(html.indexOf('id="ctlOpen"') > 0, "★ 合并折叠开关 #ctlOpen 在标记里");
  ok(html.indexOf('id="volOpen"') < 0 && html.indexOf('id="bpmOpen"') < 0,
    "★★ 原「音量 / BPM」两枚折叠开关（volOpen/bpmOpen）已从标记除名");
  /* 胶囊行只剩一枚，且两枚实时值（节拍 % · BPM）都住进同一枚胶囊 */
  const pills = html.match(/class="ctl-pills">[\s\S]*?<\/div>/) || [""];
  eq((pills[0].match(/<label/g) || []).length, 1, "★★ 窄屏胶囊行只剩一枚（两枚合一）");
  ok(/class="ctl-pills">[\s\S]*?for="ctlOpen"[\s\S]*?id="volPillPctN"[\s\S]*?id="bpmPillNumN"[\s\S]*?<\/div>/.test(html),
    "★★ 合并胶囊同时携带节拍音量 %（#volPillPctN）与当前 BPM（#bpmPillNumN）——收起时读数不丢");
  /* 组标签也挂同一个开关（宽屏点标签 = 窄屏点胶囊，同一件事） */
  ok(/<label class="group-label ctl-hit" for="ctlOpen"/.test(html),
    "★ 合并组标签挂 #ctlOpen（原 for=volOpen 随两开关合一改挂）");
  /* 实时值接线：改 BPM / 拖节拍音量，胶囊两枚值各自跟随 */
  ok(typeof els["bpmPillNumN"] !== "undefined" && typeof els["volPillPctN"] !== "undefined",
    "★ 两枚实时值 span 在桩上可取到（接线对象存在）");
}

section("T229b 折叠语义：一枚开关管整块（音量 + BPM + 开关组）");
{
  const { els } = loadApp();
  els["bpmPlus5"].fire("pointerdown");
  eq(els["bpmPillNumN"].textContent, "101", "★ setBpm 路径 → 胶囊 BPM 值实时跟随（±5 生效）");
  els["volMaster"].value = "39";
  els["volMaster"].fire("input");
  eq(els["volPillPctN"].textContent, "39%", "★ 音量 input 路径 → 胶囊节拍 % 实时跟随");
  /* CSS 侧：收起规则全部改挂 #ctlOpen，且开关组随它一起收 */
  ok(/#ctlOpen:not\(:checked\) ~ \.card-head \.card-head-left\{display:none\}/.test(html)
     && /#ctlOpen:not\(:checked\) ~ \.viz-toggles\{display:none\}/.test(html),
    "★★ 收起 = 合并组整块 + 开关组一起不参与排布（原 volOpen/bpmOpen 分治规则退役）");
  ok(/#ctlOpen:checked ~ \.ctl-pills \.ctl-hit\[for=ctlOpen\]::after\{content:"▾"\}/.test(html),
    "★ 展开态箭头 ▾ 随合并开关翻转（收起 ▸ / 展开 ▾）");
  ok(!/volOpen|bpmOpen/.test(html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "")),
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
