# GraphBrain 第三轮健壮性/优雅性审阅与修复方案

状态：待执行（本文件只是方案，未执行任何一步）
制定日期：2026-08-23
适用仓库：GraphBrain 主仓库（方案内全部使用仓库相对路径，不绑定本机盘符）
前置依赖：第一、二轮修复已在工作树中（见 §0 前置检查）

---

## 0. 前置检查（执行前必须完成）

1. **环境**：Node ≥ 24、`npm install` 完成、`npx tsc --noEmit` 0 错误。
2. **确认前两轮修复存在**（若缺失，本方案的"遗留修复项"与"真实条件验证"需按 §6 的降级说明调整）：
   - `core/store/file-lock.ts` 导出 `withFileLockAsync`；
   - `scripts/layer-gate.ts` 使用 TypeScript AST（`import ts from "typescript"`），非正则引擎；
   - `core/hooks/hook-lib.ts` 导出 `runTsxAsync` / `runLoreAsync`；
   - `server/router.ts` 含 `/api` 前缀 404 终结器与 HEAD→GET 归一化；
   - `tests/reading-context-concurrent-process.test.ts` 存在且通过。
3. **基线门禁**：`npm run check` 全绿后再开始（306+31 测试为本方案制定时的基线）。
4. **工作树纪律**（同交接文档）：禁止 `git reset --hard` / 批量清理未跟踪文件；不创建 commit；`service:activate` 需用户明确授权，本方案只允许 `service:prepare`。

---

## 1. 背景：前两轮已覆盖什么（不要重复审计）

- 第一轮：core/store+service（锁/发布/部署状态机）、annotation/reading-context/hooks、query/schema/evidence、server 全量、viewer 核心 hooks 与 App、adapters/ue5-code 全量、viewer/components 一轮。已修：evidence 查询 O(n²)、refresh 端点 spawnSync 冻结、SIGTERM 兜底、rehash-annotations 双缺陷、analyze/change-report 输入验证、任务错误脱敏、服务端无界缓存、森林环防护、analysis canonical 分组与闭包去重、viewer 8 项（入口跳转重放/拖拽泄漏/快捷键阻挡契约/焦点恢复/键盘可达/docs_url scheme/favorites 校验/常量去重）。
- 第二轮：路由接线全量复查（26 条路由谓词无贪心/不可达）、门禁工具链、viewer 组件状态机二轮。已修：layer-gate 换 AST 引擎（三个实证假通过形态 + fail-closed）、lore-watcher 异步化、/api 404 终结器、投影读窗口、If-Match 400/428 拆分、HEAD、标注草稿安全链四项、HierarchySelect 缺失态、scope slug 去重；新增跨进程并发验收测试。
- **已核实无缺陷、不必再读**：Tarjan/Brandes/闭包算法、withFileLock 家族语义、publication/deployment 状态机、checkGraphReferences、source-evidence 指纹、路由匹配顺序。

---

## 2. 第三轮审计范围（前两轮未覆盖或覆盖最浅的区域）

> 方法沿用前两轮：发现必须经上下文核实才立项；每条修复带回归测试；禁止风格挑剔。

### T1 · 浏览器门禁基础设施审计（最高优先：门禁的门禁）

范围：`tests/smoke-runner.ts`、`tests/browser-smoke-lib.ts`、`tests/visual-smoke.ts`、`tests/interactive-smoke.ts`、`tests/motion-smoke.ts`、`tests/runtime-soak-smoke.ts`、`tests/resource-budget-smoke.ts`、`tests/interface-readability-smoke.ts`、`tools/update-smoke-golden.ts`、`tests/change-scale-smoke.ts`。

审计角度（与第二轮静态门禁相同，但对象是动态门禁）：
- 断言强度：是否存在"选择器取不到元素→断言被跳过→报告通过"的路径（例如 `querySelector` 空值短路、`?? []` 吞掉缺失、catch 后继续）；
- 截图/黄金文件对比是否真的会因回归而失败（golden 更新能力是否受控——已有测试锁定"显式能力"，验证实现与测试一致）；
- 性能预算断言的测量窗口是否合理（首帧 vs 稳态、GC 时机）、预算数字是否还在合同文档里被引用；
- smoke 启动的隔离生产构建与真实 release 的差异（vite preview vs release-server）会不会让某些检查永远测不到真实形态；
- 失败诊断信息是否足以定位（失败时留下什么）。

产出：发现清单 + 修复（弱断言补强、静默跳过改 fail）。

### T2 · tools/ 数据与迁移工具审计

范围：`tools/data-publication.ts`、`tools/evidence.ts`、`tools/evidence-snapshot.ts`、`tools/migrate-graph-format-version.ts`、`tools/migrate-reading-context.ts`、`tools/backfill-annotation-hash.ts`、`tools/build-change-report.ts`、`tools/archive-curated-references.ts`、`tools/service-health-check.ts`，以及孤儿工具（`tools/purge-*.mjs`、`tools/migrate-orphan-annotations.mjs` 等，保留作审计痕迹，只验证"不可被误触发造成破坏"，不新增功能）。

审计角度：路径锚定是否 ROOT 相对（第二轮修过 rehash-annotations，查同类）、参数校验、dry-run 默认、错误退出码、幂等性声明与实现是否一致、是否复用 core 的集中边界（不得自带第二套 normalize）。

### T3 · 对抗性安全专项（新镜头，前两轮未做过）

范围：`server/http.ts`（isTrustedMutation/path guard/readJsonBody）、`server/misc.ts`（/data 直读）、`server/retired-*.ts`、router 解码层。

专项用例（构造请求逐条验证，可写成 `tests/server-adversarial.test.ts`）：
- Host 头伪造（`localhost.evil.com`、`127.0.0.1.evil.com`、IPv6 映射 `[::ffff:127.0.0.1]`）下的 mutation guard；
- 路径变体：双重 URL 编码 `%252e%252e`、反斜杠 `..\`、Windows ADS `file.json:stream`、保留名 `NUL`、尾随空格/点、大小写盘符；
- 头注入：把 CRLF 塞进可回显的字段（错误消息、job id、文件名参数）；
- JSON 体积/深度：`readJsonBody` 的限长与深嵌套（栈深）；`__proto__` 键穿透（`JSON.parse` 后进入 mutateReadingContext draft 的路径上是否有 `Object.assign`/展开赋值把原型污染写进持久化文档——reading-context 的 Ajv schema 是否拒绝多余键）；
- 服务端正则对攻击者可控输入的 ReDoS 快查（engine/misc/changes 的查询参数正则）。

### T4 · 文档-实现一致性

范围：`docs/architecture.md`、`docs/USAGE.md`、`README.md`、`docs/NEXT_AGENT_HANDOFF.md` 与当前实现的对照。列出并修复：已退役入口仍在文档出现、命令示例失效、架构描述与模块边界漂移。只修事实错误，不重写文风。

### T5 · viewer/src 剩余工具模块补漏

范围（两轮覆盖最浅的小模块）：`appHistory.ts`、`appShortcuts.ts` + `shortcutCatalog.ts`、`codeWorkspaceModel.ts`、`workspaceModel.ts`、`loadGraphProjection.ts`、`graphCatalog.ts`、`apiFetch.ts`、`latestRequest.ts`、`uiPrefs.ts`、`readingContextHttp.ts`、`readingContextMigration.ts`、`localUsage.ts`、`motion.ts`。查：latest-gate 使用一致性、prefs 键版本化、迁移一次性保证、fetch 错误分层。

### T6 · 新增代码的第三只眼（前两轮自己写的）

范围：`adapters/ue5-code/bounded-cache.ts`、`core/hooks/hook-lib.ts` 的 `runChildAsync`、`server/evidence.ts` 的异步 runner、`scripts/layer-gate.ts` AST 版、lore-watcher 异步化后的时序。以新人视角重读：竞态、清理、超时语义。特别验证 lore-watcher：tick 重叠防护（busy 标志）在异常路径（tick 抛错）后是否正确复位。

### T7 · CSS/可访问性横切（轻量）

范围：`viewer/styles/*.css` + `HelpCenter.module.css`。查：焦点可见性（`:focus-visible` 覆盖）、reduced-motion 覆盖与 `motion.ts` 声明一致、颜色对比（只查新增/修改区域）、触控目标尺寸残留问题。产出以修复小项为主，不做整体重设计。

---

## 3. 遗留修复项（前两轮已确认、留到本轮直接实施）

每项实施后必须带回归测试。

- **F1 错误包络统一**：`server/misc.ts` 的 `/data/*` 404/403 仍是纯文本而同路由 410 是 JSON；`server/changes.ts` 报告不存在 `{error}` 无 code。统一走 `sendJson + {error, code}`；给出 code 命名（如 `DATA_FILE_NOT_FOUND`、`CHANGE_REPORT_NOT_FOUND`）。注意兼容：先 grep 前端消费方确认无人依赖纯文本体。
- **F2 module 归属呈现统一**：`core/query/analysis.ts` 用 `（未分组）`、`core/query/change-report.ts` 用 `(unassigned)`、evidence 查询返回 `module: null`——同一事实三种呈现。数据格式（已发布报告）不动；只统一"运行时/CLI 呈现层"的口径并在 `code-module.ts` 注释里写明三处消费关系。
- **F3 unsaved-guard 覆盖剩余切换路径**：第二轮只接了 `navigateView`。补：`openProjectCode`、`openApiLens`、`showInApi`、`jumpToNode`、`openWorkspaceSpec`（Spec 覆盖层会卸载 DetailInspector 里的标注面板）与 popstate（popstate 无法阻断，至少在离开编辑态视图时提示过一次即可）。建议抽一个 `guardedWorkspaceSwitch(apply: () => void)` helper，避免六处复制。
- **F4 header-parser declStart 启发式**：`parseHeader` 无宏函数扫描里 `const origIdx = body.indexOf(needle)` 取的是**首次**匹配位置，inline 函数体之后同签名声明会拿错 doc 注释位置。改为"从上次消费位置之后找最近匹配"或记录为已知启发式（在代码注释与交接文档登记）。倾向修复：needle 附近 200 字符窗口内取最近一次未被消费的匹配。
- **F5 evidence join 类型隔离**：`core/schema/evidence-snapshot-v3.ts` 的 `joinEvidenceSnapshotPairV3` 返回 `GraphFile`（meta.format_version=3 不被图格式所有者承认，第一轮只加了文档注释）。升级：定义 `EvidenceRuntimeGraph`（结构化别名或独立 interface），`core/evidence/query.ts` 全链路改用它，杜绝误流入通用图消费者。
- **F6 观察项（不强制修）**：change-scale 交互时间三轮测量为 836→1417→461ms，波动大。在 `tests/change-scale-smoke.ts` 记录测量方法与已知波动，若 T1 审计发现测量窗口问题则顺手修。

---

## 4. 真实条件验证（前两轮修复的端到端补验，全部要求可移植）

- **V1 异步 refresh 不冻结并发请求**（补验第一轮 P0-2）：新增测试（建议并入 `tests/server-contracts.test.ts`）：直接驱动 `handleEvidenceRefresh`，`runStep` 传一个 `await sleep(400)` 的假步骤；在 refresh 进行期间并发调用 `handleEvidenceStatus`，断言 status 响应到达延迟 < 200ms。不依赖真实提取器与项目注册。
- **V2 lore-watcher 异步链路真实验证**（补验第二轮 A2）：写一个 **lore CLI shim**（临时目录里的可执行脚本，`history 1` 输出固定签名、`revision info <sig> --delta` 输出固定 Parent 链与文件清单），配 `--config` fixture 项目 + `--state` 临时文件，跑 `lore-watcher.ts --once` 三轮：①首轮建基线不触发；②换头签名触发 runner（runner 用假 `post-commit-update`？——不行，checkProject 里 runner 路径写死。方案：允许通过环境变量 `GRAPH_BRAIN_HOOK_RUNNER` 覆盖 runner 脚本路径，这是本轮唯一允许的小接口新增，默认仍为 post-commit-update.ts）；③runner 失败（退出码 1）时基线不推进。断言状态文件与日志行为。
- **V3 `npm run check:lifecycle`（smoke:soak）**：两轮改了异步生命周期，跑一次长时门禁确认浏览器端无回归。
- **V4 `npm run service:prepare`**：只做候选构建与隔离验收（3130 端口段），**不得 activate**。验收失败则本轮改动不得交付。
- **V5 数据运维演练（只读形态）**：`npm run data:status`、`npm run data:prune`（dry-run）、`npm run data:tidy`（dry-run），人工核对清单无异常项。

---

## 5. 执行顺序与节奏

1. §0 前置检查 → 基线 `npm run check`。
2. F1–F5 遗留修复（先做，风险低、收益确定）。
3. T1 门禁基础设施审计（本轮最高价值的新审计）。
4. T6 新增代码三审 → T2 tools → T3 对抗安全 → T5 viewer/src 补漏 → T4 文档一致性 → T7 CSS（可按代理并发上限拆两批并行）。
5. V1–V5 真实条件验证。
6. 收尾：`npm run check` 全绿 → 更新 `docs/NEXT_AGENT_HANDOFF.md`（沿用 §1.5/§1.6 格式新增 §1.7，含：发现清单、修复清单、否决清单、验证证据、交付说明与旧入口清理说明）。

每完成一个 T/F/V 组跑一次 `npx tsc --noEmit && npx tsx --test tests/<相关文件>`，不要攒到最后。

## 6. 降级与例外

- 若前置检查发现前两轮修复缺失（在旧树上执行）：F1–F6 仍可执行，但 V1/V2 的意义改变——改为"先实施第一轮 P0-2/第二轮 A2 的等价修复再验证"，具体参考 `docs/NEXT_AGENT_HANDOFF.md` §1.5/§1.6 的修复描述。
- 受限沙箱环境可能让 tsx/esbuild 报 `spawn EPERM`：不是用例失败，换非沙箱终端重跑。
- 任何与《AGENTS.md 工程宪法》冲突的"发现"，以宪法为准；例外只能登记进 `config/engineering-standard-exceptions.json`。
- 明确不做：不改已发布数据格式（change-report 的 `(unassigned)` 是持久化事实）、不动孤儿工具的功能、不做 CSS 大重构、不做依赖大版本升级（T5 之外的依赖只做"未使用依赖清单"报告）。

## 7. 完成定义

- 第三轮所有立项发现均有处置（修复+测试 / 否决+理由 / 登记为例外）；
- V1–V5 全部通过并留证（命令输出或测试名）；
- `npm run check` 全绿，测试数不少于本轮起点 + 新增回归数；
- 交接文档 §1.7 完整记录，报告清楚列出替换、删除、保留及原因（宪法第 9 条）。

---
---

# 第二部分：生产工具链定位审查与迭代方案（§8–§10）

> 本部分是战略层：不再找 BUG，而是回答"GraphBrain 在这条工具链里是否站在它该站的位置、下一程往哪走"。
> 审查基于仓库事实（非访谈）：唯一注册项目 Sabotage（UE 5.8，`vcs: lore`）、ClaudeGameStudios 承担策划/设计/评审/交付、NSSM 常驻 3030、证据 API v1、标注知识层。
> 三个经核实的关键事实，是本方案的优先级依据：
> **F-A** Lore 无 post-commit 钩子机制，`lore-watcher` 是 Sabotage 提交→图谱更新的**唯一自动通道**；
> **F-B** 生产形态 `scripts/release-server.ts` 不启动 watcher（仅 vite dev 形态启动）——生产服务上 Sabotage 的提交**永远不会自动刷新图谱**（缺陷级定位断链）；
> **F-C** `*.Build.cs` 只被收为森林文件叶，模块→模块 `depends_on` 边从未构建（代码注释自称"模块图 depends_on 边的数据源"，而该模块图已退役）。

## 8. 定位审查（十维）

**D1 链路闭环矩阵**——GraphBrain 的定位：工具链的**事实底座**（版本化、内容寻址、带 provenance 的只读代码事实 + 人工知识层），上游是代码仓库与引擎，下游是三个消费端。

| 环节 | 现状 | 判定 |
|---|---|---|
| 提交 → 事实提取 | git 走 post-commit hook；Lore 走 watcher——但 watcher 只在 dev 形态存活（F-B） | **生产断链** |
| 事实 → 人 | 3030 viewer 五工作区 + 证据徽章 | 良好 |
| 事实 → Agent | 仅有裸 HTTP evidence API；无 MCP/标准工具面；agent 要自己拼 URL+解析 | **最大杠杆缺口** |
| 事实 → ClaudeGameStudios | 无成文契约（宪法第 10 条要求先定边界再接入） | 契约缺口 |
| 分析 → 决策 | cycles/coupling/impact/forward 是纯函数但只有 CLI 入口；`diffCycles` 无人调用 | 能力沉睡 |

**D2 事实保真度**：evidence coverage=`partial`（5 个测试 .cpp 未消费：standalone TU 不支持）；Blueprint `unsupported` 但未传导到 UI 呈现；模块依赖维度缺失（F-C）。
**D3 时效性**：working-tree 指纹新鲜度已计算且驱动 evidence 门槛与目录徽章（好）；但自动刷新依赖 F-B 的断链；两次提交之间的"工作区已漂移"有指纹可比对、无主动提示。
**D4 消费通道**：人强、agent 弱（D1）、CGS 无契约；`local-usage` 计数器有人的度量、无 agent 消费度量。
**D5 分析能力**：见 D1 末行；另：保留的全部历史 generations 是免费的时间轴数据（跨代耦合/回路趋势可算），从未利用。
**D6 知识层**：标注=文件级 source_hash（改一行=整文件失效提示）；无行级锚；无导出为 agent/CGS 可用的上下文包；无写入者 provenance（人与 agent 的标注不可区分）。
**D7 运维形态**：NSSM + prepare/activate/rollback 状态机成熟；watcher 断链（F-B）；无 data/ 备份-恢复 runbook；多机/异地可移植性未成文。
**D8 安全边界**：单用户 loopback + mutation guard + DNS-rebinding 防护，与当前定位匹配；向 CGS/其他机器开放是边界变更，属决策点非默认项。
**D9 规模**：单项目注册（多项目机制在但未端到端验证）；引擎目录 27k 头全量解析靠缓存兜住；无缓存老化策略。
**D10 文档**：交接文档一流；USAGE/architecture 有漂移（第一部分 T4 已列）。

**结论**：底座本身（存储/版本化/证据/门禁）已是这套工具链里最扎实的部分；**短板不在底座，在"最后一公里"——生产形态的自动新鲜度（F-B）、agent 的标准消费面、沉睡的分析能力、未成的跨工具契约**。迭代方案据此排布。

## 9. 迭代方案（Track A–E，三阶段）

> 每项含：目标 / 实施要点（文件锚点）/ 验收。凡标【决策点】的必须先问用户，不得默认实施。

### 阶段一 · 定位闭环（P0，本轮必做）

**A2 watcher 生产化（先做——缺陷级，修 F-B）**
- 目标：生产形态下 Sabotage 的 Lore 提交自动触发图谱刷新。
- 要点：`scripts/release-server.ts` 启动时按 `GRAPH_BRAIN_NO_WATCHER`（缺省启用）调用 `startLoreWatcher()`（第二轮已异步化，嵌入不再冻结事件循环；`core/hooks/lore-watcher.ts` 顶部的 DECISION 注释需同步改写）；hook.lock 的 busy-skip 语义天然兼容双形态并存；部署验收环境已有 `GRAPH_BRAIN_NO_WATCHER=1` 隔离。【决策点 D-P2：嵌入 release-server（倾向，零新增服务）vs 独立 NSSM 服务】
- 验收：V6。

**A1 MCP 只读工具面（最大杠杆）**
- 目标：任何 MCP 宿主（ZCode/Claude 等 agent）把 GraphBrain 当标准工具消费，provenance 原样透传。
- 工具清单（`gb/1`，全部只读）：`gb_status`（新鲜度/消费门槛）、`gb_search_symbols`、`gb_symbol_detail`、`gb_neighborhood`、`gb_impact`（包装 `core/query/analysis.ts` 纯函数）、`gb_changes`、`gb_annotations_get`。
- 要点：直接 import `core/evidence/query.ts` / `core/query/analysis.ts`（不经 HTTP，单一事实源不变）；fail-closed freshness 语义保留（stale 时返回诊断而非数据）；stdio 传输；实现形态【决策点 D-P1：手写最小 JSON-RPC（零新增依赖，倾向）vs 引入 @modelcontextprotocol/sdk】；入口 `tools/mcp-server.ts` + `npm run mcp`；宪法第 10 条边界声明（拥有什么/复用什么/退出路径）写在模块头。
- 验收：V7。

**A3 回路基线门禁接线（激活沉睡能力）**
- 目标：新增依赖回路在提交后立即显式告警，架构回归有防线。
- 要点：`core/hooks/post-commit-update.ts` 刷新成功后对当前图跑 `findCycles`，与 `data/architecture-baseline.json`（新格式 `graphbrain-arch-baseline/1`：subsystem + cycles 节点集）`diffCycles`；新增回路 → hook 日志 WARN（首期日志级告警，不动 change report 格式）；成功后更新基线文件（temp+rename 原子写）。
- 验收：V8。

**A4 ClaudeGameStudios 契约成文（宪法第 10 条补课）**
- 目标：跨工具边界从隐式变显式。
- 要点：新增 `docs/toolchain-contract.md`：GraphBrain 对外稳定面（evidence HTTP v1 + `gb/1` MCP）、数据新鲜度语义（指纹/门槛）、版本化与退役政策、CGS 侧义务（不得绕过边界直读 data/）。只写文档不改代码。

### 阶段二 · 保真与知识（P1，按余量执行）

**B1 standalone 翻译单元**：`extract-classes-lib.ts` 消费无同名 .h 的 .cpp 类定义（消除 5 个 unconsumed、coverage→complete）；`PARSE_CACHE_VERSION` bump；capability `standalone-translation-units` → supported。
**B2 模块依赖边（修 F-C）**：解析 `*.Build.cs` 的 `Private/Public/(Additional)DependencyModuleNames` → 模块间 `depends_on` 边并入项目图。设计二选一（按图校验约束定）：以 file 叶（`entry_of`）为源、目标模块名生成 stub 节点建边；或恢复轻量 module 节点类型。`meta.ts` 的 `depends_on` 关系与 `DEPENDENCY_RELATIONS` 均已就绪。首次发布会新增大量边——变化报告会出现一次性结构变化，属预期，交接文档要预告。
**C1 上下文包导出**：`tools/export-context.ts --subsystem project [--module X] [--class Y]` → Markdown（front-matter `format_version: graphbrain-context-pack/1`）：事实摘要 + 该范围标注 + 新鲜度声明。给 CGS/agent prompt 直接消费。只读派生，不新增事实。
**C2 标注行级锚**：【决策点 D-P3，默认不实施】reading-context format v2（行锚 + 失效半径），涉及持久化格式迁移，需单独一轮。

### 阶段三 · 时间与规模（P2，登记备选）

**D1 架构趋势**：历史 generations × `analysis.ts` 纯函数 → 跨代回路数/耦合/不稳定度趋势；先做 `analyze --trend` CLI 报告，页面化后置；按需计算+内存缓存，不新增持久化格式。
**E3 `gate:arch` 门禁**：npm script，回路数/新增回路超基线即失败（依赖 A3 基线文件），接入 check:fast 可选链。
**B4 多项目端到端验证**：hook-projects 多条目 + 目录/切换/锁互斥实测。
**E2 引擎缓存老化**：sync-report 驱动的增量补同步策略（报告级）。
**E4 备份-恢复 runbook**：data/ 结构、内容寻址校验、恢复步骤成文。

### 决策点清单（执行者必须停下问用户）

| # | 决策 | 倾向 |
|---|---|---|
| D-P1 | MCP 实现：手写 stdio JSON-RPC vs SDK 依赖 | 手写（零运行时新依赖，守住 bundle 边界） |
| D-P2 | 生产 watcher：嵌入 release-server vs 独立 NSSM 服务 | 嵌入（零新增运维面） |
| D-P3 | 标注行级锚（格式 v2 迁移） | 暂缓 |
| D-P4 | Blueprint 事实边界 | 不做提取；仅把 capability 传导到 UI 呈现 |
| D-P5 | agent/CGS 写入通道与 loopback 外消费（token/绑定地址） | 本轮不开 |
| D-P6 | 多机同步/数据打包（换机执行场景） | 仅 E4 文档化，不做同步机制 |

## 10. 整合执行顺序与验收补充

**总顺序**：第一部分（§0–§7 审计与修复）→ 向用户过决策点（至少 D-P1、D-P2）→ 阶段一 A2→A1→A3→A4 → 按余量推进阶段二（B1/B2/C1）→ 阶段三只登记。每步之间维持 `npx tsc --noEmit` + 相关测试绿。

**新增验收（并入 §4 序列）**：
- **V6 生产 watcher**：测试进程内 `startLoreWatcher`（lore shim + fixture config/state，V2 的设施复用），提交→tick 期间用 `Promise.race` 计时证明事件循环不被冻结（并发定时器不被提取阻塞）且基线推进；release-server 的接线用源码契约测试（server-contracts 既有风格：断言 `startLoreWatcher` 被调用且受 `GRAPH_BRAIN_NO_WATCHER` 约束）。
- **V7 MCP 工具面**：spawn `tools/mcp-server.ts` 子进程，stdio 完成 initialize → tools/list → 逐工具 tools/call；断言：工具清单与 `gb/1` 声明一致、`gb_search_symbols` 返回 provenance 字段、require-fresh 语义下 stale 快照返回诊断错误码而非事实数据、写类方法（tools/call 之外的协议面）不被接受。
- **V8 回路门禁**：fixture 基线（无回路）→ 刷新含新回路的图 → hook 输出含 WARN 且基线文件更新为含该回路；再次刷新同图 → 无 WARN。

**完成定义补充（在 §7 之上）**：阶段一四项全部落地并各带验收证据；决策点逐条有用户裁决记录；`docs/toolchain-contract.md` 与交接文档 §1.7 同步更新；若 B2 实施，变化页出现的一次性结构变化需在交接文档预告并留回滚说明。

