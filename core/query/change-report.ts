// Pure, versioned graph diff + one-hop impact report. Graph files remain the canonical facts.
import type { GraphFile, GraphNode, GraphEdge } from "../../adapters/adapter-interface.js";
import { stableValueEqual } from "../../adapters/diff-lib.js";
import { resolveCodeModule, UNASSIGNED_MODULE_LABEL } from "./code-module.js";

export const CHANGE_REPORT_FORMAT_VERSION = 1 as const;

export interface ChangeNodeSummary {
	id: string;
	label: string;
	type: string;
	module: string | null;
	source_path: string | null;
	changed_fields?: string[];
}

export interface ChangeEdgeSummary {
	id: string;
	source: string;
	target: string;
	relation: string;
	changed_fields?: string[];
}

export interface ChangeReport {
	format_version: typeof CHANGE_REPORT_FORMAT_VERSION;
	domain: "ue5_code";
	subsystem: string;
	generated_at: string;
	generator: string;
	baseline: { file: string; generated_at: string | null; fingerprint: string | null };
	current: { file: string; generated_at: string | null; fingerprint: string | null };
	summary: {
		nodes: { added: number; removed: number; changed: number };
		edges: { added: number; removed: number; changed: number };
		direct_nodes: number;
		affected_nodes: number;
		affected_modules: number;
	};
	changes: {
		added_nodes: ChangeNodeSummary[];
		removed_nodes: ChangeNodeSummary[];
		changed_nodes: ChangeNodeSummary[];
		added_edges: ChangeEdgeSummary[];
		removed_edges: ChangeEdgeSummary[];
		changed_edges: ChangeEdgeSummary[];
	};
	impact: {
		direct_node_ids: string[];
		affected_node_ids: string[];
		modules: Array<{ module: string; direct: number; affected: number }>;
	};
}

export function hasChangeSummaryFacts(summary: ChangeReport["summary"]): boolean {
	return summary.nodes.added + summary.nodes.removed + summary.nodes.changed
		+ summary.edges.added + summary.edges.removed + summary.edges.changed > 0;
}

function duplicateIds(items: readonly { id: string }[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const item of items) {
		if (seen.has(item.id)) duplicates.add(item.id);
		seen.add(item.id);
	}
	return [...duplicates].sort();
}

function sameIds(actual: readonly string[], expected: ReadonlySet<string>): boolean {
	return actual.length === expected.size && actual.every((id) => expected.has(id));
}

/** Cross-field invariants for the redundant summaries stored in report format v1. */
export function checkChangeReportConsistency(report: ChangeReport): string[] {
	const errors: string[] = [];
	const nodeGroups = [report.changes.added_nodes, report.changes.removed_nodes, report.changes.changed_nodes] as const;
	const edgeGroups = [report.changes.added_edges, report.changes.removed_edges, report.changes.changed_edges] as const;
	const nodeCounts = report.summary.nodes;
	const edgeCounts = report.summary.edges;
	const expectedNodeCounts = [nodeCounts.added, nodeCounts.removed, nodeCounts.changed];
	const expectedEdgeCounts = [edgeCounts.added, edgeCounts.removed, edgeCounts.changed];
	for (let index = 0; index < nodeGroups.length; index += 1) {
		if (nodeGroups[index].length !== expectedNodeCounts[index]) errors.push(`summary.nodes 与变化数组不一致（index ${index}）`);
	}
	for (let index = 0; index < edgeGroups.length; index += 1) {
		if (edgeGroups[index].length !== expectedEdgeCounts[index]) errors.push(`summary.edges 与变化数组不一致（index ${index}）`);
	}

	const allNodes = nodeGroups.flat();
	const allEdges = edgeGroups.flat();
	const duplicateNodeIds = duplicateIds(allNodes);
	const duplicateEdgeIds = duplicateIds(allEdges);
	if (duplicateNodeIds.length > 0) errors.push(`节点同时出现在多个变化类别或重复：${duplicateNodeIds.join(", ")}`);
	if (duplicateEdgeIds.length > 0) errors.push(`关系同时出现在多个变化类别或重复：${duplicateEdgeIds.join(", ")}`);
	for (const node of report.changes.changed_nodes) {
		if (!node.changed_fields?.length) errors.push(`修改节点缺少 changed_fields：${node.id}`);
	}
	for (const edge of report.changes.changed_edges) {
		if (!edge.changed_fields?.length) errors.push(`修改关系缺少 changed_fields：${edge.id}`);
	}

	const directIds = new Set(allNodes.map((node) => node.id));
	const affectedIds = new Set(report.impact.affected_node_ids);
	if (!sameIds(report.impact.direct_node_ids, directIds)) errors.push("impact.direct_node_ids 与节点变化不一致");
	if (report.summary.direct_nodes !== directIds.size) errors.push("summary.direct_nodes 与节点变化不一致");
	if (report.summary.affected_nodes !== affectedIds.size) errors.push("summary.affected_nodes 与 impact.affected_node_ids 不一致");
	const overlap = [...affectedIds].filter((id) => directIds.has(id));
	if (overlap.length > 0) errors.push(`直接节点与一跳影响节点重叠：${overlap.sort().join(", ")}`);
	if (report.summary.affected_modules !== report.impact.modules.length) errors.push("summary.affected_modules 与 impact.modules 不一致");
	const moduleNames = new Set<string>();
	let moduleDirect = 0;
	let moduleAffected = 0;
	for (const item of report.impact.modules) {
		if (moduleNames.has(item.module)) errors.push(`影响模块重复：${item.module}`);
		moduleNames.add(item.module);
		if (item.direct === 0 && item.affected === 0) errors.push(`影响模块没有事实计数：${item.module}`);
		moduleDirect += item.direct;
		moduleAffected += item.affected;
	}
	if (moduleDirect !== directIds.size) errors.push("impact.modules 的 direct 总数不一致");
	if (moduleAffected !== affectedIds.size) errors.push("impact.modules 的 affected 总数不一致");
	return errors;
}

function fingerprint(graph: GraphFile): string | null {
	const provenance = graph.meta.provenance as { fingerprint?: { value?: unknown } } | undefined;
	return typeof provenance?.fingerprint?.value === "string" ? provenance.fingerprint.value : null;
}

function generatedAt(graph: GraphFile): string | null {
	return typeof graph.meta.generated_at === "string" ? graph.meta.generated_at : null;
}

function semanticData(data: Record<string, unknown>): Record<string, unknown> {
	const copy = { ...data };
	delete copy.metrics;
	return copy;
}

function changedFields(previous: Record<string, unknown>, current: Record<string, unknown>): string[] {
	const before = semanticData(previous);
	const after = semanticData(current);
	return [...new Set([...Object.keys(before), ...Object.keys(after)])]
		.filter((key) => !stableValueEqual(before[key], after[key]))
		.sort();
}

function nodeSummary(node: GraphNode, fields?: string[]): ChangeNodeSummary {
	return {
		id: String(node.data.id),
		label: String(node.data.label ?? node.data.id),
		type: String(node.data.type ?? "unknown"),
		module: resolveCodeModule(node.data),
		source_path: typeof node.data.source_path === "string" ? node.data.source_path : null,
		...(fields?.length ? { changed_fields: fields } : {}),
	};
}

function edgeSummary(edge: GraphEdge, fields?: string[]): ChangeEdgeSummary {
	return {
		id: String(edge.data.id),
		source: String(edge.data.source),
		target: String(edge.data.target),
		relation: String(edge.data.relation ?? "unknown"),
		...(fields?.length ? { changed_fields: fields } : {}),
	};
}

function byId<T extends { data: { id: string } }>(items: T[], label: string): Map<string, T> {
	const result = new Map<string, T>();
	for (const item of items) {
		const id = String(item.data.id);
		if (result.has(id)) throw new Error(`${label} 包含重复 id: ${id}`);
		result.set(id, item);
	}
	return result;
}

function assertSeparateIdentities(nodes: ReadonlyMap<string, unknown>, edges: ReadonlyMap<string, unknown>, label: string): void {
	for (const id of nodes.keys()) if (edges.has(id)) throw new Error(`${label} 的节点与关系 id 冲突: ${id}`);
}

/** 悬垂关系端点会让一跳影响面给两图都不存在的节点产出幽灵 affected 行（module 记为
 *  (unassigned)），且事后无法从报告本身检出——语义判断者必须在入口拒绝。 */
function assertEdgesResolve(nodes: ReadonlyMap<string, unknown>, edges: ReadonlyMap<string, GraphEdge>, label: string): void {
	for (const edge of edges.values()) {
		for (const endpoint of [edge.data.source, edge.data.target]) {
			if (!nodes.has(String(endpoint))) {
				throw new Error(`${label} 存在端点未解析的关系: ${String(edge.data.id)} → ${String(endpoint)}`);
			}
		}
	}
}

export function buildChangeReport(
	baseline: GraphFile,
	current: GraphFile,
	options: { baselineFile: string; currentFile: string; generatedAt?: string },
): ChangeReport {
	if (baseline.meta.domain !== "ue5_code" || current.meta.domain !== "ue5_code") throw new Error("change reports only accept ue5_code graphs");
	const baselineNodes = byId(baseline.elements.nodes, "基线节点");
	const currentNodes = byId(current.elements.nodes, "当前节点");
	const baselineEdges = byId(baseline.elements.edges, "基线关系");
	const currentEdges = byId(current.elements.edges, "当前关系");
	assertSeparateIdentities(baselineNodes, baselineEdges, "基线");
	assertSeparateIdentities(currentNodes, currentEdges, "当前快照");
	assertEdgesResolve(baselineNodes, baselineEdges, "基线");
	assertEdgesResolve(currentNodes, currentEdges, "当前快照");
	const addedNodes = [...currentNodes].filter(([id]) => !baselineNodes.has(id)).map(([, node]) => nodeSummary(node));
	const removedNodes = [...baselineNodes].filter(([id]) => !currentNodes.has(id)).map(([, node]) => nodeSummary(node));
	const changedNodes = [...currentNodes].flatMap(([id, node]) => {
		const before = baselineNodes.get(id);
		if (!before) return [];
		const fields = changedFields(before.data, node.data);
		return fields.length > 0 ? [nodeSummary(node, fields)] : [];
	});
	const addedEdges = [...currentEdges].filter(([id]) => !baselineEdges.has(id)).map(([, edge]) => edgeSummary(edge));
	const removedEdges = [...baselineEdges].filter(([id]) => !currentEdges.has(id)).map(([, edge]) => edgeSummary(edge));
	const changedEdges = [...currentEdges].flatMap(([id, edge]) => {
		const before = baselineEdges.get(id);
		if (!before) return [];
		const fields = changedFields(before.data, edge.data);
		return fields.length > 0 ? [edgeSummary(edge, fields)] : [];
	});
	for (const group of [addedNodes, removedNodes, changedNodes]) group.sort((a, b) => a.id.localeCompare(b.id));
	for (const group of [addedEdges, removedEdges, changedEdges]) group.sort((a, b) => a.id.localeCompare(b.id));

	const direct = new Set([...addedNodes, ...removedNodes, ...changedNodes].map((node) => node.id));
	const affected = new Set<string>();
	const collectNeighbors = (edges: GraphEdge[]) => {
		for (const edge of edges) {
			const source = String(edge.data.source);
			const target = String(edge.data.target);
			if (direct.has(source) && !direct.has(target)) affected.add(target);
			if (direct.has(target) && !direct.has(source)) affected.add(source);
		}
	};
	collectNeighbors(baseline.elements.edges);
	collectNeighbors(current.elements.edges);

	const moduleCounts = new Map<string, { direct: Set<string>; affected: Set<string> }>();
	const countNode = (id: string, bucket: "direct" | "affected") => {
		const node = currentNodes.get(id) ?? baselineNodes.get(id);
		const module = node ? resolveCodeModule(node.data) ?? UNASSIGNED_MODULE_LABEL : UNASSIGNED_MODULE_LABEL;
		const counts = moduleCounts.get(module) ?? { direct: new Set<string>(), affected: new Set<string>() };
		counts[bucket].add(id);
		moduleCounts.set(module, counts);
	};
	for (const id of direct) countNode(id, "direct");
	for (const id of affected) countNode(id, "affected");
	const modules = [...moduleCounts].map(([module, counts]) => ({ module, direct: counts.direct.size, affected: counts.affected.size }))
		.sort((a, b) => b.direct - a.direct || b.affected - a.affected || a.module.localeCompare(b.module));

	return {
		format_version: CHANGE_REPORT_FORMAT_VERSION,
		domain: "ue5_code",
		subsystem: String(current.meta.subsystem ?? baseline.meta.subsystem ?? "unknown"),
		generated_at: options.generatedAt ?? new Date().toISOString(),
		generator: "graphbrain/change-report@1",
		baseline: { file: options.baselineFile, generated_at: generatedAt(baseline), fingerprint: fingerprint(baseline) },
		current: { file: options.currentFile, generated_at: generatedAt(current), fingerprint: fingerprint(current) },
		summary: {
			nodes: { added: addedNodes.length, removed: removedNodes.length, changed: changedNodes.length },
			edges: { added: addedEdges.length, removed: removedEdges.length, changed: changedEdges.length },
			direct_nodes: direct.size,
			affected_nodes: affected.size,
			affected_modules: modules.length,
		},
		changes: { added_nodes: addedNodes, removed_nodes: removedNodes, changed_nodes: changedNodes, added_edges: addedEdges, removed_edges: removedEdges, changed_edges: changedEdges },
		impact: { direct_node_ids: [...direct].sort(), affected_node_ids: [...affected].sort(), modules },
	};
}
