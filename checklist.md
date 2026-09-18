# BeatSight 审计评审检查清单（checklist.md）

> **快照声明（v2.4.4 补）**：本文件是 2026-09-17 那次审计（spec.md，基线 v2.0.2）的评审产物，
> 其中所有数字（实跑项数、PASS 数、覆盖率、耗时、行号）均为**当时实测值，会随代码演进漂移**。
> 当前口径一律以 `node tools/check-all.js` 的实际输出为准，本文件不作实时依据。
> （它也因此被 check-docs.js 排除在防漂移规则之外——见该文件头的"刻意排除"。）

> 用于逐条核对 `spec.md` 结论的**可验证性**与 `tasks.md` 的**落地质量**。全部条目应可复现。

---

## 一、证据可复现性（评审时现场核对）

- [ ] `node tools/check-all.js` → 输出「全部通过 · 实跑 8/10 项」，墙钟约 17s。
- [ ] `node tools/check-all.js --quick` → 实跑 8/10 项，约 10.7s。
- [ ] `node tests/run.js` → 1342 PASS / 0 FAIL。
- [ ] 自验链第 10 步 → 覆盖率 99.8%（3756/3763），未覆盖 7 行（Audio 4 + Ear 3）。
- [ ] `node_modules` 不存在 → ESLint / tsc 显示 ⊘。
- [ ] `git ls-files .uploads` → 2 个 PNG（D7 成立）。

## 二、诊断结论核对（对照 spec.md）

- [ ] D1：`README.md` L19 确有「约 6 秒」。
- [ ] D2：`README.md` L25 确有「它不开严格模式」，且 `tools/tsconfig.typecheck.json` 的 strict 家族开关均为 `true`。
- [ ] D3：`docs/DEVELOPMENT.md` §5 同样残留「约 6 秒」。
- [ ] D4：`tools/check-coverage.js` L26–29 写有「v1.3.1」。
- [ ] D5：`tools/check-dom-ids.js` L39 使用脚本内相对行号（无 `baseLine`）。
- [ ] D6：`argBar`/`editorCardTitle`/`editorDot`/`earHead`/`earDot` 为声明未引用。
- [ ] D8：仓库无 `_headers` / `_redirects` / `functions/`。
- [ ] 安全：17 处 `innerHTML` 均为 `= ""`；无 `eval`/`new Function`。

## 三、架构不变式核对

- [ ] `tools/check-module-order.js` R1/R2/R3 全绿。
- [ ] R3 WHITELIST 恰为 10 条，且每条都有原因说明；无过期条目。
- [ ] 热路径 `paintFrame`/`paintFrameBody`/`paintBall` 无前向引用（R2）。
- [ ] 16 个模块 banner 顺序与 `EXPECTED_ORDER` 一致。

## 四、阶段 A 交付验收（信任修复）

- [ ] README / DEVELOPMENT / check-all 注释中**不再出现**任何与实测不符的耗时或类型描述。
- [ ] `check-coverage.js` 不再包含硬编码过期版本号。
- [ ] `check-dom-ids.js` 报错行号与 index.html 绝对行一致（构造一个故意错误验证）。
- [ ] `.uploads/` 已入 `.gitignore` 且已从索引移除，`git status` 干净。
- [ ] `--strict-env` 下，`CI=true` 且缺依赖时报错（非 ⊘）。

## 五、阶段 B 交付验收

- [ ] 诊断面板可通过 `?debug=1` 打开，计数器随运行变化。
- [ ] 反复开关弹层 N 次后无监听器累积（有自动化用例证明）。
- [ ] 文件内无新增「下游模块反向依赖上游」的违规。

## 六、功能交付验收（通用门槛）

- [ ] 新功能不引入运行时依赖、不引入构建步骤、不破坏 `file://`。
- [ ] 新模块插入位置满足 R1 线性序，新回调已登记 R3。
- [ ] 有对应测试用例，覆盖率不低于阈值。
- [ ] `VERSION` 提升时 `CHANGELOG.md` 首行一致。
- [ ] 提交前自验链全绿；直接推 `main`（不建分支、不开 PR）。

## 七、需用户决策的开放项

- [ ] P2-1（麦克风分析）是否接受「必须 `https://`、牺牲 `file://`」？
- [ ] P2-3（多设备同步）是否接受「引入后端、突破零依赖/单文件」？
- [ ] 双部署通道（Cloudflare / WorkBuddy）origin 不同导致数据孤岛，是否需统一策略？
