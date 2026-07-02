# Graph Brain — Project Specification

> 自托管的领域无关知识图谱平台。
> 第一个应用场景：UE5.8 项目代码架构分析。
> 后续扩展：关卡设计拓扑、叙事关系网络、任务图等游戏开发领域。

---

## 会话恢复协议

**每次会话开始时必须执行以下步骤（无例外）：**

1. 读取 `progress.md`，识别当前 Phase 和最新完成的 work unit
2. 读取上一个 work unit 产出的关键文件，确认文件完整且状态一致
3. 向用户报告：
   > 当前进度：Phase X / Work Unit Y 已完成。下一步：P{X}U{Z} — {简述}。是否继续？
4. 等待用户确认后开始工作
5. 工作完成后：
   - 更新 `progress.md`（勾选当前 unit，写入下一步摘要）
   - `git add -A && git commit -m "graph-brain: P{X}U{Y} - {简述}"`
   - 向用户报告：
     > 本次完成：{描述}。下次启动从 P{X}U{Z} 继续。

**如果用户只说"继续"或"接着做"，直接按上述协议恢复，不要询问要做什么。**

---

## 阶段毕业协议

当一个 Phase 的全部 work unit 完成时，执行以下步骤：

1. 从该 Phase 的工作中提取：
   - 做出的关键架构决策及理由
   - 遇到的重要问题及解决方案
   - 最终选定的技术方案
2. 将上述内容追加到 `docs/architecture.md`，格式：
   ```markdown
   ## Phase {N}: {标题} — 完成于 {日期}
   ### 关键决策
   - ...
   ### 遇到的问题与解法
   - ...
   ```
3. 在 `progress.md` 中将该 Phase 的详细 work unit 列表替换为一行：
   ```
   ## Phase {N}: ✅ 已完成 — 详见 docs/architecture.md
   ```
4. 展开下一个 Phase 的详细 work unit（从 progress.md 的概要描述展开为具体步骤）

---

## 项目结构

```
graph-brain/
├── CLAUDE.md                     # 本文件，项目规范（永久演化）
├── progress.md                   # 进度追踪（活跃文件，Phase 完成后自动毕业）
├── docs/
│   ├── architecture.md           # 毕业后的决策记录（永久参考）
│   └── schema.md                 # JSON schema 详细规范（永久参考）
├── core/                         # 领域无关的图谱核心
│   ├── schema/                   # JSON schema 验证
│   ├── store/                    # 图谱数据存储与增量更新
│   ├── query/                    # 图遍历、搜索、过滤
│   └── annotation/               # 标注存储与陈旧检测
├── adapters/                     # 领域适配器（可插拔）
│   ├── adapter-interface.ts      # 适配器接口定义
│   ├── ue5-code/                 # UE5 代码分析适配器
│   ├── level-design/             # 关卡设计适配器（Phase 4）
│   └── narrative/                # 叙事关系适配器（Phase 4）
├── viewer/                       # Cytoscape.js Web 查看器（双视图）
│   ├── index.html
│   ├── styles/                   # Cytoscape.js 样式表
│   └── components/               # UI 组件
│       ├── graph-view/           # Graph Explorer View（图谱可视化）
│       ├── api-view/             # API Reference View（函数速查表格）
│       ├── annotation-panel/     # 标注编辑侧边栏
│       └── search/               # 全文搜索 + 标签筛选
└── data/                         # 生成的图谱数据
    ├── graphs/                   # Cytoscape JSON 文件
    ├── annotations/              # 标注数据（与 graph JSON 分离）
    └── mermaid/                  # 序列图 .mmd 文件
```

---

## JSON Schema 规范

### Node（节点）

```jsonc
{
  "data": {
    "id":          "ACharacter",              // 唯一标识，UE 类用完整前缀
    "label":       "ACharacter",              // 显示名称
    "type":        "uactor",                  // 见下方枚举
    "layer":       "engine",                  // engine | plugin | project
    "module":      "Engine",                  // 所属模块名
    "domain":      "ue5_code",                // 来源适配器的领域标识
    "description": "Base class for characters with movement", // 一句话职责
    "source_path": "Engine/Source/Runtime/Engine/Classes/GameFramework/Character.h",
    "tags":        ["blueprintable", "override_point"],
    "visibility":  "explored",                // fog | silhouette | explored
    "metrics": {                              // 由 Core 自动计算
      "in_degree":    12,
      "out_degree":   5,
      "betweenness":  0.34
    }
  }
}
```

#### ufunction 节点的 API 扩展字段

当 `type` 为 `ufunction` 时，节点额外包含 `api` 子对象，用于驱动 API Reference View：

```jsonc
{
  "data": {
    "id":          "UAbilitySystemComponent::TryActivateAbility",
    "label":       "TryActivateAbility",
    "type":        "ufunction",
    "layer":       "engine",
    "module":      "GameplayAbilities",
    "domain":      "ue5_code",
    "parent":      "UAbilitySystemComponent",     // 所属类（compound node 关系）
    "description": "尝试通过 Handle 或 Class 激活一个 Gameplay Ability",
    "source_path": "...",
    "tags":        ["#combat", "#gas", "#activation"],
    "visibility":  "explored",

    "api": {
      "signature":    "bool TryActivateAbility(FGameplayAbilitySpecHandle Handle, bool bAllowRemoteActivation = true)",
      "return_type":  "bool",
      "params": [
        { "name": "Handle", "type": "FGameplayAbilitySpecHandle", "note": "由 GiveAbility 返回" },
        { "name": "bAllowRemoteActivation", "type": "bool", "note": "多人环境下是否允许远程激活" }
      ],
      "companions":   ["GiveAbility", "CancelAbility", "GetActivatableAbilities"],
      "cpp_only":     false,
      "blueprint_exposable": true
    },

    "metrics": { "in_degree": 8, "out_degree": 3, "betweenness": 0.12 }
  }
}
```

**字段说明：**
- `api.signature`：完整的 C++ 函数签名（Adapter 从 `.h` 文件自动提取）
- `api.return_type`：返回类型（自动提取）
- `api.params`：参数列表，每项含 name、type、note（note 为手动补充）
- `api.companions`：常见搭配函数的 id 引用（手动补充）
- `api.cpp_only`：是否为纯 C++ 函数（自动提取，基于 UFUNCTION 宏是否存在）
- `api.blueprint_exposable`：是否标记了 BlueprintCallable/BlueprintPure（自动提取）
- `tags` 中以 `#` 开头的为场景标签（`#combat` `#init` `#networking` 等），用于 API Reference View 的筛选

**自动提取 vs 手动补充：**
- 自动（Adapter 解析 `.h`）：signature, return_type, params.name, params.type, cpp_only, blueprint_exposable
- 手动（通过标注系统或初始数据补充）：description, params.note, companions, tags 中的场景标签
- 踩坑提示和使用场景通过标注系统附加（annotation type: gotcha / best_practice），不在 api 子对象中重复

**Node type 枚举（UE5 Code 领域）：**
`module` | `uclass` | `uactor` | `ucomponent` | `ustruct` | `uenum` | `uinterface` | `ufunction` | `blueprint` | `lifecycle_step` | `meta_group`

- `ufunction`：函数级节点，包含 `api` 扩展字段，同时驱动 Graph View 和 API Reference View
- `meta_group`：战争迷雾中的折叠抽象节点（Fog/Silhouette 态时使用）
- `lifecycle_step`：生命周期中的单个步骤节点（如 PostInitProperties）

**Node type 枚举（其他领域）由各自 Adapter 定义，不在此处穷举。**

### Edge（边）

```jsonc
{
  "data": {
    "id":          "ACharacter--inherits-->APawn",
    "source":      "ACharacter",
    "target":      "APawn",
    "relation":    "inherits",                // 见下方枚举
    "domain":      "ue5_code",                // 来源领域
    "weight":      5,                         // 耦合强度 1-5（可选）
    "description": ""                         // 关系说明（可选）
  }
}
```

**Edge relation 枚举（UE5 Code 领域）：**
`inherits` | `implements` | `composes` | `aggregates` | `depends_on` | `delegates` | `calls` | `overrides` | `binds_event` | `lifecycle_sequence` | `cross_domain`

- `lifecycle_sequence`：生命周期步骤间的执行顺序边（带 `data.order` 序号）
- `cross_domain`：跨领域链接（如代码类 ↔ 叙事角色）

### Annotation（标注）

标注与 graph JSON **分离存储**（独立文件），通过 node_id 关联：

```jsonc
{
  "node_id":      "AActor::PostInitProperties",
  "domain":       "ue5_code",
  "annotations": [
    {
      "id":           "ann_001",
      "type":         "gotcha",               // gotcha | best_practice | design_decision | performance | reference
      "content":      "此函数在 CDO 构造阶段就会被调用，此时 World 和其他组件可能尚未就绪。不要在这里访问 GetWorld()。",
      "created_at":   "2026-06-20T14:30:00Z",
      "source_hash":  "a3f2c1d...",           // 创建标注时的源文件 hash，用于陈旧检测
      "stale":        false                   // Core 自动标记：source_hash 不匹配时设为 true
    }
  ]
}
```

---

## Domain Adapter 接口规范

每个领域适配器必须实现以下接口：

```typescript
interface DomainAdapter {
  /** 领域标识符，全局唯一 */
  domain: string;  // "ue5_code" | "level_design" | "narrative" | ...

  /** 该领域支持的节点类型定义 */
  nodeTypes: {
    type: string;
    label: string;            // 用于 UI 显示
    shape: string;            // Cytoscape 形状：ellipse | round-rectangle | diamond | hexagon
    colorRamp: string;        // 配色方案标识
  }[];

  /** 该领域支持的边类型定义 */
  edgeTypes: {
    relation: string;
    label: string;
    lineStyle: string;        // solid | dashed | dotted
    directed: boolean;
  }[];

  /** 抽象层折叠规则：定义哪些节点在 fog/silhouette 态时折叠为 meta_group */
  abstractionRules: {
    groupBy: string;          // 按什么字段分组（如 "module" 按模块折叠）
    fogLabel: (group: string, count: number) => string;  // fog 态显示文本
    silhouetteEntryTypes: string[];  // silhouette 态显示哪些 nodeType
  };

  /** 全量提取：首次构建图谱时调用 */
  extract(sourcePath: string): { nodes: Node[]; edges: Edge[] };

  /** 增量提取：后续更新时只处理变化的文件 */
  diff(changedFiles: string[], currentGraph: GraphData): {
    added: { nodes: Node[]; edges: Edge[] };
    removed: { nodeIds: string[]; edgeIds: string[] };
    modified: { nodes: Node[]; edges: Edge[] };
  };
}
```

---

## 三态节点：战争迷雾规则

### Fog（迷雾态）
- 视觉：大圆、虚线描边、半透明、标注子系统名称和节点数量
- 数据：一个 `type: "meta_group"` 的节点，`data.children_count` 记录内含类数
- 与已展开区域的边用虚线表示
- 交互：点击 → 提示"展开此子系统？"

### Silhouette（轮廓态）
- 视觉：该子系统的 compound node 容器可见，内部只显示入口类（你直接交互的顶层接口类）
- 其余内部类仍然折叠，用一个"... 还有 N 个类"的灰色节点暗示
- 交互：点击内部任何节点 → 展开该节点的直接依赖

### Explored（展开态）
- 视觉：完全展开，所有类关系可见
- 标注可编辑
- 交互：可右键 → 折叠回 Silhouette

### 状态转换触发条件
- **自动 Fog → Silhouette**：项目代码 `#include` 该子系统的头文件、或继承其任一类
- **自动 Silhouette → Explored**：项目代码覆写或深度使用内部类（超过入口类层级）
- **手动**：在查看器中右键操作，支持任意方向切换

---

## Viewer 双视图架构

Web 查看器提供两个切换视图，共享同一份底层数据（Graph JSON + Annotation JSON）：

### Graph Explorer View（图谱探索视图）
- Cytoscape.js 力导向图谱渲染
- Focus 模式：点击节点高亮 N 跳邻域，其余淡化
- 三态节点折叠/展开交互
- 适用查询："GAS 激活流程经过哪些类？"、"这个子系统的整体结构是什么？"

### API Reference View（API 速查视图）
- 从 Graph JSON 中过滤所有 `type: "ufunction"` 的节点，渲染为可搜索的表格/卡片列表
- 按 `parent`（所属类）→ `module`（所属模块）生成树形导航
- 全文搜索：匹配函数名、description、params.name、tags
- 标签筛选栏：`#combat` `#gas` `#init` `#networking` `#animation` 等场景标签
- 每个条目展开后显示：签名、参数详情、搭配函数（companions 双向链接）、相关标注
- 适用查询："TryActivateAbility 的签名和参数是什么？"、"有哪些 #combat 相关的函数？"

### 双向跳转
- API Reference View → Graph Explorer View：条目上的"在图谱中定位"按钮，切换视图并 focus 到该函数节点
- Graph Explorer View → API Reference View：点击 `ufunction` 节点时，侧边栏自动显示 API 详情卡片
- 标注面板在两个视图中共享，点击任意节点/条目都能编辑标注

---

## 编码规范

- 前端：React + TypeScript + Cytoscape.js
- 后端/脚本：Python 3.11+（UE5 头文件解析）或 TypeScript（如果统一技术栈）
- 图谱数据：Cytoscape.js 兼容 JSON 格式
- 样式文件：Cytoscape.js stylesheet JSON
- 序列图：Mermaid .mmd 格式
- 版本控制：Lore（如不可用则退回 Git）

---

## 命名规范

- 图谱数据文件：`{domain}_{subsystem}_{date}.cyto.json`
- 标注文件：`{domain}_{subsystem}_annotations.json`
- Mermaid 文件：`{domain}_{topic}_{date}.mmd`
- Work unit commit：`graph-brain: P{phase}U{unit} - {简述}`

---

## 技术决策日志格式

当做出重要技术选择时（如选用某个库、改变某个 schema 字段），在代码旁用注释记录：

```typescript
// DECISION: 标注与 graph JSON 分离存储，而非内嵌
// REASON: 图谱 JSON 由 Adapter 自动生成并频繁更新，标注由人类手动维护。
//         分离后 Adapter 重新生成图谱时不会覆盖手动标注。
// DATE: 2026-06-20
```
