// Graph Brain / viewer - 复合图邻域：确保跨容器邻接节点不会被父容器透明度压暗
import type cytoscape from "cytoscape";

/**
 * 计算节点的 N 跳可视邻域，并补齐所有命中节点的复合父容器。
 *
 * Cytoscape 的 compound 父节点透明度会影响子节点，因此只高亮跨容器的子节点还不够；
 * 必须同时解除其祖先容器的 dimmed 状态。
 */
export function compoundNHopHood(
	node: cytoscape.NodeSingular,
	hops: number,
	options: { structuralFallback?: boolean } = {},
): cytoscape.CollectionReturnValue {
	const seed = node.union(node.descendants());
	let nodes = seed;
	for (let i = 0; i < hops; i++) {
		const neighbors = nodes.neighborhood("node");
		// 区域框之间直接连线时，邻居首先命中的是 compound 父节点。
		// 把该邻居区域的全部后代一并纳入，区域 hover 才能展示框内事实，而非只亮空壳。
		nodes = nodes.union(neighbors).union(neighbors.descendants());
	}

	// 关卡/叙事图中允许存在“只有结构归属、暂时没有关系边”的事实节点。
	// 这类节点悬停时以直接父容器作为语义邻域：关卡中对应同一房间的要素，
	// 叙事中对应同一事实分块。已有关系边的节点仍严格展示连线邻域。
	if (options.structuralFallback && nodes.length === seed.length) {
		const parent = node.parent();
		if (parent.nonempty()) nodes = nodes.union(parent).union(parent.children());
	}

	return nodes.union(nodes.edgesWith(nodes)).union(nodes.ancestors());
}
