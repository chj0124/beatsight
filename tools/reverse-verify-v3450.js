/* 反向验证驱动（v3.45.0 · 设置页 tab 化）：对 /tmp 副本逐项做「回退修复」变异，
   BEATSIGHT_HTML 指向副本跑 t236-settings-tabs，断言出现具名 ✗。
   铁律：锚点失配大声失败；崩溃（ReferenceError 等）不算证据。
   变异清单（三处新逻辑各退一步）：
   · M-TAB-ARIA   删掉 activate 的 aria-selected 同步 ⇒ t236b「选中态同步」变红
   · M-TAB-HIDDEN 删掉 activate 的面板 hidden 同步 ⇒ t236b「面板收起/单页制」变红
   · M-TAB-ANCHOR 删掉 open 的锚点直达激活（恒回首页）  ⇒ t236d「latGroup 先激活声音页」变红 */
"use strict";
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const MUTATIONS = [
  { id: "M-TAB-ARIA", cases: ["t236-settings-tabs"], pairs: [
    { from: `      t.setAttribute("aria-selected", on ? "true" : "false");\n`,
      to: `` }
  ] },
  { id: "M-TAB-HIDDEN", cases: ["t236-settings-tabs"], pairs: [
    { from: `      $(p.pane).hidden = !on;\n`,
      to: `` }
  ] },
  { id: "M-TAB-ANCHOR", cases: ["t236-settings-tabs"], pairs: [
    { from: `    activate(anchor && ANCHOR_TAB[anchor] ? ANCHOR_TAB[anchor] : TABS[0].tab, false);`,
      to: `    activate(TABS[0].tab, false);` }
  ] },
];

let bad = 0;
for (const m of MUTATIONS){
  let mutant = SRC, anchorMiss = false;
  for (const p of m.pairs){
    if (!mutant.includes(p.from)){ anchorMiss = true; break; }
    mutant = mutant.replace(p.from, p.to);
  }
  if (anchorMiss){
    console.log("✗✗✗ 锚点失配（变异 " + m.id + "）——大声失败");
    bad++; continue;
  }
  const tmp = "/tmp/mutant-" + m.id + ".html";
  fs.writeFileSync(tmp, mutant);
  let out = "";
  for (const c of m.cases){
    try{
      out += execSync("BEATSIGHT_HTML=" + tmp + " node tests/cases/" + c + ".js 2>&1",
        { cwd: ROOT, encoding: "utf8" });
    }catch(e){ out += (e.stdout || "") + String(e.stderr || ""); }
  }
  const crashed = /ReferenceError|SyntaxError|TypeError/.test(out);
  const fails = (out.match(/✗/g) || []).length;
  const names = out.split("\n").filter(l => l.includes("✗")).slice(0, 2).map(l => l.trim().slice(0, 66));
  if (crashed){
    console.log("✗✗✗ " + m.id + " → 应用崩溃（崩溃不算证据，变异本身非法）");
    bad++;
  } else if (fails > 0){
    console.log("✓ " + m.id + " → " + fails + " 个具名 ✗（变异被当场抓住）");
    names.forEach(n => console.log("     · " + n));
  } else {
    console.log("✗ " + m.id + " → 0 个 ✗（变异未被抓住 = 测试是橡皮图章）");
    bad++;
  }
  fs.unlinkSync(tmp);
}
console.log(bad === 0 ? "\n反向验证：全部 " + MUTATIONS.length + " 个变异都被具名 ✗ 抓住 ✓"
  : "\n反向验证：有 " + bad + " 个变异未通过 ✗");
process.exit(bad === 0 ? 0 : 1);
