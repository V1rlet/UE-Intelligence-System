import type { CoverageDiagnostic, CoverageStatus, ProvenanceStatus, SourceFingerprint } from "./graph-version.js";

export type GraphFreshness = "current" | "stale" | "unverified";
export type GraphFreshnessReason =
	| "fingerprint-match"
	| "fingerprint-mismatch"
	| "source-newer"
	| "v1-no-fingerprint"
	| "v2-unverified-provenance"
	| "unsupported-fingerprint-algorithm"
	| "missing-generated-at"
	| "missing-source-root"
	| "source-scan-failed";

export interface GraphCatalogPreviewNode {
	id: string;
	label: string;
	parent?: string;
	group?: string;
	type?: string;
	position?: { x: number; y: number };
}

export interface GraphCatalogPreviewEdge {
	source: string;
	target: string;
	type?: string;
}

/**
 * A bounded, lossless projection of canonical graph facts for catalog cards.
 * Version 1 deliberately excludes source text and business-semantic defaults.
 */
export interface GraphCatalogPreview {
	format_version: 1;
	nodes: GraphCatalogPreviewNode[];
	edges: GraphCatalogPreviewEdge[];
}

export interface GraphCatalogEntry {
	file: string;
	domain: string;
	subsystem: string;
	title: string;
	kind: string;
	stage: string;
	status: string;
	revision?: number | null;
	date: string;
	nodes: number;
	edges: number;
	/** Compatibility-only file mtime. Never present it as fact extraction time. */
	updated_at: string;
	generated_at: string | null;
	generator: string | null;
	source_root: string | null;
	format_version: number | null;
	provenance_status: ProvenanceStatus | null;
	coverage_status: CoverageStatus | null;
	coverage_discovered_files: number | null;
	coverage_consumed_files: number | null;
	coverage_skipped_files: number | null;
	coverage_failed_files: number | null;
	/** Bounded at the catalog normalization boundary. */
	coverage_diagnostics?: CoverageDiagnostic[];
	coverage_diagnostics_truncated?: number;
	source_fingerprint?: SourceFingerprint | null;
	freshness: GraphFreshness;
	freshness_reason: GraphFreshnessReason;
	source_file_count: number | null;
	source_files_newer: number | null;
	latest_source_at: string | null;
	/** Optional only for compatibility with catalog responses produced before preview v1. */
	preview?: GraphCatalogPreview;
	/** Optional for old catalog servers; absence means the client must use the full graph. */
	capabilities?: {
		file_forest_projection?: 1;
		/** B1：coverage=complete（提取器消费了全部发现的源文件，含 standalone TU）。 */
		standalone_translation_units?: 1;
	};
}
