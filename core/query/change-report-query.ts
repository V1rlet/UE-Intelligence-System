// Disposable query index for immutable ChangeReport facts.
// The report remains the only persisted owner; this index stores derived references only.
import type { ChangeEdgeSummary, ChangeNodeSummary, ChangeReport } from "./change-report.js";

export type ChangeQueryTab = "added" | "changed" | "removed" | "impact";
export type ChangeQueryScope = "code" | "structure" | "all";
export type ChangeRelationKind = "added" | "changed" | "removed";

export interface ChangeRelationEvidence {
	kind: ChangeRelationKind;
	edge: ChangeEdgeSummary;
}

export interface ChangeNodeSelection {
	scopedNodes: readonly ChangeNodeSummary[];
	visibleNodes: readonly ChangeNodeSummary[];
	nodeTypeCounts: ReadonlyArray<readonly [string, number]>;
	changedFieldCounts: ReadonlyArray<readonly [string, number]>;
}

export interface ChangeNodeQuery {
	tab: ChangeQueryTab;
	scope: ChangeQueryScope;
	module: string | null;
	nodeType: string | null;
}

const STRUCTURAL_NODE_TYPES = new Set(["folder", "file"]);
const NODE_TYPE_PRIORITY = new Map([
	["uclass", 0], ["uinterface", 1], ["ustruct", 2], ["uenum", 3], ["uactor", 4], ["ucomponent", 5],
	["ufunction", 10], ["file", 20], ["folder", 21],
]);

function orderedNodes(nodes: readonly ChangeNodeSummary[]): ChangeNodeSummary[] {
	return [...nodes].sort((left, right) =>
		(NODE_TYPE_PRIORITY.get(left.type) ?? 15) - (NODE_TYPE_PRIORITY.get(right.type) ?? 15)
		|| (left.module ?? "").localeCompare(right.module ?? "")
		|| left.label.localeCompare(right.label)
		|| left.id.localeCompare(right.id));
}

function allChangedNodes(report: ChangeReport): ChangeNodeSummary[] {
	return [...report.changes.added_nodes, ...report.changes.changed_nodes, ...report.changes.removed_nodes];
}

function selectionKey(query: ChangeNodeQuery): string {
	return [query.tab, query.scope, query.module ?? "<default>", query.nodeType ?? "<all-types>"].join("\u0000");
}

export class ChangeReportQueryIndex {
	readonly modules: readonly string[];
	readonly preferredModule: string;
	readonly nodeLabels: ReadonlyMap<string, string>;
	readonly relationEvidenceByNode: ReadonlyMap<string, readonly ChangeRelationEvidence[]>;
	private readonly selectionCache = new Map<string, ChangeNodeSelection>();
	private readonly nodesByTab: Record<Exclude<ChangeQueryTab, "impact">, readonly ChangeNodeSummary[]>;

	constructor(readonly report: ChangeReport) {
		const allNodes = allChangedNodes(report);
		this.modules = [...new Set(allNodes.map((node) => node.module).filter((module): module is string => Boolean(module)))].sort();
		const changedModules = new Set(this.modules);
		this.preferredModule = report.impact.modules
			.find((item) => item.module !== "(unassigned)" && changedModules.has(item.module))
			?.module ?? "";
		this.nodeLabels = new Map(allNodes.map((node) => [node.id, node.label || node.id]));
		this.nodesByTab = {
			added: orderedNodes(report.changes.added_nodes),
			changed: orderedNodes(report.changes.changed_nodes),
			removed: orderedNodes(report.changes.removed_nodes),
		};

		const evidence = new Map<string, ChangeRelationEvidence[]>();
		const addEvidence = (kind: ChangeRelationKind, edge: ChangeEdgeSummary) => {
			for (const id of new Set([edge.source, edge.target])) {
				const items = evidence.get(id);
				if (items) items.push({ kind, edge });
				else evidence.set(id, [{ kind, edge }]);
			}
		};
		for (const edge of report.changes.added_edges) addEvidence("added", edge);
		for (const edge of report.changes.changed_edges) addEvidence("changed", edge);
		for (const edge of report.changes.removed_edges) addEvidence("removed", edge);
		this.relationEvidenceByNode = evidence;
	}

	selectNodes(query: ChangeNodeQuery): ChangeNodeSelection {
		const key = selectionKey(query);
		const cached = this.selectionCache.get(key);
		if (cached) return cached;
		if (query.tab === "impact") {
			const empty = { scopedNodes: [], visibleNodes: [], nodeTypeCounts: [], changedFieldCounts: [] } satisfies ChangeNodeSelection;
			this.selectionCache.set(key, empty);
			return empty;
		}

		const module = query.module === "*" ? null : (query.module ?? this.preferredModule) || null;
		const scopedNodes = this.nodesByTab[query.tab].filter((node) => {
			const structural = STRUCTURAL_NODE_TYPES.has(node.type);
			if (query.scope === "code" && structural) return false;
			if (query.scope === "structure" && !structural) return false;
			return !module || node.module === module;
		});
		const counts = new Map<string, number>();
		for (const node of scopedNodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
		const nodeTypeCounts = [...counts]
			.sort(([left], [right]) => (NODE_TYPE_PRIORITY.get(left) ?? 15) - (NODE_TYPE_PRIORITY.get(right) ?? 15) || left.localeCompare(right));
		const visibleNodes = query.nodeType ? scopedNodes.filter((node) => node.type === query.nodeType) : scopedNodes;
		const fields = new Map<string, number>();
		for (const node of visibleNodes) for (const field of node.changed_fields ?? []) fields.set(field, (fields.get(field) ?? 0) + 1);
		const changedFieldCounts = [...fields].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
		const selection = { scopedNodes, visibleNodes, nodeTypeCounts, changedFieldCounts } satisfies ChangeNodeSelection;
		this.selectionCache.set(key, selection);
		return selection;
	}
}

const INDEX_CACHE = new WeakMap<ChangeReport, ChangeReportQueryIndex>();

export function changeReportQueryIndex(report: ChangeReport): ChangeReportQueryIndex {
	const cached = INDEX_CACHE.get(report);
	if (cached) return cached;
	const index = new ChangeReportQueryIndex(report);
	INDEX_CACHE.set(report, index);
	return index;
}

export function asChangeReportQueryIndex(reportOrIndex: ChangeReport | ChangeReportQueryIndex): ChangeReportQueryIndex {
	return reportOrIndex instanceof ChangeReportQueryIndex ? reportOrIndex : changeReportQueryIndex(reportOrIndex);
}
