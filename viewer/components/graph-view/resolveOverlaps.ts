// Graph Brain / viewer - 图形冲突整理
// 先分离重叠节点，再为会穿过节点、彼此交叉或长距离贴合的连线选择低冲突曲线路由。
import type { Core, EdgeSingular, NodeSingular } from "cytoscape";

interface Box {
	n: NodeSingular;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

interface Point { x: number; y: number }
interface RoutedEdge { edge: EdgeSingular; points: Point[] }

function shiftUnit(n: NodeSingular, dx: number, dy: number): void {
	const leaves = n.isParent() ? n.descendants().filter((descendant) => !descendant.isParent()) : n;
	leaves.forEach((leaf) => {
		const position = leaf.position();
		leaf.position({ x: position.x + dx, y: position.y + dy });
	});
}

function resolveNodes(
	cy: Core,
	opts: { margin: number; maxIter: number; deadline: number },
): number {
	const groups = new Map<string, NodeSingular[]>();
	cy.nodes().forEach((node) => {
		if (!node.visible()) return;
		const key = node.isChild() ? node.parent().first().id() : "";
		const list = groups.get(key) ?? [];
		list.push(node);
		groups.set(key, list);
	});
	const depthOf = (key: string) => (key ? cy.getElementById(key).ancestors().length + 1 : 0);
	const ordered = [...groups.entries()]
		.filter(([, units]) => units.length >= 2)
		.sort((a, b) => depthOf(b[0]) - depthOf(a[0]))
		.map(([, units]) => units);

	let total = 0;
	for (let iteration = 0; iteration < opts.maxIter && Date.now() < opts.deadline; iteration++) {
		let moved = 0;
		for (const units of ordered) {
			const boxes: Box[] = units.map((node) => {
				const bounds = node.boundingBox({ includeLabels: true, includeOverlays: false });
				return { n: node, x1: bounds.x1, y1: bounds.y1, x2: bounds.x2, y2: bounds.y2 };
			});
			boxes.sort((a, b) => a.x1 - b.x1);
			for (let i = 0; i < boxes.length; i++) {
				const a = boxes[i];
				for (let j = i + 1; j < boxes.length; j++) {
					const b = boxes[j];
					if (b.x1 >= a.x2 + opts.margin) break;
					const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + opts.margin;
					const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + opts.margin;
					if (overlapX <= 0 || overlapY <= 0) continue;
					moved++;
					if (overlapX <= overlapY) {
						const direction = a.x1 + a.x2 <= b.x1 + b.x2 ? 1 : -1;
						const half = overlapX / 2;
						shiftUnit(a.n, -half * direction, 0);
						shiftUnit(b.n, half * direction, 0);
						a.x1 -= half * direction; a.x2 -= half * direction;
						b.x1 += half * direction; b.x2 += half * direction;
					} else {
						const direction = a.y1 + a.y2 <= b.y1 + b.y2 ? 1 : -1;
						const half = overlapY / 2;
						shiftUnit(a.n, 0, -half * direction);
						shiftUnit(b.n, 0, half * direction);
						a.y1 -= half * direction; a.y2 -= half * direction;
						b.y1 += half * direction; b.y2 += half * direction;
					}
				}
			}
		}
		total += moved;
		if (moved === 0) break;
	}
	return total;
}

function quadraticRoute(start: Point, end: Point, offset: number, steps = 16): Point[] {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.max(1, Math.hypot(dx, dy));
	const control = {
		x: (start.x + end.x) / 2 - (dy / length) * offset,
		y: (start.y + end.y) / 2 + (dx / length) * offset,
	};
	const points: Point[] = [];
	for (let index = 0; index <= steps; index++) {
		const t = index / steps;
		const inverse = 1 - t;
		points.push({
			x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
			y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
		});
	}
	return points;
}

function pointInBox(point: Point, box: Box, padding = 7): boolean {
	return point.x >= box.x1 - padding && point.x <= box.x2 + padding
		&& point.y >= box.y1 - padding && point.y <= box.y2 + padding;
}

function orientation(a: Point, b: Point, c: Point): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
	const abC = orientation(a, b, c);
	const abD = orientation(a, b, d);
	const cdA = orientation(c, d, a);
	const cdB = orientation(c, d, b);
	return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
		&& ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

function distanceSquared(a: Point, b: Point): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

function routeScore(edge: EdgeSingular, points: Point[], boxes: Box[], routed: RoutedEdge[], deadline: number): number {
	let score = 0;
	const endpointIds = new Set([edge.source().id(), edge.target().id()]);
	// 穿过非端点节点是最严重的冲突。
	for (let index = 2; index < points.length - 2; index++) {
		for (const box of boxes) {
			if (Date.now() >= deadline) return score;
			if (!endpointIds.has(box.n.id()) && pointInBox(points[index], box)) score += 180;
		}
	}
	for (const previous of routed) {
		if (Date.now() >= deadline) return score;
		const other = previous.points;
		// 线段交叉；首尾两小段不计，避免共同端点被误判。
		for (let i = 1; i < points.length - 2; i++) {
			for (let j = 1; j < other.length - 2; j++) {
				if (segmentsCross(points[i], points[i + 1], other[j], other[j + 1])) score += 55;
			}
		}
		// 平行贴合/共线重叠不会触发严格相交，用采样点距离补充检测。
		for (let i = 2; i < points.length - 2; i += 2) {
			for (let j = 2; j < other.length - 2; j += 2) {
				if (distanceSquared(points[i], other[j]) < 11 * 11) score += 7;
			}
		}
	}
	return score;
}

/**
 * 检测连线穿越、交叉和重叠，为冲突边自动选择确定性的绕行曲线。
 * 返回实际改为曲线路由的边数。
 */
export function resolveEdgeOverlaps(cy: Core, deadline = Number.POSITIVE_INFINITY): number {
	const boxes: Box[] = [];
	cy.nodes().filter((node) => node.visible()).forEach((node) => {
		const bounds = node.boundingBox({ includeLabels: true, includeOverlays: false });
		boxes.push({ n: node, x1: bounds.x1, y1: bounds.y1, x2: bounds.x2, y2: bounds.y2 });
	});
	const routed: RoutedEdge[] = [];
	let changed = 0;
	const edges: EdgeSingular[] = [];
	cy.edges().filter((edge) => edge.visible()).forEach((edge) => { edges.push(edge); });
	edges.sort((a, b) => a.id().localeCompare(b.id()));
	// 手动再次整理时，先清除上一次的 bypass style，再基于当前位置重新评估。
	for (const edge of edges) {
		if (edge.data("routeOffset") !== undefined) {
			edge.removeStyle("curve-style control-point-distances control-point-weights");
			edge.removeData("routeOffset");
		}
	}
	for (const edge of edges) {
		if (Date.now() >= deadline) break;
		const start = edge.source().position();
		const end = edge.target().position();
		// Spec 的继承与接口关系共享同一套强制直线视觉语言，不能被自动避障改成贝塞尔曲线。
		if (edge.hasClass("spec-straight")) {
			edge.removeStyle("curve-style control-point-distances control-point-weights");
			edge.removeData("routeOffset");
			routed.push({ edge, points: quadraticRoute(start, end, 0) });
			continue;
		}
		const distance = Math.hypot(end.x - start.x, end.y - start.y);
		const unit = Math.max(24, Math.min(54, distance * 0.22));
		const candidates = [0, unit, -unit, unit * 1.8, -unit * 1.8, unit * 2.6, -unit * 2.6];
		let bestOffset = 0;
		let bestPoints = quadraticRoute(start, end, 0);
		let bestScore = routeScore(edge, bestPoints, boxes, routed, deadline);
		for (const offset of candidates.slice(1)) {
			if (Date.now() >= deadline) break;
			const points = quadraticRoute(start, end, offset);
			const score = routeScore(edge, points, boxes, routed, deadline) + Math.abs(offset) * 0.025;
			if (score < bestScore) {
				bestScore = score;
				bestOffset = offset;
				bestPoints = points;
			}
		}
		if (bestOffset !== 0) {
			edge.style({
				"curve-style": "unbundled-bezier",
				"control-point-distances": bestOffset,
				"control-point-weights": 0.5,
			});
			edge.data("routeOffset", Math.round(bestOffset));
			changed++;
		} else {
			edge.removeData("routeOffset");
		}
		routed.push({ edge, points: bestPoints });
	}
	return changed;
}

/** 节点与连线的一体化冲突整理；保留旧默认导出，调用方无需分两步。 */
export default function resolveGraphOverlaps(
	cy: Core,
	opts: { margin?: number; maxIter?: number; timeBudgetMs?: number } = {},
): number {
	const deadline = Date.now() + (opts.timeBudgetMs ?? 300);
	const nodeMoves = resolveNodes(cy, {
		margin: opts.margin ?? 10,
		maxIter: opts.maxIter ?? 40,
		deadline,
	});
	const edgeRoutes = Date.now() < deadline ? resolveEdgeOverlaps(cy, deadline) : 0;
	return nodeMoves + edgeRoutes;
}
