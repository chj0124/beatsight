/* 反向验证驱动（v3.42.1）：对 /tmp 副本逐项做「回退修复」变异，BEATSIGHT_HTML 指向副本
   跑对应用例，断言出现具名 ✗。铁律：锚点失配大声失败；崩溃（ReferenceError 等）不算证据。
   注：cum 缓存与 statusText「翻转才写」是纯性能项——新旧实现行为等价、无行为契约可红，
   不进变异清单；其正确性由 t234b/c 的等价性断言与既有 T22/T27/T79/T160 保障。 */
"use strict";
const fs = require("fs");
const { execSync } = require("child_process");
const SRC = fs.readFileSync("/workspace/index.html", "utf8");

const MUTATIONS = [
  { id: "M-P01-fold-and-nolap", cases: ["t232-resync-lap"], pairs: [
    { from: `    const posTicks = (nextNoteTime - loopStart) / spb() * TPB;
    let posT = posTicks % loopTicks;
    if (posT < 0) posT += loopTicks;
    const laps = Math.floor((posTicks - posT) / loopTicks);   // 已完整走过的圈数`,
      to: `    let posT = (nextNoteTime - loopStart) / spb() * TPB % loopTicks;
    if (posT < 0) posT += loopTicks;` },
    { from: `    let nextTicks = laps * loopTicks + b * barTicks + acc;
    if (nextTicks < posTicks - 1e-6) nextTicks += loopTicks;
    nextNoteTime = loopStart + nextTicks * spb() / TPB;`,
      to: `    nextNoteTime = loopStart + (b * barTicks + acc) * spb() / TPB;` }
  ] },
  { id: "M-P24-schedbar0", cases: ["t232-resync-lap"], pairs: [
    { from: `    const startBar = loopStartBar(patBars(activePattern()));
    if (sigChgPending && schedBarNow !== startBar) return {applied:false};
    const resetBar = sigChgPending ? startBar : schedBarNow;`,
      to: `    if (sigChgPending && schedBarNow !== 0) return {applied:false};
    const resetBar = sigChgPending ? 0 : schedBarNow;` }
  ] },
  { id: "M-P11-copy", cases: ["t233-import-and-mig"], pairs: [
    { from: `    Modal.uiConfirm("即将导入以下数据。各项写回语义以清单为准：标「替换」的会整包覆盖本机"
      + "对应内容（本机现有分组将被包内分组取代，且不可恢复）；标「新增 / 合并 / 跳过」的"
      + "不会删除本机已有内容：", () => {`,
      to: `    Modal.uiConfirm("即将导入以下数据（按「合并」语义写回，不会删除本机已有内容）：", () => {` }
  ] },
  { id: "M-P22-diagline", cases: ["t233-import-and-mig"], pairs: [
    { from: `      + (Store.migAttention() ? " · ⚠迁移未完成 ×" + Store.migAttention() : "")`,
      to: `      + (false ? " · ⚠迁移未完成 ×" + Store.migAttention() : "")` }
  ] },
  /* M-P25（S.sel 白名单）已随 P2-5 撤回而移除——「脏 sel 原样透传」是 T01/T6 · T30 · T185
     三条既有测试钉住的刻意设计，见 index.html Store 内 v3.42.1 审计备注。 */
  { id: "M-KA-lockreq", cases: ["t234-keepalive-frame"], pairs: [
    { from: `    if (lock || audioEl || lockReq) return;   // ★ v3.42.1：lockReq 拦「在途」重入（见上方标志声明处）`,
      to: `    if (lock || audioEl) return;` }
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
        { cwd: "/workspace", encoding: "utf8" });
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
