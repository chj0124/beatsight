/* T276：歌词/音符行级历史模块的独立契约。 */
"use strict";
const { loadApp, ok, eq, section } = require("../lib/harness");

section("T276 LyricHistory 字与谱同事务、空行恢复与栈边界");
{
  const app = loadApp();
  const { beat } = app;
  ok(!!beat.LyricHistory, "★ LyricHistory 模块已暴露");
  if (!beat.LyricHistory) return;
  const LH = beat.LyricHistory;
  eq(["commit", "undo", "redo", "snapshot"].every(k => typeof LH[k] === "function"), true,
    "★ 提供 commit / undo / redo / snapshot 独立接口");
  const arr = beat.Store.upsertArrange({ name: "历史边界", sections: [{ name: "段", blocks: [{ ref: { type: "builtin", idx: 0 }, repeats: 1 }] }] });
  const id = arr.id;
  const uid = arr.sections[0].uid;
  const chars = [{ t: 0, dur: 48, ch: "甲" }];
  const notes = [{ t: 0, dur: 48, p: 60 }];

  LH.commit(id, uid, chars, { notes });
  eq(beat.Store.findLyric(id, uid).chars[0].ch, "甲", "提交写入字");
  eq(beat.Store.findLyric(id, uid).notes[0].p, 60, "提交同时写入谱");
  LH.commit(id, uid, [], { notes: [] });
  eq(beat.Store.findLyric(id, uid), null, "字与谱都空时删除行");
  eq(LH.undo(id, uid), true, "撤销空行恢复成功");
  eq(beat.Store.findLyric(id, uid).chars[0].ch, "甲", "撤销同时恢复字");
  eq(beat.Store.findLyric(id, uid).notes[0].p, 60, "撤销同时恢复谱");
  eq(LH.redo(id, uid), true, "重做删除成功");
  eq(beat.Store.findLyric(id, uid), null, "重做后重新删除行");

  LH.commit(id, uid, [{ t: 0, dur: 48, ch: "乙" }]);
  LH.undo(id, uid);
  LH.commit(id, uid, [{ t: 0, dur: 48, ch: "丙" }]);
  eq(LH.redo(id, uid), false, "新提交清空 redo 分叉");
  for (let i = 0; i < 60; i++) LH.commit(id, uid, [{ t: 0, dur: 48, ch: "字" + i }]);
  eq(LH.histGet(id, uid).undo.length <= 50, true, "撤销栈最多保留 50 步");
}
