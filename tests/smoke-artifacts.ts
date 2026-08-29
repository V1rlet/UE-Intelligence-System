import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SMOKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SMOKE_RUNS_DIRECTORY = resolve(SMOKE_ROOT, "logs", "runs");
export const SMOKE_GOLDEN_DIRECTORY = resolve(SMOKE_ROOT, "logs", "smoke");

function isWithin(parent: string, candidate: string): boolean {
	const child = relative(parent, candidate);
	return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

export function smokeRunId(suite: string, now = new Date(), pid = process.pid): string {
	const safeSuite = suite.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "smoke";
	const timestamp = now.toISOString().replace(/[:.]/g, "-");
	return `${timestamp}-${pid}-${safeSuite}`;
}

export function resolveSmokeOutputDirectory(suite = "smoke"): string {
	const configured = process.env.GB_SMOKE_OUTPUT_DIR?.trim();
	const output = configured
		? resolve(SMOKE_ROOT, configured)
		: resolve(SMOKE_RUNS_DIRECTORY, smokeRunId(suite));
	if (output === SMOKE_GOLDEN_DIRECTORY) {
		if (process.env.GB_SMOKE_UPDATE_GOLDEN !== "1") {
			throw new Error("拒绝覆盖 smoke 基准：请使用 npm run smoke:update-golden -- --confirm");
		}
		return output;
	}
	if (!isWithin(SMOKE_RUNS_DIRECTORY, output)) {
		throw new Error(`GB_SMOKE_OUTPUT_DIR 必须位于 ${SMOKE_RUNS_DIRECTORY}`);
	}
	return output;
}
