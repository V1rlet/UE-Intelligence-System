# GraphBrain 对外工具链契约（toolchain-contract）

状态：有效（A4，2026-08-23 制定）
上位规则：`AGENTS.md` 工程宪法第 10 条（新工具先定义边界再接入）。
本文是 GraphBrain 与 ClaudeGameStudios（CGS）及任意 agent 宿主之间的稳定接口契约。实现变化必须先改本文并升版本，不得先改实现。

## 1. GraphBrain 是什么

本地优先的只读 UE 代码事实底座：版本化、内容寻址、带 provenance 的代码事实（类/函数/依赖关系），叠加人工标注知识层。上游是 Sabotage 仓库（Lore VCS）与 UE 引擎；下游消费端是：

1. 人（3030 viewer，五工作区）；
2. agent / MCP 宿主（gb/1 工具面）；
3. ClaudeGameStudios 流程（设计评审、dev-story、架构评审时引用代码事实）。

GraphBrain 不拥有：玩法逻辑、叙事内容、任务数据、关卡设计。这些由 CGS 持有。

## 2. 稳定消费面（唯一合法入口）

### 2.1 Evidence HTTP API v1（`http://127.0.0.1:3030/api/evidence/v1/*`）

- `GET /status`：新鲜度、publication revision、快照身份、consumer_gate。
- `GET /symbols?q&type&module&layer&limit`：符号检索。
- `GET /symbol?id=`、`GET /neighborhood?id=`：详情与一跳邻域。
- `POST /refresh`（body `{project}`）：触发提取刷新；409=busy，422=skipped，503=failed。
- 错误信封：`{ "error": string, "code": string }`；格式 `graphbrain-evidence-error/1`。

### 2.2 gb/1 MCP 工具面（stdio，`npm run mcp`）

只读工具：`gb_status`、`gb_search_symbols`、`gb_symbol_detail`、`gb_neighborhood`、`gb_impact`、`gb_changes`、`gb_annotations_get`。
协议版本前缀 `gb/1`；破坏性变更升 `gb/2` 并行退役 `gb/1`。全部工具无写语义；未知工具调用被拒绝执行。

### 2.3 共同语义

- **provenance 原样透传**：每份事实附带 snapshot_id、publication_revision、source_v2_generation（file+sha256）、engine_identity。
- **新鲜度 fail-closed**：快照 freshness ≠ current 时默认拒绝返回事实数据，返回 `EVIDENCE_STALE` 类诊断码；显式降级参数为 HTTP `?allow-nonfresh=true` / MCP `allowStale=true`。消费者不得绕过门槛后把旧事实当现状陈述。
- **单一事实源**：MCP 与 HTTP 消费同一 resolver 与同一门槛实现；两者输出在相同 revision 下一致。

## 3. 数据新鲜度语义

- 指纹：`sha256-path-content-v1`（路径+内容）覆盖注册项目源码根；图谱 provenance 记录提取时的指纹值与 file_count。
- current：活动发布代次的指纹 == 当前工作树指纹。
- stale：检测到指纹不一致或源码文件晚于提取时间；stale 不等于错误，但 fail-closed 消费者必须先 refresh 或显式降级。
- 自动刷新：Sabotage 提交 → lore-watcher（生产 release-server 内嵌 + dev 形态并存；hook.lock busy-skip 保证双形态安全；`GRAPH_BRAIN_NO_WATCHER=1` 为验收/排障逃生阀）→ post-commit-update 提取发布 → 回路基线门禁（新增依赖回路 WARN 并推进基线，见 `core/query/arch-baseline.ts`，格式 `graphbrain-arch-baseline/1`）。

## 4. 版本化与退役政策

- 持久化格式一律显式 format_version（图 v2、证据快照 v3、reading-context v1、change-report v1、publication state v1…）；读取方拒绝未知版本而非猜测。
- 退役入口集中返回 410 + 稳定 code（如 `VIEWER_SURFACE_RETIRED`、`GRAPHBRAIN_AUTHORING_RETIRED`）；0.x/1.x 内不删除适配器，只在主版本破坏性退役。
- 本契约的破坏性变更 = 主版本变更 + 本文更新 + 交接文档记录迁移路径。

## 5. CGS 侧义务

1. 只经 §2 的两个入口消费；**禁止直接读取 `data/` 目录内部文件布局**——目录结构是实现细节，不受契约保护。
2. 尊重 consumer_gate：gate 不允许时不引用事实结论；需要最新事实时调用 refresh 并等待 current。
3. 标注知识层经 viewer/API 写入（带 If-Match 冲突保护）；agent 侧本轮无写入通道（D-P5 裁决：不开）。
4. 引用事实时保留 provenance（至少 snapshot_id 与 freshness），不得剥离来源后二次传播。

## 6. GraphBrain 侧承诺

1. §2 列出的端点/工具名与错误码在本大版本内向后兼容；字段只增不删（删除走版本升级）。
2. 服务健康探针：`tools/service-health-check.ts` 的断言集即对外可用性的可执行定义。
3. 变更流程：任何影响 §2/§3 的 PR 必须同步修改本文与 `docs/NEXT_AGENT_HANDOFF.md`，并由 check 链中的契约测试锁定。
