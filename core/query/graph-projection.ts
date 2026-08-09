import {
	GRAPH_PROJECTION_FORMAT_VERSION,
	GRAPH_PROJECTION_KIND,
	type GraphProjectionDocument,
} from "../schema/graph-projection.js";
import { isUeForestNodeType } from "../schema/ue-naming.js";

interface ProjectionNode {
	data: Record<string, unknown> & { id?: unknown; type?: unknown };
}

interface ProjectionEdge {
	data: Record<string, unknown> & { source?: unknown; target?: unknown; relation?: unknown };
}

export interface ProjectionGraph<TNode extends ProjectionNode = ProjectionNode, TEdge extends ProjectionEdge = ProjectionEdge> {
	meta?: Record<string, unknown>;
	elements: { nodes: TNode[]; edges: TEdge[] };
}

/** Selects the file forest without copying or rewriting canonical node/edge facts. */
export function buildFileForestProjection<TNode extends ProjectionNode, TEdge extends ProjectionEdge>(
	graph: ProjectionGraph<TNode, TEdge>,
	file: string,
): GraphProjectionDocument<TNode, TEdge> {
	const nodes = graph.elements.nodes.filter((node) => isUeForestNodeType(node.data.type));
	const ids = new Set(nodes.map((node) => String(node.data.id ?? "")));
	const edges = graph.elements.edges.filter((edge) =>
		edge.data.relation === "contains"
		&& ids.has(String(edge.data.source ?? ""))
		&& ids.has(String(edge.data.target ?? "")),
	);
	const meta = graph.meta ?? {};
	return {
		format_version: GRAPH_PROJECTION_FORMAT_VERSION,
		kind: GRAPH_PROJECTION_KIND,
		source: {
			file,
			graph_format_version: typeof meta.format_version === "number" ? meta.format_version : null,
			revision: typeof meta.revision === "number" ? meta.revision : null,
			generated_at: typeof meta.generated_at === "string" ? meta.generated_at : null,
		},
		meta,
		stats: {
			canonical_nodes: graph.elements.nodes.length,
			canonical_edges: graph.elements.edges.length,
			projected_nodes: nodes.length,
			projected_edges: edges.length,
		},
		elements: { nodes, edges },
	};
}
