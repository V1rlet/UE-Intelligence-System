# GraphBrain 数据备份与恢复 Runbook（E4）

状态：有效（2026-08-23 制定）
范围：`data/` 目录（代码事实图、证据快照、变化报告、阅读上下文、发布状态）。
定位：换机 / 灾难恢复的人工操作手册。GraphBrain 不做自动同步（D-P6 裁决：仅文档化，不做同步机制）。

## 1. data/ 里有什么

| 路径 | 内容 | 可再生性 |
|---|---|---|
| `graphs/` | 提取的代码事实图（`*.cyto.json`，内容寻址文件名 `__gbtx-<sha 前 16>`） | **可再生**：对源码重跑提取即可重建，但历史代次不可再生 |
| `publications/<domain>.json` | 发布状态机：当前代次指针、revision、每代次 graph/change_report 的 sha256 绑定 | 不可再生（是"哪些代次有效"的唯一事实） |
| `changes/` | 变化报告（`*.change.json`，内容寻址） | 与代次绑定；可再生需当时的基线图 |
| `evidence/` | v3 证据快照（v3 模式激活时为活动事实源） | 由 v2 图迁移而来；绑定 publication 代次 |
| `reading-context/` | **人工标注知识层**（ue5_code.json，format_version 2，行级锚 v2） | **不可再生**：用户知识，唯一副本在此 |
| `annotations/` | 预留目录 + 存量投影（活动数据已并入 reading-context） | 同上 |
| `api-favorites/`、`usage/`、`cache/`、`archive/` | 收藏迁移残留 / 使用摘要 / 解析缓存 / 已退役归档 | cache 可删；archive 是退役审计痕迹，保留 |

**备份优先级**：reading-context > publications > graphs+changes+evidence > 其余。

## 2. 备份步骤

```powershell
# 停写窗口：标注写入走 .write.lock，但备份一致性最简单的保证是先停服务
# （管理员终端；NSSM 服务名 graph-brain-viewer）
& nssm.exe stop graph-brain-viewer
tar -a -c -f graphbrain-data-<日期>.zip data
& nssm.exe start graph-brain-viewer
```

小体积替代方案（只备不可再生部分）：`reading-context/` + `publications/` + `archive/`。
其余可按 §3 从源码重建后重新发布。

## 3. 恢复步骤（换机 / 数据损坏）

前置：新机已 clone 本仓库 + `npm install`；UE 项目路径不变（或修改 hook-projects.json 的注册根）。

1. 解包备份到仓库根，还原 `data/` 目录结构。
2. 校验内容寻址完整性：

   ```powershell
   npm run data:status        # validation_errors 必须为 []；revision/generation 与备份一致
   ```

   - `validation_errors` 列出缺失/哈希不符的产物 → 该代次不可信，见第 3 步。
3. 单个代次不可信时的降级恢复：
   - `npm run data:rollback -- --subsystem project` 回退到上一可用代次（状态机带 revision 冲突保护）；
   - 或 `npm run evidence:snapshot -- rollback-v2 --expected-revision <status 显示值>` 回到 v2 兼容模式后重跑提取；
   - 全部失效时：删除 `publications/*.json` 后对 Sabotage 全量重跑 `hook:update`（历史代次丢失，人工标注仍在 reading-context 中保留——标注以 node_id 为键，不依赖具体代次）。
4. 校验人工知识层未丢：

   ```powershell
   npm run validate           # schema 校验含 reading-context（当前 v2）
   npx tsx tools/evidence.ts status
   ```

5. 重建候选并验收（不得直接 activate 旧 release）：

   ```powershell
   npm run check:fast         # 门禁 + 测试
   npm run service:prepare    # 构建候选 + 3130 隔离验收
   # 管理员终端确认后再 npm run service:activate
   ```

## 4. 一致性规则（为什么这样备份）

- 图/报告文件名即内容哈希：复制后无需额外校验和；`data:status` 的 sha256 复核即完整性证明。
- publications state 带 revision：恢复时若误用新旧两份 state，`data:status` 会报 validation_errors，不会静默混用。
- reading-context 写入走 tmp+fsync+durable rename：备份时即使赶上写入，最多损失最后一个临时文件，主文档不半写。
