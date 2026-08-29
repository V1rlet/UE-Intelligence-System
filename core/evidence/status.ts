import packageJson from "../../package.json";
import type { GraphCatalogEntry, GraphFreshness } from "../schema/graph-catalog.js";
import type { CoverageDiagnostic, CoverageStatus, SourceFingerprint } from "../schema/graph-version.js";
import type { PublishedGeneration } from "../store/data-publication.js";
import { resolveEvidenceExtractor, type EvidenceExtractor } from "./extractor-registry.js";

export const EVIDENCE_STATUS_FORMAT = "graphbrain-evidence-status/1" as const;
export const MAX_EVIDENCE_DIAGNOSTICS = 20;

export type EvidenceFreshnessReason = GraphCatalogEntry["freshness_reason"]
	| "publication-state-invalid"
	| "publication-missing"
	| "active-snapshot-unavailable"
	| "publication-catalog-mismatch";

export interface EvidenceDiagnostic {
	code: string;
	path?: string;
	message?: string;
}

export interface EvidenceCoverage {
	status: CoverageStatus;
	discovered_files: number | null;
	consumed_files: number | null;
	skipped_files: number | null;
	failed_files: number | null;
	diagnostics: EvidenceDiagnostic[];
	diagnostics_truncated: number;
}

export interface EvidenceStatus {
	format_version: typeof EVIDENCE_STATUS_FORMAT;
	service_version: string;
	publication_revision: number | null;
	snapshot_id: string | null;
	source_fingerprint: SourceFingerprint | null;
	freshness: GraphFreshness;
	freshness_reason: EvidenceFreshnessReason;
	coverage: EvidenceCoverage;
	extractor: EvidenceExtractor;
	engine: {
		version: string | null;
		root_identity: string | null;
		status: "verified" | "unverified";
	};
}

export interface EvidenceGateDecision {
	require_fresh: boolean;
	allowed: boolean;
	code: "EVIDENCE_STALE" | "EVIDENCE_UNVERIFIED" | null;
	diagnostic: string | null;
}

function cleanDiagnostic(item: CoverageDiagnostic): EvidenceDiagnostic {
	const path = item.path?.replaceAll("\\", "/");
	const safePath = path && !/^(?:[A-Za-z]:\/|\/)/.test(path) ? path : undefined;
	return {
		code: item.code,
		...(safePath ? { path: safePath } : {}),
		...(item.message ? { message: item.message.slice(0, 300) } : {}),
	};
}

function boundedDiagnostics(items: CoverageDiagnostic[]): Pick<EvidenceCoverage, "diagnostics" | "diagnostics_truncated"> {
	const unique = [...new Map(items.map((item) => [`${item.code}\0${item.path ?? ""}\0${item.message ?? ""}`, item])).values()];
	return {
		diagnostics: unique.slice(0, MAX_EVIDENCE_DIAGNOSTICS).map(cleanDiagnostic),
		diagnostics_truncated: Math.max(0, unique.length - MAX_EVIDENCE_DIAGNOSTICS),
	};
}

function coverage(entry: GraphCatalogEntry | null, extraDiagnostics: CoverageDiagnostic[]): EvidenceCoverage {
	const items = [...(entry?.coverage_diagnostics ?? []), ...extraDiagnostics];
	const bounded = boundedDiagnostics(items);
	return {
		status: entry?.coverage_status ?? "unknown",
		discovered_files: entry?.coverage_discovered_files ?? null,
		consumed_files: entry?.coverage_consumed_files ?? null,
		skipped_files: entry?.coverage_skipped_files ?? null,
		failed_files: entry?.coverage_failed_files ?? null,
		...bounded,
		diagnostics_truncated: bounded.diagnostics_truncated + (entry?.coverage_diagnostics_truncated ?? 0),
	};
}

export interface BuildEvidenceStatusInput {
	publicationRevision: number | null;
	generation: PublishedGeneration | null;
	catalogEntry: GraphCatalogEntry | null;
	snapshotId?: string | null;
	engine?: EvidenceStatus["engine"];
	failureReason?: Extract<EvidenceFreshnessReason, "publication-state-invalid" | "publication-missing" | "active-snapshot-unavailable">;
	failureDiagnostic?: CoverageDiagnostic;
}

/** Pure contract boundary. Freshness itself remains owned by the graph catalog resolver. */
export function buildEvidenceStatus(input: BuildEvidenceStatusInput): EvidenceStatus {
	const entryMatches = Boolean(input.generation && input.catalogEntry?.file === input.generation.graph.file);
	let freshness: GraphFreshness = entryMatches ? input.catalogEntry!.freshness : "unverified";
	let freshnessReason: EvidenceFreshnessReason = entryMatches
		? input.catalogEntry!.freshness_reason
		: input.failureReason ?? (input.generation ? "active-snapshot-unavailable" : "publication-missing");
	const extraDiagnostics: CoverageDiagnostic[] = [];
	if (input.failureDiagnostic) extraDiagnostics.push(input.failureDiagnostic);
	if (input.generation && input.catalogEntry && !entryMatches) {
		freshness = "unverified";
		freshnessReason = "publication-catalog-mismatch";
		extraDiagnostics.push({ code: "publication-catalog-mismatch" });
	}
	if (!input.catalogEntry) extraDiagnostics.push({ code: freshnessReason });
	const extractor = resolveEvidenceExtractor(entryMatches ? input.catalogEntry!.generator : null);
	if (extractor.capabilities.length === 0) extraDiagnostics.push({ code: "extractor-capabilities-unverified" });
	const engine = input.engine ?? { version: null, root_identity: null, status: "unverified" as const };
	if (engine.status !== "verified") extraDiagnostics.push({ code: "engine-identity-unverified" });
	return {
		format_version: EVIDENCE_STATUS_FORMAT,
		service_version: packageJson.version,
		publication_revision: input.publicationRevision,
		snapshot_id: input.snapshotId === undefined ? input.generation?.id ?? null : input.snapshotId,
		source_fingerprint: entryMatches ? input.catalogEntry!.source_fingerprint ?? null : null,
		freshness,
		freshness_reason: freshnessReason,
		coverage: coverage(entryMatches ? input.catalogEntry : null, extraDiagnostics),
		extractor,
		engine,
	};
}

/** Automatic consumers fail closed by default; human read-only callers must opt out explicitly. */
export function assessEvidenceAccess(status: EvidenceStatus, requireFresh = true): EvidenceGateDecision {
	if (!requireFresh || status.freshness === "current") {
		return { require_fresh: requireFresh, allowed: true, code: null, diagnostic: null };
	}
	const stale = status.freshness === "stale";
	return {
		require_fresh: true,
		allowed: false,
		code: stale ? "EVIDENCE_STALE" : "EVIDENCE_UNVERIFIED",
		diagnostic: stale
			? `Evidence snapshot ${status.snapshot_id ?? "unknown"} is stale (${status.freshness_reason}).`
			: `Evidence snapshot ${status.snapshot_id ?? "unknown"} is unverified (${status.freshness_reason}).`,
	};
}
