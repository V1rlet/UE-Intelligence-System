import type { GraphElements } from "../graph-view/GraphView";
import {
	decorateSemanticRelationEdge,
	relationLabel as mindmapRelationLabel,
	relationPresentation as mindmapRelationPresentation,
	type RelationMotion,
} from "../graph-view/relationPresentation";

export { mindmapRelationLabel, mindmapRelationPresentation, type RelationMotion };

function decorateRelationEdge(edge: GraphElements["edges"][number], extra: Record<string, unknown>) {
	return decorateSemanticRelationEdge(edge, { architectureEdge: true, ...extra });
}

/**
 * 从当前 scope 的全量关系中选出无环主干，同时保留其余交叉关系。
 * 主干边负责稳定层级定位；多父节点、回边与自环作为次级关系叠加显示。
 */
export function buildLayeredArchitectureGraph(elements: GraphElements): GraphElements {
	const nodes = new Map(elements.nodes.map((entry) => [String(entry.data.id), entry]));
	const outgoing = new Map<string, typeof elements.edges>();
	const incoming = new Map<string, number>();
	const validEdges = elements.edges.filter((edge) => nodes.has(String(edge.data.source ?? "")) && nodes.has(String(edge.data.target ?? "")));
	for (const id of nodes.keys()) incoming.set(id, 0);
	for (const edge of validEdges) {
		const source = String(edge.data.source ?? "");
		const target = String(edge.data.target ?? "");
		if (source === target) continue;
		outgoing.set(source, [...(outgoing.get(source) ?? []), edge]);
		incoming.set(target, (incoming.get(target) ?? 0) + 1);
	}
	const labelOf = (id: string) => String(nodes.get(id)?.data.label ?? id);
	const sortIds = (ids: string[]) => ids.sort((a, b) => labelOf(a).localeCompare(labelOf(b), "zh-CN"));
	const roots = sortIds([...nodes.keys()].filter((id) => (incoming.get(id) ?? 0) === 0));
	const rootIds = new Set<string>();
	const visited = new Set<string>();
	const treeEdges: typeof elements.edges = [];
	const visit = (id: string, root: boolean) => {
		if (visited.has(id)) return;
		visited.add(id);
		if (root) rootIds.add(id);
		const edges = [...(outgoing.get(id) ?? [])].sort((a, b) => {
			const targetOrder = labelOf(String(a.data.target)).localeCompare(labelOf(String(b.data.target)), "zh-CN");
			const relationOrder = String(a.data.relation ?? "").localeCompare(String(b.data.relation ?? ""));
			return targetOrder || relationOrder || String(a.data.id ?? "").localeCompare(String(b.data.id ?? ""));
		});
		for (const edge of edges) {
			const target = String(edge.data.target);
			if (visited.has(target)) continue;
			treeEdges.push(decorateRelationEdge(edge, { forestPrimary: true }));
			visit(target, false);
		}
	};
	for (const root of roots) visit(root, true);
	for (const id of sortIds([...nodes.keys()].filter((candidate) => !visited.has(candidate)))) visit(id, true);
	const primaryEdgeIds = new Set(treeEdges.map((edge) => String(edge.data.id)));
	const secondaryEdges = validEdges
		.filter((edge) => !primaryEdgeIds.has(String(edge.data.id)))
		.map((edge) => decorateRelationEdge(edge, { forestSecondary: true }));

	// Position is derived presentation state only: the scope graph remains the sole
	// owner of identity and relationships. A deterministic layered pass keeps the
	// same scope readable after reloads and prevents stale persisted coordinates
	// from becoming a competing architectural fact.
	const children = new Map<string, string[]>();
	for (const edge of treeEdges) {
		const source = String(edge.data.source ?? "");
		const target = String(edge.data.target ?? "");
		children.set(source, [...(children.get(source) ?? []), target]);
	}
	for (const [parent, childIds] of children) children.set(parent, sortIds(childIds));

	const positions = new Map<string, { x: number; y: number }>();
	const columnGap = 270;
	const rowGap = 106;
	const componentGap = 48;
	const nodeWidth = 210;
	const nodeHeight = 76;
	const componentLayouts: Array<{
		rootId: string;
		positions: Map<string, { x: number; y: number }>;
		width: number;
		height: number;
	}> = [];
	const placeComponent = (rootId: string) => {
		const localPositions = new Map<string, { x: number; y: number }>();
		let nextRow = 0;
		const place = (id: string, depth: number): number => {
			const childIds = children.get(id) ?? [];
			let row: number;
			if (childIds.length === 0) {
				row = nextRow;
				nextRow += 1;
			} else {
				const childRows = childIds.map((childId) => place(childId, depth + 1));
				row = childRows.reduce((total, childRow) => total + childRow, 0) / childRows.length;
			}
			localPositions.set(id, { x: depth * columnGap, y: row * rowGap });
			return row;
		};
		place(rootId, 0);
		const values = [...localPositions.values()];
		const maxX = Math.max(0, ...values.map((position) => position.x));
		const maxY = Math.max(0, ...values.map((position) => position.y));
		componentLayouts.push({
			rootId,
			positions: localPositions,
			width: maxX + nodeWidth,
			height: maxY + nodeHeight,
		});
	};
	for (const rootId of sortIds([...rootIds])) placeComponent(rootId);

	// A single vertical root list made disconnected architecture previews fit at
	// unreadable 12–13% zoom. Pack immutable tree components onto deterministic
	// shelves instead. The graph still owns every id and edge; these coordinates
	// are disposable presentation state derived entirely from the same input.
	const totalArea = componentLayouts.reduce((sum, component) => sum + (component.width + componentGap) * (component.height + componentGap), 0);
	const targetWidth = Math.max(960, Math.min(1760, Math.sqrt(totalArea) * 1.4));
	let cursorX = 0;
	let cursorY = 0;
	let shelfHeight = 0;
	for (const component of componentLayouts) {
		if (cursorX > 0 && cursorX + component.width > targetWidth) {
			cursorX = 0;
			cursorY += shelfHeight + componentGap;
			shelfHeight = 0;
		}
		for (const [id, position] of component.positions) positions.set(id, { x: cursorX + position.x, y: cursorY + position.y });
		cursorX += component.width + componentGap;
		shelfHeight = Math.max(shelfHeight, component.height);
	}

	return {
		nodes: [...nodes.entries()].map(([id, node]) => {
			const data = node.data as Record<string, unknown>;
			const label = String(data.label ?? id);
			const qualifier = String(data.module ?? data.type ?? "");
			return {
				data: {
					...data,
					architectureNode: true,
					architectureLayer: rootIds.has(id),
					displayLabel: data.displayLabel ?? `${label}\n${qualifier}`,
					width: Number(data.width) || 210,
					height: Number(data.height) || 76,
				},
				position: positions.get(id),
			};
		}),
		edges: [...treeEdges, ...secondaryEdges],
	};
}
