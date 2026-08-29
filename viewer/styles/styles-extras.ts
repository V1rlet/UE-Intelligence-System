// Graph Brain / viewer - 共享样式常量（从 stylesheets.ts 切分，P4U1 合成器之外的查看器知识）
// 与基底 JSON（*.style-base.json）相对：这里是跨域的交互态/LOD/动效/时间轴/叙事层级规则，
// 全部由 stylesheets.ts 的 compose() 按固定顺序拼入合成样式表（顺序即视觉行为）。

import { RELATION_COLORS } from "../src/design-tokens";

export interface StyleRule {
	selector: string;
	style: Record<string, unknown>;
}

// Code-fact graph motion variants.
// DECISION: 过渡规则不进基底 JSON，作为可选变体由调用方按元素量门控——
//           大图（>400 节点）悬停会全量翻转 dimmed 类，逐元素过渡动画有掉帧风险。
// REASON: 动效是聚焦/热力/回放等状态变化的"光学反馈"，小图收益大；
//         大图保持瞬时切换，帧率优先（实战性能守则）。
// DATE: 2026-07-11
export const MOTION_RULES: StyleRule[] = [
	{
		selector: "node",
		style: {
			"transition-property": "opacity, border-width, border-color, background-color, overlay-opacity",
			"transition-duration": "0.15s",
			"transition-timing-function": "ease-out",
		},
	},
	{
		selector: "edge",
		style: {
			"transition-property": "opacity, width, line-color",
			"transition-duration": "0.15s",
			"transition-timing-function": "ease-out",
		},
	},
];

// F23 语义缩放（LOD）：渲染字号低于阈值的标签自动隐藏——远观看结构、拉近看名字。
// 阈值取 5px：52% 缩放下 11px 标签（≈5.7px）仍显示，38% 全图态（≈4.2px 的涂抹）才隐藏，
// 不影响中小图的初始可读性，只给大图俯瞰降噪（同时省掉海量文本渲染）。
export const LOD_RULES: StyleRule[] = [
	{ selector: "node", style: { "min-zoomed-font-size": 5 } },
	{ selector: "edge", style: { "min-zoomed-font-size": 5 } },
];

// Large-type pass: canvas labels use the same readability floor as the surrounding UI.
// Role-specific rules preserve the visual hierarchy while increasing their text containers.
export const READABILITY_RULES: StyleRule[] = [
	{ selector: "node", style: { "font-size": 13, "text-max-width": 150 } },
	{ selector: "edge[label]", style: { "font-size": 11, "text-background-padding": 4 } },
	{ selector: "node[specRole = 'delegate']", style: { "font-size": 12, height: 28, padding: "8px" } },
	{ selector: "node[specRole = 'fog']", style: { "font-size": 11, width: 40, height: 31 } },
	{ selector: "node[specRole = 'zone']", style: { "font-size": 12, padding: "22px" } },
	{ selector: "node:parent", style: { "font-size": 14, padding: "18px" } },
	{ selector: "node[?architectureNode]", style: { "font-size": 15, "text-max-width": 220 } },
	{ selector: "node[?architectureLayer]", style: { "font-size": 17, "text-max-width": 245 } },
	{ selector: "node[?architectureContext]", style: { "border-style": "dashed", "border-width": 2, opacity: 0.68, "text-opacity": 0.82 } },
	{
		selector: "edge[?semanticRelation]",
		style: {
			"font-size": 14,
			"font-weight": 650,
			"text-rotation": "none",
			"text-wrap": "wrap",
			"text-max-width": 170,
			"text-margin-y": -8,
			"text-background-color": "#111721",
			"text-background-opacity": 0.94,
			"text-background-padding": 6,
		},
	},
	{
		selector: "edge[?architectureEdge]",
		style: {
			"font-size": 14,
			"text-rotation": "none",
			"text-wrap": "wrap",
			"text-max-width": 170,
			"text-margin-y": -9,
			"text-background-color": "#111721",
			"text-background-opacity": 0.96,
			"text-background-padding": 7,
		},
	},
	{ selector: "edge[relationMotion = 'emit']", style: { "line-color": RELATION_COLORS.emit, "target-arrow-color": RELATION_COLORS.emit, color: RELATION_COLORS.emit, "line-style": "dashed", "line-dash-pattern": [3, 7] } },
	{ selector: "edge[relationMotion = 'hold']", style: { "line-color": RELATION_COLORS.hold, "target-arrow-color": RELATION_COLORS.hold, color: RELATION_COLORS.hold, "line-style": "solid" } },
	{ selector: "edge[relationMotion = 'flow']", style: { "line-color": RELATION_COLORS.flow, "target-arrow-color": RELATION_COLORS.flow, color: RELATION_COLORS.flow, "line-style": "dashed", "line-dash-pattern": [9, 5] } },
	{ selector: "edge[relationMotion = 'wire']", style: { "line-color": RELATION_COLORS.wire, "target-arrow-color": RELATION_COLORS.wire, color: RELATION_COLORS.wire, "line-style": "dashed", "line-dash-pattern": [5, 5] } },
	{ selector: "edge[relationMotion = 'type']", style: { "line-color": RELATION_COLORS.type, "target-arrow-color": RELATION_COLORS.type, color: RELATION_COLORS.type, "line-style": "solid" } },
	{ selector: "edge[relationMotion = 'related']", style: { "line-color": RELATION_COLORS.related, "target-arrow-color": RELATION_COLORS.related, color: RELATION_COLORS.related, "line-style": "dashed", "line-dash-pattern": [8, 7] } },
	{
		selector: "edge[?forestSecondary]",
		style: {
			"curve-style": "bezier",
			"line-style": "dashed",
			width: 1.35,
			opacity: 0.48,
			"text-opacity": 0.7,
			"target-arrow-shape": "triangle",
		},
	},
	{
		selector: "edge.relation-hover",
		style: {
			opacity: 1,
			"text-opacity": 1,
			"font-weight": 700,
			"text-background-opacity": 1,
			"text-background-padding": 7,
			"z-index": 45,
		},
	},
	{ selector: "node[?executionNode]", style: { "font-size": 16, "text-max-width": 230 } },
];

// 所有领域共享同一套交互状态。起点、直接连线邻居、结构上下文与非当前镜头内容
// 由 class 区分，避免每个 *.style-base.json 复制一套略有偏差的高亮规则。
export const INTERACTION_RULES: StyleRule[] = [
	{ selector: ".dimmed", style: { opacity: 0.32 } },
	{ selector: "node.lens-context", style: { opacity: 0.34 } },
	{ selector: "node.highlighted", style: { opacity: 1, "border-width": 3 } },
	{
		selector: "node.highlight-origin",
		style: {
			"border-width": 4,
			"overlay-color": "#f4c56a",
			"overlay-opacity": 0.18,
			"overlay-padding": 8,
			"z-index": 40,
		},
	},
	{
		selector: "node.highlight-neighbor",
		style: {
			"border-width": 4,
			"overlay-color": "#7bd7e0",
			"overlay-opacity": 0.16,
			"overlay-padding": 7,
			"z-index": 35,
		},
	},
	{ selector: "edge.highlighted", style: { opacity: 1, width: 3, "z-index": 30 } },
	{ selector: "edge.highlight-neighbor", style: { opacity: 1, width: 4, "z-index": 36 } },
	{
		selector: "node.highlight-predecessor",
		style: {
			opacity: 0.62,
			"border-color": "#71828f",
			"border-width": 2,
			"border-style": "dashed",
			"overlay-color": "#9eb0ba",
			"overlay-opacity": 0.025,
			"overlay-padding": 3,
			"z-index": 24,
		},
	},
	{
		selector: "edge.highlight-predecessor",
		style: {
			opacity: 0.42,
			width: 1.5,
			"line-color": "#71828f",
			"target-arrow-color": "#8295a2",
			"line-style": "dashed",
			"arrow-scale": 0.78,
			"text-opacity": 0.55,
			"z-index": 22,
		},
	},
	{
		selector: "node.highlight-successor",
		style: {
			opacity: 1,
			"border-color": "#7bd7e0",
			"border-width": 4,
			"border-style": "solid",
			"overlay-color": "#7bd7e0",
			"overlay-opacity": 0.14,
			"overlay-padding": 7,
			"z-index": 38,
		},
	},
	{
		selector: "edge.highlight-successor",
		style: {
			opacity: 1,
			width: 4,
			"text-opacity": 1,
			"z-index": 39,
		},
	},
];
