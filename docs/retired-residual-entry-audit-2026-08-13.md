# P0U5 退役残余入口审计（2026-08-13）

状态：**Completed（2026-08-13）；用户已确认三项处置。**

审计范围：`G:/UnrealProject/CLAUDE.md`、`Tools/AffinePublish`、`Sabotage/Tools/h3_beats.py`，以及 `Tools`、`ClaudeGameStudios`、`Sabotage` 下排除 `archive`、构建产物、日志和依赖目录后的 `GraphBrain` / `World Atlas` / `design_doc` 引用。

## 已确认并完成的处置

| 位置 | 实际消费者/状态 | 风险 | 建议动作 | 回滚/保留路径 |
| --- | --- | --- | --- | --- |
| `G:/UnrealProject/CLAUDE.md` | 将“xlsx 平衡表 → UE DataTable/GraphBrain”改为“xlsx → csv → balance-check / UE DataTable” | GraphBrain 不再被声明为平衡领域所有者 | 文本变更可逐行恢复；不影响数据 |
| `Tools/AffinePublish/publish-design.mjs` | 删除 `GRAPHBRAIN_EMBED_BASE`、`design_doc` importer 与 `/embed/design_doc/*` 分支 | 保留 CytoscapeViewer 数据写入、链接和 AFFiNE publish 主流程 | 文件版本控制可恢复；CytoscapeViewer 路径不变 |
| `Sabotage/Tools/h3_beats.py` | 保留为 Sabotage/CGS 持有的冻结概念预览 prompt 资产；Atlas 只记录为历史 provenance | 文件明确不读取 Atlas 归档/API/GraphBrain 数据，也禁止从退役内容自动重建产品语义 | prompt 与机位内容未改，文件可独立使用 |

## 有意保留

- `Sabotage/AGENTS.md`：只把 GraphBrain 定义为可选、只读、需 freshness gate 的代码证据，边界正确。
- `Tools/ToolRegistry/README.md` 与 `ClaudeGameStudios/skills/level-builder/SKILL.md`：明确 GraphBrain 不拥有设计/规划、World Atlas 已退役，边界正确。
- `Tools/ToolRegistry/adapters/h3/*` 及 `registry.json` 中的 “Atlas Cloud API”：指 MiniMax H3 的外部生成服务，不是退役的 GraphBrain World Atlas，不应误删。
- `Sabotage/design/previews/previews_20260804.md`：明确预览不回灌为 GraphBrain 事实，边界正确。
- AFFiNE 的 CytoscapeViewer 与附件/markdown 路径：独立于 GraphBrain，可继续恢复和使用。

## 审计结论

未发现活动代码直接读取 `GraphBrain/data/archive/world-atlas-*`，也未发现 `h3_beats.py` 的外部消费者。确认后的活动工具链不再把 GraphBrain 声明为平衡、AFFiNE 设计图或 H3 prompt 的所有者；AFFiNE 与 H3 的非 GraphBrain 路径均保留。
