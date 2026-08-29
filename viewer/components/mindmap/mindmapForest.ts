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
	// owner of identity and relationships. Positions come from a deterministic
	// semantic band layout (archify-style): 「基类/所有者 → 派生/部件」自左向右分带流动，
	// 无结构关系的孤立事实打包成纵向搁架列，同一输入永远得到同一张图。
	const flowReversed = new Set(["inherits", "implements", "overrides"]);
	const flowEdges = validEdges
		.filter((edge) => String(edge.data.source) !== String(edge.data.target))
		.map((edge) => {
			const source = String(edge.data.source);
			const target = String(edge.data.target);
			// inherits/implements 在模型里是「实现者→基类」，展示层翻转阅读方向；
			// 分带跟随阅读方向：基类带在左，实现者带在右。
			return flowReversed.has(String(edge.data.relation ?? ""))
				? { edge, from: target, to: source }
				: { edge, from: source, to: target };
		});
	const flowOutgoing = new Map<string, typeof flowEdges>();
	for (const item of flowEdges) flowOutgoing.set(item.from, [...(flowOutgoing.get(item.from) ?? []), item]);

	// 断环：按标签序 DFS，回边不参与分层（仍作为关系边展示）。
	const rankingEdges: typeof flowEdges = [];
	const dfsState = new Map<string, "entering" | "done">();
	const dfsVisit = (id: string) => {
		if (dfsState.get(id) === "done") return;
		dfsState.set(id, "entering");
		const outgoing = [...(flowOutgoing.get(id) ?? [])].sort((a, b) =>
			labelOf(a.to).localeCompare(labelOf(b.to), "zh-CN") || String(a.edge.data.id ?? "").localeCompare(String(b.edge.data.id ?? "")));
		for (const item of outgoing) {
			if (item.to === id || dfsState.get(item.to) === "entering") continue;
			rankingEdges.push(item);
			dfsVisit(item.to);
		}
		dfsState.set(id, "done");
	};
	for (const id of sortIds([...nodes.keys()])) dfsVisit(id);

	// 最长路径分层：rank 越大越靠右（下游/部件/数据类型）。
	const rank = new Map<string, number>();
	const indegree = new Map<string, number>();
	const rankingOutgoing = new Map<string, string[]>();
	for (const id of nodes.keys()) { indegree.set(id, 0); rank.set(id, 0); }
	for (const item of rankingEdges) {
		indegree.set(item.to, (indegree.get(item.to) ?? 0) + 1);
		rankingOutgoing.set(item.from, [...(rankingOutgoing.get(item.from) ?? []), item.to]);
	}
	const ready = sortIds([...nodes.keys()].filter((id) => (indegree.get(id) ?? 0) === 0));
	while (ready.length > 0) {
		const id = ready.shift()!;
		for (const next of sortIds([...(rankingOutgoing.get(id) ?? [])])) {
			rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1));
			const left = (indegree.get(next) ?? 1) - 1;
			indegree.set(next, left);
			if (left === 0) ready.push(next);
		}
		ready.sort((a, b) => labelOf(a).localeCompare(labelOf(b), "zh-CN"));
	}

	// 带内排序：标签序初始化 → 下行/上行两次重心扫掠减少交叉 → 标签兜底。
	const flowIncoming = new Map<string, string[]>();
	for (const item of rankingEdges) flowIncoming.set(item.to, [...(flowIncoming.get(item.to) ?? []), item.from]);
	const bands = new Map<number, string[]>();
	for (const [id, depth] of rank) bands.set(depth, [...(bands.get(depth) ?? []), id]);
	const order = new Map<string, number>();
	for (const [, ids] of [...bands].sort(([a], [b]) => a - b)) {
		for (const [index, id] of sortIds(ids).entries()) order.set(id, index);
	}
	const barycenter = (ids: string[]) => ids.length === 0
		? null
		: ids.reduce((total, id) => total + (order.get(id) ?? 0), 0) / ids.length;
	const byCenter = (scored: Array<{ id: string; key: number | null }>) =>
		scored.sort((a, b) =>
			(a.key ?? (order.get(a.id)! - 0.5)) - (b.key ?? (order.get(b.id)! - 0.5))
			|| labelOf(a.id).localeCompare(labelOf(b.id), "zh-CN"));
	for (const [depth] of [...bands].sort(([a], [b]) => a - b)) {
		const scored = (bands.get(depth) ?? []).map((id) => ({ id, key: barycenter(flowIncoming.get(id) ?? []) }));
		for (const [index, entry] of byCenter(scored).entries()) order.set(entry.id, index);
	}
	for (const [depth] of [...bands].sort(([a], [b]) => b - a)) {
		const scored = (bands.get(depth) ?? []).map((id) => ({ id, key: barycenter(rankingOutgoing.get(id) ?? []) }));
		for (const [index, entry] of byCenter(scored).entries()) order.set(entry.id, index);
	}

	// 坐标：带间自左向右（带距按带宽自适应），带内纵向居中、超高处再拆纵向搁架列。
	const columnGap = 128;
	const rowGap = 112;
	const maxRowsPerColumn = 6;
	const nodeWidth = 210;
	const columnWidth = nodeWidth + 48;
	const positions = new Map<string, { x: number; y: number }>();
	let bandX = 0;
	for (const [depth,] of [...bands].sort(([a], [b]) => a - b)) {
		const ids = [...(bands.get(depth) ?? [])].sort((a, b) =>
			(order.get(a) ?? 0) - (order.get(b) ?? 0) || labelOf(a).localeCompare(labelOf(b), "zh-CN"));
		const columns: string[][] = [];
		for (let index = 0; index < ids.length; index += maxRowsPerColumn) columns.push(ids.slice(index, index + maxRowsPerColumn));
		let widestHeight = 0;
		for (const [columnIndex, columnIds] of columns.entries()) {
			const x = bandX + columnIndex * columnWidth;
			const rows = columnIds.length;
			widestHeight = Math.max(widestHeight, (rows - 1) * rowGap);
			for (const [rowIndex, id] of columnIds.entries()) {
				positions.set(id, { x, y: rowIndex * rowGap - ((rows - 1) * rowGap) / 2 });
			}
		}
		const bandWidth = (columns.length - 1) * columnWidth + nodeWidth;
		bandX += bandWidth + columnGap;
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
