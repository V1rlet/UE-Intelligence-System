import type { GraphCatalogPreview } from "../../src/graphCatalog";
import type { GraphElements } from "../graph-view/GraphView";

/**
 * Derive a focused architecture view from the canonical catalog preview.
 * Primary facts stay inside `group`; directly connected nodes from other groups
 * are retained as presentation-only context. No ids, edges, or relation types
 * are synthesized here.
 */
export function architectureScopeElements(preview: GraphCatalogPreview, group: string): GraphElements {
	const primaryIds = new Set(preview.nodes.filter((node) => node.group === group).map((node) => node.id));
	const displayedIds = new Set(primaryIds);
	for (const edge of preview.edges) {
		if (primaryIds.has(edge.source)) displayedIds.add(edge.target);
		if (primaryIds.has(edge.target)) displayedIds.add(edge.source);
	}
	const selected = preview.nodes.filter((node) => displayedIds.has(node.id));
	return {
		nodes: selected.map((node) => ({
			data: {
				id: node.id,
				label: node.label,
				type: node.type,
				group: node.group,
				architectureContext: node.group !== group,
			},
			...(node.position ? { position: node.position } : {}),
		})),
		edges: preview.edges
			.filter((edge) => displayedIds.has(edge.source) && displayedIds.has(edge.target) && (primaryIds.has(edge.source) || primaryIds.has(edge.target)))
			.map((edge, index) => ({ data: {
				id: `catalog-preview:${index}:${edge.source}:${edge.type ?? "related"}:${edge.target}`,
				source: edge.source,
				target: edge.target,
				type: edge.type,
				relation: edge.type,
			} })),
	};
}
