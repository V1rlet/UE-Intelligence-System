# 活动数据格式

GraphBrain 的活动持久化格式只有三类：UE 代码图、reading-context，以及可重建的代码变化报告。所有旧设计、规划、关卡、叙事、任务、时间线与交付格式均已退役，不由当前 schema 接受。

## 图：`*.cyto.json`

`core/schema/graph.schema.json` 要求：

- `meta.domain` 固定为 `ue5_code`。
- `meta.format_version` 固定为 `2`。
- `meta.generated_at` 与 `meta.generator` 明确记录提取时间和生成器。
- `meta.provenance` 是源码来源的唯一所有者：包含版本化来源 schema、来源类型、源码根，以及仅在可证明时写入的 SHA-256 内容指纹。
- `meta.coverage` 明确记录发现、消费、跳过、失败文件数和逐项诊断；旧图迁移后的值为 `unknown`，不得补猜。
- `meta.subsystem` 提供稳定子系统身份。
- `elements.nodes[]` 与 `elements.edges[]` 显式存在。
- 节点/边 ID 全局唯一，边端点和 parent 必须命中现存节点。
- 节点类型与关系受 `adapters/ue5-code/meta.ts` 的领域声明约束。

持久化结构升级时必须增加格式版本，并提供确定、幂等、可测试的迁移。不得从文件名或日期猜版本。v1 的 `meta.source_root` 只在 `core/schema/graph-version.ts` 兼容边界读取；v2 写入者只使用 `provenance.source_roots`。

## 阅读上下文：`data/reading-context/ue5_code.json`

`core/schema/reading-context.schema.json` 统一持有标注与收藏：

- `format_version = 1`、`domain = "ue5_code"`；
- `revision` 每次成功写入单调增加，HTTP 写入必须携带 `If-Match`；不匹配返回 409 和最新投影；
- 标注的 `subsystem/node_id` 必须指向活动代码图真实节点，类型为 gotcha、best_practice、design_decision、performance 或 reference；
- 收藏使用 `kind/source/node_id` 作为稳定身份，类与函数不再分散在服务端文件和 localStorage；
- 源码绑定字段用于检测陈旧度，不取代 node ID。

标注可以描述架构观察或历史决策，但不能新增类、关系、计划或实现状态。

旧 `data/annotations/*_annotations.json` 与 `data/api-favorites/*` 只由 `tools/migrate-reading-context.ts` 读取；迁移后进入带 SHA-256 清单的归档，不再是运行时输入。旧浏览器收藏键只由 `viewer/src/readingContextMigration.ts` 处理。

## 变化报告：`data/changes/*.change.json`

`core/schema/change-report.schema.json` 定义 `format_version = 1` 的只读派生格式：

- `baseline/current` 只持有快照文件名、提取时间和可用的来源指纹；旧 v1 基线没有证据时明确保存 `null`，不猜测；
- `changes` 记录按稳定 ID 排序的新增、移除、语义修改节点与关系；布局 `position` 和提取统计 `metrics` 不制造语义修改；
- `impact.direct_node_ids` 是直接变化集合，`affected_node_ids` 只是一跳关系邻居，两者不混为实现结论；
- 默认校验要求 `current.file`、subsystem 和指纹命中活动图；基线允许位于归档，因为归档不会被 UI 当活动事实加载。

这是新增派生格式，不迁移既有用户内容。旧图可直接作为基线输入。退出/回滚路径是删除 `data/changes` 中的报告：活动图与 reading-context 不受影响，变化页显示空状态；需要时可用两份图确定性重建。增量提取只在基线与目标文件名不同的情况下自动生成报告，同日覆盖会拒绝制造含糊基线并要求显式归档或比较。

## 归档

`data/archive/` 不属于活动 schema 表面。迁移 manifest 自带独立 `schema` 标识、文件哈希与策略说明；默认 validator、catalog 和服务器文件读取均排除归档。

## 校验

```powershell
npm run validate
npm run validate:examples
npm run migrate:graph-versions
npm run migrate:graph-versions -- --apply
npm run migrate:graph-versions -- --apply --rollback-v1
npm run migrate:reading-context
npm run migrate:reading-context -- --apply
npm run build:change-report -- --baseline <旧图> --current <当前图>
```

默认校验活动 `data/graphs`、`data/reading-context` 与 `data/changes`，并执行 annotation → subsystem/node、变化报告 → 当前图/指纹的所有权检查。
