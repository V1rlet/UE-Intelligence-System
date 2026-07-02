# Graph Brain — Architecture Decisions

> 本文件记录项目中的关键技术决策和设计理由。
> 内容由 Claude Code 在每个 Phase 完成时自动从 progress.md 毕业到此处。
> 也可手动追加重要的设计决策。

---

## 项目定位

自托管的领域无关知识图谱平台，以 UE5.8 项目代码分析为首个应用场景。
支持战争迷雾式渐进探索、节点级知识标注、自动化代码同步更新，
可扩展到关卡设计和叙事设计等其他游戏开发领域。

## 初始架构决策（项目启动前确定）

### 标注与图谱数据分离存储
- **决策**: Annotation JSON 独立于 Graph JSON
- **理由**: 图谱 JSON 由 Adapter 自动生成并频繁覆写，标注由人类手动维护。合并存储会导致 Adapter 更新时覆盖手动标注。分离后各自独立演化。

### 领域适配器可插拔架构
- **决策**: 图谱核心 (core/) 领域无关，每个数据源通过 Adapter 接口接入
- **理由**: 同一套渲染/查询/标注基础设施需复用于代码架构、关卡设计、叙事关系等多个领域。紧耦合会导致每个新领域重复造轮子。

### 三态节点（Fog / Silhouette / Explored）
- **决策**: 未探索的引擎子系统显示为折叠的抽象节点，按需展开
- **理由**: UE5.8 有数千个类，全量展开不可行也不必要。抽象层保持图谱聚焦于实际使用的部分，同时让未探索区域可见但不干扰。

### API 查询器融入 Graph Brain 而非独立构建
- **决策**: 将原计划独立构建的 UE API 查询工具作为 Graph Brain 的第二个视图（API Reference View），共享同一份数据源
- **理由**: API 条目的字段（函数签名、所属类、参数、搭配函数、踩坑提示）与 Graph Brain 的 `ufunction` 节点 + 标注完全重叠。独立构建会导致两份数据需要同步维护。融合后 Adapter 解析 `.h` 文件时同时生成类节点和函数节点，一次解析驱动两个视图。
- **实现**: `ufunction` 节点增加 `api` 子对象存储签名/参数/搭配函数等结构化字段；踩坑提示和使用场景通过标注系统附加，不在 `api` 子对象中重复。

---

<!-- 以下内容由 Claude Code 在 Phase 完成时自动追加 -->

## Phase 1: Graph Core + 最小管线 — 完成于 2026-07-02

管线全通路：`extract-modules.ts`（Build.cs → .cyto.json）→ `validate.ts`（schema + 图内引用检查）
→ Vite 查看器（React + Cytoscape.js 渲染 + 标注面板）→ `core/annotation/store.ts`（标注分离持久化）。
E2E 双向验证通过：给 Sabotage.Build.cs 增/删依赖，重跑 Adapter 后查看器数据即时正确。

### 关键决策

- **技术栈统一 TypeScript**：schema 验证用 ajv，Adapter 解析 .Build.cs/.h 用 TS/Node，查看器
  Vite + React 19 + Cytoscape.js。只维护一套工具链与类型定义；UE 源文件解析靠正则与词法扫描
  即可，无需 Python 生态。只有 package.json，无 pyproject.toml。
- **图谱文件顶层格式 `{ meta, elements }`**：`elements` 直接兼容 `cytoscape({ elements })`；
  `meta` 携带 domain / generated_at / generator / source_root 溯源信息，供增量更新（P4U2）
  和陈旧检测（P4U3）使用，不污染节点数据。
- **Schema 分层策略（draft-07）**：核心字段领域无关——`type`/`relation` 在核心层为自由字符串，
  `layer`/`visibility` 枚举全局生效；`domain: "ue5_code"` 时用 if/then 条件子模式把
  type/relation 收紧为 UE5 枚举，并强制 `ufunction`→`api`+`parent`、`meta_group`→
  `children_count`、`lifecycle_sequence`→`order`。新领域无需改核心 schema。
- **单进程数据服务**：Vite dev server 中间件承载 `/api/graphs`（文件列表）、`/data/*`（数据直读，
  防路径穿越）、`/api/annotations/:domain/:subsystem`（标注增删改查）。P1 单人本地使用，
  避免多服务编排。端口固定 3030（strictPort；3010/3021/3022 已被本机其他服务占用）。
- **标注写前校验拒写**：store.ts 每次写入前用 annotation.schema.json 校验，坏数据抛错拒写，
  保证 `data/annotations/` 永远通过 validate.ts。标注文件按 `{domain}_{subsystem}` 分片，
  与图谱文件同粒度。
- **模块可见性规则**：扫描到 Build.cs 的模块 project/explored；仅作为依赖出现的模块
  engine/silhouette——对应三态规则"项目依赖即自动 Fog→Silhouette"。
- **Cytoscape 样式为纯 JSON stylesheet**（编码规范要求）：无法内嵌计算逻辑的映射（度数→
  节点大小）在加载时预计算为 `data.size` 字段，样式表用 `data(size)` 取值。

### 遇到的问题与解法

- **Build.cs 注释里的依赖会被误提取**（UE 模板工程注释着 SlateCore/OnlineSubsystem 示例）
  → 解析前用小型词法器剥离 C# `//` 与 `/* */` 注释，字符串字面量内容保留。
- **Node 的 JSON.parse 不接受 UTF-8 BOM**（Windows 编辑器/PowerShell 写出的 JSON 常带）
  → validate.ts / store.ts 读文件先剥 BOM。
- **PS 5.1 `Invoke-WebRequest -Body` 按 ASCII 发送**，中文正文变 `?` 且无报错
  → 命令行测 API 用 `[Text.Encoding]::UTF8.GetBytes($body)`；浏览器 fetch 无此问题。
- **allow-scripts 拦截 esbuild postinstall** → tsx / vite 实际运行正常，暂不处理。
