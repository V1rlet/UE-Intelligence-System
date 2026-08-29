# GraphBrain

GraphBrain 是一个本地优先的只读 UE 代码架构查看器。它从 C++ 源码提取版本化 `ue5_code` 事实，并用同一份事实提供总览、架构/关系/API 探索、版本化变化与影响阅读，以及代码标注。

GraphBrain 不再拥有架构方案、关卡设计、叙事/任务设计、实现规划、复核、交付、任务包或 World Atlas。上述创作与生产状态归 ClaudeGameStudios；空间和运行时事实归 Unreal Engine。

## 当前能力

- UE C++ 类型、成员、函数、继承、调用、委托和模块依赖提取。
- 项目代码与 UE 引擎源码的只读导航。
- `总览 / 探索 / 变化` 三个一级目的地；架构、关系图、引擎源码索引、API 和类 Spec 收敛在探索内。
- 两个提取快照之间的版本化语义变化报告，分开呈现直接变化和一跳关系影响；报告只引用图，不复制图事实。
- 依赖回路、耦合和影响范围的只读分析；默认仅输出终端，显式 `--out` 才生成事实报告。
- 收藏与代码事实标注；二者由单一、版本化 reading-context 持有，通过稳定 `domain/subsystem/node_id` 关联，不修改代码图。
- 提交钩子/轮询器更新代码事实并扫描标注陈旧度。

## 快速开始

```powershell
npm install
npm run viewer
```

默认开发地址由 Vite 输出。常用检查：

```powershell
npm run check:fast       # 普通代码改动
npm run check:data       # 格式、迁移、发布与回滚
npm run check:release    # 构建、bundle 与浏览器冒烟
npm run check:lifecycle  # 长时间 soak
```

编码与评审遵循 [工程编码标准 v1](docs/engineering-standard-v1.md)。`check:fast` 首先执行标准门禁：未登记的显式 `any`、TypeScript 类型压制、过期/陈旧例外和分层边界穿透会直接失败；唯一例外入口是 `config/engineering-standard-exceptions.json`。规范迭代的审阅证据和迁移方案见 [2026-08-13 迭代方案](docs/engineering-standard-iteration-plan-2026-08-13.md)。

常驻服务安全升级：

```powershell
npm run service:prepare   # 隔离打包前端+API runtime+bootstrap，并完成 HTTP + 五视图验收
# 以下两项需要管理员终端
npm run service:activate  # 切换已验收 release；失败自动恢复旧服务
npm run service:rollback  # 显式回到 previous release
```

`npm run smoke:soak` 会在同一浏览器文档中反复切换五个工作区，强制 GC 后检查堆、DOM、监听器和 Document 的保留斜率；报告写入 `logs/smoke/runtime-soak.json`。可用 `GB_SOAK_CYCLES` 调整循环数。

源码提取与分析：

```powershell
npm run extract:ue5-classes -- <Source目录> --subsystem project --out data/graphs
npm run build:change-report -- --baseline <旧图> --current <当前图> --data-dir data
npm run data:status
npm run data:rollback -- --subsystem project
npm run data:prune             # dry-run：列出可安全删除的历史管理文件（默认保留当前/回滚/报告引用）
npm run data:prune -- --apply  # 确认后执行删除；旧日期/未知/损坏文件只报告不删除
npm run analyze -- --graph ue5_code_project_ --cycles --coupling
npm run annotations:scan -- ue5_code project
```

Evidence 是对外唯一稳定的代码证据边界：

```powershell
npm run evidence:status
npm run evidence:check
npm run evidence:refresh
npm run evidence:snapshot -- status
```

`evidence:check` 默认要求 fresh；stale/unverified 不能静默支持自动结论。ToolRegistry/CGS 只通过 Evidence API v1 适配器消费，不直读 `data/evidence` 或 GraphBrain 内部模块。

提取器现在把图与变化报告写成不可变、SHA-256 内容寻址文件，完成 schema、引用与交叉关系校验后，只通过 `data/publications/ue5_code.json` 的一次 revision 切换发布。旧日期文件继续由集中兼容边界读取，不会被覆盖或猜测迁入清单。解析缓存是可重建加速层；reading-context 保持独立 revision 所有权，并只在事实发布成功后扫描陈旧度。

## 数据所有权

- `data/graphs/*.cyto.json`：活动 `ue5_code` v2 事实；来源指纹、覆盖率和诊断位于 `meta.provenance/coverage`。
- `data/changes/*.change.json`：`format_version: 1` 的派生比较证据；当前快照引用和指纹必须命中活动图，删除后可从两份图确定性重建。
- `data/publications/ue5_code.json`：`format_version: 1` 的代码事实发布指针；一个 generation 同时绑定图和可选变化报告的文件名与 SHA-256，并用单调 revision 提供冲突保护和无损回滚。
- `data/reading-context/ue5_code.json`：标注与类/函数收藏的唯一活动所有者，写入使用 revision/ETag 冲突保护。
- `data/api-catalog/`：UE API 本地缓存（官方模块页 + 按需解析的引擎类）。
- `data/archive/`：迁移证据，永不由活动运行时加载。

v1 图通过 `npm run migrate:graph-versions -- --apply` 确定性迁移；迁移只保留已有来源根并标记证据 `unknown`。需要结构回滚时使用 `npm run migrate:graph-versions -- --apply --rollback-v1`。

旧标注数组和服务端收藏通过 `npm run migrate:reading-context -- --apply` 迁移；原文件带哈希归档。浏览器旧收藏键只在 `viewer/src/readingContextMigration.ts` 读取一次，服务端导入成功后删除。

## 退役与兼容

用户已批准破坏性删除旧创作平台数据。466 个持久化数据文件的路径、大小和 SHA-256 记录在 [`data/archive/authoring-platform-v1/deletion-manifest.json`](data/archive/authoring-platform-v1/deletion-manifest.json)；另有 10 个独立创作原型/设计卡文件记录在 [`data/archive/authoring-platform-v1/residual-deletion-manifest.json`](data/archive/authoring-platform-v1/residual-deletion-manifest.json)。原内容无法从 GraphBrain 恢复。非代码标注与无活动图所有者的代码标注被逐字节迁入同一归档目录。

旧创作 API 通过单一服务端边界返回 HTTP 410 和 `GRAPHBRAIN_AUTHORING_RETIRED`；旧创作 URL 通过单一路由归一化边界回到总览并显示诊断。旧 `view=home|architecture|code|graph|api` 仍由同一边界接受，新 URL 只写 `overview / explore / changes` 信息架构。410 适配器在 0.x 系列保留，只能在 1.0 破坏性版本、完成已知消费者审计后移除。

World Atlas 的历史归档仍在 `data/archive/world-atlas-v18/`，只作审计证据。

更多信息：

- [使用说明](docs/USAGE.md)
- [架构与边界](docs/architecture.md)
- [工程编码标准 v1](docs/engineering-standard-v1.md)
- [数据格式](docs/schema.md)
- [产品定位](docs/product-positioning.md)
