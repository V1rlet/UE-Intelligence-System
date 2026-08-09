# GraphBrain UX 执行续接

> **已被 2026-08-09 的只读代码事实收敛替代。** 本文件只保留为历史审计，不得作为当前续接指令。当前产品边界、入口与验证命令以仓库根 `CLAUDE.md`、`README.md`、`docs/architecture.md` 和 `progress.md` 为准；下文九视图、设计交付、World Atlas 与任务包内容均已退役。

更新时间：2026-08-04  
工作区：`G:\UnrealProject\GraphBrain`  
状态：UX 续接批四已完成（CSS Modules 阶段 2：HelpCenter + design-delivery 提取 module.css；lv-l1/lv-l2/lv-l3 pre-existing 修复；App.tsx Step 9：GraphWorkspaceView 69 props 归组；阶段 3 死类清理 15 条 + <200KB 评估；3030 白屏事故修复；九视图视觉复验），全量验证通过。剩余：CSS Modules 阶段 3 收敛（无字节目标）、长期演进项。dev server 使用 **3030**（旧损坏进程已清，如再遇白屏先重启 dev server）。

## 历史新会话指令（禁止继续执行）

"继续 GraphBrain UX 任务。先读取本文件，检查当前工作区后从续接点继续。保留已有修改，不要重做或 reset。"

## 已完成

- API 搜索：有搜索词时默认全局，不受 Runtime/Engine 分类器限制；无搜索词时分类器仍用于浏览。结果按文本匹配级别、常用性、用途分组、模块/名称综合排序并高亮。新增 `apiSearch.ts` 及测试。
- Phase 1 遗漏：旧报告只迁移了部分请求；现已将 viewer 全部裸 `fetch` 收敛到 `viewer/src/apiFetch.ts`，统一网络、HTTP、解析、Abort 和可接受业务状态。
- 批注防丢：节点切换前确认；跨图谱/工作区也有统一未保存保护。新增 `unsavedChanges.ts` 及测试。
- UI 偏好使用 v2 键和集中迁移；无效路由显示恢复提示。
- 图谱加载错误/重试/空态；命令面板 ARIA；Ctrl+K 可覆盖低层弹层；帮助中心可搜索。
- 搜索下拉 DOM 测量移出 render；节点 hover 延迟；Enter 可打开聚焦节点。
- 详情分区可折叠并记忆；错误态补 `role="alert"`；设计表单改为内联错误。
- 设计必填字段由 Contract + `design-language.ts` 驱动，旧字段 `zone/arc/line/chain` 保持兼容；有覆盖测试。
- 3D：相机引导、上一视角/总览、指南针、坐标/距离、Resize 合帧、点击阈值、标签距离 LOD、Studio 重试、标准数值控件。
- 样式：间距/圆角/z-index 令牌、Firefox scrollbar、弱化态对比度、关系颜色单一来源、打印样式框架。
- 打印样式 8 处硬编码 `#fff/#111` 改为 `var(--gb-white)` / `var(--gb-neutral-20)`。`check:colors` 门禁通过。
- palette.generated.css 恢复为 129 令牌（原 112 + 17 新增），含 async-surface、quest-program、experience 等新 CSS 引用的令牌。
- API 搜索单字符子串匹配修复：`includes` 匹配要求 token ≥ 2 字符，短 token 仅匹配精确/前缀/分词前缀。
- `gameplay_design` 设计语言定义：新增完整语言定义（5 类节点 + 8 种关系 + `priority`/`category` 属性）+ 变更协议支持 + 测试 fixture。
- `npm run check` 全量通过：typecheck 0 errors · 239 tests pass · validate pass · build success · check:bundle pass。
- **App.tsx 拆分 Step 1**：新增 `useGraphDocument.ts` hook，从 App.tsx 提取图谱文档数据层（目录获取、文件选择、跨领域链接、Mermaid 索引、latestGraphOf 辅助函数）。App.tsx 94.6KB → 92.4KB。`npm run check` 全量通过。
- **App.tsx 拆分 Step 2**：新增 `useForestNavigation.ts` hook，提取森林导航全部状态与派生（collapsed/forestFocus/forestQuery/searchSel 状态、forestIndex/forestElements/searchResults 派生、locateInForest/toggleFolder 操作）。URL sync effect 因依赖 `forestFocus` 下移到 hook 调用之后（依赖数组立即求值，闭包引用不受影响）。App.tsx 92.4KB → 87.2KB。`npm run check` 全量通过（239 tests pass）。
- **App.tsx 拆分 Step 3**：新增 `useSpecNavigation.ts` hook，提取 Spec 页导航状态机（specStack/specTarget/hoverId/specSelectedId/fnPage/specZonePages/focusRequest 状态 + requestFocus/openSpec/backSpec/closeSpec 操作）。openSpec 的引擎解析副作用经 `onOpenSpec` 回调注入（hook 内 ref 保存，openSpec 身份稳定）；hook 调用置于 URL effect 之前（依赖数组含 specTarget），回调闭包引用后声明的 domain/graph/parseEngineClass（TS 合法，已验证）。App.tsx 87.2KB → 86.8KB。`npm run check` 全量通过（239 tests pass）。
- **App.tsx 拆分 Step 4**：新增 `useEngineClassParser.ts` hook，提取引擎类按需解析（engineFetch/setEngineFetch 状态、engineCandidate 候选判定、mergeIncrement 并入图、parseEngineClass 请求+定位流程）。森林联动（forestQuery/locateInForest/setForestQuery/setSearchSel）以参数注入，不持有森林状态；App 的 `onOpenSpec` 回调保留策略判断（domain/graph/hasConcreteSpecTarget/toast），解析机制已全部提升。App.tsx 86.8KB → 84.0KB。`npm run check` 全量通过（239 tests pass）。
- **App.tsx 拆分 Step 5**：新增 `viewer/components/topbar/WorkspaceTabs.tsx`，提取 `CodeWorkspaceTabs`（类与模块设计/API 查询/推进与交付/架构脑图）与 `DesignWorkspaceTabs`（设计工具/世界地图/交付中心/跨方案辅助）两个纯展示组件（无 hook，props 注入全部状态与回调）。App.tsx 84.0KB → 80.4KB；顺带清理死代码（DESIGN_ACCENT import、hasDocumentApi）。`ui-language.test.ts` 的 ws-flow-entry 断言随组件移动指向 WorkspaceTabs.tsx。`npm run check` 全量通过（239 tests pass）。
- **App.tsx 拆分 Step 6**：新增 `viewer/components/graph-view/GraphWorkspaceView.tsx`（15.5KB），提取 `view === "graph"` 的三态渲染——Spec 页（类结构 + 类详情双栏）、引擎类资料层、主画布（PlannedEditToolbar/DesignEditToolbar/TimelineBar/GraphView/Legend/跨域辅助/检视器）。纯展示容器：全部状态与回调经 props 注入（约 50 个 props），无 hook。跨图跳转统一收敛为 `onCrossJump` 回调（App 内联：同图 → forestFocus，异图 → pendingJump + setCurrentFile），`pendingJumpRef` 不再传入组件。lazy code-split 边界保持（重型视图仍 AsyncSurface 包裹按需加载）。App.tsx 80.4KB → 63.4KB（累计 94.6KB → 63.4KB，-33%）。`ui-language.test.ts` 的 AsyncSurface 计数断言改为 `app + GraphWorkspaceView` 合计 ≥ 11（迁移后 App 内 8 处 + 组件内 5 处）。`npm run check` 全量通过（239 tests pass）。
- **App.tsx 拆分 Step 7**：`useGraphFile.ts`（图谱 fetch 生命周期：fetch/AbortController/加载态/错误/格式校验/skip-reload/重载序号；UI 状态重置经回调注入留在 App）。`npm run check` 全量通过。
- **App.tsx 拆分 Step 8**：`graph-view/DetailInspector.tsx` 检视器提取（NodeDetail/ApiDetailCard/AnnotationPanel/跨域链接/Mermaid 条目/module-graph 跳转/空态）；GraphWorkspaceView 17.7KB → 14.3KB。
- **CSS Modules 阶段 1 试点**：`SliderWithInput.module.css`（9 条规则零外部依赖），全局旧规则删除，dist 哈希类 `_sliderWithInput_1m4zs_3` 验证。
- **#71 误删修复**：多类模板 head 前缀漏提 bug → 恢复 7 组动态类规则（help-workflow-world / async-state-panel / nd-badge-layer-* / api-kind-* / ann-card-* / state-* / kind-*），色值全取已验证令牌。
- **CSS Modules 阶段 2 — HelpCenter 提取**：`help-center.css`（349 行/20 类）→ `viewer/components/help/HelpCenter.module.css`（camelCase + 局部 @keyframes hash）；tab active 局部化（全局 `.active` 全为上下文限定）；动态类 `help-workflow-${id}` 改三元显式映射；`viewer/styles/help-center.css` 删除。产物 `HelpCenter-D-YRRu_z.css`。**关键认知：未在本文件定义的 keyframes（gb-enter-fade）产物保持原名不 hash**。
- **CSS Modules 阶段 2 — design-delivery 提取**：`design-delivery.css`（218 行/51 类）→ `viewer/components/design/DesignDeliveryCenter.module.css`（18.7KB）；42 静态类 + 13 条件类全转 `styles.*`；receipt/severity/impact/diagnostic 动态枚举类用 `Record<X, string>` 映射表（类型安全）；`error-banner` 全局类与 `gb-enter-*` 全局 keyframes 保留引用；顺手清死类 `design-delivery-btn`（WorkspaceTabs）。产物 `DesignDeliveryCenter-BwCRj9gw.css`。
- **lv-l1/lv-l2/lv-l3 pre-existing 修复**：`foundry-level-chip`/`foundry-dispatch-row` 的 `lv-${level.toLowerCase()}` 与静态 `.lv1/.lv2/.lv3` 从未匹配 → 补 3 条规则（ember-70/amber-75/green-75 全令牌）；`design-delivery-grade.l2/.l3` 死类迁移为 `.lv-l1/.lv-l2/.lv-l3`（修复等级色从未生效 bug）。
- **App.tsx 拆分 Step 9 — GraphWorkspaceView 69 props 归组**：69 平铺 props → 6 复合对象（`data` 13 / `spec` 20 / `edit` 17 / `canvas` 11 / `assist` 5 / `panels` 2 + `onExit`）；导出接口 `GraphWorkspaceData/Spec/Edit/Canvas/Assist/ViewProps`；组件内二次解构保持函数体零改动；App 传组对象。组件未 memo，无引用稳定性问题。
- **App.tsx 拆分 Step 10 评估**：9 个 AppView（home/graph/atlas/api/planning/review/delivery/architecture/design-delivery）渲染层已全组件化；数据层已 hook 化；**结论：三层边界已达成，剩余 App 协调行数（paletteActions/URL 序列化/快捷键/pendingJump）属核心职责不拆分**；「ExperienceWorkspace」不存在（体验编排在 WorldAtlasView 内）。
- **阶段 3 死类清理**：全 styles/ 15 真死类删除/迁移（app.css 6：grade.l2/.l3 迁移 + api-detail-empty + statusbar 主块/媒体/打印 + api-nav-tune；comfort.css 1；experience.css 5；readability.css 3）；源 CSS 565KB → 563KB。**阶段 3 结论：<200KB 不可行**（活跃功能样式占大头，压缩牺牲可维护性；dist 已按需 chunk 498KB）。
- **3030 白屏事故修复**：旧 vite dev 进程（管理员 PID 7536）转换缓存损坏（GraphWorkspaceView 返回空模块，esbuild/tsc 均正常，3031 新实例同文件成功——铁证为进程状态问题）；UAC 提升终止成功，3030 恢复（转换 44,226 字节）。**教训：dev server 长时间运行遇模块转换空结果先重启 dev server**。
- **九视图视觉复验**：home/graph/atlas/api/planning/review/delivery/architecture/design-delivery 零 JS 错误，root 内容齐全，design-delivery tab 切换 + 全局类泄漏清零。

## 立即续接点

App.tsx 拆分 6 步 + Step 7/8/9 已全部完成（useGraphFile / DetailInspector / 69 props 归组）；UX 续接批二 7 项（#42/#28/#64/#20/#21/#71/#75 评估）已全部完成；**续接批三已完成**（Step 7/8、CSS Modules 阶段 1、#71 误删修复、F47–F53 视觉复验）；**续接批四已完成**（CSS Modules 阶段 2：HelpCenter + design-delivery 提取 module.css；lv-l1/lv-l2/lv-l3 修复；Step 9 props 归组；Step 10 评估结论；阶段 3 死类清理 + <200KB 评估；3030 白屏事故修复；九视图视觉复验），全量验证通过（typecheck 0 / 244 tests / validate / build / check:bundle / check:colors；浏览器实测零 JS 错误）。

**下一个续接点**：无阻塞项。长期候选——CSS Modules 阶段 3（新代码默认 module.css、继续死类清理，不再追字节目标）；Quest 长表单分区交互细节；或按用户新需求推进。

> 拆分注意事项（Step 2–3 经验）：① React 依赖数组立即求值而 effect 回调闭包延迟求值——被拆分状态在 hook 调用之后才可用时，只有依赖数组含该状态的 effect 需要下移（URL sync effect 两次下移）；回调里引用的 effect（currentFile 加载、popstate、pendingJump）无需移动。② hook 参数回调（如 onOpenSpec）引用后声明的 App 变量是合法的——TS 允许闭包内 use-before-declare（已验证），但回调需经 ref 保存以稳定 openSpec 等操作身份。③ useGraphFile 回调同理（onLoadStart/onLoaded/onLoadError 经 ref 保存）。
> 白屏事故教训（2026-08-04）：dev server 长时间运行后遇「特定模块转换返回空、浏览器报 does not provide an export named 'default'」，且 esbuild/tsc 对同一文件均正常 → 是 dev server 转换缓存损坏而非代码问题。处理：换端口起新实例验证 → 定位旧进程（管理员权限需 UAC 提升终止）→ 恢复原端口。

## 未完成的长期/高风险项

- **CSS Modules 阶段 3 全局收敛**（#75 方案）：阶段 2 已提取全部自治组件（HelpCenter + design-delivery）；quest-program / experience-canvas3d / foundry 经评估为交织型（跨文件动态类 `tone-*`/`mode-*`/`${layer}`），归阶段 3 候选。**<200KB 目标评估不可行**（563KB 源文件均为活跃功能样式；dist 已按需 chunk 498KB）——收敛手段 = 死类清理 + 新代码默认 module.css，不追字节数。
- **App.tsx 状态下沉**：Step 10 结论——渲染/数据/协调三层边界已达成，剩余 App 协调行数（paletteActions/URL 序列化/快捷键/pendingJump）属核心职责；spec/selected/timeline 状态下沉会切断 URL 同步与命令面板访问，不建议。拆分已收尾。
- **#71 复核经验**：动态类前缀提取以模板 head 的最后一个 token 为准；删除分布（每文件条数）是复核误删的第一证据源；备份与候选清单保留至下一个验证批次。

## 关键文件

`useGraphDocument.ts`（新增）, `useForestNavigation.ts`（新增）, `useSpecNavigation.ts`（新增）, `useEngineClassParser.ts`（新增）, `useGraphFile.ts`（新增）, `topbar/WorkspaceTabs.tsx`（新增）, `graph-view/GraphWorkspaceView.tsx`（新增）, `graph-view/DetailInspector.tsx`（新增）, `common/SliderWithInput.module.css`（新增）, `help/HelpCenter.module.css`（新增）, `design/DesignDeliveryCenter.module.css`（新增）, `ApiReferenceView.tsx`, `apiSearch.ts`, `apiFetch.ts`, `uiPrefs.ts`, `unsavedChanges.ts`, `App.tsx`, `AnnotationPanel.tsx`, `DesignEditToolbar.tsx`, `WorldAtlasScene3D.tsx`, `WorldAtlasView.tsx`, `MermaidModal.tsx`, `app.css`, `world-atlas.css`, `stylesheets.ts`, `palette.generated.css`, `design-tokens-palette.ts`, `design-language.ts`, `design-graph.ts`，以及 `tests/api-search-model.test.ts`, `ui-prefs.test.ts`, `unsaved-changes.test.ts`, `design-language-attributes.test.ts`, `workspace-model.test.ts`, `ui-language.test.ts`。

## 注意

仓库原本已有大量 modified/untracked 文件，禁止 reset、checkout 或批量清理；不要把全部工作区差异归因于本轮。
**不要运行 `css-color-unify.mjs --write`**——palette 已手动恢复为完整状态，重新运行 `--write` 会再次缩减为仅 2 个令牌。如需新增令牌，手动编辑 `palette.generated.css` + `design-tokens-palette.ts`。
