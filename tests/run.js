/* ================================================================================
   BeatSight 自动化测试 · 装配入口
   运行：node tests/run.js
   ---------------------------------------------------------------------------
   本文件只负责「按序装配 + 汇总退出」：
     · 环境与桩：tests/lib/harness.js（vm 沙箱、DOM/音频 stub、drive/driveFrames、断言工具）
     · 用例：tests/cases/*.js，每个文件一个场景组，靠 require 顺序决定执行顺序
   环境变量 BEATSIGHT_HTML 可指向别的构建（用于历史版本对照）。
   ================================================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const h = require("./lib/harness");

/* 场景组装配顺序 = 执行顺序。新增文件请追加到末尾，保持既有用例的报错定位稳定。 */
/* 场景组装配顺序 = 执行顺序（v3.31.x 落地审计 E7 起只留路径清单）。
   ★ 顺序敏感、禁止重排：用例共享模块级状态（PROBE/ROW_W 等），执行顺序即 require 顺序；
     清单里的乱序（如 t154 在 t150 与 t151 之间）是历史既成事实，不要"顺手理顺"。
   ★ 版本号与主题自述不再写在这里（曾腐坏：t154 插队违反"追加末尾"、一行挤三个注释）——
     每个 case 文件的版本归属看文件内注释与 CHANGELOG；本清单只承担"执行哪些、以何顺序"。
   ★ 新增文件请追加到末尾，保持既有用例的报错定位稳定。 */
const CASE_FILES = [
  "./cases/t01-store-and-presets",
  "./cases/t08-beat-model",
  "./cases/t13-timbre-and-controllers",
  "./cases/t20-pattern-switching",
  "./cases/t23-dirty-value-robustness",
  "./cases/t24-audit-hardening",
  "./cases/t30-wiring-and-lifetime",
  "./cases/t37-training-and-keepalive",
  "./cases/t47-stroke-direction",
  "./cases/t49-ear-training",
  "./cases/t51-arrangement-model",
  "./cases/t52-arrangement-cursor",
  "./cases/t53-arrangement-playback",
  "./cases/t54-arrangement-ui",
  "./cases/t55-help",
  "./cases/t56-diagnostics",
  "./cases/t57-overlay-listeners",
  "./cases/t58-p0-audit",
  "./cases/t59-p1-audit",
  "./cases/t60-lyric-align",
  "./cases/t61-lyric-loop",
  "./cases/t62-strum-zone",
  "./cases/t63-demo-song",
  "./cases/t65-practice-loop",
  "./cases/t66-mode-contract",
  "./cases/t67-service-worker",
  "./cases/t68-whole-song-and-voices",
  "./cases/t69-pattern-length",
  "./cases/t70-arrange-window",
  "./cases/t71-editor-bars",
  "./cases/t72-loop-rewind-ball",
  "./cases/t73-arrange-mode-exit",
  "./cases/t74-demo-version-migration",
  "./cases/t75-page-flip-preview",
  "./cases/t76-voices-and-lyric-audible",
  "./cases/t77-jump-loop-release",
  "./cases/t78-bar-chord-names",
  "./cases/t79-viz-rows",
  "./cases/t80-countin-arrange-no-reenter",
  "./cases/t81-wiring-slots",
  "./cases/t82-keepalive-fallback",
  "./cases/t83-full-data-pack",
  "./cases/t84-sidebar-zones",
  "./cases/t85-sidebar-fold",
  "./cases/t86-tab-toggle-boot-sync",
  "./cases/t87-preset-row-window",
  "./cases/t88-demo-range-slider",
  "./cases/t89-narrow-range-next-row",
  "./cases/t90-control-layout",
  "./cases/t91-migration-matrix",
  "./cases/t92-wallpaper",
  "./cases/t93-first-open-defaults",
  "./cases/t94-space-global",
  "./cases/t95-latency-compensation",
  "./cases/t96-adaptive-slice",
  "./cases/t97-builtin-rename",
  "./cases/t98-sidebar-groups",
  "./cases/t99-preset-wrap-feel",
  "./cases/t100-preset-standby-preview",
  "./cases/t101-zone-groups-dnd",
  "./cases/t102-settings-help",
  "./cases/t103-lyric-sec-uid",
  "./cases/t104-arrange-editor-v3",
  "./cases/t105-arrange-templates",
  "./cases/t106-sec-card",
  "./cases/t107-practice-panel",
  "./cases/t108-lyric-collapse",
  "./cases/t109-new-entry",
  "./cases/t110-crosslink",
  "./cases/t111-cross-row-ball",
  "./cases/t112-playhead-gap-sweep",
  "./cases/t113-rename-btn-clickable",
  "./cases/t114-rest-toggle",
  "./cases/t115-lyric-rhythm-align",
  "./cases/t116-arrange-rename-drag",
  "./cases/t117-tap-magnet",
  "./cases/t118-lyric-undo",
  "./cases/t119-drag-threshold",
  "./cases/t120-ghost-droptarget",
  "./cases/t121-tap-context",
  "./cases/t122-preview",
  "./cases/t123-batch-shift",
  "./cases/t124-drag-2d",
  "./cases/t125-theme-day",
  "./cases/t126-persist-target",
  "./cases/t127-block-ops-move-n",
  "./cases/t128-arrange-undo-redo",
  "./cases/t129-candidate-preview",
  "./cases/t130-range-dedup",
  "./cases/t131-css-orphan-cleanup",
  "./cases/t132-experience-efficiency",
  "./cases/t133-experience-keyboard",
  "./cases/t134-selective-import-export",
  "./cases/t136-latency-chip",
  "./cases/t137-loop-panel-compact",
  "./cases/t138-viz-label-toggles",
  "./cases/t140-mute-cfg",
  "./cases/t141-pattern-label",
  "./cases/t142-trainer-target-empty",
  "./cases/t144-block-chords",
  "./cases/t145-pat-viz",
  "./cases/t146-cur-sec",
  "./cases/t147-range-fill",
  "./cases/t148-chip-capsule",
  "./cases/t149-lyric-follow",
  "./cases/t150-follow-countin-preview",
  "./cases/t154-lyric-position",
  "./cases/t151-settings-groups",
  "./cases/t152-demo-reset",
  "./cases/t153-factory-reset",
  "./cases/t155-scroll-mode",
  "./cases/t156-loopwrap-firstlap",
  "./cases/t157-viz-legend",
  "./cases/t158-preset-audition",
  "./cases/t159-assembly-wiring",
  "./cases/t160-scroll-countin-preroll",
  "./cases/t161-play-bar",
  "./cases/t162-preset-panel",
  "./cases/t163-param-slot",
  "./cases/t164-visual-semantics-b1",
  "./cases/t165-info-arch-b2",
  "./cases/t166-viz-band-centering-b3",
  "./cases/t167-touch-target-b4",
  "./cases/t168-toggle-slot-b5",
  "./cases/t169-scroll-fixes",
  "./cases/t170-status-pb",
  "./cases/t171-count-lane-exit",
  "./cases/t172-countlane-rebuild-hide",
  "./cases/t173-layout-decouple",
  "./cases/t174-four-features",
  "./cases/t175-v316-fixes",
  "./cases/t176-countin-entrance",
  "./cases/t177-headgrid-align",
  "./cases/t178-lane-effect-and-widefull",
  "./cases/t179-import-ref-remap",
  "./cases/t180-audit-v331x",
  "./cases/t181-audit-v3316",
  "./cases/t182-audit-v3316",
  "./cases/t183-parity-online-note",
  "./cases/t184-quota-one-shot",
  "./cases/t185-rhy-beat-split",
  "./cases/t186-scroll-lyric-entry-row",
  "./cases/t188-countin-lyric-rest-x",
  "./cases/t189-lyric-clip-last-row",
  "./cases/t190-viz-clip-single-source",
  "./cases/t191-clip-live-geometry",
  "./cases/t192-day-layout-rules",
  "./cases/t193-empty-lyric-row",
  "./cases/t195-slot-force-retract",
  "./cases/t196-aux-visibility",
  "./cases/t198-random-implies-mute",
  "./cases/t199-write-fail-and-disabled-reason",
  "./cases/t200-wall-recompress",
  "./cases/t201-t16-ruler",
  "./cases/t202-lyric-time-order",
  "./cases/t203-preset-group-style",
  "./cases/t204-refine-groups",
  "./cases/t205-viz-legend-restore",
  "./cases/t206-rowofy-hit-test",
  "./cases/t207-bg-throttle-hint",
  "./cases/t208-builtin-wallpaper-budget",
  "./cases/t209-demo2-song",
  "./cases/t210-outline-nav",
  "./cases/t211-preset-song-tree",
  "./cases/t212-song-binding",
  "./cases/t213-dblclick-play",
  "./cases/t214-demo2-chord-typo",
  "./cases/t215-help-entry-wording",
  "./cases/t216-persist-dedup",
  "./cases/t217-preset-export-fields",
  "./cases/t218-migration-stamp-reentry",
  "./cases/t219-boundaries",
  "./cases/t220-mute-phase-contract",
  "./cases/t221-bottom-bar-and-playing-dot",
  "./cases/t222-melody-pitch",
  "./cases/t223-melody-notes",
  "./cases/t224-melody-subdiv",
  "./cases/t226-jianpu-glyph",
  "./cases/t225-note-edit",
  "./cases/t227-pitch-right-slot",
  "./cases/t228-accidental-system",
  "./cases/t229-control-merge",
  "./cases/t230-bpm-tower-layout",
  "./cases/t231-control-core",
  "./cases/t232-resync-lap",
  "./cases/t233-import-and-mig",
  "./cases/t234-keepalive-frame",
  "./cases/t235-brand-swap",
];
/* v2.8.16（审计 P2-2）：CASE_FILES 是手工维护的执行顺序清单，而 tests/cases/ 目录才是真相源。
   新增一个用例文件却忘了登记进 CASE_FILES，它会**静默地不被执行**——PASS 数照旧好看却少了整组
   断言，是比失败更危险的假绿（历史上有过"文件在、没被 require"的先例）。
   故启动时把目录内容与清单**双向对账**，任一方向漂移即报错退出（退出码 1 = 真失败，非工具故障）。 */
{
  const listed = new Set(CASE_FILES.map(f => path.basename(f) + ".js"));
  const onDisk = new Set(fs.readdirSync(path.join(__dirname, "cases")).filter(f => f.endsWith(".js")));
  const unlisted = [...onDisk].filter(f => !listed.has(f));   // 目录有、清单没有 → 静默漏测
  const missing  = [...listed].filter(f => !onDisk.has(f));   // 清单有、目录没有 → require 必失败
  if (unlisted.length || missing.length){
    console.error("✗ 用例清单与 tests/cases/ 不一致（闸门 P2-2）：");
    if (unlisted.length) console.error("  未登记进 CASE_FILES（不会被执行）：" + unlisted.join("、"));
    if (missing.length)  console.error("  CASE_FILES 中存在但目录缺失：" + missing.join("、"));
    console.error("  请使两者一致后重跑（新增用例请追加到 CASE_FILES 末尾）。");
    process.exit(1);
  }
}
/* ── 分块执行（v3.39.0）：只在覆盖率插桩在场时启用 ──────────────────────────────
   【根因】NODE_V8_COVERAGE 开启时 V8 为**每个评估过的脚本**保留块级计数且不复用：
   182 个用例文件、每个至少 loadApp 一次（整份 index.html 重新进 vm），插桩数据随装载
   次数线性累积（实测 ~36MB/文件），单进程峰值超 4GB——本沙箱 cgroup memory.max=4GiB，
   实测爬到 3.6GB 即被 SIGKILL（spawnSync 退出码 null），check-all 把它记成「自动化测试 ✗」。
   --max-old-space-size 抬不动这颗雷：cgroup 在 V8 上限之前动手（抬上限只改死法）。
   【修法】切成每块 40 个文件的连续切片、每块一个子进程**顺序**跑：插桩内存只随本块
   装载次数增长，单块峰值 ~1.7GB（对 4GiB cgroup 留 2 倍余量）。子进程各写各的
   coverage-<pid>-*.json，check-coverage --reuse 本来就汇总目录下全部 JSON，合并口径零改动。
   【取舍】不开覆盖率时走原单进程路径——reverse-verify / 本地开发 / hang-guard 的口径
   全部不变；共享模块级态（PROBE / ROW_W / SCROLL_W / rowSeq）已逐一核实为「每次
   loadApp 重置」或「增量断言」，无跨块依赖——若有暗依赖，分块跑对不上单进程的
   PASS 总数，现象会自己暴露。块内顺序 = 清单顺序切片，「顺序敏感、禁止重排」不破。
   每用例一个子进程的先例：tests/hang-guard.js。BS_TEST_CHUNK_SIZE 可覆盖块大小（排障用）。 */
const CHUNK_SIZE = +(process.env.BS_TEST_CHUNK_SIZE || 40);
if (process.env.NODE_V8_COVERAGE && process.env.BS_TEST_CHUNK === undefined){
  const { spawnSync } = require("child_process");
  const os = require("os");
  const count = Math.ceil(CASE_FILES.length / CHUNK_SIZE);
  console.log(`▸ 插桩分块：${CASE_FILES.length} 个用例 → ${count} 块（每块 ≤ ${CHUNK_SIZE} 个）顺序执行`);
  let pass = 0, fail = 0; const bad = [];
  for (let ci = 0; ci < count; ci++){
    const resFile = path.join(os.tmpdir(), `bs-chunk-${process.pid}-${ci}.json`);
    const r = spawnSync(process.execPath, process.execArgv.concat([__filename]), {
      stdio: "inherit",
      env: Object.assign({}, process.env, {
        BS_TEST_CHUNK: String(ci), BS_TEST_CHUNK_RESULT: resFile,
      }),
    });
    let j = null;
    try { j = JSON.parse(fs.readFileSync(resFile, "utf8")); } catch(e){}
    fs.rmSync(resFile, { force: true });
    if (j){ pass += j.pass; fail += j.fail; }
    if (!j || r.status !== 0) bad.push(`第 ${ci + 1}/${count} 块（退出码 `
      + (r.status === null ? "null = 被信号杀" : r.status) + (j ? "" : "；未写回结果文件") + "）");
  }
  console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL（${count} 块聚合）`);
  if (bad.length){ console.log("失败块：\n - " + bad.join("\n - ")); process.exit(1); }
  process.exit(0);
}
const SLICE = process.env.BS_TEST_CHUNK === undefined ? null : +process.env.BS_TEST_CHUNK;
for (const f of (SLICE === null ? CASE_FILES
  : CASE_FILES.slice(SLICE * CHUNK_SIZE, (SLICE + 1) * CHUNK_SIZE))) require(f);

const { pass, fail, failNames } = h.stats();
/* 子进程（分块）把本块计数写回结果文件，由父进程聚合（stdio 是 inherit，父进程读不到 stdout） */
if (process.env.BS_TEST_CHUNK_RESULT){
  try { fs.writeFileSync(process.env.BS_TEST_CHUNK_RESULT, JSON.stringify({ pass, fail })); } catch(e){}
}
console.log(`\n========================================\n结果：${pass} PASS / ${fail} FAIL`);
if (fail){ console.log("失败项：\n - " + failNames.join("\n - ")); process.exit(1); }
