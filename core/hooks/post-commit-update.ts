// GraphBrain post-commit updater.
// This hook owns only UE code fact refresh and annotation staleness.
// It must never create plans, design artifacts, cross-domain links, or review reports.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	loadEvidenceRefreshConfig,
	evidenceRefreshLockPath,
	refreshProjectEvidence,
	resolveEvidenceRefreshProject,
} from "../evidence/refresh.js";
import { latestGraphFile } from "../annotation/staleness.js";
import { assessAndRecordCycles } from "../query/arch-baseline.js";
import { HOOKS_ROOT as ROOT, log, runTsx } from "./hook-lib.js";
import { recordLocalUsage } from "../usage/local-usage.js";

const LOCK_PATH = evidenceRefreshLockPath(ROOT);

function optionValue(argv: string[], name: string): string | null {
	const index = argv.indexOf(name);
	return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

async function main(): Promise<void> {
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
	const config = loadEvidenceRefreshConfig(configPath);
	let project;
	try {
		project = resolveEvidenceRefreshProject(config, projectArg);
	} catch {
		log(`仓库 ${projectArg} 未注册于 ${configPath}，跳过`);
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

	const startedAt = Date.now();
	const result = await refreshProjectEvidence({
		project,
		lockPath: LOCK_PATH,
		triggerFiles: files,
		runStep: (script, args) => runTsx(script, args),
		onEvent: log,
	});
	try { recordLocalUsage(ROOT, "evidence.refresh", { durationMs: Date.now() - startedAt, cacheHit: null }); }
	catch (error) { log(`本地 refresh 使用摘要写入失败: ${String(error)}`); }
	if (result.status === "skipped") log(`${project.name}: 没有声明的代码输入变更，跳过`);
	else if (result.status === "busy") {
		log(`${project.name}: 已有证据刷新正在执行，本次跳过`);
		// busy 表示刷新根本没有发生：必须以非零退出让 lore-watcher 保留基线下轮重试；
		// 若返回 0，watcher 会推进基线，新旧基线之间的修订将被永久跳过提取。
		process.exitCode = 1;
	}
	else if (result.status === "failed") {
		log(`${project.name}: ${result.stage} 阶段失败（exit ${result.exit_code}），publication 保持原活动 generation`);
		process.exitCode = 1;
	}
	else {
		log(`${project.name}: 事实刷新与标注扫描全部完成`);
		runCycleGate(project.subsystem);
	}
}

/** A3 回路基线门禁：新增依赖回路以 WARN 记录并推进基线；任何失败只记日志，
 *  绝不把用户的提交/刷新变成失败（告警防线的定位）。 */
function runCycleGate(subsystem: string): void {
	try {
		const graphFile = latestGraphFile("ue5_code", subsystem);
		if (!graphFile) {
			log(`回路门禁跳过：${subsystem} 没有活动图`);
			return;
		}
		const graphPath = join(ROOT, "data", "graphs", graphFile);
		if (!existsSync(graphPath)) {
			log(`回路门禁跳过：活动图文件不存在（${graphFile}）`);
			return;
		}
		const graph: unknown = JSON.parse(readFileSync(graphPath, "utf8").replace(/^\uFEFF/, ""));
		const update = assessAndRecordCycles({ root: ROOT, subsystem, graph });
		for (const warning of update.warnings) log(`WARN ${subsystem}: ${warning}`);
		if (update.added.length === 0 && update.removed.length > 0) {
			log(`${subsystem}: 回路基线已推进（消除 ${update.removed.length} 条旧回路）`);
		}
	} catch (error) {
		log(`回路门禁跳过：${(error as Error).message}`);
	}
}
try {
	await main();
} catch (error) {
	// Repository hooks must not block the user's commit path.
	log(`代码事实更新异常: ${(error as Error).stack ?? error}`);
	process.exitCode = 1;
}
