// Graph Brain / viewer - 图例浮层（F6）：域感知的节点/边/层图例 + 热力图色阶条
//
// DECISION: 图例数据从「合成后的 Cytoscape 样式表 + DomainMeta 声明」自动派生，
//           且只显示当前图里实际出现的类型/关系/层，不另建图例配置
// REASON: 样式表是视觉的唯一事实来源（P4U1 已声明化），手写图例配置必然随样式漂移；
//         按在场元素过滤避免六域全量类型撑爆浮层。
// DATE: 2026-07-10

import { useMemo, useState } from "react";
import { DOMAIN_METAS } from "../../../adapters/registry";
import { stylesheetFor } from "../../styles/stylesheets";
import { LEGEND_FALLBACK } from "../../src/design-tokens";
import { loadPref, savePref } from "../../src/uiPrefs";
import { relationPresentation } from "./relationPresentation";

export interface LegendHeatmapInfo {
	/** 当前指标显示名（中介度/传入/传出） */
	metricLabel: string;
	/** 指标最大原始值（色阶右端） */
	max: number;
	/** 0–1 → CSS 色值 */
	color: (t: number) => string;
	/** 回路节点数（0 = 不显示回路行） */
	cycleCount: number;
}

interface Props {
	domain: string;
	presentTypes: Set<string>;
	presentRelations: Set<string>;
	presentLayers: Set<string>;
	heatmap?: LegendHeatmapInfo | null;
}

interface StyleRule {
	selector: string;
	style: Record<string, unknown>;
}

/** 从合成样式表提取 node[type=X] / edge[relation=X] / node[layer=X] 的关键视觉属性 */
function indexStylesheet(domain: string) {
	const rules = stylesheetFor(domain) as unknown as StyleRule[];
	const nodeStyle = new Map<string, Record<string, unknown>>();
	const edgeStyle = new Map<string, Record<string, unknown>>();
	const layerColor = new Map<string, string>();
	let baseNode: Record<string, unknown> = {};
	let baseEdge: Record<string, unknown> = {};
	for (const r of rules) {
		if (typeof r.selector !== "string") continue;
		if (r.selector === "node") baseNode = { ...baseNode, ...r.style };
		else if (r.selector === "edge") baseEdge = { ...baseEdge, ...r.style };
		const typeMatch = r.selector.match(/^node\[type = '([^']+)'\]$/);
		if (typeMatch) nodeStyle.set(typeMatch[1], r.style);
		const relMatch = r.selector.match(/^edge\[relation = '([^']+)'\]$/);
		if (relMatch) edgeStyle.set(relMatch[1], r.style);
		const layerMatch = r.selector.match(/^node\[layer = '([^']+)'\]$/);
		if (layerMatch && typeof r.style["background-color"] === "string") {
			layerColor.set(layerMatch[1], r.style["background-color"] as string);
		}
	}
	return { nodeStyle, edgeStyle, layerColor, baseNode, baseEdge };
}

/** 形状名 → 12×12 swatch 的 SVG path/element */
function ShapeSwatch({ shape, color }: { shape: string; color: string }) {
	const s = { fill: color, stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 };
	switch (shape) {
		case "round-rectangle":
			return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="2.5" width="12" height="9" rx="2.5" {...s} /></svg>;
		case "cut-rectangle":
			return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="3.5,2.5 10.5,2.5 13,5 13,11.5 1,11.5 1,5" {...s} /></svg>;
		case "hexagon":
			return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="4,2 10,2 13,7 10,12 4,12 1,7" {...s} /></svg>;
		case "diamond":
			return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="7,1 13,7 7,13 1,7" {...s} /></svg>;
		case "right-rhomboid":
			return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="4,3 13,3 10,11 1,11" {...s} /></svg>;
		case "triangle":
			return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="7,1.5 13,12 1,12" {...s} /></svg>;
		default: // ellipse 与未知形状
			return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" {...s} /></svg>;
	}
}

function EdgeSwatch({ lineStyle, color, directed }: { lineStyle: string; color: string; directed: boolean }) {
	const dash = lineStyle === "dashed" ? "5 3" : lineStyle === "dotted" ? "1.5 2.5" : undefined;
	return (
		<svg width="26" height="10" viewBox="0 0 26 10">
			<line x1="1" y1="5" x2={directed ? 19 : 25} y2="5" stroke={color} strokeWidth="1.8" strokeDasharray={dash} />
			{directed ? <polygon points="19,1.5 25,5 19,8.5" fill={color} /> : null}
		</svg>
	);
}

const LAYER_LABELS: Record<string, string> = { project: "项目层", engine: "引擎层", plugin: "插件层" };

export default function Legend({ domain, presentTypes, presentRelations, presentLayers, heatmap }: Props) {
	const [collapsed, setCollapsed] = useState<boolean>(() => loadPref("legendCollapsed", false));
	const toggle = () => {
		setCollapsed((c) => {
			savePref("legendCollapsed", !c);
			return !c;
		});
	};

	const meta = DOMAIN_METAS.ue5_code;
	const styles = useMemo(() => indexStylesheet(domain), [domain]);

	const nodeRows = useMemo(() => {
		const decls = meta.nodeTypes;
		return decls
			.filter((t) => presentTypes.has(t.type))
			.map((t) => {
				const style = styles.nodeStyle.get(t.type) ?? t.style ?? {};
				const color =
					(style["background-color"] as string | undefined) ??
					(styles.baseNode["background-color"] as string | undefined) ??
					LEGEND_FALLBACK.node;
				const shape = (style.shape as string | undefined) ?? t.shape;
				return { type: t.type, label: t.label, shape, color };
			});
	}, [meta, presentTypes, styles]);

	const edgeRows = useMemo(() => {
		const decls = meta.edgeTypes;
		return decls
			.filter((e) => presentRelations.has(e.relation))
			.map((e) => {
				const style = styles.edgeStyle.get(e.relation) ?? {};
				const presentation = relationPresentation(e.relation);
				const color =
					(style["line-color"] as string | undefined) ??
					(styles.baseEdge["line-color"] as string | undefined) ??
					LEGEND_FALLBACK.edge;
				const lineStyle = (style["line-style"] as string | undefined) ?? e.lineStyle;
				return { relation: e.relation, label: e.label, icon: presentation.icon, motion: presentation.motion, color, lineStyle, directed: e.directed };
			});
	}, [meta, presentRelations, styles]);

	const layerRows = useMemo(
		() =>
			[...styles.layerColor.entries()]
				.filter(([layer]) => presentLayers.has(layer))
				.map(([layer, color]) => ({ layer, label: LAYER_LABELS[layer] ?? layer, color })),
		[styles, presentLayers],
	);

	if (collapsed) {
		return (
			<button className="legend-fab" title="展开图例" aria-label="展开图例" onClick={toggle}>
				🗺 图例
			</button>
		);
	}

	const gradient = heatmap
		? `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => heatmap.color(t)).join(", ")})`
		: undefined;

	return (
		<div className="legend" role="note" aria-label="图例">
			<div className="legend-head">
				<span>🗺 图例{meta ? ` · ${meta.displayName}` : ""}</span>
				<button title="收起图例" aria-label="收起图例" onClick={toggle}>—</button>
			</div>
			<div className="legend-body">
				{heatmap ? (
					<section>
						<h4>热力图 · {heatmap.metricLabel}</h4>
						<div className="legend-heat">
							<span>0</span>
							<span className="legend-heat-bar" style={{ background: gradient }} />
							<span>{heatmap.max % 1 === 0 ? heatmap.max : heatmap.max.toFixed(2)}</span>
						</div>
						{heatmap.cycleCount > 0 ? (
							<div className="legend-row">
								<span className="legend-cycle-swatch" aria-hidden="true" />
								<span>回路成员（{heatmap.cycleCount} 节点）</span>
							</div>
						) : null}
					</section>
				) : null}
				{layerRows.length > 0 ? (
					<section>
						<h4>层</h4>
						{layerRows.map((r) => (
							<div className="legend-row" key={r.layer}>
								<span className="legend-color-dot" style={{ background: r.color }} aria-hidden="true" />
								<span>{r.label}</span>
							</div>
						))}
					</section>
				) : null}
				{nodeRows.length > 0 ? (
					<section>
						<h4>节点</h4>
						{nodeRows.map((r) => (
							<div className="legend-row" key={r.type}>
								<ShapeSwatch shape={r.shape} color={r.color} />
								<span>{r.label}</span>
							</div>
						))}
					</section>
				) : null}
				{edgeRows.length > 0 ? (
					<section>
						<h4>关系</h4>
						{edgeRows.map((r) => (
							<div className="legend-row" key={r.relation}>
								<b className={`legend-relation-icon is-${r.motion}`} aria-hidden="true">{r.icon}</b>
								<EdgeSwatch lineStyle={r.lineStyle} color={r.color} directed={r.directed} />
								<span>{r.label}</span>
							</div>
						))}
					</section>
				) : null}
			</div>
		</div>
	);
}
