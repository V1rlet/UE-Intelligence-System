export const GRAPH_PROJECTION_FORMAT_VERSION = 1 as const;
export const GRAPH_PROJECTION_KIND = "file_forest" as const;

export interface GraphProjectionSource {
	file: string;
	graph_format_version: number | null;
	revision: number | null;
	generated_at: string | null;
}

export interface GraphProjectionStats {
	canonical_nodes: number;
	canonical_edges: number;
	projected_nodes: number;
	projected_edges: number;
}

/**
 * Read-only transport projection. Nodes and edges remain canonical graph facts;
 * this document only selects a bounded capability-specific subset.
 */
export interface GraphProjectionDocument<TNode = unknown, TEdge = unknown> {
	format_version: typeof GRAPH_PROJECTION_FORMAT_VERSION;
	kind: typeof GRAPH_PROJECTION_KIND;
	source: GraphProjectionSource;
	meta: Record<string, unknown>;
	stats: GraphProjectionStats;
	elements: { nodes: TNode[]; edges: TEdge[] };
}
