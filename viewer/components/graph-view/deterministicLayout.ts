// Graph Brain / viewer - 中小型知识图的确定性布局种子：保持跨加载空间记忆

export interface SeedNode {
	id: string;
	parent?: string;
}

export interface SeedPosition {
	x: number;
	y: number;
}

/** 按顶层复合分组排网格，组内叶节点排圆；结果只由 id/parent 决定。 */
export function deterministicSeedPositions(nodes: SeedNode[]): Map<string, SeedPosition> {
	const parentById = new Map(nodes.filter((node) => node.parent).map((node) => [node.id, node.parent!]));
	const nodeIds = new Set(nodes.map((node) => node.id));
	const rootOf = (id: string) => {
		let current = id;
		const seen = new Set<string>();
		while (parentById.has(current) && !seen.has(current)) {
			seen.add(current);
			current = parentById.get(current)!;
		}
		return nodeIds.has(current) ? current : id;
	};

	const leaves = nodes.filter((node) => !nodes.some((candidate) => candidate.parent === node.id));
	const byRoot = new Map<string, SeedNode[]>();
	for (const node of leaves) {
		const root = rootOf(node.id);
		const group = byRoot.get(root) ?? [];
		group.push(node);
		byRoot.set(root, group);
	}

	const roots = [...byRoot.keys()].sort((a, b) => a.localeCompare(b));
	const columns = Math.max(1, Math.ceil(Math.sqrt(roots.length)));
	const positions = new Map<string, SeedPosition>();
	roots.forEach((root, rootIndex) => {
		const centerX = (rootIndex % columns) * 280;
		const centerY = Math.floor(rootIndex / columns) * 240;
		const group = byRoot.get(root)!.sort((a, b) => a.id.localeCompare(b.id));
		if (group.length === 1) {
			positions.set(group[0].id, { x: centerX, y: centerY });
			return;
		}
		const radius = 54 + Math.min(group.length, 18) * 4;
		group.forEach((node, index) => {
			const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length;
			positions.set(node.id, {
				x: centerX + Math.cos(angle) * radius,
				y: centerY + Math.sin(angle) * radius,
			});
		});
	});
	return positions;
}

