/* T208 出厂默认壁纸已移除
   ---------------------------------------------------------------------------
   默认状态不得再内嵌或自动应用背景图；自定义壁纸仍走既有校验与存储管线。
   这条契约同时守住运行态、首屏 DOM 和内置资源三个面，防止只隐藏图片却把
   大段 base64 留在单文件里。 */
const { loadApp, ok, eq, section, html } = require("../lib/harness");

section("T208 出厂无默认壁纸 · 无内置位图 · 首屏无残留");
{
  const { beat, els, storage } = loadApp();
  eq(beat.wallState(), null, "★ 首次打开没有壁纸状态");
  eq(els["wallLayer"].hidden, true, "★ 首屏背景层保持隐藏");
  eq(els["wallLayer"].style.backgroundImage, "", "★ 首屏不写入 background-image");
  eq(storage.get(beat.WALL_KEY), undefined, "★ 无图默认态不落盘");
  eq(beat.WALL_DEFAULT, undefined, "★ 调试接口不再暴露默认壁纸常量");
  ok(!/const WALL_DEFAULT\s*=/.test(html), "★ 源码不再声明 WALL_DEFAULT");
  ok(!/data:image\/jpeg;base64,\/9j\/4AAQSkZJRgABAQAASABIAAD/.test(html),
    "★ 原内置 JPEG 数据已从单文件删除，不是只做视觉隐藏");
}
