// Stable, read-only Evidence API projections over the canonical graph/change owners.
// This module persists nothing and deliberately does not introduce a second node model.
import type { GraphEdge, GraphFile, GraphNode } from "../../adapters/adapter-interface.js";
import type { ChangeReport, ChangeNodeSummary, ChangeEdgeSummary } from "../query/change-report.js";
import { changeReportQueryIndex } from "../query/change-report-query.js";
import { resolveCodeModule } from "../query/code-module.js";
import type { EvidenceRuntimeGraph } from "../schema/evidence-snapshot-v3.js";
import type { EvidenceStatus } from "./status.js";

export const EVIDENCE_QUERY_FORMAT = "graphbrain-evidence-query/1" as const;

/** 查询消费的图形态：v3 运行时投影（join 唯一构造，format_version=3 非持久化格式）
 *  或 v2 兼容路径的持久化 GraphFile。两者都只从 resolver 进入查询链路。 */
export type EvidenceQueryGraph = GraphFile | EvidenceRuntimeGraph;
export type EvidenceClassification = "direct" | "derived";

export interface EvidenceFactProvenance {
	classification: EvidenceClassification;
	method: "direct" | "heuristic" | "unknown";
	confidence: number | null;
	capability: string | null;
	diagnostic: string | null;
}

export interface EvidenceSourceReference {
	path: string | null;
	span: { start_line: number; end_line: number } | null;
}

export interface EvidenceSymbolSummary {
	id: string;
	label: string;
	type: string;
	module: string | null;
	layer: string | null;
	parent_id: string | null;
	source: EvidenceSourceReference;
	evidence: EvidenceFactProvenance;
}

export interface EvidenceRelation {
	id: string;
	source_id: string;
	target_id: string;
	relation: string;
	evidence: EvidenceFactProvenance;
}

export interface EvidenceEnvelope {
	format_version: typeof EVIDENCE_QUERY_FORMAT;
	kind: string;
	evidence_status: Pick<EvidenceStatus,
		"publication_revision" | "snapshot_id" | "source_fingerprint" | "freshness" | "freshness_reason" | "coverage" | "extractor" | "engine">;
}

const DETAIL_FIELDS = [
	"description", "tags", "api", "inheritance_chain", "bases", "cpp_kind",
	"data_members", "cpp_declarations", "interfaces", "visibility", "system",
] as const;

function cleanString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.replaceAll("\\", "/") : null;
}

function sourceReference(node: GraphNode): EvidenceSourceReference {
	const persisted = node.data.evidence as { source?: { path?: unknown; span?: { start_line?: unknown; end_line?: unknown } | null } } | undefined;
	const span = persisted?.source?.span;
	return {
		path: cleanString(persisted?.source?.path) ?? cleanString(node.data.source_path),
		span: span && Number.isSafeInteger(span.start_line) && Number.isSafeInteger(span.end_line)
			? { start_line: Number(span.start_line), end_line: Number(span.end_line) }
			: null,
	};
}

function nodeEvidence(node: GraphNode): EvidenceFactProvenance {
	const persisted = persistedEvidence(node.data.evidence);
	if (persisted) return persisted;
	if (sourceReference(node).path) return { classification: "direct", method: "direct", confidence: 1, capability: "declarations", diagnostic: null };
	return {
		classification: "derived",
		method: "unknown",
		confidence: null,
		capability: null,
		diagnostic: "graph-v2-node-has-no-source-location",
	};
}

function persistedEvidence(value: unknown): EvidenceFactProvenance | null {
	if (!value || typeof value !== "object") return null;
	const item = value as { classification?: unknown; confidence?: unknown; capability?: unknown; diagnostic?: unknown };
	if (!["direct", "heuristic", "unknown"].includes(String(item.classification))) return null;
	const method = item.classification as "direct" | "heuristic" | "unknown";
	return {
		classification: method === "direct" ? "direct" : "derived",
		method,
		confidence: typeof item.confidence === "number" ? item.confidence : null,
		capability: typeof item.capability === "string" ? item.capability : null,
		diagnostic: typeof item.diagnostic === "string" ? item.diagnostic : null,
	};
}

function edgeEvidence(edge: GraphEdge): EvidenceFactProvenance {
	const persisted = persistedEvidence(edge.data.evidence);
	if (persisted) return persisted;
	return {
		classification: "derived",
		method: "unknown",
		confidence: null,
		capability: null,
		diagnostic: "graph-v2-relation-provenance-not-persisted",
	};
}

export function evidenceEnvelope(status: EvidenceStatus, kind: string): EvidenceEnvelope {
	return {
		format_version: EVIDENCE_QUERY_FORMAT,
		kind,
		evidence_status: {
			publication_revision: status.publication_revision,
			snapshot_id: status.snapshot_id,
			source_fingerprint: status.source_fingerprint,
			freshness: status.freshness,
			freshness_reason: status.freshness_reason,
			coverage: status.coverage,
			extractor: status.extractor,
			engine: status.engine,
		},
	};
}

export function evidenceSymbolSummary(node: GraphNode): EvidenceSymbolSummary {
	return {
		id: node.data.id,
		label: node.data.label,
		type: node.data.type,
		module: resolveCodeModule(node.data),
		layer: cleanString(node.data.layer),
		parent_id: cleanString(node.data.parent),
		source: sourceReference(node),
		evidence: nodeEvidence(node),
	};
}

export function evidenceRelation(edge: GraphEdge): EvidenceRelation {
	return {
		id: edge.data.id,
		source_id: edge.data.source,
		target_id: edge.data.target,
		relation: edge.data.relation,
		evidence: edgeEvidence(edge),
	};
}

function bySymbol(left: EvidenceSymbolSummary, right: EvidenceSymbolSummary): number {
	return left.label.localeCompare(right.label) || left.type.localeCompare(right.type) || left.id.localeCompare(right.id);
}

function byRelation(left: EvidenceRelation, right: EvidenceRelation): number {
	return left.relation.localeCompare(right.relation) || left.source_id.localeCompare(right.source_id)
		|| left.target_id.localeCompare(right.target_id) || left.id.localeCompare(right.id);
}

export interface EvidenceSymbolSearchQuery {
	text?: string | null;
	type?: string | null;
	module?: string | null;
	layer?: string | null;
	limit?: number;
}

export function searchEvidenceSymbols(graph: EvidenceQueryGraph, query: EvidenceSymbolSearchQuery = {}) {
	const text = query.text?.trim().toLocaleLowerCase() ?? "";
	const type = query.type?.trim().toLocaleLowerCase() ?? "";
	const module = query.module?.trim().toLocaleLowerCase() ?? "";
	const layer = query.layer?.trim().toLocaleLowerCase() ?? "";
	const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
	const matches = graph.elements.nodes.filter((node) => {
		const summary = evidenceSymbolSummary(node);
		if (type && summary.type.toLocaleLowerCase() !== type) return false;
		if (module && summary.module?.toLocaleLowerCase() !== module) return false;
		if (layer && summary.layer?.toLocaleLowerCase() !== layer) return false;
		if (!text) return true;
		return [summary.id, summary.label, summary.module, summary.source.path]
			.some((value) => value?.toLocaleLowerCase().includes(text));
	});
	const results = matches.map(evidenceSymbolSummary).sort(bySymbol);
	return { total: results.length, limit, truncated: results.length > limit, symbols: results.slice(0, limit) };
}

export function evidenceSymbolDetail(graph: EvidenceQueryGraph, id: string) {
	const node = graph.elements.nodes.find((item) => item.data.id === id);
	if (!node) return null;
	const attributes: Record<string, unknown> = {};
	for (const field of DETAIL_FIELDS) if (node.data[field] !== undefined) attributes[field] = structuredClone(node.data[field]);
	return { ...evidenceSymbolSummary(node), attributes };
}

export function evidenceNeighborhood(graph: EvidenceQueryGraph, id: string) {
	const center = graph.elements.nodes.find((node) => node.data.id === id);
	if (!center) return null;
	const edges = graph.elements.edges.filter((edge) => edge.data.source === id || edge.data.target === id);
	const nodeIds = new Set<string>([id]);
	for (const edge of edges) {
		nodeIds.add(edge.data.source);
		nodeIds.add(edge.data.target);
	}
	const symbols = graph.elements.nodes.filter((node) => nodeIds.has(node.data.id)).map(evidenceSymbolSummary).sort(bySymbol);
	return {
		center_id: id,
		depth: 1 as const,
		symbols,
		relations: edges.map(evidenceRelation).sort(byRelation),
	};
}

export interface EvidenceChangesQuery {
	kind?: "all" | "added" | "changed" | "removed";
	module?: string | null;
	type?: string | null;
	limit?: number;
}

type ChangeKind = Exclude<EvidenceChangesQuery["kind"], "all" | undefined>;

function changeNodeEvidence(node: ChangeNodeSummary, kind: ChangeKind) {
	return {
		kind,
		id: node.id,
		label: node.label,
		type: node.type,
		module: node.module,
		source: { path: cleanString(node.source_path), span: null },
		changed_fields: node.changed_fields ?? [],
		evidence: {
			classification: cleanString(node.source_path) ? "direct" : "derived",
			method: cleanString(node.source_path) ? "direct" : "unknown",
			confidence: cleanString(node.source_path) ? 1 : null,
			capability: cleanString(node.source_path) ? "declarations" : null,
			diagnostic: cleanString(node.source_path) ? null : "change-report-node-has-no-source-location",
		} satisfies EvidenceFactProvenance,
	};
}

function changeEdgeEvidence(edge: ChangeEdgeSummary, kind: ChangeKind) {
	return {
		kind,
		id: edge.id,
		source_id: edge.source,
		target_id: edge.target,
		relation: edge.relation,
		changed_fields: edge.changed_fields ?? [],
		evidence: {
			classification: "derived",
			method: "unknown",
			confidence: null,
			capability: null,
			diagnostic: "change-report-v1-relation-provenance-not-persisted",
		} satisfies EvidenceFactProvenance,
	};
}

export function queryEvidenceChanges(report: ChangeReport, query: EvidenceChangesQuery = {}) {
	const index = changeReportQueryIndex(report);
	const tabs: ChangeKind[] = query.kind && query.kind !== "all" ? [query.kind] : ["added", "changed", "removed"];
	const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
	// 节点来自 index.selectNodes({ tab })，其变化类别恒等于 tab——逐节点回扫
	// added/removed 数组是 O(变化数²)，50k 级事实会把该端点拖到数十秒。
	const nodes = tabs.flatMap((tab) => index.selectNodes({
		tab,
		scope: "all",
		module: query.module?.trim() || "*",
		nodeType: query.type?.trim() || null,
	}).visibleNodes.map((node) => changeNodeEvidence(node, tab)));
	const edgeGroups = {
		added: report.changes.added_edges,
		changed: report.changes.changed_edges,
		removed: report.changes.removed_edges,
	};
	const relations = tabs.flatMap((tab) => edgeGroups[tab].map((edge) => changeEdgeEvidence(edge, tab)));
	return {
		report: {
			generated_at: report.generated_at,
			generator: report.generator,
			baseline: report.baseline,
			current: report.current,
			summary: report.summary,
			impact: report.impact,
		},
		selection: { kind: query.kind ?? "all", module: query.module ?? null, type: query.type ?? null, limit },
		total_nodes: nodes.length,
		total_relations: relations.length,
		truncated: nodes.length > limit || relations.length > limit,
		nodes: nodes.slice(0, limit),
		relations: relations.slice(0, limit),
	};
}
