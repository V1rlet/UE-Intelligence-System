import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { withFileLockAsync } from "../store/file-lock.js";

export interface EvidenceRefreshProject {
	name: string;
	root: string;
	vcs: string;
	domain: "ue5_code";
	subsystem: string;
	trigger_extensions: string[];
	extract: { roots: string[]; out: string; uproject?: string; cache?: string };
	scan_annotations?: boolean;
}

export interface EvidenceRefreshConfig {
	projects: EvidenceRefreshProject[];
}

export type EvidenceRefreshResult =
	| { status: "refreshed"; project: string; matched_files: number | null }
	| { status: "skipped"; project: string; reason: "no-triggering-files"; matched_files: 0 }
	| { status: "busy"; project: string; reason: "refresh-in-progress"; matched_files: number | null }
	| { status: "failed"; project: string; stage: "extract" | "annotations"; exit_code: number; matched_files: number | null };

/** 同步返回退出码，或异步解析退出码（服务端处理器必须用异步形态，避免 spawnSync 冻结事件循环）。 */
export type EvidenceRefreshStep = (script: string, args: string[]) => number | Promise<number>;

/** Retain the pre-Evidence-v1 hook lock name so old and new launchers stay mutually exclusive. */
export function evidenceRefreshLockPath(root: string): string {
	return join(resolve(root), "logs", "hook.lock");
}

export function loadEvidenceRefreshConfig(path: string): EvidenceRefreshConfig {
	const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as Partial<EvidenceRefreshConfig>;
	if (!Array.isArray(parsed.projects)) throw new Error("evidence refresh config must contain projects");
	for (const project of parsed.projects) {
		if (!project || project.domain !== "ue5_code"
			|| typeof project.name !== "string" || !project.name
			|| typeof project.root !== "string" || !project.root
			|| typeof project.vcs !== "string" || !project.vcs
			|| typeof project.subsystem !== "string" || !project.subsystem
			|| !Array.isArray(project.trigger_extensions)
			|| !Array.isArray(project.extract?.roots) || typeof project.extract.out !== "string" || !project.extract.out
			|| (project.extract.uproject !== undefined && typeof project.extract.uproject !== "string")
			|| (project.extract.cache !== undefined && typeof project.extract.cache !== "string")
			|| (project.scan_annotations !== undefined && typeof project.scan_annotations !== "boolean")) {
			throw new Error("invalid evidence refresh project declaration");
		}
	}
	return parsed as EvidenceRefreshConfig;
}

function normalized(value: string): string {
	return resolve(value).replaceAll("\\", "/").toLowerCase();
}

export function resolveEvidenceRefreshProject(config: EvidenceRefreshConfig, identity?: string | null): EvidenceRefreshProject {
	if (!identity && config.projects.length === 1) return config.projects[0];
	const project = config.projects.find((item) =>
		item.name.toLowerCase() === identity?.toLowerCase() || normalized(item.root) === normalized(identity ?? ""));
	if (!project) throw new Error(identity ? `unknown evidence refresh project: ${identity}` : "evidence refresh project must be selected");
	return project;
}

export async function refreshProjectEvidence(input: {
	project: EvidenceRefreshProject;
	lockPath: string;
	runStep: EvidenceRefreshStep;
	triggerFiles?: string[] | null;
	onEvent?: (message: string) => void;
}): Promise<EvidenceRefreshResult> {
	const files = input.triggerFiles ?? null;
	const extensions = input.project.trigger_extensions.map((extension) => extension.toLowerCase());
	const matched = files?.filter((file) => extensions.some((extension) => file.toLowerCase().endsWith(extension))) ?? null;
	if (matched && matched.length === 0) {
		return { status: "skipped", project: input.project.name, reason: "no-triggering-files", matched_files: 0 };
	}
	const result = await withFileLockAsync(input.lockPath, async () => {
		const extractArgs = [
			...input.project.extract.roots,
			"--subsystem", input.project.subsystem,
			"--out", input.project.extract.out,
			"--incremental",
		];
		if (input.project.extract.uproject) extractArgs.push("--uproject", input.project.extract.uproject);
		if (input.project.extract.cache) extractArgs.push("--cache", input.project.extract.cache);
		input.onEvent?.(`${input.project.name}: refreshing ue5_code/${input.project.subsystem}`);
		const extractCode = await input.runStep("adapters/ue5-code/extract-classes.ts", extractArgs);
		if (extractCode !== 0) {
			return { status: "failed", project: input.project.name, stage: "extract", exit_code: extractCode, matched_files: matched?.length ?? null } as const;
		}
		if (input.project.scan_annotations !== false) {
			const scanCode = await input.runStep("core/annotation/scan-stale.ts", ["ue5_code", input.project.subsystem]);
			if (scanCode !== 0) {
				return { status: "failed", project: input.project.name, stage: "annotations", exit_code: scanCode, matched_files: matched?.length ?? null } as const;
			}
		}
		return { status: "refreshed", project: input.project.name, matched_files: matched?.length ?? null } as const;
	}, {
		// 两个步骤（extract + scan）各自允许运行至 10 分钟（runStep 超时），锁的陈旧
		// 阈值必须大于最坏总时长（20 分钟），否则一次合法的全量提取会在中途被并发
		// 触发者"恢复"，导致两个提取器同时写同一 out/cache。
		staleMs: 25 * 60 * 1000,
		busy: "skip",
		onRecover: (reason) => input.onEvent?.(`${input.project.name}: recovered stale refresh lock (${reason})`),
	});
	return result ?? { status: "busy", project: input.project.name, reason: "refresh-in-progress", matched_files: matched?.length ?? null };
}
