/* BeatSight 自动化测试 · 设置弹窗「恢复出厂设置」（v2.85.0，③b）
   T153 系列。
   ---------------------------------------------------------------------------
   契约（与 index.html L9656-9672 注释同源）：
     · 危险区「恢复出厂设置」→ 两步确认（第二次 danger 红钮「确认删除」）→
       停播放 → 枚举并删除全部 `beatsight.*` 键 → location.reload()。
     · 只删本应用前缀的键，不碰其它 origin 数据；reload 在桩里因 location 未注入而安全跳过。
   基准：预置若干本机数据（自定义预设 / 自定义曲式 / 设置 / 热数据 / 示例闩），
        以及一条非 beatsight 键用于验证「前缀过滤不误伤」。
   注：boot 期迁移会额外写入 beatsight.arrmig73 / beatsight.chdmig 等合法键，
       故键数**不**硬编码，改为记录前置基线、再对「清零 / 不变量」做断言。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

/* 预置一组有代表性的本机数据 */
function seed(){
  return {
    "beatsight.demoSeeded": "1",
    "beatsight.state": JSON.stringify({ v: 3, bpm: 120, showLyric: true, lyricPos: "auto" }),
    "beatsight.customs": JSON.stringify([{ id: "c1", name: "我的型", bars: [[{ t: 12 }]] }]),
    "beatsight.arranges": JSON.stringify({ v: 1, arranges: [{ id: "a1", name: "我的曲", sections: [] }] }),
    "beatsight.hot": JSON.stringify({ k: "v" }),
    "otherApp.data": "must-survive",        // 非本应用前缀 → 不应被清掉
  };
}
/* 当前 storage 里是否还有任何 beatsight.* 键 */
function beatsightKeys(store){
  return [...store.keys()].filter(k => k.indexOf("beatsight.") === 0);
}
/* 复刻点击路径：点按钮 → 点两次确认（两步确认） */
function clickReset(a){
  a.els["factoryResetBtn"].fire("click");   // 第 1 次 uiConfirm
  a.els["modalOk"].fire("click");           // 第 1 次确认 → 开第 2 次 danger 确认
  a.els["modalOk"].fire("click");           // 第 2 次确认 → 清键 + reload（桩里 reload 跳过）
}

section("T153a 恢复出厂设置 · 正向：两步确认后清空全部 beatsight.* 键");
{
  const a = loadApp(seed());
  const before = beatsightKeys(a.storage);
  ok(before.length >= 5, "前置：至少 5 个 beatsight.* 键在库（实际 " + before.length + "）");
  ok(a.storage.has("otherApp.data"), "前置：非 beatsight 键也在库");

  clickReset(a);

  eq(beatsightKeys(a.storage).length, 0, "★ 两步确认后全部 beatsight.* 键被删除（0 残留）");
  ok(!a.storage.has("beatsight.customs"), "★ 自定义预设键已删");
  ok(!a.storage.has("beatsight.arranges"), "★ 自定义曲式键已删");
  ok(!a.storage.has("beatsight.state"), "★ 设置键已删");
  ok(!a.storage.has("beatsight.hot"), "★ 热数据键已删");
  ok(!a.storage.has("beatsight.demoSeeded"), "★ 示例闩也已清（reload 后由 init 重新带出）");
  ok(a.storage.has("otherApp.data"), "★ 非 beatsight 键被前缀过滤保留（不误伤）");
}

section("T153b 恢复出厂设置 · 取消护栏：第 1 步点取消则不删任何数据");
{
  const a = loadApp(seed());
  const before = beatsightKeys(a.storage).length;
  ok(before >= 5, "前置：至少 5 个 beatsight.* 键在库（实际 " + before + "）");

  a.els["factoryResetBtn"].fire("click");   // 开第 1 次 uiConfirm
  a.els["modalCancel"].fire("click");       // 取消 → 不应进入第 2 步，也不删数据

  eq(beatsightKeys(a.storage).length, before, "★ 取消后所有 beatsight.* 键原样保留（无静默清除）");
  ok(a.storage.has("beatsight.customs"), "自定义预设键仍在");
  ok(a.storage.has("otherApp.data"), "非 beatsight 键仍保留");
}

section("T153c 恢复出厂设置 · 只确认第 1 步、不确认第 2 步 → 仍不删（双确认缺一则无效）");
{
  const a = loadApp(seed());
  const before = beatsightKeys(a.storage).length;
  ok(before >= 5, "前置：至少 5 个 beatsight.* 键在库（实际 " + before + "）");

  a.els["factoryResetBtn"].fire("click");   // 第 1 次 uiConfirm
  a.els["modalOk"].fire("click");           // 第 1 步确认 → 开第 2 步 danger 确认
  a.els["modalCancel"].fire("click");       // 第 2 步取消 → 不清

  eq(beatsightKeys(a.storage).length, before, "★ 第 2 步取消 → 数据全部保留（双确认缺一不可）");
}
