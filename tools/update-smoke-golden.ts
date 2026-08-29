import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = resolve(ROOT, "logs", "smoke");
const RUNS = resolve(ROOT, "logs", "runs");
const TSX = resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function fail(message: string): never {
	console.error(`[smoke-golden] ${message}`);
	process.exit(2);
}

function requireConfirmation(): void {
	if (!process.argv.includes("--confirm")) {
		fail("这是显式基准更新操作；请运行 npm run smoke:update-golden -- --confirm");
	}
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function assertBackupPath(value: string): string {
	const path = resolve(RUNS, value);
	const child = relative(RUNS, path);
	if (child === "" || child === ".." || child.startsWith(`..${sep}`) || !basename(path).startsWith("golden-backup-")) {
		fail("回滚目标必须是 logs/runs/golden-backup-* 下的备份目录");
	}
	if (!existsSync(path)) fail(`备份不存在：${path}`);
	return path;
}

function restoreBackup(value: string): void {
	requireConfirmation();
	const backup = assertBackupPath(value);
	const displaced = resolve(RUNS, `golden-displaced-${timestamp()}`);
	mkdirSync(RUNS, { recursive: true });
	if (existsSync(GOLDEN)) renameSync(GOLDEN, displaced);
	cpSync(backup, GOLDEN, { recursive: true, errorOnExist: true });
	console.log(`[smoke-golden] 已从 ${backup} 恢复；被替换内容保存在 ${displaced}`);
}

const restoreAt = process.argv.indexOf("--restore");
if (restoreAt >= 0) {
	const value = process.argv[restoreAt + 1];
	if (!value) fail("--restore 后必须提供 golden-backup-* 目录名或路径");
	restoreBackup(value);
	process.exit(0);
}

requireConfirmation();
mkdirSync(RUNS, { recursive: true });
const backup = resolve(RUNS, `golden-backup-${timestamp()}`);
if (existsSync(GOLDEN)) cpSync(GOLDEN, backup, { recursive: true, errorOnExist: true });
else mkdirSync(backup, { recursive: true });
console.log(`[smoke-golden] 回滚点：${backup}`);

const smoke = spawnSync(process.execPath, [TSX, "tests/smoke-runner.ts"], {
	cwd: ROOT,
	stdio: "inherit",
	windowsHide: true,
	env: { ...process.env, GB_SMOKE_OUTPUT_DIR: GOLDEN, GB_SMOKE_UPDATE_GOLDEN: "1" },
});
if (smoke.status !== 0) {
	console.error(`[smoke-golden] 更新失败；基准可能部分变化。回滚：npm run smoke:update-golden -- --restore ${basename(backup)} --confirm`);
	process.exit(smoke.status ?? 1);
}

const diff = spawnSync("git", ["diff", "--name-status", "--", "logs/smoke"], {
	cwd: ROOT,
	encoding: "utf8",
	windowsHide: true,
});
console.log("[smoke-golden] 基准差异：");
console.log(diff.stdout.trim() || "（与已跟踪基准无差异）");
console.log(`[smoke-golden] 如需回滚：npm run smoke:update-golden -- --restore ${basename(backup)} --confirm`);
