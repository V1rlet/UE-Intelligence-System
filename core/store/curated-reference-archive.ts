import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const CURATED_REFERENCE_ARCHIVE_FORMAT = "graphbrain.curated-reference-archive/1" as const;

export interface CuratedReferenceArchiveEntry {
	file: string;
	subsystem: string;
	original_path: string;
	archive_path: string;
	bytes: number;
	sha256: string;
	annotation_targets: number;
}

export interface CuratedReferenceArchiveManifest {
	format_version: typeof CURATED_REFERENCE_ARCHIVE_FORMAT;
	archived_at: string;
	status: "archived";
	entries: CuratedReferenceArchiveEntry[];
	consumer_audit: {
		external_consumers: string[];
		active_generators_retired: string[];
		deep_link_adapter: string;
	};
	reading_context: {
		before_revision: number;
		after_revision: number;
		archived_document: string;
		annotation_entries: number;
		annotations: number;
		favorites: number;
		favorites_verified_engine_ids: number;
		favorites_verified_project_snapshot: number;
		favorites_verified_engine_cache: number;
		favorites_verified_official_catalog: number;
		review_document: string;
	};
	rollback: string;
}

export function curatedReferenceArchiveManifestPath(dataDir: string): string {
	return join(dataDir, "archive", "curated-references-v1", "migration-manifest.json");
}

interface ManifestCacheSlot {
	mtimeMs: number;
	manifest: CuratedReferenceArchiveManifest;
}

/** 归档 manifest 不可变；按 mtime 缓存，避免每个 /data/graphs 请求都重读重解析。 */
const manifestCache = new Map<string, ManifestCacheSlot>();
const MANIFEST_CACHE_MAX = 16;

function cacheManifest(path: string, mtimeMs: number, manifest: CuratedReferenceArchiveManifest): void {
	manifestCache.set(path, { mtimeMs, manifest });
	if (manifestCache.size > MANIFEST_CACHE_MAX) {
		const oldest = manifestCache.keys().next().value;
		if (oldest !== undefined) manifestCache.delete(oldest);
	}
}

function entryErrors(entry: unknown, index: number): string[] {
	const errors: string[] = [];
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [`entry ${index} is not an object`];
	const record = entry as Record<string, unknown>;
	if (typeof record.file !== "string" || basename(record.file) !== record.file) errors.push(`entry ${index} file must be a plain file name`);
	if (typeof record.subsystem !== "string" || !record.subsystem) errors.push(`entry ${index} subsystem is invalid`);
	if (typeof record.archive_path !== "string" || !record.archive_path) errors.push(`entry ${index} archive_path is invalid`);
	if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) errors.push(`entry ${index} sha256 is invalid`);
	if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0) errors.push(`entry ${index} bytes is invalid`);
	return errors;
}

export function loadCuratedReferenceArchiveManifest(dataDir: string): CuratedReferenceArchiveManifest | null {
	const path = curatedReferenceArchiveManifestPath(dataDir);
	let mtimeMs: number;
	try {
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		manifestCache.delete(path);
		return null;
	}
	const cached = manifestCache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.manifest;
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		// 损坏的 manifest 必须带路径抛出：该函数在每个 /data/graphs 请求上被调用，
		// 裸 SyntaxError 会让所有图读取 500 且无法定位。
		throw new Error(`curated reference archive manifest is not valid JSON (${path}): ${(error as Error).message}`);
	}
	const record = value as Partial<CuratedReferenceArchiveManifest> & { status?: unknown };
	if (record.format_version !== CURATED_REFERENCE_ARCHIVE_FORMAT || record.status !== "archived" || !Array.isArray(record.entries)) {
		throw new Error(`curated reference archive manifest is invalid (${path})`);
	}
	const errors = record.entries.flatMap((entry, index) => entryErrors(entry, index));
	if (errors.length > 0) throw new Error(`curated reference archive manifest entries are invalid (${path}): ${errors.join("; ")}`);
	const manifest = record as CuratedReferenceArchiveManifest;
	cacheManifest(path, mtimeMs, manifest);
	return manifest;
}

export function archivedCuratedReference(dataDir: string, file: string): CuratedReferenceArchiveEntry | null {
	if (basename(file) !== file) return null;
	return loadCuratedReferenceArchiveManifest(dataDir)?.entries.find((item) => item.file === file) ?? null;
}
