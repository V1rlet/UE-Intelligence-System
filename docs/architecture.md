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

### 技术栈统一 TypeScript（P1U1 定案，2026-07-02）
- **决策**: 全项目统一 TS：schema 验证用 ajv，Adapter 解析 .Build.cs/.h 也用 TS/Node，查看器 React+TS
- **理由**: 只维护一套工具链与类型定义；UE 源文件解析靠正则与词法扫描即可，无需 Python 生态。只需 package.json，无 pyproject.toml。

### 图谱文件顶层格式：{ meta, elements } 包装（P1U1 定案，2026-07-02）
- **决策**: `.cyto.json` 顶层为 `{ meta, elements: { nodes, edges } }`，而非裸元素数组
- **理由**: `elements` 子对象可直接传给 `cytoscape({ elements })` 保持原生兼容；`meta` 携带 domain / generated_at / generator 等溯源信息，供增量更新（P4U2）和标注陈旧检测（P4U3）使用，不污染节点数据。

---

<!-- 以下内容由 Claude Code 在 Phase 完成时自动追加 -->
