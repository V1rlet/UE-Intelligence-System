# Graph Brain — JSON Schema 规范（独立参考）

> 从 CLAUDE.md 提取的 schema 详细规范，与 `core/schema/*.schema.json` 一一对应。
> 修改 schema 时同步更新本文档与对应的 `.schema.json` 文件。

---

## 文件与 Schema 对应关系

| 文件类型 | 命名规范 | Schema 文件 | 判定规则 |
|----------|----------|-------------|----------|
| 图谱文件 | `{domain}_{subsystem}_{date}.cyto.json` | `graph.schema.json`（引用 node/edge） | 文件名以 `.cyto.json` 结尾，或内容含 `elements` 键 |
| 标注文件 | `{domain}_{subsystem}_annotations.json` | `annotation.schema.json` | 文件名以 `_annotations.json` 结尾，或顶层为数组 |

**验证命令**：

```bash
npx tsx core/schema/validate.ts <file.json...>
npm run validate:examples   # 验证 core/schema/examples/ 下的手写示例
```

结构校验之外，验证脚本还做图内引用一致性检查：节点 id 不重复、边的 source/target
及节点的 parent 必须指向图内存在的节点。

---

## 图谱文件顶层结构

```jsonc
{
  "meta": {                                 // 溯源信息（可选但推荐）
    "domain":       "ue5_code",
    "subsystem":    "gas",
    "generated_at": "2026-07-02T05:30:00Z", // ISO 8601
    "generator":    "ue5-code-adapter@0.1"
  },
  "elements": {                             // 可直接传给 cytoscape({ elements })
    "nodes": [ /* Node */ ],
    "edges": [ /* Edge */ ]
  }
}
```

> DECISION: 采用 `{ meta, elements }` 包装而非裸元素数组。
> REASON: `elements` 保持 Cytoscape.js 原生兼容；`meta` 携带溯源信息供增量更新
> （P4U2）和陈旧检测（P4U3）使用，不污染节点数据。DATE: 2026-07-02

---

## Node（节点）

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

**必填字段**：`id` `label` `type` `domain`。其余可选。

**核心层与领域层的约束划分**：`layer` / `visibility` 枚举是核心概念，对所有领域生效；
`type` 在核心层为自由字符串，当 `domain: "ue5_code"` 时由条件子模式收紧为下方枚举。
其他领域的 type 枚举由各自 Adapter 定义。

**Node type 枚举（UE5 Code 领域）**：
`module` | `uclass` | `uactor` | `ucomponent` | `ustruct` | `uenum` | `uinterface` | `ufunction` | `blueprint` | `lifecycle_step` | `meta_group`

- `ufunction`：函数级节点，必须带 `api` 扩展字段和 `parent`（所属类）
- `meta_group`：战争迷雾折叠抽象节点，必须带 `children_count`
- `lifecycle_step`：生命周期中的单个步骤节点（如 PostInitProperties）

### ufunction 节点的 API 扩展字段

当 `type` 为 `ufunction` 时，节点额外包含 `api` 子对象，驱动 API Reference View：

```jsonc
{
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
  }
}
```

- `api.signature` / `api.return_type`：必填，Adapter 从 `.h` 自动提取
- `api.params`：参数列表（name、type 自动提取；note 手动补充）
- `api.companions`：常见搭配函数的 id 引用（手动补充）
- `api.cpp_only`：是否纯 C++ 函数（基于 UFUNCTION 宏是否存在，自动提取）
- `api.blueprint_exposable`：是否标记 BlueprintCallable/BlueprintPure（自动提取）
- `tags` 中以 `#` 开头的为场景标签（`#combat` `#gas` `#init` 等），用于 API View 筛选
- 踩坑提示和使用场景通过标注系统附加（gotcha / best_practice），不在 `api` 中重复

---

## Edge（边）

```jsonc
{
  "data": {
    "id":          "ACharacter--inherits-->APawn",
    "source":      "ACharacter",
    "target":      "APawn",
    "relation":    "inherits",                // 见下方枚举
    "domain":      "ue5_code",
    "weight":      5,                         // 耦合强度 1-5（可选）
    "description": ""                         // 关系说明（可选）
  }
}
```

**必填字段**：`id` `source` `target` `relation` `domain`。

**Edge relation 枚举（UE5 Code 领域）**：
`inherits` | `implements` | `composes` | `aggregates` | `depends_on` | `delegates` | `calls` | `overrides` | `binds_event` | `lifecycle_sequence` | `cross_domain`

- `lifecycle_sequence`：生命周期执行顺序边，必须带 `data.order` 序号
- `cross_domain`：跨领域链接（如代码类 ↔ 叙事角色）

**边 id 约定**：`{source}--{relation}-->{target}`。

---

## Annotation（标注）

标注文件为**条目数组**，每条通过 `node_id` 关联节点，与 graph JSON 分离存储：

```jsonc
[
  {
    "node_id":      "AActor::PostInitProperties",
    "domain":       "ue5_code",
    "annotations": [
      {
        "id":           "ann_001",
        "type":         "gotcha",             // gotcha | best_practice | design_decision | performance | reference
        "content":      "此函数在 CDO 构造阶段就会被调用……",
        "created_at":   "2026-06-20T14:30:00Z",
        "source_hash":  "a3f2c1d...",         // 创建标注时的源文件 hash，用于陈旧检测
        "stale":        false                 // Core 自动标记：source_hash 不匹配时设为 true
      }
    ]
  }
]
```

**条目必填**：`node_id` `domain` `annotations`；**单条标注必填**：`id` `type` `content` `created_at`。
