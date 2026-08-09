# GraphBrain 下一轮 Agent 交接清单

更新时间：2026-08-10（Asia/Shanghai）

## 0. 交接时的真实状态

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
- **五轮深挖**（2026-08-10）：静态死代码清除（adapter.ts/useExitGate.ts 2 文件 + 10 符号 + DomainAdapter）；tsconfig 开启 noUnusedLocals/noUnusedParameters（清除 13 处私有死代码，含锁迁移残留 import）；六面全局审视（数据/脚本/UI/配置/代码/归档全活）；运行时链路（hook 端到端实测、API 边界矩阵修复 engine sync 非法参数 400、新图 UI 渲染）；数据完整性（报告≡diff、图语义、断言质量）。

## 2. 关键架构事实（改动后必须遵守）

- **锁**：所有跨进程写入走 `core/store/file-lock.ts` 的 `withFileLock`。契约：锁文件记录 `pid started_at`（或 JSON 格式），`busy:"throw"|"skip"`；**释放前重读锁记录、仅 owner pid 匹配才删**（陈旧恢复竞态下不得删后继持有者锁）；`recoverStaleFileLock` 在并发移除竞态下返回 true 供重试。publication、hook、reading-context、deployment 锁共用。
- **publication**：`core/store/data-publication.ts` 是唯一 normalize/validate 边界；所有写入（publish/rollback/prune）带 revision 冲突保护；内容寻址不可变文件；`visiblePublishedFiles`/`isPublishedArtifactVisible` 只暴露 state 引用内产物。
- **catalog**：`graphCatalogEntries` 只解析 `activeCatalogGraphFiles`（current 管理文件 + legacy）；被接管 subsystem 的 legacy 文件隐藏，历史管理文件零解析。
- **scanStale**：3 次"重读最新文档 → 重新计算 stale → 新 revision 写"，绝不复用旧 draft；`saveAnnotations` 是整 subsystem 替换，冲突由 `ReadingContextConflictError` 表达。
- **安全**：生产静态服务（release-server.ts）HTML 响应带 CSP（主查看器 `frame-ancestors 'none'` + XFO DENY，`/embed.html` 放行）；`isTrustedMutation` 要求带 Origin 的写请求必须回环 host + `X-GraphBrain-Local: 1` 头（前端 `apiFetch` 统一注入）；`/data` 直读拒绝 `..` 段。
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
- 下轮候选方向：`analysis.ts` 已有测试但 analyze CLI 的 `--out` 持久化路径无端到端验证；reading-context 跨进程锁已就位但未做真实 watcher+浏览器并发写实测；50k 变化事实性能预算可回归复核。

## 5. 关键文件

- `core/store/file-lock.ts`：共享文件锁（原子获取/陈旧恢复/归属校验释放）。
- `core/store/data-publication.ts`：publication v1、内容寻址、revision 冲突、rollback、prune、活动集能力接口。
- `core/annotation/staleness.ts`：scanStale 三次重试；`core/annotation/store.ts`：标注投影 + saveAnnotations。
- `core/reading-context/store.ts`：reading-context 唯一 owner + 跨进程锁写。
- `core/query/change-report.ts` / `change-report-catalog.ts`：语义变化单一判断 + 默认非空报告选择。
- `core/service/deployment-*.ts`：部署状态机 + 锁。
- `core/hooks/post-commit-update.ts` / `lore-watcher.ts`：hook 三态退出码 + watcher 基线推进。
- `server/catalog.ts` / `changes.ts` / `graph-projection.ts` / `misc.ts` / `annotations.ts` / `engine.ts` / `http.ts`：服务端消费者与安全边界。
- `scripts/release-server.ts`：生产静态服务 + CSP/XFO。
- `tools/service-deploy.ts` / `data-publication.ts`：CLI。
- `tests/`：219 测试；重点：`data-publication.test.ts`（17）、`header-parser.test.ts`（17）、`file-lock.test.ts`（7）、`staleness-retry.test.ts`（3）、`analysis.test.ts`（7）、`server-security.test.ts`（9）。

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
