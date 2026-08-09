// Graph Brain / adapters - ue5_code 增量 diff：新旧图做稳定 id 级比对
//
// added/removed 按元素 id 集合差；modified = 同 id 但 data 深比较不等（含 metrics 度数
// 变化——邻居增删会波及未变文件的类，这正是"手术式增量"难做对的原因，见 ue5-code/
// parse-cache.ts 的 DECISION）。比对只看 elements，meta（generated_at 等）本就每次重生成。
// ue5_code 缓存重组装共用本模块。

import type { DiffResult, GraphFile } from "./adapter-interface.js";

function canonicalJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJsonValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => [key, canonicalJsonValue(item)]));
}

/** Persisted graph objects are JSON values; object member order is not semantic. */
export function stableValueEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
}

export function diffGraphs(oldGraph: GraphFile, newGraph: GraphFile): DiffResult {
	const oldNodes = new Map(oldGraph.elements.nodes.map((n) => [n.data.id, n]));
	const oldEdges = new Map(oldGraph.elements.edges.map((e) => [e.data.id, e]));
	const newNodes = new Map(newGraph.elements.nodes.map((n) => [n.data.id, n]));
	const newEdges = new Map(newGraph.elements.edges.map((e) => [e.data.id, e]));

	const result: DiffResult = {
		added: { nodes: [], edges: [] },
		removed: { nodeIds: [], edgeIds: [] },
		modified: { nodes: [], edges: [] },
	};

	for (const [id, node] of newNodes) {
		const old = oldNodes.get(id);
		if (!old) result.added.nodes.push(node);
		else if (!stableValueEqual(old, node)) result.modified.nodes.push(node);
	}
	for (const id of oldNodes.keys()) {
		if (!newNodes.has(id)) result.removed.nodeIds.push(id);
	}
	for (const [id, edge] of newEdges) {
		const old = oldEdges.get(id);
		if (!old) result.added.edges.push(edge);
		else if (!stableValueEqual(old, edge)) result.modified.edges.push(edge);
	}
	for (const id of oldEdges.keys()) {
		if (!newEdges.has(id)) result.removed.edgeIds.push(id);
	}
	return result;
}

export function summarizeDiff(diff: DiffResult): string {
	return (
		`节点 +${diff.added.nodes.length} / -${diff.removed.nodeIds.length} / ~${diff.modified.nodes.length}，` +
		`边 +${diff.added.edges.length} / -${diff.removed.edgeIds.length} / ~${diff.modified.edges.length}`
	);
}
