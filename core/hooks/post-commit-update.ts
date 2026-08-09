// GraphBrain post-commit updater.
// This hook owns only UE code fact refresh and annotation staleness.
// It must never create plans, design artifacts, cross-domain links, or review reports.

import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { withFileLock } from "../store/file-lock.js";
import { HOOKS_ROOT as ROOT, log, runTsx } from "./hook-lib.js";

const LOCK_PATH = join(ROOT, "logs", "hook.lock");
const LOCK_STALE_MS = 10 * 60 * 1000;

interface HookProject {
	name: string;
	root: string;
	vcs: string;
	domain: "ue5_code";
	subsystem: string;
	trigger_extensions: string[];
	extract: { roots: string[]; out: string; uproject?: string; cache?: string };
	scan_annotations?: boolean;
}

function normPath(path: string): string {
	return resolve(path).replaceAll("\\", "/").toLowerCase();
}

function optionValue(argv: string[], name: string): string | null {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function main(): void {
	const argv = process.argv.slice(2);
	const projectArg = optionValue(argv, "--project");
	const filesArg = optionValue(argv, "--files");
	const filesFrom = optionValue(argv, "--files-from");
	const configArg = optionValue(argv, "--config");
	if (!projectArg) {
		log("缺少 --project <仓库根路径>，跳过代码事实更新");
		return;
	}

	const configPath = resolve(ROOT, configArg ?? "core/hooks/hook-projects.json");
	const config = JSON.parse(readFileSync(configPath, "utf-8").replace(/^\uFEFF/, "")) as {
		projects: HookProject[];
	};
	const project = config.projects.find((item) => normPath(item.root) === normPath(projectArg));
	if (!project) {
		log(`仓库 ${projectArg} 未注册于 ${configPath}，跳过`);
		return;
	}
	if (project.domain !== "ue5_code") {
		log(`${project.name}: 已拒绝非 ue5_code 的 hook 配置`);
		return;
	}

	let files: string[] | null = null;
	if (filesFrom) {
		try {
			files = readFileSync(filesFrom, "utf-8").split(/\r?\n/).filter(Boolean);
		} finally {
			try { rmSync(filesFrom, { force: true }); } catch { /* 临时清单清理失败不阻断提交 */ }
		}
	} else if (filesArg) {
		files = filesArg.split(",").filter(Boolean);
	}

	if (files) {
		const extensions = project.trigger_extensions.map((extension) => extension.toLowerCase());
		const hits = files.filter((file) => extensions.some((extension) => file.toLowerCase().endsWith(extension)));
		if (hits.length === 0) {
			log(`${project.name}: 没有 ${extensions.join("/")} 变更，跳过`);
			return;
		}
		log(`${project.name}: ${hits.length}/${files.length} 个代码文件触发事实更新`);
	}

	const executed = withFileLock(LOCK_PATH, () => {
		const extractArgs = [
			...project.extract.roots,
			"--subsystem", project.subsystem,
			"--out", project.extract.out,
			"--incremental",
		];
		if (project.extract.uproject) extractArgs.push("--uproject", project.extract.uproject);
		if (project.extract.cache) extractArgs.push("--cache", project.extract.cache);

		log(`${project.name}: 更新 ue5_code/${project.subsystem} 事实图`);
		const extractCode = runTsx("adapters/ue5-code/extract-classes.ts", extractArgs);
		if (extractCode !== 0) {
			// 三态之一：事实发布失败（watcher 据此不推进基线，下轮重试）。
			log(`${project.name}: 事实发布失败（exit ${extractCode}）；标注陈旧扫描跳过，下次提交重试`);
			process.exitCode = 1;
			return;
		}
		log(`${project.name}: 代码事实更新完成`);

		if (project.scan_annotations !== false) {
			const scanCode = runTsx("core/annotation/scan-stale.ts", ["ue5_code", project.subsystem]);
			if (scanCode !== 0) {
				// 三态之二：事实已发布，但 stale 扫描失败/冲突，等待下次触发。
				log(`${project.name}: 代码事实已发布；标注陈旧扫描失败或冲突（exit ${scanCode}），下次提交重试`);
				process.exitCode = 1;
				return;
			}
			log(`${project.name}: 标注陈旧度扫描完成`);
		}
		// 三态之三：完全成功。
		log(`${project.name}: 事实更新与标注扫描全部完成`);
	}, {
		staleMs: LOCK_STALE_MS,
		busy: "skip",
		onRecover: (reason) => log(`清理超过 ${LOCK_STALE_MS / 1000} 秒的陈旧 hook 锁（${reason}）`),
	});
	if (executed === null) {
		log(`${project.name}: 已有更新正在执行，本次跳过`);
	}
}

try {
	main();
} catch (error) {
	// Repository hooks must not block the user's commit path.
	log(`代码事实更新异常: ${(error as Error).stack ?? error}`);
	process.exitCode = 1;
}
