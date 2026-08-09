// Graph Brain / server - 图谱文件目录：新→旧排序、meta 解析缓存、文档目录条目
// 缓存按 path+mtime+size 失效（F19：21 图冷 85ms → 热 2.8ms）。

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	graphSourceRootQuery,
	SOURCE_FINGERPRINT_ALGORITHM,
} from "../core/schema/graph-version.js";
import {
	type GraphCatalogEntry,
	type GraphCatalogPreview,
} from "../core/schema/graph-catalog.js";
import { discoverSourceInputs, fingerprintSourceInventory } from "../core/source/source-evidence.js";
import { GRAPH_PROJECTION_FORMAT_VERSION } from "../core/schema/graph-projection.js";
import { activeCatalogGraphFiles, sha256 } from "../core/store/data-publication.js";

type StoredCatalogEntry = Omit<GraphCatalogEntry,
	"freshness" | "freshness_reason" | "source_file_count" | "source_files_newer" | "latest_source_at"
> & { source_fingerprint_algorithm: string | null; source_fingerprint_value: string | null };

const graphCatalogCache = new Map<string, { mtimeMs: number; size: number; entry: StoredCatalogEntry }>();

function buildCatalogPreview(elements?: { nodes?: unknown[]; edges?: unknown[] }): GraphCatalogPreview {
	const candidates = (elements?.nodes ?? [])
		.map((item) => (item as { data?: Record<string, unknown>; position?: Record<string, unknown> }))
		.filter((item) => item.data?.id && !["ufunction", "function"].includes(String(item.data.type ?? "").toLowerCase()))
		.slice(0, 42);
	const nodes = candidates.map((item) => {
		const data = item.data ?? {};
		const x = item.position?.x;
		const y = item.position?.y;
		return {
			id: String(data.id),
			label: String(data.label ?? data.id),
			...(data.parent ? { parent: String(data.parent) } : {}),
			...(data.system || data.module ? { group: String(data.system ?? data.module) } : {}),
			...(data.type ? { type: String(data.type) } : {}),
			...(typeof x === "number" && typeof y === "number" ? { position: { x, y } } : {}),
		};
	});
	const ids = new Set(nodes.map((node) => node.id));
	const edges = (elements?.edges ?? [])
		.map((item) => (item as { data?: Record<string, unknown> }).data ?? {})
		.filter((data) => ids.has(String(data.source ?? "")) && ids.has(String(data.target ?? "")))
		.slice(0, 90)
		.map((data) => ({
			source: String(data.source),
			target: String(data.target),
			...(data.type || data.relation ? { type: String(data.type ?? data.relation) } : {}),
		}));
	return { format_version: 1, nodes, edges };
}

function catalogCapabilities(elements?: { nodes?: unknown[]; edges?: unknown[] }): GraphCatalogEntry["capabilities"] {
	const hasForestFacts = (elements?.nodes ?? []).some((item) => {
		const type = String((item as { data?: { type?: unknown } }).data?.type ?? "");
		return type === "folder" || type === "file";
	});
	return hasForestFacts ? { file_forest_projection: GRAPH_PROJECTION_FORMAT_VERSION } : {};
}

interface SourceScan {
	count: number;
	newer: number;
	latestMs: number;
}

function scanSourceTimes(files: Array<{ absolute_path: string }>, generatedMs: number): SourceScan {
	const result: SourceScan = { count: 0, newer: 0, latestMs: 0 };
	for (const file of files) {
		const modifiedMs = statSync(file.absolute_path).mtimeMs;
		result.count++;
		if (modifiedMs > generatedMs) result.newer++;
		result.latestMs = Math.max(result.latestMs, modifiedMs);
	}
	return result;
}

/**
 * v1 graphs have no source revision/fingerprint, so they can be proven stale but
 * can never be declared verified-current. format v2 will add that proof.
 */
export function withRuntimeFreshness(entry: StoredCatalogEntry): GraphCatalogEntry {
	if (!entry.generated_at) {
		return { ...entry, freshness: "unverified", freshness_reason: "missing-generated-at", source_file_count: null, source_files_newer: null, latest_source_at: null };
	}
	if (!entry.source_root) {
		return { ...entry, freshness: "unverified", freshness_reason: "missing-source-root", source_file_count: null, source_files_newer: null, latest_source_at: null };
	}
	const generatedMs = Date.parse(entry.generated_at);
	if (!Number.isFinite(generatedMs)) {
		return { ...entry, freshness: "unverified", freshness_reason: "missing-generated-at", source_file_count: null, source_files_newer: null, latest_source_at: null };
	}
	try {
		const inventory = discoverSourceInputs(entry.source_root.split(";").filter(Boolean));
		if (inventory.diagnostics.length > 0) throw new Error(inventory.diagnostics.map((item) => item.code).join(", "));
		const scan = scanSourceTimes(inventory.files, generatedMs);
		if (entry.provenance_status === "verified") {
			if (entry.source_fingerprint_algorithm !== SOURCE_FINGERPRINT_ALGORITHM || !entry.source_fingerprint_value) {
				return { ...entry, freshness: "unverified", freshness_reason: "unsupported-fingerprint-algorithm", source_file_count: scan.count, source_files_newer: scan.newer, latest_source_at: scan.latestMs ? new Date(scan.latestMs).toISOString() : null };
			}
			const snapshot = fingerprintSourceInventory(inventory);
			if (!snapshot.fingerprint) throw new Error("source fingerprint failed");
			const matches = snapshot.fingerprint.value === entry.source_fingerprint_value;
			return {
				...entry,
				freshness: matches ? "current" : "stale",
				freshness_reason: matches ? "fingerprint-match" : "fingerprint-mismatch",
				source_file_count: scan.count,
				source_files_newer: scan.newer,
				latest_source_at: scan.latestMs ? new Date(scan.latestMs).toISOString() : null,
			};
		}
		const isV2 = entry.format_version === 2;
		return {
			...entry,
			freshness: scan.newer > 0 ? "stale" : "unverified",
			freshness_reason: scan.newer > 0 ? "source-newer" : isV2 ? "v2-unverified-provenance" : "v1-no-fingerprint",
			source_file_count: scan.count,
			source_files_newer: scan.newer,
			latest_source_at: scan.latestMs ? new Date(scan.latestMs).toISOString() : null,
		};
	} catch {
		return { ...entry, freshness: "unverified", freshness_reason: "source-scan-failed", source_file_count: null, source_files_newer: null, latest_source_at: null };
	}
}

export function graphCatalogEntries(graphsDir: string): GraphCatalogEntry[] {
	if (!existsSync(graphsDir)) return [];
	const active = new Set<string>();
	const entries: GraphCatalogEntry[] = [];
	const publicationsDirectory = join(dirname(graphsDir), "publications");
	// Publication 接管的 subsystem 只解析当前 generation；legacy 文件走集中兼容边界。
	// 历史 generation 不读取、不解析，工作量与活动文件数成正比。
	const selection = activeCatalogGraphFiles({ graphs: graphsDir, publications: publicationsDirectory });
	for (const file of selection.files) {
		const path = join(graphsDir, file);
		active.add(path);
		try {
			// A watcher may replace/delete a file between readdir and stat/read; skip that
			// single transient entry instead of failing the entire catalog request.
			const stat = statSync(path);
			const cached = graphCatalogCache.get(path);
			if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
				entries.push(withRuntimeFreshness(cached.entry));
				continue;
			}
			const raw = readFileSync(path, "utf8");
			const content = raw.replace(/^\uFEFF/, "");
			const expectedHash = selection.currentSha256.get(file);
			if (expectedHash !== undefined && sha256(content) !== expectedHash) {
				console.warn(`[catalog] current graph hash mismatch, hiding untrusted artifact: ${file}`);
				graphCatalogCache.delete(path);
				continue;
			}
			const graph = JSON.parse(content) as {
				meta?: Record<string, unknown>;
				elements?: { nodes?: unknown[]; edges?: unknown[] };
			};
			// Viewer-only boundary: the active catalog exposes extracted UE code facts only.
			if (String(graph.meta?.domain ?? "") !== "ue5_code") {
				graphCatalogCache.delete(path);
				continue;
			}
			const base = file.replace(/\.cyto\.json$/, "");
			const subsystem = String(graph.meta?.subsystem ?? base);
			if (selection.current.has(subsystem) && selection.currentSha256.get(file) === undefined) {
				// 该 subsystem 已被 publication 接管：legacy 文件不再并列显示，避免旧图冒充当前事实。
				graphCatalogCache.delete(path);
				continue;
			}
			const sourceRoot = graphSourceRootQuery(graph.meta);
			const provenance = graph.meta?.provenance as Record<string, unknown> | undefined;
			const fingerprint = provenance?.fingerprint as Record<string, unknown> | undefined;
			const coverage = graph.meta?.coverage as Record<string, unknown> | undefined;
			const generatedAt = typeof graph.meta?.generated_at === "string" ? graph.meta.generated_at : null;
			const entry: StoredCatalogEntry = {
				file,
				domain: String(graph.meta?.domain ?? ""),
				subsystem,
				title: String(graph.meta?.title ?? ""),
				kind: String(graph.meta?.kind ?? ""),
				stage: String(graph.meta?.stage ?? ""),
				status: String(graph.meta?.status ?? ""),
				revision: typeof graph.meta?.revision === "number" ? graph.meta.revision : null,
				date: generatedAt?.slice(0, 10) ?? base.match(/_(\d{4}-\d{2}-\d{2})$/)?.[1] ?? "",
				nodes: graph.elements?.nodes?.length ?? 0,
				edges: graph.elements?.edges?.length ?? 0,
				updated_at: stat.mtime.toISOString(),
				generated_at: generatedAt,
				generator: typeof graph.meta?.generator === "string" ? graph.meta.generator : null,
				source_root: sourceRoot || null,
				format_version: typeof graph.meta?.format_version === "number" ? graph.meta.format_version : null,
				provenance_status: provenance?.status === "verified" || provenance?.status === "unknown" ? provenance.status : null,
				coverage_status: coverage?.status === "complete" || coverage?.status === "partial" || coverage?.status === "unknown" ? coverage.status : null,
				coverage_discovered_files: typeof coverage?.discovered_files === "number" ? coverage.discovered_files : null,
				coverage_consumed_files: typeof coverage?.consumed_files === "number" ? coverage.consumed_files : null,
				coverage_skipped_files: typeof coverage?.skipped_files === "number" ? coverage.skipped_files : null,
				coverage_failed_files: typeof coverage?.failed_files === "number" ? coverage.failed_files : null,
				preview: buildCatalogPreview(graph.elements),
				capabilities: catalogCapabilities(graph.elements),
				source_fingerprint_algorithm: typeof fingerprint?.algorithm === "string" ? fingerprint.algorithm : null,
				source_fingerprint_value: typeof fingerprint?.value === "string" ? fingerprint.value : null,
			};
			graphCatalogCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
			entries.push(withRuntimeFreshness(entry));
		} catch {
			graphCatalogCache.delete(path);
		}
	}
	// 当前 generation 缺失或不可信 → 显式告警并隐藏，绝不静默回退历史图。
	for (const [subsystem, file] of selection.current) {
		if (!entries.some((entry) => entry.file === file)) {
			console.warn(`[catalog] current graph hidden for ${subsystem} (missing or untrusted): ${file}`);
		}
	}
	for (const path of graphCatalogCache.keys()) {
		if (!active.has(path)) graphCatalogCache.delete(path);
	}
	return entries.sort((a, b) =>
		Number(b.subsystem === "project") - Number(a.subsystem === "project")
		|| (b.generated_at ?? "").localeCompare(a.generated_at ?? "")
		|| a.file.localeCompare(b.file));
}
