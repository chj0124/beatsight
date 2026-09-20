# BeatSight 审计落地任务清单（tasks.md）

> **历史快照 · 已归档**（2026-09-17 审计，基线 `v2.0.2`）
> 本文件是那次审计的**落地清单**：其中的耗时、步数、覆盖率、行号均为**当时实测值，会随代码演进漂移**，
> 不作实时依据——当前口径一律以 `node tools/check-all.js` 的实际输出为准。

> 来源：`spec.md`（全维度代码审计与迭代规划）
> 约束：直接提交推送 `main`，不建分支、不开 PR；推送前 `node tools/check-all.js` 须全绿。
> 标注：`[A]` 高收益低成本 · `[B]` 高收益高成本 · `[C]` 低收益低成本 · `[P0/P1/P2]` 功能项

---

## 阶段 A｜信任修复 + 工程卫生（先做，可合并一次提交）

- [x] **A1-1** `README.md` L19：将「约 6 秒」改为实测口径（快速 `--quick` 约 10.7s / 完整约 17.3s）。
- [x] **A1-2** `README.md` L25：删除/改写「它不开严格模式」为「已开启全部 strict 家族开关（见 `tools/tsconfig.typecheck.json`）」。
- [x] **A1-3** `docs/DEVELOPMENT.md` §5（约 L360）：同步修正耗时口径。
- [x] **A1-4** `tools/check-all.js` 头部注释：修正「约 2–3 秒」。
- [x] **A2** `tools/check-coverage.js` L26–29：去掉过期版本号，改为运行时读取 `VERSION` 或删除括号内版本。
- [x] **A3** `tools/check-dom-ids.js` L39：补 `baseLine` 偏移，使行号与 index.html 绝对行一致（复用 `check-eslint.js` 实现）。
- [x] **A4** `.gitignore` 增加 `.uploads/`；`git rm --cached` 已跟踪的 2 个 PNG。
- [x] **A5** `tools/check-all.js` 支持 `--strict-env`：`CI=true` 且可选步骤缺依赖时报错（不再静默 ⊘）。

## 阶段 C｜低收益低成本（顺手清零，可与阶段 A 合并）

- [x] **C1** 抽 `clear(el)` 工具函数，替换 17 处 `innerHTML = ""`。
- [x] **C2** 清理 5 个未引用 id：`argBar` / `editorCardTitle` / `editorDot` / `earHead` / `earDot`。
- [x] **C3** 新增 `_headers`（部署产物）下发 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。
- [x] **C4** `package.json` 补 `version` / `engines` / `test` 脚本字段。
- [x] **C5** `<script>` 开头加「16 模块索引注释块」（模块名 + 起始行）。

## 阶段 B｜可观测性与架构健康（中期）

- [x] **B1 / P1-1** 新增隐藏诊断面板（`?debug=1`），聚合掉帧 / 调度饥饿 / 持久化失败 / 限流脉冲计数器（复用 `onFrameError`/`onSchedError`/`onLimitPulse`）。
- [x] **B2** 统一 `Modal` 打开/关闭的监听器注册与清理协议，补内存回归用例。
- [x] **B3** 约定「新功能 UI 内聚于各模块，`Controls` 仅转发事件」；在 `check-module-order.js` 增加扇出上限告警。
- [x] **B4** 将 Cloudflare build 命令落到 `wrangler.jsonc` 可版本化字段，使本地可复现部署。

## 功能迭代 P0（核心）

- [ ] **P0-1 音频延迟校准**：新增 `Calibration` 模块（插在 `Audio` 后）；手动敲击采集中位数偏移；经 `Audio.setLatencyOffset(fn)` 注入补偿；偏移持久化。登记 R3 `Audio→Calibration`。
- [ ] **P0-2 渐进提速训练**：`Trainer` 扩展 `startBPM/targetBPM/stepBPM/barsPerStep`；跨小节边界提速；接入 `Stats` 记录达成最高 BPM。
- [ ] **P0-3 练习数据导出/导入增强**：全量导出 + schema 版本校验 + 导入合并/覆盖三态；按 `VERSION` 做前向兼容拒绝。

## 功能迭代 P1（体验）

- [ ] **P1-2** 键盘快捷键体系（`Controls` 内集中注册 + 输入框焦点豁免）。
- [ ] **P1-3** PWA 安装引导（`beforeinstallprompt`）。
- [ ] **P1-4** 节奏分享（URL hash 紧凑编码 + 解码导入）。
- [ ] **P1-5** 可视化无障碍增强（对比度/尺寸令牌）。

## 功能迭代 P2（探索，需产品决策前置）

- [ ] **P2-1** 麦克风演奏准确度分析（需 `https://`，冲击 `file://` 卖点）。
- [ ] **P2-2** 本地算法生成练习律动（零依赖可离线）。
- [ ] **P2-3** 多设备数据同步（需后端，冲击零依赖 + 单文件红线）。
- [ ] **P2-4** 社区节奏库（静态清单 + CDN，需离线回退与内容审核）。

---

## 验收与提交纪律

- 每次提交前：`node tools/check-all.js` 必须「全部通过」。
- 涉及 `index.html` 模块新增/调整时：`tools/check-module-order.js` 的 R1/R2/R3/R4 必须全绿（新回调须登记 WHITELIST 原因，过期条目须删除；扇出超限须显式抬高 `MAX_FANOUT` 并写明理由）。
- 涉及功能变更时：`tests/` 增补用例，覆盖率不低于 97%（分节不低于 90%）。
- 版本发布：提升 `VERSION` 时，`CHANGELOG.md` 首个 `## vX.Y.Z` 必须与之一致（`tools/check-version.js` 强制）。
