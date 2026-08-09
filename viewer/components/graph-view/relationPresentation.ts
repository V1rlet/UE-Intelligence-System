import type cytoscape from "cytoscape";
import type { EdgeDefinition } from "cytoscape";
import { RELATION_COLORS } from "../../src/design-tokens";

export type RelationMotion = "emit" | "hold" | "flow" | "wire" | "type" | "related";

export interface RelationPresentation {
	icon: string;
	motion: RelationMotion;
	label: string;
}

const RELATION_LABELS: Record<string, string> = {
	inherits: "继承",
	implements: "实现",
	overrides: "覆写",
	depends_on: "依赖",
	composes: "组合",
	aggregates: "聚合",
	owns: "持有",
	contains: "包含",
	possesses: "拥有",
	creates: "创建",
	spawns: "生成",
	generates: "生成",
	loads: "加载",
	configures: "配置",
	activates: "激活",
	grants: "授予",
	injects: "注入",
	replicates_to: "复制到",
	binds_as_owner: "绑定 Owner",
	binds_as_avatar: "绑定 Avatar",
	binds_event: "订阅委托",
	dispatches_to: "派发到",
	enqueues_to: "入队到",
	submits_to: "提交到",
	synchronizes_with: "同步",
	completes_on: "完成于",
	calls: "调用",
	delegates: "委托",
	uses_member: "使用成员",
	lifecycle_sequence: "生命周期",
	feeds: "供给",
	publishes: "发布",
	observes: "观察",
};

const RELATION_FAMILIES: ReadonlyArray<{ motion: RelationMotion; icon: string; relations: ReadonlySet<string> }> = [
	{ motion: "emit", icon: "◆", relations: new Set(["creates", "grants", "activates", "publishes"]) },
	{ motion: "hold", icon: "⬡", relations: new Set(["owns", "contains", "composes", "aggregates", "possesses"]) },
	{ motion: "flow", icon: "▶", relations: new Set(["dispatches_to", "enqueues_to", "submits_to", "replicates_to", "loads", "completes_on", "calls", "delegates", "lifecycle_sequence", "feeds"]) },
	{ motion: "wire", icon: "⚡", relations: new Set(["depends_on", "configures", "injects", "binds_as_owner", "binds_as_avatar", "binds_event", "synchronizes_with", "uses_member", "observes"]) },
	{ motion: "type", icon: "△", relations: new Set(["inherits", "implements", "overrides"]) },
];

const RELATION_ICONS = new Set(RELATION_FAMILIES.map((family) => family.icon).concat("•"));

export function relationLabel(relation: string): string {
	return RELATION_LABELS[relation] ?? relation.replaceAll("_", " ");
}

export function relationPresentation(relation: string): RelationPresentation {
	const family = RELATION_FAMILIES.find((entry) => entry.relations.has(relation));
	return {
		icon: family?.icon ?? "•",
		motion: family?.motion ?? "related",
		label: relationLabel(relation),
	};
}

/**
 * 代码方案的数据契约用“实现者 → 基类 / 接口”保存，便于校验继承链与类型契约；
 * 总览画布则按知识阅读方向从类型契约向实现者展开。这里只反转展示端点，并保留模型端点，
 * 不改变图文件、编辑命令或检查器所依赖的稳定 edge id / relation。
 */
export function orientCodeTypeRelationForReading(edge: EdgeDefinition, domain?: string): EdgeDefinition {
	const relation = String(edge.data.relation ?? "");
	if (domain !== "ue5_code" || (relation !== "inherits" && relation !== "implements")) return edge;
	const modelSource = String(edge.data.source);
	const modelTarget = String(edge.data.target);
	return {
		...edge,
		data: {
			...edge.data,
			source: modelTarget,
			target: modelSource,
			modelSource,
			modelTarget,
			visualDirection: relation === "inherits" ? "base_to_derived" : "contract_to_implementer",
			label: relation === "inherits" ? "派生" : "实现者",
		},
	};
}

function withoutRelationIcon(label: string): string {
	const separator = label.indexOf(" ");
	if (separator <= 0 || !RELATION_ICONS.has(label.slice(0, separator))) return label;
	return label.slice(separator + 1);
}

export type DecoratedSemanticEdge<T extends EdgeDefinition> = T & {
	data: T["data"] & {
		label: string;
		relationIcon: string;
		relationMotion: RelationMotion;
		semanticRelation: true;
	};
};

/** Adds the shared visual contract without changing the source graph data. */
export function decorateSemanticRelationEdge<T extends EdgeDefinition & { data: EdgeDefinition["data"] & { relation: string } }>(edge: T, extra?: Record<string, unknown>): DecoratedSemanticEdge<T>;
export function decorateSemanticRelationEdge(edge: EdgeDefinition, extra?: Record<string, unknown>): EdgeDefinition;
export function decorateSemanticRelationEdge(edge: EdgeDefinition, extra: Record<string, unknown> = {}): EdgeDefinition {
	const relation = String(edge.data.relation ?? "");
	if (!relation) return edge;
	const presentation = relationPresentation(relation);
	const text = withoutRelationIcon(String(edge.data.label ?? presentation.label));
	return {
		...edge,
		data: {
			...edge.data,
			label: `${presentation.icon} ${text}`,
			relationIcon: presentation.icon,
			relationMotion: presentation.motion,
			semanticRelation: true,
			...extra,
		},
	};
}

type RelationMotionStyle = Record<string, string | number | number[]>;

export interface RelationMotionFrame {
	edge: RelationMotionStyle;
	source: RelationMotionStyle;
	target: RelationMotionStyle;
}

export const RELATION_LOOP_DELAY_MS = 1000;

function smoothStep(start: number, end: number, value: number): number {
	if (end <= start) return value >= end ? 1 : 0;
	const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
	return t * t * (3 - 2 * t);
}

/** Charges progressively to full strength, holds briefly, then releases without a hard blink. */
function accumulatedSignal(phase: number, start: number, full: number, release: number, end: number): number {
	const charge = smoothStep(start, full, phase);
	const discharge = 1 - smoothStep(release, end, phase);
	return charge * discharge;
}

export function relationMotionFrame(motion: RelationMotion, elapsed: number): RelationMotionFrame {
	const configs: Record<RelationMotion, { color: string; cycle: number; speed: number; pattern: number[]; baseWidth: number; sourceAt: number; targetAt: number }> = {
		emit: { color: RELATION_COLORS.emit, cycle: 900, speed: 7, pattern: [2, 9], baseWidth: 2.5, sourceAt: 0.08, targetAt: 0.62 },
		hold: { color: RELATION_COLORS.hold, cycle: 1450, speed: 24, pattern: [16, 6], baseWidth: 2.7, sourceAt: 0.15, targetAt: 0.55 },
		flow: { color: RELATION_COLORS.flow, cycle: 760, speed: 5, pattern: [11, 5], baseWidth: 2.6, sourceAt: 0.05, targetAt: 0.72 },
		wire: { color: RELATION_COLORS.wire, cycle: 980, speed: 10, pattern: [3, 4], baseWidth: 2.35, sourceAt: 0.1, targetAt: 0.68 },
		type: { color: RELATION_COLORS.type, cycle: 1320, speed: 20, pattern: [18, 7], baseWidth: 2.8, sourceAt: 0.18, targetAt: 0.64 },
		related: { color: RELATION_COLORS.related, cycle: 1100, speed: 14, pattern: [8, 7], baseWidth: 2.25, sourceAt: 0.12, targetAt: 0.66 },
	};
	const config = configs[motion];
	const loopDuration = config.cycle + RELATION_LOOP_DELAY_MS;
	const completedLoops = Math.floor(elapsed / loopDuration);
	const loopElapsed = elapsed % loopDuration;
	const paused = loopElapsed >= config.cycle;
	const activeElapsed = Math.min(loopElapsed, config.cycle);
	// Pause freezes the conveyor at the end of the completed pass. Cumulative active time
	// keeps the dash position continuous when the next pass starts, without counting idle time.
	const conveyorElapsed = completedLoops * config.cycle + activeElapsed;
	const phase = activeElapsed / config.cycle;
	const rampDuration = Math.min(120, config.cycle * 0.16);
	const loopEnvelope = paused
		? 0
		: Math.min(1, activeElapsed / rampDuration, (config.cycle - activeElapsed) / rampDuration);
	const sourceFullAt = Math.min(0.34, config.sourceAt + 0.1);
	const sourceReleaseAt = Math.max(sourceFullAt + 0.08, config.targetAt - 0.2);
	const sourceEmptyAt = Math.min(0.9, config.targetAt + 0.04);
	const targetChargeAt = Math.max(0.2, config.targetAt - 0.25);
	const targetReleaseAt = Math.max(config.targetAt + 0.09, 0.82);
	const sourcePulse = accumulatedSignal(phase, 0, sourceFullAt, sourceReleaseAt, sourceEmptyAt) * loopEnvelope;
	const targetPulse = accumulatedSignal(phase, targetChargeAt, config.targetAt, targetReleaseAt, 1) * loopEnvelope;
	const conveyorPulse = ((Math.sin(conveyorElapsed / 120) + 1) / 2) * loopEnvelope;
	const endpoint = (pulse: number): RelationMotionStyle => ({
		"border-color": config.color,
		"border-width": 2 + pulse * 2,
		"overlay-color": config.color,
		"overlay-opacity": 0.025 + pulse * 0.16,
		"overlay-padding": 4 + pulse * 6,
	});
	return {
		edge: {
			"line-style": "dashed",
			"line-dash-pattern": config.pattern,
			"line-dash-offset": -conveyorElapsed / config.speed,
			width: config.baseWidth + conveyorPulse * 0.55 + targetPulse * 0.45,
			opacity: 0.88 + conveyorPulse * 0.12,
			"arrow-scale": 1.08 + targetPulse * 0.38,
		},
		source: endpoint(sourcePulse),
		target: endpoint(targetPulse),
	};
}

/** Returns only direct outgoing semantic relations; incoming and second-hop edges are excluded. */
export function directlyDirectedSemanticEdges(node: cytoscape.NodeSingular): cytoscape.EdgeCollection {
	return node.outgoers("edge[?semanticRelation]").edges();
}

/** Installs continuous relation animation for both edge hover and direct-outgoing node hover. */
export function bindSemanticRelationMotion(cy: cytoscape.Core, reducedMotion: boolean): () => void {
	let activeEdges: cytoscape.EdgeCollection = cy.collection().edges();
	let styledNodes: cytoscape.NodeCollection = cy.collection().nodes();
	let activeSource: cytoscape.NodeSingular | null = null;
	let activeOwner: { kind: "edge" | "node"; id: string } | null = null;
	let animationFrame = 0;
	let animationStart = 0;
	const edgeSelector = "edge[?semanticRelation]";

	const clear = () => {
		cancelAnimationFrame(animationFrame);
		animationFrame = 0;
		activeEdges.removeClass("relation-hover");
		activeEdges.removeStyle("line-style line-dash-pattern line-dash-offset width opacity arrow-scale");
		styledNodes.removeStyle("border-color border-width overlay-color overlay-opacity overlay-padding");
		activeEdges = cy.collection().edges();
		styledNodes = cy.collection().nodes();
		activeSource = null;
		activeOwner = null;
	};
	const tick = (now: number) => {
		if (activeEdges.empty()) return;
		const elapsed = now - animationStart;
		const nodeDriven = activeOwner?.kind === "node";
		if (nodeDriven && activeSource?.nonempty()) {
			// A single neutral core pulse prevents several relation families from fighting over
			// the hovered source node while every outgoing edge keeps its own semantic color.
			activeSource.style(relationMotionFrame("related", elapsed).source as cytoscape.Css.Node);
		}
		activeEdges.edges().forEach((edge) => {
			const motion = String(edge.data("relationMotion") ?? "related") as RelationMotion;
			const frame = relationMotionFrame(motion, elapsed);
			edge.style(frame.edge as cytoscape.Css.Edge);
			if (!nodeDriven) edge.source().style(frame.source as cytoscape.Css.Node);
			if (!activeSource || edge.target().id() !== activeSource.id()) {
				edge.target().style(frame.target as cytoscape.Css.Node);
			}
		});
		animationFrame = requestAnimationFrame(tick);
	};
	const start = (edges: cytoscape.EdgeCollection, source: cytoscape.NodeSingular, owner: { kind: "edge" | "node"; id: string }) => {
		clear();
		activeEdges = edges.edges();
		if (activeEdges.empty()) return;
		activeSource = source;
		activeOwner = owner;
		styledNodes = activeEdges.connectedNodes().union(source);
		activeEdges.addClass("relation-hover");
		if (!reducedMotion) {
			animationStart = performance.now();
			animationFrame = requestAnimationFrame(tick);
		}
	};
	const enterEdge = (event: cytoscape.EventObject) => {
		const edge = event.target as cytoscape.EdgeSingular;
		start(cy.collection(edge).edges(), edge.source(), { kind: "edge", id: edge.id() });
	};
	const leaveEdge = (event: cytoscape.EventObject) => {
		const edge = event.target as cytoscape.EdgeSingular;
		if (activeOwner?.kind === "edge" && activeOwner.id === edge.id()) clear();
	};
	const enterNode = (event: cytoscape.EventObject) => {
		const node = event.target as cytoscape.NodeSingular;
		start(directlyDirectedSemanticEdges(node), node, { kind: "node", id: node.id() });
	};
	const leaveNode = (event: cytoscape.EventObject) => {
		const node = event.target as cytoscape.NodeSingular;
		if (activeOwner?.kind === "node" && activeOwner.id === node.id()) clear();
	};

	cy.on("mouseover", edgeSelector, enterEdge);
	cy.on("mouseout", edgeSelector, leaveEdge);
	cy.on("mouseover", "node", enterNode);
	cy.on("mouseout", "node", leaveNode);
	return () => {
		cy.off("mouseover", edgeSelector, enterEdge);
		cy.off("mouseout", edgeSelector, leaveEdge);
		cy.off("mouseover", "node", enterNode);
		cy.off("mouseout", "node", leaveNode);
		clear();
	};
}
