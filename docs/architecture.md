# 架构与边界

工程实现受 `docs/engineering-standard-v1.md`（format version 1）约束。`scripts/engineering-standard-gate.ts` 负责类型逃生舱和集中例外，`scripts/layer-gate.ts` 负责 `core → adapters` 精确运行时边界；二者都是 `check:fast` 的前置门禁。

## 运行结构

```text
UE C++ source
  -> adapters/ue5-code (parse, normalize, version)
  -> immutable data/graphs/ue5_code_*__gbtx-*.cyto.json
  -> core/query/change-report -> immutable data/changes/*__gbtx-*.change.json
  -> data/publications/ue5_code.json (one atomic generation pointer)
  -> server (catalog, graph, change reports, reading context, engine API)
  -> viewer (overview, explore, changes)
```

每类代码事实只有一个所有者：项目事实归活动 `ue5_code` 图；按需解析的引擎事实归引擎 resolver/cache。统一代码上下文按来源选择事实集，架构总览、图画布、类 Spec、API 详情、搜索、hover 和标注不会维护第二份类结构。变化报告只持有稳定 ID、快照引用、计数和一跳推导，不复制当前节点事实；“定位”始终回到活动图 resolver。引擎事实不会动态写入项目图。

一级导航固定为总览、探索、变化。探索内的查看方式固定为架构/关系/API；“来源”是下层语境，关系提供项目/引擎，API 提供项目/引擎/全部。关系 → 引擎承载原引擎源码索引的模块森林与声明关系。它和引擎 API 共用 `useEngineCatalog` 的目录位置及 `useEngineClassParser` 的解析事实；API 不拥有独立一级入口、来源 tab、目录副本或解析缓存。旧 `lens=source` 只在 `appRoute.ts` 的单一兼容边界迁移为 `source=engine&lens=relations`。

## 模块

- `adapters/ue5-code/`：C++/UE 反射提取、引擎类型解析、架构参考构建。
- `adapters/registry.ts`：唯一活动 adapter 注册点，仅含 `ue5_code`。
- `core/schema/`：活动图、reading-context、变化报告的 schema、引用和一致性检查。
- `core/reading-context/`：用户标注与类/函数收藏的唯一持久化所有者，提供 revision 冲突保护；`core/annotation/`、`core/favorites/` 只是领域投影。
- `core/query/`：代码图的纯分析算法、版本化变化/一跳影响模型与只读 CLI。
- `core/store/data-publication.ts`：生成代码事实的唯一发布边界；持有 version 1 generation 清单、不可变产物哈希、revision 冲突保护、旧目录兼容读取和指针回滚。
- `core/hooks/`：更新代码事实并扫描标注陈旧度。
- `core/service/`：常驻服务 release/deployment 的 v1 状态协议、内容寻址与 revision 冲突保护；不拥有代码图或 reading-context。
- `server/`：活动读取/标注/变化报告 API，以及集中 410 兼容边界。
- `viewer/`：总览、探索、变化三个顶层目的地和共享只读详情组件。

## 持久化边界

- 图格式：`meta.domain = "ue5_code"`、`meta.format_version = 2`；`provenance` 独占来源身份和内容指纹，`coverage` 独占提取范围与诊断。
- reading-context：只允许 `domain = "ue5_code"`，标注引用必须命中同 subsystem 的活动节点；所有写入使用 revision/ETag。
- 变化报告：`format_version = 1`，是图快照的可重建派生物；当前文件名、subsystem 和指纹必须命中活动图，基线可来自归档且证据不足时必须保留 `fingerprint: null`。
- 数据发布：`data/publications/ue5_code.json` 使用 `format_version: 1` 和单调 revision。每个 generation 只引用一份内容寻址图及其可选变化报告；服务端目录、直接文件路由、投影和标注陈旧度解析共同消费这一状态。无清单的旧日期文件只在同一兼容边界可见，不会被自动写入新状态。
- 迁移脚本只处理活动代码格式，不推断或复活退役领域；v1→v2 与 v2→v1 结构回滚均由同一版本边界处理。
- `data/archive/` 永远不被 catalog 和服务端活动文件读取扫描；只有显式变化构建 CLI 可以把归档图作为基线输入。
- `runtime/deployment-state.json`：本机常驻服务的唯一 release 选择，`format_version: 1` 且使用单调 revision；`runtime/releases/` 是不可变、SHA-256 内容寻址的完整运行包。当前 release manifest 为 v3 / runtime protocol 1，同时绑定前端、server runtime 与 bootstrap 哈希。二者是生成的运维状态并被 Git 忽略，不复制或拥有领域事实；代码图、变化报告和 reading-context 始终由项目 `data/` 持有。

## 常驻服务发布边界

`npm run service:prepare` 在隔离目录构建候选包，把静态前端、由同一源码打包的 API runtime 和 manifest bootstrap 合成 release v3，再以临时本机端口启动该 release，并验证首页、嵌入页、图目录、默认变化报告详情、引擎目录及五个真实工作区。只有全部通过才写入 `prepared_release`。首次执行会把旧 `viewer/dist` 与当时可验证的 server runtime 一起封存为 `legacy-*`；本轮形成的 frontend-only v1 和 runtime v2 通过同一个映射迁移边界升级为 v3，旧目录不再被 launcher 接受。

管理员运行 `npm run service:activate` 后，NSSM 才改用已验收 release 内的 `bootstrap.mjs`。bootstrap 只读取 `deployment-state.json.current_release`，并启动同一 release 的 `server.mjs`；它不扫描时间戳、猜最新目录或加载工作区中的 server 实现。服务启动或健康检查失败时，工具恢复旧状态和旧 NSSM 启动参数；`npm run service:rollback` 会同时切换 state 与 release bootstrap。旧 `install-service.cmd` 仅保留为 prepare + activate 薄入口，不再持有第二套安装逻辑。

## 兼容边界

- `viewer/src/appRoute.ts` 统一读取旧 URL，并只写 `overview / explore / changes` 新 URL。旧创作 URL 不加载旧文件，只返回总览诊断。
- `server/retired-authoring-tools.ts` 统一返回 410 `GRAPHBRAIN_AUTHORING_RETIRED`。
- `server/retired-world-tools.ts` 统一返回 World Atlas 410。
- 业务组件不得包含散落的 legacy 判断。

## 退役决策（2026-08-08）

用户确认完整迁移并破坏性删除 GraphBrain 创作平台：

- 删除 `design_workspace`、`level_design`、`narrative`、`quest`、`ue5_planned` 图和相关 adapter/schema/store/server/viewer/test。
- 删除设计包、任务包、计划审计、时间线、文档/实体注册、工作台和报告数据。
- 保留代码标注；退役领域标注与孤儿代码标注逐字节归档，不进入活动服务。
- ClaudeGameStudios 拥有架构决策、关卡方案、Programmer 计划、评审和交付。
- Unreal Engine 拥有空间、资产和运行时事实。

持久化数据删除回执：`data/archive/authoring-platform-v1/deletion-manifest.json`；独立创作原型与设计卡删除回执：`data/archive/authoring-platform-v1/residual-deletion-manifest.json`。GraphBrain 无内容恢复路径；如需恢复，只能从仓库外备份或历史版本显式重建，并作为新的迁移项目审查。
