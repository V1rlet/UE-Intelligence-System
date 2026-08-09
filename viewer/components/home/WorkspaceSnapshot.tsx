import { useMemo, type ReactNode } from "react";
import type { GraphCatalogPreview, GraphCatalogPreviewNode } from "../../src/graphCatalog";

interface PositionedNode {
	id: string;
	label: string;
	x: number;
	y: number;
	tone: number;
}

const GRAPH_WIDTH = 1000;
const GRAPH_HEIGHT = 520;

function stableHash(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function graphSnapshotLayout(snapshot: GraphCatalogPreview): { nodes: PositionedNode[]; edges: Array<{ source: PositionedNode; target: PositionedNode }> } {
	const sourceNodes = snapshot.nodes
		.filter((node) => node.id)
		.slice(0, 42);
	const explicit = sourceNodes.every((node) => Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y));
	const positioned: PositionedNode[] = [];

	if (explicit && sourceNodes.length) {
		const xs = sourceNodes.map((node) => Number(node.position?.x));
		const ys = sourceNodes.map((node) => Number(node.position?.y));
		const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
		for (const node of sourceNodes) {
			const id = node.id;
			positioned.push({
				id,
				label: node.label,
				x: 80 + (Number(node.position?.x) - minX) / Math.max(1, maxX - minX) * 840,
				y: 60 + (Number(node.position?.y) - minY) / Math.max(1, maxY - minY) * 390,
				tone: stableHash(node.type ?? node.group ?? id) % 4,
			});
		}
	} else {
		const groups = new Map<string, GraphCatalogPreviewNode[]>();
		for (const node of sourceNodes) {
			const key = node.parent ?? node.group ?? node.type ?? "未分组";
			groups.set(key, [...(groups.get(key) ?? []), node]);
		}
		const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
		orderedGroups.forEach(([group, nodes], column) => {
			nodes.sort((left, right) => left.id.localeCompare(right.id));
			nodes.forEach((node, row) => {
				const id = node.id;
				positioned.push({
					id,
					label: node.label,
					x: 80 + (column + .5) / Math.max(1, orderedGroups.length) * 840,
					y: 60 + (row + .7) / Math.max(1, nodes.length) * 390,
					tone: stableHash(group) % 4,
				});
			});
		});
	}
	const byId = new Map(positioned.map((node) => [node.id, node]));
	return {
		nodes: positioned,
		edges: snapshot.edges.flatMap((edge) => {
			const source = byId.get(edge.source);
			const target = byId.get(edge.target);
			return source && target ? [{ source, target }] : [];
		}).slice(0, 90),
	};
}

function SnapshotFrame({ children, label, state = "ready" }: { children?: ReactNode; label: string; state?: "ready" | "loading" | "error" }) {
	return <span className={`home-card-preview workspace-snapshot is-${state}`} data-snapshot-state={state}>
		{children}
		<span className="workspace-snapshot-caption"><i />{label}</span>
	</span>;
}

export function GraphWorkspaceSnapshot({ file, label, preview }: { file: string; label: string; preview?: GraphCatalogPreview }) {
	const layout = useMemo(() => preview?.format_version === 1 ? graphSnapshotLayout(preview) : null, [preview]);
	if (!layout) return <SnapshotFrame label="旧目录未含缩略图 · 打开工作区查看" />;
	return <SnapshotFrame label={`最近保存快照 · ${label}`}>
		<svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${label} 图谱快照`} data-snapshot-source="catalog-preview-v1">
			<defs>
				<pattern id={`graph-grid-${stableHash(file)}`} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M 36 0 L 0 0 0 36" className="snapshot-grid-line" /></pattern>
			</defs>
			<rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} className="snapshot-backdrop" />
			<rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill={`url(#graph-grid-${stableHash(file)})`} />
			<g className="snapshot-edges">{layout.edges.map((edge, index) => <path key={`${edge.source.id}-${edge.target.id}-${index}`} d={`M ${edge.source.x} ${edge.source.y} C ${(edge.source.x + edge.target.x) / 2} ${edge.source.y}, ${(edge.source.x + edge.target.x) / 2} ${edge.target.y}, ${edge.target.x} ${edge.target.y}`} />)}</g>
			<g className="snapshot-nodes">{layout.nodes.map((node) => <g key={node.id} transform={`translate(${node.x} ${node.y})`} className={`tone-${node.tone}`}>
				<rect x="-58" y="-17" width="116" height="34" rx="5" />
				<circle cx="-43" cy="0" r="4" />
				<text x="-33" y="4">{node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}</text>
			</g>)}</g>
		</svg>
	</SnapshotFrame>;
}

export function WorkspaceSnapshotPlaceholder() {
	return <SnapshotFrame label="等待可用快照" state="loading" />;
}
