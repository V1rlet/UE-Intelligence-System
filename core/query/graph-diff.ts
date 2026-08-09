// Pure structural/data diff used when an on-demand UE class is merged into the current code graph.
import { stableValueEqual } from "../../adapters/diff-lib.js";
export interface DiffElements {
	nodes: { data: { id?: string; label?: string; type?: string; [key: string]: unknown } }[];
	edges: { data: { id?: string; source?: string; target?: string; relation?: string; [key: string]: unknown } }[];
}

export interface GraphDiff {
	addedNodeIds: Set<string>;
	addedEdgeIds: Set<string>;
	removedNodes: { id: string; label: string; type: string }[];
	removedEdges: { id: string; source: string; target: string; relation: string }[];
}

export interface DetailedElementDiff {
	addedNodes: DiffElements["nodes"];
	removedNodeIds: string[];
	changedNodes: { id: string; data: Record<string, unknown> }[];
	addedEdges: DiffElements["edges"];
	removedEdgeIds: string[];
	changedEdges: { id: string; data: Record<string, unknown> }[];
}

export function diffGraphElementsDetailed(previous: DiffElements, current: DiffElements): DetailedElementDiff {
	const previousNodes = new Map(previous.nodes.map((node) => [String(node.data.id), node]));
	const previousEdges = new Map(previous.edges.map((edge) => [String(edge.data.id), edge]));
	const currentNodeIds = new Set(current.nodes.map((node) => String(node.data.id)));
	const currentEdgeIds = new Set(current.edges.map((edge) => String(edge.data.id)));
	const addedNodes: DiffElements["nodes"] = [];
	const changedNodes: DetailedElementDiff["changedNodes"] = [];
	for (const node of current.nodes) {
		const id = String(node.data.id);
		const before = previousNodes.get(id);
		if (!before) addedNodes.push(node);
		else if (!stableValueEqual(before.data, node.data)) changedNodes.push({ id, data: node.data });
	}
	const addedEdges: DiffElements["edges"] = [];
	const changedEdges: DetailedElementDiff["changedEdges"] = [];
	for (const edge of current.edges) {
		const id = String(edge.data.id);
		const before = previousEdges.get(id);
		if (!before) addedEdges.push(edge);
		else if (!stableValueEqual(before.data, edge.data)) changedEdges.push({ id, data: edge.data });
	}
	return {
		addedNodes,
		removedNodeIds: previous.nodes.filter((node) => !currentNodeIds.has(String(node.data.id))).map((node) => String(node.data.id)),
		changedNodes,
		addedEdges,
		removedEdgeIds: previous.edges.filter((edge) => !currentEdgeIds.has(String(edge.data.id))).map((edge) => String(edge.data.id)),
		changedEdges,
	};
}

export function diffGraphElements(previous: DiffElements, current: DiffElements): GraphDiff {
	const previousNodeIds = new Set(previous.nodes.map((node) => String(node.data.id)));
	const previousEdgeIds = new Set(previous.edges.map((edge) => String(edge.data.id)));
	const currentNodeIds = new Set(current.nodes.map((node) => String(node.data.id)));
	const currentEdgeIds = new Set(current.edges.map((edge) => String(edge.data.id)));
	return {
		addedNodeIds: new Set([...currentNodeIds].filter((id) => !previousNodeIds.has(id))),
		addedEdgeIds: new Set([...currentEdgeIds].filter((id) => !previousEdgeIds.has(id))),
		removedNodes: previous.nodes.filter((node) => !currentNodeIds.has(String(node.data.id))).map((node) => ({ id: String(node.data.id), label: String(node.data.label ?? node.data.id), type: String(node.data.type ?? "") })),
		removedEdges: previous.edges.filter((edge) => !currentEdgeIds.has(String(edge.data.id))).map((edge) => ({ id: String(edge.data.id), source: String(edge.data.source), target: String(edge.data.target), relation: String(edge.data.relation ?? "") })),
	};
}
