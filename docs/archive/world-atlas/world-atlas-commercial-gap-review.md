# World Atlas 必要商业差距审视

范围：个人使用的轻量 2D+3D 关卡、Quest、Narrative tinker。只讨论会直接阻碍“快速提出假设 → 游玩/推演 → 比较 → 交付”的能力；不追求替代 UE 的完整制作链。

## 当前已经形成的有效核心

- 一个共享空间底板：地点、显式地形、白盒原语、稳定 ID 路线、高度与空间拓扑；
- 2D 与 3D 同源投影，Hover 同时表达内外、楼层、包含、邻域和连通；
- Quest / Narrative 是空间之上的结构化雕刻层，而不是第三套地点数据；
- 轨道、分支、顺序、强度、条件、效果和事实引用可见，并与阶段投影共用模型；
- 集中格式迁移、统一世界草稿原子保存、跨空间/地形/体验的撤销重做、旧 API 薄兼容。

这已经比单纯白盒建模器更适合“空间—任务—叙事”联合推演，但距离成熟工具仍有以下必要差距。

## P0：下一阶段必须有

### 1. 可游玩的尺度与移动验证

当前主要是轨道相机观察，无法真正验证玩家胶囊、速度、跳跃、台阶、坡度、门洞净空和转弯半径。Blockout 的价值在于尽早暴露尺寸、流线与可玩性问题；只看俯视和飞行镜头不够。[Level Design Book：Blockout](https://book.leveldesignbook.com/process/blockout)、[Metrics](https://book.leveldesignbook.com/process/blockout/metrics)

最小实现：

- 第一/第三人称步行测试模式；
- 可配置玩家 metrics profile；
- 碰撞、重力、跳跃、蹲伏和斜坡限制；
- 从任意空间锚点开始，记录实际路径、耗时和失败点。

### 2. Quest / Narrative 可能性推演器

现在能组织分支，但还不能证明每种可能性可达。必要能力是从初始状态逐步执行条件和效果，显示：

- 可进入、被阻断和永远不可达的标记；
- 互斥分支、汇合点、失败恢复和软锁；
- 一次模拟游程在空间中的轨迹；
- 分支覆盖率和未被任何路径消费的内容。

这是本工具区别于普通白盒编辑器的核心，不应退回到“画了几条线”的层级。

### 3. 崩溃恢复与方案历史

白盒、地点、地形和体验编排现在已共用草稿快照撤销/重做，拖动与连线也进入同一历史。剩余的个人高频 tinker 效率底线是：

- 崩溃恢复和“放弃本次草稿”；
- 保存前 diff；
- 命名快照与 A/B 方案比较。

### 4. 稳定的 UE / 通用格式交付

成熟白盒工具最终都能把验证过的布局带入正式制作。Unity ProBuilder 明确提供原型建模与导出，TrenchBroom 也围绕可运行地图和编译流程组织工作。[Unity ProBuilder](https://docs.unity.cn/Packages/com.unity.probuilder%406.0/manual/overview.html)、[TrenchBroom Manual](https://trenchbroom.github.io/manual/latest/index.html)

最小实现：

- glTF/OBJ 几何与稳定对象 ID；
- UE 坐标、单位、旋转和层级映射；
- 地点、路线、触发体、Quest/Narrative 标记导出为数据资产或 JSON；
- 重导出时按稳定 ID 更新，而不是重复生成。

## P1：证明核心循环后必须补

### 5. 基于碰撞的导航与净空分析

现有空间拓扑是设计语义和近似包围盒，不等于实际可行走性。UE 导航系统从碰撞生成 NavMesh，并支持路径成本与查询；本工具至少要有轻量代理版本。[Epic：Navigation System](https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine?lang=en-US)

- 按 agent profile 生成可走区域；
- 标出断裂、过窄、过陡、台阶超限和单向落差；
- Quest 门控前后比较可达集合；
- 路线成本和关键路径长度。

### 6. 多楼层、剖面与垂直流线

高度夸张不是楼层编辑。需要楼层过滤、剖切面、层间入口、楼梯/电梯/跌落的明确语义，以及 2D 楼层间同步选择。否则复杂室内空间很快失去可读性。

### 7. 视线、引导、掩体与遭遇验证

关卡流不仅是连通。必要的设计探针包括：

- 出入口与目标之间的视线；
- 地标可见区和关键转角的揭示时机；
- 掩体高度、朝向、间距和侧翼路径；
- 遭遇入口、战斗区、退路、资源与压力节奏。

这些评价维度分别对应 flow、wayfinding、cover、encounter 与 pacing 的基础检查。[Flow](https://book.leveldesignbook.com/process/layout/flow)、[Wayfinding](https://book.leveldesignbook.com/process/blockout/wayfinding)、[Cover](https://book.leveldesignbook.com/process/combat/cover)、[Encounter](https://book.leveldesignbook.com/process/combat/encounter)、[Pacing](https://book.leveldesignbook.com/process/preproduction/pacing)

### 8. 高频几何操作，而非完整建模

商业工具的优势不只是原语更多，而是操作摩擦低。UE Modeling Mode 和 ProBuilder 都提供更细的网格编辑；TrenchBroom 强调网格、面、顶点和纹理锁定等快速关卡操作。[Epic：Modeling Mode](https://dev.epicgames.com/documentation/unreal-engine/modeling-mode-in-unreal-engine?lang=en-US)、[Unity ProBuilder](https://docs.unity.cn/Packages/com.unity.probuilder%406.0/manual/index.html)、[TrenchBroom Manual](https://trenchbroom.github.io/manual/latest/index.html)

本工具只需补：

- 多选、框选、分组、锁定层；
- 对齐、分布、镜像、阵列、原位复制；
- 统一移动/旋转/缩放 gizmo；
- 简单拉伸、切分和布尔门洞；
- prefab/template 的实例与覆盖。

不必做完整 UV、材质烘焙或高模工具。

### 9. 用户可声明的雕刻 Schema

当前 Quest / Narrative 结构已集中声明，但新增字段仍需改代码。通用个人 tinker 工具最终需要项目级 schema：

- 字段类型、枚举、默认值、分组和校验；
- 连续数值自动生成“滑条 + 数字兜底”；
- vN→vN+1 字段迁移；
- 2D/3D badge、颜色和 Hover 关系声明；
- 未识别旧字段始终可见，不能静默丢弃。

## 明确不做

- 不做完整静态网格、UV、材质、光照和渲染替代；
- 不做大型团队权限、多人实时协作和资产管理；
- 不做 UE Gameplay Debugger 的完整运行时复制；正式实现后的 AI、网络和 Gameplay Ability 调试仍应回到引擎。[Epic：Gameplay Debugger](https://dev.epicgames.com/documentation/unreal-engine/using-the-gameplay-debugger-in-unreal-engine)

## 推荐顺序

1. 统一 undo/恢复；
2. Quest/Narrative 状态推演与软锁检查；
3. 玩家 metrics + 可游玩移动；
4. 稳定 UE/glTF 交付；
5. Nav/净空；
6. 楼层剖面、视线/引导/掩体/遭遇；
7. 高频几何操作与用户 Schema。
