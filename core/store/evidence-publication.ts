// Atomic publication owner for separated evidence snapshot v3 artifacts.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	ENGINE_EVIDENCE_KIND,
	PROJECT_EVIDENCE_KIND,
	type EngineEvidenceSnapshotV3,
	type EvidenceSnapshotPairV3,
	type ProjectEvidenceSnapshotV3,
	validateEvidenceSnapshotPairV3,
} from "../schema/evidence-snapshot-v3.js";
import { withFileLock } from "./file-lock.js";
import { renameDurableSync, writeFsyncedTemporary } from "./durable-write.js";

export const EVIDENCE_PUBLICATION_FORMAT = "graphbrain-evidence-publication/1" as const;

export interface EvidencePublishedArtifact {
	file: string;
	sha256: string;
}

export interface EvidencePublishedGeneration {
	id: string;
	published_at: string;
	source_v2_generation_id: string;
	project: EvidencePublishedArtifact;
	engine: EvidencePublishedArtifact;
}

export interface EvidencePublicationState {
	format_version: typeof EVIDENCE_PUBLICATION_FORMAT;
	domain: "ue5_code";
	revision: number;
	updated_at: string;
	active: { mode: "v3"; generation_id: string } | { mode: "v2-compatibility"; generation_id: null };
	compatibility_v2_generation_id: string | null;
	generations: EvidencePublishedGeneration[];
}

export interface EvidencePublicationDirectories {
	root: string;
	project: string;
	engine: string;
	publications: string;
}

export class EvidencePublicationConflictError extends Error {
	readonly code = "EVIDENCE_PUBLICATION_CONFLICT";
	constructor(readonly expectedRevision: number, readonly current: EvidencePublicationState) {
		super(`evidence publication changed: expected revision ${expectedRevision}, current revision ${current.revision}`);
	}
}

export function evidencePublicationDirectories(dataDir: string): EvidencePublicationDirectories {
	const root = resolve(dataDir, "evidence");
	return { root, project: join(root, "project"), engine: join(root, "engine"), publications: join(root, "publications") };
}

export function evidencePublicationStatePath(dataDir: string): string {
	return join(evidencePublicationDirectories(dataDir).publications, "ue5_code.json");
}

export function emptyEvidencePublicationState(): EvidencePublicationState {
	return {
		format_version: EVIDENCE_PUBLICATION_FORMAT,
		domain: "ue5_code",
		revision: 0,
		updated_at: "1970-01-01T00:00:00.000Z",
		active: { mode: "v2-compatibility", generation_id: null },
		compatibility_v2_generation_id: null,
		generations: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validArtifact(value: unknown, prefix: string): value is EvidencePublishedArtifact {
	if (!isRecord(value) || typeof value.file !== "string" || basename(value.file) !== value.file) return false;
	return value.file.startsWith(prefix) && value.file.endsWith(".json")
		&& typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256);
}

export function validateEvidencePublicationState(value: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(value)) return ["evidence publication state must be an object"];
	if (value.format_version !== EVIDENCE_PUBLICATION_FORMAT) errors.push("unsupported evidence publication format");
	if (value.domain !== "ue5_code") errors.push("evidence publication domain is invalid");
	if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) errors.push("evidence publication revision is invalid");
	if (typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) errors.push("evidence publication timestamp is invalid");
	if (!isRecord(value.active) || !["v3", "v2-compatibility"].includes(String(value.active.mode))) errors.push("evidence publication active mode is invalid");
	if (value.compatibility_v2_generation_id !== null && (typeof value.compatibility_v2_generation_id !== "string" || !/^generation-[a-f0-9]{64}$/.test(value.compatibility_v2_generation_id))) {
		errors.push("compatibility v2 generation id is invalid");
	}
	if (!Array.isArray(value.generations)) return [...errors, "evidence generations must be an array"];
	const ids = new Set<string>();
	for (const [index, generation] of value.generations.entries()) {
		if (!isRecord(generation)) { errors.push(`generation ${index} is invalid`); continue; }
		if (typeof generation.id !== "string" || !/^evidence-generation-[a-f0-9]{64}$/.test(generation.id)) errors.push(`generation ${index} id is invalid`);
		else if (ids.has(generation.id)) errors.push(`duplicate evidence generation: ${generation.id}`);
		else ids.add(generation.id);
		if (typeof generation.published_at !== "string" || !Number.isFinite(Date.parse(generation.published_at))) errors.push(`generation ${index} timestamp is invalid`);
		if (typeof generation.source_v2_generation_id !== "string" || !/^generation-[a-f0-9]{64}$/.test(generation.source_v2_generation_id)) errors.push(`generation ${index} v2 source is invalid`);
		if (!validArtifact(generation.project, "project__gbev3-")) errors.push(`generation ${index} project artifact is invalid`);
		if (!validArtifact(generation.engine, "engine__gbev3-")) errors.push(`generation ${index} engine artifact is invalid`);
	}
	if (isRecord(value.active)) {
		if (value.active.mode === "v3" && (typeof value.active.generation_id !== "string" || !ids.has(value.active.generation_id))) errors.push("active v3 generation does not resolve");
		if (value.active.mode === "v2-compatibility" && value.active.generation_id !== null) errors.push("v2 compatibility mode must not name a v3 generation");
	}
	return errors;
}

export function loadEvidencePublicationState(dataDir: string): EvidencePublicationState {
	const path = evidencePublicationStatePath(dataDir);
	if (!existsSync(path)) return emptyEvidencePublicationState();
	const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as unknown;
	const errors = validateEvidencePublicationState(value);
	if (errors.length > 0) throw new Error(`invalid evidence publication state: ${errors.join("; ")}`);
	return value as EvidencePublicationState;
}

function sha256(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(resolve(path, ".."), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFsyncedTemporary(temporary, content);
		renameDurableSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function writeImmutable(directory: string, file: string, content: string, hash: string): void {
	mkdirSync(directory, { recursive: true });
	const destination = join(directory, file);
	if (existsSync(destination)) {
		if (sha256(readFileSync(destination)) !== hash) throw new Error(`evidence artifact collision: ${file}`);
		return;
	}
	const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFsyncedTemporary(temporary, content);
		if (sha256(readFileSync(temporary)) !== hash) throw new Error(`staged evidence artifact hash mismatch: ${file}`);
		renameDurableSync(temporary, destination);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function withPublicationLock<T>(dataDir: string, action: () => T): T {
	const publications = evidencePublicationDirectories(dataDir).publications;
	const lockPath = join(publications, ".write.lock");
	const result = withFileLock(lockPath, action, {
		// 与 data-publication 的 parsePublicationLock 一致：校验 pid/started_at 形状，
		// 避免 {} 之类"合法 JSON 但非法记录"被当作在持锁（Date.parse(NaN) → 立即被判过期）
		// 或把非数字 pid 交给 processExists 抛 TypeError。
		parse: (content) => {
			try {
				const value = JSON.parse(content) as Partial<{ pid: number; started_at: string }>;
				return Number.isSafeInteger(value.pid) && typeof value.started_at === "string"
					? { pid: Number(value.pid), started_at: value.started_at }
					: null;
			} catch {
				return null;
			}
		},
		serialize: (record) => `${JSON.stringify(record)}\n`,
		busyMessage: () => `evidence publication is locked (${lockPath})`,
		onRecover: (reason) => console.warn(`[evidence-publication] recovered stale lock (${reason})`),
	});
	if (result === null) throw new Error(`evidence publication is locked (${lockPath})`);
	return result;
}

function stateContent(state: EvidencePublicationState): string {
	return `${JSON.stringify(state, null, 2)}\n`;
}

export function publishEvidenceSnapshotPair(input: {
	dataDir: string;
	pair: EvidenceSnapshotPairV3;
	expectedRevision: number;
	compatibilityV2GenerationId: string;
	now?: string;
}): { state: EvidencePublicationState; generation: EvidencePublishedGeneration } {
	const errors = validateEvidenceSnapshotPairV3(input.pair);
	if (errors.length > 0) throw new Error(`refusing invalid evidence v3: ${errors.join("; ")}`);
	return withPublicationLock(input.dataDir, () => {
		const current = loadEvidencePublicationState(input.dataDir);
		if (current.revision !== input.expectedRevision) throw new EvidencePublicationConflictError(input.expectedRevision, current);
		const directories = evidencePublicationDirectories(input.dataDir);
		const projectContent = `${JSON.stringify(input.pair.project, null, 2)}\n`;
		const engineContent = `${JSON.stringify(input.pair.engine, null, 2)}\n`;
		const projectHash = sha256(projectContent);
		const engineHash = sha256(engineContent);
		const project = { file: `project__gbev3-${projectHash.slice(0, 16)}.json`, sha256: projectHash };
		const engine = { file: `engine__gbev3-${engineHash.slice(0, 16)}.json`, sha256: engineHash };
		writeImmutable(directories.project, project.file, projectContent, projectHash);
		writeImmutable(directories.engine, engine.file, engineContent, engineHash);
		const id = `evidence-generation-${sha256(`${projectHash}\0${engineHash}\0${input.compatibilityV2GenerationId}`)}`;
		const existing = current.generations.find((item) => item.id === id);
		const generation: EvidencePublishedGeneration = existing ?? {
			id,
			published_at: input.now ?? new Date().toISOString(),
			source_v2_generation_id: input.compatibilityV2GenerationId,
			project,
			engine,
		};
		const generations = [generation, ...current.generations.filter((item) => item.id !== id)].slice(0, 10);
		const state: EvidencePublicationState = {
			...current,
			revision: current.revision + 1,
			updated_at: input.now ?? new Date().toISOString(),
			active: { mode: "v3", generation_id: id },
			compatibility_v2_generation_id: input.compatibilityV2GenerationId,
			generations,
		};
		const stateErrors = validateEvidencePublicationState(state);
		if (stateErrors.length > 0) throw new Error(`invalid evidence publication: ${stateErrors.join("; ")}`);
		atomicWrite(evidencePublicationStatePath(input.dataDir), stateContent(state));
		return { state, generation };
	});
}

export function setEvidencePublicationMode(input: {
	dataDir: string;
	expectedRevision: number;
	mode: "v2-compatibility" | "v3";
	generationId?: string;
}): EvidencePublicationState {
	return withPublicationLock(input.dataDir, () => {
		const current = loadEvidencePublicationState(input.dataDir);
		if (current.revision !== input.expectedRevision) throw new EvidencePublicationConflictError(input.expectedRevision, current);
		const generationId = input.mode === "v3" ? input.generationId ?? current.generations[0]?.id : null;
		if (input.mode === "v3" && !current.generations.some((item) => item.id === generationId)) throw new Error("requested evidence v3 generation is not retained");
		if (input.mode === "v2-compatibility" && !current.compatibility_v2_generation_id) throw new Error("no v2 compatibility generation is recorded");
		const state: EvidencePublicationState = {
			...current,
			revision: current.revision + 1,
			updated_at: new Date().toISOString(),
			active: input.mode === "v3" ? { mode: "v3", generation_id: generationId! } : { mode: "v2-compatibility", generation_id: null },
		};
		atomicWrite(evidencePublicationStatePath(input.dataDir), stateContent(state));
		return state;
	});
}

function readArtifact<T>(directory: string, artifact: EvidencePublishedArtifact, expectedKind: string): T {
	const path = join(directory, artifact.file);
	const content = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
	if (sha256(content) !== artifact.sha256) throw new Error(`evidence artifact hash mismatch: ${artifact.file}`);
	const value = JSON.parse(content) as { kind?: unknown };
	if (value.kind !== expectedKind) throw new Error(`evidence artifact kind mismatch: ${artifact.file}`);
	return value as T;
}

export function readActiveEvidenceSnapshotPair(dataDir: string): { state: EvidencePublicationState; generation: EvidencePublishedGeneration; pair: EvidenceSnapshotPairV3 } | null {
	const state = loadEvidencePublicationState(dataDir);
	if (state.active.mode !== "v3") return null;
	const generation = state.generations.find((item) => item.id === state.active.generation_id);
	if (!generation) throw new Error("active evidence generation is missing");
	const directories = evidencePublicationDirectories(dataDir);
	const pair = {
		project: readArtifact<ProjectEvidenceSnapshotV3>(directories.project, generation.project, PROJECT_EVIDENCE_KIND),
		engine: readArtifact<EngineEvidenceSnapshotV3>(directories.engine, generation.engine, ENGINE_EVIDENCE_KIND),
	};
	const errors = validateEvidenceSnapshotPairV3(pair);
	if (errors.length > 0) throw new Error(`active evidence snapshot pair is invalid: ${errors.join("; ")}`);
	return { state, generation, pair };
}
