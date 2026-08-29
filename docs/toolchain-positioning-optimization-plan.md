# GraphBrain 工具链定位与优化执行计划

> 状态：Completed；GraphBrain 1.0.0 已激活到生产 NSSM 服务并通过切换后验收  
> 制定日期：2026-08-13（Asia/Shanghai）  
> 最近更新：2026-08-13（P0–P3 与生产发布完成；活动 release 为 `release-b6f585f29dbd9de72b224dc24850b003e1febc24fc2076fabbe5da93ca0069a1`）  
> 适用仓库：`GraphBrain`、`Tools/ToolRegistry`、`ClaudeGameStudios`、`Sabotage`  
> 本文同时跟踪执行进度；只有明确标记“已完成”的增量代表代码已经落地，未标记阶段仍是待执行计划。

## 1. 决策摘要

GraphBrain 保持独立仓库，但从“功能完整的独立可视化产品”进一步收敛为：

> **UE C++ 的本地代码证据服务：负责提取、版本化、查询和比较已经实现的代码事实；Viewer 是可选客户端。**

GraphBrain 不并入 ClaudeGameStudios，也不重新扩展设计、规划、关卡、叙事、任务、审批、交付或 UE 运行时执行能力。

目标工具链：

```text
ClaudeGameStudios：意图、ADR、Story、规范、评审与交付
                         |
                         | 实现合同
                         v
Sabotage C++：代码真源 -----> GraphBrain：版本化代码证据
                                      |             |
                                      |             +--> 只读 Viewer
                                      +----------------> CGS / Agent 评审证据

Unreal Engine：资产、Blueprint、空间、Sequence 与运行时真源
ToolRegistry：GraphBrain 能力发现、健康状态和稳定调用入口
```

## 2. 数据所有权与工具边界

| 事实或状态 | 唯一所有者 | GraphBrain 行为 |
| --- | --- | --- |
| C++ 文件与真实实现 | Sabotage 源码 | 只读提取，不反向写源码语义 |
| 结构化、版本化的代码投影 | GraphBrain project snapshot | 持有、发布、查询、回滚 |
| 引擎类型/API 事实 | GraphBrain Engine Resolver/cache，按引擎版本隔离 | 项目图只引用稳定外部 ID，不复制引擎事实 |
| 代码变化邻域 | GraphBrain change report | 派生、可重建，不制造待办或结论 |
| 对项目代码事实的人工观察 | GraphBrain reading-context | 必须绑定稳定 ID 与来源证据 |
| UE 最佳实践与规范 | CGS `spec/`、ADR、engine-reference | 不伪装成源码提取标注 |
| Story、计划、审批、交付状态 | ClaudeGameStudios | 不读取或持久化为 GraphBrain 状态 |
| Level、Actor、资产、Blueprint、Sequence、运行时 | Unreal Engine / 项目资产 | 不建立第二份空间或运行时模型 |
| 外部工具能力和健康 | ToolRegistry | 通过 manifest/adapter/skill 接入 |
| UI 选择、布局、缓存 | Viewer 或可重建缓存 | 永远不成为代码事实 |

GraphBrain 对外稳定协议只暴露“证据”，不暴露仓库内部文件结构，不允许其他工具直接修改 GraphBrain 内部状态。

## 3. 审计基线（2026-08-13）

后续实施开始前必须重新采集一次基线；本节只记录制定计划时的状态。

### 3.1 健康与工程基线

- `npm test`：265/265 通过（UX-1 后重新采集）。
- `npm run typecheck`：通过。
- `npm run layer-gate`：通过。
- `npm run validate`：活动 publication、图、变化报告和 reading-context 通过。
- `npm run build` 与 `npm run check:bundle`：通过。
- `npm run smoke`：隔离生产构建 9/9 浏览器门禁通过，覆盖 12 个只读视图、窄屏/DPI、交互、资源预算、动效和故障恢复。
- `http://127.0.0.1:3030/`：HTTP 200，生产响应包含 CSP 与 X-Frame-Options。
- 退役 World Atlas API：HTTP 410。
- 工作树有大量既有未提交和未跟踪改动；任何实施不得 reset、checkout 或批量清理。

### 3.2 事实新鲜度基线

- 当前 publication revision：5。
- 当前项目图生成时间：2026-08-09T18:43:07.414Z。
- 运行时 catalog 判定：`stale / fingerprint-mismatch`。
- 当前源码有 7 个文件晚于项目图。
- 当前图记录 37 个发现输入：33 consumed、4 skipped、0 failed。
- 被跳过项为独立测试 `.cpp` 翻译单元。

### 3.3 事实规模与重复基线

- 当前项目 generation：3,051 nodes / 245 edges。
- project layer：252 nodes。
- engine layer：2,799 nodes，占 91.7%。
- project functions：154。
- engine functions：2,723。
- Engine API catalog：1,750 modules / 27,168 headers。
- 活动 graph catalog：8 项，其中只有一项是 publication 当前项目图，其余为旧类图、脑图或人工参考图。

### 3.4 阅读上下文基线

- annotation targets：15。
- annotation entries：18。
- favorites：18。
- 所有 annotation entries 均绑定旧 UE/Lyra 参考图，没有绑定当前 Sabotage 项目图。
- favorites 均为 engine class，可用稳定 class ID 表达。

### 3.5 维护面基线

- 当前纳入版本控制或未忽略的源码约 36,642 行。
- Viewer 约 18,632 行，占约 51%。
- `data/api-catalog` 约 24.84 MiB。
- `logs` 约 25.96 MiB。
- `runtime` 约 12.93 MiB。
- 当前跨仓库未发现活动消费者调用 GraphBrain graph/change API；CGS 只在文档中声明“可选只读证据”。

## 4. 现有内容、消费者与兼容清单

实施任何新格式或稳定 API 前，必须覆盖以下旧路径。

| 旧内容/入口 | 当前状态 | 处理策略 | 退出/回滚 |
| --- | --- | --- | --- |
| `ue5_code` graph format v2 | 活动 | 保留 reader；新增 v3 writer 与确定性迁移 | publication 指针回到 v2 generation |
| publication format v1 | 活动 | 优先保持；若无法表达 project+engine 原子绑定才升版 | 保留旧 state 和 normalize boundary |
| reading-context format v1 | 活动 | 尽量保持；只迁移 owner/subsystem 绑定 | 迁移前内容寻址归档，支持恢复 |
| change-report format v1 | 活动、可重建 | 适配 v3 snapshot identity；不复制节点事实 | 删除并从两份图重建 |
| 7 份活动旧参考/旧快照图 | 活动兼容边界 | 消费者审计后移入版本化归档 | 旧深链由集中 adapter 指向诊断/归档说明 |
| 18 条旧参考图知识标注 | 活动 reading-context | 生成人工审阅清单；确认后迁入 CGS 规范 | 原文逐字节归档，禁止猜测新目标 |
| 18 个 engine favorites | 活动 reading-context | 按完全相同 stable class ID 无损迁移 | 保留旧 projection adapter |
| 旧 authoring/Atlas API | 0.x 返回 410 | 继续集中保留到 1.0 消费者审计完成 | 不复活旧数据或逻辑 |
| 旧 `view/lens/spec_layer` URL | 兼容读取 | 继续只在 `appRoute.ts` 归一化 | 新运行时只写新 URL |
| AFFiNE `design_doc` GraphBrain embed | 残余、对应 adapter 已退役 | 删除 GraphBrain 回灌；保留明确的 Cytoscape/附件路径 | AFFiNE publish 本身仍可独立恢复 |
| 根配置“平衡 CSV → GraphBrain” | 文档残余 | 改为 CGS 数据/UE DataTable 所有权 | 不创建 GraphBrain 平衡领域 |
| `Sabotage/Tools/h3_beats.py` Atlas 来源声明 | 历史来源残余 | 迁为 Sabotage/CGS 持有的冻结 prompt 资产或归档 | 不再读取 Atlas 归档作为活动输入 |

任何无法无损迁移的语义内容必须产生诊断和人工审阅清单，不得自动猜测目标节点、规范章节或产品含义。

## 5. 执行阶段总览

| 阶段 | 目标 | 预计工作量 | 前置条件 |
| --- | --- | --- | --- |
| P0 | 让证据新鲜、可判定、不会被误用 | 1–2 天 | 当前工作树建立可恢复检查点 |
| P1 | 提供正式 ToolRegistry/Agent 消费入口 | 3–5 天 | P0 freshness/status 契约稳定 |
| P2 | 拆分项目与引擎事实的唯一所有权 | 1–2 周 | P1 evidence 协议不依赖 Cytoscape 内部结构 |
| P3 | 按真实使用削减 UI、缓存和运维表面 | 按收益选择 | 至少收集一轮本地使用证据 |

执行顺序固定为 P0 → P1 → P2；P3 可独立裁剪，但不得在 P2 前通过删除兼容内容掩盖所有权问题。

## 6. P0：证据信任闭环

### 已完成增量 UX-1：Viewer 证据信任状态贯穿

状态：**Completed（2026-08-13）**。

本增量只收敛 Viewer 的展示与验证边界，不代表 P0U2 Evidence Status 对外协议或 P0U3 自动消费者 freshness gate 已完成。

已落地：

1. 新增统一的 `resolveEvidenceStatus` 展示边界，集中把 catalog 的 `freshness`、`freshness_reason` 与 `coverage_status` 解析为 `current / partial / stale / unverified`；旧目录缺少可验证来源时保持“未验证”，不猜测为最新。
2. 首页统计改为“项目节点 / 项目关系 / 参考图”，不再把辅助参考图节点和关系混入当前项目事实规模。
3. 项目证据状态从首页项目卡贯穿到关系图与 API 顶栏；当前 `stale / fingerprint-mismatch` 项目图持续显示“只读代码事实 · 已过期”。
4. 补齐四种状态的颜色、图标、可访问名称和窄屏布局；引擎只读模式保持中性，不伪装成项目 freshness 结论。
5. 增加纯模型单元测试和首页 → 关系图状态一致性浏览器断言。

明确未发生：

- 未新增或修改持久化格式、publication、graph、change-report 或 reading-context 数据。
- 未新增 Evidence API、ToolRegistry adapter、自动 freshness gate 或 refresh 写操作。
- 未移除旧 URL、旧图或兼容入口。

后续影响：P0U2 应复用 catalog/source-evidence 的事实判断，但不能把本次 Viewer presentation model 当作对外协议；P0U3 可直接复用持续可见的 UI 状态入口。

### P0U1：实施前基线与工作树保护

状态：**Completed（2026-08-13）**。基线记录见 `docs/p0-baseline-2026-08-13.md`；未创建 commit，未 reset/checkout/批量清理用户改动。

目标：避免在当前大量既有改动上误删或混入无关变更。

动作：

1. 重新记录 `git status --short`、`git diff --stat`、publication/data/service status。
2. 区分用户既有改动与本计划改动；实施只触碰列明文件。
3. 经用户决定后建立可恢复检查点；未经用户指令不创建 commit。
4. 重跑 layer-gate、typecheck、test、validate，记录基线输出。

验收：基线可重复；没有 reset/checkout/批量清理；任何失败有明确环境或用例原因。

### P0U2：版本化 Evidence Status 契约

状态：**Completed（2026-08-13）**。已实现 `graphbrain-evidence-status/1`、`GET /api/evidence/v1/status` 与等价 CLI；协议只复用 catalog/publication/source-evidence 的事实判定，GET 无写副作用。

目标：让人类和自动消费者用同一状态判断证据是否可用。

建议新增协议：`graphbrain-evidence-status/1`。

必须包含：

- `format_version`
- `service_version`
- `publication_revision`
- `snapshot_id`
- `source_fingerprint`
- `freshness: current | stale | unverified`
- `freshness_reason`
- `coverage.status`
- discovered/consumed/skipped/failed counts
- bounded diagnostics
- extractor ID/version/capabilities
- engine version/root identity（只暴露必要的本机诊断信息）

候选入口：`GET /api/evidence/v1/status` 与等价 CLI。

实现边界：状态只消费既有 catalog/publication/source-evidence 服务；不得在 server 或 Viewer 中重新计算第二套 freshness。

验收：current、stale、unverified、损坏 publication、缺失源码根均有契约测试；响应本身不触发写入。

### P0U3：自动消费者 freshness gate

状态：**Completed（2026-08-13）**。统一 gate 默认 `require_fresh=true`，CLI/协议对 stale/unverified 返回稳定诊断并 fail closed；人类只读路径可显式放行非 fresh 证据。变化报告 API 增加活动 publication 绑定声明，不修改持久化 change-report v1。

目标：陈旧或来源未验证的图不能静默进入自动评审。

规则：

- Agent/ToolRegistry 默认 `require_fresh=true`。
- stale/unverified 时返回稳定诊断，不输出“通过/失败”式评审结论。
- 人类 Viewer 可继续只读打开旧图，但必须持续显示来源、新鲜度和覆盖率。**其中 freshness/coverage 状态跨首页与探索顶栏持续可见已由 UX-1 完成；自动消费者 gate 仍未实施。**
- change report 必须声明其 current snapshot 是否仍是活动 publication。

验收：自动消费者遇到 stale 图会 fail closed；旧 Viewer 深链仍能只读加载并显示警告。

### P0U4：刷新闭环

状态：**Completed（2026-08-13）**。hook、CLI 与 `POST /api/evidence/v1/refresh` 共用 `core/evidence/refresh.ts`、既有 `logs/hook.lock`、解析缓存和原子 publication。真实刷新已发布 data revision 8 与 Evidence revision 5；活动 v3 generation 为 `evidence-generation-b5853fa798c5a17bea80c71ad05ed52bf06fb875fdf144965f54ed008c5e1d53`，freshness 为 current，旧 v2/v3 generation 均可显式 rollback。

目标：修复“hook 存在但工作树仍过期”的实际断链。

方案：

1. 保留 `core/hooks/hook-projects.json` 为项目声明源。
2. 提供显式 `refresh` 操作，供 watcher、CGS preflight 和 ToolRegistry adapter 复用同一领域服务。
3. 普通 GET 不隐式 refresh；写操作使用现有 file lock、parse cache、publication revision 和原子发布。
4. watcher 使用工作树文件事件或 Lore 事件作为触发，但以源码指纹而非事件本身作为最终判定。
5. 零差异仍可发布新鲜 snapshot；是否生成 change report 按现有零差异策略处理。

验收：

- 未提交 `.h/.cpp/Build.cs` 变化可触发或显式刷新。
- 两个并发 refresh 不产生重复 owner 或破坏 publication。
- 失败时旧 generation 保持活动。
- refresh → 服务读取 → Viewer/CLI → 重启后读取一致。

### P0U5：退役残余清理

状态：**Completed（2026-08-13）**。审计清单见 `docs/retired-residual-entry-audit-2026-08-13.md`；用户确认后已移除根配置的 GraphBrain 平衡归属与 AFFiNE `design_doc` 回灌分支，H3 prompts 保留为 Sabotage/CGS 持有的冻结资产并明确历史 provenance。AFFiNE CytoscapeViewer 与 H3 CLI 的非 GraphBrain 路径保留。

目标：工具链文本和活动代码不再暗示 GraphBrain 拥有设计或 Atlas 数据。

范围：

- `G:/UnrealProject/CLAUDE.md`
- `Tools/AffinePublish/publish-design.mjs`
- `Sabotage/Tools/h3_beats.py` 及其实际消费者
- 其他非 archive 的 GraphBrain/Atlas/design_doc 引用

要求：先审计消费者，再改写、归档或删除；AFFiNE 与 H3 的正常非 GraphBrain 路径必须保留并验证。

### P0U6：测试产物卫生

状态：**Completed（2026-08-13）**。普通 smoke 产物写入忽略的 `logs/runs/<run-id>/`；只有 `npm run smoke:update-golden` 可以显式提升 golden，并包含确认、差异和可恢复替换流程。

目标：普通测试不再持续修改已跟踪 smoke 证据。

建议结构：

```text
tests/fixtures/visual-golden/        # 仅显式批准时更新
logs/runs/<run-id>/                  # 默认 Git ignored
logs/reports/latest.json             # 可选、稳定摘要
```

验收：普通 `npm run smoke` 不修改 golden；显式 update-golden 命令有确认、差异和回滚路径。

## 7. P1：正式工具链接入

### P1U1：Evidence 查询协议

状态：**Completed（2026-08-13）**。Evidence API v1 的 status、symbols、symbol detail、neighborhood 与 changes 查询统一复用 resolver、`core/query` 和 change-report index，并携带 snapshot、fingerprint、freshness、coverage 与 provenance。

目标：Agent 不读取整个 Cytoscape 文件，也不依赖 GraphBrain 目录布局。

建议入口：

```text
GET /api/evidence/v1/status
GET /api/evidence/v1/symbols?query=<text>&kind=<kind>&module=<module>
GET /api/evidence/v1/symbols/<stable-id>
GET /api/evidence/v1/neighborhood/<stable-id>?depth=1
GET /api/evidence/v1/changes/<report-id>
```

所有 evidence 响应必须携带：

- `format_version`
- `snapshot_id`
- `source_fingerprint`
- `freshness`
- `coverage`
- stable symbol IDs
- source path 与可用 source span
- 明确的 direct/derived/confidence 语义

查询层必须复用 `core/query`、graph resolver 和 change-report query；禁止为 REST 再建一份节点模型。

旧 `/api/graph-catalog`、`/api/graph-projection`、`/api/change-reports` 在 0.x 继续兼容，新消费者只使用 Evidence v1。

### P1U2：ToolRegistry manifest 与 adapter

状态：**Completed（2026-08-13）**。`Tools/ToolRegistry/adapters/graphbrain-evidence/` 只通过 loopback Evidence API v1 调用，manifest 能力与 ready/degraded health 已验证，不读取 GraphBrain 内部文件。

新增建议目录：

```text
Tools/ToolRegistry/adapters/graphbrain-evidence/
  manifest.json
  client.py | client.mjs
  README.md
```

建议 manifest：

- id：`graphbrain-evidence`
- protocol：`rest` 或 `mixed`
- skill：`code-evidence`
- capabilities：
  - `code-symbol-search`
  - `code-neighborhood`
  - `code-change-impact`
  - `annotation-staleness`
- health：读取 Evidence Status；fresh=current 为 ready，stale/unverified 为 degraded。

adapter 只调用稳定协议；不得直接读取 `GraphBrain/data` 或 import GraphBrain 内部模块。

### P1U3：CGS `code-evidence` skill

状态：**Completed（2026-08-13）**。CGS `$code-evidence` 先执行 freshness gate，报告来源、覆盖率与不确定性；不持有 Story、审批或交付状态。

职责：

- 仅在已实现代码证据有帮助时触发。
- 先检查 health/freshness。
- 输出来源、snapshot、coverage 和不确定性。
- 不生成实现合同、Story 状态、审批或合规结论。
- stale 时可建议或调用显式 refresh；不得把旧结果当当前事实。

### P1U4：CGS 工作流接入

状态：**Completed（2026-08-13）**。实现前/后证据附件均为可选能力；GraphBrain 缺席或 degraded 时 CGS 主流程仍可继续。

允许接入点：

- 实现前：按 story 涉及文件/符号查询既有结构与邻域。
- 实现后：把 direct changes、one-hop impact、stale annotations 作为 completion report 的可选证据附件。

禁止接入点：

- 不改变 story readiness、ADR acceptance、测试结论或交付状态的唯一所有者。
- 不从 GraphBrain 自动创建任务包、类签名计划或实现步骤。

验收：关闭或卸载 GraphBrain 后，CGS 核心设计/开发流程仍可运行，只缺少可选代码证据。

## 8. P2：项目与引擎事实拆分

### P2U1：Graph format v3 设计

状态：**Completed（2026-08-13）**。已实现显式版本的 project/engine 双 artifact、stable external reference、原子 pair publication 与读时 resolver join。

目标：项目图只拥有 project facts，引擎事实只有一个 owner。

建议结构：

- project snapshot：项目 symbol、项目关系、文件森林、对 engine symbol 的 stable external reference。
- engine snapshot/cache：按 EngineAssociation、源码根身份、头文件哈希持有引擎声明事实。
- publication generation：原子绑定 project snapshot 与其依赖的 engine identity/reference set。
- query resolver：在读取时 join，不把 engine class/function 复制回 project graph。

必须明确：

- stable engine symbol ID 规则。
- external edge/reference schema。
- engine cache invalidation。
- source span 与 provenance。
- 缺失 engine symbol 时的诊断，不生成猜测 stub 语义。

### P2U2：v2 → v3 迁移与回滚

状态：**Completed（2026-08-13）**。迁移确定、幂等且保留 stable ID/provenance；真实 v3 → v2 rollback → v3 reactivation 已验证，旧 generation 保持不可变。

现有 v2 已有 `layer=project|engine`，可作为确定性拆分边界。

迁移步骤：

1. 读取并完整校验 v2。
2. project-layer 节点进入 project snapshot。
3. engine-layer 节点进入 engine snapshot 或 reference extraction 输入。
4. 跨层边转换为显式 external references。
5. 保持 stable IDs、source paths、关系方向和可证明的 provenance。
6. 对无法证明来源的 engine stub 标记 `unknown` 并输出诊断，不补猜来源。
7. 校验 v3 两侧与 cross-reference。
8. 原子发布新的 generation。
9. 原 v2 generation 保持不可变，作为直接 rollback 目标。

迁移必须确定、幂等；同一 v2 输入应产生相同语义输出和稳定内容哈希。

### P2U3：提取器能力与置信度

状态：**Completed（2026-08-13）**。提取器通过注册表声明 supported/heuristic/unsupported 能力；迁移不提升未知或启发式事实的可信度。

当前解析器继续作为快速 backend，但必须诚实声明能力，例如：

- declarations
- UHT reflection metadata
- same-name `.cpp` member usage heuristics
- delegate binding heuristics
- standalone translation-unit coverage
- Blueprint/runtime coverage：unsupported

为每类派生关系记录 direct/heuristic/confidence/evidence span。长期可新增 `clang-v1` backend，消费 UBT 生成的 `compile_commands.json`；新增 backend 通过 adapter/capability 声明接入，不把 backend 判断散落进 UI。

旧图迁移不得把 heuristic 事实升级成 proven；未知置信度保持 unknown。

### P2U4：旧参考图与知识标注迁移

状态：**Completed（2026-08-13）**。7 份参考图、18 条标注按 SHA-256 清单归档并生成审阅记录；未猜测写入当前规范。18 个 favorites 按原 stable ID 保存/重载通过。

步骤：

1. 为 7 份旧活动图生成版本化迁移清单和 SHA-256。
2. 审计所有深链、annotation target 和外部消费者。
3. 将旧参考图移入 `data/archive/curated-references-v1/`。
4. 18 条知识标注输出人工审阅文档，候选目的地为 CGS `spec/` 或 engine-reference。
5. 用户确认后再写入目标文档；未确认内容只归档，不进入当前规范。
6. 18 个 favorites 按 engine stable ID 迁移并做保存/重载验证。

旧参考图不得自动改标为当前源码事实。

### P2U5：1.0 兼容收敛

状态：**Completed（2026-08-13）**。消费者审计与兼容矩阵见 `docs/p2-compatibility-audit-2026-08-13.md`；版本已提升为 `1.0.0`，0.x 诊断 adapter 暂按发布说明保留。

只有满足以下条件才进入 GraphBrain 1.0：

- 已知旧消费者审计完成。
- 旧 authoring/Atlas API 调用为零。
- 旧 URL 迁移覆盖真实历史 fixture。
- v2 图可读取、迁移和回滚。
- Evidence v1 已成为 ToolRegistry/CGS 唯一新入口。

1.0 才允许移除 0.x 的 410 adapter 或旧 API；移除仍需 release note 与回滚说明。

## 9. P3：产品与运维表面削减

P3 先收集真实使用证据，再决定删除，不用主观偏好直接裁剪。

### P3U1：使用证据

状态：**Completed（2026-08-13）**。`graphbrain-local-usage/1` 只接受固定 allowlist 的本机聚合计数、耗时与 cache 命中；不记录查询、源码、路径、URL 或身份。

记录本地、非遥测的匿名运行摘要：

- Viewer 各 workspace 启动次数。
- Evidence endpoint 调用次数与延迟。
- Engine 全目录浏览、Mermaid、embed 的实际使用次数。
- refresh 耗时与 cache hit。

只存本机聚合数字，不记录搜索文本、源码内容或用户标识。

### P3U2：候选削减项

状态：**Completed（2026-08-13）**。决策与恢复边界见 `docs/p3-surface-decision-2026-08-13.md`：保留按需 Engine 浏览；退役 Mermaid 和通用 embed；架构改为活动 catalog preview 投影；smoke artifact 默认忽略。

- Engine API 从全量预同步改为项目引用与搜索驱动的按需解析。
- Cytoscape 已覆盖的关系图不再重复走 Mermaid。
- 无真实消费者的通用 embed 路径退役。
- 视觉 smoke 运行产物转为 ignored artifact。
- runtime release 只保留 current/previous/prepared 与显式审计需要的 release。
- 桌面为主的前提下，移动端只保留可访问性底线，不维持独立产品级表面。

每个删除项必须先列消费者、数据迁移、兼容期和恢复方式。

### P3U3：门禁分层

状态：**Completed（2026-08-13）**。`check:fast`、`check:data`、`check:release`、`check:lifecycle` 已分层；browser smoke 不可静默跳过。

建议：

- 快速门禁：layer-gate + typecheck + unit tests + validate。
- 数据/协议门禁：旧 fixture、迁移、发布、回滚、冲突保护。
- release 门禁：build + bundle + HTTP contracts + Viewer smoke。
- 生命周期改动：额外 soak。

不得把 skipped browser smoke 报告为 passed。

## 10. 测试与验证矩阵

| 场景 | 必须验证 |
| --- | --- |
| 当前 v2 数据 | load、validate、查询、旧深链 |
| v2 → v3 | deterministic、idempotent、cross-reference、无语义猜测 |
| v3 round trip | extract → publish → API/Viewer → reload |
| 回滚 | v3 publication → v2 generation → 服务/Viewer 正常 |
| stale working tree | status degraded、自动消费者 fail closed |
| refresh 成功 | 新 fingerprint、原子 publication、标注扫描 |
| refresh 失败 | 旧 generation 保持活动、无半写产物 |
| 并发 refresh/write | file lock、revision conflict、重试边界 |
| Engine cache | 引擎版本隔离、header 变更失效、项目图无复制 |
| reading-context | favorites/annotations 保存、冲突、重载、旧数据迁移 |
| ToolRegistry | manifest schema、health、ready/degraded、adapter 可替换 |
| CGS | GraphBrain 可选缺席时主流程不阻塞 |
| 退役残余 | 非 archive 活动代码不再读取 Atlas/design_doc |
| 服务安全 | CSP、mutation guard、路径边界、410 compatibility |
| UI | overview/explore/changes、旧 URL 兼容、freshness/coverage 可见 |

## 11. 完成标准

全部核心阶段完成时应满足：

1. GraphBrain 在 ToolRegistry 中有唯一、版本化、可健康检查的 evidence capability。
2. CGS/Agent 只通过稳定 Evidence API/skill 消费，不读取 GraphBrain 内部文件。
3. 自动证据必须 fresh；stale/unverified 不能静默形成评审结论。
4. project snapshot 不再复制 engine class/function 事实。
5. 活动 catalog 只展示当前可验证事实；历史和人工参考图进入版本化归档。
6. UE 最佳实践知识由 CGS 持有；迁移过程没有猜测语义。
7. Atlas、design_doc、任务包和设计回灌路径不再存在于活动工作流。
8. v2 数据可迁移、编辑其允许的 reading-context、保存、重载并回滚。
9. publication、reading-context 和 deployment 的冲突保护继续有效。
10. 当前测试、构建、bundle、HTTP、Viewer smoke 与适用 soak 全部通过。
11. 交付报告明确列出替换、删除、归档和有意保留的兼容层。

## 12. 建议的首轮执行批次

UX-1 已作为独立前置增量完成。用户后续要求继续执行时，默认先只执行以下小批次，不直接启动 v3 大迁移：

1. P0U1：基于已重新采集的验证结果完成工作树保护和可恢复检查点；未经用户指令不创建 commit。
2. P0U2：设计并测试 `graphbrain-evidence-status/1`。
3. P0U3：加入自动消费者 freshness gate。
4. P0U4：修复显式 refresh 闭环，验证 stale → fresh。
5. P0U5：提交残余入口审计清单，等待涉及语义归属的用户确认。

首批完成并验收后，再进入 ToolRegistry/CGS 接入；项目/引擎 v3 拆分作为独立里程碑实施。

## 13. 增量实施记录

| 日期 | 增量 | 状态 | 主要文件 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-08-13 | UX-1：证据信任状态贯穿 Viewer | Completed | `viewer/src/evidenceStatus.ts`、`viewer/components/common/EvidenceStatusBadge.tsx`、`viewer/components/home/HomeView.tsx`、`viewer/src/App.tsx`、`viewer/styles/workspace-refactor.css` | typecheck；265/265 unit；build；layer/validate/bundle；9/9 browser smoke |
| 2026-08-13 | P0U1–P0U4：Evidence Status v1、freshness gate、显式 refresh | Completed | `core/evidence/*`、`server/evidence.ts`、`tools/evidence.ts`、`server/catalog.ts`、`server/changes.ts`、`core/hooks/post-commit-update.ts` | revision 5 stale gate 拒绝；显式 refresh → revision 6 current；272/272 unit；layer/typecheck/validate/build/bundle；隔离生产候选 HTTP/runtime health |
| 2026-08-13 | P0U5：退役残余清理 | Completed | `G:/UnrealProject/CLAUDE.md`、`Tools/AffinePublish/publish-design.mjs`、`Sabotage/Tools/h3_beats.py`、审计清单 | 移除平衡/设计回灌归属；保留 CytoscapeViewer 与冻结 H3 prompt 路径 |
| 2026-08-13 | P0U6、P1：产物卫生与正式消费者接入 | Completed | `tests/smoke-artifacts.ts`、`tools/update-smoke-golden.ts`、`core/evidence/*`、ToolRegistry `graphbrain-evidence` adapter、CGS `$code-evidence` | 普通 smoke 不改 golden；Evidence v1 查询/freshness；ToolRegistry/CGS 可选缺席与 fail-closed 验证 |
| 2026-08-13 | P2：Evidence v3 与 1.0 收敛 | Completed | `core/schema/evidence-snapshot-v3.ts`、`core/store/evidence-publication.ts`、`core/evidence/resolver.ts`、`data/archive/curated-references-v1/`、`docs/release-notes-1.0.0-2026-08-13.md` | v2/v3 migration、幂等、回滚、冲突、tamper、保存/重载；真实 Evidence revision 5 current |
| 2026-08-13 | P3：产品削减与门禁分层 | Completed | `core/usage/*`、`server/retired-viewer-surfaces.ts`、`viewer/components/mindmap/ArchitectureWorkspace.tsx`、`package.json` | Mermaid/embed 410；286/286 unit；30/30 data；9/9 browser smoke；30 轮 soak，heap slope 0.021 MiB/cycle |
| 2026-08-13 | GraphBrain 1.0.0 生产发布 | Completed | `release-b6f585f29dbd9de72b224dc24850b003e1febc24fc2076fabbe5da93ca0069a1` | deployment revision 28；NSSM running；3030 health/runtime、Evidence current、ToolRegistry ready、symbol query、Mermaid/embed/归档 410 均通过；previous release 保留可回滚 |
