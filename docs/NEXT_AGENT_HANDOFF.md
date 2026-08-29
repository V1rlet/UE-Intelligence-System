# GraphBrain 下一轮 Agent 交接清单

更新时间：2026-08-23（Asia/Shanghai）

## 0. 交接时的真实状态

- **第三轮已执行完毕（含追加批）**：`docs/ROUND3_AUDIT_PLAN.md` 两部分全部落地 + 用户裁决追加项全做，详见新增 §1.7。
  - **追加批（同日，用户裁决"全做"后）**：E3 gate:arch 门禁脚本+测试；C1 export-context 上下文包导出（graphbrain-context-pack/1）；D1 analyze --trend 跨代趋势（6 代次实测：units 92→97、cycles 恒 1）；E2 cache:aging 缓存老化报告（1707 模块，最旧 35 天）；B1 standalone TU 消费（PARSE_CACHE_VERSION 12→13，coverage 可收敛 complete）+ capability `standalone_translation_units`（catalog 按 coverage=complete 派生）；B2 Build.cs→模块级 depends_on 子图（stub `module:<名>` 节点自动创建；发现真实引擎层回路 AActor→ACharacter→AController→APawn 并已入基线）；B4 多项目端到端回归；C2 UI 编排器行级锚起止行输入。**部署修正**：service-deploy 不再向 NSSM 注入 GRAPH_BRAIN_NO_WATCHER=1（否则 A2 在生产被静默关闭）；候选 `release-16e8e17d…` 已 prepare 待 activate——**此前激活的 release-48ad5125 生产 watcher 处于关闭态，需再激活一次新候选**。
- 2026-08-23 本轮（第二轮）：换角度二轮审计（server 路由/门禁基础设施 + viewer 组件状态机视角）+ 修复；关闭挂账两轮的"reading-context 跨进程真实并发写"验收缺口。
- 2026-08-23 前一轮：全仓健壮性/优雅性审阅 + 全面 BUG 排查 + 修复实施（详见 §1.5）；门禁全绿。
- 工作区：`G:\UnrealProject\GraphBrain`
- 工作树有大量未提交和未跟踪内容，包含用户与本轮前多轮工作。**禁止 `git reset --hard`、`git checkout --` 或批量清理未跟踪文件。**先运行 `git status --short`，只修改当前任务涉及的文件。没有创建 Git commit。
- NSSM 服务名：`graph-brain-viewer`，当前 `SERVICE_RUNNING`（LocalSystem，见 §4 限制）。
- 服务部署状态（`npm run service:status`）：
  - `format_version: 1`
  - `revision: 22`
  - `current_release: release-c47825979b7f1d2d75c61234852df9faf2ac180fc5aa26cde4e9d27d8c16345f`
  - `previous_release: release-1e8c3e1c550aa2ae8defff94db57ebabbbfdf695cfd2b1b0c1873c3a30409756`
  - `prepared_release: null`
- 数据发布状态（`npm run data:status`）：revision 5，project 3 个 generation：
  - current `ue5_code_project__gbtx-fd3a75730751bbce.cyto.json`（**无报告**——零差异抑制，hook 实测发布）
  - `ue5_code_project__gbtx-67ab71ff6944dbbc.cyto.json`（report `ab618bd86ee8e52d`，零差异审计）
  - `ue5_code_project__gbtx-5a8d5ccef3162a85.cyto.json`（report `8f1053edda9e88da`，零差异审计）
- 3030 实测：graph-catalog 8 条（1 project current + 7 legacy 边界）、默认变化报告非空、engine-catalog 1750/27168。
- 最近门禁：**219/219 测试**通过；tsc 严格模式（`noUnusedLocals`+`noUnusedParameters`）0 错误；layer-gate/validate/build/check:bundle 通过；smoke 9 项全绿；变化报告事实准确性（报告 summary ≡ 真实 diff）与图语义合法性（类型/关系/meta 全集）实测一致。

## 1. 已完成工作（2026-08-09 ~ 08-10）

- **P0**：真实 release 切换演练完成（activate → 验证 → rollback → 回切，revision 7→10）。注意：rollback 后 `prepared_release=null`，状态机语义下"再 activate"不可行；对称回切应再执行一次 `service:rollback`。
- **P1-prune**：`data:prune`（dry-run 默认 / `--apply` / `--subsystem`）。保留集 = 当前 ∪ 直接 rollback ∪ 有报告的 generation；只删 `__gbtx-` 管理格式 + SHA 一致 + 目标 subsystem 前缀；旧日期/未知/损坏文件仅报告人工审查；同步从 state 移除被删 generation（revision+1）。
- **P1-catalog**：`activeCatalogGraphFiles` 能力接口——publication 接管 subsystem 只解析 current，历史 generation 零解析；legacy 走集中边界；current hash 不匹配隐藏并告警；损坏 state 显式失败；旧深链兼容。
- **P1-hooks**：共享锁 `core/store/file-lock.ts`（原子 `open wx` + 死进程/超时恢复 + **释放前归属校验**）；hook 锁 `busy:"skip"`；`scanStale` 冲突最多 3 次重读重算；hook 日志三态；runner 失败非 0 退出码 + watcher 不推进基线。
- **P2**：零差异报告保留为审计历史（resolver 跳过 + prune 不删有报告的 generation）；publication JSON Schema 决定不加（`validateDataPublicationState` 是唯一 normalize/validate 边界）。

### 1.7 2026-08-23 第三轮审计修复 + 生产定位迭代（docs/ROUND3_AUDIT_PLAN.md 全程）

**决策点裁决记录**：D-P1 MCP 实现=引入 @modelcontextprotocol/sdk；D-P2 watcher=嵌入 release-server；D-P3 标注行级锚=本轮实施 v2 迁移；D-P4 Blueprint=不提取、仅 capability 呈现；D-P5 写入通道=不开；D-P6 多机=仅 E4 runbook。

（本节详细清单见下方各段；验证证据与交付说明随文标注。）

**遗留修复 F1–F6（全部落地）**：F5 `EvidenceRuntimeGraph` 名义类型（真实 Symbol brand；`joinEvidenceSnapshotPairV3` 唯一构造点；query 链路改用 `EvidenceQueryGraph` 联合类型）；F6 change-scale 测量口径注释。F1–F4 起点已在树上（错误码/UNASSIGNED_MODULE_LABEL/guardedWorkspaceSwitch/flattenInlineBodies 精确坐标），补跑回归全绿。

**T1 门禁审计（4 项修复）**：①motion-smoke 测量目标缺失静默收缩覆盖→缺失即抛错；②readability-smoke 监控组件不在 DOM 时溢出检查跳过→null 即失败；③runtime-soak-smoke CDP 指标缺失以零值样本过预算→指标必须齐备；④生产 HTML 安全头零覆盖→抽出 `scripts/release-html-headers.ts` 单一所有者+契约测试。核实无问题：golden 截图无自动对比属设计（更新能力由 smoke-artifacts.test 锁定）。

**T2/T4/T5/T7 未立项缺陷**（工具 ROOT 锚定/dry-run 默认/孤儿工具无 npm 入口；文档命令逐条有效；viewer 工具模块完好；CSS focus-visible 与 reduced-motion 双全局归零一致）。**T3 对抗专项防线成立**，新增 `tests/server-adversarial.test.ts`：伪造回环 Host/IPv6 映射、/data 双重编码与 ADS·NUL·尾点变体、readJsonBody 深嵌套+1MiB、favorite 白名单防 __proto__。

**第二部分阶段一（按 §10 顺序全部落地）**
- **A2 watcher 生产化（修缺陷级 F-B）**：release-server 内嵌 `startLoreWatcher({ baseRoot: PROJECT_ROOT })`，`GRAPH_BRAIN_NO_WATCHER=1` 逃生阀保持，close() 拆除定时器；hook-lib 新增 `setHooksRootBase` 把打包形态的日志/tsx CLI/runner cwd 锚回项目工作树；lore-watcher DECISION 注释改写为 dev/生产双形态。验收 **V6**：`tests/watcher-production.test.ts`（慢提取 800ms 期间并发定时器最大漂移 <200ms、基线推进、stop 后不推进）+ release-server 源码契约。V2 三轮回归在 `tests/lore-watcher.test.ts`（csc 编译 lore 替身设施 `tests/fixtures/lore-shim.ts`）。
- **A1 MCP 只读工具面（D-P1=SDK）**：devDependency `@modelcontextprotocol/sdk@1.30.0`；`tools/mcp-server.ts`（gb/1 stdio）7 个只读工具 gb_status/search_symbols/symbol_detail/neighborhood/impact/changes/annotations_get；直调 core resolver/query/analysis 纯函数；provenance 原样透传；fail-closed freshness（EVIDENCE_STALE 诊断而非数据，allowStale 显式降级）；宪法第 10 条边界声明在模块头；入口 `npm run mcp`。验收 **V7**：`tests/mcp-server.test.ts`（清单=gb/1 且无写语义、provenance 字段、stale→EVIDENCE_STALE 无事实数据、未知写类工具被拒）。
- **A3 回路基线门禁**：`core/query/arch-baseline.ts`（格式 `graphbrain-arch-baseline/1` 单一所有者：版本/subsystem 校验、diffCycles、tmp+durable rename 原子推进）；post-commit-update 刷新成功后调用，新增回路 WARN、门禁自身失败只记日志不阻断提交。验收 **V8**：`tests/cycle-baseline.test.ts`（空基线建立/新回路 WARN+基线推进/重复刷新无告警/坏格式 fail-closed/接线源码契约）。
- **A4 CGS 契约成文**：`docs/toolchain-contract.md`——对外稳定面（HTTP v1 + gb/1）、新鲜度 fail-closed 语义、版本化退役政策、CGS 义务（禁止绕过边界直读 data/）。

**D-P3 reading-context v2 迁移（用户裁决本轮实施）**
- 格式 v2：标注项可选 `anchor {start_line, end_line, fingerprint(sha256)}`；schema const 升 2。
- 迁移边界唯一：`loadReadingContext` 对磁盘 v1 文档就地升版——v1 无 anchor、v2 anchor 可选 ⇒ 版本号提升即无损幂等迁移。生产文件 `data/reading-context/ue5_code.json` 已落盘迁移（revision 3，无标注组，零信息损失）。
- 失效半径语义：节点 hash 失配时，锚区间原始字节指纹未变则不 stale；区间超界=失效。`core/annotation/staleness.ts` 新增 `resolveNodeSourceFile`/`annotationRangeFingerprint`/`resolveAnchorFingerprint`。
- 写入通道：API add/update 接受 `anchor {start_line, end_line}`，fingerprint 由服务端按当前源文件计算（客户端不自报），不可定位→422 `ANNOTATION_ANCHOR_UNRESOLVABLE`。回归 `tests/reading-context-v2.test.ts`（迁移无损幂等/指纹确定性与超界/schema 拒坏锚/端到端落盘）。

**E4 备份恢复 runbook**：`docs/backup-recovery-runbook.md`——data/ 可再生性分级、停服务备份步骤、内容寻址校验与代次降级恢复、一致性规则。D-P6 裁决不做同步机制。

**交付说明（宪法第 9 条）**
- 替换：reading-context v1→v2（磁盘数据已迁移，旧版本号不再被 schema 承认）；release-server 从"不启动 watcher"变为"缺省启动"（逃生阀保留）。
- 删除：无（本轮零删除入口）。
- 保留：全部既有 API/CLI 入口不变；`GRAPH_BRAIN_NO_WATCHER` 语义不变；孤儿工具继续仅作审计痕迹。
- 新依赖：`@modelcontextprotocol/sdk@1.30.0`（devDependencies，仅 tools/mcp-server.ts 使用，不入 viewer bundle）。
- 遗留登记（阶段二余量不足，未实施）：B1 standalone 翻译单元、B2 Build.cs 模块依赖边（若未来实施，变化页将出现一次性大量新增 depends_on 边的结构变化，回滚=data:rollback 至前代次）、C1 上下文包导出、C2 UI 标注编排器的行级锚选择交互（后端/API 已支持）、E3 gate:arch npm 门禁、D1 架构趋势、B4 多项目端到端验证、E2 引擎缓存老化。
- 观察项登记：liveTsxRunner spawn 失败返回原始负 exit 码（行为 fail-closed，仅文案差异）；layer-gate 不查语法错误文件（同一 check 链的 typecheck 兜底）；palette-input 无独立焦点环（键盘面板单焦点位，风险低）。
### 1.6 2026-08-23 第二轮审阅与修复（门禁的假通过是本轮主题）

**门禁自身（假通过 = 比无门禁更危险）**
- `layer-gate` 正则引擎三个已实证的假通过形态（副作用导入与 adapters 导入连写被懒匹配整段吞掉、字符串内 `//` 被当注释剥掉、反引号动态 import 不命中引号字符类）→ **整个 auditFiles 换 TypeScript AST 引擎**（ImportDeclaration/ExportDeclaration/import() 调用，isTypeOnly 权威判定）；三个形态 + fail-closed 均有回归测试。
- 两个门禁（layer-gate、engineering-standard-gate）读文件失败静默 `continue` → fail closed（抛错，CLI 非零退出）。

**server 边缘**
- 未匹配的 `/api/*` 落入 Vite SPA 回退返回 200 HTML（伪装路由可用，破坏 410 退役契约）→ router 层 `/api` 前缀 404 JSON 终结器（`API_ROUTE_NOT_FOUND`）。
- lore-watcher 在 vite dev 宿主里同步 spawnSync（提取期间冻结整个 dev server——上一轮同族问题的最后残留）→ hook-lib 新增 `runTsxAsync`/`runLoreAsync`（异步 spawn + 超时强杀 + 有界输出），watcher 全链路异步化。
- graph-projection 的 stat→read 窗口异常表现为 500 → 与兄弟读取方一致按 404 处理。
- If-Match 畸形值原与缺失同报 428 → 拆分为畸形 400（`READING_CONTEXT_PRECONDITION_INVALID`）/缺失 428；引擎根缺失的 500 补 code（`ENGINE_ROOT_UNRESOLVED`）与服务端日志。
- HEAD 统一按 GET 路由（router 入口归一化；Node 自动丢弃 HEAD 响应体）。

**viewer 标注草稿安全链（二轮审计发现保护各自被挂载上下文击穿）**
- DetailInspector 对 detail-swap 用 key 重挂 → 连带卸载 AnnotationPanel 使草稿守卫永不触发 → 移除 key。
- "保留我的修改"的还原路径在 API 宿主里调 `onJumpToNode`（跳走并丢草稿）→ 新增 `onRevertSelection` 契约，API 宿主传本地选中还原。
- 409 冲突重载后编辑器成孤儿（不可见但脏标志常驻）/ 旧基线盲重试覆盖他人修改 → 冲突后条目被删则带诊断退出编辑，远端内容已变则载入编辑器供复查。
- 写响应（200/409）补 `Array.isArray` 边界校验（畸形体不再清空列表或击穿视图）。
- App `navigateView` 接入 `confirmDiscardUnsavedChanges`（探测基础设施此前无生产消费方，工作区切换静默丢草稿）。
- HierarchySelect 闭合态 value 不在选项里时显示"当前选择不在列表中"（原冒充第一项）；ArchitectureWorkspace scope slug 碰撞追加稳定序号去重（原会产生重复 React key 与不可达深链）。

**验收缺口关闭**
- 新增 `tests/reading-context-concurrent-process.test.ts` + fixture：3 个真实 Node 子进程并发 mutateReadingContext（busy 重试 + conflict 重载重试），断言 revision 无跳号、零丢失更新、最终文档过 schema——交接文档挂账两轮的"真实 watcher+浏览器并发写实测"以等价形式落地。

### 1.5 2026-08-23 第一轮全面审阅与修复（3 代理审计 + 人工精读，逐条核实后实施）

**P0（真实 BUG）**
- evidence 变化查询 O(n²)（`changedNodeKind` 逐节点回扫；80k 事实实测 38s）→ kind 直接用 `tab`（`core/evidence/query.ts`）。
- `/api/evidence/v1/refresh` 用 `spawnSync` 内联跑提取，阻塞常驻服务事件循环最长 20 分钟 → 新增 `withFileLockAsync`（file-lock.ts 同一组获取/释放原语的异步孪生）+ `refreshProjectEvidence` 异步化 + server 侧异步 spawn（带 10 分钟超时与 2 MiB 输出环形缓冲）；hook/CLI 同步语义不变。
- `tools/service-deploy.ts` 候选验收兜底 `child.kill()` 仍是 SIGTERM（POSIX 上被忽略的进程会再次忽略）→ SIGKILL。
- `tools/rehash-annotations.ts` 双缺陷：图路径按 cwd 解析（错根会对齐错误基线）+ `saveAnnotations` 缺 revision 参数（运行必冲突）→ ROOT 锚定 + 传 revision。

**P1（健壮性边界）**
- `analyze` CLI 图/基线经裸 `as` 进入 → `checkGraphSchema`+`checkGraphReferences` 校验；`--cycle-baseline` 指定但缺失时显式报错（原为静默跳过）；`parseCycleBaseline` 单一解析边界（analysis.ts，可测）。
- `buildChangeReport` 悬垂边端点会给两图都不存在的节点产出幽灵 affected 行 → 入口拒绝（稳定错误信息 + 测试）。
- Epic 同步任务表的 `job.error`/`failed[].error` 未脱敏（fs 错误带本机绝对路径进 GET 响应）→ `redactLocalPaths`（http(s) URL 不误伤）+ 完整错误只进服务端日志。
- 常驻服务两个无界内存缓存（`engine-class-service.incrementCache`、`EngineResolver.parsedFiles`；soak 只测浏览器端测不到）→ `BoundedCache`（adapters/ue5-code/bounded-cache.ts，LRU 近似 + 测试）。
- 森林导航 contains 环防护（countFiles/hide/祖先链三处遍历加终止条件）。

**P2（优雅性收敛）**
- analysis 分组三处重复 + `layer` 回退混口径（module 轴改走 canonical `resolveCodeModule`）；`forwardClosure` 与 `impactAnalysis` 47 行逐字重复 → `closureByDirection` 单实现。
- viewer：API 入口跳转按 seq 消费一次（原每次引擎解析合入重放旧导航）；面板拖拽卸载泄漏（usePanelWidth teardown ref）；SpecView 窗口快捷键接入 `hasAppShortcutBlocker` 阻挡契约；GraphView 背景关闭恢复焦点；无 href `<a>` → button；`docs_url` 只接受 http(s)（`safeDocsUrl` 单一边界）；favorites toggle 响应校验对齐加载路径；`HOLD_RELATIONS`/`ASSET_TYPE_RE`/PanelResizer 三组副本收敛为单一所有者。
- header-parser：属性正则按文件编译一次（原 O(函数×属性) 次）；extract-classes-lib 森林度数走 id 索引（原 O(边×节点)）。

**审阅结论（否决项也要知道）**：core 层锁/发布/部署状态机与算法核心（Tarjan/Brandes/闭包）人工精读无缺陷；审计代理报的"graph-diff.ts 死代码"为误报——`diffGraphElementsDetailed` 是 GraphView 活路径，仅未删除；lore-watcher 在 vite dev 内 spawnSync 阻塞仍存在（生产 release-server 不跑 watcher，属 dev 形态已知代价，未改动）。

- **五轮深挖**（2026-08-10）：静态死代码清除（adapter.ts/useExitGate.ts 2 文件 + 10 符号 + DomainAdapter）；tsconfig 开启 noUnusedLocals/noUnusedParameters（清除 13 处私有死代码，含锁迁移残留 import）；六面全局审视（数据/脚本/UI/配置/代码/归档全活）；运行时链路（hook 端到端实测、API 边界矩阵修复 engine sync 非法参数 400、新图 UI 渲染）；数据完整性（报告≡diff、图语义、断言质量）。

## 2. 关键架构事实（改动后必须遵守）

- **锁**：所有跨进程写入走 `core/store/file-lock.ts` 的 `withFileLock`（同步）/ `withFileLockAsync`（异步 action，同一组获取/释放原语）。契约：锁文件记录 `pid started_at`（或 JSON 格式），`busy:"throw"|"skip"`；**释放前重读锁记录、仅 owner pid 匹配才删**（陈旧恢复竞态下不得删后继持有者锁）；`recoverStaleFileLock` 在并发移除竞态下返回 true 供重试。publication、hook、reading-context、deployment 锁共用。**服务端处理器里的长耗时子进程必须走异步形态**（spawnSync 会冻结整个事件循环）。
- **publication**：`core/store/data-publication.ts` 是唯一 normalize/validate 边界；所有写入（publish/rollback/prune）带 revision 冲突保护；内容寻址不可变文件；`visiblePublishedFiles`/`isPublishedArtifactVisible` 只暴露 state 引用内产物。
- **catalog**：`graphCatalogEntries` 只解析 `activeCatalogGraphFiles`（current 管理文件 + legacy）；被接管 subsystem 的 legacy 文件隐藏，历史管理文件零解析。
- **scanStale**：3 次"重读最新文档 → 重新计算 stale → 新 revision 写"，绝不复用旧 draft；`saveAnnotations` 是整 subsystem 替换，冲突由 `ReadingContextConflictError` 表达。
- **安全**：生产静态服务（release-server.ts）所有 HTML 响应带 `frame-ancestors 'none'` + XFO DENY；通用 `/embed` 已退役并集中返回 410；`isTrustedMutation` 要求带 Origin 的写请求必须回环 host + `X-GraphBrain-Local: 1` 头（前端 `apiFetch` 统一注入）；`/data` 直读拒绝 `..` 段。
- **部署**：`tools/service-deploy.ts` 状态机——prepare 构建隔离候选并验收（3130），activate 切 NSSM（需管理员），失败自动恢复 NSSM 快照 + state；deployment 锁带陈旧恢复。

## 3. 操作速查

```powershell
# 部署（代码改完后）
npm run check              # layer-gate+typecheck+test+validate+build+bundle+smoke
npm run service:prepare    # 候选构建 + 隔离验收（3130）
# 管理员终端：
npm run service:activate   # 切换；失败自动回滚
npm run service:rollback   # 对称回切（rollback 后再回新 release 也用这个，不是 activate）

# 数据
npm run data:status        # publication 状态 + 校验
npm run data:prune         # dry-run 安全清理清单
npm run data:prune -- --apply
npm run data:rollback -- --subsystem project

# hook 手动触发（真实提交钩子链路）
npm run hook:update -- --project G:/UnrealProject/Sabotage --files "Source/Sabotage/SabotageCharacter.h"

# 浏览器门禁
npm run smoke              # 9 项（visual/interactive/motion/soak/资源/预算/恢复）
npm run smoke:soak         # 长时切换 + GC 斜率
```

## 4. 已知限制与待办（评估后保留，非缺陷）

- **NSSM 服务账户为 LocalSystem**：可预测路径写已全部 tmp+rename 原子化（不跟随 symlink），单用户模型下无提权收益；改 `ObjectName` 需凭据管理与影响无登录自启，属运维决策。
- **CSP 仅生产 release**：vite dev 模式不加（HMR 兼容）；生产是主要运行形态。
- **`adapter.diff` 显式失效名单按 CWD 解析**（`adapters/ue5-code/adapter.ts` 已删除，此点随 adapter 架构移除——若重建需按源码根 resolve）。
- **`CODE_WORKSPACE_MODEL` 仅测试锚定**（workspace-model.test.ts），非死代码。
- 孤儿 tools（`purge-authoring-platform.mjs`、`purge-authoring-residuals.mjs`、`migrate-orphan-annotations.mjs`、`migrate-retired-annotations.mjs`、`rehash-annotations.ts`、`css-motion-unify.mjs`）：已执行的一次性迁移/清理工具，保留作审计痕迹（无 script 入口，勿删）。
- 下轮候选方向：~~analyze CLI `--out` 端到端验证~~（2026-08-23 已验证通过，含全参数与 UTC 日期覆盖行为）；~~reading-context 跨进程并发写实测~~（2026-08-23 已落地 `reading-context-concurrent-process.test.ts`）；50k 变化事实性能预算可回归复核（本轮 smoke 实测 interactive 1.4s 仍在预算内，但斜率值得盯）。

## 5. 关键文件

- `core/store/file-lock.ts`：共享文件锁（原子获取/陈旧恢复/归属校验释放；同步 + 异步孪生）。
- `core/store/data-publication.ts`：publication v1、内容寻址、revision 冲突、rollback、prune、活动集能力接口。
- `core/annotation/staleness.ts`：scanStale 三次重试；`core/annotation/store.ts`：标注投影 + saveAnnotations。
- `core/reading-context/store.ts`：reading-context 唯一 owner + 跨进程锁写。
- `core/query/change-report.ts` / `change-report-catalog.ts`：语义变化单一判断 + 默认非空报告选择。
- `core/service/deployment-*.ts`：部署状态机 + 锁。
- `core/hooks/post-commit-update.ts` / `lore-watcher.ts`：hook 三态退出码 + watcher 基线推进。
- `server/catalog.ts` / `changes.ts` / `graph-projection.ts` / `misc.ts` / `annotations.ts` / `engine.ts` / `http.ts`：服务端消费者与安全边界。
- `scripts/release-server.ts`：生产静态服务 + CSP/XFO。
- `tools/service-deploy.ts` / `data-publication.ts`：CLI。
- `tests/`：306+31 测试；重点：`layer-gate.test.ts`（9，含 AST 引擎三形态回归 + fail-closed）、`reading-context-concurrent-process.test.ts`（跨进程真实并发）、`data-publication.test.ts`（17）、`header-parser.test.ts`（17）、`file-lock.test.ts`（8，含 async）、`analysis.test.ts`（10）、`server-security.test.ts`（9）、`change-report.test.ts`（含悬垂端点拒绝）、`bounded-cache.test.ts`。

## 6. 每轮完成前必须执行

```powershell
npm run check        # layer-gate && typecheck && test && validate && build && check:bundle && smoke
```

- tsc 严格模式（noUnusedLocals/noUnusedParameters）已开启：**新增代码不得有未使用导入/局部/参数**（用 `_` 前缀豁免参数）。
- 涉及常驻服务代码后：`npm run service:prepare`，候选 HTTP + 五工作区验收通过后才允许管理员 `service:activate`。
- 涉及长期运行与工作区生命周期后：`npm run smoke:soak`。
- 受限环境可能让 tsx/esbuild 统一报 `spawn EPERM`，不是用例失败，在非沙箱环境重跑即可。

## 7. 完成定义

- 新旧数据路径都经过集中 publication/normalization 边界；当前事实只有一个 owner；历史 generation 不得重新出现在首页成为并列主项目。
- 旧内容不被无提示删除，回滚仍可完成；所有写入具备 revision 冲突保护、故障恢复和保存/重载验证。
- 3030 的五工作区、变化页、白屏恢复、性能预算和长时切换门禁全部通过。
- 报告清楚列出替换、删除、保留及其原因。
