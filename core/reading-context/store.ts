// Canonical owner of user reading state. Legacy annotation/favorite stores are projections only.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { resolveGraphBrainProjectRoot } from "../source/project-root.js";
import { withFileLock } from "../store/file-lock.js";

export const READING_CONTEXT_FORMAT_VERSION = 1 as const;

export type AnnotationType = "gotcha" | "best_practice" | "design_decision" | "performance" | "reference";
export type FavoriteKind = "class" | "function";
export type FavoriteSource = "project" | "engine" | "unknown";

export interface ReadingAnnotation {
	id: string;
	type: AnnotationType;
	content: string;
	created_at: string;
	updated_at?: string;
	source_hash?: string;
	stale?: boolean;
}

export interface ReadingAnnotationEntry {
	subsystem: string;
	node_id: string;
	annotations: ReadingAnnotation[];
}

export interface ReadingFavorite {
	kind: FavoriteKind;
	source: FavoriteSource;
	node_id: string;
	label?: string;
	parent_id?: string;
	module?: string;
	source_path?: string;
	added_at: string;
}

export interface ReadingContextDocument {
	format_version: typeof READING_CONTEXT_FORMAT_VERSION;
	domain: "ue5_code";
	revision: number;
	updated_at: string;
	annotations: ReadingAnnotationEntry[];
	favorites: ReadingFavorite[];
}

const ROOT = resolveGraphBrainProjectRoot(import.meta.url, "..", "..");
export const READING_CONTEXT_DIR = join(ROOT, "data", "reading-context");
const SCHEMA_PATH = join(ROOT, "core", "schema", "reading-context.schema.json");
let validator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
	if (!validator) {
		const ajv = new Ajv({ allErrors: true });
		(addFormats.default ?? (addFormats as unknown as (instance: Ajv) => void))(ajv);
		validator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
	}
	return validator;
}

function assertCodeDomain(domain: string): asserts domain is "ue5_code" {
	if (domain !== "ue5_code") throw new Error(`GraphBrain 阅读上下文只接受 ue5_code，实际为 ${domain}`);
}

export function readingContextFilePath(domain: string, directory = READING_CONTEXT_DIR): string {
	assertCodeDomain(domain);
	return join(directory, `${domain}.json`);
}

export function emptyReadingContext(): ReadingContextDocument {
	return {
		format_version: READING_CONTEXT_FORMAT_VERSION,
		domain: "ue5_code",
		revision: 0,
		updated_at: "1970-01-01T00:00:00.000Z",
		annotations: [],
		favorites: [],
	};
}

export function validateReadingContext(document: unknown): string[] {
	const validate = getValidator();
	if (validate(document)) return [];
	return (validate.errors ?? []).map((error) => `${error.instancePath || "(root)"} ${error.message ?? ""}`);
}

export function loadReadingContext(domain: string, directory = READING_CONTEXT_DIR): ReadingContextDocument {
	const path = readingContextFilePath(domain, directory);
	if (!existsSync(path)) return emptyReadingContext();
	const document = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as ReadingContextDocument;
	const errors = validateReadingContext(document);
	if (errors.length > 0) throw new Error(`阅读上下文不符合 schema: ${errors.join("; ")}`);
	return document;
}

function favoriteKey(favorite: Pick<ReadingFavorite, "kind" | "source" | "node_id">): string {
	return `${favorite.kind}\u0000${favorite.source}\u0000${favorite.node_id}`;
}

function normalize(document: ReadingContextDocument): ReadingContextDocument {
	document.annotations = document.annotations
		.filter((entry) => entry.annotations.length > 0)
		.sort((a, b) => a.subsystem.localeCompare(b.subsystem) || a.node_id.localeCompare(b.node_id));
	document.favorites = [...new Map(document.favorites.map((favorite) => [favoriteKey(favorite), favorite])).values()]
		.sort((a, b) => a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source) || a.node_id.localeCompare(b.node_id));
	return document;
}

function writeDocument(document: ReadingContextDocument, directory = READING_CONTEXT_DIR): void {
	const errors = validateReadingContext(document);
	if (errors.length > 0) throw new Error(`阅读上下文不符合 schema，拒绝写入: ${errors.join("; ")}`);
	mkdirSync(directory, { recursive: true });
	const destination = readingContextFilePath(document.domain, directory);
	const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
	writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
	renameSync(temporary, destination);
}

function readingContextLockPath(directory: string): string {
	return join(directory, ".write.lock");
}

export class ReadingContextConflictError extends Error {
	readonly code = "READING_CONTEXT_CONFLICT";
	constructor(readonly expectedRevision: number, readonly current: ReadingContextDocument) {
		super(`阅读上下文已变化：期望 revision ${expectedRevision}，当前为 ${current.revision}`);
	}
}

export function replaceReadingContext(document: ReadingContextDocument, directory = READING_CONTEXT_DIR): void {
	withFileLock(readingContextLockPath(directory), () => {
		writeDocument(normalize(structuredClone(document)), directory);
	}, { busy: "throw", onRecover: (reason) => console.warn(`[reading-context] recovered stale write lock (${reason})`) });
}

/**
 * 读-校验-写放入跨进程锁临界区：浏览器写入与 watcher/scan-stale 并发时，
 * 后到者拿到锁后重读最新文档，revision 不匹配即显式冲突，绝不覆盖先写者的更新。
 */
export function mutateReadingContext(
	domain: string,
	expectedRevision: number,
	mutator: (draft: ReadingContextDocument) => void,
	directory = READING_CONTEXT_DIR,
): ReadingContextDocument {
	return withFileLock(readingContextLockPath(directory), () => {
		const current = loadReadingContext(domain, directory);
		if (current.revision !== expectedRevision) throw new ReadingContextConflictError(expectedRevision, current);
		const next = structuredClone(current);
		mutator(next);
		next.revision = current.revision + 1;
		next.updated_at = new Date().toISOString();
		normalize(next);
		writeDocument(next, directory);
		return next;
	}, { busy: "throw", onRecover: (reason) => console.warn(`[reading-context] recovered stale write lock (${reason})`) })!;
}

export function mergeReadingFavorites(
	domain: string,
	expectedRevision: number,
	favorites: Array<Omit<ReadingFavorite, "added_at"> & { added_at?: string }>,
	directory = READING_CONTEXT_DIR,
): ReadingContextDocument {
	return mutateReadingContext(domain, expectedRevision, (draft) => {
		const existing = new Map(draft.favorites.map((favorite) => [favoriteKey(favorite), favorite]));
		for (const favorite of favorites) {
			if (!favorite.node_id.trim()) continue;
			const value: ReadingFavorite = { ...favorite, added_at: favorite.added_at ?? new Date().toISOString() };
			const key = favoriteKey(value);
			const old = existing.get(key);
			existing.set(key, old ? { ...old, ...value, added_at: old.added_at } : value);
		}
		draft.favorites = [...existing.values()];
	}, directory);
}
