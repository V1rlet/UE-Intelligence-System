// Persisted ue5_code graph versioning and the single legacy-normalization boundary.

export const UE5_CODE_GRAPH_FORMAT = 2 as const;
export const SOURCE_PROVENANCE_SCHEMA_VERSION = 1 as const;
export const SOURCE_FINGERPRINT_ALGORITHM = "sha256-path-content-v1" as const;

export type SourceKind = "working_tree" | "curated_reference" | "unknown";
export type ProvenanceStatus = "verified" | "unknown";
export type CoverageStatus = "complete" | "partial" | "unknown";

export interface SourceFingerprint {
	algorithm: typeof SOURCE_FINGERPRINT_ALGORITHM;
	value: string;
	file_count: number;
}

export interface SourceProvenance {
	schema_version: typeof SOURCE_PROVENANCE_SCHEMA_VERSION;
	status: ProvenanceStatus;
	source_kind: SourceKind;
	source_roots: string[];
	fingerprint?: SourceFingerprint;
}

export interface CoverageDiagnostic {
	code: string;
	path?: string;
	message?: string;
}

export interface ExtractionCoverage {
	status: CoverageStatus;
	discovered_files: number | null;
	consumed_files: number | null;
	skipped_files: number | null;
	failed_files: number | null;
	diagnostics: CoverageDiagnostic[];
}

export interface VersionedGraphMeta extends Record<string, unknown> {
	domain: "ue5_code";
	format_version: number;
	provenance?: SourceProvenance;
	coverage?: ExtractionCoverage;
	source_root?: string;
}

export interface VersionedGraphRecord {
	meta: VersionedGraphMeta;
	elements: unknown;
	[key: string]: unknown;
}

function normalizedRoot(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.replaceAll("\\", "/") : null;
}

/** All consumers use this resolver; only this function understands v1 source_root. */
export function graphSourceRoots(meta: Record<string, unknown> | null | undefined): string[] {
	if (!meta) return [];
	const provenance = meta.provenance as Partial<SourceProvenance> | undefined;
	if (Array.isArray(provenance?.source_roots)) {
		return [...new Set(provenance.source_roots.map(normalizedRoot).filter((root): root is string => Boolean(root)))];
	}
	return [...new Set(String(meta.source_root ?? "").split(";").map(normalizedRoot).filter((root): root is string => Boolean(root)))];
}

/** Stable adapter/server query shape retained while graph storage converges on provenance.source_roots. */
export function graphSourceRootQuery(meta: Record<string, unknown> | null | undefined): string {
	return graphSourceRoots(meta).join(";");
}

export function unknownGraphEvidence(
	sourceKind: SourceKind,
	sourceRoots: string[],
	diagnosticCode: string,
): { provenance: SourceProvenance; coverage: ExtractionCoverage } {
	return {
		provenance: {
			schema_version: SOURCE_PROVENANCE_SCHEMA_VERSION,
			status: "unknown",
			source_kind: sourceKind,
			source_roots: [...sourceRoots],
		},
		coverage: {
			status: "unknown",
			discovered_files: null,
			consumed_files: null,
			skipped_files: null,
			failed_files: null,
			diagnostics: [{ code: diagnosticCode }],
		},
	};
}

export interface GraphMigrationResult<T extends VersionedGraphRecord = VersionedGraphRecord> {
	graph: T;
	changed: boolean;
	from: number | null;
	to: number;
}

/** Deterministic and idempotent v1 -> v2 migration. It preserves roots but invents no provenance. */
export function migrateGraphToCurrent<T extends VersionedGraphRecord>(input: T): GraphMigrationResult<T> {
	if (input.meta.domain !== "ue5_code") throw new Error(`unsupported graph domain: ${String(input.meta.domain)}`);
	const from = Number.isFinite(Number(input.meta.format_version)) ? Number(input.meta.format_version) : null;
	if (from === UE5_CODE_GRAPH_FORMAT) return { graph: input, changed: false, from, to: UE5_CODE_GRAPH_FORMAT };
	if (from !== null && from !== 1) throw new Error(`unsupported ue5_code graph format: ${from}`);

	const roots = graphSourceRoots(input.meta);
	const migrated = structuredClone(input);
	const evidence = unknownGraphEvidence("unknown", roots, "legacy-v1-no-provenance-or-coverage");
	migrated.meta.format_version = UE5_CODE_GRAPH_FORMAT;
	migrated.meta.provenance = evidence.provenance;
	migrated.meta.coverage = evidence.coverage;
	delete migrated.meta.source_root;
	return { graph: migrated, changed: true, from, to: UE5_CODE_GRAPH_FORMAT };
}

/** Explicit exit path for rollback tools; new v2-only evidence is intentionally dropped. */
export function downgradeGraphToV1<T extends VersionedGraphRecord>(input: T): GraphMigrationResult<T> {
	const from = Number.isFinite(Number(input.meta.format_version)) ? Number(input.meta.format_version) : null;
	if (from === 1) return { graph: input, changed: false, from, to: 1 };
	if (from !== UE5_CODE_GRAPH_FORMAT) throw new Error(`unsupported ue5_code graph format: ${String(from)}`);
	const downgraded = structuredClone(input);
	const roots = graphSourceRoots(downgraded.meta);
	downgraded.meta.format_version = 1;
	if (roots.length > 0) downgraded.meta.source_root = roots.join(";");
	else delete downgraded.meta.source_root;
	delete downgraded.meta.provenance;
	delete downgraded.meta.coverage;
	return { graph: downgraded, changed: true, from, to: 1 };
}
