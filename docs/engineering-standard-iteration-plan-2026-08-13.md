# GraphBrain 编码规范严肃审阅与 v1 迭代方案

日期：2026-08-13（Asia/Shanghai）  
审阅对象：仓库 `AGENTS.md`、架构文档、TypeScript 配置、分层门禁、测试分层与生产发布契约  
实施基线：GraphBrain 1.0.0 / production revision 30

## 1. 审阅结论

现有 11 条工程宪法对演进兼容、迁移、事实所有权和旧系统清理约束很强，且已有真实迁移、发布、回滚和浏览器门禁证明其有效。问题不在这些规则本身，而在于它们只覆盖“系统如何演进”，没有形成一份完整、可执行的编码标准。

### P0：文字规范与机器门禁的信任边界不一致

`layer-gate` 声称只放行三个稳定 Adapter 边界，实际却按 basename 判断。任何具体 Adapter 子目录只要创建同名 `registry.js`、`diff-lib.js` 或 `adapter-interface.js`，都可能绕过门禁。这使“集中边界”只是一项命名约定，不是可证明的依赖约束。

### P0：缺少规范版本、变更协议和集中例外机制

当前规则没有 `format_version`、规则 ID、适用范围、责任人或废止流程。也没有集中 waiver 登记；将来出现 `@ts-ignore`、显式 `any` 或临时分层穿透时，只能靠代码注释解释，无法发现过期例外和无主债务。

### P1：成熟工程约束散落在测试中

严格类型、LatestRequestGate、AbortController、焦点圈定、输入边界、Origin/路径防护、revision 冲突、浏览器门禁和 soak 已有测试，却未被编码规范统一描述。新贡献者必须从数十个测试反向猜规则，容易出现“测试能过，但不知道为什么”的维护风险。

### P1：完成定义没有按改动风险形成决策表

README 列出了 `check:fast`、`check:data`、`check:release`、`check:lifecycle`，但规范没有明确哪类改动必须跑哪组门禁，也没有说明不能把 skip 当作通过、何时必须做生产候选验证、何时只需本地构建。

### P1：UI、异步和错误处理缺少统一代码级要求

现有宪法只明确连续数值双输入。实际产品还依赖键盘语义、焦点恢复、移动端溢出、异步竞态淘汰、可取消请求、稳定错误码与 fail-closed 行为。这些是当前 GraphBrain 的真实质量边界，应从隐含实现提升为显式标准。

### P2：格式与可读性只有 TypeScript 编译器兜底

项目已有 `strict`、`noUnusedLocals` 和 `noUnusedParameters`，但没有说明导出契约、边界解析、显式 `any`、类型压制、注释、命名和无关格式化的处理原则。此轮不引入大规模 formatter，以避免对脏工作树做无意义机械重写；先治理高风险语义规则。

## 2. 目标标准

### S1：双层规范结构

- `AGENTS.md` 继续作为不可削弱的工程宪法，并追加最重要的编码要求。
- `docs/engineering-standard-v1.md` 成为完整、版本化的执行标准，包含规则 ID、适用矩阵、完成定义和退出路径。
- 原 11 条规则原文保留，避免一次规范迭代改变既有兼容语义。

### S2：集中、可过期的例外登记

新增 `config/engineering-standard-exceptions.json`，显式声明 `format_version: 1`。每条例外必须精确绑定规则、仓库相对路径与行号，并包含 owner、原因、跟踪项、批准日期和到期日。过期、重复、越界路径、未知规则或已无对应违规的例外都使门禁失败。

当前基线不需要例外，登记表为空。以后不得用散落注释代替登记。

### S3：机器门禁

新增 `engineering-standard-gate`，覆盖当前可可靠自动化的高风险规则：

1. 禁止未登记的 `@ts-ignore`、`@ts-nocheck`、`@ts-expect-error`。
2. 禁止未登记的显式 `any` 类型；外部输入先以 `unknown` 接收，再在边界解析。
3. 校验集中例外登记的版本、字段、日期、路径、唯一性、过期和实际命中。
4. 校验标准文档与宪法声明当前规范版本。
5. 接入 `check:fast`，让规范漂移和代码回归使用同一个日常入口。

不以正则强行判断“函数是否足够小”或“注释是否有价值”；这类不可可靠自动化的条款由评审与针对性测试治理。

### S4：修复分层门禁

把 Adapter 白名单从 basename 改为解析后的精确仓库路径，只允许：

- `adapters/adapter-interface.js`
- `adapters/diff-lib.js`
- `adapters/registry.js`

保留现有兼容策略：纯 type import 不形成运行时依赖，可通过；动态和副作用 import 仍属于运行时依赖。新增“具体 Adapter 中伪造同名文件仍失败”的回归测试。

### S5：风险驱动的完成定义

- 普通 TypeScript/文档契约变更：`check:fast`。
- Schema、迁移、Evidence、reading-context、publication：再运行 `check:data`，并验证旧 fixture、幂等、往返、冲突与回滚。
- Viewer/server/runtime/release 产物变更：`check:release`，浏览器 smoke 不得跳过。
- 订阅、计时器、图实例、缓存或工作区挂卸载变更：再运行 `check:lifecycle`。
- 生产激活是独立授权动作；门禁通过不自动等于部署。

## 3. 兼容、迁移与退出路径

- 此轮不改变产品数据格式、API、URL、UI 行为或生产 release；只增加工程治理文件、脚本和测试。
- 原 `layer-gate` CLI 名称和 `auditFiles(files)` 调用入口保留；只收紧白名单语义。
- `check:fast` 在原序列中增加标准门禁，其他脚本名称保持不变。
- 若门禁实现需要替换，保留规则 ID 和 exception schema，通过新实现读取同一登记表；不得把例外重新散回源码。
- 若某条新规则阻塞紧急修复，必须登记最小、限时例外，而不是删除门禁。例外到期必须失败，迫使续批或清理。

## 4. 实施步骤

1. 写入 `engineering-standard-v1.md`，定义规范语言、模块边界、类型、异步、错误、安全、UI、测试、发布和例外。
2. 在 `AGENTS.md` 追加规则 12–18，并声明规范版本与优先级。
3. 新增空的 v1 例外登记和标准门禁。
4. 修复精确 Adapter 边界，扩充 layer gate 回归测试。
5. 为标准门禁补正常、违规、有效例外、过期例外、陈旧例外和路径越界测试。
6. 接入 package scripts、README 和架构文档入口。
7. 运行新增测试、`check:fast`、`check:data`、生产构建与 bundle 边界；记录结果。

## 5. 验收标准

1. 规范有显式版本、稳定规则 ID、适用矩阵和变更/废止路径。
2. 三个 Adapter 放行项只能由精确路径命中，同名伪边界无法绕过。
3. 未登记的类型压制和显式 `any` 确定性失败。
4. 例外必须精确、限时、可追责；过期或陈旧例外确定性失败。
5. 当前代码基线无需例外即可通过。
6. `check:fast` 包含工程标准门禁，已有测试、Schema 与数据均不退化。
7. 文档明确每类改动的最低验证集，且构建、候选、激活三者不混为一谈。

## 6. 实施结果

状态：Completed（2026-08-13）。本轮只改变工程治理，不改变 GraphBrain 产品数据、API、Viewer 行为或 production revision 30，因此没有生成或激活新的 runtime release。

- 已新增 `docs/engineering-standard-v1.md`，以 `format_version: 1` 和稳定规则 ID 覆盖架构、类型、边界、异步、资源、错误、安全、UI、测试、变更、发布与例外。
- 已在 `AGENTS.md` 保留原 11 条宪法并追加 12–18 条实施要求；README、USAGE、architecture 和 CLAUDE 入口已同步。
- 已新增 `config/engineering-standard-exceptions.json`。当前登记为 0；门禁会拒绝过期、重复、越界、未知或陈旧例外。
- 已新增基于 TypeScript AST 的 `engineering-standard-gate`，扫描生产、工具和测试代码；浏览器 CDP 基础设施的 6 处显式 `any` 已改为 `unknown` + 泛型边界，没有用例外掩盖。
- `layer-gate` 已从 basename 白名单收紧为三个精确仓库路径；具体 Adapter 中伪造同名 `registry.js` 的绕过路径已有失败回归测试。
- `check:fast` 已把工程标准门禁放在分层、类型、测试和 Schema 校验之前。

验证证据：

- 工程标准门禁：296 个源码文件、0 个例外通过。
- 专项测试：12/12 通过；完整快速门禁：295/295 测试通过。
- 数据/协议门禁：30/30 通过；Evidence freshness 为 `current`，consumer gate allowed。
- 生产构建：132 个模块；bundle 边界通过，初始 JS 89.6 KiB gzip、CSS 33.3 KiB gzip。
