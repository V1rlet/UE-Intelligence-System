// Graph Brain / viewer - 图邻域高亮控制器
// 统一 Focus 与 Hover 的 class 写入，并吸收 compound 节点 mouseout/mouseover 交错竞态。
import type cytoscape from "cytoscape";
import { compoundNHopHood } from "./neighborhood";

const HIGHLIGHT_CLASSES = "dimmed highlighted highlight-origin highlight-neighbor highlight-successor highlight-predecessor";

export interface NeighborhoodHighlightOptions {
	structuralFallback?: boolean;
}

export function clearNeighborhoodHighlight(cy: cytoscape.Core): void {
	cy.elements().removeClass(HIGHLIGHT_CLASSES);
}

/** 应用邻域态，并明确标记起点与一跳直连节点，供样式表达不同视觉权重。 */
export function applyNeighborhoodHighlight(
	cy: cytoscape.Core,
	node: cytoscape.NodeSingular,
	hops: number,
	options: NeighborhoodHighlightOptions = {},
): cytoscape.CollectionReturnValue {
	const hood = compoundNHopHood(node, hops, options);
	const directNodes = node.neighborhood("node");
	const direct = directNodes
		.union(directNodes.descendants())
		.union(node.connectedEdges())
		.intersection(hood);
	const outgoingEdges = node.outgoers("edge").intersection(hood).edges();
	const incomingEdges = node.incomers("edge").intersection(hood).edges();
	const successors = outgoingEdges
		.union(outgoingEdges.targets())
		.union(outgoingEdges.targets().descendants())
		.intersection(hood);
	const predecessors = incomingEdges
		.union(incomingEdges.sources())
		.union(incomingEdges.sources().descendants())
		.intersection(hood);
	cy.batch(() => {
		cy.elements().addClass("dimmed").removeClass("highlighted highlight-origin highlight-neighbor highlight-successor highlight-predecessor");
		hood.removeClass("dimmed").addClass("highlighted");
		direct.addClass("highlight-neighbor");
		predecessors.addClass("highlight-predecessor");
		successors.removeClass("highlight-predecessor").addClass("highlight-successor");
		node.addClass("highlight-origin");
	});
	return hood;
}

interface HoverControllerOptions extends NeighborhoodHighlightOptions {
	isEnabled?: () => boolean;
	schedule?: (callback: () => void) => number;
	cancel?: (token: number) => void;
}

export interface HoverHighlightController {
	enter(node: cytoscape.NodeSingular): void;
	leave(node: cytoscape.NodeSingular): void;
	clear(): void;
	destroy(): void;
}

/**
 * Compound 图在子节点与父容器之间移动时会交错触发 mouseout/mouseover。
 * 清理延后一帧，并由新的 enter 取消，避免直接邻域刚亮起就被旧节点的 leave 抹掉。
 */
export function createHoverHighlightController(
	cy: cytoscape.Core,
	options: HoverControllerOptions = {},
): HoverHighlightController {
	const schedule = options.schedule ?? ((callback) => window.setTimeout(callback, 280));
	const cancel = options.cancel ?? ((token) => window.clearTimeout(token));
	let activeId: string | null = null;
	let clearToken: number | null = null;
	const enabled = () => options.isEnabled?.() ?? true;

	const cancelPendingClear = () => {
		if (clearToken === null) return;
		cancel(clearToken);
		clearToken = null;
	};
	const clear = () => {
		cancelPendingClear();
		activeId = null;
		clearNeighborhoodHighlight(cy);
	};

	return {
		enter(node) {
			if (!enabled()) return;
			cancelPendingClear();
			activeId = node.id();
			applyNeighborhoodHighlight(cy, node, 1, options);
		},
		leave(node) {
			if (!enabled() || activeId !== node.id()) return;
			const leavingId = node.id();
			cancelPendingClear();
			clearToken = schedule(() => {
				clearToken = null;
				if (activeId !== leavingId) return;
				activeId = null;
				clearNeighborhoodHighlight(cy);
			});
		},
		clear,
		destroy: clear,
	};
}
