# 使用说明

## 三个一级视图

- `0` 总览：活动代码图、规模、覆盖率和来源新鲜度。
- `1` 探索 → 架构：按职责层级阅读由代码事实生成的总览。
- `2` 探索 → 关系：查看项目/引擎关系；探索内还可切换架构/API。
- `3` 变化：比较版本化快照，分开阅读直接变化和一跳关系影响。
- `4` 探索 → API：在同一探索上下文中直接打开“API → 全部”。

`?` 打开帮助，`/` 聚焦搜索，`F` 或 `Home` 适配画布，`+/-` 缩放。图和类型详情只读。

## 深链

- `?view=explore&mode=architecture&scope=<id>`
- `?view=explore&mode=relations&file=<graph.cyto.json>&source=project&spec=<node-id>&focus=<node-id>`
- `?view=explore&mode=relations&file=<graph.cyto.json>&source=engine`
- `?view=explore&mode=api&file=<graph.cyto.json>&source=all`
- `?view=changes`

旧 `view=home|architecture|code|graph|api`、`lens` 和 `spec_layer=engine` 链接仍由 `appRoute.ts` 的单一兼容边界确定性转换，但运行时只写新 URL，不重新挂载重复入口。

旧 planning/review/delivery/design/Atlas 链接回到首页并显示退役诊断；不会加载已删除文件。旧代码 mindmap 链接集中迁移到 `architecture`。

## 标注

标注是允许写入的阅读上下文，但不是代码事实：

1. 在代码图、类详情或 API 详情中选择真实节点。
2. 新增 gotcha、best practice、design decision、performance 或 reference。
3. 保存时记录稳定 domain/subsystem/node ID 和可用的源码绑定哈希。
4. 源码变化后运行 `npm run annotations:scan -- ue5_code <subsystem>`。
5. 陈旧标注必须人工复核，系统不猜测新的语义或目标。

非 `ue5_code` 标注 API 返回 410。没有活动图所有者的标注不进入活动目录。

## 数据更新

```powershell
npm run extract:ue5-classes -- G:/UnrealProject/Sabotage/Source --subsystem project --out data/graphs
npm run extract:ue5-classes -- G:/UnrealProject/Sabotage/Source --subsystem project --out data/graphs --incremental --changes-out data/changes
npm run build:change-report -- --baseline data/archive/<基线图> --current data/graphs/<当前图> --data-dir data
npm run data:status
npm run data:rollback -- --subsystem project
npm run build:references
npm run build:mindmap
npm run sync:ue-api
```

提交钩子只执行增量源码事实更新、派生变化比较和标注陈旧度扫描，不生成计划、设计报告、设计包或任务包。图和变化报告使用内容寻址文件，同日执行也不会覆盖基线；只有 version 1 发布清单切换后，服务端才会暴露新 generation。`data:rollback` 只切换清单顺序，不改写或删除不可变产物。旧 `--out` 变化报告参数暂时保留为薄兼容适配器，新的稳定入口是 `--data-dir`。

## 架构分析

```powershell
npm run analyze -- --graph ue5_code_project_ --cycles --coupling
npm run analyze -- --graph ue5_code_project_ --impact-files Foo.cpp,Bar.h
```

默认只输出终端。需要持久化代码事实报告时显式添加 `--out <目录>`；输出带 `format_version: 1` 和 `kind: ue5_code_architecture_analysis`。
