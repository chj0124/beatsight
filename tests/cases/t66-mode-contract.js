/* BeatSight 自动化测试 · 模式字段契约（v2.4.4，审计收口）
   T66 系列。
   ---------------------------------------------------------------------------
   契约（共享状态区 setMode）：
     ① 值域白名单：playing/preview 只收布尔，playMode 只收 "preset"/"arrange"；
        非法值**拒写**（S 里的旧值不动）并返回 false；
     ② 同值幂等：重复赋同值返回 true 但**不产生**迁移轨迹（stop() 被连调不该留痕）；
     ③ 迁移轨迹：每次真实迁移进 modeTrail（含字段/新值/原因），可经 modeTrailView 只读读取；
     ④ 刻意**不做互斥**：preview=true 与 playing=true 合法共存（试听流程本就如此）——
        这条用"试听走完全程不炸、轨迹里两者都在"来钉，防止日后有人把臆想的互斥补进去。

   反向验证口径：把 setMode 里的白名单判断删掉 → T66a 立刻红（非法值进 S）。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

section("T66 模式字段契约（setMode）");

{ // T66a：非法值拒写，S 不被污染
  const { beat } = loadApp();
  const S = beat.Store.S;
  const before = S.playMode;
  eq(beat.setMode("playMode", "jazz"), false, "非法 playMode 值被拒写");
  eq(S.playMode, before, "拒写后 S.playMode 保持原值");
  eq(beat.setMode("playing", "yes"), false, "playing 的非布尔值被拒写");
  eq(S.playing, false, "拒写后 S.playing 仍为 false");
  eq(beat.setMode("noSuchField", 1), false, "未登记的字段被拒写");
}

{ // T66b：合法迁移进轨迹；同值幂等不进轨迹
  const { beat } = loadApp();
  const n0 = beat.modeTrailView().length;
  eq(beat.setMode("playMode", "arrange", "测试迁移"), true, "合法迁移被接受");
  eq(beat.Store.S.playMode, "arrange", "迁移后 S.playMode 已更新");
  const t1 = beat.modeTrailView();
  eq(t1.length, n0 + 1, "一次真实迁移 = 一条轨迹");
  eq(t1[t1.length - 1].why, "测试迁移", "轨迹带迁移原因");
  eq(beat.setMode("playMode", "arrange", "再来一次"), true, "同值重写返回 true（幂等）");
  eq(beat.modeTrailView().length, n0 + 1, "同值重写不产生新轨迹");
}

{ // T66c：preview 与 playing 合法共存（试听流程的真实顺序）——防有人补臆想的互斥规则
  const { beat } = loadApp();
  eq(beat.setMode("preview", true, "试听在先"), true, "preview=true 被接受");
  eq(beat.setMode("playing", true, "start"), true, "preview=true 时 playing=true 同样被接受（试听流程）");
  ok(beat.Store.S.preview && beat.Store.S.playing, "两态合法共存——契约不含互斥规则（试听流程依赖它）");
}

/* ================= 场景 T66d：产物戳记自检 =================
   部署闸门缺口的可读化：线上域名 + 无戳记 meta → noStamp 计数 +1；
   file:// / localhost / 无 location → 不查（本地副本无戳记是预期）。 */
section("T66d 产物戳记自检（stampCheck）");
{
  const online = loadApp({}, { location: { search: "", protocol: "https:", hostname: "beatsight.example.workers.dev" } });
  eq(online.beat.diag.noStamp, 1, "线上域名 + 无戳记 meta → noStamp +1（这次部署没过自验链）");
  eq(online.beat.diag.stampMismatch, 0, "戳记缺失不算版本不符（缺席不是罪证）");

  const local = loadApp({}, { location: { search: "", protocol: "http:", hostname: "127.0.0.1" } });
  eq(local.beat.diag.noStamp, 0, "本机 http（127.0.0.1，含 smoke 通道）不查戳记");

  const noLoc = loadApp();
  eq(noLoc.beat.diag.noStamp, 0, "无 location（file:// 语义）不查戳记");
}
