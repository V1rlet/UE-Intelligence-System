// Stable contracts shared by the UE code extractor and the read-only viewer.

export interface GraphNodeData {
	id: string;
	label: string;
	type: string;
	domain: "ue5_code";
	[key: string]: unknown;
}

export interface GraphNode {
	data: GraphNodeData;
	position?: { x: number; y: number };
	[key: string]: unknown;
}

export interface GraphEdgeData {
	id: string;
	source: string;
	target: string;
	relation: string;
	domain: "ue5_code";
	[key: string]: unknown;
}

export interface GraphEdge {
	data: GraphEdgeData;
	[key: string]: unknown;
}

export interface GraphFile {
	meta: Record<string, unknown> & { domain: "ue5_code"; format_version: number };
	elements: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export interface NodeTypeDecl {
	type: string;
	label: string;
	shape: string;
	colorRamp?: string;
	style?: Record<string, string | number>;
}

export interface EdgeTypeDecl {
	relation: string;
	label: string;
	lineStyle: "solid" | "dashed" | "dotted";
	directed: boolean;
}

export interface AbstractionRules {
	groupBy: string;
	fogLabel: (group: string, count: number) => string;
	silhouetteEntryTypes: string[];
}

export interface DomainMeta {
	domain: "ue5_code";
	displayName: string;
	nodeTypes: NodeTypeDecl[];
	edgeTypes: EdgeTypeDecl[];
	abstractionRules: AbstractionRules;
}

export interface DiffResult {
	added: { nodes: GraphNode[]; edges: GraphEdge[] };
	removed: { nodeIds: string[]; edgeIds: string[] };
	modified: { nodes: GraphNode[]; edges: GraphEdge[] };
}
