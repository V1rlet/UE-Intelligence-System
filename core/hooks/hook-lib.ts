// Graph Brain / core/hooks - hook 公共设施：日志（stdout + logs/hook.log 双写）与子进程调用
//
// post-commit-update.ts（runner）与 lore-watcher.ts 共用。日志失败不致命——
// hook 链路的一切设施都必须比"用户的提交/常驻服务"更卑微。

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOOKS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TSX_CLI = join(HOOKS_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
export const HOOK_LOG_PATH = join(HOOKS_ROOT, "logs", "hook.log");

/** 超过阈值滚动为 hook.log.1（覆盖旧归档）；常驻服务多日不重启也不至于无界增长 */
const MAX_LOG_BYTES = 1024 * 1024;

function rotateIfOversized(): void {
	try {
		if (statSync(HOOK_LOG_PATH).size > MAX_LOG_BYTES) {
			renameSync(HOOK_LOG_PATH, HOOK_LOG_PATH + ".1");
		}
	} catch {
		/* 不存在或被占用都不致命 */
	}
}

export function log(line: string): void {
	const stamped = `[${new Date().toISOString()}] ${line}`;
	console.log(stamped);
	try {
		mkdirSync(dirname(HOOK_LOG_PATH), { recursive: true });
		rotateIfOversized();
		appendFileSync(HOOK_LOG_PATH, stamped + "\n", "utf-8");
	} catch {
		/* 日志不可写也不致命 */
	}
}

/** 子进程整段输出缩进后进日志 */
export function logBlock(text: string): void {
	const body = text.trimEnd();
	if (body) log("  | " + body.split(/\r?\n/).join("\n  | "));
}

/** 在仓库根下用 tsx 跑一个本仓库脚本，返回退出码。
 *  echo="on-error"：目标脚本自己写 hook.log（如 runner）时只在失败时回显，免得整块重复 */
export function runTsx(script: string, args: string[], echo: "always" | "on-error" = "always"): number {
	const r = spawnSync(process.execPath, [TSX_CLI, script, ...args], {
		cwd: HOOKS_ROOT,
		encoding: "utf-8",
		timeout: 10 * 60 * 1000,
	});
	const status = r.status ?? 1;
	if (echo === "always" || status !== 0 || r.error) logBlock((r.stdout ?? "") + (r.stderr ?? ""));
	if (r.error) log(`  ! 子进程启动失败: ${r.error.message}`);
	return status;
}

/** 跑 lore CLI（--repository 显式指定，不依赖 cwd）；失败返回 null。
 *  exe 需可解析：常驻服务（NSSM/SYSTEM 账户）的 PATH 不含用户目录，
 *  由 hook-projects.json 的 lore_exe（或 GRAPH_BRAIN_LORE_EXE 环境变量）给绝对路径。 */
export function runLore(repository: string, args: string[], exe?: string): string | null {
	const loreExe = exe ?? process.env.GRAPH_BRAIN_LORE_EXE ?? "lore";
	const r = spawnSync(loreExe, ["--repository", repository, "-P", ...args], {
		encoding: "utf-8",
		timeout: 60 * 1000,
	});
	if (r.error || r.status !== 0) {
		const detail = r.error?.message ?? `exit ${r.status}: ${(r.stderr ?? "").trim() || "(无输出)"}`;
		log(`  ! lore ${args.join(" ")} 失败: ${detail}`);
		return null;
	}
	return r.stdout ?? "";
}
