# UE-Intelligence-System
```text
面向大型 Unreal Engine 5 C++ 工程的本地优先（Local-First）只读代码架构分析、语义差分与 AI 证据供给系统（约 3.4 万行核心代码 + 9,100+ 行自动化契约测试）。
从项目与引擎 C++ 源码静态提取结构化代码事实，通过内容寻址快照同时支撑多维可视化架构探索与 AI Coding Agent 的零幻觉代码检索。
```
```markdown
- **零编译依赖的 UE5 C++ 静态提取管线**：自研 C++/UHT 头文件与源文件解析器，采用“等长空白注释剥离 + 括号配对状态机”（支持 4MB 单文件边界，兼容 AActor/UWorld 等超大引擎核心头文件），静态提取 UCLASS/USTRUCT/UENUM/UPROPERTY/UFUNCTION、委托声明、同名 .cpp 成员访问及 *.Build.cs 模块依赖；支持从 .uproject 自动索引 30,000+ 引擎头文件并沿继承链按需解析，叠加 Actor 生命周期执行链与 SHA-256 文件级增量解析缓存。
- **SHA-256 内容寻址存储与原子发布协议**：构建不可变代码事实图（v2）、版本化语义变化报告（v1）与 Evidence 快照（v3），完成 Ajv JSON Schema 与引用完整性校验后通过单调递增 revision 指针实现单点原子切换，支持毫秒级无损回滚（data:rollback）与未引用历史产物安全清理（data:prune）。
- **面向 AI Agent 的 Fail-Closed 证据服务（MCP Server）**：基于标准 MCP 协议（Stdio）与 HTTP Evidence API v1 封装 7 个纯只读代码证据工具（符号检索、符号详情、一跳邻域、正/反向修改波及闭包计算、语义变更切片与标注查询）；设计 require_fresh 源码指纹强校验门禁，当快照落后于源码修改时自动阻断并返回 EVIDENCE_STALE 诊断，消除大模型在大型 UE 工程中的过期上下文幻觉。
- **多维交互式架构工作台（Viewer）**：基于 React 19 + Cytoscape.js (fCoSE 确定性布局与重叠消解) 构建“总览 / 探索（架构职责分带、项目与引擎关系森林、统一 API 与类 Spec）/ 变化（直接语义变化 vs 一跳关系影响）”三大工作区，配套 ETag/Revision 乐观锁保护的行级代码标注与陈旧度自动扫描。
- **高标准工程化与稳定性门禁**：制定并落地《工程编码标准 v1》，实现全仓 0 显式 any / 类型压制静态门禁（engineering-standard-gate）、core→adapters 分层依赖门禁（layer-gate）、架构依赖回路门禁（gate:arch）、101 个自动化测试文件，以及多工作区循环切换 + 强制 GC 的内存/DOM/监听器泄漏浸泡测试（Soak Test）。
```
