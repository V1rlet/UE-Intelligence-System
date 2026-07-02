# Graph Brain — Progress Tracker

> 本文件由 Claude Code 在每次会话结束时自动更新。
> 完成的 Phase 会自动毕业到 `docs/architecture.md`，本文件只保留活跃内容。
> 详见 CLAUDE.md 中的「阶段毕业协议」。

---

## 当前状态

- **Phase**: 2
- **最新完成**: Phase 1 全部（P1U1–P1U5，已毕业）
- **下一步**: P2U1 — .h 头文件解析器
- **上次会话**: 2026-07-02

---

## Phase 1: ✅ 已完成 — 详见 docs/architecture.md

---

## Phase 2: 引擎种子层 + 类解析

> 目标：解析 .h 头文件 → 类关系图谱 + Actor 生命周期 + 三态节点 + 项目代码映射。
> 本 Phase 结束时，查看器里应能看到 Sabotage 的类级图谱（含函数节点）挂接在
> 引擎种子类之下，并支持 Fog / Silhouette / Explored 折叠交互。

### P2U1 — .h 头文件解析器

**输入**: `G:\UnrealProject\Sabotage\Source` 下全部 `.h`
**产出**:
- `adapters/ue5-code/extract-classes.ts`（解析器可拆分为独立模块复用注释剥离等逻辑）
- 解析 UCLASS / USTRUCT / UENUM / UINTERFACE 宏与继承链 →
  `uclass` / `uactor` / `ucomponent` / `ustruct` / `uenum` / `uinterface` 节点
  （uactor/ucomponent 依据基类链判定）+ `inherits` / `implements` 边
- UPROPERTY 组件成员（TObjectPtr/TSubobjectPtr 等）→ `composes` 边
- UFUNCTION 签名提取 → `ufunction` 节点（`parent` = 所属类，compound 关系）+
  `api` 自动字段：signature / return_type / params.name / params.type /
  cpp_only / blueprint_exposable
- 输出 `ue5_code_classes_{date}.cyto.json`，与模块图并存

**验收**: 对 Sabotage 全部 .h 运行，产物通过 schema 验证；抽查 3 个类
（含至少 1 个带 UFUNCTION 的）与源码逐字段一致

---

### P2U2 — Actor 生命周期序列节点

**输入**: P2U1 的类图谱
**产出**:
- Actor 生命周期 `lifecycle_step` 节点链（PostInitProperties → OnConstruction →
  PreInitializeComponents → PostInitializeComponents → BeginPlay → Tick → EndPlay）
  + `lifecycle_sequence` 边（带 order 序号）
- 项目类覆写的生命周期函数 → `overrides` 边挂到对应 step 节点
- 生命周期链作为独立子图或叠加层并入类图谱

**验收**: 查看器中能看到顺序正确的生命周期链，Sabotage 覆写的函数正确连线

---

### P2U3 — 三态节点交互

**输入**: P2U1/U2 的图谱
**产出**:
- 按 module 折叠的 `meta_group` 生成逻辑（children_count 正确）
- 查看器交互：点击 fog 节点 → 提示展开；explored 节点右键 → 折叠回 silhouette；
  silhouette 容器内点击节点 → 展开直接依赖
- 折叠/展开状态持久化（刷新不丢）

**验收**: 折叠 → 展开 → 再折叠循环操作无数据丢失、无孤立边

---

### P2U4 — 种子层填充

**输入**: 引擎参考资料 + Sabotage 实际用到的引擎子系统
**产出**:
- GAS / Enhanced Input / Animation（+ StateTree，Sabotage 实际依赖）入口类种子数据
  （手工整理，layer="engine"），入口类 silhouette、其余 fog
- 种子图与 P2U1 项目类图合并加载

**验收**: 查看器能看到种子子系统，入口类带 description

---

### P2U5 — 项目类挂载引擎节点

**输入**: P2U1 产物 + P2U4 种子层
**产出**:
- 项目类 → 引擎基类的 `inherits` 边自动跨层连接（触发引擎节点
  fog→silhouette→explored 自动转换规则落地）
- 覆写引擎虚函数 → `overrides` 边

**验收**: Sabotage 全部自定义类挂在对应引擎基类下，无悬空引用

---

### P2U6 — Phase 2 集成验证 + 毕业

**输入**: P2U1–U5 全部产出
**产出**:
- 端到端验证：改一个 .h（加函数/改继承）→ 重跑 Adapter → 查看器正确反映
- 执行「阶段毕业协议」：决策写入 docs/architecture.md，精简本节，展开 Phase 3

**验收**: 完整通路无报错，docs/architecture.md 追加 Phase 2 章节

---

## Phase 3: 标注系统 + 双视图查询界面（待展开）

> 目标：双视图（Graph Explorer + API Reference） + 双模查询（视觉 + 文本） + Focus 模式 + Mermaid 内嵌 + 标注增强
> 到达此 Phase 时展开。

预估 work units：
1. P3U1 — 全文搜索 + 按类型/标签过滤（同时服务 Graph View 和 API View）
2. P3U2 — API Reference View（过滤 `ufunction` 节点 → 树形导航 + 表格/卡片列表 + 场景标签筛选 `#combat` `#gas` 等）
3. P3U3 — 双向跳转（API 条目 → 图谱定位；图谱 ufunction 节点 → API 详情卡片）
4. P3U4 — Focus 模式（N 跳邻域高亮）
5. P3U5 — Mermaid 序列图内嵌渲染
6. P3U6 — 标注侧边栏增强（类型图标、排序、跳转，两个视图共享）
7. P3U7 — Phase 3 集成验证 + 毕业

---

## Phase 4: 自动化 + 多领域扩展（待展开）

> 目标：commit hook 自动更新 + 标注陈旧检测 + Adapter 接口抽离 + 第二个领域
> 到达此 Phase 时展开。

预估 work units：
1. P4U1 — Adapter 接口正式抽离（从 ue5-code 中提取通用部分）
2. P4U2 — 增量更新管线（diff 而非全量重建）
3. P4U3 — 标注陈旧检测（source_hash 比对 + stale 标记）
4. P4U4 — VCS hook 集成（Lore 或 Git 的 post-commit 触发扫描）
5. P4U5 — 第二个领域适配器（Level Design 或 Narrative）
6. P4U6 — 跨领域边支持 + Phase 4 毕业