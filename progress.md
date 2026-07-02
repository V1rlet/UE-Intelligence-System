# Graph Brain — Progress Tracker

> 本文件由 Claude Code 在每次会话结束时自动更新。
> 完成的 Phase 会自动毕业到 `docs/architecture.md`，本文件只保留活跃内容。
> 详见 CLAUDE.md 中的「阶段毕业协议」。

---

## 当前状态

- **Phase**: 1
- **最新完成**: P1U3 — Cytoscape.js 查看器骨架
- **下一步**: P1U4 — 标注存储原型
- **上次会话**: 2026-07-02

---

## Phase 1: Graph Core + 最小管线

> 目标：跑通「源码 → JSON → Web 查看」的完整通路。
> 本 Phase 结束时，你应该能在浏览器中看到项目的模块依赖图，并能点击节点查看/编辑标注。

### P1U1 — 项目初始化 + Schema 落地 ✅（2026-07-02 完成）

**输入**: CLAUDE.md
**产出**:
- 按 CLAUDE.md 中的项目结构创建全部目录
- 将 CLAUDE.md 中的 JSON Schema 规范转化为实际的 JSON Schema 验证文件 (`core/schema/`)
- 创建 `docs/architecture.md` 空骨架
- 创建 `docs/schema.md`（从 CLAUDE.md 中提取 schema 部分，作为独立参考文档）
- 初始化 package.json / pyproject.toml（取决于技术栈选择）
- 初始化 git 仓库 + 首次提交

**验收**: `core/schema/` 下有可运行的 schema 验证脚本，能对一份手写的示例 JSON 进行验证

**完成记录**：
- 技术栈定为 TypeScript 统一栈（ajv 验证；Adapter 后续也用 TS/Node），只维护 package.json
- 4 个 schema 文件：`node` / `edge` / `graph` / `annotation`.schema.json（draft-07，
  ue5_code 领域枚举通过 if/then 条件子模式收紧，核心层保持领域无关）
- 图谱文件顶层采用 `{ meta, elements }` 包装（elements 直接兼容 Cytoscape.js）
- `validate.ts`：结构校验 + 图内引用一致性检查（重复 id / 悬空 source/target/parent）+ BOM 容错
- 正反验收均通过：`npm run validate:examples` ✓；非法 type 的坏文件被拒绝（exit 1）✓
- 根目录 architecture.md 移至 `docs/architecture.md`；新建 `docs/schema.md` 独立参考

---

### P1U2 — UE5 Code Adapter 最小版本 ✅（2026-07-02 完成）

**输入**: 你的 UE5 项目 Source/ 目录路径
**产出**:
- `adapters/ue5-code/` 下的解析脚本
- 能解析所有 `.Build.cs` 文件，提取：
  - 模块名
  - `PublicDependencyModuleNames`
  - `PrivateDependencyModuleNames`
- 输出符合 schema 的 Cytoscape JSON（nodes = 模块，edges = depends_on）
- Public 依赖 weight=5，Private 依赖 weight=2
- 引擎模块 layer="engine"，项目模块 layer="project"

**验收**: 运行脚本后 `data/graphs/` 下生成有效的 `.cyto.json`，通过 schema 验证

**用户需提供**: 你的项目 Source/ 目录路径（在会话中告知 Claude Code）

**完成记录**：
- 目标项目：`G:\UnrealProject\Sabotage\Source`（本机唯一含 Source 的 UE 项目）
- `adapters/ue5-code/extract-modules.ts`：递归扫 *.Build.cs，先剥离 C# 注释再提取
  （避免模板工程注释里的 SlateCore/OnlineSubsystem 被误提取——已实测排除），
  支持 AddRange 与 Add 两种写法；npm script `extract:ue5-modules`
- 层级/可见性规则：扫描到 Build.cs 的模块 project/explored；仅作为依赖出现的模块
  engine/silhouette（对应三态规则的"依赖即入轮廓态"）
- 产物 `data/graphs/ue5_code_modules_2026-07-02.cyto.json`：11 节点（Sabotage + 10 引擎模块）、
  10 条 depends_on 边（weight=5），in/out degree 已填充，通过 schema 验证 ✓

---

### P1U3 — Cytoscape.js 查看器骨架 ✅（2026-07-02 完成）

**输入**: P1U2 产出的 `.cyto.json`
**产出**:
- `viewer/index.html` + 必要的 JS/CSS
- 能加载 P1U2 产出的 JSON 并渲染为力导向图
- 基础交互：拖拽、缩放、点击节点显示 data 字段
- 引擎模块和项目模块用不同颜色区分
- 节点大小按 degree 编码
- 本地 http 服务可访问

**验收**: 在浏览器中打开能看到模块依赖图，可拖拽缩放，点击节点看到详情

**完成记录**：
- 技术栈：Vite + React 19 + TS + Cytoscape.js（按 CLAUDE.md 编码规范）；`npm run viewer`
  启动，端口固定 **3030**（3010/3021/3022 已被本机其他服务占用，strictPort）
- Vite dev server 兼作数据服务（vite.config.ts 中间件）：`/api/graphs` 列出图谱文件
  （新→旧），`/data/*` 直读 data/ 目录（含路径穿越防护）——P1U4 的标注保存 POST
  接口计划挂在同一中间件
- 结构：`viewer/src/`（入口+App）、`viewer/components/graph-view/GraphView.tsx`、
  `viewer/styles/ue5-code.cyto-style.json`（纯 JSON stylesheet，按规范）+ `app.css`
- 已实现：cose 力导向布局、拖拽/缩放、点击节点右侧详情表、layer 配色
  （project 橙/engine 蓝/plugin 紫）、度数→节点大小（加载时预计算 data.size）、
  visibility 视觉区分（silhouette 虚线边框、fog 点线半透明，为 P2U3 三态铺垫）
- 验证：/、/api/graphs、/data/graphs/*.cyto.json、样式 JSON 全部 HTTP 200；
  viewer 与 root 两个 tsconfig 类型检查通过（补装 @types/node）
- 浏览器人工验收入口：http://localhost:3030

---

### P1U4 — 标注存储原型

**输入**: P1U3 的查看器
**产出**:
- `core/annotation/` 下的标注读写模块
- 标注数据与 graph JSON 分离存储在 `data/annotations/`
- 查看器中添加侧边栏：点击节点 → 右侧显示标注 → 可编辑 → 保存到 annotation JSON
- 支持标注类型选择（gotcha / best_practice / design_decision / performance / reference）
- 保存时自动记录 created_at 时间戳

**验收**: 能在查看器中给某个模块节点添加标注，刷新后标注仍在

---

### P1U5 — Phase 1 端到端验证 + 毕业

**输入**: P1U1-U4 的全部产出
**产出**:
- 端到端流程验证：修改一个 .Build.cs → 重新运行 Adapter → 查看器刷新看到变化
- 修复集成中发现的问题
- 执行「阶段毕业协议」：
  - 将 Phase 1 的关键决策写入 `docs/architecture.md`
  - 精简本文件的 Phase 1 部分

**验收**: 完整通路无报错运行，`docs/architecture.md` 有内容

---

## Phase 2: 引擎种子层 + 类解析（待展开）

> 目标：解析 .h 头文件 → 类关系图谱 + Actor 生命周期 + 三态节点 + 项目代码映射
> 到达此 Phase 时，由 Claude Code 根据 Phase 1 的实际产出展开详细 work units。

预估 work units：
1. P2U1 — `.h` 头文件解析器（UCLASS / 继承链 / UPROPERTY 元数据 / UFUNCTION 签名提取，生成 `ufunction` 节点并填充 `api` 子对象的自动提取字段：signature, return_type, params.name, params.type, cpp_only, blueprint_exposable）
2. P2U2 — Actor 生命周期序列节点生成
3. P2U3 — 三态节点实现（Fog / Silhouette / Explored 交互逻辑）
4. P2U4 — 种子层填充（GAS / Enhanced Input / Animation 入口类）
5. P2U5 — 项目自定义类自动挂载到引擎节点
6. P2U6 — Phase 2 集成验证 + 毕业

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
