// Graph Brain / scripts - E3 架构回路门禁（依赖 A3 基线）
//
// 只读比较当前活动图与 data/architecture-baseline.json：
//   - 出现基线外的新增回路 → 列出并以退出码 1 失败；
//   - --update-baseline 时把当前回路集写为新基线（显式 opt-in，供"有意重构后重定基线"）。
// 与 hook 的 WARN 防线互补：hook 是提交时告警，本门禁可接入 CI/check 链做硬失败。
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { latestGraphFile } from "../core/annotation/staleness.js";
import {
	architectureBaselinePath,
	assessCycles,
	writeBaselineDocument,
} from "../core/query/arch-baseline.js";

const require = createRequire(import.meta.url);
const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", ".."));

function option(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const root = resolve(option("--root") ?? ROOT);
const subsystem = option("--subsystem") ?? "project";
const updateBaseline = process.argv.includes("--update-baseline");

let graphPath = option("--graph");
if (!graphPath) {
	const current = latestGraphFile("ue5_code", subsystem);
	if (!current) {
		console.error(`[gate:arch] ${subsystem} 没有活动图，无法评估回路`);
		process.exit(2);
	}
	graphPath = join(root, "data", "graphs", current);
}
if (!existsSync(graphPath)) {
	console.error(`[gate:arch] 图文件不存在：${graphPath}`);
	process.exit(2);
}

const graph: unknown = JSON.parse(readFileSync(graphPath, "utf8").replace(/^\uFEFF/, ""));
const assessment = assessCycles({ root, subsystem, graph });

for (const warning of assessment.warnings) console.error(`[gate:arch] FAIL ${warning}`);
for (const cycle of assessment.removed) {
	console.log(`[gate:arch] 基线中的回路已消失（可在 --update-baseline 后收敛）：${cycle.nodes.join(" -> ")}`);
}
console.log(`[gate:arch] 当前回路 ${assessment.current.length} 条；新增 ${assessment.added.length}；消失 ${assessment.removed.length}。基线：${assessment.baselinePath}`);

// --update-baseline 必须先于失败判定：显式重定基线 = 接受当前回路集（含既有回路）。
if (updateBaseline) {
	writeBaselineDocument(architectureBaselinePath(root), subsystem, assessment.current);
	console.log(`[gate:arch] 已按当前图重定基线（${assessment.current.length} 条回路）。显式重定基线视为接受现状。`);
	process.exit(0);
}

if (assessment.added.length > 0) {
	console.error(`[gate:arch] 门禁失败：出现 ${assessment.added.length} 条基线外新增回路。修复依赖方向，或确认架构调整后运行 --update-baseline 重定基线。`);
	process.exit(1);
}
process.exit(0);
