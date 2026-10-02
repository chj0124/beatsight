/* T162 · 预设库「左侧覆盖面板」（v3.3.0 第二批）
   ---------------------------------------------------------------------------
   场景组：预设库从「全宽内联抽屉」改为「左侧覆盖式浮层面板」。

   为什么要有这组断言：
   1. 这次改的是**容器语义**（内联 → 浮层），最容易发生的退化是"半改"——加了 fixed，
      却留着 `.viz-head-grid.lib-open #presetDrawer{grid-row:2}`，于是面板仍占栅格行、
      仍把「同屏行数与拍号」推下去（用户要求①就被破坏，而肉眼在宽屏上不一定看得出）；
   2. 覆盖式浮层的三件必备成本（遮罩点击关闭 / Esc / 焦点进出）是 v3.0.0 判「内联」时
      刻意省掉的，本轮补回——它们都是 DOM 级接线，桩里可断言，真机几何由 smoke 复核；
   3. 断言全部是源码文本级（同 t90/t110/t161 口径）；面板的真实几何（贴左缘 / 满视口高 /
      不推挤页面）由 tools/smoke.js 的 drawerProbe 在真实浏览器里验。

   ★ 本文件只测结构契约，不测观感；观感以真人验收为准。 */

const { section, ok, eq } = require("../lib/harness");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

section("T162a 面板与遮罩 · 覆盖式容器语义");

ok(/\.preset-drawer\{position:fixed;left:0;top:0;bottom:0;z-index:50;width:min\(392px,88vw\)/.test(src),
  "★★ 面板是 fixed 浮层、贴左缘满高、宽 min(392, 88vw)（窄屏自适应不撑破）");
ok(/\.pd-mask\{position:fixed;inset:0;z-index:45;background:rgba\(0,0,0,\.55\)\}/.test(src),
  "★★ 遮罩 fixed 满视口；z-index 45 = 面板(50)之下、播放底栏(40)之上——底栏也被压暗，语义一致");
ok(/<div class="pd-mask" id="presetMask" hidden><\/div>/.test(src),
  "★ 遮罩节点存在且默认 hidden（不是靠 opacity 藏——hidden 才是真不出现在无障碍树里）");
ok(src.includes('$("presetMask").addEventListener("click", () => setPresetDrawer(false));'),
  "★★ 点遮罩关闭：覆盖式浮层的必备退出路径（v3.0.0 判内联时省掉的那件）");
ok(src.indexOf('const btn = $("presetLibBtn"), dr = $("presetDrawer"), mask = $("presetMask");') >= 0
   && src.indexOf("dr.hidden = !open;") >= 0
   && src.indexOf("if (mask) mask.hidden = !open;") > src.indexOf("dr.hidden = !open;"),
  "★★ 开合时遮罩与面板**同显隐**（漏一个就会留下吃掉点击的孤影）");
ok(/\.preset-drawer\[hidden\]\{display:none\}/.test(src) && /\.pd-mask\[hidden\]\{display:none\}/.test(src),
  "★ 两者都尊重 hidden（display:none 兜底）");

section("T162b 防回潮 · 不得再有「内联占栅格行」的任何残留");

eq(src.includes(".viz-head-grid.lib-open"), false,
  "★★★ 三条 `.lib-open` 规则（抽屉占第 2 行 / 行数行下推第 3 行）已全部删除——留着就会出现「浮层仍占位」的半改状态");
eq(src.includes('classList.toggle("lib-open"'), false,
  "★★ JS 里也不再 toggle `.lib-open`（栅格不再需要知道面板开关）");
ok(src.includes(".viz-head-grid{display:grid") && !src.includes("grid-column:1 / 4;grid-row:2"),
  "★★ 行数拍号行自动落**第 4 轨**（不再显式占 r2）——面板是浮层，行数行位置与开合无关");

section("T162c 键盘契约 · Esc 关面板");

ok(/registerKeyLayer\(\{[\s\S]{0,300}const dr = \$\(\"presetDrawer\"\);\s*if \(!dr \|\| dr\.hidden \|\| e\.key !== \"Escape\"\) return false;\s*setPresetDrawer\(false\);/.test(src),
  "★★ Esc 关面板（registeredKeyLayer：面板收起时不消费 Esc，不跟编辑/编排等层抢键）");
ok(/const focusTarget = open \? \$\(\"presetSearch\"\) : \$\(\"presetLibBtn\"\);/.test(src),
  "★ 焦点进出：打开进搜索框、关闭归还主钮（「从哪来回哪去」）");

section("T162d 搜索框与列表契约未受改造影响");

ok(/<div class="pd-search">/.test(src) && /id="presetSearch"/.test(src),
  "★ 搜索框随面板一起搬（v3.1.0 A9 的过滤逻辑零改动）");
ok(/<div id="presetList"><\/div>/.test(src),
  "★★ #presetList 仍是**空容器**（条目由 JS 渲染、必须保持「列表直接子节点」契约——过滤用 hidden 不套 wrapper）");

section("T162e 日间主题面板头：角标不吃整行（标题逐字竖排防回潮，v3.12.0）");
{
  /* 用户实拍：日间（obs）主题下预设库面板标题「节奏型预设库」逐字竖排。
     根因：.pd-head 是 flex 行（角标 + 标题 + 收起按钮），而 obs 的卡片角标规则
     .sec-tag{width:100%} 在行内吃掉全部宽度 → 标题被挤到一字宽、逐字换行。
     修法与 .group-label .sec-tag 同款先例：行内容器里角标收成内容宽。 */
  ok(/body\[data-theme="obs"\] \.pd-head \.sec-tag\{display:inline-flex;width:auto;margin:0;flex:none\}/.test(src),
    "★★ obs 下 .pd-head 的角标收成内容宽（width:auto + flex:none）——"
    + "否则 width:100% 吃掉整行、标题逐字竖排");
  ok(/body\[data-theme="obs"\] \.sec-tag\{display:flex;align-items:baseline;gap:10px;width:100%/.test(src),
    "★ 卡片角标整行规则原样在位（它服务卡片头部，不许动；只在 .pd-head 作用域收宽）");
  ok(/<span class="sec-tag"><b>02<\/b><i>Library<\/i><\/span>\s*<span class="pd-title">节奏型预设库<\/span>/.test(src.replace(/\n\s*/g, " ")),
    "★ 面板头结构前提：角标与标题同处一行容器（.pd-head）");
}
