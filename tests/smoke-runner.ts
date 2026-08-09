// Graph Brain / tests - smoke 聚合门禁（npm run smoke，check 链末端）
// 串行执行无头 Chrome 门禁：视觉、交互、冷启动资源、动效与启动故障恢复；任一失败整体失败并指名。
// 前置条件：dev server 3030 在线 + 本机 Chrome（与各 smoke 脚本要求一致）。
// 无浏览器/无服务环境的显式逃生口：GB_SMOKE_SKIP=1（跳过是 opt-out，绝不静默假绿）。

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const SMOKES = [
	"tests/visual-smoke.ts",
	"tests/interface-readability-smoke.ts",
	"tests/runtime-health-smoke.ts",
	"tests/change-scale-smoke.ts",
	"tests/interactive-smoke.ts",
	"tests/resource-budget-smoke.ts",
	"tests/production-route-budget-smoke.ts",
	"tests/motion-smoke.ts",
	"tests/bootstrap-recovery-smoke.ts",
];

if (process.env.GB_SMOKE_SKIP === "1") {
	console.log("[smoke] GB_SMOKE_SKIP=1：跳过浏览器冒烟（显式 opt-out）");
	process.exit(0);
}

const failed: string[] = [];
for (const script of SMOKES) {
	const r = spawnSync(process.execPath, [TSX_CLI, script], {
		cwd: ROOT,
		stdio: "inherit",
		timeout: 10 * 60 * 1000,
	});
	if (r.status !== 0) failed.push(script);
}

if (failed.length > 0) {
	console.error(`\n[smoke] 失败 ${failed.length}/${SMOKES.length}：${failed.join(", ")}`);
	process.exit(1);
}
console.log(`[smoke] 全部通过（${SMOKES.length} 项）`);
