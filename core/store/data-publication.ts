// Atomic publication boundary for generated UE code facts.
//
// Graph and change-report payloads are immutable, content-addressed files. A
// single versioned state file publishes a mutually consistent generation.
// Legacy, non-content-addressed artifacts remain readable through the one
// compatibility boundary in this module; they are never guessed into state.
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { withFileLock } from "./file-lock.js";
import { renameDurableSync, writeFsyncedTemporary } from "./durable-write.js";
import { loadEvidencePublicationState } from "./evidence-publication.js";

export const DATA_PUBLICATION_FORMAT_VERSION = 1 as const;
export const MANAGED_GRAPH_PATTERN = /^ue5_code_[A-Za-z0-9_-]+__gbtx-[a-f0-9]{16}\.cyto\.json$/;
export const MANAGED_CHANGE_PATTERN = /^ue5_code_[A-Za-z0-9_-]+__gbtx-[a-f0-9]{16}\.change\.json$/;

export interface PublishedArtifact {
	file: string;
	sha256: string;
}

export interface PublishedGeneration {
	id: string;
	published_at: string;
	graph: PublishedArtifact;
	change_report: PublishedArtifact | null;
}

export interface SubsystemPublication {
	subsystem: string;
	generations: PublishedGeneration[];
}

export interface DataPublicationState {
	format_version: typeof DATA_PUBLICATION_FORMAT_VERSION;
	domain: "ue5_code";
	revision: number;
	updated_at: string;
	publications: SubsystemPublication[];
}

export interface PublicationDirectories {
	graphs: string;
	changes: string;
	publications: string;
}

export interface CurrentGraphArtifact extends PublishedArtifact {
	path: string;
	source: "publication-v1" | "legacy-catalog";
}

export class DataPublicationConflictError extends Error {
	readonly code = "DATA_PUBLICATION_CONFLICT";
	constructor(readonly expectedRevision: number, readonly current: DataPublicationState) {
		super(`data publication changed: expected revision ${expectedRevision}, current revision ${current.revision}`);
	}
}

export function publicationDirectories(dataDir: string): PublicationDirectories {
	const root = resolve(dataDir);
	return {
		graphs: join(root, "graphs"),
		changes: join(root, "changes"),
		publications: join(root, "publications"),
	};
}

export function emptyDataPublicationState(): DataPublicationState {
	return {
		format_version: DATA_PUBLICATION_FORMAT_VERSION,
		domain: "ue5_code",
		revision: 0,
		updated_at: "1970-01-01T00:00:00.000Z",
		publications: [],
	};
}

export function dataPublicationStatePath(publicationsDirectory: string): string {
	return join(resolve(publicationsDirectory), "ue5_code.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeFileName(file: unknown, suffix: string): file is string {
	return typeof file === "string" && file === basename(file) && file.endsWith(suffix) && file.length <= 240;
}

function isArtifact(value: unknown, suffix: string): value is PublishedArtifact {
	return isRecord(value)
		&& isSafeFileName(value.file, suffix)
		&& typeof value.sha256 === "string"
		&& /^[a-f0-9]{64}$/.test(value.sha256);
}

export function validateDataPublicationState(value: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(value)) return ["publication state must be an object"];
	if (value.format_version !== DATA_PUBLICATION_FORMAT_VERSION) errors.push("unsupported publication format_version");
	if (value.domain !== "ue5_code") errors.push("publication domain must be ue5_code");
	if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) errors.push("publication revision must be a non-negative integer");
	if (typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) errors.push("publication updated_at must be an ISO timestamp");
	if (!Array.isArray(value.publications)) return [...errors, "publication entries must be an array"];

	const subsystems = new Set<string>();
	const generationIds = new Set<string>();
	for (const [publicationIndex, publication] of value.publications.entries()) {
		if (!isRecord(publication)) {
			errors.push(`publications[${publicationIndex}] must be an object`);
			continue;
		}
		if (typeof publication.subsystem !== "string" || !/^[A-Za-z0-9_-]+$/.test(publication.subsystem)) {
			errors.push(`publications[${publicationIndex}].subsystem is invalid`);
		} else if (subsystems.has(publication.subsystem)) {
			errors.push(`duplicate publication subsystem: ${publication.subsystem}`);
		} else subsystems.add(publication.subsystem);
		if (!Array.isArray(publication.generations) || publication.generations.length === 0) {
			errors.push(`publications[${publicationIndex}].generations must not be empty`);
			continue;
		}
		for (const [generationIndex, generation] of publication.generations.entries()) {
			if (!isRecord(generation)) {
				errors.push(`publications[${publicationIndex}].generations[${generationIndex}] must be an object`);
				continue;
			}
			if (typeof generation.id !== "string" || !/^generation-[a-f0-9]{64}$/.test(generation.id)) {
				errors.push(`publications[${publicationIndex}].generations[${generationIndex}].id is invalid`);
			} else if (generationIds.has(generation.id)) {
				errors.push(`duplicate publication generation: ${generation.id}`);
			} else generationIds.add(generation.id);
			if (typeof generation.published_at !== "string" || !Number.isFinite(Date.parse(generation.published_at))) {
				errors.push(`publications[${publicationIndex}].generations[${generationIndex}].published_at is invalid`);
			}
			if (!isArtifact(generation.graph, ".cyto.json")) {
				errors.push(`publications[${publicationIndex}].generations[${generationIndex}].graph is invalid`);
			}
			if (generation.change_report !== null && !isArtifact(generation.change_report, ".change.json")) {
				errors.push(`publications[${publicationIndex}].generations[${generationIndex}].change_report is invalid`);
			}
		}
	}
	return errors;
}

export function loadDataPublicationState(publicationsDirectory: string): DataPublicationState {
	const path = dataPublicationStatePath(publicationsDirectory);
	if (!existsSync(path)) return emptyDataPublicationState();
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		// 损坏的 state 必须带文件路径抛出，否则现场只看到裸 SyntaxError 无法定位。
		throw new Error(`invalid JSON in data publication state (${path}): ${(error as Error).message}`);
	}
	const errors = validateDataPublicationState(value);
	if (errors.length > 0) throw new Error(`invalid data publication state: ${errors.join("; ")}`);
	return value as DataPublicationState;
}

export function sha256(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

export function managedArtifactName(subsystem: string, hash: string, kind: "graph" | "change_report"): string {
	if (!/^[A-Za-z0-9_-]+$/.test(subsystem)) throw new Error(`invalid publication subsystem: ${subsystem}`);
	const suffix = kind === "graph" ? ".cyto.json" : ".change.json";
	return `ue5_code_${subsystem}__gbtx-${hash.slice(0, 16)}${suffix}`;
}

function atomicWriteJson(path: string, value: unknown): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFsyncedTemporary(temporary, `${JSON.stringify(value, null, 2)}\n`);
		renameDurableSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

interface PublicationLockRecord {
	pid: number;
	started_at: string;
}

function parsePublicationLock(content: string): PublicationLockRecord | null {
	try {
		const value = JSON.parse(content) as Partial<PublicationLockRecord>;
		return Number.isSafeInteger(value.pid) && typeof value.started_at === "string"
			? { pid: Number(value.pid), started_at: value.started_at }
			: null;
	} catch {
		return null;
	}
}

function serializePublicationLock(record: PublicationLockRecord): string {
	return `${JSON.stringify(record)}\n`;
}

function publicationLockPath(publicationsDirectory: string): string {
	return join(resolve(publicationsDirectory), ".write.lock");
}

function withPublicationLock<T>(publicationsDirectory: string, action: () => T): T {
	const result = withFileLock(publicationLockPath(publicationsDirectory), action, {
		parse: parsePublicationLock,
		serialize: serializePublicationLock,
		busyMessage: (lockPath) => `data publication is locked (${lockPath})`,
		onRecover: (reason) => console.warn(`[data-publication] recovered stale write lock (${reason})`),
	});
	if (result === null) throw new Error(`data publication is locked (${publicationLockPath(publicationsDirectory)})`);
	return result;
}

function writeImmutable(directory: string, file: string, content: string, expectedHash: string): boolean {
	mkdirSync(directory, { recursive: true });
	const destination = join(directory, file);
	if (existsSync(destination)) {
		const actual = sha256(readFileSync(destination));
		if (actual !== expectedHash) throw new Error(`content-addressed artifact collision: ${file}`);
		return false;
	}
	const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFsyncedTemporary(temporary, content);
		if (sha256(readFileSync(temporary)) !== expectedHash) throw new Error(`staged artifact hash mismatch: ${file}`);
		renameDurableSync(temporary, destination);
		return true;
	} finally {
		rmSync(temporary, { force: true });
	}
}

function referencedFiles(state: DataPublicationState, kind: "graph" | "change_report"): Set<string> {
	const result = new Set<string>();
	for (const publication of state.publications) {
		for (const generation of publication.generations) {
			const artifact = kind === "graph" ? generation.graph : generation.change_report;
			if (artifact) result.add(artifact.file);
		}
	}
	return result;
}

export function visiblePublishedFiles(
	directory: string,
	publicationsDirectory: string,
	kind: "graph" | "change_report",
): string[] {
	if (!existsSync(directory)) return [];
	const state = loadDataPublicationState(publicationsDirectory);
	const published = referencedFiles(state, kind);
	const managedPattern = kind === "graph" ? MANAGED_GRAPH_PATTERN : MANAGED_CHANGE_PATTERN;
	const suffix = kind === "graph" ? ".cyto.json" : ".change.json";
	return readdirSync(directory)
		.filter((file) => file.endsWith(suffix))
		.filter((file) => !managedPattern.test(file) || published.has(file));
}

export function isPublishedArtifactVisible(
	file: string,
	publicationsDirectory: string,
	kind: "graph" | "change_report",
): boolean {
	const managedPattern = kind === "graph" ? MANAGED_GRAPH_PATTERN : MANAGED_CHANGE_PATTERN;
	if (!managedPattern.test(file)) return true;
	return referencedFiles(loadDataPublicationState(publicationsDirectory), kind).has(file);
}

export function currentPublishedGeneration(
	publicationsDirectory: string,
	subsystem: string,
): PublishedGeneration | null {
	return loadDataPublicationState(publicationsDirectory).publications
		.find((publication) => publication.subsystem === subsystem)?.generations[0] ?? null;
}

function legacyGraphCandidates(graphsDirectory: string, publicationsDirectory: string, subsystem: string) {
	return visiblePublishedFiles(graphsDirectory, publicationsDirectory, "graph").flatMap((file) => {
		try {
			const path = join(graphsDirectory, file);
			const content = readFileSync(path, "utf8");
			const graph = JSON.parse(content.replace(/^\uFEFF/, "")) as { meta?: Record<string, unknown> };
			if (graph.meta?.domain !== "ue5_code" || graph.meta?.subsystem !== subsystem) return [];
			const generatedAt = typeof graph.meta.generated_at === "string" ? graph.meta.generated_at : "";
			return [{ file, path, content, generatedAt }];
		} catch {
			return [];
		}
	});
}

/** Current generation first; old directories fall back once through explicit legacy catalog discovery. */
export function resolveCurrentGraphArtifact(
	directories: Pick<PublicationDirectories, "graphs" | "publications">,
	subsystem: string,
): CurrentGraphArtifact | null {
	const generation = currentPublishedGeneration(directories.publications, subsystem);
	if (generation) {
		const path = join(directories.graphs, generation.graph.file);
		if (!existsSync(path)) throw new Error(`published graph is missing: ${generation.graph.file}`);
		const actual = sha256(readFileSync(path));
		if (actual !== generation.graph.sha256) throw new Error(`published graph hash mismatch: ${generation.graph.file}`);
		return { ...generation.graph, path, source: "publication-v1" };
	}
	const latest = legacyGraphCandidates(directories.graphs, directories.publications, subsystem)
		.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.file.localeCompare(a.file))[0];
	return latest ? { file: latest.file, path: latest.path, sha256: sha256(latest.content), source: "legacy-catalog" } : null;
}

export interface PublishDataGenerationInput {
	directories: PublicationDirectories;
	subsystem: string;
	expectedRevision: number;
	graphContent: string;
	changeReportContent?: string | null;
	publishedAt?: string;
}

export interface PublishDataGenerationResult {
	state: DataPublicationState;
	generation: PublishedGeneration;
	created: string[];
}

export function publishDataGeneration(input: PublishDataGenerationInput): PublishDataGenerationResult {
	const graphHash = sha256(input.graphContent);
	const reportContent = input.changeReportContent ?? null;
	const reportHash = reportContent === null ? null : sha256(reportContent);
	const graphFile = managedArtifactName(input.subsystem, graphHash, "graph");
	const reportFile = reportHash ? managedArtifactName(input.subsystem, reportHash, "change_report") : null;
	const publishedAt = input.publishedAt ?? new Date().toISOString();
	if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("publishedAt must be an ISO timestamp");
	const generationHash = sha256(`${input.subsystem}\0${graphHash}\0${reportHash ?? ""}`);
	const generation: PublishedGeneration = {
		id: `generation-${generationHash}`,
		published_at: publishedAt,
		graph: { file: graphFile, sha256: graphHash },
		change_report: reportFile && reportHash ? { file: reportFile, sha256: reportHash } : null,
	};

	return withPublicationLock(input.directories.publications, () => {
		const current = loadDataPublicationState(input.directories.publications);
		if (current.revision !== input.expectedRevision) throw new DataPublicationConflictError(input.expectedRevision, current);
		const created: string[] = [];
		try {
			if (writeImmutable(input.directories.graphs, graphFile, input.graphContent, graphHash)) created.push(join(input.directories.graphs, graphFile));
			if (reportContent !== null && reportFile && reportHash
				&& writeImmutable(input.directories.changes, reportFile, reportContent, reportHash)) {
				created.push(join(input.directories.changes, reportFile));
			}
			const existing = current.publications.find((publication) => publication.subsystem === input.subsystem);
			const publications = current.publications.filter((publication) => publication.subsystem !== input.subsystem);
			publications.push({
				subsystem: input.subsystem,
				generations: [generation, ...(existing?.generations ?? []).filter((item) => item.id !== generation.id)],
			});
			publications.sort((a, b) => a.subsystem.localeCompare(b.subsystem));
			const next: DataPublicationState = {
				...current,
				revision: current.revision + 1,
				updated_at: publishedAt,
				publications,
			};
			const errors = validateDataPublicationState(next);
			if (errors.length > 0) throw new Error(`refusing invalid publication state: ${errors.join("; ")}`);
			atomicWriteJson(dataPublicationStatePath(input.directories.publications), next);
			return { state: next, generation, created };
		} catch (error) {
			for (const path of created) rmSync(path, { force: true });
			throw error;
		}
	});
}

export function rollbackDataPublication(
	publicationsDirectory: string,
	subsystem: string,
	expectedRevision: number,
): DataPublicationState {
	return withPublicationLock(publicationsDirectory, () => {
		const current = loadDataPublicationState(publicationsDirectory);
		if (current.revision !== expectedRevision) throw new DataPublicationConflictError(expectedRevision, current);
		const publication = current.publications.find((item) => item.subsystem === subsystem);
		if (!publication || publication.generations.length < 2) throw new Error(`no previous published generation for ${subsystem}`);
		const [active, previous, ...rest] = publication.generations;
		const next: DataPublicationState = {
			...current,
			revision: current.revision + 1,
			updated_at: new Date().toISOString(),
			publications: current.publications.map((item) => item.subsystem === subsystem
				? { ...item, generations: [previous, active, ...rest] }
				: item),
		};
		const errors = validateDataPublicationState(next);
		if (errors.length > 0) throw new Error(`refusing invalid publication after rollback: ${errors.join("; ")}`);
		atomicWriteJson(dataPublicationStatePath(publicationsDirectory), next);
		return next;
	});
}

export function validatePublishedArtifacts(directories: PublicationDirectories): string[] {
	const state = loadDataPublicationState(directories.publications);
	const errors: string[] = [];
	for (const publication of state.publications) {
		for (const generation of publication.generations) {
			for (const [kind, artifact, directory] of [
				["graph", generation.graph, directories.graphs],
				["change report", generation.change_report, directories.changes],
			] as const) {
				if (!artifact) continue;
				const path = join(directory, artifact.file);
				if (!existsSync(path) || !statSync(path).isFile()) {
					errors.push(`${kind} is missing: ${artifact.file}`);
					continue;
				}
				if (sha256(readFileSync(path)) !== artifact.sha256) errors.push(`${kind} hash mismatch: ${artifact.file}`);
			}
			if (generation.change_report) {
				try {
					const report = JSON.parse(readFileSync(join(directories.changes, generation.change_report.file), "utf8")) as { current?: { file?: unknown } };
					if (report.current?.file !== generation.graph.file) errors.push(`generation report does not reference its graph: ${generation.id}`);
				} catch {
					errors.push(`generation report is not valid JSON: ${generation.change_report.file}`);
				}
			}
		}
	}
	return errors;
}

export interface DataPublicationPruneItem {
	kind: "graph" | "change_report";
	file: string;
	sha256: string;
	/** 内容寻址产物删除后不可从保留数据恢复；若被保留 generation 共享则按文件复制可恢复。 */
	recoverable: boolean;
}

export interface DataPublicationPrunePlan {
	subsystem: string;
	revision: number;
	retained: string[];
	deletable: DataPublicationPruneItem[];
	manualReview: string[];
}

export interface DataPublicationPruneResult extends DataPublicationPrunePlan {
	removed: string[];
}

/**
 * 保留集合：当前 generation、直接 rollback generation、以及仍被变化报告引用的
 * generation（其 change_report 引用自身 graph）。evidence v3 publication 钉住的
 * v2 源代也必须保留——删除后 resolvePublishedEvidence 会持续抛
 * EVIDENCE_SNAPSHOT_UNAVAILABLE，整个 evidence 读路径瘫痪。仅保留集合外的管理格式文件可删除。
 */
function retainedPublicationFiles(state: DataPublicationState, subsystem: string, publicationsDirectory: string): Set<string> {
	const retained = new Set<string>();
	const keep = (generation: PublishedGeneration): void => {
		retained.add(generation.graph.file);
		if (generation.change_report) retained.add(generation.change_report.file);
	};
	// evidence publication state 位于 data/evidence/publications；publications 目录的
	// 父目录即 dataDir。state 损坏时 loadEvidencePublicationState 显式抛错，绝不带着
	// 未知钉住关系继续 prune（fail closed）。
	const evidenceState = loadEvidencePublicationState(resolve(publicationsDirectory, ".."));
	const pinnedV2Ids = new Set(evidenceState.generations.map((generation) => generation.source_v2_generation_id));
	for (const publication of state.publications) {
		for (const generation of publication.generations) {
			if (pinnedV2Ids.has(generation.id)) keep(generation);
		}
	}
	const publication = state.publications.find((item) => item.subsystem === subsystem);
	if (!publication) return retained;
	const [current, previous, ...rest] = publication.generations;
	if (current) keep(current);
	if (previous) keep(previous);
	for (const generation of rest) if (generation.change_report) keep(generation);
	return retained;
}

export interface ActiveCatalogGraphSelection {
	files: string[];
	current: Map<string, string>;
	currentSha256: Map<string, string>;
}

/**
 * 活动图文件集：publication 接管的 subsystem 只暴露当前 generation 文件；
 * 非管理格式文件视为 legacy catalog，全部可见。catalog 只解析该集合，
 * 工作量与活动文件数成正比，与历史 generation 总数无关。
 * publication state 损坏时显式抛错，绝不静默退回旧图冒充当前事实。
 */
export function activeCatalogGraphFiles(
	directories: Pick<PublicationDirectories, "graphs" | "publications">,
): ActiveCatalogGraphSelection {
	const state = loadDataPublicationState(directories.publications);
	const current = new Map<string, string>();
	const currentFiles = new Set<string>();
	const currentSha256 = new Map<string, string>();
	for (const publication of state.publications) {
		const generation = publication.generations[0];
		if (!generation) continue;
		current.set(publication.subsystem, generation.graph.file);
		currentFiles.add(generation.graph.file);
		currentSha256.set(generation.graph.file, generation.graph.sha256);
	}
	const files = existsSync(directories.graphs)
		? readdirSync(directories.graphs).filter((file) => file.endsWith(".cyto.json"))
		: [];
	return {
		files: files.filter((file) => !MANAGED_GRAPH_PATTERN.test(file) || currentFiles.has(file)).sort(),
		current,
		currentSha256,
	};
}

/**
 * dry-run 优先的安全清理计划：只对 `__gbtx-<hash>` 管理格式且 SHA-256 与
 * publication state 记录一致、且不再被任何保留 generation 引用的文件给出删除建议；
 * 旧日期文件、未知/损坏/候选清单外文件一律进入 manualReview，绝不自动删除。
 */
export function planDataPublicationPrune(directories: PublicationDirectories, subsystem: string): DataPublicationPrunePlan {
	const state = loadDataPublicationState(directories.publications);
	const retained = retainedPublicationFiles(state, subsystem, directories.publications);
	// 只收集目标 subsystem 的已知 hash：其他 subsystem 的文件不在扫描范围内，
	// 防止多 subsystem 场景下误删其活动 generation。
	const prefix = `ue5_code_${subsystem}__gbtx-`;
	const knownHashes = new Map<string, string>();
	for (const publication of state.publications) {
		if (publication.subsystem !== subsystem) continue;
		for (const generation of publication.generations) {
			knownHashes.set(generation.graph.file, generation.graph.sha256);
			if (generation.change_report) knownHashes.set(generation.change_report.file, generation.change_report.sha256);
		}
	}
	const deletable: DataPublicationPruneItem[] = [];
	const manualReview: string[] = [];
	for (const [directory, kind, pattern] of [
		[directories.graphs, "graph", MANAGED_GRAPH_PATTERN],
		[directories.changes, "change_report", MANAGED_CHANGE_PATTERN],
	] as const) {
		if (!existsSync(directory)) continue;
		for (const file of readdirSync(directory).sort()) {
			if (!file.endsWith(".json")) {
				// 崩溃残留的 *.tmp-<pid>-<uuid> 暂存文件没有 .json 后缀，此前被静默跳过
				// 并无限累积；显式列入人工审查，让操作者可以决定清理。
				if (file.includes(".tmp-")) manualReview.push(`${file}：崩溃残留的临时写入文件，确认无进程写入后可删除`);
				continue;
			}
			const path = join(directory, file);
			if (pattern.test(file)) {
				// 只评估目标 subsystem 的管理文件；其他 subsystem 的产物完全不动。
				if (!file.startsWith(prefix)) continue;
				if (retained.has(file)) continue;
				const expected = knownHashes.get(file);
				if (expected === undefined) {
					manualReview.push(`${file}：publication state 候选清单中无记录，需人工审查`);
					continue;
				}
				const actual = sha256(readFileSync(path));
				if (actual !== expected) {
					manualReview.push(`${file}：SHA-256 与 state 记录不一致（损坏或手工修改），需人工审查`);
					continue;
				}
				deletable.push({ kind, file, sha256: actual, recoverable: false });
			} else {
				manualReview.push(`${file}：非管理格式（旧日期/手工文件），需人工审查`);
			}
		}
	}
	return {
		subsystem,
		revision: state.revision,
		retained: [...retained].sort(),
		deletable,
		manualReview,
	};
}

/**
 * 执行计划中的删除。revision 冲突保护与写入路径一致：锁内重读 state，
 * revision 不匹配即拒绝，绝不基于过期的引用判断删除。
 *
 * 被删 generation 同时从 publication state 移除（revision +1），state 仍是唯一
 * 事实源；文件删除在 state 提交之后，任何残留都会落入下一轮 manualReview 而非
 * 静默进入可见产物。
 */
export function pruneDataPublication(
	directories: PublicationDirectories,
	subsystem: string,
	expectedRevision: number,
): DataPublicationPruneResult {
	return withPublicationLock(directories.publications, () => {
		const current = loadDataPublicationState(directories.publications);
		if (current.revision !== expectedRevision) throw new DataPublicationConflictError(expectedRevision, current);
		const plan = planDataPublicationPrune(directories, subsystem);
		const publication = current.publications.find((item) => item.subsystem === subsystem);
		if (publication) {
			const deletedFiles = new Set(plan.deletable.map((item) => item.file));
			const keptGenerations = publication.generations.filter((generation) =>
				!deletedFiles.has(generation.graph.file)
				&& !(generation.change_report !== null && deletedFiles.has(generation.change_report.file)));
			if (keptGenerations.length < publication.generations.length) {
				const next: DataPublicationState = {
					...current,
					revision: current.revision + 1,
					updated_at: new Date().toISOString(),
					publications: current.publications.map((item) => item.subsystem === subsystem
						? { ...item, generations: keptGenerations }
						: item),
				};
				const errors = validateDataPublicationState(next);
				if (errors.length > 0) throw new Error(`refusing invalid publication after prune: ${errors.join("; ")}`);
				atomicWriteJson(dataPublicationStatePath(directories.publications), next);
			}
		}
		const removed: string[] = [];
		for (const item of plan.deletable) {
			const directory = item.kind === "graph" ? directories.graphs : directories.changes;
			const path = join(directory, item.file);
			if (!existsSync(path)) continue;
			rmSync(path, { force: true });
			removed.push(item.file);
		}
		return { ...plan, removed };
	});
}
